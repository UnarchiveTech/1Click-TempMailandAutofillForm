import { browser } from 'wxt/browser';

/**
 * Named constants for magic numbers and configuration values.
 * Centralizes configuration and supports dynamic developer overrides.
 */

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
  GOOGLE_FAVICON_API_URL: 'https://www.google.com/s2/favicons',
  USERNAME_MIN_LENGTH: 1,
  USERNAME_MAX_LENGTH: 64,
  TOAST_DEFAULT_DURATION_MS: 3000,
  TOAST_UNDO_DURATION_MS: 5000,
  OTP_CLIPBOARD_CLEAR_MS: 30 * 1000,
  KEY_ROTATION_INTERVAL_MS: 90 * 24 * 60 * 60 * 1000,
  FORCE_NEW_SESSIONS_AUTO_CLEAR_MS: 5 * 60 * 1000,
  API_RETRY_ATTEMPTS: 3,
  API_RETRY_DELAY_MS: 1000,
  MAX_STORED_EMAILS_PER_INBOX: 100,
  MAX_ARCHIVED_EMAILS: 500,
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
  PBKDF2_ITERATIONS: 100000,
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
} as const;

export type ConstantKey = keyof typeof DEFAULT_CONSTANTS;

const STORAGE_KEY = 'developer_constant_overrides';

// Exported live values initialized with default values
export let DEBUG: boolean = DEFAULT_CONSTANTS.DEBUG;
export let EMAIL_CHECK_INTERVAL_MS: number = DEFAULT_CONSTANTS.EMAIL_CHECK_INTERVAL_MS;
export let EMAIL_CLEANUP_INTERVAL_MS: number = DEFAULT_CONSTANTS.EMAIL_CLEANUP_INTERVAL_MS;
export let INBOX_EXPIRY_CHECK_INTERVAL_MS: number =
  DEFAULT_CONSTANTS.INBOX_EXPIRY_CHECK_INTERVAL_MS;
export let EXPIRY_WARNING_THRESHOLD_MS: number = DEFAULT_CONSTANTS.EXPIRY_WARNING_THRESHOLD_MS;
export let PASSWORD_MIN_LENGTH: number = DEFAULT_CONSTANTS.PASSWORD_MIN_LENGTH;
export let PASSWORD_MAX_LENGTH: number = DEFAULT_CONSTANTS.PASSWORD_MAX_LENGTH;
export let GITHUB_REPO_URL: string = DEFAULT_CONSTANTS.GITHUB_REPO_URL;
export let GITHUB_ISSUES_URL: string = DEFAULT_CONSTANTS.GITHUB_ISSUES_URL;
export let GOOGLE_FAVICON_API_URL: string = DEFAULT_CONSTANTS.GOOGLE_FAVICON_API_URL;
export let USERNAME_MIN_LENGTH: number = DEFAULT_CONSTANTS.USERNAME_MIN_LENGTH;
export let USERNAME_MAX_LENGTH: number = DEFAULT_CONSTANTS.USERNAME_MAX_LENGTH;
export let TOAST_DEFAULT_DURATION_MS: number = DEFAULT_CONSTANTS.TOAST_DEFAULT_DURATION_MS;
export let TOAST_UNDO_DURATION_MS: number = DEFAULT_CONSTANTS.TOAST_UNDO_DURATION_MS;
export let OTP_CLIPBOARD_CLEAR_MS: number = DEFAULT_CONSTANTS.OTP_CLIPBOARD_CLEAR_MS;
export let KEY_ROTATION_INTERVAL_MS: number = DEFAULT_CONSTANTS.KEY_ROTATION_INTERVAL_MS;
export let FORCE_NEW_SESSIONS_AUTO_CLEAR_MS: number =
  DEFAULT_CONSTANTS.FORCE_NEW_SESSIONS_AUTO_CLEAR_MS;
export let API_RETRY_ATTEMPTS: number = DEFAULT_CONSTANTS.API_RETRY_ATTEMPTS;
export let API_RETRY_DELAY_MS: number = DEFAULT_CONSTANTS.API_RETRY_DELAY_MS;
export let MAX_STORED_EMAILS_PER_INBOX: number = DEFAULT_CONSTANTS.MAX_STORED_EMAILS_PER_INBOX;
export let MAX_ARCHIVED_EMAILS: number = DEFAULT_CONSTANTS.MAX_ARCHIVED_EMAILS;
export let DIALOG_FOCUS_DELAY_MS: number = DEFAULT_CONSTANTS.DIALOG_FOCUS_DELAY_MS;
export let QR_GENERATION_DELAY_MS: number = DEFAULT_CONSTANTS.QR_GENERATION_DELAY_MS;
export let FORM_SCAN_DELAY_MS: number = DEFAULT_CONSTANTS.FORM_SCAN_DELAY_MS;
export let BUTTON_SIZE_PX: number = DEFAULT_CONSTANTS.BUTTON_SIZE_PX;
export let BUTTON_OFFSET_PX: number = DEFAULT_CONSTANTS.BUTTON_OFFSET_PX;
export let BUTTON_OPACITY_DEFAULT: number = DEFAULT_CONSTANTS.BUTTON_OPACITY_DEFAULT;
export let BUTTON_OPACITY_HOVER: number = DEFAULT_CONSTANTS.BUTTON_OPACITY_HOVER;
export let QR_CODE_SIZE_PX: number = DEFAULT_CONSTANTS.QR_CODE_SIZE_PX;
export let QR_CODE_MARGIN: number = DEFAULT_CONSTANTS.QR_CODE_MARGIN;
export let FORM_DETECTION_TIMEOUT_MS: number = DEFAULT_CONSTANTS.FORM_DETECTION_TIMEOUT_MS;
export let MAX_CUSTOM_INSTANCE_NAME_LENGTH: number =
  DEFAULT_CONSTANTS.MAX_CUSTOM_INSTANCE_NAME_LENGTH;
export let MAX_CUSTOM_INSTANCE_URL_LENGTH: number =
  DEFAULT_CONSTANTS.MAX_CUSTOM_INSTANCE_URL_LENGTH;
export let ENCRYPTION_IV_LENGTH: number = DEFAULT_CONSTANTS.ENCRYPTION_IV_LENGTH;
export let SALT_LENGTH: number = DEFAULT_CONSTANTS.SALT_LENGTH;
export let PBKDF2_ITERATIONS: number = DEFAULT_CONSTANTS.PBKDF2_ITERATIONS;
export let PHONE_AREA_CODE_MIN: number = DEFAULT_CONSTANTS.PHONE_AREA_CODE_MIN;
export let PHONE_AREA_CODE_MAX: number = DEFAULT_CONSTANTS.PHONE_AREA_CODE_MAX;
export let PHONE_PART_MIN: number = DEFAULT_CONSTANTS.PHONE_PART_MIN;
export let PHONE_PART_MAX: number = DEFAULT_CONSTANTS.PHONE_PART_MAX;
export let PHONE_LAST_PART_MIN: number = DEFAULT_CONSTANTS.PHONE_LAST_PART_MIN;
export let PHONE_LAST_PART_MAX: number = DEFAULT_CONSTANTS.PHONE_LAST_PART_MAX;
export let OTP_LENGTH_MIN: number = DEFAULT_CONSTANTS.OTP_LENGTH_MIN;
export let OTP_LENGTH_MAX: number = DEFAULT_CONSTANTS.OTP_LENGTH_MAX;
export let STORAGE_WARNING_THRESHOLD: number = DEFAULT_CONSTANTS.STORAGE_WARNING_THRESHOLD;
export let STORAGE_CRITICAL_THRESHOLD: number = DEFAULT_CONSTANTS.STORAGE_CRITICAL_THRESHOLD;
export let STORAGE_LIMIT: number = DEFAULT_CONSTANTS.STORAGE_LIMIT;
export let MAX_FAVICON_CACHE_SIZE: number = DEFAULT_CONSTANTS.MAX_FAVICON_CACHE_SIZE;
export let FAVICON_CACHE_EVICT_RATIO: number = DEFAULT_CONSTANTS.FAVICON_CACHE_EVICT_RATIO;

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
  if ('DEBUG' in overrides && typeof overrides.DEBUG === 'boolean') DEBUG = overrides.DEBUG;
  if (
    'EMAIL_CHECK_INTERVAL_MS' in overrides &&
    typeof overrides.EMAIL_CHECK_INTERVAL_MS === 'number'
  )
    EMAIL_CHECK_INTERVAL_MS = overrides.EMAIL_CHECK_INTERVAL_MS;
  if (
    'EMAIL_CLEANUP_INTERVAL_MS' in overrides &&
    typeof overrides.EMAIL_CLEANUP_INTERVAL_MS === 'number'
  )
    EMAIL_CLEANUP_INTERVAL_MS = overrides.EMAIL_CLEANUP_INTERVAL_MS;
  if (
    'INBOX_EXPIRY_CHECK_INTERVAL_MS' in overrides &&
    typeof overrides.INBOX_EXPIRY_CHECK_INTERVAL_MS === 'number'
  )
    INBOX_EXPIRY_CHECK_INTERVAL_MS = overrides.INBOX_EXPIRY_CHECK_INTERVAL_MS;
  if (
    'EXPIRY_WARNING_THRESHOLD_MS' in overrides &&
    typeof overrides.EXPIRY_WARNING_THRESHOLD_MS === 'number'
  )
    EXPIRY_WARNING_THRESHOLD_MS = overrides.EXPIRY_WARNING_THRESHOLD_MS;
  if ('PASSWORD_MIN_LENGTH' in overrides && typeof overrides.PASSWORD_MIN_LENGTH === 'number')
    PASSWORD_MIN_LENGTH = overrides.PASSWORD_MIN_LENGTH;
  if ('PASSWORD_MAX_LENGTH' in overrides && typeof overrides.PASSWORD_MAX_LENGTH === 'number')
    PASSWORD_MAX_LENGTH = overrides.PASSWORD_MAX_LENGTH;
  if ('GITHUB_REPO_URL' in overrides && typeof overrides.GITHUB_REPO_URL === 'string')
    GITHUB_REPO_URL = overrides.GITHUB_REPO_URL;
  if ('GITHUB_ISSUES_URL' in overrides && typeof overrides.GITHUB_ISSUES_URL === 'string')
    GITHUB_ISSUES_URL = overrides.GITHUB_ISSUES_URL;
  if ('GOOGLE_FAVICON_API_URL' in overrides && typeof overrides.GOOGLE_FAVICON_API_URL === 'string')
    GOOGLE_FAVICON_API_URL = overrides.GOOGLE_FAVICON_API_URL;
  if ('USERNAME_MIN_LENGTH' in overrides && typeof overrides.USERNAME_MIN_LENGTH === 'number')
    USERNAME_MIN_LENGTH = overrides.USERNAME_MIN_LENGTH;
  if ('USERNAME_MAX_LENGTH' in overrides && typeof overrides.USERNAME_MAX_LENGTH === 'number')
    USERNAME_MAX_LENGTH = overrides.USERNAME_MAX_LENGTH;
  if (
    'TOAST_DEFAULT_DURATION_MS' in overrides &&
    typeof overrides.TOAST_DEFAULT_DURATION_MS === 'number'
  )
    TOAST_DEFAULT_DURATION_MS = overrides.TOAST_DEFAULT_DURATION_MS;
  if ('TOAST_UNDO_DURATION_MS' in overrides && typeof overrides.TOAST_UNDO_DURATION_MS === 'number')
    TOAST_UNDO_DURATION_MS = overrides.TOAST_UNDO_DURATION_MS;
  if ('OTP_CLIPBOARD_CLEAR_MS' in overrides && typeof overrides.OTP_CLIPBOARD_CLEAR_MS === 'number')
    OTP_CLIPBOARD_CLEAR_MS = overrides.OTP_CLIPBOARD_CLEAR_MS;
  if (
    'KEY_ROTATION_INTERVAL_MS' in overrides &&
    typeof overrides.KEY_ROTATION_INTERVAL_MS === 'number'
  )
    KEY_ROTATION_INTERVAL_MS = overrides.KEY_ROTATION_INTERVAL_MS;
  if (
    'FORCE_NEW_SESSIONS_AUTO_CLEAR_MS' in overrides &&
    typeof overrides.FORCE_NEW_SESSIONS_AUTO_CLEAR_MS === 'number'
  )
    FORCE_NEW_SESSIONS_AUTO_CLEAR_MS = overrides.FORCE_NEW_SESSIONS_AUTO_CLEAR_MS;
  if ('API_RETRY_ATTEMPTS' in overrides && typeof overrides.API_RETRY_ATTEMPTS === 'number')
    API_RETRY_ATTEMPTS = overrides.API_RETRY_ATTEMPTS;
  if ('API_RETRY_DELAY_MS' in overrides && typeof overrides.API_RETRY_DELAY_MS === 'number')
    API_RETRY_DELAY_MS = overrides.API_RETRY_DELAY_MS;
  if (
    'MAX_STORED_EMAILS_PER_INBOX' in overrides &&
    typeof overrides.MAX_STORED_EMAILS_PER_INBOX === 'number'
  )
    MAX_STORED_EMAILS_PER_INBOX = overrides.MAX_STORED_EMAILS_PER_INBOX;
  if ('MAX_ARCHIVED_EMAILS' in overrides && typeof overrides.MAX_ARCHIVED_EMAILS === 'number')
    MAX_ARCHIVED_EMAILS = overrides.MAX_ARCHIVED_EMAILS;
  if ('DIALOG_FOCUS_DELAY_MS' in overrides && typeof overrides.DIALOG_FOCUS_DELAY_MS === 'number')
    DIALOG_FOCUS_DELAY_MS = overrides.DIALOG_FOCUS_DELAY_MS;
  if ('QR_GENERATION_DELAY_MS' in overrides && typeof overrides.QR_GENERATION_DELAY_MS === 'number')
    QR_GENERATION_DELAY_MS = overrides.QR_GENERATION_DELAY_MS;
  if ('FORM_SCAN_DELAY_MS' in overrides && typeof overrides.FORM_SCAN_DELAY_MS === 'number')
    FORM_SCAN_DELAY_MS = overrides.FORM_SCAN_DELAY_MS;
  if ('BUTTON_SIZE_PX' in overrides && typeof overrides.BUTTON_SIZE_PX === 'number')
    BUTTON_SIZE_PX = overrides.BUTTON_SIZE_PX;
  if ('BUTTON_OFFSET_PX' in overrides && typeof overrides.BUTTON_OFFSET_PX === 'number')
    BUTTON_OFFSET_PX = overrides.BUTTON_OFFSET_PX;
  if ('BUTTON_OPACITY_DEFAULT' in overrides && typeof overrides.BUTTON_OPACITY_DEFAULT === 'number')
    BUTTON_OPACITY_DEFAULT = overrides.BUTTON_OPACITY_DEFAULT;
  if ('BUTTON_OPACITY_HOVER' in overrides && typeof overrides.BUTTON_OPACITY_HOVER === 'number')
    BUTTON_OPACITY_HOVER = overrides.BUTTON_OPACITY_HOVER;
  if ('QR_CODE_SIZE_PX' in overrides && typeof overrides.QR_CODE_SIZE_PX === 'number')
    QR_CODE_SIZE_PX = overrides.QR_CODE_SIZE_PX;
  if ('QR_CODE_MARGIN' in overrides && typeof overrides.QR_CODE_MARGIN === 'number')
    QR_CODE_MARGIN = overrides.QR_CODE_MARGIN;
  if (
    'FORM_DETECTION_TIMEOUT_MS' in overrides &&
    typeof overrides.FORM_DETECTION_TIMEOUT_MS === 'number'
  )
    FORM_DETECTION_TIMEOUT_MS = overrides.FORM_DETECTION_TIMEOUT_MS;
  if (
    'MAX_CUSTOM_INSTANCE_NAME_LENGTH' in overrides &&
    typeof overrides.MAX_CUSTOM_INSTANCE_NAME_LENGTH === 'number'
  )
    MAX_CUSTOM_INSTANCE_NAME_LENGTH = overrides.MAX_CUSTOM_INSTANCE_NAME_LENGTH;
  if (
    'MAX_CUSTOM_INSTANCE_URL_LENGTH' in overrides &&
    typeof overrides.MAX_CUSTOM_INSTANCE_URL_LENGTH === 'number'
  )
    MAX_CUSTOM_INSTANCE_URL_LENGTH = overrides.MAX_CUSTOM_INSTANCE_URL_LENGTH;
  if ('ENCRYPTION_IV_LENGTH' in overrides && typeof overrides.ENCRYPTION_IV_LENGTH === 'number')
    ENCRYPTION_IV_LENGTH = overrides.ENCRYPTION_IV_LENGTH;
  if ('SALT_LENGTH' in overrides && typeof overrides.SALT_LENGTH === 'number')
    SALT_LENGTH = overrides.SALT_LENGTH;
  if ('PBKDF2_ITERATIONS' in overrides && typeof overrides.PBKDF2_ITERATIONS === 'number')
    PBKDF2_ITERATIONS = overrides.PBKDF2_ITERATIONS;
  if ('PHONE_AREA_CODE_MIN' in overrides && typeof overrides.PHONE_AREA_CODE_MIN === 'number')
    PHONE_AREA_CODE_MIN = overrides.PHONE_AREA_CODE_MIN;
  if ('PHONE_AREA_CODE_MAX' in overrides && typeof overrides.PHONE_AREA_CODE_MAX === 'number')
    PHONE_AREA_CODE_MAX = overrides.PHONE_AREA_CODE_MAX;
  if ('PHONE_PART_MIN' in overrides && typeof overrides.PHONE_PART_MIN === 'number')
    PHONE_PART_MIN = overrides.PHONE_PART_MIN;
  if ('PHONE_PART_MAX' in overrides && typeof overrides.PHONE_PART_MAX === 'number')
    PHONE_PART_MAX = overrides.PHONE_PART_MAX;
  if ('PHONE_LAST_PART_MIN' in overrides && typeof overrides.PHONE_LAST_PART_MIN === 'number')
    PHONE_LAST_PART_MIN = overrides.PHONE_LAST_PART_MIN;
  if ('PHONE_LAST_PART_MAX' in overrides && typeof overrides.PHONE_LAST_PART_MAX === 'number')
    PHONE_LAST_PART_MAX = overrides.PHONE_LAST_PART_MAX;
  if ('OTP_LENGTH_MIN' in overrides && typeof overrides.OTP_LENGTH_MIN === 'number')
    OTP_LENGTH_MIN = overrides.OTP_LENGTH_MIN;
  if ('OTP_LENGTH_MAX' in overrides && typeof overrides.OTP_LENGTH_MAX === 'number')
    OTP_LENGTH_MAX = overrides.OTP_LENGTH_MAX;
  if (
    'STORAGE_WARNING_THRESHOLD' in overrides &&
    typeof overrides.STORAGE_WARNING_THRESHOLD === 'number'
  )
    STORAGE_WARNING_THRESHOLD = overrides.STORAGE_WARNING_THRESHOLD;
  if (
    'STORAGE_CRITICAL_THRESHOLD' in overrides &&
    typeof overrides.STORAGE_CRITICAL_THRESHOLD === 'number'
  )
    STORAGE_CRITICAL_THRESHOLD = overrides.STORAGE_CRITICAL_THRESHOLD;
  if ('STORAGE_LIMIT' in overrides && typeof overrides.STORAGE_LIMIT === 'number')
    STORAGE_LIMIT = overrides.STORAGE_LIMIT;
  if ('MAX_FAVICON_CACHE_SIZE' in overrides && typeof overrides.MAX_FAVICON_CACHE_SIZE === 'number')
    MAX_FAVICON_CACHE_SIZE = overrides.MAX_FAVICON_CACHE_SIZE;
  if (
    'FAVICON_CACHE_EVICT_RATIO' in overrides &&
    typeof overrides.FAVICON_CACHE_EVICT_RATIO === 'number'
  )
    FAVICON_CACHE_EVICT_RATIO = overrides.FAVICON_CACHE_EVICT_RATIO;
}

export async function saveConstantOverrides(
  overrides: Partial<Record<ConstantKey, unknown>>
): Promise<void> {
  const current = await getConstantOverrides();
  const updated = { ...current, ...overrides };
  await browser.storage.local.set({ [STORAGE_KEY]: updated });
  await applyConstantOverrides(updated);
}

export async function resetConstantOverride(key: ConstantKey): Promise<void> {
  const current = await getConstantOverrides();
  delete current[key];
  await browser.storage.local.set({ [STORAGE_KEY]: current });
  // Re-apply with default for this key
  const defaultValue = DEFAULT_CONSTANTS[key];
  await applyConstantOverrides({ ...current, [key]: defaultValue });
}

export async function resetAllConstantOverrides(): Promise<void> {
  await browser.storage.local.remove([STORAGE_KEY]);
  await applyConstantOverrides(DEFAULT_CONSTANTS);
}

// Load overrides initially
void (async () => {
  const overrides = await getConstantOverrides();
  await applyConstantOverrides(overrides);
})();
