/**
 * User-facing labels for activity page/dialog visit keys (view ids).
 * Never show raw storage keys like "storagePerformance" to end users.
 */
import type { ActivityViewId } from '@/features/types/view-types.js';
import { tSync } from '@/utils/i18n/i18n-background.js';

/**
 * One label key per activity id - `View | dialog:*` - and the type is the point:
 * `Record<ActivityViewId, string>` makes a NEW tracked id a compile error here
 * until it has a label, which is exactly the failure this table used to ship
 * (`storagePerformance` rendered Title-Cased English, and a later id would have
 * rendered nothing at all).
 */
const VIEW_LABEL_KEYS: Record<ActivityViewId, string> = {
  mailbox: 'nav.mailbox',
  addresses: 'nav.addresses',
  addressView: 'nav.addresses',
  mailView: 'inbox.title',
  autofill: 'nav.autofill',
  identities: 'nav.profiles',
  loginInfo: 'nav.credentials',
  organize: 'nav.organize',
  automation: 'nav.automation',
  tagManagement: 'nav.tagManagement',
  labelManagement: 'nav.labelManagement',
  filtersManagement: 'nav.savedSearches',
  analytics: 'nav.activity',
  settings: 'common.settings',
  about: 'nav.about',
  keybindings: 'nav.keyboardShortcuts',
  mailProvider: 'preferences.mailProviderSettings',
  storagePerformance: 'preferences.storageAndPerformance',
  addressAccentColors: 'preferences.perAddressAccent',
  constantsSettings: 'settings.developerConstants',
  diagnostics: 'preferences.sectionDiagnostics',
  playground: 'playground.title',
  // Dialogs
  'dialog:createAddress': 'activity.dialogCreateAddress',
  'dialog:tag': 'activity.dialogTag',
  'dialog:confirm': 'activity.dialogConfirm',
  'dialog:export': 'activity.dialogExport',
  'dialog:import': 'activity.dialogImport',
  'dialog:qr': 'activity.dialogQr',
  'dialog:commandPalette': 'activity.dialogCommandPalette',
  'dialog:masterPassword': 'activity.dialogMasterPassword',
  'dialog:identityCreate': 'activity.dialogIdentityCreate',
  'dialog:identityEdit': 'activity.dialogIdentityEdit',
  'dialog:label': 'activity.dialogLabel',
  'dialog:filter': 'activity.dialogFilter',
  'dialog:other': 'activity.dialogOther',
};

/**
 * Localized fallback for unknown view ids. The old fallback Title-Cased the
 * raw id ("storagePerformance" → "Storage Performance"), which shipped UI
 * English outside the translation pipeline - a future view id added to the
 * activity log would render hardcoded English in every locale. `common.unknown`
 * is translated in all supported languages and already exists in every locale
 * file, so no locale additions are needed here.
 */
export function humanizeViewId(): string {
  return tSync('common.unknown');
}

export function viewDisplayLabelKey(viewId: string): string | null {
  // The stored visit history is untrusted (a URL param, an older build, a
  // hand-edited record), so this lookup is by string on purpose: an id no build
  // ever tracked must resolve to `null` and render the localized unknown label
  // rather than throw. That widening is the trust boundary, and the table above
  // is still exhaustively checked against the vocabulary.
  const labels: Readonly<Record<string, string | undefined>> = VIEW_LABEL_KEYS;
  return labels[viewId] ?? null;
}
