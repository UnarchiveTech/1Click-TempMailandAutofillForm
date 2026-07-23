import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { ProviderConfig } from '@/utils/email-service';
import {
  formatPing,
  getFastestPing,
  getPingColorClass,
  pingProviderInstances,
} from '@/utils/ping-service';
import type { ProviderInstance } from '@/utils/types';

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
        createInbox: {
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
        createInbox: {
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
        createInbox: {
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
    expect(formatPing(120)).toBe('120ms');
    expect(formatPing('timeout')).toBe('timeout');
  });

  test('getPingColorClass maps colors based on latency', () => {
    expect(getPingColorClass('timeout')).toBe('text-md-error');
    expect(getPingColorClass(50)).toBe('text-md-success');
    expect(getPingColorClass(200)).toBe('text-md-warning');
    expect(getPingColorClass(400)).toBe('text-md-error');
  });
});
