/**
 * Generic Email Service - Configuration-driven API client
 * Reads provider configurations from JSON and makes API calls dynamically
 *
 * This service uses a DSL (Domain Specific Language) approach where provider
 * configurations are defined in JSON, making it easy to add new providers
 * without writing TypeScript code.
 */

import type { Browser } from 'wxt/browser';
import { ApiError, ProviderNotFoundError, ValidationError } from '@/utils/errors.js';
import { logDebug } from '@/utils/logger.js';
import { validateAllProviderConfigs } from '@/utils/provider-validation.js';
import type { ProviderInstance } from '@/utils/types.js';
import allProviders from '../config/providers.jsonc';
import { buildRequest, checkForErrors, extractPath, parseResponse } from './dsl/email-fetcher.js';

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

// Validate all provider configs on load (never throw on bad module shape at import)
try {
  if (BUNDLED_LIST.length > 0) validateAllProviderConfigs(BUNDLED_LIST);
} catch (e) {
  logDebug('Provider config validation warning', e);
}

// Provider configuration cache
const providerConfigs = new Map<string, ProviderConfig>(BUNDLED_LIST.map((p) => [p.id, p]));

/** Synthetic provider for Demo Mode inboxes (never hits network). */
export const DEMO_PROVIDER_CONFIG: ProviderConfig = {
  id: 'demo',
  name: 'demo',
  displayName: 'Demo',
  apiUrl: 'https://example.com/demo',
  auth: { type: 'none', description: 'Demo mode — no network' },
  retry: { maxAttempts: 0, delayMs: 0, backoffMultiplier: 1 },
  operations: {
    // Minimal stub so validation/UI paths that touch operations do not explode
    createInbox: {
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

/** Safe load — returns null instead of throwing (UI helpers). */
export function tryLoadProviderConfig(providerId: string): ProviderConfig | null {
  try {
    return loadProviderConfig(providerId);
  } catch {
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
 * Clear cached provider configurations
 */
export function getAllProviderConfigs(): ProviderConfig[] {
  // Hide synthetic demo from provider pickers
  return Object.values(loadAllProviderConfigs()).filter((p) => p.id !== 'demo');
}

const PROVIDER_OVERRIDE_KEY = 'providerConfigOverrides';

/** Built-in bundled snapshot (immutable baseline for reset). */
const BUNDLED_PROVIDERS = BUNDLED_LIST;

/**
 * Replace runtime provider map from a full JSON array (user overrides).
 * Invalid entries are skipped; at least one valid config is required.
 */
export function applyProviderConfigArray(configs: ProviderConfig[]): {
  ok: boolean;
  error?: string;
} {
  const list = asProviderArray(configs);
  if (list.length === 0) {
    return { ok: false, error: 'Expected a non-empty array of provider configs' };
  }
  try {
    validateAllProviderConfigs(list);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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
    return { ok: false, error: 'No valid providers after apply' };
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
      return r.ok;
    }
  } catch {
    /* keep bundled */
  }
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
  const r = applyProviderConfigArray(configs);
  if (!r.ok) throw new ValidationError(r.error || 'Invalid provider config');
  await ext.storage.local.set({ [PROVIDER_OVERRIDE_KEY]: configs });
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
    sequenceTracking?: {
      enabled: boolean;
      sequenceField: string;
      listSequenceField: string;
      sequenceOperation: 'max' | 'last';
    };
    attachmentMapping?: {
      enabled: boolean;
      path: string;
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
    renewable: boolean;
    renewalMethod?: string | null;
    strategy?: 'relative' | 'absolute' | 'ttl';
    fields?: {
      createdAt?: string;
      expiresAt?: string;
      ttl?: string;
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
  private capturedHeaders: Record<string, string> = {};

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
    return this.capturedHeaders;
  }

  /**
   * Manually set session headers
   */
  setSessionHeaders(headers: Record<string, string>): void {
    this.capturedHeaders = { ...headers };
  }

  private captureHeadersFromResponse(headers: Headers): void {
    if (!this.config.responseHeaders?.capture) return;
    for (const headerName of this.config.responseHeaders.capture) {
      const value = headers.get(headerName);
      if (value !== null) {
        this.capturedHeaders[headerName] = value;
      }
    }
  }

  private captureCookiesFromHeaders(headers: Headers): void {
    if (!this.config.cookies?.capture) return;

    const setCookie = headers.get('set-cookie') || headers.get('Set-Cookie');
    if (!setCookie) return;

    const cookies = setCookie.split(',');
    for (const cookieStr of cookies) {
      const parts = cookieStr.split(';')[0].split('=');
      if (parts.length === 2) {
        const name = parts[0].trim();
        const value = parts[1].trim();
        if (this.config.cookies.capture.includes(name)) {
          this.sessionCookies[name] = value;
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

    await this.ext.cookies.set({
      url: this.getCookieUrl(context),
      name: this.config.auth.cookieName,
      value: context.auth.token,
    });
  }

  private async parseResponseData(
    response: Response,
    responseType: ResponseType = 'json',
    allowEmptyBody = true,
    emptyMeansError = false
  ): Promise<unknown> {
    const text = await response.text();

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
      return this.executeWithRetry(operation, context);
    }

    const isCreateInbox = operationName === 'createInbox' && !context.auth?.token;
    if (isCreateInbox) {
      await this.clearCookieAuth(context);
    } else {
      await this.applyCookieAuth(context);
    }

    // Build request using modular DSL component
    const { url, options } = buildRequest(this.config, operation, {
      ...context,
      sessionCookies: isCreateInbox ? {} : this.sessionCookies,
      sessionHeaders: this.capturedHeaders,
    });

    // Make request
    const response = await fetch(url, options);

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
        throw new ApiError(
          `HTTP ${response.status} when executing ${operationName}: ${response.statusText}`,
          {
            provider: this.config.id,
            operation: operationName,
            status: response.status,
            retryAfter: retryAfterSeconds,
          }
        );
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
    context: EmailServiceContext
  ): Promise<Record<string, unknown>> {
    const retryConfig = this.config.retry;
    if (!retryConfig) {
      throw new ApiError('Retry configuration missing for provider', { provider: this.config.id });
    }
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
      try {
        const isCreateInbox =
          this.config.operations.createInbox &&
          operation.function === this.config.operations.createInbox.function &&
          !context.auth?.token;
        if (isCreateInbox) {
          await this.clearCookieAuth(context);
        } else {
          await this.applyCookieAuth(context);
        }
        const { url, options } = buildRequest(this.config, operation, {
          ...context,
          sessionCookies: isCreateInbox ? {} : this.sessionCookies,
          sessionHeaders: this.capturedHeaders,
        });
        const response = await fetch(url, options);

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
              const header =
                response.headers.get('retry-after') || response.headers.get('Retry-After');
              if (header) {
                const parsed = parseInt(header, 10);
                if (!Number.isNaN(parsed) && parsed > 0) {
                  retryAfterSeconds = parsed;
                }
              }
            }
            throw new ApiError(
              `HTTP ${response.status} when executing ${operation.function}: ${response.statusText}`,
              {
                provider: this.config.id,
                operation: operation.function,
                status: response.status,
                retryAfter: retryAfterSeconds,
              }
            );
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
        checkForErrors(data, operation.errorHandling);

        // Validate response schema contract
        const schema = operation.response.schema;
        if (schema && data !== null && typeof data === 'object') {
          for (const [key, expectedType] of Object.entries(schema)) {
            const val = extractPath(data, key);
            if (val === undefined || val === null) {
              throw new ValidationError(`Response missing required schema property: "${key}"`, {
                provider: this.config.id,
                operation: operation.function,
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
                  operation: operation.function,
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
                operation: operation.function,
              });
            }
          }
        }

        return parseResponse(data, operation.response);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Do not retry permanent HTTP 4xx client errors (except 429), and cap 5xx server error retries
        if (error instanceof ApiError && typeof error.context?.status === 'number') {
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
            error instanceof ApiError &&
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
