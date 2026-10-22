/**
 * Ordered stack of transient surfaces that Escape can dismiss.
 *
 * A surface registers itself while it is active - a view's multi-select, an open
 * editor, a layout drawer, a settings sub-page - and unregisters when it is not.
 * Escape dismisses the TOP of the stack, so the answer is always "the transient
 * surface the user opened most recently": opening the account selector over a
 * live multi-select makes the selector Escape's first target, and ticking a row
 * afterwards puts the selection back on top.
 *
 * Registration is surface-owned (a Svelte `$effect` keyed on the surface's own
 * active flag), which is what keeps the stack honest. An unmounted view runs its
 * effect teardown, so it can never leave a stale tier armed and eat an Escape
 * meant for the page underneath - the reason this is a registry rather than a
 * boolean per surface threaded up through every layout layer.
 *
 * Plain module state on purpose: the stack is read once per keydown, never
 * rendered, so it needs no reactivity of its own.
 */

export interface EscapeTier {
  /** Stable label, e.g. `mailbox.selection` - used by tests and diagnostics. */
  id: string;
  /** Dismisses the surface. Must be idempotent: a surface's own element-level
   * Escape handler may have already dismissed it earlier in the same dispatch. */
  cancel: () => void;
}

const tiers: EscapeTier[] = [];

/**
 * Register an active transient surface. Call from an `$effect` that depends on
 * the surface's state and return the result as the effect's teardown.
 */
export function registerEscapeTier(id: string, cancel: () => void): () => void {
  const tier: EscapeTier = { id, cancel };
  tiers.push(tier);
  return () => {
    const index = tiers.indexOf(tier);
    if (index !== -1) tiers.splice(index, 1);
  };
}

/** Number of active transient surfaces (0 = Escape falls through to navigation). */
export function escapeTierDepth(): number {
  return tiers.length;
}

/** Label of the top tier, or null - for diagnostics and tests. */
export function topEscapeTierId(): string | null {
  return tiers.length > 0 ? tiers[tiers.length - 1].id : null;
}

/**
 * Dismiss the most recently opened surface. Returns false when none is
 * registered, so the caller can fall through to navigation. The tier is left in
 * place: its owner unregisters it when its state actually changes, so a surface
 * that declines to close stays armed.
 */
export function cancelTopEscapeTier(): boolean {
  const top = tiers[tiers.length - 1];
  if (!top) return false;
  top.cancel();
  return true;
}

/** Drop every registration - teardown for tests and full re-inits. */
export function clearEscapeTiers(): void {
  tiers.length = 0;
}
