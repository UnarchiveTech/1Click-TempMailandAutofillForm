import { browser } from 'wxt/browser';
import { GOOGLE_FAVICON_API_URL } from '@/utils/constants.js';
import { logDebug, logError } from '@/utils/logger.js';

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
      if (commonSubdomains.includes(firstPart) || firstPart.includes('-')) {
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

// ── Cache Management ──────────────────────────────────────────────────────

function parseCache<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function storeCache<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {}
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

export function getFaviconCache(): Record<string, FaviconCacheEntry> {
  return (
    parseCache<Record<string, FaviconCacheEntry>>(localStorage.getItem(FAVICON_CACHE_KEY)) ?? {}
  );
}

export function getFaviconErrorCache(): Record<string, FaviconErrorEntry> {
  return (
    parseCache<Record<string, FaviconErrorEntry>>(localStorage.getItem(FAVICON_ERROR_CACHE_KEY)) ??
    {}
  );
}

export async function setFaviconCacheSuccess(
  domain: string,
  url: string,
  originalUrl?: string
): Promise<void> {
  let cache = getFaviconCache();
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
  storeCache(FAVICON_CACHE_KEY, cache);

  // Remove from error cache if present
  const errorCache = getFaviconErrorCache();
  if (errorCache[domain]) {
    delete errorCache[domain];
    storeCache(FAVICON_ERROR_CACHE_KEY, errorCache);
  }
}

export function setFaviconCacheError(domain: string): void {
  const errorCache = getFaviconErrorCache();
  errorCache[domain] = { timestamp: Date.now() };
  storeCache(FAVICON_ERROR_CACHE_KEY, errorCache);
}

export function getCachedFaviconUrl(domain: string): string | null {
  let cache = getFaviconCache();
  cache = cleanExpiredEntries(cache);
  const entry = cache[domain];
  if (!entry) {
    // Persist cleaned cache if anything expired
    if (Object.keys(cache).length !== Object.keys(getFaviconCache()).length) {
      storeCache(FAVICON_CACHE_KEY, cache);
    }
    return null;
  }
  return entry.webpDataUrl || entry.url || null;
}

export function hasRecentFaviconError(domain: string): boolean {
  let cache = getFaviconErrorCache();
  cache = cleanExpiredEntries(cache);
  const entry = cache[domain];
  if (!entry) {
    if (Object.keys(cache).length !== Object.keys(getFaviconErrorCache()).length) {
      storeCache(FAVICON_ERROR_CACHE_KEY, cache);
    }
    return false;
  }
  return true;
}

export function clearFaviconCache(domain: string): void {
  const cache = getFaviconCache();
  if (!(domain in cache)) return;
  delete cache[domain];
  storeCache(FAVICON_CACHE_KEY, cache);
}

/** Get cache stats for the settings UI */
export function getFaviconCacheStats(): { count: number; sizeBytes: number } {
  try {
    const raw = localStorage.getItem(FAVICON_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { count: Object.keys(parsed).length, sizeBytes: raw.length };
    }
  } catch {}
  return { count: 0, sizeBytes: 0 };
}
