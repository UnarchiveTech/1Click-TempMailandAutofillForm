import type { ProviderInstance } from '@/utils/types.js';
import type { ProviderConfig } from './email-service.js';

export interface PingResult {
  id: string;
  ping: number | 'timeout';
  /** true when we got a real HTTP status (extension host fetch), not opaque no-cors */
  reliable?: boolean;
}

const PING_TIMEOUT = 5000;
const PING_CACHE_DURATION = 5 * 60 * 1000;

const pingCache = new Map<
  string,
  { result: number | 'timeout'; timestamp: number; reliable: boolean }
>();
const MAX_CACHE_SIZE = 100;

function isValidPingUrl(url: string): boolean {
  return (url.startsWith('http://') || url.startsWith('https://')) && !url.includes('{');
}

function setCachedPing(
  id: string,
  result: number | 'timeout',
  timestamp: number,
  reliable: boolean
) {
  const now = Date.now();
  for (const [key, value] of pingCache.entries()) {
    if (now - value.timestamp >= PING_CACHE_DURATION) {
      pingCache.delete(key);
    }
  }

  if (pingCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = pingCache.keys().next().value;
    if (oldestKey !== undefined) {
      pingCache.delete(oldestKey);
    }
  }

  pingCache.set(id, { result, timestamp, reliable });
}

/**
 * Probe a provider URL with a real request.
 * Prefer CORS-mode GET/HEAD so opaque no-cors success is not treated as healthy.
 * In extension backgrounds, host permissions usually allow reading status codes.
 */
async function pingUrl(url: string): Promise<{ ms: number | 'timeout'; reliable: boolean }> {
  const startTime = performance.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PING_TIMEOUT);

  try {
    // 1) Real HEAD with cors — can read status in privileged contexts
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        mode: 'cors',
        cache: 'no-store',
        signal: controller.signal,
        credentials: 'omit',
      });
      clearTimeout(timeoutId);
      // 2xx–4xx means host is reachable; 5xx still "up" for routing but slow
      if (res.status > 0) {
        return { ms: Math.round(performance.now() - startTime), reliable: true };
      }
    } catch {
      /* try GET */
    }

    // 2) GET cors (some APIs reject HEAD)
    try {
      const res = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
        signal: controller.signal,
        credentials: 'omit',
        headers: { Accept: 'application/json, text/plain, */*' },
      });
      clearTimeout(timeoutId);
      if (res.status > 0) {
        return { ms: Math.round(performance.now() - startTime), reliable: true };
      }
    } catch {
      /* fall through */
    }

    // 3) Last resort no-cors — opaque; treat as weak signal only (not trusted health)
    try {
      await fetch(url, {
        method: 'GET',
        mode: 'no-cors',
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      // Opaque success is unreliable — mark timeout so health graph prefers real probes
      return { ms: 'timeout', reliable: false };
    } catch {
      clearTimeout(timeoutId);
      return { ms: 'timeout', reliable: false };
    }
  } catch {
    clearTimeout(timeoutId);
    return { ms: 'timeout', reliable: false };
  }
}

async function getPing(url: string, id: string): Promise<number | 'timeout'> {
  const cached = pingCache.get(id);
  const now = Date.now();

  if (cached && now - cached.timestamp < PING_CACHE_DURATION) {
    return cached.result;
  }

  const { ms, reliable } = await pingUrl(url);
  setCachedPing(id, ms, now, reliable);
  return ms;
}

export async function pingProviderInstances(
  provider: ProviderConfig,
  instances: ProviderInstance[]
): Promise<Map<string, number | 'timeout'>> {
  const results = new Map<string, number | 'timeout'>();

  if (!instances || instances.length === 0) {
    if (provider.apiUrl && isValidPingUrl(provider.apiUrl)) {
      const ping = await getPing(provider.apiUrl, provider.id);
      results.set(provider.id, ping);
    }
    return results;
  }

  const pingPromises = instances
    .filter((instance) => instance.id !== 'random')
    .map(async (instance) => {
      const instanceUrl = instance.apiUrl || provider.apiUrl;
      if (instanceUrl && isValidPingUrl(instanceUrl)) {
        const ping = await getPing(instanceUrl, instance.id);
        results.set(instance.id, ping);
      }
    });

  await Promise.all(pingPromises);

  return results;
}

export function getFastestPing(
  results: Map<string, number | 'timeout'>
): number | 'timeout' | null {
  let fastest: number | 'timeout' | null = null;

  for (const ping of results.values()) {
    if (ping === 'timeout') continue;
    if (fastest === null || ping < fastest) {
      fastest = ping;
    }
  }

  return fastest;
}

export function formatPing(ping: number | 'timeout'): string {
  if (ping === 'timeout') return 'timeout';
  return `${ping}ms`;
}

export function getPingColorClass(ping: number | 'timeout'): string {
  if (ping === 'timeout') return 'text-md-error';
  if (ping < 100) return 'text-md-success';
  if (ping < 300) return 'text-md-warning';
  return 'text-md-error';
}
