import { describe, expect, test } from 'bun:test';
import {
  clipOtpMetaText,
  isPlausibleOtpCode,
  otpFreshEnough,
} from '@/entrypoints/content/otp/otp-code.js';
import { OTP_FUTURE_SKEW_MS } from '@/utils/otp/otp-cache.js';

describe('isPlausibleOtpCode', () => {
  test('accepts real-world code shapes (digits, alphanumeric, separators, padding)', () => {
    expect(isPlausibleOtpCode('482901')).toBe(true);
    expect(isPlausibleOtpCode('8F3K2L')).toBe(true);
    expect(isPlausibleOtpCode('123-456')).toBe(true); // separator-stripped → 6 digits
    expect(isPlausibleOtpCode(' 482901 ')).toBe(true); // trimmed
    expect(isPlausibleOtpCode('123')).toBe(true); // extractor min is 3
    expect(isPlausibleOtpCode('A1B2C3D4E5F6G7H8')).toBe(true); // 16, upper bound
  });

  test('rejects non-string and empty values', () => {
    expect(isPlausibleOtpCode(undefined)).toBe(false);
    expect(isPlausibleOtpCode(null)).toBe(false);
    expect(isPlausibleOtpCode(482901)).toBe(false);
    expect(isPlausibleOtpCode('')).toBe(false);
    expect(isPlausibleOtpCode('   ')).toBe(false);
  });

  test('rejects too-short / too-long codes', () => {
    expect(isPlausibleOtpCode('12')).toBe(false);
    expect(isPlausibleOtpCode('A1B2C3D4E5F6G7H8X')).toBe(false); // 17 chars
    expect(isPlausibleOtpCode('1'.repeat(5000))).toBe(false);
  });

  test('rejects codes without a digit and non-alphanumeric payloads', () => {
    expect(isPlausibleOtpCode('abcdef')).toBe(false); // letters only - extraction rejects these
    expect(isPlausibleOtpCode('hello world')).toBe(false);
    expect(isPlausibleOtpCode('482901<script>')).toBe(false); // markup can't be a code
    expect(isPlausibleOtpCode('482901\n<b>evil</b>')).toBe(false);
    expect(isPlausibleOtpCode('12 34 56 78 90 12 34 56 78')).toBe(false); // strips to 18 digits
    expect(isPlausibleOtpCode('12345678901234567890')).toBe(false); // 20 digits
  });
});

describe('otpFreshEnough', () => {
  const now = Date.now();

  test('accepts codes received at/after the watch started (ms timestamps)', () => {
    expect(otpFreshEnough(now, now)).toBe(true);
    expect(otpFreshEnough(now + 5000, now)).toBe(true);
  });

  test('accepts codes received just before the watch started (clock-skew slack)', () => {
    expect(otpFreshEnough(now - 1000, now)).toBe(true);
    expect(otpFreshEnough(now - 2000, now)).toBe(true);
  });

  test('accepts seconds timestamps (legacy provider format)', () => {
    expect(otpFreshEnough(Math.floor(now / 1000), now)).toBe(true);
  });

  test('rejects stale codes - an old email must never auto-fill', () => {
    expect(otpFreshEnough(now - 60_000, now)).toBe(false);
    expect(otpFreshEnough(now - 3_600_000, now)).toBe(false);
    expect(otpFreshEnough(now - 2001, now)).toBe(false);
  });

  test('rejects missing / invalid timestamps', () => {
    expect(otpFreshEnough(undefined, now)).toBe(false);
    expect(otpFreshEnough(null, now)).toBe(false);
    expect(otpFreshEnough(0, now)).toBe(false);
    expect(otpFreshEnough(-5, now)).toBe(false);
    expect(otpFreshEnough('2026-01-01', now)).toBe(false);
    expect(otpFreshEnough(Number.NaN, now)).toBe(false);
  });

  test('rejects timestamps beyond the shared future-clock-skew allowance', () => {
    expect(otpFreshEnough(Date.now() + OTP_FUTURE_SKEW_MS + 1, now)).toBe(false);
  });

  test('respects a custom slack', () => {
    expect(otpFreshEnough(now - 5000, now, 10_000)).toBe(true);
    expect(otpFreshEnough(now - 15_000, now, 10_000)).toBe(false);
  });
});

describe('clipOtpMetaText', () => {
  test('passes empty values through untouched', () => {
    expect(clipOtpMetaText(undefined)).toBe('');
    expect(clipOtpMetaText('')).toBe('');
  });

  test('keeps short sender text as-is', () => {
    const sender = 'GitHub <noreply@github.com>';
    expect(clipOtpMetaText(sender)).toBe(sender);
  });

  test('caps attacker-controlled long sender text with an ellipsis', () => {
    const long = 'A'.repeat(200);
    const clipped = clipOtpMetaText(long);
    expect(clipped.length).toBe(60);
    expect(clipped.endsWith('…')).toBe(true);
    expect(clipped.startsWith('A'.repeat(59))).toBe(true);
  });

  test('respects a custom max length', () => {
    const clipped = clipOtpMetaText('1234567890', 5);
    expect(clipped).toBe('1234…');
  });
});
