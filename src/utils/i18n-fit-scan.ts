/**
 * Core i18n fit scan: compare locale strings to English design + slot budgets.
 * Used by scripts/i18n-fit-scanner.ts and unit tests.
 */

import { DEFAULT_PLACEHOLDER_SAMPLES, FIT_BUDGETS, type FitBudget } from './i18n-fit-budgets';
import {
  evaluateFit,
  type FitEvaluation,
  type FitStatus,
  type FontSpec,
  fillPlaceholders,
} from './i18n-fit-metrics';

export type LocaleMap = Map<string, string>;

export type FitRow = FitEvaluation & {
  key: string;
  locale: string;
  enText: string;
  localeText: string;
  /** Whether this key has an explicit slot budget */
  hasSlotBudget: boolean;
};

export type FitScanOptions = {
  /** EN × factor when no slot budget (default 1.4) */
  growthFactor?: number;
  /** freeSpace below this → tight (default 8) */
  tightThresholdPx?: number;
  /** Only report these statuses (default: all) */
  includeStatuses?: FitStatus[];
  /** Only keys with explicit FIT_BUDGETS */
  budgetedOnly?: boolean;
  /** Skip long body/description keys without budgets (default true) */
  skipLongUnbudgeted?: boolean;
  /** Max EN char length for unbudgeted scan (default 48) */
  maxUnbudgetedEnLength?: number;
  placeholderSamples?: Record<string, string>;
  budgets?: Record<string, FitBudget>;
};

export type FitScanSummary = {
  locales: string[];
  totalCompared: number;
  ok: number;
  tight: number;
  overflow: number;
  budgetedCompared: number;
  budgetedOverflow: number;
  orphanBudgets: string[];
};

export type FitScanResult = {
  rows: FitRow[];
  summary: FitScanSummary;
};

export function flattenLocale(
  obj: Record<string, unknown>,
  prefix = '',
  result: Map<string, string> = new Map()
): Map<string, string> {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      result.set(fullKey, value);
    } else if (value !== null && typeof value === 'object') {
      flattenLocale(value as Record<string, unknown>, fullKey, result);
    }
  }
  return result;
}

function defaultFont(): FontSpec {
  return { sizePx: 12, weight: 500 };
}

/**
 * Heuristic: skip paragraphs / help text that are not button-like.
 */
function looksLikeLongCopy(key: string, enText: string, maxLen: number): boolean {
  if (enText.length > maxLen) return true;
  if (/\.(body|description|hint|subtitle|help|prompt|warning|message)$/i.test(key)) {
    return true;
  }
  if (/\.(steps\.[^.]+\.body)$/i.test(key)) return true;
  return false;
}

export function scanLocaleFit(
  en: LocaleMap,
  locales: Record<string, LocaleMap>,
  options: FitScanOptions = {}
): FitScanResult {
  const growthFactor = options.growthFactor ?? 1.4;
  const tightThresholdPx = options.tightThresholdPx ?? 8;
  const budgetedOnly = options.budgetedOnly ?? false;
  const skipLongUnbudgeted = options.skipLongUnbudgeted ?? true;
  const maxUnbudgetedEnLength = options.maxUnbudgetedEnLength ?? 48;
  const samples = { ...DEFAULT_PLACEHOLDER_SAMPLES, ...options.placeholderSamples };
  const budgets = options.budgets ?? FIT_BUDGETS;
  const includeStatuses = options.includeStatuses ? new Set(options.includeStatuses) : null;

  const orphanBudgets = Object.keys(budgets).filter((k) => !en.has(k));

  const rows: FitRow[] = [];
  let ok = 0;
  let tight = 0;
  let overflow = 0;
  let budgetedCompared = 0;
  let budgetedOverflow = 0;

  const keysToScan = budgetedOnly ? Object.keys(budgets).filter((k) => en.has(k)) : [...en.keys()];

  for (const [locale, localeMap] of Object.entries(locales)) {
    for (const key of keysToScan) {
      const enRaw = en.get(key);
      if (enRaw === undefined) continue;
      const locRaw = localeMap.get(key);
      if (locRaw === undefined) continue;

      const budget = budgets[key];
      const hasSlotBudget = !!budget;

      if (!hasSlotBudget) {
        if (budgetedOnly) continue;
        if (skipLongUnbudgeted && looksLikeLongCopy(key, enRaw, maxUnbudgetedEnLength)) {
          continue;
        }
      }

      const enText = fillPlaceholders(enRaw, samples);
      const localeText = fillPlaceholders(locRaw, samples);
      const font = budget?.font ?? defaultFont();
      const paddingX = budget?.paddingX ?? (hasSlotBudget ? 12 : 0);

      const evaluation = evaluateFit({
        enText,
        localeText,
        font,
        paddingX,
        maxControlPx: budget?.maxControlPx,
        growthFactor,
        tightThresholdPx,
      });

      if (includeStatuses && !includeStatuses.has(evaluation.status)) {
        continue;
      }

      if (hasSlotBudget) {
        budgetedCompared += 1;
        if (evaluation.status === 'overflow') budgetedOverflow += 1;
      }

      if (evaluation.status === 'ok') ok += 1;
      else if (evaluation.status === 'tight') tight += 1;
      else overflow += 1;

      rows.push({
        key,
        locale,
        enText,
        localeText,
        hasSlotBudget,
        ...evaluation,
      });
    }
  }

  // Sort: overflow first, then tight, then by freeSpace ascending
  const order: Record<FitStatus, number> = { overflow: 0, tight: 1, ok: 2 };
  rows.sort((a, b) => {
    const d = order[a.status] - order[b.status];
    if (d !== 0) return d;
    if (a.freeSpace !== b.freeSpace) return a.freeSpace - b.freeSpace;
    return a.key.localeCompare(b.key) || a.locale.localeCompare(b.locale);
  });

  return {
    rows,
    summary: {
      locales: Object.keys(locales),
      totalCompared: rows.length,
      ok,
      tight,
      overflow,
      budgetedCompared,
      budgetedOverflow,
      orphanBudgets,
    },
  };
}
