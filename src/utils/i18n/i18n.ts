import { get } from 'svelte/store';
import { getLocaleFromNavigator, init, locale, register } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import { persistLocale, preloadTranslations, setCachedLocale } from '@/utils/i18n/i18n-utils.js';

export { getLocaleFromNavigator };

/**
 * Locale loaders - only the initial locale is registered at startup; others
 * are registered on-demand when the user switches language. This prevents
 * Vite from creating modulepreload entries for all 8 locale chunks.
 */
const LOCALE_LOADERS: Record<string, () => Promise<Record<string, unknown>>> = {
  en: () => import('../../locales/en.json'),
  es: () => import('../../locales/es.json'),
  fr: () => import('../../locales/fr.json'),
  de: () => import('../../locales/de.json'),
  ja: () => import('../../locales/ja.json'),
  zh: () => import('../../locales/zh.json'),
  ar: () => import('../../locales/ar.json'),
  th: () => import('../../locales/th.json'),
};

// Track which locales have been registered to avoid duplicate register() calls
const registeredLocales = new Set<string>();

/** Register a locale loader if not already registered. */
function ensureLocaleRegistered(code: string): void {
  if (registeredLocales.has(code)) return;
  const loader = LOCALE_LOADERS[code] || LOCALE_LOADERS.en;
  register(code, loader);
  registeredLocales.add(code);
}

// Map full browser locale codes to our supported language codes
function mapLocale(browserLocale: string): string {
  const supportedLocales = ['en', 'es', 'fr', 'de', 'ja', 'zh', 'ar', 'th'];
  const langCode = browserLocale.split(/[-_]/)[0].toLowerCase();

  // Direct match
  if (supportedLocales.includes(langCode)) {
    return langCode;
  }

  return 'en';
}

export const isRTL = (loc: string): boolean => {
  return ['ar', 'he', 'fa', 'ur'].includes(loc);
};

// Set locale immediately before init to prevent initialization errors.
// Guard: svelte-i18n's getLocaleFromNavigator reads navigator.languages[0],
// which throws in non-DOM / vite-node build contexts (Node ≥21's `navigator`
// shim lacks `languages`). Resolve the browser locale ourselves and
// fall back to 'en' when navigator is unavailable, so module evaluation never
// crashes the build or the background service worker.
function safeNavigatorLocale(): string {
  try {
    if (typeof navigator === 'undefined') return '';
    // navigator.languages can be undefined in non-DOM / Node contexts; the
    // optional chain avoids the "Cannot read properties of undefined" throw
    // that svelte-i18n's getLocaleFromNavigator hits.
    return (navigator.languages?.[0] ?? navigator.language ?? '') || '';
  } catch {
    /* ignore */
    return '';
  }
}

const browserLocale = safeNavigatorLocale() || 'en';
const initialLocale = mapLocale(browserLocale);

// Only register the initial locale at startup - other locales are loaded
// on-demand via loadLocale() when the user switches language.
ensureLocaleRegistered(initialLocale);
locale.set(initialLocale);

if (typeof document !== 'undefined') {
  document.documentElement.dir = isRTL(initialLocale) ? 'rtl' : 'ltr';
  document.documentElement.lang = initialLocale;
}

// Initialize with the set locale
init({
  fallbackLocale: 'en',
  initialLocale: initialLocale,
});

// Asynchronously apply the stored preferred locale on startup so returning
// users don't see a flash of the wrong text direction / language.
// Reads BOTH `preferredLanguage` (LanguageSwitcher legacy) and `locale`.
if (browser?.storage?.local) {
  void (async () => {
    try {
      const result = (await browser.storage.local.get(['locale', 'preferredLanguage'])) as {
        locale?: string;
        preferredLanguage?: string;
      };
      const stored = result.preferredLanguage || result.locale;
      if (typeof stored === 'string' && stored) {
        const mapped = mapLocale(stored);
        if (mapped !== initialLocale) {
          await setLanguage(mapped);
        } else {
          // Still sync storage keys + content-script cache even if codes match
          try {
            setCachedLocale(mapped);
            await persistLocale(mapped);
            await preloadTranslations(mapped);
          } catch {
            /* non-critical */
          }
        }
      }
    } catch {
      // Storage not available yet (e.g. early service-worker startup) - the
      // navigator-based default remains in place.
    }
  })();
}

export { locale };

/**
 * Load a specific locale on-demand. Registers the locale with svelte-i18n
 * if not already registered, then reinitializes.
 */
export async function loadLocale(newLocale: string): Promise<void> {
  const mapped = mapLocale(newLocale);
  ensureLocaleRegistered(mapped);
  await init({
    fallbackLocale: 'en',
    initialLocale: mapped,
  });
}

export async function setLanguage(newLocale: string) {
  const mapped = mapLocale(newLocale);
  await loadLocale(mapped);
  // Set after init so the store reflects the new locale regardless of what
  // svelte-i18n's internal resolution picked.
  locale.set(mapped);
  if (typeof document !== 'undefined') {
    document.documentElement.dir = isRTL(mapped) ? 'rtl' : 'ltr';
    document.documentElement.lang = mapped;
  }
  // Persist BOTH keys so content scripts, background, and UI stay in sync.
  try {
    setCachedLocale(mapped);
    await persistLocale(mapped);
    await preloadTranslations(mapped);
  } catch {
    /* non-critical */
  }
}

export function getCurrentLocale(): string {
  const stored = get(locale);
  return stored && stored.length > 0 ? stored : safeNavigatorLocale() || 'en';
}
