/**
 * check-layer-tokens.ts
 *
 * Pre-commit / CI guard that stops overlay z-index and surface elevation from
 * drifting back to ad-hoc literals. Flags, in `.svelte` files only:
 *
 *   1. Raw Tailwind z-index utilities (`z-10000`, `z-[9000]`, …) whose value
 *      matches one of the overlay layers defined in `src/utils/ui/portal-layers.ts`
 *      (`PORTAL_Z` / `PORTAL_Z_CLASS`). Low local-stacking values (`z-0`,
 *      `z-10`, `z-20`, `z-30`) and deliberate off-scale offsets (`z-[140]`,
 *      `z-[10051]`) are intentionally not matched.
 *   2. Raw `shadow-sm` / `shadow-md` / `shadow-lg` utilities that should use
 *      the `ELEVATION` tokens from `src/utils/ui/elevation.ts`.
 *
 * `<style>` blocks are skipped, and comment bodies are blanked up front by the
 * shared `./source-lexer`, so prose like "portaled above z-10000" is never
 * mistaken for a utility class - whatever comment syntax it hides in. Zero
 * suppression: every file is scanned, and there is no `.layer-token-ignore`
 * (a path-level allowlist would only park the debt). The only files skipped are
 * the ones `.gitignore` covers, through `scripts/source-files.ts`, so this gate
 * and `bun run check` agree on what exists.
 *
 * Usage: bun scripts/check-layer-tokens.ts
 */

import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { collectAbsoluteFiles } from './source-files';
import { stripComments } from './source-lexer';

const SRC_DIR = join(process.cwd(), 'src');

/**
 * Numeric overlay layers from `PORTAL_Z` in `src/utils/ui/portal-layers.ts`.
 * Keep this set in sync when a layer is added, removed, or re-numbered.
 */
const PORTAL_Z_VALUES = new Set([
  40, 50, 100, 110, 140, 2000, 5000, 9000, 10000, 10001, 10050, 100000, 110000,
]);

/** `z-10000` / `z-[9000]` - group 1 is the digits. */
const Z_RE = /\bz-\[?([0-9]+)\]?/g;

/** The three MD3 surface-elevation utilities owned by ELEVATION. */
const SHADOW_RE = /\bshadow-(sm|md|lg)\b/g;

const findings: string[] = [];

function report(file: string, lineNo: number, kind: string, value: string): void {
  findings.push(`${relative(process.cwd(), file)}:${lineNo}: ${kind}: ${value}`);
}

function scanFile(file: string): void {
  // Comment bodies are blanked first (shared lexer), so prose that happens to
  // name a token - in whatever comment syntax - can no longer be reported, and
  // `/*` inside markup (e.g. accept="image/*") was never a comment to begin with.
  const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
  let inStyle = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Enter the <style> region: the tokens below are Tailwind classes in markup
    // and script, so a matching token inside a stylesheet is not a class name.
    if (/<style\b/.test(line) && !/<\/style>/.test(line)) inStyle = true;

    if (!inStyle) {
      for (const m of line.matchAll(Z_RE)) {
        const value = Number(m[1]);
        if (PORTAL_Z_VALUES.has(value)) {
          report(file, i + 1, 'z-index', m[0]);
        }
      }
      for (const m of line.matchAll(SHADOW_RE)) {
        report(file, i + 1, 'shadow', m[0]);
      }
    }

    if (/<\/style>/.test(line)) inStyle = false;
  }
}

function main(): void {
  const files = collectAbsoluteFiles(SRC_DIR, ['.svelte']);

  // Zero-suppression policy: every file is scanned - there is no ignore list.
  for (const file of files) scanFile(file);

  if (findings.length > 0) {
    console.error(`Raw overlay z-index / shadow literals detected (${findings.length}):`);
    for (const f of findings) console.error(`  ${f}`);
    console.error('\nUse PORTAL_Z_CLASS (z-index) and ELEVATION (shadows).');
    process.exit(1);
  }
  console.log('No raw overlay z-index or shadow literals found in .svelte files.');
}

main();
