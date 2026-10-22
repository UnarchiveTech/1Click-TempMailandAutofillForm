/**
 * View registry - declarative metadata for each view.
 *
 * Settings subpages (secondary pages) dock into the settings hub whenever a
 * split layout is active. AppLayout never hardcodes the subpage list - it is
 * driven by `isSettingsSplitView()` from here.
 */
import type { View } from '@/features/types/view-types.js';

/** Settings subpages that dock into the settings hub in split layout. */
const SETTINGS_SUBPAGE_VIEWS: ReadonlySet<View> = new Set<View>([
  'mailProvider',
  'keybindings',
  'constantsSettings',
  'diagnostics',
  'storagePerformance',
  'addressAccentColors',
]);

/** True when the view is a settings subpage that docks into the settings hub. */
export function isSettingsSplitView(view: View): boolean {
  return SETTINGS_SUBPAGE_VIEWS.has(view);
}
