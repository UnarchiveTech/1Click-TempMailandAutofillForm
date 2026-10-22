/**
 * check-suppressions.ts
 *
 * Ratchet gate for inline lint-suppression directives.
 *
 * Philosophy: diagnostics are highlighted, never silenced. The zero-warning
 * Biome gate (`check` script with --error-on-warnings) blocks diagnostics the
 * linter can still SEE - but an inline suppression comment hides a diagnostic
 * from the linter entirely, so the strict gate never notices it. This checker
 * closes that hole: every suppression directive in src/, scripts/, and tests/
 * is inventoried, and the inventory is frozen in `scripts/baselines/suppressions.txt`.
 *
 * Counts may only DECREASE:
 *   - a directive in a file that had none, or a higher per-file count than
 *     the baseline -> FAIL (exit 1);
 *   - a lower count or a fully cleaned file -> pass, with a reminder to
 *     shrink the baseline (`bun scripts/check-suppressions.ts --update`);
 *   - `--update` rewrites the baseline from the current tree (initial seed
 *     and post-cleanup shrink). It is a conscious, git-visible act: a PR that
 *     grows the baseline must justify why the diagnostic cannot be fixed.
 *
 * Recognized directive families:
 *   Biome  - file-level ("-all") and line/range-level ignore comments;
 *   Svelte - HTML ignore comments (a11y and other rules);
 *   TS     - the three TS escape hatches: blanket ignore, expect-error,
 *            per-file nocheck (none exist today; banned from introduction);
 *   ESLint - legacy disable comments (no ESLint here; banned from return).
 *
 * Deliberately out of scope (documented, compensated carve-outs, not silent):
 *   biome.json's Svelte override for the unused-import/unused-variable rules -
 *   svelte-check + tsconfig.ts-only.json enforce those instead (see the NOTE
 *   in tsconfig.json), so the diagnostics remain enforced somewhere real.
 *
 * Directive tokens are assembled from string fragments so this scanner never
 * matches its own source or its own test fixtures (the classic self-grep
 * problem) - no self-exclusion special case is needed. Keep it that way.
 *
 * Usage:
 *   bun scripts/check-suppressions.ts            # check (gate mode)
 *   bun scripts/check-suppressions.ts --update   # seed / shrink the baseline
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { collectSourceFiles, repoAbsolute } from './source-files';

const ROOT = process.cwd();
const SCAN_DIRS = ['src', 'scripts', 'tests'] as const;
const SCAN_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.svelte', '.css'];
const BASELINE_PATH = join(ROOT, 'scripts', 'baselines', 'suppressions.txt');

// ---------------------------------------------------------------------------
// Directive registry (fragment-assembled - see the docstring note above).
// ---------------------------------------------------------------------------

const FRAG_BIOME = ['biome'].join('');
const FRAG_SVELTE = ['svelte'].join('');
const FRAG_TS = ['@ts'].join('');
const FRAG_ESLINT = ['eslint'].join('');
const FRAG_IGNORE = ['-ignore'].join('');

/** Machine names for the tracked directive kinds (used in the baseline). */
export const DIRECTIVES = {
  /** File-level Biome ignore (the "-all" suffix). */
  biomeIgnoreAll: [FRAG_BIOME, FRAG_IGNORE, '-all'].join(''),
  /** Line/range-level Biome ignore (incl. the -start/-end range markers). */
  biomeIgnore: [FRAG_BIOME, FRAG_IGNORE].join(''),
  /** Svelte HTML ignore comment. */
  svelteIgnore: [FRAG_SVELTE, FRAG_IGNORE].join(''),
  /** TypeScript blanket ignore. */
  tsIgnore: [FRAG_TS, FRAG_IGNORE].join(''),
  /** TypeScript expect-error (silences today, rots tomorrow). */
  tsExpectError: [FRAG_TS, '-expect', '-error'].join(''),
  /** TypeScript per-file typecheck opt-out. */
  tsNocheck: [FRAG_TS, '-nocheck'].join(''),
  /** Legacy ESLint disable (no ESLint in this repo - banned from return). */
  eslintDisable: [FRAG_ESLINT, '-disable'].join(''),
} as const;

export type SuppressionKind = keyof typeof DIRECTIVES;

const KIND_SET: ReadonlySet<string> = new Set(Object.keys(DIRECTIVES));

export function isSuppressionKind(kind: string): kind is SuppressionKind {
  return KIND_SET.has(kind);
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * One compiled matcher per kind. The generic Biome kind uses a negative
 * lookahead so a file-level "-all" directive is counted once (as its own,
 * stricter kind) instead of twice.
 */
export const SUPPRESSION_REGEXPS: ReadonlyArray<readonly [SuppressionKind, RegExp]> = [
  ['biomeIgnoreAll', new RegExp(`${escapeRe(DIRECTIVES.biomeIgnoreAll)}\\b`, 'g')],
  ['biomeIgnore', new RegExp(`${escapeRe(DIRECTIVES.biomeIgnore)}(?!-all)\\b`, 'g')],
  ['svelteIgnore', new RegExp(`${escapeRe(DIRECTIVES.svelteIgnore)}\\b`, 'g')],
  ['tsIgnore', new RegExp(`${escapeRe(DIRECTIVES.tsIgnore)}\\b`, 'g')],
  ['tsExpectError', new RegExp(`${escapeRe(DIRECTIVES.tsExpectError)}\\b`, 'g')],
  ['tsNocheck', new RegExp(`${escapeRe(DIRECTIVES.tsNocheck)}\\b`, 'g')],
  ['eslintDisable', new RegExp(`${escapeRe(DIRECTIVES.eslintDisable)}\\b`, 'g')],
];

// ---------------------------------------------------------------------------
// Scanning (pure, unit-testable core).
// ---------------------------------------------------------------------------

export interface SuppressionHit {
  /** 1-based line number within the scanned text. */
  line: number;
  kind: SuppressionKind;
  /** Occurrences of the directive on that line. */
  count: number;
}

/** All suppression directives in a source text, in file order. */
export function findSuppressions(text: string): SuppressionHit[] {
  const hits: SuppressionHit[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const [kind, re] of SUPPRESSION_REGEXPS) {
      const count = line.match(re)?.length ?? 0;
      if (count > 0) hits.push({ line: i + 1, kind, count });
    }
  }
  return hits;
}

/** path -> kind -> total occurrences. */
export type SuppressionCounts = Map<string, Map<SuppressionKind, number>>;

export function mapAdd(
  counts: SuppressionCounts,
  path: string,
  kind: SuppressionKind,
  n: number
): void {
  const kinds = counts.get(path);
  if (kinds) kinds.set(kind, (kinds.get(kind) ?? 0) + n);
  else counts.set(path, new Map([[kind, n]]));
}

export function totalSuppressions(counts: SuppressionCounts): number {
  let total = 0;
  for (const kinds of counts.values()) for (const n of kinds.values()) total += n;
  return total;
}

// ---------------------------------------------------------------------------
// Baseline parsing / formatting.
// ---------------------------------------------------------------------------

/**
 * Parses the baseline file format: `<path> <kind> <count>` rows, `#` comments
 * and blank lines ignored. Throws on malformed rows so a typo can never
 * silently shrink the ratchet.
 */
export function parseBaseline(text: string): SuppressionCounts {
  const out: SuppressionCounts = new Map();
  for (const [idx, raw] of text.split('\n').entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts.length !== 3) {
      throw new Error(
        `scripts/baselines/suppressions.txt:${idx + 1}: expected "<path> <kind> <count>", got: ${line}`
      );
    }
    const [path, kind, countStr] = parts;
    const count = Number.parseInt(countStr, 10);
    if (!Number.isInteger(count) || count < 1) {
      throw new Error(
        `scripts/baselines/suppressions.txt:${idx + 1}: count must be a positive integer, got: ${countStr}`
      );
    }
    if (!isSuppressionKind(kind)) {
      throw new Error(
        `scripts/baselines/suppressions.txt:${idx + 1}: unknown suppression kind "${kind}"`
      );
    }
    mapAdd(out, path, kind, count);
  }
  return out;
}

/** Deterministic (sorted) baseline serialization, header comment included. */
export function formatBaseline(counts: SuppressionCounts): string {
  const rows: string[] = [];
  for (const path of [...counts.keys()].sort()) {
    const kinds = counts.get(path);
    if (!kinds) continue;
    for (const kind of [...kinds.keys()].sort()) {
      const n = kinds.get(kind);
      if (n && n > 0) rows.push(`${path} ${kind} ${n}`);
    }
  }
  const lines = [
    '# Inline lint-suppression baseline - a ratchet: counts may only decrease.',
    '# Format: <path> <kind> <count>',
    `# Kinds: ${Object.keys(DIRECTIVES).sort().join(', ')}`,
    '# check-suppressions.ts fails when a NEW directive appears or a count grows.',
    '# After fixing code (the preferred outcome), shrink rows with:',
    '#   bun scripts/check-suppressions.ts --update',
  ];
  // The blank separator exists only when there are rows for it to separate.
  // An empty baseline would otherwise end with a blank line at EOF, which
  // `git diff --check` (blank-at-eof) rejects - and `--update` would keep
  // re-introducing it. Every baseline the writer produces therefore ends with
  // exactly one newline after its last non-blank line.
  if (rows.length) lines.push('', ...rows);
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Ratchet comparison.
// ---------------------------------------------------------------------------

export interface SuppressionDiffRow {
  path: string;
  kind: SuppressionKind;
  /** Current occurrence count (0 when the file/kind was cleaned up). */
  count: number;
  /** Baseline count this is measured against. */
  baseline: number;
}

export interface BaselineDiff {
  /** Ratchet violations: new directives or grown counts. These FAIL the gate. */
  violations: SuppressionDiffRow[];
  /** Decreased counts - pass, but the baseline row should be shrunk. */
  improved: SuppressionDiffRow[];
}

export function diffAgainstBaseline(
  current: SuppressionCounts,
  baseline: SuppressionCounts
): BaselineDiff {
  const violations: SuppressionDiffRow[] = [];
  const improved: SuppressionDiffRow[] = [];
  const paths = new Set<string>([...current.keys(), ...baseline.keys()]);
  for (const path of [...paths].sort()) {
    const kinds = new Set<string>([
      ...(current.get(path)?.keys() ?? []),
      ...(baseline.get(path)?.keys() ?? []),
    ]);
    for (const kind of kinds) {
      if (!isSuppressionKind(kind)) continue; // unreachable via parseBaseline
      const now = current.get(path)?.get(kind) ?? 0;
      const base = baseline.get(path)?.get(kind) ?? 0;
      if (now > base) violations.push({ path, kind, count: now, baseline: base });
      else if (now < base) improved.push({ path, kind, count: now, baseline: base });
    }
  }
  return { violations, improved };
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------

function scanCurrentTree(): SuppressionCounts {
  // The shared lister owns the skip set: this gate used to carry its own
  // (`entry.startsWith('.') || node_modules || .output`) while the others
  // carried theirs, so the tree a finding came from depended on which gate ran.
  const files = collectSourceFiles({ dirs: SCAN_DIRS, extensions: SCAN_EXTS }).map(repoAbsolute);
  const current: SuppressionCounts = new Map();
  for (const file of files) {
    const hits = findSuppressions(readFileSync(file, 'utf8'));
    if (hits.length === 0) continue;
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    for (const hit of hits) mapAdd(current, rel, hit.kind, hit.count);
  }
  return current;
}

function main(): void {
  const update = process.argv.includes('--update');
  const current = scanCurrentTree();

  if (update) {
    writeFileSync(BASELINE_PATH, formatBaseline(current));
    console.log(
      `Baseline written: ${totalSuppressions(current)} suppression(s) across ` +
        `${current.size} file(s) -> scripts/baselines/suppressions.txt`
    );
    return;
  }

  if (!existsSync(BASELINE_PATH)) {
    console.error(
      'scripts/baselines/suppressions.txt not found. Seed it once with:\n' +
        '  bun scripts/check-suppressions.ts --update'
    );
    process.exit(1);
  }

  let baseline: SuppressionCounts;
  try {
    baseline = parseBaseline(readFileSync(BASELINE_PATH, 'utf8'));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const { violations, improved } = diffAgainstBaseline(current, baseline);

  if (improved.length > 0) {
    console.log(
      'Suppression counts DECREASED - nice. Lock it in by shrinking the baseline:\n' +
        '  bun scripts/check-suppressions.ts --update'
    );
    for (const row of improved) {
      console.log(`  ${row.path} ${row.kind}: ${row.baseline} -> ${row.count}`);
    }
  }

  if (violations.length > 0) {
    console.error(`\nNew lint-suppression directives detected (${violations.length}):`);
    for (const row of violations) {
      console.error(`  ${row.path} ${row.kind}: baseline ${row.baseline} -> now ${row.count}`);
    }
    console.error(
      '\nA suppressed diagnostic is invisible to EVERY gate - linter, CI, reviewers.\n' +
        'Fix the root cause instead. If suppression is truly unavoidable, add a row to\n' +
        'scripts/baselines/suppressions.txt (git-visible, must be justified in the PR) - never as\n' +
        'a substitute for a fix.'
    );
    process.exit(1);
  }

  console.log(
    `No new suppression directives (${totalSuppressions(current)} total across ` +
      `${current.size} file(s); ratchet holds).`
  );
}

if (import.meta.main) main();
