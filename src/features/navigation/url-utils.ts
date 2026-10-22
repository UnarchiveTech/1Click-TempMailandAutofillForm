/**
 * Shared URL rewriting for navigation hand-offs.
 *
 * Both the print-intent and view-handoff flows strip their query params from
 * the current location so refresh does not re-trigger the flow. The serialized
 * href keeps any REMAINING search params and the hash intact.
 */

/**
 * Replace the current history entry with `u` minus its deleted params.
 * Best-effort: failures are ignored (e.g. opaque origins / about: pages).
 */
export function replaceCurrentLocation(u: URL): void {
  const next = u.pathname + (u.searchParams.toString() ? `?${u.searchParams}` : '') + u.hash;
  try {
    history.replaceState(null, '', next);
  } catch {
    /* ignore */
  }
}
