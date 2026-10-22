import { setupFocusTrap } from '@/utils/ui/focusTrap.js';
import { observeDialogDensity } from './dialog-density.js';

export interface DialogLifecycleOptions {
  lockBodyScroll?: boolean;
  initialFocus?: HTMLElement | null;
}

export interface DialogLifecycle {
  /** Attach the trap after the dialog has rendered. No-ops after cleanup. */
  attach(element: HTMLElement | null, initialFocus?: HTMLElement | null): void;
  /** Release the trap, restore body scrolling, and return focus to the opener. */
  cleanup(): void;
}

/**
 * Begin the common lifecycle shared by portaled dialogs and bottom sheets.
 * Call `attach` after the next tick when the dialog element exists, and return
 * `cleanup` from the owning Svelte effect.
 */
export function beginDialogLifecycle(options: DialogLifecycleOptions = {}): DialogLifecycle {
  const previousActiveElement =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const previousOverflow = document.body.style.overflow;
  const lockBodyScroll = options.lockBodyScroll !== false;
  let cleanupFocusTrap: (() => void) | null = null;
  let cleanupDensity: (() => void) | null = null;
  let cleanedUp = false;

  if (lockBodyScroll) {
    document.body.style.overflow = 'hidden';
  }

  return {
    attach(element, initialFocus) {
      if (cleanedUp || !element) return;
      cleanupFocusTrap?.();
      cleanupDensity?.();
      cleanupDensity = observeDialogDensity(element);
      cleanupFocusTrap = setupFocusTrap(element, {
        initialFocus: initialFocus ?? options.initialFocus,
      });
    },
    cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      cleanupFocusTrap?.();
      cleanupFocusTrap = null;
      cleanupDensity?.();
      cleanupDensity = null;
      if (lockBodyScroll) {
        document.body.style.overflow = previousOverflow;
      }
      if (previousActiveElement && document.contains(previousActiveElement)) {
        previousActiveElement.focus();
      }
    },
  };
}
