/**
 * Extension-context invalidation regression tests for the content→background
 * bridge.
 *
 * The production bug: after the extension is reloaded/updated while a tab
 * stays open, `browser.runtime.sendMessage` throws SYNCHRONOUSLY (no promise
 * is ever returned, so `.catch` never attaches). The bridge's async wrappers
 * then rejected, and the content script's fire-and-forget call sites - the 4s
 * form-watch loop, SPA-navigation pings, MutationObserver branches - surfaced
 * "Uncaught (in promise) Error: Extension context invalidated." on the host
 * page on every tick.
 *
 * These tests mock `browser.runtime.sendMessage` to behave exactly like
 * Chrome does after invalidation: throw synchronously. They pin the
 * contract that no bridge wrapper may throw or reject in that state, that
 * later calls become silent no-ops, and that transient failures (a sleeping
 * MV3 worker) do NOT trip the permanent invalidation flag.
 */

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

type SendPayload = Record<string, unknown>;

const sendState: {
  impl: (message: SendPayload) => unknown;
  calls: SendPayload[];
} = {
  // Default: healthy context answering every message.
  impl: (message) => {
    if (message.type === 'getStorageViaBg') {
      return { success: true, data: { themeColors: { '--md-primary': '#000' } } };
    }
    return { success: true };
  },
  calls: [],
};

mock.module('wxt/browser', () => ({
  browser: {
    runtime: {
      sendMessage: (message: SendPayload) => {
        sendState.calls.push(message);
        return sendState.impl(message);
      },
    },
  },
}));

afterAll(() => {
  mock.restore();
});

// The bridge module reads `browser` at call time from the mocked module, so
// the per-test `impl` swap below takes effect without re-importing.
const bridge = await import('@/utils/content/content-bg-bridge.js');

function rejectSynchronouslyLikeInvalidatedContext(): void {
  sendState.impl = () => {
    // Chrome throws "Extension context invalidated." synchronously from
    // chrome.runtime.sendMessage once the extension is reloaded/updated.
    throw new Error('Extension context invalidated.');
  };
}

function succeedAgain(): void {
  sendState.impl = (message) =>
    message.type === 'getStorageViaBg' ? { success: true, data: {} } : { success: true };
}

describe('content-bg-bridge: extension-context invalidation', () => {
  beforeEach(() => {
    sendState.calls = [];
    succeedAgain();
    bridge.resetContentBridgeForTests();
    bridge.invalidateSitePrivacySettingsCache();
  });

  test('an invalidated privacy request cannot overwrite a newer site response', async () => {
    let resolveOld!: (value: unknown) => void;
    sendState.impl = () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      });
    const oldRequest = bridge.getSitePrivacySettingsViaBg();

    bridge.invalidateSitePrivacySettingsCache();
    const newSettings = { otpDetection: false, formScanning: true };
    sendState.impl = () => ({ success: true, settings: newSettings });
    expect(await bridge.getSitePrivacySettingsViaBg()).toEqual(newSettings);

    resolveOld({ success: true, settings: { otpDetection: true, formScanning: true } });
    await oldRequest;
    expect(await bridge.getSitePrivacySettingsViaBg()).toEqual(newSettings);
    expect(sendState.calls.filter((call) => call.type === 'getSitePrivacySettings')).toHaveLength(
      2
    );
  });

  test('a sync-throwing context does NOT reject fire-and-forget wrappers', async () => {
    rejectSynchronouslyLikeInvalidatedContext();

    // Every one of these must resolve (never throw/reject) despite the
    // synchronous Chrome throw.
    await bridge.sendMessageViaBg({ type: 'formPresence', formDetected: false });
    await bridge.setStorageViaBg({ anyKey: 1 });
    await bridge.copyToClipboardViaBg('text', 60_000);
    await bridge.recordAutofillSuccessViaBg('example.com');
    await bridge.consumeLatestOtpViaBg('123456', 'user@example.com');
    await expect(bridge.getStorageViaBg(['activeAddressId'])).resolves.toEqual({});
  });

  test('the first invalidation error flags the context and later calls are silent no-ops', async () => {
    rejectSynchronouslyLikeInvalidatedContext();

    await bridge.sendMessageViaBg({ type: 'ping' });
    expect(bridge.isExtensionContextInvalidated()).toBe(true);

    const callsAfterInvalidation = sendState.calls.length;

    // After flagging, the browser API is not touched again at all.
    await bridge.sendMessageViaBg({ type: 'ping' });
    await bridge.getStorageViaBg(['latestOtp']);
    await bridge.clearWizardSessionViaBg('example.com');
    expect(sendState.calls.length).toBe(callsAfterInvalidation);
  });

  test('callers keep their previous fallback shapes after invalidation', async () => {
    rejectSynchronouslyLikeInvalidatedContext();

    await expect(bridge.getActiveAddressMetaViaBg()).resolves.toBeNull();
    await expect(bridge.getWizardSessionViaBg('example.com')).resolves.toBeNull();
    await expect(bridge.loadSmartAutofillSettingsViaBg()).resolves.toBeNull();
    await expect(bridge.generateIdentityViaBg('firstName')).resolves.toBe('');
    await expect(bridge.getIconSvgViaBg('logoMark')).resolves.toBe('');
    await expect(bridge.shouldPreferReplayViaBg('example.com')).resolves.toBe(false);
    await expect(bridge.createFreshAddressViaBg()).resolves.toBeNull();
    // decryptStoredCustomPasswordViaBg keeps its documented throw-and-fallback
    // contract - but the rejection message must come from that contract, not
    // from an escaped Chrome sync throw.
    await expect(bridge.decryptStoredCustomPasswordViaBg('passwordSettings')).rejects.toThrow(
      'Custom password decryption failed'
    );
  });

  test('transient failures (sleeping MV3 worker) do NOT permanently disable the bridge', async () => {
    // "Receiving end does not exist" happens when the MV3 service worker is
    // asleep - the context is still valid and recovers on the next event.
    sendState.impl = () => {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    };

    await bridge.sendMessageViaBg({ type: 'ping' });
    await bridge.sendMessageViaBg({ type: 'ping' });

    expect(bridge.isExtensionContextInvalidated()).toBe(false);
    expect(sendState.calls.length).toBe(2);
  });

  test('a once-invalidated bridge recovers only through reset (tab reload path)', async () => {
    rejectSynchronouslyLikeInvalidatedContext();
    await bridge.sendMessageViaBg({ type: 'ping' });
    expect(bridge.isExtensionContextInvalidated()).toBe(true);

    // Simulates the tab reload re-injecting a fresh content script (module
    // state gone) - in tests, the exported reset hook.
    bridge.resetContentBridgeForTests();
    succeedAgain();

    await expect(bridge.sendMessageViaBg({ type: 'ping' })).resolves.toEqual({ success: true });
    expect(bridge.isExtensionContextInvalidated()).toBe(false);
  });
});
