import { describe, expect, test } from 'bun:test';
import { matchKindFromTextExport } from './a11y-test-helpers.js';

// Pure text matching (no DOM) - classifyFieldA11y needs document in real env
describe('a11y field text matching', () => {
  test('detects email wording', () => {
    expect(matchKindFromTextExport('your email address')?.kind).toBe('email');
  });
  test('detects phone wording', () => {
    expect(matchKindFromTextExport('mobile phone number')?.kind).toBe('phone');
  });
  test('detects password wording', () => {
    expect(matchKindFromTextExport('create a password')?.kind).toBe('password');
  });
  test('returns null for empty', () => {
    expect(matchKindFromTextExport('')).toBeNull();
  });

  test('classifies actual labels across supported languages without a runtime bridge', () => {
    for (const label of [
      'Correo electrónico',
      'Courriel',
      'メール',
      '邮箱',
      'อีเมล',
      'البريد الإلكتروني',
    ]) {
      expect(matchKindFromTextExport(label)?.kind).toBe('email');
    }
    for (const label of ['Passwort', 'Contraseña', 'パスワード', 'รหัสผ่าน']) {
      expect(matchKindFromTextExport(label)?.kind).toBe('password');
    }
  });

  test('keeps specific name and email signals ahead of generic address/name matches', () => {
    expect(matchKindFromTextExport('email address')?.kind).toBe('email');
    expect(matchKindFromTextExport('username')?.kind).toBe('username');
    expect(matchKindFromTextExport('firstName')?.kind).toBe('firstName');
    expect(matchKindFromTextExport('family_name')?.kind).toBe('lastName');
    expect(matchKindFromTextExport('Full name')?.kind).toBe('fullName');
    expect(matchKindFromTextExport('Postal code')?.kind).toBe('pin');
    expect(matchKindFromTextExport('Street address')?.kind).toBe('address');
    expect(matchKindFromTextExport('company name')).toBeNull();
    expect(matchKindFromTextExport('unrelated words')).toBeNull();
    expect(matchKindFromTextExport('   ')).toBeNull();
  });
});
