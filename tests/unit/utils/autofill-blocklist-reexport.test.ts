import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// ── Mocks registered BEFORE importing either module under test ──────────────
// autofill-blocklist reads browser.storage.local directly; storage-keys imports
// the same `wxt/browser` module, so a single mock covers both.

const store: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};

const fakeBrowser = {
  runtime: { id: 'test-extension' },
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return { ...store };
        const list = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const key of list) if (key in store) out[key] = store[key];
        return out;
      },
      set: async (items: Record<string, unknown>) => {
        Object.assign(store, items);
      },
      remove: async (keys: string | string[]) => {
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

const blocklist = await import('@/utils/content/autofill-blocklist.js');
const storageKeys = await import('@/utils/storage/storage-keys.js');

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

describe('blocklist re-export parity', () => {
  test('storage-keys re-exports the same functions (not re-implementations)', () => {
    expect(storageKeys.getAutofillBlocklist).toBe(blocklist.getAutofillBlocklist);
    expect(storageKeys.isDomainBlocked).toBe(blocklist.isDomainBlocked);
  });

  test('both modules read the same stored blocklist', async () => {
    store.autofillBlocklist = ['example.com', 'www.other.com'];

    await expect(blocklist.getAutofillBlocklist()).resolves.toEqual([
      'example.com',
      'www.other.com',
    ]);
    await expect(storageKeys.getAutofillBlocklist()).resolves.toEqual([
      'example.com',
      'www.other.com',
    ]);
  });

  test('isDomainBlocked agrees across exact, subdomain, and non-blocked inputs', async () => {
    store.autofillBlocklist = ['example.com'];

    const cases = [
      'example.com',
      'login.example.com',
      'a.b.example.com',
      'other.com',
      'notexample.com',
    ];
    for (const domain of cases) {
      await expect(blocklist.isDomainBlocked(domain)).resolves.toBe(
        await storageKeys.isDomainBlocked(domain)
      );
    }

    await expect(storageKeys.isDomainBlocked('login.example.com')).resolves.toBe(true);
    await expect(storageKeys.isDomainBlocked('notexample.com')).resolves.toBe(false);
  });

  test('empty blocklist resolves to [] and blocks nothing in both', async () => {
    await expect(blocklist.getAutofillBlocklist()).resolves.toEqual([]);
    await expect(storageKeys.getAutofillBlocklist()).resolves.toEqual([]);
    await expect(storageKeys.isDomainBlocked('example.com')).resolves.toBe(false);
  });
});
