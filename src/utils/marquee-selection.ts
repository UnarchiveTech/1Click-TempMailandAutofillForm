/**
 * Shared helpers for rubber-band (marquee) multi-select on list UIs.
 */

export type MarqueeRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export function normalizeMarquee(
  a: { x: number; y: number },
  b: { x: number; y: number }
): MarqueeRect {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x),
    bottom: Math.max(a.y, b.y),
  };
}

export function rectsIntersect(a: MarqueeRect, b: MarqueeRect): boolean {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

export function clientRectToMarquee(r: DOMRectReadOnly): MarqueeRect {
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

/** Minimum drag distance (px) before marquee is considered active */
export const MARQUEE_THRESHOLD = 6;

/**
 * Collect data-ids of elements that intersect the marquee rect.
 * @param root list container
 * @param itemSelector e.g. '[data-marquee-id]'
 * @param marquee current selection rect in viewport coords
 */
export function collectIntersectingIds(
  root: HTMLElement,
  itemSelector: string,
  marquee: MarqueeRect
): string[] {
  const nodes = root.querySelectorAll<HTMLElement>(itemSelector);
  const ids: string[] = [];
  for (const el of nodes) {
    const id = el.getAttribute('data-marquee-id');
    if (!id) continue;
    const r = clientRectToMarquee(el.getBoundingClientRect());
    if (rectsIntersect(marquee, r)) ids.push(id);
  }
  return ids;
}

/** True when event target is an interactive control that should not start marquee */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest(
    'button, a, input, textarea, select, [role="button"], [role="menuitem"], [data-no-marquee]'
  );
}
