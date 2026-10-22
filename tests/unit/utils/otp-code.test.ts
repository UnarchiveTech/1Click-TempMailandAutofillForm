import { describe, expect, test } from 'bun:test';
import { isRealOtp, NO_OTP_SENTINEL } from '@/utils/otp/otp-code';

describe('isRealOtp', () => {
  test('accepts real codes', () => {
    expect(isRealOtp('482901')).toBe(true);
    expect(isRealOtp(' 1234 ')).toBe(true);
  });

  test('rejects the no-OTP placeholder', () => {
    expect(isRealOtp(NO_OTP_SENTINEL)).toBe(false);
    expect(NO_OTP_SENTINEL).toBe('------');
  });

  test('rejects empty, whitespace, and non-strings', () => {
    expect(isRealOtp('')).toBe(false);
    expect(isRealOtp('   ')).toBe(false);
    expect(isRealOtp(undefined)).toBe(false);
    expect(isRealOtp(null)).toBe(false);
    expect(isRealOtp(123456)).toBe(false);
  });
});
