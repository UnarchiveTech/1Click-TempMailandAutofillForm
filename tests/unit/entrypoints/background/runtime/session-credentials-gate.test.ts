import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// ── Environment shims BEFORE importing message-handler ──────────────────────
// Boundary under test: session credentials are persisted to
// browser.storage.session and (with autoCopy) written to the clipboard. A
// hostile page must not be able to plant arbitrary credentials claiming to
// belong to another site (finding: content script could inject
// { website: 'https://github.com', ... } from evil.com).

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
    id: 'test-extension-session-cred-gate',
    getURL: (p: string) => `chrome-extension://test-extension-session-cred-gate${p}`,
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

const clipboardWrites: string[] = [];
mock.module('@/utils/clipboard/clipboard.js', () => ({
  copyToClipboardAndSchedulePurge: async (text: string) => {
    clipboardWrites.push(text);
    return true;
  },
  copyToClipboardFromBackground: async (text: string) => {
    clipboardWrites.push(text);
    return true;
  },
  scheduleBackgroundPurge: async () => {},
  processClipboardPurgeQueue: async () => {},
}));

const { handlers } = await import('@/entrypoints/background/runtime/message-handler');

/** Content-script sender on a real page tab. */
function pageSender(tabUrl: string) {
  const url = new URL(tabUrl);
  return { id: 'ext-id', url: url.href, tab: { id: 1, url: tabUrl } };
}

/** Extension page running as a tab (options/app page) - a trusted UI surface. */
const extensionTabSender = {
  id: 'ext-id',
  url: 'chrome-extension://abcefefghi/app.html',
  tab: { id: 7, url: 'chrome-extension://abcefefghi/app.html' },
};

/** Extension page WITHOUT a tab (popup/sidepanel) - not a caller of this
 *  handler (the session is page-scoped), so the handler's tab requirement
 *  rejects it as before. */
const extensionPageSender = {
  id: 'ext-id',
  url: 'chrome-extension://abcefefghi/popup.html',
};

interface UpdateResult {
  success: boolean;
  clipboardWritten?: boolean;
  error?: string;
}

function callUpdate(message: unknown, sender: unknown): Promise<UpdateResult> {
  return new Promise((resolve) => {
    const updateHandler = handlers.updateSessionCredentials;
    if (!updateHandler) throw new Error('updateSessionCredentials handler missing');
    void updateHandler(message as never, sender as never, resolve as (r: unknown) => void);
  });
}

beforeEach(() => {
  delete sessionStore.sessionCredentials;
  localStore.autoCopy = false;
  clipboardWrites.length = 0;
});

describe('updateSessionCredentials sender gate', () => {
  test('extension UI running as a tab can update session credentials', async () => {
    const res = await callUpdate(
      {
        type: 'updateSessionCredentials',
        credentials: { website: 'https://anything.example', email: 'a@b.test' },
      },
      extensionTabSender
    );
    expect(res.success).toBe(true);
    const stored = sessionStore.sessionCredentials as Record<string, string> | undefined;
    expect(stored?.email).toBe('a@b.test');
  });

  test('extension pages without a tab keep the pre-existing tab-scoped rejection', async () => {
    // The session is page-scoped, so the handler requires a tab sender; my
    // sender gate must not have loosened that contract for the popup.
    const res = await callUpdate(
      { type: 'updateSessionCredentials', credentials: { email: 'a@b.test' } },
      extensionPageSender
    );
    expect(res.success).toBe(false);
    expect(sessionStore.sessionCredentials).toBeUndefined();
  });

  test('content script may update credentials without a website claim (autofill email flow)', async () => {
    // The real content-script callers send { email } only - the session is
    // tab-scoped and the website is derived from the page at consumption.
    const res = await callUpdate(
      { type: 'updateSessionCredentials', credentials: { email: 'fresh@inbox.test' } },
      pageSender('https://evil.com/signup')
    );
    expect(res.success).toBe(true);
    const stored = sessionStore.sessionCredentials as Record<string, string> | undefined;
    expect(stored?.email).toBe('fresh@inbox.test');
  });

  test('content script may pin website to its own domain', async () => {
    const res = await callUpdate(
      {
        type: 'updateSessionCredentials',
        credentials: { website: 'app.example.com', email: 'a@b.test' },
      },
      pageSender('https://app.example.com/signup')
    );
    expect(res.success).toBe(true);
  });

  test('content script may pin website to a registrable parent of its domain', async () => {
    const res = await callUpdate(
      {
        type: 'updateSessionCredentials',
        credentials: { website: 'https://example.com/profile' },
      },
      pageSender('https://docs.example.com/page')
    );
    expect(res.success).toBe(true);
  });

  test('content script cannot inject credentials claiming another site', async () => {
    const res = await callUpdate(
      {
        type: 'updateSessionCredentials',
        credentials: {
          website: 'https://github.com',
          email: 'attacker@evil.com',
          password: 'hunter2',
        },
      },
      pageSender('https://evil.com/login')
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe('errors.domainMismatch');
    // Nothing was persisted…
    expect(sessionStore.sessionCredentials).toBeUndefined();
    // …and nothing was copied to the clipboard.
    expect(clipboardWrites).toHaveLength(0);
  });

  test('subdomain claims across unrelated registrable domains are rejected', async () => {
    // github.io is a public suffix: a page there must not claim github.io
    // itself as its website (any third party can own a github.io subdomain).
    const res = await callUpdate(
      {
        type: 'updateSessionCredentials',
        credentials: { website: 'github.io' },
      },
      pageSender('https://attacker.github.io/page')
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe('errors.domainMismatch');
    expect(sessionStore.sessionCredentials).toBeUndefined();
  });

  test('autoCopy writes the clipboard only for allowed senders', async () => {
    localStore.autoCopy = true;

    const allowed = await callUpdate(
      {
        type: 'updateSessionCredentials',
        credentials: { email: 'me@ok.test', password: 'pw1' },
      },
      pageSender('https://ok.test/login')
    );
    expect(allowed.success).toBe(true);
    expect(allowed.clipboardWritten).toBe(true);
    expect(clipboardWrites).toHaveLength(1);

    clipboardWrites.length = 0;
    const rejected = await callUpdate(
      {
        type: 'updateSessionCredentials',
        credentials: { website: 'https://bank.test', email: 'x@evil.test' },
      },
      pageSender('https://evil.com/login')
    );
    expect(rejected.success).toBe(false);
    expect(clipboardWrites).toHaveLength(0);
  });
});
