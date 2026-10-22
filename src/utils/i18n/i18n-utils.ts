/**
 * Translation utilities for non-Svelte contexts (UI-side actions, utilities).
 *
 * This is the FULL-dictionary module: it loads the complete UI dictionaries
 * (all 2,491 keys per language). It must NOT be imported from the background
 * service worker or content scripts - the MV3 worker is bundled as a single
 * self-contained file, so any dictionary it imports is inlined into
 * background.js (all 8 locales: 1,355,253 bytes).
 *
 *   - Background code imports `@/utils/i18n/i18n-background.js` (minimal sets).
 *   - Content scripts import `@/utils/i18n/content-i18n.js` (background-delegated).
 *   - Everything else (UI actions, utilities) imports this module.
 *
 * The shared engine lives in `@/utils/i18n/i18n-shared.js`; scripts/
 * generate-background-locales.ts verifies the background/content graphs never
 * import this module.
 *
 * Locale strategy: English (`en.json`) is statically imported as the universal
 * fallback so tSync() always works - even if dynamic imports fail at runtime.
 * The other 7 locales are dynamically imported and code-split, so only the
 * active locale + English are loaded at startup (~155 KB vs ~640 KB if all
 * 8 were statically imported).
 *
 * IMPORTANT: Language is stored as both `preferredLanguage` (LanguageSwitcher legacy) and
 * `locale` (canonical). Always resolve via resolveStoredLocale().
 */

import { get } from 'svelte/store';
import { t as tStore } from 'svelte-i18n';
import en from '../../locales/en.json';
import { createI18nModule } from './i18n-shared.js';

/**
 * Translation function used by UI-side dependency contracts. Takes FLAT
 * interpolation vars (`{ n: 5 }`) and wraps them into svelte-i18n's
 * `{ values }` options - locale-fresh at call time.
 */
export type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

/** Build a shared translator over the live svelte-i18n store. */
export function createTranslator(): TranslateFn {
  return (key, vars) => get(tStore)(key, vars ? { values: vars } : undefined) as string;
}

export const {
  SUPPORTED_LOCALES,
  mapToSupportedLocale,
  resolveStoredLocale,
  getStoredLocaleAsync,
  persistLocale,
  t,
  tSync,
  setCachedLocale,
  getCachedLocale,
  preloadTranslations,
  clearTranslationCache,
} = createI18nModule({
  codes: ['en', 'es', 'fr', 'de', 'ja', 'zh', 'ar', 'th'] as const,
  en: en as Record<string, unknown>,
  loaders: {
    es: () => import('../../locales/es.json'),
    fr: () => import('../../locales/fr.json'),
    de: () => import('../../locales/de.json'),
    ja: () => import('../../locales/ja.json'),
    zh: () => import('../../locales/zh.json'),
    ar: () => import('../../locales/ar.json'),
    th: () => import('../../locales/th.json'),
  },
});

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
