/**
 * Translation utilities for non-Svelte contexts (background scripts, utilities)
 * Provides a way to get translated strings outside of Svelte components
 */

import { browser } from 'wxt/browser';
import { logError } from './logger.js';

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
    logError(
      `Failed to load translations for locale ${locale}:`,
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
    // Fallback to English
    if (locale !== 'en') {
      return loadTranslations('en');
    }
    return {};
  }
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

/**
 * Get a translated string by key path (e.g., "errors.apiCallFailed")
 * Supports nested keys with dot notation and {var} interpolation.
 */
export async function t(
  key: string,
  vars?: Record<string, string | number>,
  locale?: string
): Promise<string> {
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

  return typeof value === 'string' ? interpolate(value, vars) : key;
}

/**
 * Get a translated string synchronously (uses cached translations)
 * Returns the key if translation is not yet loaded.
 * Supports {var} interpolation.
 */
export function tSync(
  key: string,
  vars?: Record<string, string | number>,
  locale?: string
): string {
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

  return typeof value === 'string' ? interpolate(value, vars) : key;
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
