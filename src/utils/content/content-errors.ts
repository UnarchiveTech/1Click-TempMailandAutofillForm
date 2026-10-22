/**
 * Lightweight error utilities for content scripts.
 *
 * This module exists to avoid pulling the full `errors.ts` (17+ KB with
 * ErrorCode enums, ERROR_CODE_TO_TRANSLATION_KEY map, BaseExtensionError
 * class, and 15+ subclasses) into the content-script bundle.
 *
 * Only `getErrorMessage` and `NoActiveAddressError` are needed by content
 * scripts. The full versions live in `errors.ts` for UI / background code.
 */

export class NoActiveAddressError extends Error {
  public readonly context?: Record<string, unknown>;

  constructor(context?: Record<string, unknown>) {
    super('No active temporary inbox selected');
    this.name = 'NoActiveAddressError';
    this.context = context;
  }
}

/**
 * Extract a human-readable message from an unknown caught value.
 * Mirrors the behavior of `errors.ts#getErrorMessage` but without
 * pulling in the entire errors module.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
