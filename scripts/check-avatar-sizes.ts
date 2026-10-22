/**
 * check-avatar-sizes.ts
 *
 * Pre-commit / CI guard that pins every avatar and favicon to the shared size
 * scale (`src/utils/ui/avatar-size.ts`).
 *
 * Why: the same visual role shipped at eight different sizes. The leading avatar
 * of a *list row* was 35px in the mailbox, 36px in the addresses list, 40px on
 * the identity row and 28px in the mailbox's grouped list; `size={35}` sat
 * inside a `w-9 h-9` box (35 declared, 36 painted, because a `w-*` class on the
 * component suppresses the inline size style); and one usage-map favicon
 * declared `size={16}` inside a `w-5 h-5` box while painting `w-3.5 h-3.5` -
 * three numbers for one 14px icon. A call site cannot be trusted to agree with
 * itself, so it does not get to state a size: it names a TIER.
 *
 * Rules, per `<Avatar>` / `<FaviconImage>` call site (the primitives that own
 * the box - `Avatar.svelte` / `FaviconImage.svelte` - are not scanned):
 *
 *   1. `size` is REQUIRED, and its value must be a literal tier name. The tier
 *      name itself is also type-checked (`AvatarTier`), so a typo fails
 *      `bun run typecheck`; this gate covers the spread/dynamic `size={expr}`
 *      cases the compiler cannot see through, and reports them here.
 *   2. Any fixed size class on the element must be the tier's OWN box
 *      (`AVATAR_BOX[tier]`) - or a fill (`w-full` / `h-full`) for a caller that
 *      paints into a box it does not own. `size="row" class="w-5 h-5"` (36
 *      declared, 20 painted) fails; `size="row" class="w-full h-full"` passes.
 *
 * Zero suppression: every `.svelte` file under `src/` is scanned.
 *
 * Usage: bun scripts/check-avatar-sizes.ts
 */

import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { AVATAR_BOX, AVATAR_TIER_NAMES, type AvatarTier } from '../src/utils/ui/avatar-size';
import { collectAbsoluteFiles } from './source-files';
import { stripComments } from './source-lexer';

const SRC_DIR = join(process.cwd(), 'src');

/** The primitives own the box; their own internals are not call sites. */
const PRIMITIVE_FILES = [
  join(SRC_DIR, 'ui', 'components', 'primitives', 'Avatar.svelte'),
  join(SRC_DIR, 'ui', 'components', 'primitives', 'FaviconImage.svelte'),
];

const COMPONENT_RE = /<(Avatar|FaviconImage)\b/g;
const SIZE_ATTR_RE = /size\s*=\s*(?:"([^"]*)"|\{([^}]*)\})/;
const CLASS_ATTR_RE = /class\s*=\s*"([^"]*)"/;
/** A fixed box token: `w-9`, `w-[35px]`, `w-3.5`, `h-auto`, … */
const FIXED_BOX_RE = /^[wh]-(?:\[[^\]]+\]|\d+(?:\.\d+)?|auto|px|min|max|fit|screen)$/;
/** A fill token - a caller painting into a box it does not own. */
const FILL_RE = /^[wh]-(?:full|screen)$/;

/** One primitive call site, as written in the source. */
export interface AvatarSite {
  file: string;
  line: number;
  component: string;
  /** The literal tier, when the attribute is a literal from the scale. */
  tier: AvatarTier | null;
  /** The raw `size=` payload, for the message (`35`, `size`, `''`). */
  rawSize: string;
  /** The fixed size classes found on the element. */
  boxes: string[];
}

export interface AvatarViolation {
  file: string;
  line: number;
  component: string;
  message: string;
}

/** Comment-free source for a file (the shared lexer decides what is code). */
function scanSource(source: string): string {
  return stripComments(source)
    .split(/(<style\b[^>]*>[\s\S]*?<\/style>)/g)
    .filter((chunk) => !chunk.startsWith('<style'))
    .join('');
}

/**
 * The element's attribute text: from the tag name to the `>` that closes the
 * start tag, skipping `>` inside a `{…}` expression. A Svelte component's
 * attributes never contain a bare `>` outside braces in this codebase, and the
 * brace depth guard keeps an expression like `{a > b}` intact anyway.
 */
function tagBody(source: string, from: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    else if (ch === '>' && depth === 0) return source.slice(from, i);
  }
  return source.slice(from);
}

/** Every fixed size class in a class payload, with variant prefixes stripped. */
function fixedBoxes(classes: string): string[] {
  return classes
    .split(/\s+/)
    .map((token) => token.replace(/^.*:/, ''))
    .filter((token) => FIXED_BOX_RE.test(token) && !FILL_RE.test(token));
}

/** Pure core: every primitive call site in a (comment-free) source string. */
export function findAvatarSites(source: string, file = '<source>'): AvatarSite[] {
  const sites: AvatarSite[] = [];
  for (const match of source.matchAll(COMPONENT_RE)) {
    const component = match[1];
    const start = match.index as number;
    const body = tagBody(source, start + component.length + 1);

    const sizeAttr = body.match(SIZE_ATTR_RE);
    const rawSize = sizeAttr ? (sizeAttr[1] ?? sizeAttr[2] ?? '') : '';
    const tier = sizeAttr
      ? (AVATAR_TIER_NAMES.find((name) => name === rawSize.trim()) ?? null)
      : null;

    const classAttr = body.match(CLASS_ATTR_RE);
    sites.push({
      file,
      line: source.slice(0, start).split('\n').length,
      component,
      tier,
      rawSize: sizeAttr ? rawSize.trim() : '',
      boxes: classAttr ? fixedBoxes(classAttr[1]) : [],
    });
  }
  return sites;
}

/** Pure core: the violations for a set of call sites. */
export function findAvatarViolations(sites: AvatarSite[]): AvatarViolation[] {
  const violations: AvatarViolation[] = [];
  for (const site of sites) {
    const { file, line, component } = site;
    if (site.rawSize === '') {
      violations.push({
        file,
        line,
        component,
        message: 'no `size` - name a tier from @/utils/ui/avatar-size.js (a list row takes "row")',
      });
      continue;
    }
    if (!site.tier) {
      violations.push({
        file,
        line,
        component,
        message: `size="${site.rawSize}" is not a tier - use one of ${AVATAR_TIER_NAMES.join(', ')}`,
      });
      continue;
    }
    const box = AVATAR_BOX[site.tier].split(' ');
    for (const token of site.boxes) {
      if (box.includes(token)) continue;
      violations.push({
        file,
        line,
        component,
        message:
          `class "${token}" disagrees with size="${site.tier}" (${AVATAR_BOX[site.tier]}) - ` +
          'drop the size class (the tier owns the box) or use AVATAR_BOX here',
      });
    }
  }
  return violations;
}

/** Scan the repo: every primitive call site outside the primitives themselves. */
export function scanRepo(): AvatarSite[] {
  const files = collectAbsoluteFiles('src', ['.svelte']);
  const sites: AvatarSite[] = [];
  for (const file of files) {
    if (PRIMITIVE_FILES.includes(file)) continue;
    sites.push(...findAvatarSites(scanSource(readFileSync(file, 'utf8')), file));
  }
  return sites;
}

function main(): void {
  const sites = scanRepo();
  const violations = findAvatarViolations(sites);

  if (violations.length > 0) {
    console.error(`Avatar/Favicon call sites off the size scale (${violations.length}):`);
    for (const v of violations) {
      console.error(`  ${relative(process.cwd(), v.file)}:${v.line} <${v.component}>`);
      console.error(`    ${v.message}`);
    }
    console.error(
      '\nEvery avatar and favicon takes a TIER from src/utils/ui/avatar-size.ts:\n' +
        '  xs 16 · sm 20 · md 24 · lg 28 · xl 32 · row 36  (a list row\'s leading avatar is "row")\n' +
        'A wrapper that must be exactly that box uses AVATAR_BOX[tier]; a glyph inside it uses\n' +
        'AVATAR_INK[tier]. Never state a px number or a `w-N h-N` pair at the call site.'
    );
    process.exit(1);
  }

  console.log(
    `Avatar sizes on the scale (${sites.length} call sites, ${AVATAR_TIER_NAMES.length} tiers).`
  );
}

// CLI entry only - unit tests import the pure core above.
if (import.meta.main) main();
