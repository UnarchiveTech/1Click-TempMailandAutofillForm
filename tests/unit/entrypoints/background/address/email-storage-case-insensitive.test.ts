import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { Address, Email } from '@/utils/types.js';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// ── Mocks registered BEFORE the dynamic import of email-storage.js ──────────
// In-memory storage + counters for notifications and runtime messages. The
// scenario under test is a *casing drift*: bags/seen sets stored under
// `Foo@Bar.com` while the caller passes `foo@bar.com` (or vice versa). Email
// addresses are case-insensitive for these providers, so every lookup must
// resolve case-insensitively or mail silently stops notifying / broadcasting.

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

const { filterMessages, rescanStoredEmails, storeNewMessages } = await import(
  '@/entrypoints/background/address/email-storage.js'
);
const { storedEmailsByAddressKey } = await import('@/utils/storage/storage-keys.js');

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
      address: 'Foo@Bar.com',
      provider: 'guerrilla',
      createdAt: 1,
      expiresAt: 0,
      accountStatus: 'active',
      status: 'active',
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

describe('case-insensitive address matching under a casing drift', () => {
  test('filtering never fabricates or refreshes an email storage timestamp', () => {
    const legacy = email('legacy');
    delete legacy.stored_at;
    const stamped = email('stamped', { stored_at: 1234 });
    const zero = email('zero', { stored_at: 0 });
    const output = filterMessages([legacy, stamped, zero]);
    expect(output[0].stored_at).toBeUndefined();
    expect(output[1].stored_at).toBe(1234);
    expect(output[2].stored_at).toBe(0);
    expect(output[0]).not.toBe(legacy);
    expect(legacy.stored_at).toBeUndefined();
  });

  test('processNewMessages still notifies and broadcasts the OTP when the casing differs', async () => {
    // The account record says `Foo@Bar.com`; the fetch path delivers under the
    // lower-cased `foo@bar.com`. Pre-fix the exact-match `addresses.find` missed,
    // so no notification, no activity, and no OTP broadcast fired.
    await storeNewMessages('foo@bar.com', [
      email('n1', { otp: '123456', body_plain: 'Your verification code: 123456' }),
    ]);

    expect(notificationCalls).toBe(1); // OS notification fired
    const otpBroadcasts = sentMessages.filter((m) => m.type === 'fillOTP');
    expect(otpBroadcasts).toHaveLength(1);
    expect(otpBroadcasts[0].otp).toBe('123456');
    expect(otpBroadcasts[0].recipient).toBe('foo@bar.com');

    // Activity recorded against the account's canonical casing.
    const events = store.activityEvents as {
      type: string;
      data: { address?: string };
    }[];
    const received = events.filter((e) => e.type === 'email_received');
    expect(received).toHaveLength(1);
    expect(received[0].data.address).toBe('Foo@Bar.com');
  });

  test('storeNewMessages writes into the existing bag instead of splitting it', async () => {
    // The mailbox's ID-keyed bag + seen set were written under the account's
    // canonical casing `Foo@Bar.com`; the caller passes `foo@bar.com`. Dedup
    // must still see the existing IDs and the write must land in the SAME
    // stable ID-keyed bag - a split bag would re-notify old mail and empty
    // the view.
    store.emailStorageAddressIndex = { 'inbox-1': 'Foo@Bar.com' };
    store[storedEmailsByAddressKey('inbox-1')] = [email('old-1')];
    store.seenEmailIds = { 'Foo@Bar.com': ['old-1'] };

    await storeNewMessages('foo@bar.com', [email('old-1'), email('new-1', { otp: '654321' })]);

    // One canonical ID-keyed bag (the address-keyed aggregate no longer exists).
    const stored = store[storedEmailsByAddressKey('inbox-1')] as Email[];
    // Old-1 kept (not duplicated), new-1 appended - same-second timestamps keep
    // insertion order, so compare as sorted ids.
    expect(stored?.map((e) => e.id).sort()).toEqual(['new-1', 'old-1']);

    const seen = store.seenEmailIds as Record<string, string[]>;
    expect(Object.keys(seen)).toEqual(['Foo@Bar.com']);
    expect(seen['Foo@Bar.com']).toEqual(['old-1', 'new-1']);

    expect(notificationCalls).toBe(1); // only new-1 notified
    expect((store.analytics as { emailsReceived: number }).emailsReceived).toBe(1);
  });

  test('rescanStoredEmails covers a bag stored under a differently-cased key', async () => {
    store.emailStorageAddressIndex = { 'inbox-1': 'Foo@Bar.com' };
    store[storedEmailsByAddressKey('inbox-1')] = [
      email('e-otp', {
        from: 'noreply@github.com',
        subject: 'Your GitHub code is 482901',
        body_plain: 'Your GitHub code is 482901',
      }),
    ];

    const result = await rescanStoredEmails('foo@bar.com');

    expect(result.scanned).toBe(1);
    expect(result.otpsDetected).toBe(1);
    const stored = store[storedEmailsByAddressKey('inbox-1')] as Email[];
    expect(stored[0].otp).toBe('482901');
  });
});
