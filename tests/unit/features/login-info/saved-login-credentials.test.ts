import { afterAll, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// saved-login-credentials.ts transitively imports `browser` from wxt/browser (via crypto /
// intelligence/storage / logger). Provide an in-memory mock so the module loads.
const store: Record<string, unknown> = {};
mock.module('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: async (keys?: string | string[] | null) => {
          if (keys === null || keys === undefined) return { ...store };
          const arr = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of arr) if (k in store) out[k] = store[k];
          return out;
        },
        set: async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        },
      },
    },
    runtime: { id: 'ext' },
  },
}));

const { normalizeDomain, domainMatchesHost, looksLikeCiphertext } = await import(
  '@/features/login-info/saved-login-credentials'
);

describe('normalizeDomain', () => {
  test('strips protocol, port (at end), path, www, lowercases', () => {
    expect(normalizeDomain('https://www.Example.com:443')).toBe('example.com');
    expect(normalizeDomain('https://www.Example.com/inbox')).toBe('example.com');
  });
  test('keeps subdomains (only strips leading www)', () => {
    expect(normalizeDomain('WWW.Mail.Example.com')).toBe('mail.example.com');
  });
  test('passes through a bare domain', () => {
    expect(normalizeDomain('example.com')).toBe('example.com');
  });
  test('handles multi-level TLDs verbatim', () => {
    expect(normalizeDomain('https://a.b.co.uk/x')).toBe('a.b.co.uk');
  });
  test('empty / whitespace → empty', () => {
    expect(normalizeDomain('')).toBe('');
    expect(normalizeDomain('   ')).toBe('');
  });
});

describe('domainMatchesHost', () => {
  test('exact host match', () => {
    expect(domainMatchesHost('example.com', 'example.com')).toBe(true);
  });
  test('a subdomain credential does not flow upward to its parent', () => {
    expect(domainMatchesHost('mail.example.com', 'example.com')).toBe(false);
  });
  test('reverse: host subdomain matches item', () => {
    expect(domainMatchesHost('example.com', 'mail.example.com')).toBe(true);
  });
  test('unrelated hosts do not match', () => {
    expect(domainMatchesHost('example.com', 'other.com')).toBe(false);
  });
  test('normalizes protocol/port before comparing', () => {
    expect(domainMatchesHost('https://www.example.com:443', 'http://example.com')).toBe(true);
  });
  test('empty operand → false', () => {
    expect(domainMatchesHost('', 'example.com')).toBe(false);
    expect(domainMatchesHost('example.com', '')).toBe(false);
  });
  test('does not cross-match unrelated subdomains', () => {
    expect(domainMatchesHost('login.example.com', 'mail.example.com')).toBe(false);
  });

  test('never suffix-matches across a public suffix / shared host', () => {
    // A credential saved for the bare shared host must not be offered to any
    // third-party subdomain, and a page on a shared-host subdomain must not be
    // able to claim the bare host.
    expect(domainMatchesHost('user.github.io', 'github.io')).toBe(false);
    expect(domainMatchesHost('github.io', 'user.github.io')).toBe(false);
    expect(domainMatchesHost('evil.github.io', 'github.io')).toBe(false);
    expect(domainMatchesHost('myapp.vercel.app', 'vercel.app')).toBe(false);
    expect(domainMatchesHost('shop.example.co.uk', 'co.uk')).toBe(false);
    expect(domainMatchesHost('co.uk', 'shop.example.co.uk')).toBe(false);
  });

  test('exact match on a public suffix is still allowed', () => {
    expect(domainMatchesHost('github.io', 'github.io')).toBe(true);
  });

  test('a parent credential flows down to subdomains, including multi-label suffixes', () => {
    expect(domainMatchesHost('mail.example.com', 'example.com')).toBe(false);
    expect(domainMatchesHost('example.com', 'mail.example.com')).toBe(true);
    // A real domain inside a public suffix is a registrable boundary:
    expect(domainMatchesHost('mail.example.co.uk', 'example.co.uk')).toBe(false);
    expect(domainMatchesHost('example.co.uk', 'mail.example.co.uk')).toBe(true);
  });
});

describe('looksLikeCiphertext', () => {
  test('short values are not ciphertext', () => {
    expect(looksLikeCiphertext('short')).toBe(false);
    expect(looksLikeCiphertext('a'.repeat(39))).toBe(false);
  });
  test('real passwords with spaces/punctuation are not ciphertext', () => {
    expect(looksLikeCiphertext('Correct horse battery staple! 1234567890')).toBe(false);
  });
  test('base64 of printable ASCII is NOT flagged (decodes to ASCII)', () => {
    // 50 printable 'a' chars → base64 ≥40, but decodes back to all-printable
    expect(looksLikeCiphertext(btoa('a'.repeat(50)))).toBe(false);
  });
  test('base64 of binary (non-printable) IS flagged as ciphertext', () => {
    // 66 zero bytes → 88 'A' base64 chars, decodes to all-non-printable
    expect(looksLikeCiphertext(btoa('\x00'.repeat(66)))).toBe(true);
  });
  test('non-base64 string (even if long) is not ciphertext', () => {
    expect(looksLikeCiphertext('!@#$%^&*()'.repeat(10))).toBe(false);
  });
});
