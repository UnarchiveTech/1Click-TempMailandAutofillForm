/**
 * Shared long-press → multi-select gesture engine for list UIs (mailbox,
 * addresses, identities, …).
 *
 * Every list view used to re-implement the same state machine inline:
 *
 *   - on pointerdown of a row, schedule a per-row hold timer;
 *   - if pointerup / pointerleave lands first, cancel that hold;
 *   - when the hold fires, enter selection mode and arm a short
 *     "suppress the following click" window so the synthetic click that ends
 *     a long-press does not immediately toggle the row back off;
 *   - marquee ends and right-click menus arm the same suppression window.
 *
 * `createHoldController()` owns the hold timers + the suppression clock, so
 * the views keep only their per-row selection semantics. Timings are
 * configurable so each surface can keep its existing UX constants while
 * sharing the engine.
 */

export const GESTURE = {
  /** Default ms a pointer must stay down before the hold fires. */
  holdMs: 420,
  /** Default ms after a completed hold/marquee/menu during which clicks are ignored. */
  suppressClickMs: 500,
  /** px before marquee activates (mirrors MARQUEE_THRESHOLD in marquee-selection). */
  marqueeThreshold: 6,
  /** Drop-side effect set by onStripDragOver - move keeps the strip's drag targets consistent. */
  dropEffect: 'move' as const,
} as const;

export interface HoldTimingOverrides {
  /** Time a pointer must stay down before the hold fires. */
  holdMs?: number;
  /** Click-suppression window armed when a hold completes. */
  suppressClickMs?: number;
}

/**
 * Per-surface hold/suppression engine. Callers keep their own selection state
 * and pass an `onHold` callback that applies it when a hold completes.
 */
export interface HoldController {
  /** Schedule a hold for `key` (overwrites any pending hold for the same key). */
  start(key: string, onHold: () => void): void;
  /** Cancel a pending hold for `key`. */
  cancel(key: string): void;
  /** Cancel every pending hold (unmount / teardown). */
  cancelAll(): void;
  /** Arm the suppression window now (marquee end, right-click menu, …). */
  armSuppression(): void;
  /** True while the suppression window is open - clicks should be ignored. */
  isSuppressingClick(now?: number): boolean;
}

export function createHoldController(overrides: HoldTimingOverrides = {}): HoldController {
  const holdMs = overrides.holdMs ?? GESTURE.holdMs;
  const suppressClickMs = overrides.suppressClickMs ?? GESTURE.suppressClickMs;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let suppressClickUntil = 0;

  return {
    start(key, onHold) {
      const pending = timers.get(key);
      if (pending !== undefined) clearTimeout(pending);
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          onHold();
          // A completed hold is always followed by the synthetic click that
          // raised the pointer; ignore it so it cannot toggle the row off.
          suppressClickUntil = Date.now() + suppressClickMs;
        }, holdMs)
      );
    },
    cancel(key) {
      const pending = timers.get(key);
      if (pending !== undefined) {
        clearTimeout(pending);
        timers.delete(key);
      }
    },
    cancelAll() {
      for (const pending of timers.values()) clearTimeout(pending);
      timers.clear();
    },
    armSuppression() {
      suppressClickUntil = Date.now() + suppressClickMs;
    },
    isSuppressingClick(now = Date.now()) {
      return now < suppressClickUntil;
    },
  };
}

/** Standard dragover handler for selection-strip drop targets. */
export function onStripDragOver(e: DragEvent): void {
  e.preventDefault();
  e.stopPropagation();
  if (e.dataTransfer) e.dataTransfer.dropEffect = GESTURE.dropEffect;
}
