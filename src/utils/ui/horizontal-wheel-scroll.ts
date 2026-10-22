/**
 * Svelte action: map wheel input to horizontal scroll and allow mouse/pen
 * press-drag panning. RTL scroll positions are normalized to logical inline
 * coordinates so the action does not depend on the browser's scrollLeft model.
 */
type RtlScrollModel = 'default' | 'negative' | 'reverse';

let cachedRtlScrollModel: RtlScrollModel | null = null;

function getRtlScrollModel(): RtlScrollModel {
  if (cachedRtlScrollModel) return cachedRtlScrollModel;
  if (typeof document === 'undefined') return 'negative';

  const outer = document.createElement('div');
  const inner = document.createElement('div');
  outer.dir = 'rtl';
  outer.style.cssText =
    'position:absolute;inset:-9999px auto auto -9999px;width:4px;height:1px;overflow:scroll;';
  inner.style.cssText = 'width:8px;height:1px;';
  outer.appendChild(inner);
  (document.body ?? document.documentElement).appendChild(outer);

  if (outer.scrollLeft > 0) {
    cachedRtlScrollModel = 'reverse';
  } else {
    outer.scrollLeft = 1;
    cachedRtlScrollModel = outer.scrollLeft === 0 ? 'negative' : 'default';
  }
  outer.remove();
  return cachedRtlScrollModel;
}

function maxScrollLeft(el: HTMLElement): number {
  return Math.max(0, el.scrollWidth - el.clientWidth);
}

function logicalScrollLeft(el: HTMLElement, rtl: boolean): number {
  if (!rtl) return el.scrollLeft;
  const max = maxScrollLeft(el);
  switch (getRtlScrollModel()) {
    case 'negative':
      return -el.scrollLeft;
    case 'reverse':
      return max - el.scrollLeft;
    default:
      return el.scrollLeft;
  }
}

function setLogicalScrollLeft(el: HTMLElement, value: number, rtl: boolean): void {
  const max = maxScrollLeft(el);
  const logical = Math.max(0, Math.min(max, value));
  if (!rtl) {
    el.scrollLeft = logical;
    return;
  }
  switch (getRtlScrollModel()) {
    case 'negative':
      el.scrollLeft = -logical;
      break;
    case 'reverse':
      el.scrollLeft = max - logical;
      break;
    default:
      el.scrollLeft = logical;
  }
}

export function enableHorizontalWheelScroll(el: HTMLElement) {
  const oldCursor = el.style.cursor;
  const oldTouchAction = el.style.touchAction;
  let activeDragCleanup: (() => void) | null = null;
  let clickBlockTimer: ReturnType<typeof setTimeout> | null = null;

  const onWheel = (e: WheelEvent) => {
    const max = maxScrollLeft(el);
    if (max <= 0) return;

    const rtl = getComputedStyle(el).direction === 'rtl';
    const hasHorizontalDelta = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    // A vertical wheel advances along the inline axis. An explicit horizontal
    // delta follows the physical direction of the wheel/trackpad movement.
    const logicalDelta = hasHorizontalDelta ? (rtl ? -e.deltaX : e.deltaX) : e.deltaY;
    if (logicalDelta === 0) return;

    const current = logicalScrollLeft(el, rtl);
    const next = Math.max(0, Math.min(max, current + logicalDelta));
    if (next !== current) {
      e.preventDefault();
      setLogicalScrollLeft(el, next, rtl);
    }
  };

  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    if (e.button !== 0) return;
    activeDragCleanup?.();

    let dragging = false;
    const startX = e.clientX;
    const rtl = getComputedStyle(el).direction === 'rtl';
    const startScroll = logicalScrollLeft(el, rtl);
    const pointerId = e.pointerId;

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      try {
        if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
      } catch {
        /* Pointer capture can already be released during teardown. */
      }
      el.style.cursor = oldCursor;
      if (activeDragCleanup === cleanup) activeDragCleanup = null;
    };

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!dragging && Math.abs(dx) > 6) {
        dragging = true;
        try {
          el.setPointerCapture(pointerId);
        } catch {
          /* Window listeners still complete the drag if capture is unavailable. */
        }
        el.style.cursor = 'grabbing';
      }
      if (dragging) {
        ev.preventDefault();
        setLogicalScrollLeft(el, startScroll - dx, rtl);
      }
    };

    const onUp = () => {
      cleanup();
      if (dragging) {
        const blockClick = (click: Event) => {
          click.stopPropagation();
          click.preventDefault();
          el.removeEventListener('click', blockClick, true);
          clickBlockTimer = null;
        };
        el.addEventListener('click', blockClick, true);
        clickBlockTimer = setTimeout(() => {
          el.removeEventListener('click', blockClick, true);
          clickBlockTimer = null;
        }, 0);
      }
      dragging = false;
    };

    activeDragCleanup = cleanup;
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('pointerdown', onDown);
  el.style.touchAction = 'pan-x';

  return {
    destroy() {
      activeDragCleanup?.();
      if (clickBlockTimer) clearTimeout(clickBlockTimer);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      el.style.cursor = oldCursor;
      el.style.touchAction = oldTouchAction;
    },
  };
}
