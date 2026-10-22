import { describe, expect, test } from 'bun:test';
import {
  badgeAnchorText,
  fitNavPill,
  type MeasureTextPx,
  navBadgeEndPadPx,
  navBadgePlacementPx,
  navBadgeWidthPx,
} from '@/utils/ui/fit-nav-pill.js';
import {
  MORE_ITEM_PAD_BLOCK_PX,
  NAV_BADGE_GAP_PX,
  NAV_BADGE_HEIGHT_PX,
  NAV_BADGE_MIN_W_PX,
  NAV_BADGE_PAD_X_PX,
  NAV_ICON_SIZE_PX,
  NAV_ITEM_PAD_BLOCK_PX,
  NAV_ITEM_PAD_X_MAX_PX,
  NAV_ITEM_PAD_X_MIN_PX,
  NAV_LABEL_BASE_FONT_PX,
  NAV_LABEL_DEFAULT_FONT_PX,
  NAV_LABEL_FONT_WEIGHT,
  NAV_LABEL_MIN_FONT_PX,
  navIconSizePx,
} from '@/utils/ui/nav-layout.js';

/**
 * Deterministic stand-in for canvas metrics: the arithmetic under test must not
 * depend on which fonts happen to be installed. `.length × size × factor` keeps
 * the relative widths of the words intact (so "Addresses" stays wider than
 * "More"), which is all the lever ordering needs.
 */
const measure: MeasureTextPx = (text, sizePx, weight) =>
  text.length * sizePx * (weight >= 700 ? 0.62 : 0.55);

const LABELS = ['Mailbox', 'Addresses', 'Autofill', 'More'];
const sumAtBase = LABELS.reduce(
  (total, label) => total + measure(label, NAV_LABEL_BASE_FONT_PX, NAV_LABEL_FONT_WEIGHT),
  0
);
/** Fixed, non-label width the fitter reserves at the authored padding. */
const FIXED_AT_MAX_PAD = LABELS.length * NAV_ITEM_PAD_X_MAX_PX * 2 + (18 + 3);

const fit = (overrides: Partial<Parameters<typeof fitNavPill>[0]> = {}) =>
  fitNavPill({
    labels: LABELS,
    availPx: 284,
    lang: 'en',
    hasActiveIcon: true,
    badgeText: null,
    measure,
    ...overrides,
  });

describe('fitNavPill - levers and floors', () => {
  test('production icons preserve their proportion as label fonts shrink', () => {
    for (const size of [10, 11, 12, 14, 14.28]) {
      expect(navIconSizePx(size) / size).toBeCloseTo(18 / 14, 6);
    }
    expect(navIconSizePx(10)).toBeLessThan(navIconSizePx(14));
  });

  test('font steps remeasure both the active icon and indicated inactive icon', () => {
    for (const availPx of [120, 200, 260, 320, 400]) {
      const result = fit({
        availPx,
        iconSizeFor: navIconSizePx,
        extraChromePx: (size) => navIconSizePx(size) + 3 + 8,
      });
      const labelWidth = LABELS.reduce(
        (sum, label) => sum + measure(label, result.fontPx, NAV_LABEL_FONT_WEIGHT),
        0
      );
      const actualWidth =
        labelWidth + LABELS.length * result.padX * 2 + 2 * (navIconSizePx(result.fontPx) + 3) + 8;
      expect(result.overBudgetPx).toBeCloseTo(Math.max(0, actualWidth - availPx), 1);
    }
  });

  test('starts at the locale-scaled base when there is room', () => {
    const roomy = fit({ availPx: 2000 });
    expect(roomy.fontPx).toBe(NAV_LABEL_BASE_FONT_PX);
    expect(roomy.padX).toBe(NAV_ITEM_PAD_X_MAX_PX);
    expect(roomy.overBudgetPx).toBe(0);
  });

  test('scales the starting size by locale', () => {
    // de/fr start at 0.88 - the fitter may never exceed its own base.
    expect(fit({ lang: 'de', availPx: 2000 }).fontPx).toBeCloseTo(NAV_LABEL_BASE_FONT_PX * 0.88, 2);
    expect(fit({ lang: 'en', availPx: 2000 }).fontPx).toBeGreaterThan(
      fit({ lang: 'de', availPx: 2000 }).fontPx
    );
  });

  test('never exceeds the base or drops below the floor, whatever the width', () => {
    for (const availPx of [40, 100, 180, 284, 400, 900, 4000]) {
      const result = fit({ availPx });
      expect(result.fontPx).toBeLessThanOrEqual(NAV_LABEL_BASE_FONT_PX);
      expect(result.fontPx).toBeGreaterThanOrEqual(NAV_LABEL_MIN_FONT_PX);
      expect(result.padX).toBeGreaterThanOrEqual(NAV_ITEM_PAD_X_MIN_PX);
      expect(result.padX).toBeLessThanOrEqual(NAV_ITEM_PAD_X_MAX_PX);
      expect(result.padXEnd).toBeGreaterThanOrEqual(result.padX);
    }
  });

  test('spends padding before it touches the font', () => {
    // §8.3's order: spacing is the first lever. One pixel under the width at
    // which the authored pair fits, the padding takes the step - the font is
    // untouched, because shrinking the labels to buy 1px is what made every
    // locale render at 11-12px when 12-14 was affordable.
    const justFits = fit({ availPx: sumAtBase + FIXED_AT_MAX_PAD + 0.5 });
    expect(justFits.fontPx).toBe(NAV_LABEL_BASE_FONT_PX);
    expect(justFits.padX).toBe(NAV_ITEM_PAD_X_MAX_PX);

    const onePixelShort = fit({ availPx: sumAtBase + FIXED_AT_MAX_PAD - 1 });
    expect(onePixelShort.padX).toBe(NAV_ITEM_PAD_X_MAX_PX - 2);
    expect(onePixelShort.fontPx).toBe(NAV_LABEL_BASE_FONT_PX);
  });

  test('steps the font only when the 0.75 × font gate closes the padding path', () => {
    // The responsive fitting's two constraints are separate and both hold: padding is spent
    // first, but it may only fall to 0.75 × F while a lower typography step is
    // still available. The floor size is what the ladder finally reaches.
    for (const availPx of [140, 180, 220, 260, 290, 320, 360]) {
      const result = fit({ availPx });
      if (result.padX === NAV_ITEM_PAD_X_MAX_PX) {
        // Padding untouched ⇒ the font must be untouched too: no font cut can
        // happen before the first padding step is taken.
        expect(result.fontPx).toBe(NAV_LABEL_BASE_FONT_PX);
      }
      // A roomy-looking average may never have bought a smaller font for itself.
      if (result.fontPx < NAV_LABEL_BASE_FONT_PX) {
        expect(result.padX).toBeLessThan(NAV_ITEM_PAD_X_MAX_PX);
      }
    }

    // Both floors spent at a pathological width - the padding floor is the XS/S
    // tiers' 4px, never lower, and the remainder is reported rather than hidden.
    const squeezed = fit({ availPx: 120 });
    expect(squeezed.padX).toBe(NAV_ITEM_PAD_X_MIN_PX);
    expect(squeezed.fontPx).toBe(NAV_LABEL_MIN_FONT_PX);
  });

  test('never spends padding past the tier floor, and says what is left', () => {
    const squeezed = fit({ availPx: 100 });
    expect(squeezed.padX).toBe(NAV_ITEM_PAD_X_MIN_PX);
    expect(squeezed.fontPx).toBe(NAV_LABEL_MIN_FONT_PX);
    // The reported remainder is the labels' width minus what the floors could buy.
    const labelSpace = 100 - (LABELS.length * NAV_ITEM_PAD_X_MIN_PX * 2 + (18 + 3));
    const needAtFloor = LABELS.reduce(
      (total, label) => total + measure(label, NAV_LABEL_MIN_FONT_PX, NAV_LABEL_FONT_WEIGHT),
      0
    );
    expect(squeezed.overBudgetPx).toBeCloseTo(needAtFloor - labelSpace, 1);
    expect(squeezed.overBudgetPx).toBeGreaterThan(0);
  });

  test('reports nothing left over exactly when the labels fit', () => {
    for (const availPx of [200, 260, 284, 320, 344, 360]) {
      const result = fit({ availPx });
      const labelSpace =
        availPx - (LABELS.length * result.padX * 2 + (result.padXEnd - result.padX) + (18 + 3));
      const need = LABELS.reduce(
        (total, label) => total + measure(label, result.fontPx, NAV_LABEL_FONT_WEIGHT),
        0
      );
      // Honest either way: overBudgetPx is 0 iff the labels really fit.
      expect(result.overBudgetPx === 0).toBe(need <= labelSpace + 0.25);
    }
  });

  test('does not reserve an inter-item gap that the nav does not have', () => {
    // The nav ITEMS are flush against each other; the 6px `gap-1.5` is between
    // the pill and the FAB. Reserving (n − 1) × 6 for a non-existent gap is what
    // made every locale render over budget: the break-even width below is the
    // padding + the single expanded icon and nothing else.
    expect(fit({ availPx: sumAtBase + FIXED_AT_MAX_PAD + 0.5 }).fontPx).toBe(
      NAV_LABEL_BASE_FONT_PX
    );
    expect(fit({ availPx: sumAtBase + FIXED_AT_MAX_PAD + 3 * 6 + 0.5 }).fontPx).toBe(
      NAV_LABEL_BASE_FONT_PX
    );
    expect(fit({ availPx: sumAtBase + FIXED_AT_MAX_PAD + 3 * 6 + 5 }).fontPx).toBe(
      NAV_LABEL_BASE_FONT_PX
    );
  });

  test('reserves the expanded active icon only while a primary item is active', () => {
    const withIcon = fit({ availPx: sumAtBase + FIXED_AT_MAX_PAD + 0.5, hasActiveIcon: true });
    const withoutIcon = fit({ availPx: sumAtBase + FIXED_AT_MAX_PAD + 0.5, hasActiveIcon: false });
    expect(withIcon.fontPx).toBe(NAV_LABEL_BASE_FONT_PX);
    // With no primary item active (every view lives behind More) the icon stays
    // collapsed, so the fit must not hold 21px for it - 10px of slack has to be
    // enough, and the row must spend nothing at all.
    expect(withoutIcon.fontPx).toBe(NAV_LABEL_BASE_FONT_PX);
    expect(withoutIcon.padX).toBe(NAV_ITEM_PAD_X_MAX_PX);
    // The icon's 21px costs the row exactly one padding step: it is spacing that
    // pays for it, never the labels' size.
    const iconReserve = fit({
      availPx: sumAtBase + LABELS.length * NAV_ITEM_PAD_X_MAX_PX * 2 + 10,
    });
    expect(iconReserve.padX).toBe(NAV_ITEM_PAD_X_MAX_PX - 2);
    expect(iconReserve.fontPx).toBe(NAV_LABEL_BASE_FONT_PX);
    expect(iconReserve.overBudgetPx).toBe(0);
  });
});

describe('fitNavPill - the font it returns is the largest that fits', () => {
  test('a roomy-looking average never inflates the font past what fits', () => {
    // 320px over 4 items averages 80px per slot - exactly the condition under
    // which the old fitter raised the font back to 13px WITHOUT checking that
    // 13px fit, putting the row ~25px over budget in every locale. The fit must
    // stay at the largest size that actually fits, and fit.
    const result = fit({ availPx: 320 });
    expect(320 / LABELS.length).toBeGreaterThanOrEqual(52);
    expect(result.overBudgetPx).toBe(0);
    const needAt13 = LABELS.reduce(
      (total, label) => total + measure(label, NAV_LABEL_DEFAULT_FONT_PX, NAV_LABEL_FONT_WEIGHT),
      0
    );
    // What the old answer would have overflowed by - the failure this replaces.
    expect(needAt13 - (320 - FIXED_AT_MAX_PAD)).toBeGreaterThan(0);
  });

  test('is the largest size that fits at every width, never inflated back up', () => {
    for (const availPx of [180, 220, 260, 300, 320, 344, 400, 900]) {
      const result = fit({ availPx });
      const labelSpace =
        availPx - (LABELS.length * result.padX * 2 + (result.padXEnd - result.padX) + (18 + 3));
      const need = LABELS.reduce(
        (total, label) => total + measure(label, result.fontPx, NAV_LABEL_FONT_WEIGHT),
        0
      );
      if (result.overBudgetPx === 0) {
        expect(need).toBeLessThanOrEqual(labelSpace + 0.25);
      } else {
        // The only honest reason to report a remainder: both levers are spent.
        expect(result.padX).toBe(NAV_ITEM_PAD_X_MIN_PX);
      }
    }
  });

  test('starts at the base and stops at the base', () => {
    expect(fit({ availPx: 4000 }).fontPx).toBe(NAV_LABEL_BASE_FONT_PX);
    expect(fit({ availPx: sumAtBase + FIXED_AT_MAX_PAD + 0.5 }).fontPx).toBe(
      NAV_LABEL_BASE_FONT_PX
    );
    // Half a pixel short is a SPACING problem: the padding takes it and the font
    // stays at the base - the row never shrinks its text to buy half a pixel.
    const barelyShort = fit({ availPx: sumAtBase + FIXED_AT_MAX_PAD - 0.5 });
    expect(barelyShort.fontPx).toBe(NAV_LABEL_BASE_FONT_PX);
    expect(barelyShort.padX).toBeLessThan(NAV_ITEM_PAD_X_MAX_PX);
  });
});

describe('fitNavPill - the unread badge reserve', () => {
  test('reserves the badge box plus the row’s own side padding, not a flat 8px', () => {
    const withBadge = fit({ badgeText: '99+', availPx: 2000 });
    expect(withBadge.badgeW).toBeGreaterThanOrEqual(NAV_BADGE_MIN_W_PX);
    // The padding term is what keeps the count clear of the segment's rim, so it
    // is never below the tiers' side-padding floor - the reserve used to add a
    // bespoke 2px inset instead, half the floor, which on the ACTIVE segment (its
    // box IS the selected pill's fill) read as the count on the pill's edge.
    expect(withBadge.padXEnd).toBe(withBadge.padX + NAV_BADGE_GAP_PX + withBadge.badgeW);
    expect(withBadge.padX).toBeGreaterThanOrEqual(NAV_ITEM_PAD_X_MIN_PX);
  });

  test('the reserve puts the count’s box ON the label’s ink end - no daylight', () => {
    // The rule the count is placed by: its bottom-left corner is the last
    // letter's glyph-ink top-right corner. Inline, that means the box's
    // inline-start edge IS the ink's inline-end edge, so the reserve is the badge
    // box plus the row's own side padding and nothing more: `NAV_BADGE_GAP_PX` is
    // 0 by design, and any daylight left here would push the count off the letter.
    expect(NAV_BADGE_GAP_PX).toBe(0);
    for (const text of ['9', '12', '99+']) {
      const w = navBadgeWidthPx(text, measure);
      const endPad = navBadgeEndPadPx(w, NAV_ITEM_PAD_X_MAX_PX);
      // The label's content ends `endPad` from the item's inline-end; the badge's
      // box starts `padX` from it (its CSS inset) and is `w` wide - the two edges
      // coincide, and the count still keeps a full side padding to the rim.
      const boxStartFromItemEnd = NAV_ITEM_PAD_X_MAX_PX + w;
      expect(endPad).toBe(boxStartFromItemEnd + NAV_BADGE_GAP_PX);
      expect(endPad - NAV_ITEM_PAD_X_MAX_PX - w).toBeCloseTo(NAV_BADGE_GAP_PX, 6);
      expect(endPad - w).toBeGreaterThanOrEqual(NAV_ITEM_PAD_X_MIN_PX);
    }
  });

  test('a three-digit count reserves more than a single digit', () => {
    const wide = fit({ badgeText: '99+', availPx: 2000 });
    const narrow = fit({ badgeText: '9', availPx: 2000 });
    expect(wide.badgeW).toBeGreaterThan(narrow.badgeW);
    expect(wide.padXEnd).toBeGreaterThan(narrow.padXEnd);
  });

  test('costs nothing when there is no badge', () => {
    const noBadge = fit({ badgeText: null });
    expect(noBadge.badgeW).toBe(0);
    expect(noBadge.padXEnd).toBe(noBadge.padX);
  });

  test('the badge reserve survives the padding compression', () => {
    // The badge box is not a padding choice: the end padding may only shrink to
    // the row's padding plus the badge's box and gap - the label can never slide
    // under the count, and the count never loses its clearance from the rim.
    const squeezed = fit({ badgeText: '99+', availPx: 220 });
    expect(squeezed.padX).toBeLessThan(NAV_ITEM_PAD_X_MAX_PX);
    expect(squeezed.padXEnd).toBe(squeezed.padX + NAV_BADGE_GAP_PX + squeezed.badgeW);
    // The count's box to the segment's rim is the padding the fitter chose - at
    // or above the tier floor, even after every lever has been spent.
    expect(squeezed.padXEnd - squeezed.badgeW).toBeGreaterThanOrEqual(NAV_ITEM_PAD_X_MIN_PX);
  });

  test('the badge helpers are the one definition of both numbers', () => {
    // Both the pill and the More menu call these, so a menu badge can no longer
    // reserve nothing (which is exactly how the count ended up over the label
    // there) and neither surface can drift from the other.
    expect(navBadgeWidthPx(null, measure)).toBe(0);
    expect(navBadgeWidthPx('9', measure)).toBe(NAV_BADGE_MIN_W_PX);
    expect(navBadgeWidthPx('99+', measure)).toBeCloseTo(
      measure('99+', 9, 700) + 2 * NAV_BADGE_PAD_X_PX,
      5
    );
    expect(navBadgeEndPadPx(0, 7)).toBe(7);
    expect(navBadgeEndPadPx(24, 4)).toBe(4 + NAV_BADGE_GAP_PX + 24);
    // The row's padding is KEPT (not merely floored): a wide row gives the count
    // the same breathing room from the segment's rim as every other side has.
    expect(navBadgeEndPadPx(14, 20)).toBe(20 + NAV_BADGE_GAP_PX + 14);
  });

  test('the count lands on the label’s glyph-ink top, not on the button’s top', () => {
    // Real metrics from the shipped face at the pill's base font (Roboto 14px):
    // the face's ascent/descent and the glyph ink of a LATIN label, then of a
    // tall-script one whose diacritics rise higher.
    const latin = { fontAscentPx: 15, fontDescentPx: 3.2, inkAscentPx: 10.8 };
    const tallScript = { fontAscentPx: 15, fontDescentPx: 3.2, inkAscentPx: 13 };
    const placementFor = (padBlockStartPx: number, padBlockEndPx: number, ink: typeof latin) =>
      navBadgePlacementPx({
        padBlockStartPx,
        padBlockEndPx,
        contentHeightPx: NAV_ICON_SIZE_PX,
        labelFontPx: NAV_LABEL_BASE_FONT_PX,
        ...ink,
      });

    // The badge's box ends exactly where the ink top is: item height minus the
    // ink top, measured from the block-end edge.
    const pill = placementFor(NAV_ITEM_PAD_BLOCK_PX, NAV_ITEM_PAD_BLOCK_PX, latin);
    const itemHeight = NAV_ICON_SIZE_PX + pill.padBlockStartPx + NAV_ITEM_PAD_BLOCK_PX;
    const centering = (NAV_ICON_SIZE_PX - NAV_LABEL_BASE_FONT_PX) / 2;
    const inkTopFromLabelTop =
      (NAV_LABEL_BASE_FONT_PX - (latin.fontAscentPx + latin.fontDescentPx)) / 2 +
      latin.fontAscentPx -
      latin.inkAscentPx;
    const inkTopFromItemTop = pill.padBlockStartPx + centering + inkTopFromLabelTop;
    expect(pill.bottomInsetPx).toBeCloseTo(itemHeight - inkTopFromItemTop, 5);
    // ...and the whole box stays inside the item with fill to spare: the lane
    // opens by the badge's height plus the rim clearance, so the count is never
    // flush against the item's top edge - which for the active item IS the pill's
    // own background boundary, where a flush count reads as stitched into it.
    expect(pill.padBlockStartPx).toBeCloseTo(
      NAV_BADGE_HEIGHT_PX + 2 - centering - inkTopFromLabelTop,
      5
    );
    expect(itemHeight - pill.bottomInsetPx - NAV_BADGE_HEIGHT_PX).toBeGreaterThanOrEqual(1);

    // Taller ink needs a deeper lane - the same relation, from the metrics.
    const taller = placementFor(NAV_ITEM_PAD_BLOCK_PX, NAV_ITEM_PAD_BLOCK_PX, tallScript);
    expect(taller.padBlockStartPx).toBeGreaterThan(pill.padBlockStartPx);
    expect(taller.bottomInsetPx).toBeGreaterThan(pill.bottomInsetPx);

    // The authored padding is a floor: a shallow label may never shrink the item.
    const shallow = placementFor(20, NAV_ITEM_PAD_BLOCK_PX, latin);
    expect(shallow.padBlockStartPx).toBe(20);

    // The More menu reaches the same relation from its own authored padding.
    const menu = placementFor(MORE_ITEM_PAD_BLOCK_PX, MORE_ITEM_PAD_BLOCK_PX, latin);
    expect(menu.padBlockStartPx).toBeGreaterThan(MORE_ITEM_PAD_BLOCK_PX);
  });

  test('the count caps the LAST letter, not the tallest mark in the label', () => {
    // The ink read for the anchor is `actualBoundingBoxAscent` of the letter the
    // count sits on. Reading it off the whole label is what lifted the count off
    // the word in Thai: the tone mark over an early consonant (กล่อง…) is the
    // string's tallest ink, while the word ends on a plain letter (…หมาย).
    const THAI_MARK = '\u0e48';
    expect(badgeAnchorText('Mailbox')).toBe('x');
    expect(badgeAnchorText('กล่องจดหมาย')).toBe('ย');
    // ...and the mark that IS attached to the last letter comes along with it.
    expect(badgeAnchorText('ที่อยู่')).toBe('ยู่');
    expect(badgeAnchorText('กล่องจดหมาย')).not.toContain(THAI_MARK);
    // CJK, a single character, a surrogate pair, and the degenerate inputs.
    expect(badgeAnchorText('メールボックス')).toBe('ス');
    expect(badgeAnchorText('A')).toBe('A');
    expect(badgeAnchorText('Pin 📌')).toBe('📌');
    expect(badgeAnchorText('')).toBe('');
    expect(badgeAnchorText(THAI_MARK)).toBe(THAI_MARK);
    // A label that is nothing but marks still has to return something.
    const placement = navBadgePlacementPx({
      padBlockStartPx: NAV_ITEM_PAD_BLOCK_PX,
      padBlockEndPx: NAV_ITEM_PAD_BLOCK_PX,
      contentHeightPx: NAV_ICON_SIZE_PX,
      labelFontPx: NAV_LABEL_BASE_FONT_PX,
      fontAscentPx: 15,
      fontDescentPx: 3.2,
      inkAscentPx: 13,
    });
    expect(placement.padBlockStartPx).toBeGreaterThan(NAV_ITEM_PAD_BLOCK_PX);
  });

  test('no metric combination can put the count outside its own item', () => {
    // The badge item deliberately does NOT clip, so a box that spilled would
    // paint over the pill's rim - worse than a count a fraction of a pixel below
    // the ink top. Sweep the plausible metric space, including ink taller than
    // the font's own ascent and a font taller than the icon box.
    for (const labelFontPx of [9, 11, 13, 14, 18, 24]) {
      for (const inkAscentPx of [0, 6, 9, 13, 24, 40]) {
        for (const [padBlockStartPx, padBlockEndPx] of [
          [NAV_ITEM_PAD_BLOCK_PX, NAV_ITEM_PAD_BLOCK_PX],
          [MORE_ITEM_PAD_BLOCK_PX, MORE_ITEM_PAD_BLOCK_PX],
          [0, 40],
        ]) {
          const placement = navBadgePlacementPx({
            padBlockStartPx,
            padBlockEndPx,
            contentHeightPx: NAV_ICON_SIZE_PX,
            labelFontPx,
            fontAscentPx: labelFontPx * 1.05,
            fontDescentPx: labelFontPx * 0.25,
            inkAscentPx,
          });
          const itemHeight = NAV_ICON_SIZE_PX + placement.padBlockStartPx + padBlockEndPx;
          // Never below the authored padding...
          expect(placement.padBlockStartPx).toBeGreaterThanOrEqual(padBlockStartPx);
          // ...and the box always inside the item on both edges.
          expect(placement.bottomInsetPx).toBeGreaterThanOrEqual(0);
          expect(itemHeight - placement.bottomInsetPx - NAV_BADGE_HEIGHT_PX).toBeGreaterThanOrEqual(
            0
          );
        }
      }
    }
  });

  test('a longer label borrows room from a shorter one within one row', () => {
    // The fitter fits the SUM, not a per-item average: a row with one long label
    // gets a size no single-item box could allow.
    const row = ['Supercalifragilistic', 'A', 'B', 'C'];
    const availPx = 275;
    const result = fitNavPill({
      labels: row,
      availPx,
      lang: 'en',
      hasActiveIcon: true,
      badgeText: null,
      measure,
    });
    expect(result.overBudgetPx).toBe(0);
    // The long label alone needs several times an equal share of the row, and is
    // still not truncated - a per-item (average-slot) rule could never fit it.
    const share = availPx / row.length;
    expect(measure(row[0], result.fontPx, NAV_LABEL_FONT_WEIGHT)).toBeGreaterThan(2 * share);
    // And the row pays for it with spacing, not by crushing the text.
    expect(result.fontPx).toBeGreaterThan(NAV_LABEL_MIN_FONT_PX);
  });
});
