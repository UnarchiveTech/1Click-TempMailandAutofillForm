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
  'common.back': { maxControlPx: 72, paddingX: 12, font: DEFAULT_UI_FONT },
  'common.save': { maxControlPx: 80, paddingX: 12, font: DEFAULT_UI_FONT },
  'common.cancel': { maxControlPx: 88, paddingX: 12, font: DEFAULT_UI_FONT },
  'common.delete': { maxControlPx: 88, paddingX: 12, font: DEFAULT_UI_FONT },
  'common.edit': { maxControlPx: 72, paddingX: 12, font: DEFAULT_UI_FONT },
  'common.copy': { maxControlPx: 72, paddingX: 12, font: DEFAULT_UI_FONT },
  'common.refresh': { maxControlPx: 88, paddingX: 12, font: DEFAULT_UI_FONT },
  'common.search': { maxControlPx: 80, paddingX: 12, font: DEFAULT_UI_FONT },
  'common.filter': { maxControlPx: 80, paddingX: 12, font: DEFAULT_UI_FONT },
  'common.settings': { maxControlPx: 96, paddingX: 12, font: DEFAULT_UI_FONT },
  'common.close': { maxControlPx: 72, paddingX: 12, font: DEFAULT_UI_FONT },
  'common.confirm': { maxControlPx: 96, paddingX: 12, font: DEFAULT_UI_FONT },
  'common.continue': { maxControlPx: 96, paddingX: 12, font: DEFAULT_UI_FONT },
  'common.yes': { maxControlPx: 64, paddingX: 12, font: DEFAULT_UI_FONT },
  'common.no': { maxControlPx: 64, paddingX: 12, font: DEFAULT_UI_FONT },
  'common.archive': { maxControlPx: 96, paddingX: 12, font: DEFAULT_UI_FONT },
  'common.unarchive': { maxControlPx: 110, paddingX: 12, font: DEFAULT_UI_FONT },
  'common.restore': { maxControlPx: 96, paddingX: 12, font: DEFAULT_UI_FONT },
  'common.add': { maxControlPx: 72, paddingX: 12, font: DEFAULT_UI_FONT },

  // ── Inbox list tabs ──────────────────────────────────────────────────────
  'inbox.listTabs.inbox': {
    maxControlPx: 130,
    paddingX: 10,
    font: SMALL_UI_FONT,
    note: 'Tab pill with count',
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
    maxControlPx: 120,
    paddingX: 10,
    font: SMALL_UI_FONT,
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
  'inbox.emailActions.archive': {
    maxControlPx: 96,
    paddingX: 8,
    font: SMALL_UI_FONT,
  },
  'inbox.emailActions.delete': {
    maxControlPx: 88,
    paddingX: 8,
    font: SMALL_UI_FONT,
  },
  'inbox.emailActions.restore': {
    maxControlPx: 96,
    paddingX: 8,
    font: SMALL_UI_FONT,
  },
  'inbox.emailActions.unarchive': {
    maxControlPx: 110,
    paddingX: 8,
    font: SMALL_UI_FONT,
  },

  // ── Mail management tabs / bulk ──────────────────────────────────────────
  'mailManagement.live': { maxControlPx: 90, paddingX: 10, font: SMALL_UI_FONT },
  'mailManagement.inactive': {
    maxControlPx: 100,
    paddingX: 10,
    font: SMALL_UI_FONT,
  },
  'mailManagement.archiveSelected': {
    maxControlPx: 150,
    paddingX: 10,
    font: SMALL_UI_FONT,
  },
  'mailManagement.deleteSelected': {
    maxControlPx: 150,
    paddingX: 10,
    font: SMALL_UI_FONT,
  },
  'mailManagement.exportSelected': {
    maxControlPx: 150,
    paddingX: 10,
    font: SMALL_UI_FONT,
  },

  // ── Backup dialogs ──────────────────────────────────────────────────────
  'backup.exportTitle': { maxControlPx: 220, paddingX: 0, font: DEFAULT_UI_FONT },
  'backup.importTitle': { maxControlPx: 220, paddingX: 0, font: DEFAULT_UI_FONT },
  'backup.exportAction': { maxControlPx: 150, paddingX: 12, font: DEFAULT_UI_FONT },
  'backup.importAction': { maxControlPx: 150, paddingX: 12, font: DEFAULT_UI_FONT },
  'backup.selectAll': { maxControlPx: 110, paddingX: 8, font: SMALL_UI_FONT },
  'backup.clearAll': { maxControlPx: 110, paddingX: 8, font: SMALL_UI_FONT },

  // ── Product tour ─────────────────────────────────────────────────────────
  'productTour.skip': { maxControlPx: 110, paddingX: 10, font: SMALL_UI_FONT },
  'productTour.next': { maxControlPx: 90, paddingX: 10, font: SMALL_UI_FONT },
  'productTour.finish': { maxControlPx: 100, paddingX: 10, font: SMALL_UI_FONT },
  'productTour.replay': { maxControlPx: 160, paddingX: 12, font: DEFAULT_UI_FONT },

  // ── Activity sticky actions ──────────────────────────────────────────────
  'activity.refresh': { maxControlPx: 110, paddingX: 10, font: SMALL_UI_FONT },
  'activity.exportAnalytics': {
    maxControlPx: 130,
    paddingX: 10,
    font: SMALL_UI_FONT,
  },
  'activity.reset': { maxControlPx: 100, paddingX: 10, font: SMALL_UI_FONT },
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
