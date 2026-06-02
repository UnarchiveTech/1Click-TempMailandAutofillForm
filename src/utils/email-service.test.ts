import { afterEach, describe, expect, mock, test } from 'bun:test';
import { EmailService, type ProviderConfig } from './email-service';

// ── Mock fetch ──────────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;

function mockFetch(
  responses: Array<{ ok: boolean; status: number; json: () => Promise<unknown> }>
) {
  let callIndex = 0;
  globalThis.fetch = mock(() => {
    const resp = responses[Math.min(callIndex, responses.length - 1)];
    callIndex++;
    return Promise.resolve(resp) as Promise<Response>;
  });
}

function successJson(data: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(data) };
}

function errorJson(data: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(data) };
}

function httpError(status: number, statusText = 'Error') {
  return { ok: false, status, statusText, json: () => Promise.resolve({}) };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ── Test config ─────────────────────────────────────────────────────────────

const testConfig: ProviderConfig = {
  id: 'test-provider',
  name: 'Test Provider',
  displayName: 'Test Provider',
  apiUrl: 'https://api.test.com/endpoint',
  auth: { type: 'query_parameter', paramName: 'token', description: 'Test auth' },
  retry: { maxAttempts: 3, delayMs: 10, backoffMultiplier: 2 },
  operations: {
    createInbox: {
      method: 'GET',
      function: 'get_inbox',
      requiredParams: { ip: '127.0.0.1' },
      response: {
        successPath: '!error',
        dataPath: null,
        fields: { address: 'email_addr', token: 'sid_token' },
      },
      errorHandling: { errorPath: 'error', errorMessagePath: 'error' },
    },
    checkEmails: {
      method: 'GET',
      function: 'check_email',
      requiredParams: { token: '{auth.token}' },
      response: {
        successPath: '!error',
        dataPath: 'list',
        fields: { id: 'mail_id', from: 'mail_from', subject: 'mail_subject' },
      },
      errorHandling: { errorPath: 'error', errorMessagePath: 'error' },
    },
  },
  expiry: { duration: 3600000, renewable: true },
};

// ── EmailService class ──────────────────────────────────────────────────────

describe('EmailService', () => {
  test('constructor stores config', () => {
    const service = new EmailService(testConfig, {} as never);
    const config = service.getConfig();
    expect(config.id).toBe('test-provider');
    expect(config.apiUrl).toBe('https://api.test.com/endpoint');
  });

  test('getConfig returns the same config object', () => {
    const service = new EmailService(testConfig, {} as never);
    expect(service.getConfig()).toBe(testConfig);
  });
});

// ── executeOperation ────────────────────────────────────────────────────────

describe('executeOperation', () => {
  test('throws for unknown operation', async () => {
    const service = new EmailService(testConfig, {} as never);
    await expect(service.executeOperation('nonexistent')).rejects.toThrow(
      /Operation nonexistent not found/
    );
  });

  test('makes fetch call with correct URL and params', async () => {
    mockFetch([successJson({ email_addr: 'test@guerrilla.com', sid_token: 'tok123' })]);

    const service = new EmailService(testConfig, {} as never);
    const result = await service.executeOperation('createInbox');

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const calledUrl = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('api.test.com');
    expect(calledUrl).toContain('f=get_inbox');
    expect(calledUrl).toContain('ip=127.0.0.1');
    expect(result.address).toBe('test@guerrilla.com');
    expect(result.token).toBe('tok123');
  });

  test('resolves template values in required params', async () => {
    mockFetch([successJson({ email_addr: 'test@test.com', sid_token: 'tok' })]);

    const service = new EmailService(testConfig, {} as never);
    await service.executeOperation('checkEmails', { auth: { token: 'mytoken' } });

    const calledUrl = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('token=mytoken');
  });

  test('throws on HTTP error status', async () => {
    mockFetch([httpError(500, 'Internal Server Error')]);

    const service = new EmailService(testConfig, {} as never);
    await expect(service.executeOperation('createInbox')).rejects.toThrow(/HTTP 500/);
  });

  test('throws on API error in response', async () => {
    mockFetch([errorJson({ error: true, error_msg: 'Invalid token' })]);

    const service = new EmailService(testConfig, {} as never);
    // checkForErrors extracts error_msg via errorMessagePath: 'error' which gives boolean true
    // The thrown message will be the stringified error value
    await expect(service.executeOperation('createInbox')).rejects.toThrow();
  });

  test('parses response fields correctly', async () => {
    mockFetch([
      successJson({ email_addr: 'user@domain.com', sid_token: 'session123', extra: 'ignored' }),
    ]);

    const service = new EmailService(testConfig, {} as never);
    const result = await service.executeOperation('createInbox');

    expect(result).toEqual({ address: 'user@domain.com', token: 'session123' });
    expect(result.extra).toBeUndefined();
  });

  test('includes auth token as query parameter', async () => {
    mockFetch([successJson({ list: [{ mail_id: '1', mail_from: 'a@b.com', subject: 'Hi' }] })]);

    const service = new EmailService(testConfig, {} as never);
    await service.executeOperation('checkEmails', { auth: { token: 'authtoken' } });

    const calledUrl = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('token=authtoken');
  });
});

// ── Retry logic ─────────────────────────────────────────────────────────────

describe('executeWithRetry', () => {
  test('retries on HTTP error and succeeds on second attempt', async () => {
    mockFetch([httpError(500), successJson({ email_addr: 'test@test.com', sid_token: 'tok' })]);

    const service = new EmailService(testConfig, {} as never);
    const result = await service.executeOperation('createInbox');

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(result.address).toBe('test@test.com');
  });

  test('retries on API error and succeeds', async () => {
    mockFetch([
      errorJson({ error: true, error_msg: 'Temporary failure' }),
      successJson({ email_addr: 'test@test.com', sid_token: 'tok' }),
    ]);

    const service = new EmailService(testConfig, {} as never);
    const result = await service.executeOperation('createInbox');

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(result.address).toBe('test@test.com');
  });

  test('exhausts all retries and throws last error', async () => {
    mockFetch([httpError(500), httpError(500), httpError(500)]);

    const service = new EmailService(testConfig, {} as never);
    await expect(service.executeOperation('createInbox')).rejects.toThrow(/HTTP 500/);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  test('retries correct number of times (maxAttempts=3)', async () => {
    mockFetch([httpError(429), httpError(429), httpError(429)]);

    const service = new EmailService(testConfig, {} as never);
    await expect(service.executeOperation('createInbox')).rejects.toThrow();
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  test('does not retry after success', async () => {
    mockFetch([successJson({ email_addr: 'test@test.com', sid_token: 'tok' })]);

    const service = new EmailService(testConfig, {} as never);
    await service.executeOperation('createInbox');

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

// ── Header auth config ──────────────────────────────────────────────────────

describe('header auth', () => {
  test('sends auth token in header for header-type auth', async () => {
    const headerConfig: ProviderConfig = {
      ...testConfig,
      auth: { type: 'header', headerName: 'X-API-Key', description: 'Header auth' },
    };

    mockFetch([successJson({ success: true })]);

    const service = new EmailService(headerConfig, {} as never);
    await service.executeOperation('createInbox', { auth: { token: 'mykey' } });

    const calledOptions = (globalThis.fetch as ReturnType<typeof mock>).mock
      .calls[0][1] as RequestInit;
    expect((calledOptions.headers as Record<string, string>)['X-API-Key']).toBe('mykey');
  });
});

// ── forceNewSession ─────────────────────────────────────────────────────────

describe('forceNewSession', () => {
  test('applies forceNewSession headers when enabled', async () => {
    const forceConfig: ProviderConfig = {
      ...testConfig,
      forceNewSession: {
        enabled: true,
        params: {},
        headers: { 'Cache-Control': 'no-cache' },
        credentials: 'omit',
        cache: 'no-store',
      },
    };

    mockFetch([successJson({ email_addr: 'test@test.com', sid_token: 'tok' })]);

    const service = new EmailService(forceConfig, {} as never);
    await service.executeOperation('createInbox', { forceNewSession: true });

    const calledOptions = (globalThis.fetch as ReturnType<typeof mock>).mock
      .calls[0][1] as RequestInit;
    expect((calledOptions.headers as Record<string, string>)['Cache-Control']).toBe('no-cache');
    expect(calledOptions.credentials).toBe('omit');
    expect(calledOptions.cache).toBe('no-store');
  });
});
