#!/usr/bin/env bun
/**
 * Translation completeness checker
 *
 * Validates that every locale file in src/lib/locales/ contains exactly the
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

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── Configuration ────────────────────────────────────────────────────────────

const LOCALES_DIR = join(import.meta.dir, '../src/lib/locales');
const SOURCE_LOCALE = 'en';
const INTERPOLATION_RE = /\{(\w+)\}/g;

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

/** Load and parse a JSON locale file */
function loadLocale(file: string): LocaleData {
  const raw = readFileSync(join(LOCALES_DIR, file), 'utf8');
  return JSON.parse(raw) as LocaleData;
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

const files = readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json'));
const sourceFile = `${SOURCE_LOCALE}.json`;

if (!files.includes(sourceFile)) {
  console.error(red(`Source locale file not found: ${sourceFile}`));
  process.exit(1);
}

const sourceData = loadLocale(sourceFile);
const sourceKeys = flattenKeys(sourceData);
const otherFiles = files.filter((f) => f !== sourceFile);

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
    data = loadLocale(file);
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

// ─── Report ───────────────────────────────────────────────────────────────────

console.log(bold('\n=== Translation Completeness Check ===\n'));
console.log(`  Source locale : ${bold(SOURCE_LOCALE)}`);
console.log(`  Source keys   : ${bold(String(sourceKeys.size))}`);
console.log(
  `  Locales checked: ${bold(String(otherFiles.length))} (${otherFiles.map((f) => f.replace('.json', '')).join(', ')})\n`
);

let _anyIssue = false;

for (const { locale, missing, extra, missingVars } of localeResults) {
  const hasIssue = missing.length > 0 || extra.length > 0 || missingVars.length > 0;
  if (!hasIssue) {
    console.log(
      `  ${green('✓')} ${bold(locale.padEnd(6))} — all ${sourceKeys.size} keys present, all variables match`
    );
    continue;
  }

  _anyIssue = true;
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
