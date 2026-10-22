import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { Address, Email } from '@/utils/types.js';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// ── Mocks registered BEFORE the dynamic import of email-storage.js ──────────
// Only wxt/browser is module-mocked (in-memory storage + counters for
// notifications and runtime messages). Detection is irrelevant here - these
// tests exercise the seen-email dedup in storeNewMessages, so the emails
// arrive with otp already set (as they do after the fetch-path detection).

const store: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};
const sentMessages: Record<string, unknown>[] = [];
const storageSetCalls: Record<string, unknown>[] = [];
let notificationCalls = 0;
let failedBagWritesRemaining = 0;

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
        const containsMailboxBag = Object.keys(items).some((key) =>
          key.startsWith('storedEmailsByAddress_')
        );
        if (containsMailboxBag && failedBagWritesRemaining > 0) {
          failedBagWritesRemaining -= 1;
          throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
        }
        storageSetCalls.push({ ...items });
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

const { addSeenIds, storeNewMessages } = await import(
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
      address: 'a@test.com',
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
  storageSetCalls.length = 0;
  notificationCalls = 0;
  failedBagWritesRemaining = 0;
  for (const k of Object.keys(store)) delete store[k];
  seedAddress();
});

describe('seen-email dedup in storeNewMessages', () => {
  test('evicted mail is never re-stored, re-notified, or re-broadcast', async () => {
    // Mail "evicted": not in the bag anymore (retention/cap dropped it) but the
    // durable seen set still remembers it - exactly what the provider list
    // produces after eviction. Before the fix this re-entered the pipeline.
    store.seenEmailIds = { 'a@test.com': ['old-1'] };

    const otpMsg = email('old-1', { otp: '123456' });
    await storeNewMessages('a@test.com', [otpMsg]);

    // Not re-added to the bag (nothing was ever persisted).
    expect(
      (store.storedEmails as Record<string, Email[]> | undefined)?.['a@test.com']
    ).toBeUndefined();

    // No OS notification, no OTP broadcast, no activity, no analytics.
    expect(notificationCalls).toBe(0);
    expect(sentMessages.filter((m) => m.type === 'fillOTP')).toHaveLength(0);
    const events = store.activityEvents as { type: string }[] | undefined;
    expect(
      events?.filter((e) => e.type === 'email_received' || e.type === 'otp_detected') ?? []
    ).toHaveLength(0);
    expect((store.analytics as { emailsReceived?: number } | undefined)?.emailsReceived ?? 0).toBe(
      0
    );
  });

  test('fresh mail is still stored, notified, broadcast, and recorded as seen', async () => {
    store.seenEmailIds = { 'a@test.com': ['old-1'] };

    const fresh = email('new-1', { otp: '654321', body_plain: 'Your verification code: 654321' });
    await storeNewMessages('a@test.com', [fresh]);

    const stored = store[storedEmailsByAddressKey('inbox-1')] as Email[];
    expect(stored?.map((e) => e.id)).toEqual(['new-1']);

    expect(notificationCalls).toBe(1);
    const otpBroadcasts = sentMessages.filter((m) => m.type === 'fillOTP');
    expect(otpBroadcasts).toHaveLength(1);
    expect(otpBroadcasts[0].otp).toBe('654321');

    const seen = store.seenEmailIds as Record<string, string[]>;
    expect(seen['a@test.com']).toContain('new-1');
    expect(seen['a@test.com']).toContain('old-1');

    const events = store.activityEvents as { type: string }[];
    expect(events.filter((e) => e.type === 'email_received')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'otp_detected')).toHaveLength(1);
    expect((store.analytics as { emailsReceived: number }).emailsReceived).toBe(1);

    // The bag and its seen IDs share one storage.set payload so service-worker
    // suspension cannot persist one without the other.
    const bagAndSeenWrite = storageSetCalls.find(
      (items) => storedEmailsByAddressKey('inbox-1') in items
    );
    expect(bagAndSeenWrite).toBeDefined();
    expect(bagAndSeenWrite).toHaveProperty('seenEmailIds');
  });

  test('the retention retry also writes the mailbox bag and seen IDs together', async () => {
    failedBagWritesRemaining = 1;

    await storeNewMessages('a@test.com', [email('retry-1', { otp: '654321' })]);

    const bagKey = storedEmailsByAddressKey('inbox-1');
    const retryWrite = storageSetCalls.find((items) => bagKey in items);
    expect(retryWrite).toBeDefined();
    expect(retryWrite).toHaveProperty('seenEmailIds');
    expect((store[bagKey] as Email[]).map((message) => message.id)).toEqual(['retry-1']);
    expect((store.seenEmailIds as Record<string, string[]>)['a@test.com']).toContain('retry-1');
  });

  test('unlabelled code remains manually available without OTP broadcast or cache', async () => {
    await storeNewMessages('a@test.com', [
      email('uncertain', { otp: '654321', body_plain: '654321' }),
    ]);
    const stored = store[storedEmailsByAddressKey('inbox-1')] as Email[];
    expect(stored[0]).toMatchObject({ otp: null, otpCandidate: '654321', isOtp: false });
    expect(sentMessages.filter((message) => message.type === 'fillOTP')).toHaveLength(0);
    expect(store.latestOtp).toBeUndefined();
  });

  test('coupon and reminder metadata are stored without verification side effects', async () => {
    await storeNewMessages('a@test.com', [
      email('coupon', { subject: 'Reminder', otp: 'SAVE20', body_plain: 'Coupon code: SAVE20' }),
    ]);
    const stored = store[storedEmailsByAddressKey('inbox-1')] as Email[];
    expect(stored[0]).toMatchObject({
      otp: null,
      otpCandidate: null,
      couponCode: 'SAVE20',
      isReminder: true,
    });
    expect(sentMessages.filter((message) => message.type === 'fillOTP')).toHaveLength(0);
    expect(store.latestOtp).toBeUndefined();
  });

  test('a re-arriving seen email does not duplicate in the bag or inflate analytics', async () => {
    // The realistic full-cycle: mail stored once (seen recorded), evicted from
    // the capped bag, then the provider returns it again next poll.
    store.seenEmailIds = { 'a@test.com': ['m1'] };
    store.emailStorageAddressIndex = { 'inbox-1': 'a@test.com' };
    store[storedEmailsByAddressKey('inbox-1')] = [email('m2')];

    await storeNewMessages('a@test.com', [email('m1', { otp: '111111' }), email('m3')]);

    const stored = store[storedEmailsByAddressKey('inbox-1')] as Email[];
    expect(stored?.map((e) => e.id).sort()).toEqual(['m2', 'm3']);
    expect(notificationCalls).toBe(1); // only m3
    expect((store.analytics as { emailsReceived: number }).emailsReceived).toBe(1);
  });

  test('seen list is capped, dropping the oldest IDs first', async () => {
    // Cap logic is unit-tested directly (the live cap is 1000 and not mutable
    // from tests) - the same helper storeNewMessages uses per store.
    const capped = addSeenIds(['a', 'b'], [email('c'), email('d'), email('e')], 3);
    expect(capped).toEqual(['c', 'd', 'e']);
    expect(addSeenIds(undefined, [], 3)).toEqual([]);
  });
});
