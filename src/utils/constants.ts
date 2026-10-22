import { browser } from 'wxt/browser';
import { writeWithRetry } from '@/utils/storage/storage-write.js';

/**
 * Named constants for magic numbers and configuration values.
 * Centralizes configuration and supports dynamic developer overrides.
 */

/** Default MD3 primary color (seed green) used as a fallback for badge / injected UI. */
export const DEFAULT_PRIMARY_COLOR = '#4c662b';

export const DEFAULT_CONSTANTS = {
  DEBUG: false,
  EMAIL_CHECK_INTERVAL_MS: 10 * 1000,
  EMAIL_CLEANUP_INTERVAL_MS: 24 * 60 * 60 * 1000,
  INBOX_EXPIRY_CHECK_INTERVAL_MS: 60 * 1000,
  EXPIRY_WARNING_THRESHOLD_MS: 60 * 60 * 1000,
  PASSWORD_MIN_LENGTH: 8,
  PASSWORD_MAX_LENGTH: 42,
  GITHUB_REPO_URL: 'https://github.com/UnarchiveTech/1Click-TempMailwithAutofill',
  GITHUB_ISSUES_URL: 'https://github.com/UnarchiveTech/1Click-TempMailwithAutofill/issues/new',
  DOCS_URL: 'https://docs.unarchive.tech/1click',
  WEBSITE_URL: 'https://unarchive.tech',
  DEMO_URL: 'https://demo.unarchive.tech/1click',
  GOOGLE_FAVICON_API_URL: 'https://t0.gstatic.com/faviconV2',
  USERNAME_MIN_LENGTH: 1,
  USERNAME_MAX_LENGTH: 64,
  TOAST_DEFAULT_DURATION_MS: 3000,
  TOAST_UNDO_DURATION_MS: 5000,
  KEY_ROTATION_INTERVAL_MS: 90 * 24 * 60 * 60 * 1000,
  FORCE_NEW_SESSIONS_AUTO_CLEAR_MS: 5 * 60 * 1000,
  API_RETRY_ATTEMPTS: 3,
  API_RETRY_DELAY_MS: 1000,
  MAX_STORED_EMAILS_PER_INBOX: 100,
  MAX_ARCHIVED_EMAILS: 500,
  /** Durable per-inbox seen-ID cap: bounds the seen set so it stays tiny even
   * for heavy mailboxes. 1000 covers every ID a provider is likely to still
   * list long after the 100-message bag evicted the message. */
  MAX_SEEN_EMAIL_IDS_PER_INBOX: 1000,
  DIALOG_FOCUS_DELAY_MS: 50,
  QR_GENERATION_DELAY_MS: 100,
  FORM_SCAN_DELAY_MS: 1000,
  BUTTON_SIZE_PX: 24,
  BUTTON_OFFSET_PX: 30,
  BUTTON_OPACITY_DEFAULT: 0.85,
  BUTTON_OPACITY_HOVER: 1.0,
  QR_CODE_SIZE_PX: 160,
  QR_CODE_MARGIN: 2,
  FORM_DETECTION_TIMEOUT_MS: 5000,
  MAX_CUSTOM_INSTANCE_NAME_LENGTH: 50,
  MAX_CUSTOM_INSTANCE_URL_LENGTH: 200,
  ENCRYPTION_IV_LENGTH: 12,
  SALT_LENGTH: 16,
  PHONE_AREA_CODE_MIN: 200,
  PHONE_AREA_CODE_MAX: 999,
  PHONE_PART_MIN: 100,
  PHONE_PART_MAX: 999,
  PHONE_LAST_PART_MIN: 1000,
  PHONE_LAST_PART_MAX: 9999,
  OTP_LENGTH_MIN: 4,
  OTP_LENGTH_MAX: 8,
  STORAGE_WARNING_THRESHOLD: 4.5 * 1024 * 1024,
  STORAGE_CRITICAL_THRESHOLD: 4.8 * 1024 * 1024,
  STORAGE_LIMIT: 5 * 1024 * 1024,
  MAX_FAVICON_CACHE_SIZE: 100,
  FAVICON_CACHE_EVICT_RATIO: 0.2,
  /** Show the countdown badge when the active inbox expires within this window. */
  NEAR_EXPIRY_BADGE_WINDOW_MS: 30 * 60 * 1000,
  /** Amber warning tint for the near-expiry badge ("{m}m" countdown). */
  NEAR_EXPIRY_BADGE_COLOR: '#f59e0b',
} as const;

export type ConstantKey = keyof typeof DEFAULT_CONSTANTS;

/**
 * Mutable live constants.
 *
 * Initialized from defaults, mutated at runtime by developer overrides from
 * extension storage (see `applyConstantOverrides`). Import `CONSTANTS` and
 * access properties directly (e.g. `CONSTANTS.DEBUG`) - they always reflect
 * the latest value.
 */
export const CONSTANTS: { -readonly [K in ConstantKey]: (typeof DEFAULT_CONSTANTS)[K] } = {
  ...DEFAULT_CONSTANTS,
};

const STORAGE_KEY = 'developer_constant_overrides';

/** Keys that must never be mutated by runtime overrides. */
const FIXED_KEYS = new Set<ConstantKey>(['NEAR_EXPIRY_BADGE_WINDOW_MS', 'NEAR_EXPIRY_BADGE_COLOR']);

// ── Override helpers ─────────────────────────────────────────────────────────

export async function getConstantOverrides(): Promise<Partial<Record<ConstantKey, unknown>>> {
  try {
    if (browser?.storage?.local) {
      const result = (await browser.storage.local.get([STORAGE_KEY])) as {
        [STORAGE_KEY]?: Partial<Record<ConstantKey, unknown>>;
      };
      return result[STORAGE_KEY] || {};
    }
  } catch {
    /* ignore fallback */
  }
  return {};
}

export async function applyConstantOverrides(
  overrides: Partial<Record<ConstantKey, unknown>>
): Promise<void> {
  for (const [key, value] of Object.entries(overrides)) {
    const k = key as ConstantKey;
    if (FIXED_KEYS.has(k)) continue;
    const defaultVal = DEFAULT_CONSTANTS[k];
    if (typeof value === typeof defaultVal && value !== undefined) {
      (CONSTANTS as Record<string, unknown>)[k] = value;
    }
  }
}

export async function saveConstantOverrides(
  overrides: Partial<Record<ConstantKey, unknown>>
): Promise<void> {
  const current = await getConstantOverrides();
  const updated = { ...current, ...overrides };
  await writeWithRetry({ [STORAGE_KEY]: updated });
  await applyConstantOverrides(updated);
}

export async function resetConstantOverride(key: ConstantKey): Promise<void> {
  const current = await getConstantOverrides();
  delete current[key];
  await writeWithRetry({ [STORAGE_KEY]: current });
  (CONSTANTS as Record<string, unknown>)[key] = DEFAULT_CONSTANTS[key];
}

export async function resetAllConstantOverrides(): Promise<void> {
  await browser.storage.local.remove([STORAGE_KEY]);
  Object.assign(CONSTANTS, DEFAULT_CONSTANTS);
}

// Load overrides initially
void (async () => {
  const overrides = await getConstantOverrides();
  await applyConstantOverrides(overrides);
})();
