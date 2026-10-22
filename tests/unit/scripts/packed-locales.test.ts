import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPackedLocalePath, packLocale } from '../../../scripts/vite/packed-locales.js';
import { decodePackedLocale } from '../../../src/utils/i18n/packed-locale.js';

const ROOT = join(import.meta.dir, '../../..');
const LOCALES = ['en', 'ar', 'de', 'es', 'fr', 'ja', 'th', 'zh'] as const;

describe('production locale packs', () => {
  for (const language of LOCALES) {
    for (const directory of ['src/locales', 'src/locales/background']) {
      test(`${directory}/${language} preserves every key, string and interpolation`, () => {
        const source = readFileSync(join(ROOT, directory, `${language}.json`), 'utf8');
        const packed = packLocale(source);
        expect(decodePackedLocale(packed)).toEqual(JSON.parse(source));
        expect(packed.length).toBeLessThan(Buffer.byteLength(JSON.stringify(JSON.parse(source))));
        expect(packLocale(source)).toBe(packed);
      });
    }
  }

  test('only packs known non-English dictionaries, preserving asset queries and fallback modules', () => {
    expect(isPackedLocalePath(join(ROOT, 'src/locales/ja.json'), ROOT)).toBe(true);
    expect(isPackedLocalePath(join(ROOT, 'src/locales/background/ar.json'), ROOT)).toBe(true);
    for (const file of [
      'src/locales/en.json',
      'src/locales/background/en.json',
      'src/locales/fr.json?raw',
      'src/locales/fr.json?url',
      'src/config/providers-standard-example.json',
      'other/src/locales/fr.json',
    ]) {
      expect(isPackedLocalePath(join(ROOT, file), ROOT)).toBe(false);
    }
  });

  test('preserves Unicode, escaped strings, nested values and empty strings', () => {
    const dictionary = {
      text: 'العربية 日本語 ไทย 中文 📨 " \\ \n',
      empty: '',
      nested: { count: '{n}' },
    };
    expect(decodePackedLocale(packLocale(JSON.stringify(dictionary)))).toEqual(dictionary);
  });

  test('rejects malformed packs instead of returning an incomplete dictionary', () => {
    expect(() => decodePackedLocale('not valid base64!')).toThrow();
    expect(() => decodePackedLocale(btoa('broken zlib stream'))).toThrow();
  });

  test('full UI dictionaries contain every background translation with the same value', () => {
    function checkSubset(subset: Record<string, unknown>, full: Record<string, unknown>): void {
      for (const [key, value] of Object.entries(subset)) {
        if (value && typeof value === 'object') {
          expect(full[key]).toBeObject();
          checkSubset(value as Record<string, unknown>, full[key] as Record<string, unknown>);
        } else {
          expect(full[key]).toEqual(value);
        }
      }
    }
    for (const language of LOCALES) {
      const full = JSON.parse(readFileSync(join(ROOT, `src/locales/${language}.json`), 'utf8'));
      const background = JSON.parse(
        readFileSync(join(ROOT, `src/locales/background/${language}.json`), 'utf8')
      );
      checkSubset(background, full);
    }
  });
});
