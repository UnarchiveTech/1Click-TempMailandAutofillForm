import { describe, expect, test } from 'bun:test';
import { validateProviderConfig } from '@/utils/provider-validation.js';

describe('validateProviderConfig', () => {
  test('passes validation for a valid configuration', () => {
    const validConfig = {
      id: 'test-provider',
      name: 'Test Provider',
      displayName: 'Test',
      apiUrl: 'https://api.test.com/v1',
      auth: {
        type: 'none',
        description: 'None',
      },
      retry: {
        maxAttempts: 3,
        delayMs: 1000,
        backoffMultiplier: 1.5,
      },
      operations: {
        get_email_address: {
          method: 'GET',
          function: 'get_email_address',
        },
      },
      expiry: {
        duration: 3600,
        renewable: true,
      },
    };

    expect(() => validateProviderConfig(validConfig)).not.toThrow();
  });

  test('throws error for non-object configurations', () => {
    expect(() => validateProviderConfig(null)).toThrow('Provider config must be an object');
    expect(() => validateProviderConfig('string')).toThrow('Provider config must be an object');
  });

  test('throws error when required fields are missing', () => {
    const missingId = {
      name: 'Test',
      displayName: 'Test',
      apiUrl: 'https://api.test.com',
      auth: { type: 'none', description: 'None' },
      retry: { maxAttempts: 3, delayMs: 1000, backoffMultiplier: 1.5 },
      operations: {},
      expiry: {},
    };
    expect(() => validateProviderConfig(missingId)).toThrow(
      'Provider config missing required field: id'
    );
  });

  test('validates auth structure and auth types', () => {
    const invalidAuthType = {
      id: 'test',
      name: 'Test',
      displayName: 'Test',
      apiUrl: 'https://api.test.com',
      auth: { type: 'invalid-type', description: 'None' },
      retry: { maxAttempts: 3, delayMs: 1000, backoffMultiplier: 1.5 },
      operations: {},
      expiry: { duration: 100 },
    };
    expect(() => validateProviderConfig(invalidAuthType)).toThrow('auth.type must be');
  });

  test('requires paramName for query_parameter auth type', () => {
    const missingParam = {
      id: 'test',
      name: 'Test',
      displayName: 'Test',
      apiUrl: 'https://api.test.com',
      auth: { type: 'query_parameter', description: 'None' },
      retry: { maxAttempts: 3, delayMs: 1000, backoffMultiplier: 1.5 },
      operations: {},
      expiry: { duration: 100 },
    };
    expect(() => validateProviderConfig(missingParam)).toThrow('auth.paramName is required');
  });
});
