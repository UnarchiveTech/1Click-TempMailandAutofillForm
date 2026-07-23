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
};

const DEFAULT_FONT =
  'system-ui, Roboto, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/**
 * Measure labels against available widths and return a font-size (px) that fits all.
 * @param labelsWithWidth array of { text, availableWidth } where availableWidth is the button/item content box
 */
export function fitLabelFontSize(
  labelsWithWidth: Array<{ text: string; availableWidth: number }>,
  options: FitLabelFontOptions = {}
): number {
  const weight = options.weight ?? 600;
  const base = options.basePx ?? 13;
  const minPx = options.minPx ?? 8.5;
  const reserved = options.reservedPx ?? 0;
  const fontFamily = options.fontFamily ?? DEFAULT_FONT;

  if (typeof document === 'undefined' || !labelsWithWidth.length) return base;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return base;

  let size = base;
  while (size >= minPx) {
    ctx.font = `${weight} ${size}px ${fontFamily}`;
    let fits = true;
    for (const { text, availableWidth } of labelsWithWidth) {
      if (!text) continue;
      const need = ctx.measureText(text).width + reserved;
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

/**
 * Fit font for a set of buttons (uses each button's clientWidth and a label selector).
 */
export function fitButtonsLabelFont(
  buttons: HTMLElement[],
  labelSelector = 'span.leading-tight, span.whitespace-nowrap, span.truncate, .btn-label',
  options: FitLabelFontOptions = {}
): number {
  const items = buttons.map((btn) => {
    const el = btn.querySelector(labelSelector);
    const text = (el?.textContent || btn.textContent || '').trim();
    return { text, availableWidth: btn.clientWidth || 0 };
  });
  return fitLabelFontSize(items, { reservedPx: 48, ...options });
}
