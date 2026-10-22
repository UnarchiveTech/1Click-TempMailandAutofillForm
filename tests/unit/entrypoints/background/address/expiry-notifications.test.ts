import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { Address } from '@/utils/types.js';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// ── Mocks registered BEFORE the dynamic import of expiry-manager.js ─────────
// wxt/browser: in-memory storage + a notification counter. email-service: a
// provider config map (same pattern as backup-actions.test.ts) plus an
// EmailService stub whose renewal can be made to throw, so the auto-renew
// failure paths are testable without real network calls.

const store: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};
let notificationCalls = 0;
/** First create() argument per notification (the id, or the options when unkeyed). */
let notificationIds: unknown[] = [];
let failRenewals = false;

const fakeBrowser = {
  runtime: { id: 'test-extension', sendMessage: async () => ({}) },
  notifications: {
    create: async (...args: unknown[]) => {
      notificationCalls += 1;
      notificationIds.push(args[0]);
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

mock.module('@/utils/email/email-service.js', () => ({
  DEFAULT_PROVIDER: 'guerrilla',
  loadProviderConfig: (id: string) => {
    if (id === 'guerrilla') {
      return { id, expiry: { renewable: true, renewalMethod: 'setEmailUser', duration: 3600000 } };
    }
    if (id === 'burner') {
      return { id, expiry: { renewable: false, duration: 86400000 } };
    }
    throw new Error(`Unknown provider: ${id}`);
  },
  EmailService: class {
    async executeOperation(): Promise<Record<string, unknown>> {
      if (failRenewals) throw new Error('provider down');
      return {};
    }
  },
}));

const { checkAddressExpiry } = await import('@/entrypoints/background/address/expiry-manager.js');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

function record(overrides: Partial<Address> = {}): Address {
  return {
    id: 'inbox-1',
    address: 'a@test.com',
    provider: 'guerrilla',
    createdAt: Date.now() - 24 * HOUR,
    expiresAt: Date.now() + HOUR,
    expiryNotified: false,
    autoExtend: false,
    ...overrides,
  } as Address;
}

beforeEach(() => {
  notificationCalls = 0;
  notificationIds = [];
  failRenewals = false;
  for (const k of Object.keys(store)) delete store[k];
  store.notificationSettings = { enabled: true, soundEnabled: false };
});

describe('per-state expiry notification flags', () => {
  test('an expiring-soon warning never suppresses the expired notification', async () => {
    store.addresses = [record({ expiresAt: Date.now() + 30 * MIN })];

    // Phase 1: inside the warning window → 'expiring-soon' fires once.
    await checkAddressExpiry();
    expect(notificationCalls).toBe(1);
    expect((store.addresses as Address[])[0].expiringSoonNotified).toBe(true);

    // Phase 2: time passes, the inbox expires. The prior warning must NOT
    // silence the 'expired' notification (the old single-flag bug).
    (store.addresses as Address[])[0].expiresAt = Date.now() - 1000;
    await checkAddressExpiry();
    expect(notificationCalls).toBe(2);
    expect((store.addresses as Address[])[0].expiredNotified).toBe(true);

    // Phase 3: idempotent - no third notification.
    await checkAddressExpiry();
    expect(notificationCalls).toBe(2);
  });

  test('user-configured pre-expiry window triggers auto-renew earlier', async () => {
    store.preExpiryWindowMinutes = 30;
    store.addresses = [
      record({ autoExtend: true, token: 'tok', expiresAt: Date.now() + 25 * MIN }),
    ];

    // 25 min remaining is inside the 30-min window → renewal fires now.
    await checkAddressExpiry();
    const renewed = (store.addresses as Address[])[0];
    expect(renewed.renewalCount).toBe(1);
    // Routine renewal is silent - only recovery after failures notifies. The
    // fall-through warning may or may not fire here (the refreshed ~60min
    // window sits exactly on the default 1h threshold), so bound, don't pin.
    expect(notificationCalls).toBeLessThanOrEqual(1);
    // Fresh window anchored to now (mock response has no timestamps).
    expect(renewed.expiresAt).toBeGreaterThan(Date.now() + 50 * MIN);
  });

  test('default pre-expiry window does not renew 25 minutes early', async () => {
    store.addresses = [
      record({ autoExtend: true, token: 'tok', expiresAt: Date.now() + 25 * MIN }),
    ];

    // 25 min remaining is outside the default 1-min window → no renewal,
    // only the T-1h expiring-soon warning.
    await checkAddressExpiry();
    expect((store.addresses as Address[])[0].renewalCount ?? 0).toBe(0);
    expect(notificationCalls).toBe(1); // 'expiring-soon' warning
    expect((store.addresses as Address[])[0].expiringSoonNotified).toBe(true);
  });

  test('a renewal failure notifies even after a prior expiring-soon warning', async () => {
    // "Prior warning" state is exactly what the legacy flag produced - the
    // silent-death case: auto-renew fails at expiry and the user is never told.
    store.addresses = [
      record({
        autoExtend: true,
        token: 'tok',
        expiresAt: Date.now() + 1 * MIN,
        expiringSoonNotified: true,
        expiryNotified: true,
      }),
    ];
    failRenewals = true;

    await checkAddressExpiry();

    // The inbox is still inside its lead window, so the failure must not be
    // mislabeled as expired. It may repeat the warning, but expiredNotified
    // remains false until the expiry timestamp is actually reached.
    expect(notificationCalls).toBe(1);
    const stored = (store.addresses as Address[])[0];
    expect(stored.renewalFailCount).toBe(1);
    expect(stored.lastFailureAt).toBeGreaterThan(Date.now() - MIN);
    expect(stored.expiredNotified).not.toBe(true);
    expect(stored.expiringSoonNotified).toBe(true);
  });

  test('expired auto-renew failures auto-archive while exponential retries continue', async () => {
    store.addresses = [record({ autoExtend: true, token: 'tok', expiresAt: Date.now() - MIN })];
    failRenewals = true;

    await checkAddressExpiry(); // failure 1 → 'expired' notified once
    let stored = (store.addresses as Address[])[0];
    expect(stored.renewalFailCount).toBe(1);
    expect(stored.nextRetryAt).toBeGreaterThan(Date.now() + 30 * 1000); // 1 min backoff

    // Backoff elapses → attempt again → failure 2 (2 min backoff).
    stored.nextRetryAt = Date.now() - 1000;
    await checkAddressExpiry();
    stored = (store.addresses as Address[])[0];
    expect(stored.renewalFailCount).toBe(2);
    expect(stored.nextRetryAt).toBeGreaterThan(Date.now() + 90 * 1000);

    // Failure 3 (4 min backoff) continues even after automatic archival.
    stored.nextRetryAt = Date.now() - 1000;
    await checkAddressExpiry();
    stored = (store.addresses as Address[])[0];
    expect(stored.renewalFailCount).toBe(3);
    expect(stored.nextRetryAt).toBeGreaterThan(Date.now() + 3 * MIN);
    expect(stored.accountStatus).toBe('archived');
    expect(stored.archiveReason).toBe('auto-renew-failed');
    expect(stored.autoExtend).toBe(true);
    expect(stored.status).toBeUndefined();
    expect(notificationCalls).toBe(1); // 'expired' notified exactly once
  });

  test('lead-window renewal failures do NOT repeat the notice on every retry', async () => {
    // The address is still LIVE (its expiry has not passed), so the failure
    // takes the lead-window branch - the one every backoff retry re-enters.
    store.addresses = [record({ autoExtend: true, token: 'tok', expiresAt: Date.now() + 1 * MIN })];
    failRenewals = true;

    await checkAddressExpiry(); // failure 1 → one notice
    expect(notificationCalls).toBe(1);
    let stored = (store.addresses as Address[])[0];
    expect(stored.renewalFailCount).toBe(1);
    expect(stored.expiringSoonNotified).toBe(true);

    // Backoff elapses → failure 2 of the SAME streak: the streak grows, the
    // notice must not repeat.
    stored.nextRetryAt = Date.now() - 1000;
    await checkAddressExpiry();
    stored = (store.addresses as Address[])[0];
    expect(stored.renewalFailCount).toBe(2);
    expect(notificationCalls).toBe(1);

    // …and failure 3 likewise.
    stored.nextRetryAt = Date.now() - 1000;
    await checkAddressExpiry();
    stored = (store.addresses as Address[])[0];
    expect(stored.renewalFailCount).toBe(3);
    expect(notificationCalls).toBe(1);
    // Never archived while auto-renew is on, however long the outage runs.
    expect(stored.accountStatus).toBeUndefined();
  });

  test('a failure that starts a NEW streak notifies again', async () => {
    // The previous failure is older than the streak window - the user has not
    // been told about THIS outage, so it must be reported.
    store.addresses = [
      record({
        autoExtend: true,
        token: 'tok',
        expiresAt: Date.now() + 1 * MIN,
        renewalFailCount: 4,
        lastFailureAt: Date.now() - 60 * MIN,
      }),
    ];
    failRenewals = true;

    await checkAddressExpiry();

    expect(notificationCalls).toBe(1);
    expect((store.addresses as Address[])[0].renewalFailCount).toBe(1); // streak reset
  });

  test('an expiry reached while the retry is still backing off is reported at once', async () => {
    // Auto-renew is retrying (nextRetryAt is in the FUTURE) but the mailbox has
    // already died. The backoff spaces out network attempts; it must not
    // postpone telling the user the address is gone.
    store.addresses = [
      record({
        autoExtend: true,
        token: 'tok',
        expiresAt: Date.now() - 1000,
        renewalFailCount: 1,
        lastFailureAt: Date.now(),
        nextRetryAt: Date.now() + 10 * MIN,
      }),
    ];
    failRenewals = true;

    await checkAddressExpiry();

    expect(notificationCalls).toBe(1);
    const stored = (store.addresses as Address[])[0];
    expect(stored.expiredNotified).toBe(true);
    // The retry schedule is untouched after automatic archival.
    expect(stored.nextRetryAt).toBeGreaterThan(Date.now() + 9 * MIN);
    expect(stored.accountStatus).toBe('archived');
    expect(stored.archiveReason).toBe('auto-renew-failed');

    // Still exactly once across a later check inside the same backoff window.
    await checkAddressExpiry();
    expect(notificationCalls).toBe(1);
  });

  test('backoff skips renewal attempts until nextRetryAt', async () => {
    store.addresses = [
      record({
        autoExtend: true,
        token: 'tok',
        expiresAt: Date.now() - MIN,
        renewalFailCount: 1,
        lastFailureAt: Date.now(),
        nextRetryAt: Date.now() + 5 * MIN,
      }),
    ];
    failRenewals = true;

    await checkAddressExpiry();

    // Still inside the backoff window: no attempt, no new failure.
    const stored = (store.addresses as Address[])[0];
    expect(stored.renewalFailCount).toBe(1);
    expect(stored.nextRetryAt).toBeGreaterThan(Date.now() + 4 * MIN);
    // The address has ALREADY expired and the user has not been told, so the
    // expired notice is emitted now rather than at the retry (up to 30 min
    // later). The backoff spaces out network attempts; it must not postpone
    // reporting that the mailbox is gone.
    expect(notificationCalls).toBe(1);
    expect(stored.expiredNotified).toBe(true);
  });

  test('a successful auto-renew resets the failure streak', async () => {
    store.addresses = [record({ autoExtend: true, token: 'tok', expiresAt: Date.now() - MIN })];
    failRenewals = true;

    await checkAddressExpiry(); // failure 1
    let stored = (store.addresses as Address[])[0];
    expect(stored.renewalFailCount).toBe(1);
    expect(stored.nextRetryAt).toBeGreaterThan(Date.now());

    // Recovery: the backoff elapses, the renewal succeeds - the streak resets,
    // the backoff clears, and the window is refreshed so the inbox is active.
    failRenewals = false;
    stored.nextRetryAt = Date.now() - 1000;
    await checkAddressExpiry();
    stored = (store.addresses as Address[])[0];
    expect(stored.renewalFailCount).toBe(0);
    expect(stored.nextRetryAt).toBeUndefined();
    expect(stored.expiresAt).toBeGreaterThan(Date.now());
    expect(stored.accountStatus).toBe('active');
    expect(stored.archiveReason).toBeUndefined();
    expect(stored.archivedAt).toBeUndefined();

    // A later outage starts a fresh streak and auto-archives the expired inbox.
    failRenewals = true;
    (store.addresses as Address[])[0].expiresAt = Date.now() - MIN;
    await checkAddressExpiry(); // failure 1
    await checkAddressExpiry(); // skipped - still inside the 1 min backoff
    stored = (store.addresses as Address[])[0];
    expect(stored.renewalFailCount).toBe(1);
    expect(stored.accountStatus).toBe('archived');
    expect(stored.archiveReason).toBe('auto-renew-failed');
  });

  test('a stale failure restarts the streak and the backoff', async () => {
    // Two failures from a previous outage (hours ago, e.g. browser asleep
    // through it, one attempt per wake) must not extend the current streak.
    // One fresh failure starts at 1 with the base backoff.
    store.addresses = [
      record({
        autoExtend: true,
        token: 'tok',
        expiresAt: Date.now() - MIN,
        renewalFailCount: 2,
        lastFailureAt: Date.now() - 2 * HOUR,
      }),
    ];
    failRenewals = true;

    await checkAddressExpiry();

    const stored = (store.addresses as Address[])[0];
    expect(stored.renewalFailCount).toBe(1);
    expect(stored.lastFailureAt).toBeGreaterThan(Date.now() - MIN);
    // Backoff restarts at the base (1 min), not the 4 min of a 3rd failure.
    expect(stored.nextRetryAt).toBeGreaterThan(Date.now() + 30 * 1000);
    expect(stored.nextRetryAt).toBeLessThan(Date.now() + 2 * MIN);
    expect(stored.accountStatus).toBe('archived');
    expect(stored.archiveReason).toBe('auto-renew-failed');
  });

  test('autoExtend on a non-renewable provider warns when nearing expiry', async () => {
    // No renewal is coming - the address will die in ~1 minute. Warn.
    store.addresses = [
      record({ provider: 'burner', autoExtend: true, expiresAt: Date.now() + 1 * MIN }),
    ];

    await checkAddressExpiry();

    expect(notificationCalls).toBe(1);
    expect((store.addresses as Address[])[0].expiringSoonNotified).toBe(true);
  });

  test('non-renewable autoExtend does not double-warn when already notified', async () => {
    store.addresses = [
      record({
        provider: 'burner',
        autoExtend: true,
        expiresAt: Date.now() + 1 * MIN,
        expiringSoonNotified: true,
        expiryNotified: true,
      }),
    ];

    await checkAddressExpiry();

    expect(notificationCalls).toBe(0);
  });

  function archivedAddress(id: string, addr: string): Address {
    return record({
      id,
      address: addr,
      accountStatus: 'archived',
      status: 'archived',
      expiresAt: Date.now() - 2 * HOUR,
    });
  }

  test('eviction moves the oldest archived records to the recoverable overflow instead of deleting', async () => {
    // 52 archived + 1 expiring active → the active one archives this run (53
    // archived) → cap 50 → the 3 oldest are moved to archivedAddressOverflow,
    // never destroyed (their address + credentials survive for restore/renew).
    const archived = Array.from({ length: 52 }, (_, i) =>
      archivedAddress(`a${i + 1}`, `a${i + 1}@x.com`)
    );
    store.addresses = [
      ...archived,
      record({ id: 'live', address: 'live@x.com', expiresAt: Date.now() - MIN }),
    ];

    await checkAddressExpiry();

    const remaining = store.addresses as Address[];
    const overflow = (store.archivedAddressOverflow as Address[]) || [];
    expect(remaining.length).toBe(50);
    expect(remaining.filter((i) => i.accountStatus === 'archived').length).toBe(50);
    expect(overflow.length).toBe(3);
    expect(overflow.map((o) => o.id)).toEqual(['a1', 'a2', 'a3']);
    // The record is preserved intact - restorable, not deleted.
    expect(overflow[0].address).toBe('a1@x.com');
  });

  test('respects a user-set archived-inbox limit from storage', async () => {
    store.maxArchivedAddresses = 2;
    store.addresses = [
      archivedAddress('b1', 'b1@x.com'),
      archivedAddress('b2', 'b2@x.com'),
      archivedAddress('b3', 'b3@x.com'),
      record({ id: 'live2', address: 'live2@x.com', expiresAt: Date.now() - MIN }),
    ];

    await checkAddressExpiry();

    const remaining = store.addresses as Address[];
    const overflow = (store.archivedAddressOverflow as Address[]) || [];
    expect(overflow.map((o) => o.id)).toEqual(['b1', 'b2']);
    expect(remaining.length).toBe(2); // b3 + the just-archived live2
  });

  test('a limit of 0 keeps every archived mailbox (no eviction)', async () => {
    store.maxArchivedAddresses = 0;
    store.addresses = [
      archivedAddress('c1', 'c1@x.com'),
      archivedAddress('c2', 'c2@x.com'),
      archivedAddress('c3', 'c3@x.com'),
      record({ id: 'live3', address: 'live3@x.com', expiresAt: Date.now() - MIN }),
    ];

    await checkAddressExpiry();

    expect((store.addresses as Address[]).length).toBe(4);
    expect(store.archivedAddressOverflow).toBeUndefined();
  });

  test('legacy-warned inbox still receives the expired notification after upgrade', async () => {
    // Pre-split state: only the legacy flag is set (an old expiring-soon
    // warning). After the upgrade the expired notice must fire anyway.
    store.addresses = [record({ expiresAt: Date.now() - MIN, expiryNotified: true })];

    await checkAddressExpiry();

    expect(notificationCalls).toBe(1);
    expect((store.addresses as Address[])[0].expiredNotified).toBe(true);
  });

  test('expired mailbox with notifications disabled notifies on re-enable', async () => {
    // Disabled: the address still archives, but no notified-flag may be set -
    // setting them would silently eat the backfill the user is owed.
    store.notificationSettings = { enabled: false, soundEnabled: false };
    store.addresses = [record({ expiresAt: Date.now() - MIN })];

    await checkAddressExpiry();
    expect(notificationCalls).toBe(0);
    expect((store.addresses as Address[])[0].expiredNotified).not.toBe(true);
    const archivedAt = (store.addresses as Address[])[0].archivedAt;
    expect((store.addresses as Address[])[0].archiveReason).toBe('expired');

    // Re-enable: the missed expiry is reported exactly once, then stays quiet.
    store.notificationSettings = { enabled: true, soundEnabled: false };
    await checkAddressExpiry();
    expect(notificationCalls).toBe(1);
    expect((store.addresses as Address[])[0].expiredNotified).toBe(true);
    expect((store.addresses as Address[])[0].accountStatus).toBe('archived');
    expect((store.addresses as Address[])[0].archivedAt).toBe(archivedAt);
    await checkAddressExpiry();
    expect(notificationCalls).toBe(1);
  });

  test('re-enabling notifications does not announce a dormant manual archive', async () => {
    store.addresses = [
      record({
        accountStatus: 'archived',
        archiveReason: 'manual',
        autoExtend: false,
        expiresAt: Date.now() - MIN,
      }),
    ];
    await checkAddressExpiry();
    expect(notificationCalls).toBe(0);
    expect((store.addresses as Address[])[0].expiredNotified).not.toBe(true);
  });

  test('warning window with notifications disabled warns on re-enable', async () => {
    store.notificationSettings = { enabled: false, soundEnabled: false };
    store.addresses = [record({ expiresAt: Date.now() + 30 * MIN })];

    await checkAddressExpiry();
    expect(notificationCalls).toBe(0);
    const stored = (store.addresses as Address[])[0];
    expect(stored.expiringSoonNotified).not.toBe(true);
    expect(stored.expiryNotified).not.toBe(true);

    store.notificationSettings = { enabled: true, soundEnabled: false };
    await checkAddressExpiry();
    expect(notificationCalls).toBe(1);
    expect((store.addresses as Address[])[0].expiringSoonNotified).toBe(true);
  });

  test('routine renewals stay silent; recovery after failures notifies', async () => {
    // Narrow warning window so the refreshed post-renewal window (~60 min)
    // deterministically stays outside it - no fall-through warning noise.
    store.notificationSettings = {
      enabled: true,
      soundEnabled: false,
      expiryWarningThreshold: 5 * MIN,
    };
    store.preExpiryWindowMinutes = 30;

    // Routine renewal (no prior failures): the window refreshes, no card.
    store.addresses = [
      record({ autoExtend: true, token: 'tok', expiresAt: Date.now() + 25 * MIN }),
    ];
    await checkAddressExpiry();
    expect((store.addresses as Address[])[0].renewalCount).toBe(1);
    expect(notificationCalls).toBe(0);

    // Recovery renewal (a prior failure streak): the 'renewed' notice fires.
    store.addresses = [
      record({
        autoExtend: true,
        token: 'tok',
        expiresAt: Date.now() - MIN,
        renewalFailCount: 2,
        lastFailureAt: Date.now(),
      }),
    ];
    await checkAddressExpiry();
    const recovered = (store.addresses as Address[])[0];
    expect(recovered.renewalCount).toBe(1);
    expect(recovered.renewalFailCount).toBe(0);
    expect(notificationCalls).toBe(1);
  });

  test('warning, recovery, and expiry states for one mailbox reuse one notification id', async () => {
    store.notificationSettings = {
      enabled: true,
      soundEnabled: false,
      expiryWarningThreshold: 5 * MIN,
    };

    // Warning inside the window, then the mailbox expires - the expired card
    // must REPLACE the warning card, not stack a second one.
    store.addresses = [record({ expiresAt: Date.now() + 3 * MIN })];
    await checkAddressExpiry();
    expect(notificationCalls).toBe(1);

    (store.addresses as Address[])[0].expiresAt = Date.now() - 1000;
    await checkAddressExpiry();
    expect(notificationCalls).toBe(2);

    expect(notificationIds).toEqual(['address-expiry:inbox-1', 'address-expiry:inbox-1']);
  });
});
