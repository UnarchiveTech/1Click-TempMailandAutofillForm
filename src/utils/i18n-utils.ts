/**
 * Translation utilities for non-Svelte contexts (background, content scripts, utilities).
 * Locales are statically imported so content-script bundles always include them.
 *
 * IMPORTANT: Language is stored as both `preferredLanguage` (legacy UI key) and
 * `locale` (canonical). Always resolve via resolveStoredLocale().
 */

import { browser } from 'wxt/browser';
import ar from '../locales/ar.json';
import de from '../locales/de.json';
import en from '../locales/en.json';
import es from '../locales/es.json';
import fr from '../locales/fr.json';
import ja from '../locales/ja.json';
import th from '../locales/th.json';
import zh from '../locales/zh.json';
import { logError } from './logger.js';

type LocaleTree = Record<string, unknown>;

/** Supported language codes shipped in the extension. */
export const SUPPORTED_LOCALES = ['en', 'es', 'fr', 'de', 'ja', 'zh', 'ar', 'th'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Normalize Vite/JSON module shapes (`default` wrapper or plain object). */
function asTree(mod: unknown): LocaleTree {
  if (!mod || typeof mod !== 'object') return {};
  const m = mod as { default?: LocaleTree };
  if (m.default && typeof m.default === 'object') return m.default;
  return mod as LocaleTree;
}

const LOCALE_TABLE: Record<string, LocaleTree> = {
  en: asTree(en),
  ar: asTree(ar),
  de: asTree(de),
  es: asTree(es),
  fr: asTree(fr),
  ja: asTree(ja),
  zh: asTree(zh),
  th: asTree(th),
};

// Cache for loaded translations (copy of static tables + any future dynamic)
const translationCache = new Map<string, LocaleTree>();

/** Last known locale for tSync when locale arg is omitted. */
let cachedLocale = 'en';

/** Map any browser/storage locale string to a supported 2-letter code. */
export function mapToSupportedLocale(raw: string | null | undefined): string {
  const code = String(raw || '')
    .trim()
    .split(/[-_]/)[0]
    .toLowerCase();
  if (code && code in LOCALE_TABLE) return code;
  return 'en';
}

/**
 * Resolve the user's language from storage (or a storage snapshot).
 * Accepts both canonical `locale` and legacy `preferredLanguage`.
 */
export function resolveStoredLocale(snap?: {
  locale?: string;
  preferredLanguage?: string;
}): string {
  const raw = snap?.preferredLanguage || snap?.locale || '';
  if (raw) return mapToSupportedLocale(raw);
  return '';
}

/**
 * Get the current locale from storage (extension preference).
 * Priority: preferredLanguage → locale → page/navigator language → en
 */
export async function getCurrentLocale(): Promise<string> {
  try {
    const result = (await browser.storage.local.get(['locale', 'preferredLanguage'])) as {
      locale?: string;
      preferredLanguage?: string;
    };
    const stored = resolveStoredLocale(result);
    if (stored) return stored;

    // Page / browser language when user never set a preference
    if (typeof document !== 'undefined') {
      const docLang = document.documentElement?.lang || '';
      const navLang = typeof navigator !== 'undefined' ? navigator.language : '';
      const fromPage = mapToSupportedLocale(docLang || navLang);
      if (fromPage && (docLang || navLang)) {
        // Only use page/nav if it maps to a real non-default preference signal
        if (mapToSupportedLocale(docLang || navLang) !== 'en' || docLang || navLang) {
          return mapToSupportedLocale(docLang || navLang);
        }
      }
    } else if (typeof navigator !== 'undefined' && navigator.language) {
      return mapToSupportedLocale(navigator.language);
    }
    return 'en';
  } catch {
    return 'en';
  }
}

/**
 * Persist language preference under both storage keys used in the codebase.
 */
export async function persistLocale(langCode: string): Promise<string> {
  const code = mapToSupportedLocale(langCode);
  cachedLocale = code;
  try {
    await browser.storage.local.set({ locale: code, preferredLanguage: code });
  } catch (e) {
    logError('Failed to persist locale', e);
  }
  return code;
}

/**
 * Load translations for a specific locale
 */
async function loadTranslations(locale: string): Promise<LocaleTree> {
  const code = mapToSupportedLocale(locale);
  if (translationCache.has(code)) {
    return translationCache.get(code) ?? {};
  }

  const tree = LOCALE_TABLE[code] || LOCALE_TABLE.en;
  if (!tree) {
    logError(`No locale pack for ${code}`, undefined);
    return {};
  }
  translationCache.set(code, tree);
  // Always keep English cached as fallback
  if (code !== 'en' && !translationCache.has('en')) {
    translationCache.set('en', LOCALE_TABLE.en);
  }
  return tree;
}

/**
 * Substitute {var} placeholders in a string with values from a record.
 */
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  );
}

function lookupInTree(translations: LocaleTree, key: string): string | undefined {
  const keys = key.split('.');
  let value: unknown = translations;
  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = (value as LocaleTree)[k];
    } else {
      return undefined;
    }
  }
  return typeof value === 'string' ? value : undefined;
}

/**
 * Get a translated string by key path (e.g., "errors.apiCallFailed")
 * Supports nested keys with dot notation and {var} interpolation.
 */
export async function t(
  key: string,
  vars?: Record<string, string | number>,
  locale?: string
): Promise<string> {
  const targetLocale = mapToSupportedLocale(locale || (await getCurrentLocale()));
  cachedLocale = targetLocale;
  const translations = await loadTranslations(targetLocale);

  let found = lookupInTree(translations, key);
  if (found === undefined && targetLocale !== 'en') {
    found = lookupInTree(await loadTranslations('en'), key);
  }
  if (found !== undefined) return interpolate(found, vars);
  return key;
}

/** Hardcoded English fallbacks so UI never flashes raw keys like `time.hoursAgo`. */
const EN_SYNC_FALLBACKS: Record<string, string> = {
  'time.justNow': 'Just now',
  'time.secondsAgo': '{n}s ago',
  'time.minutesAgo': '{n}m ago',
  'time.hoursAgo': '{n}h ago',
  'time.daysAgo': '{n}d ago',
  'time.daysAgoLong': '{n} days ago',
  'time.today': 'Today',
  'time.yesterday': 'Yesterday',
  'time.never': 'Never',
  'time.expired': 'Expired',
};

/**
 * Get a translated string synchronously (uses cached translations).
 */
export function tSync(
  key: string,
  vars?: Record<string, string | number>,
  locale?: string
): string {
  const targetLocale = mapToSupportedLocale(locale || cachedLocale || 'en');
  const translations =
    translationCache.get(targetLocale) ||
    (targetLocale !== 'en' ? translationCache.get('en') : undefined);

  if (translations) {
    const found = lookupInTree(translations, key);
    if (found !== undefined) return interpolate(found, vars);
  }

  // Static English pack as last resort (always available)
  const enFound = lookupInTree(LOCALE_TABLE.en, key);
  if (enFound !== undefined) return interpolate(enFound, vars);

  const fallback = EN_SYNC_FALLBACKS[key];
  if (fallback) return interpolate(fallback, vars);

  return key;
}

/**
 * Remember the active locale for synchronous helpers.
 */
export function setCachedLocale(locale: string): void {
  cachedLocale = mapToSupportedLocale(locale);
}

/**
 * Preload translations for a locale (call this on startup)
 */
export async function preloadTranslations(locale: string): Promise<void> {
  const code = mapToSupportedLocale(locale);
  cachedLocale = code;
  if (code !== 'en') {
    await loadTranslations('en');
  }
  await loadTranslations(code);
}

/**
 * Clear translation cache (useful for locale changes)
 */
export function clearTranslationCache(): void {
  translationCache.clear();
}

// Keep content/background UIs in sync when user changes language
try {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!changes.locale && !changes.preferredLanguage) return;
    const nextRaw =
      (changes.preferredLanguage?.newValue as string | undefined) ||
      (changes.locale?.newValue as string | undefined) ||
      'en';
    const next = mapToSupportedLocale(nextRaw);
    clearTranslationCache();
    setCachedLocale(next);
    void preloadTranslations(next);
  });
} catch {
  /* storage may be unavailable in some test contexts */
}
