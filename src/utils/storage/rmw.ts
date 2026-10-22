/**
 * Serialized read-modify-write for one whole-object storage key.
 *
 * `browser.storage.local.set` replaces the whole value of a key, so two
 * contexts (or two async flows in one context) that both do get → mutate → set
 * on the same key lose whichever write lands first - the classic lost update.
 * `updateStoredObject` closes that within a single JS context: every call for
 * a key joins a per-key promise chain, so the read of call N+1 happens strictly
 * after the write of call N landed. Cross-context races (app tab vs. sidepanel
 * vs. service worker) still need the storage mutex / message handler locks -
 * this primitive is the INTRA-context half, which is where every known
 * lost-update in the UI lived (readEmails bulk marks vs. the debounced flush,
 * starredEmails toggles, the OTP domain lists, automationRules, the tag
 * catalog).
 *
 * Parsers are mandatory: a caller cannot accidentally write `undefined` over a
 * whole map because a read came back empty or corrupt - the parser decides the
 * shape of the default, and the updater always receives a well-formed value.
 *
 * Errors do not poison the chain: a failed write rejects only its own caller;
 * the next update for the key re-reads storage and proceeds.
 */
import { resolveLocalArea, writeWithRetry } from './storage-write.js';

interface KeyChain {
  promise: Promise<unknown>;
}

const keyChains = new Map<string, KeyChain>();

/** Test hook: drop every per-key chain (chains are module-global state). */
export function __clearStoredObjectChainsForTests(): void {
  keyChains.clear();
} /** Read the current value of a whole-object key OUTSIDE any chain. */
export async function readStoredObject<T>(key: string, parse: (raw: unknown) => T): Promise<T> {
  const result = await resolveLocalArea().get([key]);
  return parse(result[key]);
}

/**
 * Resolve once every update currently queued for the key has written - WITHOUT
 * performing a read/write of our own. A flush that found an empty op list (its
 * ops were drained by a concurrent flush) still joins the chain tail, so
 * "flush then read storage" keeps meaning "this key's write has landed".
 */
export async function awaitStoredObjectChain(key: string): Promise<void> {
  const previous = keyChains.get(key);
  if (!previous) return;
  await previous.promise.catch(() => {});
}

/**
 * Serialized read-modify-write of one whole-object storage key.
 *
 * The updater runs against the value the PREVIOUS write for this key landed
 * (not the value at call time), its return value is written whole, and the
 * written value is returned. A throwing updater rejects its own call only.
 */
/**
 * Read/write seams for a key whose value needs more than a raw area round trip.
 *
 * Both halves default to the raw area (`get([key])` + `parse`, and a retrying
 * whole-key write). A key that is stored in a NORMALIZED form supplies its own:
 * `addresses` holds encrypted tokens that `setAddresses` re-encrypts and dedupes
 * by id, so an update must go out through that writer and come back in through
 * `getAddresses` - a raw read/write pair would either write plaintext tokens or
 * skip the normalization every other writer applies.
 */
export interface StoredObjectAccess<T> {
  /** Read the current value. Defaults to `parse`(raw area read). */
  read?: () => Promise<T>;
  /** Persist the next value. Defaults to a retrying whole-key write. */
  write?: (next: T) => Promise<void>;
}

export async function updateStoredObject<T>(
  key: string,
  updater: (current: T) => T,
  parse: (raw: unknown) => T,
  access: StoredObjectAccess<T> = {}
): Promise<T> {
  const previous = keyChains.get(key);
  const run = async (): Promise<T> => {
    const area = resolveLocalArea();
    const current = access.read ? await access.read() : parse((await area.get([key]))[key]);
    const next = updater(current);
    // A transient storage failure is retried here rather than rejecting into
    // the chain's caller: the read half already happened inside this link, so
    // letting the write fail would lose this update while the NEXT call's read
    // (which re-reads storage) would never know it was dropped.
    if (access.write) await access.write(next);
    else await writeWithRetry({ [key]: next }, { area });
    return next;
  };
  const promise = (previous ? previous.promise : Promise.resolve()).catch(() => {}).then(run);
  keyChains.set(key, { promise });
  try {
    return (await promise) as T;
  } finally {
    // Only the latest link may retire the chain - an earlier call's finally
    // must not delete a successor's entry.
    if (keyChains.get(key)?.promise === promise) keyChains.delete(key);
  }
}

// ── Shared parsers ──────────────────────────────────────────────────────────
// One parser per stored value shape, so two call sites for the same key can
// never disagree about what a corrupt/legacy record degrades to.

export function parseStringList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}

export function parseBooleanRecord(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

export function parseNumberRecord(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

export function parseStringRecord(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

// ── Shared updaters ─────────────────────────────────────────────────────────

/**
 * Toggle one (lower-cased) domain key inside an OTP-domain list. Removal
 * matches any casing; adding is idempotent even when the list held a
 * different casing of the same domain (the old append path could duplicate).
 */
export function toggleDomainListItem(list: string[], domainKey: string, add: boolean): string[] {
  const needle = domainKey.toLowerCase();
  const filtered = list.filter((d) => typeof d === 'string' && d.toLowerCase() !== needle);
  if (!add) return filtered;
  return filtered.some((d) => d.toLowerCase() === needle) ? filtered : [...filtered, domainKey];
}

/**
 * Defaults-merge updater for preference records written whole
 * (e.g. automationRules): unknown/current fields from storage survive, the
 * patched field wins, defaults fill anything storage never held.
 */
export function mergePrefUpdate<T extends object>(
  defaults: T,
  patch: Partial<T>
): (current: T) => T {
  return (current) => ({ ...defaults, ...current, ...patch });
}
