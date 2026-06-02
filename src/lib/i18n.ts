import { getLocaleFromNavigator, init, locale, register } from 'svelte-i18n';

export { getLocaleFromNavigator };

register('en', () => import('./locales/en.json'));
register('es', () => import('./locales/es.json'));
register('fr', () => import('./locales/fr.json'));
register('de', () => import('./locales/de.json'));
register('ja', () => import('./locales/ja.json'));
register('zh', () => import('./locales/zh.json'));
register('ar', () => import('./locales/ar.json'));

// Map full browser locale codes to our supported language codes
function mapLocale(browserLocale: string): string {
  const supportedLocales = ['en', 'es', 'fr', 'de', 'ja', 'zh', 'ar'];
  const langCode = browserLocale.split('-')[0].toLowerCase();

  // Direct match
  if (supportedLocales.includes(langCode)) {
    return langCode;
  }

  return 'en';
}

// Set locale immediately before init to prevent initialization errors
const browserLocale = getLocaleFromNavigator() || 'en';
const initialLocale = mapLocale(browserLocale);
locale.set(initialLocale);

// Initialize with the set locale
init({
  fallbackLocale: 'en',
  initialLocale: initialLocale,
});

export { locale };

export async function setLanguage(newLocale: string) {
  // First set the locale
  locale.set(newLocale);

  // Then re-initialize with the new locale to load translations
  await init({
    fallbackLocale: 'en',
    initialLocale: newLocale,
  });

  // Ensure locale is set after init
  locale.set(newLocale);
}

import { get } from 'svelte/store';

export function getCurrentLocale(): string {
  return get(locale) || getLocaleFromNavigator() || 'en';
}

export const isRTL = (locale: string): boolean => {
  return ['ar', 'he', 'fa', 'ur'].includes(locale);
};
