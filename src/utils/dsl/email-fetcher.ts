/**
 * Email fetcher for DSL
 * Handles email fetching based on provider configuration
 * Supports single-step and multi-step fetching flows
 */

import {
  recordEmailFetchTime,
  recordProviderLatency,
} from '@/entrypoints/background/address/analytics.js';
import {
  filterMessages,
  storeNewMessages,
} from '@/entrypoints/background/address/email-storage.js';
import { detectOtpAndMagicLinksBatch } from '@/entrypoints/background/parsing/ai-detection.js';
import { ProviderRequestRejectedError, urlGateError, ValidationError } from '@/utils/errors.js';
import { log } from '@/utils/logger.js';
import { withAddressLock } from '@/utils/mutex.js';
import { isSafeFetchUrl } from '@/utils/provider/instance-validation.js';
import { getClientIp, refreshClientIp } from '@/utils/security/client-ip.js';
import {
  getAddresses,
  getSeenEmailIds,
  getStoredEmailsForAddress,
  resolveBagKey,
  setAddresses,
} from '@/utils/storage/storage-keys.js';
import { toSeconds } from '@/utils/time/time.js';
import type { Address, Email, EmailFilters } from '@/utils/types.js';
import type {
  EmailServiceContext,
  OperationConfig,
  ProviderConfig,
} from '../email/email-service.js';
import { randomToken } from '../security/secure-random.js';

// ============================================================================
// PATH EXTRACTOR UTILITIES
// ============================================================================

/** Escape a string for safe use as a RegExp literal body. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Redact query string / fragment from a URL for logs and error messages.
 * Tokens and PII commonly ride on the query; origin + path are enough to
 * identify the request.
 */
function redactUrlForLog(url: URL): string {
  const safe = new URL(url.toString());
  safe.search = '';
  safe.hash = '';
  return safe.toString();
}

/**
 * Extract value from nested object using dot notation path
 * Supports special paths like !error for negation
 */
function extractPath(obj: unknown, path: string): unknown {
  if (typeof obj !== 'object' || obj === null) {
    return undefined;
  }

  // Handle special paths
  if (path.startsWith('!')) {
    // Negation check
    const actualPath = path.slice(1);
    const value = extractPath(obj, actualPath);
    return !value;
  }

  if (path === '' || path === null) {
    return obj;
  }

  // Direct property check for literal keys containing dots
  if (path in (obj as Record<string, unknown>)) {
    return (obj as Record<string, unknown>)[path];
  }

  // Split by unescaped dot (\.)
  const keys = path.match(/(?:\\.|[^.])+/g)?.map((k) => k.replace(/\\(.)/g, '$1')) || [path];
  let current: unknown = obj;

  for (const key of keys) {
    if (typeof current !== 'object' || current === null || !(key in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

// ============================================================================
// TEMPLATE RESOLVER UTILITIES
// ============================================================================

/**
 * Resolve template values in strings
 * Supports: {auth.token}, {timestamp}, {random}, {variableName}
 */
function resolveTemplateValue(value: string, context: EmailServiceContext): unknown {
  if (!value.includes('{')) {
    return value;
  }

  // Replace {auth.token}
  if (value === '{auth.token}' && context.auth?.token) {
    return context.auth.token;
  }
  if (value === '{auth.jwt}' && context.auth?.jwt) {
    return context.auth.jwt;
  }
  if (value === '{auth.cookie}' && context.auth?.cookie) {
    return context.auth.cookie;
  }
  if (value === '{auth.apiKey}' && context.auth?.apiKey) {
    return context.auth.apiKey;
  }
  if (value === '{auth.refreshToken}' && context.auth?.refreshToken) {
    return context.auth.refreshToken;
  }

  // Replace {timestamp}
  if (value === '{timestamp}') {
    return Date.now().toString();
  }

  // Replace {random}
  if (value === '{random}') {
    return randomToken(8);
  }

  // Replace {instanceUrl}
  if (value === '{instanceUrl}' && context.instanceUrl) {
    return context.instanceUrl;
  }

  // Replace {clientIp} with the real public IP (cached; falls back to the
  // historical 127.0.0.1 while unknown). Kick a refresh so the NEXT request
  // gets a fresh value when the background hasn't resolved one yet.
  if (value === '{clientIp}') {
    void refreshClientIp().catch(() => {});
    return getClientIp();
  }

  // Replace {userAgent}
  if (value === '{userAgent}') {
    return typeof navigator !== 'undefined' ? navigator.userAgent : '1ClickExt';
  }

  // Replace headers and cookies variables before ordinary context variables.
  let result = value;
  if (context.sessionHeaders) {
    for (const [key, val] of Object.entries(context.sessionHeaders)) {
      result = result.replace(new RegExp(`\\{headers\\.${escapeRegExp(key)}\\}`, 'g'), val);
    }
  }
  if (context.sessionCookies) {
    for (const [key, val] of Object.entries(context.sessionCookies)) {
      result = result.replace(new RegExp(`\\{cookies\\.${escapeRegExp(key)}\\}`, 'g'), val);
    }
  }

  // Auth placeholders are also valid inside composite templates such as
  // `Bearer {auth.token}`. Exact auth placeholders returned above for the
  // common case; this handles the embedded form without exposing the token in
  // an unresolved-variable error.
  const authValues = {
    token: context.auth?.token,
    jwt: context.auth?.jwt,
    cookie: context.auth?.cookie,
    apiKey: context.auth?.apiKey,
    refreshToken: context.auth?.refreshToken,
  };
  result = result.replace(
    /\{auth\.(token|jwt|cookie|apiKey|refreshToken)\}/g,
    (placeholder, name: keyof typeof authValues) => {
      const authValue = authValues[name];
      if (authValue === undefined || authValue === null) {
        throw new Error(`Unresolved template variable: ${placeholder}`);
      }
      return String(authValue);
    }
  );

  // Replace context variables, including composite values such as
  // `msg_{email_id}.eml`. Exact placeholders retain their original value type;
  // composite templates are strings and substitute every known variable.
  const variablePattern = /\{([^{}]+)\}/g;
  let matchedVariable = false;
  result = result.replace(variablePattern, (placeholder, varName: string) => {
    matchedVariable = true;
    const variable = context.variables?.[varName];
    if (variable !== undefined && variable !== null) return String(variable);
    throw new Error(`Unresolved template variable: ${placeholder}`);
  });
  if (matchedVariable && result === value && value.startsWith('{') && value.endsWith('}')) {
    throw new Error(`Unresolved template variable: ${value}`);
  }

  if (result.includes('{')) {
    throw new Error(`Unresolved template variable in value: ${result}`);
  }
  return result;
}

/**
 * Resolve all template values in a parameter object
 */
function resolveTemplateParams(
  params: Record<string, string>,
  context: EmailServiceContext
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const resolvedValue = resolveTemplateValue(value, context);
    if (resolvedValue !== undefined && resolvedValue !== null) {
      resolved[key] = String(resolvedValue);
    }
  }
  return resolved;
}

// ============================================================================
// REQUEST BUILDER UTILITIES
// ============================================================================

/**
 * Build HTTP request based on operation configuration
 */
function buildRequest(
  config: ProviderConfig,
  operation: OperationConfig,
  context: EmailServiceContext
): { url: string; options: RequestInit } {
  // Resolve API URL with instanceUrl if provided
  let apiUrl = config.apiUrl;
  if (context.instanceUrl && apiUrl.includes('{instanceUrl}')) {
    apiUrl = apiUrl.split('{instanceUrl}').join(context.instanceUrl);
  }
  // Support substituting header/cookie template variables in API URL
  if (context.sessionHeaders) {
    for (const [key, value] of Object.entries(context.sessionHeaders)) {
      apiUrl = apiUrl.replace(
        new RegExp(`\\{headers\\.${escapeRegExp(key)}\\}`, 'g'),
        encodeURIComponent(value)
      );
    }
  }
  if (context.sessionCookies) {
    for (const [key, value] of Object.entries(context.sessionCookies)) {
      apiUrl = apiUrl.replace(
        new RegExp(`\\{cookies\\.${escapeRegExp(key)}\\}`, 'g'),
        encodeURIComponent(value)
      );
    }
  }
  if (apiUrl.includes('{')) {
    // A broken provider config, not a provider failure: the validated-config
    // path keys it as a validation error. Do not echo the URL - it can carry
    // instance credentials or other secrets in the query/path.
    throw new ValidationError('Unresolved template variable in API URL', {
      reason: 'unresolved_template',
    });
  }

  const url = new URL(apiUrl);
  const urlSafety = isSafeFetchUrl(url.toString());
  if (!urlSafety.ok) {
    throw urlGateError(apiUrl, urlSafety.error, { reason: 'provider_api_url' });
  }
  const headers: Record<string, string> = { ...config.headers?.default };

  // Add function to path for RESTful APIs
  if (operation.function.startsWith('/')) {
    let functionPath = operation.function;
    // Replace path variables like {addressId}
    if (context.variables) {
      for (const [key, value] of Object.entries(context.variables)) {
        functionPath = functionPath.split(`{${key}}`).join(encodeURIComponent(String(value)));
      }
    }
    if (context.sessionHeaders) {
      for (const [key, value] of Object.entries(context.sessionHeaders)) {
        functionPath = functionPath.replace(
          new RegExp(`\\{headers\\.${escapeRegExp(key)}\\}`, 'g'),
          encodeURIComponent(value)
        );
      }
    }
    if (context.sessionCookies) {
      for (const [key, value] of Object.entries(context.sessionCookies)) {
        functionPath = functionPath.replace(
          new RegExp(`\\{cookies\\.${escapeRegExp(key)}\\}`, 'g'),
          encodeURIComponent(value)
        );
      }
    }
    const authValues = {
      token: context.auth?.token,
      jwt: context.auth?.jwt,
      cookie: context.auth?.cookie,
      apiKey: context.auth?.apiKey,
      refreshToken: context.auth?.refreshToken,
    };
    for (const [key, value] of Object.entries(authValues)) {
      if (value !== undefined && value !== null) {
        functionPath = functionPath.split(`{auth.${key}}`).join(encodeURIComponent(String(value)));
      }
    }
    if (functionPath.includes('{')) {
      throw new ValidationError('Unresolved template variable in provider function path', {
        reason: 'unresolved_template',
      });
    }
    url.pathname = url.pathname.replace(/\/$/, '') + functionPath;
  } else {
    // For query parameter based APIs (function appended to URL)
    url.searchParams.append('f', operation.function);
  }

  const isPostLike = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(operation.method);
  const useBody = isPostLike && (operation.bodyType === 'json' || operation.bodyType === 'form');

  // Add required parameters
  const requiredParams = resolveTemplateParams(operation.requiredParams, context);
  const optionalParams = operation.optionalParams
    ? resolveTemplateParams(operation.optionalParams, context)
    : {};

  const allParams = { ...requiredParams };
  for (const [key, value] of Object.entries(optionalParams)) {
    if (value !== undefined && value !== null) {
      allParams[key] = value;
    }
  }

  // Force-new-session cache-busting parameters are part of the provider
  // operation contract, alongside its no-cache headers and fetch options.
  if (context.forceNewSession && config.forceNewSession?.enabled && config.forceNewSession.params) {
    const cacheBustParams = resolveTemplateParams(config.forceNewSession.params, context);
    Object.assign(allParams, cacheBustParams);
  }

  let requestBody: string | undefined;

  if (useBody) {
    if (operation.bodyType === 'json') {
      headers['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(allParams);
    } else if (operation.bodyType === 'form') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const formParams = new URLSearchParams();
      for (const [key, value] of Object.entries(allParams)) {
        formParams.append(key, value);
      }
      requestBody = formParams.toString();
    }
  } else {
    for (const [key, value] of Object.entries(allParams)) {
      url.searchParams.append(key, value);
    }
  }

  // Handle auth
  if (config.auth.type === 'query_parameter' && context.auth?.token) {
    if (config.auth.paramName) {
      url.searchParams.append(config.auth.paramName, context.auth.token);
    }
  } else if (config.auth.type === 'header' && context.auth?.token) {
    if (config.auth.headerName) {
      headers[config.auth.headerName] = context.auth.token;
    }
  } else if (config.auth.type === 'bearer' && context.auth?.token) {
    headers.Authorization = `Bearer ${context.auth.token}`;
  }

  // NOTE: `config.cookies.send` is intentionally NOT implemented here.
  // A manual `Cookie` request header is a forbidden header in browsers and is
  // silently dropped by fetch(), so this block could never have worked.
  // Captured cookies are instead written into the browser cookie jar via
  // `browser.cookies.set` (see EmailService.applySessionCookies) and attached
  // to the request by `credentials: 'include'`.

  // Determine if we should use forceNewSession settings
  const useForceNewSession = context.forceNewSession && config.forceNewSession?.enabled;

  // Build options
  const options: RequestInit = {
    method: operation.method,
    headers:
      useForceNewSession && config.forceNewSession
        ? { ...headers, ...config.forceNewSession.headers }
        : headers,
    credentials:
      useForceNewSession && config.forceNewSession
        ? config.forceNewSession.credentials
        : config.headers?.credentials || 'include',
    cache:
      useForceNewSession && config.forceNewSession
        ? config.forceNewSession.cache
        : config.headers?.cache || 'default',
    body: requestBody,
  };

  log(`Request URL: ${redactUrlForLog(url)}`);

  return { url: url.toString(), options };
}

// ============================================================================
// RESPONSE PARSER UTILITIES
// ============================================================================

/**
 * Check for errors in response based on error handling configuration
 */
function checkForErrors(data: unknown, errorHandling: OperationConfig['errorHandling']): void {
  if (typeof data !== 'object' || data === null) {
    return;
  }

  const errorValue = extractPath(data, errorHandling.errorPath);
  if (errorValue) {
    // The provider's own failure text is dynamic, unattributable English: it is
    // preserved for the log (`context.detail`) while the payload carries the
    // stable `errors.providerRequestRejected` key.
    const errorMessage = extractPath(data, errorHandling.errorMessagePath) || 'Unknown error';
    throw new ProviderRequestRejectedError(String(errorMessage), {
      reason: 'provider_error_path',
      errorPath: errorHandling.errorPath,
    });
  }
}

/**
 * Parse response based on response configuration
 */
function parseResponse(
  data: unknown,
  responseConfig: OperationConfig['response']
): Record<string, unknown> {
  if (typeof data !== 'object' || data === null) {
    return {};
  }

  // If no dataPath and no fields, return full response
  if (!responseConfig.dataPath && Object.keys(responseConfig.fields).length === 0) {
    return data as Record<string, unknown>;
  }

  // Extract data path if specified
  let workingData = data;
  if (responseConfig.dataPath) {
    workingData = extractPath(data, responseConfig.dataPath) as Record<string, unknown>;
  }

  // If fields is empty but dataPath was specified, return the extracted data directly
  if (Object.keys(responseConfig.fields).length === 0) {
    return workingData as Record<string, unknown>;
  }

  // Map fields
  const result: Record<string, unknown> = {};
  for (const [targetKey, mappingInfo] of Object.entries(responseConfig.fields)) {
    if (typeof mappingInfo === 'string') {
      const value = extractPath(workingData, mappingInfo);
      if (value !== undefined) {
        result[targetKey] = value;
      }
    } else if (mappingInfo && typeof mappingInfo === 'object' && 'path' in mappingInfo) {
      let value = extractPath(workingData, mappingInfo.path);
      if ((value === undefined || value === null) && 'default' in mappingInfo) {
        value = mappingInfo.default;
      }
      if (value !== undefined) {
        result[targetKey] = applyFieldTransforms(value, mappingInfo.transform);
      }
    }
  }

  return result;
}

/**
 * Decodes HTML entity references in a string (single-level).
 *
 * `&amp;` is replaced LAST so an already-escaped sequence like `&amp;lt;`
 * decodes to the literal text `&lt;` instead of a raw `<`. Decoding `&amp;`
 * first would double-decode and turn sender-escaped text into markup.
 */
function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/**
 * Apply one or more declarative transforms to a raw value.
 */
function applyFieldTransforms(value: unknown, transforms?: string | string[]): unknown {
  if (value === undefined || value === null || !transforms) {
    return value;
  }

  const transformList = Array.isArray(transforms) ? transforms : [transforms];
  let currentVal = value;

  for (const transform of transformList) {
    if (transform === 'parseInt') {
      const parsed = Number.parseInt(String(currentVal), 10);
      currentVal = Number.isNaN(parsed) ? currentVal : parsed;
    } else if (transform === 'parseDate') {
      const date = parseDateString(String(currentVal));
      currentVal = date ? Math.floor(date.getTime() / 1000) : currentVal;
    } else if (transform === 'htmlEntityDecode') {
      currentVal = decodeHtmlEntities(String(currentVal));
    } else if (transform === 'urlDecode') {
      try {
        currentVal = decodeURIComponent(String(currentVal));
      } catch {
        // Fallback if malformed URL
      }
    } else if (transform === 'trim') {
      currentVal = String(currentVal).trim();
    }
  }

  return currentVal;
}

/**
 * Map a raw message item to internal format, including optional attachments mapping.
 */
function mapMessageItem(
  item: unknown,
  responseMapping:
    | Record<string, string | { path: string; transform?: string | string[]; default?: unknown }>
    | null
    | undefined,
  attachmentMapping: NonNullable<ProviderConfig['emailFetching']>['attachmentMapping']
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  if (responseMapping) {
    for (const [targetKey, mappingInfo] of Object.entries(responseMapping)) {
      if (typeof mappingInfo === 'string') {
        const value = extractPath(item, mappingInfo);
        if (value !== undefined) {
          mapped[targetKey] = value;
        }
      } else if (mappingInfo && typeof mappingInfo === 'object' && 'path' in mappingInfo) {
        let value = extractPath(item, mappingInfo.path);
        if ((value === undefined || value === null) && 'default' in mappingInfo) {
          value = (mappingInfo as { default?: unknown }).default;
        }
        if (value !== undefined) {
          mapped[targetKey] = applyFieldTransforms(value, mappingInfo.transform);
        }
      }
    }
  }

  // Map attachments if configured
  if (attachmentMapping?.enabled && attachmentMapping.path) {
    const rawAtts = extractPath(item, attachmentMapping.path);
    if (Array.isArray(rawAtts)) {
      mapped.attachments = rawAtts.map((att: unknown) => {
        const mappedAtt: Record<string, unknown> = {};
        for (const [targetField, sourceField] of Object.entries(attachmentMapping.fields)) {
          if (sourceField) {
            mappedAtt[targetField] = extractPath(att, sourceField as string);
          } else {
            mappedAtt[targetField] = null;
          }
        }
        return mappedAtt;
      });
    }
  }

  // Capture the provider's "has attachments" flag (e.g. Guerrilla `att: "1"`)
  // so badges and the has:attachment filter work even when the manifest is
  // missing from this particular response.
  const flagPath = attachmentMapping?.hasAttachmentFlagPath;
  if (flagPath && isAttachmentFlagTruthy(extractPath(item, flagPath))) {
    mapped.hasAttachment = true;
  }

  return mapped;
}

/**
 * A provider attachment flag (e.g. Guerrilla `att: "1"`) counts as attached
 * when present and not "0"/"false".
 */
function isAttachmentFlagTruthy(flag: unknown): boolean {
  const flagStr = flag === null || flag === undefined ? '' : String(flag).toLowerCase();
  return flagStr !== '' && flagStr !== '0' && flagStr !== 'false';
}

// ============================================================================
// RAW SOURCE MIME UTILITIES (generic - not provider-specific)
// ============================================================================

/** Decode quoted-printable content (RFC 2045 §6.7). */
function decodeQuotedPrintable(input: string): string {
  return input
    .replace(/=\r?\n/g, '') // soft line breaks
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** Decode base64 content, tolerating line breaks. */
function decodeBase64(input: string): string {
  try {
    return atob(input.replace(/\s+/g, ''));
  } catch {
    return input;
  }
}

/**
 * Extract the first `text/html` part from a raw MIME message (multipart or
 * single-part). Returns the decoded HTML, or null when none exists - callers
 * fall back to the provider's filtered `body_html`.
 */
function extractHtmlPartFromRawSource(rawSource: string): string | null {
  if (!rawSource || typeof rawSource !== 'string') return null;

  const boundaryMatch = rawSource.match(/boundary="([^"]+)"/);
  // Single-part message: strip any leading MIME headers and return the rest
  // when it looks like HTML.
  if (!boundaryMatch) {
    const body = rawSource.replace(/^[\s\S]*?\r?\n\r?\n/, '').trim();
    return body && /<[a-zA-Z][^>]*>/i.test(body) ? body : null;
  }

  const boundary = boundaryMatch[1];
  const parts = rawSource.split(`--${boundary}`);
  for (const part of parts) {
    const headerEnd = part.search(/\r?\n\r?\n/);
    if (headerEnd === -1) continue;
    const headers = part.slice(0, headerEnd);
    if (!/content-type:\s*text\/html/i.test(headers)) continue;

    let body = part.slice(headerEnd + (part.startsWith('\r\n', headerEnd) ? 2 : 1));
    // Strip the trailing closing boundary marker if present.
    body = body.replace(/\r?\n?--\s*$/, '');

    const encoding = (headers.match(/content-transfer-encoding:\s*(\S+)/i) || [])[1] || '';
    if (encoding.toLowerCase() === 'quoted-printable') {
      body = decodeQuotedPrintable(body);
    } else if (encoding.toLowerCase() === 'base64') {
      body = decodeBase64(body);
    }
    return body.trim();
  }
  return null;
}

// ============================================================================
// EXPORTED UTILITIES (used by email-service.ts)
// ============================================================================

export {
  buildRequest,
  checkForErrors,
  extractHtmlPartFromRawSource,
  extractPath,
  mapMessageItem,
  parseDateString,
  parseResponse,
  parseTimestamp,
  parseTimestampValue,
  resolveTemplateParams,
  resolveTemplateValue,
};

/**
 * Fetch emails using the provider's email fetching configuration
 */
export async function fetchEmails(
  config: ProviderConfig,
  record: Address,
  executeOperation: (
    operationName: string,
    context: EmailServiceContext
  ) => Promise<Record<string, unknown>>,
  filters: EmailFilters = {}
): Promise<Email[]> {
  const emailFetchingConfig = config.emailFetching;
  if (!emailFetchingConfig) {
    log('No email fetching configuration found');
    return [];
  }

  const startTime = performance.now();

  let result: Email[];
  if (emailFetchingConfig.type === 'single_step') {
    const operation = emailFetchingConfig.operation;
    if (!operation) {
      log('single_step email fetching requires an operation');
      return [];
    }
    result = await fetchEmailsSingleStep(
      config,
      record,
      executeOperation,
      operation,
      filters,
      emailFetchingConfig
    );
  } else if (emailFetchingConfig.type === 'multi_step') {
    result = await fetchEmailsMultiStep(
      config,
      record,
      executeOperation,
      emailFetchingConfig,
      filters
    );
  } else {
    log(`Unknown email fetching type: ${emailFetchingConfig.type}`);
    return [];
  }

  const fetchTime = performance.now() - startTime;
  await recordEmailFetchTime(fetchTime);
  log(`Email fetch completed in ${fetchTime.toFixed(2)}ms for provider ${config.id}`);

  return result;
}

/**
 * Single-step email fetching (one API call returns all emails)
 * One API call returns all emails
 */
async function fetchEmailsSingleStep(
  config: ProviderConfig,
  record: Address,
  executeOperation: (
    operationName: string,
    context: EmailServiceContext
  ) => Promise<Record<string, unknown>>,
  operationName: string,
  filters: EmailFilters,
  emailFetchingConfig: NonNullable<ProviderConfig['emailFetching']>
): Promise<Email[]> {
  log(`=== FETCHING EMAILS (single step) ===`);
  log(`Inbox token exists: ${!!record.token}`);
  log(`Inbox ID: ${record.id}`);
  log(`Inbox address: ${record.address}`);

  const context: EmailServiceContext = {
    auth: record.token ? { token: record.token } : undefined,
    variables: { addressId: record.id },
  };

  const pagination = emailFetchingConfig.pagination;
  if (pagination) {
    context.variables = context.variables || {};
    if (pagination.type === 'offset') {
      context.variables[pagination.paramName] = context.variables[pagination.paramName] ?? 0;
    } else if (pagination.type === 'page') {
      context.variables[pagination.paramName] = context.variables[pagination.paramName] ?? 1;
    }
    context.variables.pageSize = context.variables.pageSize ?? pagination.pageSize;
  }

  if (config.multiInstance?.enabled) {
    const addressUnknown = record as unknown;
    if (addressUnknown && typeof addressUnknown === 'object' && 'instanceUrl' in addressUnknown) {
      const instanceUrl = (addressUnknown as Record<string, unknown>).instanceUrl;
      if (typeof instanceUrl === 'string') {
        context.instanceUrl = instanceUrl;
      }
    }
  }

  const apiStartTime = performance.now();
  const response = await executeOperation(operationName, context);
  const apiLatency = performance.now() - apiStartTime;
  await recordProviderLatency(config.id, apiLatency);

  log(`API response:`, JSON.stringify(response)?.substring(0, 200));

  // Apply responseMapping if configured
  let messages: unknown[] = [];
  const responseMapping = emailFetchingConfig.responseMapping;
  const attachmentMapping = emailFetchingConfig.attachmentMapping;
  if (responseMapping && emailFetchingConfig.dataPath) {
    const rawData = extractPath(response, emailFetchingConfig.dataPath);
    log(
      `Extracted data from path ${emailFetchingConfig.dataPath}:`,
      JSON.stringify(rawData)?.substring(0, 200)
    );
    if (Array.isArray(rawData)) {
      messages = rawData.map((item: unknown) =>
        mapMessageItem(item, responseMapping, attachmentMapping)
      );
    } else if (rawData === null || rawData === undefined) {
      // No emails yet, return empty array
      messages = [];
    }
  } else if (Array.isArray(response)) {
    // If response is already an array, use it directly
    messages = response.map((item: unknown) =>
      mapMessageItem(item, emailFetchingConfig.responseMapping, attachmentMapping)
    );
  } else if (response && typeof response === 'object' && 'result' in response) {
    // Handle wrapped response with result field
    const result = (response as Record<string, unknown>).result;
    if (Array.isArray(result)) {
      messages = result.map((item: unknown) =>
        mapMessageItem(item, emailFetchingConfig.responseMapping, attachmentMapping)
      );
    } else if (result === null || result === undefined) {
      messages = [];
    }
  } else {
    messages = [];
  }

  log(`Fetched ${messages.length} messages`);

  // Extract OTP + magic links from messages in one pass - local algorithm, or
  // a single (chunked) AI request when the AI engine is selected.
  const msgs = messages as Email[];
  const detectedList = await detectOtpAndMagicLinksBatch(
    msgs.map((msg) => ({
      subject: msg.subject || '',
      bodyHtml: msg.body_html || '',
      bodyPlain: msg.body_plain || msg.body || '',
      receivedAt: msg.received_at,
      from: msg.from || '',
    }))
  );
  msgs.forEach((msg, i) => {
    const detected = detectedList[i];
    if (detected?.otp) msg.otp = detected.otp;
    if (detected?.magicLinks && detected.magicLinks.length > 0) {
      msg.magicLinks = detected.magicLinks;
      msg.hasMagicLink = true;
    }

    // Extract sender name from from field if it contains "Name <email>" format
    if (!msg.from_name && msg.from) {
      const match = msg.from.match(/^(.+?)\s*<[^>]+>$/);
      if (match) {
        msg.from_name = match[1].trim();
      }
    }
  });

  return filterMessages(messages as Email[], filters);
}

/**
 * Multi-step email fetching (e.g., Guerrilla Mail)
 * First call gets list, then fetch each email details
 */
const MULTI_STEP_DETAIL_CONCURRENCY = 4;

async function mapWithConcurrency<T, TResult>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<TResult>
): Promise<TResult[]> {
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;
  let failed = false;
  let firstError: unknown;
  const workerCount = Math.min(items.length, Math.max(1, Math.floor(concurrency)));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (!failed && nextIndex < items.length) {
        const index = nextIndex++;
        try {
          results[index] = await mapper(items[index] as T);
        } catch (error) {
          if (!failed) firstError = error;
          failed = true;
        }
      }
    })
  );
  if (failed) throw firstError;
  return results;
}

async function fetchEmailsMultiStep(
  _config: ProviderConfig,
  record: Address,
  executeOperation: (
    operationName: string,
    context: EmailServiceContext
  ) => Promise<Record<string, unknown>>,
  emailFetchingConfig: NonNullable<ProviderConfig['emailFetching']>,
  filters: EmailFilters
): Promise<Email[]> {
  log('=== FETCHING EMAILS (multi step) ===');

  const token = record.token || record.sidToken;
  // Guerrilla Mail sometimes returns empty token - try without auth in that case
  if (!token || token === '') {
    log('Warning: No token available, attempting email check without authentication');
    // Try without auth - Guerrilla Mail might allow this for public addresses
  }
  const addressUnknown = record as unknown;
  const sequenceNumber =
    addressUnknown && typeof addressUnknown === 'object' && 'lastSequence' in addressUnknown
      ? Number((addressUnknown as Record<string, unknown>).lastSequence) || 0
      : 0;
  const rawInstanceUrl = (record as Address & { instanceUrl?: unknown }).instanceUrl;
  const instanceUrl = typeof rawInstanceUrl === 'string' ? rawInstanceUrl : undefined;
  const instanceContext = instanceUrl ? { instanceUrl } : {};

  if (emailFetchingConfig.selectMailboxOperation) {
    const emailUser =
      typeof record.emailUser === 'string' && record.emailUser
        ? record.emailUser
        : record.address.split('@')[0];
    const selectContext: EmailServiceContext = token
      ? {
          auth: { token: token as string },
          variables: { [emailFetchingConfig.selectMailboxVariable || 'emailUser']: emailUser },
          ...instanceContext,
        }
      : {
          variables: { [emailFetchingConfig.selectMailboxVariable || 'emailUser']: emailUser },
          ...instanceContext,
        };
    await executeOperation(emailFetchingConfig.selectMailboxOperation, selectContext);
  }

  // Step 1: Get list of emails
  const listContext: EmailServiceContext = token
    ? {
        auth: { token: token as string },
        variables: { seq: String(sequenceNumber) },
        ...instanceContext,
      }
    : {
        variables: { seq: String(sequenceNumber) },
        ...instanceContext,
      };

  const pagination = emailFetchingConfig.pagination;
  if (pagination) {
    listContext.variables = listContext.variables || {};
    if (pagination.type === 'offset') {
      listContext.variables[pagination.paramName] =
        listContext.variables[pagination.paramName] ?? 0;
    } else if (pagination.type === 'page') {
      listContext.variables[pagination.paramName] =
        listContext.variables[pagination.paramName] ?? 1;
    }
    listContext.variables.pageSize = listContext.variables.pageSize ?? pagination.pageSize;
  }

  const listOperation = emailFetchingConfig.listOperation;
  if (!listOperation) {
    log('multi_step email fetching requires a listOperation');
    return [];
  }
  const listData = await executeOperation(listOperation, listContext);

  const listPath = emailFetchingConfig.listPath || '';
  const messages = (extractPath(listData, listPath) as unknown as Record<string, unknown>[]) || [];
  log(`Found ${messages.length} messages`);

  // Get existing emails to filter new ones. Resolve the bag key case-
  // insensitively so a casing drift can't make a populated bag look empty
  // (which would re-detail-fetch and re-notify everything every poll).
  const activeStored = await getStoredEmailsForAddress(record.id, record.address);
  const storedEmails: Record<string, Email[]> = { [record.address]: activeStored };
  const storedKey = record.address;

  const listItemIdField = emailFetchingConfig.listItemIdField;
  if (!listItemIdField) {
    log('multi_step email fetching requires a listItemIdField');
    return [];
  }
  // Capture list-level attachment flags (e.g. `att: "1"`) so hasAttachment is
  // known from the list response itself - the badge lights up the moment mail
  // arrives, independent of the detail fetch.
  const listAttFlagPath = emailFetchingConfig.attachmentMapping?.hasAttachmentFlagPath;
  const listAttFlags = new Map<string, boolean>();
  if (listAttFlagPath) {
    for (const msg of messages) {
      if (isAttachmentFlagTruthy(extractPath(msg, listAttFlagPath))) {
        listAttFlags.set(String(msg[listItemIdField]), true);
      }
    }
  }
  const existingEmailIds = new Set(storedEmails[storedKey].map((email: Email) => email.id));
  // Also treat IDs in the durable seen set as known: an email evicted from the
  // capped bag (or removed by retention cleanup) must not be detail-fetched and
  // re-detected on every poll just because the provider still lists it.
  const seenEmailIds = await getSeenEmailIds();
  const seenKey = resolveBagKey(seenEmailIds, record.address);
  for (const id of seenEmailIds[seenKey] || []) {
    if (id) existingEmailIds.add(String(id));
  }
  const newMessages = messages.filter(
    (msg: Record<string, unknown>) => !existingEmailIds.has(String(msg[listItemIdField]))
  );

  log(`${messages.length} total, ${newMessages.length} are new`);

  // Step 2: Fetch details for each new email
  const detailOperation = emailFetchingConfig.detailOperation;
  const detailItemIdParam = emailFetchingConfig.detailItemIdParam;
  const detailResponseMapping = emailFetchingConfig.detailResponseMapping;
  if (!detailOperation || !detailItemIdParam || !detailResponseMapping) {
    log(
      'multi_step email fetching requires detailOperation, detailItemIdParam, and detailResponseMapping'
    );
    return [];
  }

  const newDetailedMessages: Email[] = await mapWithConcurrency(
    newMessages,
    MULTI_STEP_DETAIL_CONCURRENCY,
    async (msg: Record<string, unknown>) => {
      const detailContext: EmailServiceContext = token
        ? {
            auth: { token: token as string },
            variables: { [detailItemIdParam]: String(msg[listItemIdField]) },
            ...instanceContext,
          }
        : {
            variables: { [detailItemIdParam]: String(msg[listItemIdField]) },
            ...instanceContext,
          };

      const detailApiStartTime = performance.now();
      const emailData = await executeOperation(detailOperation, detailContext);
      const detailApiLatency = performance.now() - detailApiStartTime;
      await recordProviderLatency(_config.id, detailApiLatency);

      // Map response fields to internal format
      const mapped = mapMessageItem(
        emailData,
        detailResponseMapping,
        emailFetchingConfig.attachmentMapping
      );

      // Fetch the untouched raw MIME source when the provider configures a
      // rawSource block. Generic and config-driven - the operation name, id
      // param, and response path all come from providers.jsonc. Best-effort:
      // a raw-source failure never fails the message fetch (we fall back to
      // the provider's `body_html` below).
      let rawSource: string | undefined;
      const rawSourceConfig = emailFetchingConfig.rawSource;
      if (rawSourceConfig) {
        try {
          const rawContext: EmailServiceContext = token
            ? {
                auth: { token: token as string },
                variables: { [rawSourceConfig.itemIdParam]: String(msg[listItemIdField]) },
                ...instanceContext,
              }
            : {
                variables: { [rawSourceConfig.itemIdParam]: String(msg[listItemIdField]) },
                ...instanceContext,
              };
          const rawSourceData = await executeOperation(rawSourceConfig.operation, rawContext);
          const rawValue = extractPath(rawSourceData, rawSourceConfig.sourcePath);
          if (typeof rawValue === 'string' && rawValue.trim().length > 0) {
            rawSource = rawValue;
          }
        } catch (rawError: unknown) {
          log(
            `Failed to fetch raw source for message ${String(msg[listItemIdField])}: ${String(
              rawError
            )}`
          );
        }
      }

      // Parse timestamp. The last-resort fallback must look at THIS message's
      // raw data (the detail response), not the whole list response - a
      // list-level field would stamp every message with the same value.
      const timestamp = parseTimestamp(
        mapped.timestamp_field,
        mapped.date_field,
        mapped.fallback_timestamp_field,
        emailData
      );

      // Prefer the untouched HTML from the raw source over the provider's
      // filtered `body_html` when the raw source actually carries an HTML
      // part - this restores original styling/structure that servers strip.
      const rawHtml = rawSource ? extractHtmlPartFromRawSource(rawSource) : null;
      const bodyHtml = String((rawHtml ?? mapped.body_html) || '');
      const bodyPlain = String(mapped.body_plain || '');

      const subject = String(mapped.subject || '');

      // Extract sender name from from field if it contains "Name <email>" format
      let senderName = String(mapped.from_name || '');
      if (!senderName && mapped.from) {
        const fromValue = String(mapped.from);
        // Check if from field contains "Name <email>" format
        const match = fromValue.match(/^(.+?)\s*<[^>]+>$/);
        if (match) {
          senderName = match[1].trim();
        }
      }

      return {
        id: String(mapped.id || msg[listItemIdField]),
        from_name: senderName,
        from: String(mapped.from || mapped.from_name || ''),
        subject,
        body_html: bodyHtml,
        body_plain: bodyPlain,
        raw_source: rawSource,
        received_at: timestamp || Math.floor(Date.now() / 1000),
        stored_at: Date.now(),
        attachments: mapped.attachments as Email['attachments'],
        // List-flag OR detail-flag OR manifest - the stored email is
        // self-describing even if only one source carried the info.
        hasAttachment:
          mapped.hasAttachment === true ||
          listAttFlags.get(String(msg[listItemIdField])) === true ||
          (Array.isArray(mapped.attachments) && mapped.attachments.length > 0),
      };
    }
  );

  // Extract OTP + magic links for all fetched messages in one pass - local
  // algorithm, or a single (chunked) AI request when the AI engine is selected.
  if (newDetailedMessages.length > 0) {
    const detectedList = await detectOtpAndMagicLinksBatch(
      newDetailedMessages.map((m) => ({
        subject: m.subject || '',
        bodyHtml: m.body_html || '',
        bodyPlain: m.body_plain || '',
        receivedAt: m.received_at,
        from: m.from || '',
      }))
    );
    newDetailedMessages.forEach((m, i) => {
      const d = detectedList[i];
      if (d?.otp) m.otp = d.otp;
      if (d?.magicLinks && d.magicLinks.length > 0) {
        m.magicLinks = d.magicLinks;
        m.hasMagicLink = true;
      }
    });
  }

  // Store new messages
  if (newDetailedMessages.length > 0) {
    await storeNewMessages(record.address, newDetailedMessages);
  }

  // Handle sequence tracking
  if (emailFetchingConfig.sequenceTracking?.enabled && messages.length > 0) {
    await updateSequenceNumber(
      record,
      messages,
      emailFetchingConfig.sequenceTracking,
      listItemIdField
    );
  }

  // Return all stored messages with filters applied
  const allStoredMessages = await getStoredEmailsForAddress(record.id, record.address);

  return filterMessages(allStoredMessages, filters);
}

/**
 * Parse timestamp from various formats
 *
 * `itemData` is the CURRENT message's raw data (the single-message response
 * in a multi-step fetch) - the final fallback reads the item's own `ts`
 * field, never a list-level field that would apply the same value to every
 * message.
 */
function parseTimestamp(
  timestampField: unknown,
  dateField: unknown,
  fallbackTimestampField: unknown,
  itemData: Record<string, unknown>
): number | null {
  let timestamp: number | null = null;

  // Try date field first
  if (dateField) {
    if (typeof dateField === 'number') {
      timestamp = dateField;
    } else if (typeof dateField === 'string') {
      const parsedDate = parseDateString(dateField as string);
      if (parsedDate) {
        timestamp = Math.floor(parsedDate.getTime() / 1000);
      }
    }
  }

  // Try timestamp field
  if (!timestamp && timestampField) {
    timestamp = parseTimestampValue(timestampField);
  }

  // Try fallback timestamp
  if (!timestamp && fallbackTimestampField) {
    timestamp = parseTimestampValue(fallbackTimestampField);
  }

  // Use the current item's timestamp field as final fallback
  if (!timestamp) {
    const itemTimestamp = extractPath(itemData, 'ts');
    if (itemTimestamp) {
      timestamp = parseTimestampValue(itemTimestamp);
    }
  }

  if (!timestamp || timestamp === 0) {
    timestamp = Math.floor(Date.now() / 1000);
  }

  return timestamp;
}

/**
 * Parse date string in various formats
 */
function parseDateString(dateStr: string): Date | null {
  if (dateStr.includes('-') && dateStr.includes(' ')) {
    // Normalize to ISO-8601 so every engine parses it the same way: swap the
    // date/time separator, keep an existing zone designator (Z or ±HHMM / ±HH:MM)
    // verbatim, and treat a missing zone as UTC. The old code only looked for
    // '+' / 'Z' - a NEGATIVE offset like "-0700" had 'Z' appended, producing the
    // invalid "…T10:00:00 -0700Z" and silently falling through to null.
    const zoneMatch = dateStr.match(/^(.*?)\s*(Z|[+-]\d{2}:?\d{2})\s*$/i);
    let utcStr: string;
    if (zoneMatch) {
      const zone = zoneMatch[2].toUpperCase();
      // Normalize ±HHMM → ±HH:MM (strict ISO) so `new Date` never misreads it.
      const isoZone = /^[+-]\d{2}\d{2}$/.test(zone) ? `${zone.slice(0, 3)}:${zone.slice(3)}` : zone;
      utcStr = `${zoneMatch[1].replace(' ', 'T')}${isoZone}`;
    } else {
      utcStr = `${dateStr.replace(' ', 'T')}Z`;
    }
    const parsedDate = new Date(utcStr);
    if (!Number.isNaN(parsedDate.getTime())) {
      return parsedDate;
    }
  } else if (dateStr.includes(':')) {
    const today = new Date();
    const [hours, minutes, seconds] = dateStr.split(':').map(Number);
    if (!Number.isNaN(hours) && !Number.isNaN(minutes)) {
      const emailDate = new Date(
        Date.UTC(
          today.getUTCFullYear(),
          today.getUTCMonth(),
          today.getUTCDate(),
          hours,
          minutes,
          seconds || 0
        )
      );
      if (!Number.isNaN(emailDate.getTime())) {
        return emailDate;
      }
    }
  }
  return null;
}

/**
 * Parse timestamp value (string or number)
 */
function parseTimestampValue(value: unknown): number | null {
  let timestamp = value;
  if (typeof timestamp === 'string') {
    const trimmed = timestamp.trim();
    // Full-string numeric check: parseInt accepts partial parses ("1718abc" →
    // 1718 ≈ 1970), which would corrupt sort order, newest-OTP selection, and
    // retention math for that message. Only a string that is ALL digits is a
    // raw timestamp; anything else falls through to date parsing.
    if (/^\d+$/.test(trimmed)) {
      const numericTimestamp = Number(trimmed);
      if (numericTimestamp > 0) {
        timestamp = numericTimestamp;
      } else {
        return null;
      }
    } else {
      const parsedDate = new Date(timestamp);
      if (!Number.isNaN(parsedDate.getTime())) {
        timestamp = Math.floor(parsedDate.getTime() / 1000);
      } else {
        return null;
      }
    }
  }
  if (typeof timestamp === 'number' && timestamp > 0) {
    return toSeconds(timestamp);
  }
  return null;
}

/**
 * Update sequence number in record
 */
async function updateSequenceNumber(
  record: Address,
  messages: Record<string, unknown>[],
  sequenceTracking: NonNullable<ProviderConfig['emailFetching']>['sequenceTracking'],
  _listItemIdField: string
): Promise<void> {
  if (!sequenceTracking) return;
  const { sequenceField, listSequenceField, sequenceOperation } = sequenceTracking;

  let newSequence: number;
  if (sequenceOperation === 'max') {
    // Avoid `Math.max(...arr)` - V8 throws "Maximum call stack size exceeded" once
    // the spread argument count exceeds the per-platform argument-count limit
    // (~65,536 on most platforms). For a provider that returns thousands of
    // messages we would blow past that. Reduce manually instead.
    let maxMailId = 0;
    for (const msg of messages) {
      const id = Number(msg[listSequenceField]);
      if (id > maxMailId) maxMailId = id;
    }
    newSequence = maxMailId;
  } else {
    const lastMailId = messages[messages.length - 1][listSequenceField];
    newSequence = Number(lastMailId);
  }

  await withAddressLock(async () => {
    const addresses = await getAddresses();
    const updatedAddresses = addresses.map((inb: Address) => {
      if (inb.id === record.id) {
        return { ...inb, [sequenceField]: newSequence } as Address;
      }
      return inb;
    });
    await setAddresses(updatedAddresses);
  });
}
