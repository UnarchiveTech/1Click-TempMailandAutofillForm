/**
 * Runtime message handler — routes incoming messages to the appropriate module functions
 */

import { DEFAULT_PROVIDER, EmailService, loadProviderConfig } from '@/utils/email-service.js';
import { getErrorMessage } from '@/utils/errors.js';
import {
  addCustomProviderInstance,
  getProviderInstances,
  getSelectedProviderInstance,
  initializeDefaultProvider,
  removeCustomProviderInstance,
} from '@/utils/instance-manager.js';
import { logError, logInfo, logWarn } from '@/utils/logger.js';
import { getInboxes, getSelectedProvider, setInboxes } from '@/utils/storage-keys.js';
import type { Account, ProviderInstance, RuntimeMessageSender } from '@/utils/types.js';
import { validateCustomInstanceName, validateCustomInstanceUrl } from '@/utils/validation.js';
import { handleUpdateSessionCredentials } from '../credentials/session-credentials.js';
import { getAnalytics, recordUIRenderTime } from '../inbox/analytics.js';
import {
  cleanupOldStoredEmails,
  clearStoredEmails,
  getArchivedEmails,
  getEmailsToBeDeleted,
  getStorageUsage,
} from '../inbox/email-storage.js';
import {
  checkNewEmails,
  createInbox,
  deleteInbox,
  setupInboxExpiryCheck,
  setupPeriodicEmailCheck,
} from '../inbox/inbox-manager.js';
import { updateRefreshAlarm } from '../inbox/periodic-checks.js';

export function registerMessageHandler(): void {
  browser.runtime.onMessage.addListener(
    // biome-ignore lint/suspicious/noExplicitAny: Chrome runtime message listener requires any for discriminated union
    (message: any, sender: RuntimeMessageSender, sendResponse: (response: unknown) => void) => {
      logInfo('Received message:', { message });

      if (message.type === 'createInbox') {
        (async () => {
          try {
            const provider = message.provider || (await getSelectedProvider());
            const instanceId = message.instanceId;

            const inbox = await createInbox(provider, instanceId, message.emailUser);
            sendResponse({ success: true, inbox });
          } catch (error: unknown) {
            sendResponse({ success: false, error: getErrorMessage(error) });
          }
        })();
        return true;
      }

      if (message.type === 'checkEmails') {
        (async () => {
          try {
            const messages = await checkNewEmails(message.inboxId, message.filters);
            sendResponse({ success: true, messages });
          } catch (error: unknown) {
            sendResponse({ success: false, error: getErrorMessage(error) });
          }
        })();
        return true;
      }

      if (message.type === 'deleteInbox') {
        (async () => {
          try {
            const result = await deleteInbox(message.inboxId, message.preserveEmails ?? false);
            sendResponse(result);
          } catch (error: unknown) {
            sendResponse({ success: false, error: getErrorMessage(error) });
          }
        })();
        return true;
      }

      if (message.type === 'restoreInbox') {
        (async () => {
          try {
            const inboxes = await getInboxes();
            const inbox = inboxes.find((i) => i.id === message.inboxId);
            if (!inbox) {
              sendResponse({ success: false, error: 'Inbox not found' });
              return;
            }
            await setInboxes(
              inboxes.map((i) =>
                i.id === message.inboxId ? { ...i, accountStatus: 'active' as const } : i
              )
            );
            sendResponse({ success: true });
          } catch (e) {
            logError('restoreInbox error:', e);
            sendResponse({ success: false, error: 'Failed to restore inbox' });
          }
        })();
        return true;
      }

      if (message.type === 'getInboxes') {
        (async () => {
          try {
            const inboxes = await getInboxes();
            sendResponse({ success: true, inboxes });
          } catch (error: unknown) {
            sendResponse({ success: false, error: getErrorMessage(error) });
          }
        })();
        return true;
      }

      if (message.type === 'setProvider') {
        (async () => {
          try {
            await browser.storage.local.set({ selectedProvider: message.provider as string });
            sendResponse({ success: true });
          } catch (error: unknown) {
            sendResponse({ success: false, error: getErrorMessage(error) });
          }
        })();
        return true;
      }

      if (message.type === 'updateInboxTag') {
        (async () => {
          try {
            const inboxes = await getInboxes();
            const inboxIndex = inboxes.findIndex((i) => i.id === message.inboxId);
            if (inboxIndex === -1) {
              sendResponse({ success: false, error: 'Inbox not found' });
              return;
            }
            inboxes[inboxIndex].tag = message.tag;
            inboxes[inboxIndex].tagColor = message.color || null;
            await setInboxes(inboxes);
            sendResponse({ success: true });
          } catch (error: unknown) {
            sendResponse({ success: false, error: getErrorMessage(error) });
          }
        })();
        return true;
      }

      if (message.type === 'archiveInbox') {
        (async () => {
          try {
            const inboxes = await getInboxes();
            const inbox = inboxes.find((i) => i.id === message.inboxId);
            if (!inbox) {
              sendResponse({ success: false, error: 'Inbox not found' });
              return;
            }
            await clearStoredEmails(inbox.address);
            await setInboxes(
              inboxes.map((i) =>
                i.id === message.inboxId ? { ...i, accountStatus: 'archived' as const } : i
              )
            );
            sendResponse({ success: true });
          } catch (e) {
            logError('archiveInbox error:', e);
            sendResponse({ success: false, error: 'Failed to archive inbox' });
          }
        })();
        return true;
      }

      if (message.type === 'unarchiveInbox') {
        (async () => {
          try {
            const inboxes = await getInboxes();
            const inbox = inboxes.find((i) => i.id === message.inboxId);
            if (!inbox) {
              sendResponse({ success: false, error: 'Inbox not found' });
              return;
            }
            await setInboxes(
              inboxes.map((i) =>
                i.id === message.inboxId ? { ...i, accountStatus: 'active' as const } : i
              )
            );
            sendResponse({ success: true });
          } catch (e) {
            logError('unarchiveInbox error:', e);
            sendResponse({ success: false, error: 'Failed to unarchive inbox' });
          }
        })();
        return true;
      }

      if (message.type === 'getProvider') {
        (async () => {
          try {
            const selectedProvider = await getSelectedProvider();
            sendResponse({ success: true, provider: selectedProvider });
          } catch (error: unknown) {
            sendResponse({ success: false, error: getErrorMessage(error) });
          }
        })();
        return true;
      }

      if (message.type === 'clearSessionCredentials') {
        (async () => {
          try {
            await browser.storage.session.remove('sessionCredentials');
            sendResponse({ success: true });
          } catch (error: unknown) {
            sendResponse({ success: false, error: getErrorMessage(error) });
          }
        })();
        return true;
      }

      if (message.type === 'updateSessionCredentials') {
        (async () => {
          try {
            const result = await handleUpdateSessionCredentials(message, sender);
            sendResponse(result);
          } catch (error: unknown) {
            sendResponse({ success: false, error: getErrorMessage(error) });
          }
        })();
        return true;
      }

      if (message.type === 'getAnalytics') {
        (async () => {
          try {
            const analytics = await getAnalytics();
            sendResponse({ success: true, analytics });
          } catch (error: unknown) {
            sendResponse({ success: false, error: getErrorMessage(error) });
          }
        })();
        return true;
      }

      if (message.type === 'recordUIRenderTime') {
        (async () => {
          try {
            await recordUIRenderTime(message.renderTime);
            sendResponse({ success: true });
          } catch (error: unknown) {
            sendResponse({ success: false, error: getErrorMessage(error) });
          }
        })();
        return true;
      }

      if (message.action === 'getArchivedEmails') {
        (async () => {
          try {
            const archivedEmails = await getArchivedEmails(message.inboxAddress);
            sendResponse({ success: true, archivedEmails });
          } catch (error: unknown) {
            sendResponse({ success: false, error: getErrorMessage(error) });
          }
        })();
        return true;
      }

      if (message.action === 'getStorageUsage') {
        (async () => {
          try {
            const usage = await getStorageUsage();
            sendResponse({ success: true, usage });
          } catch (error: unknown) {
            sendResponse({ success: false, error: getErrorMessage(error) });
          }
        })();
        return true;
      }

      if (message.action === 'getEmailsToBeDeleted') {
        (async () => {
          try {
            const count = await getEmailsToBeDeleted(message.retentionDays || 30);
            sendResponse({ success: true, count });
          } catch (error: unknown) {
            sendResponse({ success: false, error: getErrorMessage(error) });
          }
        })();
        return true;
      }

      if (message.action === 'cleanupOldStoredEmails') {
        (async () => {
          try {
            await cleanupOldStoredEmails(
              message.activeRetentionDays || 30,
              message.archivedRetentionDays || 90
            );
            sendResponse({ success: true });
          } catch (error: unknown) {
            sendResponse({ success: false, error: getErrorMessage(error) });
          }
        })();
        return true;
      }

      if (message.action === 'hardReset') {
        (async () => {
          try {
            await browser.alarms.clearAll();
            await browser.storage.session.clear();
            try {
              if (self.caches) {
                const cacheNames = await self.caches.keys();
                for (const cacheName of cacheNames) {
                  await self.caches.delete(cacheName);
                }
              }
            } catch {
              /* non-critical */
            }
            await browser.storage.local.set({ lastHardReset: Date.now(), forceNewSessions: true });
            setupPeriodicEmailCheck(checkNewEmails);
            setupInboxExpiryCheck();
            sendResponse({ success: true });
          } catch (error: unknown) {
            sendResponse({ success: false, error: getErrorMessage(error) });
          }
        })();
        return true;
      }

      if (message.action === 'getProviderInstances') {
        (async () => {
          try {
            const provider = message.provider || DEFAULT_PROVIDER;
            const instances = await getProviderInstances(provider);
            sendResponse({ success: true, instances });
          } catch (error: unknown) {
            sendResponse({ success: false, error: getErrorMessage(error) });
          }
        })();
        return true;
      }

      if (message.type === 'renewInbox') {
        (async () => {
          try {
            const inboxes = await getInboxes();
            const inbox = inboxes.find((i) => i.id === message.inboxId);
            if (!inbox) {
              sendResponse({ success: false, error: 'Inbox not found' });
              return;
            }
            const providerConfig = loadProviderConfig(inbox.provider);
            if (!providerConfig.expiry?.renewable) {
              sendResponse({
                success: false,
                error: 'This provider does not support inbox renewal',
              });
              return;
            }
            // Auto-renew inbox using provider config
            const config = loadProviderConfig(inbox.provider);
            const service = new EmailService(config, browser);

            if (!inbox.sidToken) {
              sendResponse({ success: false, error: 'No sidToken available for renewal' });
              return;
            }

            const currentUser = inbox.address.split('@')[0];
            const newEmailResponse = await service.executeOperation('createInbox', {
              forceNewSession: true,
            });

            if (!newEmailResponse.token) {
              sendResponse({ success: false, error: 'Failed to get fresh token for renewal' });
              return;
            }

            const newSidToken = newEmailResponse.token as string;

            // Call renewal operation from config
            if (providerConfig.expiry?.renewalMethod) {
              await service.executeOperation(providerConfig.expiry.renewalMethod, {
                auth: { token: newSidToken },
                variables: { emailUser: currentUser },
              });
            }

            const allInboxes = await getInboxes();
            const inboxIndex = allInboxes.findIndex((i: Account) => i.id === inbox.id);

            if (inboxIndex !== -1) {
              const timestamp = newEmailResponse.timestamp as number;
              const expiryConfig = loadProviderConfig(inbox.provider);
              allInboxes[inboxIndex] = {
                ...allInboxes[inboxIndex],
                sidToken: newSidToken,
                expiresAt:
                  ((timestamp || 0) + (expiryConfig.expiry?.duration || 3600000) / 1000) * 1000,
                expiryNotified: false,
              };
              await setInboxes(allInboxes);
            }

            sendResponse({ success: true });
          } catch (error: unknown) {
            sendResponse({ success: false, error: getErrorMessage(error) });
          }
        })();
        return true;
      }

      if (message.action === 'getProviderInstances') {
        (async () => {
          try {
            const provider = message.provider || DEFAULT_PROVIDER;
            const instances = await getProviderInstances(provider);
            sendResponse({ success: true, instances });
          } catch (error: unknown) {
            sendResponse({ success: false, error: getErrorMessage(error) });
          }
        })();
        return true;
      }

      if (message.action === 'addCustomInstance') {
        (async () => {
          try {
            const instance = message.instance as Omit<ProviderInstance, 'id' | 'isCustom'>;
            validateCustomInstanceName(instance.name);
            validateCustomInstanceUrl(instance.apiUrl);
            const provider = await getSelectedProvider();
            await addCustomProviderInstance(provider, instance);
            sendResponse({ success: true });
          } catch (error: unknown) {
            sendResponse({ success: false, error: getErrorMessage(error) });
          }
        })();
        return true;
      }

      if (message.action === 'removeCustomInstance') {
        (async () => {
          try {
            const provider = await getSelectedProvider();
            await removeCustomProviderInstance(provider, message.instanceId as string);
            sendResponse({ success: true });
          } catch (error: unknown) {
            sendResponse({ success: false, error: getErrorMessage(error) });
          }
        })();
        return true;
      }

      if (message.action === 'getSelectedInstance') {
        (async () => {
          try {
            const provider = await getSelectedProvider();
            const instance = await getSelectedProviderInstance(provider);
            sendResponse({ success: true, instance });
          } catch (error: unknown) {
            sendResponse({ success: false, error: getErrorMessage(error) });
          }
        })();
        return true;
      }

      if (message.action === 'setSelectedInstance' || message.action === 'setInstance') {
        (async () => {
          try {
            await browser.storage.local.set({ selectedInstance: message.instanceId });
            sendResponse({ success: true });
          } catch (error: unknown) {
            sendResponse({ success: false, error: getErrorMessage(error) });
          }
        })();
        return true;
      }

      if (message.action === 'addCustomBurnerInstance') {
        (async () => {
          try {
            const instance = message.instance as Omit<ProviderInstance, 'id' | 'isCustom'>;
            validateCustomInstanceName(instance.name);
            validateCustomInstanceUrl(instance.apiUrl);
            const provider = await getSelectedProvider();
            await addCustomProviderInstance(provider, instance);
            sendResponse({ success: true });
          } catch (error: unknown) {
            sendResponse({ success: false, error: getErrorMessage(error) });
          }
        })();
        return true;
      }

      if (message.action === 'removeCustomProviderInstance') {
        (async () => {
          try {
            const provider = await getSelectedProvider();
            await removeCustomProviderInstance(provider, message.instanceId as string);
            sendResponse({ success: true });
          } catch (error: unknown) {
            sendResponse({ success: false, error: getErrorMessage(error) });
          }
        })();
        return true;
      }

      if (message.action === 'getSelectedProviderInstance') {
        (async () => {
          try {
            const provider = await getSelectedProvider();
            const instance = await getSelectedProviderInstance(provider);
            sendResponse({ success: true, instance });
          } catch (error: unknown) {
            sendResponse({ success: false, error: getErrorMessage(error) });
          }
        })();
        return true;
      }

      if (message.action === 'setSelectedProviderInstance') {
        (async () => {
          try {
            const provider = await getSelectedProvider();
            const storageKey = `selectedInstance_${provider}`;
            await browser.storage.local.set({ [storageKey]: message.instanceId as string });
            sendResponse({ success: true });
          } catch (error: unknown) {
            sendResponse({ success: false, error: getErrorMessage(error) });
          }
        })();
        return true;
      }

      if (message.action === 'initializeDefaultProvider') {
        (async () => {
          try {
            await initializeDefaultProvider();
            sendResponse({ success: true });
          } catch (error: unknown) {
            sendResponse({ success: false, error: getErrorMessage(error) });
          }
        })();
        return true;
      }

      if (message.action === 'providerApiCall') {
        (async () => {
          try {
            const config = loadProviderConfig(message.provider);
            const service = new EmailService(config, browser);
            const data = await service.executeOperation(message.func, {
              auth: message.sidToken ? { token: message.sidToken } : undefined,
              variables: message.params || {},
            });
            sendResponse({ success: true, data });
          } catch (error: unknown) {
            sendResponse({ success: false, error: getErrorMessage(error) });
          }
        })();
        return true;
      }

      if (message.type === 'fetchFavicon') {
        (async () => {
          try {
            const { url } = message as { url: string };
            logInfo('fetchFavicon requested', { url });
            const response = await fetch(url);
            logInfo('fetchFavicon response status', { status: response.status });
            if (!response.ok) {
              sendResponse({ success: false, error: `HTTP ${response.status}` });
              return;
            }
            const buffer = await response.arrayBuffer();
            const uint8 = new Uint8Array(buffer);
            logInfo('fetchFavicon buffer size', { size: uint8.length });
            // Compute SHA-256 hash in background (MD5 not supported by Web Crypto)
            const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
            logInfo('fetchFavicon hash', { hash });
            // Convert to base64 for transfer
            let binary = '';
            for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
            const base64 = btoa(binary);
            const contentType = response.headers.get('content-type') || 'image/x-icon';
            logInfo('fetchFavicon success, sending response');
            sendResponse({ success: true, base64, contentType, hash });
          } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            logError('fetchFavicon error', msg);
            sendResponse({ success: false, error: msg });
          }
        })();
        return true;
      }

      if (message.type === 'updateRefreshInterval') {
        (async () => {
          try {
            await updateRefreshAlarm(message.intervalMs as number);
            sendResponse({ success: true });
          } catch (error: unknown) {
            sendResponse({ success: false, error: getErrorMessage(error) });
          }
        })();
        return true;
      }

      logWarn('Unknown message type', { type: message.type });
      return false;
    }
  );

  browser.commands.onCommand.addListener(async (command: string) => {
    if (command === 'autofill-form') {
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (tab.id) {
          await browser.tabs.sendMessage(tab.id, { type: 'autofillForm' }).catch(() => {
            // Ignore if content script not loaded in the tab
          });
        }
      } catch (error: unknown) {
        logError(
          'Error executing autofill command:',
          undefined,
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
  });
}
