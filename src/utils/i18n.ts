import { get } from 'svelte/store';
import { getLocaleFromNavigator, init, locale, register } from 'svelte-i18n';

export { getLocaleFromNavigator };

register('en', () => import('../locales/en.json'));
register('es', () => import('../locales/es.json'));
register('fr', () => import('../locales/fr.json'));
register('de', () => import('../locales/de.json'));
register('ja', () => import('../locales/ja.json'));
register('zh', () => import('../locales/zh.json'));
register('ar', () => import('../locales/ar.json'));
register('th', () => import('../locales/th.json'));

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

// Set locale immediately before init to prevent initialization errors
const browserLocale = getLocaleFromNavigator() || 'en';
const initialLocale = mapLocale(browserLocale);
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
if (typeof browser !== 'undefined' && browser.storage?.local) {
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
            const { persistLocale, preloadTranslations, setCachedLocale } = await import(
              '@/utils/i18n-utils.js'
            );
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

export async function setLanguage(newLocale: string) {
  const mapped = mapLocale(newLocale);
  await init({
    fallbackLocale: 'en',
    initialLocale: mapped,
  });
  // Set after init so the store reflects the new locale regardless of what
  // svelte-i18n's internal resolution picked.
  locale.set(mapped);
  if (typeof document !== 'undefined') {
    document.documentElement.dir = isRTL(mapped) ? 'rtl' : 'ltr';
    document.documentElement.lang = mapped;
  }
  // Persist BOTH keys so content scripts, background, and UI stay in sync.
  try {
    const { persistLocale, preloadTranslations, setCachedLocale } = await import(
      '@/utils/i18n-utils.js'
    );
    setCachedLocale(mapped);
    await persistLocale(mapped);
    await preloadTranslations(mapped);
  } catch {
    /* non-critical */
  }
}

export function getCurrentLocale(): string {
  return get(locale) || getLocaleFromNavigator() || 'en';
}
