import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

mock.module('wxt/browser', () => ({ browser: {} }));
afterAll(() => mock.restore());
const {
  isPublicHostname,
  isSafeFetchUrl,
  isSafeFetchUrlWithDns,
  validateCustomInstanceName,
  validateCustomInstanceUrl,
} = await import('@/utils/provider/instance-validation');

// The TTL tests below must exercise the REAL validateFetchUrl and its cache.
// Other test files (e.g. email-service-redirect.test.ts) register
// mock.module('@/utils/provider/instance-validation.js'), and Bun replaces the
// module binding for every test file in the same run that resolves to that
// path - even a relative specifier is matched by resolved path. Importing
// with a cache-busting query creates a FRESH module record (with its own
// fetchUrlDnsCache) that mock.module cannot intercept, so these tests always
// run against the real implementation regardless of file order.

const realDnsModuleSpec = '../../../src/utils/provider/instance-validation?ttl-tests';
const {
  resetFetchUrlDnsCacheForTests: resetDnsCacheReal,
  seedFetchUrlDnsCacheForTests: seedDnsCacheReal,
  validateFetchUrl: validateFetchUrlReal,
} = (await import(realDnsModuleSpec)) as typeof import('@/utils/provider/instance-validation');

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('isSafeFetchUrl', () => {
  test('allows public https URLs', () => {
    expect(isSafeFetchUrl('https://mail.example.com/api').ok).toBe(true);
  });

  test('rejects http URLs for custom provider instances', () => {
    expect(isSafeFetchUrl('http://mail.example.com/api')).toEqual({
      ok: false,
      error: 'errors.webdavHttpsOnly',
    });
  });

  test('rejects localhost and private networks', () => {
    expect(isSafeFetchUrl('https://localhost/api').ok).toBe(false);
    expect(isSafeFetchUrl('https://127.0.0.1/api').ok).toBe(false);
    expect(isSafeFetchUrl('https://192.168.1.10/api').ok).toBe(false);
  });

  test('rejects DNS rebinding helper domains', () => {
    expect(isSafeFetchUrl('https://127-0-0-1.nip.io/api').ok).toBe(false);
    expect(isSafeFetchUrl('https://10.0.0.1.sslip.io/api').ok).toBe(false);
  });

  test('rejects the entire RFC 6761 localhost namespace without a DNS lookup', () => {
    for (const host of ['foo.localhost', 'foo.localhost.', 'a.b.c.localhost', 'x.LOCALHOST']) {
      expect(isPublicHostname(host)).toBe(false);
      expect(isSafeFetchUrl(`https://${host}:8443/api`).ok).toBe(false);
    }
    expect(isPublicHostname('localhost.example.com')).toBe(true);
    expect(isPublicHostname('notlocalhost.com')).toBe(true);
  });

  test('canonicalizes a trailing root dot before classifying the host', () => {
    expect(isSafeFetchUrl('https://127.0.0.1./api').ok).toBe(false);
    expect(isSafeFetchUrl('https://localhost./api').ok).toBe(false);
    expect(isPublicHostname('private.example.test.')).toBe(false);
    expect(isPublicHostname('example.com.')).toBe(true);
    expect(isPublicHostname('example.com..')).toBe(false);
  });
});

describe('hostname and name validation', () => {
  test('rejects private IPv6 and decimal IP address forms', () => {
    expect(isPublicHostname('::1')).toBe(false);
    expect(isPublicHostname('fc00::1')).toBe(false);
    expect(isPublicHostname('2130706433')).toBe(false);
  });

  test('rejects unspecified address :: and IPv6 multicast ff00::/8', () => {
    expect(isPublicHostname('::')).toBe(false);
    expect(isPublicHostname('ff02::1')).toBe(false); // link-local all-nodes
    expect(isPublicHostname('ff0e::1')).toBe(false); // global multicast
    expect(isPublicHostname('ff00::')).toBe(false); // block base
    expect(isPublicHostname('ffff::1')).toBe(false); // top of ff00::/8
  });

  test('rejects benchmark and reserved IPv4 ranges', () => {
    expect(isPublicHostname('198.18.0.1')).toBe(false);
    expect(isPublicHostname('198.19.255.254')).toBe(false);
    expect(isPublicHostname('240.0.0.1')).toBe(false);
  });

  test('rejects 6to4 addresses embedding private IPv4 (2002:V4ADDR::/48)', () => {
    expect(isPublicHostname('2002:7f00:1::')).toBe(false); // 127.0.0.1
    expect(isPublicHostname('2002:0a00:0001::')).toBe(false); // 10.0.0.1
    expect(isPublicHostname('2002:c0a8:0101::')).toBe(false); // 192.168.1.1
  });

  test('rejects IPv4-compatible addresses embedding private IPv4 (deprecated ::/96)', () => {
    expect(isPublicHostname('::7f00:1')).toBe(false); // ::127.0.0.1
    expect(isPublicHostname('::127.0.0.1')).toBe(false);
  });

  test('rejects deprecated site-local fec0::/10', () => {
    expect(isPublicHostname('fec0::1')).toBe(false);
  });

  test('keeps 6to4 addresses that embed a PUBLIC IPv4', () => {
    expect(isPublicHostname('2002:0808:0808::')).toBe(true); // 8.8.8.8
  });

  test('keeps IPv4-mapped public addresses and other public IPv6', () => {
    expect(isPublicHostname('::ffff:8.8.8.8')).toBe(true);
    expect(isPublicHostname('2606:4700:4700::1111')).toBe(true);
  });

  test('rejects empty and unsafe instance names', () => {
    expect(() => validateCustomInstanceName('   ')).toThrow('Instance name cannot be empty');
    expect(() => validateCustomInstanceName('<script>')).toThrow(
      'Instance name contains invalid characters'
    );
  });
});

describe('isSafeFetchUrlWithDns', () => {
  test('accepts a public hostname whose DNS answers are public', async () => {
    globalThis.fetch = mock(async (input) => {
      const isIpv6Query = new URL(String(input)).searchParams.get('type') === 'AAAA';
      const answer = isIpv6Query
        ? { type: 28, data: '2606:4700:4700::1111' }
        : { type: 1, data: '8.8.8.8' };
      return new Response(JSON.stringify({ Answer: [answer] }));
    }) as unknown as typeof fetch;
    const r = await isSafeFetchUrlWithDns('https://mail.example.com/api');
    expect(r.ok).toBe(true);
  });

  test('accepts canonical public IPv4 addresses returned by DNS', async () => {
    globalThis.fetch = mock(async (input) => {
      const isIpv6Query = new URL(String(input)).searchParams.get('type') === 'AAAA';
      const answer = isIpv6Query
        ? { type: 28, data: '2606:4700:4700::1111' }
        : { type: 1, data: '8.8.8.8' };
      return new Response(JSON.stringify({ Answer: [answer] }));
    }) as unknown as typeof fetch;
    const r = await isSafeFetchUrlWithDns('https://mail.example.com/api');
    expect(r.ok).toBe(true);
  });

  test('rejects a hostname that resolves to a private IPv6 address', async () => {
    globalThis.fetch = mock(async (input) => {
      const isIpv6Query = new URL(String(input)).searchParams.get('type') === 'AAAA';
      const answer = isIpv6Query ? { type: 28, data: 'fd00::1' } : { type: 1, data: '8.8.8.8' };
      return new Response(JSON.stringify({ Answer: [answer] }));
    }) as unknown as typeof fetch;
    const r = await isSafeFetchUrlWithDns('https://rebind.example.com/api');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('errors.webdavPrivateNetwork');
  });

  test('rejects a hostname that currently resolves to a private IPv4 (DNS rebinding)', async () => {
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({ Answer: [{ type: 1, data: '127.0.0.1' }] }))
    ) as unknown as typeof fetch;
    const r = await isSafeFetchUrlWithDns('https://rebind.example.com/favicon.ico');
    expect(r.ok).toBe(false);
    // Stable errors.* key - the UI owns the human language.
    expect(r.error).toBe('errors.webdavPrivateNetwork');
  });

  test('fails closed when DNS validation cannot complete', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const r = await isSafeFetchUrlWithDns('https://mail.example.com/api');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('errors.networkErrorGeneric');
  });

  test('fails closed when DNS returns no address records', async () => {
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({ Answer: [] }))
    ) as unknown as typeof fetch;
    const r = await isSafeFetchUrlWithDns('https://mail.example.com/api');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('errors.networkErrorGeneric');
  });

  test('skips DNS for literal IPs (static classification already applies)', async () => {
    const fetchMock = mock(async () => new Response(JSON.stringify({ Answer: [] })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    expect((await isSafeFetchUrlWithDns('https://127.0.0.1/x')).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('validateCustomInstanceUrl', () => {
  test('accepts a public hostname when its A and AAAA answers are public', async () => {
    const fetchMock = mock(async (input) => {
      const isIpv6Query = new URL(String(input)).searchParams.get('type') === 'AAAA';
      const answer = isIpv6Query
        ? { type: 28, data: '2606:4700:4700::1111' }
        : { type: 1, data: '8.8.8.8' };
      return new Response(JSON.stringify({ Answer: [answer] }));
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      validateCustomInstanceUrl('https://mail.example.com/api')
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('rejects a hostname that resolves to a private IPv4 address', async () => {
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({ Answer: [{ type: 1, data: '10.0.0.12' }] }))
    ) as unknown as typeof fetch;

    await expect(validateCustomInstanceUrl('https://mail.example.com/api')).rejects.toThrow(
      'webdavPrivateNetwork'
    );
  });

  test('fails closed when DNS validation cannot complete', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('network unavailable');
    }) as unknown as typeof fetch;

    await expect(validateCustomInstanceUrl('https://mail.example.com/api')).rejects.toThrow(
      'networkErrorGeneric'
    );
  });
});

describe('validateFetchUrl DNS cache TTL (DNS-rebinding window)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetDnsCacheReal();
  });

  function publicDns(): typeof fetch {
    return mock(async (input) => {
      const isIpv6Query = new URL(String(input)).searchParams.get('type') === 'AAAA';
      const answer = isIpv6Query
        ? { type: 28, data: '2606:4700:4700::1111' }
        : { type: 1, data: '8.8.8.8' };
      return new Response(JSON.stringify({ Answer: [answer] }));
    }) as unknown as typeof fetch;
  }
  function privateDns(): typeof fetch {
    return mock(
      async () => new Response(JSON.stringify({ Answer: [{ type: 1, data: '127.0.0.1' }] }))
    ) as unknown as typeof fetch;
  }

  test('within the TTL a repeated fetch is served from cache (rate limiting works)', async () => {
    globalThis.fetch = publicDns();
    const url = 'https://mail.example.com/api';

    expect((await validateFetchUrlReal(url)).ok).toBe(true);

    // Seed a FRESH cache entry, then swap in a hostile resolver: the cached
    // hit must not consult DNS again inside the TTL (that is the rate limit
    // working - a repoint inside the window is masked, by design).
    seedDnsCacheReal('mail.example.com', Date.now());
    globalThis.fetch = privateDns();
    expect((await validateFetchUrlReal(url)).ok).toBe(true);
  });

  test('an expired cache entry re-resolves: a rebinding repoint is caught on the next fetch', async () => {
    globalThis.fetch = publicDns();
    const url = 'https://rebind.example.com/api';

    expect((await validateFetchUrlReal(url)).ok).toBe(true);

    // Attacker repointed the hostname at loopback and the cache entry is now
    // older than the TTL: the next fetch must re-resolve and fail closed.
    seedDnsCacheReal('rebind.example.com', Date.now() - 11_000);
    globalThis.fetch = privateDns();

    const r = await validateFetchUrlReal(url);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('errors.webdavPrivateNetwork');
  });

  test('cache expiry uses the configured TTL, not wall-clock drift', async () => {
    globalThis.fetch = publicDns();
    const url = 'https://mail.example.com/api';

    await validateFetchUrlReal(url);

    // Just inside the TTL (9.9s < 10s): the hostile resolver is NOT consulted.
    seedDnsCacheReal('mail.example.com', Date.now() - 9_900);
    globalThis.fetch = privateDns();
    expect((await validateFetchUrlReal(url)).ok).toBe(true);

    // Just outside the TTL (10.1s > 10s): the cache is bypassed and the
    // repoint is caught.
    seedDnsCacheReal('mail.example.com', Date.now() - 10_100);
    expect((await validateFetchUrlReal(url)).ok).toBe(false);
  });
});
