import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { Address, Email } from '@/utils/types.js';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// ── Mocks registered BEFORE the dynamic import of archived-overflow.js ──────
// The module reaches email-storage (restoreArchivedEmailsToStored) and the
// storage-keys helpers through the in-memory browser mock, exactly like the
// email-storage test harnesses.

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

const { restoreArchivedOverflowAddress } = await import('@/features/address/archived-overflow.js');
const { archivedEmailsByAddressKey, storedEmailsByAddressKey } = await import(
  '@/utils/storage/storage-keys.js'
);

function evictedRecord(overrides: Partial<Address> = {}): Address {
  return {
    id: 'ov1',
    address: 'ov1@x.com',
    provider: 'guerrilla',
    token: 'tok-123',
    sidToken: 'sid-123',
    createdAt: Date.now() - 24 * 60 * 60 * 1000,
    expiresAt: Date.now() - 60 * 1000, // expired - user can renew after restore
    accountStatus: 'archived',
    status: 'archived',
    autoExtend: false,
    ...overrides,
  } as Address;
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

describe('restoreArchivedOverflowAddress', () => {
  test('moves the record back into addresses as active and brings its mail back', async () => {
    store.archivedAddressOverflow = [evictedRecord()];
    store.addresses = [
      {
        id: 'other',
        address: 'other@x.com',
        provider: 'guerrilla',
        createdAt: 1,
        expiresAt: 0,
        accountStatus: 'active',
      },
    ] as Address[];
    // Evicted mailboxes keep their index entry + ID-keyed archived bag so the
    // Offline Saved history stays recoverable.
    store.emailStorageAddressIndex = { ov1: 'ov1@x.com' };
    store[archivedEmailsByAddressKey('ov1')] = [
      {
        id: 'm1',
        from: 'noreply@example.com',
        subject: 'Saved',
        received_at: Math.floor(Date.now() / 1000),
        archived_at: Date.now() - 1000,
      } as Email,
    ];

    const restored = await restoreArchivedOverflowAddress('ov1');

    expect(restored).toBe(true);
    expect(store.archivedAddressOverflow).toEqual([]);

    const addresses = store.addresses as Address[];
    expect(addresses.length).toBe(2);
    const record = addresses.find((i) => i.id === 'ov1');
    expect(record?.accountStatus).toBe('active');
    expect(record?.status).toBeUndefined(); // display-only field, never persisted
    // Credentials survive the round-trip (setAddresses re-encrypts them, so the
    // value differs from the raw seed) → renew works after restore.
    expect(record?.token).toBeTruthy();
    expect(record?.expiredNotified).toBe(false);

    // Offline Saved history moved back into the stable ID-keyed live bag.
    const restoredMail = store[storedEmailsByAddressKey('ov1')] as Email[];
    expect(restoredMail?.map((e) => e.id)).toEqual(['m1']);
    expect(store[archivedEmailsByAddressKey('ov1')]).toBeUndefined();
  });

  test('returns false and changes nothing for an unknown id', async () => {
    store.archivedAddressOverflow = [evictedRecord()];
    store.addresses = [];

    const restored = await restoreArchivedOverflowAddress('nope');

    expect(restored).toBe(false);
    expect((store.archivedAddressOverflow as Address[]).length).toBe(1);
    expect((store.addresses as Address[]).length).toBe(0);
  });
});
