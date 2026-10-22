/**
 * The keyboard's way into a multi-select, mounted ONCE for every list.
 *
 * AppShell owns the one selection strip, so it owns the keys that drive it too.
 * That is the whole payoff of the registry: a list publishes a `SelectionApi`,
 * and this hook routes a keystroke to whichever list the user is on - the active
 * one when something is ticked, the list on screen when nothing is (see
 * `selectionKeyboardTarget()`). A new list therefore adds no key handling at all.
 *
 * Two guards keep it from eating keys it has no business eating:
 *
 *   1. **A row, or the strip itself, must hold focus.** `document.activeElement`
 *      IS the cursor (`selection-row-cursor.ts`), so this is the same condition
 *      the keys act on rather than a proxy for it - and it disposes of the
 *      checks every other shortcut handler needs by hand: a dialog open means
 *      focus is inside the dialog (its lifecycle puts it there), a text field
 *      focused means focus is in the field. What is deliberately NOT included is
 *      "a selection is active": claiming Enter whenever a selection exists would
 *      run a destructive bulk action in place of whatever button the user had
 *      focused.
 *   2. **The event must not be claimed already.** An element-level handler that
 *      called `preventDefault()` (a row's own Enter, a dropdown's arrows) wins,
 *      so nothing here has to know what those handlers were.
 *
 * The listener is on the window, not the app shell element, because the strip and
 * the rows live in different subtrees - and it is removed on teardown with the
 * effect that installed it.
 */
import {
  chooseKeyboardTarget,
  dispatchSelectionKey,
  resolveSelectionKey,
} from '@/utils/ui/selection-keyboard.js';
import { publishedSelections, selectionKeyboardTarget } from '@/utils/ui/selection-registry.js';

export function useSelectionKeyboard(): void {
  $effect(() => {
    function onKeydown(event: KeyboardEvent) {
      // Something else already handled it (a row's own Enter/Space, a select's
      // arrows, an open dialog's Escape). Deference, not duplication.
      if (event.defaultPrevented) return;
      const focused = document.activeElement;
      if (!(focused instanceof HTMLElement)) return;
      if (focused.closest('input, textarea, select, [contenteditable="true"]')) return;
      // Enter belongs to the actual control under focus, including strip actions.
      if (event.key === 'Enter' && focused.matches('button, a, [role="button"]')) return;

      // The strip is the selection's own surface: after a click on one of its
      // buttons positional arrows still work, and "which list" is then
      // the active one (or, with nothing selected, the list on screen).
      const inStrip = document.activeElement?.closest('[data-selection-strip]') != null;
      const target = chooseKeyboardTarget(publishedSelections(), {
        fallback: inStrip ? selectionKeyboardTarget() : null,
      });
      if (!target) return;

      const command = resolveSelectionKey(event, { selectionActive: target.state.active });
      if (!command) return;

      // Claimed: stop the browser scrolling the list under the cursor, and stop
      // any ancestor handler from reading the same key.
      event.preventDefault();
      event.stopPropagation();
      dispatchSelectionKey(command, target.api, target.state.actions);
    }

    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  });
}
