import { browser } from 'wxt/browser';
import {
  FAVICON_CACHE_EVICT_RATIO,
  GOOGLE_FAVICON_API_URL,
  MAX_FAVICON_CACHE_SIZE,
} from '@/utils/constants.js';
import { logDebug, logError } from '@/utils/logger.js';
import { beforeStorageWrite } from '@/utils/storageMonitor.js';

// ── Constants ───────────────────────────────────────────────────────────────

export const FAVICON_CACHE_KEY = 'favicon_success_cache';
export const FAVICON_ERROR_CACHE_KEY = 'favicon_error_cache';
export const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

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
  const match = email.match(/@([^@]+)$/);
  return match ? match[1] : '';
}

/** Get root domain, handling multi-level TLDs like .co.uk */
export function getRootDomain(domain: string): string {
  const parts = domain.split('.');
  const multiLevelTLDs = [
    'co.uk',
    'com.au',
    'co.nz',
    'co.za',
    'ac.uk',
    'gov.uk',
    'org.uk',
    'net.uk',
    'nhs.uk',
    'police.uk',
    'mod.uk',
    'sch.uk',
    'com.br',
    'co.jp',
    'com.cn',
    'co.in',
    'com.in',
    'com.sg',
    'com.hk',
    'com.tw',
    'com.mx',
    'com.tr',
    'com.pe',
    'com.pk',
  ];
  const tld = parts.slice(-2).join('.');

  if (multiLevelTLDs.includes(tld)) {
    if (parts.length > 3) return parts.slice(-3).join('.');
    if (parts.length === 3) {
      const firstPart = parts[0];
      const commonSubdomains = [
        'www',
        'mail',
        'email',
        'web',
        'm',
        'mobile',
        'app',
        'api',
        'blog',
        'shop',
        'store',
      ];
      if (commonSubdomains.includes(firstPart)) {
        return parts.slice(-2).join('.');
      }
      return domain;
    }
  }

  return parts.length > 2 ? parts.slice(-2).join('.') : domain;
}

/** Strip dash and preceding word from domain (email-staples.co.uk → staples.co.uk) */
export function getStrippedDomain(domain: string): string {
  const dashIndex = domain.indexOf('-');
  if (dashIndex === -1) return domain;
  return domain.substring(dashIndex + 1);
}

// ── URL Builders ──────────────────────────────────────────────────────────

/** Direct /favicon.ico URL from an email sender */
export function getDomainFaviconUrl(sender: string): string {
  const domain = sender.split('@')[1] || sender;
  return `https://${domain}/favicon.ico`;
}

/** Root-domain /favicon.ico URL from an email sender */
export function getRootDomainFaviconUrl(sender: string): string {
  const domain = sender.split('@')[1] || sender;
  const root = getRootDomain(domain);
  return `https://${root}/favicon.ico`;
}

/** Generic favicon.ico URL for a domain */
export function getFaviconUrl(domain: string): string {
  if (!domain) return '';
  return `https://${domain}/favicon.ico`;
}

/** Google favicon API URL */
export function getGoogleFaviconUrl(domain: string, size: number = 32): string {
  return `${GOOGLE_FAVICON_API_URL}?sz=${size}&domain=${domain}`;
}

// ── Background Fetch ────────────────────────────────────────────────────────

/** Fetch favicon via background script (bypasses CORS) */
export async function fetchFaviconViaBackground(
  url: string
): Promise<{ dataUrl: string; hash: string } | null> {
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
  if (entries.length <= MAX_FAVICON_CACHE_SIZE) return cache;
  const evictCount = Math.ceil(entries.length * FAVICON_CACHE_EVICT_RATIO);
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

    await browser.storage.local.set({ [key]: data });
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
export async function getCachedFaviconUrl(domain: string): Promise<string | null> {
  const raw = await getFaviconCache();
  const entry = raw[domain];
  return entry ? entry.webpDataUrl || entry.url || null : null;
}

/** True when cache entry is missing or older than CACHE_DURATION (needs revalidate). */
export async function isFaviconCacheStale(domain: string): Promise<boolean> {
  const raw = await getFaviconCache();
  const entry = raw[domain];
  if (!entry) return true;
  return Date.now() - entry.timestamp > CACHE_DURATION;
}

export async function hasRecentFaviconError(domain: string): Promise<boolean> {
  const raw = await getFaviconErrorCache();
  const cleaned = cleanExpiredEntries(raw);
  // Only prune error entries - success cache is kept (stale-while-revalidate)
  if (Object.keys(cleaned).length !== Object.keys(raw).length) {
    await storeCache(FAVICON_ERROR_CACHE_KEY, cleaned);
  }
  return domain in cleaned;
}

/**
 * Only clear a domain from success cache when explicitly requested
 * (e.g. user wipe). Failed revalidations must NOT call this.
 */
export async function clearFaviconCache(domain: string): Promise<void> {
  const cache = await getFaviconCache();
  if (!(domain in cache)) return;
  delete cache[domain];
  await storeCache(FAVICON_CACHE_KEY, cache);
}

/**
 * Clear all favicon cache from browser.storage.local.
 */
export async function clearAllFaviconCache(): Promise<void> {
  try {
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
    return { count: 0, sizeBytes: 0 };
  }
}
