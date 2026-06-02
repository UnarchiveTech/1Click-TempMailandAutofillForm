import { beforeEach, describe, expect, test } from 'bun:test';

// ── Mocks must be set up BEFORE importing favicon ───────────────────────────

const localStorageStore: Record<string, string> = {};

const mockLocalStorage = {
  getItem: (key: string) => localStorageStore[key] ?? null,
  setItem: (key: string, value: string) => {
    localStorageStore[key] = value;
  },
  removeItem: (key: string) => {
    delete localStorageStore[key];
  },
  clear: () => {
    for (const key of Object.keys(localStorageStore)) delete localStorageStore[key];
  },
  get length() {
    return Object.keys(localStorageStore).length;
  },
  key: (index: number) => Object.keys(localStorageStore)[index] ?? null,
};

(globalThis as Record<string, unknown>).localStorage = mockLocalStorage;
(globalThis as Record<string, unknown>).browser = {
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
    },
    onChanged: {
      addListener: () => {},
    },
  },
  runtime: {
    sendMessage: async () => ({ success: false }),
  },
};

// ── Import after mocks ──────────────────────────────────────────────────────

import {
  CACHE_DURATION,
  FAVICON_CACHE_KEY,
  FAVICON_ERROR_CACHE_KEY,
  GOOGLE_DEFAULT_HASH,
  getDomainFaviconUrl,
  getDomainFromEmail,
  getFaviconCache,
  getFaviconCacheStats,
  getFaviconErrorCache,
  getFaviconUrl,
  getGoogleFaviconUrl,
  getRootDomain,
  getRootDomainFaviconUrl,
  getStrippedDomain,
} from './favicon';

beforeEach(() => {
  for (const key of Object.keys(localStorageStore)) delete localStorageStore[key];
});

// ── getDomainFromEmail ──────────────────────────────────────────────────────

describe('getDomainFromEmail', () => {
  test('extracts domain from email address', () => {
    expect(getDomainFromEmail('user@example.com')).toBe('example.com');
  });

  test('handles subdomains', () => {
    expect(getDomainFromEmail('user@mail.example.com')).toBe('mail.example.com');
  });

  test('returns empty string for invalid email', () => {
    expect(getDomainFromEmail('no-at-sign')).toBe('');
  });

  test('handles single @ sign', () => {
    expect(getDomainFromEmail('@domain.com')).toBe('domain.com');
  });
});

// ── getRootDomain ───────────────────────────────────────────────────────────

describe('getRootDomain', () => {
  test('returns two-part domain as-is', () => {
    expect(getRootDomain('example.com')).toBe('example.com');
  });

  test('returns two-part domain for simple domain', () => {
    expect(getRootDomain('google.com')).toBe('google.com');
  });

  test('handles multi-level TLDs like .co.uk', () => {
    expect(getRootDomain('example.co.uk')).toBe('example.co.uk');
  });

  test('handles subdomain with multi-level TLD', () => {
    expect(getRootDomain('www.example.co.uk')).toBe('example.co.uk');
  });

  test('handles deep subdomain with multi-level TLD', () => {
    expect(getRootDomain('mail.sub.example.co.uk')).toBe('example.co.uk');
  });

  test('handles non-multi-level TLD', () => {
    expect(getRootDomain('www.example.com')).toBe('example.com');
  });

  test('handles common subdomains with multi-level TLD', () => {
    expect(getRootDomain('mail.example.co.uk')).toBe('example.co.uk');
    expect(getRootDomain('api.example.com')).toBe('example.com');
    expect(getRootDomain('blog.example.org')).toBe('example.org');
  });

  test('handles domain with dash in subdomain', () => {
    expect(getRootDomain('my-site.example.co.uk')).toBe('example.co.uk');
  });

  test('handles .com.au TLD', () => {
    expect(getRootDomain('example.com.au')).toBe('example.com.au');
    expect(getRootDomain('www.example.com.au')).toBe('example.com.au');
  });

  test('handles .gov.uk TLD', () => {
    expect(getRootDomain('www.gov.uk')).toBe('gov.uk');
  });
});

// ── getStrippedDomain ───────────────────────────────────────────────────────

describe('getStrippedDomain', () => {
  test('strips dash and preceding word', () => {
    expect(getStrippedDomain('email-staples.co.uk')).toBe('staples.co.uk');
  });

  test('returns domain as-is if no dash', () => {
    expect(getStrippedDomain('example.com')).toBe('example.com');
  });

  test('strips only first dash segment', () => {
    expect(getStrippedDomain('a-b-c.example.com')).toBe('b-c.example.com');
  });
});

// ── URL Builders ────────────────────────────────────────────────────────────

describe('getDomainFaviconUrl', () => {
  test('builds favicon URL from email', () => {
    expect(getDomainFaviconUrl('user@example.com')).toBe('https://example.com/favicon.ico');
  });

  test('handles domain without @ sign', () => {
    expect(getDomainFaviconUrl('example.com')).toBe('https://example.com/favicon.ico');
  });
});

describe('getRootDomainFaviconUrl', () => {
  test('builds root domain favicon URL', () => {
    expect(getRootDomainFaviconUrl('user@mail.example.com')).toBe(
      'https://example.com/favicon.ico'
    );
  });

  test('handles multi-level TLD', () => {
    expect(getRootDomainFaviconUrl('user@example.co.uk')).toBe('https://example.co.uk/favicon.ico');
  });
});

describe('getFaviconUrl', () => {
  test('builds favicon URL for domain', () => {
    expect(getFaviconUrl('example.com')).toBe('https://example.com/favicon.ico');
  });

  test('returns empty string for empty domain', () => {
    expect(getFaviconUrl('')).toBe('');
  });
});

describe('getGoogleFaviconUrl', () => {
  test('builds Google favicon API URL with default size', () => {
    const url = getGoogleFaviconUrl('example.com');
    expect(url).toContain('www.google.com/s2/favicons');
    expect(url).toContain('sz=32');
    expect(url).toContain('domain=example.com');
  });

  test('builds Google favicon API URL with custom size', () => {
    const url = getGoogleFaviconUrl('example.com', 64);
    expect(url).toContain('sz=64');
  });
});

// ── Cache functions (localStorage-based) ────────────────────────────────────

describe('favicon cache', () => {
  test('getFaviconCache returns empty object when localStorage is empty', () => {
    localStorage.removeItem(FAVICON_CACHE_KEY);
    const cache = getFaviconCache();
    expect(typeof cache).toBe('object');
    expect(Object.keys(cache).length).toBe(0);
  });

  test('getFaviconErrorCache returns empty object when localStorage is empty', () => {
    localStorage.removeItem(FAVICON_ERROR_CACHE_KEY);
    const cache = getFaviconErrorCache();
    expect(typeof cache).toBe('object');
    expect(Object.keys(cache).length).toBe(0);
  });

  test('getFaviconCache returns parsed data from localStorage', () => {
    const testData = {
      'example.com': { timestamp: Date.now(), url: 'https://example.com/favicon.ico' },
    };
    localStorage.setItem(FAVICON_CACHE_KEY, JSON.stringify(testData));
    const cache = getFaviconCache();
    expect(cache['example.com']).toBeDefined();
    expect(cache['example.com'].url).toBe('https://example.com/favicon.ico');
  });

  test('getFaviconCache handles invalid JSON gracefully', () => {
    localStorage.setItem(FAVICON_CACHE_KEY, 'not-json');
    const cache = getFaviconCache();
    expect(typeof cache).toBe('object');
    expect(Object.keys(cache).length).toBe(0);
  });

  test('getFaviconCacheStats returns count and size when empty', () => {
    localStorage.removeItem(FAVICON_CACHE_KEY);
    const stats = getFaviconCacheStats();
    expect(stats.count).toBe(0);
    expect(stats.sizeBytes).toBe(0);
  });

  test('getFaviconCacheStats returns correct count for cached entries', () => {
    const testData = {
      'a.com': { timestamp: 1, url: 'a' },
      'b.com': { timestamp: 2, url: 'b' },
      'c.com': { timestamp: 3, url: 'c' },
    };
    localStorage.setItem(FAVICON_CACHE_KEY, JSON.stringify(testData));
    const stats = getFaviconCacheStats();
    expect(stats.count).toBe(3);
    expect(stats.sizeBytes).toBeGreaterThan(0);
  });
});

// ── Constants ───────────────────────────────────────────────────────────────

describe('favicon constants', () => {
  test('CACHE_DURATION is 24 hours in ms', () => {
    expect(CACHE_DURATION).toBe(24 * 60 * 60 * 1000);
  });

  test('GOOGLE_DEFAULT_HASH is a SHA-256 hex string', () => {
    expect(GOOGLE_DEFAULT_HASH).toMatch(/^[0-9a-f]{64}$/);
  });
});
