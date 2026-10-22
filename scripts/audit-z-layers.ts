/**
 * audit-z-layers.ts - is the app's stacking order ONE scale, or a pile of numbers?
 *
 * Every overlay in the extension competes with every other one, so the order is
 * declared in one place: `PORTAL_Z` (extension UI) and `CONTENT_Z` (the injected
 * page UI, a separate document). A number written at a call site is invisible to
 * that scale - it cannot be reordered with the rest of the app, it can silently
 * claim a layer a second time, and it can sit BELOW the layer it has to beat.
 *
 * The bug this audit exists for: the language selector in Settings appeared
 * behind the floating nav island. Its own number was never the problem (menu 50
 * vs the island's 30) - `.view-crossfade`, the wrapper around every view, kept a
 * `transform` from its entry animation (`animation: … both`), which made it a
 * permanent STACKING CONTEXT, and a stacking context is a jail: the island is a
 * SIBLING of the view shell, so no z-index inside the shell could ever paint
 * above it. A number only works when no ancestor is a stacking context, which is
 * why this audit reads the animations too and not just the numbers.
 *
 * What it reports:
 *
 *   1. INVENTORY - every z-index site under `src/` (a `z-index:` declaration, a
 *      `z-N` / `z-[N]` utility, including TS-injected cssText), classified:
 *        scale   - the value names a member of PORTAL_Z / CONTENT_Z
 *        local   - a literal below the first overlay layer: inside ONE
 *                  component's own box (avatar stacks, notches, dividers,
 *                  a portaled dialog's own internals)
 *        dynamic - an expression the scanner cannot resolve (`{4 - i}`)
 *   2. FINDINGS
 *        UNSOURCED-LAYER    a literal at or above `PORTAL_Z.chrome` that does not
 *                           name a layer - chrome is the last local value; every
 *                           overlay above it must be reorderable with the scale
 *        MENU-BELOW-CHROME  a flyout/menu surface carrying a local literal, so
 *                           no value it can be given puts it above the nav island
 *        STACKING-TRAP      an animation with a RETAINING fill (`both` /
 *                           `forwards`) that animates `transform` at all - the
 *                           retained value is an identity MATRIX, not the
 *                           `none` keyword, so it is a permanent stacking
 *                           context even when the final keyframe omits it
 *        SCALE-ORDER        the documented ordering is not strictly ascending
 *        CLASS-DRIFT        a `PORTAL_Z_CLASS` fragment disagrees with its layer
 *   3. The stack itself, low → high, printed so a reviewer reads the ordering off
 *      this command's own output instead of trusting the table.
 *
 * The trap rule is filled in from the built extension: with `both`, Chrome kept
 * `matrix(1, 0, 0, 1, 0, 0)` on `.view-crossfade` after the animation finished -
 * an identity transform, which orders and contains exactly like a real one. The
 * rule therefore keys on the FILL MODE and on whether `transform` is animated at
 * all, not on what the `to` block happens to declare.
 *
 * `--strict` exits 1 on any finding (this is what `bun run audit` runs).
 *
 * Usage: bun scripts/audit-z-layers.ts [--strict]
 */

import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { CONTENT_Z, PORTAL_Z, PORTAL_Z_CLASS } from '../src/utils/ui/portal-layers.js';
import { collectAbsoluteFiles } from './source-files';
import { stripComments } from './source-lexer';

const PROJECT_ROOT = process.cwd();
const SRC_DIR = join(PROJECT_ROOT, 'src');

/** The scale's own home: its literals ARE the definition, not a call site. */
export const SCALE_FILES = ['src/utils/ui/portal-layers.ts'];

/**
 * The order the extension UI claims to hold, low → high. Asserted strictly
 * ascending; layers that deliberately TIE (splitOverlay = menu, marquee =
 * navMenu) are left out, because a tie is not an ordering claim.
 */
export const ORDER = [
  'chrome',
  'accountSelector',
  'menu',
  'navMenu',
  'accountMenu',
  'offlineBanner',
  'toast',
  'dialog',
  'dialogMenu',
  'tour',
  'tooltip',
  'viewportRestriction',
] as const;

export type Rule =
  | 'UNSOURCED-LAYER'
  | 'MENU-BELOW-CHROME'
  | 'STACKING-TRAP'
  | 'EXIT-ANIMATION-STALE'
  | 'SCALE-ORDER'
  | 'CLASS-DRIFT';

export interface Site {
  file: string;
  line: number;
  kind: 'css' | 'class';
  /** The value exactly as written: `30`, `PORTAL_Z.chrome`, `{4 - i}`. */
  value: string;
  /** The numeric layer for a static value, else null (dynamic / named). */
  layer: number | null;
  /** True when the value names a member of the scale. */
  sourced: boolean;
  /** The line the site sits on, trimmed. */
  snippet: string;
}

export interface Finding {
  rule: Rule;
  file: string;
  line: number;
  detail: string;
}

/**
 * Exit animations whose retained final pose IS the effect - the element is gone
 * immediately after, so it never holds an overlay. Anything else that retains a
 * transform is a trap.
 */
export const EXIT_ANIMATIONS: { name: string; reason: string }[] = [
  {
    name: 'email-row-exit',
    reason: 'the retained pose is the exit itself; the row is removed on the next tick',
  },
];

/** Committed entry animations that need no transform in their final keyframe. */
const RETAINING_FILLS = /\b(both|forwards)\b/;

/**
 * A flyout/menu surface: what must be able to beat `chrome`. Read off the
 * element's OWN tag - `dropdown` alone would match an id like
 * `button-close-dropdown-backdrop` on a scrim that legitimately sits at 0.
 */
const MENUISH = /role\s*=\s*["'{]?\s*(menu|listbox)|menu-list\b|dropdown-menu/i;

const SOURCED = /PORTAL_Z|CONTENT_Z/;

const CLASS_BRACKET_RE = /(^|[^\w-])(-?)z-\[(-?\d+)\]/g;
const CLASS_PLAIN_RE = /(^|[^\w-])(-?)z-(\d+)(?![\w-])/g;
/**
 * A declaration, wherever it is written: a `<style>` rule, or an inline
 * `style="z-index: 40"` (which the older, narrower form missed entirely).
 * The value runs to the end of the declaration, so a template-literal
 * interpolation (`z-index: ${PORTAL_Z.dialog}`) is read as a whole.
 */
const CSS_DECL_RE = /(?:^|[^\w-])z-index\s*:\s*([^;"']+)/g;

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function indexOfLine(source: string, line: number): number {
  let index = 0;
  for (let i = 1; i < line; i += 1) {
    const next = source.indexOf('\n', index);
    if (next === -1) return source.length;
    index = next + 1;
  }
  return index;
}

/** The tag a class attribute sits in, so a rule never judges a NEIGHBOUR. */
function enclosingTag(code: string, index: number): string {
  const open = code.lastIndexOf('<', index);
  if (open === -1 || index - open > 800) return '';
  const close = code.indexOf('>', index);
  if (close === -1 || close - open > 800) return '';
  return code.slice(open, close + 1);
}

function linesOf(source: string): string[] {
  return source.split('\n');
}

/** Every z-index site in one file. `code` has comment bodies blanked. */
export function findSites(file: string, code: string, raw: string): Site[] {
  const lines = linesOf(raw);
  const sites: Site[] = [];
  const push = (
    index: number,
    kind: Site['kind'],
    value: string,
    layer: number | null,
    sourced: boolean
  ) => {
    const line = lineOf(code, index);
    sites.push({
      file,
      line,
      kind,
      value,
      layer,
      sourced,
      snippet: (lines[line - 1] ?? '').trim().slice(0, 160),
    });
  };

  for (const match of code.matchAll(CLASS_BRACKET_RE)) {
    const sign = match[2] === '-' ? -1 : 1;
    push(
      match.index ?? 0,
      'class',
      `${sign < 0 ? '-' : ''}z-[${match[3]}]`,
      sign * Number(match[3]),
      false
    );
  }
  for (const match of code.matchAll(CLASS_PLAIN_RE)) {
    const sign = match[2] === '-' ? -1 : 1;
    push(
      match.index ?? 0,
      'class',
      `${sign < 0 ? '-' : ''}z-${match[3]}`,
      sign * Number(match[3]),
      false
    );
  }
  for (const match of code.matchAll(CSS_DECL_RE)) {
    const value = (match[1] ?? '').trim();
    const staticNumber = /^-?\d+$/.test(value);
    push(match.index ?? 0, 'css', value, staticNumber ? Number(value) : null, SOURCED.test(value));
  }
  return sites.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));
}

/** Every `@keyframes` block in one file, with its FINAL step's declarations. */
function keyframesBlocks(code: string): { name: string; body: string; final: string }[] {
  const blocks: { name: string; body: string; final: string }[] = [];
  const opener = /@keyframes\s+([\w-]+)\s*\{/g;
  for (const match of code.matchAll(opener)) {
    const start = (match.index ?? 0) + match[0].length;
    let depth = 1;
    let end = start;
    while (end < code.length && depth > 0) {
      if (code[end] === '{') depth += 1;
      else if (code[end] === '}') depth -= 1;
      end += 1;
    }
    const body = code.slice(start, end - 1);
    const steps = [...body.matchAll(/(?:[\w%]+)\s*\{([^{}]*)\}/g)];
    const final = steps.length > 0 ? (steps[steps.length - 1][1] ?? '') : '';
    blocks.push({ name: match[1] ?? '', body, final });
  }
  return blocks;
}

/**
 * Entry animations that keep a stacking context after they finish: a retained
 * `transform` (or `opacity: <1`) in the final keyframe of an animation applied
 * with `both` / `forwards`.
 */
export function findTraps(file: string, code: string): Finding[] {
  const findings: Finding[] = [];
  const exempt = new Set(EXIT_ANIMATIONS.map((a) => a.name));
  const blocks = keyframesBlocks(code);

  // `transform` counts wherever it appears: Chrome keeps the animation's
  // interpolated end value as a MATRIX (identity included), so a `to` block that
  // omits it changes nothing.
  const animatesTransform = (body: string) => /(?:^|[;{\s])transform\s*:/.test(body);
  const endsFaded = (final: string) => {
    const match = final.match(/(?:^|[;{\s])opacity\s*:\s*([\d.]+)/);
    return match ? Number(match[1]) < 1 : false;
  };

  const declarations = [
    ...code.matchAll(/(?:^|[;{\s])animation(?:-fill-mode|-name)?\s*:\s*([^;{}]+)/g),
  ];
  for (const match of declarations) {
    const declaration = (match[1] ?? '').trim();
    if (!RETAINING_FILLS.test(declaration)) continue;
    const line = lineOf(code, match.index ?? 0);
    for (const block of blocks) {
      if (exempt.has(block.name)) continue;
      if (!new RegExp(`(^|[^\\w-])${block.name}([^\\w-]|$)`).test(declaration)) continue;
      const transform = animatesTransform(block.body);
      const faded = endsFaded(block.final);
      if (!transform && !faded) continue;
      findings.push({
        rule: 'STACKING-TRAP',
        file,
        line,
        detail: transform
          ? `@keyframes ${block.name} animates \`transform\` while the animation fills ` +
            `${declaration.includes('forwards') ? 'forwards' : 'both'} - the fill keeps an ` +
            `identity MATRIX after it finishes, not \`none\`, so the element stays a stacking ` +
            `context (and a containing block for position:fixed) and every overlay inside it ` +
            `is jailed. Drop the fill mode; the end state is the element's own value anyway.`
          : `@keyframes ${block.name} ends at \`opacity < 1\` while the animation fills ` +
            `${declaration.includes('forwards') ? 'forwards' : 'both'} - the element is held ` +
            `translucent (and a stacking context) forever.`,
      });
    }
  }
  // Only keyframes this file actually APPLIES are judged: a block can be
  // referenced from another rule in the same <style>, and a component's own
  // `animation:` shorthand is the thing that decides retention.
  return findings;
}

/** One file's sites and findings (the unit under test). */
export function analyse(file: string, source: string): { sites: Site[]; findings: Finding[] } {
  if (SCALE_FILES.includes(file)) return { sites: [], findings: [] };
  const code = stripComments(source);
  const sites = findSites(file, code, source);
  const findings: Finding[] = [...findTraps(file, code)];

  for (const site of sites) {
    if (site.sourced || site.layer === null) continue;
    if (site.layer >= PORTAL_Z.chrome) {
      findings.push({
        rule: 'UNSOURCED-LAYER',
        file,
        line: site.line,
        detail:
          `${site.value} claims the layer at ${site.layer} while ${PORTAL_Z.chrome} is the last ` +
          `local value - at or above chrome every overlay takes its number from the scale ` +
          `(PORTAL_Z / PORTAL_Z_CLASS), so it can be reordered with everything else.`,
      });
      continue;
    }
    if (site.kind === 'class' && MENUISH.test(enclosingTag(code, indexOfLine(code, site.line)))) {
      findings.push({
        rule: 'MENU-BELOW-CHROME',
        file,
        line: site.line,
        detail:
          `a menu surface carries the local value ${site.value} (${site.layer}); chrome is ` +
          `${PORTAL_Z.chrome}, so no number below it can put this flyout above the nav island - ` +
          `give it PORTAL_Z_CLASS.menu (${PORTAL_Z.menu}) or the layer a dialog-hosted menu needs.`,
      });
    }
  }
  return { sites, findings };
}

/** The documented ordering must be strictly ascending, and the halves must agree. */
export function checkScale(
  scale: Record<string, number> = PORTAL_Z as unknown as Record<string, number>,
  fragments: Record<string, string> = PORTAL_Z_CLASS as unknown as Record<string, string>
): Finding[] {
  const findings: Finding[] = [];
  const portal = scale;
  for (let i = 1; i < ORDER.length; i += 1) {
    const previous = ORDER[i - 1];
    const current = ORDER[i];
    const before = portal[previous];
    const after = portal[current];
    if (typeof before !== 'number' || typeof after !== 'number') {
      findings.push({
        rule: 'SCALE-ORDER',
        file: SCALE_FILES[0],
        line: 0,
        detail: `the order names ${typeof before !== 'number' ? previous : current}, which PORTAL_Z does not declare`,
      });
      continue;
    }
    if (after <= before) {
      findings.push({
        rule: 'SCALE-ORDER',
        file: SCALE_FILES[0],
        line: 0,
        detail: `PORTAL_Z.${current} (${after}) must be above PORTAL_Z.${previous} (${before})`,
      });
    }
  }
  for (const [name, layer] of Object.entries(portal)) {
    const fragment = fragments[name];
    if (fragment === undefined) {
      findings.push({
        rule: 'CLASS-DRIFT',
        file: SCALE_FILES[0],
        line: 0,
        detail: `PORTAL_Z.${name} has no PORTAL_Z_CLASS fragment, so a view cannot name it`,
      });
      continue;
    }
    if (fragment !== `z-[${layer}]`) {
      findings.push({
        rule: 'CLASS-DRIFT',
        file: SCALE_FILES[0],
        line: 0,
        detail: `PORTAL_Z_CLASS.${name} is ${fragment} but PORTAL_Z.${name} is ${layer}`,
      });
    }
  }
  return findings;
}

/** The whole stack, low → high (the scale plus the content-script document). */
export function stack(): { name: string; value: number; where: string }[] {
  return [
    ...Object.entries(PORTAL_Z).map(([name, value]) => ({ name, value, where: 'PORTAL_Z' })),
    ...Object.entries(CONTENT_Z).map(([name, value]) => ({ name, value, where: 'CONTENT_Z' })),
  ].sort((a, b) => a.value - b.value);
}

export function scanRepo(): { sites: Site[]; findings: Finding[]; scaleUses: number } {
  const sites: Site[] = [];
  const findings: Finding[] = [...checkScale()];
  const animated = new Set<string>();
  let scaleUses = 0;
  // One lister for the whole audit: this gate and `bun run check` must agree on
  // which files exist, or a finding depends on which gate ran first.
  for (const absolute of collectAbsoluteFiles(SRC_DIR, ['.svelte', '.ts', '.css'])) {
    const file = relative(PROJECT_ROOT, absolute).split('\\').join('/');
    const source = readFileSync(absolute, 'utf8');
    const code = stripComments(source);
    scaleUses += [...code.matchAll(/\b(PORTAL_Z|CONTENT_Z)\b/g)].length;
    for (const name of code.matchAll(/@keyframes\s+([\w-]+)/g)) animated.add(name[1] ?? '');
    const result = analyse(file, source);
    sites.push(...result.sites);
    findings.push(...result.findings);
  }
  findings.push(...staleExits(animated));
  return { sites, findings, scaleUses };
}

/**
 * An exemption nobody needs is an exemption nobody reviews: a stale exit row has
 * to be deleted, not left to excuse a future animation that reuses the name.
 */
export function staleExits(animated: Set<string>): Finding[] {
  return EXIT_ANIMATIONS.filter((exit) => !animated.has(exit.name)).map((exit) => ({
    rule: 'EXIT-ANIMATION-STALE' as const,
    file: SCALE_FILES[0],
    line: 0,
    detail: `EXIT_ANIMATIONS still exempts @keyframes ${exit.name} (${exit.reason}), but no such animation exists`,
  }));
}

/** The distinct values in a group of sites, for the one-line tally. */
function ports(list: Site[]): string {
  const values = [...new Set(list.map((s) => s.layer))].sort((a, b) => (a ?? 0) - (b ?? 0));
  return values.map((v) => (v === null ? 'dynamic' : String(v))).join(', ');
}

function main(): void {
  const strict = process.argv.includes('--strict');
  const { sites, findings, scaleUses } = scanRepo();

  const byRule = (rule: Rule) => findings.filter((f) => f.rule === rule);
  const unsourced = byRule('UNSOURCED-LAYER');
  const menus = byRule('MENU-BELOW-CHROME');
  const traps = byRule('STACKING-TRAP');
  const stale = byRule('EXIT-ANIMATION-STALE');
  const scale = byRule('SCALE-ORDER').concat(byRule('CLASS-DRIFT'));
  const local = sites.filter((s) => !s.sourced && s.layer !== null && s.layer < PORTAL_Z.chrome);
  const dynamic = sites.filter((s) => !s.sourced && s.layer === null);

  console.log(
    `Scanned ${sites.length} z-index sites under src/ against ${Object.keys(PORTAL_Z).length} ` +
      `portal layers + ${Object.keys(CONTENT_Z).length} content-script layers; ` +
      `${scaleUses} references name the scale.`
  );
  console.log(
    `\n### The stack, low → high\n\n` +
      stack()
        .map((l) => `  ${String(l.value).padStart(10)}  ${l.where}.${l.name}`)
        .join('\n')
  );

  const printFindings = (title: string, list: Finding[], hint: string) => {
    if (list.length === 0) return;
    console.log(`\n### ${title} (${list.length})\n`);
    for (const finding of list.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
      console.log(`${finding.file}${finding.line ? `:${finding.line}` : ''}`);
      console.log(`    ${finding.detail}`);
    }
    console.log(`\n${hint}`);
  };

  printFindings('SCALE-ORDER / CLASS-DRIFT - the scale disagrees with itself', scale, '');
  printFindings(
    'UNSOURCED-LAYER - a literal at or above chrome',
    unsourced,
    `Chrome is the last local value. Every overlay above it takes a layer from the scale so two ` +
      `of them can never claim the same number by accident.`
  );
  printFindings(
    'MENU-BELOW-CHROME - a flyout that cannot beat the nav island',
    menus,
    `A menu surface's number only works if no ancestor is a stacking context; below chrome even ` +
      `the largest local value loses to the nav island.`
  );
  printFindings(
    'STACKING-TRAP - an entry animation that keeps a transform',
    traps,
    `A retained transform (or opacity < 1) makes the element a permanent stacking context: every ` +
      `z-index inside it is resolved within it, and position:fixed descendants resolve against it.`
  );
  printFindings(
    'EXIT-ANIMATION-STALE - an exemption with nothing to excuse',
    stale,
    'Delete the row.'
  );

  console.log(
    `\n${sites.length} written literals, none of them claiming a layer: ${local.length} are local ` +
      `values below chrome (${ports(local)}) and ${dynamic.length} are expressions this scan cannot ` +
      `resolve. Both are fine where they are - a local value orders ONE component's own children ` +
      `(avatar stacks, notches, dividers, a portaled dialog's internals). The app's actual stacking ` +
      `is expressed by the ${scaleUses} references to PORTAL_Z / PORTAL_Z_CLASS / CONTENT_Z, which ` +
      `is what makes the stack above the whole app's order rather than one view's guess.`
  );

  if (strict && findings.length > 0) {
    console.error(`\n--strict: ${findings.length} layering finding(s).`);
    process.exit(1);
  }
}

if (import.meta.main) main();
