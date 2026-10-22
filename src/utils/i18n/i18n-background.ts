/**
 * Translation utilities for the background service worker.
 *
 * The MV3 worker is bundled as a single self-contained file, so every
 * dictionary it imports - even via dynamic import() - is inlined into
 * background.js. The full UI dictionaries (all 2,491 keys × 8 languages,
 * ≈ 1,323 KiB; 1,355,253 bytes) used to be shipped into the worker, where
 * only a small fraction of the keys are ever rendered.
 *
 * This module loads the MINIMAL per-language sets in `src/locales/background/`
 * - only the keys the background renders plus the keys content scripts
 * request through the background `translate` handler. The sets are generated
 * by `scripts/generate-background-locales.ts` (run `bun run
 * generate-background-locales` after adding translation calls to background
 * or content code; `bun run check-background-locales` guards it in CI).
 *
 * The API is identical to `@/utils/i18n/i18n-utils.ts` (the full-dictionary module
 * for UI-side code) - switch imports, nothing else.
 *
 * Locale strategy: English (`background/en.json`) is statically imported as
 * the universal fallback so tSync() always works. The other 7 locales are
 * dynamically imported and code-split, so only the active locale + English
 * are loaded at startup.
 *
 * IMPORTANT: Language is stored as both `preferredLanguage` (LanguageSwitcher legacy) and
 * `locale` (canonical). Always resolve via resolveStoredLocale().
 */

import en from '../../locales/background/en.json';
import { createI18nModule } from './i18n-shared.js';

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
    es: () => import('../../locales/background/es.json'),
    fr: () => import('../../locales/background/fr.json'),
    de: () => import('../../locales/background/de.json'),
    ja: () => import('../../locales/background/ja.json'),
    zh: () => import('../../locales/background/zh.json'),
    ar: () => import('../../locales/background/ar.json'),
    th: () => import('../../locales/background/th.json'),
  },
});
