import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// ── Mocks registered BEFORE the dynamic import of blocklist-learn.js ────────
// The module reads storage.local for the blocklist, smart-autofill settings,
// and the failure-count map - the in-memory mock covers all of them.

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

const { recordAutofillFailure } = await import('@/features/intelligence/blocklist-learn.js');

// Must match MAX_FAILURE_DOMAINS in blocklist-learn.ts - regression-locks the cap.
const MAX_FAILURE_DOMAINS = 300;

function failureCountMap(): Record<string, number> {
  return (store.autofillFailureCounts_v1 as Record<string, number>) || {};
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

describe('recordAutofillFailure', () => {
  test('accumulates per-domain counts below the cap', async () => {
    await recordAutofillFailure('x.example.com');
    await recordAutofillFailure('x.example.com');
    const res = await recordAutofillFailure('x.example.com');
    expect(res.count).toBe(3);
    expect(failureCountMap()['x.example.com']).toBe(3);
  });

  test('caps the failure-count map size and keeps the just-incremented domain', async () => {
    // Fill right up to the cap with distinct domains.
    for (let i = 0; i < MAX_FAILURE_DOMAINS; i++) {
      await recordAutofillFailure(`site${i}.example.com`);
    }
    expect(Object.keys(failureCountMap()).length).toBe(MAX_FAILURE_DOMAINS);

    // One more distinct domain pushes the map over - the cap must evict the
    // lowest-count entries (all 1s here) while keeping the new domain's count.
    const res = await recordAutofillFailure('keep.example.com');
    expect(res.count).toBe(1);
    const map = failureCountMap();
    expect(Object.keys(map).length).toBeLessThanOrEqual(MAX_FAILURE_DOMAINS);
    expect(map['keep.example.com']).toBe(1);
  });

  test('does not evict a domain that reached the suggest threshold', async () => {
    // A domain with a high count must survive eviction when the map is full.
    for (let i = 0; i < 20; i++) {
      await recordAutofillFailure('important.example.com');
    }
    for (let i = 0; i < MAX_FAILURE_DOMAINS; i++) {
      await recordAutofillFailure(`noise${i}.example.com`);
    }
    const map = failureCountMap();
    expect(map['important.example.com']).toBe(20);
    expect(Object.keys(map).length).toBeLessThanOrEqual(MAX_FAILURE_DOMAINS);
  });
});
