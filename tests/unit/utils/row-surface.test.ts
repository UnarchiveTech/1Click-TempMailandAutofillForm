/**
 * The row-surface contract - one state per row, and a state that actually
 * separates in every theme.
 *
 * The API half asserts what a view can ask for; the theme half parses
 * `src/styles/row-surfaces.css` and recomputes, in all six themes, what the eye
 * compares on a row:
 *
 *   - the state's FILL against the surface the row sits on - the whole state,
 *     because a state is a fill and nothing else (no bar, no rim, no divider
 *     between two ticked rows)
 *   - the states' ORDER: `selected` above `active`, and both above the floor
 *     and above the hover wash
 *   - the ink on a selected row against that fill (text: 4.5:1, /85: 4:1,
 *     icons: 3:1) - read through the palette's own `--row-ink-core`, because the
 *     fill is deepened in the two `standard` palettes and the ink follows it
 *
 * Parsing the stylesheet means a retoken or an alpha edit fails on the numbers
 * instead of shipping a row whose selection nobody can see.
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  CONTROL_INK_SELECTED,
  controlSurface,
  ROW_INK_PLAIN,
  ROW_INK_SELECTED,
  ROW_SURFACE_CLASS,
  ROW_SURFACE_STATE_CLASS,
  type RowSurfaceState,
  rowGlyphInk,
  rowInk,
  rowSurface,
  rowSurfaceState,
} from '@/utils/ui/row-surface.js';
import { PROJECT_ROOT } from '../helpers/project-root';
import {
  contrast,
  hexToRgb,
  mix,
  type Rgb,
  readSource,
  THEME_NAMES,
  tokenOf,
} from '../helpers/theme-contrast';

const sheet = readSource('src/styles/row-surfaces.css');

/**
 * One rule's body, as written in the stylesheet. The lookup takes the selector's
 * first line (a selector may wrap) and reads to the following rule.
 */
function ruleBody(selector: string): string {
  const start = sheet.indexOf(`\n${selector}`);
  if (start < 0) throw new Error(`row-surfaces.css has no \`${selector}\` rule`);
  const open = sheet.indexOf('{', start);
  return sheet.slice(open, sheet.indexOf('}', open));
}

/**
 * A state's paint: the token it fills with, the share of it, and - where the
 * palette deepens the state - the token mixed in after it
 * (`color-mix(in srgb, A 60%, B)`).
 */
interface Paint {
  token: string;
  alpha: number;
  mixedWith?: string;
}

/** The `--md-*` token a declaration paints with, and its share if it has one. */
function paintOf(body: string, property = 'background-color'): Paint {
  // Whitespace-normalised first: the sheet is formatted across lines, so
  // `color-mix(\n  in srgb,\n  var(…) 60%,\n  var(…)\n)` and the one-line form
  // have to parse the same way.
  const line = body
    .match(new RegExp(`${property}:\\s*([^;]+);`))?.[1]
    ?.replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();
  if (!line) throw new Error(`no ${property} in "${body.trim()}"`);
  const solid = line.match(/^var\(--(md-[a-z-]+)\)$/);
  if (solid) return { token: solid[1], alpha: 1 };
  const faded = line.match(/^color-mix\(in srgb, var\(--(md-[a-z-]+)\) (\d+)%, transparent\)$/);
  if (faded) return { token: faded[1], alpha: Number(faded[2]) / 100 };
  const deepened = line.match(
    /^color-mix\(in srgb, var\(--(md-[a-z-]+)\) (\d+)%, var\(--(md-[a-z-]+)\)\)$/
  );
  if (deepened) {
    return { token: deepened[1], alpha: Number(deepened[2]) / 100, mixedWith: deepened[3] };
  }
  throw new Error(`unparsable paint "${line}"`);
}

/**
 * Every rule in the sheet - selector list and body - so a selector can be
 * resolved ACROSS the rules that name it: a state's base rule, the palette rule
 * that deepens it, and the shared rule that hands it its ink variables.
 *
 * Comments are stripped first: the sheet explains itself in prose that mentions
 * braces-adjacent syntax, and a scanner that reads a comment as a selector would
 * be reading the documentation instead of the values.
 */
const SHEET_RULES: { selectors: string[]; body: string }[] = (() => {
  const rules: { selectors: string[]; body: string }[] = [];
  const stripped = sheet.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1]
      .split(',')
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (selectors.length > 0) rules.push({ selectors, body: match[2] });
  }
  return rules;
})();

/**
 * The declarations in force for a selector in one theme: the palette's own rule
 * FIRST, then the base rule. First-declaration-wins is the point - it mirrors the
 * cascade (`:root[data-theme=…] .row-surface-selected` is the later, more
 * specific rule), so the test reads what the browser paints.
 */
function declOf(selector: string, theme: string): string {
  // Most specific first, exactly as the cascade resolves them: the theme's own
  // rule, then a mode-wide rule (`[data-theme^="dark"]`), then the base rule.
  const overrides = [
    `:root[data-theme="${theme}"] ${selector}`,
    ...['light', 'dark']
      .filter((mode) => theme.startsWith(mode))
      .map((mode) => `:root[data-theme^="${mode}"] ${selector}`),
  ];
  const parts: string[] = [];
  for (const override of overrides) {
    for (const rule of SHEET_RULES) {
      if (rule.selectors.includes(override)) parts.push(rule.body);
    }
  }
  for (const rule of SHEET_RULES) {
    if (rule.selectors.includes(selector)) parts.push(rule.body);
  }
  if (parts.length === 0) throw new Error(`row-surfaces.css has no \`${selector}\` rule`);
  return parts.join('\n');
}

/** The `--md-*` token a state's ink resolves from in one theme. */
function inkCoreOf(selector: string, theme: string): string {
  const core = declOf(selector, theme).match(/--row-ink-core:\s*var\(--(md-[a-z-]+)\)/)?.[1];
  if (!core) throw new Error(`no --row-ink-core for \`${selector}\` in ${theme}`);
  return core;
}

const token = (theme: string, name: string): Rgb => hexToRgb(tokenOf(theme, name));
/** A paint as it lands on a surface. */
const over = (paint: Paint, theme: string, under: Rgb): Rgb => {
  if (paint.mixedWith) {
    return mix(token(theme, paint.token), token(theme, paint.mixedWith), paint.alpha);
  }
  return paint.alpha === 1
    ? token(theme, paint.token)
    : mix(token(theme, paint.token), under, paint.alpha);
};

/** A state's fill in one theme, with the palette's own rule applied. */
const fillIn = (selector: string, theme: string): Paint => paintOf(declOf(selector, theme));

/** How opaque a paint is: a two-token mix is opaque, a share of `transparent` is not. */
const opacityOf = (paint: Paint): number => (paint.mixedWith ? 1 : paint.alpha);

const STATE_SELECTORS = [
  '.row-surface-selected',
  '.row-surface-active',
  '.row-surface-highlighted',
] as const;

/** The floor a row state's fill has to clear against the row it sits on. */
const FILL_FLOOR = 1.8;

/**
 * The surface bases a SELECTABLE row rests on in this app, as the real-extension
 * probe measures them: the mailbox list on `surface`, the automation rules on
 * `surface-container-low`, and the login / address cards on
 * `surface-container-high`.
 *
 * `surface-container-highest` is deliberately NOT one of them, and the test
 * below keeps it that way: `secondary-container` against `-highest` is 1.34:1 in
 * `dark-standard` / 1.22:1 in `light-standard` - the container-vs-container
 * span, where no fill from this family can separate - so a card whose rows can
 * be ticked rests one step lower, which is what the probe caught.
 */
const SURFACES = [
  'md-surface',
  'md-surface-container-low',
  'md-surface-container',
  'md-surface-container-high',
] as const;

/** Every surface a control's whisper can land on. */
const FAMILY = [
  'md-surface',
  'md-surface-container',
  'md-surface-container-low',
  'md-surface-container-high',
  'md-surface-container-highest',
  'md-surface-variant',
] as const;

/** The whisper's own `color-mix(…, transparent)` alpha, as written in the sheet. */
const WHISPER_ALPHA = 0.08;

describe('rowSurface - one state per row', () => {
  test('precedence is selected > active > highlighted > unread', () => {
    const all = { selected: true, active: true, highlighted: true, unread: true };
    expect(rowSurfaceState(all)).toBe('selected');
    expect(rowSurfaceState({ ...all, selected: false })).toBe('active');
    expect(rowSurfaceState({ ...all, selected: false, active: false })).toBe('highlighted');
    expect(rowSurfaceState({ ...all, selected: false, active: false, highlighted: false })).toBe(
      'unread'
    );
    expect(rowSurfaceState({})).toBe('plain');
  });

  test('a row carries the resting class and at most ONE state class', () => {
    const states: RowSurfaceState[] = ['selected', 'active', 'highlighted', 'unread', 'plain'];
    for (const state of states) {
      const classes = rowSurface({
        selected: state === 'selected',
        active: state === 'active',
        highlighted: state === 'highlighted',
        unread: state === 'unread',
      });
      const carried = Object.values(ROW_SURFACE_STATE_CLASS).filter(
        (name) => name && classes.split(' ').includes(name)
      );
      expect(carried).toHaveLength(state === 'plain' ? 0 : 1);
      expect(classes.startsWith(ROW_SURFACE_CLASS)).toBe(true);
    }
  });

  test('every state class has a rule, and the resting class carries no state', () => {
    for (const [state, name] of Object.entries(ROW_SURFACE_STATE_CLASS)) {
      if (!name) continue;
      expect(sheet).toContain(`.${name} {`);
      expect(state).not.toBe('plain');
    }
    // `plain` is the absence of a state: the resting rule declares behaviour
    // (a transition) and no paint of its own.
    expect(ROW_SURFACE_STATE_CLASS.plain).toBe('');
    const resting = ruleBody(`.${ROW_SURFACE_CLASS}`);
    expect(resting).not.toContain('background-color:');
    expect(resting).not.toContain('box-shadow');
  });

  test('the ink switches to the container ink ONLY on a selected row', () => {
    expect(rowInk('primary', 'selected')).toBe(ROW_INK_SELECTED.primary);
    for (const state of ['active', 'highlighted', 'unread', 'plain'] as RowSurfaceState[]) {
      expect(rowInk('primary', state)).toBe(ROW_INK_PLAIN.primary);
      expect(rowInk('meta', state)).toBe(ROW_INK_PLAIN.meta);
    }
    expect(rowGlyphInk('selected', 'text-md-tertiary')).toBe(ROW_INK_SELECTED.icon);
    expect(rowGlyphInk('active', 'text-md-tertiary')).toBe('text-md-tertiary');
  });
});

describe('the contract’s states, measured in every theme', () => {
  test('a state is a FILL and nothing else - no bar, no rim, no RTL mirror', () => {
    // What this replaced: a 3px `on-secondary-container` bar at the inline start
    // plus a 1px rim at 25%. The rim drew a line where two ticked rows met, which
    // the design never had, and the bar restated the state in a second shape -
    // both existed only because the standard palettes' container is weak, and
    // that is a palette problem (see the `data-theme` rules), not a row one.
    for (const selector of STATE_SELECTORS) {
      for (const theme of THEME_NAMES) {
        expect(declOf(selector, theme)).not.toContain('box-shadow');
      }
      expect(sheet).not.toContain(`[dir="rtl"] ${selector}`);
    }
    // Neither hover nor press may repaint a ticked row.
    expect(ruleBody('.row-surface-selected:hover,\n.row-surface-selected:active')).toContain(
      'background-color: var(--md-secondary-container);'
    );
  });

  test('every state’s fill clears the floor against the row, in every theme', () => {
    // The metric is now the whole state: the fill against the surface it rests
    // on. `paintOf` reads the PALETTE's rule first, so a state that is deepened
    // per theme is measured as the browser paints it.
    const failures: string[] = [];
    for (const selector of STATE_SELECTORS) {
      for (const theme of THEME_NAMES) {
        for (const surface of SURFACES) {
          const under = token(theme, surface);
          const ratio = contrast(over(fillIn(selector, theme), theme, under), under);
          if (ratio < FILL_FLOOR) {
            failures.push(`${selector}/${theme}/${surface}: ${ratio.toFixed(2)}:1`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  test('the standard palettes deepen the two fills that would otherwise be a hover', () => {
    // `secondary-container` IS the plain row in these two palettes - 1.22:1 in
    // light-standard, where its own hover wash is 1.10:1, i.e. "selected" and
    // "hovered" were the same pixel. The deepen is toward the container's own
    // ink (dark in the light palette, light in the dark one), which is why one
    // rule serves both, and the medium/high palettes - which separate at
    // 4.91:1…10.49:1 on their own - are deliberately untouched.
    const surface = (theme: string) => token(theme, 'md-surface');
    const sep = (selector: string, theme: string) =>
      contrast(over(fillIn(selector, theme), theme, surface(theme)), surface(theme));

    expect(sep('.row-surface-selected', 'light-standard')).toBeGreaterThan(2);
    expect(sep('.row-surface-active', 'light-standard')).toBeGreaterThan(FILL_FLOOR);
    expect(sep('.row-surface-selected', 'dark-standard')).toBeGreaterThan(2);

    // Where the palette says nothing, the state keeps the token as written.
    for (const theme of ['light-medium', 'dark-medium', 'light-high', 'dark-high']) {
      expect(fillIn('.row-surface-selected', theme)).toEqual({
        token: 'md-secondary-container',
        alpha: 1,
      });
    }
  });

  test('the states stay ORDERED: selected above active, both above the row and the hover', () => {
    const hover = paintOf(
      ruleBody('.row-surface:not(.row-surface-selected):not(.row-surface-active):not(')
    );
    const failures: string[] = [];
    for (const theme of THEME_NAMES) {
      const surface = token(theme, 'md-surface');
      const sep = (paint: Paint) => contrast(over(paint, theme, surface), surface);
      const selected = sep(fillIn('.row-surface-selected', theme));
      const active = sep(fillIn('.row-surface-active', theme));
      const hovered = sep(hover);
      if (active <= FILL_FLOOR) failures.push(`${theme}: active ${active.toFixed(2)}:1`);
      if (selected <= active) {
        failures.push(
          `${theme}: selected ${selected.toFixed(2)}:1 <= active ${active.toFixed(2)}:1`
        );
      }
      // A hover must stay the weakest of the three, or hovering an unselected
      // row reads as opening (or ticking) it.
      if (hovered >= active) {
        failures.push(`${theme}: hover ${hovered.toFixed(2)}:1 >= active ${active.toFixed(2)}:1`);
      }
    }
    expect(failures).toEqual([]);
    // ...and in the standard palettes the hover is a wash, not a state.
    for (const theme of ['light-standard', 'dark-standard']) {
      const surface = token(theme, 'md-surface');
      expect(contrast(over(hover, theme, surface), surface)).toBeLessThan(FILL_FLOOR);
    }
  });

  test('the ticked row’s ink follows its palette, and clears its floors there', () => {
    // The ink is a variable set rather than a role, because the FILL is
    // palette-dependent: on the deepened light-standard fill the container's own
    // ink measures 4.4:1 - under the 4.5:1 body floor it has on the untouched
    // container - while that palette's `on-surface` measures 6.85:1. Asserted
    // here: what the classes name, what the sheet resolves, and the ratios.
    const floors: Record<'primary' | 'meta' | 'icon', number> = { primary: 4.5, meta: 4, icon: 3 };
    const shares = { primary: 1, meta: 0.85, icon: 0.7 } as const;
    for (const role of ['primary', 'meta', 'icon'] as const) {
      expect(ROW_INK_SELECTED[role]).toBe(`text-(--row-ink-${role})`);
      expect(sheet).toContain(`--row-ink-${role}:`);
    }

    const failures: string[] = [];
    for (const theme of THEME_NAMES) {
      const painted = over(
        fillIn('.row-surface-selected', theme),
        theme,
        token(theme, 'md-surface')
      );
      const core = token(theme, inkCoreOf('.row-surface-selected', theme));
      for (const role of ['primary', 'meta', 'icon'] as const) {
        const ratio = contrast(mix(core, painted, shares[role]), painted);
        if (ratio < floors[role]) failures.push(`${theme} ${role}: ${ratio.toFixed(2)}:1`);
      }
    }
    expect(failures).toEqual([]);

    // The same floors are asserted for `active`, whose ink comes from the same
    // set - a row whose fill moved must not keep an ink that no longer sits on
    // it. (`highlighted` keeps the app's plain ink, which is why it is absent.)
    for (const theme of THEME_NAMES) {
      const painted = over(fillIn('.row-surface-active', theme), theme, token(theme, 'md-surface'));
      const core = token(theme, inkCoreOf('.row-surface-active', theme));
      expect(contrast(core, painted)).toBeGreaterThanOrEqual(4.5);
    }

    // ...and the re-role is load-bearing, not cosmetic: the container's own ink
    // is under the body floor on the deepened light-standard fill.
    const lightFill = over(
      fillIn('.row-surface-selected', 'light-standard'),
      'light-standard',
      token('light-standard', 'md-surface')
    );
    expect(contrast(token('light-standard', 'md-on-secondary-container'), lightFill)).toBeLessThan(
      4.5
    );
    expect(inkCoreOf('.row-surface-selected', 'light-standard')).toBe('md-on-surface');
  });

  test('no selectable row rests on a base its own fill cannot separate from', () => {
    // A row that is ticked on `surface-container-highest` is a row whose fill is
    // 1.34:1 from what it sits on (dark-standard) - the state is there and nobody
    // can see it. Both offenders this found (the login card and the address card)
    // moved to `-high`, and this scan keeps the next one from arriving.
    const offenders: string[] = [];
    const files = readdirSync(join(PROJECT_ROOT, 'src/ui'), { recursive: true })
      .map((entry) => String(entry).split('\\').join('/'))
      .filter((entry) => entry.endsWith('.svelte'));
    for (const file of files) {
      const source = readSource(`src/ui/${file}`);
      for (const match of source.matchAll(/class="[^"]*"/g)) {
        const attribute = match[0];
        if (/rowSurface\(/.test(attribute) && /bg-md-surface-container-highest/.test(attribute)) {
          offenders.push(`src/ui/${file}: ${attribute.slice(0, 70)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('unread stays the quietest wash, and never outranks a state', () => {
    const unread = paintOf(ruleBody('.row-surface-unread'));
    expect(unread.alpha).toBeLessThan(0.2);
    // A deepened fill is still OPAQUE - its mix share is not an opacity.
    expect(opacityOf(fillIn('.row-surface-selected', 'light-standard'))).toBe(1);
    for (const theme of THEME_NAMES) {
      const surface = token(theme, 'md-surface');
      const unreadSep = contrast(over(unread, theme, surface), surface);
      const selectedSep = contrast(
        over(fillIn('.row-surface-selected', theme), theme, surface),
        surface
      );
      expect(selectedSep).toBeGreaterThan(unreadSep);
    }
  });
});

/**
 * The whisper a control's idle hover lays over it: `background-image:
 * linear-gradient(<mix>, <mix>)`. Read from the sheet so a re-alpha fails here.
 */
function whisperPaint(selector: string): { token: string; alpha: number } {
  const body = ruleBody(selector);
  if (body.includes('background-color:')) {
    throw new Error(`the whisper REPLACES the resting fill in \`${selector}\``);
  }
  const gradient = body.match(
    /linear-gradient\(\s*color-mix\(in srgb, var\(--(md-[a-z-]+)\) (\d+)%, transparent\)/
  );
  if (!gradient) throw new Error(`no whisper overlay in \`${selector}\``);
  return { token: gradient[1], alpha: Number(gradient[2]) / 100 };
}

// An applied control - whichever shape its state takes - is excluded from the
// whisper, because a wash over an applied control is a second cue for one state.
const HOVER_SELECTOR =
  '.control-surface:not(.control-surface-selected):not(.control-border-selected):hover';
const PRESS_SELECTOR =
  '.control-surface:not(.control-surface-selected):not(.control-border-selected):active';

describe('controlSurface - the applied state cannot be imitated by its own hover', () => {
  test('the API emits the resting class plus the applied class, on a truthy flag', () => {
    expect(controlSurface(true)).toBe('control-surface control-surface-selected');
    expect(controlSurface(false)).toBe('control-surface');
    // The underline shape is the same state for a segment whose container IS a
    // surface (a tab strip): the ink and a 2px bottom bar, no fill.
    expect(controlSurface(true, 'underline')).toBe('control-surface control-underline-selected');
    expect(controlSurface(false, 'underline')).toBe('control-surface');
    expect(controlSurface(true, 'fill')).toBe('control-surface control-surface-selected');
    // The border shape is the same state for a control whose own box holds
    // content a fill would swallow (the credentials domain's select-all disc
    // holds a favicon): the accent is its border, and the resting arm keeps a
    // `border-transparent` so the box cannot pop when the state turns on.
    expect(controlSurface(true, 'border')).toBe('control-surface control-border-selected');
    expect(controlSurface(false, 'border')).toBe('control-surface');
    // The flags are as loose as the markup's: `selectedTagFilter === null` is a
    // boolean, `sortBy !== 'newest'` is one, `filterIdentityId` is a string|null
    // and `otpDetectionMode === mode` is a boolean - all of them say
    // "applied" or "not".
    for (const truthy of ['archived', 1, {}]) expect(controlSurface(truthy)).toContain('selected');
    for (const falsy of [null, undefined, '', 0])
      expect(controlSurface(falsy)).toBe('control-surface');
  });

  test('the applied form is a solid accent fill with its container ink', () => {
    const body = ruleBody('.control-surface-selected');
    expect(paintOf(body)).toEqual({ token: 'md-primary', alpha: 1 });
    expect(body).toContain('color: var(--md-on-primary);');
    expect(CONTROL_INK_SELECTED).toBe('text-md-on-primary');
  });

  test('the idle hover COMPOSES with the resting fill instead of replacing it', () => {
    // A grey pill that swaps its resting token for a translucent wash on hover
    // reads as the control switching itself off; the overlay is a
    // `background-image` so the resting `background-color` survives underneath.
    expect(whisperPaint(HOVER_SELECTOR)).toEqual({ token: 'md-on-surface', alpha: WHISPER_ALPHA });
    // ...and press is the same whisper, one step deeper.
    const press = whisperPaint(PRESS_SELECTOR);
    expect(press.token).toBe('md-on-surface');
    expect(press.alpha).toBeGreaterThan(WHISPER_ALPHA);
  });

  test('the applied fill dominates the hover whisper on every base, in every theme', () => {
    // The bug this replaces: the idle hover was `bg-md-surface-variant` (1.23:1
    // in light-standard) and the applied form was `bg-md-primary/10`
    // (**1.15:1**) - hovering an unapplied control painted a STRONGER fill than
    // applying it. The bound is now structural, not a coincidence of one theme.
    const applied = paintOf(ruleBody('.control-surface-selected'));
    const whisper = whisperPaint(HOVER_SELECTOR);
    const failures: string[] = [];
    const margins: number[] = [];
    for (const theme of THEME_NAMES) {
      for (const base of FAMILY) {
        const under = token(theme, base);
        const appliedSep = contrast(over(applied, theme, under), under);
        const hoverSep = contrast(mix(token(theme, whisper.token), under, whisper.alpha), under);
        if (appliedSep < 4) failures.push(`${theme}/${base}: applied ${appliedSep.toFixed(2)}:1`);
        if (hoverSep > 1.4) failures.push(`${theme}/${base}: hover ${hoverSep.toFixed(2)}:1`);
        margins.push(appliedSep / hoverSep);
      }
    }
    expect(failures).toEqual([]);
    // ...by at least 4×, measured on the worst base in the worst theme.
    expect(Math.min(...margins)).toBeGreaterThan(4);
  });

  test('the applied ink is legible on the applied fill in every theme', () => {
    const fill = paintOf(ruleBody('.control-surface-selected'));
    for (const theme of THEME_NAMES) {
      const painted = over(fill, theme, token(theme, 'md-surface'));
      expect(contrast(token(theme, 'md-on-primary'), painted)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('the underline shape cues with its own ink and bar, in every theme', () => {
    // An MD3 primary tab: the strip's container is already a surface, so a filled
    // segment would restyle the strip. The bar is the segment's own box (an
    // inset shadow: the tab does not grow), and it is measured against the
    // STRIP the tab sits on as well as against the page.
    const body = ruleBody('.control-underline-selected');
    expect(body).toContain('color: var(--md-primary);');
    // The bar is the BOTTOM edge of the segment's own box (hence the `-2px`),
    // not the inline-start bar a row uses - `edgeToken` reads only the latter.
    expect(body).toContain('box-shadow: inset 0 -2px 0 0 var(--md-primary)');
    const failures: string[] = [];
    for (const theme of THEME_NAMES) {
      for (const base of FAMILY) {
        const under = token(theme, base);
        const barVsStrip = contrast(token(theme, 'md-primary'), under);
        if (barVsStrip < 3) failures.push(`${theme}/${base}: bar ${barVsStrip.toFixed(2)}:1`);
        const inkVsStrip = contrast(token(theme, 'md-primary'), under);
        if (inkVsStrip < 4.5) failures.push(`${theme}/${base}: ink ${inkVsStrip.toFixed(2)}:1`);
      }
    }
    expect(failures).toEqual([]);
  });

  test('the border shape cues on the control’s own edge and takes no fill', () => {
    // A control whose box holds content a fill would swallow - the credentials
    // domain's select-all disc holds a favicon - so its state is the border in
    // the accent role. It paints no fill and no ink of its own: the content keeps
    // the surface it was legible on, and the border sits INSIDE the box, so the
    // clipping ancestor that removed the old `ring-md-primary` cannot reach it.
    const body = ruleBody('.control-border-selected');
    expect(body).toContain('border-color: var(--md-primary);');
    expect(body).not.toMatch(/background/);
    expect(body).not.toMatch(/(?:^|[;\s])color:/);
    expect(body).not.toMatch(/box-shadow/);
    // The accent is over the 3:1 a graphical cue owes on every base the disc's
    // border is drawn on - including `primary-container` in the high-contrast
    // themes, where the ring this replaces fell to 1.54:1.
    const failures: string[] = [];
    for (const theme of THEME_NAMES) {
      for (const base of FAMILY) {
        const vs = contrast(token(theme, 'md-primary'), token(theme, base));
        if (vs < 3) failures.push(`${theme}/${base}: ${vs.toFixed(2)}:1`);
      }
    }
    expect(failures).toEqual([]);
  });

  test('the whisper cannot land on the pixels that carry a state', () => {
    // The whisper is the IDLE cue. For a shape whose state IS the control's own
    // surface - the fill and the border - a wash laid over it would cover the
    // very pixels that state consists of (a wash over an applied filter is
    // exactly what made it read as merely hovered), so both are excluded by
    // name: a fourth shape has to opt in here or the sheet and this list
    // disagree. The underline shape needs no exclusion and gets none: its state
    // is its ink and its bar, which no translucent wash imitates.
    const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
    const sheet = flat(readSource('src/styles/row-surfaces.css'));
    expect(HOVER_SELECTOR).toContain(':not(.control-surface-selected)');
    expect(HOVER_SELECTOR).toContain(':not(.control-border-selected)');
    expect(PRESS_SELECTOR).toContain(':not(.control-surface-selected)');
    expect(PRESS_SELECTOR).toContain(':not(.control-border-selected)');
    expect(sheet).toContain(flat(HOVER_SELECTOR));
    expect(sheet).toContain(flat(PRESS_SELECTOR));
  });
});

describe('the contract is the app’s only selected-control home', () => {
  test('the tab strip states both of its variants through the contract', () => {
    // The pill segment (`fill`) and the primary tab (`underline`) are two shapes
    // of ONE state, and neither keeps a fill, an ink or a hover wash of its own.
    // The pill's applied form used to be `bg-md-surface` on a
    // `bg-md-surface-variant` strip - 1.23:1, the whole surface-family span - and
    // the underline variant signalled with a child `<div>` the audit could not
    // see, so both read as "no signal" to the scan.
    const tabs = readSource('src/ui/components/composites/Tabs.svelte');
    expect(tabs).toContain('controlSurface(isActive)');
    expect(tabs).toContain("controlSurface(isActive, 'underline')");
    expect(tabs).not.toContain('bg-md-surface {ELEVATION');
    expect(tabs).not.toContain('absolute bottom-0 left-0 right-0 h-0.5');
    expect(readSource('src/utils/ui/row-surface.ts')).toContain('control-underline-selected');
  });

  test('the credentials domain disc states its state through the contract', () => {
    // The disc was the last control in the app with a cue mechanism of its own: a
    // `hover:brightness-110` filter, which brightens the accent border that
    // CARRIES the state and the favicon inside it, and which the real-extension
    // probe read as the state being repainted on hover (15/255 on the disc's
    // dominant pixel in light-standard, while its computed background never
    // moved - a filter is invisible to a background read). It now takes the
    // contract's border shape, so its idle hover is the shared whisper and its
    // applied state excludes that whisper entirely.
    const view = readSource('src/ui/views/autofill/SavedLoginsView.svelte');
    expect(view).toContain('isDomainFullySelected(group.logins),');
    // The disc's own class attribute - from its box tier to the end of the
    // contract call - is what must carry the state and nothing else.
    const start = view.indexOf('{AVATAR_BOX.md}');
    const disc = view.slice(start, view.indexOf(')}"', start) + 3);
    expect(disc).toContain('controlSurface(');
    expect(disc).toContain("'border'");
    expect(disc).toContain('border-transparent');
    expect(disc).not.toContain('brightness');
  });

  test('no view hands a chip the inverted pair the contract exists to prevent', () => {
    // The shape, not the flag's name: a weak accent fill on the applied arm with
    // an idle arm that hovers to a surface token. `sortBy !== 'newest'`,
    // `otpOnly` and `hasAttachment` all shipped it - that is why the audit's
    // scanner was widened to grade the shape rather than the variable.
    const offenders: string[] = [];
    const files = readdirSync(join(PROJECT_ROOT, 'src/ui'), { recursive: true })
      .map((entry) => String(entry).split('\\').join('/'))
      .filter((entry) => entry.endsWith('.svelte'));
    for (const file of files) {
      const source = readSource(`src/ui/${file}`);
      for (const match of source.matchAll(/class="[^"]*"/g)) {
        const attribute = match[0];
        if (
          /bg-md-(?:primary|secondary|tertiary)\/(?:10|15)/.test(attribute) &&
          /hover:bg-md-(?:surface|on-surface)/.test(attribute)
        ) {
          offenders.push(`src/ui/${file}: ${attribute.slice(0, 80)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the contract is the app’s only selected-row home', () => {
  test('no view paints a row with a non-inset ring or its own state fill', () => {
    // `ring-2` is painted OUTSIDE the border box: the mailbox row lost all four
    // sides of its own ring to an `overflow-hidden` ancestor, and the selector
    // drawer's list clipped two of them. Rows state their state with an inset
    // edge, so a row-level `ring-*` in a list is a regression.
    const offenders: string[] = [];
    for (const file of [
      'src/ui/views/mailbox/MailboxView.svelte',
      'src/ui/views/addresses/AddressesView.svelte',
      'src/ui/views/autofill/IdentitiesView.svelte',
      'src/ui/views/autofill/SavedLoginsView.svelte',
      'src/ui/blocks/addresses/AddressCard.svelte',
      'src/ui/blocks/addresses/AddressSelectorDrawer.svelte',
      'src/ui/blocks/layout/SidebarNav.svelte',
    ]) {
      const source = readSource(file);
      for (const match of source.matchAll(/class="[^"]*ring-(?:2|1) ring-md-secondary[^"]*"/g)) {
        offenders.push(`${file}: ${match[0].slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('no state is signalled by an OUTWARD ring any more', () => {
    // A `ring-*` is painted outside the border box, so any clipping ancestor
    // removes it - the mailbox row lost all four sides of its own. Two of these
    // were also unable to separate from what they sat on: the credentials disc's
    // `ring-md-primary` against its own `primary-container` measures 1.54:1 in
    // `light-high`. The replacements are clip-proof by construction - the row
    // contract's INSET bar, a border, and the control contract's fill.
    const offenders: string[] = [];
    const removed: [string, string][] = [
      // The row the keyboard sits on: `active` on the row contract, whose bar is
      // INSET. The old `ring-1 ring-md-primary/50` measured 2.18:1 in
      // light-standard - under the 3:1 a cue owes, before clipping is even
      // considered.
      ['src/ui/views/AutomationView.svelte', 'ring-1 ring-md-primary/50'],
      // The domain select-all disc: a border in the accent role (5.29:1…14.42:1
      // against the surface family) instead of a ring that both clipped and, as
      // `primary` on its own `primary-container`, fell to 1.54:1 in light-high.
      ['src/ui/views/autofill/SavedLoginsView.svelte', 'ring-2 ring-md-primary'],
      // The drawer card's avatar: the row's fill and bar already say "selected",
      // so the `ring-2 … ring-offset-1` was a second, clippable cue for one state.
      ['src/ui/blocks/addresses/AddressCard.svelte', 'ring-offset-1'],
    ];
    for (const [file, banned] of removed) {
      const source = readSource(file);
      for (const match of source.matchAll(/([?:])\s*'([^']*)'/g)) {
        const arm = match[2];
        // Not every ring is a state: a drop target is a drag affordance, and a
        // `focus-visible:` ring belongs to the keyboard.
        if (!arm.includes(banned)) continue;
        if (/drop-target|focus-visible|ring-inset/.test(arm)) continue;
        offenders.push(`${file}: ${arm}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the migrated views import the contract rather than a fill of their own', () => {
    for (const file of [
      'src/ui/views/addresses/AddressesView.svelte',
      'src/ui/views/autofill/IdentitiesView.svelte',
      'src/ui/views/autofill/SavedLoginsView.svelte',
      'src/ui/blocks/addresses/AddressCard.svelte',
      'src/ui/blocks/layout/SidebarNav.svelte',
      'src/ui/components/composites/LanguageMenu.svelte',
      'src/ui/blocks/overlays/CommandPalette.svelte',
      'src/ui/components/composites/SearchBar.svelte',
    ]) {
      expect(readSource(file)).toContain("from '@/utils/ui/row-surface.js'");
    }
  });
});
