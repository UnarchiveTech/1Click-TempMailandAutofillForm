/**
 * Structured logging framework with log levels
 * Supports debug, info, warn, and error levels
 */

import { browser } from 'wxt/browser';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

interface LogEntry {
  level: LogLevel;
  timestamp: string;
  message: string;
  context?: Record<string, unknown>;
  error?: Error;
}

type LogContext = Record<string, unknown>;

let isLoggingEnabled = false;
let currentLogLevel: LogLevel = LogLevel.INFO;

/**
 * Initialize the logger by checking developer settings
 */
export async function initLogger(): Promise<void> {
  try {
    const result = await browser.storage.local.get(['developerSettings']);
    const developerSettings = result.developerSettings as
      | { enableLogging?: boolean; logLevel?: string }
      | undefined;
    isLoggingEnabled = developerSettings?.enableLogging || false;

    const logLevelStr = developerSettings?.logLevel || 'info';
    currentLogLevel = parseLogLevel(logLevelStr);
  } catch (error) {
    console.error('[Logger] Failed to initialize:', error);
    isLoggingEnabled = false;
  }
}

/**
 * Update logging state
 */
export async function setLoggingEnabled(enabled: boolean): Promise<void> {
  isLoggingEnabled = enabled;
}

/**
 * Set the current log level
 */
export async function setLogLevel(level: LogLevel | string): Promise<void> {
  currentLogLevel = typeof level === 'string' ? parseLogLevel(level) : level;
}

/**
 * Parse log level string to enum
 */
function parseLogLevel(level: string): LogLevel {
  const upperLevel = level.toUpperCase();
  switch (upperLevel) {
    case 'DEBUG':
      return LogLevel.DEBUG;
    case 'INFO':
      return LogLevel.INFO;
    case 'WARN':
      return LogLevel.WARN;
    case 'ERROR':
      return LogLevel.ERROR;
    default:
      return LogLevel.INFO;
  }
}

/**
 * Format log entry for console output
 */
function formatLogEntry(entry: LogEntry): string {
  const levelName = LogLevel[entry.level];
  const timestamp = entry.timestamp;
  const contextStr = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
  const errorStr = entry.error ? ` Error: ${entry.error.message}` : '';
  return `[${timestamp}] [${levelName}] ${entry.message}${contextStr}${errorStr}`;
}

/**
 * Internal log function that handles all levels
 */
function internalLog(level: LogLevel, message: string, context?: LogContext, error?: Error): void {
  if (!isLoggingEnabled || level < currentLogLevel) {
    return;
  }

  const entry: LogEntry = {
    level,
    timestamp: new Date().toISOString(),
    message,
    context,
    error,
  };

  const formatted = formatLogEntry(entry);

  switch (level) {
    case LogLevel.DEBUG:
      console.debug('[1Click]', formatted);
      break;
    case LogLevel.INFO:
      console.info('[1Click]', formatted);
      break;
    case LogLevel.WARN:
      console.warn('[1Click]', formatted);
      break;
    case LogLevel.ERROR:
      console.error('[1Click]', formatted);
      if (error?.stack) {
        console.error('[1Click] Stack:', error.stack);
      }
      break;
  }
}

/**
 * Debug level log - only logs if enabled and level is DEBUG or lower
 */
export function logDebug(message: string, context?: LogContext | unknown): void {
  const safeContext = context && typeof context === 'object' ? (context as LogContext) : undefined;
  internalLog(LogLevel.DEBUG, message, safeContext);
}

/**
 * Info level log - only logs if enabled and level is INFO or lower
 */
export function logInfo(message: string, context?: LogContext | unknown): void {
  const safeContext = context && typeof context === 'object' ? (context as LogContext) : undefined;
  internalLog(LogLevel.INFO, message, safeContext);
}

/**
 * Warn level log - only logs if enabled and level is WARN or lower
 */
export function logWarn(message: string, context?: LogContext | unknown): void {
  const safeContext = context && typeof context === 'object' ? (context as LogContext) : undefined;
  internalLog(LogLevel.WARN, message, safeContext);
}

/**
 * Error level log - always logs regardless of setting
 */
export function logError(message: string, context?: LogContext | unknown, error?: Error): void {
  const safeContext = context && typeof context === 'object' ? (context as LogContext) : undefined;
  internalLog(LogLevel.ERROR, message, safeContext, error);
}

/**
 * Legacy log function for backward compatibility
 * @deprecated Use logInfo, logDebug, logWarn, or logError instead
 */
export function log(...args: unknown[]): void {
  if (isLoggingEnabled) {
    const message = args
      .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
      .join(' ');
    logInfo(message);
  }
}

// Automatically initialize the logger on load in a valid browser storage context
if (browser?.storage) {
  initLogger().catch(() => {});
}
