import { describe, expect, test } from 'bun:test';
import type { EmailServiceContext, OperationConfig, ProviderConfig } from '../email-service';
import {
  buildRequest,
  checkForErrors,
  extractPath,
  parseDateString,
  parseResponse,
  parseTimestamp,
  parseTimestampValue,
  resolveTemplateParams,
  resolveTemplateValue,
} from './email-fetcher';

// ── extractPath ─────────────────────────────────────────────────────────────

describe('extractPath', () => {
  test('returns undefined for non-object input', () => {
    expect(extractPath(null, 'a')).toBeUndefined();
    expect(extractPath(undefined, 'a')).toBeUndefined();
    expect(extractPath('string', 'a')).toBeUndefined();
    expect(extractPath(42, 'a')).toBeUndefined();
  });

  test('returns the object itself for empty path', () => {
    const obj = { a: 1 };
    expect(extractPath(obj, '')).toBe(obj);
  });

  test('returns the object itself for empty string path', () => {
    const obj = { a: 1 };
    expect(extractPath(obj, '')).toBe(obj);
  });

  test('extracts simple nested value', () => {
    const obj = { a: { b: { c: 42 } } };
    expect(extractPath(obj, 'a.b.c')).toBe(42);
  });

  test('returns undefined for missing path', () => {
    const obj = { a: 1 };
    expect(extractPath(obj, 'b')).toBeUndefined();
    expect(extractPath(obj, 'a.b')).toBeUndefined();
  });

  test('handles deeply nested objects', () => {
    const obj = { level1: { level2: { level3: { level4: 'deep' } } } };
    expect(extractPath(obj, 'level1.level2.level3.level4')).toBe('deep');
  });

  test('handles array values', () => {
    const obj = { items: [10, 20, 30] };
    expect(extractPath(obj, 'items')).toEqual([10, 20, 30]);
  });

  test('handles falsy values correctly', () => {
    const obj = { zero: 0, empty: '', falsy: false, nothing: null };
    expect(extractPath(obj, 'zero')).toBe(0);
    expect(extractPath(obj, 'empty')).toBe('');
    expect(extractPath(obj, 'falsy')).toBe(false);
    expect(extractPath(obj, 'nothing')).toBe(null);
  });

  test('negation path with ! prefix', () => {
    const obj = { error: false };
    expect(extractPath(obj, '!error')).toBe(true);

    const obj2 = { error: true };
    expect(extractPath(obj2, '!error')).toBe(false);
  });

  test('negation path for missing value', () => {
    const obj = {};
    expect(extractPath(obj, '!nonexistent')).toBe(true);
  });
});

// ── resolveTemplateValue ────────────────────────────────────────────────────

describe('resolveTemplateValue', () => {
  test('returns value as-is if no template syntax', () => {
    const ctx: EmailServiceContext = {};
    expect(resolveTemplateValue('hello', ctx)).toBe('hello');
    expect(resolveTemplateValue('no-braces', ctx)).toBe('no-braces');
  });

  test('resolves {auth.token}', () => {
    const ctx: EmailServiceContext = { auth: { token: 'abc123' } };
    expect(resolveTemplateValue('{auth.token}', ctx)).toBe('abc123');
  });

  test('returns template string if no auth token provided', () => {
    const ctx: EmailServiceContext = {};
    expect(resolveTemplateValue('{auth.token}', ctx)).toBe('{auth.token}');
  });

  test('resolves {timestamp}', () => {
    const ctx: EmailServiceContext = {};
    const result = resolveTemplateValue('{timestamp}', ctx);
    expect(typeof result).toBe('string');
    const num = Number(result);
    expect(num).toBeGreaterThan(0);
    expect(num).toBeCloseTo(Date.now(), -2);
  });

  test('resolves {random}', () => {
    const ctx: EmailServiceContext = {};
    const result = resolveTemplateValue('{random}', ctx);
    expect(typeof result).toBe('string');
    expect((result as string).length).toBeGreaterThan(0);
    // Two calls should produce different values
    const result2 = resolveTemplateValue('{random}', ctx);
    expect(result).not.toBe(result2);
  });

  test('resolves {instanceUrl}', () => {
    const ctx: EmailServiceContext = { instanceUrl: 'https://api.example.com' };
    expect(resolveTemplateValue('{instanceUrl}', ctx)).toBe('https://api.example.com');
  });

  test('resolves context variables', () => {
    const ctx: EmailServiceContext = { variables: { emailUser: 'testuser' } };
    expect(resolveTemplateValue('{emailUser}', ctx)).toBe('testuser');
  });

  test('returns template string for unknown variable', () => {
    const ctx: EmailServiceContext = {};
    expect(resolveTemplateValue('{unknown}', ctx)).toBe('{unknown}');
  });
});

// ── resolveTemplateParams ───────────────────────────────────────────────────

describe('resolveTemplateParams', () => {
  test('resolves all template values in params', () => {
    const ctx: EmailServiceContext = {
      auth: { token: 'tok123' },
      variables: { user: 'alice' },
    };
    const params = {
      token: '{auth.token}',
      user: '{user}',
      static: 'plain-value',
    };
    const resolved = resolveTemplateParams(params, ctx);
    expect(resolved).toEqual({
      token: 'tok123',
      user: 'alice',
      static: 'plain-value',
    });
  });

  test('skips undefined resolved values', () => {
    const ctx: EmailServiceContext = {};
    const params = { missing: '{unknown}' };
    const resolved = resolveTemplateParams(params, ctx);
    // Unknown variable returns the template string, not undefined
    expect(resolved).toEqual({ missing: '{unknown}' });
  });

  test('handles empty params', () => {
    const ctx: EmailServiceContext = {};
    expect(resolveTemplateParams({}, ctx)).toEqual({});
  });
});

// ── parseTimestampValue ──────────────────────────────────────────────────────

describe('parseTimestampValue', () => {
  test('parses numeric timestamp in seconds', () => {
    expect(parseTimestampValue(1700000000)).toBe(1700000000);
  });

  test('parses numeric timestamp in milliseconds and converts', () => {
    expect(parseTimestampValue(1700000000000)).toBe(1700000000);
  });

  test('parses string timestamp', () => {
    expect(parseTimestampValue('1700000000')).toBe(1700000000);
  });

  test('parses numeric string timestamp', () => {
    const result = parseTimestampValue('1700000000');
    expect(result).toBe(1700000000);
  });

  test('returns null for invalid string', () => {
    expect(parseTimestampValue('not-a-date')).toBeNull();
  });

  test('returns null for zero', () => {
    expect(parseTimestampValue(0)).toBeNull();
  });

  test('returns null for negative', () => {
    expect(parseTimestampValue(-100)).toBeNull();
  });

  test('returns null for null/undefined', () => {
    expect(parseTimestampValue(null)).toBeNull();
    expect(parseTimestampValue(undefined)).toBeNull();
  });
});

// ── parseDateString ─────────────────────────────────────────────────────────

describe('parseDateString', () => {
  test('parses datetime with dash and space', () => {
    const result = parseDateString('2023-11-14 22:13:20');
    expect(result).not.toBeNull();
    expect(result?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
  });

  test('parses datetime with dash-space format and Z appended', () => {
    // The function appends Z if not present, so "2023-11-14 22:13:20" → "2023-11-14T22:13:20Z"
    const result = parseDateString('2023-11-14 22:13:20');
    expect(result).not.toBeNull();
    expect(result?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
  });

  test('parses time-only string (HH:MM:SS)', () => {
    const result = parseDateString('14:30:00');
    expect(result).not.toBeNull();
    expect(result?.getUTCHours()).toBe(14);
    expect(result?.getUTCMinutes()).toBe(30);
    expect(result?.getUTCSeconds()).toBe(0);
  });

  test('parses time-only string (HH:MM)', () => {
    const result = parseDateString('09:15');
    expect(result).not.toBeNull();
    expect(result?.getUTCHours()).toBe(9);
    expect(result?.getUTCMinutes()).toBe(15);
  });

  test('returns null for plain text', () => {
    expect(parseDateString('hello world')).toBeNull();
  });
});

// ── parseTimestamp ───────────────────────────────────────────────────────────

describe('parseTimestamp', () => {
  test('returns current time as fallback when no fields provided', () => {
    const before = Math.floor(Date.now() / 1000);
    const result = parseTimestamp(null, null, null, {});
    const after = Math.floor(Date.now() / 1000);
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  test('uses timestamp field when provided', () => {
    const result = parseTimestamp(1700000000, null, null, {});
    expect(result).toBe(1700000000);
  });

  test('uses date field when provided', () => {
    const result = parseTimestamp(null, '2023-11-14 22:13:20', null, {});
    expect(result).toBe(1700000000);
  });

  test('uses fallback timestamp when primary is null', () => {
    const result = parseTimestamp(null, null, 1600000000, {});
    expect(result).toBe(1600000000);
  });

  test('uses list timestamp as final fallback', () => {
    const listData = { ts: 1500000000 };
    const result = parseTimestamp(null, null, null, listData);
    expect(result).toBe(1500000000);
  });

  test('date field takes priority over timestamp field', () => {
    const result = parseTimestamp(1600000000, '2023-11-14 22:13:20', null, {});
    // Date field is tried first, so if it parses successfully it wins
    expect(result).toBe(1700000000);
  });
});

// ── buildRequest ────────────────────────────────────────────────────────────

const testProviderConfig: ProviderConfig = {
  id: 'test',
  name: 'Test',
  displayName: 'Test',
  apiUrl: 'https://api.test.com/endpoint',
  auth: { type: 'query_parameter', paramName: 'token', description: 'auth' },
  retry: { maxAttempts: 1, delayMs: 0, backoffMultiplier: 1 },
  operations: {},
  expiry: { duration: 3600000, renewable: false },
};

const testOperation: OperationConfig = {
  method: 'GET',
  function: 'get_data',
  requiredParams: { key: 'value' },
  response: { fields: {} },
  errorHandling: { errorPath: 'error', errorMessagePath: 'msg' },
};

describe('buildRequest', () => {
  test('builds URL with function as query param', () => {
    const { url } = buildRequest(testProviderConfig, testOperation, {});
    expect(url).toContain('f=get_data');
    expect(url).toContain('key=value');
  });

  test('includes auth token as query parameter', () => {
    const { url } = buildRequest(testProviderConfig, testOperation, {
      auth: { token: 'mytoken' },
    });
    expect(url).toContain('token=mytoken');
  });

  test('resolves template values in required params', () => {
    const op: OperationConfig = {
      ...testOperation,
      requiredParams: { sid_token: '{auth.token}' },
    };
    const { url } = buildRequest(testProviderConfig, op, { auth: { token: 'tok123' } });
    expect(url).toContain('sid_token=tok123');
  });

  test('adds optional params when provided', () => {
    const op: OperationConfig = {
      ...testOperation,
      optionalParams: { extra: 'data' },
    };
    const { url } = buildRequest(testProviderConfig, op, {});
    expect(url).toContain('extra=data');
  });

  test('uses RESTful path for function starting with /', () => {
    const op: OperationConfig = {
      ...testOperation,
      function: '/inbox/{inboxId}/messages',
    };
    const { url } = buildRequest(testProviderConfig, op, {
      variables: { inboxId: '123' },
    });
    expect(url).toContain('/inbox/123/messages');
    expect(url).not.toContain('f=');
  });

  test('replaces {instanceUrl} in apiUrl', () => {
    const config: ProviderConfig = {
      ...testProviderConfig,
      apiUrl: '{instanceUrl}/api/v2',
    };
    const { url } = buildRequest(config, testOperation, {
      instanceUrl: 'https://custom.api.com',
    });
    expect(url).toContain('custom.api.com/api/v2');
  });

  test('sets correct HTTP method', () => {
    const { options } = buildRequest(testProviderConfig, testOperation, {});
    expect(options.method).toBe('GET');
  });

  test('sets POST method correctly', () => {
    const op: OperationConfig = { ...testOperation, method: 'POST' };
    const { options } = buildRequest(testProviderConfig, op, {});
    expect(options.method).toBe('POST');
  });

  test('sets credentials from config', () => {
    const { options } = buildRequest(testProviderConfig, testOperation, {});
    expect(options.credentials).toBe('include');
  });

  test('applies forceNewSession headers when enabled', () => {
    const config: ProviderConfig = {
      ...testProviderConfig,
      forceNewSession: {
        enabled: true,
        params: {},
        headers: { 'Cache-Control': 'no-cache' },
        credentials: 'omit',
        cache: 'no-store',
      },
    };
    const { options } = buildRequest(config, testOperation, { forceNewSession: true });
    expect((options.headers as Record<string, string>)['Cache-Control']).toBe('no-cache');
    expect(options.credentials).toBe('omit');
    expect(options.cache).toBe('no-store');
  });

  test('does not apply forceNewSession when not enabled', () => {
    const config: ProviderConfig = {
      ...testProviderConfig,
      forceNewSession: {
        enabled: false,
        params: {},
        headers: { 'Cache-Control': 'no-cache' },
        credentials: 'omit',
        cache: 'no-store',
      },
    };
    const { options } = buildRequest(config, testOperation, { forceNewSession: true });
    expect(options.credentials).toBe('include');
  });

  test('includes header auth in headers', () => {
    const config: ProviderConfig = {
      ...testProviderConfig,
      auth: { type: 'header', headerName: 'X-API-Key', description: 'auth' },
    };
    const { options } = buildRequest(config, testOperation, { auth: { token: 'key123' } });
    expect((options.headers as Record<string, string>)['X-API-Key']).toBe('key123');
  });
});

// ── checkForErrors ──────────────────────────────────────────────────────────

describe('checkForErrors', () => {
  test('does not throw when error path is falsy', () => {
    expect(() =>
      checkForErrors({ error: false }, { errorPath: 'error', errorMessagePath: 'msg' })
    ).not.toThrow();
  });

  test('throws when error path is truthy', () => {
    expect(() =>
      checkForErrors(
        { error: true, msg: 'Something went wrong' },
        { errorPath: 'error', errorMessagePath: 'msg' }
      )
    ).toThrow('Something went wrong');
  });

  test('throws with default message when error message path is missing', () => {
    expect(() =>
      checkForErrors({ error: true }, { errorPath: 'error', errorMessagePath: 'msg' })
    ).toThrow('Unknown error');
  });

  test('does not throw for non-object data', () => {
    expect(() =>
      checkForErrors(null, { errorPath: 'error', errorMessagePath: 'msg' })
    ).not.toThrow();
    expect(() =>
      checkForErrors('string', { errorPath: 'error', errorMessagePath: 'msg' })
    ).not.toThrow();
  });

  test('handles nested error path', () => {
    expect(() =>
      checkForErrors(
        { response: { error: true, msg: 'Nested error' } },
        { errorPath: 'response.error', errorMessagePath: 'response.msg' }
      )
    ).toThrow('Nested error');
  });
});

// ── parseResponse ───────────────────────────────────────────────────────────

describe('parseResponse', () => {
  test('returns full data when no dataPath and no fields', () => {
    const data = { a: 1, b: 2 };
    const result = parseResponse(data, { fields: {} });
    expect(result).toEqual(data);
  });

  test('extracts dataPath and maps fields', () => {
    const data = {
      result: { email_addr: 'test@test.com', sid_token: 'tok123', extra: 'ignored' },
    };
    const result = parseResponse(data, {
      dataPath: 'result',
      fields: { address: 'email_addr', token: 'sid_token' },
    });
    expect(result).toEqual({ address: 'test@test.com', token: 'tok123' });
  });

  test('returns extracted data when fields is empty but dataPath is set', () => {
    const data = { result: { a: 1, b: 2 } };
    const result = parseResponse(data, { dataPath: 'result', fields: {} });
    expect(result).toEqual({ a: 1, b: 2 });
  });

  test('returns empty object for null data', () => {
    expect(parseResponse(null, { fields: {} })).toEqual({});
  });

  test('handles missing dataPath gracefully', () => {
    const data = { a: 1, b: 2 };
    const result = parseResponse(data, {
      fields: { x: 'a' },
    });
    expect(result).toEqual({ x: 1 });
  });

  test('omits undefined field values', () => {
    const data = { present: 'yes' };
    const result = parseResponse(data, {
      fields: { found: 'present', missing: 'nonexistent' },
    });
    expect(result).toEqual({ found: 'yes' });
    expect(result.missing).toBeUndefined();
  });
});
