// Translation functions are lazily imported inside the functions below to
// avoid pulling `en.json` (139,001 bytes) into the content-script bundle via
// a static import. These functions are primarily used by the extension UI.
//
// This module is also part of the background graph (errors.ts is imported by
// the service worker), so it loads the minimal background locale module -
// importing the full-dictionary i18n-utils here would inline all 8 UI
// dictionaries into background.js. The generated background locale files
// include the errors.* keys (see scripts/generate-background-locales.ts).

/**
 * Centralized error types for the 1Click extension
 * Provides structured error handling across the application
 *
 * Error messages use human-readable English strings.
 * translationKey property contains the localization key (e.g., "errors.apiCallFailed")
 * Use getTranslatedErrorMessage() to get translated text for display in the UI.
 */

// Error codes for categorization
export enum ErrorCode {
  // API Errors
  API_CALL_FAILED = 'API_CALL_FAILED',
  API_TIMEOUT = 'API_TIMEOUT',
  API_INVALID_RESPONSE = 'API_INVALID_RESPONSE',

  // Inbox Errors
  INBOX_NOT_FOUND = 'INBOX_NOT_FOUND',
  INBOX_CREATION_FAILED = 'INBOX_CREATION_FAILED',
  INBOX_EXPIRED = 'INBOX_EXPIRED',
  INBOX_ALREADY_EXISTS = 'INBOX_ALREADY_EXISTS',
  INBOX_TOKEN_MISSING = 'INBOX_TOKEN_MISSING',
  INBOX_SESSION_CONFLICT = 'INBOX_SESSION_CONFLICT',

  // Provider Errors
  PROVIDER_NOT_FOUND = 'PROVIDER_NOT_FOUND',
  PROVIDER_UNSUPPORTED = 'PROVIDER_UNSUPPORTED',
  PROVIDER_INSTANCE_NOT_FOUND = 'PROVIDER_INSTANCE_NOT_FOUND',
  PROVIDER_INSTANCE_INVALID = 'PROVIDER_INSTANCE_INVALID',
  /**
   * Fetch-layer failures, split by WHY the request failed. They used to collapse
   * into API_CALL_FAILED, so the UI could only say "API call failed" for a 503, a
   * network drop, a blocked redirect and a rejected URL alike - the reason lived
   * in the English `message` no payload carries.
   */
  PROVIDER_UNREACHABLE = 'PROVIDER_UNREACHABLE',
  PROVIDER_HTTP_ERROR = 'PROVIDER_HTTP_ERROR',
  PROVIDER_REQUEST_REJECTED = 'PROVIDER_REQUEST_REJECTED',
  /** The redirect/URL safety gate refused the request (provider or WebDAV). */
  REDIRECT_BLOCKED = 'REDIRECT_BLOCKED',

  // Storage Errors
  STORAGE_READ_FAILED = 'STORAGE_READ_FAILED',
  STORAGE_WRITE_FAILED = 'STORAGE_WRITE_FAILED',
  STORAGE_CLEAR_FAILED = 'STORAGE_CLEAR_FAILED',

  // Encryption Errors
  ENCRYPTION_FAILED = 'ENCRYPTION_FAILED',
  DECRYPTION_FAILED = 'DECRYPTION_FAILED',
  KEY_ROTATION_FAILED = 'KEY_ROTATION_FAILED',
  KEY_INITIALIZATION_FAILED = 'KEY_INITIALIZATION_FAILED',

  // Backup Errors
  BACKUP_PASSWORD_TOO_SHORT = 'BACKUP_PASSWORD_TOO_SHORT',
  BACKUP_PASSWORD_REQUIRED = 'BACKUP_PASSWORD_REQUIRED',
  BACKUP_DECRYPTION_FAILED = 'BACKUP_DECRYPTION_FAILED',
  BACKUP_INVALID_ENCRYPTED_FILE = 'BACKUP_INVALID_ENCRYPTED_FILE',
  BACKUP_NO_CATEGORIES = 'BACKUP_NO_CATEGORIES',
  BACKUP_TOO_LARGE = 'BACKUP_TOO_LARGE',
  BACKUP_EMPTY = 'BACKUP_EMPTY',
  BACKUP_INVALID_JSON = 'BACKUP_INVALID_JSON',
  BACKUP_MISSING_FIELDS = 'BACKUP_MISSING_FIELDS',
  BACKUP_INTEGRITY_FAILED = 'BACKUP_INTEGRITY_FAILED',
  BACKUP_KEY_MISMATCH = 'BACKUP_KEY_MISMATCH',
  BACKUP_FILE_READ_FAILED = 'BACKUP_FILE_READ_FAILED',

  // WebDAV Errors
  WEBDAV_INVALID_FILENAME = 'WEBDAV_INVALID_FILENAME',

  // Form/Content Script Errors
  FORM_NOT_FOUND = 'FORM_NOT_FOUND',
  FORM_FILL_FAILED = 'FORM_FILL_FAILED',
  NO_ACTIVE_INBOX = 'NO_ACTIVE_INBOX',

  // Import/Export Errors
  IMPORT_FAILED = 'IMPORT_FAILED',
  EXPORT_FAILED = 'EXPORT_FAILED',
  INVALID_BACKUP_FORMAT = 'INVALID_BACKUP_FORMAT',

  // Network Errors
  NETWORK_ERROR = 'NETWORK_ERROR',
  NETWORK_OFFLINE = 'NETWORK_OFFLINE',

  // Validation Errors
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_URL = 'INVALID_URL',

  // General Errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
}

/**
 * Map error codes to translation keys
 */
export const ERROR_CODE_TO_TRANSLATION_KEY: Record<ErrorCode, string> = {
  [ErrorCode.API_CALL_FAILED]: 'errors.apiCallFailed',
  [ErrorCode.API_TIMEOUT]: 'errors.apiTimeout',
  [ErrorCode.API_INVALID_RESPONSE]: 'errors.apiInvalidResponse',
  [ErrorCode.INBOX_NOT_FOUND]: 'errors.addressNotFound',
  [ErrorCode.INBOX_CREATION_FAILED]: 'errors.addressCreationFailed',
  [ErrorCode.INBOX_EXPIRED]: 'errors.addressExpired',
  [ErrorCode.INBOX_ALREADY_EXISTS]: 'errors.addressAlreadyExists',
  [ErrorCode.INBOX_TOKEN_MISSING]: 'errors.addressTokenMissing',
  [ErrorCode.INBOX_SESSION_CONFLICT]: 'errors.addressSessionConflict',
  [ErrorCode.PROVIDER_NOT_FOUND]: 'errors.providerNotFound',
  [ErrorCode.PROVIDER_UNSUPPORTED]: 'errors.providerUnsupported',
  [ErrorCode.PROVIDER_INSTANCE_NOT_FOUND]: 'errors.providerInstanceNotFound',
  [ErrorCode.PROVIDER_INSTANCE_INVALID]: 'errors.providerInstanceInvalid',
  [ErrorCode.PROVIDER_UNREACHABLE]: 'errors.providerUnreachable',
  [ErrorCode.PROVIDER_HTTP_ERROR]: 'errors.providerHttpError',
  [ErrorCode.PROVIDER_REQUEST_REJECTED]: 'errors.providerRequestRejected',
  [ErrorCode.REDIRECT_BLOCKED]: 'errors.redirectBlocked',
  [ErrorCode.STORAGE_READ_FAILED]: 'errors.storageReadFailed',
  [ErrorCode.STORAGE_WRITE_FAILED]: 'errors.storageWriteFailed',
  [ErrorCode.STORAGE_CLEAR_FAILED]: 'errors.storageClearFailed',
  [ErrorCode.ENCRYPTION_FAILED]: 'errors.encryptionFailed',
  [ErrorCode.DECRYPTION_FAILED]: 'errors.decryptionFailed',
  [ErrorCode.KEY_ROTATION_FAILED]: 'errors.keyRotationFailed',
  [ErrorCode.KEY_INITIALIZATION_FAILED]: 'errors.keyInitializationFailed',
  [ErrorCode.BACKUP_PASSWORD_TOO_SHORT]: 'errors.backupPasswordTooShort',
  [ErrorCode.BACKUP_PASSWORD_REQUIRED]: 'errors.backupPasswordRequired',
  [ErrorCode.BACKUP_DECRYPTION_FAILED]: 'errors.backupDecryptionFailed',
  [ErrorCode.BACKUP_INVALID_ENCRYPTED_FILE]: 'errors.backupInvalidEncryptedFile',
  [ErrorCode.BACKUP_NO_CATEGORIES]: 'errors.backupNoCategories',
  [ErrorCode.BACKUP_TOO_LARGE]: 'errors.backupTooLarge',
  [ErrorCode.BACKUP_EMPTY]: 'errors.backupEmpty',
  [ErrorCode.BACKUP_INVALID_JSON]: 'errors.backupInvalidJson',
  [ErrorCode.BACKUP_MISSING_FIELDS]: 'errors.backupMissingFields',
  [ErrorCode.BACKUP_INTEGRITY_FAILED]: 'errors.backupIntegrityFailed',
  [ErrorCode.BACKUP_KEY_MISMATCH]: 'errors.backupKeyMismatch',
  [ErrorCode.BACKUP_FILE_READ_FAILED]: 'errors.backupFileReadFailed',
  [ErrorCode.WEBDAV_INVALID_FILENAME]: 'errors.webdavInvalidFilename',
  [ErrorCode.FORM_NOT_FOUND]: 'errors.formNotFound',
  [ErrorCode.FORM_FILL_FAILED]: 'errors.formFillFailed',
  [ErrorCode.NO_ACTIVE_INBOX]: 'errors.noActiveAddress',
  [ErrorCode.IMPORT_FAILED]: 'errors.importFailed',
  [ErrorCode.EXPORT_FAILED]: 'errors.exportFailed',
  [ErrorCode.INVALID_BACKUP_FORMAT]: 'errors.invalidBackupFormat',
  [ErrorCode.NETWORK_ERROR]: 'errors.networkErrorGeneric',
  [ErrorCode.NETWORK_OFFLINE]: 'errors.networkOffline',
  [ErrorCode.VALIDATION_ERROR]: 'errors.validationError',
  [ErrorCode.INVALID_URL]: 'errors.invalidUrl',
  [ErrorCode.UNKNOWN_ERROR]: 'errors.unknownError',
  [ErrorCode.PERMISSION_DENIED]: 'errors.permissionDenied',
};

/**
 * Get translation key for an error code
 */
export function getTranslationKeyForError(code: ErrorCode): string {
  return ERROR_CODE_TO_TRANSLATION_KEY[code] || 'errors.unknownError';
}

// Error severity levels
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

// Base error class
export class BaseExtensionError extends Error {
  public readonly code: ErrorCode;
  public readonly severity: ErrorSeverity;
  public readonly context?: Record<string, unknown>;
  public readonly timestamp: number;
  public readonly originalError?: Error;
  public readonly translationKey: string;
  /**
   * Values for the `{slot}`s in `translationKey` - the same pairing
   * `LocalizedMessage` enforces for result payloads, carried on the error so a
   * catch site can hand both to the UI without re-deriving them from `context`.
   */
  public readonly translationValues?: Record<string, string | number>;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.UNKNOWN_ERROR,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    context?: Record<string, unknown>,
    originalError?: Error,
    translationKey?: string,
    translationValues?: Record<string, string | number>
  ) {
    // If message is a translation key, use it as translationKey too
    const resolvedKey =
      translationKey ||
      (message.startsWith('errors.')
        ? message
        : ERROR_CODE_TO_TRANSLATION_KEY[code] || 'errors.unknownError');
    // If message is a translation key, provide a fallback English string for message
    const resolvedMessage = message.startsWith('errors.')
      ? message.split('.').pop() || message
      : message;

    super(resolvedMessage);
    this.name = this.constructor.name;
    this.code = code;
    this.severity = severity;
    this.context = context;
    this.timestamp = Date.now();
    this.originalError = originalError;
    this.translationKey = resolvedKey;
    this.translationValues = translationValues;

    // Maintains proper stack trace (Node.js only, not available in browser)
    const ErrorWithStackTrace = Error as {
      // Node.js Error.captureStackTrace is not in TypeScript DOM types; the
      // ctor argument is only forwarded to V8, so a narrow type is unnecessary.
      captureStackTrace?: (target: Error, ctor?: unknown) => void;
    };
    ErrorWithStackTrace.captureStackTrace?.(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      severity: this.severity,
      context: this.context,
      timestamp: this.timestamp,
      originalError: this.originalError?.message,
      translationKey: this.translationKey,
      translationValues: this.translationValues,
      stack: this.stack,
    };
  }
}

// API-specific errors
export class ApiError extends BaseExtensionError {
  constructor(message: string, context?: Record<string, unknown>, originalError?: Error) {
    super(message, ErrorCode.API_CALL_FAILED, ErrorSeverity.HIGH, context, originalError);
  }
}

export class ApiTimeoutError extends BaseExtensionError {
  constructor(context?: Record<string, unknown>) {
    super(
      'API request timed out',
      ErrorCode.API_TIMEOUT,
      ErrorSeverity.MEDIUM,
      context,
      undefined,
      'errors.apiTimeout'
    );
  }
}

export class ApiInvalidResponseError extends BaseExtensionError {
  constructor(context?: Record<string, unknown>, originalError?: Error) {
    super(
      'Invalid API response received',
      ErrorCode.API_INVALID_RESPONSE,
      ErrorSeverity.HIGH,
      context,
      originalError,
      'errors.apiInvalidResponse'
    );
  }
}

// Inbox-specific errors
export class AddressNotFoundError extends BaseExtensionError {
  constructor(addressId: string, context?: Record<string, unknown>) {
    super(
      'Inbox not found',
      ErrorCode.INBOX_NOT_FOUND,
      ErrorSeverity.MEDIUM,
      {
        addressId,
        ...context,
      },
      undefined,
      'errors.addressNotFound'
    );
  }
}

export class AddressCreationError extends BaseExtensionError {
  constructor(provider: string, context?: Record<string, unknown>, originalError?: Error) {
    super(
      'Failed to create inbox',
      ErrorCode.INBOX_CREATION_FAILED,
      ErrorSeverity.HIGH,
      { provider, ...context },
      originalError,
      'errors.addressCreationFailed'
    );
  }
}

export class AddressExpiredError extends BaseExtensionError {
  constructor(addressId: string, context?: Record<string, unknown>) {
    super(
      'Inbox has expired',
      ErrorCode.INBOX_EXPIRED,
      ErrorSeverity.LOW,
      {
        addressId,
        ...context,
      },
      undefined,
      'errors.addressExpired'
    );
  }
}

export class AddressAlreadyExistsError extends BaseExtensionError {
  constructor(address: string, context?: Record<string, unknown>) {
    super(
      'Inbox address already exists',
      ErrorCode.INBOX_ALREADY_EXISTS,
      ErrorSeverity.MEDIUM,
      {
        address,
        ...context,
      },
      undefined,
      'errors.addressAlreadyExists'
    );
  }
}

export class AddressSessionConflictError extends BaseExtensionError {
  constructor(context?: Record<string, unknown>, originalError?: Error) {
    super(
      'Session conflict detected',
      ErrorCode.INBOX_SESSION_CONFLICT,
      ErrorSeverity.HIGH,
      context,
      originalError,
      'errors.addressSessionConflict'
    );
  }
}

// Provider-specific errors
/**
 * The request never reached a provider response: DNS/connection failure, a
 * dropped network, an aborted request. The original (English) throwable rides
 * along as `originalError` for the log; the payload carries the key.
 */
export class ProviderUnreachableError extends BaseExtensionError {
  constructor(context?: Record<string, unknown>, originalError?: Error) {
    super(
      'Mail provider could not be reached',
      ErrorCode.PROVIDER_UNREACHABLE,
      ErrorSeverity.MEDIUM,
      context,
      originalError,
      'errors.providerUnreachable'
    );
  }
}

/**
 * The provider answered with a non-2xx status. `status` travels as a slot value
 * (the UI renders `errors.providerHttpError` with it) AND stays in `context`,
 * where the retry policy reads it to decide whether a retry is allowed.
 */
export class ProviderHttpError extends BaseExtensionError {
  constructor(
    status: number,
    statusText: string,
    context?: Record<string, unknown>,
    originalError?: Error
  ) {
    super(
      `Provider responded with HTTP ${status}${statusText ? ` ${statusText}` : ''}`,
      ErrorCode.PROVIDER_HTTP_ERROR,
      ErrorSeverity.HIGH,
      { status, ...context },
      originalError,
      'errors.providerHttpError',
      { status }
    );
  }
}

/**
 * The provider's own API reported a failure (its `errorPath` fired). The
 * provider's text is dynamic, unattributable English - it is kept in `context`
 * for the log rather than interpolated into a localized sentence.
 */
export class ProviderRequestRejectedError extends BaseExtensionError {
  constructor(detail: string, context?: Record<string, unknown>) {
    super(
      detail || 'Mail provider rejected the request',
      ErrorCode.PROVIDER_REQUEST_REJECTED,
      ErrorSeverity.MEDIUM,
      { detail, ...context },
      undefined,
      'errors.providerRequestRejected'
    );
  }
}

/**
 * The redirect/URL safety gate refused a request (an opaque manual redirect, a
 * hop to a private/link-local host, an HTTPS→HTTP downgrade, a streamed body
 * that cannot be replayed). Fail-closed by design, and deliberately NEUTRAL so
 * both the mail providers and WebDAV report the same stable key.
 */
export class RedirectBlockedError extends BaseExtensionError {
  constructor(detail: string, context?: Record<string, unknown>) {
    super(
      detail || 'Blocked an unsafe redirect',
      ErrorCode.REDIRECT_BLOCKED,
      ErrorSeverity.MEDIUM,
      { detail: detail || undefined, ...context },
      undefined,
      'errors.redirectBlocked'
    );
  }
}

export class ProviderNotFoundError extends BaseExtensionError {
  constructor(provider: string, context?: Record<string, unknown>) {
    super(
      'Mail provider not found',
      ErrorCode.PROVIDER_NOT_FOUND,
      ErrorSeverity.MEDIUM,
      {
        provider,
        ...context,
      },
      undefined,
      'errors.providerNotFound'
    );
  }
}

export class ProviderUnsupportedError extends BaseExtensionError {
  constructor(provider: string, context?: Record<string, unknown>) {
    super(
      'Mail provider is unsupported',
      ErrorCode.PROVIDER_UNSUPPORTED,
      ErrorSeverity.MEDIUM,
      {
        provider,
        ...context,
      },
      undefined,
      'errors.providerUnsupported'
    );
  }
}

export class ProviderInstanceNotFoundError extends BaseExtensionError {
  constructor(instanceId: string, context?: Record<string, unknown>) {
    super(
      'Provider instance not found',
      ErrorCode.PROVIDER_INSTANCE_NOT_FOUND,
      ErrorSeverity.MEDIUM,
      { instanceId, ...context },
      undefined,
      'errors.providerInstanceNotFound'
    );
  }
}

// Storage-specific errors
export class StorageReadError extends BaseExtensionError {
  constructor(key: string, context?: Record<string, unknown>, originalError?: Error) {
    super(
      'Failed to read from local storage',
      ErrorCode.STORAGE_READ_FAILED,
      ErrorSeverity.HIGH,
      { key, ...context },
      originalError,
      'errors.storageReadFailed'
    );
  }
}

export class StorageWriteError extends BaseExtensionError {
  constructor(key: string, context?: Record<string, unknown>, originalError?: Error) {
    super(
      'Failed to write to local storage',
      ErrorCode.STORAGE_WRITE_FAILED,
      ErrorSeverity.HIGH,
      { key, ...context },
      originalError,
      'errors.storageWriteFailed'
    );
  }
}

// Encryption-specific errors
export class EncryptionError extends BaseExtensionError {
  constructor(context?: Record<string, unknown>, originalError?: Error) {
    super(
      'Encryption failed',
      ErrorCode.ENCRYPTION_FAILED,
      ErrorSeverity.CRITICAL,
      context,
      originalError,
      'errors.encryptionFailed'
    );
  }
}

export class DecryptionError extends BaseExtensionError {
  constructor(context?: Record<string, unknown>, originalError?: Error) {
    super(
      'Decryption failed',
      ErrorCode.DECRYPTION_FAILED,
      ErrorSeverity.CRITICAL,
      context,
      originalError,
      'errors.decryptionFailed'
    );
  }
}

export class KeyRotationError extends BaseExtensionError {
  constructor(context?: Record<string, unknown>, originalError?: Error) {
    super(
      'Encryption key rotation failed',
      ErrorCode.KEY_ROTATION_FAILED,
      ErrorSeverity.CRITICAL,
      context,
      originalError,
      'errors.keyRotationFailed'
    );
  }
}

// Form/Content Script errors
export class FormNotFoundError extends BaseExtensionError {
  constructor(context?: Record<string, unknown>) {
    super(
      'Signup form not found',
      ErrorCode.FORM_NOT_FOUND,
      ErrorSeverity.LOW,
      context,
      undefined,
      'errors.formNotFound'
    );
  }
}

export class FormFillError extends BaseExtensionError {
  constructor(context?: Record<string, unknown>, originalError?: Error) {
    super(
      'Failed to fill form fields',
      ErrorCode.FORM_FILL_FAILED,
      ErrorSeverity.MEDIUM,
      context,
      originalError,
      'errors.formFillFailed'
    );
  }
}

export class NoActiveAddressError extends BaseExtensionError {
  constructor(context?: Record<string, unknown>) {
    super(
      'No active temporary inbox selected',
      ErrorCode.NO_ACTIVE_INBOX,
      ErrorSeverity.MEDIUM,
      context,
      undefined,
      'errors.noActiveAddress'
    );
  }
}

// Import/Export errors
export class ImportError extends BaseExtensionError {
  constructor(message: string, context?: Record<string, unknown>, originalError?: Error) {
    super(message, ErrorCode.IMPORT_FAILED, ErrorSeverity.MEDIUM, context, originalError);
  }
}

export class ExportError extends BaseExtensionError {
  constructor(message: string, context?: Record<string, unknown>, originalError?: Error) {
    super(message, ErrorCode.EXPORT_FAILED, ErrorSeverity.MEDIUM, context, originalError);
  }
}

export class InvalidBackupFormatError extends BaseExtensionError {
  constructor(context?: Record<string, unknown>) {
    super(
      'Invalid backup configuration format',
      ErrorCode.INVALID_BACKUP_FORMAT,
      ErrorSeverity.MEDIUM,
      context,
      undefined,
      'errors.invalidBackupFormat'
    );
  }
}

// Validation errors
export class ValidationError extends BaseExtensionError {
  /**
   * `translationKey` (+ the `translationValues` its `{slot}`s need) lets a
   * validation failure keep a descriptive English `message` for the log while
   * still rendering localized copy in the UI (see
   * `localizedErrorMessageOrFallback`) and resolving to a stable `errors.*` key
   * in a response payload (see `toResultErrorKey`). Without a key the error
   * maps to `errors.validationError` through the code map.
   *
   * The pair is supplied together on purpose: a key like
   * `errors.validationTextTooLong` renders a literal `{field}`/`{max}` without
   * its values, so the constructor mirrors `localizedMessage()`'s pairing.
   */
  constructor(
    message: string,
    context?: Record<string, unknown>,
    translationKey?: string,
    translationValues?: Record<string, string | number>
  ) {
    super(
      message,
      ErrorCode.VALIDATION_ERROR,
      ErrorSeverity.LOW,
      context,
      undefined,
      translationKey,
      translationValues
    );
  }
}

/**
 * The error for a URL-gate refusal.
 *
 * The gate already reports a stable key as its reason (`errors.webdavHttpsOnly`,
 * `errors.webdavPrivateNetwork`, `errors.networkErrorGeneric`, …), so a
 * key-shaped reason becomes the error's own `translationKey` - the specific
 * reason survives instead of collapsing into one generic "invalid URL". A
 * free-text reason (a caller's own validator) keeps the diagnostics in the
 * message and lands on `errors.invalidUrl`.
 */
export function urlGateError(
  url: string,
  reason: string | undefined,
  context?: Record<string, unknown>
): BaseExtensionError {
  const detail = reason || 'URL failed the safety check';
  const keyShaped = detail.startsWith('errors.');
  return new BaseExtensionError(
    `URL blocked by the safety gate: ${detail}`,
    ErrorCode.INVALID_URL,
    ErrorSeverity.MEDIUM,
    { url, reason: detail, ...context },
    undefined,
    keyShaped ? detail : 'errors.invalidUrl'
  );
}

export class InvalidUrlError extends BaseExtensionError {
  constructor(url: string, context?: Record<string, unknown>) {
    super(
      'Invalid URL provided',
      ErrorCode.INVALID_URL,
      ErrorSeverity.LOW,
      { url, ...context },
      undefined,
      'errors.invalidUrl'
    );
  }
}

// Helper function to wrap unknown errors
export function wrapError(error: unknown, context?: Record<string, unknown>): BaseExtensionError {
  if (error instanceof BaseExtensionError) {
    return error;
  }

  if (error instanceof Error) {
    return new BaseExtensionError(
      error.message,
      ErrorCode.UNKNOWN_ERROR,
      ErrorSeverity.MEDIUM,
      context,
      error
    );
  }

  return new BaseExtensionError(
    String(error),
    ErrorCode.UNKNOWN_ERROR,
    ErrorSeverity.MEDIUM,
    context
  );
}

// Helper function to determine if error is recoverable
export function isRecoverableError(error: BaseExtensionError): boolean {
  const recoverableCodes = [
    ErrorCode.API_TIMEOUT,
    ErrorCode.NETWORK_ERROR,
    ErrorCode.FORM_NOT_FOUND,
    ErrorCode.INBOX_EXPIRED,
  ];

  return recoverableCodes.includes(error.code) || error.severity === ErrorSeverity.LOW;
}

// Standardized error handling for async operations
export async function handleAsyncError<T>(
  operation: () => Promise<T>,
  context: string,
  options?: {
    throwOnError?: boolean;
    defaultValue?: T;
  }
): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    const wrappedError = wrapError(error, { context });

    if (options?.throwOnError) {
      throw wrappedError;
    }

    if (options?.defaultValue !== undefined) {
      return options.defaultValue;
    }

    throw wrappedError;
  }
}

// Standardized error message extraction
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Get translated error message for display
 * In Svelte components, use the translation key with t()
 * In non-Svelte contexts, use getTranslatedErrorMessage()
 */
export async function getTranslatedErrorMessage(error: unknown): Promise<string> {
  if (error instanceof BaseExtensionError) {
    if (error.translationKey?.startsWith('errors.')) {
      const { t } = await import('./i18n/i18n-background.js');
      const translated = await t(error.translationKey, error.translationValues);
      if (!UNRESOLVED_SLOT_RE.test(translated)) return translated;
      return await t('errors.unknownError');
    }
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

/**
 * `t` is the component's `$t` store formatter (svelte-i18n shape: options
 * object with `values`).
 */
type UiTranslate = (key: string, options?: { values?: Record<string, string | number> }) => string;

/**
 * Render an error for a user-visible message without ever letting raw
 * (untranslated) error prose reach the UI. `BaseExtensionError` instances carry
 * a translationKey resolved through the error-code map; anything else - a
 * `fetch`/storage `Error`, a `SyntaxError`, a DOMException - has no keyable
 * message, so the caller's localized fallback is shown and the raw detail is
 * left to the log.
 *
 * This is the ONLY helper for rendering a caught value to the user. There is
 * deliberately no variant that falls back to `error.message`: an arbitrary
 * message is English (or a server's own wording) in all eight locales, and a
 * helper that returns it silently wins over the caller's localized copy -
 * precisely the bug the feature error paths kept re-introducing. Log the raw
 * value at the catch site, then render through here.
 *
 * `fallbackKey` must be a locale key that renders standalone (e.g.
 * `errors.unknownError` or a feature-specific "… failed" sentence). It is also
 * the belt for a slot-bearing key whose `translationValues` did not survive a
 * boundary: a rendered `{slot}` is never shown, the caller's copy is.
 */
export function localizedErrorMessageOrFallback(
  error: unknown,
  t: UiTranslate,
  fallbackKey: string
): string {
  if (error instanceof BaseExtensionError && error.translationKey?.startsWith('errors.')) {
    // `translationValues` travels WITH the key (the same pairing
    // `LocalizedMessage` enforces). Rendering the key without them would put a
    // literal `{min}`/`{field}` on screen, so they are passed together and a
    // still-unresolved slot falls back instead of leaking.
    const rendered = error.translationValues
      ? t(error.translationKey, { values: error.translationValues })
      : t(error.translationKey);
    if (!UNRESOLVED_SLOT_RE.test(rendered)) return rendered;
  }
  return t(fallbackKey);
}

/**
 * Resolve a caught error into a stable `errors.*` locale key for a result
 * payload (`{ success: false, error }`) crossing a module or messaging
 * boundary. Such payloads are rendered by the receiving UI - or injected into
 * a host page by a content script - so they must never carry raw English
 * prose: a `BaseExtensionError` already carries a mapped key, while anything
 * else (a `fetch`/storage `Error`, a `SyntaxError`, a `DOMException`) has no
 * keyable message and collapses to the caller's generic key.
 *
 * The raw thrown value belongs in the log, not in the payload - log it at the
 * throw/catch site (see `errorPayload()` in the background message handler),
 * then pair this with `renderResultError()` on the consuming side.
 */
export function toResultErrorKey(
  error: unknown,
  fallbackKey: string = 'errors.unknownError'
): string {
  if (error instanceof BaseExtensionError && error.translationKey?.startsWith('errors.')) {
    return error.translationKey;
  }
  return fallbackKey;
}

/**
 * Render a result payload's `error` field for display: a stable `errors.*` key
 * is translated, anything else - an absent payload, or legacy raw prose from a
 * producer that has not migrated yet - resolves to the caller's localized
 * fallback instead of being shown verbatim. Use this (not
 * `translateResultMessage`) on every path where a background payload reaches
 * the UI, so no English can win by ordering.
 *
 * `errors.unknownError` is treated as "no specific reason" - it is the generic
 * code a background catch block produces for an unexpected throwable, and the
 * caller's `fallbackKey` is context-specific ("Failed to delete address") and
 * strictly more informative than "Unknown error", so the fallback wins.
 *
 * `t` is the flat-vars form (`t` / `tSync` from `@/utils/i18n/i18n-utils.js`),
 * as opposed to the svelte-i18n store form accepted by
 * `translateResultMessage()`.
 */
export function renderResultError(
  message: string | undefined,
  t: (key: string, vars?: Record<string, string | number>) => string,
  fallbackKey: string
): string {
  if (!message?.startsWith('errors.') || message === 'errors.unknownError') {
    return t(fallbackKey);
  }
  const rendered = t(message);
  // A bare-string payload cannot carry the values a `{slot}` key needs - they are
  // lost when only the key crosses the messaging boundary - so a leftover slot
  // means those values never made it. Show the caller's own context-specific copy
  // rather than "… (status {status})" at the user. A typed producer pairs the key
  // with its values (`localizedMessage`/`toResultError` + `translateResultMessage`)
  // and renders them properly.
  return UNRESOLVED_SLOT_RE.test(rendered) ? t(fallbackKey) : rendered;
}

/**
 * A `{slot}` still present in a rendered locale value - i.e. the key declared an
 * interpolation the caller never supplied.
 */
const UNRESOLVED_SLOT_RE = /\{[A-Za-z_][A-Za-z0-9_]*\}/;

/**
 * `errors.*` keys whose `en.json` value declares a `{slot}`. Typed as a tuple
 * so the *type* and the *runtime list* can never drift apart, and asserted
 * against `en.json` in tests/unit/utils/translate-result-message.test.ts - add
 * a slot-bearing key to `en.json` and that test fails until it is listed here,
 * at which point `localizedMessage()` makes its values mandatory.
 */
export const SLOT_BEARING_ERROR_KEYS = [
  'errors.providerHttpError',
  'errors.webdavServerStatus',
  'errors.webdavUploadStatus',
  'errors.webdavDownloadStatus',
  'errors.validationUsernameMinLength',
  'errors.validationUsernameMaxLength',
  'errors.validationTextTooLong',
  'errors.providerConfigDuplicateId',
  'errors.providerConfigFieldMissing',
  'errors.providerConfigFieldString',
  'errors.providerConfigFieldBoolean',
  'errors.providerConfigFieldObject',
  'errors.providerConfigFieldNonNegativeNumber',
  'errors.providerConfigFieldPositiveNumber',
  'errors.providerConfigFieldNonEmptyString',
  'errors.providerConfigFieldArray',
  'errors.providerConfigFieldArrayOfStrings',
  'errors.providerConfigFieldArrayOfNumbers',
  'errors.providerConfigFieldOneOf',
  'errors.providerConfigAuthFieldRequired',
  'errors.providerConfigDuplicateInstanceId',
  'errors.providerConfigOperationFunctionUnsafe',
] as const;

export type SlotBearingErrorKey = (typeof SLOT_BEARING_ERROR_KEYS)[number];

/**
 * A user-facing message produced by a feature or background module: the locale
 * key **together with** the values its `{slot}`s need, as **one value**.
 *
 * This is what makes a dropped interpolation impossible rather than merely
 * checked: there is no separate `params` argument left to forget, because a
 * consumer renders the whole value and the values travel inside it. A
 * slot-bearing key cannot even be constructed without them - the compiler
 * rejects `localizedMessage('errors.webdavUploadStatus')`.
 */
export interface LocalizedMessage {
  /** A stable `errors.*` locale key, or raw pass-through diagnostic text. */
  readonly key: string;
  /** Values for the key's `{slot}`s. They travel with the key, by construction. */
  readonly values?: Record<string, string | number>;
}

/**
 * Pair a locale key with the values its `{slot}`s need.
 *
 * `values` is required - and enforced - for the keys in
 * `SLOT_BEARING_ERROR_KEYS`; every other key (and raw pass-through text) may
 * omit it. Keys without a slot can still carry values harmlessly.
 */
export function localizedMessage<K extends string>(
  key: K,
  ...values: K extends SlotBearingErrorKey
    ? [values: Record<string, string | number>]
    : [values?: Record<string, string | number>]
): LocalizedMessage {
  return { key, values: values[0] };
}

/**
 * Resolve a caught error into the typed message a result payload carries: a
 * `BaseExtensionError` contributes its `translationKey` and the
 * `translationValues` that go with it, anything else collapses to the caller's
 * generic key (it has no keyable message). The raw thrown value belongs in the
 * log, not in the payload.
 */
export function toResultError(
  error: unknown,
  fallbackKey: string = 'errors.unknownError'
): LocalizedMessage {
  if (error instanceof BaseExtensionError && error.translationKey?.startsWith('errors.')) {
    return localizedMessage(error.translationKey, error.translationValues);
  }
  return localizedMessage(fallbackKey);
}

/**
 * Translate a result-object message/error field. Feature modules return a
 * `LocalizedMessage` - an `errors.*` locale key paired with its slot values - so
 * the UI layer owns the human language and cannot render a key without the
 * values that belong to it. A bare string is still accepted for payloads that
 * cross the messaging boundary, where only the key survives serialization, and
 * anything that is not a known `errors.*` key is shown as-is (dynamic text like
 * "Status 503" from a server).
 *
 * A translated `errors.*` value that still contains a `{slot}` resolves to `''`
 * instead of being shown: that state means the values never made it, and
 * printing "Server returned status {status}" at the user is worse than the
 * caller's own `|| $t('…failed')` copy. `localizedMessage()` makes that state
 * unrepresentable for a typed producer, so this guard only ever catches a bare
 * key arriving from outside the type system. Only key-rendered text is
 * inspected; pass-through diagnostics keep their braces.
 */
export function translateResultMessage(
  message: string | LocalizedMessage | undefined,
  t: UiTranslate
): string {
  if (message == null) return '';
  const { key, values } =
    typeof message === 'string' ? { key: message, values: undefined } : message;
  if (!key) return '';
  if (!key.startsWith('errors.')) return key;
  const rendered = t(key, values ? { values } : undefined);
  return UNRESOLVED_SLOT_RE.test(rendered) ? '' : rendered;
}

// Standardized error logging helper
export function logAndWrapError(
  context: string,
  error: unknown,
  logger: { error: (message: string, error?: Error) => void }
): BaseExtensionError {
  const wrappedError = wrapError(error, { context });
  logger.error(context, wrappedError instanceof Error ? wrappedError : undefined);
  return wrappedError;
}
