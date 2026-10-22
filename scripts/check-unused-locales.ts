#!/usr/bin/env bun
/**
 * Unused locale-key checker
 *
 * Fails when a key in src/locales/en.json (the source of truth) is not
 * referenced anywhere in the codebase. Dead keys accumulate after refactors
 * (renamed namespaces, replaced components, superseded copy), and every one
 * ships in all 8 locale chunks.
 *
 * A key counts as referenced when its exact dotted literal appears anywhere
 * in src/, tests/, or scripts/ - inside $t()/t()/tSync() calls, labelKey /
 * titleKey / messageKey maps, or any other quoted string. Template-literal
 * keys (e.g. `about.faq.${id}.q`, `backup.${opt.label}`,
 * `savedLoginInfo.field_${field}`) are matched by their static path
 * fragments. Messageformat plural variants (key_one / key_few / …) are kept
 * when their base key is referenced.
 *
 * Usage:
 *   bun run check-unused-locales           # exits 1 when dead keys exist
 *   bun run check-unused-locales --fix     # also prune them from all 8 locales
 *
 * --fix rewrites src/locales/{ar,de,en,es,fr,ja,th,zh}.json, removing the
 * unreferenced keys (and any containers they leave empty). Run check-translations
 * afterwards - pruning is applied identically to every locale.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectSourceFiles, repoAbsolute } from './source-files';

// ─── Configuration ────────────────────────────────────────────────────────────

const ROOT = join(import.meta.dir, '..');
const LOCALES_DIR = join(ROOT, 'src', 'locales');
const SOURCE_LOCALE = 'en';
const LOCALES = ['ar', 'de', 'en', 'es', 'fr', 'ja', 'th', 'zh'];

/**
 * File types scanned for key references.
 *
 * This gate used to be the worst offender for ignore drift: it walked the whole
 * repository with a hand-rolled skip list, so it read build output, scratch
 * directories and gitignored notes that no other gate (and not `bun run check`)
 * ever looked at. It now takes its file list from `scripts/source-files.ts`,
 * which is the same set every gate and biome share.
 */
const CODE_EXTS = ['.svelte', '.ts', '.js', '.mjs', '.cjs', '.html', '.vue', '.md'];

// ─── Reference collection ─────────────────────────────────────────────────────

/** Every dotted string literal found in the codebase (per line, quote-agnostic). */
const literals = new Set<string>();

/** Static fragments around template interpolations, e.g. `about.faq.${id}.q`. */
interface TemplateSeg {
  /** Static text before the first ${…} ('' when the template starts with one). */
  first: string;
  /** Static text after the last ${…} ('' when the template ends with one). */
  last: string;
}
const templateSegs: TemplateSeg[] = [];

/** Matches a single-line quoted string; run once per line to avoid cross-line artifacts. */
const LINE_RE = /(['"`])((?:[^'"`\\]|\\.)*)\1/g;
/** Matches a template interpolation `${...}`. */
const TPL_RE = /\$\{[^}]*\}/g;

function collectReferences(): void {
  for (const file of collectSourceFiles({ dirs: ['.'], extensions: CODE_EXTS }).map(repoAbsolute)) {
    const src = readFileSync(file, 'utf8');

    // 1. Line-scoped literal scan - every quoted string that looks like a key.
    for (const line of src.split('\n')) {
      LINE_RE.lastIndex = 0;
      for (let m = LINE_RE.exec(line); m !== null; m = LINE_RE.exec(line)) {
        const s = m[2].trim();
        if (s.length >= 2 && s.includes('.')) literals.add(s);
      }
    }

    // 2. Template-literal boundaries: split `a.${x}.b` into static fragments.
    TPL_RE.lastIndex = 0;
    for (let tm = TPL_RE.exec(src); tm !== null; tm = TPL_RE.exec(src)) {
      const start = tm.index;
      const end = tm.index + tm[0].length;
      let lt = src.lastIndexOf('`', start - 1);
      while (lt > 0 && src[lt - 1] === '\\') lt = src.lastIndexOf('`', lt - 1);
      const rt = src.indexOf('`', end);
      if (lt >= 0 && rt >= end) {
        const parts = src.slice(lt + 1, rt).split(/\$\{[^}]*\}/);
        if (parts.length >= 2) {
          const first = parts[0].trim();
          const last = parts[parts.length - 1].trim();
          if (first || last) templateSegs.push({ first, last });
        }
      }
    }
  }
}

// ─── Locale flattening ────────────────────────────────────────────────────────

type LocaleTree = Record<string, unknown>;

function flattenKeys(obj: LocaleTree, prefix = '', out: string[] = []): string[] {
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.push(full);
    else if (value !== null && typeof value === 'object')
      flattenKeys(value as LocaleTree, full, out);
  }
  return out;
}

/** Plural-suffix variants resolved by messageformat from a referenced base key. */
const PLURAL_SUFFIX = /_(one|other|few|many|two|zero)$/;

const seen = new Set<string>();

/**
 * A key is referenced when:
 *   1. its exact dotted literal appears anywhere, or
 *   2. it matches the static fragments of a template-literal key
 *      (prefix must end with '.' or '_', suffix must start with '.' -
 *      bare-alnum tails like `${r}s` do NOT anchor anything), or
 *   3. it is a messageformat plural variant of a referenced base key.
 */
function isReferenced(key: string): boolean {
  if (seen.has(key)) return true;
  if (literals.has(key)) {
    seen.add(key);
    return true;
  }
  for (const { first, last } of templateSegs) {
    if (first && /\.|_$/.test(first)) {
      if (last && key.startsWith(first) && key.endsWith(last)) {
        seen.add(key);
        return true;
      }
      if (!last && key.startsWith(first)) {
        seen.add(key);
        return true;
      }
    } else if (last.startsWith('.')) {
      if (first && key.startsWith(first) && key.endsWith(last)) {
        seen.add(key);
        return true;
      }
      if (!first && key.endsWith(last)) {
        seen.add(key);
        return true;
      }
    }
  }
  const pm = key.match(PLURAL_SUFFIX);
  if (pm) {
    const base = key.slice(0, key.length - pm[1].length - 1);
    if (isReferenced(base)) {
      seen.add(key);
      return true;
    }
  }
  return false;
}

// ─── Pruning (--fix) ──────────────────────────────────────────────────────────

function removeKeys(obj: LocaleTree, prefix: string, dead: Set<string>): string[] {
  const removed: string[] = [];
  for (const k of Object.keys(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    const value = obj[k];
    if (typeof value === 'string') {
      if (dead.has(full)) {
        delete obj[k];
        removed.push(full);
      }
    } else if (value !== null && typeof value === 'object') {
      removed.push(...removeKeys(value as LocaleTree, full, dead));
      if (Object.keys(value as Record<string, unknown>).length === 0) delete obj[k];
    }
  }
  return removed;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const useColour = process.stdout.isTTY;
const red = (s: string) => (useColour ? `\x1b[31m${s}\x1b[0m` : s);
const green = (s: string) => (useColour ? `\x1b[32m${s}\x1b[0m` : s);
const yellow = (s: string) => (useColour ? `\x1b[33m${s}\x1b[0m` : s);
const bold = (s: string) => (useColour ? `\x1b[1m${s}\x1b[0m` : s);

const isFix = process.argv.includes('--fix');

const enFile = join(LOCALES_DIR, `${SOURCE_LOCALE}.json`);
if (!existsSync(enFile)) {
  console.error(red(`Source locale file not found: ${enFile}`));
  process.exit(1);
}

const enTree = JSON.parse(readFileSync(enFile, 'utf8')) as LocaleTree;
const allKeys = flattenKeys(enTree).sort();

collectReferences();

const unused = allKeys.filter((k) => !isReferenced(k));

console.log(bold('\n=== Unused Locale Keys ==='));
console.log(`  Locale keys     : ${bold(String(allKeys.length))}`);
console.log(`  Literal refs    : ${bold(String(literals.size))}`);
console.log(`  Template pats   : ${bold(String(templateSegs.length))}`);
console.log(`  Unused          : ${unused.length > 0 ? red(String(unused.length)) : green('0')}`);

if (unused.length === 0) {
  console.log(`\n${green(bold('  Every locale key is referenced. ✓'))}\n`);
  process.exit(0);
}

console.log(`\n  Unreferenced keys (${unused.length}):`);
for (const k of unused) console.log(red(`    - ${k}`));

if (!isFix) {
  console.log(
    yellow(
      `\n  Run "bun run check-unused-locales --fix" to prune them from all ${LOCALES.length} locales.`
    )
  );
  process.exit(1);
}

// --fix: prune identically from every locale so key parity is preserved.
const dead = new Set(unused);
let totalRemoved = 0;
for (const locale of LOCALES) {
  const file = join(LOCALES_DIR, `${locale}.json`);
  const tree = JSON.parse(readFileSync(file, 'utf8')) as LocaleTree;
  const removed = removeKeys(tree, '', dead);
  writeFileSync(file, `${JSON.stringify(tree, null, 2)}\n`);
  totalRemoved += removed.length;
  console.log(`  ${locale.padEnd(6)} removed ${removed.length}`);
}
console.log(`\n${yellow(bold(`  Pruned ${totalRemoved} keys across ${LOCALES.length} locales.`))}`);
console.log(yellow(`  Re-run "bun run check-translations" to confirm key parity.`));
process.exit(1);
