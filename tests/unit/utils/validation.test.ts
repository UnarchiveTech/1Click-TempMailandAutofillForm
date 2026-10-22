import { describe, expect, test } from 'bun:test';
import { CONSTANTS } from '@/utils/constants';
import { ValidationError } from '@/utils/errors';
import {
  domainsShareRegistrableSite,
  domainsShareSiteBoundary,
  hostMatchesDomainScope,
  isPublicSuffix,
  normalizeDomain,
  validateEmail,
  validateTextInput,
  validateURL,
  validateUsername,
} from '@/utils/validation';

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

/**
 * The dialogs render these failures in a visible error paragraph, so each rule
 * must carry a stable `errors.*` key (and the values its slots need) instead of
 * letting the English `message` - which is for the log - reach the screen.
 */
describe('validation rules carry renderable locale keys', () => {
  function caughtFrom(run: () => void): ValidationError {
    let caught: unknown;
    try {
      run();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    return caught as ValidationError;
  }

  test('validateUsername maps each reachable rule to its key', () => {
    expect(caughtFrom(() => validateUsername('')).translationKey).toBe(
      'errors.validationUsernameEmpty'
    );
    expect(
      caughtFrom(() => validateUsername('x'.repeat(CONSTANTS.USERNAME_MAX_LENGTH + 1)))
        .translationKey
    ).toBe('errors.validationUsernameMaxLength');
    expect(caughtFrom(() => validateUsername('bad name!')).translationKey).toBe(
      'errors.validationUsernameCharset'
    );
  });

  test('the min-length rule is shadowed while the floor is <= 1', () => {
    // With a floor of 1 the empty check catches every string the min rule
    // could, so `errors.validationUsernameMinLength` is unreachable. This
    // expectation is the tripwire: raise the floor and the test fails, which is
    // the signal to add the min-length case to the mapping test above.
    expect(CONSTANTS.USERNAME_MIN_LENGTH).toBeLessThanOrEqual(1);
  });

  test('a length rule ships the value its slot needs, matching its message', () => {
    const tooLong = caughtFrom(() =>
      validateUsername('x'.repeat(CONSTANTS.USERNAME_MAX_LENGTH + 1))
    );
    expect(tooLong.translationValues).toEqual({ max: CONSTANTS.USERNAME_MAX_LENGTH });
    // `{max}` must be the same number the English message quotes, so the two
    // cannot drift apart when the constant changes.
    expect(tooLong.message).toContain(String(tooLong.translationValues?.max));
  });

  test('validateTextInput pairs {field} and {max} with the caller’s label', () => {
    const err = caughtFrom(() => validateTextInput('x'.repeat(40), 'Add tag', 32));

    expect(err.translationKey).toBe('errors.validationTextTooLong');
    expect(err.translationValues).toEqual({ field: 'Add tag', max: 32 });
  });
});

describe('normalizeDomain', () => {
  test('strips protocol, port, path, query, fragment, and www', () => {
    expect(normalizeDomain('http://example.com:8080#section')).toBe('example.com');
    expect(normalizeDomain('https://www.Example.com:8443/path?q=1#frag')).toBe('example.com');
    expect(normalizeDomain('example.com:8080')).toBe('example.com');
    expect(normalizeDomain('HTTP://EXAMPLE.COM/')).toBe('example.com');
    expect(normalizeDomain('  https://example.com  ')).toBe('example.com');
    expect(normalizeDomain('example.com')).toBe('example.com');
  });
});

describe('isPublicSuffix', () => {
  test('recognizes shared hosts and multi-label public suffixes', () => {
    expect(isPublicSuffix('github.io')).toBe(true);
    expect(isPublicSuffix('pages.dev')).toBe(true);
    expect(isPublicSuffix('co.uk')).toBe(true);
    expect(isPublicSuffix('com')).toBe(true);
  });

  test('does not flag real registrable domains, even inside a public suffix', () => {
    expect(isPublicSuffix('example.com')).toBe(false);
    expect(isPublicSuffix('user.github.io')).toBe(false);
    expect(isPublicSuffix('example.co.uk')).toBe(false);
    expect(isPublicSuffix('mail.example.com')).toBe(false);
  });

  test('is case-insensitive and trims whitespace', () => {
    expect(isPublicSuffix('GITHUB.IO')).toBe(true);
    expect(isPublicSuffix('  Co.UK ')).toBe(true);
  });
});

describe('domain scope matching', () => {
  test('matches exact hosts and descendants in the configured direction only', () => {
    expect(hostMatchesDomainScope('example.com', 'example.com')).toBe(true);
    expect(hostMatchesDomainScope('login.example.com', 'example.com')).toBe(true);
    expect(hostMatchesDomainScope('example.com', 'login.example.com')).toBe(false);
    expect(hostMatchesDomainScope('notexample.com', 'example.com')).toBe(false);
    expect(domainsShareSiteBoundary('shop.example.com', 'accounts.example.com')).toBe(false);
    expect(domainsShareRegistrableSite('shop.example.com', 'accounts.example.com')).toBe(true);
  });

  test('does not let a public suffix authorize unrelated tenants', () => {
    expect(hostMatchesDomainScope('a.github.io', 'github.io')).toBe(false);
    expect(hostMatchesDomainScope('github.io', 'github.io')).toBe(true);
    expect(domainsShareSiteBoundary('a.github.io', 'b.github.io')).toBe(false);
    expect(domainsShareSiteBoundary('a.customer.github.io', 'customer.github.io')).toBe(true);
    expect(domainsShareRegistrableSite('a.github.io', 'b.github.io')).toBe(false);
    expect(domainsShareRegistrableSite('a.customer.github.io', 'b.customer.github.io')).toBe(true);
    expect(domainsShareSiteBoundary('login.example.co.uk', 'example.co.uk')).toBe(true);
    expect(domainsShareSiteBoundary('a.github.io', 'github.io')).toBe(false);
  });

  test('accepts URL-like scopes and rejects malformed values safely', () => {
    expect(hostMatchesDomainScope('https://login.example.com/path', 'www.example.com')).toBe(true);
    expect(hostMatchesDomainScope('example.com', '   ')).toBe(false);
    expect(hostMatchesDomainScope('example.com', 42 as unknown as string)).toBe(false);
  });
});
