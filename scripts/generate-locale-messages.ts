#!/usr/bin/env bun
/**
 * generate-locale-messages.ts
 *
 * Derives two per-locale artifacts from `src/locales/*.json`, the single
 * source of truth:
 *
 * 1. `public/_locales/<code>/messages.json` - the WebExtensions dictionaries
 *    Chrome uses to localize strings it renders ITSELF (manifest `name` /
 *    `description` / `action.default_title` / `commands.*.description`,
 *    surfaced on chrome://extensions, the shortcuts page, the toolbar tooltip
 *    and the store listing).
 *
 * 2. `store-listing/<code>.json` - the localized store-listing metadata:
 *    the long `detail` description and the per-screenshot `caption`s, keyed
 *    by screenshot file. These have no WebExtensions plumbing (both the CWS
 *    and AMO dashboards take per-locale text fields uploaded by hand), so a
 *    per-locale JSON file is the smallest derivable representation - the
 *    release agent reads it when filling the listing instead of translators
 *    hand-editing eight copies on the store dashboard, where nothing can
 *    check completeness.
 *
 * Reuse beats duplication:
 *   - `extName` IS `actionTitle.tempMailAndAutofill` (the in-app product name
 *     the toolbar tooltip renders). Hand-keeping both copies meant 8 duplicated
 *     strings that could silently drift apart; here the duplication does not
 *     exist, so no equality check is needed.
 *   - the store `summary` field is the manifest description on the Chrome Web
 *     Store, so it reuses `manifest.extDescription` - no second copy.
 *   - everything else lives in the `manifest.*` and `store.*` namespaces of
 *     `src/locales`, so `bun run check-translations` (pre-commit + CI) already
 *     proves every locale carries them, and `bun run mirror-locales` fills new
 *     locales/keys automatically. Hand-maintained artifacts are invisible to
 *     both.
 *
 * Usage:
 *   bun run generate-locale-messages           # write both artifact trees
 *   bun run check-locale-messages              # exit 1 when they are stale
 *
 * The check compares parsed JSON (values + key sets), not raw text, so a
 * formatting pass can never make it report a false diff.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { collectSourceFiles } from './source-files';

const ROOT = join(import.meta.dir, '..');
const MESSAGES_DIR = join(ROOT, 'public', '_locales');
const STORE_LISTING_DIR = join(ROOT, 'store-listing');
const WXT_CONFIG = join(ROOT, 'wxt.config.ts');
const LOCALES_DIR = join(ROOT, 'src', 'locales');
const DEFAULT_LOCALE = 'en';

/** `__MSG_<key>__` → dotted path in `src/locales/<code>.json`. */
export const MESSAGE_SOURCES: Record<string, string> = {
  extName: 'actionTitle.tempMailAndAutofill',
  extDescription: 'manifest.extDescription',
  cmdAutofillForm: 'manifest.cmdAutofillForm',
  cmdOpenAutofillManager: 'manifest.cmdOpenAutofillManager',
  cmdQuickGenerateInbox: 'manifest.cmdQuickGenerateInbox',
  cmdCopyLatestOtp: 'manifest.cmdCopyLatestOtp',
};

/**
 * Store screenshot slug → dotted caption path in `src/locales/<code>.json`.
 * The slug IS the screenshot file name (`<slug>.png` in
 * `docs-site/public/screenshots`, rendered by the light/dark docs-screenshots
 * e2e pass), so the caption key and the artwork cannot be paired wrong.
 */
export const STORE_SOURCES: Record<string, string> = {
  'mailbox-overview': 'store.caption.mailboxOverview',
  autofill: 'store.caption.autofill',
  organize: 'store.caption.organize',
  'settings-data': 'store.caption.settingsData',
  'mailbox-detail': 'store.caption.mailboxDetail',
};

/** Dotted path of the store listing's long description. */
export const STORE_DETAIL_SOURCE = 'store.detail';

/**
 * Which variant of the docs screenshot pairs (light/dark) ships to the store.
 * The docs pipeline renders `<slug>-light.png` and `<slug>-dark.png`; the store
 * listing uses the light variant, flipped here in exactly one place.
 */
export const STORE_SCREENSHOT_VARIANT = 'light';

/**
 * Chrome Web Store length limits (Firefox/AMO have no equivalent caps that
 * bite at these lengths). Enforced here so an over-long translation fails the
 * audit instead of being silently truncated at upload time.
 */
export const STORE_LENGTH_LIMITS = {
  /** CWS detailed description. AMO accepts far more; this is the binding cap. */
  detail: 16_000,
  /** CWS per-screenshot caption. */
  caption: 100,
} as const;

/**
 * `src/locales` code → artifact directory/file name. Simplified Chinese is
 * the one code that differs: `zh` in the app, `zh_CN` for Chrome's `_locales`.
 * (Store dashboards accept plain `zh`; the extra artifact code is generated
 * from the same map for consistency.)
 */
export const LOCALE_DIRS: Record<string, string> = {
  en: 'en',
  ar: 'ar',
  de: 'de',
  es: 'es',
  fr: 'fr',
  ja: 'ja',
  th: 'th',
  zh: 'zh_CN',
};

/** Locale files must have an explicit browser/store artifact mapping. */
export function unmappedLocaleFiles(): string[] {
  return collectSourceFiles({ dirs: ['src/locales'], extensions: ['.json'], flat: true })
    .map((file) => basename(file, '.json'))
    .filter((locale) => !(locale in LOCALE_DIRS))
    .sort();
}

/** One curated store screenshot with its localized caption. */
export interface StoreScreenshot {
  /** Screenshot slug - also the PNG file name without extension. */
  name: string;
  /** File name in `docs-site/public/screenshots/`. */
  file: string;
  /** Localized caption shown under the screenshot on the store listing. */
  caption: string;
}

/** Localized store-listing metadata for one locale. */
export interface StoreListing {
  /** Long store description (`store.detail`). */
  detail: string;
  /** Curated screenshots in listing order. */
  screenshots: StoreScreenshot[];
}

/** Every distinct `__MSG_key__` placeholder in a manifest source. */
export function placeholdersIn(source: string): string[] {
  const found = [...source.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)]
    .map((m) => m[1])
    .filter((key): key is string => typeof key === 'string');
  return [...new Set(found)].sort();
}

/** Resolves a dotted path against a parsed locale tree. */
export function lookup(tree: Record<string, unknown>, dotted: string): unknown {
  let node: unknown = tree;
  for (const part of dotted.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/** Placeholders referenced by the manifest that have no `src/locales` source. */
export function unmappedPlaceholders(required: string[]): string[] {
  return required.filter((key) => !(key in MESSAGE_SOURCES));
}

/**
 * Builds one `_locales` dictionary. Returns the missing source paths rather
 * than throwing so the caller can report every locale at once.
 */
export function buildMessages(tree: Record<string, unknown>): {
  messages: Record<string, string>;
  missing: string[];
} {
  const messages: Record<string, string> = {};
  const missing: string[] = [];
  for (const [key, source] of Object.entries(MESSAGE_SOURCES)) {
    const value = lookup(tree, source);
    if (typeof value !== 'string' || value.trim() === '')
      missing.push(`${source} (for __MSG_${key}__)`);
    else messages[key] = value;
  }
  return { messages, missing };
}

/**
 * Builds one store-listing artifact. Returns the missing source paths rather
 * than throwing so the caller can report every locale at once.
 */
export function buildStoreListing(tree: Record<string, unknown>): {
  listing: StoreListing;
  missing: string[];
} {
  const listing: StoreListing = { detail: '', screenshots: [] };
  const missing: string[] = [];

  const detail = lookup(tree, STORE_DETAIL_SOURCE);
  if (typeof detail !== 'string' || detail.trim() === '')
    missing.push(`${STORE_DETAIL_SOURCE} (for the store detail description)`);
  else listing.detail = detail;

  for (const [slug, source] of Object.entries(STORE_SOURCES)) {
    const caption = lookup(tree, source);
    if (typeof caption !== 'string' || caption.trim() === '')
      missing.push(`${source} (for the ${slug}.png caption)`);
    else
      listing.screenshots.push({
        name: slug,
        file: `${slug}-${STORE_SCREENSHOT_VARIANT}.png`,
        caption,
      });
  }

  return { listing, missing };
}

/**
 * Store length limits that would be silently truncated (or rejected) at
 * upload time. Returns one human-readable violation per offender.
 */
export function validateStoreListingLengths(listing: StoreListing): string[] {
  const violations: string[] = [];
  if (listing.detail.length > STORE_LENGTH_LIMITS.detail)
    violations.push(
      `store.detail is ${listing.detail.length} chars (limit ${STORE_LENGTH_LIMITS.detail})`
    );
  for (const shot of listing.screenshots) {
    if (shot.caption.length > STORE_LENGTH_LIMITS.caption)
      violations.push(
        `caption for ${shot.file} is ${shot.caption.length} chars (limit ${STORE_LENGTH_LIMITS.caption})`
      );
  }
  return violations;
}

/** Deterministic output shape: one key per line, so a diff shows one string. */
export function renderMessages(messages: Record<string, string>): string {
  const lines = Object.keys(MESSAGE_SOURCES)
    .filter((key) => key in messages)
    .map((key) => `  ${JSON.stringify(key)}: { "message": ${JSON.stringify(messages[key])} }`);
  return `{\n${lines.join(',\n')}\n}\n`;
}

/**
 * Deterministic store-listing shape: detail first, screenshots in curated
 * order, one field per line so a diff shows exactly the changed string.
 */
export function renderStoreListing(listing: StoreListing): string {
  const shotLines = listing.screenshots.map(
    (shot) =>
      `    { "name": ${JSON.stringify(shot.name)}, "file": ${JSON.stringify(shot.file)}, "caption": ${JSON.stringify(shot.caption)} }`
  );
  const head = `{\n  "detail": ${JSON.stringify(listing.detail)},\n  "screenshots": [`;
  return `${head}\n${shotLines.join(',\n')}\n  ]\n}\n`;
}

/** Format-insensitive comparison: same key set, same values. */
export function matchesExisting(existing: string, expected: Record<string, string>): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(existing);
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null) return false;
  const entries = Object.entries(parsed as Record<string, { message?: unknown }>);
  if (entries.length !== Object.keys(expected).length) return false;
  return entries.every(([key, entry]) => entry?.message === expected[key]);
}

/** Format-insensitive store-listing comparison (deep, value-based). */
export function storeListingMatches(existing: string, expected: StoreListing): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(existing);
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null) return false;
  const node = parsed as { detail?: unknown; screenshots?: unknown };
  if (node.detail !== expected.detail) return false;
  if (!Array.isArray(node.screenshots)) return false;
  if (node.screenshots.length !== expected.screenshots.length) return false;
  return node.screenshots.every(
    (shot, i) =>
      JSON.stringify(shot) === JSON.stringify(expected.screenshots[i]) &&
      typeof shot === 'object' &&
      shot !== null &&
      'name' in shot &&
      'file' in shot &&
      'caption' in shot
  );
}

function main(): void {
  const check = process.argv.includes('--check');
  const required = placeholdersIn(readFileSync(WXT_CONFIG, 'utf8'));

  const unmappedLocales = unmappedLocaleFiles();
  if (unmappedLocales.length > 0) {
    console.error('✗ Locale source files have no generated-artifact mapping:');
    for (const locale of unmappedLocales) console.error(`  src/locales/${locale}.json`);
    console.error('\nAdd each locale to LOCALE_DIRS before generating browser/store artifacts.');
    process.exit(1);
  }

  const unmapped = unmappedPlaceholders(required);
  if (unmapped.length > 0) {
    console.error('✗ wxt.config.ts references placeholders with no src/locales source:');
    for (const key of unmapped) console.error(`  __MSG_${key}__`);
    console.error('\nAdd a mapping to MESSAGE_SOURCES and the key to every src/locales/*.json.');
    process.exit(1);
  }

  if (required.length === 0) {
    console.log('✓ No __MSG_*__ placeholders in wxt.config.ts - nothing to generate.');
    return;
  }

  const problems: string[] = [];
  const stale: string[] = [];

  for (const [srcCode, dirName] of Object.entries(LOCALE_DIRS)) {
    const srcPath = join(LOCALES_DIR, `${srcCode}.json`);
    if (!existsSync(srcPath)) {
      problems.push(`${srcCode}: missing src/locales/${srcCode}.json`);
      continue;
    }
    let tree: Record<string, unknown>;
    try {
      tree = JSON.parse(readFileSync(srcPath, 'utf8')) as Record<string, unknown>;
    } catch (error) {
      // A half-written locale file (e.g. a translation mid-save) must read as a
      // clear problem for that locale, not an unhandled parse crash that hides
      // which file is at fault and which locales were already processed.
      problems.push(
        `${srcCode}: src/locales/${srcCode}.json is not valid JSON (${
          error instanceof Error ? error.message : String(error)
        })`
      );
      continue;
    }

    // Artifact 1: the WebExtensions _locales dictionary.
    const { messages, missing } = buildMessages(tree);
    if (missing.length > 0) {
      for (const source of missing) problems.push(`${srcCode}: missing ${source}`);
    } else {
      const outPath = join(MESSAGES_DIR, dirName, 'messages.json');
      const existing = existsSync(outPath) ? readFileSync(outPath, 'utf8') : null;
      if (existing === null || !matchesExisting(existing, messages)) {
        stale.push(`${dirName}/messages.json`);
        if (!check) {
          mkdirSync(join(MESSAGES_DIR, dirName), { recursive: true });
          writeFileSync(outPath, renderMessages(messages));
        }
      }
    }

    // Artifact 2: the localized store-listing metadata.
    const store = buildStoreListing(tree);
    if (store.missing.length > 0) {
      for (const source of store.missing) problems.push(`${srcCode}: missing ${source}`);
    } else {
      const tooLong = validateStoreListingLengths(store.listing);
      for (const violation of tooLong) problems.push(`${srcCode}: ${violation}`);
      if (tooLong.length === 0) {
        const outPath = join(STORE_LISTING_DIR, `${dirName}.json`);
        const existing = existsSync(outPath) ? readFileSync(outPath, 'utf8') : null;
        if (existing === null || !storeListingMatches(existing, store.listing)) {
          stale.push(`store-listing/${dirName}.json`);
          if (!check) {
            mkdirSync(STORE_LISTING_DIR, { recursive: true });
            writeFileSync(outPath, renderStoreListing(store.listing));
          }
        }
      }
    }
  }

  console.log('=== Locale message dictionaries + store listings ===');
  console.log(`  Manifest sources : ${Object.values(MESSAGE_SOURCES).join(', ')}`);
  console.log(
    `  Store listing    : ${STORE_DETAIL_SOURCE} + ${Object.keys(STORE_SOURCES).length} captions (${Object.keys(
      STORE_SOURCES
    )
      .map((slug) => `${slug}.png`)
      .join(', ')})`
  );
  console.log(`  Locales          : ${Object.values(LOCALE_DIRS).join(', ')}`);
  console.log(`  Placeholders     : ${required.length} (${required.join(', ')})`);

  if (problems.length > 0) {
    console.error(`\n✗ ${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }

  if (check && stale.length > 0) {
    console.error(`\n✗ ${stale.length} stale artifact file(s): ${stale.join(', ')}`);
    console.error('Run: bun run generate-locale-messages');
    process.exit(1);
  }

  if (!check && stale.length > 0) {
    console.log(`  ✓ Wrote ${stale.length} artifact file(s).`);
    return;
  }

  console.log(
    `  ✓ public/_locales + store-listing are up to date (default locale: ${DEFAULT_LOCALE}).`
  );
}

if (import.meta.main) main();
