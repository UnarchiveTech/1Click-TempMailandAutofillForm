import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { Address, Email } from '@/utils/types.js';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// ── Mocks registered BEFORE the dynamic import of address-manager.js ────────
// wxt/browser is replaced with in-memory storage so the real storage-keys /
// mutex pipeline runs against a controllable fake. fetchEmails (the provider
// DSL entry point) is stubbed so we can interleave a mid-fetch delete - the
// exact H-5 race: the inbox exists when checkNewEmails starts, is removed
// while the provider fetch is in flight, and must not get its bag resurrected
// when the local_only merge writes back.

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

// Simulates the provider fetch; when deleteMidFetch is set, the inbox is
// removed from the address list inside the "fetch" - the H-5 interleaving. The
// index and bag keys are intentionally left (deleteAddress's cleanup lags
// behind), so the persist block below still resolves the bag and must rely on
// re-validating the address itself before writing the local_only merge back.
let deleteMidFetch = false;
const fetchEmailsMock = mock(async () => {
  if (deleteMidFetch) {
    store.addresses = [];
  }
  return [{ id: 'api-2', subject: 'new mail', received_at: Date.now() }] satisfies Email[];
});

// email-service.ts imports these helpers from the same module; they're never
// invoked here (executeOperation is never reached - fetchEmails is stubbed),
// but they must exist so email-service's static import resolves.
mock.module('@/utils/dsl/email-fetcher.js', () => ({
  fetchEmails: fetchEmailsMock,
  buildRequest: () => ({ url: '', options: {} }),
  checkForErrors: () => undefined,
  extractPath: () => '',
  parseResponse: () => ({}),
}));

const { checkNewEmails } = await import('@/entrypoints/background/address/address-manager.js');
const { storedEmailsByAddressKey } = await import('@/utils/storage/storage-keys.js');

function liveAddress(id: string, address: string): Address {
  return {
    id,
    address,
    provider: 'guerrilla',
    accountStatus: 'active',
    expiresAt: Date.now() + 60_000,
    createdAt: Date.now(),
    autoExtend: false,
  } as Address;
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  for (const k of Object.keys(sessionStore)) delete sessionStore[k];
  deleteMidFetch = false;
});

describe('checkNewEmails H-5 (delete-mid-fetch must not resurrect the bag)', () => {
  test('persists local_only flags when the address still exists', async () => {
    const a1 = liveAddress('a1', 'a@test.com');
    store.addresses = [a1];
    store.emailStorageAddressIndex = { a1: 'a@test.com' };
    store[storedEmailsByAddressKey('a1')] = [
      { id: 'e1', received_at: Date.now(), local_only: false },
    ] satisfies Email[];

    const result = await checkNewEmails('a1');

    // Fetch returned the new message; the stored bag survived and its old
    // message was marked Saved Offline (absent from the API response).
    expect(result.some((e) => e.id === 'api-2')).toBe(true);
    const bag = store[storedEmailsByAddressKey('a1')] as Email[];
    expect(bag).toHaveLength(1);
    expect(bag[0]?.local_only).toBe(true);
  });

  test('does not write back the bag when the address is deleted mid-fetch', async () => {
    const a1 = liveAddress('a1', 'a@test.com');
    store.addresses = [a1];
    store.emailStorageAddressIndex = { a1: 'a@test.com' };
    store[storedEmailsByAddressKey('a1')] = [
      { id: 'e1', received_at: Date.now(), local_only: false },
    ] satisfies Email[];

    deleteMidFetch = true;

    const result = await checkNewEmails('a1');

    // The address vanished during the fetch. The result is still computed and
    // returned for the caller, but the local_only merge must NOT be written
    // back: e1 keeps local_only:false (untouched), proving the doomed bag was
    // not resurrected by the persist block.
    expect(result.length).toBeGreaterThan(0);
    const bag = store[storedEmailsByAddressKey('a1')] as Email[];
    expect(bag).toHaveLength(1);
    expect(bag[0]?.id).toBe('e1');
    expect(bag[0]?.local_only).toBe(false);
  });
});
