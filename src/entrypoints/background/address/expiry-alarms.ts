/**
 * expiry-alarms.ts - event-driven expiry scheduling.
 *
 * Replaces the two 1-minute periodic alarms (checkAddressExpiry +
 * near_expiry_badge) with a SINGLE self-rescheduling one-shot alarm set at the
 * earliest pending event across all addresses. The service worker now wakes
 * only when there is actually something to do (renewal kick, expiry warning,
 * expiry processing, or a renewal-backoff retry) instead of 120 times an hour.
 *
 * Event times per live address:
 *   - expiresAt − preExpiryWindow  → auto-renew kick (autoExtend only)
 *   - expiresAt − warningThreshold → "expiring soon" notification
 *   - expiresAt                    → expired: notify / archive / delete
 *   - nextRetryAt                  → renewal-backoff retry (autoExtend only)
 *
 * The schedule is re-derived from storage (never from the previous schedule)
 * after every SW start, relevant address or scheduling-setting writes, and
 * every expiry check - so drift, missed alarms after sleep, and mutations all
 * converge on the truth. A missed one-shot fires late (Chrome fires it on
 * wake), and the SW-start immediate pass re-runs the check anyway.
 */

import { browser } from 'wxt/browser';
import { loadProviderConfig } from '@/utils/email/email-service.js';
import { logError } from '@/utils/logger.js';
import {
  DEFAULT_PRE_EXPIRY_WINDOW_MINUTES,
  effectivePreExpiryWindowMs,
} from '@/utils/provider/provider-expiry.js';
import type { Address } from '@/utils/types.js';

/** The single one-shot alarm name (replaces the two periodic alarms). */
export const EXPIRY_SCHEDULER_ALARM = 'expiry_scheduler';

/** Minimum step between re-scheduled fires; also the "past-due" delay. */
const PAST_DUE_DELAY_MS = 1000;

/** How long a reschedule burst may be coalesced (storage writes arrive in bursts). */
const RESCHEDULE_DEBOUNCE_MS = 1000;

export interface NextExpiryEvent {
  whenMs: number;
  /** Which event kind won - for tests and diagnostics, not for control flow. */
  kind: 'pre-renew-window' | 'warning' | 'expiry' | 'renew-retry';
  address: string;
}

/**
 * PURE: the earliest pending event across `addresses`, or null when nothing
 * needs waking. Events already in the past are reported as due-now so the
 * alarm fires immediately and the check processes them (Chrome requires a
 * future `when`; the caller clamps). Past events that the expiry check has
 * already handled are not returned again: in particular, a failed auto-renew
 * must wake at `nextRetryAt`, not every second at the stale pre-renew/expiry
 * timestamp.
 */
export function computeNextExpiryEvent(
  addresses: Address[],
  warningThresholdMs: number,
  preExpiryWindowFor: (record: Address) => number,
  now: number,
  notificationsEnabled = true
): NextExpiryEvent | null {
  let best: NextExpiryEvent | null = null;
  let bestComparisonMs = Number.POSITIVE_INFINITY;
  const consider = (whenMs: number, kind: NextExpiryEvent['kind'], address: string): void => {
    if (!Number.isFinite(whenMs)) return;
    // All due events are equivalent from the alarm's point of view. Compare
    // them at `now`, while retaining the absolute timestamp in the result for
    // diagnostics and existing callers.
    const comparisonMs = whenMs <= now ? now : whenMs;
    if (best === null || comparisonMs < bestComparisonMs) {
      best = { whenMs, kind, address };
      bestComparisonMs = comparisonMs;
    }
  };

  for (const record of addresses) {
    // Archived inboxes stay dormant unless the user explicitly re-enables
    // auto-renew in Settings; deleted inboxes never re-enter the retry lane.
    if (record.accountStatus === 'deleted') continue;
    if (record.accountStatus === 'archived' && !record.autoExtend) {
      if (
        notificationsEnabled &&
        record.archiveReason !== undefined &&
        record.archiveReason !== 'manual' &&
        record.expiresAt !== undefined &&
        record.expiresAt <= now &&
        !record.expiredNotified
      ) {
        consider(record.expiresAt, 'expiry', record.address);
      }
      continue;
    }
    if (!record.expiresAt) continue;

    const expiresAt = record.expiresAt;
    const nextRetryAt = (record as Address & { nextRetryAt?: number }).nextRetryAt;
    const providerConfig = loadProviderConfig(record.provider);
    const supportsRenewal =
      (providerConfig.expiry?.renewable === true ||
        providerConfig.capabilities?.supportsRenew === true) &&
      !!providerConfig.expiry?.renewalMethod;
    if (
      record.accountStatus === 'archived' &&
      record.autoExtend &&
      supportsRenewal &&
      expiresAt <= now &&
      typeof nextRetryAt !== 'number'
    ) {
      // Settings may enable auto-renew after this inbox expired. Wake once
      // immediately so the lifecycle can renew it and restore it to Live.
      consider(now, 'renew-retry', record.address);
    }

    if (record.autoExtend && typeof nextRetryAt === 'number') {
      // A retry deadline is an explicit pending action. It must dominate every
      // STALE timestamp, including after the browser slept past the retry time;
      // otherwise clamping that older event to +1s creates a tight wake loop
      // and starves the retry itself.
      consider(nextRetryAt, 'renew-retry', record.address);
      // …but it must not HIDE an event that comes due BEFORE it. The backoff
      // runs up to 30 min, so an expiry (or its warning) landing inside that
      // window would otherwise wait for the retry and arrive late - the retry
      // spaces out network attempts, it does not postpone telling the user.
      // Only FUTURE events are considered here: a past unhandled one would
      // clamp to +1s and recreate the wake loop this branch exists to prevent.
      if (notificationsEnabled && expiresAt > now) {
        consider(expiresAt, 'expiry', record.address);
      }
      const retryLaneWarningAt = expiresAt - warningThresholdMs;
      if (notificationsEnabled && retryLaneWarningAt > now) {
        consider(retryLaneWarningAt, 'warning', record.address);
      }
      continue;
    }

    // An event in the past is useful only until its corresponding state has
    // been recorded. These flags are also what prevents unsupported auto-renew
    // addresses from becoming a permanent +1s scheduler wake after expiry.
    const warningHandled = record.expiringSoonNotified ?? record.expiryNotified ?? false;
    const expiryHandled = record.expiredNotified ?? false;
    // A past event is actionable only when its state has not been recorded.
    // Do not turn an already-consumed timestamp into a permanent +1s wake.
    // Expiry still needs processing for ordinary addresses (archive/delete)
    // and for a live auto-renew attempt. Once an auto-renew address is already
    // expired, though, an unshown notification is the only remaining work;
    // defer that backfill until notifications are enabled again.
    if (expiresAt > now || (!expiryHandled && (notificationsEnabled || !record.autoExtend))) {
      consider(expiresAt, 'expiry', record.address);
    }
    // T-warning: notification threshold applies to every live address.
    const warningAt = expiresAt - warningThresholdMs;
    if (notificationsEnabled && (warningAt > now || !warningHandled)) {
      consider(warningAt, 'warning', record.address);
    }

    if (record.autoExtend) {
      // Auto-renew is a separate pending action from the warning. If the
      // worker wakes slightly after the pre-renew deadline, a previously sent
      // warning must not suppress the renewal kick while the address is still
      // live. A failed attempt is represented by nextRetryAt above and a
      // successful attempt moves expiresAt into the future.
      const preExpiryWindowMs = preExpiryWindowFor(record);
      const preRenewAt = expiresAt - preExpiryWindowMs;
      const renewalDue = expiresAt > now && expiresAt - now <= preExpiryWindowMs;
      if (preRenewAt > now || renewalDue) {
        consider(preRenewAt, 'pre-renew-window', record.address);
      }
    }
  }
  return best;
}

/**
 * Re-derive the single one-shot from storage and (re)create the alarm. Returns
 * the scheduled time, or null when no event is pending (alarm cleared).
 */
export async function scheduleNextExpiryAlarm(): Promise<number | null> {
  try {
    const {
      addresses = [],
      notificationSettings = {
        enabled: true,
        soundEnabled: true,
        expiryWarningThreshold: 60 * 60 * 1000,
      },
      preExpiryWindowMinutes,
    } = (await browser.storage.local.get([
      'addresses',
      'notificationSettings',
      'preExpiryWindowMinutes',
    ])) as {
      addresses?: Address[];
      notificationSettings?: { enabled?: boolean; expiryWarningThreshold?: number };
      preExpiryWindowMinutes?: number;
    };

    const now = Date.now();
    const userLead =
      typeof preExpiryWindowMinutes === 'number' && preExpiryWindowMinutes > 0
        ? preExpiryWindowMinutes
        : DEFAULT_PRE_EXPIRY_WINDOW_MINUTES;
    const next = computeNextExpiryEvent(
      addresses,
      notificationSettings.expiryWarningThreshold || 60 * 60 * 1000,
      (record) =>
        effectivePreExpiryWindowMs(
          record,
          addresses,
          loadProviderConfig(record.provider),
          userLead
        ),
      now,
      notificationSettings.enabled !== false
    );

    const existing = await browser.alarms.get(EXPIRY_SCHEDULER_ALARM);
    if (!next) {
      if (existing) await browser.alarms.clear(EXPIRY_SCHEDULER_ALARM);
      return null;
    }
    // Past-due events fire at once (min 1s out - `when` must be in the future).
    const whenMs = Math.max(next.whenMs, now + PAST_DUE_DELAY_MS);
    // Same scheduled minute → leave the alarm alone (burst coalescing).
    if (
      existing &&
      existing.periodInMinutes === undefined &&
      Math.abs((existing.scheduledTime ?? 0) - whenMs) < RESCHEDULE_DEBOUNCE_MS
    ) {
      return whenMs;
    }
    await browser.alarms.clear(EXPIRY_SCHEDULER_ALARM);
    await browser.alarms.create(EXPIRY_SCHEDULER_ALARM, { when: whenMs });
    return whenMs;
  } catch (e) {
    logError(
      'Failed to schedule expiry alarm:',
      undefined,
      e instanceof Error ? e : new Error(String(e))
    );
    return null;
  }
}

let rescheduleTimer: ReturnType<typeof setTimeout> | null = null;
let listenersRegistered = false;

/** Debounced reschedule - storage writes arrive in bursts (bulk tag/archive). */
function scheduleReschedule(): void {
  if (rescheduleTimer) return;
  rescheduleTimer = setTimeout(() => {
    rescheduleTimer = null;
    void scheduleNextExpiryAlarm();
  }, RESCHEDULE_DEBOUNCE_MS);
}

/**
 * Register the alarm + storage listeners once per SW lifetime. The alarm
 * handler runs the check and then re-derives the next event (the check may
 * have renewed an address, moving its expiry, or consumed the fired event).
 */
export function registerExpiryAlarmListeners(runCheck: () => Promise<void>): void {
  if (listenersRegistered) return;
  listenersRegistered = true;

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== EXPIRY_SCHEDULER_ALARM) return;
    void (async () => {
      await runCheck();
      await scheduleNextExpiryAlarm();
    })();
  });

  // Address changes and scheduling preferences may change the earliest
  // pending event - re-derive from truth.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.renewalFailurePolicy) {
      // Apply a newly selected archive policy to renewal failures already
      // waiting in backoff instead of making the user wait for the next retry.
      void (async () => {
        await runCheck();
        await scheduleNextExpiryAlarm();
      })();
    }
    if (
      area === 'local' &&
      (changes.addresses ||
        changes.notificationSettings ||
        changes.preExpiryWindowMinutes ||
        changes.renewalFailurePolicy)
    ) {
      scheduleReschedule();
    }
  });
}
