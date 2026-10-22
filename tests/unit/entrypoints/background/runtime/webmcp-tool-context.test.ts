import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { RuntimeMessageSender } from '@/utils/types';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
/**
 * The webmcpTool handler must only accept requests from a real page context
 * (content script on an http(s) tab). Context-less senders - popup/sidepanel,
 * app-tab pages, background-internal calls - would otherwise reach the tools
 * without the per-site authorization (webmcpAccessList) or the per-tab rate
 * limiter in webmcp/tools.ts.
 *
 * wxt/browser is mocked with mock.module (same approach as
 * webmcp-tools.test.ts) so the dynamically imported tools.js sees a storage
 * fake regardless of what earlier test files pinned in the shared process.
 */

let store: Record<string, unknown>;

const storageGet = mock(async (key?: string | string[] | null) => {
  if (key === undefined || key === null) return { ...store };
  const arr = Array.isArray(key) ? key : [key];
  const out: Record<string, unknown> = {};
  for (const k of arr) if (k in store) out[k] = store[k];
  return out;
});

mock.module('wxt/browser', () => ({
  browser: {
    runtime: { id: 'test-extension' },
    storage: { local: { get: storageGet } },
    commands: {},
    tabs: {},
  },
}));

const { handlers } = await import('@/entrypoints/background/runtime/message-handler.js');

function callWebmcpTool(
  message: Record<string, unknown>,
  sender: RuntimeMessageSender
): Promise<unknown> {
  return new Promise((resolve) => {
    const handler = handlers.webmcpTool as unknown as (
      msg: Record<string, unknown>,
      s: RuntimeMessageSender,
      respond: (r: unknown) => void
    ) => Promise<void>;
    handler(message, sender, resolve).catch(() =>
      resolve({ success: false, error: 'handler threw' })
    );
  });
}

/** Page-context sender (what webmcp-bridge.content.ts sends with). */
const pageSender: RuntimeMessageSender = {
  id: 'ext-id',
  url: 'https://example.com/',
  tab: { id: 7, url: 'https://example.com/agent-page' },
};

/** Popup sender - no tab. */
const popupSender: RuntimeMessageSender = {
  id: 'ext-id',
  url: 'chrome-extension://abcefefghi/popup.html',
};

describe('webmcpTool page-context gate', () => {
  beforeEach(() => {
    store = {};
    storageGet.mockReset();
    storageGet.mockImplementation(async (key?: string | string[] | null) => {
      if (key === undefined || key === null) return { ...store };
      const arr = Array.isArray(key) ? key : [key];
      const out: Record<string, unknown> = {};
      for (const k of arr) if (k in store) out[k] = store[k];
      return out;
    });
  });

  test('rejects context-less senders before any tool logic runs', async () => {
    const resp = await callWebmcpTool({ tool: 'get_active_email', args: {} }, popupSender);
    expect(resp).toEqual({ success: false, error: 'WebMCP requires a page context' });
  });

  test('rejects senders with a tab but no tab URL', async () => {
    const noUrlSender: RuntimeMessageSender = {
      id: 'ext-id',
      url: 'https://example.com/',
      tab: { id: 9 },
    };
    const resp = await callWebmcpTool({ tool: 'get_active_email', args: {} }, noUrlSender);
    expect(resp).toEqual({ success: false, error: 'WebMCP requires a page context' });
  });

  test('page-context senders reach tool validation', async () => {
    const resp = await callWebmcpTool({ tool: 'definitely_not_a_tool', args: {} }, pageSender);
    expect(resp).toEqual({ success: false, error: expect.stringContaining('Unknown WebMCP tool') });
  });

  test('page-context senders are still subject to the per-site opt-in gate', async () => {
    // example.com is NOT in the (empty) webmcpAccessList → email tools are denied.
    const resp = await callWebmcpTool({ tool: 'get_active_email', args: {} }, pageSender);
    expect(resp).toEqual({
      success: false,
      error: expect.stringContaining('WebMCP access is not enabled for this website'),
    });
  });

  test('page-context senders on an opted-in host pass the gate', async () => {
    store.webmcpAccessList = ['example.com'];
    const resp = await callWebmcpTool({ tool: 'list_addresses', args: {} }, pageSender);
    // Reached the tool: the empty address list proves the opt-in gate passed
    // and listAddresses ran (a denial would return the opt-in error instead).
    expect(resp).toEqual({ success: true, result: { count: 0, addresses: [] } });
  });

  test('rejects a page-context sender whose tab URL yields no hostname', async () => {
    // An opt-in is present, so the ONLY reason to deny is the underivable host:
    // a host-less URL (data:, about:blank, file:, or unparseable) must not fall
    // back to the trusted internal-caller arm and must not skip the consent
    // list or the per-tab rate limiter.
    store.webmcpAccessList = ['example.com'];
    for (const tabUrl of ['about:blank', 'data:text/html,x', 'file:///etc/passwd', 'not a url']) {
      const resp = await callWebmcpTool(
        { tool: 'get_active_email', args: {} },
        { id: 'ext-id', url: tabUrl, tab: { id: 12, url: tabUrl } }
      );
      expect(resp).toEqual({
        success: false,
        error: expect.stringContaining('WebMCP access is not enabled for this website'),
      });
    }
  });
});
