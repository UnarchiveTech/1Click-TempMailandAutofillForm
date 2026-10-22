/**
 * Observe an element's size without mutating component state during the
 * browser's ResizeObserver delivery phase.
 *
 * ResizeObserver callbacks that synchronously change layout can trigger the
 * browser's "ResizeObserver loop completed with undelivered notifications"
 * warning. Queueing the latest entries into the next animation frame lets the
 * browser finish the current layout pass first and coalesces noisy resize
 * notifications during popup startup and responsive transitions.
 */
export interface FrameBatchedResizeObserver {
  observe(target: Element): void;
  disconnect(): void;
}

/** Create one frame-batched observer for one or many targets. */
export function createResizeObserverOnFrame(
  callback: (entries: ResizeObserverEntry[]) => void
): FrameBatchedResizeObserver | null {
  if (typeof ResizeObserver === 'undefined') return null;

  let frameId: number | null = null;
  let pendingEntries: ResizeObserverEntry[] = [];

  const flush = () => {
    frameId = null;
    const entries = pendingEntries;
    pendingEntries = [];
    if (entries.length > 0) callback(entries);
  };

  const schedule = () => {
    if (frameId !== null) return;
    if (typeof requestAnimationFrame === 'function') {
      frameId = requestAnimationFrame(flush);
    } else {
      frameId = window.setTimeout(flush, 0);
    }
  };

  const observer = new ResizeObserver((entries) => {
    pendingEntries = entries;
    schedule();
  });

  return {
    observe(target) {
      observer.observe(target);
    },
    disconnect() {
      observer.disconnect();
      pendingEntries = [];
      if (frameId === null) return;
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(frameId);
      } else {
        window.clearTimeout(frameId);
      }
      frameId = null;
    },
  };
}

export function observeResizeOnFrame(
  target: Element,
  callback: (entries: ResizeObserverEntry[]) => void
): () => void {
  const observer = createResizeObserverOnFrame(callback);
  if (!observer) return () => {};
  observer.observe(target);
  return () => observer.disconnect();
}
