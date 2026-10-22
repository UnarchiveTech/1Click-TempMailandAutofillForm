import { describe, expect, test } from 'bun:test';
import { formatDate } from '@/utils/time/time-format.js';

describe('formatDate', () => {
  test('treats epoch-seconds timestamps the same as milliseconds', () => {
    const now = Date.now();
    expect(formatDate(Math.floor(now / 1000))).toBe(formatDate(now));
  });

  test('regression: seconds timestamps are not rendered as 1970 dates', () => {
    const todaySecs = Math.floor(Date.now() / 1000);
    const out = formatDate(todaySecs);
    expect(out).not.toMatch(/1970/);
    expect(out).toBe(formatDate(todaySecs * 1000));
  });

  test('a mid-epoch seconds value maps to its real calendar day', () => {
    // 1_723_891_200 is 2024-08-17 in seconds - previously rendered as 1970.
    const secs = 1_723_891_200;
    expect(formatDate(secs)).toBe(formatDate(secs * 1000));
  });

  test('returns "Never" for missing timestamps', () => {
    expect(formatDate(0)).toBe('Never');
    expect(formatDate('')).toBe('Never');
  });
});
