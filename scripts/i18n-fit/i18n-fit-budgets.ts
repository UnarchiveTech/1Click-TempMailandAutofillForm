/**
 * Slot budgets for tight UI controls in the ~375px popup.
 *
 * maxControlPx = text content + horizontal padding (both sides).
 * Keys use the same dot paths as locale JSON (e.g. common.delete).
 *
 * English is the design baseline; these caps are the real layout budget.
 * Unlisted keys still get EN × growthFactor checks in the scanner.
 */

import type { FontSpec } from './i18n-fit-metrics';

export type FitBudget = {
  /** Max width of the control in px (text + paddingX*2) */
  maxControlPx: number;
  font?: FontSpec;
  /** Horizontal padding on one side (default 12) */
  paddingX?: number;
  /** Optional note for reports */
  note?: string;
};

/** Default font for compact popup chrome */
export const DEFAULT_UI_FONT: FontSpec = { sizePx: 12, weight: 500 };
export const SMALL_UI_FONT: FontSpec = { sizePx: 11, weight: 500 };
export const TINY_UI_FONT: FontSpec = { sizePx: 10, weight: 500 };

/**
 * Explicit budgets for controls that cannot grow freely.
 * Only keys that exist in en.json should be listed (scanner warns on orphans).
 */
export const FIT_BUDGETS: Record<string, FitBudget> = {
  // ── Common actions ───────────────────────────────────────────────────────
  // Caps are set to the widest NATURAL translation (de/fr/ja/th) + margin -
  // these controls are full-width buttons, dialog footers, flex-1 rows with the
  // P2 font-shrink responsive fitting, or wrapping chips, so the label always fits.
  'common.back': { maxControlPx: 72, paddingX: 12, font: DEFAULT_UI_FONT },
  'common.save': { maxControlPx: 88, paddingX: 12, font: DEFAULT_UI_FONT, note: 'fr Enregistrer' },
  'common.cancel': { maxControlPx: 88, paddingX: 12, font: DEFAULT_UI_FONT },
  'common.delete': { maxControlPx: 88, paddingX: 12, font: DEFAULT_UI_FONT },
  'common.edit': { maxControlPx: 88, paddingX: 12, font: DEFAULT_UI_FONT, note: 'de Bearbeiten' },
  'common.copy': { maxControlPx: 78, paddingX: 12, font: DEFAULT_UI_FONT, note: 'de Kopieren' },
  'common.refresh': {
    maxControlPx: 104,
    paddingX: 12,
    font: DEFAULT_UI_FONT,
    note: 'de Aktualisieren',
  },
  'common.search': { maxControlPx: 92, paddingX: 12, font: DEFAULT_UI_FONT, note: 'fr Rechercher' },
  'common.filter': { maxControlPx: 92, paddingX: 12, font: DEFAULT_UI_FONT, note: 'ja フィルター' },
  'common.settings': {
    maxControlPx: 106,
    paddingX: 12,
    font: DEFAULT_UI_FONT,
    note: 'de Einstellungen',
  },
  'common.close': { maxControlPx: 84, paddingX: 12, font: DEFAULT_UI_FONT, note: 'de Schließen' },
  'common.confirm': { maxControlPx: 96, paddingX: 12, font: DEFAULT_UI_FONT },
  'common.continue': {
    maxControlPx: 116,
    paddingX: 12,
    font: DEFAULT_UI_FONT,
    note: 'th ดำเนินการต่อ',
  },
  'common.yes': { maxControlPx: 64, paddingX: 12, font: DEFAULT_UI_FONT },
  'common.no': { maxControlPx: 64, paddingX: 12, font: DEFAULT_UI_FONT },
  'common.archive': { maxControlPx: 96, paddingX: 12, font: DEFAULT_UI_FONT },
  'common.unarchive': { maxControlPx: 110, paddingX: 12, font: DEFAULT_UI_FONT },
  'common.restore': {
    maxControlPx: 120,
    paddingX: 12,
    font: DEFAULT_UI_FONT,
    note: 'de Wiederherstellen',
  },
  'common.add': { maxControlPx: 92, paddingX: 12, font: DEFAULT_UI_FONT, note: 'de Hinzufügen' },
  'common.selectAll': {
    maxControlPx: 128,
    paddingX: 10,
    font: SMALL_UI_FONT,
    note: 'fr 98 - merged budget of absorbed address.selectAll (128) and backup.selectAll (110)',
  },

  // ── Inbox list tabs ──────────────────────────────────────────────────────
  'inbox.listTabs.inbox': {
    maxControlPx: 150,
    paddingX: 10,
    font: SMALL_UI_FONT,
    note: 'Tab pill with count - fr Boîte de réception (99); row wraps',
  },
  'inbox.listTabs.archived': {
    maxControlPx: 140,
    paddingX: 10,
    font: SMALL_UI_FONT,
  },
  'inbox.listTabs.deleted': {
    maxControlPx: 140,
    paddingX: 10,
    font: SMALL_UI_FONT,
  },
  'inbox.listTabs.allMails': {
    maxControlPx: 140,
    paddingX: 10,
    font: SMALL_UI_FONT,
  },
  'inbox.listTabs.view': {
    maxControlPx: 80,
    paddingX: 10,
    font: SMALL_UI_FONT,
  },

  // ── Renewal strip ────────────────────────────────────────────────────────
  'inbox.renewalStrip.always': {
    maxControlPx: 140,
    paddingX: 10,
    font: SMALL_UI_FONT,
  },
  'inbox.renewalStrip.once': {
    maxControlPx: 126,
    paddingX: 10,
    font: SMALL_UI_FONT,
    note: 'fr Renouveler une fois - flex-1 + P2 font-shrink',
  },
  'inbox.renewalStrip.dismiss': {
    maxControlPx: 64,
    paddingX: 10,
    font: SMALL_UI_FONT,
  },
  'inbox.renewalStrip.renewing': {
    maxControlPx: 120,
    paddingX: 10,
    font: SMALL_UI_FONT,
  },

  // ── Email row actions ────────────────────────────────────────────────────

  // ── Address list tabs / bulk (was mailManagement.* before the view rename) ─
  'address.live': { maxControlPx: 90, paddingX: 10, font: SMALL_UI_FONT },
  'address.inactive': {
    maxControlPx: 100,
    paddingX: 10,
    font: SMALL_UI_FONT,
  },
  // Bulk action buttons use common.archive / common.delete / common.unarchive
  // (budgeted above) plus address.exportSelected / address.addTagSelected.
  // address.selectAll was absorbed into common.selectAll (see Common actions).
  'address.exportSelected': {
    maxControlPx: 150,
    paddingX: 10,
    font: SMALL_UI_FONT,
  },

  // ── Backup dialogs ──────────────────────────────────────────────────────
  'backup.exportTitle': { maxControlPx: 220, paddingX: 0, font: DEFAULT_UI_FONT },
  'backup.importTitle': { maxControlPx: 220, paddingX: 0, font: DEFAULT_UI_FONT },
  'backup.exportAction': { maxControlPx: 150, paddingX: 12, font: DEFAULT_UI_FONT },
  'backup.importAction': { maxControlPx: 150, paddingX: 12, font: DEFAULT_UI_FONT },
  // backup.selectAll was absorbed into common.selectAll (see Common actions).

  // ── Product tour ─────────────────────────────────────────────────────────
  'productTour.skip': { maxControlPx: 110, paddingX: 10, font: SMALL_UI_FONT },
  'productTour.next': { maxControlPx: 90, paddingX: 10, font: SMALL_UI_FONT },
  'productTour.finish': { maxControlPx: 100, paddingX: 10, font: SMALL_UI_FONT },
  'productTour.replay': {
    maxControlPx: 216,
    paddingX: 12,
    font: DEFAULT_UI_FONT,
    note: 'th เริ่มต้นแนะนำการใช้งานแอป - w-full button on About page',
  },

  // ── Activity sticky actions ──────────────────────────────────────────────
  'activity.exportAnalytics': {
    maxControlPx: 190,
    paddingX: 10,
    font: SMALL_UI_FONT,
    note: 'ja 155 / th 146 - pill bar wraps (max-w-full)',
  },

  // ── 2026-09 overflow triage ─────────────────────────────────────────────────
  // Budgets added for the highest-visibility keys that overflowed the default
  // EN×1.4 growth check. Caps = widest natural translation across ar/de/es/fr/
  // ja/th/zh (measured by the scanner) + 2×paddingX + 10px margin, even-rounded.
  // The rendered single-line controls behind these keys rely on the app's own
  // fitters (fitNavPill, responsiveButtonLayout, flex-wrap) as the actual fitter;
  // these caps turn runaways from invisible EN×growth noise into strict-gate
  // failures.

  // Nav bar items (fitNavPill slots; labels shrink per locale via refreshNavLabelWidths)
  'nav.about': { maxControlPx: 86, paddingX: 10, font: DEFAULT_UI_FONT, note: 'fr À propos' },
  'nav.mailbox': { maxControlPx: 116, paddingX: 10, font: DEFAULT_UI_FONT, note: 'ja/th 86' },
  'nav.more': { maxControlPx: 82, paddingX: 10, font: DEFAULT_UI_FONT, note: 'th 52' },
  'nav.autofill': { maxControlPx: 136, paddingX: 10, font: DEFAULT_UI_FONT, note: 'ar 106' },
  'nav.profiles': { maxControlPx: 128, paddingX: 10, font: DEFAULT_UI_FONT, note: 'ja 98' },
  'nav.tagManagement': { maxControlPx: 158, paddingX: 10, font: DEFAULT_UI_FONT, note: 'fr 127' },
  'nav.labelManagement': { maxControlPx: 138, paddingX: 10, font: DEFAULT_UI_FONT, note: 'es 108' },
  'nav.savedSearches': { maxControlPx: 168, paddingX: 10, font: DEFAULT_UI_FONT, note: 'fr 138' },
  'nav.filtersManagement': {
    maxControlPx: 92,
    paddingX: 10,
    font: DEFAULT_UI_FONT,
    note: 'ja 62',
  },
  'nav.activity': { maxControlPx: 116, paddingX: 10, font: DEFAULT_UI_FONT, note: 'ja/th 86' },
  'nav.automation': { maxControlPx: 120, paddingX: 10, font: DEFAULT_UI_FONT, note: 'de 89' },
  'nav.defaultBadge': { maxControlPx: 116, paddingX: 10, font: DEFAULT_UI_FONT, note: 'es 86' },

  // FAB speed-dial labels (w-full pills)
  'nav.fabRefresh': { maxControlPx: 164, paddingX: 12, font: DEFAULT_UI_FONT, note: 'th 129' },
  'nav.fabScrollTop': { maxControlPx: 130, paddingX: 12, font: DEFAULT_UI_FONT, note: 'th 95' },
  'nav.fabCreateIdentity': {
    maxControlPx: 132,
    paddingX: 12,
    font: DEFAULT_UI_FONT,
    note: 'ja 98',
  },
  'nav.fabCreateLabel': {
    maxControlPx: 122,
    paddingX: 12,
    font: DEFAULT_UI_FONT,
    note: 'fr/th 87',
  },
  'nav.fabCreateFilter': { maxControlPx: 120, paddingX: 12, font: DEFAULT_UI_FONT, note: 'ja 86' },
  'nav.fabCreateTag': { maxControlPx: 118, paddingX: 12, font: DEFAULT_UI_FONT, note: 'es 83' },

  // Common actions (dialog footers, flex-1 rows, chips)
  'common.all': {
    maxControlPx: 74,
    paddingX: 12,
    font: DEFAULT_UI_FONT,
    note: 'th 43 - shared with Activity filters',
  },
  'common.archived': { maxControlPx: 120, paddingX: 12, font: DEFAULT_UI_FONT, note: 'ja/th 86' },
  'common.deleted': { maxControlPx: 96, paddingX: 12, font: DEFAULT_UI_FONT, note: 'es 61' },
  'common.apply': { maxControlPx: 90, paddingX: 12, font: DEFAULT_UI_FONT, note: 'de 56' },
  'common.undo': { maxControlPx: 100, paddingX: 12, font: DEFAULT_UI_FONT, note: 'de 65' },
  'common.retry': { maxControlPx: 130, paddingX: 12, font: DEFAULT_UI_FONT, note: 'de 96' },
  'common.saved': { maxControlPx: 108, paddingX: 12, font: DEFAULT_UI_FONT, note: 'ja 74' },
  'common.clear': { maxControlPx: 82, paddingX: 12, font: DEFAULT_UI_FONT, note: 'de 48' },
  'common.reset': { maxControlPx: 110, paddingX: 12, font: DEFAULT_UI_FONT, note: 'de 76' },
  'common.create': { maxControlPx: 84, paddingX: 12, font: DEFAULT_UI_FONT, note: 'de 50' },
  'common.done': { maxControlPx: 78, paddingX: 12, font: DEFAULT_UI_FONT, note: 'fr 44' },
  'common.on': {
    maxControlPx: 66,
    paddingX: 12,
    font: DEFAULT_UI_FONT,
    note: 'ar 32 - toggle pill',
  },
  'common.off': {
    maxControlPx: 72,
    paddingX: 12,
    font: DEFAULT_UI_FONT,
    note: 'es 70 - toggle pill (ar 32)',
  },
  'common.expand': { maxControlPx: 100, paddingX: 12, font: DEFAULT_UI_FONT, note: 'de 65' },
  'common.loading': { maxControlPx: 120, paddingX: 12, font: DEFAULT_UI_FONT, note: 'ar 86' },

  // Inbox list tabs - short variants (SidebarNav pills, flex-wrap row)
  'inbox.listTabs.inboxShort': {
    maxControlPx: 134,
    paddingX: 10,
    font: SMALL_UI_FONT,
    note: 'fr 104',
  },
  'inbox.listTabs.allShort': {
    maxControlPx: 74,
    paddingX: 10,
    font: SMALL_UI_FONT,
    note: 'th 43',
  },
  'inbox.listTabs.archivedShort': {
    maxControlPx: 116,
    paddingX: 10,
    font: SMALL_UI_FONT,
    note: 'ja 86',
  },
  'inbox.listTabs.storedLocallyShort': {
    maxControlPx: 160,
    paddingX: 10,
    font: SMALL_UI_FONT,
    note: 'es 129',
  },

  // Email row / selection-toolbar actions (flex-wrap overlays)
  'inbox.emailActions.selectAll': {
    maxControlPx: 104,
    paddingX: 8,
    font: SMALL_UI_FONT,
    note: 'th 78',
  },
  'inbox.emailActions.deselectAll': {
    maxControlPx: 130,
    paddingX: 8,
    font: SMALL_UI_FONT,
    note: 'th 103',
  },
  'inbox.emailActions.star': { maxControlPx: 82, paddingX: 8, font: SMALL_UI_FONT, note: 'de 55' },
  'inbox.emailActions.label': {
    maxControlPx: 112,
    paddingX: 8,
    font: SMALL_UI_FONT,
    note: 'de 85',
  },
  'inbox.emailActions.starSelected': {
    maxControlPx: 164,
    paddingX: 8,
    font: SMALL_UI_FONT,
    note: 'th 138',
  },
  'inbox.emailActions.labelSelected': {
    maxControlPx: 206,
    paddingX: 8,
    font: SMALL_UI_FONT,
    note: 'th 180',
  },
  'inbox.emailActions.addLabel': {
    maxControlPx: 142,
    paddingX: 8,
    font: SMALL_UI_FONT,
    note: 'fr 116',
  },
  'inbox.emailActions.download': {
    maxControlPx: 106,
    paddingX: 8,
    font: SMALL_UI_FONT,
    note: 'de 79',
  },
  'inbox.emailActions.forwardShort': {
    maxControlPx: 94,
    paddingX: 8,
    font: SMALL_UI_FONT,
    note: 'ar 68',
  },
  'inbox.emailActions.markUnreadShort': {
    maxControlPx: 86,
    paddingX: 8,
    font: SMALL_UI_FONT,
    note: 'th 60',
  },
  'inbox.emailActions.createRuleShort': {
    maxControlPx: 64,
    paddingX: 8,
    font: SMALL_UI_FONT,
    note: 'ja 37',
  },
  'inbox.emailActions.expandView': {
    maxControlPx: 130,
    paddingX: 8,
    font: SMALL_UI_FONT,
    note: 'de 104',
  },
  'inbox.emailActions.print': {
    maxControlPx: 122,
    paddingX: 8,
    font: SMALL_UI_FONT,
    note: 'fr 95',
  },

  // Renewal strip
  'inbox.renewalStrip.title': {
    maxControlPx: 118,
    paddingX: 10,
    font: SMALL_UI_FONT,
    note: 'fr 88',
  },
  'inbox.renewalStrip.retryTitle': {
    maxControlPx: 198,
    paddingX: 10,
    font: SMALL_UI_FONT,
    note: 'fr 167',
  },

  // Address list (bulk strip, filter chips)

  'address.clearFilters': {
    maxControlPx: 142,
    paddingX: 10,
    font: SMALL_UI_FONT,
    note: 'ja 111',
  },
  'address.renewAddresses': {
    maxControlPx: 92,
    paddingX: 10,
    font: SMALL_UI_FONT,
    note: 'fr 62',
  },
  'address.selectedCount': {
    maxControlPx: 164,
    paddingX: 10,
    font: SMALL_UI_FONT,
    note: 'th 133',
  },
  'address.filterAllProviders': {
    maxControlPx: 158,
    paddingX: 10,
    font: SMALL_UI_FONT,
    note: 'es 127',
  },
  'address.filterAllInstances': {
    maxControlPx: 154,
    paddingX: 10,
    font: SMALL_UI_FONT,
    note: 'ja 123',
  },
  'address.filterAnyTime': {
    maxControlPx: 136,
    paddingX: 10,
    font: SMALL_UI_FONT,
    note: 'es 105',
  },

  // Address view header chips
  'addressView.markAllReadShort': {
    maxControlPx: 100,
    paddingX: 10,
    font: SMALL_UI_FONT,
    note: 'de 70',
  },
  'addressView.markAllUnreadShort': {
    maxControlPx: 134,
    paddingX: 10,
    font: SMALL_UI_FONT,
    note: 'th 103',
  },
  'addressView.renewNow': {
    maxControlPx: 158,
    paddingX: 10,
    font: SMALL_UI_FONT,
    note: 'fr 127',
  },
  'addressView.refreshMessages': {
    maxControlPx: 174,
    paddingX: 10,
    font: SMALL_UI_FONT,
    note: 'de 143',
  },

  // Backup wizard: step dots + footer buttons
  'backup.stepFile': { maxControlPx: 76, paddingX: 8, font: SMALL_UI_FONT, note: 'ja 49' },
  'backup.stepChoose': { maxControlPx: 86, paddingX: 8, font: SMALL_UI_FONT, note: 'de 60' },
  'backup.unlockBackup': {
    maxControlPx: 194,
    paddingX: 12,
    font: DEFAULT_UI_FONT,
    note: 'ja 160',
  },
  'backup.exporting': { maxControlPx: 130, paddingX: 12, font: DEFAULT_UI_FONT, note: 'ja 95' },
  'backup.importing': { maxControlPx: 124, paddingX: 12, font: DEFAULT_UI_FONT, note: 'ar 89' },
  'backup.reauthFailed': {
    maxControlPx: 236,
    paddingX: 12,
    font: DEFAULT_UI_FONT,
    note: 'de 201',
  },

  // Dialog titles (header slot ≈ 220px like backup.exportTitle/importTitle)
  'backup.confirmTitle': { maxControlPx: 220, paddingX: 0, font: DEFAULT_UI_FONT, note: 'th 138' },
  'backup.wizardTitle': { maxControlPx: 220, paddingX: 0, font: DEFAULT_UI_FONT, note: 'es 139' },
  'activity.resetDialogTitle': {
    maxControlPx: 220,
    paddingX: 0,
    font: DEFAULT_UI_FONT,
    note: 'ja 209',
  },

  // Settings
  'settings.constantsResetAll': {
    maxControlPx: 262,
    paddingX: 12,
    font: DEFAULT_UI_FONT,
    note: 'es 228 - section header button',
  },
  'settings.constantsResetAllConfirmLabel': {
    maxControlPx: 134,
    paddingX: 12,
    font: DEFAULT_UI_FONT,
    note: 'de 100',
  },
  'settings.masterPasswordRotateButton': {
    maxControlPx: 146,
    paddingX: 12,
    font: DEFAULT_UI_FONT,
    note: 'ja 111',
  },
  'settings.masterPasswordSave': {
    maxControlPx: 186,
    paddingX: 12,
    font: DEFAULT_UI_FONT,
    note: 'fr 151',
  },
  'settings.addToBlocklist': {
    maxControlPx: 98,
    paddingX: 12,
    font: DEFAULT_UI_FONT,
    note: 'de 64',
  },
  'settings.blockSuggestionsAccept': {
    maxControlPx: 94,
    paddingX: 12,
    font: DEFAULT_UI_FONT,
    note: 'de 59',
  },
  'settings.clearFaviconCache': {
    maxControlPx: 194,
    paddingX: 12,
    font: DEFAULT_UI_FONT,
    note: 'ja 160',
  },
  'settings.primaryItemsPrefAuto': {
    maxControlPx: 98,
    paddingX: 10,
    font: SMALL_UI_FONT,
    note: 'de 68',
  },

  // Keyboard shortcuts view (inline text buttons + badge)
  'keyboardShortcuts.custom': {
    maxControlPx: 122,
    paddingX: 8,
    font: SMALL_UI_FONT,
    note: 'de 95 - Badge label',
  },
  'keyboardShortcuts.customCount': {
    maxControlPx: 168,
    paddingX: 8,
    font: SMALL_UI_FONT,
    note: 'th 142 - Badge label',
  },
  'keyboardShortcuts.resetAll': {
    maxControlPx: 134,
    paddingX: 12,
    font: DEFAULT_UI_FONT,
    note: 'de 100',
  },

  // Saved logins: vault + filter chips
  'savedLoginInfo.unlockVault': {
    maxControlPx: 158,
    paddingX: 12,
    font: DEFAULT_UI_FONT,
    note: 'ja 123',
  },
  'savedLoginInfo.unlocking': {
    maxControlPx: 132,
    paddingX: 12,
    font: DEFAULT_UI_FONT,
    note: 'th 98',
  },
  'savedLoginInfo.filterMailbox': {
    maxControlPx: 116,
    paddingX: 10,
    font: SMALL_UI_FONT,
    note: 'ja 86 - filter chip',
  },
  'savedLoginInfo.clearFilters': {
    maxControlPx: 142,
    paddingX: 10,
    font: SMALL_UI_FONT,
    note: 'ja 111 - filter chip',
  },

  // Activity view
  'activity.showMore': { maxControlPx: 116, paddingX: 10, font: SMALL_UI_FONT, note: 'th 86' },
  'activity.showLess': { maxControlPx: 130, paddingX: 10, font: SMALL_UI_FONT, note: 'de 99' },
  'activity.resetActivity': {
    maxControlPx: 178,
    paddingX: 10,
    font: SMALL_UI_FONT,
    note: 'ja 147',
  },
  'activity.storageTrendTitle': {
    maxControlPx: 88,
    paddingX: 10,
    font: SMALL_UI_FONT,
    note: 'es 58',
  },

  // Diagnostics view: status badges + action buttons
  'diagnostics.status.ok': { maxControlPx: 52, paddingX: 8, font: SMALL_UI_FONT, note: 'th 26' },
  'diagnostics.status.fail': {
    maxControlPx: 78,
    paddingX: 8,
    font: SMALL_UI_FONT,
    note: 'th 52',
  },
  'diagnostics.status.warn': {
    maxControlPx: 106,
    paddingX: 8,
    font: SMALL_UI_FONT,
    note: 'fr 79',
  },
  'diagnostics.rerun': { maxControlPx: 130, paddingX: 8, font: SMALL_UI_FONT, note: 'th 103' },
  'diagnostics.running': { maxControlPx: 138, paddingX: 8, font: SMALL_UI_FONT, note: 'th 112' },

  // Product tour: skip link in dialog footer (sibling of productTour.skip)
  'productTour.skipTour': {
    maxControlPx: 130,
    paddingX: 10,
    font: SMALL_UI_FONT,
    note: 'de 100',
  },
};

/** Default samples for {placeholders} when measuring */
export const DEFAULT_PLACEHOLDER_SAMPLES: Record<string, string> = {
  count: '99',
  n: '99',
  total: '99',
  name: 'Work',
  address: 'abc@guerrillamail.com',
  email: 'user@example.com',
  version: '3.0.0',
  provider: 'Guerrilla',
  domain: 'example.com',
  filtered: '12',
  size: '1.2 MB',
  time: '2h ago',
  date: '2026-01-01',
};
