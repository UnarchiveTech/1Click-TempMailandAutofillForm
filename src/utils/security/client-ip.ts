/**
 * Resolve the browser's public client IP for the `{clientIp}` provider
 * template variable.
 *
 * Historically `{clientIp}` resolved to a hardcoded `127.0.0.1`. That is fine
 * for the bundled providers (Guerrilla's API documents the param and never
 * binds sessions to it), but any provider that binds sessions or rate-limits
 * by client IP would see every user as localhost. Instead we look the real
 * public IP up once and cache it.
 *
 * api.ipify.org sends `Access-Control-Allow-Origin: *`, so the lookup works
 * from the extension service worker WITHOUT a host permission (plain CORS -
 * exactly how the dns.google-based SSRF check works). If the lookup fails
 * (offline, blocked, timeout) we keep the previous value / the historical
 * `127.0.0.1` fallback rather than failing the inbox creation.
 */

import { isIpv4Private } from '../provider/instance-validation.js';

/** The historical fallback - also what bundled providers expect to tolerate. */
const FALLBACK_CLIENT_IP = '127.0.0.1';

/** Re-resolve the IP at most this often per service-worker lifetime. */
const CLIENT_IP_TTL_MS = 10 * 60 * 1000;

const IP_ECHO_URL = 'https://api.ipify.org?format=json';

let cachedClientIp = FALLBACK_CLIENT_IP;
let lastFetchedAt = 0;
let inflight: Promise<string> | null = null;

function isValidPublicIpv4(ip: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return false;
  if (ip.split('.').some((octet) => Number(octet) > 255)) return false;
  return !isIpv4Private(ip);
}

/**
 * Synchronous read for the DSL template resolver (buildRequest is sync).
 * Returns the cached public IP, falling back to `127.0.0.1` until a refresh
 * completes.
 */
export function getClientIp(): string {
  return cachedClientIp;
}

/**
 * Kick off (or share) a public-IP lookup. Cached for `CLIENT_IP_TTL_MS`;
 * concurrent callers share one in-flight request. Failure keeps the previous
 * value - the extension never blocks provider calls on this.
 */
export async function refreshClientIp(force = false): Promise<string> {
  if (!force && cachedClientIp && Date.now() - lastFetchedAt < CLIENT_IP_TTL_MS) {
    return cachedClientIp;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(IP_ECHO_URL, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (res.ok) {
          const data = (await res.json()) as { ip?: string };
          if (typeof data.ip === 'string' && isValidPublicIpv4(data.ip)) {
            cachedClientIp = data.ip;
            lastFetchedAt = Date.now();
          }
        }
      } finally {
        clearTimeout(timeoutId);
      }
    } catch {
      /* keep the previous/fallback value - never fail the caller */
    }
    return cachedClientIp;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
