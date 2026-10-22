import { describe, expect, test } from 'bun:test';
import { classifyConflictText } from '@/features/intelligence/conflict-regexes.js';

describe('field-specific conflict classification', () => {
  test('username taken is not an email conflict', () => {
    expect(classifyConflictText('Username already taken')).toBe('username');
    expect(classifyConflictText('This username is already taken.')).toBe('username');
    expect(classifyConflictText('Username not allowed')).toBe('username');
  });
  test('username recovery copy inside a form does not trigger inbox replacement', () => {
    expect(
      classifyConflictText(
        'Email address This username is already taken. Edit username Generate another'
      )
    ).toBe('username');
  });
  test('email failures retain their existing classification', () => {
    expect(classifyConflictText('Email already registered')).toBe('email');
    expect(classifyConflictText('Disposable email not accepted')).toBe('email');
    expect(classifyConflictText('Already taken')).toBe('email');
  });
  test('OTP errors and ordinary help are distinct', () => {
    expect(classifyConflictText('Invalid verification code')).toBe('otp');
    expect(classifyConflictText('Choose a username')).toBeNull();
  });
});
