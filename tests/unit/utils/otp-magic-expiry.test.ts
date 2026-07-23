import { describe, expect, test } from 'bun:test';
import {
  estimateExpiresAt,
  formatRemaining,
  parseValidityDurationMs,
} from '@/utils/otp-magic-expiry.js';

describe('parseValidityDurationMs', () => {
  test('parses expires in N minutes', () => {
    expect(parseValidityDurationMs('Your code expires in 10 minutes')).toBe(10 * 60_000);
  });

  test('parses valid for N hours', () => {
    expect(parseValidityDurationMs('This link is valid for 2 hours')).toBe(2 * 3_600_000);
  });

  test('returns null when no duration', () => {
    expect(parseValidityDurationMs('Hello friend')).toBeNull();
  });
});

describe('estimateExpiresAt / formatRemaining', () => {
  test('adds duration to receivedAt', () => {
    const base = 1_700_000_000_000;
    const exp = estimateExpiresAt(base, 'Verify', 'expires in 5 minutes');
    expect(exp).toBe(base + 5 * 60_000);
  });

  test('formatRemaining', () => {
    const now = Date.now();
    expect(formatRemaining(now + 90_000, now)).toMatch(/2m|1m/);
    expect(formatRemaining(now - 1000, now)).toBe('expired');
  });
});
