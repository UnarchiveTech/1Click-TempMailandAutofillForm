import { browser } from 'wxt/browser';
import { CONSTANTS } from '@/utils/constants.js';
import { logDebug, logError } from '@/utils/logger.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import { beforeStorageWrite } from '@/utils/storage/storageMonitor.js';

// ── Constants ───────────────────────────────────────────────────────────────

export const FAVICON_CACHE_KEY = 'favicon_success_cache';
export const FAVICON_ERROR_CACHE_KEY = 'favicon_error_cache';
export const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

/** Share concurrent favicon reads/revalidations across visible components. */
const faviconRequestRegistry = new Map<string, Promise<unknown>>();

// ── Warm in-memory mirror of the success cache ───────────────────────────
//
// `getCachedFaviconUrl` is async (a storage.local round-trip), which forces
// FaviconImage to paint its letter avatar first and swap to the favicon one
// frame+ later - the visible avatar→favicon flash on every mailbox open. This
// mirror is hydrated once per context (storage read at module init, lazily on
// first sync lookup) and kept coherent by every write path below plus a
// storage.onChanged listener, so subsequent components resolve cached icons
// SYNCHRONOUSLY at first paint.
let faviconMemoryMirror: Map<string, FaviconCacheEntry> | null = null;
let faviconMemoryMirrorReady: Promise<void> | null = null;

async function _hydrateFaviconMemoryMirror(): Promise<void> {
  try {
    const raw = await getFaviconCache();
    // Mirror is an EXACT copy of the stored success cache, including
    // stale-while-revalidate entries - consumers (isFaviconCacheStale, the
    // component's revalidate path) own the 24h freshness decision. Dropping
    // aged entries here would make stale icons vanish instead of showing
    // while they revalidate.
    faviconMemoryMirror = new Map(Object.entries(raw));
  } catch (e) {
    logError('favicon: failed to hydrate memory mirror', e);
  }
}

/** Hydrate the mirror once; later calls return the same promise. */
function ensureFaviconMemoryMirror(): Promise<void> {
  faviconMemoryMirrorReady ??= _hydrateFaviconMemoryMirror();
  return faviconMemoryMirrorReady;
}

/**
 * Synchronous mirror lookup - non-blocking, no storage round-trip.
 * Returns `undefined` while the mirror is still hydrating; callers should
 * fall through to the async path in that case (first call after context
 * start only).
 */
export function peekCachedFaviconEntrySync(domain: string): FaviconCacheEntry | undefined {
  return faviconMemoryMirror?.get(domain);
}

/** Await mirror hydration (used by tests and by callers that must be warm). */
export async function warmFaviconMemoryMirror(): Promise<void> {
  await ensureFaviconMemoryMirror();
}

/**
 * Test-only: drop the memoized mirror so the next lookup re-reads storage.
 * Production code never needs this - cross-context writes flow through
 * storage.onChanged and same-context writes through updateMemoryMirror.
 */
export function __resetFaviconMemoryMirrorForTests(): void {
  faviconMemoryMirror = null;
  faviconMemoryMirrorReady = null;
}

/** Keep the mirror coherent with any successful storage write. */
function updateMemoryMirror(domain: string, entry: FaviconCacheEntry | null): void {
  if (entry) faviconMemoryMirror?.set(domain, entry);
  else faviconMemoryMirror?.delete(domain);
}

// Cross-context coherence: another extension page or the background worker can
// mutate the favicon success cache concurrently. storage.onChanged re-hydrates
// the mirror so its sync view never drifts. (Mirrors in the same context that
// produced the write are already updated synchronously by updateMemoryMirror.)
try {
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (!(FAVICON_CACHE_KEY in changes)) return;
    const next = changes[FAVICON_CACHE_KEY]?.newValue as
      | Record<string, FaviconCacheEntry>
      | undefined;
    const mirror = faviconMemoryMirror;
    if (!mirror) return; // not hydrated yet - first lookup will read fresh
    mirror.clear();
    if (next) {
      for (const [k, v] of Object.entries(next)) mirror.set(k, v);
    }
  });
} catch {
  /* ignore - storage.onChanged unavailable in some test/DOM contexts */
}

// Warm the mirror eagerly at context start (fire-and-forget): by the time the
// mailbox renders, cached favicons resolve synchronously with zero awaits.
void ensureFaviconMemoryMirror();

function dedupeFaviconRequest<T>(key: string, request: () => Promise<T>): Promise<T> {
  const existing = faviconRequestRegistry.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const pending = request().finally(() => faviconRequestRegistry.delete(key));
  faviconRequestRegistry.set(key, pending);
  return pending;
}

// Google's default favicon hash (SHA-256 of default placeholder)
export const GOOGLE_DEFAULT_HASH =
  '59bfe9bc385ad69f50793ce4a53397316d7a875a7148a63c16df9b674c6cda64';

// ── Types ─────────────────────────────────────────────────────────────────

export interface FaviconCacheEntry {
  timestamp: number;
  url?: string;
  webpDataUrl?: string;
  originalUrl?: string;
}

export interface FaviconErrorEntry {
  timestamp: number;
}

// ── Domain Parsing ──────────────────────────────────────────────────────────

/** Extract domain from an email address */
export function getDomainFromEmail(email: string): string {
  const match = email.match(/@([^@\s<>]+)/);
  return match ? match[1].toLowerCase() : '';
}

/** Strip dash and preceding word from domain (email-staples.co.uk → staples.co.uk) */
export function getStrippedDomain(domain: string): string {
  const dashIndex = domain.indexOf('-');
  if (dashIndex === -1) return domain;
  return domain.substring(dashIndex + 1);
}

// ── URL Builders ──────────────────────────────────────────────────────────

/** URL to pass only to fetchFaviconViaBackground, whose handler enforces SSRF checks. */
export function getFaviconRequestUrl(domain: string): string {
  if (!domain) return '';
  // Strip any protocol prefix that may already be present
  const cleanDomain = domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return `https://${cleanDomain}/favicon.ico`;
}

/** Google favicon API URL. Domain is encoded as one query value. */
export function getGoogleFaviconUrl(domain: string, size: number = 32): string {
  const url = new URL(CONSTANTS.GOOGLE_FAVICON_API_URL);
  // s2/favicons redirects to this image service. Use its direct endpoint so
  // the background's fail-closed redirect policy remains effective.
  url.searchParams.set('client', 'SOCIAL');
  url.searchParams.set('type', 'FAVICON');
  url.searchParams.set('fallback_opts', 'TYPE,SIZE,URL');
  url.searchParams.set('url', `https://${domain}`);
  url.searchParams.set('size', String(size));
  return url.toString();
}

// ── Background Fetch ────────────────────────────────────────────────────────

/** Fetch favicon via background script (bypasses CORS) */
export async function fetchFaviconViaBackground(
  url: string
): Promise<{ dataUrl: string; hash: string } | null> {
  return dedupeFaviconRequest(`fetch:${url}`, async () => {
    try {
      const response = (await browser.runtime.sendMessage({ type: 'fetchFavicon', url })) as {
        success: boolean;
        base64?: string;
        contentType?: string;
        hash?: string;
        error?: string;
      };
      logDebug('fetchFaviconViaBackground response', response);
      if (!response.success || !response.base64 || !response.hash) {
        logDebug('fetchFaviconViaBackground failed', response);
        return null;
      }
      const dataUrl = `data:${response.contentType};base64,${response.base64}`;
      logDebug('fetchFaviconViaBackground success', {
        dataUrl: `${dataUrl.substring(0, 50)}...`,
        hash: response.hash,
      });
      return { dataUrl, hash: response.hash };
    } catch (e) {
      logError('fetchFaviconViaBackground error', e);
      return null;
    }
  });
}

// ── WebP Conversion ─────────────────────────────────────────────────────────

/** Convert an image data URL to WebP using Canvas (defaults 32×32, 80% quality) */
export async function convertToWebP(
  dataUrl: string,
  size: number = 32,
  quality: number = 0.8
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        resolve(canvas.toDataURL('image/webp', quality));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

// ── Shared Storage Setup ────────────────────────────────────────────────────

export async function initFaviconStorage(): Promise<void> {
  // No longer needed, as we only use browser.storage.local directly
}

// ── Cache Management ──────────────────────────────────────────────────────

/** Enforce max cache entry count via LRU eviction. */
function _evictIfNeeded(
  cache: Record<string, FaviconCacheEntry>
): Record<string, FaviconCacheEntry> {
  const entries = Object.entries(cache);
  if (entries.length <= CONSTANTS.MAX_FAVICON_CACHE_SIZE) return cache;
  const evictCount = Math.ceil(entries.length * CONSTANTS.FAVICON_CACHE_EVICT_RATIO);
  const sorted = entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
  const toRemove = sorted.slice(0, evictCount);
  for (const [k] of toRemove) delete cache[k];
  logDebug(`favicon: evicted ${evictCount} old cache entries`);
  return cache;
}

/**
 * Persist cache data to browser.storage.local
 */
async function storeCache<T>(key: string, data: T): Promise<void> {
  try {
    const estimatedSize = JSON.stringify(data).length;
    const { canWrite, shouldPromptPermission } = await beforeStorageWrite(estimatedSize);

    if (!canWrite) {
      if (shouldPromptPermission) {
        logDebug('favicon: storage near/at limit - permission prompt needed');
      }
      logDebug('favicon: skipping browser.storage.local write - storage full');
      return;
    }

    await writeWithRetry({ [key]: data });
  } catch (e) {
    logError('favicon: failed to write to browser.storage.local', e);
  }
}

function cleanExpiredEntries<T extends { timestamp: number }>(
  cache: Record<string, T>
): Record<string, T> {
  const now = Date.now();
  const cleaned: Record<string, T> = {};
  for (const [k, v] of Object.entries(cache)) {
    if (now - v.timestamp <= CACHE_DURATION) cleaned[k] = v;
  }
  return cleaned;
}

export async function getFaviconCache(): Promise<Record<string, FaviconCacheEntry>> {
  const data = await browser.storage.local.get(FAVICON_CACHE_KEY);
  return (data[FAVICON_CACHE_KEY] as Record<string, FaviconCacheEntry>) || {};
}

export async function getFaviconErrorCache(): Promise<Record<string, FaviconErrorEntry>> {
  const data = await browser.storage.local.get(FAVICON_ERROR_CACHE_KEY);
  return (data[FAVICON_ERROR_CACHE_KEY] as Record<string, FaviconErrorEntry>) || {};
}

export async function setFaviconCacheSuccess(
  domain: string,
  url: string,
  originalUrl?: string
): Promise<void> {
  let cache = await getFaviconCache();
  cache = cleanExpiredEntries(cache);

  const settings = (await browser.storage.local.get(['faviconCaching'])) as {
    faviconCaching?: 'direct' | 'local';
  };
  const shouldCacheLocally = settings.faviconCaching === 'local';

  let webpDataUrl: string | undefined;
  if (shouldCacheLocally && url) {
    try {
      webpDataUrl = await convertToWebP(url);
    } catch (e) {
      logError('Failed to convert favicon to WebP', e);
    }
  }

  cache[domain] = { timestamp: Date.now(), url, webpDataUrl, originalUrl };
  _evictIfNeeded(cache);
  // Mirror stays coherent with the intended write. Benign divergence is
  // possible only when storeCache skips persisting (quota) or LRU evicts
  // other entries - both display-only and self-healing on the next full read.
  updateMemoryMirror(domain, cache[domain]);
  await storeCache(FAVICON_CACHE_KEY, cache);

  // Remove from error cache if present
  const errorCache = await getFaviconErrorCache();
  if (errorCache[domain]) {
    delete errorCache[domain];
    await storeCache(FAVICON_ERROR_CACHE_KEY, errorCache);
  }
}

export async function setFaviconCacheError(domain: string): Promise<void> {
  const errorCache = await getFaviconErrorCache();
  errorCache[domain] = { timestamp: Date.now() };
  await storeCache(FAVICON_ERROR_CACHE_KEY, errorCache);
}

/**
 * Return cached favicon URL if present.
 * Stale entries (older than CACHE_DURATION) are still returned - caller may
 * revalidate in the background. We never drop a good icon just because it aged.
 */
export function resolveFaviconEntryUrl(entry: FaviconCacheEntry | undefined): string | null {
  if (!entry) return null;
  const url = entry.webpDataUrl || entry.url || null;
  // Older versions stored remote URLs here; never hand them back to a view as
  // an image source. Remote fetches must pass through fetchFaviconViaBackground.
  return url?.startsWith('data:image/') ? url : null;
}

export async function getCachedFaviconUrl(domain: string): Promise<string | null> {
  // Synchronous fast path: once the mirror is hydrated (first context after
  // init), a warm entry resolves without any await - FaviconImage can mount
  // the cached <img> at first paint instead of after a storage round-trip.
  const warm = peekCachedFaviconEntrySync(domain);
  if (warm) return resolveFaviconEntryUrl(warm);
  return dedupeFaviconRequest(`cache:${domain}`, async () => {
    // Hydrating the mirror here makes every cold read also warm it, so the
    // NEXT lookup for any domain resolves synchronously.
    await ensureFaviconMemoryMirror();
    return resolveFaviconEntryUrl(peekCachedFaviconEntrySync(domain));
  });
}

/** True when cache entry is missing or older than CACHE_DURATION (needs revalidate). */
export async function isFaviconCacheStale(domain: string): Promise<boolean> {
  return dedupeFaviconRequest(`stale:${domain}`, async () => {
    await ensureFaviconMemoryMirror();
    const entry = peekCachedFaviconEntrySync(domain);
    if (!entry) return true; // missing (or expired-filtered) → stale
    return Date.now() - entry.timestamp > CACHE_DURATION;
  });
}

export async function hasRecentFaviconError(domain: string): Promise<boolean> {
  return dedupeFaviconRequest(`error:${domain}`, async () => {
    const raw = await getFaviconErrorCache();
    const cleaned = cleanExpiredEntries(raw);
    // Only prune error entries - success cache is kept (stale-while-revalidate)
    if (Object.keys(cleaned).length !== Object.keys(raw).length) {
      await storeCache(FAVICON_ERROR_CACHE_KEY, cleaned);
    }
    return domain in cleaned;
  });
}

/**
 * Only clear a domain from success cache when explicitly requested
 * (e.g. user wipe). Failed revalidations must NOT call this.
 */
export async function clearFaviconCache(domain: string): Promise<void> {
  const cache = await getFaviconCache();
  if (!(domain in cache)) return;
  delete cache[domain];
  updateMemoryMirror(domain, null);
  await storeCache(FAVICON_CACHE_KEY, cache);
}

/**
 * Clear all favicon cache from browser.storage.local.
 */
export async function clearAllFaviconCache(): Promise<void> {
  try {
    faviconMemoryMirror?.clear();
    await browser.storage.local.remove([FAVICON_CACHE_KEY, FAVICON_ERROR_CACHE_KEY]);
  } catch (e) {
    logError('favicon: failed to remove cache from browser.storage.local', e);
  }
}

/** Get cache stats for the settings UI */
export async function getFaviconCacheStats(): Promise<{ count: number; sizeBytes: number }> {
  try {
    const cache = await getFaviconCache();
    const str = JSON.stringify(cache);
    return { count: Object.keys(cache).length, sizeBytes: str.length };
  } catch {
    /* ignore */
    return { count: 0, sizeBytes: 0 };
  }
}
