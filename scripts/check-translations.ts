#!/usr/bin/env bun
/**
 * Translation completeness checker
 *
 * Validates that every locale file in src/locales/ contains exactly the
 * same keys as the English source-of-truth (en.json).  Also checks that any
 * interpolation variables present in the English string (e.g. {n}, {count})
 * are carried over into every translation.
 *
 * Usage:
 *   bun run check-translations          # exits 0 = OK, 1 = problems found
 *   bun scripts/check-translations.ts   # same, run directly
 *
 * Output is human-readable and CI-friendly (no colour codes unless a TTY is
 * detected, summary at the bottom with counts).
 */

import { basename } from 'node:path';
import { collectAbsoluteFiles } from './source-files';

// ─── Configuration ────────────────────────────────────────────────────────────

const LOCALES_DIR = `${import.meta.dir}/../src/locales`;
const SOURCE_LOCALE = 'en';
const INTERPOLATION_RE = /\{(\w+)\}/g;

/**
 * ICU plural messages (`{n, plural, one {…} other {…}}`) are a second message
 * form the two-way `*Key`/`*KeyPlural` convention does not cover: the count
 * selects an ARM inside ONE dictionary value, via the locale's own
 * `Intl.PluralRules` categories (ar needs zero/one/two/few/many/other, de
 * needs one/other, ja only other). An arm the message does not declare falls
 * back to `other` SILENTLY - so a translator who writes only `one`/`other`
 * for Arabic ships grammatically wrong text at zero/two/few counts and no
 * key goes missing. The arm-completeness check below closes that hole:
 * every ICU message must declare every category the locale's own plural
 * rules can produce (integer sweep 0-999; exact-match arms like `=0` are
 * optional extras). Evidence and options: docs/icu-plurals-evaluation.md.
 */
const ICU_PLURAL_OPENER_RE = /\{\s*(\w+)\s*,\s*plural\s*,/g;
const ICU_ARM_RE = /(=\d+)|(zero|one|two|few|many|other)(?=\s*\{)/g;
/** Sweep bound for `requiredCategories` - every CLDR cardinal category for
 * these locales is reachable from integers below 1000 (es/fr `many` starts
 * at 10⁶, where the `other` fallback is the correct text anyway). */
const PLURAL_SWEEP_MAX = 999;
const requiredCategoryCache = new Map<string, Set<string>>();

/** The plural categories `locale`'s own rules produce for integers 0-999. */
function requiredCategories(locale: string): Set<string> {
  const cached = requiredCategoryCache.get(locale);
  if (cached) return cached;
  const rules = new Intl.PluralRules(locale);
  const cats = new Set<string>();
  for (let n = 0; n <= PLURAL_SWEEP_MAX; n++) cats.add(rules.select(n));
  requiredCategoryCache.set(locale, cats);
  return cats;
}

/** Parse every `{arg, plural, …}` body and collect its arm selectors. */
function icuPluralArms(str: string): Array<{ arg: string; arms: Set<string> }> {
  const out: Array<{ arg: string; arms: Set<string> }> = [];
  const opener = new RegExp(ICU_PLURAL_OPENER_RE.source, 'g');
  // for-loop assignment idiom (matches extractVars above) - keeps Biome's
  // noAssignInExpressions happy while walking a stateful regex.
  for (let m = opener.exec(str); m !== null; m = opener.exec(str)) {
    // Walk the body by brace depth: the opener consumed the leading `{`, so
    // the body runs to the matching `}` (arm bodies nest one level).
    let depth = 1;
    let i = m.index + m[0].length;
    const bodyStart = i;
    while (i < str.length && depth > 0) {
      const ch = str[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      if (depth > 0) i++;
    }
    if (depth !== 0) break; // malformed - the render test fails on it
    const body = str.slice(bodyStart, i);
    const arms = new Set<string>();
    const armRe = new RegExp(ICU_ARM_RE.source, 'g');
    for (let a = armRe.exec(body); a !== null; a = armRe.exec(body)) arms.add(a[0]);
    out.push({ arg: m[1], arms });
    opener.lastIndex = i; // continue past this message
  }
  return out;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type LocaleData = Record<string, unknown>;

/** Recursively flatten a nested object into dot-notation keys */
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

/** Extract interpolation variable names from a template string */
function extractVars(str: string): Set<string> {
  const vars = new Set<string>();
  let m: RegExpExecArray | null;
  INTERPOLATION_RE.lastIndex = 0;
  for (m = INTERPOLATION_RE.exec(str); m !== null; m = INTERPOLATION_RE.exec(str)) {
    vars.add(m[1]);
  }
  return vars;
}

async function loadLocale(file: string): Promise<LocaleData> {
  return (await Bun.file(`${LOCALES_DIR}/${file}`).json()) as LocaleData;
}

/** Detect TTY to decide whether to use ANSI colours */
const useColour = process.stdout.isTTY;

function red(s: string) {
  return useColour ? `\x1b[31m${s}\x1b[0m` : s;
}
function yellow(s: string) {
  return useColour ? `\x1b[33m${s}\x1b[0m` : s;
}
function green(s: string) {
  return useColour ? `\x1b[32m${s}\x1b[0m` : s;
}
function bold(s: string) {
  return useColour ? `\x1b[1m${s}\x1b[0m` : s;
}

// ─── Main ────────────────────────────────────────────────────────────────────

// The same file set every gate and `bun run check` sees: gitignored dictionaries
// are skipped everywhere or nowhere, never in one place only. `flat` excludes the
// generated `locales/background/*.json` minimal sets, as the glob used to.
const files = collectAbsoluteFiles(LOCALES_DIR, ['.json'], { flat: true })
  .map((f) => basename(f))
  .sort();
const sourceFile = `${SOURCE_LOCALE}.json`;

if (!files.includes(sourceFile)) {
  console.error(red(`Source locale file not found: ${sourceFile}`));
  process.exit(1);
}

const sourceData = await loadLocale(sourceFile);
const sourceKeys = flattenKeys(sourceData);
const otherFiles = files.filter((f) => f !== sourceFile);

// ─── ICU arm completeness ─────────────────────────────────────────────────

/**
 * For every locale (en included - the source must satisfy its own rules),
 * every ICU plural message must declare all categories that locale's
 * plural rules produce. Runs after the main loop so `flattenKeys` per file
 * is reused through a fresh load (cheap, and keeps the main loop untouched).
 */
const icuIssues: Array<{ locale: string; key: string; missing: string[] }> = [];
for (const file of files) {
  const locale = file.replace('.json', '');
  let data: LocaleData;
  try {
    data = await loadLocale(file);
  } catch {
    continue; // already reported above
  }
  const required = requiredCategories(locale);
  for (const [key, value] of flattenKeys(data)) {
    for (const { arg, arms } of icuPluralArms(value)) {
      const missing = [...required].filter((c) => !arms.has(c));
      if (missing.length > 0 || arms.size === 0) {
        icuIssues.push({
          locale,
          key: `${key} (${arg})`,
          missing: arms.size === 0 ? ['<no arms parsed>'] : missing,
        });
      }
    }
  }
}

let totalErrors = 0;
let totalWarnings = 0;
const localeResults: Array<{
  locale: string;
  missing: string[];
  extra: string[];
  missingVars: Array<{ key: string; expected: string[]; got: string[] }>;
}> = [];

for (const file of otherFiles) {
  const locale = file.replace('.json', '');
  let data: LocaleData;

  try {
    data = await loadLocale(file);
  } catch (e) {
    console.error(red(`  [${locale}] Failed to parse JSON: ${(e as Error).message}`));
    totalErrors++;
    continue;
  }

  const localeKeys = flattenKeys(data);

  // Missing keys: in source but not in this locale
  const missing: string[] = [];
  for (const key of sourceKeys.keys()) {
    if (!localeKeys.has(key)) {
      missing.push(key);
    }
  }

  // Extra keys: in this locale but not in source (warning, not error)
  const extra: string[] = [];
  for (const key of localeKeys.keys()) {
    if (!sourceKeys.has(key)) {
      extra.push(key);
    }
  }

  // Interpolation variable mismatches
  const missingVars: Array<{ key: string; expected: string[]; got: string[] }> = [];
  for (const [key, sourceStr] of sourceKeys.entries()) {
    const expectedVars = extractVars(sourceStr);
    if (expectedVars.size === 0) continue;

    const localeStr = localeKeys.get(key);
    if (!localeStr) continue; // already caught as missing key above

    const gotVars = extractVars(localeStr);
    const missingInLocale = [...expectedVars].filter((v) => !gotVars.has(v));
    const extraInLocale = [...gotVars].filter((v) => !expectedVars.has(v));

    if (missingInLocale.length > 0 || extraInLocale.length > 0) {
      missingVars.push({
        key,
        expected: [...expectedVars],
        got: [...gotVars],
      });
    }
  }

  localeResults.push({ locale, missing, extra, missingVars });
  totalErrors += missing.length + missingVars.length;
  totalWarnings += extra.length;
}
totalErrors += icuIssues.length;

// ─── Report ───────────────────────────────────────────────────────────────────

console.log(bold('\n=== Translation Completeness Check ===\n'));
console.log(`  Source locale : ${bold(SOURCE_LOCALE)}`);
console.log(`  Source keys   : ${bold(String(sourceKeys.size))}`);
console.log(
  `  Locales checked: ${bold(String(otherFiles.length))} (${otherFiles.map((f) => f.replace('.json', '')).join(', ')})\n`
);

for (const { locale, missing, extra, missingVars } of localeResults) {
  const hasIssue = missing.length > 0 || extra.length > 0 || missingVars.length > 0;
  if (!hasIssue) {
    console.log(
      `  ${green('✓')} ${bold(locale.padEnd(6))} - all ${sourceKeys.size} keys present, all variables match`
    );
    continue;
  }

  console.log(`\n  ${red('✗')} ${bold(locale)}`);

  if (missing.length > 0) {
    console.log(red(`    Missing keys (${missing.length}):`));
    for (const k of missing) {
      console.log(red(`      - ${k}`));
      console.log(`          en: "${sourceKeys.get(k)}"`);
    }
  }

  if (missingVars.length > 0) {
    console.log(yellow(`    Interpolation variable mismatches (${missingVars.length}):`));
    for (const { key, expected, got } of missingVars) {
      console.log(yellow(`      ~ ${key}`));
      console.log(`          expected vars: {${expected.join('}, {')}}`);
      console.log(
        `          found vars:    ${got.length > 0 ? `{${got.join('}, {')}}` : '(none)'}`
      );
    }
  }

  if (extra.length > 0) {
    console.log(yellow(`    Extra keys not in source (${extra.length}) [warning only]:`));
    for (const k of extra) {
      console.log(yellow(`      + ${k}`));
    }
  }
}

// ─── ICU arm-completeness report ───────────────────────────────────────

if (icuIssues.length > 0) {
  console.log(`\n${red(bold(`ICU plural arm completeness (${icuIssues.length}):`))}`);
  for (const { locale, key, missing } of icuIssues) {
    console.log(red(`  ✗ [${locale}] ${key}`));
    console.log(`      missing arms for categories: ${missing.join(', ')}`);
  }
  console.log(
    `      (an undeclared category silently falls back to 'other' - declare every\n` +
      `       category Intl.PluralRules(locale) can produce; see docs/icu-plurals-evaluation.md)`
  );
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${bold('=== Summary ===')}`);
console.log(`  Errors   : ${totalErrors > 0 ? red(String(totalErrors)) : green('0')}`);
console.log(`  Warnings : ${totalWarnings > 0 ? yellow(String(totalWarnings)) : green('0')}`);

if (totalErrors === 0 && totalWarnings === 0) {
  console.log(`\n${green(bold('  All translations are complete and consistent!'))}\n`);
} else if (totalErrors === 0) {
  console.log(
    `\n${yellow(bold('  Translations are complete but have extra keys (see warnings above).'))}\n`
  );
} else {
  console.log(
    `\n${red(bold(`  ✗ ${totalErrors} error(s) found. Fix missing keys / variables before merging.`))}\n`
  );
}

process.exit(totalErrors > 0 ? 1 : 0);
