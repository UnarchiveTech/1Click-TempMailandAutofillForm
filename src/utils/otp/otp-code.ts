/**
 * Shared "no OTP" sentinel and predicate.
 *
 * Several layers store the placeholder `'------'` to mean "no one-time code
 * present" (e.g. the global `latestOtp` state and, historically, some email
 * records). Every check that decides whether a message "is an OTP email" or
 * "has a usable code" must exclude this sentinel, otherwise a placeholder is
 * treated as a real verification code.
 */

export const NO_OTP_SENTINEL = '------';

/**
 * True when `code` is a real, usable OTP string - non-empty, not whitespace,
 * and not the `'------'` placeholder.
 */
export function isRealOtp(code: unknown): code is string {
  return typeof code === 'string' && code.trim().length > 0 && code.trim() !== NO_OTP_SENTINEL;
}
