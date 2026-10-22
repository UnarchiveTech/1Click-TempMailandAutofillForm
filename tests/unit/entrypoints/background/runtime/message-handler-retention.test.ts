/**
 * Behavioral tests for the retention message handlers in message-handler.ts.
 *
 * The contract (mirrors getEmailRetentionDays in storage-keys.ts): 0 is the
 * "never delete" sentinel and must pass through to the callee - the callee
 * turns it into keep-all / zero deletions. Only a malformed (non-number or
 * non-finite) value falls back to the default retention, and a negative value
 * must NEVER be forwarded (it would compute a future threshold and delete
 * every email) - it falls back to the default with the same response shape.
 */

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as actualLogger from '@/utils/logger.js';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
const logWarnCalls: Array<{ message: string; details?: unknown }> = [];

// Spread the real module and override only the levels this test observes. An
// exhaustive stub silently drifts: it previously omitted `log`, and the file
// only passed because an earlier file's leaked logger mock happened to supply
// it. Under per-file isolation the real module is the only source of truth.
mock.module('@/utils/logger.js', () => ({
  ...actualLogger,
  logError: () => {},
  logWarn: (message: string, details?: unknown) => {
    logWarnCalls.push({ message, details });
  },
  logDebug: () => {},
  logInfo: () => {},
}));

// ── Mocks registered BEFORE the dynamic import of message-handler.js ────────
// wxt/browser is replaced with in-memory storage so the real email-storage
// callee runs against empty state. This matters for the retention-0 contract:
// getEmailsToBeDeleted short-circuits 0 to all-zero counts, whereas the
// fallback cases really do walk storage - without this fake they threw and the
// handler answered `{ success: false }`, which is why the file previously only
// passed when another test file's storage mock happened to still be installed.
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

const { handlers } = await import('@/entrypoints/background/runtime/message-handler.js');

/** Invoke a handler directly the way the runtime dispatch would. */
function call<T>(
  handler: unknown,
  message: Record<string, unknown>
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const sendResponse = (response: unknown) => {
      const r = response as { success?: boolean; error?: string; count?: T };
      if (r?.success) resolve({ ok: true, value: r.count as T });
      else resolve({ ok: false, error: r?.error ?? 'unknown error' });
    };
    void (handler as (m: Record<string, unknown>, s: unknown, r: typeof sendResponse) => void)(
      message,
      {},
      sendResponse
    );
  });
}

beforeEach(() => {
  logWarnCalls.length = 0;
});

describe('getEmailsToBeDeleted handler - retention 0 contract', () => {
  test('forwards the "never delete" sentinel 0 instead of substituting 30', async () => {
    // The email-storage callee short-circuits 0 to all-zero counts; the
    // handler must not rewrite it to 30 (which would count real deletions).
    const res = await call<{
      activeEmails: number;
      archivedEmails: number;
      totalEmails: number;
    }>(handlers.getEmailsToBeDeleted, {
      type: 'getEmailsToBeDeleted',
      retentionDays: 0,
    });
    expect(res).toEqual({
      ok: true,
      value: { activeEmails: 0, archivedEmails: 0, totalEmails: 0 },
    });
    expect(logWarnCalls).toHaveLength(0);
  });

  test('falls back to the 30-day default for non-numeric values', async () => {
    const res = await call(handlers.getEmailsToBeDeleted, {
      type: 'getEmailsToBeDeleted',
      retentionDays: '30',
    });
    expect(res.ok).toBe(true);
    expect(logWarnCalls).toHaveLength(0);
  });
});

describe('cleanupOldStoredEmails handler - retention 0 contract', () => {
  test('forwards 0 / 0 without warnings (background no-ops keep-all)', async () => {
    const res = await call(handlers.cleanupOldStoredEmails, {
      type: 'cleanupOldStoredEmails',
      activeRetentionDays: 0,
      archivedRetentionDays: 0,
    });
    expect(res.ok).toBe(true);
    expect(logWarnCalls).toHaveLength(0);
  });

  test('regression: a negative retention never reaches cleanup as-is', async () => {
    // A negative threshold would delete EVERYTHING; the handler must coerce it
    // to the default (30/90) and leave a logWarn trace.
    const res = await call(handlers.cleanupOldStoredEmails, {
      type: 'cleanupOldStoredEmails',
      activeRetentionDays: -7,
      archivedRetentionDays: -7,
    });
    expect(res.ok).toBe(true);
    expect(logWarnCalls.length).toBe(2);
    expect(logWarnCalls[0].message).toContain('negative active retention');
    expect(logWarnCalls[1].message).toContain('negative archived retention');
  });

  test('mixed payload: 0 stays keep-all for its window, malformed archived falls back to 90', async () => {
    const res = await call(handlers.cleanupOldStoredEmails, {
      type: 'cleanupOldStoredEmails',
      activeRetentionDays: 0,
      archivedRetentionDays: NaN,
    });
    expect(res.ok).toBe(true);
    expect(logWarnCalls).toHaveLength(0);
  });
});
