/**
 * Inbox creation, deletion, and email checking
 */

import { browser } from 'wxt/browser';
import { addActivityEvent } from '@/utils/activity-tracker.js';
import { FORCE_NEW_SESSIONS_AUTO_CLEAR_MS } from '@/utils/constants.js';
import { fetchEmails } from '@/utils/dsl/email-fetcher.js';
import { EmailService, loadProviderConfig } from '@/utils/email-service.js';
import {
  ApiError,
  InboxCreationError,
  InboxNotFoundError,
  InboxSessionConflictError,
  ProviderUnsupportedError,
} from '@/utils/errors.js';
import { getProviderInstancesWithCustom } from '@/utils/instance-manager.js';
import { log, logError } from '@/utils/logger.js';
import { withInboxLock } from '@/utils/mutex.js';
import { deriveInboxTiming } from '@/utils/provider-expiry.js';
import { randomItem } from '@/utils/secure-random.js';
import { getInboxes, getSelectedProvider } from '@/utils/storage-keys.js';
import { safeStorageSet } from '@/utils/storageMonitor.js';
import { timeAgo } from '@/utils/time.js';
import type {
  Account,
  Email,
  EmailFilters,
  MailProvider,
  ProviderInstance,
} from '@/utils/types.js';
import { incrementAnalytic } from './analytics.js';
import { clearStoredEmails, filterMessages, getStoredEmails } from './email-storage.js';

export interface DeleteInboxResult {
  success: boolean;
  error?: string;
}

/**
 * Creates a new email inbox using the specified provider
 * @param provider - Optional mail provider to use (defaults to selected provider in storage)
 * @param instanceId - Optional provider instance ID to use
 * @param emailUser - Optional email username for custom address
 * @returns Promise resolving to the created inbox account
 * @throws InboxCreationError if inbox creation fails
 * @throws ProviderUnsupportedError if the provider is not supported
 * @throws ApiError for other API-related errors
 */
let createInboxQueue: Promise<unknown> = Promise.resolve();

export function createInbox(
  provider?: MailProvider,
  instanceId?: string,
  emailUser?: string
): Promise<Account> {
  return new Promise((resolve, reject) => {
    createInboxQueue = createInboxQueue
      .catch(() => {}) // Recover queue state if previous task rejected
      .then(() => _createInbox(provider, instanceId, emailUser))
      .then(resolve, reject);
  });
}

function addressLocalPart(address: string): string {
  return (address.split('@')[0] || '').toLowerCase();
}

async function _createInbox(
  provider?: MailProvider,
  instanceId?: string,
  emailUser?: string
): Promise<Account> {
  const selectedProvider = await getSelectedProvider();

  if (!selectedProvider) {
    throw new ProviderUnsupportedError('No provider selected');
  }

  /** Throw if local-part or full address already exists in storage. */
  function throwIfDuplicateUsername(
    existingList: Account[],
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
      throw new InboxSessionConflictError({
        address: live.address,
        reason: 'duplicate_live',
        inboxId: live.id,
      });
    }
    const archived = matches.find((i) => i.accountStatus === 'archived');
    const expired = matches.find(
      (i) => (i.expiresAt > 0 && i.expiresAt <= Date.now()) || i.status === 'expired'
    );
    const pick = archived || expired || matches[0];
    throw new InboxSessionConflictError({
      address: pick.address,
      reason: 'duplicate_inactive',
      inboxId: pick.id,
      canUnarchive: !!archived,
      canRenew: !!expired && isProviderRenewableSafe(pick.provider),
      archivedInboxId: archived?.id,
      expiredInboxId: expired?.id,
    });
  }

  function isProviderRenewableSafe(provider: string): boolean {
    try {
      return !!loadProviderConfig(provider).expiry?.renewable;
    } catch {
      return false;
    }
  }

  // Pre-check custom username before hitting provider API
  if (emailUser?.trim()) {
    const { inboxes: existingList = [] } = (await browser.storage.local.get(['inboxes'])) as {
      inboxes?: Account[];
    };
    throwIfDuplicateUsername(existingList, emailUser);
  }

  // If instanceId is provided, use that provider
  let activeProvider: MailProvider;
  if (instanceId) {
    activeProvider = (provider || selectedProvider) as MailProvider;
  } else {
    activeProvider = (provider || selectedProvider) as MailProvider;
  }

  const createStarted = Date.now();
  try {
    const config = loadProviderConfig(activeProvider);
    let instanceUrl: string | undefined;
    let selectedInstance: ProviderInstance | null = null;

    // Handle multi-instance providers
    if (config.multiInstance?.enabled) {
      if (instanceId) {
        const instances = await getProviderInstancesWithCustom(activeProvider);
        selectedInstance = instances.find((i) => i.id === instanceId) || null;
      } else {
        // Random instance selection for multi-instance providers
        const instances = await getProviderInstancesWithCustom(activeProvider);
        if (instances.length === 0) {
          throw new InboxCreationError(activeProvider, {
            reason: `No instances available for ${activeProvider}. Please add instances in settings.`,
          });
        }
        selectedInstance = randomItem(instances) ?? null;
      }

      if (!selectedInstance) {
        throw new InboxCreationError(activeProvider, {
          reason: `Instance not found for ${activeProvider}. Please select an instance in settings.`,
        });
      }

      instanceUrl = selectedInstance.apiUrl;
    }

    const service = new EmailService(config, browser);
    const result = await service.executeOperation('createInbox', {
      instanceUrl,
      forceNewSession: true,
    });

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
    const inboxId = (id || address) as string;

    // Allow empty token for providers that sometimes return empty token (like Guerrilla Mail)
    if (!address) {
      logError('Missing required fields in API response', { result, address, token });
      throw new InboxCreationError(
        activeProvider,
        { response: result },
        new Error('Missing required fields in API response')
      );
    }

    const timing = deriveInboxTiming(timingSource, config);

    const inbox: Account = {
      id: inboxId,
      address: address as string,
      token: token as string,
      sidToken: token as string,
      provider: activeProvider,
      createdAt: timing.createdAt,
      expiresAt: timing.expiresAt,
      expiryNotified: false,
      autoExtend: false,
      ...(instanceUrl && { instanceUrl }),
    };

    const { inboxes = [], seenEmailIds = {} } = (await browser.storage.local.get([
      'inboxes',
      'seenEmailIds',
    ])) as { inboxes?: Account[]; seenEmailIds?: Record<string, string[]> };

    // Final guard: block any same local-part or exact address already stored
    // (covers random API reuse and post-setEmailUser collisions)
    throwIfDuplicateUsername(inboxes, addressLocalPart(inbox.address), inbox.address);

    // Provider reliability graph — successful create
    try {
      const { recordProviderCreate } = await import('@/features/intelligence/provider-health.js');
      await recordProviderCreate(activeProvider, true, Date.now() - createStarted);
    } catch {
      /* ignore */
    }

    inboxes.push(inbox);
    seenEmailIds[inbox.address] = [];

    await incrementAnalytic('accountsCreated');
    // Always select the newly created mailbox (context menu + UI share this path)
    await safeStorageSet(browser, {
      inboxes,
      seenEmailIds,
      activeInboxId: inbox.id,
      onboardingComplete: true,
    });

    // Track account creation activity
    await addActivityEvent('account_created', {
      inboxAddress: inbox.address,
    });

    // Rescan forms on every open tab so Autofill All appears without a second create
    try {
      const { ensureTabAutofillReady } = await import('../tab-autofill.js');
      const tabs = await browser.tabs.query({});
      for (const tab of tabs) {
        if (tab.id == null) continue;
        void ensureTabAutofillReady(tab.id).catch(() => {});
      }
    } catch {
      /* optional */
    }

    return inbox;
  } catch (error: unknown) {
    // Preserve structured duplicate/conflict errors for UI (warn + unarchive/renew)
    if (error instanceof InboxSessionConflictError) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    try {
      const { recordProviderCreate } = await import('@/features/intelligence/provider-health.js');
      await recordProviderCreate(activeProvider, false, Date.now() - createStarted, errorMessage);
    } catch {
      /* ignore */
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

/**
 * Deletes an inbox from storage
 * @param inboxId - The ID of the inbox to delete
 * @param preserveEmails - Whether to preserve emails in archive (default: false)
 * @returns Promise resolving to delete result with success status
 */
export async function deleteInbox(
  inboxId: string,
  preserveEmails: boolean = false
): Promise<DeleteInboxResult> {
  return withInboxLock(async () => {
    try {
      const inboxes: Account[] = await getInboxes();
      const inbox = inboxes.find((i) => i.id === inboxId);

      if (!inbox) {
        return { success: false, error: `Inbox with ID ${inboxId} not found` };
      }

      const config = loadProviderConfig(inbox.provider);

      // Call forget_me if provider supports it
      if (config.operations?.forgetMe) {
        try {
          const service = new EmailService(config, browser);
          await service.executeOperation('forgetMe', {
            auth: { token: inbox.sidToken as string },
            variables: { email_addr: inbox.address },
          });
          await service.executeOperation('createInbox', { forceNewSession: true });
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logError(
            'Error during forget_me:',
            { inboxId: inbox.id, inboxAddress: inbox.address, error: errorMessage },
            error instanceof Error ? error : new Error(errorMessage)
          );
          // Continue with deletion even if forget_me fails
        }
      }

      const updatedInboxes = inboxes.filter((i: Account) => i.id !== inboxId);

      const {
        seenEmailIds = {},
        lastMessageTimestamps = {},
        storedEmails = {},
        archivedEmails = {},
        readEmails = {},
        starredEmails = [],
      } = (await browser.storage.local.get([
        'seenEmailIds',
        'lastMessageTimestamps',
        'storedEmails',
        'archivedEmails',
        'readEmails',
        'starredEmails',
      ])) as {
        seenEmailIds?: Record<string, string[]>;
        lastMessageTimestamps?: Record<string, number>;
        storedEmails?: Record<string, Email[]>;
        archivedEmails?: Record<string, Email[]>;
        readEmails?: Record<string, boolean>;
        starredEmails?: string[];
      };

      delete seenEmailIds[inbox.address];
      delete lastMessageTimestamps[inboxId];
      let deletedEmailIds = new Set<string>();

      // Update latestOtp if it was from this deleted inbox address
      await updateLatestOtpAfterDeletion(inbox.address, storedEmails);

      if (preserveEmails) {
        await clearStoredEmails(inbox.address);
        await safeStorageSet(browser, {
          inboxes: updatedInboxes,
          seenEmailIds,
          lastMessageTimestamps,
        });
      } else {
        deletedEmailIds = new Set<string>([
          ...(storedEmails[inbox.address] || []).map((email) => email.id),
          ...(archivedEmails[inbox.address] || []).map((email) => email.id),
        ]);

        delete storedEmails[inbox.address];
        delete archivedEmails[inbox.address];

        for (const emailId of deletedEmailIds) {
          delete readEmails[`${inbox.address}_${emailId}`];
          delete readEmails[emailId];
        }

        await safeStorageSet(browser, {
          inboxes: updatedInboxes,
          seenEmailIds,
          lastMessageTimestamps,
          storedEmails,
          archivedEmails,
          readEmails,
          starredEmails: starredEmails.filter((emailId) => !deletedEmailIds.has(emailId)),
        });
      }
      return { success: true };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logError(
        'Error deleting inbox:',
        { inboxId },
        error instanceof Error ? error : new Error(errorMessage)
      );
      return { success: false, error: errorMessage };
    }
  });
}

/**
 * Checks for new emails in a specific inbox
 * @param inboxId - The ID of the inbox to check
 * @param filters - Email filtering options
 * @returns Promise resolving to an array of new emails
 * @throws InboxNotFoundError if the inbox is not found
 * @throws ApiError if email fetching fails
 */
export async function checkNewEmails(
  inboxId: string,
  filters: EmailFilters = {}
): Promise<Email[]> {
  try {
    const inboxes: Account[] = await getInboxes();
    const inbox = inboxes.find((i) => i.id === inboxId);
    if (!inbox) {
      throw new InboxNotFoundError(inboxId, {
        reason: `Inbox with ID ${inboxId} not found in storage`,
      });
    }

    // If inbox is archived, expired, or deleted, load emails from both archivedEmails and storedEmails storage and mark as local-only
    // expiresAt <= 0 means no expiry (treat as live)
    const isExpired = (inbox.expiresAt ?? 0) > 0 && Date.now() > inbox.expiresAt;
    if (inbox.accountStatus === 'archived' || inbox.accountStatus === 'deleted' || isExpired) {
      const { archivedEmails = {}, storedEmails = {} } = (await browser.storage.local.get([
        'archivedEmails',
        'storedEmails',
      ])) as {
        archivedEmails?: Record<string, Email[]>;
        storedEmails?: Record<string, Email[]>;
      };
      const archived = archivedEmails[inbox.address] || [];
      const stored = storedEmails[inbox.address] || [];

      // Combine archived and stored emails, mark all as local-only
      const sinceFallback = isExpired && (inbox.expiresAt ?? 0) > 0 ? inbox.expiresAt : Date.now();
      const allLocalEmails = [...archived, ...stored].map((email) => ({
        ...email,
        local_only: true,
        local_only_since:
          email.local_only_since || email.local_deleted_at || email.stored_at || sinceFallback,
      }));

      // Apply filters to local emails
      let filtered = allLocalEmails;
      if (filters.searchQuery) {
        const query = filters.searchQuery.toLowerCase();
        filtered = filtered.filter(
          (e) =>
            e.subject?.toLowerCase().includes(query) ||
            e.from_name?.toLowerCase().includes(query) ||
            e.from?.toLowerCase().includes(query)
        );
      }
      if (filters.hasOTP) {
        filtered = filtered.filter((e) => e.otp && e.otp !== '------');
      }

      return filtered;
    }

    // If inbox is not archived, fetch from provider API and merge with stored emails
    let apiMessages: Email[] = [];
    const config = loadProviderConfig(inbox.provider);
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
      Date.now() - lastHardReset > FORCE_NEW_SESSIONS_AUTO_CLEAR_MS
    ) {
      isForceActive = false;
      await browser.storage.local.remove('forceNewSessions').catch(() => {});
    }

    try {
      apiMessages = await fetchEmails(
        config,
        inbox,
        (operationName, context) =>
          service.executeOperation(operationName, {
            ...context,
            forceNewSession: isForceActive || context?.forceNewSession,
          }),
        {} // Fetch all emails from the API, bypassing UI filters during fetch
      );
      try {
        const { recordProviderFetch } = await import('@/features/intelligence/provider-health.js');
        await recordProviderFetch(inbox.provider, true, Date.now() - fetchStarted);
      } catch {
        /* ignore */
      }
    } catch (fetchError: unknown) {
      try {
        const { recordProviderFetch } = await import('@/features/intelligence/provider-health.js');
        const msg = fetchError instanceof Error ? fetchError.message : String(fetchError);
        await recordProviderFetch(inbox.provider, false, Date.now() - fetchStarted, msg);
      } catch {
        /* ignore */
      }
      throw fetchError;
    }

    // Merge with stored emails to ensure we have all emails including those stored by periodic checks
    const storedEmails = await getStoredEmails(inbox.address);
    const mergedMessages = new Map<string, Email>();

    // Collect API email IDs for comparison
    const apiEmailIds = new Set(apiMessages.map((e) => e.id));

    const addrLower = inbox.address.toLowerCase();

    // Add stored emails first - only this address bag, mark local-only vs API
    for (const email of storedEmails) {
      const own = (email.original_inbox || inbox.address).toLowerCase();
      // Skip stored copies clearly belonging to another inbox
      if (own && own !== addrLower) continue;
      const isLocalOnly = !apiEmailIds.has(email.id);
      mergedMessages.set(email.id, {
        ...email,
        local_only: isLocalOnly,
        // Preserve first-seen local_only_since; set now when newly missing from server
        local_only_since: isLocalOnly
          ? email.local_only_since || email.local_deleted_at || Date.now()
          : undefined,
        original_inbox: inbox.address,
      });
    }

    // API results for THIS inbox session - force stamp to this address
    // (prevents cross-bag bleed when ids collide across accounts)
    for (const email of apiMessages) {
      mergedMessages.set(email.id, {
        ...email,
        local_only: false,
        local_only_since: undefined,
        original_inbox: inbox.address,
      });
    }

    // Convert back to array and sort by received_at descending
    const allMessages = Array.from(mergedMessages.values()).sort(
      (a, b) => b.received_at - a.received_at
    );

    // Persist local_only / local_only_since onto the stored bag so badges & tooltips survive reloads
    try {
      const { storedEmails = {} } = (await browser.storage.local.get(['storedEmails'])) as {
        storedEmails?: Record<string, Email[]>;
      };
      const bag = storedEmails[inbox.address] || [];
      if (bag.length > 0) {
        let changed = false;
        const nextBag = bag.map((e) => {
          const m = mergedMessages.get(e.id);
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
          await browser.storage.local.set({
            storedEmails: { ...storedEmails, [inbox.address]: nextBag },
          });
        }
      }
    } catch {
      /* non-critical */
    }

    return filterMessages(allMessages, filters);
  } catch (error: unknown) {
    if (error instanceof InboxNotFoundError || error instanceof ApiError) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(
      'Error checking emails:',
      { inboxId },
      error instanceof Error ? error : new Error(errorMessage)
    );
    throw new ApiError(`Failed to check emails for inbox ${inboxId}: ${errorMessage}`, {
      inboxId,
      originalError: error,
    });
  }
}

// Re-export functions from split modules for backward compatibility
export { checkInboxExpiry, setupInboxExpiryCheck } from './expiry-manager.js';
export { setupPeriodicEmailCheck } from './periodic-checks.js';

async function updateLatestOtpAfterDeletion(
  deletedAddress: string,
  remainingStored: Record<string, Email[]>
) {
  try {
    const currentLatestOtp = (
      (await browser.storage.local.get('latestOtp')) as {
        latestOtp?: { sender: string; received_at: number };
      }
    ).latestOtp;
    if (currentLatestOtp?.sender.toLowerCase().includes(deletedAddress.toLowerCase())) {
      let maxOtpMsg: Email | null = null;
      for (const [addr, inboxEmails] of Object.entries(remainingStored)) {
        if (addr.toLowerCase() === deletedAddress.toLowerCase()) continue;
        for (const m of inboxEmails) {
          if (m.otp) {
            if (!maxOtpMsg || m.received_at > maxOtpMsg.received_at) {
              maxOtpMsg = m;
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
      } else {
        await browser.storage.local.remove('latestOtp');
      }
    }
  } catch (error: unknown) {
    logError('Error updating latest OTP after inbox deletion:', error);
  }
}
