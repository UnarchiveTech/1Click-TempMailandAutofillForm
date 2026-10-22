import { describe, expect, test } from 'bun:test';
import {
  otpRecipientMatches,
  waitPanelRecipientMatches,
} from '@/entrypoints/content/otp/otp-recipient.js';

describe('otpRecipientMatches', () => {
  test('accepts when there is no expected recipient (unknown address)', () => {
    expect(otpRecipientMatches('', 'a@x.com')).toBe(true);
    expect(otpRecipientMatches('   ', undefined)).toBe(true);
  });

  test('accepts when the incoming message has no recipient tag (legacy senders)', () => {
    expect(otpRecipientMatches('a@x.com', undefined)).toBe(true);
    expect(otpRecipientMatches('a@x.com', '')).toBe(true);
    expect(otpRecipientMatches('a@x.com', null)).toBe(true);
  });

  test('accepts exact case-insensitive address match', () => {
    expect(otpRecipientMatches('User@Example.com', 'user@example.com')).toBe(true);
    expect(otpRecipientMatches('user@example.com', 'USER@EXAMPLE.COM')).toBe(true);
  });

  test('rejects a code addressed to a different inbox', () => {
    expect(otpRecipientMatches('user1@example.com', 'user2@example.com')).toBe(false);
  });

  test('rejects a code addressed to a different address on the same domain', () => {
    expect(otpRecipientMatches('a@example.com', 'b@example.com')).toBe(false);
  });

  test('accepts RFC 5322 display-name recipient forms', () => {
    expect(otpRecipientMatches('user@example.com', 'User Name <user@example.com>')).toBe(true);
    expect(otpRecipientMatches('User Name <user@example.com>', 'user@example.com')).toBe(true);
    expect(otpRecipientMatches('"Acme Mail" <user@example.com>', 'USER@example.com')).toBe(true);
  });

  test('still rejects a bracketed address for a different inbox', () => {
    expect(otpRecipientMatches('user1@example.com', 'Other <user2@example.com>')).toBe(false);
  });

  test('wait panel requires a known expected and incoming recipient', () => {
    expect(waitPanelRecipientMatches('', 'user@example.com')).toBe(false);
    expect(waitPanelRecipientMatches('user@example.com', '')).toBe(false);
    expect(waitPanelRecipientMatches('user@example.com', undefined)).toBe(false);
    expect(waitPanelRecipientMatches('user@example.com', 'user@example.com')).toBe(true);
    expect(waitPanelRecipientMatches('user@example.com', 'other@example.com')).toBe(false);
  });
});
