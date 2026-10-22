/**
 * Demo mode must put `received_at` on the `latestOtp` record it writes.
 *
 * The copy-latest-OTP shortcut refuses a cache it cannot prove fresh
 * (`resolveLatestOtpForCopy`'s age guard), and it CLEARS the key while refusing
 * - so a record with no timestamp is not merely unreadable, it wipes the OTP
 * the playground is showing. Every background writer (email-storage's M5 step
 * and its rescan, address-manager's post-deletion recompute) sets the field;
 * demo mode writes the key twice - once at entry, once per simulated delivery -
 * and set neither.
 *
 * The two modules are driven TOGETHER here on purpose: the bug lived in the
 * seam (two writers agreeing on one storage shape), so pinning the shape on
 * either side alone would have kept passing. Both demo writes are covered - a
 * simulated delivery is exercised directly rather than by waiting on the 2s
 * timer `enterDemoMode` arms, which the helper below keeps from ever firing so
 * the test cannot leak a callback into a later test file.
 *
 * Freshness is asserted through `isOtpCacheFresh` - the SHARED predicate three
 * consumers now read the cache with (the copy-latest-OTP shortcut and the two
 * WebMCP OTP tools), not a restatement of its rule - and then end-to-end through
 * the shortcut's real resolver, so the demo record is proven acceptable to every
 * reader of the key.
 */

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});

// ── In-memory browser mock (the shape demo-mode + storage-keys need) ─────────
const store: Record<string, unknown> = {};

const fakeBrowser = {
  runtime: { id: 'test-extension', sendMessage: async (_message: unknown) => ({}) },
  // No `tabs.create`: the demo signup showcase is non-fatal and returns early
  // without it, so entering demo never opens real pages under test.
  tabs: {},
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
  },
};

mock.module('wxt/browser', () => ({ browser: fakeBrowser }));
Object.assign(globalThis, { browser: fakeBrowser });

mock.module('@/utils/clipboard/clipboard.js', () => ({
  copyToClipboardFromBackground: async () => true,
  copyToClipboardAndSchedulePurge: async () => true,
  processClipboardPurgeQueue: async () => {},
}));
mock.module('@/utils/notifications/notification-permission.js', () => ({
  createBrowserNotification: async () => undefined,
  getNotificationPermissionStatus: async () => 'granted',
  openNotificationSettingsPage: async () => true,
}));
mock.module('@/utils/notifications/notification-sound.js', () => ({
  playNotificationSoundIfEnabled: async () => {},
  playNotificationSound: async () => {},
}));

const { enterDemoMode, simulateDemoReceive } = await import('@/features/demo/demo-mode.js');
const { resolveLatestOtpForCopy } = await import(
  '@/entrypoints/background/address/latest-otp-shortcut.js'
);
const { isOtpCacheFresh } = await import('@/utils/otp/otp-cache.js');

/** 10 minutes - the shortcut's own freshness window, restated as a bound. */
const FRESH_WINDOW_MS = 10 * 60 * 1000;

/**
 * Enter demo mode while intercepting the 2s simulated-delivery timer
 * `enterDemoMode` arms. The callback is captured and never invoked, so the
 * test asserts the SEEDED record (the delivery is exercised explicitly below).
 */
let scheduledDemoReceive: (() => void) | null = null;
async function enterDemoWithoutTimer(): Promise<void> {
  const realSetTimeout = globalThis.setTimeout;
  let captured: (() => void) | null = null;
  globalThis.setTimeout = ((handler: () => void, timeout?: number, ...args: unknown[]) => {
    if (timeout === 2000) {
      captured = () => handler(...(args as []));
      // A real, immediately-cancellable id - never a fired callback.
      return realSetTimeout(() => {}, 0);
    }
    return realSetTimeout(handler, timeout);
  }) as unknown as typeof globalThis.setTimeout;
  try {
    await enterDemoMode(fakeBrowser as unknown as Browser);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
  scheduledDemoReceive = captured;
}

type LatestOtpRecord = { otp?: string; sender?: string; received_at?: number; recipient?: string };
const recordedOtp = (): LatestOtpRecord | undefined =>
  store.latestOtp as LatestOtpRecord | undefined;

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  scheduledDemoReceive = null;
});

describe('demo mode writes a latestOtp the shortcut can prove fresh', () => {
  test('entering demo seeds received_at from the demo message, and the shortcut copies it', async () => {
    await enterDemoWithoutTimer();

    const seeded = recordedOtp();
    const seededOtp = seeded?.otp ?? '';
    expect(seededOtp).not.toBe('');
    expect(typeof seeded?.received_at).toBe('number');
    // The demo message's OWN age (~2 min), not `Date.now()` - a timestamp that
    // merely looked fresh would satisfy the guard without describing the mail.
    const age = Date.now() - (seeded?.received_at ?? 0);
    expect(age).toBeGreaterThan(60_000);
    expect(age).toBeLessThan(FRESH_WINDOW_MS);
    // The shared predicate every cache consumer reads it with.
    expect(isOtpCacheFresh(seeded)).toBe(true);
    expect(store.selectedEmail).toBe(seeded?.recipient);

    // The real integration: the guard accepts the record and copies the code.
    await expect(resolveLatestOtpForCopy()).resolves.toBe(seededOtp);
    // …and the refusal path (which removes the key) did NOT run.
    expect(recordedOtp()?.otp ?? '').toBe(seededOtp);

    // The simulated delivery is still armed by entry - the seed is not the only
    // chance the playground gets at a fresh code.
    expect(scheduledDemoReceive).not.toBeNull();
  });

  test('a simulated delivery stamps the record with the delivered message time', async () => {
    await enterDemoWithoutTimer();
    const seededOtp = recordedOtp()?.otp;
    // Walk to a sender whose code differs from the seeded one, so a record left
    // behind by entry cannot satisfy the assertions below.
    store.demoReceiveIndex = 5;

    const result = await simulateDemoReceive(fakeBrowser as unknown as Browser);
    const deliveredOtp = result?.mail.otp ?? '';
    expect(deliveredOtp).not.toBe('');
    expect(deliveredOtp).not.toBe(seededOtp);

    const delivered = recordedOtp();
    expect(delivered?.otp ?? '').toBe(deliveredOtp);
    expect(delivered?.received_at ?? 0).toBe(result?.mail.received_at ?? 0);
    // Fresh by construction: this mail was just created.
    expect(Date.now() - (delivered?.received_at ?? 0)).toBeLessThan(5_000);
    expect(isOtpCacheFresh(delivered)).toBe(true);
    expect(store.selectedEmail).toBe(delivered?.recipient);

    await expect(resolveLatestOtpForCopy()).resolves.toBe(deliveredOtp);
  });

  test('a fresh demo code cannot be copied for a different active inbox', async () => {
    await enterDemoWithoutTimer();
    const seeded = recordedOtp();
    const addresses = store.addresses as Array<{ id: string; address: string }>;
    const other = addresses.find((address) => address.address !== seeded?.recipient);
    expect(other).toBeDefined();
    store.activeAddressId = other?.id;

    await expect(resolveLatestOtpForCopy()).resolves.toBe('');
    expect(recordedOtp()).toEqual(seeded);
  });

  test('the guard still refuses a demo record that has no timestamp (the pre-fix shape)', async () => {
    await enterDemoWithoutTimer();
    // Restore the exact shape demo mode used to write.
    const preFixShape = { otp: '482901', sender: 'security@github.com', context: 'seed' };
    store.latestOtp = preFixShape;

    expect(isOtpCacheFresh(preFixShape)).toBe(false);
    await expect(resolveLatestOtpForCopy()).resolves.toBe('');
    expect(recordedOtp()).toBeUndefined();
  });
});
