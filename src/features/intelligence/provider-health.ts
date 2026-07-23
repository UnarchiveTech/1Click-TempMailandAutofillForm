/**
 * Provider reliability graph — track create/fetch success and latency.
 */

import { withLock } from '@/utils/mutex.js';
import { loadProviderHealthMap, saveProviderHealthMap } from './storage.js';
import { INTELLIGENCE_CAPS, type ProviderHealth } from './types.js';

function emptyHealth(providerId: string): ProviderHealth {
  return {
    providerId,
    createAttempts: 0,
    createSuccesses: 0,
    fetchAttempts: 0,
    fetchSuccesses: 0,
    createLatencyMs: [],
    fetchLatencyMs: [],
    updatedAt: Date.now(),
  };
}

function pushSample(arr: number[], value: number): number[] {
  const next = [...arr, value];
  if (next.length > INTELLIGENCE_CAPS.maxLatencySamples) {
    return next.slice(next.length - INTELLIGENCE_CAPS.maxLatencySamples);
  }
  return next;
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export async function recordProviderCreate(
  providerId: string,
  success: boolean,
  latencyMs: number,
  error?: string
): Promise<void> {
  if (!providerId) return;
  await withLock('provider_health_lock', async () => {
    const map = await loadProviderHealthMap();
    const h = map[providerId] || emptyHealth(providerId);
    h.createAttempts += 1;
    if (success) {
      h.createSuccesses += 1;
      h.lastSuccessAt = Date.now();
      h.createLatencyMs = pushSample(h.createLatencyMs, Math.max(0, latencyMs));
      h.lastError = undefined;
    } else {
      h.lastFailureAt = Date.now();
      h.lastError = (error || 'create_failed').slice(0, 200);
    }
    h.updatedAt = Date.now();
    map[providerId] = h;
    await saveProviderHealthMap(map);
  });
}

export async function recordProviderFetch(
  providerId: string,
  success: boolean,
  latencyMs: number,
  error?: string
): Promise<void> {
  if (!providerId) return;
  await withLock('provider_health_lock', async () => {
    const map = await loadProviderHealthMap();
    const h = map[providerId] || emptyHealth(providerId);
    h.fetchAttempts += 1;
    if (success) {
      h.fetchSuccesses += 1;
      h.lastSuccessAt = Date.now();
      h.fetchLatencyMs = pushSample(h.fetchLatencyMs, Math.max(0, latencyMs));
    } else {
      h.lastFailureAt = Date.now();
      h.lastError = (error || 'fetch_failed').slice(0, 200);
    }
    h.updatedAt = Date.now();
    map[providerId] = h;
    await saveProviderHealthMap(map);
  });
}

/** 0–100 health score (higher is better). */
export function providerHealthScore(h: ProviderHealth): number {
  const createRate = h.createAttempts > 0 ? h.createSuccesses / h.createAttempts : 0.5;
  const fetchRate = h.fetchAttempts > 0 ? h.fetchSuccesses / h.fetchAttempts : 0.5;
  const attempts = h.createAttempts + h.fetchAttempts;
  // Bayesian-ish shrink toward 0.5 when little data
  const weight = Math.min(1, attempts / 8);
  const blended = (createRate * 0.55 + fetchRate * 0.45) * weight + 0.5 * (1 - weight);

  // Latency penalty (create)
  const lat = avg(h.createLatencyMs);
  let latFactor = 1;
  if (lat > 3000) latFactor = 0.85;
  else if (lat > 1500) latFactor = 0.92;

  // Recent failure penalty
  let recency = 1;
  if (h.lastFailureAt && (!h.lastSuccessAt || h.lastFailureAt > h.lastSuccessAt)) {
    const age = Date.now() - h.lastFailureAt;
    if (age < 5 * 60 * 1000) recency = 0.7;
    else if (age < 30 * 60 * 1000) recency = 0.85;
  }

  return Math.round(Math.max(0, Math.min(100, blended * 100 * latFactor * recency)));
}

export interface RankedProvider {
  providerId: string;
  score: number;
  health: ProviderHealth;
}

export async function rankProvidersByHealth(providerIds: string[]): Promise<RankedProvider[]> {
  const map = await loadProviderHealthMap();
  return providerIds
    .map((id) => {
      const health = map[id] || emptyHealth(id);
      return { providerId: id, score: providerHealthScore(health), health };
    })
    .sort((a, b) => b.score - a.score);
}

export async function getBestHealthyProvider(
  providerIds: string[],
  minScore = 35
): Promise<string | null> {
  const ranked = await rankProvidersByHealth(providerIds);
  const ok = ranked.find((r) => r.score >= minScore);
  return ok?.providerId || ranked[0]?.providerId || null;
}

/**
 * Resolve which provider to use when creating an inbox:
 * 1) Explicit providerId (if given and not forceHealthPick)
 * 2) Site rule provider for domain
 * 3) Best healthy among available ids
 * 4) Fallbacks: preferred → first available
 */
export async function resolveCreateProvider(opts: {
  providerIds: string[];
  explicitProviderId?: string | null;
  domain?: string | null;
  /** When true, ignore explicit and pick by health (failover) */
  forceHealthPick?: boolean;
  preferProviderId?: string | null;
}): Promise<{
  providerId: string | null;
  reason: 'explicit' | 'rule' | 'health' | 'prefer' | 'none';
}> {
  const ids = opts.providerIds.filter(Boolean);
  if (ids.length === 0) return { providerId: null, reason: 'none' };

  if (!opts.forceHealthPick && opts.explicitProviderId && ids.includes(opts.explicitProviderId)) {
    return { providerId: opts.explicitProviderId, reason: 'explicit' };
  }

  if (opts.domain) {
    try {
      const { resolveRuleProviderId } = await import('./site-rules.js');
      const ruleProvider = await resolveRuleProviderId(opts.domain);
      if (ruleProvider && ids.includes(ruleProvider)) {
        return { providerId: ruleProvider, reason: 'rule' };
      }
    } catch {
      /* optional */
    }
  }

  const best = await getBestHealthyProvider(ids, 30);
  if (best) return { providerId: best, reason: 'health' };

  if (opts.preferProviderId && ids.includes(opts.preferProviderId)) {
    return { providerId: opts.preferProviderId, reason: 'prefer' };
  }

  return { providerId: ids[0] || null, reason: ids[0] ? 'prefer' : 'none' };
}

/** Ordered failover list: health rank, excluding already-tried. */
export async function getProviderFailoverOrder(
  providerIds: string[],
  exclude: string[] = []
): Promise<string[]> {
  const ex = new Set(exclude);
  const ranked = await rankProvidersByHealth(providerIds.filter((id) => !ex.has(id)));
  return ranked.map((r) => r.providerId);
}

export async function getProviderHealth(providerId: string): Promise<ProviderHealth> {
  const map = await loadProviderHealthMap();
  return map[providerId] || emptyHealth(providerId);
}
