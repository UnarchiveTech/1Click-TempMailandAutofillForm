import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { Email } from '@/utils/types.js';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// ── Mocks registered BEFORE the dynamic import of email-storage.js ──────────
// email-storage reaches storage through the in-memory browser mock (storage-keys
// helpers, safeStorageSet), exactly like the archived-overflow harness.

const store: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};

const fakeBrowser = {
  runtime: { id: 'test-extension', sendMessage: async () => ({}) },
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
    session: {
      get: async (keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return { ...sessionStore };
        const list = Array.isArray(keys) ? keys : [keys];
        const result: Record<string, unknown> = {};
        for (const key of list) if (key in sessionStore) result[key] = sessionStore[key];
        return result;
      },
      set: async (items: Record<string, unknown>) => {
        Object.assign(sessionStore, items);
      },
      remove: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete sessionStore[key];
      },
    },
  },
};

mock.module('wxt/browser', () => ({ browser: fakeBrowser }));
Object.assign(globalThis, { browser: fakeBrowser });

const { cleanupOldStoredEmails } = await import(
  '@/entrypoints/background/address/email-storage.js'
);
const { archivedEmailsByAddressKey, storedEmailsByAddressKey } = await import(
  '@/utils/storage/storage-keys.js'
);

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

function email(id: string, ageMs: number, field: 'stored_at' | 'archived_at' = 'stored_at'): Email {
  return {
    id,
    from: 'noreply@example.com',
    subject: 's',
    received_at: Math.floor((now - ageMs) / 1000),
    [field]: now - ageMs,
  } as Email;
}

/** Register an address record + index entry and store its ID-keyed bags. */
function seedMailbox(
  address: string,
  stored: Email[],
  opts: { id?: string; archived?: Email[] } = {}
): string {
  const id = opts.id ?? `inbox-${address.split('@')[0]}`;
  const addresses = ((store.addresses as Array<{ id: string; address: string }>) || []).slice();
  addresses.push({ id, address });
  store.addresses = addresses;
  const index = (store.emailStorageAddressIndex as Record<string, string>) || {};
  index[id] = address;
  store.emailStorageAddressIndex = index;
  store[storedEmailsByAddressKey(id)] = stored;
  if (opts.archived) store[archivedEmailsByAddressKey(id)] = opts.archived;
  return id;
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

describe('cleanupOldStoredEmails', () => {
  test('deletes bags whose emails all expired, and pre-existing empty bags', async () => {
    seedMailbox('old@x.com', [email('o1', 3 * DAY)]);
    seedMailbox('fresh@x.com', [email('f1', 1 * 60 * 60 * 1000)]);
    seedMailbox('empty@x.com', []);
    seedMailbox('arch-old@x.com', [], { archived: [email('a1', 5 * DAY, 'archived_at')] });
    seedMailbox('arch-empty@x.com', [], { archived: [] });

    await cleanupOldStoredEmails(1, 1);

    // Only the fresh bag still carries mail; every expired/empty bag is
    // removed from the physical layer (reads treat absent bags as empty, so
    // the mailbox stays readable without leaving dead `[]` keys behind).
    expect(store[storedEmailsByAddressKey('inbox-old')]).toBeUndefined();
    expect(store[storedEmailsByAddressKey('inbox-fresh')]).toEqual([
      expect.objectContaining({ id: 'f1' }),
    ]);
    expect(store[storedEmailsByAddressKey('inbox-empty')]).toBeUndefined();
    expect(store[archivedEmailsByAddressKey('inbox-arch-old')]).toBeUndefined();
    expect(store[archivedEmailsByAddressKey('inbox-arch-empty')]).toBeUndefined();
  });

  test('keeps a bag when at least one email survives and prunes the rest', async () => {
    const id = seedMailbox('mixed@x.com', [
      email('keep', 1 * 60 * 60 * 1000),
      email('drop', 3 * DAY),
    ]);

    await cleanupOldStoredEmails(1, 1);

    const bag = store[storedEmailsByAddressKey(id)] as Email[];
    expect(bag.map((e) => e.id)).toEqual(['keep']);
  });

  test('retention 0 means never delete (no-op)', async () => {
    const id = seedMailbox('ancient@x.com', [email('e1', 400 * DAY)]);

    await cleanupOldStoredEmails(0, 0);

    expect(store[storedEmailsByAddressKey(id)]).toEqual([expect.objectContaining({ id: 'e1' })]);
  });

  test('regression: negative retention means never delete, not delete-everything', async () => {
    // A negative retention must not compute a future threshold and wipe every
    // bag - non-positive values are keep-all, exactly like 0.
    const storedId = seedMailbox('neg-stored@x.com', [email('s1', 400 * DAY)]);
    const archId = seedMailbox('neg-arch@x.com', [], {
      archived: [email('a1', 400 * DAY, 'archived_at')],
    });

    await cleanupOldStoredEmails(-1, -1);

    expect(store[storedEmailsByAddressKey(storedId)]).toEqual([
      expect.objectContaining({ id: 's1' }),
    ]);
    expect(store[archivedEmailsByAddressKey(archId)]).toEqual([
      expect.objectContaining({ id: 'a1' }),
    ]);
  });

  test('regression: active=0 keeps active mail while archived retention still applies', async () => {
    // The two windows are independent: "never delete" on the active bag must
    // not disable archived cleanup (archived retention is activeDays * 3 from
    // every caller, so (0, 0) is the only all-keep-all combination in practice,
    // but the contract is per-window).
    const storedId = seedMailbox('mix-stored@x.com', [email('m1', 400 * DAY)]);
    const archId = seedMailbox('mix-arch@x.com', [], {
      archived: [email('m2', 400 * DAY, 'archived_at')],
    });

    await cleanupOldStoredEmails(0, 1);

    expect(store[storedEmailsByAddressKey(storedId)]).toEqual([
      expect.objectContaining({ id: 'm1' }),
    ]);
    expect(store[archivedEmailsByAddressKey(archId)]).toBeUndefined();
  });

  test('regression: archived=0 keeps archived mail while active retention still applies', async () => {
    const storedId = seedMailbox('mix2-stored@x.com', [email('n1', 400 * DAY)]);
    const archId = seedMailbox('mix2-arch@x.com', [], {
      archived: [email('n2', 400 * DAY, 'archived_at')],
    });

    await cleanupOldStoredEmails(1, 0);

    expect(store[storedEmailsByAddressKey(storedId)]).toBeUndefined();
    expect(store[archivedEmailsByAddressKey(archId)]).toEqual([
      expect.objectContaining({ id: 'n2' }),
    ]);
  });
});
