/**
 * Re-authenticate an inbox whose credentials were lost - e.g. a backup import
 * that dropped undecryptable tokens. Unlike renewal (which reuses the stored
 * session token), re-authentication asks the provider for a FRESH session for
 * the same username with NO auth token.
 *
 * Provider support: any provider whose setEmailUser-like operation can mint a
 * new session for an existing username (Guerrilla Mail's `set_email_user`
 * auto-creates a session when none is presented - see EMAIL_PROVIDER_APIS.md).
 * The operation is resolved from customEmail → expiry.renewalMethod →
 * selectMailboxOperation. Providers with none (or that reject auth-less
 * calls) fail with a clear error instead of guessing.
 */

import type { ProviderConfig } from '@/utils/email/email-service.js';
import { logError } from '@/utils/logger.js';
import { deriveAddressTiming } from '@/utils/provider/provider-expiry.js';
import type { Address } from '@/utils/types.js';

export interface ReauthDeps {
  getAddresses: () => Promise<Address[]>;
  setAddresses: (addresses: Address[]) => Promise<void>;
  /** Serialize the read-modify-write of the inbox list. Only consumed by the
   * self-locking `reauthenticateAddressCore` wrapper - the locked-caller
   * variant must NOT re-acquire the (non-reentrant) address lock it runs
   * under and therefore ignores it. */
  withLock: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Executes a provider operation WITHOUT auth (fresh session semantics). */
  executeOperation: (
    operation: string,
    context: { variables?: Record<string, unknown> }
  ) => Promise<Record<string, unknown>>;
  /** Bring archived mail back into the live bag after a successful session. */
  restoreArchivedEmailsToStored: (address: string) => Promise<void>;
  now?: () => number;
}

export interface ReauthOutcome {
  ok: boolean;
  address?: string;
  expiresAt?: number;
  /**
   * Stable `errors.*` locale key - this outcome is rendered in the import
   * dialog's re-auth list via `translateResultMessage()`, so raw provider or
   * network prose must never reach it (English in every locale). A provider
   * throw has no keyable message, so it collapses to `errors.reauthFailed`
   * and the raw value goes to the log.
   */
  error?: string;
}

/** Resolve the operation capable of minting a fresh session for a username. */
export function resolveReauthOperation(config: ProviderConfig): string | null {
  return (
    config.customEmail?.operation ||
    config.expiry?.renewalMethod ||
    config.emailFetching?.selectMailboxOperation ||
    null
  );
} /** Outcome for one inbox inside a batch re-auth. */
export interface ReauthBatchOutcome {
  addressId: string;
  success: boolean;
  address?: string;
  expiresAt?: number;
  /** Stable `errors.*` locale key - the UI renders it (see `ReauthOutcome.error`). */
  error?: string;
}

export interface BulkReauthEntry {
  addressId: string;
  record: Address;
  config: ProviderConfig;
  executeOperation: ReauthDeps['executeOperation'];
}

export interface BulkReauthResult {
  /** The caller-provided list with every successful probe applied. */
  next: Address[];
  outcomes: ReauthBatchOutcome[];
}

/** Auth-less provider call + fresh-session token/timing (no storage effects). */
type FreshSessionProbe =
  | { ok: true; token: string; emailUser: string; expiresAt: number }
  | { ok: false; error: string }; // `error` is an `errors.*` locale key - never prose

async function probeFreshSession(
  config: ProviderConfig,
  record: Address,
  executeOperation: ReauthDeps['executeOperation'],
  now: number
): Promise<FreshSessionProbe> {
  const operation = resolveReauthOperation(config);
  if (!operation) {
    // Locale keys (not English prose): the UI maps them through
    // translateResultMessage so the reason stays localized.
    return { ok: false, error: 'errors.reauthUnsupported' };
  }
  const emailUser = record.emailUser || record.address.split('@')[0];
  if (!emailUser) {
    return { ok: false, error: 'errors.reauthNoUsername' };
  }

  let response: Record<string, unknown>;
  try {
    // Deliberately NO auth token - the whole point is a fresh session. The
    // same auth-less call the fetcher already makes for token-less addresses.
    response = await executeOperation(operation, { variables: { emailUser } });
  } catch (err) {
    // A provider/network throw has no keyable message, so the outcome carries
    // the generic key and the raw value goes to the log: this error is shown
    // in the import dialog's re-auth list, where English prose would leak.
    logError('Re-authentication probe failed', err);
    return { ok: false, error: 'errors.reauthFailed' };
  }

  const token = typeof response.token === 'string' && response.token ? response.token : undefined;
  if (!token) {
    return { ok: false, error: 'errors.reauthNoToken' };
  }

  // Renewal-style timing: force the base to now so the fresh window is future.
  const timing = deriveAddressTiming(response, config, now, { renewalBaseNow: true });
  return { ok: true, token, emailUser, expiresAt: timing.expiresAt };
}

/** Apply a probed fresh session onto one record (shared single + batch path). */
function applyFreshSessionToRecord(
  record: Address,
  probe: Extract<FreshSessionProbe, { ok: true }>
): Address {
  return {
    ...record,
    token: probe.token,
    sidToken: probe.token,
    emailUser: probe.emailUser,
    expiresAt: probe.expiresAt,
    // Fresh session → new expiry cycle; reset the notification flags so the
    // normal expiring-soon / expired warnings fire again.
    expiryNotified: false,
    expiringSoonNotified: false,
    expiredNotified: false,
    // A re-auth ends any renewal-failure streak.
    renewalFailCount: 0,
    lastFailureAt: undefined,
    // accountStatus is the single persisted lifecycle source - background/
    // content paths derive display state from it + expiresAt via
    // @/utils/address/address-status (never read a stored `status` field).
    accountStatus: 'active',
    lastRenewalAt: Date.now(),
  };
}

/**
 * Shared body: auth-less provider call + apply of the fresh session. Runs
 * withOUT acquiring the address lock - the caller decides locking:
 * `reauthenticateAddressCore` wraps it in `deps.withLock`;
 * `reauthenticateAddressCoreForLockedCaller` requires the caller to already
 * hold the lock (the non-reentrant mutex would deadlock on a nested acquire).
 */
async function reauthenticateAddressUnlocked(
  config: ProviderConfig,
  record: Address,
  deps: ReauthDeps
): Promise<ReauthOutcome> {
  const probe = await probeFreshSession(
    config,
    record,
    deps.executeOperation,
    deps.now ? deps.now() : Date.now()
  );
  if (!probe.ok) return { ok: false, error: probe.error };

  // Re-authenticating is for THIS mailbox - preserve the stored address even
  // if the provider returns a different one (e.g. default-domain hop).
  const storedAddress = record.address;

  const list = await deps.getAddresses();
  const idx = list.findIndex((i) => i.id === record.id);
  if (idx !== -1) {
    list[idx] = applyFreshSessionToRecord(list[idx], probe);
    await deps.setAddresses(list);
  } // else: deleted while we were re-authenticating - nothing to write back

  // Same as the renewal path - make sure offline history is in the live bag.
  try {
    await deps.restoreArchivedEmailsToStored(storedAddress);
  } catch {
    /* best-effort */
  }

  return { ok: true, address: storedAddress, expiresAt: probe.expiresAt };
}

/**
 * Batch re-authentication for callers already inside ONE withAddressLock:
 * the caller reads and writes the address list once regardless of N, while
 * each inbox's network probe stays isolated (one failing provider never
 * aborts the rest). Mirrors the bulk tag / deleteAddresses fan-outs.
 */
export async function runReauthBatch(
  list: Address[],
  entries: BulkReauthEntry[],
  deps: Pick<ReauthDeps, 'now'>
): Promise<BulkReauthResult> {
  const next = [...list];
  const now = deps.now ? deps.now() : Date.now();
  const outcomes: ReauthBatchOutcome[] = [];
  for (const { addressId, record, config, executeOperation } of entries) {
    const probe = await probeFreshSession(config, record, executeOperation, now);
    if (!probe.ok) {
      outcomes.push({ addressId, success: false, error: probe.error });
      continue;
    }
    const idx = next.findIndex((i) => i.id === addressId);
    if (idx === -1) {
      outcomes.push({ addressId, success: false, error: 'errors.addressNotFound' });
      continue;
    }
    next[idx] = applyFreshSessionToRecord(next[idx], probe);
    outcomes.push({
      addressId,
      success: true,
      address: record.address,
      expiresAt: probe.expiresAt,
    });
  }
  return { next, outcomes };
}

/**
 * Self-locking variant for callers that do NOT already hold the address lock
 * (tests, non-handler flows). Reads `record` from its own locked section.
 */
export async function reauthenticateAddressCore(
  config: ProviderConfig,
  record: Address,
  deps: ReauthDeps
): Promise<ReauthOutcome> {
  return deps.withLock(() => reauthenticateAddressUnlocked(config, record, deps));
}

/**
 * Locked-caller variant: the caller MUST already hold the address lock
 * (message-handler reauthenticateAddress wraps read → network → apply in ONE
 * withAddressLock, like renewAddress/deleteAddress, so a concurrent delete or
 * re-auth can't race a stale record). Must not re-acquire the non-reentrant
 * mutex, hence the separate entry point.
 */
export async function reauthenticateAddressCoreForLockedCaller(
  config: ProviderConfig,
  record: Address,
  deps: ReauthDeps
): Promise<ReauthOutcome> {
  return reauthenticateAddressUnlocked(config, record, deps);
}
