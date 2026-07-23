// biome-ignore-all lint/suspicious/noExplicitAny: stub globalThis.fetch
import { afterEach, describe, expect, mock, test } from 'bun:test';
import { EmailService, type ProviderConfig } from '@/utils/email-service';
import { deriveInboxTiming } from '@/utils/provider-expiry';

// ── Mock fetch ──────────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;

function mockFetch(
  responses: Array<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
    text?: () => Promise<string>;
  }>
) {
  let callIndex = 0;
  (globalThis as any).fetch = mock(() => {
    const resp = responses[Math.min(callIndex, responses.length - 1)];
    callIndex++;
    return Promise.resolve(resp) as Promise<Response>;
  });
}

function successJson(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

function errorJson(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

function httpError(status: number, statusText = 'Error') {
  return {
    ok: false,
    status,
    statusText,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve('{}'),
  };
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
    const calledUrl = (globalThis.fetch as any).mock.calls[0][0] as string;
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

    const calledUrl = (globalThis.fetch as any).mock.calls[0][0] as string;
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

    const calledUrl = (globalThis.fetch as any).mock.calls[0][0] as string;
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

    const calledOptions = (globalThis.fetch as any).mock.calls[0][1] as RequestInit;
    expect((calledOptions.headers as Record<string, string>)['X-API-Key']).toBe('mykey');
  });
});

// ── Cookie auth config ──────────────────────────────────────────────────────

describe('cookie auth', () => {
  test('sets browser cookie and does not send token in request headers', async () => {
    const cookieConfig: ProviderConfig = {
      ...testConfig,
      auth: { type: 'cookie', cookieName: 'PHPSESSID', description: 'Cookie auth' },
    };
    const cookies = { set: mock(() => Promise.resolve({})) };

    mockFetch([successJson({ success: true })]);

    const service = new EmailService(cookieConfig, { cookies } as never);
    await service.executeOperation('createInbox', { auth: { token: 'sid123' } });

    expect(cookies.set).toHaveBeenCalledWith({
      url: 'https://api.test.com/endpoint',
      name: 'PHPSESSID',
      value: 'sid123',
    });

    const calledUrl = (globalThis.fetch as any).mock.calls[0][0] as string;
    const calledOptions = (globalThis.fetch as any).mock.calls[0][1] as RequestInit;
    expect(calledUrl).not.toContain('sid123');
    expect((calledOptions.headers as Record<string, string>).Cookie).toBeUndefined();
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

    const calledOptions = (globalThis.fetch as any).mock.calls[0][1] as RequestInit;
    expect((calledOptions.headers as Record<string, string>)['Cache-Control']).toBe('no-cache');
    expect(calledOptions.credentials).toBe('omit');
    expect(calledOptions.cache).toBe('no-store');
  });
});

// ── responseType Parsing ──────────────────────────────────────────────────

function mockFetchRaw(
  responses: Array<{ ok: boolean; status: number; text: () => Promise<string> }>
) {
  let callIndex = 0;
  (globalThis as any).fetch = mock(() => {
    const resp = responses[Math.min(callIndex, responses.length - 1)];
    callIndex++;
    return Promise.resolve(resp) as Promise<Response>;
  });
}

describe('responseType parsing', () => {
  test('handles responseType boolean', async () => {
    const booleanConfig: ProviderConfig = {
      ...testConfig,
      operations: {
        forgetMe: {
          method: 'GET',
          function: 'forget_me',
          requiredParams: {},
          response: { successPath: 'result', fields: {} },
          errorHandling: { errorPath: 'error', errorMessagePath: 'error' },
          responseType: 'boolean',
        },
      },
    };

    mockFetchRaw([{ ok: true, status: 200, text: () => Promise.resolve('true') }]);
    const service = new EmailService(booleanConfig, {} as never);
    const result = await service.executeOperation('forgetMe');
    expect(result).toEqual({ result: true });
  });

  test('handles responseType text', async () => {
    const textConfig: ProviderConfig = {
      ...testConfig,
      operations: {
        extend: {
          method: 'GET',
          function: 'extend',
          requiredParams: {},
          response: { successPath: 'result', fields: {} },
          errorHandling: { errorPath: 'error', errorMessagePath: 'error' },
          responseType: 'text',
        },
      },
    };

    mockFetchRaw([{ ok: true, status: 200, text: () => Promise.resolve('Success message') }]);
    const service = new EmailService(textConfig, {} as never);
    const result = await service.executeOperation('extend');
    expect(result).toEqual({ result: 'Success message' });
  });

  test('handles responseType empty', async () => {
    const emptyConfig: ProviderConfig = {
      ...testConfig,
      operations: {
        emptyOp: {
          method: 'GET',
          function: 'empty',
          requiredParams: {},
          response: { successPath: 'result', fields: {} },
          errorHandling: { errorPath: 'error', errorMessagePath: 'error' },
          responseType: 'empty',
        },
      },
    };

    mockFetchRaw([{ ok: true, status: 200, text: () => Promise.resolve('') }]);
    const service = new EmailService(emptyConfig, {} as never);
    const result = await service.executeOperation('emptyOp');
    expect(result).toEqual({});
  });
});

// ── statusHandling ──────────────────────────────────────────────────────────

describe('statusHandling', () => {
  test('ignores status when ignoreStatus is true', async () => {
    const config: ProviderConfig = {
      ...testConfig,
      operations: {
        testOp: {
          method: 'GET',
          function: 'test',
          requiredParams: {},
          response: { fields: {} },
          errorHandling: { errorPath: 'err', errorMessagePath: 'msg' },
          statusHandling: { ignoreStatus: true },
        },
      },
    };
    mockFetchRaw([{ ok: false, status: 404, text: () => Promise.resolve('{"val": 123}') }]);
    const service = new EmailService(config, {} as never);
    const result = await service.executeOperation('testOp');
    expect(result).toEqual({ val: 123 });
  });

  test('allows specific status codes', async () => {
    const config: ProviderConfig = {
      ...testConfig,
      operations: {
        testOp: {
          method: 'GET',
          function: 'test',
          requiredParams: {},
          response: { fields: {} },
          errorHandling: { errorPath: 'err', errorMessagePath: 'msg' },
          statusHandling: { allowedStatuses: [404] },
        },
      },
    };
    mockFetchRaw([{ ok: false, status: 404, text: () => Promise.resolve('{"val": 456}') }]);
    const service = new EmailService(config, {} as never);
    const result = await service.executeOperation('testOp');
    expect(result).toEqual({ val: 456 });
  });
});

// ── retryOn status codes ─────────────────────────────────────────────────────

describe('retryOn status codes', () => {
  test('retries on configured retryOn status code', async () => {
    const config: ProviderConfig = {
      ...testConfig,
      retry: { maxAttempts: 2, delayMs: 1, backoffMultiplier: 1, retryOn: [502] },
      operations: {
        testOp: {
          method: 'GET',
          function: 'test',
          requiredParams: {},
          response: { fields: {} },
          errorHandling: { errorPath: 'err', errorMessagePath: 'msg' },
        },
      },
    };
    mockFetchRaw([
      { ok: false, status: 502, text: () => Promise.resolve('Bad gateway') },
      { ok: true, status: 200, text: () => Promise.resolve('{"result": "ok"}') },
    ]);
    const service = new EmailService(config, {} as never);
    const result = await service.executeOperation('testOp');
    expect(result).toEqual({ result: 'ok' });
  });

  test('does not retry on unconfigured status code', async () => {
    const config: ProviderConfig = {
      ...testConfig,
      retry: { maxAttempts: 2, delayMs: 1, backoffMultiplier: 1, retryOn: [502] },
      operations: {
        testOp: {
          method: 'GET',
          function: 'test',
          requiredParams: {},
          response: { fields: {} },
          errorHandling: { errorPath: 'err', errorMessagePath: 'msg' },
        },
      },
    };
    mockFetchRaw([
      { ok: false, status: 500, text: () => Promise.resolve('Internal server error') },
    ]);
    const service = new EmailService(config, {} as never);
    await expect(service.executeOperation('testOp')).rejects.toThrow();
  });
});

// ── Retry-After header handling ──────────────────────────────────────────────

describe('Retry-After header handling', () => {
  test('uses Retry-After header duration on HTTP 429 rate limits', async () => {
    const config: ProviderConfig = {
      ...testConfig,
      retry: { maxAttempts: 2, delayMs: 10000, backoffMultiplier: 1 },
      operations: {
        testOp: {
          method: 'GET',
          function: 'test',
          requiredParams: {},
          response: { fields: {} },
          errorHandling: { errorPath: 'err', errorMessagePath: 'msg' },
        },
      },
    };

    const headersMap = new Map<string, string>([['retry-after', '1']]);
    const mockHeaders = {
      get: (name: string) => headersMap.get(name.toLowerCase()) || null,
    } as unknown as Headers;

    (globalThis as any).fetch = mock(() => {
      if ((globalThis.fetch as any).mock.calls.length === 1) {
        return Promise.resolve({
          ok: false,
          status: 429,
          headers: mockHeaders,
          statusText: 'Too Many Requests',
          text: () => Promise.resolve('Rate limit exceeded'),
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null } as unknown as Headers,
        text: () => Promise.resolve('{"result": "ok"}'),
      } as unknown as Response);
    });

    const startTime = Date.now();
    const service = new EmailService(config, {} as never);
    const result = await service.executeOperation('testOp');
    const duration = Date.now() - startTime;

    expect(result).toEqual({ result: 'ok' });
    expect(duration).toBeLessThan(5000);
  });
});

// ── cookie capture lifecycle ─────────────────────────────────────────────────

describe('cookie capture lifecycle', () => {
  test('captures configure cookies and sends them back', async () => {
    const config: ProviderConfig = {
      ...testConfig,
      cookies: {
        capture: ['PHPSESSID', 'SUBSCR'],
        send: true,
      },
      operations: {
        testOp: {
          method: 'GET',
          function: 'test',
          requiredParams: {},
          response: { fields: {} },
          errorHandling: { errorPath: 'err', errorMessagePath: 'msg' },
        },
      },
    };

    const headersMap = new Map<string, string>([
      ['set-cookie', 'PHPSESSID=xyz789; Path=/, SUBSCR=abc456; Path=/'],
    ]);
    const mockHeaders = {
      get: (name: string) => headersMap.get(name.toLowerCase()) || null,
    } as unknown as Headers;

    (globalThis as any).fetch = mock(() => {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: mockHeaders,
        text: () => Promise.resolve('{"result": "ok"}'),
      } as unknown as Response);
    });

    const service = new EmailService(config, {} as never);
    await service.executeOperation('testOp');

    const captured = service.getSessionCookies();
    expect(captured.PHPSESSID).toBe('xyz789');
    expect(captured.SUBSCR).toBe('abc456');

    await service.executeOperation('testOp');
    const lastFetchCall = (globalThis.fetch as any).mock.calls[1];
    const requestOptions = lastFetchCall[1] as RequestInit;
    expect((requestOptions.headers as Record<string, string>).Cookie).toBe(
      'PHPSESSID=xyz789; SUBSCR=abc456'
    );
  });
});

// ── header capture lifecycle ─────────────────────────────────────────────────

describe('header capture lifecycle', () => {
  test('captures configured headers and exposes them', async () => {
    const config: ProviderConfig = {
      ...testConfig,
      responseHeaders: {
        capture: ['ETag', 'X-Rate-Limit'],
      },
      operations: {
        testOp: {
          method: 'GET',
          function: 'test',
          requiredParams: {},
          response: { fields: {} },
          errorHandling: { errorPath: 'err', errorMessagePath: 'msg' },
        },
      },
    };

    const headersMap = new Map<string, string>([
      ['etag', 'etag123'],
      ['x-rate-limit', '60'],
    ]);
    const mockHeaders = {
      get: (name: string) => headersMap.get(name.toLowerCase()) || null,
    } as unknown as Headers;

    (globalThis as any).fetch = mock(() => {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: mockHeaders,
        text: () => Promise.resolve('{"result": "ok"}'),
      } as unknown as Response);
    });

    const service = new EmailService(config, {} as never);
    await service.executeOperation('testOp');

    const captured = service.getSessionHeaders();
    expect(captured.ETag).toBe('etag123');
    expect(captured['X-Rate-Limit']).toBe('60');
  });
});

// ── empty body policy rules ──────────────────────────────────────────────────

describe('empty body policy rules', () => {
  test('throws ApiError when emptyMeansError is true and body is empty', async () => {
    const config: ProviderConfig = {
      ...testConfig,
      operations: {
        testOp: {
          method: 'GET',
          function: 'test',
          requiredParams: {},
          response: { fields: {}, emptyMeansError: true },
          errorHandling: { errorPath: 'err', errorMessagePath: 'msg' },
        },
      },
    };

    (globalThis as any).fetch = mock(() => {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null } as unknown as Headers,
        text: () => Promise.resolve(''),
      } as unknown as Response);
    });

    const service = new EmailService(config, {} as never);
    await expect(service.executeOperation('testOp')).rejects.toThrow('emptyMeansError');
  });

  test('throws ApiError when allowEmptyBody is false and body is empty', async () => {
    const config: ProviderConfig = {
      ...testConfig,
      operations: {
        testOp: {
          method: 'GET',
          function: 'test',
          requiredParams: {},
          response: { fields: {}, allowEmptyBody: false },
          errorHandling: { errorPath: 'err', errorMessagePath: 'msg' },
        },
      },
    };

    (globalThis as any).fetch = mock(() => {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null } as unknown as Headers,
        text: () => Promise.resolve(''),
      } as unknown as Response);
    });

    const service = new EmailService(config, {} as never);
    await expect(service.executeOperation('testOp')).rejects.toThrow('allowEmptyBody');
  });
});

// ── response required fields validation checking ─────────────────────────────

describe('response required fields validation checking', () => {
  test('throws ValidationError when a required field is missing in data payload', async () => {
    const config: ProviderConfig = {
      ...testConfig,
      operations: {
        testOp: {
          method: 'GET',
          function: 'test',
          requiredParams: {},
          response: { fields: {}, requiredFields: ['needed_key'] },
          errorHandling: { errorPath: 'err', errorMessagePath: 'msg' },
        },
      },
    };

    (globalThis as any).fetch = mock(() => {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null } as unknown as Headers,
        text: () => Promise.resolve('{"other_key": "some_value"}'),
      } as unknown as Response);
    });

    const service = new EmailService(config, {} as never);
    await expect(service.executeOperation('testOp')).rejects.toThrow('needed_key');
  });

  test('succeeds when all required fields are present in data payload', async () => {
    const config: ProviderConfig = {
      ...testConfig,
      operations: {
        testOp: {
          method: 'GET',
          function: 'test',
          requiredParams: {},
          response: { fields: {}, requiredFields: ['needed_key'] },
          errorHandling: { errorPath: 'err', errorMessagePath: 'msg' },
        },
      },
    };

    (globalThis as any).fetch = mock(() => {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null } as unknown as Headers,
        text: () => Promise.resolve('{"needed_key": "some_value"}'),
      } as unknown as Response);
    });

    const service = new EmailService(config, {} as never);
    const result = await service.executeOperation('testOp');
    expect(result).toBeDefined();
  });
});

// ── response contract schema validation ──────────────────────────────────────

describe('response contract schema validation', () => {
  test('throws ValidationError when a required schema property is missing', async () => {
    const config: ProviderConfig = {
      ...testConfig,
      operations: {
        testOp: {
          method: 'GET',
          function: 'test',
          requiredParams: {},
          response: {
            fields: {},
            schema: {
              email: 'string',
            },
          },
          errorHandling: { errorPath: 'err', errorMessagePath: 'msg' },
        },
      },
    };

    (globalThis as any).fetch = mock(() => {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null } as unknown as Headers,
        text: () => Promise.resolve('{"name": "test"}'),
      } as unknown as Response);
    });

    const service = new EmailService(config, {} as never);
    await expect(service.executeOperation('testOp')).rejects.toThrow(
      'missing required schema property'
    );
  });

  test('throws ValidationError when a required schema property type mismatches', async () => {
    const config: ProviderConfig = {
      ...testConfig,
      operations: {
        testOp: {
          method: 'GET',
          function: 'test',
          requiredParams: {},
          response: {
            fields: {},
            schema: {
              count: 'number',
            },
          },
          errorHandling: { errorPath: 'err', errorMessagePath: 'msg' },
        },
      },
    };

    (globalThis as any).fetch = mock(() => {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null } as unknown as Headers,
        text: () => Promise.resolve('{"count": "not-a-number"}'),
      } as unknown as Response);
    });

    const service = new EmailService(config, {} as never);
    await expect(service.executeOperation('testOp')).rejects.toThrow('type mismatch');
  });

  test('succeeds when all schema types match', async () => {
    const config: ProviderConfig = {
      ...testConfig,
      operations: {
        testOp: {
          method: 'GET',
          function: 'test',
          requiredParams: {},
          response: {
            fields: {},
            schema: {
              email: 'string',
              active: 'boolean',
              tags: 'array',
            },
          },
          errorHandling: { errorPath: 'err', errorMessagePath: 'msg' },
        },
      },
    };

    (globalThis as any).fetch = mock(() => {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null } as unknown as Headers,
        text: () => Promise.resolve('{"email": "a@b.com", "active": true, "tags": ["test"]}'),
      } as unknown as Response);
    });

    const service = new EmailService(config, {} as never);
    const result = await service.executeOperation('testOp');
    expect(result).toBeDefined();
  });
});

// ── deriveInboxTiming strategy configuration ──────────────────────────────────

describe('deriveInboxTiming strategy configuration', () => {
  test('uses custom createdAt and expiresAt and ttl fields when configured', () => {
    const config: ProviderConfig = {
      ...testConfig,
      expiry: {
        duration: 3600000,
        renewable: true,
        fields: {
          createdAt: 'custom_created',
          expiresAt: 'custom_expires',
          ttl: 'custom_ttl',
        },
      },
    };

    const payload = {
      custom_created: 1700000000000,
      custom_expires: 1700086400000,
    };

    const timing = deriveInboxTiming(payload, config);
    expect(timing.createdAt).toBe(1700000000000);
    expect(timing.expiresAt).toBe(1700086400000);
  });
});
