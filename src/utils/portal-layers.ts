/**
 * Single source of truth for overlay stacking (extension UI).
 * Always portal dialogs to document.body when they must sit above AccountSelector
 * or any transform-containing ancestor.
 *
 * Scale (low → high):
 *  nav / more menus < account selector < toast < modal dialogs < tour
 */

export const PORTAL_Z = {
  /** Floating more-menu / nav popovers */
  navMenu: 100,
  /** Account selector overlay (must stay below dialogs) */
  accountSelector: 40,
  /** Account card ⋮ menus (fixed, still below dialogs) */
  accountMenu: 110,
  /** Offline banner */
  offlineBanner: 2000,
  /** Toasts (bottom-right; below modal dialogs so confirms stay readable) */
  toast: 9000,
  /** Confirm / Tag / Export / Import dialogs (body-portaled) */
  dialog: 10000,
  /** Product tour */
  tour: 10050,
  /** Native-feeling tooltips at app root */
  tooltip: 100000,
} as const;

/** Tailwind-friendly class fragments for common layers */
export const PORTAL_Z_CLASS = {
  accountSelector: 'z-[40]',
  accountMenu: 'z-[110]',
  toast: 'z-[9000]',
  dialog: 'z-[10000]',
  tour: 'z-[10050]',
} as const;

/**
 * Move an element to document.body if not already there.
 * Returns cleanup that re-parents or removes when appropriate.
 */
export function portalToBody(el: HTMLElement | null | undefined): () => void {
  if (!el || typeof document === 'undefined') return () => {};
  if (el.parentElement !== document.body) {
    document.body.appendChild(el);
  }
  return () => {
    try {
      if (el.parentElement === document.body) el.remove();
    } catch {
      /* ignore */
    }
  };
}
