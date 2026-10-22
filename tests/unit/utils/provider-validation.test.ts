import { describe, expect, test } from 'bun:test';
import { ValidationError } from '@/utils/errors.js';
import { validateProviderConfig } from '@/utils/provider/provider-validation.js';

/**
 * Every rejection carries a stable `errors.*` locale key **and** the values its
 * `{slot}`s need, so the providers JSON editor names the offending field in the
 * user's language instead of collapsing to a generic message. Assertions here
 * therefore pin the KEY (the contract the UI renders) plus the values, not the
 * English prose - prose is a derived developer-facing diagnostic that reaches
 * logs only.
 */
function rejectionFrom(run: () => void): ValidationError {
  try {
    run();
  } catch (error) {
    if (error instanceof ValidationError) return error;
    throw error;
  }
  throw new Error('expected the validator to reject this config');
}

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
    for (const notAnObject of [null, 'string']) {
      const rejection = rejectionFrom(() => validateProviderConfig(notAnObject));
      expect(rejection.translationKey).toBe('errors.providerConfigMustBeObject');
      expect(rejection.translationValues).toBeUndefined();
    }
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
    const rejection = rejectionFrom(() => validateProviderConfig(missingId));
    expect(rejection.translationKey).toBe('errors.providerConfigFieldMissing');
    expect(rejection.translationValues).toEqual({ field: 'id' });
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
    const rejection = rejectionFrom(() => validateProviderConfig(invalidAuthType));
    expect(rejection.translationKey).toBe('errors.providerConfigFieldOneOf');
    expect(rejection.translationValues).toEqual({
      field: 'auth.type',
      allowed: 'query_parameter, header, cookie, bearer, none',
    });
  });

  test('validates multiInstance shape and instance fields', () => {
    const base = {
      id: 'test',
      name: 'Test',
      displayName: 'Test',
      apiUrl: 'https://api.test.com',
      auth: { type: 'none', description: 'None' },
      retry: { maxAttempts: 1, delayMs: 0, backoffMultiplier: 1 },
      operations: {},
    };
    const wrongShape = rejectionFrom(() =>
      validateProviderConfig({ ...base, multiInstance: { enabled: 'true' } })
    );
    expect(wrongShape.translationKey).toBe('errors.providerConfigFieldBoolean');
    expect(wrongShape.translationValues).toEqual({ field: 'multiInstance.enabled' });

    const notAnArray = rejectionFrom(() =>
      validateProviderConfig({ ...base, multiInstance: { enabled: true, instances: 'bad' } })
    );
    expect(notAnArray.translationKey).toBe('errors.providerConfigFieldArray');
    expect(notAnArray.translationValues).toEqual({ field: 'multiInstance.instances' });

    const emptyInstanceField = rejectionFrom(() =>
      validateProviderConfig({
        ...base,
        multiInstance: {
          enabled: true,
          instances: [{ id: 'one', name: 'One', displayName: 'One', apiUrl: '' }],
        },
      })
    );
    expect(emptyInstanceField.translationKey).toBe('errors.providerConfigFieldNonEmptyString');
    // The indexed path is what makes the message actionable in the JSON editor.
    expect(emptyInstanceField.translationValues).toEqual({
      field: 'multiInstance.instances[0].apiUrl',
    });

    const duplicateId = rejectionFrom(() =>
      validateProviderConfig({
        ...base,
        multiInstance: {
          enabled: true,
          instances: [
            { id: 'one', name: 'One', displayName: 'One', apiUrl: 'https://one.example.com' },
            { id: 'one', name: 'Two', displayName: 'Two', apiUrl: 'https://two.example.com' },
          ],
        },
      })
    );
    expect(duplicateId.translationKey).toBe('errors.providerConfigDuplicateInstanceId');
    expect(duplicateId.translationValues).toEqual({ id: 'one' });
  });

  test('rejects wrong element types in array-valued provider fields', () => {
    const base = {
      id: 'test',
      name: 'Test',
      displayName: 'Test',
      apiUrl: 'https://api.test.com',
      auth: { type: 'none', description: 'None' },
      retry: { maxAttempts: 1, delayMs: 0, backoffMultiplier: 1 },
      operations: {},
    };

    const invalidDomains = rejectionFrom(() =>
      validateProviderConfig({
        ...base,
        multiDomain: { enabled: true, domains: ['valid.test', 123, null] },
      })
    );
    expect(invalidDomains.translationKey).toBe('errors.providerConfigFieldArrayOfStrings');
    expect(invalidDomains.translationValues).toEqual({ field: 'multiDomain.domains' });

    const invalidRetryStatuses = rejectionFrom(() =>
      validateProviderConfig({ ...base, retry: { ...base.retry, retryOn: [502, '503'] } })
    );
    expect(invalidRetryStatuses.translationKey).toBe('errors.providerConfigFieldArrayOfNumbers');
    expect(invalidRetryStatuses.translationValues).toEqual({ field: 'retry.retryOn' });
  });

  test('rejects scheme-relative or path-traversal operation.function values', () => {
    const base = {
      id: 'test',
      name: 'Test',
      displayName: 'Test',
      apiUrl: 'https://api.test.com',
      auth: { type: 'none', description: 'None' },
      retry: { maxAttempts: 1, delayMs: 0, backoffMultiplier: 1 },
      operations: {},
    };
    const withFunction = (fn: string) => ({
      ...base,
      operations: {
        op: { method: 'GET', function: fn },
      },
    });
    // The function interpolates into request paths/query on every poll - a
    // tampered override must not smuggle an origin or collapse the path.
    for (const unsafe of ['//attacker.com/steal', '/../.env']) {
      const rejection = rejectionFrom(() => validateProviderConfig(withFunction(unsafe)));
      expect(rejection.translationKey).toBe('errors.providerConfigOperationFunctionUnsafe');
      expect(rejection.translationValues).toEqual({ opKey: 'op' });
    }
    const emptyFunction = rejectionFrom(() => validateProviderConfig(withFunction('')));
    expect(emptyFunction.translationKey).toBe('errors.providerConfigFieldNonEmptyString');
    expect(emptyFunction.translationValues).toEqual({ field: 'operations.op.function' });
    // Normal identifiers / REST-style paths still pass.
    expect(() => validateProviderConfig(withFunction('get_email_address'))).not.toThrow();
    expect(() => validateProviderConfig(withFunction('/api/v1/mailbox'))).not.toThrow();
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
    const rejection = rejectionFrom(() => validateProviderConfig(missingParam));
    expect(rejection.translationKey).toBe('errors.providerConfigAuthFieldRequired');
    expect(rejection.translationValues).toEqual({
      field: 'auth.paramName',
      authType: 'query_parameter',
    });
  });

  test('names the offending field instead of a generic failure', () => {
    // The pair the UI renders: `applyProviderConfigArray`/`toResultError` hand
    // over the key + values, so the user is told which field is wrong. The
    // generic "Provider configuration is invalid" survives only as the fallback
    // for an unkeyed failure - see email-service.test.ts for that payload path.
    const missing = rejectionFrom(() => validateProviderConfig({ id: 'x', name: 'X' }));
    expect(missing.translationKey).toBe('errors.providerConfigFieldMissing');
    expect(missing.translationValues).toEqual({ field: 'displayName' });
  });

  test('the derived log message names the key, never English prose', () => {
    // The message is developer-facing: it must stay greppable to the key so it
    // cannot drift from the sentence the user sees.
    const rejection = rejectionFrom(() => validateProviderConfig({ id: 'x' }));
    expect(rejection.message).toContain('errors.providerConfigFieldMissing');
  });
});
