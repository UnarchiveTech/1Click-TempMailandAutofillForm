import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// message-handler.ts uses WXT's injected GLOBAL `browser` (no 'wxt/browser'
// import), so shim it (plus the module mock for safety) before importing.
const localStore: Record<string, unknown> = {};

const mockBrowser = {
  runtime: { id: 'test-hard-reset-flag', onMessage: { addListener() {}, removeListener() {} } },
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return { ...localStore };
        const list = Array.isArray(keys) ? keys : [keys];
        const result: Record<string, unknown> = {};
        for (const k of list) if (k in localStore) result[k] = localStore[k];
        return result;
      },
      set: async (items: Record<string, unknown>) => Object.assign(localStore, items),
      remove: async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete localStore[k];
      },
    },
  },
};

(globalThis as unknown as { browser?: unknown }).browser = mockBrowser;
mock.module('wxt/browser', () => ({ browser: mockBrowser }));

const { isLatestHardReset } = await import('@/entrypoints/background/runtime/message-handler.js');

describe('isLatestHardReset (hardReset auto-clear reconciliation)', () => {
  beforeEach(() => {
    for (const key of Object.keys(localStore)) delete localStore[key];
  });

  test('returns true when the snapshot is still the most recent reset', async () => {
    localStore.lastHardReset = 1000;
    expect(await isLatestHardReset(1000)).toBe(true);
  });

  test('returns false when a newer reset re-armed lastHardReset', async () => {
    localStore.lastHardReset = 2000;
    // A stale timer from the FIRST reset must NOT clear the flag after the
    // second reset re-armed it: this is the two-rapid-hardReset race.
    expect(await isLatestHardReset(1000)).toBe(false);
  });

  test('returns false when lastHardReset is absent (cleared storage)', async () => {
    expect(await isLatestHardReset(1000)).toBe(false);
  });
});
