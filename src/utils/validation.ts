/**
 * Input validation utilities
 * Provides validation functions for user inputs to prevent XSS, injection attacks, and data corruption
 */

import {
  MAX_CUSTOM_INSTANCE_NAME_LENGTH,
  MAX_CUSTOM_INSTANCE_URL_LENGTH,
  OTP_LENGTH_MAX,
  OTP_LENGTH_MIN,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from './constants.js';
import { ValidationError } from './errors.js';

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
 * Validate and sanitize email address
 */
export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate custom instance name
 */
export function validateCustomInstanceName(name: string): void {
  if (!name || name.trim().length === 0) {
    throw new ValidationError('Instance name cannot be empty', { field: 'instanceName' });
  }
  if (name.length > MAX_CUSTOM_INSTANCE_NAME_LENGTH) {
    throw new ValidationError(
      `Instance name must be less than ${MAX_CUSTOM_INSTANCE_NAME_LENGTH} characters`,
      { field: 'instanceName', maxLength: MAX_CUSTOM_INSTANCE_NAME_LENGTH }
    );
  }
  // Check for potentially dangerous characters
  if (/[<>"'&]/.test(name)) {
    throw new ValidationError('Instance name contains invalid characters', {
      field: 'instanceName',
    });
  }
}

/**
 * Validate custom instance URL
 */
export function validateCustomInstanceUrl(url: string): void {
  if (!url || url.trim().length === 0) {
    throw new ValidationError('Instance URL cannot be empty', { field: 'instanceUrl' });
  }
  if (url.length > MAX_CUSTOM_INSTANCE_URL_LENGTH) {
    throw new ValidationError(
      `Instance URL must be less than ${MAX_CUSTOM_INSTANCE_URL_LENGTH} characters`,
      { field: 'instanceUrl', maxLength: MAX_CUSTOM_INSTANCE_URL_LENGTH }
    );
  }
  try {
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new ValidationError('Instance URL must use HTTP or HTTPS protocol', {
        field: 'instanceUrl',
      });
    }
    const hostname = parsedUrl.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname.startsWith('127.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
      hostname === '[::1]'
    ) {
      throw new ValidationError('Instance URL cannot point to internal/private networks', {
        field: 'instanceUrl',
      });
    }
  } catch (_error) {
    throw new ValidationError('Instance URL is not a valid URL', { field: 'instanceUrl' });
  }
}

/**
 * Validate password strength
 */
export function validatePassword(password: string): void {
  if (!password) {
    throw new ValidationError('Password cannot be empty', { field: 'password' });
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new ValidationError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`, {
      field: 'password',
      minLength: PASSWORD_MIN_LENGTH,
    });
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new ValidationError(`Password must be less than ${PASSWORD_MAX_LENGTH} characters`, {
      field: 'password',
      maxLength: PASSWORD_MAX_LENGTH,
    });
  }
}

/**
 * Validate username
 */
export function validateUsername(username: string): void {
  if (!username) {
    throw new ValidationError('Username cannot be empty', { field: 'username' });
  }
  if (username.length < USERNAME_MIN_LENGTH) {
    throw new ValidationError(`Username must be at least ${USERNAME_MIN_LENGTH} characters`, {
      field: 'username',
      minLength: USERNAME_MIN_LENGTH,
    });
  }
  if (username.length > USERNAME_MAX_LENGTH) {
    throw new ValidationError(`Username must be less than ${USERNAME_MAX_LENGTH} characters`, {
      field: 'username',
      maxLength: USERNAME_MAX_LENGTH,
    });
  }
  // Allow only alphanumeric characters and underscores
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    throw new ValidationError('Username can only contain letters, numbers, and underscores', {
      field: 'username',
    });
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
  if (trimmedOtp.length < OTP_LENGTH_MIN) {
    throw new ValidationError(`OTP must be at least ${OTP_LENGTH_MIN} characters`, {
      field: 'otp',
      minLength: OTP_LENGTH_MIN,
    });
  }
  if (trimmedOtp.length > OTP_LENGTH_MAX) {
    throw new ValidationError(`OTP must be less than ${OTP_LENGTH_MAX} characters`, {
      field: 'otp',
      maxLength: OTP_LENGTH_MAX,
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
  if (trimmed.length > maxLength) {
    throw new ValidationError(`${fieldName} must be less than ${maxLength} characters`, {
      field: fieldName,
      maxLength,
    });
  }
  return sanitizeHTML(trimmed);
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
