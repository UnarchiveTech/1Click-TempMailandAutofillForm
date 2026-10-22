import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { Address, Email } from '@/utils/types.js';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// ── In-memory browser mock (registered before the dynamic import) ───────────
const store: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};

const fakeBrowser = {
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return { ...store };
        const arr = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const k of arr) if (k in store) out[k] = store[k];
        return out;
      },
      set: async (items: Record<string, unknown>) => Object.assign(store, items),
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

const { restoreStorageSnapshot } = await import('@/utils/storage/storage-snapshot.js');
const { archivedEmailsByAddressKey, storedEmailsByAddressKey } = await import(
  '@/utils/storage/storage-keys.js'
);

function bag(key: string, ids: string[]): Record<string, Email[]> {
  return {
    [key]: ids.map((id) => ({ id, from: 'a@x.com', received_at: 1 }) as Email),
  };
}

function record(overrides: Partial<Address> = {}): Address {
  return {
    id: 'inbox-1',
    address: 'foo@x.com',
    provider: 'guerrilla',
    createdAt: 1,
    expiresAt: 0,
    accountStatus: 'active',
    status: 'active',
    ...overrides,
  } as Address;
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

describe('restoreStorageSnapshot (casing drift)', () => {
  test('writes restored bags into the EXISTING drifted casing key instead of duplicating', async () => {
    // Current storage holds the mailbox's bag under a drifted casing (the
    // address-index entry maps the id to 'Foo@X.com').
    store.emailStorageAddressIndex = { 'inbox-1': 'Foo@X.com' };
    store[storedEmailsByAddressKey('inbox-1')] = bag('Foo@X.com', ['s1'])['Foo@X.com'];
    store[archivedEmailsByAddressKey('inbox-1')] = bag('Foo@X.com', ['a1'])['Foo@X.com'];
    store.seenEmailIds = { 'Foo@X.com': ['s1'] };
    store.lastMessageTimestamps = {};
    store.addresses = [];

    // The snapshot (taken at delete time) used the lower-cased address.
    const snapshot = {
      storedEmails: bag('foo@x.com', ['s1', 's2']),
      archivedEmails: bag('foo@x.com', ['a2']),
      seenEmailIds: { 'foo@x.com': ['s1', 's2'] },
      lastMessageTimestamps: {},
    };

    await restoreStorageSnapshot(fakeBrowser as never, snapshot, [record()]);

    // No duplicate bags: everything lands in the one stable ID-keyed bag, with
    // the snapshot merged over the drifted-casing contents.
    const stored = store[storedEmailsByAddressKey('inbox-1')] as Email[];
    expect(stored.map((e) => e.id).sort()).toEqual(['s1', 's2']);
    const archived = store[archivedEmailsByAddressKey('inbox-1')] as Email[];
    expect(archived.map((e) => e.id)).toEqual(['a2']);
    const seen = store.seenEmailIds as Record<string, string[]>;
    expect(Object.keys(seen)).toEqual(['Foo@X.com']);
    expect(seen['Foo@X.com']).toEqual(['s1', 's2']);
  });

  test('snapshot bags under drifted casing resolve back to the snapshot key', async () => {
    // Snapshot stored the bags under a drifted casing; current storage is empty.
    store.addresses = [];
    const snapshot = {
      storedEmails: bag('Foo@X.com', ['s1']),
      archivedEmails: bag('Foo@X.com', ['a1']),
      seenEmailIds: { 'Foo@X.com': ['s1'] },
      lastMessageTimestamps: {},
    };

    await restoreStorageSnapshot(fakeBrowser as never, snapshot, [record()]);

    // No current key to merge into → bags restore under the caller's casing
    // into the restored record's stable ID-keyed bag.
    const stored = store[storedEmailsByAddressKey('inbox-1')] as Email[];
    expect(stored.map((e) => e.id)).toEqual(['s1']);
    const archived = store[archivedEmailsByAddressKey('inbox-1')] as Email[];
    expect(archived.map((e) => e.id)).toEqual(['a1']);
  });

  test('restores scoped read state under casing drift without reviving bare IDs', async () => {
    store.addresses = [];
    store.readEmails = {};

    const snapshot = {
      storedEmails: bag('Foo@X.com', ['foo_msg_1']),
      readEmails: { foo_msg_1: true, 'Foo@X.com_foo_msg_1': true },
    };

    await restoreStorageSnapshot(fakeBrowser as never, snapshot, [
      record({ address: 'foo@x.com' }),
    ]);

    expect((store.readEmails as Record<string, boolean>).foo_msg_1).toBeUndefined();
    expect((store.readEmails as Record<string, boolean>)['Foo@X.com_foo_msg_1']).toBe(true);
  });

  test('preserves concurrent read state updates in non-deleted addresses', async () => {
    // Other active inbox had an email marked read during the undo window
    store.readEmails = {
      other_email_123: true,
      'other@x.com_email_456': true,
      'foo@x.com_old_msg': false, // state that got changed in storage
    };
    store.addresses = [record({ id: 'inbox-other', address: 'other@x.com' })];

    const snapshot = {
      storedEmails: bag('foo@x.com', ['foo_msg_1']),
      readEmails: {
        foo_msg_1: true,
        'foo@x.com_old_msg': true, // snapshot state to restore for foo@x.com
        other_email_123: false, // old state from snapshot for other inbox (should NOT overwrite)
      },
    };

    await restoreStorageSnapshot(fakeBrowser as never, snapshot, [
      record({ address: 'foo@x.com' }),
    ]);

    const read = store.readEmails as Record<string, boolean>;
    // foo@x.com messages restored from snapshot
    expect(read.foo_msg_1).toBeUndefined();
    expect(read['foo@x.com_old_msg']).toBe(true);
    // other inbox's new state was preserved and NOT overwritten by snapshot
    expect(read.other_email_123).toBe(true);
    expect(read['other@x.com_email_456']).toBe(true);
  });

  test('delete undo preserves newly arrived mail in a surviving inbox', async () => {
    const survivor = record({ id: 'inbox-2', address: 'other@x.com' });
    store.addresses = [survivor];
    store.emailStorageAddressIndex = { 'inbox-2': 'other@x.com' };
    store[storedEmailsByAddressKey('inbox-2')] = bag('other@x.com', ['old', 'new'])['other@x.com'];
    const snapshot = {
      addresses: [record(), survivor],
      storedEmails: { ...bag('foo@x.com', ['deleted-mail']), ...bag('other@x.com', ['old']) },
    };
    await restoreStorageSnapshot(fakeBrowser as never, snapshot, [record()]);
    expect(
      (store[storedEmailsByAddressKey('inbox-2')] as Email[]).map((email) => email.id)
    ).toEqual(['old', 'new']);
    expect(
      (store[storedEmailsByAddressKey('inbox-1')] as Email[]).map((email) => email.id)
    ).toEqual(['deleted-mail']);
  });

  test('never overwrites a mailbox whose address a NEWER record now owns', async () => {
    // The address was reconnected / re-created after the delete: a live record
    // with a different id owns the mailbox now, and its bag holds mail that
    // arrived since. Restoring the pre-delete snapshot over it would replace
    // that mail with the old mail.
    store.addresses = [record({ id: 'inbox-2', address: 'foo@x.com' })];
    store[storedEmailsByAddressKey('inbox-2')] = bag('foo@x.com', ['new-1'])['foo@x.com'];
    store.seenEmailIds = { 'foo@x.com': ['new-1'] };
    store.lastMessageTimestamps = { 'inbox-2': 99 };

    const snapshot = {
      addresses: [record()],
      storedEmails: bag('foo@x.com', ['old-1']),
      seenEmailIds: { 'foo@x.com': ['old-1'] },
      lastMessageTimestamps: { 'inbox-1': 7 },
    };

    await restoreStorageSnapshot(fakeBrowser as never, snapshot, [record()]);

    // The newer record is left exactly as it was - no resurrection of the old
    // one, and none of its pre-delete mail.
    expect((store.addresses as Address[]).map((a) => a.id)).toEqual(['inbox-2']);
    const stored = store[storedEmailsByAddressKey('inbox-2')] as Email[];
    expect(stored.map((e) => e.id)).toEqual(['new-1']);
    expect((store.seenEmailIds as Record<string, string[]>)['foo@x.com']).toEqual(['new-1']);
  });

  test('skips only the re-taken mailbox when undoing a batch delete', async () => {
    // The index is what links a live record to its bag key (the restore rebuilds
    // the physical bags through it), so seed it like the real app would.
    store.emailStorageAddressIndex = { 'inbox-2': 'foo@x.com' };
    store.addresses = [record({ id: 'inbox-2', address: 'foo@x.com' })];
    store[storedEmailsByAddressKey('inbox-2')] = bag('foo@x.com', ['new-1'])['foo@x.com'];

    const bar = record({ id: 'inbox-3', address: 'bar@x.com' });
    const snapshot = {
      addresses: [record(), bar],
      storedEmails: { ...bag('foo@x.com', ['old-1']), ...bag('bar@x.com', ['bar-1']) },
      lastMessageTimestamps: {},
    };

    await restoreStorageSnapshot(fakeBrowser as never, snapshot, [record(), bar]);

    // foo@x.com belongs to a newer record → skipped; bar@x.com restores.
    expect((store.addresses as Address[]).map((a) => a.id).sort()).toEqual(['inbox-2', 'inbox-3']);
    const stored = store[storedEmailsByAddressKey('inbox-2')] as Email[];
    expect(stored.map((e) => e.id)).toEqual(['new-1']);
    const barStored = store[storedEmailsByAddressKey('inbox-3')] as Email[];
    expect(barStored.map((e) => e.id)).toEqual(['bar-1']);
  });
});
