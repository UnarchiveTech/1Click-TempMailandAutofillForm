/**
 * Named constants for magic numbers and configuration values
 * Centralizes configuration to improve maintainability
 */

// Debug mode - set to false for production
export const DEBUG = false;

// Email check intervals (in milliseconds)
export const EMAIL_CHECK_INTERVAL_MS = 10 * 1000; // 10 seconds
export const EMAIL_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const INBOX_EXPIRY_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute

// Inbox expiration times (in milliseconds)
// Provider-specific constants moved to JSON configs
export const EXPIRY_WARNING_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour before expiry

// Password generation
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 42;

// External URLs
export const GITHUB_REPO_URL = 'https://github.com/UnarchiveTech/1Click-TempMailwithAutofill';
export const GITHUB_ISSUES_URL =
  'https://github.com/UnarchiveTech/1Click-TempMailwithAutofill/issues/new';
export const GOOGLE_FAVICON_API_URL = 'https://www.google.com/s2/favicons';
export const USERNAME_MIN_LENGTH = 8;
export const USERNAME_MAX_LENGTH = 15;

// Toast notification durations (in milliseconds)
export const TOAST_DEFAULT_DURATION_MS = 3000;
export const TOAST_UNDO_DURATION_MS = 5000;

// Key rotation
export const KEY_ROTATION_INTERVAL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

// Session management
export const FORCE_NEW_SESSIONS_AUTO_CLEAR_MS = 5 * 60 * 1000; // 5 minutes

// API retry settings
export const API_RETRY_ATTEMPTS = 3;
export const API_RETRY_DELAY_MS = 1000;

// Storage limits
export const MAX_STORED_EMAILS_PER_INBOX = 100;
export const MAX_ARCHIVED_EMAILS = 500;

// UI delays (in milliseconds)
export const DIALOG_FOCUS_DELAY_MS = 50;
export const QR_GENERATION_DELAY_MS = 100;
export const FORM_SCAN_DELAY_MS = 1000;

// Button positioning
export const BUTTON_SIZE_PX = 24;
export const BUTTON_OFFSET_PX = 30;
export const BUTTON_OPACITY_DEFAULT = 0.85;
export const BUTTON_OPACITY_HOVER = 1.0;

// QR Code
export const QR_CODE_SIZE_PX = 160;
export const QR_CODE_MARGIN = 2;

// Form detection timeout
export const FORM_DETECTION_TIMEOUT_MS = 5000;

// Custom instance validation
export const MAX_CUSTOM_INSTANCE_NAME_LENGTH = 50;
export const MAX_CUSTOM_INSTANCE_URL_LENGTH = 200;

// Encryption
export const ENCRYPTION_IV_LENGTH = 12; // bytes for AES-GCM
export const SALT_LENGTH = 16; // bytes for PBKDF2
export const PBKDF2_ITERATIONS = 100000;

// Phone number generation
export const PHONE_AREA_CODE_MIN = 200;
export const PHONE_AREA_CODE_MAX = 999;
export const PHONE_PART_MIN = 100;
export const PHONE_PART_MAX = 999;
export const PHONE_LAST_PART_MIN = 1000;
export const PHONE_LAST_PART_MAX = 9999;

// OTP detection patterns
export const OTP_LENGTH_MIN = 4;
export const OTP_LENGTH_MAX = 8;
