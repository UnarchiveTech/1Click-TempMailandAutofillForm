/**
 * Fetch helper that validates every exposed redirect target before following it.
 *
 * Browsers may return an opaque redirect for cross-origin manual redirects. In
 * that case the Location header is unavailable and the request fails closed.
 *
 * Every refusal throws a `RedirectBlockedError` carrying the stable
 * `errors.redirectBlocked` key (with the human detail in the message/context for
 * the log), so a caller that surfaces the failure to the UI or an agent can name
 * the reason instead of echoing engine prose.
 */
import { RedirectBlockedError } from '@/utils/errors.js';

export type FetchUrlValidation = { ok: boolean; error?: string };
export type FetchUrlValidator = (url: string) => FetchUrlValidation | Promise<FetchUrlValidation>;

export interface ValidatedRedirectOptions {
  /** Additional exact hostnames allowed beyond the initial request hostname. */
  allowedRedirectHosts?: readonly string[];
  /** Exact origins (including any non-default port) allowed as redirect targets. */
  allowedRedirectOrigins?: readonly string[];
  /** Maximum number of redirect hops to follow. */
  maxRedirects?: number;
  /** Provider-specific query parameters that must not cross host boundaries. */
  sensitiveQueryParams?: readonly string[];
  /**
   * Hard ceiling for the WHOLE call, in milliseconds: connect, headers and every
   * redirect hop share one budget, so a host that accepts the connection and then
   * never answers cannot pin the caller - and whatever lock the caller holds -
   * for the browser's own network timeout, which is minutes.
   *
   * The timer is cleared as soon as a response is returned; reading that
   * response's BODY is the caller's own to bound.
   */
  timeoutMs?: number;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_MAX_REDIRECTS = 5;
const SENSITIVE_REDIRECT_HEADER =
  /^(authorization|proxy-authorization|cookie|cookie2|set-cookie|x-api-key|x-auth-token|x-access-token|x-burner-key|.*token.*|.*secret.*|.*password.*|.*credential.*|.*session.*)$/i;
const SENSITIVE_REDIRECT_QUERY =
  /^(authorization|auth|token|.*(?:token|secret|password|passwd|api[_-]?key|session|credential).*)$/i;

function normalizeHost(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  try {
    return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function hostnameOf(url: string): string {
  return new URL(url).hostname.toLowerCase();
}

function originOf(url: string): string {
  return new URL(url).origin.toLowerCase();
}

function effectivePort(url: URL): string {
  return url.port || (url.protocol === 'https:' ? '443' : url.protocol === 'http:' ? '80' : '');
}

function normalizeOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin.toLowerCase();
  } catch {
    return null;
  }
}

function isSafeHttpsUpgrade(currentUrl: string, nextUrl: string): boolean {
  const current = new URL(currentUrl);
  const next = new URL(nextUrl);
  return (
    current.protocol === 'http:' &&
    next.protocol === 'https:' &&
    current.hostname.toLowerCase() === next.hostname.toLowerCase() &&
    (current.port === '' || current.port === '80') &&
    (next.port === '' || next.port === '443')
  );
}

function sanitizeRedirectTarget(
  currentUrl: string,
  nextUrl: string,
  sensitiveQueryParams: readonly string[] = []
): string {
  const next = new URL(nextUrl);
  if (originOf(currentUrl) === originOf(nextUrl) || isSafeHttpsUpgrade(currentUrl, nextUrl)) {
    return next.toString();
  }

  // A redirecting host has already seen the original URL. Never repeat
  // provider credentials in a cross-host target URL, even if the Location
  // header tries to copy them into a query parameter or user-info component.
  next.username = '';
  next.password = '';
  const explicit = new Set(sensitiveQueryParams.map((name) => name.toLowerCase()));
  for (const key of Array.from(next.searchParams.keys())) {
    if (explicit.has(key.toLowerCase()) || SENSITIVE_REDIRECT_QUERY.test(key)) {
      next.searchParams.delete(key);
    }
  }
  return next.toString();
}

function isReadableBody(body: BodyInit | null | undefined): boolean {
  if (!body || typeof body !== 'object') return true;
  return !('getReader' in body);
}

function buildRedirectInit(
  currentUrl: string,
  nextUrl: string,
  status: number,
  original: RequestInit
): RequestInit {
  const originalMethod = String(original.method || 'GET').toUpperCase();
  let method = originalMethod;
  let body = original.body;
  let methodChanged = false;

  // Match fetch redirect semantics for methods whose body is discarded.
  if (status === 303 && method !== 'GET' && method !== 'HEAD') {
    method = 'GET';
    body = undefined;
    methodChanged = true;
  } else if ((status === 301 || status === 302) && method === 'POST') {
    method = 'GET';
    body = undefined;
    methodChanged = true;
  }

  const currentHost = hostnameOf(currentUrl);
  const nextHost = hostnameOf(nextUrl);
  const originChanged = originOf(currentUrl) !== originOf(nextUrl);
  const safeHttpsUpgrade = isSafeHttpsUpgrade(currentUrl, nextUrl);
  const headers = new Headers(original.headers);

  // Keep credentials for the conventional HTTP→HTTPS upgrade on the same
  // default host. Strip them for every other host/origin change, and never
  // carry an explicit Cookie header across origins.
  if (currentHost !== nextHost || (originChanged && !safeHttpsUpgrade)) {
    for (const key of Array.from(headers.keys())) {
      if (SENSITIVE_REDIRECT_HEADER.test(key)) headers.delete(key);
    }
  } else if (originChanged) {
    for (const key of Array.from(headers.keys())) {
      if (/^(cookie|cookie2|set-cookie)$/i.test(key)) headers.delete(key);
    }
  }
  if (methodChanged) {
    headers.delete('content-length');
    headers.delete('content-type');
  }

  return {
    ...original,
    method,
    body,
    headers,
    credentials: originChanged && !safeHttpsUpgrade ? 'omit' : original.credentials,
    redirect: 'manual',
  };
}

function assertValidation(result: FetchUrlValidation, url: string): void {
  if (!result.ok) {
    throw new RedirectBlockedError(
      result.error || `Redirect target failed URL validation: ${url}`,
      { url, reason: 'url_validation_failed' }
    );
  }
}

/** A timeout only counts when it is a positive, finite number of milliseconds. */
function normalizeTimeoutMs(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

/**
 * Follow redirects only after validating each exposed Location target.
 *
 * The initial URL must already be validated by the caller. The validator is
 * invoked for every redirect target with its final URL, so callers can enable
 * DNS re-resolution for redirect hops even when the initial request uses a
 * bundled-host shortcut.
 *
 * `redirectOptions.timeoutMs` bounds the whole chain, and the GUARD owns that
 * timer so no caller has to remember to cancel a request that never answers. A
 * caller-supplied `options.signal` keeps working - the two are linked so
 * whichever fires first aborts, rather than one silently overriding the other.
 */
export async function fetchWithValidatedRedirects(
  initialUrl: string,
  options: RequestInit,
  validateRedirectUrl: FetchUrlValidator,
  redirectOptions: ValidatedRedirectOptions = {}
): Promise<Response> {
  const timeoutMs = normalizeTimeoutMs(redirectOptions.timeoutMs);
  if (!timeoutMs) {
    return fetchGuardedRedirects(initialUrl, options, validateRedirectUrl, redirectOptions);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const callerSignal = options.signal;
  if (callerSignal) {
    // A caller that brought its own signal (WebDAV's operation timeout) must not
    // have it discarded by ours.
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    return await fetchGuardedRedirects(
      initialUrl,
      options,
      validateRedirectUrl,
      redirectOptions,
      controller.signal
    );
  } finally {
    // The background is a long-lived service worker: a pending timer here would
    // keep it alive for the rest of the budget after the response already came
    // back, exactly when the worker is otherwise idle.
    clearTimeout(timeoutId);
  }
}

/**
 * The redirect walk itself. `signal` (when given) bounds every hop; the caller
 * owns its lifetime and its cleanup.
 */
async function fetchGuardedRedirects(
  initialUrl: string,
  options: RequestInit,
  validateRedirectUrl: FetchUrlValidator,
  redirectOptions: ValidatedRedirectOptions,
  signal?: AbortSignal
): Promise<Response> {
  const maxRedirects = Math.max(
    0,
    Math.min(10, Math.floor(redirectOptions.maxRedirects ?? DEFAULT_MAX_REDIRECTS))
  );
  const allowedHosts = new Set<string>();
  allowedHosts.add(hostnameOf(initialUrl));
  const allowedOrigins = new Set<string>([originOf(initialUrl)]);
  for (const host of redirectOptions.allowedRedirectHosts || []) {
    const normalized = normalizeHost(host);
    if (normalized) allowedHosts.add(normalized);
  }
  for (const origin of redirectOptions.allowedRedirectOrigins || []) {
    const normalized = normalizeOrigin(origin);
    if (normalized) {
      allowedOrigins.add(normalized);
      allowedHosts.add(new URL(normalized).hostname.toLowerCase());
    }
  }

  let currentUrl = initialUrl;
  let currentOptions: RequestInit = { ...options, redirect: 'manual' };

  for (let hop = 0; ; hop++) {
    // The signal rides along on every hop, so one time budget covers the whole
    // chain instead of restarting at each redirect.
    const response = await fetch(
      currentUrl,
      signal ? { ...currentOptions, signal } : currentOptions
    );
    if (response.type === 'opaqueredirect') {
      throw new RedirectBlockedError('Redirect target was not exposed by the browser', {
        url: currentUrl,
        reason: 'opaque_redirect',
      });
    }
    const isRedirect = REDIRECT_STATUSES.has(response.status);

    if (isRedirect) {
      if (hop >= maxRedirects) {
        throw new RedirectBlockedError(`Too many redirects (maximum ${maxRedirects})`, {
          url: currentUrl,
          reason: 'too_many_redirects',
        });
      }
      if (!isReadableBody(currentOptions.body)) {
        throw new RedirectBlockedError(
          'Cannot safely replay a streamed request body after redirect',
          { url: currentUrl, reason: 'streamed_body_replay' }
        );
      }

      const location = response.headers.get('location');
      if (!location) {
        throw new RedirectBlockedError('Redirect target was not exposed by the browser', {
          url: currentUrl,
          reason: 'redirect_location_missing',
        });
      }
      const rawNextUrl = new URL(location, currentUrl).toString();
      const currentProtocol = new URL(currentUrl).protocol;
      const rawNextProtocol = new URL(rawNextUrl).protocol;
      if (currentProtocol === 'https:' && rawNextProtocol === 'http:') {
        throw new RedirectBlockedError('Refusing an HTTPS to HTTP redirect', {
          url: rawNextUrl,
          reason: 'https_downgrade',
        });
      }
      const nextUrl = sanitizeRedirectTarget(
        currentUrl,
        rawNextUrl,
        redirectOptions.sensitiveQueryParams
      );
      const nextHost = hostnameOf(nextUrl);
      const nextParsed = new URL(nextUrl);
      const currentParsed = new URL(currentUrl);
      if (
        effectivePort(nextParsed) !== effectivePort(currentParsed) &&
        !isSafeHttpsUpgrade(currentUrl, nextUrl) &&
        !allowedOrigins.has(nextParsed.origin.toLowerCase())
      ) {
        throw new RedirectBlockedError('Redirect changes service port without an allowed origin', {
          url: nextUrl,
          reason: 'redirect_port_not_allowed',
        });
      }
      // The URL validator is the default SSRF boundary. A caller may provide
      // an explicit host restriction for a stricter protocol, but ordinary
      // provider redirects can safely move to another public host after the
      // target has passed full validation.
      if (redirectOptions.allowedRedirectHosts && !allowedHosts.has(nextHost)) {
        throw new RedirectBlockedError(`Redirect host is not allowed: ${nextHost}`, {
          url: nextUrl,
          reason: 'host_not_allowed',
        });
      }
      assertValidation(await validateRedirectUrl(nextUrl), nextUrl);
      const nextOptions = buildRedirectInit(currentUrl, nextUrl, response.status, currentOptions);
      if (originOf(currentUrl) !== originOf(nextUrl) && nextOptions.body != null) {
        throw new RedirectBlockedError(
          'Cannot safely replay a request body across origins after redirect',
          { url: nextUrl, reason: 'cross_origin_body_replay' }
        );
      }

      currentOptions = nextOptions;
      currentUrl = nextUrl;
      continue;
    }

    // Engines that ignore manual mode may return the final response directly.
    // Validate the reported landing before the caller consumes its body. A
    // browser that followed an opaque redirect without reporting a URL cannot
    // be made safe here and is rejected by the opaque branch above.
    const finalUrl = typeof response.url === 'string' ? response.url : '';
    if (response.redirected || (finalUrl && finalUrl !== currentUrl)) {
      if (!finalUrl) {
        throw new RedirectBlockedError('Redirect landing URL was not exposed by the browser', {
          url: currentUrl,
          reason: 'landing_url_missing',
        });
      }
      const finalHost = hostnameOf(finalUrl);
      const finalParsed = new URL(finalUrl);
      const currentParsed = new URL(currentUrl);
      if (
        effectivePort(finalParsed) !== effectivePort(currentParsed) &&
        !isSafeHttpsUpgrade(currentUrl, finalUrl) &&
        !allowedOrigins.has(finalParsed.origin.toLowerCase())
      ) {
        throw new RedirectBlockedError('Redirect changes service port without an allowed origin', {
          url: finalUrl,
          reason: 'redirect_port_not_allowed',
        });
      }
      if (redirectOptions.allowedRedirectHosts && !allowedHosts.has(finalHost)) {
        throw new RedirectBlockedError(`Redirect host is not allowed: ${finalHost}`, {
          url: finalUrl,
          reason: 'host_not_allowed',
        });
      }
      assertValidation(await validateRedirectUrl(finalUrl), finalUrl);
    }
    return response;
  }
}
