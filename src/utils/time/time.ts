// --- Time helpers ---

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

/** Format a timestamp with the requested fields and optional explicit locale. */
export function formatLocalDateTime(
  timestamp: number,
  options: Intl.DateTimeFormatOptions,
  fallbackTimestamp = timestamp,
  locale?: string
): string {
  try {
    return new Date(timestamp).toLocaleString(locale, options);
  } catch {
    return new Date(fallbackTimestamp).toISOString();
  }
}

// timeAgo and formatDate have been moved to time-format.ts to avoid pulling
// i18n-utils → en.json into the content-script bundle via time.ts.

/**
 * Shared duration composition: given whole minutes and three pre-rendered
 * pure-unit strings (days / hours / minutes), pick the shape
 * "1d 2h" | "1d" | "2h 3m" | "2h" | "45m". Lives here (not in time-format.ts)
 * so the content-script-safe plain formatter and the localized one in
 * time-format.ts are structurally guaranteed to produce identical shapes -
 * only the unit strings differ.
 */
export function composeDuration(
  minutes: number,
  day: string,
  hour: string,
  minute: string
): string {
  if (minutes >= 1440) {
    const hours = Math.floor((minutes % 1440) / 60);
    return hours > 0 ? `${day} ${hour}` : day;
  }
  if (minutes >= 60) {
    const mins = minutes % 60;
    return mins > 0 ? `${hour} ${minute}` : hour;
  }
  return minute;
}

/** Days/hours/minutes components for the composeDuration shape rules. */
export function durationParts(minutes: number): { day: number; hour: number; minute: number } {
  return {
    day: Math.floor(minutes / 1440),
    hour: Math.floor((minutes % 1440) / 60),
    minute: minutes % 60,
  };
}

/**
 * Format a remaining/elapsed duration in whole minutes as "1d 2h", "2h 3m",
 * "2h" or "45m" (shared by expiry/auto-renew displays in list components).
 *
 * Plain ASCII units - intentionally dependency-free so content scripts can
 * use it. UI surfaces should prefer `formatDurationRemaining` from
 * time-format.ts, which renders the same shapes with localized units.
 */
export function formatTimeRemaining(minutes: number): string {
  const { day, hour, minute } = durationParts(minutes);
  return composeDuration(minutes, `${day}d`, `${hour}h`, `${minute}m`);
}

export function formatTimeLeft(ms: number): string {
  if (!ms || ms <= 0) return '';
  const minutes = Math.ceil(ms / 60000);
  return formatTimeRemaining(minutes);
}

/**
 * A debounced function with explicit lifecycle controls. `flush` runs the
 * pending invocation immediately (with the latest args); `cancel` drops it.
 */
export interface Debounced<F extends (...args: never[]) => unknown> {
  (...args: Parameters<F>): void;
  flush: () => void;
  cancel: () => void;
}

/**
 * Simple debounce helper to rate-limit execution of a function.
 */
// `never[]` (contravariance-safe) so functions with typed parameters satisfy
// the constraint while `Parameters<F>` still preserves their real signatures.
export function debounce<F extends (...args: never[]) => unknown>(
  fn: F,
  wait: number
): Debounced<F> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latestArgs: Parameters<F> | null = null;
  const invoke = (): void => {
    timer = null;
    const args = latestArgs;
    latestArgs = null;
    if (args) fn(...args);
  };
  const debounced = ((...args: Parameters<F>): void => {
    latestArgs = args;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(invoke, wait);
  }) as Debounced<F>;
  debounced.flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      invoke();
    }
  };
  debounced.cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    latestArgs = null;
  };
  return debounced;
}
