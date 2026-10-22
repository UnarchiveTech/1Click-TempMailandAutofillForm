import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { Email } from '@/utils/types.js';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// ── Mocks registered BEFORE the dynamic import of the detector ──────────────
// The purge path reads/writes mailbox bags through storage-keys (getStoredEmailsMap /
// getEmailMaps / setLogicalEmailMaps), which use the bare `browser` from
// 'wxt/browser' - not the browserExt parameter (that is only used for the
// automationRules read). Provide the in-memory fake on BOTH channels so the
// fixture lands where the sweep looks for it.
const store: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};

const fakeBrowser = {
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
Object.assign(globalThis, { browser: fakeBrowser });

const { isEmailOlderThan24Hours, isPromotionalEmail, purgePromotionalEmailsOlderThan24Hours } =
  await import('@/features/address/promotional-email-detector.js');

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

describe('promotional-email-detector', () => {
  describe('isPromotionalEmail', () => {
    test('identifies promotional emails by subject keyword', () => {
      const email: Email = {
        id: 'msg-1',
        from: 'store@example.com',
        subject: '50% off your next purchase! Limited time deal',
        body: 'Check out our deals today.',
        received_at: 1700000000,
      };
      expect(isPromotionalEmail(email)).toBe(true);
    });

    test('identifies promotional emails by sender domain/prefix', () => {
      const email: Email = {
        id: 'msg-2',
        from: 'newsletter@company.org',
        subject: 'Your weekly update',
        body: 'Here is what happened this week.',
        received_at: 1700000000,
      };
      expect(isPromotionalEmail(email)).toBe(true);
    });

    test('identifies promotional emails by multiple unsubscribe body signals', () => {
      const email: Email = {
        id: 'msg-3',
        from: 'hello@brand.io',
        subject: 'A message from our CEO',
        body: 'Thank you for following us. Click here to unsubscribe or manage your preferences.',
        received_at: 1700000000,
      };
      expect(isPromotionalEmail(email)).toBe(true);
    });

    test('does NOT classify transactional email from a lone unsubscribe footer', () => {
      // GitHub PR notifications, Stripe invoices, Jira updates and AWS alerts
      // all carry a CAN-SPAM/GDPR unsubscribe footer - one such signal must
      // never be enough to auto-delete them after 24h.
      const email: Email = {
        id: 'msg-tx-1',
        from: 'notifications@github.example.com',
        subject: '[repo] PR #123: Fix flaky test',
        body: 'Merged by alice. You are receiving this because you are subscribed to this thread. Unsubscribe.',
        received_at: 1700000000,
      };
      expect(isPromotionalEmail(email)).toBe(false);
    });

    test('does NOT classify transactional email from a lone preferences footer', () => {
      const email: Email = {
        id: 'msg-tx-2',
        from: 'invoices@stripe.example.com',
        subject: 'Your invoice from Example SaaS',
        body: 'Thanks for your business. You can manage your email preferences at any time.',
        received_at: 1700000000,
      };
      expect(isPromotionalEmail(email)).toBe(false);
    });

    test('requires multiple body signals when subject and sender are neutral', () => {
      // Exactly one compliance footer - not promotional.
      const email: Email = {
        id: 'msg-6',
        from: 'hello@brand.io',
        subject: 'A message from our CEO',
        body: 'Thanks for being a customer. You can unsubscribe at any time.',
        received_at: 1700000000,
      };
      expect(isPromotionalEmail(email)).toBe(false);

      // Multiple independent marketing signals - promotional.
      const email2: Email = {
        id: 'msg-7',
        from: 'hello@brand.io',
        subject: 'A message from our CEO',
        body: 'Thanks for being a customer. Unsubscribe, opt out, or view in browser anytime.',
        received_at: 1700000000,
      };
      expect(isPromotionalEmail(email2)).toBe(true);
    });

    test('protects emails with OTP codes from being classified as promotional', () => {
      const email: Email = {
        id: 'msg-4',
        from: 'security@service.com',
        subject: 'Your 50% verification code is 123456',
        body: 'Your verification code is 123456. Do not share it.',
        otp: '123456',
        received_at: 1700000000,
      };
      expect(isPromotionalEmail(email)).toBe(false);
    });

    test('protects transactional/security subjects from being classified as promotional', () => {
      const email: Email = {
        id: 'msg-5',
        from: 'auth@auth0.com',
        subject: 'Verify your email address to continue',
        body: 'Click the button below to confirm your account.',
        received_at: 1700000000,
      };
      expect(isPromotionalEmail(email)).toBe(false);
    });
  });

  describe('isEmailOlderThan24Hours', () => {
    const now = 1700000000000;
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

    test('returns true if email timestamp is older than 24 hours', () => {
      const email: Email = {
        id: 'msg-old',
        received_at: Math.floor((now - (TWENTY_FOUR_HOURS + 1000)) / 1000),
      };
      expect(isEmailOlderThan24Hours(email, now)).toBe(true);
    });

    test('returns false if email is newer than 24 hours', () => {
      const email: Email = {
        id: 'msg-new',
        received_at: Math.floor((now - (TWENTY_FOUR_HOURS - 1000)) / 1000),
      };
      expect(isEmailOlderThan24Hours(email, now)).toBe(false);
    });
  });

  describe('purgePromotionalEmailsOlderThan24Hours', () => {
    test('purges only promotional emails older than 24 hours when rule is enabled', async () => {
      const now = 1700000000000;
      const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
      const { storedEmailsByAddressKey } = await import('@/utils/storage/storage-keys.js');
      const BAG_KEY = storedEmailsByAddressKey('test-1');

      store.addresses = [{ id: 'test-1', address: 'test@temp.com' }];
      store.emailStorageAddressIndex = { 'test-1': 'test@temp.com' };
      store.automationRules = { autoDeletePromo24h: true };
      store[BAG_KEY] = [
        {
          id: 'promo-old',
          from: 'deals@shop.com',
          subject: 'Huge discount today!',
          body: 'Unsubscribe here',
          received_at: Math.floor((now - (TWENTY_FOUR_HOURS + 5000)) / 1000),
        },
        {
          id: 'promo-new',
          from: 'deals@shop.com',
          subject: 'Huge discount today!',
          body: 'Unsubscribe here',
          received_at: Math.floor((now - 1000) / 1000),
        },
        {
          id: 'otp-old',
          from: 'auth@bank.com',
          subject: 'Your verification code',
          body: 'Code: 987654',
          otp: '987654',
          received_at: Math.floor((now - (TWENTY_FOUR_HOURS + 5000)) / 1000),
        },
      ];

      const purged = await purgePromotionalEmailsOlderThan24Hours(fakeBrowser as never, now);
      expect(purged).toBe(1);

      const remaining = store[BAG_KEY] as Email[];
      expect(remaining.length).toBe(2);
      expect(remaining.map((m) => m.id)).toEqual(['promo-new', 'otp-old']);
    });

    test('does nothing when autoDeletePromo24h is false', async () => {
      store.addresses = [{ id: 'test-1', address: 'test@temp.com' }];
      store.emailStorageAddressIndex = { 'test-1': 'test@temp.com' };
      store.automationRules = { autoDeletePromo24h: false };
      const { storedEmailsByAddressKey } = await import('@/utils/storage/storage-keys.js');
      store[storedEmailsByAddressKey('test-1')] = [
        {
          id: 'promo-old',
          from: 'deals@shop.com',
          subject: 'Huge discount today!',
          body: 'Unsubscribe here',
          received_at: 1000,
        },
      ];

      const purged = await purgePromotionalEmailsOlderThan24Hours(fakeBrowser as never, Date.now());
      expect(purged).toBe(0);
    });
  });
});
