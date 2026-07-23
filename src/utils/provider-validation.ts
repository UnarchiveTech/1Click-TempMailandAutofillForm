/**
 * Provider configuration validation utilities
 */

import type { ProviderConfig } from './email-service.js';

/**
 * Validate a provider configuration against the JSON schema
 * @throws Error if validation fails
 */
export function validateProviderConfig(config: unknown): asserts config is ProviderConfig {
  if (typeof config !== 'object' || config === null) {
    throw new Error('Provider config must be an object');
  }

  const cfg = config as Record<string, unknown>;

  // Required fields
  const requiredFields = ['id', 'name', 'displayName', 'apiUrl', 'auth', 'retry', 'operations'];
  for (const field of requiredFields) {
    if (!(field in cfg)) {
      throw new Error(`Provider config missing required field: ${field}`);
    }
  }

  // Validate types of required fields
  if (typeof cfg.id !== 'string') throw new Error('Provider config id must be a string');
  if (typeof cfg.name !== 'string') throw new Error('Provider config name must be a string');
  if (typeof cfg.displayName !== 'string')
    throw new Error('Provider config displayName must be a string');
  if (typeof cfg.apiUrl !== 'string') throw new Error('Provider config apiUrl must be a string');

  if (cfg.websiteUrl !== undefined && typeof cfg.websiteUrl !== 'string') {
    throw new Error('Provider config websiteUrl must be a string');
  }

  // Validate auth
  if (typeof cfg.auth !== 'object' || cfg.auth === null) {
    throw new Error('Provider config auth must be an object');
  }
  const auth = cfg.auth as Record<string, unknown>;
  if (
    !auth.type ||
    !['query_parameter', 'header', 'cookie', 'bearer', 'none'].includes(auth.type as string)
  ) {
    throw new Error(
      'Provider config auth.type must be "query_parameter", "header", "cookie", "bearer", or "none"'
    );
  }
  if (typeof auth.description !== 'string') {
    throw new Error('Provider config auth.description must be a string');
  }
  if (auth.type === 'query_parameter') {
    if (!auth.paramName || typeof auth.paramName !== 'string') {
      throw new Error(
        'Provider config auth.paramName is required for query_parameter auth and must be a string'
      );
    }
  } else if (auth.type === 'header') {
    if (!auth.headerName || typeof auth.headerName !== 'string') {
      throw new Error(
        'Provider config auth.headerName is required for header auth and must be a string'
      );
    }
  } else if (auth.type === 'cookie') {
    if (!auth.cookieName || typeof auth.cookieName !== 'string') {
      throw new Error(
        'Provider config auth.cookieName is required for cookie auth and must be a string'
      );
    }
  }

  // Validate retry
  if (typeof cfg.retry !== 'object' || cfg.retry === null) {
    throw new Error('Provider config retry must be an object');
  }
  const retry = cfg.retry as Record<string, unknown>;
  if (typeof retry.maxAttempts !== 'number' || retry.maxAttempts < 0) {
    throw new Error('Provider config retry.maxAttempts must be a non-negative number');
  }
  if (typeof retry.delayMs !== 'number' || retry.delayMs < 0) {
    throw new Error('Provider config retry.delayMs must be a non-negative number');
  }
  if (typeof retry.backoffMultiplier !== 'number' || retry.backoffMultiplier < 0) {
    throw new Error('Provider config retry.backoffMultiplier must be a non-negative number');
  }
  if (retry.retryOn !== undefined && !Array.isArray(retry.retryOn)) {
    throw new Error('Provider config retry.retryOn must be an array of numbers');
  }

  // Validate operations
  if (typeof cfg.operations !== 'object' || cfg.operations === null) {
    throw new Error('Provider config operations must be an object');
  }
  const operations = cfg.operations as Record<string, unknown>;
  for (const [opKey, opVal] of Object.entries(operations)) {
    if (typeof opVal !== 'object' || opVal === null) {
      throw new Error(`Provider config operation "${opKey}" must be an object`);
    }
    const op = opVal as Record<string, unknown>;
    if (
      typeof op.method !== 'string' ||
      !['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(op.method.toUpperCase())
    ) {
      throw new Error(
        `Provider config operation "${opKey}" method must be a valid HTTP method string`
      );
    }
    if (typeof op.function !== 'string') {
      throw new Error(`Provider config operation "${opKey}" function must be a string`);
    }
  }

  // Validate expiry (optional)
  if (cfg.expiry !== undefined) {
    if (typeof cfg.expiry !== 'object' || cfg.expiry === null) {
      throw new Error('Provider config expiry must be an object');
    }
    const expiry = cfg.expiry as Record<string, unknown>;
    if (typeof expiry.duration !== 'number' || expiry.duration <= 0) {
      throw new Error('Provider config expiry.duration must be a positive number');
    }
    if (typeof expiry.renewable !== 'boolean') {
      throw new Error('Provider config expiry.renewable must be a boolean');
    }
  }

  // Validate customEmail (optional)
  if (cfg.customEmail !== undefined) {
    if (typeof cfg.customEmail !== 'object' || cfg.customEmail === null) {
      throw new Error('Provider config customEmail must be an object');
    }
    const customEmail = cfg.customEmail as Record<string, unknown>;
    if (typeof customEmail.supported !== 'boolean') {
      throw new Error('Provider config customEmail.supported must be a boolean');
    }
  }

  // Validate multiDomain (optional)
  if (cfg.multiDomain !== undefined) {
    if (typeof cfg.multiDomain !== 'object' || cfg.multiDomain === null) {
      throw new Error('Provider config multiDomain must be an object');
    }
    const multiDomain = cfg.multiDomain as Record<string, unknown>;
    if (typeof multiDomain.enabled !== 'boolean') {
      throw new Error('Provider config multiDomain.enabled must be a boolean');
    }
    if (!Array.isArray(multiDomain.domains)) {
      throw new Error('Provider config multiDomain.domains must be an array of strings');
    }
  }

  // Validate ui (optional)
  if (cfg.ui !== undefined) {
    if (typeof cfg.ui !== 'object' || cfg.ui === null) {
      throw new Error('Provider config ui must be an object');
    }
  }

  // Validate emailFetching (optional)
  if (cfg.emailFetching !== undefined) {
    if (typeof cfg.emailFetching !== 'object' || cfg.emailFetching === null) {
      throw new Error('Provider config emailFetching must be an object');
    }
  }
}

/**
 * Validate all provider configurations
 * @throws Error if any validation fails
 */
export function validateAllProviderConfigs(
  configs: unknown[]
): asserts configs is ProviderConfig[] {
  if (!Array.isArray(configs)) {
    throw new Error('Provider configs must be an array');
  }

  if (configs.length === 0) {
    throw new Error('Provider configs array cannot be empty');
  }

  // Check for duplicate IDs
  const ids = new Set<string>();
  for (const config of configs) {
    validateProviderConfig(config);
    const id = (config as ProviderConfig).id;
    if (ids.has(id)) {
      throw new Error(`Duplicate provider ID detected: ${id}`);
    }
    ids.add(id);
  }
}
