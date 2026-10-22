/**
 * Audit: which selected / active surfaces in the app actually SEPARATE from
 * the surface they sit on - in the two `standard` contrast themes, where the
 * tokens are closest together and a fill-only signal is most likely to vanish.
 *
 * Why this is a script and not a paragraph: "the selected row doesn't look
 * selected" is a number, not an opinion. A fill is only a signal if the eye can
 * see it, and in `light-standard` / `dark-standard` most container washes are
 * 1.1:1-1.4:1 from the surface under them - the same distance as an inactive
 * row's hover wash. The mailbox row hit exactly this (`ring-2` clipped away by
 * an `overflow-hidden` ancestor, a 40% wash invisible, so the only surviving
 * cue was the avatar flipping to a check disc) and needed a solid fill plus an
 * accent edge; this walks every other one to the same question.
 *
 * For each candidate site it reports, per standard theme:
 *   base      the surface the row sits on (off-branch fill, else static sibling,
 *             else the app shell's `--md-surface`)
 *   fill      the on-branch fill's separation from `base` - the signal itself
 *   hover     the off-state hover wash's separation from `base` - the noise
 *             floor a selection must beat to read as "selected, not hovered"
 *   cue       a border / ring / outline in the on-branch, whose own separation
 *             from `base` carries the state when the fill cannot
 *
 * Findings it can name without a browser:
 *   SILENT      fill below FLOOR and no cue at all
 *   RING-ONLY   no usable fill; a non-inset `ring-*` is the only cue (a
 *               `ring` paints outside the border box, so any clipping ancestor
 *               removes it - verify per site, see the notes)
 *   HOVER-EQUAL the fill's separation is the off state's hover separation, so
 *               "selected" and "hovered" are the same pixel
 *   DEAD-FILL   a static sibling in the same class attribute is emitted LATER
 *               in the built stylesheet, so the conditional fill never paints
 *
 * `--strict` exits 1 when a row-level site is SILENT / DEAD-FILL / RING-ONLY,
 * so the report can be promoted to a ratchet once the backlog is cleared.
 *
 * Run: bun run audit-row-surfaces [--strict] [--all]
 */
// `readdirSync` stays for `cssOrder()`, which reads the BUILT stylesheet out of
// `.output/` - that is the one input here that is legitimately ignored.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PROJECT_ROOT } from '../tests/unit/helpers/project-root';
import {
  contrast,
  hexToRgb,
  mix,
  type Rgb,
  THEME_NAMES,
  tokenOf,
} from '../tests/unit/helpers/theme-contrast';
import { collectAbsoluteFiles } from './source-files';
import { stripComments } from './source-lexer';

/** The two themes where token families sit closest to each other. */
const STANDARD_THEMES = ['light-standard', 'dark-standard'] as const;

/**
 * Every surface a row can plausibly be drawn on, for the best-case ceiling -
 * including `surface-variant`, which is what a segmented control's track and a
 * chip row use. The `best` column is an upper bound by construction: no
 * baseline outside this list can flatter a fill beyond it.
 */
const SURFACE_FAMILIES = [
  'md-surface',
  'md-surface-container',
  'md-surface-container-low',
  'md-surface-container-high',
  'md-surface-container-highest',
  'md-surface-variant',
] as const;

/**
 * A fill must beat this to be a signal at all - the floor the nav's selected
 * segment was made to satisfy (`nav-selection-contrast.test.ts`). Below it the
 * difference is a rendering artefact, not a state.
 */
export const FLOOR = 1.8;

/** Where the app actually paints: `AppShell` is `bg-md-surface`. */
const SHELL_TOKEN = 'md-surface';

/**
 * Substring, not word-boundary, matching: the state variables are camel-cased
 * compounds (`isLoginSelected`, `activeIdx`, `selectedIdentityId`), so `\bactive\b`
 * misses `activeIdx` entirely - which is how the first version of this scan
 * reported 3 rows instead of 20.
 */
const SELECTION_ISH =
  /(selected|selection|active|current|chosen|assigned|highlight|checked|expanded|opened|pinned|focused)/i;

const SURFACE_TOKEN = /(?:bg-|ring-|border-|outline-)/;

/**
 * Status ornaments, not selection: an expired address row's red tint answers a
 * different question ("what is this row's state?") than "which row is picked?".
 * Reported separately so the two axes are never conflated.
 */
const STATUS_ISH =
  /(lifecycle|expired|deleted|prefissue|healthissue|storageusage|critical|error\b|warning\b)/i;

/**
 * A drop target answers a third question - "what can I drop on?", not "which row
 * is picked?" - and it is a DRAG affordance, so it is reported on its own axis
 * instead of being graded as a selection fill. Its cue still has to be visible
 * (the strip targets measure 5.2:1), and it has to be clip-proof, which is why
 * those two rings are `ring-inset`.
 */
const DROPPABLE_ISH = /(droptarget|dropzone|dragover|dragactive|dragdepth)/i;

export interface Site {
  file: string;
  line: number;
  condition: string;
  on: string;
  off: string;
  /** The whole `class` attribute the ternary lives in, when one was found. */
  attribute: string;
  /** The nearest ancestor `class=` attribute, for the surface the row sits on. */
  ancestor: string;
  /**
   * The element states its surface through the shared contract
   * (`rowSurface({ … })`), so its state is not a fill this scan has to grade:
   * the values there are asserted in `tests/unit/utils/row-surface.test.ts`.
   */
  contract: boolean;
  /**
   * The fill of the nearest preceding class attribute of ANY kind - a heuristic
   * baseline that may be a sibling rather than an ancestor. Printed as `alt`
   * whenever it disagrees with the resolved one, so neither reading is hidden.
   */
  nearestFill: string | null;
  /** Source that itself shadows the conditional fill (emitted later in CSS). */
  shadow: string | null;
}

export interface Report {
  site: Site;
  rowish: boolean;
  /** The element's surface is the shared contract's, so it is not graded here. */
  contract: boolean;
  base: string;
  alt: string | null;
  fill: string | null;
  cue: string | null;
  /**
   * Per standard theme: `fill` is the separation on the resolved baseline,
   * `best` the highest separation the SAME fill reaches on any surface family
   * - the definitive ceiling, since no baseline choice can beat it.
   */
  numbers: {
    theme: string;
    fill: number | null;
    best: number | null;
    hover: number | null;
    cue: number | null;
  }[];
  flags: string[];
}

/** Token colour for `md-<name>` / `md-<name>/<alpha>` (and `transparent`). */
function resolveToken(spec: string): { color: Rgb; alpha: number } | null {
  const [name, alphaText] = spec.split('/');
  if (name === 'transparent' || name === 'inherit' || name === 'current') return null;
  const alpha = alphaText ? Number.parseInt(alphaText, 10) / 100 : 1;
  if (!name.startsWith('md-')) return null;
  return { color: hexToRgb(tokenOf(lastTheme ?? THEME_NAMES[0], name)), alpha };
}

/** Token names a theme is read for; set per theme inside `measure`. */
let lastTheme: string | null = null;

/** `bg-md-secondary-container/40` → `md-secondary-container/40`, else null. */
function surfaceSpec(cls: string, prefix: 'bg' | 'ring' | 'border' | 'outline'): string | null {
  const m = cls.match(new RegExp(`^${prefix}-(md-[a-z-]+(?:\\/\\d+)?)$`));
  return m ? m[1] : null;
}

/** Utilities of one kind, with their variant prefix stripped. */
function utilities(text: string, prefix: 'bg' | 'ring' | 'border' | 'outline'): string[] {
  return text
    .split(/\s+/)
    .map((c) => c.replace(/^(?:hover|active|focus|focus-visible|disabled|group-hover):/, ''))
    .filter((c) => c.startsWith(`${prefix}-`));
}

/**
 * The state expression itself, out of the raw capture. The captured condition
 * can start inside the PREVIOUS arm of a chained ternary (`…bg-md-error/5' :
 * selectedIdentityId === …`), which made a status filter drop a real selection
 * arm - and made `when` read as a class list instead of a condition.
 */
function stateExpr(condition: string): string {
  const tail = condition.split(':').pop() ?? condition;
  const stripped = tail
    .replace(/'[^']*'/g, ' ')
    .replace(
      /\b(?:bg|text|border|ring|outline|divide|shadow|hover|active|focus)-[\w/[\].-]+/g,
      ' '
    );
  // A Svelte class expression always opens with `{`, so everything before the
  // last one is markup or an earlier attribute, never part of the condition.
  const brace = stripped.lastIndexOf('{');
  return (brace >= 0 ? stripped.slice(brace + 1) : stripped).replace(/\s+/g, ' ').trim();
}

/**
 * A baseline surface, which is always the container/surface family - never an
 * element's own fill. Without this restriction the nearest preceding class
 * attribute can be a SIBLING (`CommandPalette`'s `<kbd>` is `bg-md-surface-variant`
 * two lines above the result rows), and the baseline for the selected row then
 * reads off a keycap.
 */
function containerFill(text: string): string | null {
  const fill = staticFill(text);
  return fill &&
    /^bg-md-(background|surface|surface-(?:container(?:-low|-high|-highest)?|dim|bright))(\/\d+)?$/.test(
      fill
    )
    ? fill
    : null;
}

/** The first fill a class string declares WITHOUT a variant prefix. */
function staticFill(text: string): string | null {
  for (const cls of text.split(/\s+/)) {
    if (/^(?:hover|active|focus|focus-visible|disabled|group-hover|group-active):/.test(cls))
      continue;
    const spec = surfaceSpec(cls, 'bg');
    if (spec && spec !== 'md-transparent') return `bg-${spec}`;
  }
  return null;
}

/** Fold a stack of (token, alpha) over a starting colour. */
function over(base: Rgb, stack: { color: Rgb; alpha: number }[]): Rgb {
  return stack.reduce((acc, layer) => mix(layer.color, acc, layer.alpha), base);
}

/** The `hover:` fill of a class string, if any. */
function hoverFill(text: string): string | null {
  for (const cls of text.split(/\s+/)) {
    const m = cls.match(/^hover:(bg-md-[a-z-]+(?:\/\d+)?)$/);
    if (m) return m[1].replace(/^bg-/, '');
  }
  return null;
}

/**
 * Which of `classes` wins: the conditional fill or a static sibling. Tailwind
 * emits same-property utilities in its own order, so equal specificity means
 * source order decides - and a static `bg-md-tertiary-container` is emitted
 * after `bg-md-primary/5`, which silently deletes the conditional fill.
 */
function shadowingFill(attribute: string, conditional: string): string | null {
  const order = cssOrder();
  const onSpec = surfaceSpec(conditional, 'bg');
  if (!onSpec) return null;
  const onIndex = order.get(`bg-${onSpec}`);
  if (onIndex === undefined) return null;
  for (const cls of attribute.replace(/[{}`]/g, ' ').split(/\s+/)) {
    if (cls === conditional) continue;
    if (/^(?:hover|active|focus|focus-visible|disabled|group-hover|group-active):/.test(cls))
      continue;
    const spec = surfaceSpec(cls, 'bg');
    if (!spec || spec === 'md-transparent') continue;
    const index = order.get(`bg-${spec}`);
    if (index !== undefined && index > onIndex) return cls;
  }
  return null;
}

/** Emitted position of every surface utility in the built stylesheet. */
let orderCache: Map<string, number> | null = null;
function cssOrder(): Map<string, number> {
  if (orderCache) return orderCache;
  orderCache = new Map();
  const dir = join(PROJECT_ROOT, '.output/chrome-mv3/assets');
  let file: string | undefined;
  try {
    file = readdirSync(dir)
      .filter((n) => n.startsWith('styles-') && n.endsWith('.css'))
      .sort()
      .pop();
  } catch {
    /* no build yet - order-unknown, DEAD-FILL just goes unreported */
  }
  if (!file) return orderCache;
  const css = readFileSync(join(dir, file), 'utf8');
  // Tailwind groups same-property utilities into one selector list
  // (`.bg-md-a,.bg-md-b{…}`), so a utility is followed by `,` OR `{` - a
  // `\{`-only pattern silently sees just the last member of each group and
  // reports every fill as unshadowed.
  const re =
    /(?:\.|,)((?:(?:hover|active|focus)\\:)?(?:bg|ring|border|outline)-md-[a-z-]+(?:\\\/\d+)?(?::[a-z-]+)?)(?=[,{])/g;
  for (const m of css.matchAll(re)) {
    // The emitted selector escapes the alpha slash (`bg-md-primary\/5`) -
    // normalize, or every alpha lookup misses and DEAD-FILL never fires.
    const key = m[1].replace(/\\\//g, '/');
    if (!orderCache.has(key)) orderCache.set(key, m.index ?? 0);
  }
  return orderCache;
}

/** `class="…"` / `class={…}` around a match, for static siblings and hover. */
/** `class="…"` / `class={…}` at `start`, with the attribute value. */
function classAt(source: string, start: number, at: number): string {
  const open = source[start + 6];
  if (open === '"') {
    const end = source.indexOf('"', start + 7);
    return end < 0 ? '' : source.slice(start + 7, end);
  }
  if (open === '{') {
    let depth = 0;
    for (let i = start + 6; i < Math.min(source.length, at + 1200); i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) return source.slice(start + 7, i);
      }
    }
  }
  return '';
}

/**
 * The `class` attribute around a match plus the nearest ANCESTOR one. The
 * ancestor is where the baseline surface usually lives (`AppShell` is
 * `bg-md-surface`; the sidebar is `bg-md-surface-container-low/80`), and
 * without it every row reads as sitting on the app shell - which is how the
 * sidebar's active item first looked like a 1.22:1 fill against the wrong
 * baseline.
 */
function enclosingClass(
  source: string,
  at: number
): { attribute: string; ancestor: string; nearestFill: string | null } {
  const start = source.lastIndexOf('class=', at);
  if (start < 0 || at - start > 4000) return { attribute: '', ancestor: '', nearestFill: null };
  const attribute = classAt(source, start, at);
  let search = start;
  let nearestFill: string | null = null;
  for (let hop = 0; hop < 4; hop += 1) {
    const previous = source.lastIndexOf('class=', search - 1);
    if (previous < 0) break;
    const candidate = classAt(source, previous, search);
    const fill = candidate ? staticFill(candidate) : null;
    if (fill && !nearestFill) nearestFill = fill;
    if (fill && containerFill(candidate)) return { attribute, ancestor: candidate, nearestFill };
    search = previous;
  }
  return { attribute, ancestor: '', nearestFill };
}

/** Every selection-conditional class arm pair in a source file. */
export function findSites(file: string, source: string): Site[] {
  const sites: Site[] = [];
  const stripped = stripComments(source);
  // `[\s]*` around `?` and `:` so an arm pair split across lines still matches;
  // the arms themselves are single-line class strings.
  const patterns = [
    /([^\n?;]{1,120}?)[\s]*\?[\s]*'([^'\n]*)'[\s]*:[\s]*'([^'\n]*)'/g,
    /([^\n?;]{1,120}?)[\s]*\?[\s]*`([^`\n]*)`[\s]*:[\s]*`([^`\n]*)`/g,
  ];
  for (const pattern of patterns) {
    for (const match of stripped.matchAll(pattern)) {
      const [, rawCondition, on, off] = match;
      const condition = stateExpr(rawCondition);
      // The flag's NAME is not the gate. A chip whose condition is
      // `sortBy !== 'newest'` or `otpOnly` states a selection as much as
      // `isSelected` does, and it was the same bug: an idle arm hovering to a
      // surface token (1.23:1 in light-standard) against an applied arm of
      // `bg-md-primary/10` (**1.15:1**). Any arm pair shaped like an applied
      // control is therefore graded whatever its variable happens to be called.
      const shapedLikeAControl =
        /bg-md-(?:primary|secondary|tertiary)\/(?:10|15)/.test(on) && /hover:bg-md-/.test(off);
      if (!SELECTION_ISH.test(condition) && !shapedLikeAControl && !DROPPABLE_ISH.test(condition)) {
        continue;
      }
      if (!SURFACE_TOKEN.test(on) && !SURFACE_TOKEN.test(off)) continue;
      // Anchored at the END of the condition capture, not its start: the lazy
      // capture may begin before the `class=` it belongs to (it consumes the
      // leading `class="…` text), and `lastIndexOf('class=')` from there then
      // walks out to the PARENT element and reports the parent's surface as
      // this element's own static fill.
      const anchor = (match.index ?? 0) + rawCondition.length;
      const line = stripped.slice(0, match.index ?? 0).split('\n').length;
      const { attribute, ancestor, nearestFill } = enclosingClass(stripped, anchor);
      sites.push({
        file,
        line,
        condition,
        on,
        off,
        attribute,
        ancestor,
        nearestFill,
        contract: attribute.includes('rowSurface(') || attribute.includes('controlSurface('),
        shadow: null,
      });
    }
  }
  return sites;
}

/**
 * Controls whose applied/off state comes from the contract: `controlSurface(…)`.
 *
 * They have no arm pair left for the scan above to grade - that is the point of
 * the migration - so they are listed by name here rather than dropped from the
 * report, and their values are the stylesheet's (`src/styles/row-surfaces.css`),
 * pinned by `tests/unit/utils/row-surface.test.ts`.
 */
export function findControlSites(file: string, source: string): { file: string; line: number }[] {
  const stripped = stripComments(source);
  return [...stripped.matchAll(/controlSurface\(/g)].map((match) => ({
    file,
    line: stripped.slice(0, match.index ?? 0).split('\n').length,
  }));
}

export function analyse(site: Site): Report {
  // The arms themselves sit inside the attribute's text, so strip every quoted
  // string before reading it for static classes - otherwise the on-arm's own
  // fill is read back as "the static sibling" and every site looks shaded.
  const skeleton = site.attribute.replace(/'[^']*'/g, ' ').replace(/`[^`]*`/g, ' ');
  // What the row is drawn ON: its own off-state fill, else its own static fill,
  // else the nearest ancestor's fill, else the app shell.
  const baseCandidate = staticFill(site.off) ?? staticFill(skeleton);
  const ancestorFill = baseCandidate ? null : staticFill(site.ancestor);
  // `≈` marks a baseline read off the nearest preceding class attribute (`AppShell`
  // is `bg-md-surface`, the sidebar is `bg-md-surface-container-low/80`) - a
  // heuristic, since "the previous class attribute" is not always an ancestor.
  const base = baseCandidate ?? (ancestorFill ? `≈${ancestorFill}` : `bg-${SHELL_TOKEN}`);
  const alt =
    site.nearestFill && site.nearestFill !== base.replace(/^≈/, '') ? site.nearestFill : null;
  const fillCandidate = staticFill(site.on);
  const fill = fillCandidate ? `bg-${surfaceSpec(fillCandidate, 'bg')}` : null;
  const cueCandidate = utilities(site.on, 'ring')
    .concat(utilities(site.on, 'border'), utilities(site.on, 'outline'))
    .find((c) => surfaceSpec(c, 'ring') || surfaceSpec(c, 'border') || surfaceSpec(c, 'outline'));
  const cue = cueCandidate ? cueCandidate.replace(/^focus-visible:/, '') : null;
  // A `ring-2` (NOT `ring-inset`) is painted outside the border box, so any
  // ancestor that clips - `overflow-hidden`, or `overflow-y-auto`, which the CSS
  // overflow rule makes clip both axes - removes it. That is how the mailbox
  // row lost its ring: all four sides, inside the swipe wrapper.
  const outwardRing = /(?:^|\s)ring-\d/.test(site.on) && !site.on.includes('ring-inset');
  const hover = hoverFill(site.attribute) ?? hoverFill(site.on) ?? hoverFill(site.off);

  const numbers = STANDARD_THEMES.map((theme) => {
    lastTheme = theme;
    const outlineLayer = resolveToken('md-outline');
    const shell = hexToRgb(tokenOf(theme, 'md-surface'));
    const baseSpec = base.replace(/^≈?bg-/, '');
    const baseLayer = baseSpec === SHELL_TOKEN ? null : resolveToken(baseSpec);
    const baseEff = baseLayer ? over(shell, [baseLayer]) : shell;
    const fillLayer = fill ? resolveToken(fill.replace(/^bg-/, '')) : null;
    const hoverLayer = hover ? resolveToken(hover) : null;
    const cueLayer = cue ? resolveToken(cue.replace(/^(ring|border|outline)-/, '')) : null;
    return {
      theme,
      fill: fillLayer ? contrast(over(baseEff, [fillLayer]), baseEff) : null,
      best: fillLayer
        ? Math.max(
            ...SURFACE_FAMILIES.map((family) => {
              const under = hexToRgb(tokenOf(theme, family));
              return contrast(over(under, [fillLayer]), under);
            })
          )
        : null,
      hover: hoverLayer ? contrast(over(baseEff, [hoverLayer]), baseEff) : null,
      cue: cueLayer
        ? contrast(over(baseEff, [cueLayer]), baseEff)
        : // `ring-2` / `border-2` with no colour utility: the theme's outline.
          /^(ring|border|outline)(-\d+)?$/.test(cue ?? '') && outlineLayer
          ? contrast(over(baseEff, [outlineLayer]), baseEff)
          : null,
    };
  });

  const worstFill = Math.min(...numbers.map((n) => n.fill ?? Number.POSITIVE_INFINITY));
  const bestFill = Math.max(...numbers.map((n) => n.best ?? 0));
  const flags: string[] = [];
  if (site.contract) {
    // The state and its ink come from the shared contract, whose values are
    // pinned per theme by its own test. Nothing here to grade - and nothing a
    // view-level class could contradict.
    return {
      site,
      rowish: /\bw-full\b|\bflex-1\b|density-row/.test(site.attribute),
      contract: true,
      base,
      alt,
      fill,
      cue,
      numbers,
      flags,
    };
  }
  const shadow = fill ? shadowingFill(skeleton, fill) : null;
  if (shadow) flags.push(`DEAD-FILL (${shadow} wins)`);
  if (fill && bestFill < FLOOR) flags.push('SILENT');
  else if (fill && worstFill < FLOOR) flags.push('WEAK-ON-BASE');
  const cueFlag = outwardRing ? 'RING-ONLY' : 'CUE-ONLY';
  if (fill && worstFill < FLOOR && cue) flags.push(cueFlag);
  if (!fill && cue) flags.push(cueFlag);
  if (!fill && !cue) flags.push('INK-ONLY');
  const hoverWorst = Math.max(...numbers.map((n) => n.hover ?? 0));
  if (
    fill &&
    numbers.some((n) => n.fill !== null && n.hover !== null && Math.abs(n.fill - n.hover) < 0.15)
  ) {
    flags.push('HOVER-EQUAL');
  } else if (fill && worstFill < FLOOR && hoverWorst >= worstFill) {
    flags.push('HOVER-EQUAL');
  }

  // A "row" is a full-width or density-padded CELL; a pill, chip, avatar or
  // segmented tab is a control, and is reported separately.
  const rowish =
    /\bw-full\b|\bflex-1\b|density-row/.test(site.attribute) &&
    /(?:^|\s)(?:px-\d|py-\d|p-\d)/.test(site.attribute) &&
    !site.attribute.includes('rounded-full');

  return {
    site: { ...site, shadow },
    contract: false,
    rowish,
    base,
    alt,
    fill,
    cue,
    numbers,
    flags,
  };
}

/** Contrast between the two extreme tokens of the surface family. */
export function surfaceSpan(theme: string): number {
  const values = SURFACE_FAMILIES.map((family) => hexToRgb(tokenOf(theme, family)));
  let span = 1;
  for (const a of values) for (const b of values) span = Math.max(span, contrast(a, b));
  return span;
}

/** Every selection- / status-conditional surface under `src/ui`. */
export function scanRepo(): {
  reports: Report[];
  status: string[];
  droppable: string[];
  controls: { file: string; line: number }[];
} {
  const uiRoot = join(PROJECT_ROOT, 'src/ui');
  const reports: Report[] = [];
  const status: string[] = [];
  const droppable: string[] = [];
  const controls: { file: string; line: number }[] = [];

  // The shared lister resolves which files exist, so this gate and `bun run
  // check` skip the identical set (docs/ and root probes included).
  for (const absolute of collectAbsoluteFiles(uiRoot, ['.svelte'])) {
    const file = relative(PROJECT_ROOT, absolute).split('\\').join('/');
    const source = readFileSync(absolute, 'utf8');
    controls.push(...findControlSites(file, source));
    for (const site of findSites(file, source)) {
      if (DROPPABLE_ISH.test(site.condition)) {
        droppable.push(`${file}:${site.line}`);
        continue;
      }
      if (STATUS_ISH.test(site.condition)) {
        status.push(`${file}:${site.line}`);
        continue;
      }
      reports.push(analyse(site));
    }
  }
  return { reports, status, droppable, controls };
}

function main(): void {
  const strict = process.argv.includes('--strict');
  const showAll = process.argv.includes('--all');
  const { reports, status, droppable, controls } = scanRepo();

  const withFlags = reports.filter((r) => r.flags.length > 0);
  const rows = withFlags.filter((r) => r.rowish);
  const others = withFlags.filter((r) => !r.rowish);
  const contractBacked = reports.filter((r) => r.contract);
  const clean = reports.filter((r) => r.flags.length === 0 && !r.contract);

  const print = (title: string, list: Report[]) => {
    if (list.length === 0) return;
    console.log(`\n### ${title} (${list.length})\n`);
    const sorted = list.sort((a, b) => {
      const worst = (r: Report) =>
        Math.min(...r.numbers.map((n) => n.fill ?? Number.POSITIVE_INFINITY));
      return worst(a) - worst(b);
    });
    for (const r of sorted) {
      const numbers = r.numbers
        .map(
          (n) =>
            `${n.theme}: fill ${n.fill === null ? '-' : n.fill.toFixed(2)} best ${
              n.best === null ? '-' : n.best.toFixed(2)
            } hover ${n.hover === null ? '-' : n.hover.toFixed(2)} cue ${
              n.cue === null ? '-' : n.cue.toFixed(2)
            }`
        )
        .join('  |  ');
      const condition = r.site.condition.replace(/\s+/g, ' ').slice(-70);
      console.log(`${r.site.file}:${r.site.line}`);
      console.log(`    when      …${condition}`);
      console.log(`    on        ${r.site.on.trim()}`);
      console.log(
        `    base/fill ${r.base} → ${r.fill ?? '(no fill)'}${r.cue ? `   cue ${r.cue}` : ''}` +
          (r.alt ? `   alt ${r.alt}` : '')
      );
      console.log(`    ${numbers}`);
      console.log(`    → ${r.flags.join(', ')}\n`);
    }
  };

  console.log(
    `Scanned ${reports.length} selection-conditional surfaces under src/ui; ` +
      `${withFlags.length} carry a signal finding in the standard themes ` +
      `(floor ${FLOOR}:1, below which a difference is an artefact, not a state).\n` +
      `${contractBacked.length} take their surface from the shared row contract ` +
      `(rowSurface({ … })) and ${controls.length} from the control contract ` +
      `(controlSurface(…)) - both graded by tests/unit/utils/row-surface.test.ts, not here.\n` +
      `${status.length} status-conditional and ${droppable.length} drop-target surfaces skipped ` +
      `(different axes).`
  );
  print('Row-level surfaces (the audit target)', rows);
  if (showAll) print('Other selected surfaces (controls, pills, cards)', others);
  else if (others.length)
    console.log(`(${others.length} control-level sites omitted - pass --all)`);
  if (showAll) {
    console.log(`\n### Contract-backed (${contractBacked.length}) - the state is the contract's\n`);
    for (const r of contractBacked.sort((a, b) => a.site.file.localeCompare(b.site.file))) {
      console.log(`  ${r.site.file}:${r.site.line}  ${r.site.condition.replace(/\s+/g, ' ')}`);
    }
    console.log(
      `\n### Contract-backed controls (${controls.length}) - no arm pair left to grade\n`
    );
    for (const c of controls.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
      console.log(`  ${c.file}:${c.line}`);
    }
    console.log(`\n### No findings (${clean.length}) - these DO separate on their own\n`);
    for (const r of clean.sort((a, b) => a.site.file.localeCompare(b.site.file))) {
      console.log(
        `  ${r.site.file}:${r.site.line}  ${r.fill ?? r.cue ?? 'ink'} on ${r.base}` +
          (r.site.nearestFill ? `  (alt ${r.site.nearestFill})` : '')
      );
    }
  }
  console.log(
    `\nNot arm-pairs: the mailbox row's surface comes from mailRowSurfaceClass, which ` +
      `delegates to the same contract (src/styles/row-surfaces.css), so it is pinned by ` +
      `tests/unit/utils/mail-row-state.test.ts rather than by this scan.\n`
  );

  const failures = rows.filter((r) => /SILENT|DEAD-FILL|RING-ONLY/.test(r.flags.join(' ')));
  const count = (predicate: (r: Report) => boolean) => rows.filter(predicate).length;
  const hasCue = (r: Report) => r.flags.includes('CUE-ONLY') || r.flags.includes('RING-ONLY');
  console.log(
    `\nVerdict for the ${rows.length} row-level findings - the FILL, in the two standard themes:\n` +
      `  ${count((r) => r.flags.some((f) => f.startsWith('DEAD-FILL')))} carry a fill that never paints ` +
      `(a static sibling is emitted later in the stylesheet)\n` +
      `  ${count((r) => r.flags.includes('SILENT') && !hasCue(r))} SILENT with no cue: below ${FLOOR}:1 on EVERY ` +
      `surface family, so no baseline choice can rescue them\n` +
      `  ${count((r) => r.flags.includes('SILENT') && hasCue(r))} SILENT fill, carried only by a border or ring\n` +
      `  ${count((r) => r.flags.includes('WEAK-ON-BASE') && !hasCue(r))} WEAK-ON-BASE: below the floor on their own ` +
      `baseline, above it on another\n` +
      `  ${count((r) => !r.flags.includes('SILENT') && !r.flags.includes('WEAK-ON-BASE') && hasCue(r))} cue plus a ` +
      `fill that passes on its own baseline\n` +
      `  ${count((r) => r.flags.includes('HOVER-EQUAL'))} where the idle state's HOVER paints what the selected ` +
      `state paints (selected and hovered are the same pixel)\n` +
      `  ${count((r) => r.flags.includes('INK-ONLY'))} signal is ink alone (no fill, no cue)\n`
  );
  console.log(
    `Floor note: in light-standard the surface family spans ` +
      `${surfaceSpan('light-standard').toFixed(2)}:1 end to end and in dark-standard ` +
      `${surfaceSpan('dark-standard').toFixed(2)}:1 - that span is the whole budget a fill-only selection ` +
      `has to work with.\n`
  );
  if (strict && failures.length > 0) {
    console.error(`--strict: ${failures.length} row-level surface(s) carry no usable signal.`);
    process.exit(1);
  }
}

if (import.meta.main) main();
