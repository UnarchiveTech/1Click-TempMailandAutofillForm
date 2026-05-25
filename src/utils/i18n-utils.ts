/**
 * Translation utilities for non-Svelte contexts (background scripts, utilities)
 * Provides a way to get translated strings outside of Svelte components
 */

import { browser } from 'wxt/browser';

// Cache for loaded translations
const translationCache = new Map<string, Record<string, unknown>>();

/**
 * Get the current locale from storage
 */
export async function getCurrentLocale(): Promise<string> {
  try {
    const result = await browser.storage.local.get(['locale']);
    return (result.locale as string) || 'en';
  } catch {
    return 'en';
  }
}

/**
 * Load translations for a specific locale
 */
async function loadTranslations(locale: string): Promise<Record<string, unknown>> {
  // Check cache first
  if (translationCache.has(locale)) {
    return translationCache.get(locale)!;
  }

  try {
    // Dynamic import of locale file
    const translations = await import(`../lib/locales/${locale}.json`);
    translationCache.set(locale, translations.default);
    return translations.default;
  } catch (error) {
    console.error(`Failed to load translations for locale ${locale}:`, error);
    // Fallback to English
    if (locale !== 'en') {
      return loadTranslations('en');
    }
    return {};
  }
}

/**
 * Get a translated string by key path (e.g., "errors.apiCallFailed")
 * Supports nested keys with dot notation
 */
export async function t(key: string, locale?: string): Promise<string> {
  const targetLocale = locale || (await getCurrentLocale());
  const translations = await loadTranslations(targetLocale);

  const keys = key.split('.');
  let value: unknown = translations;

  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = (value as Record<string, unknown>)[k];
    } else {
      // Key not found, return the key itself as fallback
      return key;
    }
  }

  return typeof value === 'string' ? value : key;
}

/**
 * Get a translated string synchronously (uses cached translations)
 * Returns the key if translation is not yet loaded
 */
export function tSync(key: string, locale?: string): string {
  const targetLocale = locale || 'en';
  const translations = translationCache.get(targetLocale);

  if (!translations) {
    return key; // Not loaded yet
  }

  const keys = key.split('.');
  let value: unknown = translations;

  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = (value as Record<string, unknown>)[k];
    } else {
      return key;
    }
  }

  return typeof value === 'string' ? value : key;
}

/**
 * Preload translations for a locale (call this on startup)
 */
export async function preloadTranslations(locale: string): Promise<void> {
  await loadTranslations(locale);
}

/**
 * Clear translation cache (useful for locale changes)
 */
export function clearTranslationCache(): void {
  translationCache.clear();
}
