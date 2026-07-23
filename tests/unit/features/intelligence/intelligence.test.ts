import { describe, expect, test } from 'bun:test';
import { isInQuietHours, isOtpOrMagic } from '@/features/intelligence/notification-policy.js';
import { providerHealthScore } from '@/features/intelligence/provider-health.js';
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
