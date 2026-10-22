/**
 * The keys that drive a multi-select - resolved in ONE place, for every list.
 *
 * A list used to be selectable by pointer only, so this map could not exist:
 * `x`/arrows had nothing to act on that was shared. Now that every list
 * publishes a `SelectionApi` (see `selection-api.ts`) and the cursor is DOM
 * focus (`selection-row-cursor.ts`), the KEYS are shared too - and this module is
 * the whole of them. Adding a list adds no key handling; adding a key is one
 * `case` here plus a cheat-sheet row.
 *
 * What the map deliberately is not:
 *
 *   - **Not a recorder entry.** `Keybindings` + the settings recorder are for
 *     user-rebindable actions. These are the fixed, positional keys a list needs
 *     (the same class as `/`, `J` and `K`), because their meaning is bound to
 *     the row the user is standing on rather than to a command.
 *   - **Not a global hotkey set.** A chord with Ctrl/Cmd/Alt is never ours, so
 *     rebindable shortcuts and browser chords keep working; and the caller only
 *     reaches this module when a row or the strip already has focus.
 *   - **Not a toggle for an already-ticked row in the extend direction.**
 *     `Shift+Down` must ADD the row it lands on. A plain toggle would untick a
 *     row the user was extending THROUGH, so extend is `move` + `set(selected)`
 *     - which is also why the contract's write is `setFocusedSelected(boolean)`
 *     rather than a toggle.
 */
import type { SelectionActionId, SelectionApi } from './selection-api.js';
import type { PublishedSelection } from './selection-registry.js';

/** One keystroke's meaning to the list that owns the selection. */
export type SelectionKeyCommand =
  | { kind: 'toggleFocused' }
  | { kind: 'moveFocus'; delta: -1 | 1 }
  | { kind: 'extendFocus'; delta: -1 | 1 }
  | { kind: 'runPrimary' };

/** The subset of a `KeyboardEvent` this module reads (so tests need no event). */
export interface SelectionKeyEvent {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/**
 * What one keystroke means, or null when it is not ours.
 *
 * `selectionActive` gates Enter only: with nothing selected, Enter belongs to
 * whatever the row has focused (opening a message, an identity's editor), and
 * claiming it would take that away. The arrow/X keys need no such gate - outside
 * a list they never reach here at all.
 */
export function resolveSelectionKey(
  event: SelectionKeyEvent,
  options: { selectionActive: boolean }
): SelectionKeyCommand | null {
  // Never claim a chord: Ctrl/Cmd/Alt belong to the browser and to the
  // user-rebindable shortcuts (Ctrl+A select-all-in-page, Ctrl+K palette, …).
  if (event.ctrlKey || event.metaKey || event.altKey) return null;

  switch (event.key) {
    case 'ArrowDown':
      return event.shiftKey ? { kind: 'extendFocus', delta: 1 } : { kind: 'moveFocus', delta: 1 };
    case 'ArrowUp':
      return event.shiftKey ? { kind: 'extendFocus', delta: -1 } : { kind: 'moveFocus', delta: -1 };
    case 'x':
    case 'X':
      // Shift+X is not a second meaning - leave it unclaimed rather than guess.
      return event.shiftKey ? null : { kind: 'toggleFocused' };
    case 'Enter':
      return options.selectionActive ? { kind: 'runPrimary' } : null;
    default:
      return null;
  }
}

/**
 * Which list a keystroke belongs to.
 *
 * Asked of each published list in turn - "is your row cursor holding the focus?"
 * - rather than decided by any ordering rule, because ordering is a guess: two
 * lists are mounted together during a split-view transition, and a list that
 * refreshed a moment ago is not necessarily the one the user is standing in. A
 * list answers from its own container, so exactly one of them can say yes.
 *
 * The fallback covers the case where focus is NOT on a row: the selection strip
 * is the selection's own surface, so a key pressed there belongs to whichever
 * list is active (or, with nothing ticked, the one on screen).
 */
export function chooseKeyboardTarget(
  entries: readonly PublishedSelection[],
  options: { fallback?: PublishedSelection | null } = {}
): PublishedSelection | null {
  return entries.find((entry) => entry.api.hasFocusedRow()) ?? options.fallback ?? null;
}

/**
 * Run one resolved command against a list.
 *
 * `actions` is the list's own advertised order, so Enter runs the SAME action the
 * strip's first button shows - the keyboard is not a second opinion about what
 * "the" action is, and a list that reorders its actions reorders both.
 */
export function dispatchSelectionKey(
  command: SelectionKeyCommand,
  api: SelectionApi,
  actions: readonly SelectionActionId[]
): void {
  switch (command.kind) {
    case 'toggleFocused':
      api.setFocusedSelected(!api.focusedIsSelected());
      return;
    case 'moveFocus':
      api.moveFocus(command.delta);
      return;
    case 'extendFocus': {
      // Move first, then tick what the cursor landed on: `setFocusedSelected`
      // addresses the row under the cursor, so the order is the whole trick.
      const moved = api.moveFocus(command.delta);
      if (moved) void moved.then(() => api.setFocusedSelected(true));
      else api.setFocusedSelected(true);
      return;
    }
    case 'runPrimary': {
      const primary = actions[0];
      if (primary) void api.run(primary);
      return;
    }
  }
}
