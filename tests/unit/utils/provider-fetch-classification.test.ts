/**
 * Provider-fetch failures must arrive at the UI as a stable `errors.*` code.
 *
 * Before this, every fetch-layer failure - a 503, a dropped network, a blocked
 * redirect, a refused URL, a provider-reported error - collapsed into
 * `errors.apiCallFailed`, and the reason lived only in the English `message` no
 * result payload carries. These tests pin the classification AND the rendering:
 * a code that names the reason, and a locale sentence (never the engine prose)
 * on the other side of `renderResultError`.
 *
 * No module mock here on purpose: the URL gate is driven with real inputs (an
 * `http:` URL is a static rejection), so nothing can leak into another test file.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { checkForErrors } from '@/utils/dsl/email-fetcher';
import { EmailService, type ProviderConfig } from '@/utils/email/email-service';
import {
  ErrorCode,
  getTranslationKeyForError,
  ProviderHttpError,
  ProviderRequestRejectedError,
  ProviderUnreachableError,
  RedirectBlockedError,
  renderResultError,
  toResultError,
  toResultErrorKey,
  translateResultMessage,
  urlGateError,
} from '@/utils/errors';
import { PROJECT_ROOT } from '../helpers/project-root';

const SAFE_URL = 'https://api.guerrillamail.com/ajax.php';
const originalFetch = globalThis.fetch;
let fetchImpl: () => Promise<Response> = () => Promise.resolve(new Response('{}', { status: 200 }));

beforeEach(() => {
  fetchImpl = () => Promise.resolve(new Response('{}', { status: 200 }));
  globalThis.fetch = (async () => fetchImpl()) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    // Match the exact bundled endpoint so these classification tests do not
    // depend on external DNS. Redirect destinations still run the full gate.
    id: 'guerrilla',
    name: 'Classify Test',
    // Same host as the request below, so the URL gate skips the DNS pass - no
    // network in the unit suite.
    apiUrl: SAFE_URL,
    auth: { type: 'none' },
    expiry: { duration: 86_400_000, renewable: true },
    customEmail: { supported: true },
    ui: { supportsCustomInstance: false, multiInstance: false, supportsCustomEmail: true },
    retry: { maxAttempts: 1, delayMs: 1, backoffMultiplier: 1 },
    operations: {
      fetchEmails: {
        method: 'GET',
        function: 'noop',
        requiredParams: {},
        response: { fields: {} },
        errorHandling: { errorPath: 'error', errorMessagePath: 'message' },
      },
    },
    ...overrides,
  } as unknown as ProviderConfig;
}

const NOOP_BROWSER = {} as unknown as Browser;

/** The private fetch wrapper, exercised directly (same trick as the redirect tests). */
async function safeFetch(url: string = SAFE_URL): Promise<unknown> {
  const service = new EmailService(makeConfig({}), NOOP_BROWSER);
  const fetcher = service as unknown as {
    safeFetch: (url: string, options: RequestInit) => Promise<Response>;
  };
  return fetcher.safeFetch(url, {}).catch((e: unknown) => e);
}

/** The request never reaches a response (DNS/connection drop). */
function fetchFails(): void {
  fetchImpl = () => Promise.reject(new TypeError('Failed to fetch'));
}

/** The real English dictionary, flattened to dotted keys (as the i18n layer sees it). */
const EN: Record<string, string> = (() => {
  const flat: Record<string, string> = {};
  const walk = (node: unknown, path: string) => {
    if (typeof node === 'string') {
      flat[path] = node;
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        walk(value, path ? `${path}.${key}` : key);
      }
    }
  };
  walk(JSON.parse(readFileSync(`${PROJECT_ROOT}/src/locales/en.json`, 'utf8')), '');
  return flat;
})();

function tEn(key: string, vars?: Record<string, string | number>): string {
  const raw = EN[key] ?? key;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? `{${name}}`));
}

describe('a non-2xx provider response', () => {
  test('is its own keyed HTTP error - with the status still readable by the retry policy', async () => {
    fetchImpl = () =>
      Promise.resolve(new Response('nope', { status: 503, statusText: 'Service Unavailable' }));

    const err = (await new EmailService(makeConfig({}), NOOP_BROWSER)
      .executeOperation('fetchEmails')
      .catch((e: unknown) => e)) as ProviderHttpError;

    expect(err).toBeInstanceOf(ProviderHttpError);
    expect(err.translationKey).toBe('errors.providerHttpError');
    expect(err.translationValues).toEqual({ status: 503 });
    // The retry policy (4xx vs 5xx, 429 Retry-After) reads the status off context.
    expect(err.context?.status).toBe(503);
    expect(toResultErrorKey(err)).toBe('errors.providerHttpError');
  });
});

describe('a request that never reached a response', () => {
  test('is classified as unreachable, not as an API failure', async () => {
    fetchFails();

    const err = (await safeFetch()) as ProviderUnreachableError;

    expect(err).toBeInstanceOf(ProviderUnreachableError);
    expect(err.translationKey).toBe('errors.providerUnreachable');
    expect(toResultErrorKey(err)).toBe('errors.providerUnreachable');
  });
});

describe('the URL safety gate', () => {
  // The gate is `https:`-only and names its reason with a stable `errors.*` key.
  // (Its end-to-end wiring - `buildRequest` refusing `http://127.0.0.1:8080/api`
  // with that key - is pinned by tests/unit/utils/dsl/email-fetcher.test.ts; this
  // file stays on the contract so no other test file's module mock can change
  // what it measures.)
  test('a key-naming refusal keeps that key instead of flattening to one generic URL error', () => {
    const err = urlGateError('http://127.0.0.1:8080/api', 'errors.webdavHttpsOnly');

    expect(err.code).toBe(ErrorCode.INVALID_URL);
    expect(err.translationKey).toBe('errors.webdavHttpsOnly');
    expect(toResultErrorKey(err)).toBe('errors.webdavHttpsOnly');
  });

  test('a free-text reason lands on errors.invalidUrl and keeps the detail in the log', () => {
    const err = urlGateError(SAFE_URL, 'URL hostname resolves to private network');

    expect(err.translationKey).toBe('errors.invalidUrl');
    expect(err.context?.reason).toBe('URL hostname resolves to private network');
    expect(err.message).toContain('private network');
  });
});

describe('a redirect the guard refuses', () => {
  test('is a blocked redirect with a neutral key (shared with WebDAV)', async () => {
    fetchImpl = () => {
      const response = new Response(null, { status: 302 });
      Object.defineProperty(response, 'type', { value: 'opaqueredirect' });
      return Promise.resolve(response);
    };

    const err = (await safeFetch()) as RedirectBlockedError;

    expect(err).toBeInstanceOf(RedirectBlockedError);
    expect(err.translationKey).toBe('errors.redirectBlocked');
    expect(toResultErrorKey(err)).toBe('errors.redirectBlocked');
  });
});

describe("the provider's own error path", () => {
  test('is a stable rejection - its English detail stays in the log', () => {
    const err = (() => {
      try {
        checkForErrors(
          { error: true, message: 'Invalid API token' },
          { errorPath: 'error', errorMessagePath: 'message' }
        );
      } catch (e) {
        return e as ProviderRequestRejectedError;
      }
      throw new Error('checkForErrors did not throw');
    })();

    expect(err).toBeInstanceOf(ProviderRequestRejectedError);
    expect(err.translationKey).toBe('errors.providerRequestRejected');
    expect(err.context?.detail).toBe('Invalid API token');
    expect(toResultErrorKey(err)).toBe('errors.providerRequestRejected');
  });
});

describe('the codes the UI renders', () => {
  test('each new code resolves to a key that exists in en.json', () => {
    const codes = [
      ErrorCode.PROVIDER_UNREACHABLE,
      ErrorCode.PROVIDER_HTTP_ERROR,
      ErrorCode.PROVIDER_REQUEST_REJECTED,
      ErrorCode.REDIRECT_BLOCKED,
    ];
    for (const code of codes) {
      const key = getTranslationKeyForError(code);
      expect(key.startsWith('errors.')).toBe(true);
      expect(typeof EN[key]).toBe('string');
    }
  });

  test('the HTTP error renders its status through the locale - never the engine prose', () => {
    const err = new ProviderHttpError(503, 'Service Unavailable', { provider: 'classify-test' });

    // The typed path: the key travels WITH its slot values, so the status renders.
    const rendered = translateResultMessage(toResultError(err), (key, opts) =>
      tEn(key, opts?.values)
    );

    expect(rendered).toBe('The mail provider returned an error (status 503).');
    expect(rendered).not.toContain('Provider responded with HTTP');
    // The raw engine message is still there for the log - it is just not the payload.
    expect(err.message).toContain('HTTP 503');
  });

  test('the bare-string arm never prints an unresolved slot - it falls back instead', () => {
    const err = new ProviderHttpError(503, 'Service Unavailable', { provider: 'classify-test' });

    // `errorPayload` (and the batch results) can only carry the key across the
    // messaging boundary, so the values are gone by the time the UI renders it.
    const rendered = renderResultError(toResultErrorKey(err), tEn, 'errors.networkErrorGeneric');

    expect(rendered).toBe(tEn('errors.networkErrorGeneric'));
    expect(rendered).not.toContain('{status}');
  });
});
