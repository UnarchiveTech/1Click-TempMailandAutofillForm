/**
 * Lightweight constants module for content scripts.
 *
 * Avoids pulling the entire `constants.ts` (with DEFAULT_CONSTANTS, applyOverrides,
 * and encryption constants like ENCRYPTION_IV_LENGTH and SALT_LENGTH)
 * into the content-script bundle.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 42;
export const USERNAME_MIN_LENGTH = 1;
export const USERNAME_MAX_LENGTH = 64;
export const PHONE_AREA_CODE_MIN = 200;
export const PHONE_AREA_CODE_MAX = 999;
export const PHONE_PART_MIN = 100;
export const PHONE_PART_MAX = 999;
export const PHONE_LAST_PART_MIN = 1000;
export const PHONE_LAST_PART_MAX = 9999;
export const BUTTON_OPACITY_DEFAULT = 0.92;
export const BUTTON_OPACITY_HOVER = 1;
export const TOAST_DEFAULT_DURATION_MS = 3000;
