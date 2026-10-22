/**
 * The one degradation contract for UNTRUSTED data reaching content scripts.
 *
 * Everything a content script consumes - address lists, domain maps, background
 * message responses - arrives through the content bridge as untrusted data: the
 * whole value can be a non-object (quota-truncated write, a writer bug, a sync
 * conflict) and individual fields can be `null` / primitives / the wrong type
 * entirely. Before this module each consumption site carried its own filter,
 * and the filters disagreed (two dereferenced non-array lists outright; two
 * trusted a numeric-STRING `expiresAt` that `string <= number` compares as
 * NaN, silently resurrecting dead mailboxes).
 *
 * The generic core (arrayOrEmpty, isObjectRecord, sanitizeTimestampMap) lives
 * in `src/utils/storage/storage-shape-guards.ts` and is shared with the
 * app-side storage consumers; this module re-exports it and layers the
 * content-specific fill-path rules on top (mailbox liveness with archived /
 * deleted status, background-response sanitization). Its sibling
 * `storage-reads.ts` is the other half of the same contract: guarded readers
 * for the single-key values (passwordSettings, nameSettings, loginInfo,
 * selectedProvider, autofillFeatureEnabled, otpOptInList) that each call site
 * used to shape-check for itself.
 *
 * The rules, in one place so no site can drift again:
 *   - a corrupt LIST is the empty list - never a throw
 *   - a corrupt ENTRY is never a live mailbox
 *   - a corrupt EXPIRY is dead - garbage must not resurrect a mailbox
 *   - a corrupt MAP is the empty map - corrupt values are never canonized
 *     back into the next persist
 *   - a malformed BACKGROUND RESPONSE degrades to its "nothing" shape -
 *     `inbox: null`, never a record the fill path could stringify to
 *     `"undefined"` into a host-page input
 */

export {
  arrayOrEmpty,
  isObjectRecord,
  sanitizeTimestampMap,
} from '@/utils/storage/storage-shape-guards.js';

import { isObjectRecord } from '@/utils/storage/storage-shape-guards.js';
import type { AddressStatus } from '@/utils/types.js';

/**
 * The fields any address entry is expected to carry. Everything is optional
 * because storage guarantees nothing.
 *
 * `accountStatus` carries the PERSISTED vocabulary (`AddressStatus`, the three
 * tokens the writers write) so the comparisons below are checked by the
 * compiler; the runtime tolerance for a value outside it is this module's job,
 * not the type's - a stranger value is simply neither archived nor deleted,
 * which is what the predicate means by live. The two halves are complementary
 * and that is why this module exists.
 */
export interface AutofillAddressLike {
  id?: string;
  address?: string;
  status?: string;
  accountStatus?: AddressStatus;
  expiresAt?: number;
}

/**
 * True when `entry` is a well-formed mailbox that autofill may fill right now.
 *
 * - non-object / null entries (and `null` inside arrays) are never live
 * - `archived` / `deleted` are never live (same states the background uses)
 * - an expiry that is a finite positive number in the past is dead; a MISSING
 *   expiry (0 / undefined / null) is live; a present-but-garbage expiry is
 *   treated as dead, never silently live
 * - an empty/missing address is not fillable
 */
export function isLiveMailboxAddress(
  entry: unknown,
  now: number = Date.now()
): entry is LiveMailboxAddress {
  if (!isObjectRecord(entry)) return false;
  const candidate = entry as AutofillAddressLike;
  if (candidate.accountStatus === 'archived' || candidate.accountStatus === 'deleted') {
    return false;
  }
  const expiresAt = candidate.expiresAt;
  if (expiresAt != null) {
    if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return false;
    if (expiresAt > 0 && expiresAt <= now) return false;
  }
  return typeof candidate.address === 'string' && candidate.address.length > 0;
}

/** A storage-fed entry the predicate has PROVEN well-formed and live. */
export type LiveMailboxAddress = AutofillAddressLike & { address: string };

/** Revalidate the resolved signup email, including preferred and newly created inboxes. */
export function isAutofillEmailAvailable(
  entries: unknown,
  email: string,
  requireOwned = true
): boolean {
  if (!Array.isArray(entries)) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  const matches = entries.filter(
    (entry) =>
      isObjectRecord(entry) &&
      typeof entry.address === 'string' &&
      entry.address.trim().toLowerCase() === normalized
  );
  return matches.length > 0 ? matches.some((entry) => isLiveMailboxAddress(entry)) : !requireOwned;
}

/**
 * Shape-guard a background create-response whose payload is an inbox record:
 * `{ success?, inbox?, needsUserInteraction? }`. A malformed answer must never
 * hand a record the fill path would stringify (`field.value = record.address`
 * writing the literal string `"undefined"` into a host-page signup field).
 *
 * Degradation: an `inbox` that fails `isLiveMailboxAddress` (non-object,
 * missing address, archived/deleted, corrupt expiry) is reported as `null` -
 * the caller renders its existing create-failed tooltip. Non-record responses
 * degrade to `{ inbox: null }`. The `needsUserInteraction` flag is passed
 * through verbatim whenever present: it reports a REAL flow (the background
 * opened the extension UI), not a failure, and must survive the guard.
 */
export function sanitizeBackgroundInboxResponse(response: unknown): {
  inbox: LiveMailboxAddress | null;
  needsUserInteraction?: boolean;
} {
  if (!isObjectRecord(response)) return { inbox: null };
  const needsUserInteraction =
    typeof response.needsUserInteraction === 'boolean' ? response.needsUserInteraction : undefined;
  if (!isLiveMailboxAddress(response.inbox)) return { inbox: null, needsUserInteraction };
  return { inbox: response.inbox, needsUserInteraction };
}
