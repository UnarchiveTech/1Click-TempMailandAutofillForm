/**
 * Translation completeness tests
 *
 * Ensures every locale file stays in sync with en.json (source of truth).
 * Run via: bun test
 *
 * These tests deliberately fail fast with descriptive messages so developers
 * know exactly which keys/variables need to be added to which locale.
 */

import { describe, expect, test } from 'bun:test';

// ─── Helpers (duplicated from check-translations.ts to be self-contained) ────

const LOCALES_DIR = `${import.meta.dir}/../../../src/locales`;
const SOURCE_LOCALE = 'en';
const INTERPOLATION_RE = /\{(\w+)\}/g;

type LocaleData = Record<string, unknown>;

function flattenKeys(
  obj: LocaleData,
  prefix = '',
  result: Map<string, string> = new Map()
): Map<string, string> {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      result.set(fullKey, value);
    } else if (value !== null && typeof value === 'object') {
      flattenKeys(value as LocaleData, fullKey, result);
    }
  }
  return result;
}

function extractVars(str: string): Set<string> {
  const vars = new Set<string>();
  let m: RegExpExecArray | null;
  INTERPOLATION_RE.lastIndex = 0;
  for (m = INTERPOLATION_RE.exec(str); m !== null; m = INTERPOLATION_RE.exec(str)) {
    vars.add(m[1]);
  }
  return vars;
}

async function loadLocale(filename: string): Promise<LocaleData> {
  return (await Bun.file(`${LOCALES_DIR}/${filename}`).json()) as LocaleData;
}

// ─── Setup ───────────────────────────────────────────────────────────────────

const allFiles = (await Array.fromAsync(new Bun.Glob('*.json').scan(LOCALES_DIR))).sort();
const sourceKeys = flattenKeys(await loadLocale(`${SOURCE_LOCALE}.json`));
const otherLocales = allFiles
  .filter((f) => f !== `${SOURCE_LOCALE}.json`)
  .map((f) => ({ file: f, locale: f.replace('.json', '') }));

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Translation completeness', () => {
  test('source locale (en.json) is valid JSON with at least one key', () => {
    expect(sourceKeys.size).toBeGreaterThan(0);
  });

  test('all expected locale files exist', () => {
    const expected = ['ar', 'de', 'es', 'fr', 'ja', 'zh'];
    for (const lang of expected) {
      const exists = allFiles.includes(`${lang}.json`);
      expect(exists, `${lang}.json should exist in src/locales/`).toBe(true);
    }
  });

  for (const { file, locale } of otherLocales) {
    describe(locale, () => {
      test('has no missing keys vs en.json', async () => {
        const localeKeys = flattenKeys(await loadLocale(file));
        const missing: string[] = [];
        for (const key of sourceKeys.keys()) {
          if (!localeKeys.has(key)) missing.push(key);
        }
        expect(missing, `Missing keys in ${locale}: ${missing.join(', ')}`).toEqual([]);
      });

      test('interpolation variables match en.json', async () => {
        const localeKeys = flattenKeys(await loadLocale(file));
        const bad: string[] = [];
        for (const [key, enVal] of sourceKeys) {
          const locVal = localeKeys.get(key);
          if (locVal === undefined) continue;
          const enVars = extractVars(enVal);
          const locVars = extractVars(locVal);
          for (const v of enVars) {
            if (!locVars.has(v)) bad.push(`${key} missing {${v}}`);
          }
        }
        expect(bad, `Var mismatches in ${locale}: ${bad.join('; ')}`).toEqual([]);
      });
    });
  }
});
