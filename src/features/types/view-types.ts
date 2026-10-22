export type View =
  | 'mailbox'
  | 'addresses'
  | 'settings'
  | 'analytics'
  | 'loginInfo'
  | 'addressView'
  | 'mailView'
  | 'about'
  | 'identities'
  /** Autofill manager: Identities, Saved Logins, and Sites tabs */
  | 'autofill'
  | 'keybindings'
  | 'tagManagement'
  | 'filtersManagement'
  | 'mailProvider'
  | 'storagePerformance'
  | 'addressAccentColors'
  | 'labelManagement'
  | 'constantsSettings'
  | 'diagnostics'
  /** Unified Tags / Labels / Filters hub */
  | 'organize'
  /** Automation rules hub */
  | 'automation'
  /** QA autofill playground */
  | 'playground';

export type AutofillTab = 'profiles' | 'credentials' | 'sites';
export type OrganizeTab = 'tags' | 'labels' | 'filters';

/**
 * Runtime registry for the View union. Handoff payloads (URL `?view=` params,
 * storage-written openView) are untrusted strings - validate them through
 * `isView()` before casting, or an unknown id reaches AppShell's `{:else}`
 * fallback, which renders content only for `mailbox` (i.e. a blank main pane).
 */
const VIEW_LIST = [
  'mailbox',
  'addresses',
  'settings',
  'analytics',
  'loginInfo',
  'addressView',
  'mailView',
  'about',
  'identities',
  'autofill',
  'keybindings',
  'tagManagement',
  'filtersManagement',
  'mailProvider',
  'storagePerformance',
  'addressAccentColors',
  'labelManagement',
  'constantsSettings',
  'diagnostics',
  'organize',
  'automation',
  'playground',
] as const satisfies readonly View[];

/** Registered pages shown in Activity, including views with no visits yet. */
export const ACTIVITY_PAGE_KEYS: readonly View[] = VIEW_LIST;

// Compile-time exhaustiveness: adding a View without registering it here
// (or a typo'd entry) fails `bun run typecheck` on this record.
const _VIEW_EXHAUSTIVE: Record<View, true> = Object.fromEntries(
  VIEW_LIST.map((view) => [view, true])
) as Record<View, true>;
void _VIEW_EXHAUSTIVE;

export const KNOWN_VIEWS: ReadonlySet<View> = new Set(VIEW_LIST);

/** Narrow an untrusted string (URL param, storage payload) to a View. */
export function isView(value: unknown): value is View {
  return typeof value === 'string' && KNOWN_VIEWS.has(value as View);
}

/**
 * The dialog ids the activity log records beside a view id.
 *
 * A visit is counted for a pane AND for each transient surface it opens, so the
 * activity record is keyed by `View | ActivityDialogKey`. The family is written
 * down here - not left as a string at each producer - because three things
 * agree on it: the producers (`AppLayout` pushes these ids), the label table
 * (`VIEW_LABEL_KEYS`, which must carry a label for every id) and the stored
 * history an older build may have written. A misspelled id used to be a visit
 * count nothing could label; now it is a compile error at the producer, or a
 * missing row in a `Record<ActivityViewId, …>` table.
 *
 * The list includes the specific dialogs currently labeled in Activity, plus a
 * fallback for every other accessible dialog and ids retained from older builds
 * so stored counts never fall back to "Unknown".
 */
export const ACTIVITY_DIALOG_KEYS = [
  'dialog:createAddress',
  'dialog:tag',
  'dialog:confirm',
  'dialog:export',
  'dialog:import',
  'dialog:qr',
  'dialog:commandPalette',
  'dialog:masterPassword',
  'dialog:identityCreate',
  'dialog:identityEdit',
  'dialog:label',
  'dialog:filter',
  'dialog:other',
] as const;

export type ActivityDialogKey = (typeof ACTIVITY_DIALOG_KEYS)[number];

const KNOWN_ACTIVITY_DIALOG_KEYS: ReadonlySet<string> = new Set(ACTIVITY_DIALOG_KEYS);

/** Narrow a dialog tracking attribute to a supported, localized activity id. */
export function isActivityDialogKey(value: unknown): value is ActivityDialogKey {
  return typeof value === 'string' && KNOWN_ACTIVITY_DIALOG_KEYS.has(value);
}

/** Every id the activity log can carry: a pane, or one of its dialogs. */
export type ActivityViewId = View | ActivityDialogKey;

const KNOWN_ACTIVITY_IDS: ReadonlySet<string> = new Set<string>([
  ...VIEW_LIST,
  ...ACTIVITY_DIALOG_KEYS,
]);

/**
 * Narrow an untrusted string (tour of stored visit history, a message payload)
 * to an activity id. The id family is inspected rather than trusted, because the
 * history is written by whatever build ran before this one.
 */
export function isActivityViewId(value: unknown): value is ActivityViewId {
  return typeof value === 'string' && KNOWN_ACTIVITY_IDS.has(value);
}
