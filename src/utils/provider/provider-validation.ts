/**
 * Provider configuration validation utilities
 *
 * Every rejection carries a stable `errors.*` locale key **and** the values its
 * `{slot}`s need, so a rejected override can tell the user *which* field is
 * wrong instead of collapsing to a generic "Provider configuration is invalid"
 * - the consumer is the providers JSON editor (`MailProviderView`), reached
 * through `saveProviderOverridesToStorage` → the UI's
 * `localizedErrorMessageOrFallback`, or through `applyProviderConfigArray` →
 * `toResultError`.
 */

import { ValidationError } from '@/utils/errors.js';
import type { ProviderConfig } from '../email/email-service.js';

const AUTH_TYPES: readonly string[] = ['query_parameter', 'header', 'cookie', 'bearer', 'none'];
const HTTP_METHODS: readonly string[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

/**
 * Reject a configuration with a locale key paired to the values its `{slot}`s
 * need - one value, exactly as `localizedMessage()` pairs them for payloads.
 *
 * The `message` is a developer-facing diagnostic *derived* from that pair (it
 * reaches logs only), never prose that could travel to the UI: `ValidationError`
 * carries the key, and the UI renders the key. Because it is derived, the log
 * line and the displayed sentence cannot drift apart.
 */
function reject(key: string, values?: Record<string, string | number>): never {
  const detail = values
    ? ` (${Object.entries(values)
        .map(([name, value]) => `${name}=${value}`)
        .join(', ')})`
    : '';
  throw new ValidationError(`Provider config rejected: ${key}${detail}`, undefined, key, values);
}

/** `errors.*` key for a field whose value has the wrong shape. */
const FIELD_SHAPE_KEYS = {
  string: 'errors.providerConfigFieldString',
  boolean: 'errors.providerConfigFieldBoolean',
  object: 'errors.providerConfigFieldObject',
  nonNegativeNumber: 'errors.providerConfigFieldNonNegativeNumber',
  positiveNumber: 'errors.providerConfigFieldPositiveNumber',
  nonEmptyString: 'errors.providerConfigFieldNonEmptyString',
  array: 'errors.providerConfigFieldArray',
  stringArray: 'errors.providerConfigFieldArrayOfStrings',
  numberArray: 'errors.providerConfigFieldArrayOfNumbers',
} as const;

/** Reject `field`, naming both the field and the shape it was expected to have. */
function rejectFieldShape(field: string, shape: keyof typeof FIELD_SHAPE_KEYS): never {
  reject(FIELD_SHAPE_KEYS[shape], { field });
}

/**
 * Validate a provider configuration against the JSON schema
 * @throws ValidationError carrying an `errors.*` translation key
 */
export function validateProviderConfig(config: unknown): asserts config is ProviderConfig {
  if (typeof config !== 'object' || config === null) {
    reject('errors.providerConfigMustBeObject');
  }

  const cfg = config as Record<string, unknown>;

  // Required fields
  const requiredFields = ['id', 'name', 'displayName', 'apiUrl', 'auth', 'retry', 'operations'];
  for (const field of requiredFields) {
    if (!(field in cfg)) {
      reject('errors.providerConfigFieldMissing', { field });
    }
  }

  // Validate types of required fields
  if (typeof cfg.id !== 'string') rejectFieldShape('id', 'string');
  if (typeof cfg.name !== 'string') rejectFieldShape('name', 'string');
  if (typeof cfg.displayName !== 'string') rejectFieldShape('displayName', 'string');
  if (typeof cfg.apiUrl !== 'string') rejectFieldShape('apiUrl', 'string');

  if (cfg.websiteUrl !== undefined && typeof cfg.websiteUrl !== 'string') {
    rejectFieldShape('websiteUrl', 'string');
  }

  // Validate auth
  if (typeof cfg.auth !== 'object' || cfg.auth === null) {
    rejectFieldShape('auth', 'object');
  }
  const auth = cfg.auth as Record<string, unknown>;
  if (!auth.type || !AUTH_TYPES.includes(auth.type as string)) {
    reject('errors.providerConfigFieldOneOf', {
      field: 'auth.type',
      allowed: AUTH_TYPES.join(', '),
    });
  }
  if (typeof auth.description !== 'string') {
    rejectFieldShape('auth.description', 'string');
  }
  if (auth.type === 'query_parameter') {
    if (!auth.paramName || typeof auth.paramName !== 'string') {
      reject('errors.providerConfigAuthFieldRequired', {
        field: 'auth.paramName',
        authType: 'query_parameter',
      });
    }
  } else if (auth.type === 'header') {
    if (!auth.headerName || typeof auth.headerName !== 'string') {
      reject('errors.providerConfigAuthFieldRequired', {
        field: 'auth.headerName',
        authType: 'header',
      });
    }
  } else if (auth.type === 'cookie') {
    if (!auth.cookieName || typeof auth.cookieName !== 'string') {
      reject('errors.providerConfigAuthFieldRequired', {
        field: 'auth.cookieName',
        authType: 'cookie',
      });
    }
  }

  // Validate retry
  if (typeof cfg.retry !== 'object' || cfg.retry === null) {
    rejectFieldShape('retry', 'object');
  }
  const retry = cfg.retry as Record<string, unknown>;
  if (
    typeof retry.maxAttempts !== 'number' ||
    !Number.isInteger(retry.maxAttempts) ||
    retry.maxAttempts < 1
  ) {
    rejectFieldShape('retry.maxAttempts', 'positiveNumber');
  }
  if (typeof retry.delayMs !== 'number' || retry.delayMs < 0) {
    rejectFieldShape('retry.delayMs', 'nonNegativeNumber');
  }
  if (typeof retry.backoffMultiplier !== 'number' || retry.backoffMultiplier < 0) {
    rejectFieldShape('retry.backoffMultiplier', 'nonNegativeNumber');
  }
  if (
    retry.retryOn !== undefined &&
    (!Array.isArray(retry.retryOn) ||
      retry.retryOn.some(
        (status) =>
          typeof status !== 'number' || !Number.isInteger(status) || status < 100 || status > 599
      ))
  ) {
    rejectFieldShape('retry.retryOn', 'numberArray');
  }

  // Validate operations
  if (typeof cfg.operations !== 'object' || cfg.operations === null) {
    rejectFieldShape('operations', 'object');
  }
  const operations = cfg.operations as Record<string, unknown>;
  for (const [opKey, opVal] of Object.entries(operations)) {
    if (typeof opVal !== 'object' || opVal === null) {
      rejectFieldShape(`operations.${opKey}`, 'object');
    }
    const op = opVal as Record<string, unknown>;
    if (typeof op.method !== 'string' || !HTTP_METHODS.includes(op.method.toUpperCase())) {
      reject('errors.providerConfigFieldOneOf', {
        field: `operations.${opKey}.method`,
        allowed: HTTP_METHODS.join(', '),
      });
    }
    if (typeof op.function !== 'string' || op.function.trim().length === 0) {
      rejectFieldShape(`operations.${opKey}.function`, 'nonEmptyString');
    }
    // The function value is interpolated into the request path/query on EVERY
    // poll (url.pathname += function, or ?f=function). Reject scheme-relative
    // ('//') and path-traversal ('..') values so a tampered provider override
    // can't smuggle an external origin into the path or collapse the request
    // to an unexpected server endpoint. All bundled provider functions are
    // plain identifiers - no legit value contains these tokens.
    if (op.function.includes('//') || op.function.includes('..')) {
      reject('errors.providerConfigOperationFunctionUnsafe', { opKey });
    }
  }

  // Validate expiry (optional)
  if (cfg.expiry !== undefined) {
    if (typeof cfg.expiry !== 'object' || cfg.expiry === null) {
      rejectFieldShape('expiry', 'object');
    }
    const expiry = cfg.expiry as Record<string, unknown>;
    if (typeof expiry.duration !== 'number' || expiry.duration <= 0) {
      rejectFieldShape('expiry.duration', 'positiveNumber');
    }
    if (
      expiry.lifetime !== undefined &&
      expiry.lifetime !== 'finite' &&
      expiry.lifetime !== 'never' &&
      expiry.lifetime !== 'unknown'
    ) {
      reject('errors.providerConfigFieldOneOf', {
        field: 'expiry.lifetime',
        allowed: 'finite, never, unknown',
      });
    }
    if (typeof expiry.renewable !== 'boolean') {
      rejectFieldShape('expiry.renewable', 'boolean');
    }
    if (
      expiry.renewalLabel !== undefined &&
      expiry.renewalLabel !== 'autoRenew' &&
      expiry.renewalLabel !== 'autoExtend'
    ) {
      reject('errors.providerConfigFieldOneOf', {
        field: 'expiry.renewalLabel',
        allowed: 'autoRenew, autoExtend',
      });
    }
    if (expiry.renewal !== undefined) {
      if (
        typeof expiry.renewal !== 'object' ||
        expiry.renewal === null ||
        Array.isArray(expiry.renewal)
      ) {
        rejectFieldShape('expiry.renewal', 'object');
      }
      const renewal = expiry.renewal as Record<string, unknown>;
      if (
        renewal.mode !== undefined &&
        renewal.mode !== 'manual' &&
        renewal.mode !== 'automatic' &&
        renewal.mode !== 'providerManaged' &&
        renewal.mode !== 'unknown'
      ) {
        reject('errors.providerConfigFieldOneOf', {
          field: 'expiry.renewal.mode',
          allowed: 'manual, automatic, providerManaged, unknown',
        });
      }
      if (
        renewal.afterExpiry !== undefined &&
        renewal.afterExpiry !== 'supported' &&
        renewal.afterExpiry !== 'unsupported' &&
        renewal.afterExpiry !== 'unknown'
      ) {
        reject('errors.providerConfigFieldOneOf', {
          field: 'expiry.renewal.afterExpiry',
          allowed: 'supported, unsupported, unknown',
        });
      }
      if (
        renewal.recoveryWindowMs !== undefined &&
        (typeof renewal.recoveryWindowMs !== 'number' || renewal.recoveryWindowMs <= 0)
      ) {
        rejectFieldShape('expiry.renewal.recoveryWindowMs', 'positiveNumber');
      }
    }
  }

  // Validate customEmail (optional)
  if (cfg.customEmail !== undefined) {
    if (typeof cfg.customEmail !== 'object' || cfg.customEmail === null) {
      rejectFieldShape('customEmail', 'object');
    }
    const customEmail = cfg.customEmail as Record<string, unknown>;
    if (typeof customEmail.supported !== 'boolean') {
      rejectFieldShape('customEmail.supported', 'boolean');
    }
  }

  // Validate multiDomain (optional)
  if (cfg.multiDomain !== undefined) {
    if (typeof cfg.multiDomain !== 'object' || cfg.multiDomain === null) {
      rejectFieldShape('multiDomain', 'object');
    }
    const multiDomain = cfg.multiDomain as Record<string, unknown>;
    if (typeof multiDomain.enabled !== 'boolean') {
      rejectFieldShape('multiDomain.enabled', 'boolean');
    }
    if (
      !Array.isArray(multiDomain.domains) ||
      multiDomain.domains.some((domain) => typeof domain !== 'string')
    ) {
      rejectFieldShape('multiDomain.domains', 'stringArray');
    }
  }

  // Validate multiInstance (optional)
  if (cfg.multiInstance !== undefined) {
    if (
      typeof cfg.multiInstance !== 'object' ||
      cfg.multiInstance === null ||
      Array.isArray(cfg.multiInstance)
    ) {
      rejectFieldShape('multiInstance', 'object');
    }
    const multiInstance = cfg.multiInstance as Record<string, unknown>;
    if (typeof multiInstance.enabled !== 'boolean') {
      rejectFieldShape('multiInstance.enabled', 'boolean');
    }
    if (
      multiInstance.defaultInstanceUrl !== undefined &&
      typeof multiInstance.defaultInstanceUrl !== 'string'
    ) {
      rejectFieldShape('multiInstance.defaultInstanceUrl', 'string');
    }
    if (multiInstance.instances !== undefined) {
      if (!Array.isArray(multiInstance.instances)) {
        rejectFieldShape('multiInstance.instances', 'array');
      }
      const instanceIds = new Set<string>();
      for (const [index, value] of multiInstance.instances.entries()) {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          rejectFieldShape(`multiInstance.instances[${index}]`, 'object');
        }
        const instance = value as Record<string, unknown>;
        for (const field of ['id', 'name', 'displayName', 'apiUrl']) {
          if (typeof instance[field] !== 'string' || instance[field].trim() === '') {
            rejectFieldShape(`multiInstance.instances[${index}].${field}`, 'nonEmptyString');
          }
        }
        const id = instance.id as string;
        if (instanceIds.has(id)) {
          reject('errors.providerConfigDuplicateInstanceId', { id });
        }
        instanceIds.add(id);
      }
    }
  }

  // Validate ui (optional)
  if (cfg.ui !== undefined) {
    if (typeof cfg.ui !== 'object' || cfg.ui === null) {
      rejectFieldShape('ui', 'object');
    }
  }

  // Validate emailFetching (optional)
  if (cfg.emailFetching !== undefined) {
    if (typeof cfg.emailFetching !== 'object' || cfg.emailFetching === null) {
      rejectFieldShape('emailFetching', 'object');
    }
  }
}

/**
 * Validate all provider configurations
 * @throws ValidationError carrying an `errors.*` translation key
 */
export function validateAllProviderConfigs(
  configs: unknown[]
): asserts configs is ProviderConfig[] {
  if (!Array.isArray(configs)) {
    reject('errors.providerConfigArrayRequired');
  }

  if (configs.length === 0) {
    reject('errors.providerConfigArrayRequired');
  }

  // Check for duplicate IDs
  const ids = new Set<string>();
  for (const config of configs) {
    validateProviderConfig(config);
    const id = (config as ProviderConfig).id;
    if (ids.has(id)) {
      reject('errors.providerConfigDuplicateId', { id });
    }
    ids.add(id);
  }
}
