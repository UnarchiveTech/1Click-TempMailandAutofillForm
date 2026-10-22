/**
 * Regression tests for the `copy-latest-otp` keyboard shortcut handler.
 *
 * Bug (pre-existing at HEAD, fixed here): the shortcut read
 * `storage.session._latest_otp_code`, a key NOTHING in the codebase writes,
 * so Alt+Shift+O was always a silent no-op. The authoritative cache is the
 * `latestOtp` record in storage.local written by the email-storage M5 step
 * (email-storage.ts) - `{ otp, sender, senderName, context, received_at,
 * recipient }`. The contract pinned here:
 *
 *  1. the OTP is resolved from `latestOtp` (storage.local);
 *  2. untimestamped legacy session values cannot bypass freshness checks;
 *  3. an empty cache is a silent no-op - no clipboard write, no toast, no
 *     notification;
 *  4. with an extension UI open, the background reports via `otpCopied` and
 *     does NOT raise a desktop notification;
 *  5. without an extension UI (runtime.sendMessage rejects), it falls back to
 *     a value-free desktop notification (copied / failed title) - never
 *     embedding the code itself (shoulder-surfing).
 */

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// ── In-memory browser mock (local + session storage, runtime, tabs) ──────────
const store: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};

const clipboardWrite = mock(async (_text?: string, _durationMs?: number) => true);
const playSound = mock(async () => {});
const runtimeSendMessage = mock(async (_message: unknown) => ({}));
const createNotification = mock(
  async (_id: string, _opts: { title: string; message: string }) => undefined
);

const fakeBrowser = {
  runtime: { id: 'test-extension', sendMessage: runtimeSendMessage },
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return { ...store };
        const list = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const k of list) if (k in store) out[k] = store[k];
        return out;
      },
      set: async (items: Record<string, unknown>) => Object.assign(store, items),
      remove: async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
      },
    },
    session: {
      get: async (keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return { ...sessionStore };
        const list = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const k of list) if (k in sessionStore) out[k] = sessionStore[k];
        return out;
      },
      set: async (items: Record<string, unknown>) => Object.assign(sessionStore, items),
      remove: async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete sessionStore[k];
      },
    },
  },
};

mock.module('wxt/browser', () => ({ browser: fakeBrowser }));
Object.assign(globalThis, { browser: fakeBrowser });

// Dependencies of the handler that are observable in the assertions.
mock.module('@/utils/clipboard/clipboard.js', () => ({
  copyToClipboardFromBackground: clipboardWrite,
  copyToClipboardAndSchedulePurge: clipboardWrite,
  processClipboardPurgeQueue: async () => {},
}));
mock.module('@/utils/notifications/notification-permission.js', () => ({
  createBrowserNotification: createNotification,
}));
mock.module('@/utils/notifications/notification-sound.js', () => ({
  playNotificationSoundIfEnabled: playSound,
}));

const { handleCopyLatestOtpCommand, resolveLatestOtpForCopy } = await import(
  '@/entrypoints/background/address/latest-otp-shortcut.js'
);

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  for (const k of Object.keys(sessionStore)) delete sessionStore[k];
  clipboardWrite.mockClear();
  clipboardWrite.mockImplementation(async () => true);
  playSound.mockClear();
  runtimeSendMessage.mockClear();
  runtimeSendMessage.mockImplementation(async () => ({}));
  createNotification.mockClear();
  createNotification.mockImplementation(async () => undefined);
});

describe('resolveLatestOtpForCopy', () => {
  test('regression: reads the REAL latestOtp cache from storage.local', async () => {
    store.latestOtp = { otp: '482901', sender: 'n@example.com', received_at: Date.now() };
    await expect(resolveLatestOtpForCopy()).resolves.toBe('482901');
  });

  test('refuses the untimestamped legacy session key when local cache is absent', async () => {
    sessionStore._latest_otp_code = '246810';
    await expect(resolveLatestOtpForCopy()).resolves.toBe('');
  });

  test('prefers the local cache over the legacy session key', async () => {
    store.latestOtp = { otp: '111111', received_at: Date.now() };
    sessionStore._latest_otp_code = '222222';
    await expect(resolveLatestOtpForCopy()).resolves.toBe('111111');
  });

  test('returns empty string when both caches are absent', async () => {
    await expect(resolveLatestOtpForCopy()).resolves.toBe('');
  });

  test('regression: a STALE cache (message expired/deleted since) is refused, not copied', async () => {
    // Expiry-archiving, deletion and archived-cap eviction never clear the
    // latestOtp key - without the age guard the shortcut kept serving codes
    // whose message no longer exists.
    store.latestOtp = { otp: '111111', received_at: Date.now() - 11 * 60 * 1000 };
    await expect(resolveLatestOtpForCopy()).resolves.toBe('');
    // Self-heal: the stale key is removed so later presses fall through.
    expect(store.latestOtp).toBeUndefined();
  });

  test('a stale local cache cannot fall through to an untimestamped session value', async () => {
    store.latestOtp = { otp: '111111', received_at: Date.now() - 11 * 60 * 1000 };
    sessionStore._latest_otp_code = '222222';
    await expect(resolveLatestOtpForCopy()).resolves.toBe('');
  });

  test('a record without received_at is treated as stale (cannot prove freshness)', async () => {
    store.latestOtp = { otp: '111111' };
    await expect(resolveLatestOtpForCopy()).resolves.toBe('');
  });

  test('a slightly-future received_at (clock skew) is still copied', async () => {
    store.latestOtp = { otp: '111111', received_at: Date.now() + 60_000 };
    await expect(resolveLatestOtpForCopy()).resolves.toBe('111111');
  });

  test('refuses a fresh code addressed to a different active inbox', async () => {
    store.activeAddressId = 'active';
    store.addresses = [
      { id: 'active', address: 'active@example.com' },
      { id: 'other', address: 'other@example.com' },
    ];
    store.latestOtp = {
      otp: '111111',
      recipient: 'other@example.com',
      received_at: Date.now(),
    };
    await expect(resolveLatestOtpForCopy()).resolves.toBe('');
    expect(store.latestOtp).toBeDefined();
  });

  test('copies a fresh code addressed to the active inbox case-insensitively', async () => {
    store.activeAddressId = 'active';
    store.addresses = [{ id: 'active', address: 'active@example.com' }];
    store.latestOtp = {
      otp: '222222',
      recipient: 'ACTIVE@example.com',
      received_at: Date.now(),
    };
    await expect(resolveLatestOtpForCopy()).resolves.toBe('222222');
  });
});

describe('handleCopyLatestOtpCommand', () => {
  test('copies the cached code and reports otpCopied to the open extension UI', async () => {
    store.latestOtp = { otp: '135790', received_at: Date.now() };
    await handleCopyLatestOtpCommand();

    // No override: the clipboard helper must resolve the user's privacy delay.
    expect(clipboardWrite).toHaveBeenCalledWith('135790');
    expect(runtimeSendMessage).toHaveBeenCalledWith({ type: 'otpCopied', ok: true });
    expect(playSound).toHaveBeenCalledTimes(1);
    expect(createNotification).not.toHaveBeenCalled();
  });

  test('regression: empty cache is a silent no-op (the original bug made this always happen)', async () => {
    await handleCopyLatestOtpCommand();

    expect(clipboardWrite).not.toHaveBeenCalled();
    expect(runtimeSendMessage).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  test('regression: a stale cache is a silent no-op - the code must NOT reach the clipboard', async () => {
    store.latestOtp = { otp: '135790', received_at: Date.now() - 11 * 60 * 1000 };
    await handleCopyLatestOtpCommand();

    expect(clipboardWrite).not.toHaveBeenCalled();
    expect(runtimeSendMessage).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  test('falls back to a value-free desktop notification when no extension page is open', async () => {
    store.latestOtp = { otp: '654321', received_at: Date.now() };
    runtimeSendMessage.mockImplementation(async () => {
      throw new Error('Receiving end does not exist');
    });

    await handleCopyLatestOtpCommand();

    expect(clipboardWrite).toHaveBeenCalledWith('654321');
    expect(createNotification).toHaveBeenCalledTimes(1);
    // The OTP itself must never be embedded in the notification (shoulder-surfing).
    // tSync resolves the en-locale strings in the test environment.
    const [_id, opts] = createNotification.mock.calls[0] as unknown as [
      string,
      { title: string; message: string },
    ];
    expect(opts.title).toBe('OTP Copied');
    expect(JSON.stringify(opts)).not.toContain('654321');
  });

  test('notifies failure (without the code) when the clipboard write fails', async () => {
    store.latestOtp = { otp: '987654', received_at: Date.now() };
    clipboardWrite.mockImplementation(async () => false);
    runtimeSendMessage.mockImplementation(async () => {
      throw new Error('Receiving end does not exist');
    });

    await handleCopyLatestOtpCommand();

    expect(createNotification).toHaveBeenCalledTimes(1);
    const [_id, opts] = createNotification.mock.calls[0] as unknown as [
      string,
      { title: string; message: string },
    ];
    expect(opts.title).toBe('Failed to Copy OTP');
    expect(playSound).not.toHaveBeenCalled();
    expect(JSON.stringify(opts)).not.toContain('987654');
  });
});
