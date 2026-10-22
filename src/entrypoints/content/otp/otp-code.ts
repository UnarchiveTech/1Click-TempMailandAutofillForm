/**
 * Defensive shape + freshness guards for OTP codes arriving at the content
 * scripts (wait-OTP panel, multi-step watcher).
 *
 * Background extraction (local `normalizeOtp`, AI `sanitizeOtp`) already caps
 * codes at 3-8 alphanumeric chars containing a digit, but the content boundary
 * is where untrusted values are displayed, auto-filled into forms, and
 * consumed from `latestOtp`. These helpers are the last line of defense so a
 * malformed or hostile value can never reach a form field, the panel DOM, or
 * the clipboard - even if a future extraction path forgets to sanitize.
 */

import { OTP_FUTURE_SKEW_MS } from '@/utils/otp/otp-cache.js';

/**
 * Plausible OTP codes are short alphanumeric strings containing a digit.
 * Loose enough to never reject a real code (3-16 vs the extractor's 3-8), but
 * it rejects arbitrary-length or control-character payloads before they can be
 * displayed, filled, or consumed.
 */
export function isPlausibleOtpCode(value: unknown): value is string {
  return normalizeOtpCode(value) !== null;
}

/** Return the canonical value that must be shown and inserted into OTP fields. */
export function normalizeOtpCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim().replace(/[\s-]+/g, '');
  if (candidate.length < 3 || candidate.length > 16) return null;
  if (!/^[A-Za-z0-9]+$/.test(candidate)) return null;
  return /[0-9]/.test(candidate) ? candidate : null;
}

/**
 * True when a cached code's `received_at` is at/after `sinceMs` (with a small
 * slack for clock skew). The future-date allowance matches the background OTP
 * cache guard. Accepts seconds or milliseconds timestamps; rejects
 * missing/invalid values.
 *
 * Without this, a flow that refreshes `latestOtp` from an OLD email (re-scan,
 * inbox-deletion fallback) would let a stale - possibly already-consumed -
 * code auto-fill into the site currently being watched.
 */
export function otpFreshEnough(receivedAt: unknown, sinceMs: number, slackMs = 2000): boolean {
  if (
    typeof receivedAt !== 'number' ||
    !Number.isFinite(receivedAt) ||
    receivedAt <= 0 ||
    !Number.isFinite(sinceMs)
  ) {
    return false;
  }
  const receivedMs = receivedAt > 1e12 ? receivedAt : receivedAt * 1000;
  const now = Date.now();
  return receivedMs >= sinceMs - slackMs && receivedMs <= now + OTP_FUTURE_SKEW_MS;
}

/** Cap attacker-controlled metadata text (email from/subject) in the panel DOM. */
export function clipOtpMetaText(value: string | undefined, max = 60): string {
  if (!value) return '';
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
