/**
 * Computes the optical vertical offset (in pixels) for a status label / notch
 * element so it sits optically centered on a horizontal line or border -
 * adapting across languages, fonts, diacritics, and script metrics (e.g.
 * Thai, Arabic, CJK, Latin).
 *
 * Strategy:
 *  1. DOM Range: measure the rendered text line-box bounds (minTop/maxBottom)
 *     and compute the text vertical midpoint;
 *  2. Measure the DOM baseline using a zero-size inline marker, then use
 *     TextMetrics actualBoundingBoxAscent/Descent to locate the glyph ink;
 *  3. Prefer the measured ink offset; fall back to the DOM line-box offset when
 *     the baseline marker or canvas metrics are unavailable.
 *
 * AddressSelectorBar supplies data-optical-text and data-optical-baseline.
 * The marker participates in inline layout without painting or adding size.
 */
export function computeOpticalCenterOffset(notchEl: HTMLElement): number {
  if (!notchEl || typeof window === 'undefined') return 0;

  const notchRect = notchEl.getBoundingClientRect();
  if (notchRect.height === 0) return 0;

  const elementCenterY = notchRect.top + notchRect.height / 2;

  // 1. DOM Range Layout Box Measurement
  let minTop = Infinity;
  let maxBottom = -Infinity;
  let foundRange = false;

  try {
    const range = document.createRange();
    const walker = document.createTreeWalker(notchEl, NodeFilter.SHOW_TEXT, null);
    let node = walker.nextNode();
    while (node) {
      if (node.textContent?.trim()) {
        range.selectNodeContents(node);
        const rects = range.getClientRects();
        for (let i = 0; i < rects.length; i++) {
          const r = rects[i];
          if (r.height > 0) {
            if (r.top < minTop) minTop = r.top;
            if (r.bottom > maxBottom) maxBottom = r.bottom;
            foundRange = true;
          }
        }
      }
      node = walker.nextNode();
    }
  } catch {
    /* ignore */
  }

  const visualTextCenterY =
    foundRange && Number.isFinite(minTop) && Number.isFinite(maxBottom)
      ? (minTop + maxBottom) / 2
      : elementCenterY;
  const domOpticalOffset = elementCenterY - visualTextCenterY;

  // 2. Glyph ink relative to the ACTUAL rendered baseline, not a guessed
  // fraction of fontSize. Coordinates share the element's translation, so the
  // resulting offset does not accumulate when layout runs again.
  try {
    const textEl = notchEl.querySelector<HTMLElement>('[data-optical-text]');
    const baselineEl = textEl?.querySelector<HTMLElement>('[data-optical-baseline]');
    const text = textEl?.textContent?.replace(/\s+/gu, ' ').trim() || '';
    if (text && textEl && baselineEl) {
      const computedStyle = window.getComputedStyle(textEl);
      const fontSize = parseFloat(computedStyle.fontSize) || 12;
      const fontStyle = computedStyle.fontStyle || 'normal';
      const fontWeight = computedStyle.fontWeight || '400';
      const fontFamily = computedStyle.fontFamily || 'sans-serif';
      const fontCss = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.font = fontCss;
        ctx.textBaseline = 'alphabetic';
        const metrics = ctx.measureText(text);
        const ascent = metrics.actualBoundingBoxAscent;
        const descent = metrics.actualBoundingBoxDescent;
        const baselineY = baselineEl.getBoundingClientRect().top;
        if (
          Number.isFinite(ascent) &&
          Number.isFinite(descent) &&
          Number.isFinite(baselineY) &&
          ascent + descent > 0
        ) {
          const inkCenterY = baselineY + (descent - ascent) / 2;
          return elementCenterY - inkCenterY;
        }
      }
    }
  } catch {
    /* ignore */
  }

  return domOpticalOffset;
}
