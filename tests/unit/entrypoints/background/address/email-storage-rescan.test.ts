import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { Email } from '@/utils/types.js';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// ── Mocks registered BEFORE the dynamic import of email-storage.js ──────────
// rescanStoredEmails reads/writes browser.storage.local and goes through
// storage-keys + storageMonitor. Those boundaries are stubbed with an
// in-memory store; the detection engines (algorithm + batched AI) are real.

const store: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};

const fakeBrowser = {
  runtime: { id: 'test-extension', sendMessage: async () => ({}) },
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

// storage-keys.ts reads the bare GLOBAL `browser` that WXT installs at runtime
// rather than importing it - provide it here too, so the real modules (and the
// real safeStorageSet quota guards, which fail soft) work against the fake.
Object.assign(globalThis, { browser: fakeBrowser });

const { clearAllOtps, rescanStoredEmails } = await import(
  '@/entrypoints/background/address/email-storage.js'
);
const { archivedEmailsByAddressKey, storedEmailsByAddressKey } = await import(
  '@/utils/storage/storage-keys.js'
);

// ── Fixtures ─────────────────────────────────────────────────────────────────

const NOW_SEC = Math.floor(Date.now() / 1000);

/** Register an address record + index entry and store its ID-keyed bag. */
function seedMailbox(
  address: string,
  emails: Email[],
  id = `inbox-${address.split('@')[0]}`
): void {
  const addresses = ((store.addresses as Array<{ id: string; address: string }>) || []).slice();
  addresses.push({ id, address });
  store.addresses = addresses;
  const index = (store.emailStorageAddressIndex as Record<string, string>) || {};
  index[id] = address;
  store.emailStorageAddressIndex = index;
  store[storedEmailsByAddressKey(id)] = emails;
}

function seedEmail(overrides: Partial<Email>): Email {
  return {
    id: 'e1',
    from: 'no-reply@example.com',
    from_name: 'Example',
    subject: '',
    body_plain: '',
    received_at: NOW_SEC - 120,
    stored_at: Date.now(),
    ...overrides,
  };
}

// Factories (not shared instances): rescanStoredEmails mutates the stored email
// objects in place, so each test needs a fresh bag to start from.
function otpEmail(): Email {
  return seedEmail({
    id: 'e-otp',
    from: 'noreply@github.com',
    from_name: 'GitHub',
    subject: 'Your GitHub code is 482901',
    body_plain: 'Your GitHub code is 482901',
  });
}

function magicEmail(): Email {
  return seedEmail({
    id: 'e-magic',
    from: 'noreply@figma.com',
    from_name: 'Figma',
    subject: 'Magic link to sign in',
    body_html: '<a href="https://figma.com/login?token=abcdefghijklmnopqrst">Sign in</a>',
    received_at: NOW_SEC - 60,
  });
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

describe('rescanStoredEmails', () => {
  test('rescan separates a legacy possible code and coupon, and clears an unsupported latest cache', async () => {
    seedMailbox('a@example.com', [
      seedEmail({ id: 'possible', subject: 'Unlabelled', body_plain: '654321', otp: '654321' }),
      seedEmail({
        id: 'coupon',
        subject: 'Reminder',
        body_plain: 'Coupon code: SAVE20',
        otp: 'SAVE20',
      }),
    ]);
    store.latestOtp = { otp: '654321', recipient: 'a@example.com', received_at: NOW_SEC - 120 };
    await rescanStoredEmails();
    const bag = store[storedEmailsByAddressKey('inbox-a')] as Email[];
    expect(bag[0]).toMatchObject({ otp: null, otpCandidate: '654321', isOtp: false });
    expect(bag[1]).toMatchObject({
      otp: null,
      otpCandidate: null,
      couponCode: 'SAVE20',
      isReminder: true,
    });
    expect(store.latestOtp).toBeUndefined();
    await clearAllOtps();
    const cleared = store[storedEmailsByAddressKey('inbox-a')] as Email[];
    expect(cleared[0].otpCandidate).toBeNull();
    expect(cleared[1].couponCode).toBe('SAVE20');
    expect(cleared[1].isReminder).toBe(true);
  });
  test('explicit archive scans preserve bag ownership and clear invalid archived detections', async () => {
    seedMailbox('a@example.com', [otpEmail()]);
    store[archivedEmailsByAddressKey('inbox-a')] = [
      seedEmail({
        id: 'archived-news',
        subject: 'Demand up 11%',
        body_plain: 'Shopping offers',
        otp: 'up11',
        isOtp: true,
      }),
    ];
    const result = await rescanStoredEmails(undefined, true);
    expect(result.scanned).toBe(2);
    expect((store[storedEmailsByAddressKey('inbox-a')] as Email[])[0].otp).toBe('482901');
    const archived = store[archivedEmailsByAddressKey('inbox-a')] as Email[];
    expect(archived).toHaveLength(1);
    expect(archived[0].id).toBe('archived-news');
    expect(archived[0].otp).toBeNull();
    expect(archived[0].isOtp).toBe(false);
  });
  test('removes cached marketing links that no longer pass detection', async () => {
    seedMailbox('a@example.com', [
      seedEmail({
        subject: 'Latest discounts',
        body_html:
          '<a href="https://shop.example.com/products/magic-rgb-projector">Magic RGB lamp Shop Now</a>',
        hasMagicLink: true,
        magicLinks: [
          {
            url: 'https://shop.example.com/products/magic-rgb-projector',
            score: 7,
          },
        ],
      }),
    ]);
    await rescanStoredEmails();
    const bag = store[storedEmailsByAddressKey('inbox-a')] as Email[];
    expect(bag[0].magicLinks).toEqual([]);
    expect(bag[0].hasMagicLink).toBe(false);
  });
  test('detects OTP + magic links on stored emails that lack them', async () => {
    seedMailbox('a@test.com', [otpEmail(), magicEmail()]);

    const summary = await rescanStoredEmails();

    expect(summary).toEqual({ scanned: 2, otpsDetected: 1, magicLinksDetected: 1 });

    const bag = store[storedEmailsByAddressKey('inbox-a')] as Email[];
    expect(bag[0].otp).toBe('482901');
    expect(bag[0].isOtp).toBe(true);
    expect(bag[1].magicLinks?.[0]?.url).toContain('figma.com');
    expect(bag[1].hasMagicLink).toBe(true);
  });

  test('refreshes the cached latestOtp with the newest found code', async () => {
    seedMailbox('a@test.com', [otpEmail(), magicEmail()]);

    await rescanStoredEmails();

    const { latestOtp } = store as { latestOtp?: { otp?: string; recipient?: string } };
    expect(latestOtp?.otp).toBe('482901');
    expect(latestOtp?.recipient).toBe('a@test.com');
  });

  test('clears a stale OTP and latestOtp cache when a rescan no longer detects it', async () => {
    const stale = seedEmail({
      id: 'stale-otp',
      subject: 'Your order has shipped',
      body_plain: 'Your order has shipped.',
      otp: '482901',
      isOtp: true,
    });
    seedMailbox('a@test.com', [stale]);
    store.latestOtp = {
      otp: '482901',
      recipient: 'a@test.com',
      received_at: stale.received_at,
    };

    const summary = await rescanStoredEmails();

    expect(summary).toEqual({ scanned: 1, otpsDetected: 0, magicLinksDetected: 0 });
    const bag = store[storedEmailsByAddressKey('inbox-a')] as Email[];
    expect(bag[0].otp).toBeNull();
    expect(bag[0].isOtp).toBe(false);
    expect(store.latestOtp).toBeUndefined();
  });

  test('respects the address filter', async () => {
    seedMailbox('a@test.com', [otpEmail()]);
    seedMailbox('b@test.com', [
      seedEmail({
        id: 'other',
        subject: 'Your code is 111111',
        body_plain: 'Your code is 111111',
      }),
    ]);

    const summary = await rescanStoredEmails('a@test.com');

    expect(summary).toEqual({ scanned: 1, otpsDetected: 1, magicLinksDetected: 0 });
    const otherBag = store[storedEmailsByAddressKey('inbox-b')] as Email[];
    expect(otherBag[0].otp).toBeUndefined();
  });

  test('reports zero changes when emails already carry detections', async () => {
    seedMailbox('a@test.com', [{ ...otpEmail(), otp: '482901', isOtp: true }]);

    const summary = await rescanStoredEmails();

    expect(summary).toEqual({ scanned: 1, otpsDetected: 0, magicLinksDetected: 0 });
  });

  test('scans every inbox when no address is given', async () => {
    seedMailbox('a@test.com', [otpEmail()]);
    seedMailbox('b@test.com', [
      seedEmail({ id: 'other', subject: 'PIN: 7777', body_plain: 'PIN: 7777' }),
    ]);

    const summary = await rescanStoredEmails();

    expect(summary).toEqual({ scanned: 2, otpsDetected: 2, magicLinksDetected: 0 });
  });
});
