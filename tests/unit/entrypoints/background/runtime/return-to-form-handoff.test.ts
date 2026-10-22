import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { RuntimeMessageSender } from '@/utils/types';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
/**
 * flagReturnToForm - content scripts cannot reach storage.session (no
 * setAccessLevel opens it to them), so the return-to-form handoff goes through
 * this dedicated background handler instead of the local-only setStorageViaBg
 * bridge. Pins: writes exactly the three pendingAutofill* keys into session,
 * never touches storage.local, is allowlisted for content senders, and reports
 * the sender's page URL.
 */

let sessionStore: Record<string, unknown>;
let localStore: Record<string, unknown>;

const sessionSet = mock(async (items: Record<string, unknown>) => {
  Object.assign(sessionStore, items);
});
const localSet = mock(async (items: Record<string, unknown>) => {
  Object.assign(localStore, items);
});

// runtime.id is required: wxt/browser falls back to `chrome` when the global
// browser lacks it, and test files share one process - every fake must carry
// the id so the first module load pins a sane runtime.
const mockBrowser = {
  storage: {
    local: {
      get: mock(async (key: string | string[]) => {
        if (typeof key === 'string') return { [key]: localStore[key] };
        const out: Record<string, unknown> = {};
        for (const k of key) out[k] = localStore[k];
        return out;
      }),
      set: localSet,
    },
    session: {
      set: sessionSet,
    },
  },
  runtime: { id: 'test-extension' },
  commands: {},
  tabs: {},
};
mock.module('wxt/browser', () => ({ browser: mockBrowser }));

const { handlers } = await import('@/entrypoints/background/runtime/message-handler.js');
const { CONTENT_SCRIPT_ALLOWED_HANDLERS } = await import(
  '@/entrypoints/background/runtime/message-handler.js'
);

beforeEach(() => {
  sessionStore = {};
  localStore = {};
  sessionSet.mockReset();
  sessionSet.mockImplementation(async (items: Record<string, unknown>) => {
    Object.assign(sessionStore, items);
  });
  localSet.mockReset();
  localSet.mockImplementation(async (items: Record<string, unknown>) => {
    Object.assign(localStore, items);
  });
});

const pageSender: RuntimeMessageSender = {
  id: 'ext-id',
  url: 'https://example.com/form',
  tab: { id: 1, url: 'https://example.com/form' },
};

function callHandler(message: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve) => {
    const handler = handlers.flagReturnToForm as unknown as (
      msg: Record<string, unknown>,
      s: RuntimeMessageSender,
      respond: (r: unknown) => void
    ) => Promise<void>;
    handler(message, pageSender, resolve).catch(() =>
      resolve({ success: false, error: 'handler threw' })
    );
  });
}

describe('flagReturnToForm', () => {
  test('stores the handoff in storage.session (the popup reader) with the page URL', async () => {
    const resp = await callHandler({ type: 'flagReturnToForm', url: 'https://example.com/form' });
    expect(resp).toEqual({ success: true });
    expect(sessionSet).toHaveBeenCalledTimes(1);
    const payload = sessionSet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.pendingAutofillReturn).toBe(true);
    expect(payload.pendingAutofillUrl).toBe('https://example.com/form');
    expect(typeof payload.pendingAutofillAt).toBe('number');
  });

  test('never touches persistent storage.local', async () => {
    await callHandler({ type: 'flagReturnToForm', url: 'https://example.com/form' });
    expect(localSet).not.toHaveBeenCalled();
    expect(localStore).toEqual({});
  });

  test('tolerates a missing URL (defaults to empty string)', async () => {
    const resp = await callHandler({ type: 'flagReturnToForm' });
    expect(resp).toEqual({ success: true });
    const payload = sessionSet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.pendingAutofillUrl).toBe('');
  });

  test('is allowlisted for content scripts', () => {
    expect(CONTENT_SCRIPT_ALLOWED_HANDLERS.has('flagReturnToForm')).toBe(true);
  });
});
