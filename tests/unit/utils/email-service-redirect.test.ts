import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import { EmailService, type ProviderConfig } from '@/utils/email/email-service';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// ── Mock the SSRF validator BEFORE email-service loads ──────────────────────
// Route validation outcomes per URL so the redirect tests can force an unsafe
// final target or a safe one and observe every validation call.
const validationOk: Record<string, boolean> = {};
const validationCalls: Array<{ url: string; skipDns: boolean }> = [];

mock.module('@/utils/provider/instance-validation.js', () => ({
  validateFetchUrl: mock(async (url: string, opts?: { skipDns?: boolean }) => {
    validationCalls.push({ url, skipDns: !!opts?.skipDns });
    if (validationOk[url] === false) {
      return { ok: false, error: 'URL hostname resolves to private network' };
    }
    return { ok: true };
  }),
}));

const originalFetch = globalThis.fetch;
let fetchResult: () => Promise<Response> = () =>
  Promise.resolve(new Response(null, { status: 200 }));
const fetchCalls: Array<{ url: string; options: RequestInit }> = [];

beforeEach(() => {
  fetchCalls.length = 0;
  validationCalls.length = 0;
  globalThis.fetch = mock(async (url: unknown, options: RequestInit) => {
    fetchCalls.push({ url: String(url), options });
    return fetchResult();
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  fetchResult = () => Promise.resolve(new Response(null, { status: 200 }));
});

function makeConfig(overrides: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: 'redirect-test',
    name: 'Redirect Test',
    apiUrl: 'https://grr.la/mail',
    auth: { type: 'none' } as ProviderConfig['auth'],
    expiry: { duration: 86_400_000, renewable: true },
    customEmail: { supported: true },
    ui: { supportsCustomInstance: false, multiInstance: false, supportsCustomEmail: true },
    ...overrides,
  } as unknown as ProviderConfig;
}

const NOOP_BROWSER = {} as unknown as Browser;

/** Build a Response that reports a follow-redirect landing (engine ignored 'error'). */
function followedResponse(finalUrl: string, status = 200): Response {
  const response = new Response(null, { status });
  Object.defineProperty(response, 'redirected', { value: true });
  Object.defineProperty(response, 'url', { value: finalUrl });
  return response;
}

async function safeFetchVia(service: EmailService, url: string): Promise<Response> {
  const fetcher = service as unknown as {
    safeFetch: (url: string, options: RequestInit) => Promise<Response>;
  };
  return fetcher.safeFetch(url, {});
}

describe('safeFetch redirect handling', () => {
  test('requests the engine with redirect:manual so exposed hops can be validated', async () => {
    const service = new EmailService(makeConfig({}), NOOP_BROWSER);
    await safeFetchVia(service, 'https://evil.example.com/api');
    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0].options.redirect).toBe('manual');
  });

  test('validates an exposed redirect before issuing the next request', async () => {
    const responses = [
      new Response(null, {
        status: 302,
        headers: { location: 'https://cdn.example.com/final.json' },
      }),
      new Response('{"ok":true}', { status: 200 }),
    ];
    fetchResult = () => Promise.resolve(responses.shift() as Response);

    const service = new EmailService(makeConfig({}), NOOP_BROWSER);
    const res = await safeFetchVia(service, 'https://evil.example.com/api');

    expect(res.status).toBe(200);
    expect(fetchCalls.map((call) => call.url)).toEqual([
      'https://evil.example.com/api',
      'https://cdn.example.com/final.json',
    ]);
    expect(validationCalls.map((call) => call.url)).toEqual([
      'https://evil.example.com/api',
      'https://cdn.example.com/final.json',
    ]);
  });

  test('does not issue a request when an exposed redirect target is unsafe', async () => {
    validationOk['https://169.254.169.254/latest/meta-data'] = false;
    fetchResult = () =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: 'https://169.254.169.254/latest/meta-data' },
        })
      );

    const service = new EmailService(makeConfig({}), NOOP_BROWSER);
    await expect(safeFetchVia(service, 'https://evil.example.com/api')).rejects.toThrow(
      /private network/
    );
    expect(fetchCalls).toHaveLength(1);
  });

  test('accepts a normal 200 response unchanged (only the start URL is validated)', async () => {
    fetchResult = () => Promise.resolve(new Response('{"ok":true}', { status: 200 }));
    const service = new EmailService(makeConfig({}), NOOP_BROWSER);
    const res = await safeFetchVia(service, 'https://evil.example.com/api');
    expect(res.status).toBe(200);
    expect(validationCalls.map((c) => c.url)).toEqual(['https://evil.example.com/api']);
  });

  test('rejects a redirect an engine followed to an UNSAFE final URL (never consumed)', async () => {
    validationOk['https://169.254.169.254/latest/meta-data'] = false;
    fetchResult = () =>
      Promise.resolve(followedResponse('https://169.254.169.254/latest/meta-data'));

    const service = new EmailService(makeConfig({}), NOOP_BROWSER);
    await expect(safeFetchVia(service, 'https://evil.example.com/api')).rejects.toThrow(
      /private network/
    );
    // The final URL was re-validated with the FULL gate (DNS enabled).
    expect(
      validationCalls.some(
        (c) => c.url === 'https://169.254.169.254/latest/meta-data' && c.skipDns === false
      )
    ).toBe(true);
  });

  test('permits a redirect an engine followed to a SAFE final URL, after full re-validation', async () => {
    validationOk['https://cdn.example.com/final.json'] = true;
    const followed = followedResponse('https://cdn.example.com/final.json');
    fetchResult = () => Promise.resolve(followed);

    const service = new EmailService(makeConfig({}), NOOP_BROWSER);
    const res = await safeFetchVia(service, 'https://evil.example.com/api');
    expect(res).toBe(followed);
    expect(validationCalls.map((c) => c.url)).toEqual([
      'https://evil.example.com/api',
      'https://cdn.example.com/final.json',
    ]);
    expect(validationCalls[1].skipDns).toBe(false);
  });
});
