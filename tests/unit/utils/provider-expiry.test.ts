import { describe, expect, test } from 'bun:test';
import type { ProviderConfig } from '@/utils/email/email-service';
import {
  computePreExpiryWindow,
  deriveAddressTiming,
  effectivePreExpiryWindowMs,
  estimateRenewalLatencyMs,
} from '@/utils/provider/provider-expiry';
import type { Address } from '@/utils/types';

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

describe('deriveAddressTiming', () => {
  test('uses provider timestamp plus configured duration', () => {
    const timing = deriveAddressTiming({ timestamp: 1700000000 }, config, 1);
    expect(timing.createdAt).toBe(1700000000000);
    expect(timing.expiresAt).toBe(1700003600000);
  });

  test('uses Burner ttl as absolute expiry time', () => {
    const timing = deriveAddressTiming({ createdAt: 1700000000, ttl: 1700086400 }, config, 1);
    expect(timing.createdAt).toBe(1700000000000);
    expect(timing.expiresAt).toBe(1700086400000);
  });

  test('falls back to current time and configured duration', () => {
    const timing = deriveAddressTiming({}, config, 1000);
    expect(timing.createdAt).toBe(1000);
    expect(timing.expiresAt).toBe(3601000);
  });
});

describe('computePreExpiryWindow', () => {
  test('user window replaces the provider minimum as the floor', () => {
    expect(computePreExpiryWindow(config, undefined, 10 * 60_000)).toBe(600000);
  });

  test('user window below the provider minimum is honored', () => {
    expect(computePreExpiryWindow(config, undefined, 1 * 60_000)).toBe(60000);
  });

  test('measured latency still widens beyond the user window', () => {
    // 600s latency × 1.25 buffer = 750s > 600s user window.
    expect(computePreExpiryWindow(config, 600_000, 10 * 60_000)).toBe(750000);
    // Latency below the user window keeps the user window.
    expect(computePreExpiryWindow(config, 60_000, 10 * 60_000)).toBe(600000);
  });

  test('no user window falls back to the provider minimum', () => {
    expect(computePreExpiryWindow(config, undefined, undefined)).toBe(300000);
  });
});

describe('effectivePreExpiryWindowMs', () => {
  test('combines own latency with the user window', () => {
    const record = { ...baseAddress, renewalLatencyMs: 600_000, lastRenewalAt: 5000 };
    // 600s × 1.25 = 750s > 10 min user window.
    expect(effectivePreExpiryWindowMs(record, [], config, 10)).toBe(750000);
    // Low latency stays at the user window.
    const fast = { ...baseAddress, renewalLatencyMs: 10_000, lastRenewalAt: 5000 };
    expect(effectivePreExpiryWindowMs(fast, [], config, 10)).toBe(600000);
  });

  test('borrows sibling latency when the account has none', () => {
    const record = { ...baseAddress, instanceUrl: 'https://inst.example' };
    const siblings = [
      {
        ...baseAddress,
        id: 'b',
        instanceUrl: 'https://inst.example',
        renewalLatencyMs: 480_000,
        lastRenewalAt: 9000,
      },
    ];
    // 480s × 1.25 = 600s = 10 min > 5 min user default floor.
    expect(effectivePreExpiryWindowMs(record, siblings, config, undefined)).toBe(600000);
  });

  test('falls back to the user window with no latency anywhere', () => {
    expect(effectivePreExpiryWindowMs(baseAddress, [], config, 12)).toBe(720000);
    expect(effectivePreExpiryWindowMs(baseAddress, [], config, undefined)).toBe(300000);
  });
});

const baseAddress: Address = {
  id: 'a',
  address: 'a@test.com',
  provider: 'test',
  createdAt: 1000,
  expiresAt: 3601000,
};

describe('estimateRenewalLatencyMs', () => {
  test("uses the account's own measurement when present", () => {
    const record = { ...baseAddress, renewalLatencyMs: 900, lastRenewalAt: 5000 };
    const siblings = [{ ...baseAddress, id: 'b', renewalLatencyMs: 1200, lastRenewalAt: 9000 }];
    expect(estimateRenewalLatencyMs(record, siblings)).toBe(900);
  });

  test('borrows the most recent sibling on the same provider and instance', () => {
    const record = { ...baseAddress, instanceUrl: 'https://inst.example' };
    const siblings = [
      {
        ...baseAddress,
        id: 'b',
        instanceUrl: 'https://inst.example',
        renewalLatencyMs: 1000,
        lastRenewalAt: 7000,
      },
      {
        ...baseAddress,
        id: 'c',
        instanceUrl: 'https://inst.example',
        renewalLatencyMs: 1400,
        lastRenewalAt: 9000,
      },
      // Different instance of the same provider: must NOT be borrowed.
      {
        ...baseAddress,
        id: 'd',
        instanceUrl: 'https://other.example',
        renewalLatencyMs: 2000,
        lastRenewalAt: 9999,
      },
      // Different provider: must NOT be borrowed.
      {
        ...baseAddress,
        id: 'e',
        provider: 'other',
        renewalLatencyMs: 3000,
        lastRenewalAt: 9999,
      },
    ];
    expect(estimateRenewalLatencyMs(record, siblings)).toBe(1400);
  });

  test('borrows from instance-less siblings when the inbox has no instance', () => {
    const record = { ...baseAddress };
    const siblings = [
      { ...baseAddress, id: 'b', renewalLatencyMs: 1100, lastRenewalAt: 8000 },
      // Instanced sibling must not match an instance-less inbox.
      {
        ...baseAddress,
        id: 'c',
        instanceUrl: 'https://inst.example',
        renewalLatencyMs: 2200,
        lastRenewalAt: 9000,
      },
    ];
    expect(estimateRenewalLatencyMs(record, siblings)).toBe(1100);
  });

  test('returns undefined when neither the account nor siblings have a measurement', () => {
    expect(estimateRenewalLatencyMs(baseAddress, [])).toBeUndefined();
    expect(
      estimateRenewalLatencyMs(baseAddress, [
        { ...baseAddress, id: 'b', instanceUrl: 'https://inst.example' },
      ])
    ).toBeUndefined();
  });
});
