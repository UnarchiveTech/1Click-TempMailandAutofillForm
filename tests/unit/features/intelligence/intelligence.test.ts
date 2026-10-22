import { describe, expect, test } from 'bun:test';
import {
  isInQuietHours,
  isOtpOrMagic,
  isSenderMuted,
} from '@/features/intelligence/notification-policy.js';
import {
  isProviderHealthStale,
  providerHealthScore,
} from '@/features/intelligence/provider-health.js';
import { hostMatchesPattern } from '@/features/intelligence/site-rules.js';
import type {
  NotificationIntelligenceSettings,
  ProviderHealth,
} from '@/features/intelligence/types.js';
import { DEFAULT_NOTIFICATION_INTELLIGENCE } from '@/features/intelligence/types.js';

describe('Provider health score', () => {
  test('healthy provider ranks high', () => {
    const h: ProviderHealth = {
      providerId: 'guerrilla',
      createAttempts: 10,
      createSuccesses: 9,
      fetchAttempts: 20,
      fetchSuccesses: 19,
      createLatencyMs: [200, 250, 180],
      fetchLatencyMs: [100, 120],
      lastSuccessAt: Date.now(),
      updatedAt: Date.now(),
    };
    expect(providerHealthScore(h)).toBeGreaterThan(70);
  });

  test('failing provider ranks low', () => {
    const h: ProviderHealth = {
      providerId: 'x',
      createAttempts: 8,
      createSuccesses: 1,
      fetchAttempts: 10,
      fetchSuccesses: 1,
      createLatencyMs: [5000],
      fetchLatencyMs: [],
      lastFailureAt: Date.now(),
      updatedAt: Date.now(),
    };
    expect(providerHealthScore(h)).toBeLessThan(50);
  });

  describe('staleness guard', () => {
    const base = {
      providerId: 'stale',
      createAttempts: 10,
      createSuccesses: 10,
      fetchAttempts: 20,
      fetchSuccesses: 20,
      createLatencyMs: [100],
      fetchLatencyMs: [100],
    };

    test('a PERFECT but stale record cannot outrank the neutral midpoint', () => {
      // The latency ring only ages out after 12 newer probes and success
      // rates never decay, so without the cap an unprobed provider served its
      // months-old verdict forever.
      const h: ProviderHealth = {
        ...base,
        lastSuccessAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
        updatedAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
      };
      const fresh: ProviderHealth = { ...base, providerId: 'fresh', updatedAt: Date.now() };

      expect(isProviderHealthStale(h)).toBe(true);
      expect(providerHealthScore(h)).toBe(50);
      // A fresh record with identical history keeps its full score.
      expect(providerHealthScore(fresh)).toBeGreaterThan(50);
    });

    test('a fresh record is never capped', () => {
      const h: ProviderHealth = { ...base, updatedAt: Date.now() - 60_000 };
      expect(isProviderHealthStale(h)).toBe(false);
      expect(providerHealthScore(h)).toBeGreaterThan(50);
    });

    test('a record without updatedAt is stale (cannot prove freshness)', () => {
      const h: ProviderHealth = { ...base, updatedAt: 0 };
      expect(isProviderHealthStale(h)).toBe(true);
      expect(providerHealthScore(h)).toBeLessThanOrEqual(50);
    });
  });
});

describe('Notification quiet hours', () => {
  test('quiet hours returns boolean', () => {
    const settings: NotificationIntelligenceSettings = {
      ...DEFAULT_NOTIFICATION_INTELLIGENCE,
      quietHoursEnabled: true,
      quietHoursStart: 22,
      quietHoursEnd: 8,
    };
    expect(typeof isInQuietHours(settings)).toBe('boolean');
  });

  test('OTP detection', () => {
    expect(isOtpOrMagic({ id: '1', received_at: 1, otp: '123456' })).toBe(true);
    expect(isOtpOrMagic({ id: '2', received_at: 1, hasMagicLink: true })).toBe(true);
    expect(isOtpOrMagic({ id: '3', received_at: 1, subject: 'Hello' })).toBe(false);
  });

  test('muting parses display-name headers and preserves domain boundaries', () => {
    const settings = { ...DEFAULT_NOTIFICATION_INTELLIGENCE, mutedSenderDomains: ['muted.com'] };
    for (const from of [
      'x@muted.com',
      'Spam <x@muted.com>',
      '"Name@elsewhere" <x@sub.muted.com>',
    ]) {
      expect(isSenderMuted({ id: from, received_at: 1, from }, settings)).toBe(true);
    }
    for (const from of ['Spam <x@notmuted.com>', 'Spam <x@muted.com.evil.net>', '']) {
      expect(isSenderMuted({ id: from, received_at: 1, from }, settings)).toBe(false);
    }
  });
});

describe('Site rule domain patterns', () => {
  test('exact and suffix match', () => {
    expect(hostMatchesPattern('github.com', 'github.com')).toBe(true);
    expect(hostMatchesPattern('app.github.com', 'github.com')).toBe(true);
    expect(hostMatchesPattern('evil.com', 'github.com')).toBe(false);
  });

  test('wildcard *.example.com', () => {
    expect(hostMatchesPattern('foo.example.com', '*.example.com')).toBe(true);
    expect(hostMatchesPattern('example.com', '*.example.com')).toBe(true);
    expect(hostMatchesPattern('notexample.com', '*.example.com')).toBe(false);
  });
});
