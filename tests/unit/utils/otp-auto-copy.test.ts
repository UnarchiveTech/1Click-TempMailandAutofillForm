/**
 * Unit tests for the shared per-site OTP auto-copy helpers.
 *
 * The full orchestration (`maybeAutoCopyOtp`) needs browser.storage, so it's
 * covered end-to-end by the Playwright e2e (otp-auto-copy.e2e.ts); here we pin
 * the pure decision logic that both the background and demo paths rely on.
 */
import { describe, expect, test } from 'bun:test';
import { isDomainAutoCopyListed, senderDomainOf } from '@/utils/otp/otp-auto-copy.js';

describe('senderDomainOf', () => {
  test('extracts the domain from a bare address', () => {
    expect(senderDomainOf('security@github.com')).toBe('github.com');
  });

  test('extracts the domain from a display-name address', () => {
    expect(senderDomainOf('GitHub <noreply@github.com>')).toBe('github.com');
  });

  test('normalizes case and strips www', () => {
    expect(senderDomainOf('no-reply@WWW.Apple.com')).toBe('apple.com');
  });

  test('returns empty string for senders without an address', () => {
    expect(senderDomainOf('')).toBe('');
    expect(senderDomainOf('just a name')).toBe('');
  });
});

describe('isDomainAutoCopyListed', () => {
  test('matches case-insensitively against the stored list', () => {
    expect(isDomainAutoCopyListed(['github.com', 'apple.com'], 'GitHub.com')).toBe(true);
    expect(isDomainAutoCopyListed(['github.com'], 'github.com')).toBe(true);
  });

  test('rejects domains not on the list', () => {
    expect(isDomainAutoCopyListed(['github.com'], 'paypal.com')).toBe(false);
    expect(isDomainAutoCopyListed([], 'github.com')).toBe(false);
  });

  test('rejects missing lists and empty domains safely', () => {
    expect(isDomainAutoCopyListed(undefined, 'github.com')).toBe(false);
    expect(isDomainAutoCopyListed(['github.com'], '')).toBe(false);
    expect(isDomainAutoCopyListed(['github.com'], undefined as unknown as string)).toBe(false);
  });
});
