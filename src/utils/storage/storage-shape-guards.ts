/**
 * Shared shape guards for UNTRUSTED storage values (both directions of the
 * content bridge, `browser.storage.local` reads in features and background,
 * and persisted maps/lists re-read before a read-modify-write).
 *
 * Storage guarantees nothing: a quota-truncated write, a writer bug, a sync
 * conflict or a hand-edited database can turn any key into a non-array, a
 * non-object, a string timestamp or a nested wrapper. Every consumer that
 * decides "is this usable?" must degrade the same way instead of carrying its
 * own subtly different filter - the way four content-script filters used to
 * disagree on numeric-STRING expiries and dereferenced non-array lists.
 *
 * The rules, in one place so no site can drift again:
 *   - a corrupt LIST is the empty list - never a throw
 *   - a corrupt ENTRY is never a live mailbox
 *   - a corrupt EXPIRY is dead - garbage must not resurrect a mailbox
 *   - a corrupt MAP is the empty map - corrupt values are never canonized
 *     back into the next persist
 *
 * Consumers needing the mailbox-specific predicate and background-response
 * sanitizer live in `entrypoints/content/shared/address-liveness.ts`, which
 * re-exports this module and layers the fill-path rules on top; the guarded
 * single-key readers content scripts call for (`readPasswordSettings`,
 * `readNameSettings`, `readLoginInfo`, `readSelectedProvider`,
 * `readAutofillFeatureEnabled`, `readOtpOptInList`) live in the sibling
 * `entrypoints/content/shared/storage-reads.ts`, which applies these guards to
 * the value each key is supposed to hold.
 */

/**
 * `Array.isArray` for storage-fed list values: a corrupt non-array (truthy
 * garbage) degrades to the empty list instead of throwing `.filter`/`.map`
 * TypeErrors at the consumption site. Pairs with `isLiveMailboxAddress` -
 * filter the guarded list through the guarded predicate.
 */
export function arrayOrEmpty<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * `isObject` for storage-fed single-key values: a corrupt non-object degrades
 * to the empty record instead of throwing on property access (or - worse -
 * having its garbage spread back into the next persist). Arrays are NOT
 * records: a map guard must not index an array's slots.
 */
export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Shape-guard a storage-fed map of keys → epoch-ms timestamps (dismissed
 * domains, failure counts, and any sibling map of the same shape): only a
 * plain object of finite-number timestamp values survives. Everything else
 * degrades to the empty map, so a corrupted write is DROPPED - never spread
 * back into the next persist, which would canonize the corruption.
 *
 * Note the value rule is "finite number", not "positive" or "recent": a
 * stored 0 or a past timestamp is meaningful data the consumer may interpret
 * (e.g. `receivedAt`), while garbage is absent. Freshness comparison is the
 * consumer's decision.
 */
export function sanitizeTimestampMap(value: unknown): Record<string, number> {
  if (!isObjectRecord(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, ts] of Object.entries(value)) {
    if (typeof key === 'string' && key && typeof ts === 'number' && Number.isFinite(ts)) {
      out[key] = ts;
    }
  }
  return out;
}

/**
 * The one expiry-liveness rule for mailbox records read from storage - the
 * app-side counterpart of the content-script predicate. Strictness matches
 * the content contract exactly:
 *
 * - a PRESENT-but-garbage expiry (string epoch, ISO string, NaN, `{}`) is
 *   DEAD, never silently live - `string <= number` compares as NaN and the
 *   old inline filters read a dead mailbox as fillable
 * - `expiresAt <= 0` / missing / null means "no expiry" and is LIVE
 * - a finite expiry in the future is LIVE; in the past is DEAD
 *
 * Everything else about liveness (archived/deleted status, address presence)
 * stays with the caller - use `isPersistedAddress` (storage-keys.ts) for the
 * structural half and the callers' own status checks for the stateful half.
 */
export function hasLiveExpiry(expiry: unknown, now: number = Date.now()): boolean {
  if (expiry == null) return true;
  if (typeof expiry !== 'number' || !Number.isFinite(expiry)) return false;
  if (expiry <= 0) return true;
  return expiry > now;
}
