#!/usr/bin/env bun
/**
 * check-undo-guards.ts
 *
 * Ratchet gate for toast undo offers: every toast registered with an undo
 * callback must either check the shared stale-generation guard
 * (`isUndoCurrent(...)`, src/utils/storage/undo-generation.ts) inside that
 * callback, or be an entry in `scripts/baselines/undo-guards.txt` with a reason.
 *
 * WHY. An undo callback that restores a storage snapshot is only meaningful
 * while the state it describes is still the newest state. The delete-undo,
 * the import-undo and the domain-switch undo all route through the shared
 * revision counter for exactly this reason - but nothing stopped a NEW undo
 * flow from shipping without one, reviving the exact clobber bug the counter
 * exists to prevent (delete A, do newer work, click A's still-visible Undo,
 * newer work silently walked back). This gate closes that: a new toast
 * carrying an undo callback FAILS until it names the guard or the baseline
 * documents why it does not need one (diff-based undos over fresh state,
 * action buttons that are not undos, plumbing pass-throughs).
 *
 * WHAT COUNTS AS A REGISTRATION
 *
 * A call whose callee routes an argument into an undo position:
 *   showToast / setShowToast        (message, type, UNDO, actionLabel)
 *   toastStore.success|warning|info|error  (message, duration, UNDO)
 *   toastStore.add                  (type, message, duration, UNDO, label)
 * where that argument is a function literal, or an identifier that resolves
 * to a same-file `const NAME = (...) => ...` / `function NAME(...)` - or any
 * other non-null expression, which counts conservatively as UNGUARDED
 * (an unknown expression may be a callback; the scanner cannot see through
 * it, so the site must be baselined to ship).
 *
 * WHAT COUNTS AS GUARDED
 *
 * The callback body (the literal, or the const/function body the identifier
 * resolves to in the same file) calls `isUndoCurrent(...)`. The gate cannot
 * see cross-file helpers or guards wrapped in further indirection - such a
 * site lands in the baseline with its reason, which is the visible exception
 * this repo's ratchets prefer over a silent bypass.
 *
 * Baseline rows: `<path> <count> # reason` - counts may only decrease.
 * After guarding a site (the preferred outcome), shrink the row with
 * `bun scripts/check-undo-guards.ts --update` (reasons are preserved).
 *
 * Usage:
 *   bun scripts/check-undo-guards.ts            # check (gate mode)
 *   bun scripts/check-undo-guards.ts --update   # seed / shrink the baseline
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { segmentsOfText } from './check-storage-namespace-drift';
import { collectAbsoluteFiles, REPO_ROOT } from './source-files';

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, 'src');
const BASELINE_PATH = join(ROOT, 'scripts', 'baselines', 'undo-guards.txt');

/**
 * Callee method name -> index of the undo-callback parameter, matching the
 * canonical toast signatures (use-toast.ts ToastFn, toastStore.ts, and the
 * `setShowToast`/`showToast` contract fields built on them).
 */
const UNDO_POSITIONS: Readonly<Record<string, number>> = {
  showToast: 2,
  setShowToast: 2,
  success: 2,
  warning: 2,
  info: 2,
  error: 2,
  add: 3,
};

/** The shared guard's name - a callback is "guarded" when its body calls it. */
export const GUARD_NAME = 'isUndoCurrent';

// ---------------------------------------------------------------------------
// Scanning (pure, unit-testable core).
// ---------------------------------------------------------------------------

export interface UndoRegistration {
  /** 1-based line number within the FULL file text (segment offset included). */
  line: number;
  /** Callee spelling as written (`toastStore.add`, `deps.showToast`, …). */
  callee: string;
  /** True when the callback body (or its same-file resolution) calls the guard. */
  guarded: boolean;
}

function callsGuard(body: ts.Node): boolean {
  let found = false;
  const walk = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === GUARD_NAME
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, walk);
  };
  walk(body);
  return found;
}

/** Is the argument syntactically "no callback here"? (null / undefined) */
function isAbsentArg(arg: ts.Expression): boolean {
  // ts.isNullLiteral was removed in TS 6 - match the kind directly.
  return (
    arg.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(arg) && arg.text === 'undefined')
  );
}

/**
 * Same-file callable map: `const NAME = (...) => ...` / `let NAME = ...` /
 * `function NAME(...)`, at any nesting depth. Callbacks merely passed through
 * parameters (plumbing) do NOT resolve, so they read as unguarded - a
 * documented baseline row rather than a special case.
 */
export function collectCallables(sf: ts.SourceFile): Map<string, ts.Node> {
  const out = new Map<string, ts.Node>();
  const scan = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = node.initializer;
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        out.set(node.name.text, init);
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name) {
      out.set(node.name.text, node);
    }
    ts.forEachChild(node, scan);
  };
  scan(sf);
  return out;
}

/** Scan one already-split segment; `lineOffset` = newlines before it. */
export function findUndoRegistrations(text: string, lineOffset: number): UndoRegistration[] {
  const sf = ts.createSourceFile(
    'segment.ts',
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const callables = collectCallables(sf);
  const out: UndoRegistration[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name.text
        : ts.isIdentifier(node.expression)
          ? node.expression.text
          : undefined;
      const undoIdx = name !== undefined ? UNDO_POSITIONS[name] : undefined;
      if (undoIdx !== undefined) {
        const arg = node.arguments[undoIdx] as ts.Expression | undefined;
        if (arg && !isAbsentArg(arg)) {
          let body: ts.Node | undefined;
          if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
            body = arg.body;
          } else if (ts.isIdentifier(arg)) {
            const resolved = callables.get(arg.text);
            if (resolved) {
              body = ts.isFunctionDeclaration(resolved)
                ? resolved.body
                : (resolved as ts.ArrowFunction).body;
            }
          }
          // Parenthesized / conditional callbacks and unknown identifiers are
          // conservatively UNGUARDED: the gate cannot see through them.
          const guarded = body ? callsGuard(body) : false;
          const callee = ts.isPropertyAccessExpression(node.expression)
            ? node.expression.getText(sf)
            : (name ?? '(call)');
          out.push({
            line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1 + lineOffset,
            callee,
            guarded,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export interface FileFinding {
  path: string;
  line: number;
  callee: string;
}

/**
 * Scan one repo file (TS/JS whole text, Svelte per <script> block). Finding
 * paths are repo-relative with forward slashes on every OS, matching the
 * baseline files (`scripts/baselines/*.txt`), so every consumer - the CLI
 * and the unit test alike - keys the counts identically.
 */
export async function scanFile(path: string): Promise<FileFinding[]> {
  const rel = relative(REPO_ROOT, resolve(path)).split(sep).join('/');
  const text = await Bun.file(path).text();
  const isSvelte = path.endsWith('.svelte');
  const findings: FileFinding[] = [];
  for (const seg of segmentsOfText(text, isSvelte)) {
    const lineOffset = (text.slice(0, seg.offset).match(/\n/g) ?? []).length;
    for (const reg of findUndoRegistrations(seg.text, lineOffset)) {
      if (!reg.guarded) {
        findings.push({ path: rel, line: reg.line, callee: reg.callee });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Baseline parsing / formatting (path <count> # reason rows).
// ---------------------------------------------------------------------------

export interface BaselineRow {
  count: number;
  reason: string;
}

export function parseBaseline(text: string): Map<string, BaselineRow> {
  const out = new Map<string, BaselineRow>();
  for (const [idx, raw] of text.split('\n').entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(\S+)\s+(\d+)(?:\s+#\s*(.*))?$/);
    if (!m?.[1] || !m[2]) {
      throw new Error(
        `scripts/baselines/undo-guards.txt:${idx + 1}: expected "<path> <count> [# reason]", got: ${line}`
      );
    }
    const count = Number.parseInt(m[2], 10);
    if (!Number.isInteger(count) || count < 1) {
      throw new Error(
        `scripts/baselines/undo-guards.txt:${idx + 1}: count must be a positive integer`
      );
    }
    out.set(m[1], { count, reason: m[3] ?? '' });
  }
  return out;
}

/** path -> unguarded registration count. */
export type FindingCounts = Map<string, number>;

export function countFindings(findings: readonly FileFinding[]): FindingCounts {
  const out: FindingCounts = new Map();
  for (const f of findings) out.set(f.path, (out.get(f.path) ?? 0) + 1);
  return out;
}

export interface UndoGuardDiff {
  /** New files, or files with MORE unguarded registrations than baselined. */
  violations: Array<{ path: string; count: number; baseline: number }>;
  /** Files whose count dropped - pass, but the row should shrink. */
  improved: Array<{ path: string; count: number; baseline: number }>;
}

export function diffAgainstBaseline(
  current: FindingCounts,
  baseline: Map<string, BaselineRow>
): UndoGuardDiff {
  const violations: UndoGuardDiff['violations'] = [];
  const improved: UndoGuardDiff['improved'] = [];
  for (const [path, count] of [...current].sort()) {
    const base = baseline.get(path)?.count ?? 0;
    if (count > base) violations.push({ path, count, baseline: base });
    else if (baseline.has(path) && count < base) improved.push({ path, count, baseline: base });
  }
  for (const [path, row] of [...baseline].sort()) {
    if (!current.has(path)) improved.push({ path, count: 0, baseline: row.count });
  }
  return { violations, improved };
}

/** Deterministic serialization; existing reasons survive an --update rewrite. */
export function formatBaseline(current: FindingCounts, previous: Map<string, BaselineRow>): string {
  const lines = [
    '# Toast-undo ratchet baseline - a ratchet: counts may only decrease.',
    '# Format: <path> <count> # reason',
    '# check-undo-guards.ts fails when a NEW toast carries an undo callback',
    '# without an isUndoCurrent(...) guard inside that callback.',
    '# After guarding a site (the preferred outcome), shrink rows with:',
    '#   bun scripts/check-undo-guards.ts --update',
  ];
  const rows: string[] = [];
  for (const path of [...current.keys()].sort()) {
    const count = current.get(path) ?? 0;
    if (count <= 0) continue;
    const reason = previous.get(path)?.reason;
    rows.push(reason ? `${path} ${count} # ${reason}` : `${path} ${count}`);
  }
  if (rows.length) lines.push('', ...rows);
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const update = process.argv.includes('--update');
  const files = collectAbsoluteFiles(SRC_DIR, ['.ts', '.tsx', '.js', '.jsx', '.svelte']);

  const findings: FileFinding[] = [];
  for (const file of files) {
    findings.push(...(await scanFile(file)));
  }
  const current = countFindings(findings);

  if (update) {
    const previous = existsSync(BASELINE_PATH)
      ? parseBaseline(readFileSync(BASELINE_PATH, 'utf8'))
      : new Map<string, BaselineRow>();
    writeFileSync(BASELINE_PATH, formatBaseline(current, previous));
    console.log(
      `scripts/baselines/undo-guards.txt written: ${findings.length} unguarded registration(s) across ${current.size} file(s).`
    );
    return 0;
  }

  if (!existsSync(BASELINE_PATH)) {
    console.error(
      'scripts/baselines/undo-guards.txt is missing - run `bun scripts/check-undo-guards.ts --update` to seed it, then review every row.'
    );
    return 1;
  }

  const baseline = parseBaseline(readFileSync(BASELINE_PATH, 'utf8'));
  const { violations, improved } = diffAgainstBaseline(current, baseline);

  if (violations.length > 0) {
    console.error('New or grown unguarded toast-undo registrations - guard them with');
    console.error(`isUndoCurrent(...) (${GUARD_NAME} in src/utils/storage/undo-generation.ts)`);
    console.error('or justify a baseline row with a reason:\n');
    for (const v of violations) {
      const rows = findings.filter((f) => f.path === v.path);
      for (const r of rows) {
        console.error(
          `  ${r.path}:${r.line}  ${r.callee}(...) undo callback has no ${GUARD_NAME} guard`
        );
      }
      if (rows.length === 0)
        console.error(`  ${v.path}: (count ${v.count} > baseline ${v.baseline})`);
    }
    return 1;
  }

  if (improved.length > 0) {
    console.log(
      `Improved (shrink the baseline with --update): ${improved
        .map((i) => `${i.path} ${i.baseline}→${i.count}`)
        .join(', ')}`
    );
  }

  console.log(
    `Undo-guard ratchet holds: ${findings.length} unguarded registration(s), all baselined; 0 new.`
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
