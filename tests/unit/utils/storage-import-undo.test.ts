import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// ── Mock 'wxt/browser' BEFORE importing storage-snapshot ────────────────────
// storage-keys (getEmailMaps etc.) and mutex (persistent lease) reach the
// browser through wxt/browser AND the injected global - provide both, exactly
// like the delete-undo / message-handler tests.

const localStore: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};

function pick(
  store: Record<string, unknown>,
  keys?: string | string[] | null
): Record<string, unknown> {
  if (keys === null || keys === undefined) return { ...store };
  const list = Array.isArray(keys) ? keys : [keys];
  const result: Record<string, unknown> = {};
  for (const k of list) if (k in store) result[k] = store[k];
  return result;
}

const mockBrowser = {
  runtime: { id: 'test-import-undo' },
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => pick(localStore, keys),
      set: async (items: Record<string, unknown>) => Object.assign(localStore, items),
      remove: async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete localStore[k];
      },
    },
    session: {
      get: async (keys?: string | string[] | null) => pick(sessionStore, keys),
      set: async (items: Record<string, unknown>) => Object.assign(sessionStore, items),
      remove: async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete sessionStore[k];
      },
    },
  },
};

(globalThis as unknown as { browser?: unknown }).browser = mockBrowser;
mock.module('wxt/browser', () => ({ browser: mockBrowser }));

const { captureImportUndoSnapshot, restoreImportUndoSnapshot, restoreImportUndo } = await import(
  '@/utils/storage/storage-snapshot.js'
);

const ID_LIVE_A = 'addr-a';
const ID_LIVE_B = 'addr-b';
const ID_OVERFLOW = 'overflow-1';

function seedPreImportState(): void {
  localStore.addresses = [
    { id: ID_LIVE_A, address: 'a@example.com', provider: 'guerrilla', accountStatus: 'active' },
    { id: ID_LIVE_B, address: 'b@example.com', provider: 'guerrilla', accountStatus: 'archived' },
  ];
  localStore.activeAddressId = ID_LIVE_A;
  // Overflow mailbox keeps its index entry + ID-keyed archived bag.
  localStore.emailStorageAddressIndex = {
    [ID_LIVE_A]: 'a@example.com',
    [ID_LIVE_B]: 'b@example.com',
    [ID_OVERFLOW]: 'c@example.com',
  };
  localStore.archivedAddressOverflow = [
    { id: ID_OVERFLOW, address: 'c@example.com', provider: 'guerrilla', accountStatus: 'archived' },
  ];
  localStore[`storedEmailsByAddress_${ID_LIVE_A}`] = [
    { id: 'm1', from: 'x', subject: 'hi', received_at: 1, original_inbox: 'a@example.com' },
  ];
  localStore[`archivedEmailsByAddress_${ID_LIVE_B}`] = [
    { id: 'm2', from: 'y', subject: 'old', received_at: 1, original_inbox: 'b@example.com' },
  ];
  localStore[`archivedEmailsByAddress_${ID_OVERFLOW}`] = [
    {
      id: 'm3',
      from: 'z',
      subject: 'offline-saved',
      received_at: 1,
      original_inbox: 'c@example.com',
    },
  ];
}

describe('replace-import undo snapshot', () => {
  beforeEach(() => {
    for (const key of Object.keys(localStore)) delete localStore[key];
    for (const key of Object.keys(sessionStore)) delete sessionStore[key];
  });

  test('capture stores raw ID-keyed bags for live AND overflow mailboxes', async () => {
    seedPreImportState();
    const snap = await captureImportUndoSnapshot(mockBrowser as never);
    const archivedById = snap.archivedEmailsById ?? {};
    const storedById = snap.storedEmailsById ?? {};
    expect(snap.emailStorageAddressIndex?.[ID_OVERFLOW]).toBe('c@example.com');
    expect(archivedById[ID_OVERFLOW]).toHaveLength(1);
    expect(storedById[ID_LIVE_A]).toHaveLength(1);
    expect(snap.archivedAddressOverflow ?? []).toHaveLength(1);
    expect(snap.activeAddressId).toBe(ID_LIVE_A);
  });

  test('undo after a replace-import restores addresses, index, overflow AND pruned bags', async () => {
    seedPreImportState();
    const snap = await captureImportUndoSnapshot(mockBrowser as never);
    await restoreImportUndoSnapshot(mockBrowser as never, snap);

    // A replace import rebuilt the index from ONE imported address, pruned the
    // other index entries, removed their bags, replaced addresses, and moved
    // the active selection to the new inbox - that is the damage to undo:
    localStore.emailStorageAddressIndex = { [ID_LIVE_A]: 'a@example.com' };
    delete localStore[`archivedEmailsByAddress_${ID_LIVE_B}`];
    delete localStore[`archivedEmailsByAddress_${ID_OVERFLOW}`];
    localStore.addresses = [
      { id: ID_LIVE_A, address: 'a@example.com', provider: 'guerrilla', accountStatus: 'active' },
    ];
    localStore.activeAddressId = ID_LIVE_A;
    // Import also created a bag under a NEW id - undo must sweep it.
    localStore[`storedEmailsByAddress_new-imported`] = [
      { id: 'x9', from: 'n', subject: 'imported', received_at: 1 },
    ];
    (localStore as Record<string, Record<string, string>>).emailStorageAddressIndex[
      'new-imported'
    ] = 'n@example.com';

    // The user clicks Undo: the snapshot (persisted at import time) restores
    // the exact pre-import surface.
    await restoreImportUndoSnapshot(mockBrowser as never, snap);

    expect((localStore.addresses as unknown[]).length).toBe(2);
    expect((localStore.emailStorageAddressIndex as Record<string, string>)[ID_OVERFLOW]).toBe(
      'c@example.com'
    );
    expect(localStore.activeAddressId).toBe(ID_LIVE_A);
    expect((localStore.archivedAddressOverflow as unknown[]).length).toBe(1);
    // Pruned overflow + live archived bags are back, byte-faithful:
    expect((localStore[`archivedEmailsByAddress_${ID_OVERFLOW}`] as { id: string }[])[0].id).toBe(
      'm3'
    );
    expect((localStore[`archivedEmailsByAddress_${ID_LIVE_B}`] as { id: string }[])[0].id).toBe(
      'm2'
    );
    expect((localStore[`storedEmailsByAddress_${ID_LIVE_A}`] as { id: string }[])[0].id).toBe('m1');
    // Reverse sweep: the imported-address bag + index entry are gone.
    expect('storedEmailsByAddress_new-imported' in localStore).toBe(false);
    expect('new-imported' in (localStore.emailStorageAddressIndex as Record<string, string>)).toBe(
      false
    );
  });

  test('undo restores captured metadata byte-faithfully and prunes import-added entries (badge fast path)', async () => {
    seedPreImportState();
    // Pre-import read state: m1 (stored, ID_LIVE_A) is already read; the
    // archived m2/m3 are unread.
    localStore.readEmails = { 'a@example.com_m1': true };
    localStore.emailStorageMetadata = {
      [ID_LIVE_A]: {
        messageCount: 1,
        unreadCount: 0,
        latestReceivedAt: 1000,
        latestOtpAt: 0,
        hasMagicLink: false,
        archivedMessageCount: 0,
        archivedUnreadCount: 0,
        archivedLatestReceivedAt: 0,
        revision: 2,
      },
      [ID_LIVE_B]: {
        messageCount: 0,
        unreadCount: 0,
        latestReceivedAt: 0,
        latestOtpAt: 0,
        hasMagicLink: false,
        archivedMessageCount: 1,
        archivedUnreadCount: 1,
        archivedLatestReceivedAt: 1000,
        revision: 2,
      },
      [ID_OVERFLOW]: {
        messageCount: 0,
        unreadCount: 0,
        latestReceivedAt: 0,
        latestOtpAt: 0,
        hasMagicLink: false,
        archivedMessageCount: 1,
        archivedUnreadCount: 1,
        archivedLatestReceivedAt: 1000,
        revision: 2,
      },
    };
    const snap = await captureImportUndoSnapshot(mockBrowser as never);

    // A replace import then rewrote the surface: ID_LIVE_A's stored bag was
    // replaced with imported mail, the archived bags of ID_LIVE_B / ID_OVERFLOW
    // were pruned, a brand-new id was added - and the import writer left
    // recomputed metadata behind (replaced bag, new id) while pruning the
    // dropped ids.
    localStore.emailStorageAddressIndex = {
      [ID_LIVE_A]: 'a@example.com',
      'new-imported': 'n@example.com',
    };
    localStore[`storedEmailsByAddress_${ID_LIVE_A}`] = [
      { id: 'm9', from: 'n', subject: 'imported', received_at: 1, original_inbox: 'a@example.com' },
    ];
    delete localStore[`archivedEmailsByAddress_${ID_LIVE_B}`];
    delete localStore[`archivedEmailsByAddress_${ID_OVERFLOW}`];
    localStore.emailStorageMetadata = {
      [ID_LIVE_A]: { messageCount: 1, unreadCount: 1, revision: 3 },
      'new-imported': { messageCount: 1, unreadCount: 1, revision: 3 },
    };
    await restoreImportUndoSnapshot(mockBrowser as never, snap);

    // The captured metadata map is restored EXACTLY as captured - no
    // recomputation, no field rewrites (badge fast path byte-faithful).
    expect(localStore.emailStorageMetadata).toEqual(snap.emailStorageMetadata);
    const metadata = localStore.emailStorageMetadata as Record<string, Record<string, number>>;
    // m1 is restored and still marked read - the badge must not count it.
    expect(metadata[ID_LIVE_A]).toMatchObject({ messageCount: 1, unreadCount: 0 });
    // Restored archived bags keep their separate stats.
    expect(metadata[ID_LIVE_B]).toMatchObject({ archivedMessageCount: 1, archivedUnreadCount: 1 });
    expect(metadata[ID_OVERFLOW]).toMatchObject({
      archivedMessageCount: 1,
      archivedUnreadCount: 1,
    });
    // The import-added id was never in the captured map - still absent after
    // the undo's defensive prune.
    expect(metadata['new-imported']).toBeUndefined();
  });

  test('legacy snapshot without captured metadata falls back to recompute from restored bags', async () => {
    seedPreImportState();
    localStore.readEmails = { 'a@example.com_m1': true };
    const snap = await captureImportUndoSnapshot(mockBrowser as never);
    // A snapshot captured by an older build predates the metadata field.
    delete snap.emailStorageMetadata;

    // Damage: the stored bag was replaced with one UNREAD email and stale
    // metadata followed it.
    localStore[`storedEmailsByAddress_${ID_LIVE_A}`] = [
      {
        id: 'm9',
        from: 'n',
        subject: 'imported',
        received_at: 1,
        original_inbox: 'a@example.com',
      },
    ];
    localStore.emailStorageMetadata = {
      [ID_LIVE_A]: { messageCount: 1, unreadCount: 1, revision: 9 },
    };

    await restoreImportUndoSnapshot(mockBrowser as never, snap);

    const metadata = localStore.emailStorageMetadata as Record<string, Record<string, number>>;
    // m1 is restored and still read - the recompute must zero the unread count.
    expect(metadata[ID_LIVE_A]).toMatchObject({ messageCount: 1, unreadCount: 0 });
    // Pruned-away archived bags are back and their stats recomputed.
    expect(metadata[ID_LIVE_B]).toMatchObject({ archivedUnreadCount: 1 });
    expect(metadata[ID_OVERFLOW]).toMatchObject({ archivedUnreadCount: 1 });
  });

  test('restoreImportUndo is single-shot (consumes the stored snapshot)', async () => {
    seedPreImportState();
    localStore.pendingImportUndo = await captureImportUndoSnapshot(mockBrowser as never);

    // Damage (as above) then undo through the one-shot API:
    delete localStore[`archivedEmailsByAddress_${ID_OVERFLOW}`];
    expect(await restoreImportUndo(mockBrowser as never)).toBe(true);
    expect(localStore.pendingImportUndo).toBeUndefined();
    expect(localStore[`archivedEmailsByAddress_${ID_OVERFLOW}`]).toBeDefined();

    // Second call: nothing left to undo.
    expect(await restoreImportUndo(mockBrowser as never)).toBe(false);
  });
});
