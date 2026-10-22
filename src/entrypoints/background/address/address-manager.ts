/**
 * Inbox creation, deletion, and email checking
 */

import { browser } from 'wxt/browser';

export { checkAddressExpiry, setupAddressExpiryCheck } from './expiry-manager.js';
export { setupPeriodicEmailCheck } from './periodic-checks.js';

import { addActivityEvent } from '@/utils/activity/activity-tracker.js';
import { isLive } from '@/utils/address/address-status.js';
import { runWithConcurrency } from '@/utils/concurrency.js';
import { CONSTANTS } from '@/utils/constants.js';
import { fetchEmails } from '@/utils/dsl/email-fetcher.js';
import { emailLabelKey } from '@/utils/email/email-label-key.js';
import { EmailService, loadProviderConfig } from '@/utils/email/email-service.js';
import { starKeyForEmail } from '@/utils/email/email-star-key.js';
import {
  AddressCreationError,
  AddressNotFoundError,
  AddressSessionConflictError,
  ApiError,
  BaseExtensionError,
  ErrorCode,
  ProviderUnsupportedError,
  toResultErrorKey,
  ValidationError,
} from '@/utils/errors.js';
import { log, logDebug, logError, logWarn } from '@/utils/logger.js';
import { withAddressLock, withLock } from '@/utils/mutex.js';
import {
  getEnabledInstances,
  getProviderInstancesWithCustom,
} from '@/utils/provider/instance-manager.js';
import { deriveAddressTiming } from '@/utils/provider/provider-expiry.js';
import { canonicalHost, chooseAllowedEmailAlias } from '@/utils/provider/site-email-domains.js';
import {
  getAddresses,
  getArchivedEmailsForAddress,
  getEmailMaps,
  getRawAddresses,
  getSelectedProvider,
  getStoredEmailsForAddress,
  removeEmailStorageForAddress,
  resolveBagKey,
  setAddresses,
  setLogicalEmailMapsUnlockedForLockedCaller,
  setStoredEmailsForAddress,
  updateAddresses,
} from '@/utils/storage/storage-keys.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import { safeStorageSet } from '@/utils/storage/storageMonitor.js';
import { toMs } from '@/utils/time/time.js';
import { timeAgo } from '@/utils/time/time-format.js';
import type {
  Address,
  AddressStatus,
  Email,
  EmailFilters,
  MailProvider,
  ProviderInstance,
} from '@/utils/types.js';
import { incrementAnalytic } from './analytics.js';
import {
  archiveStoredEmailsAndCommitAddresses,
  clearStoredEmails,
  filterMessages,
  getStoredEmails,
  restoreArchivedEmailsToStored,
} from './email-storage.js';
import { broadcastOtpToTabs } from './otp-broadcast.js';
import { getRenewalFailureUpdates } from './renewal-retry.js';

function mailboxRefreshFailureKind(error: unknown): 'network' | 'provider' | 'unknown' {
  const code = error instanceof BaseExtensionError ? error.code : undefined;
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (
    !navigator.onLine ||
    code === ErrorCode.NETWORK_ERROR ||
    code === ErrorCode.NETWORK_OFFLINE ||
    code === ErrorCode.PROVIDER_UNREACHABLE ||
    message.includes('failed to fetch') ||
    message.includes('network') ||
    message.includes('offline')
  ) {
    return 'network';
  }
  if (
    code === ErrorCode.PROVIDER_HTTP_ERROR ||
    code === ErrorCode.PROVIDER_REQUEST_REJECTED ||
    code === ErrorCode.API_CALL_FAILED ||
    code === ErrorCode.API_TIMEOUT
  ) {
    return 'provider';
  }
  return 'unknown';
}

async function storeMailboxRefreshFailure(addressId: string, error: unknown): Promise<void> {
  const kind = mailboxRefreshFailureKind(error);
  const errorKey = toResultErrorKey(error);
  try {
    const previous = (await getRawAddresses()).find(
      (address) => address.id === addressId
    )?.mailboxRefreshFailure;
    if (previous?.kind === kind && previous.errorKey === errorKey) return;
    await updateAddresses((addresses) => {
      let changed = false;
      const updated = addresses.map((address) => {
        if (address.id !== addressId) return address;
        const previous = address.mailboxRefreshFailure;
        if (previous?.kind === kind && previous.errorKey === errorKey) return address;
        changed = true;
        return { ...address, mailboxRefreshFailure: { kind, failedAt: Date.now(), errorKey } };
      });
      return changed ? updated : addresses;
    });
  } catch (storageError) {
    logWarn('Could not persist mailbox refresh failure state', {
      addressId,
      error: storageError instanceof Error ? storageError.message : String(storageError),
    });
  }
}

async function clearMailboxRefreshFailure(addressId: string): Promise<void> {
  try {
    const previous = (await getRawAddresses()).find(
      (address) => address.id === addressId
    )?.mailboxRefreshFailure;
    if (!previous) return;
    await updateAddresses((addresses) => {
      let changed = false;
      const updated = addresses.map((address) => {
        if (address.id !== addressId || !address.mailboxRefreshFailure) return address;
        const { mailboxRefreshFailure: _failure, ...rest } = address;
        changed = true;
        return rest;
      });
      return changed ? updated : addresses;
    });
  } catch (storageError) {
    logWarn('Could not clear mailbox refresh failure state', {
      addressId,
      error: storageError instanceof Error ? storageError.message : String(storageError),
    });
  }
}

export interface DeleteAddressResult {
  success: boolean;
  /** Id of the inbox this outcome refers to (batch deletes). */
  addressId?: string;
  error?: string;
}

export interface DeleteAddressesResult {
  /** Per-address outcomes, one per requested id, in request order. */
  results: DeleteAddressResult[];
}

export interface AddressLifecycleResult {
  success: boolean;
  /** Id of the inbox this outcome refers to (batch lifecycle ops). */
  addressId?: string;
  error?: string;
  /** Present on successful renewals (mirrors the single renewAddress response). */
  renewalCount?: number;
}

export interface AddressLifecycleBatchResult {
  /** Per-address outcomes, one per requested id, in request order. */
  results: AddressLifecycleResult[];
}

/** Bounded fan-out for provider-side forget_me calls - same limit as the periodic checker. */
const FORGET_ME_CONCURRENCY = 3;

/**
 * True when a message's own independent retention window (Model 2 - e.g.
 * Guerrilla Mail's messageRetentionDuration) has passed, even if the server
 * still returns it or the mailbox session continues.
 */
function isRetentionExpired(
  email: Pick<Email, 'received_at'>,
  config: {
    expiry?: { messageRetentionDuration?: number };
  }
): boolean {
  const retentionMs = config.expiry?.messageRetentionDuration;
  return (
    typeof retentionMs === 'number' &&
    retentionMs > 0 &&
    toMs(email.received_at) + retentionMs <= Date.now()
  );
}

/**
 * Creates a new email inbox using the specified provider
 * @param provider - Optional mail provider to use (defaults to selected provider in storage)
 * @param instanceId - Optional provider instance ID to use
 * @param emailUser - Optional email username for custom address
 * @returns Promise resolving to the created inbox account
 * @throws AddressCreationError if inbox creation fails
 * @throws ProviderUnsupportedError if the provider is not supported
 * @throws ApiError for other API-related errors
 */
let createAddressQueue: Promise<unknown> = Promise.resolve();

export function createAddress(
  provider?: MailProvider,
  instanceId?: string,
  emailUser?: string,
  rejectedDomains: readonly string[] = [],
  preparation?: { cancelled: () => boolean }
): Promise<Address> {
  return new Promise((resolve, reject) => {
    createAddressQueue = createAddressQueue
      .catch(() => {}) // Recover queue state if previous task rejected
      .then(() => {
        if (preparation?.cancelled()) throw new Error('Onboarding preparation cancelled');
        return _createAddress(provider, instanceId, emailUser, rejectedDomains, !!preparation);
      })
      .then(resolve, reject);
  });
}

function addressLocalPart(address: string): string {
  return (address.split('@')[0] || '').toLowerCase();
}

/** Remove timestamp entries without racing concurrent polling side effects. */
async function removeLastMessageTimestamps(addressIds: string[]): Promise<void> {
  if (addressIds.length === 0) return;
  await withLock('last_message_timestamps_lock', async () => {
    const { lastMessageTimestamps = {} } = (await browser.storage.local.get([
      'lastMessageTimestamps',
    ])) as { lastMessageTimestamps?: Record<string, number> };
    for (const id of addressIds) delete lastMessageTimestamps[id];
    await safeStorageSet(browser, { lastMessageTimestamps });
  });
}

/** Fisher-Yates shuffle (new array; input untouched). */
function shuffle<T>(arr: readonly T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Throw if local-part or full address already exists in storage. */
function throwIfDuplicateUsername(
  existingList: Address[],
  wantLocal: string,
  fullAddress?: string
) {
  const want = wantLocal.trim().toLowerCase();
  if (!want) return;
  const matches = existingList.filter((i) => {
    const addr = (i.address || '').toLowerCase();
    if (fullAddress && addr === fullAddress.toLowerCase()) return true;
    return addressLocalPart(i.address || '') === want;
  });
  if (matches.length === 0) return;

  const live = matches.find(
    (i) =>
      i.accountStatus !== 'archived' &&
      i.accountStatus !== 'deleted' &&
      !(i.expiresAt > 0 && i.expiresAt <= Date.now())
  );
  if (live) {
    throw new AddressSessionConflictError({
      address: live.address,
      reason: 'duplicate_live',
      addressId: live.id,
    });
  }
  const archived = matches.find((i) => i.accountStatus === 'archived');
  const expired = matches.find((i) => i.expiresAt > 0 && i.expiresAt <= Date.now());
  const pick = archived || expired || matches[0];
  throw new AddressSessionConflictError({
    address: pick.address,
    reason: 'duplicate_inactive',
    addressId: pick.id,
    canUnarchive: !!archived,
    canRenew: !!expired && isProviderRenewableSafe(pick.provider),
    archivedAddressId: archived?.id,
    expiredAddressId: expired?.id,
  });
}

function isProviderRenewableSafe(provider: string): boolean {
  try {
    return !!loadProviderConfig(provider).expiry?.renewable;
  } catch {
    /* ignore */
    return false;
  }
}

async function _createAddress(
  provider?: MailProvider,
  instanceId?: string,
  emailUser?: string,
  rejectedDomains: readonly string[] = [],
  prepareOnly = false
): Promise<Address> {
  const selectedProvider = await getSelectedProvider();
  if (!selectedProvider) throw new ProviderUnsupportedError('No provider selected');

  // Pre-check custom username before hitting provider API
  if (emailUser?.trim()) {
    await withAddressLock(async () => {
      const { addresses: existingList = [] } = (await browser.storage.local.get(['addresses'])) as {
        addresses?: Address[];
      };
      throwIfDuplicateUsername(existingList, emailUser);
    });
  }

  // Determine active provider (instanceId lookup is handled downstream by the service layer)
  let activeProvider: MailProvider;
  activeProvider = (provider || selectedProvider) as MailProvider;

  const createStarted = Date.now();
  try {
    const config = loadProviderConfig(activeProvider);
    const aliases = config.multiDomain?.enabled ? config.multiDomain.domains || [] : [];
    if (
      rejectedDomains.length &&
      aliases.length &&
      aliases.every((domain) => {
        const host = canonicalHost(domain);
        return !host || rejectedDomains.includes(host);
      })
    )
      throw new ValidationError(
        'No permitted email domain for this site',
        undefined,
        'errors.siteEmailUnavailable'
      );
    let instanceUrl: string | undefined;

    // Resolve the instance pool for multi-instance providers:
    //   • explicit instanceId → that single instance (user pinned it)
    //   • otherwise → ENABLED instances (all minus the disabled blacklist),
    //     with per-instance failover: try each in shuffled order until one
    //     creates successfully, before ever leaving the provider.
    const pool: ProviderInstance[] = [];
    if (config.multiInstance?.enabled) {
      if (instanceId) {
        const instances = await getProviderInstancesWithCustom(activeProvider);
        const pinned = instances.find((i) => i.id === instanceId);
        if (pinned) pool.push(pinned);
        if (pool.length === 0) {
          throw new AddressCreationError(activeProvider, {
            reason: `Instance not found for ${activeProvider}. Please select an instance in settings.`,
          });
        }
      } else {
        const enabled = await getEnabledInstances(activeProvider);
        if (enabled.length === 0) {
          throw new AddressCreationError(activeProvider, {
            reason: `No enabled instances for ${activeProvider}. Enable at least one instance in settings.`,
          });
        }
        // Shuffle so a failing first pick doesn't deterministically fail the same
        // way every time - instance-level failover spreads load and retries.
        pool.push(...shuffle(enabled));
      }
    }

    const service = new EmailService(config, browser);
    let result: Record<string, unknown>;
    if (pool.length > 0) {
      // Instance-level failover: try each pool instance until one succeeds.
      let lastError: unknown;
      let created = false;
      let createdResult: Record<string, unknown> | undefined;
      let firstAttemptedId: string | null = null;
      let failures = 0;
      for (const instance of pool) {
        const attemptStart = Date.now();
        if (firstAttemptedId === null) firstAttemptedId = instance.id;
        try {
          createdResult = await service.executeOperation('createInbox', {
            instanceUrl: instance.apiUrl,
            forceNewSession: true,
          });
          instanceUrl = instance.apiUrl;
          created = true;
          try {
            const { recordProviderCreate } = await import(
              '@/features/intelligence/provider-health.js'
            );
            await recordProviderCreate(activeProvider, true, Date.now() - attemptStart);
          } catch {
            /* ignore */
          }
          // Surface instance-level auto-failover to the user: the inbox was
          // created on a different instance than the first one tried. The UI
          // (MailProviderView) reads `lastInstanceFailover` for a notice +
          // toast, mirroring `lastProviderFailover`.
          if (failures > 0 && instance.id !== firstAttemptedId) {
            const first = pool.find((i) => i.id === firstAttemptedId);
            try {
              await writeWithRetry({
                lastInstanceFailover: {
                  requested: first?.displayName || firstAttemptedId || activeProvider,
                  used: instance.displayName || instance.id,
                  at: Date.now(),
                },
              });
            } catch {
              /* ignore */
            }
          }
          break;
        } catch (err: unknown) {
          failures += 1;
          lastError = err;
          const msg = err instanceof Error ? err.message : String(err);
          logError(`Instance ${instance.id} failed to create inbox`, {
            provider: activeProvider,
            instanceId: instance.id,
            error: msg,
          });
        }
      }
      if (!created || !createdResult) {
        throw new AddressCreationError(
          activeProvider,
          { reason: 'All enabled instances failed to create an inbox.' },
          lastError instanceof Error ? lastError : new Error(String(lastError))
        );
      }
      result = createdResult;
    } else {
      result = await service.executeOperation('createInbox', {
        instanceUrl,
        forceNewSession: true,
      });
    }

    log('Create inbox result:', JSON.stringify(result));

    let { address, id, token } = result;
    let timingSource = result;

    // If custom username is provided and provider supports setEmailUser, use it
    if (emailUser && config.operations?.setEmailUser) {
      const domain = (address as string).split('@')[1];
      const customAddress = `${emailUser}@${domain}`;
      log(`Setting custom email address: ${customAddress}`);

      const setEmailResult = await service.executeOperation('setEmailUser', {
        auth: { token: token as string },
        variables: { emailUser },
      });

      if (setEmailResult) {
        address = setEmailResult.address || customAddress;
        id = setEmailResult.address || customAddress;
        token = setEmailResult.token || token;
        timingSource = setEmailResult;
        log('Custom email address set successfully:', address);
      }
    }

    // For single-instance providers like guerrilla, id might not be in response
    // Use address as id if id is not present
    const addressId = (id || address) as string;
    if (typeof address === 'string' && rejectedDomains.length) {
      const permitted = chooseAllowedEmailAlias(address, aliases, rejectedDomains);
      if (!permitted)
        throw new ValidationError(
          'No permitted email domain for this site',
          undefined,
          'errors.siteEmailUnavailable'
        );
      // Same provider-authorized aliases used by the existing domain chooser.
      // Preserve the native inbox ID/token so fetching and renewal keep working.
      address = permitted;
    }

    // Allow empty token for providers that sometimes return empty token (like Guerrilla Mail)
    if (!address) {
      logError('Missing required fields in API response', { result, address, token });
      throw new AddressCreationError(
        activeProvider,
        { response: result },
        new Error('Missing required fields in API response')
      );
    }

    const timing = deriveAddressTiming(timingSource, config);

    // Auto-renew defaults ON so every newly-created inbox survives expiry unless
    // the user explicitly disabled the setting.
    const { autoRenew = true } = (await browser.storage.local.get(['autoRenew'])) as {
      autoRenew?: boolean;
    };

    const record: Address = {
      id: addressId,
      address: address as string,
      token: token as string,
      sidToken: token as string,
      provider: activeProvider,
      createdAt: timing.createdAt,
      expiresAt: timing.expiresAt,
      expiryNotified: false,
      expiringSoonNotified: false,
      expiredNotified: false,
      autoExtend: !!autoRenew,
      ...(instanceUrl && { instanceUrl }),
    };

    if (prepareOnly) {
      // Drafts never enter the address index, polling, analytics or onboarding state.
      await withAddressLock(async () => {
        throwIfDuplicateUsername(
          await getAddresses(),
          addressLocalPart(record.address),
          record.address
        );
      });
      return record;
    }
    await adoptPreparedAddress(record, createStarted);
    return record;
  } catch (error: unknown) {
    if (error instanceof AddressSessionConflictError || error instanceof BaseExtensionError)
      throw error;
    const errorMessage = error instanceof Error ? error.message : String(error);
    try {
      const { recordProviderCreate } = await import('@/features/intelligence/provider-health.js');
      await recordProviderCreate(activeProvider, false, Date.now() - createStarted, errorMessage);
    } catch {
      /* health bookkeeping is non-critical */
    }
    logError(
      'Error creating inbox:',
      { provider: activeProvider },
      error instanceof Error ? error : new Error(errorMessage)
    );
    throw new ApiError(`Failed to create ${activeProvider} inbox: ${errorMessage}`, {
      provider: activeProvider,
      originalError: error,
    });
  }
}

/** Commit a freshly created or prepared inbox through the same locked path. */
export async function adoptPreparedAddress(
  record: Address,
  createStarted = Date.now()
): Promise<void> {
  const activeProvider = record.provider;
  await withAddressLock(async () => {
    // Address creation also updates the per-inbox seen-ID map. Keep that
    // read-modify-write under the same email lock as polling so a concurrent
    // poll cannot have its newly-seen IDs overwritten by this stale snapshot.
    await withLock('emails_storage_lock', async () => {
      const { addresses = [], seenEmailIds = {} } = (await browser.storage.local.get([
        'addresses',
        'seenEmailIds',
      ])) as { addresses?: Address[]; seenEmailIds?: Record<string, string[]> };

      // Final guard: block any same local-part or exact address already stored
      // (covers random API reuse and post-setEmailUser collisions)
      throwIfDuplicateUsername(addresses, addressLocalPart(record.address), record.address);

      // Provider reliability graph - successful create
      try {
        const { recordProviderCreate } = await import('@/features/intelligence/provider-health.js');
        await recordProviderCreate(activeProvider, true, Date.now() - createStarted);
      } catch {
        /* ignore */
      }

      addresses.push(record);
      // Resolve case-insensitively so a recreated (re-cased) address reuses the
      // old seen-IDs key instead of orphaning it under a second casing.
      seenEmailIds[resolveBagKey(seenEmailIds, record.address)] = [];

      await incrementAnalytic('accountsCreated');
      await setAddresses(addresses);
      // Always select the newly created mailbox (context menu + UI share this path)
      await safeStorageSet(browser, {
        seenEmailIds,
        activeAddressId: record.id,
        onboardingComplete: true,
      });
    });
  });

  // Track account creation activity
  await addActivityEvent('address_created', {
    address: record.address,
  });

  // Rescan forms on every open tab so Autofill All appears without a second create
  try {
    const { ensureTabAutofillReady } = await import('../tab-autofill.js');
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      if (tab.id == null) continue;
      void ensureTabAutofillReady(tab.id).catch((error) =>
        logWarn('Autofill refresh after address creation failed', {
          tabId: tab.id,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }
  } catch (error) {
    logWarn('Could not refresh open tabs after address creation', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Deletes inboxes from storage in one batched, locked pass.
 *
 * The address-list and email-bag mutations run under a single withAddressLock
 * and (for permanent deletes) a single emails_storage_lock: one read of the
 * address list, one setAddresses, one setLogicalEmailMaps, and one
 * metadata/index cleanup regardless of how many inboxes are deleted. The
 * provider-side forget_me call stays per inbox (the API is per-address) but is
 * failure-isolated AND fanned out with bounded concurrency, so a single
 * hanging or failing inbox cannot abort or block the remaining deletes.
 *
 * @param addressIds - The IDs of the inboxes to delete
 * @param preserveEmails - Whether to preserve emails in archive (default: false)
 * @returns Per-address results in request order; missing inboxes are reported
 *          as isolated failures without aborting the batch.
 */
export async function deleteAddresses(
  addressIds: string[],
  preserveEmails: boolean = false
): Promise<DeleteAddressesResult> {
  const ids = [...new Set(addressIds.filter((id) => typeof id === 'string'))];
  if (ids.length === 0) return { results: [] };

  const results: DeleteAddressResult[] = [];
  const found: Array<{ id: string; record: Address }> = [];

  await withAddressLock(async () => {
    try {
      const addresses: Address[] = await getAddresses();

      // Resolve requested ids against the current list; a missing inbox is an
      // isolated per-id failure (same contract as the single delete) so one
      // stale selection can't abort the whole batch.
      const missing: string[] = [];
      for (const id of ids) {
        const record = addresses.find((i) => i.id === id);
        if (record) found.push({ id, record });
        else missing.push(id);
      }
      if (found.length === 0) {
        for (const id of missing) {
          results.push({ addressId: id, success: false, error: 'errors.addressNotFound' });
        }
        return;
      }

      // Call forget_me where the provider supports it - per inbox and isolated
      // so one failing or HANGING call can't abort or block the remaining
      // deletes. Bounded fan-out matters here because this section runs inside
      // the address lock: parallelizing keeps lock time near one request for N
      // inboxes instead of N wall-clock sequential requests.
      const forgetMeCalls = found
        .map((entry) => ({
          record: entry.record,
          config: loadProviderConfig(entry.record.provider),
        }))
        .filter(({ config }) => config.operations?.forgetMe);
      await runWithConcurrency(forgetMeCalls, FORGET_ME_CONCURRENCY, async ({ record, config }) => {
        try {
          const service = new EmailService(config, browser);
          await service.executeOperation('forgetMe', {
            auth: { token: record.sidToken as string },
            variables: { email_addr: record.address },
          });
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logError(
            'Error during forget_me:',
            { addressId: record.id, address: record.address, error: errorMessage },
            error instanceof Error ? error : new Error(errorMessage)
          );
          // Continue with deletion even if forget_me fails
        }
      });

      const deletedIds = new Set(found.map((f) => f.id));
      const updatedAddresses = addresses.filter((i: Address) => !deletedIds.has(i.id));

      if (preserveEmails) {
        // Side tables and mailbox maps are one read-modify-write transaction:
        // acquire the email lock before taking any snapshots so a concurrent
        // poll cannot add seen IDs after this delete's stale read.
        await withLock('emails_storage_lock', async () => {
          const { seenEmailIds = {} } = (await browser.storage.local.get(['seenEmailIds'])) as {
            seenEmailIds?: Record<string, string[]>;
          };
          for (const { record } of found) {
            delete seenEmailIds[resolveBagKey(seenEmailIds, record.address)];
          }

          // Latest-OTP cleanup and archiving use the same email lock without
          // recursively acquiring it.
          for (const { record } of found) {
            const { storedEmails: snapStored = {} } = await getEmailMaps();
            await updateLatestOtpAfterDeletion(record.address, snapStored);
            await clearStoredEmails(record.address, true);
          }
          await setAddresses(updatedAddresses);
          await removeLastMessageTimestamps(found.map(({ id }) => id));
          await safeStorageSet(browser, { seenEmailIds });
        });
      } else {
        const deletedEmailIds = new Set<string>();

        // Acquire the email storage lock BEFORE reading maps or side tables so
        // a concurrent storeNewMessages cannot land a new message between the
        // read and the delete's full-map writes.
        await withLock('emails_storage_lock', async () => {
          const {
            seenEmailIds = {},
            readEmails = {},
            starredEmails = [],
            emailLabels = {},
          } = (await browser.storage.local.get([
            'seenEmailIds',
            'readEmails',
            'starredEmails',
            'emailLabels',
          ])) as {
            seenEmailIds?: Record<string, string[]>;
            readEmails?: Record<string, boolean>;
            starredEmails?: string[];
            emailLabels?: Record<string, string[]>;
          };
          for (const { record } of found) {
            delete seenEmailIds[resolveBagKey(seenEmailIds, record.address)];
          }

          const { storedEmails = {}, archivedEmails = {} } = await getEmailMaps();
          for (const { record } of found) {
            const storedKey = resolveBagKey(storedEmails, record.address);
            const archivedKey = resolveBagKey(archivedEmails, record.address);
            const addressEmails = [
              ...(storedEmails[storedKey] || []),
              ...(archivedEmails[archivedKey] || []),
            ];
            for (const email of addressEmails) {
              // Legacy stars use bare IDs, while current stars are scoped to
              // the originating mailbox. Prune both forms on permanent delete.
              deletedEmailIds.add(email.id);
              const scopedStarKey = starKeyForEmail(email, record.address);
              if (scopedStarKey) deletedEmailIds.add(scopedStarKey);
              delete emailLabels[emailLabelKey(email.id, email.original_inbox || record.address)];
            }

            // Update latestOtp if it was from this deleted inbox address.
            // Called against the pre-deletion maps - the same semantics as N
            // sequential single deletes, minus the redundant re-reads.
            await updateLatestOtpAfterDeletion(record.address, storedEmails);

            delete storedEmails[storedKey];
            delete archivedEmails[archivedKey];

            for (const email of addressEmails) {
              const origAddr = email.original_inbox || record.address;
              delete readEmails[`${origAddr}_${email.id}`];
              delete readEmails[`${record.address}_${email.id}`];
              delete readEmails[email.id];
            }
          }

          await setAddresses(updatedAddresses);
          await setLogicalEmailMapsUnlockedForLockedCaller(storedEmails, archivedEmails);
          await removeLastMessageTimestamps(found.map(({ id }) => id));
          // A permanent delete must remove each address ID explicitly so its
          // current per-address bag cannot remain reachable from the index.
          for (const { id } of found) {
            await removeEmailStorageForAddress(id);
          }
          await safeStorageSet(browser, {
            seenEmailIds,
            readEmails,
            emailLabels,
            starredEmails: starredEmails.filter((emailId) => !deletedEmailIds.has(emailId)),
          });
        });
      }
      // Burn the deleted inboxes out of the intelligence stores: a deleted
      // address must not keep steering site replay (`lastAddressId` switches
      // the ACTIVE inbox on the next fill) or carrying a lifecycle value
      // score until the recency cap happens to evict it. Best-effort - a
      // purge failure must never fail the delete itself.
      try {
        const { forgetAddressesFromIntelligence } = await import(
          '@/features/intelligence/storage.js'
        );
        await forgetAddressesFromIntelligence(
          found.map(({ record }) => ({ id: record.id, address: record.address }))
        );
      } catch (intelligenceError) {
        logDebug(`intelligence forget failed: ${String(intelligenceError)}`);
      }
      // Assemble per-id outcomes mapped back over the RESOLVED request order
      // so callers can pair each result with its id (not-found first, success
      // second would silently reorder a mixed batch).
      const successIds = new Set(found.map((f) => f.id));
      for (const id of ids) {
        results.push(
          successIds.has(id)
            ? { addressId: id, success: true }
            : { addressId: id, success: false, error: 'errors.addressNotFound' }
        );
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logError(
        'Error deleting inboxes:',
        { addressIds: found.map((f) => f.id) },
        error instanceof Error ? error : new Error(errorMessage)
      );
      // The storage pass failed as a whole - every requested id failed with
      // the same error, again in request order.
      results.length = 0;
      for (const id of ids) {
        results.push({ addressId: id, success: false, error: toResultErrorKey(error) });
      }
    }
  });

  return { results };
}

/**
 * Deletes a single inbox from storage.
 * @param addressId - The ID of the inbox to delete
 * @param preserveEmails - Whether to preserve emails in archive (default: false)
 * @returns Promise resolving to delete result with success status
 */
export async function deleteAddress(
  addressId: string,
  preserveEmails: boolean = false
): Promise<DeleteAddressResult> {
  const batch = await deleteAddresses([addressId], preserveEmails);
  return batch.results[0] ?? { success: false, error: 'errors.addressNotFound' };
}

/**
 * Shared outcome assembly for the lifecycle batches: per-id results mapped
 * back over the RESOLVED request order so a mixed batch keeps its pairing
 * (missing ids get isolated not-found failures, never a reorder).
 */
function assembleLifecycleResults(
  ids: string[],
  foundIds: Set<string>,
  errorFor: (id: string) => string,
  outcomeById?: Map<string, AddressLifecycleResult>
): AddressLifecycleResult[] {
  const results: AddressLifecycleResult[] = [];
  for (const id of ids) {
    if (outcomeById) {
      const outcome = outcomeById.get(id);
      if (outcome) {
        results.push(outcome);
        continue;
      }
    }
    results.push(
      foundIds.has(id)
        ? { addressId: id, success: true }
        : { addressId: id, success: false, error: errorFor(id) }
    );
  }
  return results;
}

/**
 * Archives inboxes in one batched, locked pass.
 *
 * Mirror of deleteAddresses for the archive lifecycle: ONE withAddressLock,
 * one read of the address list, one setAddresses, and the per-address
 * clearStoredEmails (each internally emails_storage_lock-scoped) - instead of
 * N serial `archiveAddress` RPCs each re-reading and re-writing the whole list.
 * Missing inboxes are isolated per-id failures; results map back over request
 * order.
 */
export async function archiveAddresses(addressIds: string[]): Promise<AddressLifecycleBatchResult> {
  const ids = [...new Set(addressIds.filter((id): id is string => typeof id === 'string'))];
  if (ids.length === 0) return { results: [] };

  const results: AddressLifecycleResult[] = [];
  // `errors.*` codes, not prose: these land in the batch result payloads the
  // UI renders (see renderResultError at the consumers).
  const notFound = () => 'errors.addressNotFound';

  await withAddressLock(async () => {
    try {
      // Keep the encrypted raw records so the address list and mailbox bags can
      // be committed together without decrypting/re-encrypting credentials.
      const addresses: Address[] = await getRawAddresses();
      const foundIds = new Set<string>();
      for (const id of ids) {
        if (addresses.some((i) => i.id === id)) foundIds.add(id);
      }
      if (foundIds.size > 0) {
        const archivedAddresses = addresses.map((i) => {
          const next = foundIds.has(i.id)
            ? {
                ...i,
                accountStatus: 'archived' as const,
                archiveReason: 'manual' as const,
                archivedAt: Math.max(Date.now(), (i.archivedAt ?? 0) + 1),
                autoExtend: false,
                unarchiveAfterRenewal: undefined,
              }
            : { ...i };
          // Keep the same persistence invariant as setAddresses(): status is a
          // computed UI field, never part of the stored lifecycle record.
          delete (next as Address & { status?: string }).status;
          return next;
        });
        await archiveStoredEmailsAndCommitAddresses(archivedAddresses);
      }
      results.push(...assembleLifecycleResults(ids, foundIds, notFound));
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logError(
        'Error archiving inboxes:',
        { addressIds: ids },
        error instanceof Error ? error : new Error(errorMessage)
      );
      results.length = 0;
      for (const id of ids) {
        results.push({ addressId: id, success: false, error: toResultErrorKey(error) });
      }
    }
  });

  return { results };
}

/**
 * Unarchives inboxes in one batched, locked pass.
 *
 * Mirrors archiveAddresses: one read, one setAddresses, and per-address
 * restoreArchivedEmailsToStored (Offline Saved history back into the live bag)
 * instead of N serial `unarchiveAddress` RPCs.
 */
export async function unarchiveAddresses(
  addressIds: string[]
): Promise<AddressLifecycleBatchResult> {
  const ids = [...new Set(addressIds.filter((id): id is string => typeof id === 'string'))];
  if (ids.length === 0) return { results: [] };

  const results: AddressLifecycleResult[] = [];
  // `errors.*` codes, not prose: these land in the batch result payloads the
  // UI renders (see renderResultError at the consumers).
  const notFound = () => 'errors.addressNotFound';

  await withAddressLock(async () => {
    try {
      const addresses: Address[] = await getAddresses();
      const foundIds = new Set<string>();
      for (const id of ids) {
        if (addresses.some((i) => i.id === id)) foundIds.add(id);
      }
      if (foundIds.size > 0) {
        for (const id of foundIds) {
          const record = addresses.find((i) => i.id === id);
          if (record) await restoreArchivedEmailsToStored(record.address);
        }
        await setAddresses(
          addresses.map((i) => {
            if (!foundIds.has(i.id)) return i;
            const address = { ...i };
            delete address.archiveReason;
            delete address.archivedAt;
            delete address.unarchiveAfterRenewal;
            return { ...address, accountStatus: 'active' as const };
          })
        );
      }
      results.push(...assembleLifecycleResults(ids, foundIds, notFound));
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logError(
        'Error unarchiving inboxes:',
        { addressIds: ids },
        error instanceof Error ? error : new Error(errorMessage)
      );
      results.length = 0;
      for (const id of ids) {
        results.push({ addressId: id, success: false, error: toResultErrorKey(error) });
      }
    }
  });

  return { results };
}

/**
 * Renews inboxes in one batched, locked pass.
 *
 * The whole batch is ONE critical section: one address-list read, the per-inbox
 * provider renewal calls fanned out with bounded concurrency (each failure
 * isolated so a hanging/failing inbox can't block the others), each renewal
 * writing its token/expiry back into the shared list, and ONE setAddresses at
 * the end - instead of N serial `renewAddress` RPCs each re-reading the list
 * and re-entering the lock around its network call. Non-renewable or tokenless
 * inboxes are per-id rejections, mirroring the single handler's messages.
 */
export async function renewAddresses(addressIds: string[]): Promise<AddressLifecycleBatchResult> {
  const ids = [...new Set(addressIds.filter((id): id is string => typeof id === 'string'))];
  if (ids.length === 0) return { results: [] };

  const results: AddressLifecycleResult[] = [];
  // `errors.*` codes, not prose: these land in the batch result payloads the
  // UI renders (see renderResultError at the consumers).
  const notFound = () => 'errors.addressNotFound';

  await withAddressLock(async () => {
    try {
      const currentAddresses: Address[] = await getAddresses();
      const found: Array<{
        id: string;
        record: Address;
        config: ReturnType<typeof loadProviderConfig>;
      }> = [];
      for (const id of ids) {
        const record = currentAddresses.find((i) => i.id === id);
        if (record) found.push({ id, record, config: loadProviderConfig(record.provider) });
      }
      if (found.length === 0) {
        results.push(...assembleLifecycleResults(ids, new Set(), notFound));
        return;
      }

      const outcomeById = new Map<string, AddressLifecycleResult>();
      await runWithConcurrency(found, FORGET_ME_CONCURRENCY, async ({ id, record, config }) => {
        const renewalMethod = config.expiry?.renewalMethod;
        const supportsRenewal =
          config.expiry?.renewable === true || config.capabilities?.supportsRenew === true;
        const recordFailure = (error: string, retryEligible: boolean) => {
          if (retryEligible && record.autoExtend) {
            const addressIndex = currentAddresses.findIndex((item) => item.id === id);
            if (addressIndex !== -1) {
              currentAddresses[addressIndex] = {
                ...currentAddresses[addressIndex],
                ...getRenewalFailureUpdates(currentAddresses[addressIndex]),
              };
            }
          }
          outcomeById.set(id, { addressId: id, success: false, error });
        };
        try {
          if (!supportsRenewal || !renewalMethod) {
            recordFailure('errors.renewUnsupported', false);
            return;
          }
          const service = new EmailService(config, browser);
          const token = record.token || record.sidToken;
          if (!token) {
            recordFailure('errors.renewNoToken', true);
            return;
          }
          const currentUser = record.emailUser || record.address.split('@')[0];
          const renewalStart = Date.now();
          const renewalResponse = await service.executeOperation(renewalMethod, {
            auth: { token },
            variables: { emailUser: currentUser },
            // Keep renewal on the instance that owns this mailbox.
            ...(record.instanceUrl ? { instanceUrl: record.instanceUrl } : {}),
          });
          const measuredLatencyMs = Date.now() - renewalStart;

          // The list is read once and mutated per distinct index inside the
          // lock - safe to touch directly from the fanned-out tasks.
          const addressIndex = currentAddresses.findIndex((i: Address) => i.id === id);
          if (addressIndex === -1) {
            outcomeById.set(id, {
              addressId: id,
              success: false,
              error: 'errors.renewAddressGone',
            });
            return;
          }
          await restoreArchivedEmailsToStored(record.address);

          // No eager local_only marking - checkNewEmails' merge marks a
          // message local_only only when its ID is absent from the API response.
          const capturedCookieToken =
            config.auth.type === 'cookie' && config.auth.cookieName
              ? service.getSessionCookies()[config.auth.cookieName]
              : undefined;
          const newSidToken =
            typeof renewalResponse.token === 'string' && renewalResponse.token.trim()
              ? renewalResponse.token
              : capturedCookieToken ||
                currentAddresses[addressIndex].token ||
                currentAddresses[addressIndex].sidToken ||
                token;
          const timing = deriveAddressTiming(renewalResponse, config, Date.now(), {
            renewalBaseNow: true,
          });
          const prevCount = currentAddresses[addressIndex].renewalCount ?? 0;
          const renewedAddress: Address = {
            ...currentAddresses[addressIndex],
            token: newSidToken,
            sidToken: newSidToken,
            emailUser: currentUser,
            expiresAt: timing.expiresAt,
            expiryNotified: false,
            expiringSoonNotified: false,
            expiredNotified: false,
            renewalCount: prevCount + 1,
            renewalLatencyMs: measuredLatencyMs,
            lastRenewalAt: Date.now(),
            renewalFailCount: 0,
            lastFailureAt: undefined,
            nextRetryAt: undefined,
            accountStatus: 'active',
          };
          delete renewedAddress.archiveReason;
          delete renewedAddress.archivedAt;
          currentAddresses[addressIndex] = renewedAddress;
          outcomeById.set(id, { addressId: id, success: true, renewalCount: prevCount + 1 });
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logError(
            'Error during renewal:',
            { addressId: id, address: record.address, error: errorMessage },
            error instanceof Error ? error : new Error(errorMessage)
          );
          recordFailure(toResultErrorKey(error), supportsRenewal && !!renewalMethod);
        }
      });

      await setAddresses(currentAddresses);
      const foundIds = new Set(found.map((f) => f.id));
      results.push(...assembleLifecycleResults(ids, foundIds, notFound, outcomeById));
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logError(
        'Error renewing inboxes:',
        { addressIds: ids },
        error instanceof Error ? error : new Error(errorMessage)
      );
      results.length = 0;
      for (const id of ids) {
        results.push({ addressId: id, success: false, error: toResultErrorKey(error) });
      }
    }
  });

  return { results };
}

/**
 * Checks for new emails in a specific inbox
 * @param addressId - The ID of the inbox to check
 * @param filters - Email filtering options
 * @returns Promise resolving to an array of new emails
 * @throws AddressNotFoundError if the inbox is not found
 * @throws ApiError if email fetching fails
 */
export async function checkNewEmails(
  addressId: string,
  filters: EmailFilters = {}
): Promise<Email[]> {
  try {
    const addresses: Address[] = await getAddresses();
    const record = addresses.find((i) => i.id === addressId);
    if (!record) {
      throw new AddressNotFoundError(addressId, {
        reason: `Inbox with ID ${addressId} not found in storage`,
      });
    }

    // If inbox is archived, expired, or deleted, load emails from both archivedEmails and storedEmails storage and mark as local-only
    // expiresAt <= 0 means no expiry (treat as live)
    const isExpired = (record.expiresAt ?? 0) > 0 && Date.now() >= record.expiresAt;
    if (record.accountStatus === 'archived' || record.accountStatus === 'deleted' || isExpired) {
      const archived = await getArchivedEmailsForAddress(record.id, record.address);
      const stored = await getStoredEmailsForAddress(record.id, record.address);

      // Combine archived and stored emails, mark all as local-only
      const sinceFallback =
        isExpired && (record.expiresAt ?? 0) > 0 ? record.expiresAt : Date.now();
      const allLocalEmails = [...archived, ...stored].map((email) => ({
        ...email,
        local_only: true,
        local_only_since:
          email.local_only_since || email.local_deleted_at || email.stored_at || sinceFallback,
      }));

      // Use the same full filter implementation as live inboxes so archived
      // and expired inboxes honor sender, recipient, and date criteria too.
      return filterMessages(allLocalEmails, filters);
    }

    // If inbox is not archived, fetch from provider API and merge with stored emails
    let apiMessages: Email[] = [];
    const config = loadProviderConfig(record.provider);
    const service = new EmailService(config, browser);
    const fetchStarted = Date.now();

    // Read and respect forceNewSessions flag
    const { lastHardReset, forceNewSessions } = (await browser.storage.local.get([
      'lastHardReset',
      'forceNewSessions',
    ])) as { lastHardReset?: number; forceNewSessions?: boolean };
    let isForceActive = !!forceNewSessions;
    if (
      isForceActive &&
      lastHardReset &&
      Date.now() - lastHardReset > CONSTANTS.FORCE_NEW_SESSIONS_AUTO_CLEAR_MS
    ) {
      isForceActive = false;
      await browser.storage.local.remove('forceNewSessions').catch((error) =>
        logWarn('Failed to clear expired force-new-session flag', {
          addressId,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }

    try {
      apiMessages = await fetchEmails(
        config,
        record,
        (operationName, context) =>
          service.executeOperation(operationName, {
            ...context,
            forceNewSession: isForceActive || context?.forceNewSession,
          }),
        {} // Fetch all emails from the API, bypassing UI filters during fetch
      );
      await clearMailboxRefreshFailure(addressId);
      try {
        const { recordProviderFetch } = await import('@/features/intelligence/provider-health.js');
        await recordProviderFetch(record.provider, true, Date.now() - fetchStarted);
      } catch {
        /* ignore */
      }
    } catch (fetchError: unknown) {
      try {
        const { recordProviderFetch } = await import('@/features/intelligence/provider-health.js');
        const msg = fetchError instanceof Error ? fetchError.message : String(fetchError);
        await recordProviderFetch(record.provider, false, Date.now() - fetchStarted, msg);
      } catch {
        /* ignore */
      }
      const msg = fetchError instanceof Error ? fetchError.message : String(fetchError);
      const isNetworkError =
        msg.toLowerCase().includes('failed to fetch') ||
        msg.toLowerCase().includes('network') ||
        !navigator.onLine;
      if (isNetworkError) {
        await storeMailboxRefreshFailure(addressId, fetchError);
        const storedEmails = await getStoredEmails(record.address);
        return filterMessages(storedEmails, filters);
      }
      throw fetchError;
    }

    // Merge with stored emails to ensure we have all emails including those stored by periodic checks
    // Also pull any leftover archivedEmails bag (e.g. if unarchive restore raced) into the merge.
    let storedEmails = await getStoredEmails(record.address);
    try {
      const leftover = await getArchivedEmailsForAddress(record.id, record.address);
      if (leftover.length > 0) {
        await restoreArchivedEmailsToStored(record.address);
        storedEmails = await getStoredEmailsForAddress(record.id, record.address);
      }
    } catch {
      /* non-critical */
    }
    const mergedMessages = new Map<string, Email>();

    // Collect API email IDs for comparison
    const apiEmailIds = new Set(apiMessages.map((e) => e.id));

    const addrLower = record.address.toLowerCase();

    // Add stored emails first - only this address bag, mark local-only vs API
    for (const email of storedEmails) {
      const own = (email.original_inbox || record.address).toLowerCase();
      // Skip stored copies clearly belonging to another inbox
      if (own && own !== addrLower) continue;
      // A message is "Saved Offline" (local_only) when EITHER:
      //   1. Its ID is absent from the latest API response (server no longer has it), OR
      //   2. Its own independent retention window has passed (Model 2 - e.g. Guerrilla
      //      Mail's messageRetentionDuration), even if the server still returns it or
      //      the poll hasn't caught up yet.
      // `messageExpiresAt` is not persisted on stored emails (only computed for display
      // in email-mapper.ts), so derive the retention expiry from the provider config.
      const retentionExpired = isRetentionExpired(email, config);
      const isLocalOnly = !apiEmailIds.has(email.id) || retentionExpired;
      mergedMessages.set(`${record.address}_${email.id}`, {
        ...email,
        local_only: isLocalOnly,
        // Preserve first-seen local_only_since; set now when newly missing from server
        local_only_since: isLocalOnly
          ? email.local_only_since || email.local_deleted_at || Date.now()
          : undefined,
        original_inbox: record.address,
      });
    }

    // API results for THIS inbox session - force stamp to this address
    // (prevents cross-bag bleed when ids collide across accounts).
    // NOTE: A message present in the API response is live ONLY IF its own
    // independent retention has NOT expired (Model 2 - Guerrilla's
    // messageRetentionDuration). If the retention window has passed, keep it
    // marked local_only (Saved Offline) even though the server still returns it.
    for (const email of apiMessages) {
      const retentionExpired = isRetentionExpired(email, config);
      mergedMessages.set(`${record.address}_${email.id}`, {
        ...email,
        local_only: retentionExpired,
        local_only_since: retentionExpired ? email.local_only_since || Date.now() : undefined,
        original_inbox: record.address,
      });
    }

    // Convert back to array and sort by received_at descending
    const allMessages = Array.from(mergedMessages.values()).sort(
      (a, b) => b.received_at - a.received_at
    );

    // Persist local_only / local_only_since onto the stored bag so badges & tooltips survive reloads.
    // Guarded by emails_storage_lock (same lock as storeNewMessages / cleanupOldStoredEmails)
    // so a concurrent periodic check between this read and write can't be overwritten.
    try {
      await withLock('emails_storage_lock', async () => {
        // H-5: the inbox may have been deleted while the provider fetch was in
        // flight. Re-validate it still exists inside the lock so this write
        // can't resurrect its just-removed bag (ghosting seenEmailIds / quota).
        const stillExists = (await getAddresses()).some((i) => i.id === record.id);
        if (!stillExists) return;
        const bag = await getStoredEmailsForAddress(record.id, record.address);
        if (bag.length > 0) {
          let changed = false;
          const nextBag = bag.map((e) => {
            const m = mergedMessages.get(`${record.address}_${e.id}`);
            if (!m) return e;
            const since = m.local_only
              ? m.local_only_since || e.local_only_since || e.local_deleted_at || Date.now()
              : undefined;
            if (e.local_only === m.local_only && e.local_only_since === since) return e;
            changed = true;
            return {
              ...e,
              local_only: m.local_only,
              local_only_since: since,
            };
          });
          if (changed) {
            await setStoredEmailsForAddress(record.id, record.address, nextBag);
          }
        }
      });
    } catch {
      /* non-critical */
    }

    return filterMessages(allMessages, filters);
  } catch (error: unknown) {
    await storeMailboxRefreshFailure(addressId, error);
    // Anything the fetch/parse layer already classified keeps its code: a 503, a
    // provider rejection, a blocked redirect and an unreachable network each map
    // to their own stable key, and re-wrapping them into one generic API error
    // here is what used to erase the reason before the UI ever saw it.
    if (error instanceof BaseExtensionError) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(
      'Error checking emails:',
      { addressId },
      error instanceof Error ? error : new Error(errorMessage)
    );
    // Unclassified throwable (storage/DOM/plain Error): the raw text stays in
    // the log, the payload carries the generic API-failure key.
    throw new ApiError(`Failed to check emails for inbox ${addressId}: ${errorMessage}`, {
      addressId,
      originalError: error,
    });
  }
}

async function updateLatestOtpAfterDeletion(
  deletedAddress: string,
  remainingStored: Record<string, Email[]>
) {
  try {
    // Serialize against the live-delivery writer (email-storage M5) and the
    // rescan writer: both hold `latest_otp_lock` for their latestOtp
    // read-modify-write, so this recompute must too - otherwise a delivery
    // landing mid-recompute is lost (or this recompute resurrects an OTP the
    // removal handler just cleared). Lock order everywhere is
    // emails_storage_lock → latest_otp_lock (same as clearAllOtps), so nesting
    // here cannot deadlock. The tab broadcast stays outside the lock.
    const broadcast = await withLock('latest_otp_lock', async () => {
      const currentLatestOtp = (
        (await browser.storage.local.get('latestOtp')) as {
          latestOtp?: { sender: string; received_at: number; recipient?: string };
        }
      ).latestOtp;
      if (
        !currentLatestOtp?.recipient ||
        currentLatestOtp.recipient.toLowerCase() === deletedAddress.toLowerCase()
      ) {
        let maxOtpMsg: Email | null = null;
        let maxOtpAddress = '';
        for (const [addr, addressEmails] of Object.entries(remainingStored)) {
          if (addr.toLowerCase() === deletedAddress.toLowerCase()) continue;
          for (const m of addressEmails) {
            if (m.otp) {
              if (!maxOtpMsg || m.received_at > maxOtpMsg.received_at) {
                maxOtpMsg = m;
                maxOtpAddress = addr;
              }
            }
          }
        }
        if (maxOtpMsg) {
          const time = typeof timeAgo === 'function' ? timeAgo(maxOtpMsg.received_at) : '';
          const otpResult = {
            otp: maxOtpMsg.otp,
            sender: maxOtpMsg.from || '',
            senderName: maxOtpMsg.from_name || '',
            context: [maxOtpMsg.from_name ? `From: ${maxOtpMsg.from_name}` : '', time]
              .filter(Boolean)
              .join(' | '),
            received_at: maxOtpMsg.received_at,
          };
          await safeStorageSet(browser, { latestOtp: otpResult });
          // Broadcast to all webpage tabs so wait-OTP panels everywhere receive
          // it. The storage bag key the message was found under IS the recipient
          // address for recipient-matched wait panels. Returned (not awaited
          // here) so the broadcast happens after the lock is released.
          if (otpResult.otp) {
            return {
              otp: otpResult.otp,
              sender: otpResult.sender,
              senderName: otpResult.senderName,
              recipient: maxOtpAddress,
            };
          }
          return null;
        } else {
          await browser.storage.local.remove('latestOtp');
          return null;
        }
      }
    });
    if (broadcast) {
      await broadcastOtpToTabs(broadcast);
    }
  } catch (error: unknown) {
    logError('Error updating latest OTP after inbox deletion:', error);
  }
}

/**
 * Re-derive the near-expiry badge countdown alarm (idempotent, event-driven).
 *
 * The countdown is a one-shot CHAIN now instead of a 1-minute periodic alarm:
 * while the badge is actually displaying "{m}m" (active live inbox, autoExtend
 * off, inside NEAR_EXPIRY_BADGE_WINDOW_MS), a `near_expiry_badge` one-shot is
 * set for the next minute tick and the handler re-arms it after each fire -
 * so the alarm self-terminates the moment the countdown is irrelevant
 * (renewal took over, address changed, window passed) instead of waking the
 * service worker every minute all session.
 *
 * hardReset clears ALL alarms; this helper is called there so the countdown
 * resumes without waiting for a service-worker restart. The listener lives in
 * setupUnreadBadge (background/index.ts).
 */
export async function ensureBadgeCountdownAlarm(): Promise<void> {
  try {
    const { addresses = [], activeAddressId } = (await browser.storage.local.get([
      'addresses',
      'activeAddressId',
    ])) as {
      addresses?: Array<{
        id?: string;
        expiresAt?: number;
        autoExtend?: boolean;
        accountStatus?: AddressStatus;
      }>;
      activeAddressId?: string;
    };
    const now = Date.now();
    const active =
      addresses.find((i) => i.id === activeAddressId) ||
      addresses.find((i) => isLive({ accountStatus: i.accountStatus, expiresAt: i.expiresAt })) ||
      addresses[0];
    const counting = !!(
      active?.expiresAt &&
      active.expiresAt > now &&
      active.autoExtend !== true &&
      active.expiresAt - now <= CONSTANTS.NEAR_EXPIRY_BADGE_WINDOW_MS
    );
    const existing = await browser.alarms.get('near_expiry_badge');
    if (!counting) {
      if (existing) await browser.alarms.clear('near_expiry_badge');
      return;
    }
    // Next minute tick - or the expiry instant itself, whichever comes first
    // (firing at expiry lets the handler show the final state and then clear).
    // `counting` being true guarantees `active` exists with a future `expiresAt`.
    const expiresAt = active?.expiresAt ?? 0;
    const nextTick = Math.min(counting ? expiresAt : now + 60_000, now + 60_000);
    // Inside the coalescing window the existing fire time is close enough -
    // recreating every call would churn the alarm registry.
    if (existing && Math.abs((existing.scheduledTime ?? 0) - nextTick) < 30_000) return;
    if (existing) await browser.alarms.clear('near_expiry_badge');
    await browser.alarms.create('near_expiry_badge', { when: nextTick });
  } catch {
    /* alarms optional */
  }
}
