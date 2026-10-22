import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// ── Mock the 'wxt/browser' module BEFORE importing favicon ──────────────────
// favicon.ts (and its transitive deps: logger.ts, storageMonitor.ts) import
// { browser } from 'wxt/browser'. In Bun's test runner there is no extension
// context, so that module resolves to undefined. We use mock.module() to
// intercept the module resolution and provide an in-memory storage mock.
// A dynamic `await import()` ensures the mock is registered before favicon.ts
// is loaded (ES module static imports are hoisted above mock.module calls).

const storageStore: Record<string, unknown> = {};

mock.module('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: async (keys?: string | string[] | null) => {
          if (keys === null || keys === undefined) return { ...storageStore };
          const keyArr = Array.isArray(keys) ? keys : [keys];
          const result: Record<string, unknown> = {};
          for (const k of keyArr) {
            if (k in storageStore) result[k] = storageStore[k];
          }
          return result;
        },
        set: async (items: Record<string, unknown>) => {
          Object.assign(storageStore, items);
        },
        remove: async (keys: string | string[]) => {
          const keyArr = Array.isArray(keys) ? keys : [keys];
          for (const k of keyArr) delete storageStore[k];
        },
        getBytesInUse: async () => 0,
      },
      onChanged: {
        addListener: () => {},
      },
    },
    runtime: {
      sendMessage: async () => ({ success: false }),
    },
  },
}));

// ── Dynamic import AFTER mock.module is registered ──────────────────────────

const {
  CACHE_DURATION,
  FAVICON_CACHE_KEY,
  GOOGLE_DEFAULT_HASH,
  __resetFaviconMemoryMirrorForTests,
  clearFaviconCache,
  getCachedFaviconUrl,
  getDomainFromEmail,
  getFaviconCache,
  getFaviconCacheStats,
  getFaviconErrorCache,
  getFaviconRequestUrl,
  getGoogleFaviconUrl,
  getStrippedDomain,
  peekCachedFaviconEntrySync,
  resolveFaviconEntryUrl,
  setFaviconCacheSuccess,
  warmFaviconMemoryMirror,
} = await import('@/utils/ui/favicon');
const { getRootDomain } = await import('@/utils/security/root-domain');

beforeEach(() => {
  for (const key of Object.keys(storageStore)) delete storageStore[key];
  // The mirror memoizes across lookups - reset it alongside the storage mock
  // so every test starts cold.
  __resetFaviconMemoryMirrorForTests();
});

// ── getDomainFromEmail ──────────────────────────────────────────────────────

describe('getDomainFromEmail', () => {
  test('extracts domain from email address', () => {
    expect(getDomainFromEmail('user@example.com')).toBe('example.com');
  });

  test('handles subdomains', () => {
    expect(getDomainFromEmail('user@mail.example.com')).toBe('mail.example.com');
  });

  test('extracts a normalized domain from a display-name From header', () => {
    expect(getDomainFromEmail('Security Team <sender@MAIL.Example.com>')).toBe('mail.example.com');
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

  test('handles domain with dash in root domain', () => {
    expect(getRootDomain('my-shop.co.uk')).toBe('my-shop.co.uk');
    expect(getRootDomain('foo-bar.com.br')).toBe('foo-bar.com.br');
  });

  test('handles .com.br and .co.jp TLDs', () => {
    expect(getRootDomain('example.com.br')).toBe('example.com.br');
    expect(getRootDomain('www.example.com.br')).toBe('example.com.br');
    expect(getRootDomain('example.co.jp')).toBe('example.co.jp');
    expect(getRootDomain('www.example.co.jp')).toBe('example.co.jp');
  });

  test('handles .com.au TLD', () => {
    expect(getRootDomain('example.com.au')).toBe('example.com.au');
    expect(getRootDomain('www.example.com.au')).toBe('example.com.au');
  });

  test('handles .gov.uk TLD', () => {
    expect(getRootDomain('service.gov.uk')).toBe('service.gov.uk');
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

describe('getFaviconRequestUrl', () => {
  test('builds favicon URL for domain', () => {
    expect(getFaviconRequestUrl('example.com')).toBe('https://example.com/favicon.ico');
  });

  test('returns empty string for empty domain', () => {
    expect(getFaviconRequestUrl('')).toBe('');
  });
});

describe('getGoogleFaviconUrl', () => {
  test('builds Google favicon API URL with default size', () => {
    const url = getGoogleFaviconUrl('example.com');
    expect(new URL(url).origin).toBe('https://t0.gstatic.com');
    expect(new URL(url).searchParams.get('size')).toBe('32');
    expect(new URL(url).searchParams.get('url')).toBe('https://example.com');
  });

  test('builds Google favicon API URL with custom size', () => {
    const url = getGoogleFaviconUrl('example.com', 64);
    expect(new URL(url).searchParams.get('size')).toBe('64');
  });

  test('encodes a domain as one query value', () => {
    const url = new URL(getGoogleFaviconUrl('example.com&x=1'));
    expect(url.searchParams.get('url')).toBe('https://example.com&x=1');
    expect(url.searchParams.get('x')).toBeNull();
  });
});

// ── Cache functions (browser.storage.local-based) ───────────────────────────

describe('favicon cache', () => {
  test('getFaviconCache returns empty object when storage is empty', async () => {
    const cache = await getFaviconCache();
    expect(typeof cache).toBe('object');
    expect(Object.keys(cache).length).toBe(0);
  });

  test('getFaviconErrorCache returns empty object when storage is empty', async () => {
    const cache = await getFaviconErrorCache();
    expect(typeof cache).toBe('object');
    expect(Object.keys(cache).length).toBe(0);
  });

  test('getFaviconCache returns parsed data from storage', async () => {
    const testData = {
      'example.com': { timestamp: Date.now(), url: 'https://example.com/favicon.ico' },
    };
    storageStore[FAVICON_CACHE_KEY] = testData;
    const cache = await getFaviconCache();
    expect(cache['example.com']).toBeDefined();
    expect(cache['example.com'].url).toBe('https://example.com/favicon.ico');
  });

  test('getFaviconCache returns empty object when key is absent', async () => {
    // No data set for FAVICON_CACHE_KEY - should return {} not throw
    const cache = await getFaviconCache();
    expect(typeof cache).toBe('object');
    expect(Object.keys(cache).length).toBe(0);
  });

  test('getFaviconCacheStats returns count and size when empty', async () => {
    const stats = await getFaviconCacheStats();
    expect(stats.count).toBe(0);
    // JSON.stringify({}) === '{}' which is 2 characters
    expect(stats.sizeBytes).toBe(2);
  });

  test('getFaviconCacheStats returns correct count for cached entries', async () => {
    const testData = {
      'a.com': { timestamp: 1, url: 'a' },
      'b.com': { timestamp: 2, url: 'b' },
      'c.com': { timestamp: 3, url: 'c' },
    };
    storageStore[FAVICON_CACHE_KEY] = testData;
    const stats = await getFaviconCacheStats();
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

// ── Warm in-memory mirror (anti-flash fast path) ────────────────────────

describe('favicon memory mirror', () => {
  test('peek returns undefined before hydration, the entry after warm', async () => {
    expect(peekCachedFaviconEntrySync('warm.test')).toBeUndefined();

    storageStore[FAVICON_CACHE_KEY] = {
      'warm.test': { timestamp: Date.now(), url: 'https://warm.test/favicon.ico' },
    };
    await warmFaviconMemoryMirror();

    const entry = peekCachedFaviconEntrySync('warm.test');
    expect(entry?.url).toBe('https://warm.test/favicon.ico');
  });

  test('mirror is an exact copy including stale-while-revalidate entries', async () => {
    storageStore[FAVICON_CACHE_KEY] = {
      'fresh.test': { timestamp: Date.now(), url: 'u-fresh' },
      'stale.test': { timestamp: Date.now() - CACHE_DURATION - 60_000, url: 'u-stale' },
    };
    await warmFaviconMemoryMirror();

    expect(peekCachedFaviconEntrySync('fresh.test')?.url).toBe('u-fresh');
    // Stale entries MUST survive hydration - consumers own the freshness
    // decision (stale-while-revalidate keeps the old icon visible while it
    // refreshes; dropping aged entries here would blank them).
    expect(peekCachedFaviconEntrySync('stale.test')?.url).toBe('u-stale');
  });

  test('getCachedFaviconUrl rejects a legacy remote URL from the sync mirror', async () => {
    storageStore[FAVICON_CACHE_KEY] = {
      'sync.test': { timestamp: Date.now(), url: 'https://sync.test/favicon.ico' },
    };
    await warmFaviconMemoryMirror();

    expect(await getCachedFaviconUrl('sync.test')).toBeNull();
  });

  test('webp-only entries resolve through the mirror (no url field)', async () => {
    storageStore[FAVICON_CACHE_KEY] = {
      'webp.test': { timestamp: Date.now(), webpDataUrl: 'data:image/webp;base64,xx' },
    };
    await warmFaviconMemoryMirror();

    expect(await getCachedFaviconUrl('webp.test')).toBe('data:image/webp;base64,xx');
  });

  test('setFaviconCacheSuccess updates the mirror for the next component without re-warm', async () => {
    await warmFaviconMemoryMirror();
    expect(peekCachedFaviconEntrySync('live.test')).toBeUndefined();

    await setFaviconCacheSuccess('live.test', 'https://live.test/favicon.ico');

    // The write path must keep the mirror coherent synchronously - a mailbox
    // row rendered right after a fetch success must not miss the entry.
    expect(peekCachedFaviconEntrySync('live.test')?.url).toBe('https://live.test/favicon.ico');
  });

  test('clearFaviconCache removes the entry from the mirror too', async () => {
    storageStore[FAVICON_CACHE_KEY] = {
      'gone.test': { timestamp: Date.now(), url: 'u-gone' },
    };
    await warmFaviconMemoryMirror();
    expect(peekCachedFaviconEntrySync('gone.test')).toBeDefined();

    await clearFaviconCache('gone.test');

    expect(peekCachedFaviconEntrySync('gone.test')).toBeUndefined();
  });

  test('resolveFaviconEntryUrl prefers webpDataUrl over url and handles absence', () => {
    expect(
      resolveFaviconEntryUrl({
        timestamp: 1,
        webpDataUrl: 'data:image/webp;base64,xx',
        url: 'data:image/png;base64,yy',
      })
    ).toBe('data:image/webp;base64,xx');
    expect(
      resolveFaviconEntryUrl({ timestamp: 1, url: 'https://legacy.test/favicon.ico' })
    ).toBeNull();
    expect(resolveFaviconEntryUrl({ timestamp: 1 })).toBeNull();
    expect(resolveFaviconEntryUrl(undefined)).toBeNull();
  });
});
