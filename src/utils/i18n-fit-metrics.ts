/**
 * Approximate visual text width for i18n fit scanning (no native canvas).
 *
 * Calibrated for typical system-ui / Inter metrics at a given font size.
 * Not pixel-perfect vs browser `measureText`, but stable for CI and relative
 * EN vs DE/FR comparisons.
 */

export type FontSpec = {
  /** CSS font size in px (e.g. 12) */
  sizePx: number;
  /** Approximate weight factor: 400 → 1, 500 → 1.02, 600 → 1.05, 700 → 1.08 */
  weight?: number;
};

const DEFAULT_WEIGHT = 400;

/** Average Latin advance width as fraction of em (system-ui ~0.52–0.56) */
const LATIN_EM = 0.55;
/** Wide Latin (W, M, @) */
const LATIN_WIDE_EM = 0.72;
/** Narrow Latin (i, l, t, f, j, r) */
const LATIN_NARROW_EM = 0.32;
/** Digits */
const DIGIT_EM = 0.58;
/** Space */
const SPACE_EM = 0.28;
/** CJK / fullwidth */
const CJK_EM = 1.0;
/** Arabic / Hebrew rough average */
const RTL_EM = 0.52;
/** Fallback (emoji, symbols) */
const OTHER_EM = 0.7;

const NARROW = new Set('iljtfrI1|!.,:;\'`"'.split(''));
const WIDE = new Set('WMmw@%&QHGO'.split(''));

function isCjk(code: number): boolean {
  return (
    (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified
    (code >= 0x3400 && code <= 0x4dbf) || // CJK Ext A
    (code >= 0x3040 && code <= 0x30ff) || // Hiragana/Katakana
    (code >= 0xac00 && code <= 0xd7af) || // Hangul
    (code >= 0xff00 && code <= 0xffef) || // Fullwidth forms
    (code >= 0x3000 && code <= 0x303f) // CJK punctuation
  );
}

function isRtlLetter(code: number): boolean {
  return (
    (code >= 0x0600 && code <= 0x06ff) || // Arabic
    (code >= 0x0750 && code <= 0x077f) ||
    (code >= 0x0590 && code <= 0x05ff) // Hebrew
  );
}

function charEm(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  if (code <= 0x20) return SPACE_EM;
  if (isCjk(code)) return CJK_EM;
  if (isRtlLetter(code)) return RTL_EM;
  if (code >= 0x30 && code <= 0x39) return DIGIT_EM;
  if (NARROW.has(ch)) return LATIN_NARROW_EM;
  if (WIDE.has(ch)) return LATIN_WIDE_EM;
  // Basic Latin + Latin-1 supplement letters
  if (code < 0x0250 || (code >= 0x00c0 && code <= 0x024f)) {
    return LATIN_EM;
  }
  return OTHER_EM;
}

function weightFactor(weight: number): number {
  if (weight <= 400) return 1;
  if (weight <= 500) return 1.02;
  if (weight <= 600) return 1.05;
  return 1.08;
}

/**
 * Estimate content width in CSS pixels for `text` at the given font size.
 * Does not include button padding - only the text run.
 */
export function measureTextWidth(text: string, font: FontSpec = { sizePx: 12 }): number {
  if (!text) return 0;
  const w = font.weight ?? DEFAULT_WEIGHT;
  const factor = weightFactor(w);
  let em = 0;
  for (const ch of text) {
    em += charEm(ch);
  }
  return Math.ceil(em * font.sizePx * factor);
}

/** Total control width ≈ text + horizontal padding on both sides */
export function measureControlWidth(text: string, font: FontSpec, paddingX: number): number {
  return measureTextWidth(text, font) + paddingX * 2;
}

/**
 * Replace `{var}` placeholders with sample values so widths are realistic.
 */
export function fillPlaceholders(template: string, samples: Record<string, string> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    if (samples[name] !== undefined) return samples[name];
    // Sensible defaults for common keys
    if (name === 'count' || name === 'n' || name === 'total') return '99';
    if (name === 'name' || name === 'address' || name === 'email') return 'user@example.com';
    if (name === 'version') return '3.0.0';
    if (name === 'provider') return 'Guerrilla';
    return 'XX';
  });
}

export type FitStatus = 'ok' | 'tight' | 'overflow';

export type FitEvaluation = {
  enWidth: number;
  localeWidth: number;
  /** Slot max for full control (text + padding), if budgeted */
  maxWidth: number | null;
  /** localeWidth - enWidth */
  deltaVsEn: number;
  /** maxWidth - localeWidth when budgeted; else budgetFromEn - localeWidth */
  freeSpace: number;
  status: FitStatus;
  /** How budget was derived */
  budgetSource: 'slot' | 'en-growth' | 'none';
};

/**
 * Evaluate whether locale text fits relative to English and optional slot budget.
 *
 * @param growthFactor When no slot budget, allow locale up to enWidth * growthFactor (default 1.4)
 * @param tightThresholdPx free space below this (but ≥ 0) → "tight"
 */
export function evaluateFit(options: {
  enText: string;
  localeText: string;
  font?: FontSpec;
  paddingX?: number;
  /** Absolute max control width (text + padding). Overrides growth budget when set. */
  maxControlPx?: number;
  growthFactor?: number;
  tightThresholdPx?: number;
}): FitEvaluation {
  const font = options.font ?? { sizePx: 12, weight: 500 };
  const paddingX = options.paddingX ?? 0;
  const growthFactor = options.growthFactor ?? 1.4;
  const tightThresholdPx = options.tightThresholdPx ?? 8;

  const enWidth = measureControlWidth(options.enText, font, paddingX);
  const localeWidth = measureControlWidth(options.localeText, font, paddingX);
  const deltaVsEn = localeWidth - enWidth;

  let maxWidth: number | null = null;
  let budgetSource: FitEvaluation['budgetSource'] = 'none';

  if (options.maxControlPx != null && options.maxControlPx > 0) {
    maxWidth = options.maxControlPx;
    budgetSource = 'slot';
  } else if (enWidth > 0) {
    maxWidth = Math.ceil(enWidth * growthFactor);
    budgetSource = 'en-growth';
  }

  const freeSpace = maxWidth != null ? maxWidth - localeWidth : 0;

  let status: FitStatus = 'ok';
  if (maxWidth != null) {
    if (freeSpace < 0) status = 'overflow';
    else if (freeSpace < tightThresholdPx) status = 'tight';
    else status = 'ok';
  }

  return {
    enWidth,
    localeWidth,
    maxWidth,
    deltaVsEn,
    freeSpace,
    status,
    budgetSource,
  };
}
