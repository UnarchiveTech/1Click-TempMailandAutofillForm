/**
 * Wiring test for the storage write-retry primitive: every primitive the
 * storage layer writes through must absorb a one-off storage hiccup (the user
 * sees nothing) and must still fail loudly when the write genuinely cannot
 * land (nothing is silently dropped).
 *
 * Deliberately drives the REAL call paths - repository, read-modify-write,
 * safeStorageSet and the storage-keys setter - rather than the wrapper alone
 * (`storage-write-retry.test.ts` covers the wrapper's own policy).
 */
import { afterAll, describe, expect, mock, test } from 'bun:test';
import { StorageWriteError } from '@/utils/errors.js';
import { updateStoredObject } from '@/utils/storage/rmw.js';
import { setStorage } from '@/utils/storage/storage-keys.js';
import { createStorageRepository } from '@/utils/storage/storage-repository.js';
import { safeStorageSet } from '@/utils/storage/storageMonitor.js';

const HICCUP = new Error('Failed to write to storage');

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});

interface FakeArea {
  calls: number;
  store: Record<string, unknown>;
  failures: unknown[];
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

function fakeArea(failures: unknown[] = []): FakeArea {
  const area: FakeArea = {
    calls: 0,
    store: {},
    failures,
    get: async (keys: string[]) =>
      Object.fromEntries(keys.filter((k) => k in area.store).map((k) => [k, area.store[k]])),
    set: async (items: Record<string, unknown>) => {
      area.calls += 1;
      if (area.failures.length > 0) throw area.failures.shift();
      Object.assign(area.store, items);
    },
    remove: async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete area.store[key];
    },
  };
  return area;
}

/**
 * rmw + storage-keys resolve the area themselves, and they resolve it through
 * `wxt/browser` first (the seam unit tests replace) with the live global as the
 * fallback - so this file installs BOTH, pointed at one mutable area, and each
 * test just swaps that area in. Installing only one seam would make the result
 * depend on which of the two the resolver happened to prefer, and leak a fake
 * browser into whichever file runs next.
 */
let liveArea: FakeArea;
const browserFake = {
  storage: {
    local: {
      get: async (keys: string[]) => liveArea.get(keys),
      set: async (items: Record<string, unknown>) => liveArea.set(items),
      remove: async (keys: string | string[]) => liveArea.remove(keys),
    },
  },
};
mock.module('wxt/browser', () => ({ browser: browserFake }));
Object.assign(globalThis, { browser: browserFake });

describe('storage-layer write retries', () => {
  test('createStorageRepository.save absorbs a hiccup instead of rejecting', async () => {
    const area = fakeArea([HICCUP]);
    const repository = createStorageRepository(area, 'settings', { enabled: false });

    await repository.save({ enabled: true });

    expect(area.calls).toBe(2);
    expect(area.store.settings).toEqual({ enabled: true });
    expect(await repository.load()).toEqual({ enabled: true });
  });

  test('createStorageRepository.save still fails loudly when the write really cannot land', async () => {
    const area = fakeArea([HICCUP, HICCUP, HICCUP, HICCUP]);
    const repository = createStorageRepository(area, 'settings', { enabled: false });

    const error = await repository.save({ enabled: true }).catch((e) => e);

    expect(error).toBeInstanceOf(StorageWriteError);
    expect(error.context?.attempts).toBe(4);
    expect(error.originalError).toBe(HICCUP);
    // Never a partial success: the key was not written.
    expect(area.store.settings).toBeUndefined();
  });

  test('updateStoredObject absorbs a hiccup and the chain keeps the new value', async () => {
    const area = fakeArea([HICCUP]);
    liveArea = area;

    const next = await updateStoredObject<Record<string, boolean>>(
      'readEmails',
      (current) => ({ ...current, e1: true }),
      (raw) => (raw && typeof raw === 'object' ? (raw as Record<string, boolean>) : {})
    );

    expect(next).toEqual({ e1: true });
    expect(area.calls).toBe(2);
    expect(area.store.readEmails).toEqual({ e1: true });
  });

  test('safeStorageSet absorbs a hiccup and reports success', async () => {
    const area = fakeArea([HICCUP]);
    const ext = { storage: { local: area } } as unknown as typeof browser;

    expect(await safeStorageSet(ext, { seenEmailIds: { a: ['1'] } })).toBe(true);

    expect(area.calls).toBe(2);
    expect(area.store.seenEmailIds).toEqual({ a: ['1'] });
  });

  test('safeStorageSet keeps its boolean contract when the retries are exhausted', async () => {
    const area = fakeArea([HICCUP, HICCUP, HICCUP, HICCUP]);
    const ext = { storage: { local: area } } as unknown as typeof browser;

    // The caller's own quota/cleanup path still runs on `false` - the retry
    // only removes the failures that were never worth a toast.
    expect(await safeStorageSet(ext, { seenEmailIds: {} })).toBe(false);
    expect(area.calls).toBe(4);
    expect(area.store.seenEmailIds).toBeUndefined();
  });

  test('storage-keys setStorage (the prefs/mail write path) absorbs a hiccup', async () => {
    const area = fakeArea([HICCUP]);
    liveArea = area;

    await setStorage('selectedProvider', 'mailtm');

    expect(area.calls).toBe(2);
    expect(area.store.selectedProvider).toBe('mailtm');
  });
});
