/**
 * The live selection surfaces - who is multi-selecting right now.
 *
 * A list publishes itself here while it is mounted and its selection is live; the
 * shell's ONE selection strip renders whichever surface is active. The registry
 * is why the strip can drive four lists that are rendered through four different
 * component chains (`AddressesSplitView` → `AddressesListPane` → `AddressesView`,
 * `AutofillView` → `IdentitiesView`, …): a `bind:` prop would have to be threaded
 * through every intermediate component, and `AddressesView` is ALSO rendered
 * directly inside a settings subpage where that chain does not exist at all.
 *
 * Being published is scoped to MOUNTING, which is what keeps the strip honest:
 * an unmounted list runs its effect cleanup and disappears from here, so it can
 * never leave a stale strip up over the page that replaced it. That is the same
 * argument the escape stack makes (`features/keyboard-shortcuts/escape-stack.ts`)
 * - one mechanism for "a transient surface exists right now", not two.
 *
 * Publishing is idempotent and cheap: a list's `$effect` re-runs whenever the
 * facts the strip renders from change, and each run re-publishes its entry.
 */
import { writable } from 'svelte/store';
import type { ListSelectionState, SelectionApi, SelectionSurface } from './selection-api.js';

/** One list's published selection: its surface, its facts, and how to drive it. */
export interface PublishedSelection {
  surface: SelectionSurface;
  state: ListSelectionState;
  api: SelectionApi;
}

/** The surface the strip must render now, or null when nothing is selected. */
export const activeSelectionStore = writable<PublishedSelection | null>(null);

const published = new Map<SelectionSurface, PublishedSelection>();
/** Activation order, so the most recently activated surface wins a tie. */
const activatedAt = new Map<SelectionSurface, number>();
/**
 * Refresh order - who published most recently, whether or not they had a
 * selection. This is what answers "which list is on screen?" for the KEYBOARD:
 * with nothing ticked there is no active surface, and the keys still have to
 * know which list to start selecting in. A mounted list refreshes on every
 * change to its facts, and the one the user is looking at is the one whose view
 * is mounted, so the newest entry is that list (a view transition leaves both
 * mounted for a moment, and the incoming view republishes last).
 */
const touchedAt = new Map<SelectionSurface, number>();
let sequence = 0;

/**
 * Publish (or refresh) a list's selection and return the unregister function.
 *
 * Call it from an `$effect`: the effect re-runs when the state's own fields
 * change, and its cleanup unregisters on unmount.
 */
export function publishSelectionSurface(entry: PublishedSelection): () => void {
  // Reading the facts here is what makes the CALLER's effect track them - the
  // strip must re-render when the count changes, not only when the list appears.
  const { active } = entry.state;
  void entry.state.count;
  void entry.state.actions;
  void entry.state.allMatched;
  void entry.state.matchingTotal;
  void entry.state.universeCounted;

  const already = published.get(entry.surface);
  const isNewActivation = active && (already === undefined || !already.state.active);
  published.set(entry.surface, entry);
  touchedAt.set(entry.surface, ++sequence);
  if (isNewActivation) activatedAt.set(entry.surface, ++sequence);
  // Activation ORDER decides, never "the last one to refresh": during a view
  // transition both lists exist for a moment and the incoming one must win, which
  // a last-writer rule would hand back to the outgoing list on its next refresh.
  notify();

  return () => {
    // Only the entry that is still current may unregister - a re-mount that
    // replaced it must not be torn down by the previous mount's cleanup.
    if (published.get(entry.surface) !== entry) return;
    published.delete(entry.surface);
    activatedAt.delete(entry.surface);
    touchedAt.delete(entry.surface);
    notify();
  };
}

/** Point the store at the most recently ACTIVATED live surface (or null). */
function notify(): void {
  let chosen: PublishedSelection | null = null;
  let chosenAt = -1;
  for (const entry of published.values()) {
    if (!entry.state.active) continue;
    const at = activatedAt.get(entry.surface) ?? 0;
    if (at > chosenAt) {
      chosenAt = at;
      chosen = entry;
    }
  }
  activeSelectionStore.update((prev) => (prev === chosen ? prev : chosen));
}

/**
 * The published entry for one surface, for imperative callers that know which
 * list they mean - the sidebar's drag-onto-folder and drag-onto-label targets
 * act on the mailbox selection specifically, not on "whichever is active".
 */
export function selectionFor(surface: SelectionSurface): PublishedSelection | null {
  return published.get(surface) ?? null;
}

/**
 * The list the KEYBOARD should drive: the active one when a selection exists,
 * otherwise the list on screen.
 *
 * The two answers differ because the keys must be able to START a selection: with
 * nothing ticked `activeSelectionStore` is null by design, yet `X` still has to
 * tick the row under the cursor somewhere - so with no active surface this falls
 * back to the most recently refreshed mounted list (see `touchedAt`).
 */
/**
 * Every list published right now, for the caller that has to ASK them something:
 * the keyboard layer resolves which list a keystroke belongs to by asking each
 * one whether its row cursor holds the focus, which no amount of ordering in
 * here could answer for it.
 */
export function publishedSelections(): PublishedSelection[] {
  return [...published.values()];
}

export function selectionKeyboardTarget(): PublishedSelection | null {
  // Two passes rather than one score: an ACTIVE surface outranks every idle one
  // (while a selection is live the keys belong to the list that owns it, even if
  // another list refreshed later), and only when nothing is selected does
  // refresh order decide. Folding both ranks into one number would have made the
  // intent an arithmetic detail.
  let active: PublishedSelection | null = null;
  let activeAt = -1;
  let idle: PublishedSelection | null = null;
  let idleAt = -1;
  for (const entry of published.values()) {
    const at = (entry.state.active ? activatedAt : touchedAt).get(entry.surface) ?? 0;
    if (entry.state.active) {
      if (at > activeAt) {
        activeAt = at;
        active = entry;
      }
    } else if (at > idleAt) {
      idleAt = at;
      idle = entry;
    }
  }
  return active ?? idle;
}

/** Forget every published surface. For tests and for a full teardown. */
export function resetSelectionRegistry(): void {
  published.clear();
  activatedAt.clear();
  touchedAt.clear();
  sequence = 0;
  activeSelectionStore.set(null);
}
