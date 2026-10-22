#!/usr/bin/env bun
/**
 * Locale-key reference checker
 *
 * `check-translations` proves every *locale* carries every key in `en.json`, and
 * `check-unused-locales` proves every key in `en.json` is referenced somewhere.
 * Neither direction covers the case that actually reaches a user: a `t()` /
 * `tSync()` / `$t()` call naming a key that does **not exist** in `en.json`.
 * `t()` returns the key itself on a miss, so a typo - a guessed namespace
 * (`inbox.preferredDomain` where the real key is `disposable.preferredDomain`)
 * or a renamed leaf - renders as literal `inbox.preferredDomain` text on screen,
 * in every language, and no other gate notices.
 *
 * This check closes that loop: it collects the string literals sitting in a
 * *translation-key position* and fails when one is absent from `en.json` at that
 * exact path.
 *
 * Positions checked (literals are comment-stripped first, so prose and JSDoc
 * examples never count):
 *
 *   1. translator calls - `$t('…')`, `t('…')`, `tSync('…')`, `translate('…')`,
 *      `get(t)('…')` - and `translateResultMessage('…')`;
 *   2. `renderResultError(…, 'fallbackKey')` / `localizedErrorMessageOrFallback(…, 'fallbackKey')`
 *      (last argument);
 *   3. `*Key:` / `default:` object properties - `labelKey`, `titleKey`,
 *      `messageKey`, `translationKey`, `$t(key, { default: 'otherKey' })`, and a
 *      `pluralMessage($t, { oneKey, otherKey }, n)` pair (both halves; see
 *      `src/utils/i18n/i18n-plural.ts`) - and
 *      the string values of a `*KEY` / `*KEYS: Record<string, string>` map
 *      (`VIEW_LABEL_KEYS`, whose values are the keys `tSync` renders for each
 *      recorded view id; `LOGIN_HEALTH_KIND_LABEL_KEY`, whose values reach the
 *      screen through `$t(LOGIN_HEALTH_KIND_LABEL_KEY[kind])`);
 *   4. the `ERROR_CODE_TO_TRANSLATION_KEY` map in `src/utils/errors.ts`, whose
 *      values are renderable keys used by background notifications;
 *   5. a key-shaped literal RETURNED from a helper (`statusPillLabel`,
 *      `fabLabelKeyForKind`, `expiryCaption`) - the helper call sits in a
 *      `$t(...)` position, the literal does not, so no other rule reaches it.
 *
 * A literal only counts when it is *shaped* like a key (lowercase first segment,
 * dot-separated, no whitespace), so machine codes (`invalid-current-password`),
 * storage keys (`selectedInstance_x`), filenames (`manifest.json`) and English
 * prose (`Please try again.`) are never candidates. Dynamic keys (a template
 * literal with `${…}`) are skipped - they cannot be resolved statically, the
 * same contract `generate-background-locales.ts` enforces in background code.
 *
 * Usage:
 *   bun run check-locale-key-references            # exits 1 on a new finding
 *   bun run check-locale-key-references --update   # rewrite the baseline
 *
 * `scripts/baselines/locale-key.txt` holds the pre-existing offenders as `<path><TAB><key>`
 * rows (path + key, never a line number, so unrelated edits cannot invalidate a
 * row). The gate is a **ratchet**: a finding that is not in the baseline fails,
 * and so does a baseline row with no matching finding - so migrating a file to
 * real keys forces its row out. Never add a row to silence a new key: fix the
 * key, or add it to `src/locales/en.json` plus every locale.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { collectSourceFiles, repoAbsolute } from './source-files';
// The one classifier for "which bytes are code" - shared with every other scanner.
import { analyzeSource } from './source-lexer';

// ─── Configuration ────────────────────────────────────────────────────────────

const ROOT = join(import.meta.dir, '..');
const EN_FILE = join(ROOT, 'src', 'locales', 'en.json');
const BASELINE_FILE = join(ROOT, 'scripts', 'baselines', 'locale-key.txt');

/** Scanned roots - the code that can render a key to a user. */
const SCAN_DIRS = ['src', 'tests'];

/** File types that can hold a reference (the walk's extension filter). */
const CODE_EXTS = ['.ts', '.svelte', '.js', '.mjs'];

/** Sources that define keys rather than reference them. */
const SKIP_FILES = new Set(['src/locales/en.json']);

/**
 * A key looks like `namespace.leaf` - lowercase first segment, dot-separated
 * alphanumeric/underscore segments, no whitespace.
 */
const KEY_SHAPE_RE = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+$/;

/**
 * Call names whose FIRST argument is a translation key. `localizedMessage` is
 * here because it is now the canonical producer API - a key typo'd there would
 * render the raw key exactly like a `$t()` typo, and it must be gated the same
 * way rather than becoming a hole in the check.
 */
const TRANSLATOR_CALLS = [
  '$t',
  'tSync',
  'translate',
  't',
  'translateResultMessage',
  'localizedMessage',
];

/** Calls whose LAST argument is a translation key. */
const FALLBACK_CALLS = ['renderResultError', 'localizedErrorMessageOrFallback'];

/** Literal positions: `…Key: 'x.y'` and `default: 'x.y'`. */
const PROP_RE = /\b(\w*[Kk]ey|default)\s*:\s*(['"])((?:[^'"\\]|\\.)*)\2/g;

/** Property names that hold DOM/locale identifiers rather than another key. */
const IGNORED_PROPS = new Set(['key']);

// ─── Reference collection (pure core) ─────────────────────────────────────────

export interface KeyReference {
  path: string;
  line: number;
  key: string;
}

/** Extracts a call's argument list, starting at its `(`. */
export function extractArgs(source: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(openParen + 1, i);
    }
  }
  return source.slice(openParen + 1);
}

/**
 * Split an argument list at its TOP-LEVEL commas, so a nested call's commas stay
 * inside their own argument (`pluralMessage($t, { oneKey: 'a', otherKey: 'b' }, n)`
 * is three arguments, not five). Shared with `check-plural-keys`, which reads a
 * call's SECOND argument's pair - one splitter, so the two gates cannot disagree
 * about where an argument ends either.
 */
export function splitTopLevel(args: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < args.length; i += 1) {
    const ch = args[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(args.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(args.slice(start));
  return parts;
}

/** Text before the first top-level comma - i.e. a call's first argument. */
export function firstArgument(args: string): string {
  return splitTopLevel(args)[0] ?? args;
}

/** Every static string literal in a fragment (a ternary may name several keys). */
export function literalsIn(fragment: string): string[] {
  return [...fragment.matchAll(/(['"`])((?:[^'"`\\]|\\.)*)\1/g)]
    .map((match) => match[2])
    .filter((raw) => !raw.includes('${')); // dynamic key - not statically checkable
}

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (source[i] === '\n') line += 1;
  return line;
}

/**
 * Every key-positioned literal in one file's source. Pure over its inputs so the
 * scanner can be unit-tested on fixtures; the caller decides which keys exist.
 */
export function findKeyReferences(relPath: string, raw: string): KeyReference[] {
  const { code: src, inString } = analyzeSource(raw);
  const found: KeyReference[] = [];
  const seen = new Set<string>();

  // A reference must sit in code position: `$t('a.b')` is a call, while the same
  // text inside a string literal is a snippet being quoted (a test fixture, a
  // doc string, an error message describing the pattern). One literal can be
  // reached by two rules at once (`default:` inside a `$t(…)` call is also a
  // property), so references are deduped per line + key.
  const push = (index: number, key: string | null) => {
    if (!key || !KEY_SHAPE_RE.test(key) || inString[index] === 1) return;
    const line = lineOf(raw, index);
    const id = `${line}\t${key}`;
    if (seen.has(id)) return;
    seen.add(id);
    found.push({ path: relPath, line, key });
  };

  // 1. Translator calls - first argument (a ternary may name several keys).
  for (const name of TRANSLATOR_CALLS) {
    const callRe = new RegExp(`(?:^|[^\\w$.])${name.replace('$', '\\$')}\\s*\\(`, 'gm');
    for (const match of src.matchAll(callRe)) {
      const open = match.index + match[0].length - 1;
      const args = extractArgs(src, open);
      for (const key of literalsIn(firstArgument(args))) push(open, key);
      // `$t(key, { default: 'other.key', … })` - a nested key literal.
      const defaultProp = /\bdefault\s*:\s*(['"])((?:[^'"\\]|\\.)*)\1/.exec(args);
      push(open, defaultProp?.[2] ?? null);
    }
  }

  // `get(t)('key')` - svelte-i18n's formatter unwrapped from its store.
  for (const match of src.matchAll(/get\s*\(\s*t\s*\)\s*\(\s*(['"])((?:[^'"\\]|\\.)*)\1/gm)) {
    push(match.index, match[2]);
  }

  // 2. Fallback-key calls - last argument.
  for (const name of FALLBACK_CALLS) {
    const callRe = new RegExp(`(?:^|[^\\w$.])${name}\\s*\\(`, 'gm');
    for (const match of src.matchAll(callRe)) {
      const open = match.index + match[0].length - 1;
      const literals = literalsIn(extractArgs(src, open));
      push(open, literals.length > 0 ? literals[literals.length - 1] : null);
    }
  }

  // 3. `*Key:` / `default:` properties.
  for (const match of src.matchAll(PROP_RE)) {
    if (IGNORED_PROPS.has(match[1])) continue;
    push(match.index, match[3]);
  }

  // 3b. String values of a `*KEY` / `*KEYS` map typed as a string record
  //     (`VIEW_LABEL_KEYS: Record<string, string>`) - keys rendered later by
  //     `tSync`. The SINGULAR form is the blind spot this rule closes: a map of
  //     `kind → key` is naturally named `…_KEY`, and its values reach the user
  //     through `$t(MAP[x])` while being checked by nothing at all (a value like
  //     `savedLoginInfo.healthExpiredMailbox` renders as that raw path on a
  //     rename). The `Record<…, string>` annotation is what separates a key map
  //     from a lookalike (`ICON_KEYS = { user: 'icons/user.svg' }`) whose values
  //     are paths; array-valued records are skipped by the pair pattern.
  for (const mapMatch of src.matchAll(/[A-Za-z_]*KEYS?\s*:\s*Record<[^>]*>\s*=\s*\{/g)) {
    if (/\[\]/.test(mapMatch[0])) continue; // Record<string, string[]> - not keys
    const body = extractArgs(src, mapMatch.index + mapMatch[0].length - 1);
    for (const pair of body.matchAll(/\b[A-Za-z_$][\w$]*\s*:\s*(['"])((?:[^'"\\]|\\.)*)\1/g)) {
      push(mapMatch.index, pair[2]);
    }
  }

  // 4. The error-code → translation-key map.
  if (relPath === 'src/utils/errors.ts') {
    for (const match of src.matchAll(/\[ErrorCode\.[A-Z_]+\]\s*:\s*(['"])((?:[^'"\\]|\\.)*)\1/g)) {
      push(match.index, match[2]);
    }
  }

  // 5. A key-shaped literal RETURNED from a helper (`$t(statusPillLabel(pill))`,
  //    `$t(fabLabelKeyForKind(kind))`): the CALL is in a translation-key
  //    position but the literal is not, so rules 1-4 cannot see it. `push`'s
  //    shape filter keeps this a fidelity check rather than a heuristic - across
  //    src/ + tests/ the rule matches 13 literals and every one is a real key.
  for (const match of src.matchAll(/\breturn\s+(['"])((?:[^'"\\]|\\.)*)\1/g)) {
    push(match.index, match[2]);
  }

  return found;
}

// ─── Locale keys ──────────────────────────────────────────────────────────────

type Tree = Record<string, unknown>;

function flattenKeys(obj: Tree, prefix = '', out = new Set<string>()): Set<string> {
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.add(full);
    else if (value !== null && typeof value === 'object') flattenKeys(value as Tree, full, out);
  }
  return out;
}

// ─── Baseline ─────────────────────────────────────────────────────────────────

export const baselineRow = (ref: KeyReference) => `${ref.path}\t${ref.key}`;

export function loadBaseline(): Set<string> {
  if (!existsSync(BASELINE_FILE)) return new Set();
  return new Set(
    readFileSync(BASELINE_FILE, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
  );
}

export interface BaselineDiff {
  /** Missing keys that the baseline does not excuse - the build breakers. */
  newFindings: KeyReference[];
  /** Baseline rows with no matching finding - fixed debt to remove. */
  staleRows: string[];
}

/**
 * The ratchet itself. A row only excuses the exact `<path><TAB><key>` it names,
 * so one baseline entry can never cover a second key or a second file.
 */
export function diffAgainstBaseline(missing: KeyReference[], baseline: Set<string>): BaselineDiff {
  const current = new Set(missing.map(baselineRow));
  return {
    newFindings: missing.filter((reference) => !baseline.has(baselineRow(reference))),
    staleRows: [...baseline].filter((row) => !current.has(row)),
  };
}

/** Every key-positioned literal in the scanned tree (the gate's raw input). */
export function collectRepositoryReferences(): KeyReference[] {
  const references: KeyReference[] = [];
  // `collectSourceFiles` returns repo-relative paths already, and skips exactly
  // what `.gitignore` covers - the same set `bun run check` skips.
  for (const rel of collectSourceFiles({ dirs: SCAN_DIRS, extensions: CODE_EXTS })) {
    if (SKIP_FILES.has(rel)) continue;
    references.push(...findKeyReferences(rel, readFileSync(repoAbsolute(rel), 'utf8')));
  }
  return references;
}

/** Flattened key set of `src/locales/en.json` (the source of truth). */
export function loadSourceKeys(): Set<string> {
  return flattenKeys(JSON.parse(readFileSync(EN_FILE, 'utf8')) as Tree);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const useColour = () => Boolean(process.stdout.isTTY);
const red = (s: string) => (useColour() ? `\x1b[31m${s}\x1b[0m` : s);
const green = (s: string) => (useColour() ? `\x1b[32m${s}\x1b[0m` : s);
const yellow = (s: string) => (useColour() ? `\x1b[33m${s}\x1b[0m` : s);
const bold = (s: string) => (useColour() ? `\x1b[1m${s}\x1b[0m` : s);

function main(): void {
  if (!existsSync(EN_FILE)) {
    console.error(red(`Source locale file not found: ${EN_FILE}`));
    process.exit(1);
  }

  const isUpdate = process.argv.includes('--update');
  const keys = loadSourceKeys();
  const references = collectRepositoryReferences();

  const missing = references.filter((reference) => !keys.has(reference.key));
  const baseline = loadBaseline();
  const { newFindings, staleRows } = diffAgainstBaseline(missing, baseline);
  const current = new Set(missing.map(baselineRow));
  const fileCount = new Set(references.map((reference) => reference.path)).size;

  console.log(bold('\n=== Locale Key References ==='));
  console.log(`  Source keys     : ${bold(String(keys.size))} (src/locales/en.json)`);
  console.log(`  Key refs found  : ${bold(String(references.length))} across ${fileCount} file(s)`);
  console.log(
    `  Missing         : ${missing.length > 0 ? red(String(missing.length)) : green('0')}` +
      ` (baseline ${baseline.size})`
  );

  if (isUpdate) {
    const header = [
      '# Locale-key reference baseline - a ratchet: rows may only disappear.',
      '# Format: <path><TAB><key>',
      '# Each row is a key referenced from code that does NOT exist in',
      '# src/locales/en.json, so t()/tSync()/$t() render the literal key text at',
      '# the user. Rows are pre-existing debt: fix the call site - or add the key',
      '# to en.json and every locale - then drop the row. A new row is never a fix,',
      '# because any finding that is not listed here fails the gate.',
      '# Refresh (after shrinking) with:',
      '#   bun scripts/check-locale-key-references.ts --update',
      '',
    ];
    const rows = [...current].sort();
    writeFileSync(BASELINE_FILE, `${[...header, ...rows].join('\n')}\n`);
    console.log(
      yellow(bold(`\n  Baseline written: ${rows.length} row(s) → ${relative(ROOT, BASELINE_FILE)}`))
    );
    console.log(yellow('  Every row is a user-visible raw-key bug - shrink this list.\n'));
    process.exit(0);
  }

  if (newFindings.length === 0 && staleRows.length === 0) {
    console.log(`\n${green(bold('  Every referenced key exists in en.json. ✓'))}\n`);
    process.exit(0);
  }

  if (newFindings.length > 0) {
    console.log(`\n${red(bold(`  New missing keys (${newFindings.length}):`))}`);
    for (const finding of newFindings) {
      console.log(red(`    ${finding.path}:${finding.line}  ${finding.key}`));
    }
    console.log(red('\n  t()/tSync()/$t() return the key itself on a miss, so this renders the'));
    console.log(red('  literal key on screen in every language. Add the key to'));
    console.log(red('  src/locales/en.json (and every locale), or fix the call site.'));
  }

  if (staleRows.length > 0) {
    console.log(`\n${yellow(bold(`  Fixed baseline rows (${staleRows.length}) - remove them:`))}`);
    for (const row of staleRows) console.log(yellow(`    ${row.replace('\t', '  ')}`));
    console.log(yellow('\n  Run: bun scripts/check-locale-key-references.ts --update'));
  }

  console.log('');
  process.exit(1);
}

if (import.meta.main) main();
