import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// ── Mocks registered BEFORE the dynamic import of instance-manager.js ───────
// instance-manager reaches storage through the in-memory browser mock
// (getStorage / setStorage / disabledInstancesKey).

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
Object.assign(globalThis, { browser: fakeBrowser });

const { removeCustomProviderInstance, setDisabledInstances, toggleDisabledInstance } = await import(
  '@/utils/provider/instance-manager.js'
);

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

describe('toggleDisabledInstance', () => {
  test('disables an instance without mutating the input set', () => {
    const disabled = new Set<string>();
    const next = toggleDisabledInstance(disabled, 'one', 2);

    expect(next).toEqual(new Set(['one']));
    expect(disabled).toEqual(new Set());
  });

  test('prevents disabling the final enabled instance', () => {
    expect(toggleDisabledInstance(new Set(), 'only', 1)).toBeNull();
    expect(toggleDisabledInstance(new Set(['other']), 'only', 2)).toBeNull();
  });

  test('re-enables a disabled instance', () => {
    expect(toggleDisabledInstance(new Set(['one']), 'one', 1)).toEqual(new Set());
  });
});

describe('removeCustomProviderInstance', () => {
  test('purges the deleted instance id from the disabled-instances blacklist', async () => {
    const providerId = 'guerrilla';
    const instanceId = 'custom_guerrilla_1234567890_abc123';
    store.customInstances_guerrilla = [{ id: instanceId, apiUrl: 'https://x', isCustom: true }];
    await setDisabledInstances(providerId, ['other-id', instanceId]);

    await removeCustomProviderInstance(providerId, instanceId);

    expect(store.customInstances_guerrilla).toEqual([]);
    expect(store.disabledInstances_guerrilla).toEqual(['other-id']);
  });

  test('leaves the blacklist untouched when the id was never disabled', async () => {
    const providerId = 'guerrilla';
    const instanceId = 'custom_guerrilla_1_x';
    store.customInstances_guerrilla = [{ id: instanceId, apiUrl: 'https://x', isCustom: true }];
    await setDisabledInstances(providerId, ['other-id']);

    await removeCustomProviderInstance(providerId, instanceId);

    expect(store.customInstances_guerrilla).toEqual([]);
    expect(store.disabledInstances_guerrilla).toEqual(['other-id']);
  });

  test('does not create the blacklist key when none exists', async () => {
    const providerId = 'guerrilla';
    const instanceId = 'custom_guerrilla_2_y';
    store.customInstances_guerrilla = [{ id: instanceId, apiUrl: 'https://x', isCustom: true }];

    await removeCustomProviderInstance(providerId, instanceId);

    expect(store.customInstances_guerrilla).toEqual([]);
    expect(store.disabledInstances_guerrilla).toBeUndefined();
  });
});
