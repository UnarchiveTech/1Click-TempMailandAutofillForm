// --- Time helpers ---
import { tSync } from './i18n-utils.js';
import type { Account } from './types.js';

export function isMs(timestamp: number, threshold = 5e10): boolean {
  return timestamp > threshold;
}

export function toMs(receivedAt: number): number {
  if (!receivedAt) return 0;
  return isMs(receivedAt) ? receivedAt : receivedAt * 1000;
}

export function toSeconds(receivedAt: number): number {
  if (!receivedAt) return 0;
  return isMs(receivedAt) ? Math.floor(receivedAt / 1000) : receivedAt;
}

export function timeAgo(timestamp: number): string {
  if (!timestamp) return '';
  const now = Date.now();
  const secondsPast = (now - toMs(timestamp)) / 1000;
  if (secondsPast < 60) {
    return tSync('time.secondsAgo', { n: Math.round(secondsPast) });
  }
  if (secondsPast < 3600) {
    return tSync('time.minutesAgo', { n: Math.round(secondsPast / 60) });
  }
  if (secondsPast <= 86400) {
    return tSync('time.hoursAgo', { n: Math.round(secondsPast / 3600) });
  }
  return tSync('time.daysAgo', { n: Math.round(secondsPast / 86400) });
}

export function formatDate(ts: number | string): string {
  if (!ts) return tSync('time.never');
  const date = new Date(ts);
  const now = new Date();
  // Compare calendar dates (strip time to midnight) instead of ceiling of
  // elapsed milliseconds - the latter races against wall-clock time and can
  // misclassify "yesterday" as "2 days ago" when a few ms elapse between
  // constructing the date and computing the diff.
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.round((startOfToday.getTime() - startOfDate.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return tSync('time.today');
  if (diff === 1) return tSync('time.yesterday');
  if (diff <= 7) return tSync('time.daysAgoLong', { n: diff });
  return date.toLocaleDateString();
}

export function formatTimeLeft(ms: number): string {
  if (!ms || ms <= 0) return tSync('time.expired');
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, '0')}`;
  return `${minutes}m`;
}

/** @deprecated Prefer `@/utils/account-status` helpers; kept for call-site stability. */
export function getEmailStatus(inbox: Account): string {
  if (inbox.accountStatus === 'deleted') return 'deleted';
  if (inbox.accountStatus === 'archived') return 'archived';
  // expiresAt === 0 means unknown/no expiry — do not treat as expired
  const exp = inbox.expiresAt || 0;
  if (exp > 0 && Date.now() > exp) return 'expired';
  return 'active';
}

/**
 * Simple debounce helper to rate-limit execution of a function.
 */
export function debounce<F extends (...args: unknown[]) => unknown>(
  fn: F,
  delayMs: number
): (...args: Parameters<F>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<F>) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, delayMs);
  };
}
