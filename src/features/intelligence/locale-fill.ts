/**
 * Locale-aware fill data - names/phones/addresses match page language.
 */

import { detectCountryLocally, randomCity, randomPostalCode } from '@/utils/i18n/locale-profile.js';
import { randomInt, randomIntBetween } from '@/utils/security/secure-random.js';

/** Detect page language from html[lang], document, or navigator. */
export function detectPageLocale(): string {
  try {
    const htmlLang = document.documentElement?.lang || '';
    if (htmlLang) return htmlLang;
    const meta = document
      .querySelector('meta[http-equiv="content-language"]')
      ?.getAttribute('content');
    if (meta) return meta;
  } catch {
    /* ignore */
  }
  return typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US';
}

export function localeToCountryHint(locale: string): string {
  const base = (locale || 'en').split('-')[0]?.toLowerCase() || 'en';
  const map: Record<string, string> = {
    en: 'US',
    de: 'DE',
    fr: 'FR',
    es: 'ES',
    ja: 'JP',
    zh: 'CN',
    ar: 'AE',
    th: 'TH',
    pt: 'BR',
    it: 'IT',
    nl: 'NL',
    ko: 'KR',
    hi: 'IN',
    pl: 'PL',
    ru: 'RU',
    sv: 'SE',
  };
  const region = (locale || '').split('-')[1]?.toUpperCase();
  if (region && region.length === 2) return region;
  return map[base] || detectCountryLocally() || 'US';
}

/** Locale-shaped phone without importing content generators (avoids circular deps). */
export function localeAwarePhone(locale?: string): string {
  const loc = (locale || detectPageLocale()).toLowerCase();
  if (loc.startsWith('fr')) {
    return `06 ${String(randomIntBetween(10, 99))} ${String(randomIntBetween(10, 99))} ${String(randomIntBetween(10, 99))} ${String(randomIntBetween(10, 99))}`;
  }
  if (loc.startsWith('de')) {
    return `+49 17${randomInt(10)} ${randomIntBetween(1000000, 9999999)}`;
  }
  if (loc.startsWith('en-gb') || loc.startsWith('en-uk')) {
    return `07${randomIntBetween(100, 999)} ${randomIntBetween(100000, 999999)}`;
  }
  if (loc.startsWith('ja')) {
    return `090-${randomIntBetween(1000, 9999)}-${randomIntBetween(1000, 9999)}`;
  }
  if (loc.startsWith('in') || loc.startsWith('hi')) {
    return `+91 ${randomIntBetween(7000000000, 9999999999)}`;
  }
  // US default
  const area = randomIntBetween(200, 999);
  const mid = randomIntBetween(200, 999);
  const last = randomIntBetween(1000, 9999);
  return `(${area}) ${mid}-${last}`;
}

export function localeAwareAddressExtras(locale?: string): {
  country: string;
  city: string;
  pin: string;
} {
  const country = localeToCountryHint(locale || detectPageLocale());
  return {
    country,
    city: randomCity(country),
    pin: randomPostalCode(country),
  };
}
