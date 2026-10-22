// Focus trap implementation for accessibility
import { CONSTANTS } from '../constants.js';

export function setupFocusTrap(
  element: HTMLElement,
  options?: { initialFocus?: HTMLElement | null }
): () => void {
  const FOCUSABLE_SELECTOR =
    'button:not([disabled]), [href], input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function getFocusableElements(): HTMLElement[] {
    return Array.from(element.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
      // Native controls may explicitly opt out of Tab (e.g. a dialog scrim).
      // Matching "button" does not override that opt-out.
      if (el.tabIndex < 0 || el.matches(':disabled') || el.closest('[inert]')) return false;
      // Filter out elements that are not currently displayed/visible in layout
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
  }

  function trapFocus(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const focusables = getFocusableElements();
    if (focusables.length === 0) {
      e.preventDefault();
      return;
    }

    const firstFocusable = focusables[0];
    const lastFocusable = focusables[focusables.length - 1];
    // Within a shadow tree document.activeElement is the host, not the button.
    const root = element.getRootNode();
    const activeElement =
      'activeElement' in root
        ? (root as Document | ShadowRoot).activeElement
        : document.activeElement;

    // A dialog may start with focus on its container or a static heading.
    // Enter the Tab sequence in either direction without escaping the trap.
    if (!focusables.some((focusable) => focusable === activeElement)) {
      e.preventDefault();
      (e.shiftKey ? lastFocusable : firstFocusable).focus();
      return;
    }

    if (e.shiftKey) {
      if (activeElement === firstFocusable) {
        e.preventDefault();
        lastFocusable.focus();
      }
    } else {
      if (activeElement === lastFocusable) {
        e.preventDefault();
        firstFocusable.focus();
      }
    }
  }

  element.addEventListener('keydown', trapFocus);

  // Focus the requested element (or the first focusable) on setup. Callers
  // that leave this default land focus on whatever comes first in DOM order -
  // e.g. a settings gear before the close button.
  // The delayed focus must not fire after teardown: focusing a detached
  // (unmounted-dialog) node steals/restores focus to nowhere and can throw on
  // some engine/AT combinations. The id is cleared alongside the keydown
  // listener in the single teardown below.
  const focusTimer = setTimeout(() => {
    const target =
      options?.initialFocus && element.contains(options.initialFocus)
        ? options.initialFocus
        : getFocusableElements()[0];
    target?.focus();
  }, CONSTANTS.DIALOG_FOCUS_DELAY_MS);

  return () => {
    clearTimeout(focusTimer);
    element.removeEventListener('keydown', trapFocus);
  };
}
