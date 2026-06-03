/**
 * Inbox creation, deletion, and email checking
 */

import { browser } from 'wxt/browser';
import { addActivityEvent } from '@/utils/activity-tracker.js';
import { fetchEmails } from '@/utils/dsl/email-fetcher.js';
import { EmailService, loadProviderConfig } from '@/utils/email-service.js';
import {
  ApiError,
  InboxCreationError,
  InboxNotFoundError,
  InboxSessionConflictError,
  ProviderUnsupportedError,
} from '@/utils/errors.js';
import { getProviderInstances } from '@/utils/instance-manager.js';
import { log, logError } from '@/utils/logger.js';
import { randomItem } from '@/utils/secure-random.js';
import { getInboxes, getSelectedProvider } from '@/utils/storage-keys.js';
import type {
  Account,
  Email,
  EmailFilters,
  MailProvider,
  ProviderInstance,
} from '@/utils/types.js';
import { incrementAnalytic } from './analytics.js';
import { clearStoredEmails, getStoredEmails } from './email-storage.js';

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
let createInboxQueue = Promise.resolve();

export function createInbox(
  provider?: MailProvider,
  instanceId?: string,
  emailUser?: string
): Promise<Account> {
  return new Promise((resolve, reject) => {
    createInboxQueue = createInboxQueue
      .then(() => _createInbox(provider, instanceId, emailUser))
      .then(resolve)
      .catch(reject);
  });
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

  // If instanceId is provided, use that provider
  let activeProvider: MailProvider;
  if (instanceId) {
    activeProvider = (provider || selectedProvider) as MailProvider;
  } else {
    activeProvider = (provider || selectedProvider) as MailProvider;
  }

  try {
    let inbox: Account;

    const config = loadProviderConfig(activeProvider);
    let instanceUrl: string | undefined;
    let selectedInstance: ProviderInstance | null = null;

    // Handle multi-instance providers
    if (config.multiInstance?.enabled) {
      if (instanceId) {
        const instances = await getProviderInstances(activeProvider);
        selectedInstance = instances.find((i) => i.id === instanceId) || null;
      } else {
        // Random instance selection for multi-instance providers
        const instances = await getProviderInstances(activeProvider);
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
        address = setEmailResult.email_addr || customAddress;
        id = setEmailResult.email_addr || customAddress;
        token = setEmailResult.token || token;
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

    inbox = {
      id: inboxId,
      address: address as string,
      token: token as string,
      sidToken: token as string,
      provider: activeProvider,
      createdAt: Date.now(),
      expiresAt: Date.now() + (config.expiry?.duration || 3600000),
      expiryNotified: false,
      autoExtend: false,
      ...(instanceUrl && { instanceUrl }),
    };

    const { inboxes = [], seenEmailIds = {} } = (await browser.storage.local.get([
      'inboxes',
      'seenEmailIds',
    ])) as { inboxes?: Account[]; seenEmailIds?: Record<string, string[]> };

    const existingInbox = inboxes.find((e) => e.address === inbox.address);

    if (existingInbox) {
      if (config.expiry?.renewable) {
        const now = Date.now();
        const isExpired = existingInbox.expiresAt && now > existingInbox.expiresAt;

        if (!isExpired && existingInbox.accountStatus !== 'archived') {
          // Reuse existing valid inbox, update its sidToken
          const inboxIndex = inboxes.findIndex((i: Account) => i.address === existingInbox.address);
          if (inboxIndex !== -1 && inbox.sidToken) {
            inboxes[inboxIndex].sidToken = inbox.sidToken;
            await browser.storage.local.set({ inboxes });
          }
          return inboxes[inboxIndex] || existingInbox;
        } else {
          // Expired/archived: call forget_me if provider supports it and get fresh address
          try {
            const config = loadProviderConfig(activeProvider);
            if (config.operations?.forgetMe) {
              await service.executeOperation('forgetMe', {
                auth: { token: inbox.sidToken as string },
                variables: { email_addr: inbox.address },
              });
            }
            const freshData = await service.executeOperation('createInbox', {
              forceNewSession: true,
            });
            if (freshData.address && freshData.address !== inbox.address) {
              inbox.address = freshData.address as string;
              inbox.id = freshData.address as string;
              inbox.sidToken = freshData.token as string;
              const timestamp = freshData.timestamp as number;
              inbox.expiresAt =
                ((timestamp || 0) + (config.expiry?.duration || 3600000) / 1000) * 1000;

              const stillDuplicate = inboxes.find(
                (i: Account) => i.address === inbox.address && i.accountStatus !== 'archived'
              );
              if (stillDuplicate) {
                throw new InboxSessionConflictError({ address: inbox.address });
              }
              const cleaned = inboxes.filter((i: Account) => i.address !== existingInbox.address);
              cleaned.push(inbox);
              await browser.storage.local.set({ inboxes: cleaned });
              log('Created fresh inbox after forgetting expired one');
              return inbox;
            }
          } catch (error: unknown) {
            logError('Error during forget_me and fresh inbox creation:', error);
            throw new InboxCreationError(activeProvider, {
              reason: 'Failed to create fresh inbox',
            });
            // Continue with new inbox even if forget_me fails
          }
        }
      } else {
        // Provider doesn't support renewal - throw error if inbox already exists
        throw new InboxSessionConflictError({ address: inbox.address });
      }
    }

    inboxes.push(inbox);
    seenEmailIds[inbox.address] = [];

    await incrementAnalytic('accountsCreated');
    await browser.storage.local.set({ inboxes, seenEmailIds });

    // Track account creation activity
    await addActivityEvent('account_created', {
      inboxAddress: inbox.address,
    });

    return inbox;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
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
    if (inbox) {
      delete seenEmailIds[inbox.address];
      delete lastMessageTimestamps[inboxId];
      let deletedEmailIds = new Set<string>();

      if (preserveEmails) {
        await clearStoredEmails(inbox.address);
        await browser.storage.local.set({
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

        await browser.storage.local.set({
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
    }

    return { success: false, error: `Inbox with ID ${inboxId} not found` };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(
      'Error deleting inbox:',
      { inboxId },
      error instanceof Error ? error : new Error(errorMessage)
    );
    return { success: false, error: errorMessage };
  }
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
    if (
      inbox.accountStatus === 'archived' ||
      inbox.accountStatus === 'deleted' ||
      Date.now() > (inbox.expiresAt || 0)
    ) {
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
      const allLocalEmails = [...archived, ...stored].map((email) => ({
        ...email,
        local_only: true,
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
    apiMessages = await fetchEmails(
      config,
      inbox,
      (operationName, context) => service.executeOperation(operationName, context),
      filters
    );

    // Merge with stored emails to ensure we have all emails including those stored by periodic checks
    const storedEmails = await getStoredEmails(inbox.address);
    const mergedMessages = new Map<string, Email>();

    // Collect API email IDs for comparison
    const apiEmailIds = new Set(apiMessages.map((e) => e.id));

    // Add stored emails first, marking local-only ones
    for (const email of storedEmails) {
      const isLocalOnly = !apiEmailIds.has(email.id);
      mergedMessages.set(email.id, { ...email, local_only: isLocalOnly });
    }

    // Add API emails, overwriting stored ones if same ID (they're not local-only)
    for (const email of apiMessages) {
      mergedMessages.set(email.id, { ...email, local_only: false });
    }

    // Convert back to array and sort by received_at descending
    const allMessages = Array.from(mergedMessages.values()).sort(
      (a, b) => b.received_at - a.received_at
    );

    return allMessages;
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
