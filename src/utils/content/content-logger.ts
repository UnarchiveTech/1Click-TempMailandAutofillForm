/**
 * Zero-dependency logger for content scripts and MAIN-world page scripts.
 *
 * Unlike `src/utils/logger.ts` (which reads developer settings from
 * `browser.storage.local` and requires `wxt/browser`), this logger has no
 * extension-API dependencies and can be imported in any bundled context,
 * including unlisted page scripts injected into the MAIN world.
 *
 * All output is namespaced with a caller-supplied prefix so entries are
 * easy to filter in the console (e.g. `[1Click WebMCP]`).
 *
 * Errors always log regardless of the `enabled` flag - the gate only
 * suppresses debug/info/warn output.
 */

let enabled = false;
let currentPrefix = '';

/**
 * Enable or disable non-error output for a given namespace.
 * Subsequent calls with a different prefix replace the previous state
 * (single-toggle logger - intended for one consumer per entrypoint).
 */
export function setContentLogging(prefix: string, on: boolean): void {
  currentPrefix = prefix;
  enabled = on;
}

function fmt(...args: unknown[]): unknown[] {
  return [currentPrefix, ...args];
}

export function logDebug(...args: unknown[]): void {
  if (!enabled) return;
  console.debug(...fmt(...args));
}

export function logInfo(...args: unknown[]): void {
  if (!enabled) return;
  console.info(...fmt(...args));
}

export function logWarn(...args: unknown[]): void {
  if (!enabled) return;
  console.warn(...fmt(...args));
}

/** Always logged - errors are never suppressed. */
export function logError(...args: unknown[]): void {
  console.error(...fmt(...args));
}
