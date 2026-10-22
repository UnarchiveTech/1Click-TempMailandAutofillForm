/**
 * check-state-layers.ts
 *
 * Pre-commit / CI guard that pins the MD3 state-layer ladder on every
 * interactive `<button>` in `.svelte` files. Any button that declares a
 * hover state layer (`hover:bg-…` / `hover:brightness-…`) MUST also declare
 * a pressed state layer (`active:bg-…` / `active:brightness-…`) - pressing
 * must look at least as strong as hovering, per the MD3 state-layer spec.
 *
 * Scope: real `<button>` elements. Icon buttons, chips, pills, text buttons,
 * and tonal cards-that-are-buttons are all in scope; `role="button"` divs and
 * static elements are out (the class-string heuristic cannot see semantics).
 *
 * The check is idiom-agnostic about WHICH pressed treatment a button uses:
 *   - opacity washes step +20 (`hover:bg-X/40` → `active:bg-X/60`)
 *   - 100% container fills use the `md-*-container-pressed` tokens from
 *     `src/styles.css` `@theme` (never a re-derived color-mix at the call site)
 *   - sidebar-style `color-mix` washes ladder 8% hover → 12% press
 *   - full-solid fills / brightness-up hovers press via `active:brightness-95`
 *     (a visible darken that works on any fill in any theme)
 *
 * `--fix` codemod: inserts the paired pressed class after every hover token
 * that lacks one, using `pressedTreatmentFor()`. Re-run the check after a fix
 * pass; anything it could not treat mechanically is reported.
 *
 * Zero suppression: every `.svelte` file is scanned - no gate-level ignore list.
 * The one thing skipped is what `.gitignore` covers, resolved through
 * `scripts/source-files.ts` so every gate skips the identical set.
 *
 *
 * Usage: bun scripts/check-state-layers.ts [--fix]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { collectAbsoluteFiles } from './source-files';
import { stripComments } from './source-lexer';

const SRC_DIR = join(process.cwd(), 'src');

/** One finding: file, line, and the button's own class attribute text. */
export interface StateLayerViolation {
  file: string;
  line: number;
  /** The full class="…" payload that failed, for actionable output. */
  classes: string;
}

/**
 * A class="…" attribute payload (the text between the quotes). A negated
 * character class (`[^"]`) matches newlines too - unlike `.` - so attributes
 * that biome wraps across lines are fully captured. Svelte forbids a raw `"`
 * inside a double-quoted attribute value (interpolations use single quotes),
 * so the next `"` always ends the value. Interpolations are kept verbatim:
 * the predicate scans are literal-substring checks and `${…}` never contains
 * `hover:bg-` / `active:bg-` prefixes.
 */
const CLASS_ATTR_RE = /class="([^"]*)"/g;

/**
 * Hover state layer: a background wash or a brightness shift. The separator
 * before the token (whitespace, quote, or brace) is CAPTURED and written back -
 * dropping it glues the pressed class to the neighboring Svelte token
 * (`py-1.5hover:bg-…`). The token value itself stops before quotes/braces so
 * Svelte ternary syntax (`'`, `}`) is never swallowed - the codemod inserts
 * the pressed class between the token and whatever Svelte syntax follows it.
 */
const HOVER_RE = /(^|[\s'"}])(hover:(?:bg|brightness)-[^\s'"}]+)/g;

/** Pressed state layer: same two families as hover. */
const PRESSED_RE = /(?:^|\s)active:(bg|brightness)-\S/;

/** Declares a hover state layer. */
export function hasHoverState(classes: string): boolean {
  return /(?:^|\s)hover:(bg|brightness)-\S/.test(classes);
}

/** Declares a pressed state layer (any `active:bg-…` / `active:brightness-…`). */
export function hasPressedState(classes: string): boolean {
  return PRESSED_RE.test(classes);
}

/**
 * The MD3 pressed treatment for a given hover wash token (the text after
 * `hover:`), or null when the wash has no mechanical mapping (the call site
 * must choose one by hand - reported, never guessed wrong).
 *
 *   opacity washes  → +20, capped (at the 100% cap: brightness-95)
 *   *-container fills → the `md-*-container-pressed` tokens
 *   other solid fills → brightness-95
 *   color-mix 8% ladder → the 12% press half
 *   brightness-up hovers → brightness-95
 */
export function pressedTreatmentFor(hoverToken: string): string | null {
  // Brightness hovers: 110 / 105 (glass/lighten) press DOWN to 95.
  const brightness = hoverToken.match(/^brightness-(\d+)/);
  if (brightness) return 'active:brightness-95';

  const bg = hoverToken.match(/^bg-(.+)$/);
  if (!bg) return null;
  const value = bg[1];

  // Arbitrary color-mix ladder: the sidebar idiom is 8% hover → 12% press.
  // The var() wrapper is part of the emitted class - Tailwind arbitrary values
  // are raw CSS, so `in_srgb,--md-x_12%` would be an invalid color function.
  const mix = value.match(/^\[color-mix\(in_srgb,var\((--md-[a-z-]+)\)_(\d+)%,transparent\)\]$/);
  if (mix) {
    const [, tokenVar, pct] = mix;
    return `active:bg-[color-mix(in_srgb,var(${tokenVar})_${Number(pct) + 4}%,transparent)]`;
  }

  // Container fills get their dedicated pressed tokens (single definition in
  // src/styles.css @theme - call sites never re-derive the color-mix).
  const container = value.match(/^(md-(?:primary|secondary|tertiary|error)-container)$/);
  if (container) return `active:bg-${container[1]}-pressed`;

  // Opacity washes: +20, capped at 100%. At the cap a stronger opacity does
  // not exist, so the press darkens the full fill via brightness instead.
  const opacity = value.match(/^(md-[a-z-]+)\/(\d{1,3})$/);
  if (opacity) {
    const [, color, pct] = opacity;
    const next = Number(pct) + 20;
    return next <= 100 ? `active:bg-${color}/${next}` : 'active:brightness-95';
  }

  // Remaining solid fills (md-primary, md-surface, md-surface-container,
  // md-outline-variant, …): press darkens via brightness.
  if (/^md-[a-z-]+$/.test(value)) return 'active:brightness-95';

  return null;
}

/**
 * The violation predicate for one class payload: a hover state layer with no
 * pressed state layer. Element awareness lives in findStateLayerViolations
 * (only real <button> elements are candidates).
 */
export function isStateLayerViolation(classes: string): boolean {
  return hasHoverState(classes) && !hasPressedState(classes);
}

/** The innermost open element for a source offset ('button', 'div', …). */
function enclosingTag(
  tags: Array<{ idx: number; close: boolean; name: string }>,
  offset: number
): string | null {
  for (let k = tags.length - 1; k >= 0; k--) {
    if (tags[k].idx < offset) return tags[k].close ? null : tags[k].name;
  }
  return null;
}

function tagPositions(source: string): Array<{ idx: number; close: boolean; name: string }> {
  return [...source.matchAll(/<(\/?)([a-zA-Z][\w-]*)/g)].map((m) => ({
    idx: m.index as number,
    close: m[1] === '/',
    name: m[2].toLowerCase(),
  }));
}

/**
 * Pure core: every violating button class payload in a source string, in
 * order. Comment bodies are blanked by the caller; the input here is already
 * comment-free, <style>-free source.
 */
export function findStateLayerViolations(source: string): Array<{ line: number; classes: string }> {
  const violations: Array<{ line: number; classes: string }> = [];
  const tags = tagPositions(source);
  for (const m of source.matchAll(CLASS_ATTR_RE)) {
    const classes = m[1];
    if (!isStateLayerViolation(classes)) continue;
    if (enclosingTag(tags, m.index as number) !== 'button') continue;
    const line = source.slice(0, m.index).split('\n').length;
    violations.push({ line, classes: classes.replace(/\s+/g, ' ').trim() });
  }
  return violations;
}

/**
 * Codemod: insert the paired pressed class after every hover token in the
 * payload that lacks one. Multi-branch ternaries are handled token-by-token -
 * each branch's hover gets its own press. Returns the rewritten source and
 * the number of insertions.
 */
export function applyPressedTreatments(source: string): { source: string; insertions: number } {
  let insertions = 0;
  const rewritten = source.replace(CLASS_ATTR_RE, (attr, classes: string) => {
    if (!isStateLayerViolation(classes)) return attr;
    const fixed = classes.replace(HOVER_RE, (_full, sep: string, token: string) => {
      const hoverValue = token.replace(/^hover:/, '');
      const treatment = pressedTreatmentFor(hoverValue);
      if (!treatment) return `${sep}${token}`;
      insertions += 1;
      return `${sep}${token} ${treatment}`;
    });
    return `class="${fixed}"`;
  });
  return { source: rewritten, insertions };
}

/** Comment-free, <style>-free source for a file. */
function scanSource(file: string): string {
  return scanSourceOf(readFileSync(file, 'utf8'));
}

function report(findings: StateLayerViolation[]): never {
  console.error(`Buttons missing the MD3 pressed state-layer step (${findings.length}):`);
  for (const f of findings) {
    console.error(`  ${relative(process.cwd(), f.file)}:${f.line}`);
    console.error(`    ${f.classes}`);
  }
  console.error(
    '\nMD3 state ladder: every hover state layer MUST be paired with a pressed one -\n' +
      '  - opacity washes: hover:bg-X/40 → active:bg-X/60 (+20; at the 100% cap use active:brightness-95)\n' +
      '  - 100% container fills: active:bg-md-{primary,secondary}-container-pressed\n' +
      '    (tokens in src/styles.css @theme - do not re-derive the color-mix)\n' +
      '  - sidebar-style color-mix washes: 8% hover → 12% press\n' +
      '  - solid fills / brightness-up hovers: active:brightness-95\n' +
      'Run `bun scripts/check-state-layers.ts --fix` to apply the standard treatments.'
  );
  process.exit(1);
}

function main(): void {
  const fix = process.argv.includes('--fix');
  const files = collectAbsoluteFiles(SRC_DIR, ['.svelte']);

  const findings: StateLayerViolation[] = [];
  let totalInsertions = 0;
  for (const file of files) {
    const found = findStateLayerViolations(scanSource(file));
    if (found.length === 0) continue;

    if (!fix) {
      for (const v of found) findings.push({ file, line: v.line, classes: v.classes });
      continue;
    }

    // Codemod runs on the RAW file text: the rewrite only touches class="…"
    // payloads that violate the rule, so comments, <style> blocks, and all
    // other markup stay byte-identical.
    const raw = readFileSync(file, 'utf8');
    const { source: fixed, insertions } = applyPressedTreatments(raw);
    const remaining = findStateLayerViolations(scanSourceOf(fixed));
    if (remaining.length === 0) {
      writeFileSync(file, fixed);
      totalInsertions += insertions;
      console.log(`fixed ${relative(process.cwd(), file)} (${insertions} pressed steps added)`);
    } else {
      // Some washes have no mechanical treatment - report them for hand-fixing.
      for (const v of remaining) findings.push({ file, line: v.line, classes: v.classes });
    }
  }

  if (findings.length > 0) report(findings);

  if (fix) {
    console.log(
      `All buttons now carry the MD3 pressed state layer (${totalInsertions} insertions).`
    );
  } else {
    console.log('Every button pairs its hover state layer with a pressed one.');
  }
}

/** Comment-free, <style>-free view of an arbitrary source string. */
function scanSourceOf(source: string): string {
  return stripComments(source)
    .split(/(<style\b[^>]*>[\s\S]*?<\/style>)/g)
    .filter((chunk) => !chunk.startsWith('<style'))
    .join('');
}

// CLI entry only - unit tests import the pure core above.
if (import.meta.main) main();
