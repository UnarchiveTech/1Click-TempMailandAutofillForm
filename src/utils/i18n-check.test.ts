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
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── Helpers (duplicated from check-translations.ts to be self-contained) ────

const LOCALES_DIR = join(import.meta.dir, '../lib/locales');
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

function loadLocale(filename: string): LocaleData {
  const raw = readFileSync(join(LOCALES_DIR, filename), 'utf8');
  return JSON.parse(raw) as LocaleData;
}

// ─── Setup ───────────────────────────────────────────────────────────────────

const allFiles = readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json'));
const sourceKeys = flattenKeys(loadLocale(`${SOURCE_LOCALE}.json`));
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
      expect(exists, `${lang}.json should exist in src/lib/locales/`).toBe(true);
    }
  });

  for (const { file, locale } of otherLocales) {
    // Load locale data outside the describe block; mark as invalid if parsing fails
    let localeKeys: Map<string, string> | null = null;
    let parseError: string | null = null;
    try {
      localeKeys = flattenKeys(loadLocale(file));
    } catch (e) {
      parseError = (e as Error).message;
    }

    describe(`locale: ${locale}`, () => {
      test('is valid JSON', () => {
        expect(parseError, `Failed to parse ${file}: ${parseError}`).toBeNull();
      });

      if (localeKeys === null) return; // remaining tests would all crash

      const keys = localeKeys; // narrowed reference for use inside closures

      test('has no missing keys', () => {
        const missing = [...sourceKeys.keys()].filter((k) => !keys.has(k));
        expect(
          missing,
          `${locale}.json is missing ${missing.length} key(s):\n` +
            missing.map((k) => `  - ${k}  (en: "${sourceKeys.get(k)}")`).join('\n')
        ).toEqual([]);
      });

      test('has no extra keys absent from en.json', () => {
        const extra = [...keys.keys()].filter((k) => !sourceKeys.has(k));
        expect(
          extra,
          `${locale}.json has ${extra.length} extra key(s) not present in en.json:\n` +
            extra.map((k) => `  + ${k}`).join('\n') +
            '\n(Remove these keys or add them to en.json first)'
        ).toEqual([]);
      });

      test('all interpolation variables match en.json', () => {
        const mismatches: string[] = [];

        for (const [key, sourceStr] of sourceKeys.entries()) {
          const expectedVars = extractVars(sourceStr);
          if (expectedVars.size === 0) continue;

          const localeStr = keys.get(key);
          if (!localeStr) continue; // already caught by missing-keys test above

          const gotVars = extractVars(localeStr);
          const missingVars = [...expectedVars].filter((v) => !gotVars.has(v));
          const extraVars = [...gotVars].filter((v) => !expectedVars.has(v));

          if (missingVars.length > 0) {
            mismatches.push(
              `  ${key}: missing {${missingVars.join('}, {')}}\n` +
                `    en:     "${sourceStr}"\n` +
                `    ${locale}: "${localeStr}"`
            );
          }
          if (extraVars.length > 0) {
            mismatches.push(
              `  ${key}: unexpected {${extraVars.join('}, {')}}\n` +
                `    en:     "${sourceStr}"\n` +
                `    ${locale}: "${localeStr}"`
            );
          }
        }

        expect(
          mismatches,
          `${locale}.json has ${mismatches.length} interpolation variable mismatch(es):\n` +
            mismatches.join('\n')
        ).toEqual([]);
      });
    });
  }
});
