/**
 * Live layout metrics store - written by the single measurement owner
 * (AppLayout's `updateWide`) and read by diagnostics / debug surfaces.
 *
 * Holding the measurements in a store keeps a single source of truth while
 * letting any view (e.g. DiagnosticsView) render the current responsive
 * breakpoint state without reaching into AppLayout internals.
 */
import { writable } from 'svelte/store';

/** Entrypoint context the shell runs as - matches AppLayout's context prop. */
export type ViewContext = 'popup' | 'sidepanel' | 'app';

export interface LayoutMetrics {
  /** Container width driving the layout ladder (layoutRootEl rect width). */
  width: number;
  /** Entrypoint context the shell is running as. */
  context: ViewContext;
  /** ≥ LAYOUT_WIDE_MIN - sidebar + content row active. */
  layoutWide: boolean;
  /** ≥ LAYOUT_SPLIT_MIN - true list|detail split active. */
  layoutSplit: boolean;
  /** Vertical (stacked) list|detail split between the wide and split thresholds. */
  layoutVerticalSplit: boolean;
  /** Width driving the nav ladder (same as `width` today; kept for clarity). */
  navShellWidth: number;
}

export const layoutMetricsStore = writable<LayoutMetrics>({
  width: 0,
  context: 'popup',
  layoutWide: false,
  layoutSplit: false,
  layoutVerticalSplit: false,
  navShellWidth: 0,
});

/** Update the store (no-op when nothing changed to avoid spurious re-renders). */
export function setLayoutMetrics(next: LayoutMetrics): void {
  layoutMetricsStore.update((prev) => {
    if (
      prev.width === next.width &&
      prev.context === next.context &&
      prev.layoutWide === next.layoutWide &&
      prev.layoutSplit === next.layoutSplit &&
      prev.layoutVerticalSplit === next.layoutVerticalSplit &&
      prev.navShellWidth === next.navShellWidth
    ) {
      return prev;
    }
    return next;
  });
}
