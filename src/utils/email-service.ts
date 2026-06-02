/**
 * Generic Email Service - Configuration-driven API client
 * Reads provider configurations from JSON and makes API calls dynamically
 *
 * This service uses a DSL (Domain Specific Language) approach where provider
 * configurations are defined in JSON, making it easy to add new providers
 * without writing TypeScript code.
 */

import type { Browser } from 'wxt/browser';
import { logDebug } from '@/utils/logger.js';
import { validateAllProviderConfigs } from '@/utils/provider-validation.js';
import type { ProviderInstance } from '@/utils/types.js';
import allProviders from '../config/providers.jsonc';
import { buildRequest, checkForErrors, parseResponse } from './dsl/email-fetcher.js';

// Validate all provider configs on load
validateAllProviderConfigs(allProviders as unknown as ProviderConfig[]);

// Provider configuration cache
const providerConfigs = new Map<string, ProviderConfig>(
  (allProviders as unknown as ProviderConfig[]).map((p) => [p.id, p])
);

// Default provider ID (first provider in config)
const firstProvider = (allProviders as unknown as ProviderConfig[])[0];
if (!firstProvider) {
  throw new Error('No mail providers configured in providers.jsonc');
}
export const DEFAULT_PROVIDER = firstProvider.id;

/**
 * Load a provider configuration by ID
 */
export function loadProviderConfig(providerId: string): ProviderConfig {
  const config = providerConfigs.get(providerId);
  if (!config) {
    throw new Error(`Provider configuration not found for: ${providerId}`);
  }
  return config;
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
  const config = loadAllProviderConfigs();
  return Object.values(config);
}

export interface ProviderConfig {
  id: string;
  name: string;
  displayName: string;
  apiUrl: string;
  websiteUrl?: string;
  auth: {
    type: 'query_parameter' | 'header';
    paramName?: string;
    headerName?: string;
    description: string;
  };
  retry: {
    maxAttempts: number;
    delayMs: number;
    backoffMultiplier: number;
  };
  operations: Record<string, OperationConfig>;
  emailFetching?: {
    type: 'single_step' | 'multi_step';
    operation?: string;
    dataPath?: string;
    responseMapping?: Record<string, string>;
    listOperation?: string;
    listPath?: string;
    listItemIdField?: string;
    detailOperation?: string;
    detailItemIdParam?: string;
    detailResponseMapping?: Record<string, string>;
    sequenceTracking?: {
      enabled: boolean;
      sequenceField: string;
      listSequenceField: string;
      sequenceOperation: 'max' | 'last';
    };
  };
  expiry?: {
    duration: number;
    renewable: boolean;
    renewalMethod?: string;
  };
  customEmail?: {
    supported: boolean;
    operation?: string;
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
}

export interface OperationConfig {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  function: string;
  requiredParams: Record<string, string>;
  optionalParams?: Record<string, string>;
  response: {
    successPath?: string;
    dataPath?: string;
    fields: Record<string, string>;
  };
  errorHandling: {
    errorPath: string;
    errorMessagePath: string;
  };
}

export interface EmailServiceContext {
  auth?: {
    token: string;
  };
  variables?: Record<string, unknown>;
  forceNewSession?: boolean;
  instanceUrl?: string;
}

export class EmailService {
  private config: ProviderConfig;

  constructor(config: ProviderConfig, _ext: Browser) {
    this.config = config;
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
      throw new Error(`Operation ${operationName} not found in provider configuration`);
    }

    logDebug(`Executing operation: ${operationName}`);

    // Apply retry logic if configured
    if (this.config.retry) {
      return this.executeWithRetry(operation, context);
    }

    // Build request using modular DSL component
    const { url, options } = buildRequest(this.config, operation, context);

    // Make request
    const response = await fetch(url, options);

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} when executing ${operationName}: ${response.statusText}`
      );
    }

    const data = await response.json();

    // Check for errors using modular DSL component
    checkForErrors(data, operation.errorHandling);

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
    const retryConfig = this.config.retry!;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
      try {
        const { url, options } = buildRequest(this.config, operation, context);
        const response = await fetch(url, options);

        if (!response.ok) {
          throw new Error(
            `HTTP ${response.status} when executing ${operation.function}: ${response.statusText}`
          );
        }

        const data = await response.json();
        checkForErrors(data, operation.errorHandling);
        return parseResponse(data, operation.response);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < retryConfig.maxAttempts) {
          const backoffDelay = retryConfig.delayMs * retryConfig.backoffMultiplier ** (attempt - 1);
          logDebug(`Retry attempt ${attempt}/${retryConfig.maxAttempts} after ${backoffDelay}ms`);
          await new Promise((resolve) => setTimeout(resolve, backoffDelay));
        }
      }
    }

    throw lastError || new Error('Max retry attempts exceeded');
  }

  /**
   * Get provider configuration
   */
  getConfig(): ProviderConfig {
    return this.config;
  }
}
