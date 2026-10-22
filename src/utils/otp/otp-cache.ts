/**
 * Freshness guard for the authoritative `latestOtp` cache record
 * (storage.local) written by the email-storage M5 step
 * (`{ otp, sender, senderName, context, received_at, recipient }`).
 *
 * Expiry-archiving, message deletion and the archived-cap eviction do NOT
 * clear the `latestOtp` key - only the manual "clear all OTPs" privacy action
 * and inbox deletion do - so a cached code can outlive its message. Every
 * background consumer that serves the cache (the copy-latest-otp shortcut,
 * the WebMCP `get_latest_otp` / `get_otp_from` fast paths) must bound its age:
 * a genuinely fresh OTP is always younger than this window, while an
 * unbounded record keeps serving codes whose message no longer exists.
 *
 * Consumers compare timestamps through `toMs`, which normalizes the
 * seconds-vs-milliseconds values the writers store.
 */

import { toMs } from '@/utils/time/time.js';

/** Cache shape written by the email-storage M5 step (all fields optional on read). */
export interface OtpCacheRecord {
  otp?: string;
  sender?: string;
  senderName?: string;
  context?: string;
  received_at?: number;
  recipient?: string;
}

/**
 * A cached code older than this is never served. Matches the shortcut's
 * staleness guard; see module docstring for why the bound is required.
 */
export const OTP_CACHE_MAX_AGE_MS = 10 * 60 * 1000;
/** Small allowance for provider/device clock skew; larger future dates are invalid. */
export const OTP_FUTURE_SKEW_MS = 2 * 60 * 1000;

/**
 * True when the record proves its own freshness: a valid `received_at`
 * within `OTP_CACHE_MAX_AGE_MS`. A record without a usable timestamp is
 * treated as stale - it cannot prove freshness - while a slightly-future
 * timestamp (clock skew) is still fresh.
 */
export function isOtpCacheFresh(record?: OtpCacheRecord | null): boolean {
  if (!record) return false;
  const receivedMs = record.received_at ? toMs(record.received_at) : 0;
  const ageMs = Date.now() - receivedMs;
  return receivedMs > 0 && ageMs <= OTP_CACHE_MAX_AGE_MS && ageMs >= -OTP_FUTURE_SKEW_MS;
}
