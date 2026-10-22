import { describe, expect, test } from 'bun:test';
import {
  detectPasswordRules,
  generatePassword,
} from '@/entrypoints/content/autofill/generators.js';

describe('password strength match', () => {
  test('generated password meets min length and classes', () => {
    const pw = generatePassword({
      minLength: 14,
      maxLength: 18,
      requireUpper: true,
      requireLower: true,
      requireDigit: true,
      requireSpecial: true,
    });
    expect(pw.length).toBeGreaterThanOrEqual(14);
    expect(/[A-Z]/.test(pw)).toBe(true);
    expect(/[a-z]/.test(pw)).toBe(true);
    expect(/\d/.test(pw)).toBe(true);
  });

  test('can disable special characters', () => {
    const pw = generatePassword({
      minLength: 10,
      maxLength: 12,
      requireSpecial: false,
      requireUpper: true,
      requireLower: true,
      requireDigit: true,
    });
    expect(pw.length).toBeGreaterThanOrEqual(10);
  });

  test('does not require excluded classes for lowercase-and-digits-only sites', () => {
    const field = {
      getAttribute: (name: string) =>
        name === 'title' ? 'Use lowercase letters and digits only' : null,
      placeholder: '',
      name: '',
      id: '',
      minLength: 0,
      maxLength: 0,
      labels: [],
      form: null,
    } as unknown as HTMLInputElement;
    const form = { querySelectorAll: () => [] } as unknown as HTMLElement;
    const rules = detectPasswordRules(field, form);

    expect(rules.requireUpper).toBe(false);
    expect(rules.requireLower).toBe(true);
    expect(rules.requireDigit).toBe(true);
    expect(rules.requireSpecial).toBe(false);

    const password = generatePassword(rules);
    expect(password).toMatch(/^[a-z\d]+$/);
  });
});
