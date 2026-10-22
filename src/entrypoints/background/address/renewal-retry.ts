import type { Address } from '@/utils/types.js';

/** Consecutive renewal failures count only while they are reasonably recent. */
export const RENEWAL_FAIL_STREAK_MS = 10 * 60 * 1000;
export const RENEWAL_BACKOFF_BASE_MS = 60 * 1000;
export const RENEWAL_BACKOFF_MAX_MS = 30 * 60 * 1000;

export type RenewalFailureState = Pick<Address, 'renewalFailCount' | 'lastFailureAt'>;

/** Shared manual/automatic renewal retry bookkeeping. */
export function getRenewalFailureUpdates(
  previous: RenewalFailureState,
  failureNow = Date.now()
): Pick<Address, 'renewalFailCount' | 'lastFailureAt' | 'nextRetryAt'> {
  const priorCount = previous.renewalFailCount ?? 0;
  const consecutiveCount =
    previous.lastFailureAt && failureNow - previous.lastFailureAt <= RENEWAL_FAIL_STREAK_MS
      ? priorCount
      : 0;
  const renewalFailCount = consecutiveCount + 1;
  const backoffMs = Math.min(
    RENEWAL_BACKOFF_BASE_MS * 2 ** (renewalFailCount - 1),
    RENEWAL_BACKOFF_MAX_MS
  );

  return {
    renewalFailCount,
    lastFailureAt: failureNow,
    nextRetryAt: failureNow + backoffMs,
  };
}
