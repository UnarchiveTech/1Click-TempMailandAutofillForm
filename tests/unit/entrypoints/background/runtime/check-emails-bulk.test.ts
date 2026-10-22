import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { Address, Email } from '@/utils/types.js';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// ── Mocks registered BEFORE the dynamic import of message-handler.js ────────
// wxt/browser is replaced with in-memory storage so the real storage-keys /
// email-storage pipeline runs against a controllable fake. The batch under
// test uses ARCHIVED inboxes only - checkNewEmails short-circuits those to
// their local bags without ever constructing an EmailService or touching the
// network - so the fan-out mechanics (order, isolation, merge) are pinned
// hermetically.

const store: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};

const fakeBrowser = {
  runtime: { id: 'test-extension' },
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
// message-handler itself references `browser` as the WXT-provided GLOBAL
// (src/global.d.ts), not an import - module mocks cover import sites only, so
// the test env must also install the fake on globalThis (cleaned in afterEach).
(globalThis as { browser?: unknown }).browser = fakeBrowser;

const { handlers } = await import('@/entrypoints/background/runtime/message-handler.js');
const { storedEmailsByAddressKey } = await import('@/utils/storage/storage-keys.js');
const { __clearMutexRegistryForTests } = await import('@/utils/mutex.js');
const { __clearInboxCheckCoalescerForTests } = await import(
  '@/entrypoints/background/runtime/message-handler.js'
);

type BulkResponse = {
  results?: Array<{ addressId?: string; success?: boolean; messages?: Email[]; error?: string }>;
};

async function runBulk(addressIds: string[]): Promise<BulkResponse> {
  let response: BulkResponse | undefined;
  await (
    handlers.checkEmailsBulk as unknown as (
      message: { type: 'checkEmailsBulk'; addressIds: string[]; filters?: object },
      _sender: unknown,
      sendResponse: (r: BulkResponse) => void
    ) => Promise<void>
  )({ type: 'checkEmailsBulk', addressIds, filters: {} }, {}, (r) => {
    response = r;
  });
  return response ?? {};
}

/** Archived inbox: checkNewEmails returns the local bag - no network, ever. */
function archivedAddress(id: string, address: string, messageIds: string[]): void {
  store.addresses = [
    ...((store.addresses as Address[]) || []),
    {
      id,
      address,
      provider: 'burner',
      accountStatus: 'archived',
      expiresAt: Date.now() - 60_000,
      createdAt: Date.now() - 120_000,
      autoExtend: false,
    } as Address,
  ];
  const index = (store.emailStorageAddressIndex as Record<string, string>) || {};
  index[id] = address;
  store.emailStorageAddressIndex = index;
  store[storedEmailsByAddressKey(id)] = messageIds.map((mid, i) => ({
    id: mid,
    received_at: Date.now() - i,
    subject: `msg-${mid}`,
  })) satisfies Email[];
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  for (const k of Object.keys(sessionStore)) delete sessionStore[k];
  // Shared module-registry across bun test files: a sibling that left the
  // address/email locks pending would otherwise wedge withAddressLock here.
  __clearMutexRegistryForTests();
  // The inbox-check coalescer retains settled results for its TTL; without
  // this reset a previous test's success would satisfy a later test's
  // unseeded address (bounded staleness by design, not a test expectation).
  __clearInboxCheckCoalescerForTests();
  (globalThis as { browser?: unknown }).browser = fakeBrowser;
});

afterEach(() => {
  delete (globalThis as { browser?: unknown }).browser;
});

describe('checkEmailsBulk (batched export check)', () => {
  test('returns every requested inbox\u2019s messages in request order, one round-trip', async () => {
    archivedAddress('a1', 'a@test.com', ['e1', 'e2']);
    archivedAddress('a2', 'b@test.com', ['e3']);

    const res = await runBulk(['a1', 'a2']);

    expect(res.results).toHaveLength(2);
    expect(res.results?.[0]).toMatchObject({ addressId: 'a1', success: true });
    expect(res.results?.[0]?.messages?.map((m) => m.id)).toEqual(['e1', 'e2']);
    expect(res.results?.[1]).toMatchObject({ addressId: 'a2', success: true });
    expect(res.results?.[1]?.messages?.map((m) => m.id)).toEqual(['e3']);
  });

  test('a missing inbox is an isolated failure that never aborts the batch', async () => {
    archivedAddress('a1', 'a@test.com', ['e1']);

    const res = await runBulk(['a1', 'ghost-id', 'a2']);

    expect(res.results).toHaveLength(3);
    expect(res.results?.[0]).toMatchObject({ addressId: 'a1', success: true });
    expect(res.results?.[1]).toMatchObject({ addressId: 'ghost-id', success: false });
    expect(res.results?.[2]).toMatchObject({ addressId: 'a2', success: false });
  });

  test('empty / non-string inputs resolve to an empty result, not an error', async () => {
    expect(await runBulk([])).toEqual({ results: [] });
    // Non-string ids are filtered out by the handler before any work begins.
    expect(await runBulk([42 as unknown as string])).toEqual({ results: [] });
  });
});
