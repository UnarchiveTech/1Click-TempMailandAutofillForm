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
import type {
  Account,
  EmailFilters,
  ProviderInstance,
  RuntimeMessageSender,
  SessionCredentials,
} from '@/utils/types.js';
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

interface RuntimeMessage {
  [key: string]: unknown;
  type?: string;
  action?: string;
  activeRetentionDays?: number;
  archivedRetentionDays?: number;
  color?: string;
  credentials?: Partial<SessionCredentials>;
  emailUser?: string;
  filters?: EmailFilters;
  func?: string;
  inboxAddress?: string;
  inboxId?: string;
  instance?: Omit<ProviderInstance, 'id' | 'isCustom'>;
  instanceId?: string;
  intervalMs?: number;
  params?: Record<string, unknown>;
  preserveEmails?: boolean;
  provider?: string;
  renderTime?: number;
  retentionDays?: number;
  sidToken?: string;
  tag?: string;
  url?: string;
}

type HandlerFn = (
  message: RuntimeMessage,
  sender: RuntimeMessageSender,
  sendResponse: (response: unknown) => void
) => Promise<void>;

function requireString(message: RuntimeMessage, key: keyof RuntimeMessage): string {
  const value = message[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing required message field: ${String(key)}`);
  }
  return value;
}

function requireNumber(message: RuntimeMessage, key: keyof RuntimeMessage): number {
  const value = message[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Missing required message field: ${String(key)}`);
  }
  return value;
}

const handlers: Record<string, HandlerFn> = {
  createInbox: async (message, _sender, sendResponse) => {
    try {
      const provider = message.provider || (await getSelectedProvider());
      const inbox = await createInbox(provider, message.instanceId, message.emailUser);
      sendResponse({ success: true, inbox });
    } catch (error: unknown) {
      sendResponse({ success: false, error: getErrorMessage(error) });
    }
  },

  checkEmails: async (message, _sender, sendResponse) => {
    try {
      const messages = await checkNewEmails(requireString(message, 'inboxId'), message.filters);
      sendResponse({ success: true, messages });
    } catch (error: unknown) {
      sendResponse({ success: false, error: getErrorMessage(error) });
    }
  },

  deleteInbox: async (message, _sender, sendResponse) => {
    try {
      const result = await deleteInbox(
        requireString(message, 'inboxId'),
        message.preserveEmails ?? false
      );
      sendResponse(result);
    } catch (error: unknown) {
      sendResponse({ success: false, error: getErrorMessage(error) });
    }
  },

  restoreInbox: async (message, _sender, sendResponse) => {
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
  },

  getInboxes: async (_message, _sender, sendResponse) => {
    try {
      const inboxes = await getInboxes();
      sendResponse({ success: true, inboxes });
    } catch (error: unknown) {
      sendResponse({ success: false, error: getErrorMessage(error) });
    }
  },

  setProvider: async (message, _sender, sendResponse) => {
    try {
      await browser.storage.local.set({ selectedProvider: message.provider as string });
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse({ success: false, error: getErrorMessage(error) });
    }
  },

  updateInboxTag: async (message, _sender, sendResponse) => {
    try {
      const inboxes = await getInboxes();
      const inboxIndex = inboxes.findIndex((i) => i.id === message.inboxId);
      if (inboxIndex === -1) {
        sendResponse({ success: false, error: 'Inbox not found' });
        return;
      }
      const updatedInboxes = inboxes.map((i) =>
        i.id === message.inboxId
          ? { ...i, tag: message.tag, tagColor: message.color || undefined }
          : i
      );
      await setInboxes(updatedInboxes);
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse({ success: false, error: getErrorMessage(error) });
    }
  },

  archiveInbox: async (message, _sender, sendResponse) => {
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
  },

  unarchiveInbox: async (message, _sender, sendResponse) => {
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
  },

  getProvider: async (_message, _sender, sendResponse) => {
    try {
      const selectedProvider = await getSelectedProvider();
      sendResponse({ success: true, provider: selectedProvider });
    } catch (error: unknown) {
      sendResponse({ success: false, error: getErrorMessage(error) });
    }
  },

  clearSessionCredentials: async (_message, _sender, sendResponse) => {
    try {
      await browser.storage.session.remove('sessionCredentials');
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse({ success: false, error: getErrorMessage(error) });
    }
  },

  updateSessionCredentials: async (message, sender, sendResponse) => {
    try {
      const result = await handleUpdateSessionCredentials(
        {
          type: 'updateSessionCredentials',
          credentials: message.credentials ?? {},
        },
        sender
      );
      sendResponse(result);
    } catch (error: unknown) {
      sendResponse({ success: false, error: getErrorMessage(error) });
    }
  },

  getAnalytics: async (_message, _sender, sendResponse) => {
    try {
      const analytics = await getAnalytics();
      sendResponse({ success: true, analytics });
    } catch (error: unknown) {
      sendResponse({ success: false, error: getErrorMessage(error) });
    }
  },

  recordUIRenderTime: async (message, _sender, sendResponse) => {
    try {
      await recordUIRenderTime(requireNumber(message, 'renderTime'));
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse({ success: false, error: getErrorMessage(error) });
    }
  },

  getArchivedEmails: async (message, _sender, sendResponse) => {
    try {
      const archivedEmails = await getArchivedEmails(message.inboxAddress);
      sendResponse({ success: true, archivedEmails });
    } catch (error: unknown) {
      sendResponse({ success: false, error: getErrorMessage(error) });
    }
  },

  getStorageUsage: async (_message, _sender, sendResponse) => {
    try {
      const usage = await getStorageUsage();
      sendResponse({ success: true, usage });
    } catch (error: unknown) {
      sendResponse({ success: false, error: getErrorMessage(error) });
    }
  },

  getEmailsToBeDeleted: async (message, _sender, sendResponse) => {
    try {
      const count = await getEmailsToBeDeleted(message.retentionDays || 30);
      sendResponse({ success: true, count });
    } catch (error: unknown) {
      sendResponse({ success: false, error: getErrorMessage(error) });
    }
  },

  cleanupOldStoredEmails: async (message, _sender, sendResponse) => {
    try {
      await cleanupOldStoredEmails(
        message.activeRetentionDays || 30,
        message.archivedRetentionDays || 90
      );
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse({ success: false, error: getErrorMessage(error) });
    }
  },

  hardReset: async (_message, _sender, sendResponse) => {
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
  },

  getProviderInstances: async (message, _sender, sendResponse) => {
    try {
      const provider = message.provider || DEFAULT_PROVIDER;
      const instances = await getProviderInstances(provider);
      sendResponse({ success: true, instances });
    } catch (error: unknown) {
      sendResponse({ success: false, error: getErrorMessage(error) });
    }
  },

  renewInbox: async (message, _sender, sendResponse) => {
    try {
      const inboxes = await getInboxes();
      const inbox = inboxes.find((i) => i.id === message.inboxId);
      if (!inbox) {
        sendResponse({ success: false, error: 'Inbox not found' });
        return;
      }
      const providerConfig = loadProviderConfig(inbox.provider);
      if (!providerConfig.expiry?.renewable) {
        sendResponse({ success: false, error: 'This provider does not support inbox renewal' });
        return;
      }
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
      if (providerConfig.expiry?.renewalMethod) {
        await service.executeOperation(providerConfig.expiry.renewalMethod, {
          auth: { token: newSidToken },
          variables: { emailUser: currentUser },
        });
      }
      const inboxIndex = inboxes.findIndex((i: Account) => i.id === inbox.id);
      if (inboxIndex !== -1) {
        const timestamp = newEmailResponse.timestamp as number;
        const expiryConfig = loadProviderConfig(inbox.provider);
        inboxes[inboxIndex] = {
          ...inboxes[inboxIndex],
          sidToken: newSidToken,
          expiresAt: ((timestamp || 0) + (expiryConfig.expiry?.duration || 3600000) / 1000) * 1000,
        };
        await setInboxes(inboxes);
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'Inbox disappeared during renewal' });
      }
    } catch (error: unknown) {
      sendResponse({ success: false, error: getErrorMessage(error) });
    }
  },

  addCustomInstance: async (message, _sender, sendResponse) => {
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
  },

  removeCustomInstance: async (message, _sender, sendResponse) => {
    try {
      const provider = await getSelectedProvider();
      await removeCustomProviderInstance(provider, message.instanceId as string);
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse({ success: false, error: getErrorMessage(error) });
    }
  },

  getSelectedInstance: async (_message, _sender, sendResponse) => {
    try {
      const provider = await getSelectedProvider();
      const instance = await getSelectedProviderInstance(provider);
      sendResponse({ success: true, instance });
    } catch (error: unknown) {
      sendResponse({ success: false, error: getErrorMessage(error) });
    }
  },

  setSelectedInstance: async (message, _sender, sendResponse) => {
    try {
      const provider = await getSelectedProvider();
      const storageKey = `selectedInstance_${provider}`;
      await browser.storage.local.set({ [storageKey]: message.instanceId as string });
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse({ success: false, error: getErrorMessage(error) });
    }
  },

  initializeDefaultProvider: async (_message, _sender, sendResponse) => {
    try {
      await initializeDefaultProvider();
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse({ success: false, error: getErrorMessage(error) });
    }
  },

  providerApiCall: async (message, _sender, sendResponse) => {
    try {
      const config = loadProviderConfig(requireString(message, 'provider'));
      const service = new EmailService(config, browser);
      const data = await service.executeOperation(requireString(message, 'func'), {
        auth: message.sidToken ? { token: message.sidToken } : undefined,
        variables: message.params || {},
      });
      sendResponse({ success: true, data });
    } catch (error: unknown) {
      sendResponse({ success: false, error: getErrorMessage(error) });
    }
  },

  fetchFavicon: async (message, _sender, sendResponse) => {
    try {
      const { url } = message as { url: string };
      logInfo('fetchFavicon requested', { url });

      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
        throw new Error('Invalid protocol: only http and https are allowed');
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 seconds timeout

      const response = await fetch(parsedUrl.toString(), { signal: controller.signal });
      clearTimeout(timeoutId);

      logInfo('fetchFavicon response status', { status: response.status });
      if (!response.ok) {
        sendResponse({ success: false, error: `HTTP ${response.status}` });
        return;
      }
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > 5 * 1024 * 1024) {
        throw new Error('Favicon too large');
      }
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > 5 * 1024 * 1024) {
        throw new Error('Favicon too large');
      }
      const uint8 = new Uint8Array(buffer);
      logInfo('fetchFavicon buffer size', { size: uint8.length });
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
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
  },

  updateRefreshInterval: async (message, _sender, sendResponse) => {
    try {
      const ms = message.intervalMs as number;
      if (typeof ms !== 'number' || ms < 10000 || ms > 3600000) {
        throw new Error('Refresh interval must be between 10s and 1hr');
      }
      await updateRefreshAlarm(ms);
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse({ success: false, error: getErrorMessage(error) });
    }
  },
};

// Aliases — multiple message keys can map to the same handler
const aliases: Record<string, string> = {
  removeCustomProviderInstance: 'removeCustomInstance',
  addCustomProviderInstance: 'addCustomInstance',
  getSelectedProviderInstance: 'getSelectedInstance',
  setSelectedProviderInstance: 'setSelectedInstance',
  setInstance: 'setSelectedInstance',
};

function resolveHandlerKey(message: RuntimeMessage): string | undefined {
  if (message.type && handlers[message.type]) return message.type;
  if (message.action && aliases[message.action] && handlers[aliases[message.action]])
    return aliases[message.action];
  if (message.action && handlers[message.action]) return message.action;
  return undefined;
}

export function registerMessageHandler(): void {
  browser.runtime.onMessage.addListener(
    (message: unknown, sender: RuntimeMessageSender, sendResponse: (response: unknown) => void) => {
      if (sender.id !== browser.runtime.id) {
        logWarn('Rejected message from unauthorized sender:', { senderId: sender.id });
        return false;
      }

      if (typeof message !== 'object' || message === null) return false;
      const runtimeMessage = message as RuntimeMessage;
      logInfo('Received message:', { message: runtimeMessage });

      const handlerKey = resolveHandlerKey(runtimeMessage);
      if (handlerKey) {
        handlers[handlerKey](runtimeMessage, sender, sendResponse);
        return true;
      }

      logWarn('Unknown message type', { type: runtimeMessage.type, action: runtimeMessage.action });
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
