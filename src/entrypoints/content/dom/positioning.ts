/**
 * Robust position tracking for injected UI elements.
 *
 * Injected buttons are appended to document.body, so the browser's normal
 * layout/scroll context doesn't follow the target field. The previous
 * implementation used `position: absolute` with manual `getBoundingClientRect()
 * + window.scrollY` math, which only worked for window scroll - it broke for
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
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')
    return false;
  const rect = target.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function trackElementPosition(
  button: HTMLElement,
  target: HTMLElement,
  positioner: (rect: DOMRect) => { top: number; left: number; visible: boolean },
  updatePositionListeners: Array<() => void>,
  layoutRoot?: HTMLElement
): PositionTracker {
  let isIntersecting = true;
  let frameId: number | null = null;
  // Snapshot the element's intended display (the pill sets
  // `display: inline-flex !important` via cssText). Restoring the RAW inline
  // style is critical: `style.display = ''` would DELETE the inline display
  // (and its !important priority), collapsing flex containers to `block` and
  // turning flex children into baseline-aligned inline boxes - which visibly
  // shifts segments (e.g. the Autofill All button 2px low) until a re-layout
  // happens to restore flex.
  const originalDisplay = button.style.display || '';
  const displayPriority = button.style.getPropertyPriority('display');

  const update = () => {
    if (frameId !== null) return;
    frameId = requestAnimationFrame(() => {
      frameId = null;
      if (!isVisible(target) || !isIntersecting) {
        button.style.display = 'none';
        return;
      }
      const rect = target.getBoundingClientRect();
      // Measure the intended size even after an intersection/space hide.
      button.style.setProperty('display', originalDisplay || 'block', displayPriority);
      const { top, left, visible } = positioner(rect);
      button.style.position = 'fixed';
      button.style.top = `${top}px`;
      button.style.left = `${left}px`;
      if (visible) {
        // Restore the intended display (with its priority) - never clobber it.
        if (originalDisplay) {
          button.style.setProperty('display', originalDisplay, displayPriority);
        } else {
          button.style.removeProperty('display');
        }
      } else {
        button.style.setProperty('display', 'none', displayPriority);
      }
    });
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
    resizeObserver = new ResizeObserver((entries) => {
      if (
        entries.some(
          (entry) =>
            entry.target !== button || (entry.contentRect.width > 0 && entry.contentRect.height > 0)
        )
      )
        update();
    });
    resizeObserver.observe(target);
    if (layoutRoot) {
      resizeObserver.observe(layoutRoot);
      resizeObserver.observe(button);
    }
    for (const ancestor of ancestors) {
      resizeObserver.observe(ancestor);
    }
  }

  let intersectionObserver: IntersectionObserver | null = null;
  if (typeof IntersectionObserver !== 'undefined') {
    intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          isIntersecting = entry.isIntersecting;
          update();
        }
      },
      { threshold: 0 }
    );
    intersectionObserver.observe(target);
  }

  const layoutObserver =
    layoutRoot && typeof MutationObserver !== 'undefined' ? new MutationObserver(update) : null;
  if (layoutRoot)
    layoutObserver?.observe(layoutRoot, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden'],
    });

  const cleanup = () => {
    if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
    window.removeEventListener('resize', resizeListener);
    layoutObserver?.disconnect();
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
  const BUTTON_SIZE = 20;
  return {
    top: rect.top + Math.max(0, (rect.height - BUTTON_SIZE) / 2),
    left: Math.max(0, rect.right - BUTTON_SIZE - 6),
    visible: rect.width > 0 && rect.height > 0,
  };
}

type PlacementRect = Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left'>;

/** Prefer the anchor gap, then free space around the form. Never cover a site control. */
export function chooseToolbarPosition(
  anchor: PlacementRect,
  form: PlacementRect,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  obstacles: PlacementRect[]
): { top: number; left: number; visible: boolean } {
  const gap = 6;
  const inset = 4;
  const left = Math.max(inset, Math.min(anchor.left, viewport.width - size.width - inset));
  const candidates = [
    { top: anchor.bottom + gap, left },
    { top: form.bottom + gap, left },
    { top: form.top - size.height - gap, left },
    { top: anchor.top - size.height - gap, left },
    { top: anchor.top, left: form.right + gap },
    { top: anchor.top, left: form.left - size.width - gap },
    ...obstacles.flatMap((rect) => [
      { top: rect.bottom + gap, left },
      { top: rect.top - size.height - gap, left },
    ]),
  ];
  for (const candidate of candidates) {
    const right = candidate.left + size.width;
    const bottom = candidate.top + size.height;
    if (
      candidate.top < inset ||
      candidate.left < inset ||
      right > viewport.width - inset ||
      bottom > viewport.height - inset
    )
      continue;
    if (
      obstacles.some(
        (rect) =>
          candidate.left < rect.right + inset &&
          right > rect.left - inset &&
          candidate.top < rect.bottom + inset &&
          bottom > rect.top - inset
      )
    )
      continue;
    return { ...candidate, visible: true };
  }
  // Keep website controls usable even when the viewport has no free slot.
  return { top: 0, left, visible: false };
}

export function createToolbarPositioner(
  button: HTMLElement,
  form: HTMLElement,
  scope: HTMLElement
) {
  return (anchor: DOMRect) => {
    const obstacles = Array.from(
      scope.querySelectorAll<HTMLElement>(
        'input,select,textarea,button,a,label,h1,h2,h3,h4,h5,h6,p,[role="button"],[role="heading"]'
      )
    )
      .filter(isVisible)
      .map((element) => element.getBoundingClientRect());
    return chooseToolbarPosition(
      anchor,
      form.getBoundingClientRect(),
      { width: button.offsetWidth, height: button.offsetHeight },
      { width: document.documentElement.clientWidth, height: window.innerHeight },
      // The chosen heading can be outside the form's layout scope. Keep it
      // clear even when the first candidate has to fall back above the form.
      [anchor, ...obstacles]
    );
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
