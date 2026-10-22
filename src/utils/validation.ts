/**
 * Input validation utilities
 * Provides validation functions for user inputs to prevent XSS, injection attacks, and data corruption
 */

import { CONSTANTS } from './constants.js';
import { ValidationError } from './errors.js';
import { PUBLIC_SUFFIXES } from './security/root-domain.js';

/**
 * Sanitize HTML content to prevent XSS attacks
 */
export function sanitizeHTML(input: string): string {
  return input.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] ?? character
  );
}

/**
 * Validate and sanitize a CSS color value for safe use in DOM style attributes.
 *
 * Prevents HTML/CSS injection when a user-controlled color string (e.g. the
 * `customColor` setting) is interpolated into an inline `style="…"` attribute
 * or assigned to `element.style.cssText`. Only hex (#rgb / #rrggbb /
 * #rrggbbaa / #rgba) and rgb()/rgba()/hsl()/hsla() functional notation are
 * accepted. Any string containing characters that could break out of an
 * attribute or style context (<, >, ", ', backtick, {, }, ;) is rejected.
 *
 * @returns the validated color string, or `null` if the input is not a safe color.
 */
export function sanitizeColor(color: string): string | null {
  if (!color) return null;
  const trimmed = color.trim();
  // Reject anything that could break out of a style attribute / HTML context
  if (/[<>"`'{};]/.test(trimmed)) return null;
  // Allow hex (#rgb, #rgba, #rrggbb, #rrggbbaa)
  const hexRe = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
  // Allow strict rgb()/rgba()/hsl()/hsla() functional notation with numeric/percentage args only
  const rgbRe =
    /^rgba?\(\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*(,\s*(0|1|0?\.\d+|\d+%)\s*)?\)$/i;
  const hslRe =
    /^hsla?\(\s*\d{1,3}(deg|rad|turn)?\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*(,\s*(0|1|0?\.\d+|\d+%)\s*)?\)$/i;
  if (hexRe.test(trimmed) || rgbRe.test(trimmed) || hslRe.test(trimmed)) {
    return trimmed;
  }
  return null;
}

/**
 * Authoritative domain normalization function for credential matching and intelligence lookups.
 * Strips protocol, ports, paths, query params, www. prefix, trims, and converts to lowercase.
 */
export function normalizeDomain(d: string): string {
  let s = (d || '').trim().toLowerCase();
  s = s.replace(/^https?:\/\//i, '');
  // Cut path, query, AND fragment before stripping the port - a trailing
  // `#fragment` after a `:port` (e.g. "example.com:8080#section") would
  // otherwise defeat the /:\d+$/ port regex and leak the port into the result.
  const cut = s.search(/[/?#]/);
  if (cut !== -1) s = s.slice(0, cut);
  s = s.replace(/:\d+$/, '');
  return s.replace(/^www\./i, '');
}

/**
 * Known public suffixes / multi-tenant shared hosts. Subdomain (suffix)
 * credential matching must never span one of these: any third party can own a
 * subdomain of e.g. `github.io` or `co.uk`, so treating the bare suffix as a
 * credential boundary would over-share saved credentials to unrelated sites.
 *
 * Curated safety-net subset (not the full Mozilla PSL). Entries are matched on
 * the FULL normalized domain, so `example.co.uk` is unaffected - only the bare
 * `co.uk` / `github.io` / … itself is blocked from suffix matching.
 * Exact-equality matches are always allowed (a credential literally saved on
 * the bare host still matches that exact host).
 */
/**
 * True when `domain` is a known public suffix / shared host that must never
 * act as the parent side of a subdomain credential match.
 */
export function isPublicSuffix(domain: string): boolean {
  return PUBLIC_SUFFIXES.has((domain || '').trim().toLowerCase());
}

function registrableSiteDomain(domain: string): string {
  const labels = domain.split('.').filter(Boolean);
  if (labels.length < 2) return domain;

  // Find the longest known public suffix and include its directly preceding
  // label. This groups sibling subdomains of one registrable site while
  // keeping separate tenants under shared hosts (for example, github.io).
  for (let index = 0; index < labels.length; index += 1) {
    const suffix = labels.slice(index).join('.');
    if (PUBLIC_SUFFIXES.has(suffix)) {
      return index === 0 ? domain : labels.slice(index - 1).join('.');
    }
  }

  // Keep a conservative fallback for common single-label TLDs absent from
  // the curated suffix set.
  return labels.slice(-2).join('.');
}

/**
 * True when two normalized hosts are the same site or one is a subdomain of
 * the other. A known public suffix can never be the shared parent boundary,
 * so unrelated tenants such as `a.github.io` and `b.github.io` stay distinct.
 */
export function domainsShareSiteBoundary(left: string, right: string): boolean {
  const leftDomain = normalizeDomain(left);
  const rightDomain = normalizeDomain(right);
  if (!leftDomain || !rightDomain) return false;
  if (leftDomain === rightDomain) return true;
  if (!isPublicSuffix(rightDomain) && leftDomain.endsWith(`.${rightDomain}`)) return true;
  if (!isPublicSuffix(leftDomain) && rightDomain.endsWith(`.${leftDomain}`)) return true;
  return false;
}

/** True when two hosts resolve to the same registrable site boundary. */
export function domainsShareRegistrableSite(left: string, right: string): boolean {
  const leftDomain = normalizeDomain(left);
  const rightDomain = normalizeDomain(right);
  if (!leftDomain || !rightDomain) return false;
  return registrableSiteDomain(leftDomain) === registrableSiteDomain(rightDomain);
}

/** True when a host is exactly a configured domain or lies below that parent. */
export function hostMatchesDomainScope(host: string, scope: string): boolean {
  if (typeof host !== 'string' || typeof scope !== 'string') return false;
  const normalizedHost = normalizeDomain(host);
  const normalizedScope = normalizeDomain(scope);
  if (!normalizedHost || !normalizedScope) return false;
  return (
    normalizedHost === normalizedScope ||
    (!isPublicSuffix(normalizedScope) && normalizedHost.endsWith(`.${normalizedScope}`))
  );
}

/**
 * Validate and sanitize email address
 */
export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate password strength
 */
export function validatePassword(password: string): void {
  if (!password) {
    throw new ValidationError('Password cannot be empty', { field: 'password' });
  }
  if (password.length < CONSTANTS.PASSWORD_MIN_LENGTH) {
    throw new ValidationError(
      `Password must be at least ${CONSTANTS.PASSWORD_MIN_LENGTH} characters`,
      {
        field: 'password',
        minLength: CONSTANTS.PASSWORD_MIN_LENGTH,
      }
    );
  }
  if (password.length > CONSTANTS.PASSWORD_MAX_LENGTH) {
    throw new ValidationError(
      `Password must be less than ${CONSTANTS.PASSWORD_MAX_LENGTH} characters`,
      {
        field: 'password',
        maxLength: CONSTANTS.PASSWORD_MAX_LENGTH,
      }
    );
  }
}

/**
 * Validate username
 */
export function validateUsername(username: string): void {
  if (!username) {
    throw new ValidationError(
      'Username cannot be empty',
      { field: 'username' },
      'errors.validationUsernameEmpty'
    );
  }
  if (username.length < CONSTANTS.USERNAME_MIN_LENGTH) {
    throw new ValidationError(
      `Username must be at least ${CONSTANTS.USERNAME_MIN_LENGTH} characters`,
      {
        field: 'username',
        minLength: CONSTANTS.USERNAME_MIN_LENGTH,
      },
      'errors.validationUsernameMinLength',
      { min: CONSTANTS.USERNAME_MIN_LENGTH }
    );
  }
  if (username.length > CONSTANTS.USERNAME_MAX_LENGTH) {
    throw new ValidationError(
      `Username must be less than ${CONSTANTS.USERNAME_MAX_LENGTH} characters`,
      {
        field: 'username',
        maxLength: CONSTANTS.USERNAME_MAX_LENGTH,
      },
      'errors.validationUsernameMaxLength',
      { max: CONSTANTS.USERNAME_MAX_LENGTH }
    );
  }
  // Allow only alphanumeric characters and underscores
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    throw new ValidationError(
      'Username can only contain letters, numbers, and underscores',
      { field: 'username' },
      'errors.validationUsernameCharset'
    );
  }
}

/**
 * Validate OTP code
 */
export function validateOTP(otp: string): void {
  if (!otp) {
    throw new ValidationError('OTP cannot be empty', { field: 'otp' });
  }
  const trimmedOtp = otp.trim();
  if (trimmedOtp.length < CONSTANTS.OTP_LENGTH_MIN) {
    throw new ValidationError(`OTP must be at least ${CONSTANTS.OTP_LENGTH_MIN} characters`, {
      field: 'otp',
      minLength: CONSTANTS.OTP_LENGTH_MIN,
    });
  }
  if (trimmedOtp.length > CONSTANTS.OTP_LENGTH_MAX) {
    throw new ValidationError(`OTP must be less than ${CONSTANTS.OTP_LENGTH_MAX} characters`, {
      field: 'otp',
      maxLength: CONSTANTS.OTP_LENGTH_MAX,
    });
  }
  // OTP should be numeric
  if (!/^\d+$/.test(trimmedOtp)) {
    throw new ValidationError('OTP must contain only numbers', { field: 'otp' });
  }
}

/**
 * Validate phone number
 */
export function validatePhoneNumber(phone: string): void {
  if (!phone) {
    throw new ValidationError('Phone number cannot be empty', { field: 'phone' });
  }
  // Remove common formatting characters
  const cleaned = phone.replace(/[\s\-()]/g, '');
  // Check if it's a valid phone number (10-15 digits)
  if (!/^\d{10,15}$/.test(cleaned)) {
    throw new ValidationError('Phone number must be 10-15 digits', { field: 'phone' });
  }
}

/**
 * Validate and sanitize text input
 */
export function validateTextInput(
  input: string,
  fieldName: string,
  maxLength: number = 1000
): string {
  if (!input) {
    return '';
  }
  const trimmed = input.trim();
  // Strip control characters (C0: U+0000-U+001F, DEL/C1: U+007F-U+009F - includes
  // \n, \r, \t) and collapse any resulting whitespace runs into a single space.
  // \p{Cc} is the Unicode "Control" category and avoids embedding literal
  // control chars in the regex (which Biome's noControlCharactersInRegex bans).
  const cleaned = trimmed
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length > maxLength) {
    // `fieldName` arrives already localized (callers pass their own translated
    // label), so the `{field}` slot is safe to interpolate as-is.
    throw new ValidationError(
      `${fieldName} must be less than ${maxLength} characters`,
      {
        field: fieldName,
        maxLength,
      },
      'errors.validationTextTooLong',
      { field: fieldName, max: maxLength }
    );
  }
  return sanitizeHTML(cleaned);
}

/**
 * Validate URL
 */
export function validateURL(url: string): void {
  if (!url) {
    throw new ValidationError('URL cannot be empty', { field: 'url' });
  }
  try {
    const parsedUrl = new URL(url);
    if (!['http:', 'https:', 'ftp:', 'mailto:'].includes(parsedUrl.protocol)) {
      throw new ValidationError('URL protocol is not allowed', { field: 'url' });
    }
  } catch (_error) {
    throw new ValidationError('Invalid URL format', { field: 'url' });
  }
}

/**
 * Validate numeric input
 */
export function validateNumber(
  input: string,
  fieldName: string,
  min?: number,
  max?: number
): number {
  if (!input) {
    throw new ValidationError(`${fieldName} cannot be empty`, { field: fieldName });
  }
  const num = Number(input);
  if (Number.isNaN(num)) {
    throw new ValidationError(`${fieldName} must be a valid number`, { field: fieldName });
  }
  if (min !== undefined && num < min) {
    throw new ValidationError(`${fieldName} must be at least ${min}`, { field: fieldName, min });
  }
  if (max !== undefined && num > max) {
    throw new ValidationError(`${fieldName} must be at most ${max}`, { field: fieldName, max });
  }
  return num;
}

/**
 * Validate boolean input (checkbox, toggle)
 */
export function validateBoolean(input: unknown, fieldName: string): boolean {
  if (typeof input !== 'boolean') {
    throw new ValidationError(`${fieldName} must be a boolean value`, { field: fieldName });
  }
  return input;
}

/**
 * Validate array input
 */
export function validateArray(input: unknown, fieldName: string, maxLength?: number): unknown[] {
  if (!Array.isArray(input)) {
    throw new ValidationError(`${fieldName} must be an array`, { field: fieldName });
  }
  if (maxLength !== undefined && input.length > maxLength) {
    throw new ValidationError(`${fieldName} must contain at most ${maxLength} items`, {
      field: fieldName,
      maxLength,
    });
  }
  return input;
}
