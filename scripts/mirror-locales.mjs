#!/usr/bin/env bun
/**
 * Mirror en.json keys to all other locale files.
 * - For keys already present in the target locale, keep the existing translation.
 * - For new keys, write the English value as a fallback (translators can localize later).
 */
import { join } from 'node:path';

const LOCALES_DIR = join(import.meta.dir, '..', 'src', 'lib', 'locales');

const SOURCE = 'en';
const LOCALES = ['ar', 'de', 'es', 'fr', 'ja', 'zh'];

/** Deep merge: target gets new keys from source, but values are NOT overwritten. */
function mergeKeys(target, source) {
  for (const key of Object.keys(source)) {
    if (!(key in target)) {
      target[key] = source[key];
    } else if (
      typeof source[key] === 'object' &&
      source[key] !== null &&
      !Array.isArray(source[key]) &&
      typeof target[key] === 'object' &&
      target[key] !== null
    ) {
      mergeKeys(target[key], source[key]);
    }
  }
  return target;
}

const sourceData = await Bun.file(join(LOCALES_DIR, `${SOURCE}.json`)).json();

for (const locale of LOCALES) {
  const file = join(LOCALES_DIR, `${locale}.json`);
  const data = await Bun.file(file).json();
  mergeKeys(data, sourceData);
  await Bun.write(file, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`Updated ${locale}.json`);
}
