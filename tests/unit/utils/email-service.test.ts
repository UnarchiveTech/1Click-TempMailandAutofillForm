import { afterAll, afterEach, describe, expect, type Mock, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  applyProviderConfigArray,
  EmailService,
  type ProviderConfig,
  resetProviderConfigsToBundled,
  saveProviderOverridesToStorage,
} from '@/utils/email/email-service';
import {
  localizedErrorMessageOrFallback,
  translateResultMessage,
  ValidationError,
} from '@/utils/errors';
import { deriveAddressTiming } from '@/utils/provider/provider-expiry';
import { PROJECT_ROOT } from '../helpers/project-root';

// This suite exercises request construction and response handling. URL and DNS
// safety behavior has its own tests, so keep those network checks out of this
// fetch-call fixture.
mock.module('@/utils/provider/instance-validation.js', () => ({
  validateFetchUrl: mock(async () => ({ ok: true })),
}));

afterAll(() => {
  mock.restore();
});

// ── Mock fetch ──────────────────────────────────────────────────────────────

/** Exactly the arguments `fetch` receives, so call assertions stay typed. */
type FetchCall = [input: RequestInfo | URL, init?: RequestInit];
type FetchImpl = (...args: FetchCall) => Promise<Response>;
type FetchMock = Mock<FetchImpl>;

/**
 * `globalThis.fetch` seen as a plain callable: these tests replace it wholesale
 * and never use Bun's `preconnect` companion property.
 */
const fetchHost = globalThis as unknown as { fetch: FetchImpl };

const originalFetch = fetchHost.fetch;

/** The stub currently installed on `globalThis.fetch`, if any. */
let currentFetch: FetchMock | null = null;

/**
 * Install a `globalThis.fetch` stub and remember it, so tests can assert on the
 * calls it recorded. The implementation may ignore request arguments it does
 * not need.
 */
function installFetch(impl: () => Promise<Response>): FetchMock {
  currentFetch = mock<FetchImpl>(impl);
  fetchHost.fetch = currentFetch;
  return currentFetch;
}

/** Calls recorded by the stub installed via {@link installFetch}. */
function fetchCalls(): FetchCall[] {
  if (!currentFetch) throw new Error('No fetch stub installed');
  return currentFetch.mock.calls;
}

function mockFetch(
  responses: Array<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
    text?: () => Promise<string>;
  }>
): FetchMock {
  let callIndex = 0;
  return installFetch(() => {
    const resp = responses[Math.min(callIndex, responses.length - 1)];
    callIndex++;
    return Promise.resolve({ headers: new Headers(), body: null, ...resp } as Response);
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
  fetchHost.fetch = originalFetch;
  currentFetch = null;
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
    const calledUrl = fetchCalls()[0][0];
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

    const calledUrl = fetchCalls()[0][0];
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

    const calledUrl = fetchCalls()[0][0];
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

    const calledOptions = fetchCalls()[0][1] as RequestInit;
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
      secure: true,
      httpOnly: true,
    });

    const calledUrl = fetchCalls()[0][0];
    const calledOptions = fetchCalls()[0][1] as RequestInit;
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

    const calledOptions = fetchCalls()[0][1] as RequestInit;
    expect((calledOptions.headers as Record<string, string>)['Cache-Control']).toBe('no-cache');
    expect(calledOptions.credentials).toBe('omit');
    expect(calledOptions.cache).toBe('no-store');
  });
});

// ── responseType Parsing ──────────────────────────────────────────────────

function mockFetchRaw(
  responses: Array<{ ok: boolean; status: number; text: () => Promise<string> }>
): FetchMock {
  let callIndex = 0;
  return installFetch(() => {
    const resp = responses[Math.min(callIndex, responses.length - 1)];
    callIndex++;
    return Promise.resolve({ headers: new Headers(), body: null, ...resp } as Response);
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

    let attempts = 0;
    installFetch(() => {
      attempts++;
      if (attempts === 1) {
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
  test('captures Set-Cookie via getSetCookie and sends them via browser.cookies.set', async () => {
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

    // `set-cookie` is a FORBIDDEN response header in a service worker
    // (headers.get returns null) - capture runs off `getSetCookie()` instead.
    const mockHeaders = {
      get: () => null,
      getSetCookie: () => [
        'PHPSESSID=xyz789; Path=/',
        'SUBSCR=abc456; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT',
      ],
    } as unknown as Headers;

    installFetch(() => {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: mockHeaders,
        text: () => Promise.resolve('{"result": "ok"}'),
      } as unknown as Response);
    });

    const cookies = { set: mock(() => Promise.resolve({})) };
    const service = new EmailService(config, { cookies } as never);
    await service.executeOperation('testOp');

    const captured = service.getSessionCookies();
    expect(captured.PHPSESSID).toBe('xyz789');
    expect(captured.SUBSCR).toBe('abc456');

    // Second operation: the captured cookies are written into the browser
    // cookie jar (credentials: 'include' attaches them) - never a manual
    // Cookie header, which fetch() would silently drop.
    await service.executeOperation('testOp');
    expect(cookies.set).toHaveBeenCalledWith({
      url: 'https://api.test.com/endpoint',
      name: 'PHPSESSID',
      value: 'xyz789',
      secure: true,
      httpOnly: false,
      path: '/',
    });
    expect(cookies.set).toHaveBeenCalledWith({
      url: 'https://api.test.com/endpoint',
      name: 'SUBSCR',
      value: 'abc456',
      secure: true,
      httpOnly: false,
      path: '/',
    });
    const lastFetchCall = fetchCalls()[1];
    const requestOptions = lastFetchCall[1] as RequestInit;
    expect((requestOptions.headers as Record<string, string>).Cookie).toBeUndefined();
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

    installFetch(() => {
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

    installFetch(() => {
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

    installFetch(() => {
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

    installFetch(() => {
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

    installFetch(() => {
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

    installFetch(() => {
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

    installFetch(() => {
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

    installFetch(() => {
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

// ── deriveAddressTiming strategy configuration ──────────────────────────────────

describe('deriveAddressTiming strategy configuration', () => {
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

    const timing = deriveAddressTiming(payload, config);
    expect(timing.createdAt).toBe(1700000000000);
    expect(timing.expiresAt).toBe(1700086400000);
  });
});

// ── applyProviderConfigArray / saveProviderOverridesToStorage error payloads ───
//
// These two producers describe why an override was rejected. They used to return
// the validator's English prose (and, for a duplicate id, a template literal), so
// the first UI consumer to render them would have shown English in all eight
// locales - and the id of the offending provider lived in a string that a
// key-only payload could not carry. The reason is now a `LocalizedMessage`: a
// stable `errors.*` key with its slot values inside the same value, which is
// what makes it render (`{id}` filled) rather than leak.

/** Minimal stand-in for svelte-i18n's `$t`, reading the real `en.json`. */
const EN_ERRORS: Record<string, string> = (() => {
  const en = JSON.parse(readFileSync(`${PROJECT_ROOT}/src/locales/en.json`, 'utf8')) as Record<
    string,
    Record<string, string>
  >;
  // Keyed by the path a call site uses (`errors.<name>`), so the fake resolves
  // exactly the strings the producer names.
  return Object.fromEntries(
    Object.entries(en.errors).map(([name, value]) => [`errors.${name}`, value])
  );
})();

function fakeT(key: string, options?: { values?: Record<string, string | number> }): string {
  const template = EN_ERRORS[key];
  if (template === undefined) return key;
  const values = options?.values;
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match
  );
}

/** In-memory stand-in for `browser.storage.local`. */
function fakeStorage() {
  const store: Record<string, unknown> = {};
  return {
    storage: {
      local: {
        set: async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        },
        remove: async (key: string | string[]) => {
          for (const k of Array.isArray(key) ? key : [key]) delete store[k];
        },
      },
    },
  };
}

describe('provider override rejection reasons are keyed, never English prose', () => {
  // These calls mutate the module-level provider map that `loadProviderConfig()`
  // serves to every later test file in this process - a successful apply
  // replaces the bundled providers with `test-provider`. Restore the bundled
  // list after each case so no other file observes the override.
  afterEach(() => {
    resetProviderConfigsToBundled();
  });

  test('an empty list rejects with the array-required key', () => {
    const result = applyProviderConfigArray([]);

    expect(result.ok).toBe(false);
    expect(result.error?.key).toBe('errors.providerConfigArrayRequired');
    expect(result.error?.values).toBeUndefined();
  });

  test('a schema-invalid list names the offending field, never the validator message', () => {
    // `validateProviderConfig` rejects the missing `name` field with a keyed
    // reason, so the payload names it instead of collapsing to
    // `errors.providerConfigInvalid` - and never carries its English prose.
    const result = applyProviderConfigArray([{ id: 'x' } as ProviderConfig]);

    expect(result.ok).toBe(false);
    expect(result.error?.key).toBe('errors.providerConfigFieldMissing');
    expect(result.error?.values).toEqual({ field: 'name' });
    // The whole payload is the key + values: no prose survived anywhere in it.
    expect(JSON.stringify(result.error)).not.toContain('Provider config');
    expect(JSON.stringify(result.error)).not.toContain('missing required field');
  });

  test('the field-naming reason renders with the field substituted', () => {
    const result = applyProviderConfigArray([
      { ...testConfig, retry: { ...testConfig.retry, maxAttempts: -1 } },
    ]);

    const rendered = translateResultMessage(result.error, fakeT);
    expect(rendered).toContain('retry.maxAttempts');
    expect(rendered).not.toContain('{');
  });

  test('a wrong-shape field names the field in the rendered sentence', () => {
    // Deliberately invalid input, so the fixture has to bypass the declared
    // types - the validator is what is under test here.
    const wrongRenewable = {
      ...testConfig,
      expiry: { duration: 3_600_000, renewable: 'yes' },
    } as unknown as ProviderConfig;
    const result = applyProviderConfigArray([wrongRenewable]);

    expect(result.error?.key).toBe('errors.providerConfigFieldBoolean');
    const rendered = translateResultMessage(result.error, fakeT);
    expect(rendered).toContain('expiry.renewable');
    expect(rendered).not.toContain('{');
  });

  test('the JSON editor path throws the same field-naming pair', async () => {
    const rejection = await saveProviderOverridesToStorage(fakeStorage(), [
      { id: 'x' } as ProviderConfig,
    ]).then(
      () => null,
      (e: unknown) => e
    );

    const error = rejection as ValidationError;
    expect(error.translationKey).toBe('errors.providerConfigFieldMissing');
    expect(error.translationValues).toEqual({ field: 'name' });
    expect(
      localizedErrorMessageOrFallback(error, fakeT, 'mailProvider.editJsonSaveFailed')
    ).toContain('name');
  });

  test('a duplicate id carries the offending id as a slot value', () => {
    const result = applyProviderConfigArray([testConfig, { ...testConfig }]);

    expect(result.ok).toBe(false);
    expect(result.error?.key).toBe('errors.providerConfigDuplicateId');
    expect(result.error?.values).toEqual({ id: 'test-provider' });
  });

  test('the rejected reason renders with the id substituted, no {slot} left', () => {
    const result = applyProviderConfigArray([testConfig, { ...testConfig }]);

    const rendered = translateResultMessage(result.error, fakeT);
    expect(rendered).toContain('test-provider');
    expect(rendered).not.toContain('{');
    expect(rendered).not.toContain('errors.');
  });

  test('an empty key renders nothing rather than a raw key', () => {
    // `translateResultMessage` returns '' for a `{slot}` it could not fill, so a
    // consumer's own `|| $t('…failed')` copy takes over instead of the user
    // reading `Duplicate provider id "{id}"`.
    const orphaned = { key: 'errors.providerConfigDuplicateId' };

    expect(translateResultMessage(orphaned, fakeT)).toBe('');
  });

  test('saveProviderOverridesToStorage throws a keyed ValidationError, not prose', async () => {
    const ext = fakeStorage();

    const rejection = await saveProviderOverridesToStorage(ext, [
      testConfig,
      { ...testConfig },
    ]).then(
      () => null,
      (e: unknown) => e
    );

    expect(rejection).toBeInstanceOf(ValidationError);
    const error = rejection as ValidationError;
    expect(error.translationKey).toBe('errors.providerConfigDuplicateId');
    expect(error.translationValues).toEqual({ id: 'test-provider' });
    // The JSON editor's own `localizedErrorMessageOrFallback` path - the reason
    // the pair has to travel on the error, not just the key.
    expect(
      localizedErrorMessageOrFallback(error, fakeT, 'mailProvider.editJsonSaveFailed')
    ).toContain('test-provider');
  });

  test('an empty list throws the array-required key', async () => {
    const rejection = await saveProviderOverridesToStorage(fakeStorage(), []).then(
      () => null,
      (e: unknown) => e
    );

    expect((rejection as ValidationError).translationKey).toBe(
      'errors.providerConfigArrayRequired'
    );
  });

  test('a valid list still saves and applies', async () => {
    const ext = fakeStorage();

    await expect(saveProviderOverridesToStorage(ext, [testConfig])).resolves.toBeUndefined();
    expect(applyProviderConfigArray([testConfig]).ok).toBe(true);
  });
});
