import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { RuntimeMessageSender } from '@/utils/types';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
/**
 * The background's OUTERMOST authorization gate: `registerMessageHandler`
 * rejects any message whose `sender.id` is not this extension's id, before
 * handler dispatch. It is what makes the bridge handlers - including
 * `getStorageViaBg`, whose content-readable allowlist deliberately contains
 * credential-bearing keys (loginInfo, identities, latestOtp, addresses) -
 * unreachable from other extensions and from web pages.
 *
 * The URL-based `isExtensionSender(sender)` check further INSIDE the listener
 * only ever sees our own extension's senders because of this gate, so its
 * `chrome-extension://` prefix test cannot be spoofed into an extension-page
 * bypass. These tests pin that ordering: a foreign sender is rejected even
 * when it presents an extension-shaped URL, and no storage read happens.
 */

type Listener = (
  message: unknown,
  sender: RuntimeMessageSender,
  sendResponse: (response: unknown) => void
) => unknown;

let capturedListener: Listener | null = null;

const storageGet = mock(async () => ({ masterKey: 'secret', loginInfo: [{ id: 'l1' }] }));
const storageSet = mock(async () => {});

const mockBrowser = {
  storage: {
    local: { get: storageGet, set: storageSet },
    session: { get: mock(async () => ({})), set: mock(async () => {}) },
  },
  runtime: {
    id: 'test-own-extension',
    onMessage: {
      addListener(listener: Listener) {
        capturedListener = listener;
      },
      removeListener() {},
    },
  },
  commands: { onCommand: { addListener() {}, removeListener() {} } },
  tabs: {},
};

mock.module('wxt/browser', () => ({ browser: mockBrowser }));

const { registerMessageHandler } = await import(
  '@/entrypoints/background/runtime/message-handler.js'
);

beforeEach(() => {
  storageGet.mockClear();
  storageSet.mockClear();
  // Imported modules may register their own listeners before this test starts.
  // Register the dispatcher explicitly so this callback is the one under test.
  registerMessageHandler();
});

function sendFrom(sender: RuntimeMessageSender, message: Record<string, unknown>) {
  expect(capturedListener).not.toBeNull();
  const responses: unknown[] = [];
  const result = capturedListener?.(message, sender, (r) => responses.push(r));
  return { result, responses };
}

describe('background sender gate', () => {
  test('another extension is rejected even with an extension-shaped sender URL', () => {
    const foreign: RuntimeMessageSender = {
      id: 'a-different-extension',
      url: 'chrome-extension://adifferentextensionid/popup.html',
    };
    const { result, responses } = sendFrom(foreign, {
      type: 'getStorageViaBg',
      keys: ['loginInfo', 'masterKey'],
    });
    expect(result).toBe(false);
    expect(responses).toEqual([]);
    // The gate runs before dispatch - the vault is never read for the foreign id.
    expect(storageGet).not.toHaveBeenCalled();
  });

  test('a sender without an extension id (page-originated) is rejected', () => {
    const { result, responses } = sendFrom(
      { url: 'https://example.com/' },
      { type: 'getStorageViaBg', keys: 'loginInfo' }
    );
    expect(result).toBe(false);
    expect(responses).toEqual([]);
    expect(storageGet).not.toHaveBeenCalled();
  });

  test('a write from another extension never reaches storage', () => {
    const foreign: RuntimeMessageSender = {
      id: 'a-different-extension',
      url: 'moz-extension://adifferentextensionid/sidepanel.html',
    };
    const { result } = sendFrom(foreign, {
      type: 'setStorageViaBg',
      items: { loginInfo: [] },
    });
    expect(result).toBe(false);
    expect(storageSet).not.toHaveBeenCalled();
  });
});
