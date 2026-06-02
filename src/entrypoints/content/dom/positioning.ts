/**
 * Robust position tracking for injected UI elements.
 *
 * Injected buttons are appended to document.body, so the browser's normal
 * layout/scroll context doesn't follow the target field. The previous
 * implementation used `position: absolute` with manual `getBoundingClientRect()
 * + window.scrollY` math, which only worked for window scroll — it broke for
 * any form inside a nested scroll container (modal, sticky sidebar, any
 * `overflow: auto|scroll` parent) because the inner scroll wasn't tracked.
 *
 * The new approach:
 *  - `position: fixed` so coords map 1:1 to `getBoundingClientRect()`.
 *  - Scroll listeners on every `overflow: auto|scroll` ancestor.
 *  - Resize observer on the target element to handle dynamic layout changes.
 *  - IntersectionObserver to hide the element when the target scrolls out of
 *    view (e.g., clipped by a parent's `overflow: hidden`).
 *  - `display: none` check on the target.
 */

export interface PositionTracker {
  /** Stop tracking and detach all listeners. */
  cleanup: () => void;
}

const SCROLL_OVERFLOW_RE = /auto|scroll|overlay/;

function isScrollable(el: Element): boolean {
  const style = getComputedStyle(el);
  return (
    SCROLL_OVERFLOW_RE.test(style.overflow) ||
    SCROLL_OVERFLOW_RE.test(style.overflowX) ||
    SCROLL_OVERFLOW_RE.test(style.overflowY)
  );
}

function findScrollableAncestors(target: HTMLElement): HTMLElement[] {
  const ancestors: HTMLElement[] = [];
  let current: HTMLElement | null = target.parentElement;
  while (current && current !== document.documentElement) {
    if (isScrollable(current)) {
      ancestors.push(current);
    }
    current = current.parentElement;
  }
  return ancestors;
}

function isVisible(target: HTMLElement): boolean {
  if (!target.isConnected) return false;
  const style = getComputedStyle(target);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const rect = target.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function trackElementPosition(
  button: HTMLElement,
  target: HTMLElement,
  positioner: (rect: DOMRect) => { top: number; left: number; visible: boolean },
  updatePositionListeners: Array<() => void>
): PositionTracker {
  const update = () => {
    if (!isVisible(target)) {
      button.style.display = 'none';
      return;
    }
    const rect = target.getBoundingClientRect();
    const { top, left, visible } = positioner(rect);
    button.style.position = 'fixed';
    button.style.top = `${top}px`;
    button.style.left = `${left}px`;
    button.style.display = visible ? '' : 'none';
  };

  update();

  const ancestors = findScrollableAncestors(target);

  const resizeListener = () => update();
  const scrollListener = () => update();

  window.addEventListener('resize', resizeListener);
  window.addEventListener('scroll', scrollListener, { passive: true });
  for (const ancestor of ancestors) {
    ancestor.addEventListener('scroll', scrollListener, { passive: true });
  }

  let resizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => update());
    resizeObserver.observe(target);
    for (const ancestor of ancestors) {
      resizeObserver.observe(ancestor);
    }
  }

  let intersectionObserver: IntersectionObserver | null = null;
  if (typeof IntersectionObserver !== 'undefined') {
    intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          button.style.display = entry.isIntersecting ? '' : 'none';
        }
      },
      { threshold: 0 }
    );
    intersectionObserver.observe(target);
  }

  const cleanup = () => {
    window.removeEventListener('resize', resizeListener);
    window.removeEventListener('scroll', scrollListener);
    for (const ancestor of ancestors) {
      ancestor.removeEventListener('scroll', scrollListener);
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (intersectionObserver) {
      intersectionObserver.disconnect();
      intersectionObserver = null;
    }
  };

  updatePositionListeners.push(cleanup);

  return { cleanup };
}

/**
 * Position the button at the vertical center of the field, just inside its
 * right edge. Suitable for icon-sized buttons (≤ 32px).
 */
export function positionAtEndOfField(rect: DOMRect): {
  top: number;
  left: number;
  visible: boolean;
} {
  const BUTTON_SIZE = 24;
  return {
    top: rect.top + (rect.height - BUTTON_SIZE) / 2,
    left: Math.max(0, rect.right - BUTTON_SIZE - 4),
    visible: true,
  };
}

/**
 * Position the button above the form, anchored to its top-left corner.
 * Suitable for the "Fill All" pill button.
 */
export function positionAboveForm(rect: DOMRect): {
  top: number;
  left: number;
  visible: boolean;
} {
  const PILL_HEIGHT = 32;
  const top = rect.top - PILL_HEIGHT - 8;
  return {
    top: Math.max(0, top),
    left: Math.max(0, rect.left + 8),
    visible: top >= 0,
  };
}
