#!/usr/bin/env bun
/**
 * Mirror en.json keys to all other locale files.
 * - For keys already present in the target locale, keep the existing translation.
 * - For new keys, write the English value as a fallback (translators can localize later).
 *
 * Usage:
 *   bun run mirror-locales            # write English fallbacks into every locale
 *   bun run mirror-locales --check    # read-only pre-commit guard: exits 1 when
 *                                     # any locale is missing keys from en.json
 */
import { join } from 'node:path';

const LOCALES_DIR = join(import.meta.dir, '..', 'src', 'locales');

const SOURCE = 'en';
const LOCALES = ['ar', 'de', 'es', 'fr', 'ja', 'th', 'zh'];

type JsonObject = Record<string, unknown>;

/** True when `value` is a non-null, non-array JSON object. */
function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep merge: target gets new keys from source, but values are NOT overwritten. */
export function mergeKeys(target: JsonObject, source: JsonObject): JsonObject {
  for (const key of Object.keys(source)) {
    if (!(key in target)) {
      target[key] = source[key];
    } else if (isObject(source[key]) && isObject(target[key])) {
      mergeKeys(target[key], source[key]);
    }
  }
  return target;
}

/**
 * Dotted paths of source keys missing from `target`. Walks the same structure
 * mergeKeys() mirrors: nested objects recurse, arrays and scalars are atomic.
 */
export function missingKeys(target: JsonObject, source: JsonObject, prefix = ''): string[] {
  const missing: string[] = [];
  for (const key of Object.keys(source)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!(key in target)) {
      missing.push(path);
    } else if (isObject(source[key]) && isObject(target[key])) {
      missing.push(...missingKeys(target[key], source[key], path));
    }
  }
  return missing;
}

if (import.meta.main) {
  const sourceData = (await Bun.file(join(LOCALES_DIR, `${SOURCE}.json`)).json()) as JsonObject;

  if (process.argv.includes('--check')) {
    let totalMissing = 0;
    for (const locale of LOCALES) {
      const file = join(LOCALES_DIR, `${locale}.json`);
      let data: JsonObject;
      try {
        data = (await Bun.file(file).json()) as JsonObject;
      } catch (error) {
        console.error(`✗ ${locale}.json: could not parse (${(error as Error).message})`);
        process.exit(1);
      }
      const missing = missingKeys(data, sourceData);
      if (missing.length > 0) {
        totalMissing += missing.length;
        console.error(`✗ ${locale}.json is missing ${missing.length} key(s) from en.json:`);
        for (const key of missing) console.error(`    ${key}`);
      }
    }
    if (totalMissing > 0) {
      console.error(
        `\n✗ ${totalMissing} missing key(s) - run "bun run mirror-locales" to add English fallbacks.`
      );
      process.exit(1);
    }
    console.log(`✓ All ${LOCALES.length} locales contain every en.json key.`);
    process.exit(0);
  }

  for (const locale of LOCALES) {
    const file = join(LOCALES_DIR, `${locale}.json`);
    const data = (await Bun.file(file).json()) as JsonObject;
    mergeKeys(data, sourceData);
    await Bun.write(file, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`Updated ${locale}.json`);
  }
}
