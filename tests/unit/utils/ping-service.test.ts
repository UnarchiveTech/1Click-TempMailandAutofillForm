import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { ProviderConfig } from '@/utils/email/email-service';
import type { ProviderInstance } from '@/utils/types';

// Ping behavior has its own fetch fixture; DNS validation is covered by
// instance-validation tests and must not consume that fixture's responses.
mock.module('@/utils/provider/instance-validation.js', () => ({
  validateFetchUrl: mock(async () => ({ ok: true })),
}));

const {
  __pingCacheForTests,
  formatPing,
  getFastestPing,
  getPingColorClass,
  pingProviderInstances,
} = await import('@/utils/provider/ping-service');

afterAll(() => {
  mock.restore();
});

describe('ping-service', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    // Mock global fetch to return immediately for pings
    global.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 200 }))
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('pingProviderInstances pings provider API URL when instances list is empty and URL is valid', async () => {
    const provider: ProviderConfig = {
      id: 'test-provider',
      name: 'test-provider',
      displayName: 'Test',
      apiUrl: 'https://api.test.com',
      websiteUrl: 'https://test.com',
      auth: { type: 'none', description: 'None' },
      retry: { maxAttempts: 1, delayMs: 100, backoffMultiplier: 1 },
      operations: {
        createAddress: {
          method: 'GET',
          function: 'create',
          requiredParams: {},
          response: { successPath: 'ok', dataPath: null, fields: {} },
          errorHandling: { errorPath: 'err', errorMessagePath: 'msg' },
        },
      },
    };

    const results = await pingProviderInstances(provider, []);
    expect(results.has('test-provider')).toBe(true);
    expect(typeof results.get('test-provider')).toBe('number');
  });

  test('pingProviderInstances skips provider API URL when it contains placeholders', async () => {
    const provider: ProviderConfig = {
      id: 'test-provider',
      name: 'test-provider',
      displayName: 'Test',
      apiUrl: 'https://{instanceUrl}/api',
      websiteUrl: 'https://test.com',
      auth: { type: 'none', description: 'None' },
      retry: { maxAttempts: 1, delayMs: 100, backoffMultiplier: 1 },
      operations: {
        createAddress: {
          method: 'GET',
          function: 'create',
          requiredParams: {},
          response: { successPath: 'ok', dataPath: null, fields: {} },
          errorHandling: { errorPath: 'err', errorMessagePath: 'msg' },
        },
      },
    };

    const results = await pingProviderInstances(provider, []);
    expect(results.has('test-provider')).toBe(false);
  });

  test('pingProviderInstances pings instances in parallel and skips random', async () => {
    const provider: ProviderConfig = {
      id: 'test-provider',
      name: 'test-provider',
      displayName: 'Test',
      apiUrl: 'https://api.test.com',
      websiteUrl: 'https://test.com',
      auth: { type: 'none', description: 'None' },
      retry: { maxAttempts: 1, delayMs: 100, backoffMultiplier: 1 },
      operations: {
        createAddress: {
          method: 'GET',
          function: 'create',
          requiredParams: {},
          response: { successPath: 'ok', dataPath: null, fields: {} },
          errorHandling: { errorPath: 'err', errorMessagePath: 'msg' },
        },
      },
    };

    const instances: ProviderInstance[] = [
      { id: 'random', name: 'Random', displayName: 'Random', apiUrl: '' },
      {
        id: 'inst1',
        name: 'Instance 1',
        displayName: 'Instance 1',
        apiUrl: 'https://inst1.test.com',
      },
      {
        id: 'inst2',
        name: 'Instance 2',
        displayName: 'Instance 2',
        apiUrl: 'https://inst2.test.com',
      },
    ];

    const results = await pingProviderInstances(provider, instances);
    expect(results.has('random')).toBe(false);
    expect(results.has('inst1')).toBe(true);
    expect(results.has('inst2')).toBe(true);
    expect(typeof results.get('inst1')).toBe('number');
    expect(typeof results.get('inst2')).toBe('number');
  });

  test('getFastestPing gets the correct fastest result', () => {
    const results = new Map<string, number | 'timeout'>([
      ['inst1', 150],
      ['inst2', 50],
      ['inst3', 'timeout'],
    ]);

    expect(getFastestPing(results)).toBe(50);
  });

  test('formatPing formats results correctly', () => {
    // Localized via the shared time.milliseconds key (en: "{n} ms").
    expect(formatPing(120)).toBe('120 ms');
    expect(formatPing('timeout')).toBe('timeout');
  });

  test('getPingColorClass maps colors based on latency', () => {
    expect(getPingColorClass('timeout')).toBe('text-md-error');
    expect(getPingColorClass(50)).toBe('text-md-success');
    expect(getPingColorClass(200)).toBe('text-md-warning');
    expect(getPingColorClass(400)).toBe('text-md-error');
  });

  describe('cache TTL (reliable vs unreliable results)', () => {
    beforeEach(() => {
      __pingCacheForTests().clear();
    });

    test('an UNRELIABLE timeout is served from cache only briefly, then re-probed', async () => {
      // CORS-opaque hosts always land here: no-cors success is unreadable, so
      // the probe reports 'timeout' with reliable=false.
      let calls = 0;
      global.fetch = mock(() => {
        calls += 1;
        return Promise.resolve(new Response(null, { status: 0 }));
      }) as unknown as typeof fetch;

      const provider = {
        id: 'opaque-provider',
        apiUrl: 'https://opaque.test.com',
      } as unknown as ProviderConfig;

      const first = await pingProviderInstances(provider, []);
      expect(first.get('opaque-provider')).toBe('timeout');
      expect(calls).toBeGreaterThan(0);

      // A second call within the short unreliable window is served from cache.
      const callsAfterFirst = calls;
      const second = await pingProviderInstances(provider, []);
      expect(second.get('opaque-provider')).toBe('timeout');
      expect(calls).toBe(callsAfterFirst);

      // Age the cache entry past the short unreliable window - the next call
      // must re-probe instead of trusting the stale 'timeout' for the full
      // 5-minute health window.
      const entry = __pingCacheForTests().get('opaque-provider');
      if (!entry) throw new Error('ping cache entry missing');
      expect(entry.reliable).toBe(false);
      entry.timestamp = Date.now() - 16 * 1000;
      await pingProviderInstances(provider, []);
      expect(calls).toBeGreaterThan(callsAfterFirst);
    });

    test('a RELIABLE latency is served for the full cache window', async () => {
      __pingCacheForTests().set('inst-full', {
        result: 120,
        timestamp: Date.now() - 4 * 60 * 1000,
        reliable: true,
      });
      let calls = 0;
      global.fetch = mock(() => {
        calls += 1;
        return Promise.resolve(new Response(null, { status: 200 }));
      }) as unknown as typeof fetch;

      const provider = {
        id: 'full-provider',
        apiUrl: 'https://full.test.com',
      } as unknown as ProviderConfig;
      const results = await pingProviderInstances(provider, [
        { id: 'inst-full', name: 'I', displayName: 'I', apiUrl: 'https://full.test.com' },
      ]);

      expect(results.get('inst-full')).toBe(120);
      expect(calls).toBe(0); // cache hit - no probe issued
    });
  });
});
