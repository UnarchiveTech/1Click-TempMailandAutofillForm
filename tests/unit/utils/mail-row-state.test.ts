/**
 * The mailbox row's SELECTED state must be visible in every theme, and its ink
 * must stay legible ON the fill.
 *
 * Two things made this a guard rather than a style choice:
 *
 * 1. The state used to be `ring-2 ring-md-secondary` on the row div. `.ring-2`
 *    is a NON-inset box-shadow, and the row sits inside an `overflow-hidden`
 *    swipe wrapper, so all four sides were clipped away - the only cue left was
 *    the avatar flipping to a check disc.
 * 2. A 60%-alpha wash cannot replace it: measured below, it sits 1.12:1 from
 *    the plain row in light-standard - the same distance as an inactive row's
 *    hover wash (1.09:1), so "selected" and "hovered" were the same pixel.
 *
 * The surfaces themselves now live in the SHARED row contract
 * (`src/styles/row-surfaces.css`, values; `src/utils/ui/row-surface.ts`, API) -
 * asserted in full by `row-surface.test.ts`. What this file owns is the
 * mailbox's own vocabulary: which state a row is in, that both renderings go
 * through it and neither hand-rolls a fill or a ring, and that the star's
 * colour gives way to the glyph shape on a selected row.
 */
import { describe, expect, test } from 'bun:test';
import {
  MAIL_ROW_SELECTED_CLASS,
  mailRowStarClass,
  mailRowSurfaceClass,
  SELECTED_ROW_INK,
} from '@/utils/ui/mail-row-state.js';
import { ROW_SURFACE_CLASS, ROW_SURFACE_STATE_CLASS } from '@/utils/ui/row-surface.js';
import {
  contrast,
  hexToRgb,
  mix,
  type Rgb,
  readSource,
  THEME_NAMES,
  tokenOf,
} from '../helpers/theme-contrast';

const viewSrc = readSource('src/ui/views/mailbox/MailboxView.svelte');
const sheet = readSource('src/styles/row-surfaces.css');

/**
 * The sheet's `--row-ink-*` slot a class names. The ink is a slot rather than a
 * role because the FILL is palette-dependent: the ticked fill is deepened in the
 * two `standard` palettes (its container is 1.22:1 there - the same pixel as a
 * hover), and a deeper fill needs the palette's own strongest ink.
 */
function slotOf(classes: string): 'primary' | 'meta' | 'icon' {
  const slot = classes.match(/text-\(--row-ink-(primary|meta|icon)\)/)?.[1];
  if (!slot) throw new Error(`no --row-ink-* class in "${classes}"`);
  return slot as 'primary' | 'meta' | 'icon';
}

/** The declarations in force for a selector in one theme: the palette's first. */
function declOf(selector: string, theme: string): string {
  const rules: string[] = [];
  for (const override of [
    `:root[data-theme="${theme}"] ${selector}`,
    ...[`light`, `dark`]
      .filter((mode) => theme.startsWith(mode))
      .map((mode) => `:root[data-theme^="${mode}"] ${selector}`),
  ]) {
    const at = sheet.indexOf(`\n${override} {`);
    if (at >= 0) rules.push(sheet.slice(sheet.indexOf('{', at), sheet.indexOf('}', at)));
  }
  const at = sheet.indexOf(`\n${selector} {`);
  if (at < 0) throw new Error(`row-surfaces.css has no \`${selector}\` rule`);
  rules.push(sheet.slice(sheet.indexOf('{', at), sheet.indexOf('}', at)));
  return rules.join('\n');
}

/** The share of the ink a slot is derived at (`/85`, `/70`, or the ink itself). */
function shareOf(slot: 'primary' | 'meta' | 'icon'): number {
  if (slot === 'primary') return 1;
  // Read from the whole sheet: the derivation is declared once, on the rule the
  // two states share, so it is not scoped to `.row-surface-selected` alone.
  const share = sheet.match(
    new RegExp(`--row-ink-${slot}:\\s*color-mix\\(in srgb, var\\(--row-ink-core\\) (\\d+)%`)
  )?.[1];
  if (!share) throw new Error(`the sheet does not derive --row-ink-${slot}`);
  return Number(share) / 100;
}

/** The ticked row's fill in one theme, as the browser paints it. */
function fillOf(theme: string): Rgb {
  const decl = declOf('.row-surface-selected', theme);
  const line =
    decl
      .match(/background-color:\s*([^;]+);/)?.[1]
      ?.replace(/\s+/g, ' ')
      .replace(/\(\s+/g, '(')
      .replace(/\s+\)/g, ')')
      .trim() ?? '';
  const solid = line.match(/^var\(--(md-[a-z-]+)\)$/);
  if (solid) return hexToRgb(tokenOf(theme, solid[1]));
  const deep = line.match(
    /^color-mix\(in srgb, var\(--(md-[a-z-]+)\) (\d+)%, var\(--(md-[a-z-]+)\)\)$/
  );
  if (!deep) throw new Error(`unparsable selected fill "${line}"`);
  return mix(
    hexToRgb(tokenOf(theme, deep[1])),
    hexToRgb(tokenOf(theme, deep[3])),
    Number(deep[2]) / 100
  );
}

/** The ink a slot resolves to in one theme (the sheet's `--row-ink-core`). */
function inkCoreOf(theme: string): string {
  const core = declOf('.row-surface-selected', theme).match(
    /--row-ink-core:\s*var\(--(md-[a-z-]+)\)/
  )?.[1];
  if (!core) throw new Error(`no --row-ink-core for ${theme}`);
  return core;
}

/** Ink as painted: the slot's ink at its own share, over the ticked fill. */
const inkOnFill = (theme: string, classes: string): Rgb => {
  const slot = slotOf(classes);
  return mix(hexToRgb(tokenOf(theme, inkCoreOf(theme))), fillOf(theme), shareOf(slot));
};

describe('mailRowSurfaceClass', () => {
  test('a selected row is the contract class - not a ring, not a wash, not an outline', () => {
    const classes = mailRowSurfaceClass({
      selected: true,
      active: false,
      highlighted: false,
      unread: true,
    });
    expect(classes).toContain(MAIL_ROW_SELECTED_CLASS);
    expect(classes.startsWith(ROW_SURFACE_CLASS)).toBe(true);
    expect(classes).not.toContain('ring');
    expect(classes).not.toContain('secondary-container/');
  });

  test('selection wins over the open thread, and a ticked open row keeps its weight', () => {
    const classes = mailRowSurfaceClass({
      selected: true,
      active: true,
      highlighted: false,
      unread: false,
    });
    // Both facts about the row survive: it is ticked AND it is the open message.
    expect(classes).toContain(MAIL_ROW_SELECTED_CLASS);
    expect(classes).toContain('font-semibold');
    expect(classes).not.toContain(ROW_SURFACE_STATE_CLASS.active);
  });

  test('every unselected state resolves to exactly one contract state class', () => {
    const classesFor = (state: {
      selected: boolean;
      active: boolean;
      highlighted: boolean;
      unread: boolean;
    }) => mailRowSurfaceClass(state);

    expect(
      classesFor({ selected: false, active: true, highlighted: false, unread: false })
    ).toContain(ROW_SURFACE_STATE_CLASS.active);
    expect(
      classesFor({ selected: false, active: false, highlighted: true, unread: false })
    ).toContain(ROW_SURFACE_STATE_CLASS.highlighted);
    expect(
      classesFor({ selected: false, active: false, highlighted: false, unread: true })
    ).toContain(ROW_SURFACE_STATE_CLASS.unread);
    expect(classesFor({ selected: false, active: false, highlighted: false, unread: false })).toBe(
      ROW_SURFACE_CLASS
    );
  });

  test('both row renderings use the contract, and neither hand-rolls a surface', () => {
    // The main (virtualised) list and the cross-mailbox result list share one
    // contract; a second inline fill is how the two drift apart.
    const calls = viewSrc.match(/mailRowSurfaceClass\(\{ selected: isSelected/g) ?? [];
    expect(calls).toHaveLength(2);
    // The ring that never painted is gone from every class attribute, not
    // merely restyled (the prose above the rule still names it on purpose).
    expect(viewSrc.match(/class="[^"]*ring-md-secondary/g) ?? []).toEqual([]);
    // The ROW's hover and pressed washes are the contract's now - a view-level
    // wash on a row is what made "selected" and "hovered" the same pixel. (The
    // star button inside the row keeps its own hover: it is an icon button, not
    // a row surface.)
    const rowClasses = viewSrc.match(/class="[^"]*mailRowSurfaceClass\(\(?\{?[^"]*"/g) ?? [];
    expect(rowClasses).toHaveLength(2);
    expect(rowClasses.filter((c) => /hover:bg-|active:bg-/.test(c))).toEqual([]);
    // ...and each row still exposes its state to the real-extension probe.
    expect(viewSrc.match(/data-selected=\{isSelected \? 'true' : 'false'\}/g) ?? []).toHaveLength(
      2
    );
  });
});

describe('the mailbox ink, in all six themes', () => {
  test('theme.css declares the six themes this guard covers', () => {
    expect(THEME_NAMES).toEqual([
      'light-standard',
      'dark-standard',
      'light-medium',
      'dark-medium',
      'light-high',
      'dark-high',
    ]);
  });

  test('the ink on the fill keeps its level in every theme, read from the class strings', () => {
    const floors: Record<keyof typeof SELECTED_ROW_INK, number> = {
      subject: 4.5,
      sender: 4.5,
      preview: 4,
      meta: 4,
      star: 3,
    };
    // Every line reads the same slot set, and the slots are the sheet's own.
    expect(Object.values(SELECTED_ROW_INK).map(slotOf)).toEqual([
      'primary',
      'primary',
      'meta',
      'meta',
      'icon',
    ]);
    const failures: string[] = [];
    for (const theme of THEME_NAMES) {
      const fill = fillOf(theme);
      for (const [kind, classes] of Object.entries(SELECTED_ROW_INK)) {
        const ratio = contrast(inkOnFill(theme, classes), fill);
        const floor = floors[kind as keyof typeof SELECTED_ROW_INK];
        if (ratio < floor) failures.push(`${theme} ${kind}: ${ratio.toFixed(2)}:1 < ${floor}:1`);
      }
    }
    expect(failures).toEqual([]);
  });

  test('the selected ink beats the muted on-surface ink it replaced, in every theme', () => {
    for (const theme of THEME_NAMES) {
      const fill = fillOf(theme);
      const selected = contrast(inkOnFill(theme, SELECTED_ROW_INK.sender), fill);
      const old = contrast(mix(hexToRgb(tokenOf(theme, 'md-on-surface')), fill, 0.5), fill);
      expect(selected).toBeGreaterThan(old);
    }
  });

  test('a starred star on a selected row is legible, so the amber is dropped there', () => {
    expect(mailRowStarClass({ selected: true, starred: true })).not.toBe('text-md-tertiary');
    expect(mailRowStarClass({ selected: false, starred: true })).toBe('text-md-tertiary');
    expect(mailRowStarClass({ selected: false, starred: false })).toBe('text-md-on-surface/25');
    // The amber really is unusable on the fill in the high-contrast themes -
    // the `filled` glyph shape, not the hue, is what keeps "starred" readable.
    expect(
      contrast(hexToRgb(tokenOf('dark-high', 'md-tertiary')), fillOf('dark-high'))
    ).toBeLessThan(3);
    // The ink it uses instead clears the icon floor in every theme.
    for (const theme of THEME_NAMES) {
      expect(contrast(inkOnFill(theme, SELECTED_ROW_INK.star), fillOf(theme))).toBeGreaterThan(3);
    }
  });
});
