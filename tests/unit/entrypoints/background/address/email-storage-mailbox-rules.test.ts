import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { Address, Email } from '@/utils/types.js';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// ── Mocks registered BEFORE the dynamic import of email-storage.js ──────────
const store: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};
const sentMessages: Record<string, unknown>[] = [];
let notificationCalls = 0;

const fakeBrowser = {
  runtime: {
    id: 'test-extension',
    sendMessage: async (msg: Record<string, unknown>) => {
      sentMessages.push(msg);
      return {};
    },
  },
  tabs: {
    query: async () => [{ id: 1 }],
    sendMessage: async (_tabId: number, msg: Record<string, unknown>) => {
      sentMessages.push(msg);
    },
  },
  notifications: {
    create: async () => {
      notificationCalls += 1;
      return `notif_${notificationCalls}`;
    },
  },
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return { ...store };
        const arr = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const k of arr) if (k in store) out[k] = store[k];
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

const { storeNewMessages } = await import('@/entrypoints/background/address/email-storage.js');

function email(id: string, opts: Partial<Email> = {}): Email {
  return {
    id,
    from: 'noreply@github.com',
    from_name: 'GitHub',
    subject: `Subject ${id}`,
    body_plain: `Body ${id}`,
    received_at: Math.floor(Date.now() / 1000),
    stored_at: Date.now(),
    ...opts,
  };
}

function seedAddress(): void {
  store.addresses = [
    {
      id: 'inbox-1',
      address: 'foo@bar.com',
      provider: 'guerrilla',
      accountStatus: 'active',
      status: 'active',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    },
  ] as unknown as Address[];
  store.notificationSettings = { enabled: true, soundEnabled: false };
}

beforeEach(() => {
  sentMessages.length = 0;
  notificationCalls = 0;
  for (const k of Object.keys(store)) delete store[k];
  seedAddress();
});

describe('inbox rules hook in processNewMessages', () => {
  test('a silence rule suppresses the OS notification but still delivers the OTP', async () => {
    store.mailboxRules = [
      {
        id: 'r1',
        name: 'github',
        enabled: true,
        field: 'sender',
        contains: 'github',
        tag: undefined,
        autoArchiveDays: null,
        silenceNotifications: true,
        createdAt: 0,
        updatedAt: 0,
      },
    ];

    await storeNewMessages('foo@bar.com', [
      email('n1', { otp: '123456', body_plain: 'Your verification code: 123456' }),
    ]);

    // Silenced: no OS notification...
    expect(notificationCalls).toBe(0);
    // ...but the verification code is never silenced.
    const otpBroadcasts = sentMessages.filter((m) => m.type === 'fillOTP');
    expect(otpBroadcasts).toHaveLength(1);
    expect(otpBroadcasts[0].otp).toBe('123456');
  });

  test('non-matching senders still notify', async () => {
    store.mailboxRules = [
      {
        id: 'r1',
        name: 'github',
        enabled: true,
        field: 'sender',
        contains: 'github',
        tag: undefined,
        autoArchiveDays: null,
        silenceNotifications: true,
        createdAt: 0,
        updatedAt: 0,
      },
    ];

    await storeNewMessages('foo@bar.com', [
      email('n1', { from: 'billing@stripe.com', from_name: 'Stripe' }),
    ]);

    expect(notificationCalls).toBe(1);
  });

  test('a label rule writes into the emailLabels map for the new message', async () => {
    store.mailboxRules = [
      {
        id: 'r1',
        name: 'receipts',
        enabled: true,
        field: 'sender',
        contains: 'billing',
        label: 'receipts',
        autoArchiveDays: null,
        silenceNotifications: false,
        createdAt: 0,
        updatedAt: 0,
      },
    ];

    await storeNewMessages('foo@bar.com', [
      email('n1', { from: 'billing@stripe.com', from_name: 'Stripe' }),
    ]);

    const labels = store.emailLabels as Record<string, string[]>;
    expect(labels['foo@bar.com_n1']).toEqual(['receipts']);
    // The silenced-by-default GitHub sender is NOT labeled by the billing rule.
    await storeNewMessages('foo@bar.com', [email('n2')]);
    expect((store.emailLabels as Record<string, string[]>)['foo@bar.com_n2']).toBeUndefined();
  });

  test('an archive rule schedules the mailbox through the shared archive schedule', async () => {
    store.mailboxRules = [
      {
        id: 'r1',
        name: 'promo',
        enabled: true,
        field: 'subject',
        contains: 'promo',
        tag: undefined,
        autoArchiveDays: 7,
        silenceNotifications: false,
        createdAt: 0,
        updatedAt: 0,
      },
    ];

    await storeNewMessages('foo@bar.com', [email('n1', { subject: 'Your promo code inside' })]);

    const schedule = store.siteRuleArchiveSchedule as Record<
      string,
      { archiveAt: number; ruleId: string; domain: string }
    >;
    expect(schedule['inbox-1']).toBeDefined();
    expect(schedule['inbox-1'].ruleId).toBe('r1');
    expect(schedule['inbox-1'].domain).toBe('foo@bar.com');
  });
});
