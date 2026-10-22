import { toMs } from '@/utils/time/time.js';

export interface VerificationPreferences {
  maxAgeMinutes: number;
  grouping: 'address' | 'website';
}

export const DEFAULT_VERIFICATION_PREFERENCES: VerificationPreferences = {
  maxAgeMinutes: 30,
  grouping: 'address',
};

/** Bound imported/untrusted preferences without changing the original message timestamps. */
export function normalizeVerificationPreferences(raw: unknown): VerificationPreferences {
  const value = raw && typeof raw === 'object' ? (raw as Partial<VerificationPreferences>) : {};
  return {
    maxAgeMinutes:
      typeof value.maxAgeMinutes === 'number' && Number.isFinite(value.maxAgeMinutes)
        ? Math.max(1, Math.min(1440, Math.round(value.maxAgeMinutes)))
        : DEFAULT_VERIFICATION_PREFERENCES.maxAgeMinutes,
    grouping: value.grouping === 'website' ? 'website' : 'address',
  };
}

/** Missing, invalid or far-future receipt times cannot prove that a verification is current. */
export function verificationExpiresAt(
  receivedAt: number,
  detectedExpiry: number | null | undefined,
  maxAgeMinutes: number,
  now: number
): number {
  const received = toMs(receivedAt);
  if (!Number.isFinite(received) || received <= 0 || received > now + 120_000) return 0;
  const limit = normalizeVerificationPreferences({ maxAgeMinutes }).maxAgeMinutes;
  const capped = received + limit * 60_000;
  return typeof detectedExpiry === 'number' && Number.isFinite(detectedExpiry) && detectedExpiry > 0
    ? Math.min(capped, toMs(detectedExpiry))
    : capped;
}
