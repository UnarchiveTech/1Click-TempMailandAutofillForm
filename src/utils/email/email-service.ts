/**
 * Generic Email Service - Configuration-driven API client
 * Reads provider configurations from JSON and makes API calls dynamically
 *
 * This service uses a DSL (Domain Specific Language) approach where provider
 * configurations are defined in JSON, making it easy to add new providers
 * without writing TypeScript code. */
import {
  ApiError,
  BaseExtensionError,
  type LocalizedMessage,
  localizedMessage,
  ProviderHttpError,
  ProviderNotFoundError,
  ProviderUnreachableError,
  toResultError,
  urlGateError,
  ValidationError,
} from '@/utils/errors.js';
import { logDebug, logError, logWarn } from '@/utils/logger.js';
import { validateFetchUrl } from '@/utils/provider/instance-validation.js';
import { validateAllProviderConfigs } from '@/utils/provider/provider-validation.js';
import { fetchWithValidatedRedirects } from '@/utils/security/safe-fetch.js';
import { areaOf, writeWithRetry } from '@/utils/storage/storage-write.js';
import type { ProviderInstance } from '@/utils/types.js';
import allProviders from '../../config/providers.jsonc';
import { buildRequest, checkForErrors, extractPath, parseResponse } from '../dsl/email-fetcher.js';

/** Normalize Vite/jsonc import shapes to a ProviderConfig[]. */
function asProviderArray(mod: unknown): ProviderConfig[] {
  if (Array.isArray(mod)) return mod as ProviderConfig[];
  if (mod && typeof mod === 'object') {
    const m = mod as { default?: unknown };
    if (Array.isArray(m.default)) return m.default as ProviderConfig[];
    // Object map id → config
    const vals = Object.values(mod as Record<string, unknown>).filter(
      (v) => v && typeof v === 'object' && 'id' in (v as object)
    );
    if (vals.length) return vals as ProviderConfig[];
  }
  return [];
}

const BUNDLED_LIST = asProviderArray(allProviders);

// Validate all bundled provider configs at load. Invalid bundled data is a
// programming/configuration error and must not enter the runtime provider map.
if (BUNDLED_LIST.length === 0) {
  throw new ValidationError('No mail providers configured in providers.jsonc');
}
validateAllProviderConfigs(BUNDLED_LIST);

// Provider configuration cache
const providerConfigs = new Map<string, ProviderConfig>(BUNDLED_LIST.map((p) => [p.id, p]));

/** Synthetic provider for Demo Mode addresses (never hits network). */
export const DEMO_PROVIDER_CONFIG: ProviderConfig = {
  id: 'demo',
  name: 'demo',
  displayName: 'Demo',
  apiUrl: 'https://example.com/demo',
  auth: { type: 'none', description: 'Demo mode - no network' },
  retry: { maxAttempts: 0, delayMs: 0, backoffMultiplier: 1 },
  operations: {
    // Minimal stub so validation/UI paths that touch operations do not explode
    createAddress: {
      method: 'GET',
      function: 'noop',
      requiredParams: {},
      response: { fields: {} },
      errorHandling: { errorPath: 'error', errorMessagePath: 'message' },
    },
  },
  expiry: { duration: 86_400_000, renewable: true },
  customEmail: { supported: true },
  ui: {
    canUnarchive: true,
    supportsCustomEmail: true,
    multiInstance: false,
    supportsCustomInstance: false,
  },
};
providerConfigs.set(DEMO_PROVIDER_CONFIG.id, DEMO_PROVIDER_CONFIG);

// Default provider ID (first real provider in config, not demo)
const firstProvider = BUNDLED_LIST[0];
if (!firstProvider) {
  throw new ValidationError('No mail providers configured in providers.jsonc');
}
export const DEFAULT_PROVIDER = firstProvider.id;

/**
 * Load a provider configuration by ID
 */
export function loadProviderConfig(providerId: string): ProviderConfig {
  if (providerId === 'demo' || providerId === DEMO_PROVIDER_CONFIG.id) {
    return DEMO_PROVIDER_CONFIG;
  }
  const config = providerConfigs.get(providerId);
  if (!config) {
    // Soft-fail: return demo stub for unknown so UI never hard-crashes
    if (!providerId) throw new ProviderNotFoundError(providerId || '(empty)');
    throw new ProviderNotFoundError(providerId);
  }
  return config;
}

/** Safe load - returns null instead of throwing (UI helpers). */
export function tryLoadProviderConfig(providerId: string): ProviderConfig | null {
  try {
    return loadProviderConfig(providerId);
  } catch {
    /* ignore */
    return providerId === 'demo' ? DEMO_PROVIDER_CONFIG : null;
  }
}

/**
 * Load all available provider configurations
 */
export function loadAllProviderConfigs(): Record<string, ProviderConfig> {
  return Object.fromEntries(providerConfigs);
}

/**
 * Return all provider configurations (excluding the synthetic demo provider).
 */
export function getAllProviderConfigs(): ProviderConfig[] {
  // Hide synthetic demo from provider pickers
  return Object.values(loadAllProviderConfigs()).filter((p) => p.id !== 'demo');
}

const PROVIDER_OVERRIDE_KEY = 'providerConfigOverrides';

/**
 * Per-request ceiling for every provider call, in milliseconds.
 *
 * Without one, a black-holed connection - a host that accepts the connection
 * and then never answers - pins `checkNewEmails` for the browser's own network
 * timeout (minutes), holding `emails_storage_lock` and leaving the UI on a
 * refresh spinner with no cancel path. The redirect guard applies this across
 * every hop, and the abort surfaces below as `ProviderUnreachableError`, i.e.
 * the same "couldn't reach the provider" outcome a DNS failure produces rather
 * than a hang. Matches the WebDAV request budget, which is the same shape of
 * user-visible operation (a network round-trip the user is waiting on).
 */
const PROVIDER_REQUEST_TIMEOUT_MS = 30_000;

/** Resolved after user provider overrides are loaded from storage (or on first
 *  failed attempt). Provider-dependent alarm handlers and message handlers
 *  await this before reading runtime config so the bundled defaults never
 *  shadow user-saved overrides. */
let _providerConfigsResolve: () => void = () => {};
export const providerConfigsReady = new Promise<void>((resolve) => {
  _providerConfigsResolve = resolve;
});

/** Built-in bundled snapshot (immutable baseline for reset). */
const BUNDLED_PROVIDERS = BUNDLED_LIST;

/**
 * Validate a candidate override list *without* touching the runtime map.
 *
 * Returns the reason as a `LocalizedMessage` - an `errors.*` locale key paired
 * with the values its `{slot}`s need - or `null` when the list is usable. The
 * id of a colliding provider travels inside that one value, so a consumer
 * cannot render "Duplicate provider id \"{id}\"" with the id dropped.
 *
 * The validator's own `Error` prose is developer-facing English (its ~43 throw
 * sites are not keyed), so it is logged, never returned: `toResultError` passes
 * a key through if the validator ever gains one and otherwise collapses to
 * `errors.providerConfigInvalid`. Callers must not surface a raw thrown
 * message - that is the leak this signature exists to prevent.
 */
function validateOverrideList(list: ProviderConfig[]): LocalizedMessage | null {
  if (list.length === 0) {
    return localizedMessage('errors.providerConfigArrayRequired');
  }
  // Duplicate IDs are checked FIRST: Map.set silently overwrites, so two
  // providers sharing an ID would collapse to the last entry, and
  // `validateAllProviderConfigs` does reject them - but with unkeyed English
  // prose ("Duplicate provider ID detected: x") that may only be logged. Doing
  // the scan here is what lets the user be told *which* id collided, through a
  // key that carries the id. Entries with a non-string id fall through to the
  // schema validation below.
  const seenIds = new Set<string>();
  for (const p of list) {
    if (typeof p?.id === 'string' && seenIds.has(p.id)) {
      return localizedMessage('errors.providerConfigDuplicateId', { id: p.id });
    }
    if (typeof p?.id === 'string') seenIds.add(p.id);
  }
  try {
    validateAllProviderConfigs(list);
  } catch (e) {
    logError('Provider override failed schema validation', e);
    return toResultError(e, 'errors.providerConfigInvalid');
  }
  return null;
}

/**
 * Replace runtime provider map from a full JSON array (user overrides).
 * Invalid entries are skipped; at least one valid config is required.
 *
 * `error` is a keyed `LocalizedMessage`, never English prose, so the moment a
 * UI consumer renders it through `translateResultMessage(res.error, $t)` it is
 * correct in every locale - with the offending provider id already attached to
 * the key that needs it.
 */
export function applyProviderConfigArray(configs: ProviderConfig[]): {
  ok: boolean;
  error?: LocalizedMessage;
} {
  const list = asProviderArray(configs);
  const invalid = validateOverrideList(list);
  if (invalid) return { ok: false, error: invalid };
  providerConfigs.clear();
  for (const p of list) {
    if (p?.id) providerConfigs.set(p.id, p);
  }
  // Always keep demo provider available
  providerConfigs.set(DEMO_PROVIDER_CONFIG.id, DEMO_PROVIDER_CONFIG);
  if (providerConfigs.size <= 1) {
    // restore bundled if wipe failed
    for (const p of BUNDLED_PROVIDERS) providerConfigs.set(p.id, p);
    providerConfigs.set(DEMO_PROVIDER_CONFIG.id, DEMO_PROVIDER_CONFIG);
    return { ok: false, error: localizedMessage('errors.providerConfigNoValidProviders') };
  }
  return { ok: true };
}

export function resetProviderConfigsToBundled(): void {
  providerConfigs.clear();
  for (const p of BUNDLED_PROVIDERS) {
    providerConfigs.set(p.id, p);
  }
  providerConfigs.set(DEMO_PROVIDER_CONFIG.id, DEMO_PROVIDER_CONFIG);
}

export async function loadProviderOverridesFromStorage(ext: {
  storage: { local: { get: (k: string | string[]) => Promise<Record<string, unknown>> } };
}): Promise<boolean> {
  try {
    const res = (await ext.storage.local.get([PROVIDER_OVERRIDE_KEY])) as {
      providerConfigOverrides?: ProviderConfig[];
    };
    const overrides = res.providerConfigOverrides;
    if (Array.isArray(overrides) && overrides.length > 0) {
      const r = applyProviderConfigArray(overrides);
      _providerConfigsResolve();
      return r.ok;
    }
  } catch {
    /* keep bundled */
  }
  _providerConfigsResolve();
  return false;
}

export async function saveProviderOverridesToStorage(
  ext: {
    storage: {
      local: {
        set: (v: Record<string, unknown>) => Promise<void>;
        remove: (k: string | string[]) => Promise<void>;
      };
    };
  },
  configs: ProviderConfig[] | null
): Promise<void> {
  if (!configs) {
    await ext.storage.local.remove(PROVIDER_OVERRIDE_KEY);
    resetProviderConfigsToBundled();
    return;
  }
  // Validate without mutating the runtime map yet, so a persistence failure
  // doesn't leave the runtime map diverged from storage (next SW restart
  // would silently revert).
  const list = asProviderArray(configs);
  const invalid = validateOverrideList(list);
  if (invalid) {
    // Same reason, same keys as `applyProviderConfigArray` - one validator, so
    // the two paths cannot drift. `message` is log-only English; the displayed
    // copy is the `translationKey` + `translationValues` pair, which
    // `localizedErrorMessageOrFallback()` renders in the JSON editor.
    throw new ValidationError(
      `Provider override rejected: ${invalid.key}`,
      undefined,
      invalid.key,
      invalid.values
    );
  }
  // The caller handed us the area to persist through - write to that one, not
  // to the live `storage.local` (see `areaOf`).
  await writeWithRetry({ [PROVIDER_OVERRIDE_KEY]: configs }, areaOf(ext));
  // Now that storage persisted, update the runtime map
  applyProviderConfigArray(configs);
}

export function exportProvidersAsJson(): string {
  // Exclude synthetic demo from the editable export
  const list = getAllProviderConfigs().filter((p) => p.id !== 'demo');
  return `${JSON.stringify(list, null, 2)}\n`;
}

export interface ProviderConfig {
  id: string;
  name: string;
  displayName: string;
  apiUrl: string;
  websiteUrl?: string;
  auth: {
    type: 'query_parameter' | 'header' | 'cookie' | 'bearer' | 'none';
    paramName?: string;
    headerName?: string;
    cookieName?: string;
    description: string;
  };
  retry: {
    maxAttempts: number;
    delayMs: number;
    backoffMultiplier: number;
    retryOn?: number[];
  };
  operations: Record<string, OperationConfig>;
  emailFetching?: {
    type: 'single_step' | 'multi_step';
    operation?: string;
    dataPath?: string | null;
    responseMapping?: Record<string, string | { path: string; transform: string | string[] }>;
    listOperation?: string;
    listPath?: string;
    listItemIdField?: string;
    detailOperation?: string;
    detailItemIdParam?: string;
    detailResponseMapping?: Record<string, string | { path: string; transform: string | string[] }>;
    selectMailboxOperation?: string;
    selectMailboxVariable?: string;
    /** When set, the fetcher additionally retrieves the raw MIME source per
     * message via a dedicated operation and stores it on `Email.raw_source`.
     * Providers frequently serve a server-filtered `mail_body` (e.g. stripped
     * <style>/@media and rewritten image URLs) - the raw source preserves the
     * original so rendering and .eml export stay pixel-faithful.
     *
     * Fully config-driven: the DSL never references a specific provider. */
    rawSource?: {
      /** Operation name (from `operations`) that returns the raw source. */
      operation: string;
      /** Context variable name carrying the message id (e.g. "email_id"). */
      itemIdParam: string;
      /** Response path to the raw source string (e.g. "source"). */
      sourcePath: string;
    };
    sequenceTracking?: {
      enabled: boolean;
      sequenceField: string;
      listSequenceField: string;
      sequenceOperation: 'max' | 'last';
    };
    attachmentMapping?: {
      enabled: boolean;
      path: string;
      /** Optional field on the raw message whose truthy value (e.g. "1")
       * flags the message as having attachments - mapped to `Email.hasAttachment`
       * so badges/filters work even before/without the attachment manifest. */
      hasAttachmentFlagPath?: string;
      fields: {
        filename: string;
        mimeType: string;
        partNumber?: string | null;
        downloadUrl?: string | null;
      };
    };
    pagination?: {
      type: 'offset' | 'page' | 'cursor';
      paramName: string;
      pageSize: number;
    };
  };
  expiry?: {
    duration: number;
    /**
     * Provider-reported lifetime capability. This is descriptive metadata for
     * future lifecycle handling; the current scheduler still uses `duration`
     * and the response fields below to calculate an expiry timestamp.
     */
    lifetime?: 'finite' | 'never' | 'unknown';
    /** Per-message server retention (ms) - independent of the mailbox session (Model 2). */
    messageRetentionDuration?: number;
    renewable: boolean;
    /** How to describe the provider's renewal operation in compact status text. */
    renewalLabel?: 'autoRenew' | 'autoExtend';
    renewalMethod?: string | null;
    strategy?: 'relative' | 'absolute' | 'ttl';
    fields?: {
      createdAt?: string;
      expiresAt?: string;
      ttl?: string;
    };
    /** Adaptive auto-renew timing config. */
    renewal?: {
      /** How renewal is initiated by the provider/service. Omitted means unknown. */
      mode?: 'manual' | 'automatic' | 'providerManaged' | 'unknown';
      /** Whether the provider accepts renewal after the inbox has expired. */
      afterExpiry?: 'supported' | 'unsupported' | 'unknown';
      /** Known post-expiry recovery window in milliseconds; omitted when unknown. */
      recoveryWindowMs?: number;
      /** How many API calls a renewal takes (some providers need 2). */
      apiCallCount?: number;
      /** How many API calls creation takes (default 1). */
      createApiCallCount?: number;
      /** Minimum pre-expiry window to start auto-renew (ms). */
      minPreExpiryWindowMs?: number;
      /** Extra buffer over measured latency as a fraction (0.25 = 25%). */
      safetyBufferRatio?: number;
    };
  };
  customEmail?: {
    supported: boolean;
    operation?: string | null;
  };
  multiDomain?: {
    enabled: boolean;
    domains: string[];
  };
  ui?: {
    canUnarchive: boolean | 'ifNotExpired';
    supportsCustomEmail: boolean;
    multiInstance: boolean;
    supportsCustomInstance: boolean;
    icon?: string;
    color?: string;
    description?: string;
  };
  headers?: {
    default?: Record<string, string>;
    credentials?: 'include' | 'omit' | 'same-origin';
    cache?: 'default' | 'no-cache' | 'no-store';
  };
  forceNewSession?: {
    enabled: boolean;
    params: Record<string, string>;
    headers: Record<string, string>;
    credentials?: 'include' | 'omit' | 'same-origin';
    cache?: 'default' | 'no-cache' | 'no-store';
  };
  multiInstance?: {
    enabled: boolean;
    defaultInstanceUrl?: string;
    instances?: ProviderInstance[];
  };
  cookies?: {
    capture?: string[];
    send?: boolean;
  };
  responseHeaders?: {
    capture?: string[];
  };
  capabilities?: {
    supportsAttachments?: boolean;
    supportsDelete?: boolean;
    supportsRenew?: boolean;
    supportsPagination?: boolean;
    supportsCustomEmail?: boolean;
    supportsMultipleInstances?: boolean;
  };
  metadata?: {
    website?: string;
    family?: string;
    apiVersion?: string;
    documentationUrl?: string;
  };
}

export type ResponseType = 'json' | 'boolean' | 'text' | 'empty';

/** Provider APIs return untrusted bodies; bound buffering before JSON parsing. */
const MAX_PROVIDER_RESPONSE_BYTES = 25 * 1024 * 1024;

async function readProviderResponseText(response: Response, provider: string): Promise<string> {
  const contentLength = response.headers.get('content-length');
  const declaredBytes = contentLength === null ? Number.NaN : Number(contentLength);
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new ApiError('Provider response body exceeds the configured size limit', {
      provider,
      status: response.status,
    });
  }

  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_PROVIDER_RESPONSE_BYTES) {
      throw new ApiError('Provider response body exceeds the configured size limit', {
        provider,
        status: response.status,
      });
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const textChunks: string[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_PROVIDER_RESPONSE_BYTES) {
        try {
          await reader.cancel();
        } catch {
          /* Keep the size-limit error authoritative if stream cancellation fails. */
        }
        throw new ApiError('Provider response body exceeds the configured size limit', {
          provider,
          status: response.status,
        });
      }
      textChunks.push(decoder.decode(value, { stream: true }));
    }
    textChunks.push(decoder.decode());
    return textChunks.join('');
  } finally {
    reader.releaseLock();
  }
}

export interface OperationConfig {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  function: string;
  requiredParams: Record<string, string>;
  optionalParams?: Record<string, string>;
  bodyType?: 'json' | 'form' | 'none';
  response: {
    successPath?: string | null;
    dataPath?: string | null;
    fields: Record<
      string,
      string | { path: string; transform?: string | string[]; default?: unknown }
    >;
    allowEmptyBody?: boolean;
    emptyMeansError?: boolean;
    requiredFields?: string[];
    schema?: Record<string, 'string' | 'number' | 'boolean' | 'object' | 'array'>;
  };
  errorHandling: {
    errorPath: string;
    errorMessagePath: string;
  };
  responseType?: ResponseType;
  statusHandling?: {
    ignoreStatus?: boolean;
    require2xx?: boolean;
    allowedStatuses?: number[];
  };
}

export interface EmailServiceContext {
  auth?: {
    token: string;
    jwt?: string;
    cookie?: string;
    apiKey?: string;
    refreshToken?: string;
  };
  variables?: Record<string, unknown>;
  forceNewSession?: boolean;
  instanceUrl?: string;
  sessionCookies?: Record<string, string>;
  sessionHeaders?: Record<string, string>;
}

export class EmailService {
  private config: ProviderConfig;
  private ext: Browser;
  private sessionCookies: Record<string, string> = {};
  private sessionCookieFlags: Record<
    string,
    {
      httpOnly: boolean;
      secure: boolean;
      sameSite?: 'no_restriction' | 'lax' | 'strict';
      path?: string;
    }
  > = {};
  private sessionHeaders: Record<string, string> = {};

  constructor(config: ProviderConfig, ext: Browser) {
    this.config = config;
    this.ext = ext;
  }

  /**
   * Get currently captured session cookies
   */
  getSessionCookies(): Record<string, string> {
    return this.sessionCookies;
  }

  /**
   * Manually set session cookies
   */
  setSessionCookies(cookies: Record<string, string>): void {
    this.sessionCookies = { ...cookies };
  }

  /**
   * Get currently captured response headers
   */
  getSessionHeaders(): Record<string, string> {
    return this.sessionHeaders;
  }

  /**
   * Manually set session headers
   */
  setSessionHeaders(headers: Record<string, string>): void {
    this.sessionHeaders = { ...headers };
  }

  private captureHeadersFromResponse(headers: Headers): void {
    if (!this.config.responseHeaders?.capture) return;
    for (const headerName of this.config.responseHeaders.capture) {
      const value = headers.get(headerName);
      if (value !== null) {
        this.sessionHeaders[headerName] = value;
      }
    }
  }

  /**
   * Run the fetch through the SSRF guard. `isSafeFetchUrlWithDns` only runs
   * when the user ADDS a custom instance - a hostname that resolved public
   * then is fetched repeatedly later, and could be repointed at a
   * private/loopback IP in between (DNS rebinding). Re-validate at fetch time:
   * always static checks (cheap), plus a cached DNS re-resolution unless the
   * host is an exact match for a bundled provider endpoint.
   */
  private async safeFetch(url: string, options: RequestInit): Promise<Response> {
    let skipDns = false;
    try {
      const requestHost = new URL(url).hostname.toLowerCase();
      const bundledConfig = BUNDLED_LIST.find((config) => config.id === this.config.id);
      // Only an endpoint that exactly matches this provider's bundled config may
      // use the DNS shortcut. Custom provider JSON, including its multi-instance
      // list, is user-editable and must pass the DNS rebinding check.
      if (bundledConfig && this.config.apiUrl === bundledConfig.apiUrl) {
        if (bundledConfig.apiUrl.includes('{instanceUrl}')) {
          skipDns = (bundledConfig.multiInstance?.instances ?? []).some((instance) => {
            try {
              return new URL(instance.apiUrl).hostname.toLowerCase() === requestHost;
            } catch {
              return false;
            }
          });
        } else {
          try {
            skipDns = new URL(bundledConfig.apiUrl).hostname.toLowerCase() === requestHost;
          } catch {
            /* invalid URLs still fail the static URL gate below */
          }
        }
      }
    } catch {
      /* invalid URLs still fail the static URL gate below */
    }
    const { ok, error } = await validateFetchUrl(url, { skipDns });
    if (!ok) {
      // The gate names a stable key as its reason; carry it through so the
      // payload says WHY (bad scheme, private network) instead of one generic
      // "invalid URL", and keep the detail in the log.
      logWarn('Provider API URL rejected by the URL safety gate', {
        provider: this.config.id,
        url,
        reason: error ?? 'URL validation failed',
      });
      throw urlGateError(url, error, { provider: this.config.id });
    }
    // Follow only exposed redirects. Each target is checked with the full
    // static + DNS gate before a new request is issued, so canonical-host and
    // trailing-slash redirects work without allowing a public URL to reach a
    // private/link-local target. Browsers that return an opaque manual
    // redirect do not expose Location and are rejected fail-closed.
    try {
      return await fetchWithValidatedRedirects(
        url,
        options,
        async (redirectUrl) => validateFetchUrl(redirectUrl, { skipDns: false }),
        { timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS }
      );
    } catch (error) {
      // The redirect guard already speaks in stable codes (RedirectBlockedError)
      // and a URL-gate refusal does too - rethrow those instead of flattening
      // every refusal into one generic API failure.
      if (error instanceof BaseExtensionError) throw error;
      // Anything else thrown by fetch itself is the request never reaching a
      // response: DNS failure, no network, an abort. That is a distinct user
      // outcome ("couldn't reach the provider") from an HTTP error status.
      throw new ProviderUnreachableError(
        { provider: this.config.id, url },
        error instanceof Error ? error : undefined
      );
    }
  }

  private captureCookiesFromHeaders(headers: Headers): void {
    if (!this.config.cookies?.capture) return;

    // `headers.get('set-cookie')` is a FORBIDDEN response header in a
    // service worker - it always returns null. `getSetCookie()` is the only
    // API that exposes response cookies in MV3, one string per Set-Cookie.
    let setCookies: string[] = [];
    try {
      setCookies = headers.getSetCookie();
    } catch {
      /* Headers without a getSetCookie impl (mocks / older engines) */
      return;
    }
    for (const cookieStr of setCookies) {
      // Each string is a single Set-Cookie - no comma-splitting needed (that
      // regex lived on because a joined header merged multiple cookies).
      const mainPair = cookieStr.split(';')[0];
      const eqIdx = mainPair.indexOf('=');
      if (eqIdx > 0) {
        const name = mainPair.slice(0, eqIdx).trim();
        const value = mainPair.slice(eqIdx + 1).trim();
        if (this.config.cookies.capture.includes(name)) {
          this.sessionCookies[name] = value;
          const attrs = new Map(
            cookieStr
              .split(';')
              .slice(1)
              .map((part) => {
                const [key, ...rest] = part.trim().split('=');
                return [key.toLowerCase(), rest.join('=').trim()] as const;
              })
          );
          const sameSiteValue = attrs.get('samesite')?.toLowerCase();
          this.sessionCookieFlags[name] = {
            httpOnly: attrs.has('httponly'),
            secure: attrs.has('secure'),
            ...(sameSiteValue === 'strict' || sameSiteValue === 'lax'
              ? { sameSite: sameSiteValue }
              : sameSiteValue === 'none'
                ? { sameSite: 'no_restriction' as const }
                : {}),
            ...(attrs.get('path') ? { path: attrs.get('path') } : {}),
          };
        }
      }
    }
  }

  private getCookieUrl(context: EmailServiceContext): string {
    let apiUrl = this.config.apiUrl;
    if (context.instanceUrl && apiUrl.includes('{instanceUrl}')) {
      apiUrl = apiUrl.replace('{instanceUrl}', context.instanceUrl);
    }
    return apiUrl;
  }

  private async clearCookieAuth(context: EmailServiceContext): Promise<void> {
    if (this.config.auth.type === 'cookie' && this.config.auth.cookieName) {
      try {
        await this.ext.cookies.remove({
          url: this.getCookieUrl(context),
          name: this.config.auth.cookieName,
        });
      } catch (e) {
        logDebug(`Failed to clear cookie: ${String(e)}`);
      }
    }
  }

  private async applyCookieAuth(context: EmailServiceContext): Promise<void> {
    if (
      this.config.auth.type !== 'cookie' ||
      !context.auth?.token ||
      !this.config.auth.cookieName
    ) {
      return;
    }

    const url = this.getCookieUrl(context);
    await this.ext.cookies.set({
      url,
      name: this.config.auth.cookieName,
      value: context.auth.token,
      secure: new URL(url).protocol === 'https:',
      httpOnly: true,
    });
  }

  /**
   * Remove captured session cookies from the browser jar (fresh-session path).
   * Prevents a stale captured session from leaking into a brand-new inbox.
   */
  private async clearSessionCookies(context: EmailServiceContext): Promise<void> {
    if (!this.config.cookies?.send) return;
    const url = this.getCookieUrl(context);
    for (const name of Object.keys(this.sessionCookies)) {
      try {
        await this.ext.cookies.remove({ url, name });
      } catch (e) {
        logDebug(`Failed to clear session cookie ${name}: ${String(e)}`);
      }
      delete this.sessionCookieFlags[name];
    }
  }

  /**
   * Send captured session cookies. fetch() silently drops a manually-set
   * `Cookie` request header (forbidden header), so instead each cookie is
   * written into the browser cookie jar for the request URL with
   * `browser.cookies.set` - `credentials: 'include'` then attaches it to the
   * actual request, which is the only mechanism that works in MV3.
   */
  private async applySessionCookies(context: EmailServiceContext): Promise<void> {
    if (!this.config.cookies?.send) return;
    const url = this.getCookieUrl(context);
    for (const [name, value] of Object.entries(this.sessionCookies)) {
      try {
        const flags = this.sessionCookieFlags[name];
        const secureTransport = new URL(url).protocol === 'https:';
        await this.ext.cookies.set({
          url,
          name,
          value,
          secure: secureTransport || flags?.secure === true,
          httpOnly: flags?.httpOnly === true,
          ...(flags?.sameSite ? { sameSite: flags.sameSite } : {}),
          ...(flags?.path ? { path: flags.path } : {}),
        });
      } catch (e) {
        logDebug(`Failed to set session cookie ${name}: ${String(e)}`);
      }
    }
  }

  private async parseResponseData(
    response: Response,
    responseType: ResponseType = 'json',
    allowEmptyBody = true,
    emptyMeansError = false
  ): Promise<unknown> {
    const text = await readProviderResponseText(response, this.config.id);

    const isEmpty = !text || text.trim() === '';
    if (isEmpty) {
      if (emptyMeansError) {
        throw new ApiError('Response body is empty (emptyMeansError is configured)', {
          provider: this.config.id,
          status: response.status,
        });
      }
      if (!allowEmptyBody) {
        throw new ApiError('Response body is empty (allowEmptyBody is false)', {
          provider: this.config.id,
          status: response.status,
        });
      }
    }

    if (responseType === 'empty') {
      return {};
    }

    if (responseType === 'boolean') {
      const clean = text.trim().toLowerCase();
      if (clean === 'true') return { result: true };
      if (clean === 'false') return { result: false };
      try {
        const parsed = JSON.parse(text);
        return { result: !!parsed };
      } catch {
        /* ignore */
        return { result: false };
      }
    }

    if (responseType === 'text') {
      return { result: text };
    }

    if (isEmpty) {
      return {};
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new ApiError(
        `Failed to parse JSON response: "${text.substring(0, 100)}"`,
        { provider: this.config.id, status: response.status },
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Execute an operation defined in the provider configuration
   */
  async executeOperation(
    operationName: string,
    context: EmailServiceContext = {}
  ): Promise<Record<string, unknown>> {
    const operation = this.config.operations[operationName];
    if (!operation) {
      throw new ValidationError(`Operation ${operationName} not found in provider configuration`, {
        provider: this.config.id,
        operation: operationName,
      });
    }

    logDebug(`Executing operation: ${operationName}`);

    // Apply retry logic if configured
    if (this.config.retry) {
      return this.executeWithRetry(operation, context, operationName);
    }

    return this.performRequest(operation, context, operationName);
  }

  /**
   * Single attempt: apply auth/cookies, send the request through the SSRF
   * guard, then parse + validate the response. Shared by `executeOperation`
   * (no-retry path) and `executeWithRetry` (one invocation per attempt).
   */
  private async performRequest(
    operation: OperationConfig,
    context: EmailServiceContext,
    operationName: string
  ): Promise<Record<string, unknown>> {
    const isCreateAddress = operationName === 'createInbox' && !context.auth?.token;
    if (isCreateAddress) {
      await this.clearCookieAuth(context);
      await this.clearSessionCookies(context);
    } else {
      await this.applyCookieAuth(context);
      await this.applySessionCookies(context);
    }

    // Build request using modular DSL component
    const { url, options } = buildRequest(this.config, operation, {
      ...context,
      sessionCookies: isCreateAddress ? {} : this.sessionCookies,
      sessionHeaders: this.sessionHeaders,
    });

    // Make request (through the fetch-time SSRF guard)
    const response = await this.safeFetch(url, options);

    this.captureCookiesFromHeaders(response.headers);
    this.captureHeadersFromResponse(response.headers);

    const statusHandling = operation.statusHandling || {};
    const ignoreStatus = statusHandling.ignoreStatus ?? false;
    const require2xx = statusHandling.require2xx ?? true;
    const allowedStatuses = statusHandling.allowedStatuses || [];

    if (!response.ok && !ignoreStatus) {
      if (allowedStatuses.length > 0 && allowedStatuses.includes(response.status)) {
        // Allowed status, continue
      } else if (require2xx) {
        let retryAfterSeconds: number | undefined;
        if (response.status === 429) {
          const header = response.headers.get('retry-after') || response.headers.get('Retry-After');
          if (header) {
            const parsed = parseInt(header, 10);
            if (!Number.isNaN(parsed) && parsed > 0) {
              retryAfterSeconds = parsed;
            }
          }
        }
        // `status` stays in `context` (the retry policy reads it, and
        // `retryAfter` schedules the 429 backoff) while the stable key plus its
        // `{status}` slot value are what the payload carries to the UI.
        throw new ProviderHttpError(response.status, response.statusText, {
          provider: this.config.id,
          operation: operationName,
          retryAfter: retryAfterSeconds,
        });
      }
    }

    const allowEmptyBody = operation.response.allowEmptyBody ?? true;
    const emptyMeansError = operation.response.emptyMeansError ?? false;
    const data = await this.parseResponseData(
      response,
      operation.responseType,
      allowEmptyBody,
      emptyMeansError
    );

    // Check for errors using modular DSL component
    checkForErrors(data, operation.errorHandling);

    // Validate response schema contract
    const schema = operation.response.schema;
    if (schema && data !== null && typeof data === 'object') {
      for (const [key, expectedType] of Object.entries(schema)) {
        const val = extractPath(data, key);
        if (val === undefined || val === null) {
          throw new ValidationError(`Response missing required schema property: "${key}"`, {
            provider: this.config.id,
            operation: operationName,
          });
        }
        let actualType: string = typeof val;
        if (Array.isArray(val)) {
          actualType = 'array';
        }
        if (actualType !== expectedType) {
          throw new ValidationError(
            `Response property "${key}" type mismatch. Expected "${expectedType}", got "${actualType}"`,
            {
              provider: this.config.id,
              operation: operationName,
            }
          );
        }
      }
    }

    // Validate required fields
    const requiredFields = operation.response.requiredFields;
    if (requiredFields && requiredFields.length > 0) {
      for (const field of requiredFields) {
        if (data === null || typeof data !== 'object' || !(field in data)) {
          throw new ValidationError(`Response missing required field: "${field}"`, {
            provider: this.config.id,
            operation: operationName,
          });
        }
      }
    }

    // Parse response using modular DSL component
    return parseResponse(data, operation.response);
  }

  /**
   * Execute operation with retry logic
   */
  private async executeWithRetry(
    operation: OperationConfig,
    context: EmailServiceContext,
    operationName: string
  ): Promise<Record<string, unknown>> {
    const retryConfig = this.config.retry;
    if (!retryConfig) {
      throw new ApiError('Retry configuration missing for provider', { provider: this.config.id });
    }
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
      try {
        return await this.performRequest(operation, context, operationName);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Do not retry permanent HTTP 4xx client errors (except 429), and cap 5xx server error retries.
        // Keyed off BaseExtensionError + a numeric status: ProviderHttpError is the
        // class that now carries a status, and it must drive the same policy
        // (including the 429 Retry-After override below) as the old ApiError.
        if (error instanceof BaseExtensionError && typeof error.context?.status === 'number') {
          const status = error.context.status as number;
          const retryOn = retryConfig.retryOn;

          if (retryOn && retryOn.length > 0) {
            if (!retryOn.includes(status)) {
              throw error; // Not configured to retry on this status code
            }
          } else {
            // Default retry logic
            if (status >= 400 && status < 500 && status !== 429) {
              throw error;
            }
            if (status >= 500 && attempt >= Math.min(3, retryConfig.maxAttempts)) {
              throw error;
            }
          }
        }

        if (attempt < retryConfig.maxAttempts) {
          let baseDelay = retryConfig.delayMs * retryConfig.backoffMultiplier ** (attempt - 1);
          if (
            error instanceof BaseExtensionError &&
            error.context?.status === 429 &&
            typeof error.context?.retryAfter === 'number'
          ) {
            baseDelay = error.context.retryAfter * 1000;
          }
          // Add ±15% random jitter to avoid thundering herd problem
          const jitter = baseDelay * 0.3 * (Math.random() - 0.5);
          const backoffDelay = Math.max(0, Math.round(baseDelay + jitter));
          logDebug(`Retry attempt ${attempt}/${retryConfig.maxAttempts} after ${backoffDelay}ms`);
          await new Promise((resolve) => setTimeout(resolve, backoffDelay));
        }
      }
    }

    if (lastError) {
      throw lastError;
    }
    throw new ApiError('Max retry attempts exceeded', { provider: this.config.id });
  }

  /**
   * Get provider configuration
   */
  getConfig(): ProviderConfig {
    return this.config;
  }
}
