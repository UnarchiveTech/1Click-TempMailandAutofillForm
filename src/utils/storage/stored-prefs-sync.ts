/**
 * Synchronous mirror for small storage-backed UI preferences.
 *
 * Mirrors the favicon anti-flash fix (`peekCachedFaviconEntrySync`): prefs
 * rendered by the FIRST paint must not wait on an async
 * `browser.storage.local.get` round-trip, or the UI pops from the default
 * value to the stored value a frame+ later (hidden label pills appearing,
 * strip toggling, icons flickering in/out).
 *
 * The mirror is hydrated once per context at module import (fire-and-forget,
 * single flight per key) and kept coherent by:
 *   • writers calling `updateStoredJsonMirror` / writing through
 *     `browser.storage.local.set` with the onChanged listener below, and
 *   • a `storage.onChanged` listener for cross-context writes.
 *
 * Scope: SMALL UI booleans and small JSON maps only (per-key mirror). Do NOT
 * mirror large records (email bags, caches) - those stay on the async path.
 */

import { browser } from 'wxt/browser';
import { logError } from '@/utils/logger.js';

const boolMirror = new Map<string, boolean>();
const boolReady = new Map<string, Promise<void>>();
const jsonMirror = new Map<string, unknown>();
const jsonReady = new Map<string, Promise<void>>();

/** Boolean prefs owned by this mirror - warmed eagerly at import. */
export const SYNCED_BOOLEAN_PREF_KEYS = [
  'showFavicons',
  'hideLabels',
  'hideOtpLabels',
  'hideAttachmentBadges',
  'preferHideVerificationStrip',
  'preferHideOtpStrip',
  'preferHideMagicStrip',
  'preferHideAutofillStrip',
  'showSearchSlashIcon',
  'voiceSearchEnabled',
  'dialogPresentationBottomSheet',
] as const;

/** JSON prefs owned by this mirror - warmed eagerly at import. */
export const SYNCED_JSON_PREF_KEYS = ['notificationSnoozeByAddress'] as const;

async function hydrateBoolKey(key: string): Promise<void> {
  try {
    const res = (await browser.storage.local.get([key])) as Record<string, unknown>;
    // Only mirror keys that EXIST in storage - an absent key must stay
    // "unknown" so callers keep their own unset-default logic (e.g.
    // showFavicons defaults to true when never stored, not false).
    if (key in res) boolMirror.set(key, res[key] === true);
  } catch (e) {
    logError(`stored-prefs-sync: failed to hydrate "${key}"`, e);
  }
}

async function hydrateJsonKey(key: string): Promise<void> {
  try {
    const res = (await browser.storage.local.get([key])) as Record<string, unknown>;
    jsonMirror.set(key, res[key]);
  } catch (e) {
    logError(`stored-prefs-sync: failed to hydrate "${key}"`, e);
  }
}

/** Start (or join) hydration for a boolean pref. */
function ensureBoolKey(key: string): Promise<void> {
  let ready = boolReady.get(key);
  if (!ready) {
    ready = hydrateBoolKey(key);
    boolReady.set(key, ready);
  }
  return ready;
}

/** Start (or join) hydration for a JSON pref. */
function ensureJsonKey(key: string): Promise<void> {
  let ready = jsonReady.get(key);
  if (!ready) {
    ready = hydrateJsonKey(key);
    jsonReady.set(key, ready);
  }
  return ready;
}

// Cross-context coherence: another extension page / background may write these
// prefs. (storage.onChanged also fires in the writing context, so this covers
// same-context writes too; the explicit update* helpers just make it immediate.)
try {
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    for (const key of Object.keys(changes)) {
      const { newValue } = changes[key];
      if (boolMirror.has(key) || boolReady.has(key)) {
        // Removal (newValue undefined) → back to "unknown", not false.
        if (newValue === undefined) boolMirror.delete(key);
        else boolMirror.set(key, newValue === true);
      }
      if (jsonMirror.has(key) || jsonReady.has(key)) {
        if (newValue === undefined) jsonMirror.delete(key);
        else jsonMirror.set(key, newValue);
      }
    }
  });
} catch {
  /* ignore - storage.onChanged unavailable in some test/DOM contexts */
}

/**
 * Synchronous mirror read. Returns `undefined` while the key is unknown
 * (not hydrated or genuinely absent from storage) - callers must treat that
 * as "no stored value" and use their default.
 */
export function peekStoredBooleanSync(key: string): boolean | undefined {
  if (!boolMirror.has(key)) return undefined;
  return boolMirror.get(key);
}

/**
 * Synchronous mirror read for JSON prefs. Returns `undefined` while the key
 * is unknown (not hydrated or genuinely absent from storage).
 */
export function peekStoredJsonSync<T>(key: string): T | undefined {
  if (!jsonMirror.has(key)) return undefined;
  return jsonMirror.get(key) as T;
}

/**
 * All-or-nothing sync read of several boolean prefs (one render gate often
 * depends on multiple keys). Returns `undefined` if ANY key is unknown.
 */
export function peekStoredBooleansSync(
  keys: readonly string[]
): Record<string, boolean> | undefined {
  const out: Record<string, boolean> = {};
  for (const key of keys) {
    const value = peekStoredBooleanSync(key);
    if (value === undefined) return undefined;
    out[key] = value;
  }
  return out;
}

/**
 * Sync-first reconcile for a single pref:
 *  • mirror warm  → `apply(value)` runs SYNCHRONOUSLY (no pop) and true is
 *    returned;
 *  • mirror cold  → hydration is kicked off and a fallback storage read
 *    applies the stored value async (identical to the pre-mirror behavior),
 *    and false is returned.
 * `fallback` (default false) is only used by the async path when the key is
 * absent from storage.
 */
export function reconcileStoredBooleanPref(
  key: string,
  apply: (value: boolean) => void,
  fallback = false
): boolean {
  const warm = peekStoredBooleanSync(key);
  if (warm !== undefined) {
    apply(warm);
    return true;
  }
  void ensureBoolKey(key).then(() => {
    apply(peekStoredBooleanSync(key) ?? fallback);
  });
  return false;
}

/**
 * Sync-first reconcile for a JSON pref. Same contract as
 * `reconcileStoredBooleanPref`; `apply` receives the stored value (or
 * `undefined` when the key is absent from storage).
 */
export function reconcileStoredJsonPref<T>(
  key: string,
  apply: (value: T | undefined) => void
): boolean {
  if (jsonMirror.has(key)) {
    apply(jsonMirror.get(key) as T);
    return true;
  }
  void ensureJsonKey(key).then(() => {
    apply(peekStoredJsonSync<T>(key));
  });
  return false;
}

/**
 * Keep the JSON mirror coherent from writer paths (call AFTER computing the
 * new value, alongside/instead of awaiting the storage set).
 */
export function updateStoredJsonMirror(key: string, value: unknown): void {
  if (jsonMirror.has(key) || jsonReady.has(key)) jsonMirror.set(key, value);
}

/** Warm mirrors for the given keys (no-op once hydrated). */
export async function warmStoredBooleanPrefs(
  keys: readonly string[] = SYNCED_BOOLEAN_PREF_KEYS
): Promise<void> {
  await Promise.all(keys.map((k) => ensureBoolKey(k)));
}

/** Warm mirrors for the given JSON keys (no-op once hydrated). */
export async function warmStoredJsonPrefs(
  keys: readonly string[] = SYNCED_JSON_PREF_KEYS
): Promise<void> {
  await Promise.all(keys.map((k) => ensureJsonKey(k)));
}

// Warm eagerly at import: the utility is imported by the components whose
// first paint depends on these prefs, and import side effects run before any
// component renders - hydration is typically done by first paint.
void warmStoredBooleanPrefs();
void warmStoredJsonPrefs();

/** Test-only: drop all memoized mirrors so the next lookup re-reads storage. */
export function __resetStoredPrefsSyncForTests(): void {
  boolMirror.clear();
  boolReady.clear();
  jsonMirror.clear();
  jsonReady.clear();
}
