/**
 * User-tunable smart autofill settings (local storage).
 */

import { browser } from 'wxt/browser';
import { withLock } from '@/utils/mutex.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';

export interface SmartAutofillSettings {
  /** Mimic human behavior while filling forms (keystroke micro-delays & realistic events) */
  humanLikeFilling: boolean;
  /** Stagger field fills with small random delays (anti-bot) */
  humanLikeTiming: boolean;
  /** Min/max ms between field fills when humanLikeTiming is on */
  timingMinMs: number;
  timingMaxMs: number;
  /** Show dry-run overlay before committing Autofill All */
  dryRunPreview: boolean;
  /** Auto-open Wait-for-OTP after successful email fill */
  smartOtpAttach: boolean;
  /** Prefer page language for names/phones/addresses */
  localeAwareData: boolean;
  /** Failures before suggesting domain block */
  blockSuggestAfterFailures: number;
  /** Multi-level undo depth */
  undoStackDepth: number;
  /** Automatically click the form submit button after autofill (explicit opt-in) */
  autoClickSubmitButtons: boolean;
}

export const DEFAULT_SMART_AUTOFILL: SmartAutofillSettings = {
  humanLikeFilling: true,
  humanLikeTiming: true,
  timingMinMs: 40,
  timingMaxMs: 180,
  dryRunPreview: true,
  smartOtpAttach: true,
  localeAwareData: true,
  blockSuggestAfterFailures: 3,
  undoStackDepth: 5,
  autoClickSubmitButtons: false,
};

const KEY = 'smartAutofillSettings';

function isSettingsObject(value: unknown): value is Partial<SmartAutofillSettings> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/**
 * Clamp timing bounds to the same absolute caps load and save must share:
 * timingMinMs ∈ [10, 500] and timingMaxMs ∈ [clampedMin + 10, 2000]. A save
 * path that only enforced max ≥ min + 10 let a buggy UI or an imported
 * settings blob persist out-of-range values (e.g. timingMaxMs: 99999) until
 * the next load silently clamped them.
 */
function clampTimingBounds(
  timingMinMs: number,
  timingMaxMs: number
): {
  timingMinMs: number;
  timingMaxMs: number;
} {
  const min = Math.max(10, Math.min(500, timingMinMs));
  const max = Math.max(min + 10, Math.min(2000, timingMaxMs));
  return { timingMinMs: min, timingMaxMs: max };
}

/**
 * Persist the defaults explicitly so the auto-submit default is stable across
 * upgrades. autoClickSubmitButtons is consent-sensitive (it submits forms on
 * the user's behalf), so it is only ever enabled by an explicit stored
 * choice: fresh installs get the opt-in default (`false`), and upgraders who
 * never persisted a choice fall back to that same default rather than being
 * silently flipped ON (the pre-opt-in default of true was never a user
 * decision). Explicit stored true/false is always preserved.
 */
export async function initializeSmartAutofillSettings(
  _reason: 'install' | 'update'
): Promise<SmartAutofillSettings> {
  return withLock('smart_settings_lock', async () => {
    const res = (await browser.storage.local.get([KEY])) as {
      smartAutofillSettings?: unknown;
    };
    const raw = isSettingsObject(res.smartAutofillSettings) ? res.smartAutofillSettings : {};
    const next = { ...DEFAULT_SMART_AUTOFILL, ...raw } as SmartAutofillSettings;
    const bounds = clampTimingBounds(next.timingMinMs, next.timingMaxMs);
    next.timingMinMs = bounds.timingMinMs;
    next.timingMaxMs = bounds.timingMaxMs;
    await writeWithRetry({ [KEY]: next });
    return next;
  });
}

export async function loadSmartAutofillSettings(): Promise<SmartAutofillSettings> {
  try {
    const res = (await browser.storage.local.get([KEY])) as {
      smartAutofillSettings?: Partial<SmartAutofillSettings>;
    };

    // Deep merge function
    const isObject = (item: unknown): item is Record<string, unknown> =>
      Boolean(item && typeof item === 'object' && !Array.isArray(item));
    const mergeDeep = (
      target: Record<string, unknown>,
      source: Record<string, unknown>
    ): Record<string, unknown> => {
      const output = Object.assign({}, target);
      if (isObject(target) && isObject(source)) {
        Object.keys(source).forEach((key) => {
          if (isObject(source[key])) {
            if (!(key in target)) Object.assign(output, { [key]: source[key] });
            else
              output[key] = mergeDeep(
                (target[key] || {}) as Record<string, unknown>,
                (source[key] || {}) as Record<string, unknown>
              );
          } else {
            Object.assign(output, { [key]: source[key] });
          }
        });
      }
      return output;
    };

    const loaded = mergeDeep(
      DEFAULT_SMART_AUTOFILL as unknown as Record<string, unknown>,
      (isSettingsObject(res.smartAutofillSettings) ? res.smartAutofillSettings : {}) as Record<
        string,
        unknown
      >
    ) as unknown as SmartAutofillSettings;
    const rawMin = Number(loaded.timingMinMs) || DEFAULT_SMART_AUTOFILL.timingMinMs;
    const rawMax = Number(loaded.timingMaxMs) || DEFAULT_SMART_AUTOFILL.timingMaxMs;
    const bounds = clampTimingBounds(rawMin, rawMax);
    loaded.timingMinMs = bounds.timingMinMs;
    loaded.timingMaxMs = bounds.timingMaxMs;
    return loaded;
  } catch {
    /* ignore */
    return { ...DEFAULT_SMART_AUTOFILL };
  }
}

export async function saveSmartAutofillSettings(
  partial: Partial<SmartAutofillSettings>
): Promise<SmartAutofillSettings> {
  return withLock('smart_settings_lock', async () => {
    const next = { ...(await loadSmartAutofillSettings()), ...partial };
    const bounds = clampTimingBounds(
      Number(next.timingMinMs) || DEFAULT_SMART_AUTOFILL.timingMinMs,
      Number(next.timingMaxMs) || DEFAULT_SMART_AUTOFILL.timingMaxMs
    );
    next.timingMinMs = bounds.timingMinMs;
    next.timingMaxMs = bounds.timingMaxMs;
    await writeWithRetry({ [KEY]: next });
    return next;
  });
}
