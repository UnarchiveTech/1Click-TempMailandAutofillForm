// biome-ignore-all lint/suspicious/noExplicitAny: mock and stub typings
import { describe, expect, mock, test } from 'bun:test';
import {
  buildRequest,
  checkForErrors,
  extractPath,
  fetchEmails,
  mapMessageItem,
  parseDateString,
  parseResponse,
  parseTimestamp,
  parseTimestampValue,
  resolveTemplateParams,
  resolveTemplateValue,
} from '@/utils/dsl/email-fetcher';
import type { EmailServiceContext, OperationConfig, ProviderConfig } from '@/utils/email-service';
import type { Account } from '@/utils/types.js';

// Mock global browser API
(globalThis as Record<string, unknown>).browser = {
  storage: {
    local: {
      get: mock(() => Promise.resolve({})),
      set: mock(() => Promise.resolve({})),
    },
  },
};

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

  test('does not put cookie auth into URL or request headers', () => {
    const config: ProviderConfig = {
      ...testProviderConfig,
      auth: { type: 'cookie', cookieName: 'PHPSESSID', description: 'auth' },
    };
    const { options, url } = buildRequest(config, testOperation, { auth: { token: 'sid123' } });
    expect((options.headers as Record<string, string>).Cookie).toBeUndefined();
    expect(url).not.toContain('sid123');
  });

  test('supports bearer auth in Authorization header', () => {
    const config: ProviderConfig = {
      ...testProviderConfig,
      auth: { type: 'bearer', description: 'auth' },
    };
    const { options } = buildRequest(config, testOperation, { auth: { token: 'myjwt123' } });
    expect((options.headers as Record<string, string>).Authorization).toBe('Bearer myjwt123');
  });

  test('injects captured session cookies if send is enabled', () => {
    const config: ProviderConfig = {
      ...testProviderConfig,
      cookies: { send: true },
    };
    const { options } = buildRequest(config, testOperation, {
      sessionCookies: { PHPSESSID: 'session123', SUBSCR: 'sub456' },
    });
    expect((options.headers as Record<string, string>).Cookie).toBe(
      'PHPSESSID=session123; SUBSCR=sub456'
    );
  });

  test('supports JSON POST request body serialization', () => {
    const config = { ...testProviderConfig };
    const op: OperationConfig = {
      method: 'POST',
      function: 'test',
      bodyType: 'json',
      requiredParams: { param1: 'val1', param2: 'val2' },
      response: { fields: {} },
      errorHandling: { errorPath: 'err', errorMessagePath: 'msg' },
    };
    const { url, options } = buildRequest(config, op, {});
    expect((options.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(options.body).toBe(JSON.stringify({ param1: 'val1', param2: 'val2' }));
    expect(url).not.toContain('param1');
  });

  test('supports Form POST URL-encoded request body serialization', () => {
    const config = { ...testProviderConfig };
    const op: OperationConfig = {
      method: 'POST',
      function: 'test',
      bodyType: 'form',
      requiredParams: { param1: 'val1', param2: 'val2' },
      response: { fields: {} },
      errorHandling: { errorPath: 'err', errorMessagePath: 'msg' },
    };
    const { url, options } = buildRequest(config, op, {});
    expect((options.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded'
    );
    expect(options.body).toBe('param1=val1&param2=val2');
    expect(url).not.toContain('param1');
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

// ── mapMessageItem ──────────────────────────────────────────────────────────

describe('mapMessageItem', () => {
  test('maps response fields correctly', () => {
    const item = { mail_id: '123', mail_from: 'sender@example.com', mail_subject: 'Hello' };
    const mapping = { id: 'mail_id', from: 'mail_from', subject: 'mail_subject' };
    const result = mapMessageItem(item, mapping, undefined);
    expect(result).toEqual({ id: '123', from: 'sender@example.com', subject: 'Hello' });
  });

  test('maps attachments correctly when enabled', () => {
    const item = {
      mail_id: '123',
      att_info: [
        { f: 'document.pdf', t: 'application/pdf', p: '1' },
        { f: 'image.png', t: 'image/png', p: '2' },
      ],
    };
    const mapping = { id: 'mail_id' };
    const attMapping = {
      enabled: true,
      path: 'att_info',
      fields: {
        filename: 'f',
        mimeType: 't',
        partNumber: 'p',
        downloadUrl: null,
      },
    };
    const result = mapMessageItem(item, mapping, attMapping);
    expect(result).toEqual({
      id: '123',
      attachments: [
        {
          filename: 'document.pdf',
          mimeType: 'application/pdf',
          partNumber: '1',
          downloadUrl: null,
        },
        { filename: 'image.png', mimeType: 'image/png', partNumber: '2', downloadUrl: null },
      ],
    });
  });

  test('ignores attachments mapping if disabled', () => {
    const item = {
      mail_id: '123',
      att_info: [{ f: 'document.pdf', t: 'application/pdf', p: '1' }],
    };
    const mapping = { id: 'mail_id' };
    const attMapping = {
      enabled: false,
      path: 'att_info',
      fields: { filename: 'f', mimeType: 't' },
    };
    const result = mapMessageItem(item, mapping, attMapping);
    expect(result.attachments).toBeUndefined();
  });
});

// ── resolveTemplateValue Advanced Tokens ─────────────────────────────────────

describe('resolveTemplateValue advanced tokens', () => {
  test('resolves new auth variables', () => {
    const ctx: EmailServiceContext = {
      auth: {
        token: 'tok',
        jwt: 'jwt123',
        cookie: 'cook',
        apiKey: 'key',
        refreshToken: 'refresh',
      },
    };
    expect(resolveTemplateValue('{auth.jwt}', ctx)).toBe('jwt123');
    expect(resolveTemplateValue('{auth.cookie}', ctx)).toBe('cook');
    expect(resolveTemplateValue('{auth.apiKey}', ctx)).toBe('key');
    expect(resolveTemplateValue('{auth.refreshToken}', ctx)).toBe('refresh');
  });
});

// ── Field Transforms ──────────────────────────────────────────────────────────

describe('field transforms in mapMessageItem', () => {
  test('applies parseInt transform', () => {
    const item = { val: '456' };
    const mapping = { id: { path: 'val', transform: 'parseInt' } };
    const result = mapMessageItem(item, mapping, undefined);
    expect(result.id).toBe(456);
  });

  test('applies htmlEntityDecode transform', () => {
    const item = { text: 'Hello &amp; welcome &#39;user&#39;' };
    const mapping = { msg: { path: 'text', transform: 'htmlEntityDecode' } };
    const result = mapMessageItem(item, mapping, undefined);
    expect(result.msg).toBe("Hello & welcome 'user'");
  });

  test('applies trim and urlDecode transforms in list', () => {
    const item = { text: '  hello%20world  ' };
    const mapping = { msg: { path: 'text', transform: ['trim', 'urlDecode'] } };
    const result = mapMessageItem(item, mapping, undefined);
    expect(result.msg).toBe('hello world');
  });

  test('applies parseDate transform', () => {
    const item = { date: '2023-11-14 22:13:20' };
    const mapping = { ts: { path: 'date', transform: 'parseDate' } };
    const result = mapMessageItem(item, mapping, undefined);
    expect(result.ts).toBe(1700000000); // 2023-11-14T22:13:20Z
  });
});

// ── pagination in fetchEmails ────────────────────────────────────────────────

describe('pagination in fetchEmails', () => {
  test('injects default offset pagination variables', async () => {
    const config: ProviderConfig = {
      ...testProviderConfig,
      emailFetching: {
        type: 'single_step',
        operation: 'get_emails',
        pagination: {
          type: 'offset',
          paramName: 'myOffset',
          pageSize: 15,
        },
      },
    };
    const inbox = { id: 'inb123', address: 'test@test.com' } as unknown as Account;

    let calledContext: EmailServiceContext | null = null;
    const executeOperation = mock(async (_op: string, ctx: EmailServiceContext) => {
      calledContext = ctx;
      return { result: [] };
    });

    await fetchEmails(
      config,
      inbox,
      executeOperation as unknown as (
        opName: string,
        context?: EmailServiceContext
      ) => Promise<Record<string, unknown>>
    );
    expect(calledContext).not.toBeNull();
    expect((calledContext as any)?.variables?.myOffset).toBe(0);
    expect((calledContext as any)?.variables?.pageSize).toBe(15);
  });
});

// ── headers and cookies template expansion ───────────────────────────────────

describe('headers and cookies template expansion', () => {
  test('expands headers and cookies in resolveTemplateValue', () => {
    const ctx: EmailServiceContext = {
      sessionHeaders: { ETag: 'etag123' },
      sessionCookies: { PHPSESSID: 'sess456' },
    };
    expect(resolveTemplateValue('Prefix {headers.ETag}', ctx)).toBe('Prefix etag123');
    expect(resolveTemplateValue('Prefix {cookies.PHPSESSID}', ctx)).toBe('Prefix sess456');
  });

  test('substitutes headers and cookies in buildRequest API URL and path', () => {
    const config: ProviderConfig = {
      ...testProviderConfig,
      apiUrl: 'https://test.com/api/{headers.ETag}',
    };
    const op: OperationConfig = {
      method: 'GET',
      function: '/fetch/{cookies.PHPSESSID}',
      requiredParams: {},
      response: { fields: {} },
      errorHandling: { errorPath: 'err', errorMessagePath: 'msg' },
    };
    const { url } = buildRequest(config, op, {
      sessionHeaders: { ETag: 'etag123' },
      sessionCookies: { PHPSESSID: 'sess456' },
    });
    expect(url).toBe('https://test.com/api/etag123/fetch/sess456');
  });
});

// ── field defaults in mapMessageItem ─────────────────────────────────────────

describe('field defaults in mapMessageItem', () => {
  test('falls back to default value when path value is undefined', () => {
    const item = { val: null };
    const mapping = {
      id: { path: 'absent_key', default: 'myDefault' },
    };
    const result = mapMessageItem(item, mapping, undefined);
    expect(result.id).toBe('myDefault');
  });

  test('falls back to default value and applies transform if default is supplied', () => {
    const item = {};
    const mapping = {
      id: { path: 'absent_key', default: '123', transform: 'parseInt' },
    };
    const result = mapMessageItem(item, mapping, undefined);
    expect(result.id).toBe(123);
  });
});
