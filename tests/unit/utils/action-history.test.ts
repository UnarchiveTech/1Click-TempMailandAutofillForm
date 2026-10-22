import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// ── Mock 'wxt/browser' BEFORE importing action-history ──────────────────────
// action-history reaches storage through wxt/browser AND the injected global
// (getEmailMaps / setLogicalEmailMaps), so provide both like the other
// storage-level tests.

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
  runtime: { id: 'test-action-history' },
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

const { revertLastAction } = await import('@/utils/activity/action-history.js');

const address = (id: string, value: string) => ({
  id,
  address: value,
  provider: 'demo',
  createdAt: 1,
  expiresAt: 0,
  accountStatus: 'active',
});

const email = (id: string, originalInbox: string) => ({
  id,
  received_at: 1,
  subject: id,
  original_inbox: originalInbox,
});

describe('action-history revertLastAction', () => {
  beforeEach(() => {
    for (const key of Object.keys(localStore)) delete localStore[key];
    for (const key of Object.keys(sessionStore)) delete sessionStore[key];
  });

  test('reverting recomputes metadata so the badge matches the reverted bags', async () => {
    // Last-good snapshot: address a1 with ONE stored email (m1) that was read.
    localStore.actionHistory_v1 = [
      {
        addresses: [address('a1', 'one@example.test')],
        readEmails: { 'one@example.test_m1': true },
        storedEmails: { 'one@example.test': [email('m1', 'one@example.test')] },
        archivedEmails: {},
        _savedAt: 1,
      },
    ];
    // The action then replaced the bag with two UNREAD emails and the badge
    // metadata followed the new bag - reverting must restore both together.
    localStore.emailStorageAddressIndex = { a1: 'one@example.test' };
    localStore.storedEmailsByAddress_a1 = [
      email('m2', 'one@example.test'),
      email('m3', 'one@example.test'),
    ];
    localStore.emailStorageMetadata = {
      a1: { messageCount: 2, unreadCount: 2, revision: 5 },
    };

    expect(await revertLastAction(mockBrowser as never)).toBe(true);

    expect(localStore.storedEmailsByAddress_a1).toEqual([email('m1', 'one@example.test')]);
    const metadata = (localStore.emailStorageMetadata as Record<string, Record<string, number>>).a1;
    expect(metadata).toMatchObject({ messageCount: 1, unreadCount: 0 });
  });
});
