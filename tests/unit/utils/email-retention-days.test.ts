/**
 * Behavioral tests for getEmailRetentionDays (src/utils/storage/storage-keys.ts).
 *
 * The retention contract: 0 (and any non-positive value) means "Never delete"
 * - the UI's first option (storagePerformance.neverDelete) persists exactly 0,
 * and both cleanupOldStoredEmails and use-retention-cleanup treat <= 0 as
 * keep-all. Positive values must therefore always resolve to at least 1 day:
 * a malformed fractional value like 0.4 must not round to 0, which cleanup
 * would silently read as "never delete" and permanently disable retention.
 */

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
const store: Record<string, unknown> = {};

const fakeBrowser = {
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return { ...store };
        const list = Array.isArray(keys) ? keys : [keys];
        const result: Record<string, unknown> = {};
        for (const key of list) if (key in store) result[key] = store[key];
        return result;
      },
      set: async (items: Record<string, unknown>) => {
        Object.assign(store, items);
      },
      remove: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
      },
    },
  },
};

mock.module('wxt/browser', () => ({ browser: fakeBrowser }));
Object.assign(globalThis, { browser: fakeBrowser });

const { getEmailRetentionDays } = await import('@/utils/storage/storage-keys.js');

beforeEach(() => {
  delete store.emailRetentionDays;
});

describe('getEmailRetentionDays', () => {
  test('defaults to 30 when unset', async () => {
    expect(await getEmailRetentionDays()).toBe(30);
  });

  test('returns 0 for the explicit "never delete" sentinel', async () => {
    store.emailRetentionDays = 0;
    expect(await getEmailRetentionDays()).toBe(0);
  });

  test('returns 0 for any non-positive value', async () => {
    store.emailRetentionDays = -5;
    expect(await getEmailRetentionDays()).toBe(0);
  });

  test('passes whole-day values through unchanged', async () => {
    store.emailRetentionDays = 7;
    expect(await getEmailRetentionDays()).toBe(7);
  });

  test('rounds fractional values normally', async () => {
    store.emailRetentionDays = 2.6;
    expect(await getEmailRetentionDays()).toBe(3);
  });

  test('regression: a small positive fraction clamps to 1, not 0', async () => {
    // 0.4 is not the "never delete" sentinel (the UI persists exactly 0), so
    // rounding it to 0 must not disable cleanup - it clamps to the minimum
    // meaningful positive retention of 1 day.
    store.emailRetentionDays = 0.4;
    expect(await getEmailRetentionDays()).toBe(1);
    store.emailRetentionDays = 0.1;
    expect(await getEmailRetentionDays()).toBe(1);
  });

  test('clamps overflow to the 365-day cap', async () => {
    store.emailRetentionDays = 9999;
    expect(await getEmailRetentionDays()).toBe(365);
  });

  test('falls back to the default for non-finite or non-number values', async () => {
    store.emailRetentionDays = NaN;
    expect(await getEmailRetentionDays()).toBe(30);
    store.emailRetentionDays = '7';
    expect(await getEmailRetentionDays()).toBe(30);
    store.emailRetentionDays = null;
    expect(await getEmailRetentionDays()).toBe(30);
  });
});
