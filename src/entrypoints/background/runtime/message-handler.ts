/**
 * Runtime message handler - routes incoming messages to the appropriate module functions
 */

import { findSiteReplayForDomain } from '@/features/login-info/login-crypto.js';
import { FORCE_NEW_SESSIONS_AUTO_CLEAR_MS } from '@/utils/constants.js';
import {
  DEFAULT_PROVIDER,
  EmailService,
  getAllProviderConfigs,
  loadProviderConfig,
} from '@/utils/email-service.js';
import { getErrorMessage } from '@/utils/errors.js';
import { t } from '@/utils/i18n-utils.js';
import {
  addCustomProviderInstance,
  getProviderInstancesWithCustom,
  getSelectedProviderInstance,
  initializeDefaultProvider,
  removeCustomProviderInstance,
} from '@/utils/instance-manager.js';
import {
  isSafeFetchUrl,
  validateCustomInstanceName,
  validateCustomInstanceUrl,
} from '@/utils/instance-validation.js';
import { logError, logInfo, logWarn } from '@/utils/logger.js';
import { withInboxLock } from '@/utils/mutex.js';
import { deriveInboxTiming } from '@/utils/provider-expiry.js';
import { getInboxes, getSelectedProvider, setInboxes } from '@/utils/storage-keys.js';
import type {
  Account,
  EmailFilters,
  ProviderInstance,
  RuntimeMessageSender,
  SessionCredentials,
} from '@/utils/types.js';
import { handleUpdateSessionCredentials } from '../credentials/session-credentials.js';
import {
  getAnalytics,
  recordEmailRead,
  recordExtensionOpen,
  recordPageVisit,
  recordUIRenderTime,
  resetAnalyticsData,
} from '../inbox/analytics.js';
import {
  cleanupOldStoredEmails,
  clearAllOtps,
  clearStoredEmails,
  getArchivedEmails,
  getEmailsToBeDeleted,
  getStorageUsage,
  storeNewMessages,
} from '../inbox/email-storage.js';
import {
  checkNewEmails,
  createInbox,
  deleteInbox,
  setupInboxExpiryCheck,
  setupPeriodicEmailCheck,
} from '../inbox/inbox-manager.js';
import { updateRefreshAlarm } from '../inbox/periodic-checks.js';

export interface RuntimeMessage {
  [key: string]: unknown;
  type?: string;
  action?: string;
  activeRetentionDays?: number;
  archivedRetentionDays?: number;
  color?: string;
  credentials?: Partial<SessionCredentials>;
  domain?: string;
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

export function requireString(message: RuntimeMessage, key: keyof RuntimeMessage): string {
  const value = message[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing required message field: ${String(key)}`);
  }
  return value;
}

export function requireNumber(message: RuntimeMessage, key: keyof RuntimeMessage): number {
  const value = message[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Missing required message field: ${String(key)}`);
  }
  return value;
}

const handlers: Record<string, HandlerFn> = {
  /** Open extension UI from content script (setup / renew prompts). */
  openExtensionUi: async (message, _sender, sendResponse) => {
    try {
      const reason = String((message as { reason?: string }).reason || 'setup');
      const hint = String((message as { hint?: string }).hint || '');
      // Identity handoffs from content Autofill All menu
      const viewPayload: Record<string, unknown> = {
        openExtensionReason: reason,
        openExtensionHint: hint,
        openExtensionAt: Date.now(),
      };
      if (reason === 'create-identity' || hint === 'create-identity') {
        viewPayload.openView = 'autofill';
        viewPayload.autofillTab = 'profiles';
        viewPayload.openIdentityCreate = true;
      } else if (reason === 'edit-identity' || hint === 'edit-identity') {
        viewPayload.openView = 'autofill';
        viewPayload.autofillTab = 'profiles';
      }
      try {
        await browser.storage.session.set(viewPayload);
      } catch {
        await browser.storage.local.set(viewPayload);
      }
      // Prefer popup when available (user gesture from content click)
      try {
        const action = (
          browser as unknown as {
            action?: { openPopup?: () => Promise<void> };
          }
        ).action;
        if (action?.openPopup) {
          await action.openPopup();
          sendResponse({ success: true, opened: 'popup' });
          return;
        }
      } catch {
        /* openPopup may be unavailable */
      }
      const url = (browser.runtime as unknown as { getURL: (p: string) => string }).getURL(
        `/app.html?reason=${encodeURIComponent(reason)}`
      );
      await browser.tabs.create({ url });
      sendResponse({ success: true, opened: 'tab' });
    } catch (error: unknown) {
      sendResponse({ success: false, error: getErrorMessage(error) });
    }
  },

  createInbox: async (message, _sender, sendResponse) => {
    try {
      // Demo mode is fully client-side — refuse real provider creates
      const { demoMode } = (await browser.storage.local.get(['demoMode'])) as {
        demoMode?: boolean;
      };
      if (demoMode) {
        sendResponse({
          success: false,
          error: 'Demo mode is active — use the UI demo create path',
        });
        return;
      }

      const allIds = getAllProviderConfigs().map((p) => p.id);
      const selected = await getSelectedProvider();
      const msg = message as RuntimeMessage & {
        provider?: string;
        instanceId?: string;
        emailUser?: string;
        domain?: string;
        skipHealthPick?: boolean;
      };

      // Healthy provider auto-pick (+ site rule) when user didn't pin a provider
      let provider = msg.provider || selected || DEFAULT_PROVIDER;
      let pickReason: string = msg.provider ? 'explicit' : 'prefer';

      if (!msg.skipHealthPick) {
        try {
          const { resolveCreateProvider, getProviderFailoverOrder, recordProviderCreate } =
            await import('@/features/intelligence/provider-health.js');
          const resolved = await resolveCreateProvider({
            providerIds: allIds,
            explicitProviderId: msg.provider || null,
            domain: msg.domain || null,
            preferProviderId: selected || DEFAULT_PROVIDER,
            forceHealthPick: !msg.provider,
          });
          if (resolved.providerId) {
            provider = resolved.providerId;
            pickReason = resolved.reason;
          }

          const order = msg.provider
            ? [provider]
            : [provider, ...(await getProviderFailoverOrder(allIds, [provider])).slice(0, 3)];
          const tried = new Set<string>();
          let lastError: unknown;
          for (const pid of order) {
            if (!pid || tried.has(pid)) continue;
            tried.add(pid);
            const t0 = Date.now();
            try {
              const inbox = await createInbox(pid, msg.instanceId, msg.emailUser);
              void recordProviderCreate(pid, true, Date.now() - t0);
              sendResponse({
                success: true,
                inbox,
                providerId: pid,
                healthPick: pickReason === 'health' || pickReason === 'rule',
                pickReason,
              });
              return;
            } catch (err: unknown) {
              lastError = err;
              void recordProviderCreate(pid, false, Date.now() - t0, getErrorMessage(err));
              const e = err as { context?: { reason?: string } };
              if (
                e?.context?.reason === 'duplicate_live' ||
                e?.context?.reason === 'duplicate_inactive'
              ) {
                throw err;
              }
              // Explicit provider: no failover
              if (msg.provider) throw err;
            }
          }
          throw lastError || new Error('All providers failed');
        } catch (healthErr: unknown) {
          // Conflicts always bubble; other errors from health path also bubble
          // (failover already exhausted). Fallback only if intelligence module failed to load.
          const msgText = getErrorMessage(healthErr);
          if (
            healthErr &&
            typeof healthErr === 'object' &&
            ((healthErr as { context?: { reason?: string } }).context?.reason ||
              !msgText.includes('Cannot find module'))
          ) {
            throw healthErr;
          }
        }
      }

      const inbox = await createInbox(provider, msg.instanceId, msg.emailUser);
      sendResponse({ success: true, inbox, providerId: provider, pickReason });
    } catch (error: unknown) {
      // Preserve structured conflict context for UI recovery (unarchive/renew).
      // Also unwrap nested originalError when ApiError re-wrapped a conflict.
      let ctx: Record<string, unknown> | undefined;
      if (error && typeof error === 'object') {
        const e = error as {
          context?: Record<string, unknown>;
          originalError?: { context?: Record<string, unknown> };
        };
        ctx = e.context;
        if (
          (!ctx || (ctx.reason !== 'duplicate_live' && ctx.reason !== 'duplicate_inactive')) &&
          e.originalError?.context
        ) {
          ctx = e.originalError.context;
        }
        // ApiError sometimes stuffed originalError inside context
        const nested = ctx?.originalError as { context?: Record<string, unknown> } | undefined;
        if (
          nested?.context &&
          (nested.context.reason === 'duplicate_live' ||
            nested.context.reason === 'duplicate_inactive')
        ) {
          ctx = nested.context;
        }
      }
      if (ctx && (ctx.reason === 'duplicate_live' || ctx.reason === 'duplicate_inactive')) {
        sendResponse({ success: false, error: ctx });
      } else {
        sendResponse({ success: false, error: getErrorMessage(error) });
      }
    }
  },

  checkEmails: async (message, _sender, sendResponse) => {
    try {
      const inboxId = requireString(message, 'inboxId');
      // Demo: return stored bag only, never hit real providers
      const {
        demoMode,
        storedEmails = {},
        inboxes = [],
      } = (await browser.storage.local.get(['demoMode', 'storedEmails', 'inboxes'])) as {
        demoMode?: boolean;
        storedEmails?: Record<string, import('@/utils/types.js').Email[]>;
        inboxes?: import('@/utils/types.js').Account[];
      };
      const demoInbox = inboxes.find((i) => i.id === inboxId);
      if (demoMode || demoInbox?.provider === 'demo') {
        const addr = demoInbox?.address || '';
        const bag = (addr && storedEmails[addr]) || [];
        sendResponse({ success: true, messages: bag });
        return;
      }

      const messages = await checkNewEmails(inboxId, message.filters);

      const liveInboxes = await getInboxes();
      const inbox = liveInboxes.find((i) => i.id === inboxId);
      if (inbox && messages.length > 0) {
        const apiMsgs = messages.filter((m) => !m.local_only);
        if (apiMsgs.length > 0) {
          await storeNewMessages(inbox.address, apiMsgs);
        }
      }

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
      await withInboxLock(async () => {
        const inboxes = await getInboxes();
        const inboxIndex = inboxes.findIndex((i) => i.id === message.inboxId);
        if (inboxIndex === -1) {
          sendResponse({ success: false, error: 'Inbox not found' });
          return;
        }
        // Prefer full multi-tag list when provided; otherwise set/clear a single primary tag.
        const tagsPayload = (message as { tags?: Array<{ name: string; color: string }> }).tags;
        const updatedInboxes = inboxes.map((i) => {
          if (i.id !== message.inboxId) return i;
          if (Array.isArray(tagsPayload)) {
            const cleaned = tagsPayload
              .filter((t) => t?.name?.trim())
              .map((t) => ({ name: t.name.trim(), color: t.color || '#6750a4' }));
            const first = cleaned[0];
            return {
              ...i,
              tags: cleaned,
              tag: first?.name,
              tagColor: first?.color,
            };
          }
          const name = String(message.tag || '').trim();
          if (!name) {
            return { ...i, tag: undefined, tagColor: undefined, tags: [] };
          }
          const color = (message.color as string) || i.tagColor || '#6750a4';
          // Merge into existing multi-tag list (add/update color by name)
          const prev =
            Array.isArray(i.tags) && i.tags.length > 0
              ? [...i.tags]
              : i.tag
                ? [{ name: i.tag, color: i.tagColor || '#6750a4' }]
                : [];
          const idx = prev.findIndex((t) => t.name.toLowerCase() === name.toLowerCase());
          const next =
            idx >= 0
              ? prev.map((t, j) => (j === idx ? { name, color } : t))
              : [...prev, { name, color }];
          const first = next[0];
          return {
            ...i,
            tags: next,
            tag: first?.name,
            tagColor: first?.color,
          };
        });
        await setInboxes(updatedInboxes);
        sendResponse({ success: true });
      });
    } catch (error: unknown) {
      sendResponse({ success: false, error: getErrorMessage(error) });
    }
  },

  archiveInbox: async (message, _sender, sendResponse) => {
    try {
      await withInboxLock(async () => {
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
      });
    } catch (e) {
      logError('archiveInbox error:', e);
      sendResponse({ success: false, error: 'Failed to archive inbox' });
    }
  },

  unarchiveInbox: async (message, _sender, sendResponse) => {
    try {
      await withInboxLock(async () => {
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
      });
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

  /** Persist a filled signup credential from the content script */
  saveLoginCredential: async (message, _sender, sendResponse) => {
    try {
      const credential = message.credential as Record<string, unknown> | undefined;
      if (!credential || typeof credential !== 'object') {
        sendResponse({ success: false, error: 'Missing credential' });
        return;
      }
      const result = (await browser.storage.local.get(['loginInfo'])) as {
        loginInfo?: Record<string, unknown>[];
      };
      const loginInfo = Array.isArray(result.loginInfo) ? [...result.loginInfo] : [];
      loginInfo.unshift(credential);
      if (loginInfo.length > 50) loginInfo.length = 50;
      await browser.storage.local.set({ loginInfo });
      sendResponse({ success: true, count: loginInfo.length });
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

  resetAnalytics: async (_message, _sender, sendResponse) => {
    try {
      await resetAnalyticsData();
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse({ success: false, error: getErrorMessage(error) });
    }
  },

  recordExtensionOpen: async (_message, _sender, sendResponse) => {
    try {
      await recordExtensionOpen();
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse({ success: false, error: getErrorMessage(error) });
    }
  },

  recordPageVisit: async (message, _sender, sendResponse) => {
    try {
      const viewId = String((message as { viewId?: string }).viewId || '');
      await recordPageVisit(viewId);
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse({ success: false, error: getErrorMessage(error) });
    }
  },

  recordEmailRead: async (_message, _sender, sendResponse) => {
    try {
      await recordEmailRead();
      sendResponse({ success: true });
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
      try {
        await browser.alarms.clearAll();
      } catch (alarmErr) {
        logWarn('Non-fatal error clearing alarms during hard reset:', alarmErr);
      }
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
      setTimeout(async () => {
        try {
          await browser.storage.local.remove('forceNewSessions');
        } catch {
          // Ignore clear errors (e.g. storage closed)
        }
      }, FORCE_NEW_SESSIONS_AUTO_CLEAR_MS);
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
      const instances = await getProviderInstancesWithCustom(provider);
      sendResponse({ success: true, instances });
    } catch (error: unknown) {
      sendResponse({ success: false, error: getErrorMessage(error) });
    }
  },

  translate: async (message, _sender, sendResponse) => {
    try {
      const key = message.key as string;
      const vars = message.vars as Record<string, string | number> | undefined;
      const result = await t(key, vars);
      sendResponse({ success: true, translated: result });
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
      const currentUser = inbox.emailUser || inbox.address.split('@')[0];
      let renewalResponse: Record<string, unknown> = {};
      if (providerConfig.expiry?.renewalMethod) {
        renewalResponse = await service.executeOperation(providerConfig.expiry.renewalMethod, {
          auth: { token: inbox.sidToken },
          variables: { emailUser: currentUser },
        });
      }
      await withInboxLock(async () => {
        const inboxes = await getInboxes();
        const inboxIndex = inboxes.findIndex((i: Account) => i.id === inbox.id);
        if (inboxIndex !== -1) {
          const expiryConfig = loadProviderConfig(inbox.provider);
          const newSidToken =
            typeof renewalResponse.token === 'string'
              ? renewalResponse.token
              : inboxes[inboxIndex].sidToken;
          const timing = deriveInboxTiming(renewalResponse, expiryConfig);
          const prevCount = inboxes[inboxIndex].renewalCount ?? 0;
          inboxes[inboxIndex] = {
            ...inboxes[inboxIndex],
            token: newSidToken,
            sidToken: newSidToken,
            emailUser: currentUser,
            expiresAt: timing.expiresAt,
            expiryNotified: false,
            renewalCount: prevCount + 1,
          };
          await setInboxes(inboxes);
          sendResponse({ success: true, renewalCount: prevCount + 1 });
        } else {
          sendResponse({ success: false, error: 'Inbox disappeared during renewal' });
        }
      });
    } catch (error: unknown) {
      sendResponse({ success: false, error: getErrorMessage(error) });
    }
  },

  addCustomInstance: async (message, _sender, sendResponse) => {
    try {
      const instance = message.instance as Omit<ProviderInstance, 'id' | 'isCustom'>;
      validateCustomInstanceName(instance.name);
      await validateCustomInstanceUrl(instance.apiUrl);
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
      const safeUrl = isSafeFetchUrl(parsedUrl.toString());
      if (!safeUrl.ok) throw new Error(safeUrl.error || 'Favicon URL is not allowed');

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
      const CHUNK_SIZE = 0x8000;
      for (let i = 0; i < uint8.length; i += CHUNK_SIZE) {
        binary += String.fromCharCode.apply(null, Array.from(uint8.subarray(i, i + CHUNK_SIZE)));
      }
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

  findReusableIdentity: async (message, _sender, sendResponse) => {
    try {
      const domain = requireString(message, 'domain');
      const inboxId =
        typeof (message as { inboxId?: string }).inboxId === 'string'
          ? (message as { inboxId: string }).inboxId
          : '';
      const replay = await findSiteReplayForDomain(domain, inboxId || null);
      sendResponse({
        found: !!replay.credential,
        credential: replay.credential,
        lastEmail: replay.lastEmail,
        lastInboxId: replay.lastInboxId,
        lastIdentityId: replay.lastIdentityId,
        fromSiteProfile: replay.fromSiteProfile,
      });
    } catch (error: unknown) {
      sendResponse({ found: false, error: getErrorMessage(error) });
    }
  },

  findSiteReplay: async (message, _sender, sendResponse) => {
    try {
      const domain = requireString(message, 'domain');
      const inboxId =
        typeof (message as { inboxId?: string }).inboxId === 'string'
          ? (message as { inboxId: string }).inboxId
          : null;
      const replay = await findSiteReplayForDomain(domain, inboxId);
      sendResponse({ success: true, ...replay, found: !!replay.credential });
    } catch (error: unknown) {
      sendResponse({ success: false, found: false, error: getErrorMessage(error) });
    }
  },

  clearAllOtps: async (_message, _sender, sendResponse) => {
    try {
      await clearAllOtps();
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse({ success: false, error: getErrorMessage(error) });
    }
  },

  /** UI/content: ensure active tab has content script + form scan (post-install / after create). */
  ensureActiveTabAutofill: async (_message, _sender, sendResponse) => {
    try {
      const { ensureActiveTabAutofill } = await import('../tab-autofill.js');
      const status = await ensureActiveTabAutofill({ notifyIfRefreshNeeded: true });
      sendResponse({ success: true, status });
    } catch (error: unknown) {
      sendResponse({ success: false, error: getErrorMessage(error) });
    }
  },

  formPresence: async (message, sender, sendResponse) => {
    try {
      const detected = !!(message as { formDetected?: boolean }).formDetected;
      const tabId = sender.tab?.id;
      if (typeof tabId === 'number') {
        const { setFormBadge } = await import('../tab-autofill.js');
        await setFormBadge(tabId, detected);
      }
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse({ success: false, error: getErrorMessage(error) });
    }
  },
};

// Aliases - multiple message keys can map to the same handler
export const aliases: Record<string, string> = {
  removeCustomProviderInstance: 'removeCustomInstance',
  addCustomProviderInstance: 'addCustomInstance',
  getSelectedProviderInstance: 'getSelectedInstance',
  setSelectedProviderInstance: 'setSelectedInstance',
  setInstance: 'setSelectedInstance',
};

export function resolveHandlerKey(message: RuntimeMessage): string | undefined {
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
      browser.storage.session.set({ _last_vault_activity: Date.now() }).catch(() => {});

      const handlerKey = resolveHandlerKey(runtimeMessage);
      if (handlerKey) {
        // clearSessionCredentials is intentionally content-callable (clear-only, no secrets).
        const privilegedHandlers = new Set(['hardReset', 'updateRefreshInterval']);
        if (privilegedHandlers.has(handlerKey)) {
          const senderUrl = sender.url || '';
          const isExtensionContext =
            senderUrl.startsWith('chrome-extension://') ||
            senderUrl.startsWith('moz-extension://') ||
            senderUrl.startsWith('extension://');
          if (!isExtensionContext) {
            logWarn('Blocked privileged message call from content script:', {
              handlerKey,
              senderUrl,
            });
            sendResponse({ success: false, error: 'Unauthorized message caller' });
            return true;
          }
        }
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
        const { autofillActiveTab } = await import('../tab-autofill.js');
        await autofillActiveTab();
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
