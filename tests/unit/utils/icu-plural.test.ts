/**
 * ICU plural messages, rendered through the REAL formatter and the REAL
 * dictionaries (the pilot from docs/icu-plurals-evaluation.md).
 *
 * An ICU value renders per the locale's OWN Intl.PluralRules categories, so the
 * hazard the two-way key selector cannot have applies here: an arm the message
 * does not declare falls back to `other` SILENTLY - grammatically wrong text at
 * counts the translator didn't arm for. `check-translations` proves every
 * locale's ICU messages declare every category that locale's rules can produce
 * (that gate is arm-completeness); this file proves the arms RENDER - every ICU
 * key × every locale × a count sweep across all six categories, with zero
 * syntax leaking to the screen and the Arabic six-arm forms pinned exactly.
 */

import { describe, expect, test } from 'bun:test';
import { get } from 'svelte/store';
import { addMessages, init, t } from 'svelte-i18n';
import ar from '@/locales/ar.json';
import de from '@/locales/de.json';
import en from '@/locales/en.json';
import es from '@/locales/es.json';
import fr from '@/locales/fr.json';
import ja from '@/locales/ja.json';
import th from '@/locales/th.json';
import zh from '@/locales/zh.json';

const DICTS = { en, es, fr, de, ja, zh, ar, th } as const;

type LocaleCode = keyof typeof DICTS;
type Dict = Record<string, string>;

/** One locale's nested dictionary flattened to dotted keys. */
function flatten(obj: Record<string, unknown>, prefix = '', out: Dict = {}): Dict {
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[full] = value;
    else if (value !== null && typeof value === 'object') {
      flatten(value as Record<string, unknown>, full, out);
    }
  }
  return out;
}

/** The dotted keys whose value is an ICU `{arg, plural, …}` message. */
function icuKeysOf(dict: Dict): string[] {
  return Object.keys(dict).filter((key) => /\{\s*\w+\s*,\s*plural\s*,/.test(dict[key]));
}

/** Load one locale and hand back its formatter. */
async function formatterFor(locale: LocaleCode) {
  addMessages(locale, DICTS[locale]);
  await init({ fallbackLocale: 'en', initialLocale: locale });
  return get(t);
}

/**
 * Counts hitting every CLDR cardinal category the eight locales can produce:
 * zero(0) one(1) two(2) few(3,6,110) many(11,15,1_000_000-unreachable) other(100,102).
 * 999 caps the sweep - matches the gate's PLURAL_SWEEP_MAX.
 */
const SWEEP = [0, 1, 2, 3, 6, 11, 15, 100, 102, 110, 999];

/** Extra slots some messages declare (the favicon counter's size). */
const EXTRAS = { size: '2 MB' } as const;

const EN = flatten(en);

describe('every ICU plural key, in every locale', () => {
  test('the scan is not vacuous - en carries ICU keys', () => {
    expect(icuKeysOf(EN).length).toBeGreaterThanOrEqual(3);
  });

  for (const locale of Object.keys(DICTS) as LocaleCode[]) {
    test(`${locale}: category sweep renders locale text, never raw syntax`, async () => {
      const $t = await formatterFor(locale);
      const dict = flatten(DICTS[locale]);
      const keys = icuKeysOf(dict);

      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        // ICU selectors need not be named `n` (verification.itemCount uses
        // `count`). Sweep each declared plural selector through the real engine.
        const selectors = Array.from(dict[key].matchAll(/\{\s*(\w+)\s*,\s*plural\s*,/g));
        for (const n of SWEEP) {
          const values = {
            ...EXTRAS,
            ...Object.fromEntries(selectors.map((match) => [match[1], n])),
          };
          const rendered = $t(key, { values });
          // No ICU machinery may reach the screen: no selector keyword, no
          // unrendered slot, no unevaluated arm.
          expect(rendered).not.toMatch(/plural|zero \{|one \{|two \{|few \{|many \{|other \{/);
          expect(rendered).not.toContain('{');
          expect(rendered.trim().length).toBeGreaterThan(0);
        }
      }
    });
  }

  test('en: one vs other through the engine', async () => {
    const $t = await formatterFor('en');
    expect($t('storagePerformance.messages', { values: { n: 1 } })).toBe('1 message');
    expect($t('storagePerformance.messages', { values: { n: 5 } })).toBe('5 messages');
  });

  test('ar: the six CLDR arms render exactly (zero/one/two/few/many/other)', async () => {
    const $t = await formatterFor('ar');
    // The product does not force a numbering system for Arabic. ICU's # uses
    // the active runtime's Arabic number formatter, which may choose Latin or
    // Arabic-Indic digits; the grammatical arm must be correct in either case.
    const number = new Intl.NumberFormat('ar');
    expect($t('storagePerformance.messages', { values: { n: 0 } })).toBe('لا رسائل');
    expect($t('storagePerformance.messages', { values: { n: 1 } })).toBe('رسالة واحدة');
    expect($t('storagePerformance.messages', { values: { n: 2 } })).toBe('رسالتان');
    expect($t('storagePerformance.messages', { values: { n: 6 } })).toBe(
      `${number.format(6)} رسائل`
    );
    expect($t('storagePerformance.messages', { values: { n: 11 } })).toBe(
      `${number.format(11)} رسالة`
    );
    expect($t('storagePerformance.messages', { values: { n: 100 } })).toBe(
      `${number.format(100)} رسالة`
    );
  });

  test('ar: =0-style zero arm also covers the favicon counter (exact-zero bonus)', async () => {
    const $t = await formatterFor('ar');
    // zero is a real arm here, not an =N exact match - but it proves the view's
    // disabled-at-0 state can show a grammatical sentence, not "0 favicons".
    expect($t('storagePerformance.faviconsCached', { values: { ...EXTRAS, n: 0 } })).toBe(
      'لا أيقونات مخزّنة (2 MB)'
    );
  });

  test('every en ICU key has a counterpart value in every locale', () => {
    for (const locale of Object.keys(DICTS) as LocaleCode[]) {
      const dict = flatten(DICTS[locale]);
      for (const key of icuKeysOf(EN)) {
        expect(dict[key], `${locale} is missing ${key}`).toBeDefined();
        expect(/\{\s*\w+\s*,\s*plural\s*,/.test(dict[key]), `${locale}.${key} is not ICU`).toBe(
          true
        );
      }
    }
  });
});
