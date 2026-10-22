import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { Address, Email } from '@/utils/types.js';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
const store: Record<string, unknown> = {};
const gets: Array<string[] | null> = [];
const localWrites: Record<string, unknown>[] = [];
let rejectRemovals = false;

const sessionStore: Record<string, unknown> = {};

const fakeBrowser = {
  runtime: { onMessage: { addListener: () => {} } },
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return { ...store };
        const list = Array.isArray(keys) ? keys : [keys];
        gets.push([...list]);
        const result: Record<string, unknown> = {};
        for (const key of list) if (key in store) result[key] = store[key];
        return result;
      },
      set: async (items: Record<string, unknown>) => {
        localWrites.push({ ...items });
        Object.assign(store, items);
      },
      remove: async (keys: string | string[]) => {
        if (rejectRemovals) throw new Error('Injected cleanup failure');
        for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
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

const {
  archivedEmailsByAddressKey,
  findOrphanedEmailStorageBagKeys,
  getEmailMaps,
  getEmailStorageMetadata,
  getStoredEmailsForAddress,
  refreshEmailStorageMetadataForAddresses,
  removeEmailStorageForAddress,
  removeEmailStorageForAddressUnlocked,
  removeOrphanedEmailStorageBags,
  setAddresses,
  setArchivedEmailsForAddressUnlocked,
  setLogicalEmailMaps,
  setStoredEmailsForAddress,
  setStoredEmailsForAddressUnlocked,
  storedEmailsByAddressKey,
} = await import('@/utils/storage/storage-keys.js');
const { withLock } = await import('@/utils/mutex.js');

const email = (id: string): Email => ({ id, received_at: 1, subject: id });
const address = (id: string, value: string): Address => ({
  id,
  address: value,
  provider: 'demo',
  createdAt: 1,
  expiresAt: 0,
  accountStatus: 'active',
});

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  for (const key of Object.keys(sessionStore)) delete sessionStore[key];
  gets.length = 0;
  localWrites.length = 0;
  rejectRemovals = false;
});

describe('ID-keyed mailbox storage', () => {
  test('reads only the selected mailbox key when the v2 bag exists', async () => {
    store[storedEmailsByAddressKey('active-id')] = [email('active')];
    store.storedEmails = {
      'active@example.test': [email('legacy-active')],
      'inactive@example.test': Array.from({ length: 100 }, (_, i) => email(`inactive-${i}`)),
    };

    const result = await getStoredEmailsForAddress('active-id', 'active@example.test');

    expect(result.map((item) => item.id)).toEqual(['active']);
    expect(gets).toEqual([[storedEmailsByAddressKey('active-id')]]);
  });

  test('does not fall back to removed aggregate mailbox storage', async () => {
    store.storedEmails = { 'Active@Example.test': [email('legacy')] };

    const result = await getStoredEmailsForAddress('missing-id', 'active@example.test');

    expect(result).toEqual([]);
    expect(gets).toEqual([[storedEmailsByAddressKey('missing-id')]]);
  });

  test('logical global reads current ID-keyed bags', async () => {
    store.addresses = [address('a1', 'one@example.test')];
    store.emailStorageAddressIndex = { a1: 'one@example.test' };
    store[storedEmailsByAddressKey('a1')] = [email('new')];

    const { storedEmails } = await getEmailMaps();

    expect(storedEmails['one@example.test'].map((item) => item.id)).toEqual(['new']);
  });

  test('new writes update only the ID-keyed bag and address index', async () => {
    // The bag writers are RMW over the index/metadata: the sanctioned
    // low-level entry point for tests is the *Unlocked variant.
    await setStoredEmailsForAddressUnlocked('a1', 'one@example.test', [email('new')]);

    expect(store[storedEmailsByAddressKey('a1')]).toEqual([email('new')]);
    expect(store.emailStorageAddressIndex).toEqual({ a1: 'one@example.test' });
    expect(store.storedEmails).toBeUndefined();
  });

  test('asserting writers throw without emails_storage_lock (dev/test lock contract)', async () => {
    // No withLock anywhere in this test - the RMW contract must fail loudly
    // instead of racing the index/metadata.
    await expect(
      setStoredEmailsForAddress('a1', 'one@example.test', [email('new')])
    ).rejects.toThrow(/emails_storage_lock/);
    await expect(removeEmailStorageForAddress('a1')).rejects.toThrow(/emails_storage_lock/);
  });

  test('asserting writers pass when the caller holds emails_storage_lock', async () => {
    await withLock('emails_storage_lock', () =>
      setStoredEmailsForAddress('a1', 'one@example.test', [email('new')])
    );
    expect(store[storedEmailsByAddressKey('a1')]).toEqual([email('new')]);
    expect(store.emailStorageAddressIndex).toEqual({ a1: 'one@example.test' });

    await withLock('emails_storage_lock', () => removeEmailStorageForAddress('a1'));
    expect(store[storedEmailsByAddressKey('a1')]).toBeUndefined();
    expect(store.emailStorageAddressIndex).toEqual({});
  });

  test('logical writes retain index entries for evicted mailboxes and drop empty bags (absent = empty on read)', async () => {
    store.addresses = [address('current', 'current@example.test')];
    store.emailStorageAddressIndex = { deleted: 'deleted@example.test' };
    store[storedEmailsByAddressKey('deleted')] = [email('old')];
    store.storedEmails = { 'orphan@example.test': [email('orphan')] };

    await setLogicalEmailMaps({ 'current@example.test': [email('current')] }, {});

    // Eviction (a mailbox leaving `addresses`) RETAINS its index entry so its
    // recoverable history stays reachable; only removeEmailStorageForAddress
    // prunes index entries (permanent delete).
    expect(store.emailStorageAddressIndex).toEqual({
      current: 'current@example.test',
      deleted: 'deleted@example.test',
    });
    // Symmetric with the read: every index entry stays readable (absent bag =
    // empty), but a physical bag exists only while it holds mail - an omitted
    // retained mailbox is dropped from the physical layer, never persisted as
    // a dead `[]` key. The caller's maps are authoritative.
    expect(store[storedEmailsByAddressKey('deleted')]).toBeUndefined();
    expect((await getEmailMaps()).storedEmails['deleted@example.test']).toEqual([]);
    // The legacy aggregate keys are still dropped entirely.
    expect(store.storedEmails).toBeUndefined();
    expect((await getEmailMaps()).storedEmails['orphan@example.test']).toBeUndefined();
  });

  test('global empty commit cannot resurrect old mail when physical cleanup fails', async () => {
    store.addresses = [address('a1', 'one@example.test'), address('a2', 'two@example.test')];
    store.emailStorageAddressIndex = { a1: 'one@example.test', a2: 'two@example.test' };
    store[storedEmailsByAddressKey('a1')] = [email('removed-stored')];
    store[archivedEmailsByAddressKey('a1')] = [email('removed-archived')];
    store[storedEmailsByAddressKey('a2')] = [email('retained')];
    store.emailStorageMetadata = { a1: { messageCount: 1, unreadCount: 1, revision: 1 } };
    rejectRemovals = true;

    await setLogicalEmailMaps({ 'two@example.test': [email('retained')] }, {});

    expect(localWrites[0]).toMatchObject({
      [storedEmailsByAddressKey('a1')]: [],
      [archivedEmailsByAddressKey('a1')]: [],
    });
    const maps = await getEmailMaps();
    expect(maps.storedEmails['one@example.test']).toEqual([]);
    expect(maps.archivedEmails['one@example.test']).toEqual([]);
    expect(maps.storedEmails['two@example.test']).toEqual([email('retained')]);
    expect((store.emailStorageMetadata as Record<string, unknown>).a1).toBeUndefined();
  });

  test('read→mutate→write round trip preserves every index entry and its non-empty mail', async () => {
    store.addresses = [address('live', 'live@example.test')];
    store.emailStorageAddressIndex = {
      live: 'live@example.test',
      evicted: 'evicted@example.test',
    };
    store[storedEmailsByAddressKey('live')] = [email('live-1')];
    // An evicted (archived-overflow) mailbox: not in `addresses`, but indexed
    // with recoverable Offline Saved mail.
    store[storedEmailsByAddressKey('evicted')] = [email('saved-1')];
    store[archivedEmailsByAddressKey('evicted')] = [email('archived-1')];

    const { storedEmails, archivedEmails } = await getEmailMaps();
    storedEmails['live@example.test'].push(email('live-2'));
    await setLogicalEmailMaps(storedEmails, archivedEmails);

    expect(store.emailStorageAddressIndex).toEqual({
      live: 'live@example.test',
      evicted: 'evicted@example.test',
    });
    const { storedEmails: after } = await getEmailMaps();
    expect(after['live@example.test'].map((e) => e.id)).toEqual(['live-1', 'live-2']);
    expect(after['evicted@example.test'].map((e) => e.id)).toEqual(['saved-1']);
    expect((await getEmailMaps()).archivedEmails['evicted@example.test'].map((e) => e.id)).toEqual([
      'archived-1',
    ]);
  });

  test('setLogicalEmailMaps recomputes metadata from the persisted bags and prunes stale entries', async () => {
    store.addresses = [address('a1', 'one@example.test')];
    store.emailStorageAddressIndex = {
      a1: 'one@example.test',
      a2: 'two@example.test',
      a3: 'three@example.test',
    };
    store.readEmails = { 'one@example.test_s2': true };
    // a1: stored 2 (s2 read) + archived 1; a2: stored 1; a3: emptied out.
    const maps = {
      storedEmails: {
        'one@example.test': [email('s1'), email('s2')],
        'two@example.test': [email('t1')],
      },
      archivedEmails: { 'one@example.test': [email('a1-arch')] },
    };
    // Stale metadata that the bulk writer must correct / prune - including a
    // ghost entry whose address ID never existed in the index (badge fast
    // path would otherwise sum phantom unread).
    store.emailStorageMetadata = {
      a1: { messageCount: 9, unreadCount: 9, revision: 3 },
      a2: { messageCount: 9, unreadCount: 9, revision: 3 },
      a3: { messageCount: 9, unreadCount: 9, revision: 3 },
      ghost: { messageCount: 9, unreadCount: 9, revision: 3 },
    };

    await setLogicalEmailMaps(maps.storedEmails, maps.archivedEmails);

    const metadata = await getEmailStorageMetadata();
    expect(metadata.a1).toMatchObject({
      messageCount: 2,
      unreadCount: 1, // s2 is read
      archivedMessageCount: 1,
      archivedUnreadCount: 1,
      revision: 4, // previous 3 + 1
    });
    expect(metadata.a2).toMatchObject({ messageCount: 1, unreadCount: 1, revision: 4 });
    // Both bags empty → entry pruned; never indexed → entry pruned.
    expect(metadata.a3).toBeUndefined();
    expect(metadata.ghost).toBeUndefined();
  });

  test('finds only physical bags absent from the address index', () => {
    const liveStored = storedEmailsByAddressKey('live');
    const orphanArchived = archivedEmailsByAddressKey('orphan');
    const orphanStored = storedEmailsByAddressKey('orphan');
    const storage = {
      [liveStored]: [email('live')],
      [orphanStored]: [email('orphan')],
      [orphanArchived]: [email('orphan-archived')],
      unrelated: true,
    };

    expect(findOrphanedEmailStorageBagKeys(storage, { live: 'live@example.test' })).toEqual([
      orphanStored,
      orphanArchived,
    ]);
    expect(findOrphanedEmailStorageBagKeys(storage, undefined)).toEqual([]);
  });

  test('finds indexed empty bags left by interrupted physical cleanup', () => {
    const live = storedEmailsByAddressKey('live');
    const empty = archivedEmailsByAddressKey('live');
    expect(
      findOrphanedEmailStorageBagKeys(
        { [live]: [email('live')], [empty]: [] },
        { live: 'live@example.test' }
      )
    ).toEqual([empty]);
  });

  test('removes physical orphan bags while retaining indexed bags', async () => {
    store.emailStorageAddressIndex = { live: 'live@example.test' };
    store[storedEmailsByAddressKey('live')] = [email('live')];
    store[storedEmailsByAddressKey('orphan')] = [email('orphan')];
    store[archivedEmailsByAddressKey('orphan')] = [email('orphan-archived')];
    // Orphan metadata would feed phantom unread counts to the badge fast
    // path - the sweep must prune it for non-indexed ids while keeping the
    // live entry.
    store.emailStorageMetadata = {
      orphan: { messageCount: 1, unreadCount: 1, revision: 1 },
      live: { messageCount: 1, unreadCount: 0, revision: 1 },
    };

    await expect(removeOrphanedEmailStorageBags()).resolves.toBe(2);
    expect(store[storedEmailsByAddressKey('live')]).toEqual([email('live')]);
    expect(store[storedEmailsByAddressKey('orphan')]).toBeUndefined();
    expect(store[archivedEmailsByAddressKey('orphan')]).toBeUndefined();
    expect((store.emailStorageMetadata as Record<string, unknown>).orphan).toBeUndefined();
    expect((store.emailStorageMetadata as Record<string, unknown>).live).toBeDefined();
  });

  test('permanent address removal clears both v2 bags, its index entry, and metadata', async () => {
    store.emailStorageAddressIndex = { a1: 'one@example.test' };
    store[storedEmailsByAddressKey('a1')] = [email('stored')];
    store[archivedEmailsByAddressKey('a1')] = [email('archived')];
    store.emailStorageMetadata = { a1: { messageCount: 1, unreadCount: 1, revision: 1 } };

    await removeEmailStorageForAddressUnlocked('a1');

    expect(localWrites[0]).toMatchObject({
      emailStorageAddressIndex: {},
      [storedEmailsByAddressKey('a1')]: [],
      [archivedEmailsByAddressKey('a1')]: [],
    });
    expect(store[storedEmailsByAddressKey('a1')]).toBeUndefined();
    expect(store[archivedEmailsByAddressKey('a1')]).toBeUndefined();
    expect(store.emailStorageAddressIndex).toEqual({});
    // Both bags are gone - the metadata entry must not linger for the badge.
    expect(store.emailStorageMetadata).toEqual({});
  });

  test('stored and archived bag writers track counts separately (no last-write-wins)', async () => {
    store.emailStorageAddressIndex = { a1: 'one@example.test' };
    // s2 is read, so the stored bag has exactly 1 unread; the archived bag's
    // 2 messages are both unread - a discriminating difference.
    store.readEmails = { 'one@example.test_s2': true };

    await setStoredEmailsForAddressUnlocked('a1', 'one@example.test', [email('s1'), email('s2')]);
    // An archived write AFTER the stored write must not clobber the stored
    // unread count (the pre-fix last-write-wins bug would set unreadCount=2).
    await setArchivedEmailsForAddressUnlocked('a1', 'one@example.test', [email('a1'), email('a2')]);

    const metadata = (await getEmailStorageMetadata()).a1;
    expect(metadata).toMatchObject({
      messageCount: 2,
      unreadCount: 1, // stored bag only: s1 unread, s2 read
      latestReceivedAt: 1000,
      latestOtpAt: 0, // otp-less stored mails
      hasMagicLink: false,
      archivedMessageCount: 2,
      archivedUnreadCount: 2,
      archivedLatestReceivedAt: 1000,
      revision: 2,
    });
  });

  test('metadata entry is pruned once BOTH bags are emptied', async () => {
    store.emailStorageAddressIndex = { a1: 'one@example.test' };
    store[archivedEmailsByAddressKey('a1')] = [email('archived')];
    store.emailStorageMetadata = {
      a1: { messageCount: 0, unreadCount: 0, revision: 1 },
    };

    // Stored emptied while archived still holds mail: index + metadata stay.
    await setStoredEmailsForAddressUnlocked('a1', 'one@example.test', []);
    expect(store.emailStorageAddressIndex).toEqual({ a1: 'one@example.test' });
    expect(store.emailStorageMetadata).toMatchObject({ a1: { messageCount: 0, unreadCount: 0 } });

    // Archived emptied too - both bags gone, so the entry is pruned.
    await setArchivedEmailsForAddressUnlocked('a1', 'one@example.test', []);
    expect(store.emailStorageAddressIndex).toEqual({});
    expect(store.emailStorageMetadata).toEqual({});
  });
});

describe('refreshEmailStorageMetadataForAddresses (batched)', () => {
  test('recomputes metadata for every entry in ONE pass with one metadata write', async () => {
    store.addresses = [address('a1', 'one@example.test'), address('a2', 'two@example.test')];
    store.emailStorageAddressIndex = { a1: 'one@example.test', a2: 'two@example.test' };
    store[storedEmailsByAddressKey('a1')] = [email('m1'), email('m2-unread'), email('m3-unread')];
    store[storedEmailsByAddressKey('a2')] = [email('n1')];
    store.emailStorageMetadata = {
      a1: {
        messageCount: 0,
        unreadCount: 0,
        latestReceivedAt: 0,
        latestOtpAt: 0,
        hasMagicLink: false,
        revision: 7,
      },
    };

    const readEmails = { 'one@example.test_m1': true, 'two@example.test_n1': true };
    await refreshEmailStorageMetadataForAddresses(readEmails, [
      { addressId: 'a1', address: 'one@example.test' },
      { addressId: 'a2', address: 'two@example.test' },
    ]);

    const metadata = store.emailStorageMetadata as Record<
      string,
      {
        messageCount: number;
        unreadCount: number;
        latestReceivedAt: number;
        latestOtpAt: number;
        hasMagicLink: boolean;
        archivedMessageCount: number;
        archivedUnreadCount: number;
        archivedLatestReceivedAt: number;
        revision: number;
        readStateVersion?: 1;
      }
    >;
    expect(metadata.a1).toEqual({
      messageCount: 3,
      readStateVersion: 1,
      unreadCount: 2, // m2/m3 unread (m1 read)
      latestReceivedAt: 1000, // toMs(1): the bag's received_at is seconds → ms
      latestOtpAt: 0,
      hasMagicLink: false,
      // Archived stats are preserved (defaults here - no archived bag written).
      archivedMessageCount: 0,
      archivedUnreadCount: 0,
      archivedLatestReceivedAt: 0,
      revision: 8, // previous 7 + 1 in the same pass
    });
    expect(metadata.a2).toEqual({
      messageCount: 1,
      readStateVersion: 1,
      unreadCount: 0,
      latestReceivedAt: 1000,
      latestOtpAt: 0,
      hasMagicLink: false,
      archivedMessageCount: 0,
      archivedUnreadCount: 0,
      archivedLatestReceivedAt: 0,
      revision: 1,
    });
  });
});

describe('setAddresses deduplication', () => {
  test('drops exact id duplicates but keeps address-case collisions with different ids', async () => {
    await setAddresses([
      address('a1', 'Foo@Example.com'),
      address('a2', 'foo@example.com'), // same mailbox, different id - must be kept
      address('a1', 'dup@example.test'), // exact id repeat - must be dropped
    ]);

    const persisted = store.addresses as Array<{ id: string; address: string }>;
    expect(persisted).toHaveLength(2);
    expect(persisted.map((item) => item.id).sort()).toEqual(['a1', 'a2']);
    // Both casings survive; the read side merges them (getLogicalEmailMaps).
    expect(persisted.find((item) => item.id === 'a2')?.address).toBe('foo@example.com');
  });
});
