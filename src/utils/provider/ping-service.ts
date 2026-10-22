import { formatMilliseconds } from '@/utils/time/time-format.js';
import type { ProviderInstance } from '@/utils/types.js';
import type { ProviderConfig } from '../email/email-service.js';
import { validateFetchUrl } from './instance-validation.js';

export interface PingResult {
  id: string;
  ping: number | 'timeout';
  /** true when we got a real HTTP status (extension host fetch), not opaque no-cors */
  reliable?: boolean;
}

export interface ProviderPingProbe {
  ping: number | 'timeout';
  failure?: 'validation' | 'request' | 'unreadable';
  /** A keyed safety/DNS validation error, retained for the UI. */
  error?: string;
}

const PING_TIMEOUT = 5000;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PING_TIMEOUT);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}
const PING_CACHE_DURATION = 5 * 60 * 1000;
/**
 * A 'timeout' carries far less information than a measured latency - the
 * no-cors fallback path returns 'timeout' whenever it cannot SEE the result
 * (opaque response), not only when the host is actually down. Caching it for
 * the full window let one network blip or CORS-opaque host report the
 * instance down for minutes, steering failover/onboarding/provider ranking
 * off stale health. Unreliable results are therefore cached for a short
 * window only - long enough to dedupe a burst of parallel pings, short
 * enough that the next UI action re-probes.
 */
const PING_UNRELIABLE_CACHE_DURATION = 15 * 1000;

const pingCache = new Map<
  string,
  {
    result: number | 'timeout';
    timestamp: number;
    reliable: boolean;
    url?: string;
    failure?: ProviderPingProbe['failure'];
  }
>();
const MAX_CACHE_SIZE = 100;

function isValidPingUrl(url: string): boolean {
  return (url.startsWith('http://') || url.startsWith('https://')) && !url.includes('{');
}

function setCachedPing(
  id: string,
  url: string,
  result: number | 'timeout',
  reliable: boolean,
  failure?: ProviderPingProbe['failure']
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

  pingCache.set(id, { result, timestamp: now, reliable, url, failure });
}

/**
 * Probe a provider URL with a real request.
 * Prefer CORS-mode GET/HEAD so opaque no-cors success is not treated as healthy.
 * In extension backgrounds, host permissions usually allow reading status codes.
 */
async function pingUrl(
  url: string
): Promise<{ ms: number | 'timeout'; reliable: boolean; failure?: ProviderPingProbe['failure'] }> {
  const startTime = performance.now();

  try {
    // 1) Real HEAD with cors - can read status in privileged contexts
    try {
      const res = await fetchWithTimeout(url, {
        method: 'HEAD',
        mode: 'cors',
        cache: 'no-store',
        credentials: 'omit',
      });
      // 2xx-4xx means host is reachable; 5xx still "up" for routing but slow
      if (res.status > 0) {
        return { ms: Math.round(performance.now() - startTime), reliable: true };
      }
    } catch {
      /* try GET */
    }

    // 2) GET cors (some APIs reject HEAD)
    try {
      const res = await fetchWithTimeout(url, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
        credentials: 'omit',
        headers: { Accept: 'application/json, text/plain, */*' },
      });
      if (res.status > 0) {
        return { ms: Math.round(performance.now() - startTime), reliable: true };
      }
    } catch {
      /* fall through */
    }

    // 3) Last resort no-cors - opaque; treat as weak signal only (not trusted health)
    try {
      await fetchWithTimeout(url, {
        method: 'GET',
        mode: 'no-cors',
        cache: 'no-store',
      });
      // Opaque success is unreliable - mark timeout so health graph prefers real probes
      return { ms: 'timeout', reliable: false, failure: 'unreadable' };
    } catch {
      /* ignore */
      return { ms: 'timeout', reliable: false, failure: 'request' };
    }
  } catch {
    /* ignore */
    return { ms: 'timeout', reliable: false, failure: 'request' };
  }
}

async function getPing(url: string, id: string): Promise<ProviderPingProbe> {
  const cached = pingCache.get(id);
  const now = Date.now();

  // An unreliable entry (opaque no-cors 'timeout') expires after the short
  // window even when its timestamp is young; a reliable latency lives the
  // full cache duration.
  const ttl = cached?.reliable === false ? PING_UNRELIABLE_CACHE_DURATION : PING_CACHE_DURATION;
  if (cached && (!cached.url || cached.url === url) && now - cached.timestamp < ttl) {
    return { ping: cached.result, failure: cached.failure };
  }

  const { ms, reliable, failure } = await pingUrl(url);
  setCachedPing(id, url, ms, reliable, failure);
  return { ping: ms, failure };
}

/**
 * Test hook: direct access to the module-level ping cache so TTL behavior is
 * deterministic without mocking the process clock (mirrors the
 * seedFetchUrlDnsCacheForTests pattern in instance-validation.ts).
 */
export function __pingCacheForTests(): Map<
  string,
  { result: number | 'timeout'; timestamp: number; reliable: boolean }
> {
  return pingCache;
}

export async function probeProviderInstances(
  provider: ProviderConfig,
  instances: ProviderInstance[]
): Promise<Map<string, ProviderPingProbe>> {
  const results = new Map<string, ProviderPingProbe>();

  const probe = async (url: string | undefined, id: string) => {
    if (!url || !isValidPingUrl(url)) {
      results.set(id, {
        ping: 'timeout',
        failure: 'validation',
        error: 'errors.webdavInvalidUrlFormat',
      });
      return;
    }
    const validation = await validateFetchUrl(url);
    if (!validation.ok) {
      results.set(id, { ping: 'timeout', failure: 'validation', error: validation.error });
      return;
    }
    results.set(id, await getPing(url, id));
  };

  if (!instances || instances.length === 0) {
    await probe(provider.apiUrl, provider.id);
    return results;
  }

  const pingPromises = instances
    .filter((instance) => instance.id !== 'random')
    .map(async (instance) => {
      const instanceUrl = instance.apiUrl || provider.apiUrl;
      await probe(instanceUrl, instance.id);
    });

  await Promise.all(pingPromises);

  return results;
}

/** Preserve the numeric ranking contract for provider failover consumers. */
export async function pingProviderInstances(
  provider: ProviderConfig,
  instances: ProviderInstance[]
): Promise<Map<string, number | 'timeout'>> {
  const probes = await probeProviderInstances(provider, instances);
  return new Map(
    [...probes]
      .filter(([, probe]) => probe.failure !== 'validation')
      .map(([id, probe]) => [id, probe.ping])
  );
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
  return formatMilliseconds(ping);
}

export function getPingColorClass(ping: number | 'timeout'): string {
  if (ping === 'timeout') return 'text-md-error';
  if (ping < 100) return 'text-md-success';
  if (ping < 300) return 'text-md-warning';
  return 'text-md-error';
}
