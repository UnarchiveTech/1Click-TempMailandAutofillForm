/**
 * Shared multi-select gesture state machine for mailbox / addresses / account selector.
 *
 * Modes:
 *  - idle: no gesture
 *  - hold: long-press accumulating selection
 *  - marquee: rubber-band box select
 *  - drag: HTML5 drag of selected items onto action strips
 *
 * Click-after-hold is suppressed via suppressClickUntil so the synthetic click
 * after pointerup does not toggle selection off.
 */

export type GestureMode = 'idle' | 'hold' | 'marquee' | 'drag';

export const GESTURE = {
  /** px before marquee activates */
  marqueeThreshold: 6,
  /** ms hold before multi-select */
  holdMs: 420,
  /** suppress click after hold/marquee (ms) */
  suppressClickMs: 500,
  /** HTML5 DnD — always use move on both sides to avoid copy/move mismatch */
  dragEffectAllowed: 'move' as const,
  dropEffect: 'move' as const,
} as const;

export interface GestureController {
  mode: GestureMode;
  suppressClickUntil: number;
  /** Call when long-press fires */
  beginHold: () => void;
  /** Call when marquee exceeds threshold */
  beginMarquee: () => void;
  /** Call on dragstart of a selected item */
  beginDrag: () => void;
  /** Call on pointerup / dragend / marquee end */
  end: () => void;
  /** True if a click should be ignored (post-hold/marquee) */
  shouldSuppressClick: (now?: number) => boolean;
  /** Apply standard drag dataTransfer settings */
  applyDragStart: (dt: DataTransfer | null) => void;
  /** Apply standard drop zone dragover settings */
  applyDragOver: (e: DragEvent) => void;
}

export function createGestureController(): GestureController {
  let mode: GestureMode = 'idle';
  let suppressClickUntil = 0;

  const api: GestureController = {
    get mode() {
      return mode;
    },
    get suppressClickUntil() {
      return suppressClickUntil;
    },
    beginHold() {
      mode = 'hold';
      suppressClickUntil = Date.now() + GESTURE.suppressClickMs;
    },
    beginMarquee() {
      mode = 'marquee';
      suppressClickUntil = Date.now() + GESTURE.suppressClickMs;
    },
    beginDrag() {
      mode = 'drag';
    },
    end() {
      if (mode === 'hold' || mode === 'marquee') {
        suppressClickUntil = Date.now() + GESTURE.suppressClickMs;
      }
      mode = 'idle';
    },
    shouldSuppressClick(now = Date.now()) {
      return now < suppressClickUntil;
    },
    applyDragStart(dt) {
      if (!dt) return;
      dt.effectAllowed = GESTURE.dragEffectAllowed;
    },
    applyDragOver(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = GESTURE.dropEffect;
    },
  };

  return api;
}

/** Standard dragover handler for selection-strip drop targets. */
export function onStripDragOver(e: DragEvent): void {
  e.preventDefault();
  e.stopPropagation();
  if (e.dataTransfer) e.dataTransfer.dropEffect = GESTURE.dropEffect;
}

/** Prepare dataTransfer on dragstart for list items. */
export function onItemDragStart(e: DragEvent, payload?: string): void {
  if (!e.dataTransfer) return;
  e.dataTransfer.effectAllowed = GESTURE.dragEffectAllowed;
  if (payload != null) {
    e.dataTransfer.setData('text/plain', payload);
  }
}
