import { describe, expect, test } from 'bun:test';
import type { ProviderConfig } from '@/utils/email-service';
import { deriveInboxTiming } from '@/utils/provider-expiry';

const config: ProviderConfig = {
  id: 'test',
  name: 'Test',
  displayName: 'Test',
  apiUrl: 'https://example.com',
  auth: { type: 'header', headerName: 'X-Test', description: 'test' },
  retry: { maxAttempts: 1, delayMs: 0, backoffMultiplier: 1 },
  operations: {},
  expiry: { duration: 3600000, renewable: false },
};

describe('deriveInboxTiming', () => {
  test('uses provider timestamp plus configured duration', () => {
    const timing = deriveInboxTiming({ timestamp: 1700000000 }, config, 1);
    expect(timing.createdAt).toBe(1700000000000);
    expect(timing.expiresAt).toBe(1700003600000);
  });

  test('uses Burner ttl as absolute expiry time', () => {
    const timing = deriveInboxTiming({ createdAt: 1700000000, ttl: 1700086400 }, config, 1);
    expect(timing.createdAt).toBe(1700000000000);
    expect(timing.expiresAt).toBe(1700086400000);
  });

  test('falls back to current time and configured duration', () => {
    const timing = deriveInboxTiming({}, config, 1000);
    expect(timing.createdAt).toBe(1000);
    expect(timing.expiresAt).toBe(3601000);
  });
});
