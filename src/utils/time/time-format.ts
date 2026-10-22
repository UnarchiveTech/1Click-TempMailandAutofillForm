/**
 * Time formatting helpers that require synchronous translations (tSync).
 *
 * This module is separate from `time.ts` to avoid pulling `i18n-utils.js`
 * (which statically imports the full `en.json`, 139,001 bytes) into the
 * content-script bundle. The content script only needs `toMs` / `isMs` / `formatTimeLeft` from
 * `time.ts`, none of which require translations.
 *
 * This module is also part of the background graph, so it must import the
 * minimal background locale module rather than the full-dictionary one -
 * otherwise the whole UI dictionary set would be inlined into background.js.
 */

import { getCachedLocale, tSync } from '../i18n/i18n-background.js';
import { pluralKey } from '../i18n/i18n-plural.js';
import { composeDuration, durationParts, toMs } from './time.js';

/**
 * Localized remaining/elapsed duration - the i18n counterpart of
 * `formatTimeRemaining` (time.ts). Uses the shared `composeDuration` shape
 * rules, so output differs from the plain formatter ONLY in the unit strings
 * ("1d 2h" in English, "1天2小时" in zh, "1 T 2 Std." in de, …). UI surfaces
 * should prefer these; content scripts keep using the plain ASCII form.
 */
export function formatDurationRemaining(minutes: number): string {
  const { day, hour, minute } = durationParts(minutes);
  return composeDuration(
    minutes,
    tSync('time.durationD', { d: day }),
    tSync('time.durationH', { h: hour }),
    tSync('time.durationM', { m: minute })
  );
}

/** Localized `formatTimeLeft`: empty string for falsy/negative input. */
export function formatDurationLeft(ms: number): string {
  if (!ms || ms <= 0) return '';
  return formatDurationRemaining(Math.ceil(ms / 60000));
}

/**
 * Localized millisecond reading (“42 ms”). The single home for the `ms` unit -
 * a view must never spell `${value}ms` itself, so a locale that typographs the
 * unit differently can, and two call sites cannot drift on rounding.
 */
export function formatMilliseconds(ms: number): string {
  return tSync('time.milliseconds', { n: Math.round(ms) });
}

/**
 * Compact localized countdown/remaining duration from a millisecond delta:
 * seconds → minutes → hours (with minutes) → days (with hours). The single home
 * for the `s`/`m`/`h`/`d` unit tokens. Zero or negative input renders zero
 * seconds; non-finite input is treated as zero.
 */
export function formatCompactDuration(ms: number): string {
  const safeMs = Number.isFinite(ms) ? ms : 0;
  if (safeMs <= 0) return tSync('time.durationS', { s: 0 });
  const totalSeconds = Math.floor(safeMs / 1000);
  if (totalSeconds < 60) return tSync('time.durationS', { s: totalSeconds });
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return tSync('time.durationM', { m: totalMinutes });
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    const m = totalMinutes % 60;
    return m > 0
      ? tSync('time.durationHM', { h: totalHours, m })
      : tSync('time.durationH', { h: totalHours });
  }
  const d = Math.floor(totalHours / 24);
  const h = totalHours % 24;
  return h > 0 ? tSync('time.durationDH', { d, h }) : tSync('time.durationD', { d });
}

export function timeAgo(timestamp: number, now = Date.now()): string {
  if (!timestamp) return '';
  const secondsPast = (now - toMs(timestamp)) / 1000;
  if (secondsPast < 0) return tSync('time.justNow');
  if (secondsPast < 60) {
    const n = Math.round(secondsPast);
    const key = pluralKey({ oneKey: 'time.secondsAgo', otherKey: 'time.secondsAgoPlural' }, n);
    return key === 'time.secondsAgo'
      ? tSync('time.secondsAgo', { n })
      : tSync('time.secondsAgoPlural', { n });
  }
  if (secondsPast < 3600) {
    const n = Math.round(secondsPast / 60);
    const key = pluralKey({ oneKey: 'time.minutesAgo', otherKey: 'time.minutesAgoPlural' }, n);
    return key === 'time.minutesAgo'
      ? tSync('time.minutesAgo', { n })
      : tSync('time.minutesAgoPlural', { n });
  }
  if (secondsPast <= 86400) {
    const n = Math.round(secondsPast / 3600);
    const key = pluralKey({ oneKey: 'time.hoursAgo', otherKey: 'time.hoursAgoPlural' }, n);
    return key === 'time.hoursAgo'
      ? tSync('time.hoursAgo', { n })
      : tSync('time.hoursAgoPlural', { n });
  }
  return tSync('time.daysAgoLong', { n: Math.round(secondsPast / 86400) });
}

/**
 * Full, absolute date + time (e.g. "Aug 7, 2026, 4:32 PM") in the user's
 * locale - used as hover tooltip text over relative "x ago" labels so the
 * exact received moment is always one hover away.
 */
export function formatFullDateTime(ts: number | null | undefined): string {
  if (!ts) return '';
  const date = new Date(toMs(ts));
  if (Number.isNaN(date.getTime())) return '';
  const locale = getCachedLocale();
  try {
    return date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return date.toLocaleString(locale);
  }
}

/**
 * `YYYY-MM-DD` stamp in the user's LOCAL calendar - the correct basis for
 * anything a human associates with "today" (export filenames, default names).
 * `new Date().toISOString()` is UTC, so an export clicked between 00:00 and
 * the timezone offset past midnight was stamped with YESTERDAY's date.
 */
export function localDateStamp(date: Date = new Date()): string {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function formatDate(ts: number | string): string {
  if (!ts) return tSync('time.never');
  // Normalize epoch-SECONDS timestamps (some providers return Unix seconds)
  // to milliseconds, matching timeAgo()/formatFullDateTime(). String inputs
  // are ISO date strings and pass through to new Date() untouched.
  if (typeof ts === 'number' && Number.isNaN(ts)) return tSync('time.never');
  const date = typeof ts === 'number' ? new Date(toMs(ts)) : new Date(ts);
  if (Number.isNaN(date.getTime())) return tSync('time.never');
  const now = new Date();
  // Use UTC to compute the diff of local calendar dates so that
  // daylight saving time (DST) transitions don't alter the exact 24h gap
  const startOfToday = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.round((startOfToday - startOfDate) / 86400000);
  if (diff === 0) return tSync('time.today');
  if (diff === 1) return tSync('time.yesterday');
  if (diff > 1 && diff <= 7) return tSync('time.daysAgoLong', { n: diff });
  return date.toLocaleDateString(getCachedLocale());
}
