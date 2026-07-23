/**
 * Svelte action: when hovering a horizontally scrollable element, map vertical
 * wheel/trackpad deltas to horizontal scroll so chip rows (ScrollSpy) pan L/R.
 * Also supports press-hold-drag horizontal pan.
 */
export function enableHorizontalWheelScroll(el: HTMLElement) {
  const onWheel = (e: WheelEvent) => {
    // Prefer explicit horizontal delta; otherwise convert vertical to horizontal
    const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (dx === 0) return;
    // Only intercept when element can scroll horizontally
    const maxScroll = el.scrollWidth - el.clientWidth;
    if (maxScroll <= 0) return;
    const next = el.scrollLeft + dx;
    const clamped = Math.max(0, Math.min(maxScroll, next));
    if (clamped !== el.scrollLeft) {
      e.preventDefault();
      el.scrollLeft = clamped;
    }
  };

  // Press-hold-drag pan
  let dragging = false;
  let startX = 0;
  let startScroll = 0;
  let pointerId = 0;

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    dragging = false;
    startX = e.clientX;
    startScroll = el.scrollLeft;
    pointerId = e.pointerId;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!dragging && Math.abs(dx) > 6) {
        dragging = true;
        try {
          el.setPointerCapture(pointerId);
        } catch {
          /* ignore */
        }
        el.style.cursor = 'grabbing';
      }
      if (dragging) {
        ev.preventDefault();
        el.scrollLeft = startScroll - dx;
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      try {
        el.releasePointerCapture(pointerId);
      } catch {
        /* ignore */
      }
      el.style.cursor = '';
      if (dragging) {
        const block = (ce: Event) => {
          ce.stopPropagation();
          ce.preventDefault();
          el.removeEventListener('click', block, true);
        };
        el.addEventListener('click', block, true);
        setTimeout(() => el.removeEventListener('click', block, true), 0);
      }
      dragging = false;
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('pointerdown', onDown);
  el.style.touchAction = 'pan-x';
  return {
    destroy() {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
    },
  };
}
