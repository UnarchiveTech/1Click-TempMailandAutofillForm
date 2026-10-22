import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// ── Environment shims BEFORE importing message-handler ──────────────────────
// message-handler.ts references the bare `browser` global that WXT injects
// into real extension contexts (it does NOT import from 'wxt/browser'), so
// both the WXT module mock AND the global must be provided. Assert the
// copyToClipboard boundary: extension pages may copy arbitrary text; content
// scripts (which run on <all_urls>) may only copy plausible credential values
// (OTP codes, emails, usernames, phone numbers) - never arbitrary page-driven
// payloads such as exfiltration URLs (paste-target prompt injection).

const localStore: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};

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
    id: 'test-extension-clipboard-gate',
    getURL: (p: string) => `chrome-extension://test-extension-clipboard-gate${p}`,
    sendMessage: async () => {
      throw new Error('no UI listener');
    },
    onMessage: { addListener() {}, removeListener() {} },
  },
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => pick(localStore, keys),
      set: async (items: Record<string, unknown>) => void Object.assign(localStore, items),
      remove: async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete localStore[k];
      },
    },
    session: {
      get: async (keys?: string | string[] | null) => pick(sessionStore, keys),
      set: async (items: Record<string, unknown>) => void Object.assign(sessionStore, items),
      remove: async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete sessionStore[k];
      },
    },
    onChanged: { addListener() {} },
  },
  permissions: { contains: async () => true },
};

Object.assign(globalThis, { browser: mockBrowser });
mock.module('wxt/browser', () => ({ browser: mockBrowser }));

const clipboardWrites: Array<{ text: string; ms?: number }> = [];
mock.module('@/utils/clipboard/clipboard.js', () => ({
  copyToClipboardAndSchedulePurge: async (text: string, ms?: number) => {
    clipboardWrites.push({ text, ms });
    return true;
  },
  copyToClipboardFromBackground: async (text: string, ms?: number) => {
    clipboardWrites.push({ text, ms });
    return true;
  },
  scheduleBackgroundPurge: async () => {},
  processClipboardPurgeQueue: async () => {},
}));

const { handlers, isPlausibleClipboardText } = await import(
  '@/entrypoints/background/runtime/message-handler'
);

/** Content-script sender on a real page tab. */
function pageSender(tabUrl: string) {
  const url = new URL(tabUrl);
  return { id: 'ext-id', url: url.href, tab: { id: 1, url: tabUrl } };
}

/** Extension-page (popup/sidepanel/app tab) sender. */
const extensionPageSender = {
  id: 'ext-id',
  url: 'chrome-extension://abcefefghi/popup.html',
};

function callCopy(message: unknown, sender: unknown): Promise<{ success: boolean }> {
  return new Promise((resolve) => {
    const copyHandler = handlers.copyToClipboard;
    if (!copyHandler) throw new Error('copyToClipboard handler missing');
    void copyHandler(message as never, sender as never, resolve as (response: unknown) => void);
  });
}

describe('isPlausibleClipboardText', () => {
  test('accepts OTP-like codes, emails, usernames, and phone numbers', () => {
    expect(isPlausibleClipboardText('482913')).toBe(true);
    expect(isPlausibleClipboardText('A1B2C3')).toBe(true);
    expect(isPlausibleClipboardText('user.name+tag@example.com')).toBe(true);
    expect(isPlausibleClipboardText('+1 (555) 123-4567')).toBe(true);
  });

  test('rejects URLs and URL-shaped payloads', () => {
    expect(isPlausibleClipboardText('https://evil.com/steal?c=xyz123')).toBe(false);
    expect(isPlausibleClipboardText('http://attacker.net')).toBe(false);
    expect(isPlausibleClipboardText('evil.com/path')).toBe(false);
    expect(isPlausibleClipboardText('javascript:alert(1)')).toBe(false);
  });

  test('rejects overlong payloads and digit-free text', () => {
    expect(isPlausibleClipboardText(`${'x'.repeat(65)}1`)).toBe(false);
    expect(isPlausibleClipboardText('no digits here at all')).toBe(false);
  });
});

describe('copyToClipboard handler gate', () => {
  beforeEach(() => {
    clipboardWrites.length = 0;
  });

  test('extension pages can copy arbitrary text (UI surface)', async () => {
    const res = await callCopy(
      { type: 'copyToClipboard', text: 'https://arbitrary.user/text without digits' },
      extensionPageSender
    );
    expect(res.success).toBe(true);
    expect(clipboardWrites).toHaveLength(1);
  });

  test('content script may copy an OTP code (wait-OTP panel flow)', async () => {
    const res = await callCopy(
      { type: 'copyToClipboard', text: '482913' },
      pageSender('https://example.com/verify')
    );
    expect(res.success).toBe(true);
    expect(clipboardWrites).toHaveLength(1);
  });

  test('content script cannot copy an exfiltration URL', async () => {
    const res = await callCopy(
      { type: 'copyToClipboard', text: `https://evil.com/steal?c=${'A'.repeat(40)}` },
      pageSender('https://evil.com/page')
    );
    expect(res.success).toBe(false);
    expect(clipboardWrites).toHaveLength(0);
  });
});
