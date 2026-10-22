/**
 * `advanceWithTrackingPx` - the letter-spacing correction both label fitters
 * need (`createLabelMetrics` for the pill, `fitLabelFontSize` for the More
 * menu), and the wiring that makes them use it.
 *
 * The nav labels paint with `letter-spacing: 0.5px`
 * (`--md-type-label-medium-tracking`), and `measureText` ignores it. Measuring
 * without it reserved half a pixel less than every character needed, so the fit
 * reported a row that "fit" while the flexbox silently shaved the last letter off
 * EVERY nav item - 3.31 / 2.88 / 2.11 / 1.50px measured in the shipped build.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { advanceWithTrackingPx, fitLabelFontSize } from '@/utils/ui/fit-label-font.js';

describe('advanceWithTrackingPx', () => {
  test('adds the tracking once per character, including the last', () => {
    // 7 characters ⇒ 7 × 0.5px. CSS adds the spacing after every character, the
    // final one included, so the label advances by n × spacing, not (n − 1) ×.
    expect(advanceWithTrackingPx(43.85, 'Mailbox', 0.5)).toBeCloseTo(47.35, 5);
    expect(advanceWithTrackingPx(28.97, 'More', 0.5)).toBeCloseTo(30.97, 5);
  });

  test('the correction follows the label, not the font size', () => {
    expect(advanceWithTrackingPx(0, 'Addresses', 0.5)).toBeCloseTo(4.5, 5);
    expect(advanceWithTrackingPx(0, 'Autofill', 0.5)).toBeCloseTo(4, 5);
    expect(advanceWithTrackingPx(0, 'Mailbox', 0.5)).toBeCloseTo(3.5, 5);
  });

  test('zero tracking is exactly the raw measurement', () => {
    expect(advanceWithTrackingPx(43.85, 'Mailbox', 0)).toBe(43.85);
  });

  test('an empty label carries no spacing', () => {
    expect(advanceWithTrackingPx(0, '', 0.5)).toBe(0);
  });
});

describe('fitLabelFontSize reserves the tracking', () => {
  // A stand-in canvas: 0.5px of advance per character per px of font size, so the
  // arithmetic the fitter does is exact and readable. The real numbers (11px
  // Mailbox = 43.85px raw / 47.35px painted) are in the describe above.
  const measure = (text: string, sizePx: number) => text.length * 0.5 * sizePx;

  test('the tracking is part of the fit, not the caller\u2019s business', () => {
    // 7 chars at 11px = 38.5px raw, +7 × 0.5px = 42px painted. A 40px slot fits
    // at no size (7 chars × 0.5 × 6 = 21px + 3.5 = 24.5 fits at 6px, below the
    // 8.5px floor)… so pick a slot the tracking alone decides: 40.5px.
    const labels = [{ text: 'Mailbox', availableWidth: 40.5 }];
    const withTracking = fitLabelFontSize(labels, {
      basePx: 11,
      minPx: 8.5,
      measure,
      letterSpacingPx: 0.5,
    });
    const without = fitLabelFontSize(labels, { basePx: 11, minPx: 8.5, measure });
    // Without tracking the fit says 11px (38.5 ≤ 38.5); with it, the row needs
    // 42px and the fitter must come down.
    expect(without).toBe(11);
    expect(withTracking).toBeLessThan(11);
    expect(
      advanceWithTrackingPx(measure('Mailbox', withTracking), 'Mailbox', 0.5)
    ).toBeLessThanOrEqual(40.5 - 2);
  });

  test('zero tracking is the raw measurement, unchanged', () => {
    const labels = [{ text: 'Mailbox', availableWidth: 40.5 }];
    expect(fitLabelFontSize(labels, { basePx: 11, minPx: 8.5, measure })).toBe(11);
  });

  test('the chosen size always leaves the row inside its slot', () => {
    const labels = [
      { text: 'Mailbox', availableWidth: 60 },
      { text: 'Addresses', availableWidth: 70 },
    ];
    for (const letterSpacingPx of [0, 0.5, 1]) {
      const size = fitLabelFontSize(labels, { basePx: 14, minPx: 8.5, measure, letterSpacingPx });
      for (const l of labels) {
        const painted = advanceWithTrackingPx(measure(l.text, size), l.text, letterSpacingPx);
        if (size > 8.5) expect(painted).toBeLessThanOrEqual(l.availableWidth - 2);
      }
    }
  });

  test('no labels means the base size, never a NaN', () => {
    expect(fitLabelFontSize([], { basePx: 12, measure })).toBe(12);
  });
});

describe('createLabelMetrics uses it', () => {
  test('the raw canvas width is passed through the tracking correction', () => {
    // The canvas is unavailable under `bun test`, so the wiring is pinned at the
    // source instead of by a measurement: a raw `measureText(...).width` returned
    // straight from `width()` is the bug this test exists to prevent.
    const src = readFileSync(
      join(import.meta.dir, '..', '..', '..', 'src', 'utils', 'ui', 'fit-label-font.ts'),
      'utf8'
    );
    expect(src).toContain(
      'advanceWithTrackingPx(c.measureText(text).width, text, letterSpacingPx)'
    );
    // …and the OTHER fitter reserves it too: the More menu's labels are
    // `.nav-label` as well, so a fit that skips the correction shaves the same
    // half-pixel-per-character off every menu label.
    expect(src).toContain(
      'advanceWithTrackingPx(measure(text, size, weight), text, letterSpacingPx)'
    );
  });
});
