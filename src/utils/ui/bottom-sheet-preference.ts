/**
 * Shared subscription for the `dialogPresentationBottomSheet` preference - the
 * single implementation behind every dialog's bottom-sheet/dialog switch.
 *
 * Six components used to each hand-roll the same pair of subscriptions: a
 * sync-first `reconcileStoredBooleanPref` read (so the first paint does not pop
 * to the default) plus a `storage.onChanged` listener (so a write in another
 * extension surface re-lays an already-open dialog). The copies had drifted in
 * shape - some guarded the changed key with `area !== 'local' || !key`, others
 * with `area === 'local' && key` - so the shared helper fixes ONE contract.
 *
 * Plain `.ts`, not `.svelte.ts`: this function owns no runes, so every caller
 * keeps its own `$state`/`$effect` and the component-test harness (which
 * compiles `.svelte` files but loads plain modules directly) needs no new rule.
 *
 * Usage inside a component:
 *
 * ```svelte
 * let useBottomSheet = $state(false);
 * $effect(() => subscribeBottomSheetPreference((value) => {
 *   useBottomSheet = value;
 * }));
 * ```
 */

import { browser } from 'wxt/browser';
import { reconcileStoredBooleanPref } from '@/utils/storage/stored-prefs-sync.js';

/** The storage key this helper mirrors - also written by the settings toggle. */
export const DIALOG_BOTTOM_SHEET_KEY = 'dialogPresentationBottomSheet';

/**
 * Mirror the bottom-sheet preference into `apply`, now and on every later
 * change. Returns the teardown that removes the listener - return it from the
 * `$effect`/`onMount` that calls this.
 */
export function subscribeBottomSheetPreference(apply: (value: boolean) => void): () => void {
  reconcileStoredBooleanPref(DIALOG_BOTTOM_SHEET_KEY, apply, false);

  const onStorageChange = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local' || !changes[DIALOG_BOTTOM_SHEET_KEY]) return;
    apply(changes[DIALOG_BOTTOM_SHEET_KEY].newValue === true);
  };
  browser.storage.onChanged.addListener(onStorageChange);
  return () => browser.storage.onChanged.removeListener(onStorageChange);
}
