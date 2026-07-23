/**
 * Email fetcher for DSL
 * Handles email fetching based on provider configuration
 * Supports single-step and multi-step fetching flows
 */

import {
  recordEmailFetchTime,
  recordProviderLatency,
} from '@/entrypoints/background/inbox/analytics.js';
import {
  applyFiltersAndProcessMessages,
  storeNewMessages,
} from '@/entrypoints/background/inbox/email-storage.js';
import { extractMagicLinks } from '@/entrypoints/background/parsing/magic-link.js';
import { extractOTP } from '@/entrypoints/background/parsing/otp.js';
import { log } from '@/utils/logger.js';
import { withInboxLock } from '@/utils/mutex.js';
import { getInboxes, getStoredEmailsMap, setInboxes } from '@/utils/storage-keys.js';
import { toSeconds } from '@/utils/time.js';
import type { Account, Email, EmailFilters } from '@/utils/types.js';
import type { EmailServiceContext, OperationConfig, ProviderConfig } from '../email-service.js';
import { randomToken } from '../secure-random.js';

// ============================================================================
// PATH EXTRACTOR UTILITIES
// ============================================================================

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

  // Replace {clientIp}
  if (value === '{clientIp}') {
    return '127.0.0.1';
  }

  // Replace {userAgent}
  if (value === '{userAgent}') {
    return typeof navigator !== 'undefined' ? navigator.userAgent : '1ClickExt';
  }

  // Replace context variables
  if (value.startsWith('{') && value.endsWith('}')) {
    const varName = value.slice(1, -1);
    if (context.variables?.[varName]) {
      return context.variables[varName];
    }
  }

  // Replace headers and cookies variables
  let result = value;
  if (context.sessionHeaders) {
    for (const [key, val] of Object.entries(context.sessionHeaders)) {
      result = result.replace(new RegExp(`\\{headers\\.${key}\\}`, 'g'), val);
    }
  }
  if (context.sessionCookies) {
    for (const [key, val] of Object.entries(context.sessionCookies)) {
      result = result.replace(new RegExp(`\\{cookies\\.${key}\\}`, 'g'), val);
    }
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
    apiUrl = apiUrl.replace('{instanceUrl}', context.instanceUrl);
  }

  // Support substituting header/cookie template variables in API URL
  if (context.sessionHeaders) {
    for (const [key, value] of Object.entries(context.sessionHeaders)) {
      apiUrl = apiUrl.replace(new RegExp(`\\{headers\\.${key}\\}`, 'g'), value);
    }
  }
  if (context.sessionCookies) {
    for (const [key, value] of Object.entries(context.sessionCookies)) {
      apiUrl = apiUrl.replace(new RegExp(`\\{cookies\\.${key}\\}`, 'g'), value);
    }
  }

  const url = new URL(apiUrl);
  const headers: Record<string, string> = { ...config.headers?.default };

  // Add function to path for RESTful APIs
  if (operation.function.startsWith('/')) {
    let functionPath = operation.function;
    // Replace path variables like {inboxId}
    if (context.variables) {
      for (const [key, value] of Object.entries(context.variables)) {
        functionPath = functionPath.replace(`{${key}}`, String(value));
      }
    }
    if (context.sessionHeaders) {
      for (const [key, value] of Object.entries(context.sessionHeaders)) {
        functionPath = functionPath.replace(new RegExp(`\\{headers\\.${key}\\}`, 'g'), value);
      }
    }
    if (context.sessionCookies) {
      for (const [key, value] of Object.entries(context.sessionCookies)) {
        functionPath = functionPath.replace(new RegExp(`\\{cookies\\.${key}\\}`, 'g'), value);
      }
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

  // Handle captured cookies injection if send is true
  if (config.cookies?.send && context.sessionCookies) {
    const cookiePairs = Object.entries(context.sessionCookies)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
    if (cookiePairs) {
      headers.Cookie = cookiePairs;
    }
  }

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

  log(`Request URL: ${url.toString()}`);

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
    const errorMessage = extractPath(data, errorHandling.errorMessagePath) || 'Unknown error';
    throw new Error(String(errorMessage));
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
 * Decodes HTML entity references in a string.
 */
function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
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

  return mapped;
}

// ============================================================================
// EXPORTED UTILITIES (used by email-service.ts)
// ============================================================================

export {
  buildRequest,
  checkForErrors,
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
  inbox: Account,
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
      inbox,
      executeOperation,
      operation,
      filters,
      emailFetchingConfig
    );
  } else if (emailFetchingConfig.type === 'multi_step') {
    result = await fetchEmailsMultiStep(
      config,
      inbox,
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
  inbox: Account,
  executeOperation: (
    operationName: string,
    context: EmailServiceContext
  ) => Promise<Record<string, unknown>>,
  operationName: string,
  filters: EmailFilters,
  emailFetchingConfig: NonNullable<ProviderConfig['emailFetching']>
): Promise<Email[]> {
  log(`=== FETCHING EMAILS (single step) ===`);
  log(`Inbox token exists: ${!!inbox.token}`);
  log(`Inbox ID: ${inbox.id}`);
  log(`Inbox address: ${inbox.address}`);

  const context: EmailServiceContext = {
    auth: inbox.token ? { token: inbox.token } : undefined,
    variables: { inboxId: inbox.id },
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
    const inboxUnknown = inbox as unknown;
    if (inboxUnknown && typeof inboxUnknown === 'object' && 'instanceUrl' in inboxUnknown) {
      const instanceUrl = (inboxUnknown as Record<string, unknown>).instanceUrl;
      if (typeof instanceUrl === 'string') {
        context.instanceUrl = instanceUrl;
      }
    }
  }

  const apiStartTime = performance.now();
  const response = await executeOperation(operationName, context);
  const apiLatency = performance.now() - apiStartTime;
  await recordProviderLatency(config.id, apiLatency);

  log(`API response:`, JSON.stringify(response).substring(0, 200));

  // Apply responseMapping if configured
  let messages: unknown[] = [];
  const responseMapping = emailFetchingConfig.responseMapping;
  const attachmentMapping = emailFetchingConfig.attachmentMapping;
  if (responseMapping && emailFetchingConfig.dataPath) {
    const rawData = extractPath(response, emailFetchingConfig.dataPath);
    log(
      `Extracted data from path ${emailFetchingConfig.dataPath}:`,
      JSON.stringify(rawData).substring(0, 200)
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

  // Extract OTP + magic links from messages
  (messages as Email[]).forEach((msg: Email) => {
    const otp = extractOTP(msg.subject || '', msg.body_html || msg.body_plain || '');
    msg.otp = otp || undefined;

    const magicLinks = extractMagicLinks(
      msg.subject || '',
      msg.body_html || '',
      msg.body_plain || msg.body || ''
    );
    if (magicLinks.length > 0) {
      msg.magicLinks = magicLinks;
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

  return applyFiltersAndProcessMessages(messages as Email[], filters, inbox);
}

/**
 * Multi-step email fetching (e.g., Guerrilla Mail)
 * First call gets list, then fetch each email details
 */
async function fetchEmailsMultiStep(
  _config: ProviderConfig,
  inbox: Account,
  executeOperation: (
    operationName: string,
    context: EmailServiceContext
  ) => Promise<Record<string, unknown>>,
  emailFetchingConfig: NonNullable<ProviderConfig['emailFetching']>,
  filters: EmailFilters
): Promise<Email[]> {
  log('=== FETCHING EMAILS (multi step) ===');

  const token = inbox.token || inbox.sidToken;
  // Guerrilla Mail sometimes returns empty token - try without auth in that case
  if (!token || token === '') {
    log('Warning: No token available, attempting email check without authentication');
    // Try without auth - Guerrilla Mail might allow this for public inboxes
  }
  const inboxUnknown = inbox as unknown;
  const sequenceNumber =
    inboxUnknown && typeof inboxUnknown === 'object' && 'lastSequence' in inboxUnknown
      ? Number((inboxUnknown as Record<string, unknown>).lastSequence) || 0
      : 0;

  if (emailFetchingConfig.selectMailboxOperation) {
    const emailUser =
      typeof inbox.emailUser === 'string' && inbox.emailUser
        ? inbox.emailUser
        : inbox.address.split('@')[0];
    const selectContext: EmailServiceContext = token
      ? {
          auth: { token: token as string },
          variables: { [emailFetchingConfig.selectMailboxVariable || 'emailUser']: emailUser },
        }
      : {
          variables: { [emailFetchingConfig.selectMailboxVariable || 'emailUser']: emailUser },
        };
    await executeOperation(emailFetchingConfig.selectMailboxOperation, selectContext);
  }

  // Step 1: Get list of emails
  const listContext: EmailServiceContext = token
    ? {
        auth: { token: token as string },
        variables: { seq: String(sequenceNumber) },
      }
    : {
        variables: { seq: String(sequenceNumber) },
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

  // Get existing emails to filter new ones
  const storedEmails = await getStoredEmailsMap();
  if (!storedEmails[inbox.address]) {
    storedEmails[inbox.address] = [];
  }

  const listItemIdField = emailFetchingConfig.listItemIdField;
  if (!listItemIdField) {
    log('multi_step email fetching requires a listItemIdField');
    return [];
  }
  const existingEmailIds = new Set(storedEmails[inbox.address].map((email: Email) => email.id));
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

  const newDetailedMessages = await Promise.all(
    newMessages.map(async (msg: Record<string, unknown>) => {
      const detailContext: EmailServiceContext = token
        ? {
            auth: { token: token as string },
            variables: { [detailItemIdParam]: String(msg[listItemIdField]) },
          }
        : {
            variables: { [detailItemIdParam]: String(msg[listItemIdField]) },
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

      // Parse timestamp
      const timestamp = parseTimestamp(
        mapped.timestamp_field,
        mapped.date_field,
        mapped.fallback_timestamp_field,
        listData
      );

      // Extract OTP + magic links
      const subject = String(mapped.subject || '');
      const bodyHtml = String(mapped.body_html || '');
      const bodyPlain = String(mapped.body_plain || '');
      const otp = extractOTP(subject, bodyHtml || bodyPlain);
      const magicLinks = extractMagicLinks(subject, bodyHtml, bodyPlain);

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
        received_at: timestamp || Math.floor(Date.now() / 1000),
        otp: otp || undefined,
        magicLinks: magicLinks.length > 0 ? magicLinks : undefined,
        hasMagicLink: magicLinks.length > 0,
        stored_at: Date.now(),
        attachments: mapped.attachments as Email['attachments'],
      };
    })
  );

  // Store new messages
  if (newDetailedMessages.length > 0) {
    await storeNewMessages(inbox.address, newDetailedMessages);
  }

  // Handle sequence tracking
  if (emailFetchingConfig.sequenceTracking?.enabled && messages.length > 0) {
    await updateSequenceNumber(
      inbox,
      messages,
      emailFetchingConfig.sequenceTracking,
      listItemIdField
    );
  }

  // Return all stored messages with filters applied
  const allStoredMessages = (await getStoredEmailsMap())[inbox.address] || [];

  return applyFiltersAndProcessMessages(allStoredMessages, filters, inbox);
}

/**
 * Parse timestamp from various formats
 */
function parseTimestamp(
  timestampField: unknown,
  dateField: unknown,
  fallbackTimestampField: unknown,
  listData: Record<string, unknown>
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

  // Use list timestamp as final fallback
  if (!timestamp) {
    const listTimestamp = extractPath(listData, 'ts');
    if (listTimestamp) {
      timestamp = parseTimestampValue(listTimestamp);
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
    const utcStr =
      dateStr.includes('Z') || dateStr.includes('+') ? dateStr : `${dateStr.replace(' ', 'T')}Z`;
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
    const numericTimestamp = parseInt(timestamp, 10);
    if (!Number.isNaN(numericTimestamp) && numericTimestamp > 0) {
      timestamp = numericTimestamp;
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
 * Update sequence number in inbox
 */
async function updateSequenceNumber(
  inbox: Account,
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

  await withInboxLock(async () => {
    const inboxes = await getInboxes();
    const updatedInboxes = inboxes.map((inb: Account) => {
      if (inb.id === inbox.id) {
        return { ...inb, [sequenceField]: newSequence } as Account;
      }
      return inb;
    });
    await setInboxes(updatedInboxes);
  });
}
