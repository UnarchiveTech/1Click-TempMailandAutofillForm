import { beforeAll, describe, expect, test } from 'bun:test';
import { setCachedLocale } from '@/utils/i18n/i18n-background.js';
import { t } from '@/utils/i18n/i18n-utils';
import { formatLocalDateTime, formatTimeLeft, formatTimeRemaining } from '@/utils/time/time';
import {
  formatCompactDuration,
  formatDate,
  formatDurationLeft,
  formatDurationRemaining,
  formatMilliseconds,
  timeAgo,
} from '@/utils/time/time-format';

beforeAll(async () => {
  await t('time.secondsAgo');
  // Preload the duration keys so tSync resolves in formatDuration* tests.
  await t('time.durationDH');
  await t('time.durationHM');
  await t('time.durationD');
  await t('time.durationH');
  await t('time.durationM');
  await t('time.durationS');
  await t('time.milliseconds');
});

describe('timeAgo', () => {
  test('returns empty string for falsy timestamp', () => {
    expect(timeAgo(0)).toBe('');
    expect(timeAgo(null as unknown as number)).toBe('');
  });

  test('returns seconds ago for recent timestamps', () => {
    const now = Date.now();
    const timestamp = Math.floor((now - 30000) / 1000); // 30 seconds ago
    const result = timeAgo(timestamp);
    expect(result).toMatch(/\d+ seconds ago/); // Match any seconds ago
  });

  test('returns minutes ago for timestamps within an hour', () => {
    const now = Date.now();
    const timestamp = Math.floor((now - 1800000) / 1000); // 30 minutes ago
    expect(timeAgo(timestamp)).toBe('30 minutes ago');
  });

  test('returns hours ago for timestamps within a day', () => {
    const now = Date.now();
    const timestamp = Math.floor((now - 7200000) / 1000); // 2 hours ago
    expect(timeAgo(timestamp)).toBe('2 hours ago');
  });

  test('returns days ago for timestamps over a day', () => {
    const now = Date.now();
    const timestamp = Math.floor((now - 172800000) / 1000); // 2 days ago
    expect(timeAgo(timestamp)).toBe('2 days ago');
  });

  test('uses an injected current time for reactive callers', () => {
    const now = Date.UTC(2026, 0, 10);
    expect(timeAgo(now - 172800000, now)).toBe('2 days ago');
  });
});

describe('formatDate', () => {
  test('formats older absolute dates with the selected locale', () => {
    const timestamp = Date.UTC(2020, 0, 2, 12);
    try {
      setCachedLocale('ja');
      expect(formatDate(timestamp)).toBe(new Date(timestamp).toLocaleDateString('ja'));
    } finally {
      setCachedLocale('en');
    }
  });

  test('returns Never for falsy timestamp', () => {
    expect(formatDate(0)).toBe('Never');
    expect(formatDate(null as unknown as string)).toBe('Never');
  });

  test('returns Today for today', () => {
    const today = new Date();
    expect(formatDate(today.toISOString())).toBe('Today');
  });

  test('returns Yesterday for yesterday', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(formatDate(yesterday.toISOString())).toBe('Yesterday');
  });

  test('returns days ago for within a week', () => {
    const date = new Date();
    date.setDate(date.getDate() - 3);
    expect(formatDate(date.toISOString())).toBe('3 days ago');
  });

  test('returns locale date string for older dates', () => {
    const date = new Date();
    date.setDate(date.getDate() - 10);
    expect(formatDate(date.toISOString())).toBe(date.toLocaleDateString());
  });
});

describe('formatLocalDateTime', () => {
  test('accepts the selected locale while preserving runtime-locale default behavior', () => {
    const timestamp = Date.UTC(2020, 0, 2, 12);
    const options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };
    expect(formatLocalDateTime(timestamp, options, timestamp, 'ja')).toBe(
      new Date(timestamp).toLocaleString('ja', options)
    );
  });
});

describe('formatDurationRemaining (localized)', () => {
  test('byte-parity: English units render identically to the plain formatter', () => {
    // composeDuration is shared, so under the en locale the localized and
    // plain formatters must agree exactly - this pins the shape contract
    // ("1d 2h" | "1d" | "2h 3m" | "2h" | "45m") against formatter drift.
    for (const minutes of [0, 1, 45, 59, 60, 119, 120, 1439, 1440, 1500, 2880, 4469]) {
      expect(formatDurationRemaining(minutes)).toBe(formatTimeRemaining(minutes));
    }
  });

  test('shape rules match the plain formatter at the boundaries', () => {
    expect(formatDurationRemaining(1440)).toBe('1d');
    // Sub-hour remainders are dropped at the day tier (same as plain).
    expect(formatDurationRemaining(1441)).toBe('1d');
    expect(formatDurationRemaining(1500)).toBe('1d 1h');
    expect(formatDurationRemaining(60)).toBe('1h');
    expect(formatDurationRemaining(90)).toBe('1h 30m');
  });
});

describe('formatDurationLeft (localized)', () => {
  test('returns empty string for falsy or negative milliseconds', () => {
    expect(formatDurationLeft(0)).toBe('');
    expect(formatDurationLeft(-1000)).toBe('');
  });
  test('byte-parity with formatTimeLeft under the en locale', () => {
    expect(formatDurationLeft(3600000 + 1800000)).toBe(formatTimeLeft(3600000 + 1800000));
    expect(formatDurationLeft(300000)).toBe('5m');
  });
});

describe('formatMilliseconds (localized)', () => {
  test('renders the ms unit from the time locale key', () => {
    expect(formatMilliseconds(0)).toBe('0 ms');
    expect(formatMilliseconds(42)).toBe('42 ms');
    // Rounds to a whole millisecond (latency samples are fractional).
    expect(formatMilliseconds(119.6)).toBe('120 ms');
  });
});

describe('formatCompactDuration (localized)', () => {
  test('zero or negative input renders zero seconds', () => {
    expect(formatCompactDuration(0)).toBe('0s');
    expect(formatCompactDuration(-5000)).toBe('0s');
    expect(formatCompactDuration(Number.NaN)).toBe('0s');
  });

  test('picks the largest whole unit and keeps the finer remainder', () => {
    expect(formatCompactDuration(45_000)).toBe('45s');
    expect(formatCompactDuration(5 * 60_000)).toBe('5m');
    expect(formatCompactDuration(90 * 60_000)).toBe('1h 30m');
    expect(formatCompactDuration(2 * 3_600_000)).toBe('2h');
    expect(formatCompactDuration(30 * 3_600_000)).toBe('1d 6h');
    expect(formatCompactDuration(48 * 3_600_000)).toBe('2d');
  });
});

describe('formatTimeLeft', () => {
  test('returns empty string for falsy or negative milliseconds (caller localizes Expired)', () => {
    expect(formatTimeLeft(0)).toBe('');
    expect(formatTimeLeft(-1000)).toBe('');
  });

  test('returns formatted time with hours and minutes (consistent Xh Ym style)', () => {
    expect(formatTimeLeft(3600000 + 1800000)).toBe('1h 30m'); // 1h 30m
    expect(formatTimeLeft(7200000 + 30000)).toBe('2h 1m'); // 2h + 30s ceil to next minute
  });

  test('returns minutes only for less than an hour', () => {
    expect(formatTimeLeft(1800000)).toBe('30m'); // 30 minutes
    expect(formatTimeLeft(300000)).toBe('5m'); // 5 minutes
  });
});

describe('formatTimeRemaining', () => {
  test('formats whole minutes under an hour', () => {
    expect(formatTimeRemaining(45)).toBe('45m');
    expect(formatTimeRemaining(0)).toBe('0m');
  });

  test('formats hours with a minute remainder', () => {
    expect(formatTimeRemaining(123)).toBe('2h 3m');
  });

  test('drops the minute remainder when minutes are zero', () => {
    expect(formatTimeRemaining(120)).toBe('2h');
    expect(formatTimeRemaining(180)).toBe('3h');
  });

  test('rolls 24h+ into days', () => {
    expect(formatTimeRemaining(1440)).toBe('1d');
    expect(formatTimeRemaining(1500)).toBe('1d 1h');
    expect(formatTimeRemaining(1560)).toBe('1d 2h');
    expect(formatTimeRemaining(2880)).toBe('2d');
  });
});
