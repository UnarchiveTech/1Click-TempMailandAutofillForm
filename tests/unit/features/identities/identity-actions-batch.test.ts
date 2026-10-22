import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
const store: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};

const fakeBrowser = {
  runtime: { id: 'test-extension' },
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return { ...store };
        const requested = Array.isArray(keys) ? keys : [keys];
        const result: Record<string, unknown> = {};
        for (const key of requested) {
          if (key in store) result[key] = store[key];
        }
        return result;
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
        const requested = Array.isArray(keys) ? keys : [keys];
        const result: Record<string, unknown> = {};
        for (const key of requested) {
          if (key in sessionStore) result[key] = sessionStore[key];
        }
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

const { deleteIdentities } = await import('@/features/identities/identity-actions.js');
const extension = fakeBrowser as Parameters<typeof deleteIdentities>[0];

type IdentitySetters = Parameters<typeof deleteIdentities>[2];

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  for (const key of Object.keys(sessionStore)) delete sessionStore[key];
});

describe('deleteIdentities', () => {
  test('deletes a batch in one storage update and selects the first remaining identity', async () => {
    const identities = [
      {
        id: 'one',
        name: 'One',
        firstNames: '',
        lastNames: '',
        useRandomPassword: true,
        isDefault: false,
        createdAt: 1,
      },
      {
        id: 'two',
        name: 'Two',
        firstNames: '',
        lastNames: '',
        useRandomPassword: true,
        isDefault: false,
        createdAt: 2,
      },
      {
        id: 'three',
        name: 'Three',
        firstNames: '',
        lastNames: '',
        useRandomPassword: true,
        isDefault: false,
        createdAt: 3,
      },
    ];
    store.identities = identities;
    store.selectedIdentityId = 'two';

    const setterCalls: { identities?: unknown[]; selected?: string | null } = {};
    const setters = {
      setIdentities: (next: unknown[]) => {
        setterCalls.identities = next;
      },
      setSelectedIdentityId: (next: string | null) => {
        setterCalls.selected = next;
      },
    } as IdentitySetters;

    const setCalls: Record<string, unknown>[] = [];
    const originalSet = extension.storage.local.set;
    extension.storage.local.set = async (items: Record<string, unknown>) => {
      setCalls.push(items);
      await originalSet(items);
    };

    const deleted = await deleteIdentities(extension, ['one', 'two', 'two', 'missing'], setters);

    expect(deleted).toBe(true);
    expect(store.identities).toEqual([identities[2]]);
    expect(store.selectedIdentityId).toBe('three');
    expect(setterCalls.identities).toEqual([identities[2]]);
    expect(setterCalls.selected).toBe('three');
    expect(setCalls).toHaveLength(2);
    expect(setCalls[0]).toEqual({ identities: [identities[2]] });
    expect(setCalls[1]).toEqual({ selectedIdentityId: 'three' });
  });

  test('keeps the selected identity when the batch does not contain it', async () => {
    const identitiesForTest = [
      {
        id: 'one',
        name: 'One',
        firstNames: '',
        lastNames: '',
        useRandomPassword: true,
        isDefault: false,
        createdAt: 1,
      },
      {
        id: 'two',
        name: 'Two',
        firstNames: '',
        lastNames: '',
        useRandomPassword: true,
        isDefault: false,
        createdAt: 2,
      },
    ];
    store.identities = identitiesForTest;
    store.selectedIdentityId = 'two';

    let selectedSetterCalls = 0;
    const setters = {
      setIdentities: () => {},
      setSelectedIdentityId: () => {
        selectedSetterCalls += 1;
      },
    } as IdentitySetters;

    const deleted = await deleteIdentities(extension, ['one'], setters);

    expect(deleted).toBe(true);
    expect(store.identities).toEqual([identitiesForTest[1]]);
    expect(store.selectedIdentityId).toBe('two');
    expect(selectedSetterCalls).toBe(0);
  });
});
