/**
 * Lightweight translation utilities for content scripts.
 *
 * This module replaces `@/utils/i18n/i18n-utils` in content-script code paths.
 * The full `i18n-utils.ts` statically imports `en.json` (139,001 bytes), which
 * would bloat every content-script bundle. Instead, this module:
 *
 * - `t(key)` / `t(key, vars)` - delegates to the background `translate` handler
 *   via `runtime.sendMessage({ type: 'translate', key, vars })`. The background
 *   process already has translations loaded and returns the translated string.
 *   Results are cached in a Map with a 5-minute TTL to avoid repeated messaging.
 *
 * - `tSync(key)` - returns a minimal hardcoded English fallback for the handful
 *   of keys that content scripts need synchronously (e.g. real-time progress
 *   labels during autofill). Falls back to the raw key if no fallback exists.
 *
 * This eliminates the 139,001-byte `en.json` import from the content-script bundle.
 */

import { browser } from 'wxt/browser';
import { logError } from '../logger.js';

/** Cache entry for async translations. */
interface CacheEntry {
  value: string;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60_000; // 5 minutes
const translationCache = new Map<string, CacheEntry>();

/**
 * Hardcoded English fallbacks for keys that must be available synchronously
 * (used by real-time progress indicators during form autofill, where awaiting
 * a message round-trip would cause visible UI stutter).
 *
 * Only the keys actually referenced via `tSync()` in content scripts are listed.
 */
const SYNC_FALLBACKS: Record<string, string> = {
  'common.done': 'Done',
  'contentAutofill.autofilling': 'Autofilling…',
  'time.durationS': '{s}s',
  'time.milliseconds': '{n} ms',
};

/** Purge expired entries from the cache. */
function purgeCache(): void {
  const now = Date.now();
  for (const [key, entry] of translationCache) {
    if (entry.expiresAt <= now) {
      translationCache.delete(key);
    }
  }
}

/**
 * ICU structured-message syntax - `{arg, plural, one {…} other {…}}` and its
 * `select` sibling - that this module's flat `{name}` interpolator cannot
 * process. A value carrying it must never be rendered here: the arm bodies
 * and selectors would reach the HOST PAGE verbatim (the regex below only
 * substitutes plain `{name}` slots, so every other brace survives). Rendered
 * formatter output never matches - prose plus numbers contains no
 * `{word, plural,` opener - so the guard is precise.
 *
 * Structured messages belong to the svelte-i18n engine (background side),
 * which resolves them through the locale's own Intl.PluralRules - see
 * `docs/icu-plurals-evaluation.md`. Exported for tests.
 */
export function hasIcuStructuredSyntax(value: string): boolean {
  return /\{\s*\w+\s*,\s*(?:plural|select)\s*,/.test(value);
}

/**
 * Substitute the fallback template's flat `{name}` slots.
 *
 * Refuses templates carrying ICU structured syntax (see
 * `hasIcuStructuredSyntax`): it logs an error naming the key and returns the
 * raw key instead of the template, so raw braces can never reach a host page
 * through the sync-fallback path - loud, but not a crash in a progress UI.
 */
function interpolate(
  template: string,
  vars?: Record<string, string | number>,
  key?: string
): string {
  if (hasIcuStructuredSyntax(template)) {
    logError(
      'ICU structured syntax cannot be rendered by content-i18n; refusing to output raw braces',
      { key: key ?? '(unknown)', preview: template.slice(0, 100) }
    );
    return key ?? '';
  }
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  );
}

/**
 * Get a translated string asynchronously by sending a message to the background
 * `translate` handler. The background process has the full locale data loaded.
 *
 * Results are cached per (key, vars) combination for CACHE_TTL_MS.
 */
export async function t(key: string, vars?: Record<string, string | number>): Promise<string> {
  const cacheKey = vars ? `${key}:${JSON.stringify(vars)}` : key;
  purgeCache();
  const cached = translationCache.get(cacheKey);
  if (cached) return cached.value;

  try {
    const response = (await browser.runtime.sendMessage({
      type: 'translate',
      key,
      vars,
    })) as { success?: boolean; translated?: string; error?: string } | undefined;

    const result =
      response?.success && response.translated !== undefined ? response.translated : undefined;

    // Defense in depth: the background renders through the svelte-i18n
    // engine, but the formatter returns the RAW message when a structured
    // value is malformed - if that ever leaks through, the content script
    // would print raw arms to the host page. Refuse (uncached, so a fixed
    // background recovers immediately) and surface the key instead.
    if (result !== undefined && hasIcuStructuredSyntax(result)) {
      logError(
        'Background returned unrendered ICU structured syntax; refusing to render it on the host page',
        { key, preview: result.slice(0, 100) }
      );
      return key;
    }

    const resolved = result ?? key;
    translationCache.set(cacheKey, { value: resolved, expiresAt: Date.now() + CACHE_TTL_MS });
    return resolved;
  } catch (e: unknown) {
    logError('Content script translate request failed', e);
    const fallback = SYNC_FALLBACKS[key] ?? key;
    return interpolate(fallback, vars, key);
  }
}

/**
 * Get a translated string synchronously. Uses hardcoded English fallbacks
 * for the small set of keys that content scripts need in real-time contexts
 * (e.g. progress labels during autofill). Falls back to the raw key.
 */
export function tSync(key: string, vars?: Record<string, string | number>): string {
  const fallback = SYNC_FALLBACKS[key];
  if (fallback) return interpolate(fallback, vars, key);
  return key;
}
