import type { ProviderConfig } from './email-service.js';
import { isMs, toMs } from './time.js';

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

export function deriveInboxTiming(
  result: Record<string, unknown>,
  config: ProviderConfig,
  fallbackNow = Date.now()
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

  const createdAt = rawCreatedAt && rawCreatedAt > 0 ? rawCreatedAt : fallbackNow;

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
      const ttlDuration = isMs(rawTtl, 1e6) ? rawTtl : rawTtl * 1000;
      expiresAt = createdAt + ttlDuration;
    }
  }

  if (!expiresAt || expiresAt <= createdAt) {
    const defaultDuration = config.expiry?.duration || 3600000;
    expiresAt = createdAt + defaultDuration;
  }

  return { createdAt, expiresAt };
}
