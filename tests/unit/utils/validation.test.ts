import { describe, expect, test } from 'bun:test';
import { validateEmail, validateURL } from '@/utils/validation';

describe('validateEmail', () => {
  test('returns true for valid email addresses', () => {
    expect(validateEmail('test@example.com')).toBe(true);
    expect(validateEmail('user.name@domain.co.uk')).toBe(true);
    expect(validateEmail('user+tag@example.org')).toBe(true);
  });

  test('returns false for invalid email addresses', () => {
    expect(validateEmail('invalid')).toBe(false);
    expect(validateEmail('@example.com')).toBe(false);
    expect(validateEmail('test@')).toBe(false);
    expect(validateEmail('')).toBe(false);
  });
});

describe('validateURL', () => {
  test('throws error for valid URLs', () => {
    expect(() => validateURL('https://example.com')).not.toThrow();
    expect(() => validateURL('http://example.com')).not.toThrow();
    expect(() => validateURL('https://example.com/path')).not.toThrow();
  });

  test('throws error for invalid URLs', () => {
    expect(() => validateURL('not-a-url')).toThrow();
    expect(() => validateURL('')).toThrow();
    expect(() => validateURL('example.com')).toThrow();
  });
});
