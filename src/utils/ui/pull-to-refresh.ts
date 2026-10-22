/**
 * Svelte action: pull-to-refresh for a scrollable list root.
 *
 * The mailbox list root is a labelled scroll region (`role="region"`), not an
 * interactive widget, so its pull gesture is imperative DOM plumbing - the same
 * reason `enableHorizontalWheelScroll` owns the chip-row pan. Keeping the
 * listeners here also lets the touch and mouse paths share one state machine
 * instead of duplicating it in the markup.
 */

export type PullToRefreshOptions = {
  /** Live read of the refreshing flag - while true the gesture stays inert. */
  isRefreshing: () => boolean;
  /** Drag displacement in px; reported as 0 when the gesture starts and ends. */
  onProgress: (distance: number) => void;
  /** Released past `readyThreshold` while the list is at the top. */
  onRefresh: () => void | Promise<void>;
  /** Gesture finished without refreshing - clear the indicator. */
  onReset: () => void;
  /** Displacement (px) at which releasing triggers a refresh. Default 60. */
  readyThreshold?: number;
  /** Upper bound for the reported displacement. Default 88. */
  maxDistance?: number;
  /** Fraction of the raw drag turned into displacement. Default 0.55. */
  resistance?: number;
  /** Displacement (px) before the mouse gesture engages. Default 12. */
  mouseMinDistance?: number;
};

/**
 * Raw pointer offset → reported pull displacement: resist the drag, clamp the
 * result, and never report a negative (upward) pull.
 */
export function pullDistanceFor(
  clientY: number,
  startY: number,
  options: Pick<PullToRefreshOptions, 'resistance' | 'maxDistance'> = {}
): number {
  const resistance = options.resistance ?? 0.55;
  const maxDistance = options.maxDistance ?? 88;
  return Math.min(Math.max(0, clientY - startY) * resistance, maxDistance);
}

export function pullToRefresh(el: HTMLElement, options: PullToRefreshOptions) {
  let opts = options;
  let startY = 0;
  let distance = 0;
  let pulling = false;

  const begin = (clientY: number) => {
    startY = clientY;
    distance = 0;
    pulling = true;
    opts.onProgress(0);
  };

  /** Track the drag; returns true when the reported distance moved forward. */
  const progress = (clientY: number, minDistance: number): boolean => {
    if (!pulling || opts.isRefreshing() || el.scrollTop > 0) return false;
    const next = pullDistanceFor(clientY, startY, opts);
    if (next <= minDistance) return false;
    distance = next;
    opts.onProgress(next);
    return true;
  };

  const reset = () => {
    startY = 0;
    distance = 0;
    pulling = false;
    opts.onReset();
  };

  const settle = async () => {
    // Refresh only when the drag crossed the threshold and the list is still
    // at the top - releasing mid-scroll must not fire a fetch.
    if (distance > (opts.readyThreshold ?? 60) && el.scrollTop === 0) {
      await opts.onRefresh();
    }
    reset();
  };

  const onRelease = () => {
    void settle();
  };

  const onTouchStart = (e: TouchEvent) => {
    begin(e.touches[0].clientY);
  };

  const onTouchMove = (e: TouchEvent) => {
    // Touch reports from the first pixel; the mouse path needs a dead zone.
    if (progress(e.touches[0].clientY, 0)) e.preventDefault();
  };

  const onMouseDown = (e: MouseEvent) => {
    begin(e.clientY);
  };

  const onMouseMove = (e: MouseEvent) => {
    if (e.buttons !== 1) return;
    progress(e.clientY, opts.mouseMinDistance ?? 12);
  };

  const onMouseLeave = () => {
    if (opts.isRefreshing()) return;
    reset();
  };

  // Touch stays passive (Svelte binds `ontouchstart`/`ontouchmove` that way), so
  // extracting the gesture did not change mobile scroll behaviour.
  el.addEventListener('touchstart', onTouchStart, { passive: true });
  el.addEventListener('touchmove', onTouchMove, { passive: true });
  el.addEventListener('touchend', onRelease);
  el.addEventListener('mousedown', onMouseDown);
  el.addEventListener('mousemove', onMouseMove);
  el.addEventListener('mouseup', onRelease);
  el.addEventListener('mouseleave', onMouseLeave);

  return {
    update(next: PullToRefreshOptions) {
      opts = next;
    },
    destroy() {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onRelease);
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('mousemove', onMouseMove);
      el.removeEventListener('mouseup', onRelease);
      el.removeEventListener('mouseleave', onMouseLeave);
    },
  };
}
