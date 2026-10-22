import type { ProviderConfig } from '../email/email-service.js';
import { isMs, toMs } from '../time/time.js';
import type { Address } from '../types.js';

/** Default auto-renew lead time (minutes before expiry) when the user hasn't
 * configured one. 1 minute - renewal fires as late as possible; the adaptive
 * latency component still widens the window when renewal is slow. */
export const DEFAULT_PRE_EXPIRY_WINDOW_MINUTES = 1;

function parseRawNumber(value: unknown): number | null {
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  return null;
}

function parseAbsoluteTimestampMs(value: unknown): number | null {
  const raw = parseRawNumber(value);
  if (!raw) return null;
  return toMs(raw);
}

export function deriveAddressTiming(
  result: Record<string, unknown>,
  config: ProviderConfig,
  fallbackNow = Date.now(),
  opts?: { renewalBaseNow?: boolean }
): { createdAt: number; expiresAt: number } {
  const fields = config.expiry?.fields || {};
  const createdAtKey = fields.createdAt || 'created_at';
  const expiresAtKey = fields.expiresAt || 'expires_at';
  const ttlKey = fields.ttl || 'ttl';

  const rawCreatedAt =
    parseAbsoluteTimestampMs(result[createdAtKey]) ??
    parseAbsoluteTimestampMs(result.createdAt) ??
    parseAbsoluteTimestampMs(result.created_at) ??
    parseAbsoluteTimestampMs(result.timestamp);

  // BUG FIX (auto-renew): For renewal, do NOT trust a possibly-stale
  // `result.timestamp` from the API as the created-at base. If the provider
  // returns the ORIGINAL session timestamp (not the renewal time), the derived
  // expiresAt would be `original_createdAt + duration` - already in the past,
  // causing auto-renew to fail/loop. When `renewalBaseNow` is true, force the
  // base to `fallbackNow` (Date.now()) so the renewed window is always in the
  // future, unless the API provides an absolute future expiry/ttl.
  const createdAt = opts?.renewalBaseNow
    ? fallbackNow
    : rawCreatedAt && rawCreatedAt > 0
      ? rawCreatedAt
      : fallbackNow;

  const absoluteExpiresAt =
    parseAbsoluteTimestampMs(result[expiresAtKey]) ??
    parseAbsoluteTimestampMs(result.expiresAt) ??
    parseAbsoluteTimestampMs(result.expires_at);

  const rawTtl = parseRawNumber(result[ttlKey]) ?? parseRawNumber(result.ttl);

  let expiresAt: number | null = null;

  if (absoluteExpiresAt && absoluteExpiresAt > createdAt) {
    expiresAt = absoluteExpiresAt;
  } else if (rawTtl) {
    if (isMs(rawTtl)) {
      // Absolute timestamp in milliseconds
      expiresAt = rawTtl;
    } else if (rawTtl > createdAt / 1000) {
      // Absolute timestamp in seconds (e.g. Burner.kiwi ttl: 1700086400)
      expiresAt = rawTtl * 1000;
    } else {
      // Relative duration in seconds or milliseconds (e.g. ttl: 3600)
      // Relative TTL values are provider durations, not Unix timestamps.
      // Treat them as seconds unless they are unambiguously millisecond-sized
      // durations. A 30-day TTL (2_592_000 seconds) must not become 43 minutes.
      const ttlDuration = rawTtl >= 1e8 ? rawTtl : rawTtl * 1000;
      expiresAt = createdAt + ttlDuration;
    }
  }

  if (!expiresAt || expiresAt <= createdAt) {
    const defaultDuration = config.expiry?.duration || 3600000;
    expiresAt = createdAt + defaultDuration;
  }

  return { createdAt, expiresAt };
}

/**
 * Adaptive pre-expiry window for auto-renew.
 *
 * Uses the measured renewal latency (from the account record) to ensure the
 * auto-renew fires early enough to complete before the mailbox expires.
 * Falls back to a provider-configured minimum window when no latency has been
 * measured yet (e.g. a brand-new inbox).
 *
 *   window = max(minPreExpiryWindowMs | userWindowMs, measuredLatencyMs × (1 + safetyBufferRatio))
 *
 * `userWindowMs` (from the user-configurable renewal lead time, 1-30 min)
 * replaces the provider minimum as the floor; the adaptive latency component
 * can still widen the window when renewal is slow.
 */
export function computePreExpiryWindow(
  config: ProviderConfig,
  measuredLatencyMs?: number,
  userWindowMs?: number
): number {
  const providerMin = config.expiry?.renewal?.minPreExpiryWindowMs ?? 300000; // 5 min default
  const minWindow =
    typeof userWindowMs === 'number' && userWindowMs > 0 ? userWindowMs : providerMin;
  const bufferRatio = config.expiry?.renewal?.safetyBufferRatio ?? 0.25; // 25% default
  if (typeof measuredLatencyMs === 'number' && measuredLatencyMs > 0) {
    return Math.max(minWindow, Math.round(measuredLatencyMs * (1 + bufferRatio)));
  }
  return minWindow;
}

/**
 * The auto-renew lead time actually used for an inbox: the user-configured
 * minutes (or provider minimum) as the floor, widened by measured renewal
 * latency (own or a sibling's) when that would fire later. Mirrors exactly
 * what the background expiry check uses, so the UI and the scheduler can't
 * drift apart.
 */
export function effectivePreExpiryWindowMs(
  record: Address,
  siblings: Address[],
  config: ProviderConfig,
  userWindowMinutes?: number
): number {
  return computePreExpiryWindow(
    config,
    estimateRenewalLatencyMs(record, siblings),
    typeof userWindowMinutes === 'number' && userWindowMinutes > 0
      ? userWindowMinutes * 60_000
      : undefined
  );
}

/**
 * Estimate the renewal latency for an inbox, for sizing the adaptive
 * pre-expiry window.
 *
 * Uses the account's own measured latency when available; otherwise borrows
 * the most recent measurement from a sibling address sharing the same provider
 * AND the same instance (instance-less single-instance providers match on
 * provider alone). Network latency is a property of the provider/instance, not
 * the individual address, so a sibling's measurement calibrates the window
 * before this address has renewed even once - instead of falling back to the
 * static provider minimum.
 *
 * Returns undefined when neither the account nor any sibling has a measurement.
 */
export function estimateRenewalLatencyMs(record: Address, siblings: Address[]): number | undefined {
  if (typeof record.renewalLatencyMs === 'number' && record.renewalLatencyMs > 0) {
    return record.renewalLatencyMs;
  }
  const instance = record.instanceUrl ?? '';
  let best: { latency: number; at: number } | undefined;
  for (const sibling of siblings) {
    if (sibling.id === record.id) continue;
    if (sibling.provider !== record.provider) continue;
    if ((sibling.instanceUrl ?? '') !== instance) continue;
    const latency = sibling.renewalLatencyMs;
    if (typeof latency !== 'number' || latency <= 0) continue;
    const at = sibling.lastRenewalAt ?? 0;
    if (!best || at > best.at) best = { latency, at };
  }
  return best?.latency;
}
