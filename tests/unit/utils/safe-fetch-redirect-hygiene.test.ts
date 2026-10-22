import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { fetchWithValidatedRedirects } from '@/utils/security/safe-fetch';

// Direct fetch mocking (no mock.module) - mirrors instance-validation.test.ts.
const originalFetch = globalThis.fetch;
let responses: Array<() => Response> = [];
const fetchCalls: Array<{ url: string; options: RequestInit }> = [];

beforeEach(() => {
  responses = [];
  fetchCalls.length = 0;
  globalThis.fetch = (async (url: unknown, options: RequestInit = {}) => {
    fetchCalls.push({ url: String(url), options });
    const next = responses.shift();
    if (!next) throw new Error(`no scripted response for ${String(url)}`);
    return next();
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function redirect(status: number, location: string): () => Response {
  return () => new Response(null, { status, headers: { location } });
}
const ok =
  (body = '{"ok":true}'): (() => Response) =>
  () =>
    new Response(body, { status: 200 });

const allowAll = async (): Promise<{ ok: true }> => ({ ok: true });

function headerNames(options: RequestInit): Set<string> {
  return new Set(Array.from(new Headers(options.headers || undefined).keys()));
}

describe('cross-origin redirect hygiene (redirect token-leak pinning)', () => {
  test('strips a token query param when a redirect crosses origins', async () => {
    responses.push(redirect(302, 'https://collector.evil.com/collect?token=SECRET&keep=1'), ok());

    await fetchWithValidatedRedirects(
      'https://provider.example.com/api?token=SECRET&keep=1',
      {},
      allowAll
    );

    // The INITIAL request is unchanged - only redirect hops are sanitized.
    expect(fetchCalls[0].url).toBe('https://provider.example.com/api?token=SECRET&keep=1');
    // The cross-origin hop must not repeat the provider's credential.
    expect(fetchCalls[1].url).toBe('https://collector.evil.com/collect?keep=1');
  });

  test('strips generic secret-shaped params and explicit sensitiveQueryParams across origins', async () => {
    responses.push(
      redirect(302, 'https://collector.evil.com/x?sessionid=abc&apikey=k3y&sid=XYZ&page=2'),
      ok()
    );

    await fetchWithValidatedRedirects(
      'https://provider.example.com/api?sessionid=abc&sid=XYZ&page=2',
      {},
      allowAll,
      { sensitiveQueryParams: ['sid'] }
    );

    // `page` is benign and survives; every credential-shaped name is dropped.
    expect(fetchCalls[1].url).toBe('https://collector.evil.com/x?page=2');
  });

  test('preserves query params on a same-origin redirect', async () => {
    responses.push(redirect(302, 'https://api.example.com/b?token=SECRET'), ok());

    await fetchWithValidatedRedirects('https://api.example.com/a?token=SECRET', {}, allowAll);

    expect(fetchCalls[1].url).toBe('https://api.example.com/b?token=SECRET');
  });

  test('strips userinfo credentials from a cross-origin Location', async () => {
    responses.push(redirect(302, 'https://user:pass@collector.evil.com/x'), ok());

    await fetchWithValidatedRedirects('https://provider.example.com/api', {}, allowAll);

    expect(fetchCalls[1].url).toBe('https://collector.evil.com/x');
  });

  test('does not forward sensitive headers across origins', async () => {
    responses.push(redirect(302, 'https://collector.evil.com/collect'), ok());

    await fetchWithValidatedRedirects(
      'https://provider.example.com/api',
      {
        headers: new Headers({
          Cookie: 'session=abc',
          Authorization: 'Bearer secret',
          'X-Custom': 'keepme',
        }),
      },
      allowAll
    );

    const second = headerNames(fetchCalls[1].options);
    expect(second.has('cookie')).toBe(false);
    expect(second.has('authorization')).toBe(false);
    expect(second.has('x-custom')).toBe(true);
  });

  test('omits the credentials mode across origins but keeps it same-origin', async () => {
    responses.push(
      redirect(302, 'https://api.example.com/b'),
      redirect(302, 'https://collector.evil.com/collect'),
      ok()
    );

    await fetchWithValidatedRedirects(
      'https://api.example.com/a',
      { credentials: 'include' },
      allowAll
    );

    expect(fetchCalls[1].options.credentials).toBe('include'); // same-origin hop
    expect(fetchCalls[2].options.credentials).toBe('omit'); // cross-origin hop
  });
});

describe('redirect protocol, hop, and validator guards', () => {
  test('refuses an HTTPS to HTTP redirect', async () => {
    responses.push(redirect(302, 'http://collector.evil.com/collect'));

    await expect(
      fetchWithValidatedRedirects('https://provider.example.com/api', {}, allowAll)
    ).rejects.toThrow(/HTTPS to HTTP/);
    expect(fetchCalls).toHaveLength(1);
  });

  test('caps redirect hops', async () => {
    const loop = () => redirect(302, 'https://provider.example.com/hop');
    responses.push(loop(), loop(), loop(), loop(), loop(), loop(), ok());

    await expect(
      fetchWithValidatedRedirects('https://provider.example.com/api', {}, allowAll)
    ).rejects.toThrow(/Too many redirects/);
    expect(fetchCalls).toHaveLength(6); // initial + 5 hops
  });

  test('never issues a request when the validator rejects the redirect target', async () => {
    responses.push(redirect(302, 'https://collector.evil.com/collect'));

    await expect(
      fetchWithValidatedRedirects('https://provider.example.com/api', {}, async (url) =>
        url.includes('evil') ? { ok: false, error: 'errors.webdavPrivateNetwork' } : { ok: true }
      )
    ).rejects.toThrow(/webdavPrivateNetwork/);
    expect(fetchCalls).toHaveLength(1);
  });
});

/**
 * A host that accepts the connection and then never answers - the black-hole
 * case a per-request budget exists for. Rejects only when its signal aborts,
 * the way a real fetch rejects with `signal.reason`.
 */
function hangingFetch(): void {
  globalThis.fetch = (async (url: unknown, options: RequestInit = {}) => {
    fetchCalls.push({ url: String(url), options });
    return new Promise<Response>((_resolve, reject) => {
      const signal = options.signal;
      // No signal means nothing can bound this request - leave it hanging so the
      // test fails loudly instead of passing on an unguarded fetch.
      if (!signal) return;
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  }) as unknown as typeof fetch;
}

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected the request to be rejected');
}

describe('request timeout (the guard owns the timer)', () => {
  const target = 'https://provider.example.com/api';

  test('aborts a request that never answers instead of hanging for minutes', async () => {
    hangingFetch();

    const error = await rejectionOf(
      fetchWithValidatedRedirects(target, {}, allowAll, { timeoutMs: 20 })
    );

    expect(error.name).toBe('AbortError');
    expect(fetchCalls).toHaveLength(1);
  });

  test('one budget covers the whole redirect chain, not each hop separately', async () => {
    responses.push(redirect(302, 'https://api.example.com/b'), ok());

    await fetchWithValidatedRedirects(target, {}, allowAll, { timeoutMs: 50 });

    expect(fetchCalls).toHaveLength(2);
    // The SAME signal on both hops - a per-hop timer would hand out two, and the
    // chain could then take maxRedirects × budget.
    const first = fetchCalls[0].options.signal;
    expect(first).toBeDefined();
    expect(fetchCalls[1].options.signal).toBe(first);
  });

  test('clears its timer once the response is back', async () => {
    responses.push(ok());

    await fetchWithValidatedRedirects(target, {}, allowAll, { timeoutMs: 20 });

    const signal = fetchCalls[0].options.signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    // A leaked timer would abort the signal after the request is long done -
    // and in the MV3 service worker it would keep the worker alive to do it.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(signal.aborted).toBe(false);
  });

  test('keeps a caller-supplied signal working alongside the timeout', async () => {
    hangingFetch();
    const caller = new AbortController();

    const pending = fetchWithValidatedRedirects(target, { signal: caller.signal }, allowAll, {
      timeoutMs: 5_000,
    });
    setTimeout(() => caller.abort(), 5);

    // The caller's signal would be dead weight if the timeout replaced it.
    expect((await rejectionOf(pending)).name).toBe('AbortError');
  });

  test('attaches no signal when no timeout is configured', async () => {
    responses.push(ok());

    await fetchWithValidatedRedirects(target, {}, allowAll);

    expect(fetchCalls[0].options.signal).toBeUndefined();
  });
});
