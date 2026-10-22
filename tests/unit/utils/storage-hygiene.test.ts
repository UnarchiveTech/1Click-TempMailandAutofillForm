import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  isProfilePictureTooLarge,
  MAX_PROFILE_PICTURE_FILE_BYTES,
} from '@/utils/identity/profile-picture.js';
import {
  applySoftEmailBudget,
  clampProfilePictureDataUrl,
  pruneFaviconCache,
  pruneStoredEmailsMap,
  runStorageHygiene,
  STORAGE_CAPS,
  trimEmailList,
} from '@/utils/storage/storage-hygiene.js';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});

const store: Record<string, unknown> = {};
mock.module('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: async (keys?: string | string[] | null) => {
          if (keys === null || keys === undefined) return { ...store };
          const arr = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of arr) if (k in store) out[k] = store[k];
          return out;
        },
        set: async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        },
        remove: async (keys: string | string[]) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
        },
      },
    },
  },
}));

// storage-hygiene imports storage-keys.ts helpers that read the bare global.
Object.assign(globalThis, { browser: (await import('wxt/browser')).browser });

describe('storage-hygiene', () => {
  test('trimEmailList keeps newest', () => {
    const list = Array.from({ length: 5 }, (_, i) => ({ received_at: i + 1 }));
    const trimmed = trimEmailList(list, 3);
    expect(trimmed).toHaveLength(3);
    expect(trimmed[0]?.received_at).toBe(5);
  });

  test('pruneStoredEmailsMap prefers active addresses', () => {
    const map: Record<string, unknown[]> = {};
    for (let i = 0; i < 5; i++) {
      map[`a${i}@test.com`] = [{ received_at: i }];
    }
    const pruned = pruneStoredEmailsMap(map, ['a4@test.com']);
    expect(Object.keys(pruned)).toContain('a4@test.com');
  });

  test('profile picture size cap', () => {
    const ok = `data:image/png;base64,${'a'.repeat(100)}`;
    const big = `data:image/png;base64,${'a'.repeat(STORAGE_CAPS.maxProfilePictureChars + 10)}`;
    expect(clampProfilePictureDataUrl(ok)).toBe(ok);
    expect(clampProfilePictureDataUrl(big)).toBeNull();
  });

  test('cleanup preserves a picture at the editor upload limit', async () => {
    const picture = `data:image/png;base64,${'a'.repeat(4 * Math.ceil(MAX_PROFILE_PICTURE_FILE_BYTES / 3))}`;
    expect(isProfilePictureTooLarge(picture)).toBe(false);
    expect(clampProfilePictureDataUrl(picture)).toBe(picture);
    store.identities = [{ id: 'profile', profilePicture: picture }];
    await runStorageHygiene();
    expect((store.identities as Array<{ profilePicture: string }>)[0]?.profilePicture).toBe(
      picture
    );
  });
});

describe('pruneFaviconCache', () => {
  test('keeps the NEWEST entries by timestamp (mirrors the module LRU)', () => {
    const cache: Record<string, unknown> = {};
    for (let i = 0; i < 10; i++) {
      cache[`d${i}.example`] = { timestamp: i + 1 };
    }
    const pruned = pruneFaviconCache(cache, 5);
    expect(Object.keys(pruned).sort()).toEqual([
      'd5.example',
      'd6.example',
      'd7.example',
      'd8.example',
      'd9.example',
    ]);
  });

  test('entries without a usable timestamp sort last (evicted first)', () => {
    const cache = {
      'fresh.example': { timestamp: Date.now() },
      'old.example': {},
      'bad.example': { timestamp: 'nope' },
    };
    const pruned = pruneFaviconCache(cache, 1);
    expect(Object.keys(pruned)).toEqual(['fresh.example']);
  });

  test('under the cap the object is returned unchanged', () => {
    const cache = { 'a.example': { timestamp: 1 } };
    expect(pruneFaviconCache(cache, 5)).toBe(cache);
  });
});

describe('runStorageHygiene - favicon cache caps', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
  });

  test('regression: the REAL favicon caches are capped (the old pass pruned a key nothing writes)', () => {
    const successCache: Record<string, unknown> = {};
    const errorCache: Record<string, unknown> = {};
    for (let i = 0; i < STORAGE_CAPS.maxFavicons + 10; i++) {
      successCache[`s${i}.example`] = { timestamp: Date.now() + i };
      errorCache[`e${i}.example`] = { timestamp: Date.now() + i };
    }
    store.favicon_success_cache = successCache;
    store.favicon_error_cache = errorCache;

    const result = runStorageHygiene();

    return result.then(({ faviconsPruned }) => {
      expect(faviconsPruned).toBe(true);
      const nextSuccess = store.favicon_success_cache as Record<string, unknown>;
      const nextError = store.favicon_error_cache as Record<string, unknown>;
      expect(Object.keys(nextSuccess)).toHaveLength(STORAGE_CAPS.maxFavicons);
      expect(Object.keys(nextError)).toHaveLength(STORAGE_CAPS.maxFavicons);
      // Newest kept, oldest evicted.
      expect(nextSuccess[`s${STORAGE_CAPS.maxFavicons + 9}.example`]).toBeDefined();
      expect(nextSuccess['s0.example']).toBeUndefined();
    });
  });

  test('under the cap nothing is written', async () => {
    store.favicon_success_cache = { 'a.example': { timestamp: 1 } };
    store.favicon_error_cache = { 'b.example': { timestamp: 1 } };

    const { faviconsPruned } = await runStorageHygiene();
    expect(faviconsPruned).toBe(false);
    expect(Object.keys(store.favicon_success_cache as object)).toEqual(['a.example']);
  });
});

describe('applySoftEmailBudget', () => {
  const bigStored = () => ({
    'one@example.com': Array.from({ length: 200 }, (_, i) => ({ received_at: i + 1 })),
  });
  const bigArchived = () => ({
    'arch@example.com': Array.from({ length: 200 }, (_, i) => ({ received_at: i + 1 })),
  });

  test('fits within the budget: nothing trimmed', () => {
    const stored = { 'one@example.com': [{ received_at: 1 }] };
    const result = applySoftEmailBudget(stored, {}, 10_000);
    expect(result.trimmedStored).toBe(false);
    expect(result.trimmedArchived).toBe(false);
    expect(result.stored).toBe(stored);
  });

  test('stored bags are trimmed first (halving) before archived is touched', () => {
    const result = applySoftEmailBudget(bigStored(), bigArchived(), 5_000);
    expect(result.trimmedStored).toBe(true);
    expect(result.trimmedArchived).toBe(false);
    // The stored bag shrank below its original size…
    expect(result.stored['one@example.com']?.length).toBeLessThan(200);
    // …while archived stayed untouched.
    expect(result.archived['arch@example.com']).toHaveLength(200);
  });

  test('stored at floor + archived dominating: oldest archived mail is trimmed', () => {
    const stored = {
      'one@example.com': Array.from({ length: STORAGE_CAPS.softBudgetFloorPerAddress }, (_, i) => ({
        received_at: i + 1,
      })),
    };
    const result = applySoftEmailBudget(stored, bigArchived(), 1_000);
    // Stored already sits at its floor - only archived can shrink.
    expect(result.trimmedStored).toBe(false);
    expect(result.trimmedArchived).toBe(true);
    expect(result.archived['arch@example.com']?.length).toBeLessThan(200);
    // Newest archived mail survives (oldest dropped).
    const kept = result.archived['arch@example.com'] as Array<{ received_at: number }>;
    expect(kept[0]?.received_at).toBe(200);
  });

  test('both at floors and still over budget: stops without error (documented limit)', () => {
    const tinyBudget = 1;
    const stored = {
      'one@example.com': Array.from({ length: STORAGE_CAPS.softBudgetFloorPerAddress }, (_, i) => ({
        received_at: i + 1,
      })),
    };
    const archived = {
      'arch@example.com': Array.from(
        { length: STORAGE_CAPS.archivedSoftBudgetFloorPerAddress },
        (_, i) => ({ received_at: i + 1 })
      ),
    };
    // Both maps are at their floors; a sub-atomic budget cannot converge -
    // the pass terminates and reports nothing further to trim.
    const result = applySoftEmailBudget(stored, archived, tinyBudget);
    expect(result.trimmedStored).toBe(false);
    expect(result.trimmedArchived).toBe(false);
    expect(result.stored).toBe(stored);
    expect(result.archived).toBe(archived);
  });
});
