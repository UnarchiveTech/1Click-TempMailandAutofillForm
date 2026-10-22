import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { Address, Email } from '@/utils/types.js';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// ── Mocks registered BEFORE the dynamic import ──────────────────────────────
const store: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};

const fakeBrowser = {
  runtime: { id: 'test-extension', sendMessage: async () => ({ success: true }) },
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

// NOTE: i18n-utils is intentionally NOT mocked - its `t()` resolves against the
// (fake) browser's storage and falls back to English, so toast strings resolve
// for real without leaking a mock into other test files sharing this worker.
const { deleteArchivedEmail, restoreArchivedAddress } = await import(
  '@/features/archived-mail/archived-actions.js'
);
const { archivedEmailsByAddressKey, storedEmailsByAddressKey } = await import(
  '@/utils/storage/storage-keys.js'
);

function archivedEmail(rawId: string, originalInbox = 'foo@x.com'): Email {
  return {
    id: `${originalInbox}_${rawId}`,
    original_inbox: originalInbox,
    from: 'a@x.com',
    received_at: 1,
  } as Email;
}

function setters() {
  return {
    setArchivedEmails: () => {},
    setShowToast: () => {},
    loadAddresses: async () => {},
  };
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

describe('deleteArchivedEmail (casing drift)', () => {
  test('removes the email from the EXISTING drifted-casing bag, not a new key', async () => {
    // Mailbox's archived bag is indexed under the drifted casing.
    store.addresses = [{ id: 'inbox-1', address: 'Foo@X.com' } as Address];
    store.emailStorageAddressIndex = { 'inbox-1': 'Foo@X.com' };
    store[archivedEmailsByAddressKey('inbox-1')] = [
      { id: 'a1', from: 'a@x.com', received_at: 1 },
      { id: 'a2', from: 'b@x.com', received_at: 2 },
    ];

    await deleteArchivedEmail(
      fakeBrowser as never,
      archivedEmail('a1'),
      { archivedEmails: [] },
      setters()
    );

    // One canonical ID-keyed bag, a1 filtered out.
    const archived = store[archivedEmailsByAddressKey('inbox-1')] as Email[];
    expect(archived.map((e) => e.id)).toEqual(['a2']);
  });

  test('deletes the drifted key entirely when the last email goes', async () => {
    store.addresses = [{ id: 'inbox-1', address: 'Foo@X.com' } as Address];
    store.emailStorageAddressIndex = { 'inbox-1': 'Foo@X.com' };
    store[archivedEmailsByAddressKey('inbox-1')] = [{ id: 'a1', from: 'a@x.com', received_at: 1 }];

    await deleteArchivedEmail(
      fakeBrowser as never,
      archivedEmail('a1'),
      { archivedEmails: [] },
      setters()
    );

    // The logical entry is gone; the emptied ID-keyed bag is removed (absent
    // = empty on read) instead of persisting as `[]`.
    expect(store[archivedEmailsByAddressKey('inbox-1')]).toBeUndefined();
  });
});

describe('restoreArchivedAddress (casing drift)', () => {
  test('moves the email into the existing drifted-casing stored bag without duplicating keys', async () => {
    store.addresses = [{ id: 'inbox-1', address: 'Foo@X.com' } as Address];
    store.emailStorageAddressIndex = { 'inbox-1': 'Foo@X.com' };
    store[archivedEmailsByAddressKey('inbox-1')] = [{ id: 'a1', from: 'a@x.com', received_at: 1 }];
    store[storedEmailsByAddressKey('inbox-1')] = [{ id: 's1', from: 'a@x.com', received_at: 0 }];

    await restoreArchivedAddress(
      fakeBrowser as never,
      archivedEmail('a1'),
      { archivedEmails: [] },
      setters()
    );

    // One canonical ID-keyed bag, restored email appended, archived emptied
    // (the emptied archived bag is removed - absent = empty on read).
    const stored = store[storedEmailsByAddressKey('inbox-1')] as Email[];
    expect(stored.map((e) => e.id).sort()).toEqual(['a1', 's1']);
    expect(store[archivedEmailsByAddressKey('inbox-1')]).toBeUndefined();
  });
});
