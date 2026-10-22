import { afterAll, describe, expect, mock, test } from 'bun:test';

import type { Address } from '@/utils/types.js';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
const store: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};
const storageGets: string[][] = [];

const fakeBrowser = {
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return { ...store };
        const arr = Array.isArray(keys) ? keys : [keys];
        storageGets.push([...arr]);
        const out: Record<string, unknown> = {};
        for (const k of arr) if (k in store) out[k] = store[k];
        return out;
      },
      set: async (items: Record<string, unknown>) => {
        Object.assign(store, items);
      },
      remove: async () => {},
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

// NOTE: only `wxt/browser` is mocked here. `getStoredEmailsMap` and
// `saveLastGoodSnapshot` run against the fake storage below, so the real
// modules stay intact - bun's `mock.module` is process-global and stubbing
// them would poison sibling suites (email-storage) that import them unmocked.
mock.module('wxt/browser', () => ({ browser: fakeBrowser }));
Object.assign(globalThis, { browser: fakeBrowser });

const { loadAddresses } = await import('@/features/address/address-actions.js');

describe('loadAddresses account mapping', () => {
  test('keeps instanceUrl, tags, and renewal-failure fields on every account', async () => {
    const now = Date.now();
    const record: Address = {
      id: 'b-alpha',
      address: 'alpha.demo@burner.kiwi',
      provider: 'burner',
      instanceUrl: 'https://alphac.qzz.io/api/v2',
      token: 'tok',
      sidToken: 'tok',
      createdAt: now - 3600_000,
      expiresAt: now + 3600_000,
      autoExtend: false,
      tag: 'work',
      tags: [{ name: 'work', color: '#ff0000' }],
      renewalCount: 3,
      renewalFailCount: 2,
      lastFailureAt: now - 1000,
      accountStatus: 'active',
      emailUser: 'alpha.demo',
    };
    store.addresses = [record];
    store.activeAddressId = 'b-alpha';
    store.storedEmails = {};

    const allAddresses: Address[] = [];
    const selected: string[] = [];
    await loadAddresses(
      fakeBrowser as never,
      {
        setLoadingAddresses: () => {},
        setAllAddresses: (list: Address[]) => allAddresses.push(...list),
        setAddresses: () => {},
        setSelectedEmail: (e: string) => selected.push(e),
      } as never,
      false
    );

    expect(allAddresses).toHaveLength(1);
    const mapped = allAddresses[0];
    expect(mapped.instanceUrl).toBe('https://alphac.qzz.io/api/v2');
    expect(mapped.tags).toEqual([{ name: 'work', color: '#ff0000' }]);
    expect(mapped.renewalFailCount).toBe(2);
    expect(mapped.lastFailureAt).toBe(now - 1000);
    expect(mapped.renewalCount).toBe(3);
    expect(mapped.token).toBe('tok');
    expect(mapped.sidToken).toBe('tok');
    expect(mapped.status).toBe('active');
    expect(selected).toEqual(['alpha.demo@burner.kiwi']);
  });

  test('deferred bootstrap skips the broad email-map read and starts with zero counts', async () => {
    storageGets.length = 0;
    const record: Address = {
      id: 'active',
      address: 'active@example.test',
      provider: 'demo',
      token: 'tok',
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600_000,
      autoExtend: false,
      accountStatus: 'active',
      emailUser: 'active',
    };
    store.addresses = [record];
    store.activeAddressId = record.id;
    store.storedEmails = {
      [record.address]: [{ id: 'active-message', received_at: Date.now() }],
      'inactive@example.test': Array.from({ length: 100 }, (_, i) => ({
        id: `inactive-${i}`,
        received_at: Date.now(),
      })),
    };

    const allAddresses: Address[] = [];
    await loadAddresses(
      fakeBrowser as never,
      {
        setLoadingAddresses: () => {},
        setAllAddresses: (list: Address[]) => allAddresses.push(...list),
        setAddresses: () => {},
        setSelectedEmail: () => {},
      } as never,
      false,
      { deferEmailCounts: true }
    );

    expect(allAddresses[0]?.received).toBe(0);
    expect(storageGets.some((keys) => keys.includes('storedEmails'))).toBe(false);
  });
});
