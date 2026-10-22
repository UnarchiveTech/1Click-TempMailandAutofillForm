/**
 * Content-script event guard utilities.
 *
 * Content scripts inject clickable UI into the *page* DOM. A malicious page
 * can programmatically `.dispatchEvent(new MouseEvent('click'))` on those
 * elements, which would trigger autofill, OTP insertion, identity selection,
 * etc. without the user's knowledge.
 *
 * Every click/tap handler attached to page-DOM elements created by content
 * scripts MUST pass through `trustedClick` (or check `event.isTrusted`
 * manually) to reject synthetic events.
 *
 * @see src/AGENTS.md - Content script security guidelines
 */

/**
 * Wrap a click handler so it only fires for trusted (user-driven) events.
 *
 * Usage:
 *   el.addEventListener('click', trustedClick(async (e) => {
 *     // e is guaranteed to be trusted (MouseEvent in practice)
 *     ...
 *   }));
 *
 * @param handler  The real click handler (receives a MouseEvent).
 * @returns An EventListener compatible wrapper that checks `event.isTrusted`.
 */
export function trustedClick(handler: (e: MouseEvent) => void | Promise<void>): EventListener {
  return (e: Event) => {
    if (!e.isTrusted) return;
    void handler(e as MouseEvent);
  };
}

/**
 * Wrap a pointerdown handler so it only fires for trusted events.
 * Some content-script UI uses `pointerdown` for press effects.
 */
export function trustedPointerDown(handler: (e: PointerEvent) => void): (e: Event) => void {
  return (e: Event) => {
    if (!e.isTrusted) return;
    handler(e as PointerEvent);
  };
}

/**
 * Shorthand: attach a trusted click listener in one call.
 * Equivalent to `el.addEventListener('click', trustedClick(handler))`.
 */
export function addTrustedClickListener(el: EventTarget, handler: (e: MouseEvent) => void): void {
  el.addEventListener('click', trustedClick(handler));
}
