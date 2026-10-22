import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// ── Environment shims BEFORE importing message-handler ──────────────────────
// message-handler.ts references the bare `browser` global that WXT injects
// into real extension contexts (it does NOT import from 'wxt/browser'), so
// both the WXT module mock AND the global must be provided. Assert the
// gesture-token minting contract of openExtensionUiInternal: a pending
// create-address token is issued ONLY after a UI-open actually reported
// success, never for an invocation whose open paths all failed.

const sessionStore: Record<string, unknown> = {};
const localStore: Record<string, unknown> = {};
let openPopupFails = false;
let tabsFail = false;

function pick(
  store: Record<string, unknown>,
  keys?: string | string[] | null
): Record<string, unknown> {
  if (keys === null || keys === undefined) return { ...store };
  const list = Array.isArray(keys) ? keys : [keys];
  const result: Record<string, unknown> = {};
  for (const k of list) if (k in store) result[k] = store[k];
  return result;
}

const mockBrowser = {
  runtime: {
    id: 'test-extension-mint-order',
    getURL: (p: string) => `chrome-extension://test-extension-mint-order${p}`,
    sendMessage: async () => {
      throw new Error('no UI listener');
    },
    onMessage: { addListener() {}, removeListener() {} },
  },
  storage: {
    session: {
      get: async (keys?: string | string[] | null) => pick(sessionStore, keys),
      set: async (items: Record<string, unknown>) => Object.assign(sessionStore, items),
      remove: async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete sessionStore[k];
      },
    },
    local: {
      get: async (keys?: string | string[] | null) => pick(localStore, keys),
      set: async (items: Record<string, unknown>) => Object.assign(localStore, items),
      remove: async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete localStore[k];
      },
    },
  },
  action: {
    openPopup: async () => {
      if (openPopupFails) throw new Error('User gesture required');
    },
  },
  sidePanel: {
    open: async () => {
      throw new Error('side panel unavailable');
    },
  },
  windows: { getCurrent: async () => ({ id: 1 }) },
  tabs: {
    create: async () => {
      if (tabsFail) throw new Error('tab create failed');
      return { id: 9 };
    },
  },
};

(globalThis as unknown as { browser?: unknown }).browser = mockBrowser;
mock.module('wxt/browser', () => ({ browser: mockBrowser }));

const { openExtensionUiInternal } = await import(
  '@/entrypoints/background/runtime/message-handler.js'
);

function pendingCreateAddressToken(): { token?: string } | undefined {
  const pending = sessionStore.pendingGestureTokens as
    | Record<string, { token: string; expiresAt: number }>
    | undefined;
  return pending?.['autofill-create-address:7'];
}

describe('openExtensionUiInternal gesture mint order', () => {
  beforeEach(() => {
    for (const key of Object.keys(sessionStore)) delete sessionStore[key];
    for (const key of Object.keys(localStore)) delete localStore[key];
    openPopupFails = false;
    tabsFail = false;
  });

  test('popup opens → pending create-address token IS issued (UI provably reached)', async () => {
    const res = await openExtensionUiInternal(
      {
        type: 'openExtensionUi',
        reason: 'autofill-create-address',
        hint: 'create-address',
      } as never,
      { gestureTabId: 7 }
    );
    expect(res.success).toBe(true);
    expect(pendingCreateAddressToken()?.token).toBeTruthy();
  });

  test('EVERY open path fails → NO token minted (regression: was minted before opening)', async () => {
    openPopupFails = true;
    tabsFail = true;
    const res = await openExtensionUiInternal(
      {
        type: 'openExtensionUi',
        reason: 'autofill-create-address',
        hint: 'create-address',
      } as never,
      { gestureTabId: 7 }
    );
    expect(res.success).toBe(false);
    expect(pendingCreateAddressToken()).toBeUndefined();
  });

  test('popup denied by gesture requirement but app tab opens → no token issued', async () => {
    openPopupFails = true;
    const res = await openExtensionUiInternal(
      {
        type: 'openExtensionUi',
        reason: 'autofill-create-address',
        hint: 'create-address',
      } as never,
      { gestureTabId: 7 }
    );
    expect(res.success).toBe(true);
    expect(res.opened).toBe('tab');
    expect(pendingCreateAddressToken()).toBeUndefined();
  });

  test('popup opens without a verified originating tab → no token issued', async () => {
    const res = await openExtensionUiInternal({
      type: 'openExtensionUi',
      reason: 'autofill-create-address',
      hint: 'create-address',
    } as never);
    expect(res.success).toBe(true);
    expect(res.opened).toBe('popup');
    expect(pendingCreateAddressToken()).toBeUndefined();
  });

  test('handoff payload goes to session only - no storage.local mirror', async () => {
    await openExtensionUiInternal({
      type: 'openExtensionUi',
      reason: 'expired',
      hint: '',
    } as never);
    expect(Object.keys(sessionStore).length).toBeGreaterThan(0);
    expect(Object.keys(localStore)).toEqual([]);
  });

  test('session storage failure → handoff falls back to storage.local', async () => {
    const originalSet = mockBrowser.storage.session.set;
    mockBrowser.storage.session.set = async () => {
      throw new Error('session storage unavailable');
    };
    try {
      const res = await openExtensionUiInternal({
        type: 'openExtensionUi',
        reason: 'expired',
        hint: '',
      } as never);
      expect(res.success).toBe(true);
      expect(localStore.openExtensionReason).toBe('expired');
      expect(localStore.openExtensionAt).toBeTypeOf('number');
    } finally {
      mockBrowser.storage.session.set = originalSet;
    }
  });

  test('unrelated reasons never mint a create-address token', async () => {
    const res = await openExtensionUiInternal({
      type: 'openExtensionUi',
      reason: 'expired',
      hint: '',
    } as never);
    expect(res.success).toBe(true);
    expect(pendingCreateAddressToken()).toBeUndefined();
  });
});
