/**
 * Centralized error types for the 1Click extension
 * Provides structured error handling across the application
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

  // Storage Errors
  STORAGE_READ_FAILED = 'STORAGE_READ_FAILED',
  STORAGE_WRITE_FAILED = 'STORAGE_WRITE_FAILED',
  STORAGE_CLEAR_FAILED = 'STORAGE_CLEAR_FAILED',

  // Encryption Errors
  ENCRYPTION_FAILED = 'ENCRYPTION_FAILED',
  DECRYPTION_FAILED = 'DECRYPTION_FAILED',
  KEY_ROTATION_FAILED = 'KEY_ROTATION_FAILED',
  KEY_INITIALIZATION_FAILED = 'KEY_INITIALIZATION_FAILED',

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

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.UNKNOWN_ERROR,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    context?: Record<string, unknown>,
    originalError?: Error
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.severity = severity;
    this.context = context;
    this.timestamp = Date.now();
    this.originalError = originalError;

    // Maintains proper stack trace (Node.js only, not available in browser)
    // Type-safe access to optional Node.js captureStackTrace method
    const ErrorWithStackTrace = Error as {
      // biome-ignore lint/complexity/noBannedTypes: Node.js Error.captureStackTrace is not in TypeScript DOM types
      captureStackTrace?: (target: Error, ctor: Function) => void;
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
    super('API request timed out', ErrorCode.API_TIMEOUT, ErrorSeverity.MEDIUM, context);
  }
}

export class ApiInvalidResponseError extends BaseExtensionError {
  constructor(context?: Record<string, unknown>, originalError?: Error) {
    super(
      'Invalid API response',
      ErrorCode.API_INVALID_RESPONSE,
      ErrorSeverity.HIGH,
      context,
      originalError
    );
  }
}

// Inbox-specific errors
export class InboxNotFoundError extends BaseExtensionError {
  constructor(inboxId: string, context?: Record<string, unknown>) {
    super(`Inbox not found: ${inboxId}`, ErrorCode.INBOX_NOT_FOUND, ErrorSeverity.MEDIUM, {
      inboxId,
      ...context,
    });
  }
}

export class InboxCreationError extends BaseExtensionError {
  constructor(provider: string, context?: Record<string, unknown>, originalError?: Error) {
    super(
      `Failed to create inbox for provider: ${provider}`,
      ErrorCode.INBOX_CREATION_FAILED,
      ErrorSeverity.HIGH,
      { provider, ...context },
      originalError
    );
  }
}

export class InboxExpiredError extends BaseExtensionError {
  constructor(inboxId: string, context?: Record<string, unknown>) {
    super(`Inbox has expired: ${inboxId}`, ErrorCode.INBOX_EXPIRED, ErrorSeverity.LOW, {
      inboxId,
      ...context,
    });
  }
}

export class InboxAlreadyExistsError extends BaseExtensionError {
  constructor(address: string, context?: Record<string, unknown>) {
    super(
      `Inbox with this address already exists: ${address}`,
      ErrorCode.INBOX_ALREADY_EXISTS,
      ErrorSeverity.MEDIUM,
      { address, ...context }
    );
  }
}

export class InboxSessionConflictError extends BaseExtensionError {
  constructor(context?: Record<string, unknown>, originalError?: Error) {
    super(
      'Email session conflict - unable to create unique inbox',
      ErrorCode.INBOX_SESSION_CONFLICT,
      ErrorSeverity.HIGH,
      context,
      originalError
    );
  }
}

// Provider-specific errors
export class ProviderNotFoundError extends BaseExtensionError {
  constructor(provider: string, context?: Record<string, unknown>) {
    super(`Provider not found: ${provider}`, ErrorCode.PROVIDER_NOT_FOUND, ErrorSeverity.MEDIUM, {
      provider,
      ...context,
    });
  }
}

export class ProviderUnsupportedError extends BaseExtensionError {
  constructor(provider: string, context?: Record<string, unknown>) {
    super(
      `Unsupported provider: ${provider}`,
      ErrorCode.PROVIDER_UNSUPPORTED,
      ErrorSeverity.MEDIUM,
      { provider, ...context }
    );
  }
}

export class ProviderInstanceNotFoundError extends BaseExtensionError {
  constructor(instanceId: string, context?: Record<string, unknown>) {
    super(
      `Provider instance not found: ${instanceId}`,
      ErrorCode.PROVIDER_INSTANCE_NOT_FOUND,
      ErrorSeverity.MEDIUM,
      { instanceId, ...context }
    );
  }
}

// Storage-specific errors
export class StorageReadError extends BaseExtensionError {
  constructor(key: string, context?: Record<string, unknown>, originalError?: Error) {
    super(
      `Failed to read from storage: ${key}`,
      ErrorCode.STORAGE_READ_FAILED,
      ErrorSeverity.HIGH,
      { key, ...context },
      originalError
    );
  }
}

export class StorageWriteError extends BaseExtensionError {
  constructor(key: string, context?: Record<string, unknown>, originalError?: Error) {
    super(
      `Failed to write to storage: ${key}`,
      ErrorCode.STORAGE_WRITE_FAILED,
      ErrorSeverity.HIGH,
      { key, ...context },
      originalError
    );
  }
}

// Encryption-specific errors
export class EncryptionError extends BaseExtensionError {
  constructor(context?: Record<string, unknown>, originalError?: Error) {
    super(
      'Failed to encrypt data',
      ErrorCode.ENCRYPTION_FAILED,
      ErrorSeverity.CRITICAL,
      context,
      originalError
    );
  }
}

export class DecryptionError extends BaseExtensionError {
  constructor(context?: Record<string, unknown>, originalError?: Error) {
    super(
      'Failed to decrypt data',
      ErrorCode.DECRYPTION_FAILED,
      ErrorSeverity.CRITICAL,
      context,
      originalError
    );
  }
}

export class KeyRotationError extends BaseExtensionError {
  constructor(context?: Record<string, unknown>, originalError?: Error) {
    super(
      'Failed to rotate encryption key',
      ErrorCode.KEY_ROTATION_FAILED,
      ErrorSeverity.CRITICAL,
      context,
      originalError
    );
  }
}

// Form/Content Script errors
export class FormNotFoundError extends BaseExtensionError {
  constructor(context?: Record<string, unknown>) {
    super(
      'No signup form found on this page',
      ErrorCode.FORM_NOT_FOUND,
      ErrorSeverity.LOW,
      context
    );
  }
}

export class FormFillError extends BaseExtensionError {
  constructor(context?: Record<string, unknown>, originalError?: Error) {
    super(
      'Failed to fill form',
      ErrorCode.FORM_FILL_FAILED,
      ErrorSeverity.MEDIUM,
      context,
      originalError
    );
  }
}

export class NoActiveInboxError extends BaseExtensionError {
  constructor(context?: Record<string, unknown>) {
    super('No active inbox found', ErrorCode.NO_ACTIVE_INBOX, ErrorSeverity.MEDIUM, context);
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
      'Invalid backup file format',
      ErrorCode.INVALID_BACKUP_FORMAT,
      ErrorSeverity.MEDIUM,
      context
    );
  }
}

// Validation errors
export class ValidationError extends BaseExtensionError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, ErrorCode.VALIDATION_ERROR, ErrorSeverity.LOW, context);
  }
}

export class InvalidUrlError extends BaseExtensionError {
  constructor(url: string, context?: Record<string, unknown>) {
    super(`Invalid URL: ${url}`, ErrorCode.INVALID_URL, ErrorSeverity.LOW, { url, ...context });
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
