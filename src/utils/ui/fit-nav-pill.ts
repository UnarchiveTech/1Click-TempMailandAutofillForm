/**
 * Floating-pill fitting.
 *
 * The bottom nav is a segmented control - elastic active indicator, collapsing
 * active icon, More overflow menu - not an action-button row, so it keeps its
 * own fitter instead of `responsiveButtonLayout` (AGENTS.md §8 governs action rows).
 * It does follow the same two rules the responsive fitting rests on, because both are
 * about geometry telling the truth:
 *
 *  1. **Spacing before typography** - §8.3's overflow order. The item's side
 *     padding steps down 2px at a time FIRST, never below the responsive fitting's
 *     `P >= 0.75 x F` gate and never below the XS/S tiers' 4px floor; the font
 *     only compresses when that gate blocks the next padding step, and padding
 *     resumes once the font is at its floor. The reverse order (font to its
 *     floor, then padding) over-shrinks the labels and reaches the padding
 *     floor late, which is what made every locale render at 11-12px when 12-14
 *     was affordable.
 *  2. **The fitter's answer must be achievable.** `overBudgetPx` reports what
 *     the labels still need after BOTH levers are spent, and the row renders
 *     exactly what the fitter returned - `overBudgetPx > 0` is the only state
 *     that may hide label ink, and the caller declares it (`data-nav-overflow`)
 *     rather than letting a shrinkable flex box shave a few pixels off every
 *     last letter (see `.nav-label` in Footer.svelte).
 *
 * Three arithmetic bugs lived here before, all of which pushed the row over and
 * let the nav shrink below its content instead:
 *
 *  - The wide-layout "soft floor" raised the font back to 13px whenever the
 *    *average* slot looked roomy, without checking that 13px actually fit - so
 *    every locale rendered ~40% over budget at popup width. It is gone rather
 *    than guarded: the downward scan below already returns the LARGEST size that
 *    fits, so a second pass that only ever raises the font was dead code the
 *    moment the reserve stopped being wrong.
 *  - The fixed width counted `(n - 1) × NAV_GAP_PX` as an inter-item gap. The
 *    nav items are adjacent; that 6px gap lives between the nav and the FAB, so
 *    18px of label budget was being reserved for a gap that does not exist.
 *  - The badge reserved a flat 8px while the badge box is 17-24px wide, which
 *    is what let a two-digit count paint over the label in ja / th.
 *
 * Its inline placement was the fifth: the count was inset from the segment's rim
 * by a 2px constant - half the XS/S tiers' side-padding floor - so on the ACTIVE
 * segment, whose box is the selected pill's fill, the count read as sitting on
 * that fill's edge. The reserve now carries the row's own side padding (see
 * `navBadgeEndPadPx`), so the count keeps exactly the padding the rest of the row
 * keeps between its content and the segment's rim.
 *
 * The badge's own placement was the fourth bug in the same family: its block
 * anchor was the BUTTON (`top: 2px`) rather than the label - so the count floated
 * above the word instead of sitting on the last glyph's ink top-right corner.
 * `navBadgePlacementPx` now derives both the badge's block inset and the lane of
 * item padding that inset needs, from the measured ink metrics of the letter the
 * count caps (`badgeAnchorText`), so a tall mark earlier in the label cannot lift
 * the count off the letter it belongs to.
 *
 * Measurement is injected so the arithmetic is unit testable without a canvas.
 */

import { localeFontScale } from '@/utils/i18n/locale-font-scale.js';
import {
  NAV_BADGE_FONT_PX,
  NAV_BADGE_GAP_PX,
  NAV_BADGE_HEIGHT_PX,
  NAV_BADGE_MIN_W_PX,
  NAV_BADGE_PAD_X_PX,
  NAV_DOT_GAP_PX,
  NAV_DOT_SIZE_PX,
  NAV_ICON_GAP_PX,
  NAV_ICON_SIZE_PX,
  NAV_ITEM_PAD_X_MAX_PX,
  NAV_ITEM_PAD_X_MIN_PX,
  NAV_LABEL_BASE_FONT_PX,
  NAV_LABEL_FONT_WEIGHT,
  NAV_LABEL_MIN_FONT_PX,
} from './nav-layout.js';

/** Measures the rendered width of `text` at `sizePx` / `weight`. */
export type MeasureTextPx = (text: string, sizePx: number, weight: number) => number;

/**
 * The label's vertical ink extents, from the same canvas the widths come from:
 * `fontBoundingBox*` is the face's ascent/descent (what the browser centres the
 * line box on) and `actualBoundingBoxAscent` is where the glyphs' ink actually
 * stops - read for `badgeAnchorText(label)`, the letter the count caps, NOT for
 * the whole label (see that helper).
 */
export type LabelInkMetrics = {
  inkAscentPx: number;
  /** Actual glyph ink's right edge from the start of the label. */
  inkRightPx: number;
  fontAscentPx: number;
  fontDescentPx: number;
};

/** A Unicode combining mark (`\p{M}`): it belongs to the character before it. */
const COMBINING_MARK_RE = /\p{M}/u;

/**
 * The text the unread count hangs off: the label's LAST letter - one base
 * character plus the combining marks that belong to it.
 *
 * Reading the ink off the WHOLE label is wrong for exactly the scripts the
 * superscript exists for. `actualBoundingBoxAscent` is the tallest ink anywhere
 * in the string, so in Thai a tone mark over an early consonant (`กล่อง…`) lifts
 * the count to that mark's height even though the word ENDS on a plain letter
 * (`…หมาย`): the count then floats above the word's end - detached from the
 * letter it is supposed to cap - and the superscript lane opens for ink that is
 * nowhere near it, growing the pill. A Devanagari matra or a Latin accent
 * earlier in the word does the same thing.
 *
 * Walking code points from the end through the trailing combining marks covers
 * the "base + marks" shape of Thai / Lao / Devanagari (marks follow the base)
 * and returns the final character for Latin, CJK and emoji. `Intl.Segmenter`
 * would be the general answer, but it is newer than this extension's Firefox
 * floor, and a pure slice keeps this unit-testable and mirrorable.
 */
export function badgeAnchorText(label: string): string {
  const chars = [...label];
  let start = chars.length - 1;
  while (start > 0 && COMBINING_MARK_RE.test(chars[start])) start -= 1;
  return chars.slice(Math.max(0, start)).join('');
}

export type MeasureLabelInkPx = (text: string, sizePx: number, weight: number) => LabelInkMetrics;

/** Icon + icon→label gap, contributed by exactly one (the active) item. */
const NAV_ACTIVE_ICON_PX = NAV_ICON_SIZE_PX + NAV_ICON_GAP_PX;
/** Badge weight - the badge renders bolder than its label. */
const NAV_BADGE_WEIGHT = 700;
/**
 * Fill the superscript lane keeps between the badge's box and the item's top
 * edge (px). The item's top edge is the ACTIVE pill's own background boundary -
 * they are the same box - so a count flush against it reads as stitched into the
 * pill's fill instead of sitting on the letter. This is the number that buys that
 * separation; the lane is sized from it, and the ink it hangs off never moves.
 */
const NAV_BADGE_RIM_CLEARANCE_PX = 2;
/**
 * Typography step (px). The same 0.25px granularity every other label fitter in
 * the app scans in (`fit-label-font.ts`), so "fits" means the same thing here.
 */
const NAV_FONT_STEP_PX = 0.25;

/** Rounds to the quarter-pixel the app's font fitters all work in. */
const roundQuarter = (value: number): number => Math.round(value * 100) / 100;

export type NavPillFitInput = {
  /** Nav labels, in render order (typically 3 primary items + More). */
  labels: string[];
  /** Width available to the pill (shell width − insets − FAB − gap). */
  availPx: number;
  /** Active locale, for `localeFontScale`. */
  lang: string | null | undefined;
  /** Badge text rendered on the mailbox item, or null when there is no badge. */
  badgeText: string | null;
  /** Number of items reserving this badge lane. Defaults to one when text exists. */
  badgeCount?: number;
  /** Number of active dot indicators placed after their labels. */
  dotCount?: number;
  /** Additional indicator chrome, optionally remeasured at each font step. */
  extraChromePx?: number | ((labelFontPx: number) => number);
  /** Rendered icon size at each font step; omitted for the fixed-icon preview model. */
  iconSizeFor?: (labelFontPx: number) => number;
  /**
   * Whether a primary item is active. Only then does its icon expand (using
   * iconSizeFor when supplied, plus the icon gap), so only then may the fit reserve that width - counting it
   * when no primary item is active would shrink the font for nothing, and the
   * font is shared by every item.
   */
  hasActiveIcon: boolean;
  measure: MeasureTextPx;
};

export type NavPillFit = {
  /** Label font in px - between `NAV_LABEL_MIN_FONT_PX` and the locale base. */
  fontPx: number;
  /** Item side padding in px - between `NAV_ITEM_PAD_X_MIN_PX` and 14. */
  padX: number;
  /**
   * Side padding for the badge-carrying item. Never below `padX`; grows so the
   * badge box plus its clearance stays clear of the label.
   */
  padXEnd: number;
  /** Rendered badge box width (0 when there is no badge). */
  badgeW: number;
  /** Label width the fit could not place (0 = everything fits). */
  overBudgetPx: number;
};

/** The badge's own box: its `min-width`, or its text + padding, whichever is wider. */
export function navBadgeWidthPx(badgeText: string | null, measure: MeasureTextPx): number {
  if (!badgeText) return 0;
  return Math.max(
    NAV_BADGE_MIN_W_PX,
    measure(badgeText, NAV_BADGE_FONT_PX, NAV_BADGE_WEIGHT) + 2 * NAV_BADGE_PAD_X_PX
  );
}

/**
 * End-side padding the badge-carrying item needs so the label's ink ends where
 * the count's box begins: the row's OWN side padding (the same `padX` every
 * other segment side uses, and the surface's own value in the More menu) plus
 * the badge box, plus `NAV_BADGE_GAP_PX` - which is zero, because the count's
 * bottom-left corner sits on the last letter's ink top-right corner.
 *
 * The padding term is what keeps the count inside the segment: it is the space
 * between the badge's box and the segment's rim, so it can never be smaller than
 * the row's spacing floor. A bespoke inset here (2px) put the count at half the
 * XS/S tiers' 4px floor, and on the active item - whose box is the selected
 * pill's fill - that read as the count sitting on the pill's edge. Shared by the
 * pill and the More menu, so the two cannot reserve differently (which is how the
 * More menu ended up with no reserve at all and painted the count over its label).
 */
export function navBadgeEndPadPx(badgeWidth: number, padX: number): number {
  return badgeWidth > 0 ? padX + NAV_BADGE_GAP_PX + badgeWidth : padX;
}

export type NavBadgePlacementInput = {
  /** Authored block-start padding - a FLOOR the superscript lane may raise. */
  padBlockStartPx: number;
  /** Authored block-end padding (never part of the lane). */
  padBlockEndPx: number;
  /** Tallest in-flow child of the item - the `.nav-icon` box (18px). */
  contentHeightPx: number;
  /** Label font; `line-height: 1` makes it the label's box height. */
  labelFontPx: number;
  /** `fontBoundingBoxAscent` for the face the label is painted with. */
  fontAscentPx: number;
  /** `fontBoundingBoxDescent` for that same face. */
  fontDescentPx: number;
  /**
   * `actualBoundingBoxAscent` for `badgeAnchorText(label)` - the ink top of the
   * letter the count caps, above the shared baseline.
   */
  inkAscentPx: number;
};

export type NavBadgePlacement = {
  /** Block-start padding the item uses (>= the authored floor). */
  padBlockStartPx: number;
  /**
   * Distance from the item's block-end edge to the badge's block-end edge, so
   * the badge's box sits on the last letter's glyph-ink top - its bottom-left
   * corner on that ink's top-right corner, with the fitted reserve putting the
   * box's inline-start edge on the ink's inline-end edge.
   */
  bottomInsetPx: number;
};

/**
 * Where the unread count sits, relative to the LAST LETTER's glyph ink.
 *
 * The count is a superscript: its block-end edge is `inkAscentPx` - the ink top
 * of the letter it caps (`badgeAnchorText(label)`), not the tallest mark
 * anywhere in the label - and its inline-start edge is that letter's ink end, so
 * the badge's bottom-left corner lands on the letter's top-right corner.
 * Anchoring the block axis to the item instead (`top: 2px`
 * of the button) is what made the count float ~12px above a ja / th / zh label
 * and hang down into the text's band: the item's top is a property of the
 * button's padding, while "top-right of the last letter" is a property of the
 * text.
 *
 * That needs the ink to have somewhere to go, so the item's block-START padding
 * is raised to whatever the badge's own height requires above the ink top, plus
 * `NAV_BADGE_RIM_CLEARANCE_PX` of fill so the count never sits flush against the
 * active pill's own background boundary (the item's top edge). The lane keeps the
 * island's height honest, because the badge cannot be allowed to paint over the
 * pill's rim. The authored padding is the floor: the lane may open the item,
 * never close it.
 *
 * The returned inset is clamped so the badge's box can never start above the
 * item's - a guard for a script whose ink rises further than the lane carries
 * (in which case the badge lands a fraction of a pixel below the ink top rather
 * than being clipped).
 *
 * Metrics in, numbers out: no DOM, so the pill and the More menu can share it.
 */
export function navBadgePlacementPx(input: NavBadgePlacementInput): NavBadgePlacement {
  const { padBlockEndPx, contentHeightPx, labelFontPx, inkAscentPx } = input;
  /**
   * Top of the label's glyph ink, from the label's own box top. `line-height: 1`
   * centres the font's content area (ascent + descent) in a box one font-size
   * tall, and the ink is the font's ascent minus the glyphs' own ink ascent -
   * negative when the ink rises above the box, which is exactly the tall-script
   * case the lane has to cover.
   */
  const inkTopFromLabelTop =
    (labelFontPx - (input.fontAscentPx + input.fontDescentPx)) / 2 +
    input.fontAscentPx -
    inkAscentPx;
  /** The label box is centred in the content box (the 18px icon). */
  const centering = (contentHeightPx - labelFontPx) / 2;
  /** Room the badge needs above the ink top for its whole box to stay inside. */
  const needed = NAV_BADGE_HEIGHT_PX + NAV_BADGE_RIM_CLEARANCE_PX - centering - inkTopFromLabelTop;
  const padBlockStartPx = roundQuarter(Math.max(input.padBlockStartPx, needed));
  const itemHeightPx = contentHeightPx + padBlockStartPx + padBlockEndPx;
  const inkTopFromItemTop = padBlockStartPx + centering + inkTopFromLabelTop;
  const bottomInsetPx = roundQuarter(
    Math.max(0, Math.min(itemHeightPx - inkTopFromItemTop, itemHeightPx - NAV_BADGE_HEIGHT_PX))
  );
  return { padBlockStartPx, bottomInsetPx };
}

/**
 * Fit the pill's label font (and, only if needed, its item padding) into
 * `availPx`, in the same 0.25px steps every other label fitter in the app uses,
 * so they all agree on what "fits" means.
 */
export function fitNavPill(input: NavPillFitInput): NavPillFit {
  const { labels, availPx, lang, badgeText, hasActiveIcon, measure } = input;
  const badgeCount = input.badgeCount ?? (badgeText ? 1 : 0);
  const dotCount = input.dotCount ?? 0;
  const base = NAV_LABEL_BASE_FONT_PX * localeFontScale(lang);

  const badgeW = navBadgeWidthPx(badgeText, measure);

  /** End padding that lands the label's ink end on the badge's inline-start edge. */
  const endPadFor = (padX: number): number => navBadgeEndPadPx(badgeW, padX);

  /** Non-label width: item padding (both sides, badge item on its end padding),
   *  the single expanded active icon, and nothing else - nav items are adjacent. */
  const fixedWidth = (padX: number, sizePx: number): number =>
    labels.length * padX * 2 +
    badgeCount * (endPadFor(padX) - padX) +
    dotCount * (NAV_DOT_SIZE_PX + NAV_DOT_GAP_PX) +
    (typeof input.extraChromePx === 'function'
      ? input.extraChromePx(sizePx)
      : (input.extraChromePx ?? 0)) +
    (hasActiveIcon
      ? input.iconSizeFor
        ? input.iconSizeFor(sizePx) + NAV_ICON_GAP_PX
        : NAV_ACTIVE_ICON_PX
      : 0);

  const sumAt = (sizePx: number): number => {
    let total = 0;
    // The painted weight - a bolder face is wider, and measuring a lighter one
    // than `.nav-label` paints is how labels got their last letter shaved.
    for (const label of labels) total += label ? measure(label, sizePx, NAV_LABEL_FONT_WEIGHT) : 0;
    return total;
  };

  /** The whole row at a given (font, padding) pair, and what is left over. */
  const overAt = (sizePx: number, pad: number): number =>
    Math.max(0, roundQuarter(sumAt(sizePx) + fixedWidth(pad, sizePx) - availPx));

  let padX = NAV_ITEM_PAD_X_MAX_PX;
  let fontPx = base;

  // 8.3's order, one lever at a time, re-measuring after every step:
  //   - padding down 2px, while the 0.75 x F gate and the tier floor allow it;
  //   - otherwise ONE typography step (the 0.25px scan every other label fitter
  //     in the app uses), which is the responsive fitting's response to the gate closing;
  //   - padding again to its own floor once the font is at its floor;
  //   - anything still left is reported, never absorbed by the flex box.
  while (overAt(fontPx, padX) > 0) {
    const nextPad = padX - 2;
    if (nextPad >= NAV_ITEM_PAD_X_MIN_PX && nextPad >= 0.75 * fontPx) {
      padX = nextPad;
      continue;
    }
    if (fontPx > NAV_LABEL_MIN_FONT_PX) {
      // The floor is a reachable step, not a wall: from 11.05 the next step is
      // 11.00 exactly, never "blocked because 10.80 would be below it".
      fontPx = roundQuarter(Math.max(NAV_LABEL_MIN_FONT_PX, fontPx - NAV_FONT_STEP_PX));
      continue;
    }
    if (padX > NAV_ITEM_PAD_X_MIN_PX) {
      padX = Math.max(NAV_ITEM_PAD_X_MIN_PX, nextPad);
      continue;
    }
    break;
  }

  // A roomy row never enters the loop, so it keeps the authored pair exactly.
  const overBudgetPx = overAt(fontPx, padX);

  return { fontPx, padX, padXEnd: endPadFor(padX), badgeW, overBudgetPx };
}
