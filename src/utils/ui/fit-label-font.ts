/**
 * Shared dynamic font-sizing for single-line button/nav labels.
 * Shrinks font until every label fits its container without truncation/wrap.
 */

export type FitLabelFontOptions = {
  /** CSS font-weight (default 600) */
  weight?: number | string;
  /** Starting font size in px */
  basePx?: number;
  /** Minimum font size in px */
  minPx?: number;
  /** Extra width reserved (icon + padding + gaps) */
  reservedPx?: number;
  /** Font family stack */
  fontFamily?: string;
  /**
   * The label's CSS letter-spacing, in px. `measureText` ignores it and the nav
   * labels paint 0.5px per character, so a fit that omits it reserves half a
   * pixel less than every character needs - the last letter of every label gets
   * shaved by exactly that gap. Omit only for labels that genuinely paint none.
   */
  letterSpacingPx?: number;
};

/**
 * The stack the app actually RENDERS labels in - `body { font-family }` in
 * `src/styles.css`, pinned by `tests/unit/utils/fit-label-font.test.ts`.
 *
 * This used to be `system-ui, Roboto, …`, i.e. a *different* order from the one
 * the shell renders with. Measuring a font the app never paints is a silent
 * geometry lie: the fitter says "fits", the render overflows, and the label
 * ends up wider than the button box the active pill is sized to. Same-font on
 * the machines where `Roboto` is absent - which is exactly why it survived.
 */
export const BODY_FONT_FAMILY =
  'Roboto, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", "Helvetica Neue", Arial, sans-serif';

const DEFAULT_FONT = BODY_FONT_FAMILY;

/**
 * The font stack `el` (or its ancestor) renders text with. Preferred over
 * `BODY_FONT_FAMILY` when a live element is available: a caller that renders
 * inside a themed subtree then measures *that* subtree's font, so the fit can
 * never drift from the paint again.
 */
export function resolveLabelFontFamily(el: Element | null | undefined): string {
  if (!el || typeof getComputedStyle !== 'function') return BODY_FONT_FAMILY;
  const resolved = getComputedStyle(el).fontFamily;
  return resolved || BODY_FONT_FAMILY;
}

/**
 * A label's vertical ink extents, from the same canvas the widths come from:
 * `fontBoundingBox*` is the face's ascent/descent (what the browser centres the
 * line box on) and `actualBoundingBoxAscent` is where the glyphs' ink stops.
 */
export type LabelInkMetrics = {
  /** `actualBoundingBoxAscent` for the anchored text, above the shared baseline. */
  inkAscentPx: number;
  /** `actualBoundingBoxRight` for the anchored text, from its inline start. */
  inkRightPx: number;
  fontAscentPx: number;
  fontDescentPx: number;
};

/** Label measurement bound to ONE family - widths and vertical ink. */
export type LabelMetrics = {
  /** Advance width of `text`, exactly as the app paints it. */
  width(text: string, sizePx: number, weight: number): number;
  /**
   * Vertical metrics for a label whose BADGE-CAPPED letter is `anchor`.
   *
   * The ink top is read for `anchor` - the label's last letter, one base
   * character plus its combining marks - because `actualBoundingBoxAscent` of a
   * whole string is the TALLEST ink anywhere in it (a Thai tone mark over an
   * early consonant lifts a whole-word read off the letter the count caps). The
   * font box still comes from `text`, the whole label, because that is what the
   * rendered line box is built from.
   */
  ink(text: string, sizePx: number, weight: number, anchor?: string): LabelInkMetrics;
};

/**
 * The ONE canvas label-measurement in the app: the nav pill, the More menu and
 * the `tests/visual/preview-responsive-button-layout.html` nav panels all measure through this,
 * so no surface can measure a face (or an ink box) another one does not paint.
 * Bound to `fontFamily` at creation for exactly that reason - pass the stack the
 * element actually renders with (`resolveLabelFontFamily`).
 *
 * `letterSpacingPx` is NOT optional in spirit: `measureText` ignores the CSS
 * letter-spacing the label paints with, and the nav labels carry 0.5px per
 * character (`--md-type-label-medium-tracking`). Measuring without it reserves
 * half a pixel less than every single character needs, which is why the last
 * letter of EVERY nav item was being sliced in half by the flexbox - the row
 * looked 14px narrower on paper than it painted. CSS adds the spacing after each
 * character, including the last, so the correction is `spacing x characters`.
 */
/**
 * The letter-spacing a `.nav-label` actually paints with, in px.
 *
 * Read from a LIVE label when one is rendered (the only honest source), else
 * derived from the same design token the global strip rule uses - the first fit
 * and the membership probe both run before a label has painted, and a first
 * measurement at zero tracking is a measurement that cuts every last letter.
 */
export function resolveLabelTrackingPx(el: Element | null | undefined): number {
  const live = el?.querySelector('.nav-label');
  if (live) return parseFloat(getComputedStyle(live).letterSpacing) || 0;
  const token = el
    ? getComputedStyle(el as HTMLElement).getPropertyValue('--md-type-label-medium-tracking')
    : '';
  const value = parseFloat(token);
  if (!Number.isFinite(value)) return 0;
  // The token is authored in rem (0.03125rem = 0.5px); a bare px/em value is
  // taken at face value. Never guess past what the token says.
  return token.includes('rem') ? value * 16 : value;
}

/**
 * A label's advance with CSS letter-spacing applied: the raw text width plus one
 * spacing per character. CSS adds the spacing after EVERY character - the last
 * one included - so the whole label advances by `n x spacing`, not `(n-1) x`.
 *
 * Pure on purpose: `measureText` needs a canvas, this does not, so the rule that
 * keeps the last letter whole is unit-testable without a DOM.
 */
export function advanceWithTrackingPx(
  rawWidthPx: number,
  text: string,
  letterSpacingPx: number
): number {
  return rawWidthPx + letterSpacingPx * text.length;
}

export function createLabelMetrics(
  fontFamily: string = DEFAULT_FONT,
  letterSpacingPx = 0
): LabelMetrics {
  let ctx: CanvasRenderingContext2D | null = null;
  const context = (): CanvasRenderingContext2D | null => {
    if (typeof document === 'undefined') return null;
    if (!ctx) ctx = document.createElement('canvas').getContext('2d');
    return ctx;
  };
  const setFont = (c: CanvasRenderingContext2D, sizePx: number, weight: number): void => {
    c.font = `${weight} ${sizePx}px ${fontFamily}`;
  };
  return {
    width(text, sizePx, weight) {
      const c = context();
      if (!c) return 0;
      setFont(c, sizePx, weight);
      return advanceWithTrackingPx(c.measureText(text).width, text, letterSpacingPx);
    },
    ink(text, sizePx, weight, anchor) {
      const c = context();
      const fallback: LabelInkMetrics = {
        inkAscentPx: 0,
        inkRightPx: 0,
        fontAscentPx: sizePx,
        fontDescentPx: 0,
      };
      if (!c) return fallback;
      setFont(c, sizePx, weight);
      const whole = c.measureText(text);
      const anchored = anchor === undefined || anchor === text ? whole : c.measureText(anchor);
      return {
        inkAscentPx: anchored.actualBoundingBoxAscent ?? 0,
        inkRightPx: anchored.actualBoundingBoxRight ?? anchored.width,
        fontAscentPx: whole.fontBoundingBoxAscent ?? sizePx,
        fontDescentPx: whole.fontBoundingBoxDescent ?? 0,
      };
    },
  };
}

/**
 * Measure labels against available widths and return a font-size (px) that fits all.
 * @param labelsWithWidth array of { text, availableWidth } where availableWidth is the button/item content box
 *
 * `measure` is the RAW advance of the text at a size (no tracking) - injectable so
 * the sizing arithmetic can be tested without a canvas, exactly as `fitNavPill`
 * takes one. The tracking is applied here, by the fitter, so a caller cannot
 * forget it.
 */
export function fitLabelFontSize(
  labelsWithWidth: Array<{ text: string; availableWidth: number }>,
  options: FitLabelFontOptions & {
    measure?: (text: string, sizePx: number, weight: number | string) => number;
  } = {}
): number {
  const weight = options.weight ?? 600;
  const base = options.basePx ?? 13;
  const minPx = options.minPx ?? 8.5;
  const reserved = options.reservedPx ?? 0;
  const fontFamily = options.fontFamily ?? DEFAULT_FONT;
  const letterSpacingPx = options.letterSpacingPx ?? 0;

  if (!labelsWithWidth.length) return base;

  let raw = options.measure;
  if (!raw) {
    if (typeof document === 'undefined') return base;
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return base;
    // The one place the family is bound: `ctx.font` cannot be re-read, so the
    // closure sets it from the size the loop is testing.
    const canvas = ctx;
    raw = (text, sizePx, weightPx) => {
      canvas.font = `${weightPx} ${sizePx}px ${fontFamily}`;
      return canvas.measureText(text).width;
    };
  }
  const measure = raw;

  let size = base;
  while (size >= minPx) {
    let fits = true;
    for (const { text, availableWidth } of labelsWithWidth) {
      if (!text) continue;
      const need =
        advanceWithTrackingPx(measure(text, size, weight), text, letterSpacingPx) + reserved;
      if (need > availableWidth - 2) {
        fits = false;
        break;
      }
    }
    if (fits) break;
    size -= 0.25;
  }
  return Math.round(size * 100) / 100;
}
