import { afterAll, describe, expect, mock, test } from 'bun:test';

import type { Address } from '@/utils/types.js';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});

// ── Mocks registered BEFORE the dynamic import of expiry-alarms.js ──────────
// wxt/browser: in-memory storage + alarm registry. The scheduler module also
// pulls logger (no-op-able) and provider-expiry/email-service (config only).

const store: Record<string, unknown> = {};
interface FakeAlarm {
  name: string;
  scheduledTime: number;
}
const alarms = new Map<string, FakeAlarm>();

const fakeBrowser = {
  runtime: { id: 'test-extension' },
  alarms: {
    get: async (name: string) => alarms.get(name),
    clear: async (name: string) => {
      alarms.delete(name);
    },
    create: async (name: string, info: { when?: number; scheduledTime?: number }) => {
      alarms.set(name, { name, scheduledTime: info.when ?? info.scheduledTime ?? 0 });
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
    onChanged: { addListener: () => {} },
  },
};

mock.module('wxt/browser', () => ({ browser: fakeBrowser }));

mock.module('@/utils/email/email-service.js', () => ({
  loadProviderConfig: (id: string) => ({
    id,
    expiry: { renewable: true, renewalMethod: 'setEmailUser', duration: 3600000 },
  }),
}));

mock.module('@/utils/logger.js', () => ({
  logError: () => {},
  logWarn: () => {},
  logInfo: () => {},
  logDebug: () => {},
  log: () => {},
}));

const { computeNextExpiryEvent, scheduleNextExpiryAlarm, EXPIRY_SCHEDULER_ALARM } = await import(
  '@/entrypoints/background/address/expiry-alarms.js'
);

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

function record(overrides: Partial<Address> = {}): Address {
  return {
    id: 'inbox-1',
    address: 'a@test.com',
    provider: 'guerrilla',
    createdAt: Date.now() - 24 * HOUR,
    expiresAt: Date.now() + HOUR,
    token: 't',
    addressEmail: 'a@test.com',
    ...overrides,
  } as Address;
}

describe('computeNextExpiryEvent - pure event selection', () => {
  const fixedWindow = () => 10 * MIN;

  test('picks the earliest of expiry / warning / pre-renew events', () => {
    const now = 1_000_000;
    const exp = now + HOUR;
    const next = computeNextExpiryEvent(
      [record({ expiresAt: exp, autoExtend: true })],
      HOUR,
      fixedWindow,
      now
    );
    expect(next).not.toBeNull();
    // warning (exp − 60m) is earlier than pre-renew (exp − 10m) → warning wins
    expect(next?.kind).toBe('warning');
    expect(next?.whenMs).toBe(exp - 60 * MIN);
  });

  test('warning threshold earlier than pre-renew window wins for autoExtend', () => {
    const now = 1_000_000;
    const exp = now + HOUR;
    const next = computeNextExpiryEvent(
      [record({ expiresAt: exp, autoExtend: true })],
      30 * MIN,
      fixedWindow,
      now
    );
    expect(next?.kind).toBe('warning');
    expect(next?.whenMs).toBe(exp - 30 * MIN);
  });

  test('non-autoExtend addresses never schedule renew events', () => {
    const now = 1_000_000;
    const exp = now + 20 * MIN;
    const next = computeNextExpiryEvent(
      [record({ expiresAt: exp, autoExtend: false })],
      HOUR,
      fixedWindow,
      now
    );
    expect(next?.kind).toBe('warning');
    expect(next?.whenMs).toBe(exp - HOUR); // in the past → due now
  });

  test('renewal-backoff retry (nextRetryAt) is schedulable and can win', () => {
    const now = 1_000_000;
    const exp = now + HOUR;
    const retryAt = now + 2 * MIN; // earliest event overall
    const next = computeNextExpiryEvent(
      [record({ expiresAt: exp, autoExtend: true, nextRetryAt: retryAt } as Partial<Address>)],
      30 * MIN,
      fixedWindow,
      now
    );
    expect(next?.kind).toBe('renew-retry');
    expect(next?.whenMs).toBe(retryAt);
  });

  test('an expiry due BEFORE the pending retry wins the schedule', () => {
    const now = 1_000_000;
    const retryAt = now + 10 * MIN; // a retry is pending…
    const exp = now + 2 * MIN; // …but the mailbox expires first
    const next = computeNextExpiryEvent(
      [record({ expiresAt: exp, autoExtend: true, nextRetryAt: retryAt } as Partial<Address>)],
      30 * MIN,
      fixedWindow,
      now
    );
    // The retry deadline must not HIDE an event that comes due before it, or
    // the expiry notice arrives up to a full backoff (30 min) late.
    expect(next?.kind).toBe('expiry');
    expect(next?.whenMs).toBe(exp);
  });

  test('a past-due expiry does not pre-empt the pending retry (no +1s wake loop)', () => {
    const now = 1_000_000;
    const retryAt = now + 5 * MIN;
    const next = computeNextExpiryEvent(
      [
        record({
          expiresAt: now - MIN,
          autoExtend: true,
          nextRetryAt: retryAt,
        } as Partial<Address>),
      ],
      30 * MIN,
      fixedWindow,
      now
    );
    // A past event would clamp to +1s and, because the retry wait skips the
    // check, wake forever - so the retry deadline stays the schedule.
    expect(next?.kind).toBe('renew-retry');
    expect(next?.whenMs).toBe(retryAt);
  });

  test('dormant manual archives and deleted records are ignored', () => {
    const now = 1_000_000;
    const next = computeNextExpiryEvent(
      [
        record({
          expiresAt: now + MIN,
          accountStatus: 'archived',
          archiveReason: 'manual',
          autoExtend: false,
        }),
        record({ expiresAt: now + MIN, accountStatus: 'deleted', autoExtend: true }),
      ],
      HOUR,
      fixedWindow,
      now
    );
    expect(next).toBeNull();
  });

  test('an archived inbox explicitly re-armed for renewal schedules an immediate retry', () => {
    const now = 1_000_000;
    const next = computeNextExpiryEvent(
      [record({ expiresAt: now - MIN, accountStatus: 'archived', autoExtend: true })],
      HOUR,
      fixedWindow,
      now
    );
    expect(next?.kind).toBe('renew-retry');
    expect(next?.whenMs).toBe(now);
  });

  test('a missed auto-archive notice wakes only when enabled and not yet delivered', () => {
    const now = 1_000_000;
    const address = record({
      expiresAt: now - MIN,
      accountStatus: 'archived',
      archiveReason: 'expired',
      autoExtend: false,
    });
    expect(computeNextExpiryEvent([address], HOUR, fixedWindow, now, false)).toBeNull();
    expect(computeNextExpiryEvent([address], HOUR, fixedWindow, now)?.kind).toBe('expiry');
    expect(
      computeNextExpiryEvent([{ ...address, expiredNotified: true }], HOUR, fixedWindow, now)
    ).toBeNull();
  });

  test('records without expiresAt contribute nothing', () => {
    const now = 1_000_000;
    expect(
      computeNextExpiryEvent([record({ expiresAt: undefined })], HOUR, fixedWindow, now)
    ).toBeNull();
  });

  test('past-due events are returned as-is (caller clamps to future)', () => {
    const now = 1_000_000;
    const exp = now - 5 * MIN;
    const next = computeNextExpiryEvent(
      [record({ expiresAt: exp, autoExtend: false })],
      0,
      fixedWindow,
      now
    );
    expect(next?.kind).toBe('expiry');
    expect(next?.whenMs).toBe(exp);
  });

  test('multiple addresses: earliest event across all wins', () => {
    const now = 1_000_000;
    const a = record({ id: '1', address: 'a@x.com', expiresAt: now + 2 * HOUR, autoExtend: false });
    const b = record({ id: '2', address: 'b@x.com', expiresAt: now + 20 * MIN, autoExtend: false });
    const next = computeNextExpiryEvent([a, b], HOUR, fixedWindow, now);
    expect(next?.address).toBe('b@x.com');
    expect(next?.whenMs).toBe(now + 20 * MIN - HOUR); // warning for b, in the past
  });

  test('does not resurrect a handled past warning ahead of a future expiry', () => {
    const now = 1_000_000;
    const exp = now + 20 * MIN;
    const next = computeNextExpiryEvent(
      [
        record({
          expiresAt: exp,
          autoExtend: false,
          expiringSoonNotified: true,
          expiryNotified: true,
        }),
      ],
      HOUR,
      fixedWindow,
      now
    );
    expect(next?.kind).toBe('expiry');
    expect(next?.whenMs).toBe(exp);
  });

  test('keeps a live auto-renew mailbox due for its past pre-renew event', () => {
    const now = 1_000_000;
    const exp = now + 5 * MIN;
    const next = computeNextExpiryEvent(
      [
        record({
          expiresAt: exp,
          autoExtend: true,
          expiringSoonNotified: true,
          expiryNotified: true,
        }),
      ],
      HOUR,
      fixedWindow,
      now
    );
    expect(next?.kind).toBe('pre-renew-window');
    expect(next?.whenMs).toBe(exp - 10 * MIN);
  });

  test('stops waking after warning and expiry have both been handled', () => {
    const now = 1_000_000;
    expect(
      computeNextExpiryEvent(
        [
          record({
            expiresAt: now - MIN,
            autoExtend: false,
            expiringSoonNotified: true,
            expiryNotified: true,
            expiredNotified: true,
          }),
        ],
        HOUR,
        fixedWindow,
        now
      )
    ).toBeNull();
  });
});

describe('scheduleNextExpiryAlarm - storage-derived one-shot', () => {
  test('creates a one-shot at the earliest event; past events clamp to +1s', async () => {
    store.addresses = [record({ expiresAt: Date.now() + 20 * MIN, autoExtend: false })];
    delete store.notificationSettings;
    const when = await scheduleNextExpiryAlarm();
    expect(when).not.toBeNull();
    if (when === null) throw new Error('unreachable: when is non-null');
    expect(when - Date.now()).toBeLessThanOrEqual(20 * MIN);
    const alarm = alarms.get(EXPIRY_SCHEDULER_ALARM);
    expect(alarm).toBeDefined();
    expect(alarm?.scheduledTime).toBe(when);
  });

  test('clears the alarm when nothing is pending', async () => {
    store.addresses = [record({ expiresAt: Date.now() + HOUR, accountStatus: 'archived' })];
    alarms.set(EXPIRY_SCHEDULER_ALARM, {
      name: EXPIRY_SCHEDULER_ALARM,
      scheduledTime: Date.now() + MIN,
    });
    const when = await scheduleNextExpiryAlarm();
    expect(when).toBeNull();
    expect(alarms.has(EXPIRY_SCHEDULER_ALARM)).toBe(false);
  });

  test('re-schedules a closer event when the earliest changes', async () => {
    const soonExp = Date.now() + 5 * MIN;
    store.addresses = [record({ expiresAt: soonExp, autoExtend: false })];
    await scheduleNextExpiryAlarm();
    const first = alarms.get(EXPIRY_SCHEDULER_ALARM)?.scheduledTime ?? 0;

    // Renewal pushes expiry far out → next event moves out too.
    store.addresses = [record({ expiresAt: soonExp + 10 * HOUR, autoExtend: false })];
    await scheduleNextExpiryAlarm();
    const second = alarms.get(EXPIRY_SCHEDULER_ALARM)?.scheduledTime ?? 0;
    expect(second).toBeGreaterThan(first);
  });

  test('no addresses at all → no alarm (the SW stops waking)', async () => {
    store.addresses = [];
    const when = await scheduleNextExpiryAlarm();
    expect(when).toBeNull();
    expect(alarms.has(EXPIRY_SCHEDULER_ALARM)).toBe(false);
  });
});
