import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import {
  isWebDAVEnabled,
  loadWebDAVSettings,
  runAutoWebDAVBackup,
} from '@/features/backup/webdav-sync.js';
import { openSignupVerificationLink } from '@/features/intelligence/signup-attempts.js';
import { initializeSmartAutofillSettings } from '@/features/intelligence/smart-settings.js';
import {
  isReloadablePageUrl,
  normalizeReloadRequiredTabIds,
  RELOAD_REQUIRED_TAB_IDS_KEY,
  updateReloadRequiredTabIds,
} from '@/features/navigation/reload-required-tabs.js';
import { SETTINGS_SYNC_KEYS } from '@/features/settings/use-extension-storage-sync.js';
import type { View } from '@/features/types/view-types.js';
import { isLive } from '@/utils/address/address-status.js';
import { clearWebmcpOnce } from '@/utils/browser/webmcp-access.js';
import {
  CLIPBOARD_PURGE_ALARM,
  copyToClipboardFromBackground,
  processClipboardPurgeQueue,
  scheduleNextClipboardPurgeAlarm,
} from '@/utils/clipboard/clipboard.js';
import { CONSTANTS, DEFAULT_PRIMARY_COLOR } from '@/utils/constants.js';
import { isBlockedByList } from '@/utils/content/autofill-blocklist.js';
import { getStoredLocaleAsync, preloadTranslations, tSync } from '@/utils/i18n/i18n-background.js';
import { initLogger, log, logDebug, logError, logInfo, logWarn } from '@/utils/logger.js';
import { LOCKS, PERSISTENT_LOCK_TTL_MS, withLock } from '@/utils/mutex.js';
import { createBrowserNotification } from '@/utils/notifications/notification-permission.js';
import { perfEnd, perfMark, perfStart } from '@/utils/perf/perf-marks.js';
import { initializeDefaultProvider } from '@/utils/provider/instance-manager.js';
import { decryptSecret } from '@/utils/security/crypto.js';
import {
  createEmailReadChecker,
  getAutofillBlocklist,
  getEmailStorageMetadata,
  getSelectedProvider,
  getStoredEmailsForAddress,
  getStoredEmailsMap,
  toggleAutofillBlocklist,
} from '@/utils/storage/storage-keys.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import {
  getVaultAutoLockTimeoutMs,
  getVaultConfig,
  lockVault,
} from '@/utils/storage/vault-lock.js';
import type { Address, AddressStatus, Identity } from '@/utils/types.js';
import {
  checkNewEmails,
  createAddress,
  ensureBadgeCountdownAlarm,
  setupAddressExpiryCheck,
  setupPeriodicEmailCheck,
} from './address/address-manager.js';
import { initializeAnalytics } from './address/analytics.js';
import { handleCopyLatestOtpCommand } from './address/latest-otp-shortcut.js';
import { setupOnboardingPreparation } from './address/onboarding-preparation.js';
import {
  type OtpDetectionProvider,
  setAiConfig,
  setOtpDetectionProvider,
} from './parsing/ai-detection.js';
import { setMagicLinkDetectionEnabled } from './parsing/magic-link.js';
import {
  type OtpDetectionMode,
  setOtpDetectionEnabled,
  setOtpDetectionMode,
} from './parsing/otp.js';
import { registerMessageHandler } from './runtime/message-handler.js';
import {
  autofillActiveTab,
  ensureTabAutofillReady,
  setReloadRequiredBadge,
} from './tab-autofill.js';

const RELOAD_REQUIRED_TABS_LOCK = 'content_reload_required_tabs_lock';
let reloadRequiredTabIdsCache: Set<number> | null = null;

async function markOpenTabsForReload(): Promise<void> {
  const tabs = await browser.tabs.query({});
  const tabIds = tabs
    .filter((tab) => tab.id !== undefined && isReloadablePageUrl(tab.url))
    .map((tab) => tab.id as number);

  await withLock(RELOAD_REQUIRED_TABS_LOCK, async () => {
    await browser.storage.session.set({ [RELOAD_REQUIRED_TAB_IDS_KEY]: tabIds });
    reloadRequiredTabIdsCache = new Set(tabIds);
  });

  await Promise.all(tabIds.map((tabId) => setReloadRequiredBadge(tabId)));
}

async function clearTabReloadRequirement(tabId: number): Promise<boolean> {
  if (reloadRequiredTabIdsCache !== null && !reloadRequiredTabIdsCache.has(tabId)) return false;
  return withLock(RELOAD_REQUIRED_TABS_LOCK, async () => {
    if (reloadRequiredTabIdsCache === null) {
      const stored = (await browser.storage.session.get(RELOAD_REQUIRED_TAB_IDS_KEY)) as Record<
        string,
        unknown
      >;
      reloadRequiredTabIdsCache = new Set(
        normalizeReloadRequiredTabIds(stored[RELOAD_REQUIRED_TAB_IDS_KEY])
      );
    }
    if (!reloadRequiredTabIdsCache.has(tabId)) return false;
    reloadRequiredTabIdsCache = new Set(
      updateReloadRequiredTabIds([...reloadRequiredTabIdsCache], tabId, false)
    );
    await browser.storage.session.set({
      [RELOAD_REQUIRED_TAB_IDS_KEY]: [...reloadRequiredTabIdsCache],
    });
    return true;
  });
}

async function syncOtpDetectionMode() {
  try {
    const stored = (await browser.storage.local.get([
      'otpDetectionMode',
      'otpDetectionEnabled',
      'magicLinkDetectionEnabled',
      'otpDetectionProvider',
      'aiBaseUrl',
      'aiApiKey',
      'aiModel',
    ])) as {
      otpDetectionMode?: OtpDetectionMode;
      otpDetectionEnabled?: boolean;
      magicLinkDetectionEnabled?: boolean;
      otpDetectionProvider?: OtpDetectionProvider;
      aiBaseUrl?: string;
      aiApiKey?: string;
      aiModel?: string;
    };
    if (stored.otpDetectionMode) setOtpDetectionMode(stored.otpDetectionMode);
    setOtpDetectionEnabled(stored.otpDetectionEnabled !== false);
    setMagicLinkDetectionEnabled(stored.magicLinkDetectionEnabled !== false);
    if (stored.otpDetectionProvider === 'algorithm' || stored.otpDetectionProvider === 'ai') {
      setOtpDetectionProvider(stored.otpDetectionProvider);
    }
    // aiApiKey is persisted `_enc_:` ciphertext - decrypt for the engine.
    // When the vault is locked the key resolves to '' and AI mode gracefully
    // falls back to the local algorithm until the vault is unlocked.
    const apiKey = stored.aiApiKey ? await decryptSecret(stored.aiApiKey) : '';
    setAiConfig(stored.aiBaseUrl || '', apiKey, stored.aiModel || '');
  } catch (e) {
    // Corrupt otpDetectionMode / AI config silently degrades the whole
    // detection engine - surface it in error logs, not just debug.
    logError('Failed to load AI/detection settings', e);
  }
}

/** Count unread emails across all addresses and set the badge. */
async function setupUnreadBadge() {
  async function updateBadge() {
    const {
      readEmails = {},
      customColor,
      addresses = [],
      activeAddressId,
    } = (await browser.storage.local.get([
      'readEmails',
      'customColor',
      'addresses',
      'activeAddressId',
    ])) as {
      readEmails?: Record<string, boolean>;
      customColor?: string;
      addresses?: Array<{
        id?: string;
        expiresAt?: number;
        autoExtend?: boolean;
        accountStatus?: AddressStatus;
      }>;
      activeAddressId?: string;
    };
    // Near-expiry override: when the active inbox expires soon and auto-renew
    // is disabled, show a live countdown ("45m") in amber instead of the unread
    // count, so the "why did my inbox die?" loop is answered at a glance.
    const now = Date.now();
    const active =
      addresses.find((i) => i.id === activeAddressId) ||
      addresses.find((i) => isLive({ accountStatus: i.accountStatus, expiresAt: i.expiresAt })) ||
      addresses[0];
    const expiresAt = active?.expiresAt;
    if (
      expiresAt &&
      expiresAt > now &&
      active?.autoExtend !== true &&
      expiresAt - now <= CONSTANTS.NEAR_EXPIRY_BADGE_WINDOW_MS
    ) {
      const minutes = Math.max(1, Math.ceil((expiresAt - now) / 60000));
      await browser.action.setBadgeBackgroundColor({ color: CONSTANTS.NEAR_EXPIRY_BADGE_COLOR });
      await browser.action.setBadgeText({ text: tSync('time.durationM', { m: minutes }) });
      return;
    }

    // Fast path: compact per-address metadata (1 key) instead of sweeping every
    // inbox bag (N keys) on every readEmails change. deriveEmailStorageMetadata
    // uses mailbox-scoped read keys. Fall back to bags for older cached counts
    // that may still have interpreted bare IDs as read in unrelated inboxes.
    // Shared bag sweep: counts unread across every inbox bag using the same
    // `${original_inbox || address}_${id}` + `id` keying. Used both when metadata
    // is empty AND when the metadata read itself throws, so the two paths can't
    // drift apart.
    async function countUnreadFromBags(): Promise<number> {
      const storedEmails = await getStoredEmailsMap();
      const read = createEmailReadChecker(readEmails);
      let count = 0;
      for (const [addr, msgs] of Object.entries(storedEmails)) {
        if (!Array.isArray(msgs)) continue;
        count += msgs.filter((m) => {
          if (!m || typeof m !== 'object' || !m.id) return false;
          const mExt = m as { id: string; original_inbox?: string };
          return !read(m.id, mExt.original_inbox || addr);
        }).length;
      }
      return count;
    }

    let unread = 0;
    try {
      const metadata = await getEmailStorageMetadata();
      const ids = Object.keys(metadata);
      if (ids.length > 0 && ids.every((id) => metadata[id]?.readStateVersion === 1)) {
        for (const id of ids) unread += metadata[id]?.unreadCount ?? 0;
      } else {
        unread = await countUnreadFromBags();
      }
    } catch {
      unread = await countUnreadFromBags();
    }
    await browser.action.setBadgeBackgroundColor({ color: customColor || DEFAULT_PRIMARY_COLOR });
    await browser.action.setBadgeText({ text: unread > 0 ? String(unread) : '' });
  }

  // Update on every relevant storage change
  browser.storage.onChanged.addListener((changes) => {
    if (
      changes.readEmails ||
      changes.customColor ||
      changes.addresses ||
      changes.activeAddressId ||
      Object.keys(changes).some((key) => key.startsWith('storedEmailsByAddress_')) ||
      Object.keys(changes).some((key) => key.startsWith('archivedEmailsByAddress_'))
    ) {
      updateBadge().catch((e) => logError('updateBadge error', e));
      // The countdown alarm may need to start (expiry entered the window,
      // address activated) or stop (renewed, deleted) - re-derive idempotently.
      void ensureBadgeCountdownAlarm();
    }
  });

  // Event-driven countdown: the alarm only exists while the "\{m\}m" badge is
  // actually showing; each fire re-arms the next minute tick via
  // ensureBadgeCountdownAlarm and self-terminates when the countdown ends.
  void ensureBadgeCountdownAlarm();
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'near_expiry_badge') {
      const t0 = perfStart('bg.updateBadge');
      updateBadge()
        .catch((e) => logError('updateBadge error', e))
        .finally(() => {
          perfEnd('bg.updateBadge', t0);
          // Re-arm the next tick (no-op + alarm clear when the countdown is
          // no longer displaying).
          void ensureBadgeCountdownAlarm();
        });
    }
  });

  // Set initial badge on service worker start
  await updateBadge();
}

async function getActiveAddressValue(): Promise<string> {
  try {
    const res = (await browser.storage.local.get(['activeAddressId', 'addresses'])) as {
      activeAddressId?: string;
      addresses?: Array<{
        id?: string;
        address?: string;
        accountStatus?: AddressStatus;
        expiresAt?: number;
      }>;
    };
    const list = res.addresses || [];
    const byId = list.find((i) => i.id === res.activeAddressId && i.address);
    if (byId?.address) return byId.address;
    const active = list.find(
      (i) => i.address && isLive({ accountStatus: i.accountStatus, expiresAt: i.expiresAt })
    );
    return active?.address || list[0]?.address || '';
  } catch (e) {
    logDebug('getActiveAddressValue failed', e);
    return '';
  }
}

async function openExtensionView(view: View, extra?: Record<string, unknown>): Promise<void> {
  const payload = { openView: view, openViewAt: Date.now(), ...extra };
  try {
    await writeWithRetry(payload);
  } catch (e) {
    logDebug('openExtensionView: storage.local.set failed', e);
  }
  try {
    await browser.storage.session.set(payload);
  } catch (e) {
    logDebug('openExtensionView: storage.session.set failed', e);
  }
  // Notify any open popup/sidepanel/app to navigate immediately
  try {
    await browser.runtime.sendMessage({ type: 'navigateView', view, ...extra });
  } catch {
    /* no UI listener yet */
  }

  // Prefer popup (user expects toolbar flow); then side panel; then full app tab
  try {
    await browser.action.openPopup();
    return;
  } catch {
    /* openPopup often requires a user gesture / may be unavailable */
  }
  try {
    // Block side panel when the active tab is our full app page
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const activeUrl = tabs[0]?.url || '';
    const isOwnApp =
      activeUrl.includes('/app.html') ||
      /chrome-extension:\/\/[^/]+\/app\.html/i.test(activeUrl) ||
      /moz-extension:\/\/[^/]+\/app\.html/i.test(activeUrl);
    if (!isOwnApp) {
      const anyBrowser = browser as typeof browser & {
        sidePanel?: { open: (opts: { windowId?: number }) => Promise<void> };
      };
      if (anyBrowser.sidePanel?.open) {
        const win = await browser.windows.getCurrent();
        if (win.id != null) {
          await anyBrowser.sidePanel.open({ windowId: win.id });
          return;
        }
      }
    }
  } catch {
    /* side panel may be unavailable */
  }
  try {
    const getURL = (browser.runtime as unknown as { getURL: (p: string) => string }).getURL;
    const url = getURL(`/app.html?view=${encodeURIComponent(view)}`);
    await browser.tabs.create({ url });
  } catch (e) {
    logError('openExtensionView failed', e);
  }
}

let isSettingUpContextMenu = false;

/** Right-click on page + right-click on extension toolbar icon (action). */
function setupContextMenu() {
  if (isSettingUpContextMenu) return;
  isSettingUpContextMenu = true;

  // Non-empty tuple required by @types/chrome ContextType[]
  const actionContexts: ['action'] = ['action'];

  function safeCreateMenu(options: Record<string, unknown>) {
    try {
      browser.contextMenus.create(
        options as Parameters<typeof browser.contextMenus.create>[0],
        () => {
          // Access runtime.lastError to mark it checked in Chrome engine
          void (
            browser.runtime.lastError ||
            (globalThis as unknown as { chrome?: { runtime?: { lastError?: unknown } } }).chrome
              ?.runtime?.lastError
          );
        }
      );
    } catch (e) {
      logDebug(`contextMenus.create ${String(options.id)} failed`, e);
    }
  }

  function createActionMenu(id: string, title: string, extra?: Record<string, unknown>) {
    safeCreateMenu({
      id,
      title,
      contexts: actionContexts,
      ...extra,
    });
  }

  function sep(id: string) {
    safeCreateMenu({
      id,
      type: 'separator',
      contexts: actionContexts,
    });
  }

  browser.contextMenus
    .removeAll()
    .then(async () => {
      await preloadTranslations(await getStoredLocaleAsync());
      const addr = (await getActiveAddressValue()) || tSync('contextMenu.noAddressYet');

      // -- Extension icon (toolbar) menu --
      // Keep this list short + flat: nested menus sometimes truncate siblings on Chrome.
      // Order: identity → primary actions → open surfaces → secondary.
      createActionMenu('action-active-email', addr, { enabled: false });
      sep('action-sep-1');
      createActionMenu('action-autofill-page', tSync('contextMenu.autofillThisPage'));
      createActionMenu('action-create-temp-email', tSync('contextMenu.createTempEmail'));
      createActionMenu('action-exclude-autofill', tSync('contextMenu.excludeWebsite'));
      sep('action-sep-2');
      // Open targets early so they always appear (never after a failing submenu build)
      createActionMenu('action-open-popup', tSync('contextMenu.openPopup'));
      createActionMenu('action-open-sidepanel', tSync('contextMenu.openSidePanel'));
      createActionMenu('action-open-app', tSync('contextMenu.openFullApp'));
      sep('action-sep-3');
      createActionMenu('action-report-issue', tSync('contextMenu.reportIssue'));
      sep('action-sep-4');
      // Flat address list (no nested parent - Chrome action menus drop siblings when nested)
      try {
        await rebuildAddressSubmenu();
      } catch (e) {
        logDebug('rebuildAddressSubmenu failed', e);
      }

      // -- Page context menu --
      try {
        safeCreateMenu({
          id: 'create-temp-email',
          title: tSync('contextMenu.createTempEmail'),
          contexts: ['page', 'link', 'editable'],
        });
        safeCreateMenu({
          id: 'separator-autofill',
          type: 'separator',
          contexts: ['page'],
        });
        safeCreateMenu({
          id: 'page-autofill-form',
          title: tSync('contextMenu.autofillThisPage'),
          contexts: ['page', 'editable'],
        });
        safeCreateMenu({
          id: 'autofill-toggle-blocklist',
          title: tSync('contextMenu.excludeFromAutofill'),
          contexts: ['page'],
        });
      } catch (e) {
        logDebug('page context menus failed', e);
      }
    })
    .catch((e) => logError('contextMenus.removeAll failed', e))
    .finally(() => {
      isSettingUpContextMenu = false;
    });

  async function refreshActionEmailTitle() {
    try {
      const addr = (await getActiveAddressValue()) || tSync('contextMenu.noAddressYet');
      await browser.contextMenus.update('action-active-email', { title: addr });
    } catch (e) {
      logDebug('refreshActionEmailTitle failed', e);
    }
  }

  async function rebuildAddressSubmenu() {
    try {
      // Flat list under action context (max ~8) - nested parent menus are unreliable on Chrome.
      const res = (await browser.storage.local.get(['addresses'])) as {
        addresses?: Array<{ id?: string; address?: string; accountStatus?: AddressStatus }>;
      };
      const list = (res.addresses || [])
        .filter((i) => i.address && i.accountStatus !== 'deleted')
        .slice(0, 8);

      const removePromises: Promise<void>[] = [];
      for (let i = 0; i < 12; i++) {
        removePromises.push(
          browser.contextMenus.remove(`action-address-item-${i}`).catch(() => {})
        );
      }
      removePromises.push(browser.contextMenus.remove('action-address-empty').catch(() => {}));
      removePromises.push(browser.contextMenus.remove('action-addresses-parent').catch(() => {}));
      await Promise.all(removePromises);

      if (list.length === 0) {
        createActionMenu('action-address-empty', tSync('contextMenu.noAddressesYet'), {
          enabled: false,
        });
        return;
      }
      list.forEach((record, idx) => {
        const title = record.address || record.id || 'address';
        // Truncate long addresses for the action menu
        const short = title.length > 36 ? `${title.slice(0, 33)}…` : title;
        createActionMenu(`action-address-item-${idx}`, short);
      });
      try {
        await browser.storage.session.set({
          actionAddressMenuMap: Object.fromEntries(
            list.map((record, idx) => [`action-address-item-${idx}`, record.id || ''])
          ),
        });
      } catch (e) {
        logDebug('actionAddressMenuMap session set failed', e);
      }
    } catch (e) {
      logDebug('rebuildAddressSubmenu failed', e);
    }
  }

  async function updateContextMenuForTab(tabId: number) {
    try {
      const tab = await browser.tabs.get(tabId);
      if (!tab.url) return;
      const url = new URL(tab.url);
      const domain = url.hostname;
      const blocklist = await getAutofillBlocklist();
      const isBlocked = isBlockedByList(domain, blocklist);

      await browser.contextMenus.update('autofill-toggle-blocklist', {
        title: isBlocked
          ? tSync('contextMenu.removeFromAutofillBlocklist', { domain })
          : tSync('contextMenu.excludeFromAutofill'),
      });
      await refreshActionEmailTitle();
      // Password-manager-style cue: badge when signup form present
      void ensureTabAutofillReady(tabId).catch((error) =>
        logWarn('Autofill readiness check failed', {
          tabId,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    } catch (error) {
      // Tab may not have a valid URL (e.g. about:blank), but other failures can
      // prevent the context-menu state from matching the current tab.
      logWarn('Failed to update context-menu state for tab', {
        tabId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  browser.tabs.onActivated.addListener((activeInfo) => {
    updateContextMenuForTab(activeInfo.tabId).catch((error) =>
      logWarn('Context-menu refresh on tab activation failed', {
        tabId: activeInfo.tabId,
        error: error instanceof Error ? error.message : String(error),
      })
    );
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading' || changeInfo.url) {
      void clearWebmcpOnce(tabId).catch((error) =>
        logError('Failed to revoke temporary WebMCP access on navigation', error)
      );
    }
    if (changeInfo.status === 'complete') {
      void clearTabReloadRequirement(tabId)
        .then(async (cleared) => {
          // The stale badge intentionally wins over form/unread state only
          // until a reload/navigation completes. Re-probe so the per-tab
          // action title and badge are restored from the current page.
          if (cleared) await ensureTabAutofillReady(tabId);
        })
        .catch((error) =>
          logError('Failed to clear the content reload requirement after page load', error)
        );
    }
    if (changeInfo.status === 'complete' || changeInfo.url) {
      updateContextMenuForTab(tabId).catch((error) =>
        logWarn('Context-menu refresh on tab update failed', {
          tabId,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }
    if (changeInfo.url) {
      void withLock('session_credentials_lock', async () => {
        try {
          const res = (await browser.storage.session.get('sessionCredentials')) as {
            sessionCredentials?: Record<string, unknown>;
          };
          const creds = res.sessionCredentials;
          if (creds?.[tabId]) {
            delete creds[tabId];
            await browser.storage.session.set({ sessionCredentials: creds });
          }
        } catch (e: unknown) {
          logError('Failed to remove session credentials on navigation', e);
        }
      });
    }
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    void clearWebmcpOnce(tabId).catch((error) =>
      logError('Failed to revoke temporary WebMCP access for a closed tab', error)
    );
    void clearTabReloadRequirement(tabId).catch((error) =>
      logError('Failed to clear the content reload requirement for a closed tab', error)
    );
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.activeAddressId || changes.addresses) {
      void refreshActionEmailTitle();
      void rebuildAddressSubmenu();
    }
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    await recordVaultActivity().catch((error) =>
      logError('Failed to record context-menu vault activity', error)
    );
    const id = String(info.menuItemId);

    if (id === 'action-autofill-page' || id === 'page-autofill-form') {
      await runAutofillActiveTabAndNotify();
      return;
    }

    if (id === 'action-create-temp-email' || id === 'create-temp-email') {
      try {
        const provider = await getSelectedProvider();
        if (!provider) return;
        const record = await createAddress(provider);
        // Select new mailbox + open popup mailbox view on next open
        try {
          await writeWithRetry({
            activeAddressId: record.id,
            openView: 'mailbox',
            openViewAt: Date.now(),
          });
          await browser.storage.session.set({
            openView: 'mailbox',
            openViewAt: Date.now(),
          });
        } catch (error) {
          logError('Failed to persist context-menu mailbox selection', error);
        }
        if (tab?.id !== undefined) {
          // Copy through the sensitive-data path, not a blind writeText +
          // setTimeout(''): the blind clear would overwrite whatever the user
          // copied in the intervening minute and bypassed verify-before-wipe
          // (no background purge record). This routes through the standard
          // copy + scheduled purge with the user's clipboard-privacy duration.
          await copyToClipboardFromBackground(record.address);
          const status = await ensureTabAutofillReady(tab.id, {
            notifyIfRefreshNeeded: true,
          });
          if (status === 'form') {
            createBrowserNotification(`ctx_form_${record.address}`, {
              type: 'basic',
              iconUrl: 'icons/icon128.png',
              title: tSync('notifications.tempEmailReady'),
              message: tSync('notifications.tempEmailReadyMessage', { address: record.address }),
            });
          } else {
            createBrowserNotification(`ctx_${record.address}`, {
              type: 'basic',
              iconUrl: 'icons/icon128.png',
              title: tSync('notifications.tempEmailCreated'),
              message: tSync('notifications.tempEmailCreatedMessage', { address: record.address }),
            });
          }
        } else {
          createBrowserNotification(`ctx_${record.address}`, {
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: tSync('notifications.tempEmailCreated'),
            message: record.address,
          });
        }
        await refreshActionEmailTitle();
        await rebuildAddressSubmenu();
        // Open popup so user sees the new mailbox selected
        try {
          await browser.action.openPopup();
        } catch {
          /* gesture may be consumed */
        }
      } catch (e) {
        logError('Context menu createAddress error', e);
      }
      return;
    }

    if (id === 'action-report-issue') {
      try {
        const { CONSTANTS } = await import('@/utils/constants.js');
        await browser.tabs.create({
          url: CONSTANTS.GITHUB_ISSUES_URL,
        });
      } catch (e) {
        logError('Failed to open GitHub issues', e);
      }
      return;
    }

    if (id === 'action-open-popup') {
      try {
        await browser.action.openPopup();
      } catch (e) {
        // openPopup often requires user gesture / may be unavailable - fall back to app
        try {
          const getURL = (browser.runtime as unknown as { getURL: (p: string) => string }).getURL;
          await browser.tabs.create({ url: getURL('/popup.html') });
        } catch (e2) {
          logError('Failed to open popup', e2 ?? e);
        }
      }
      return;
    }

    if (id === 'action-open-sidepanel') {
      try {
        // Never open side panel when the active tab is our own full app page
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        const activeUrl = tabs[0]?.url || '';
        if (
          activeUrl.includes('/app.html') ||
          /chrome-extension:\/\/[^/]+\/app\.html/i.test(activeUrl) ||
          /moz-extension:\/\/[^/]+\/app\.html/i.test(activeUrl)
        ) {
          logDebug('Side panel blocked on app.html tab');
          return;
        }
        // Re-enable side panel if app tab disabled it; never steal toolbar click from popup
        await configureToolbarDefaultUi({ enableSidePanel: true });
        const chromeApi = (
          globalThis as unknown as {
            chrome?: {
              sidePanel?: { open?: (opts: { windowId?: number }) => Promise<void> };
            };
          }
        ).chrome;
        const anyBrowser = browser as typeof browser & {
          sidePanel?: { open?: (opts: { windowId?: number }) => Promise<void> };
        };
        const openFn = chromeApi?.sidePanel?.open ?? anyBrowser.sidePanel?.open;
        const win = await browser.windows.getCurrent();
        if (win.id != null && openFn) {
          await openFn({ windowId: win.id });
        }
      } catch (e) {
        logError('Failed to open side panel', e);
      }
      return;
    }

    if (id === 'action-open-app') {
      try {
        const getURL = (browser.runtime as unknown as { getURL: (p: string) => string }).getURL;
        await browser.tabs.create({ url: getURL('/app.html') });
      } catch (e) {
        logError('Failed to open app view', e);
      }
      return;
    }

    if (id.startsWith('action-address-item-')) {
      try {
        const mapRes = (await browser.storage.session.get(['actionAddressMenuMap'])) as {
          actionAddressMenuMap?: Record<string, string>;
        };
        const addressId = mapRes.actionAddressMenuMap?.[id] || '';
        if (!addressId) return;
        await writeWithRetry({
          activeAddressId: addressId,
          openView: 'mailbox',
          openViewAt: Date.now(),
        });
        await browser.storage.session.set({ openView: 'mailbox', openViewAt: Date.now() });
        await openExtensionView('mailbox');
      } catch (e) {
        logDebug('open mailbox from menu failed', e);
      }
      return;
    }

    if (id === 'action-exclude-autofill' || id === 'autofill-toggle-blocklist') {
      try {
        const targetTab =
          tab ||
          (await browser.tabs.query({ active: true, currentWindow: true }).then((t) => t[0]));
        if (!targetTab?.url) return;
        const url = new URL(targetTab.url);
        const domain = url.hostname;
        const toggle = await toggleAutofillBlocklist(domain);

        if (toggle.changed) {
          createBrowserNotification(toggle.blocked ? `blocked_${domain}` : `unblocked_${domain}`, {
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: toggle.blocked
              ? tSync('notifications.autofillExcludedTitle')
              : tSync('notifications.autofillReenabledTitle'),
            message: toggle.blocked
              ? tSync('notifications.autofillExcludedMessage', { domain })
              : tSync('notifications.autofillReenabledMessage', { domain }),
          });
          if (targetTab.id) {
            await browser.tabs
              .sendMessage(targetTab.id, {
                type: 'autofillBlocklistChanged',
              })
              .catch(() => {
                // Restricted pages and tabs without the content script are expected.
              });
          }
        }

        if (targetTab.id) await updateContextMenuForTab(targetTab.id);
        // Refresh action menu title for exclude item
        try {
          await browser.contextMenus.update('action-exclude-autofill', {
            title: toggle.blocked
              ? tSync('contextMenu.removeFromAutofillBlocklist', { domain })
              : tSync('contextMenu.excludeFromAutofill'),
          });
        } catch (e) {
          logDebug('action-exclude-autofill menu update failed', e);
        }
      } catch (e) {
        if (CONSTANTS.DEBUG) log(`Context menu blocklist error: ${e}`);
      }
    }
  });
}

/** Omnibox keyword "1c" - search signup credentials / open Autofill manager (PM-style address bar). */
function setupOmnibox() {
  // Preload the locale pack before any user-visible omnibox copy is rendered;
  // listener registration below stays synchronous (MV3 requirement).
  void (async () => {
    try {
      await preloadTranslations(await getStoredLocaleAsync());
      browser.omnibox.setDefaultSuggestion({
        description: tSync('omnibox.defaultSuggestion'),
      });
    } catch (e) {
      logDebug('omnibox.setDefaultSuggestion unavailable', e);
    }
  })();

  browser.omnibox.onInputChanged.addListener((text, suggest) => {
    void (async () => {
      const q = (text || '').trim().toLowerCase();
      const suggestions: { content: string; description: string }[] = [];

      if (!q || 'fill'.startsWith(q) || 'autofill'.startsWith(q)) {
        suggestions.push({
          content: 'fill',
          description: tSync('omnibox.autofillForm'),
        });
      }
      if (!q || 'profiles'.startsWith(q) || 'profile'.startsWith(q)) {
        suggestions.push({
          content: 'profiles',
          description: tSync('omnibox.openProfiles'),
        });
      }
      if (!q || 'addresses'.startsWith(q) || 'address'.startsWith(q)) {
        suggestions.push({
          content: 'addresses',
          description: tSync('omnibox.openAddresses'),
        });
      }
      if (!q || 'credentials'.startsWith(q) || 'cred'.startsWith(q)) {
        suggestions.push({
          content: 'credentials',
          description: tSync('omnibox.openCredentials'),
        });
      }
      if (!q || 'mailbox'.startsWith(q) || 'mail'.startsWith(q)) {
        suggestions.push({
          content: 'mailbox',
          description: tSync('omnibox.openMailbox'),
        });
      }
      if (!q || 'settings'.startsWith(q)) {
        suggestions.push({
          content: 'settings',
          description: tSync('omnibox.openSettings'),
        });
      }

      try {
        const {
          addresses = [],
          loginInfo = [],
          identities = [],
        } = (await browser.storage.local.get(['addresses', 'loginInfo', 'identities'])) as {
          addresses?: Address[];
          loginInfo?: Array<{ email?: string; website?: string; domain?: string; id?: string }>;
          identities?: Identity[];
        };

        if (q) {
          // 1) Match active addresses
          const matchedAddresses = (addresses || [])
            .filter((i) => {
              const hay = `${i.address || ''} ${i.provider || ''}`.toLowerCase();
              return hay.includes(q);
            })
            .slice(0, 3);
          for (const record of matchedAddresses) {
            suggestions.push({
              content: `inbox:${record.id || record.address}`,
              description: tSync('omnibox.inbox', {
                address: record.address,
                provider: record.provider || 'default',
              }),
            });
          }

          // 2) Match identity profiles
          const matchedIdentities = (identities || [])
            .filter((id) => {
              const hay =
                `${id.name || ''} ${id.username || ''} ${id.firstNames || ''} ${id.lastNames || ''}`.toLowerCase();
              return hay.includes(q);
            })
            .slice(0, 3);
          for (const id of matchedIdentities) {
            suggestions.push({
              content: `profile:${id.id}`,
              description: tSync('omnibox.profile', {
                name: id.name,
                username: id.username || '',
              }),
            });
          }

          // 3) Match saved credentials
          const hits = (loginInfo || [])
            .filter((row) => {
              const hay =
                `${row.email || ''} ${row.website || ''} ${row.domain || ''}`.toLowerCase();
              return hay.includes(q);
            })
            .slice(0, 3);
          for (const row of hits) {
            const site = row.website || row.domain || 'site';
            const email = row.email || '';
            suggestions.push({
              content: `cred:${row.id || email}`,
              description: tSync('omnibox.credential', { email, site }),
            });
          }
        }
      } catch (e) {
        logDebug('omnibox credential search failed', e);
      }

      suggest(suggestions.slice(0, 8));
    })();
  });

  browser.omnibox.onInputEntered.addListener((text, disposition) => {
    void recordVaultActivity().catch((error) =>
      logError('Failed to record omnibox vault activity', error)
    );
    void (async () => {
      const cmd = (text || '').trim().toLowerCase();
      if (cmd === 'fill' || cmd === 'autofill') {
        await runAutofillActiveTabAndNotify();
        return;
      }
      if (cmd === 'profiles' || cmd === 'profile') {
        await writeWithRetry({
          openView: 'autofill',
          openViewAt: Date.now(),
          autofillTab: 'profiles',
        });
        await openExtensionView('autofill');
        return;
      }
      if (cmd === 'addresses' || cmd === 'address') {
        await writeWithRetry({ openView: 'addresses', openViewAt: Date.now() });
        await openExtensionView('addresses');
        return;
      }
      if (cmd.startsWith('inbox:')) {
        const addressKey = (text || '').trim().slice(6);
        const { addresses = [] } = (await browser.storage.local.get(['addresses'])) as {
          addresses?: Address[];
        };
        const found = addresses.find(
          (i) => i.id === addressKey || i.address.toLowerCase() === addressKey.toLowerCase()
        );
        if (found) {
          await writeWithRetry({
            selectedEmail: found.address,
            openView: 'mailbox',
            openViewAt: Date.now(),
          });
        } else {
          await writeWithRetry({ openView: 'mailbox', openViewAt: Date.now() });
        }
        await openExtensionView('mailbox');
        return;
      }
      if (cmd.startsWith('profile:')) {
        const profileId = (text || '').trim().slice(8);
        await writeWithRetry({
          openView: 'autofill',
          openViewAt: Date.now(),
          autofillTab: 'profiles',
          selectedIdentityId: profileId,
        });
        await openExtensionView('autofill');
        return;
      }
      if (cmd === 'credentials' || cmd === 'cred' || cmd.startsWith('cred:')) {
        await writeWithRetry({
          openView: 'autofill',
          openViewAt: Date.now(),
          autofillTab: 'credentials',
        });
        await openExtensionView('autofill');
        return;
      }
      if (cmd === 'mailbox' || cmd === 'mail') {
        await openExtensionView('mailbox');
        return;
      }
      if (cmd === 'settings') {
        await openExtensionView('settings');
        return;
      }
      // Default: open autofill hub
      await writeWithRetry({ openView: 'autofill', openViewAt: Date.now() });
      await openExtensionView('autofill');
      void disposition;
    })();
  });
}

/**
 * Mirror the settings subset between browser.storage.local and
 * browser.storage.sync so settings (theme, custom color, keybindings,
 * notifications, provider choice, etc.) follow the user across devices.
 *
 * Emails, logins, and identities are NOT synced - too large / too sensitive
 * for sync quotas. Only the keys in SETTINGS_SYNC_KEYS are mirrored.
 *
 * A guard flag prevents the local→sync→local echo from looping.
 */
function setupStorageSyncMirror(): void {
  const syncKeysSet = new Set(SETTINGS_SYNC_KEYS);

  // Timestamp-stamped: a mirror interrupted by service-worker termination
  // (the finally-remove never ran) self-heals after the TTL instead of
  // suppressing every future mirror until browser restart.
  async function isMirroringLocked(): Promise<boolean> {
    try {
      const res = await browser.storage.session.get('_sync_mirroring_lock');
      const ts = res._sync_mirroring_lock;
      return typeof ts === 'number' && Date.now() - ts < PERSISTENT_LOCK_TTL_MS;
    } catch (e) {
      logDebug('isMirroringLocked failed', e);
      return false;
    }
  }

  async function setMirroringLock(locked: boolean): Promise<void> {
    try {
      if (locked) {
        await browser.storage.session.set({ _sync_mirroring_lock: Date.now() });
      } else {
        await browser.storage.session.remove('_sync_mirroring_lock');
      }
    } catch (e) {
      logDebug('setMirroringLock failed', e);
    }
  }

  // Mirror one direction; the flag check runs INSIDE the mutex so the
  // previously racy check-then-set is atomic: concurrent onChanged events
  // serialize on the queue (no double-write / no lost customNavOrder), while
  // the echo of our own write still sees the flag and bails.
  async function mirrorWithGuard(apply: () => Promise<void>): Promise<void> {
    try {
      await withLock(LOCKS.SYNC_MIRRORING, async () => {
        if (await isMirroringLocked()) return;
        await setMirroringLock(true);
        try {
          await apply();
        } finally {
          await setMirroringLock(false);
        }
      });
    } catch (e) {
      logError('storage.sync mirror lock failed', e);
    }
  }

  // Shared local↔sync mirror: the two directions differ only in source area,
  // target write, and log label - one helper so filter/guard semantics can't
  // drift between directions.
  function setupSyncMirror(
    fromArea: string,
    apply: (items: Record<string, unknown>) => Promise<void>,
    directionLabel: string
  ): void {
    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== fromArea) return;
      void (async () => {
        const pending: Record<string, unknown> = {};
        for (const key of Object.keys(changes)) {
          if (syncKeysSet.has(key)) {
            pending[key] = changes[key].newValue;
          }
        }
        if (Object.keys(pending).length === 0) return;
        await mirrorWithGuard(async () => {
          try {
            await apply(pending);
          } catch (e: unknown) {
            logError(`storage.sync mirror (${directionLabel}) failed`, e);
          }
        });
      })();
    });
  }

  // local → sync: when a setting changes locally, push it to sync
  setupSyncMirror('local', (items) => browser.storage.sync.set(items), 'local→sync');

  // sync → local: when a setting arrives from another device, apply it locally
  // (through the retry wrapper - a hiccup must not silently drop a synced setting)
  setupSyncMirror('sync', (items) => writeWithRetry(items), 'sync→local');
}

const VAULT_IDLE_ALARM = 'vault_idle_autolock_check';

async function recordVaultActivity(): Promise<void> {
  await withLock(LOCKS.VAULT_ACTIVITY, async () => {
    await browser.storage.session.set({ _last_vault_activity: Date.now() });
  });
}

function ensureVaultIdleAlarm(active: boolean): void {
  if (!active) {
    // Mode switched to standard (or never protected): idle auto-lock is
    // meaningless there (the raw key lives in local storage), so retire the
    // alarm instead of letting it poll storage.session every 5 minutes forever.
    browser.alarms.clear(VAULT_IDLE_ALARM).catch(() => {});
    return;
  }
  // Avoid resetting the alarm's interval if it is already scheduled
  // (restarting MV3 service worker).
  browser.alarms
    .get(VAULT_IDLE_ALARM)
    .then((alarm) => {
      if (!alarm) {
        browser.alarms.create(VAULT_IDLE_ALARM, { periodInMinutes: 5 });
      }
    })
    .catch((e) => logError('alarms.get failed', e));
}

function setupVaultAutoLockCheck(): void {
  void (async () => {
    try {
      const cfg = await getVaultConfig();
      ensureVaultIdleAlarm(cfg.mode === 'password' || cfg.mode === 'biometrics');
    } catch {
      // Conservative default: behave like the old always-on schedule.
      ensureVaultIdleAlarm(true);
    }
  })();

  // Track vault mode changes so a password→standard downgrade retires the
  // alarm and a standard→password upgrade re-arms it.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const configChange = changes.vault_security_config;
    if (!configChange) return;
    const mode = (configChange.newValue as { mode?: string } | undefined)?.mode;
    ensureVaultIdleAlarm(mode === 'password' || mode === 'biometrics');
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== VAULT_IDLE_ALARM) return;
    void withLock(LOCKS.VAULT_ACTIVITY, async () => {
      try {
        const config = await getVaultConfig();
        // Standard mode keeps the raw key in local: there is nothing to lock,
        // and lockVault() would broadcast a spurious vaultLocked toast.
        if (config.mode === 'standard') return;
        const sessionRes = (await browser.storage.session.get(['_last_vault_activity'])) as {
          _last_vault_activity?: number;
        };
        const timeoutMs = getVaultAutoLockTimeoutMs(config.autoLockTimeout);
        if (
          timeoutMs > 0 &&
          Number.isFinite(timeoutMs) &&
          sessionRes._last_vault_activity &&
          Date.now() - sessionRes._last_vault_activity > timeoutMs
        ) {
          await lockVault();
          logInfo(`Vault auto-locked due to ${config.autoLockTimeout || '15m'} of inactivity.`);
        }
      } catch (err) {
        logError('Failed during vault auto-lock check', err);
      }
    }).catch((err) => logError('Failed during vault auto-lock lock', err));
  });
}

/**
 * Background clipboard purge fallback. The queue owns absolute deadlines; the
 * worker keeps one one-shot alarm at the earliest deadline instead of waking
 * once per minute when there is nothing due.
 */
function setupClipboardPurgeAlarm(): void {
  void scheduleNextClipboardPurgeAlarm();
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.clipboardPurgeQueue) {
      void scheduleNextClipboardPurgeAlarm();
    }
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === CLIPBOARD_PURGE_ALARM) {
      void processClipboardPurgeQueue();
    }
  });
}

/**
 * Scheduled WebDAV auto-backup: keeps a `webdav_auto_backup` alarm in sync
 * with the persisted settings (created when auto-backup + URL are configured,
 * cleared otherwise, rescheduled when the interval changes), and on each tick
 * uploads the backup and records `lastWebDAVSyncAt` for the Settings indicator.
 */
const WEBDAV_AUTO_BACKUP_ALARM = 'webdav_auto_backup';

function setupWebDAVAutoBackupAlarm(): void {
  const syncAlarm = () => {
    browser.alarms
      .get(WEBDAV_AUTO_BACKUP_ALARM)
      .then(async (alarm) => {
        const settings = await loadWebDAVSettings();
        const enabled = isWebDAVEnabled(settings) && settings.autoBackup === true && !!settings.url;
        const minutes = Math.max(60, Math.round((settings.autoBackupIntervalDays || 1) * 24 * 60));
        if (enabled) {
          if (alarm && alarm.periodInMinutes === minutes) return;
          if (alarm) await browser.alarms.clear(WEBDAV_AUTO_BACKUP_ALARM);
          browser.alarms.create(WEBDAV_AUTO_BACKUP_ALARM, { periodInMinutes: minutes });
        } else if (alarm) {
          await browser.alarms.clear(WEBDAV_AUTO_BACKUP_ALARM);
        }
      })
      .catch((e) => logError('webdav auto-backup alarm sync failed', e));
  };

  // Re-arm whenever the settings change (toggle on/off, interval edit, URL).
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.webdavConfig) syncAlarm();
  });
  syncAlarm();

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === WEBDAV_AUTO_BACKUP_ALARM) {
      void (async () => {
        try {
          const res = await runAutoWebDAVBackup();
          if (res.success) logInfo('WebDAV auto-backup uploaded successfully.');
          else logWarn('WebDAV auto-backup skipped:', res.error?.key);
        } catch (err) {
          logError('WebDAV auto-backup failed', err);
        }
      })();
    }
  });
}

async function updateUserAgentSessionRule(): Promise<void> {
  try {
    const { identities = [], selectedIdentityId } = await browser.storage.local.get([
      'identities',
      'selectedIdentityId',
    ]);
    const activeIdentity = (identities as import('@/utils/types.js').Identity[]).find(
      (i) => i.id === selectedIdentityId
    );
    const customUA = activeIdentity?.userAgent;

    const ruleId = 1001;

    if (customUA) {
      const rule = {
        id: ruleId,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            {
              header: 'User-Agent',
              operation: 'set',
              value: customUA,
            },
          ],
        },
        condition: {
          urlFilter: '*',
          resourceTypes: [
            'main_frame',
            'sub_frame',
            'stylesheet',
            'script',
            'image',
            'font',
            'object',
            'xmlhttprequest',
            'ping',
            'csp_report',
            'media',
            'websocket',
            'other',
          ],
        },
      };

      await browser.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [ruleId],
        addRules: [
          rule as unknown as NonNullable<
            Parameters<typeof browser.declarativeNetRequest.updateSessionRules>[0]['addRules']
          >[number],
        ],
      });
      if (CONSTANTS.DEBUG) logDebug(`DeclarativeNetRequest rule added for UA: ${customUA}`);
    } else {
      await browser.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [ruleId],
      });
      if (CONSTANTS.DEBUG) logDebug('DeclarativeNetRequest rule cleared for UA (using default)');
    }
  } catch (err) {
    logError('declarativeNetRequest UA spoofing rule failed', err);
  }
}

/**
 * Toolbar click must open the POPUP, never the side panel by default.
 * Side panel stays available via action context menu ("Open Side Panel").
 * The Chrome-only sidePanel API is optional in other browsers. Feature-detect
 * it before use because WXT's browser export does not polyfill missing APIs.
 */
async function configureToolbarDefaultUi(opts?: { enableSidePanel?: boolean }): Promise<void> {
  const enableSidePanel = opts?.enableSidePanel !== false;
  const chromeApi = (
    globalThis as unknown as {
      chrome?: {
        action?: { setPopup?: (d: { popup: string }) => Promise<void> | void };
        sidePanel?: {
          setPanelBehavior?: (o: { openPanelOnActionClick: boolean }) => Promise<void>;
          setOptions?: (o: { path?: string; enabled?: boolean }) => Promise<void>;
        };
      };
    }
  ).chrome;
  const anyBrowser = browser as typeof browser & {
    sidePanel?: {
      setPanelBehavior?: (opts: { openPanelOnActionClick: boolean }) => Promise<void>;
      setOptions?: (opts: { path?: string; enabled?: boolean }) => Promise<void>;
    };
    action?: { setPopup?: (details: { popup: string }) => Promise<void> };
  };
  const sidePanel = chromeApi?.sidePanel ?? anyBrowser.sidePanel;
  const action = chromeApi?.action ?? anyBrowser.action;

  // Order matters: force click→popup BEFORE wiring side panel path
  try {
    await sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false });
  } catch (e) {
    logDebug('setPanelBehavior(false) failed', e);
  }
  try {
    await action?.setPopup?.({ popup: 'popup.html' });
  } catch (e) {
    logDebug('setPopup(popup.html) failed', e);
  }
  try {
    await sidePanel?.setOptions?.({
      path: 'sidepanel.html',
      enabled: enableSidePanel,
    });
  } catch (e) {
    logDebug('sidePanel.setOptions failed', e);
  }
  // Re-assert after setOptions (some Chrome builds reset behavior)
  try {
    await sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false });
  } catch (e) {
    logDebug('sidePanel.setPanelBehavior failed', e);
  }
}

/**
 * Run autofill on the active tab and surface the outcome as a desktop
 * notification. Shared by the context-menu and omnibox "fill" commands so
 * they report the same failures - including the blocklist case, which would
 * otherwise fall through to the generic "could not autofill" message.
 */
async function runAutofillActiveTabAndNotify(): Promise<void> {
  const result = await autofillActiveTab();
  if (result.ok) return;
  const msg =
    result.reason === 'no_form'
      ? tSync('notifications.autofillNoForm')
      : result.reason === 'need_refresh'
        ? tSync('notifications.autofillNeedRefresh')
        : result.reason === 'blocked'
          ? tSync('notifications.autofillBlocked')
          : tSync('notifications.autofillFailedGeneric');
  await createBrowserNotification('af', {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: tSync('notifications.autofillTitle'),
    message: msg,
  });
}

export default defineBackground(() => {
  const swStart = perfStart('bg.swStart');
  // Synchronous-first attempt so the first icon click after SW wake is correct
  void configureToolbarDefaultUi();

  // Load user provider JSON overrides before any create/check calls
  void (async () => {
    try {
      const { loadProviderOverridesFromStorage } = await import('@/utils/email/email-service.js');
      await loadProviderOverridesFromStorage(browser);
    } catch (e) {
      logDebug('loadProviderOverridesFromStorage failed - bundled providers remain', e);
    }
  })();
  // Warm the {clientIp} template cache on every SW wake (module state is lost
  // when the worker is killed), so inbox creation sends the real public IP
  // instead of the 127.0.0.1 placeholder.
  void (async () => {
    try {
      const { refreshClientIp } = await import('@/utils/security/client-ip.js');
      await refreshClientIp();
    } catch (e) {
      logDebug('refreshClientIp failed - resolver falls back to 127.0.0.1', e);
    }
  })();
  // ── Register all event listeners SYNCHRONOUSLY first ───────────────
  // In MV3, the service worker can be terminated mid-await. Listeners
  // registered after an awaited operation may not be live when an event
  // arrives. Per Chrome guidance, register top-level event listeners
  // synchronously, then perform async initialization below.
  registerMessageHandler();
  setupOnboardingPreparation();
  setupPeriodicEmailCheck(checkNewEmails);
  setupAddressExpiryCheck();
  setupUnreadBadge();
  setupContextMenu();
  setupOmnibox();
  setupStorageSyncMirror();
  setupVaultAutoLockCheck();
  setupClipboardPurgeAlarm();
  setupWebDAVAutoBackupAlarm();

  browser.runtime.onInstalled.addListener((details: { reason: string }) => {
    if (CONSTANTS.DEBUG) logDebug(`Extension installed/updated: ${details.reason}`);
    void configureToolbarDefaultUi();
    const isInstall = details.reason === 'install';
    void (async () => {
      try {
        if (isInstall) {
          await browser.storage.local.clear();
          if (CONSTANTS.DEBUG) log('Storage cleared on install');
        }
      } catch (error) {
        logError('Failed to clear storage during install initialization', error);
      }
      try {
        // The old default was true. Preserve it for upgrades that never
        // persisted a choice, while fresh installs explicitly opt out.
        await initializeSmartAutofillSettings(isInstall ? 'install' : 'update');
      } catch (error) {
        logError('Failed to initialize smart autofill settings', error);
      }
    })();
    // Existing tabs won't have content scripts until inject/refresh
    void (async () => {
      try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (tab?.id) {
          await ensureTabAutofillReady(tab.id, {
            notifyIfRefreshNeeded: details.reason === 'install' || details.reason === 'update',
          });
        }
      } catch (e) {
        logDebug('onInstalled tab autofill ensure failed', e);
      }
      if (details.reason === 'update') {
        try {
          await markOpenTabsForReload();
        } catch (error) {
          logError('Failed to mark existing tabs for reload after extension update', error);
        }
      }
    })();
  });

  try {
    browser.runtime.onStartup.addListener(() => {
      void configureToolbarDefaultUi();
    });
  } catch (e) {
    logDebug('runtime.onStartup unavailable', e);
  }

  // Commands: open autofill manager, quick generate, copy latest OTP
  try {
    browser.commands.onCommand.addListener((command) => {
      void recordVaultActivity().catch((error) =>
        logError('Failed to record command vault activity', error)
      );
      if (command === 'open-autofill-manager') {
        void openExtensionView('autofill');
      } else if (command === 'quick-generate-inbox') {
        void (async () => {
          try {
            const acc = (await createAddress()) as Address;
            if (acc?.address) {
              createBrowserNotification('quick_gen', {
                type: 'basic',
                iconUrl: 'icons/icon48.png',
                title: tSync('notifications.tempMailGenerated'),
                message: tSync('notifications.tempMailGeneratedMessage', { address: acc.address }),
              });
            }
          } catch (e) {
            logError('Failed quick generate shortcut', e);
          }
        })();
      } else if (command === 'copy-latest-otp') {
        // The handler reads the authoritative `latestOtp` cache (storage.local)
        // maintained by the email-storage writers - see latest-otp-shortcut.ts.
        void handleCopyLatestOtpCommand();
      }
    });
  } catch {
    /* commands optional */
  }

  // Handle notification clicks - open extension or direct Magic Link tab
  browser.notifications.onClicked.addListener(async (notificationId: string) => {
    void recordVaultActivity().catch((error) =>
      logError('Failed to record notification vault activity', error)
    );
    if (CONSTANTS.DEBUG) log(`Notification clicked: ${notificationId}`);

    if (notificationId.startsWith('magiclink:')) {
      // Format: magiclink:{emailId}:{addressId} - emailId may itself contain
      // ":", so the address id is the last segment. The URL is resolved from
      // the stored message rather than embedded in the id (embedding breaches
      // Chrome's 500-char notification-id limit on long SSO/magic URLs).
      const rest = notificationId.slice('magiclink:'.length);
      const parts = rest.split(':');
      if (parts.length >= 2) {
        const addressId = parts[parts.length - 1] as string;
        const emailId = parts.slice(0, -1).join(':');
        if (emailId && addressId) {
          try {
            const emails = await getStoredEmailsForAddress(addressId);
            const msg = emails.find((m) => String(m.id) === emailId);
            // magicLinks[] is the validated path (detector hard-rejects
            // non-https destinations). The legacy flat `magicLinkUrl` field
            // is written by NOTHING in the codebase; as an unvalidated
            // string it would have bypassed the detector - removed. The
            // scheme gate is anchored: plain `http:` must not pass.
            const magicUrl = msg?.magicLinks?.[0]?.url;
            if (/^https:\/\//.test(magicUrl || '')) {
              await openSignupVerificationLink(magicUrl as string, addressId);
              return;
            }
          } catch (error) {
            logError(
              'Failed to resolve magic link for notification',
              { notificationId },
              error instanceof Error ? error : new Error(String(error))
            );
          }
          // Message or URL gone (deleted/expired) - fall back to the mailbox
          // with the message selected, same as the email: branch below.
          await writeWithRetry({
            pendingEmailOpen: {
              emailId,
              addressId,
              expiresAt: Date.now() + 5 * 60 * 1000,
            },
          });
          await browser.tabs.create({
            url: 'app.html',
          });
          return;
        }
      }
    }

    // Clipboard-purge stuck alert (review-2-glm §10.3): open Settings, where
    // the Privacy card shows how many purge records keep failing.
    if (notificationId.startsWith('clipboard-purge-alert:')) {
      await openExtensionView('settings');
      return;
    }

    // Parse notification ID to extract email ID and inbox ID
    // Format: email:{emailId}:{addressId} - emailId may itself contain ":", so
    // re-join the middle segments like the adjacent magiclink: branch does.
    if (notificationId.startsWith('email:')) {
      const parts = notificationId.split(':');
      if (parts.length >= 3) {
        const addressId = parts[parts.length - 1] as string;
        const emailId = parts.slice(1, -1).join(':');
        if (!emailId || !addressId) return;

        // Store the selected email to open
        await writeWithRetry({
          pendingEmailOpen: {
            emailId,
            addressId,
            expiresAt: Date.now() + 5 * 60 * 1000,
          },
        });

        // Open extension in a new tab (app.html) - popup cannot be opened programmatically
        await browser.tabs.create({
          url: 'app.html',
        });
      }
    }
  });

  // Keep settings & User-Agent rules in sync with storage changes
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.otpDetectionMode) {
        const v = changes.otpDetectionMode.newValue as OtpDetectionMode | undefined;
        if (v) setOtpDetectionMode(v);
      }
      if (changes.otpDetectionEnabled) {
        setOtpDetectionEnabled(changes.otpDetectionEnabled.newValue !== false);
      }
      if (changes.magicLinkDetectionEnabled) {
        setMagicLinkDetectionEnabled(changes.magicLinkDetectionEnabled.newValue !== false);
      }
      if (changes.otpDetectionProvider) {
        const v = changes.otpDetectionProvider.newValue as OtpDetectionProvider | undefined;
        if (v === 'algorithm' || v === 'ai') setOtpDetectionProvider(v);
      }
      if (changes.aiBaseUrl || changes.aiApiKey || changes.aiModel) {
        browser.storage.local
          .get(['aiBaseUrl', 'aiApiKey', 'aiModel'])
          .then(async (cfg) => {
            const key = (cfg as { aiApiKey?: string }).aiApiKey || '';
            const apiKey = key ? await decryptSecret(key) : '';
            setAiConfig(
              (cfg as { aiBaseUrl?: string }).aiBaseUrl || '',
              apiKey,
              (cfg as { aiModel?: string }).aiModel || ''
            );
          })
          .catch((err) => logError('sync AI config failed', err));
      }
      if (changes.selectedIdentityId || changes.identities) {
        updateUserAgentSessionRule().catch((err) =>
          logError('updateUserAgentSessionRule failed', err)
        );
      }
    }
  });

  // ── Async initialization (does not block event delivery) ───────────
  (async () => {
    try {
      await initLogger().catch((error) =>
        logError('Background logger initialization failed', error)
      );
      if (CONSTANTS.DEBUG) log('=== BACKGROUND SCRIPT STARTED ===');
      await syncOtpDetectionMode();
      await updateUserAgentSessionRule().catch((err) =>
        logError('updateUserAgentSessionRule startup failed', err)
      );

      void initializeAnalytics().catch((err) =>
        logError('initializeAnalytics startup failed', err)
      );
      void initializeDefaultProvider().catch((err) =>
        logError('initializeDefaultProvider startup failed', err)
      );

      // Preload translations for current locale (async, non-blocking for events)
      const locale = await getStoredLocaleAsync();
      await preloadTranslations(locale);
      // Also preload English as fallback
      if (locale !== 'en') {
        await preloadTranslations('en');
      }

      if (CONSTANTS.DEBUG) logDebug('=== BACKGROUND SCRIPT INITIALIZED ===');
    } catch (error) {
      logError('Background initialization failed', error);
    } finally {
      perfEnd('bg.swStart', swStart);
    }
  })();

  // Dev-only wake telemetry: every alarm, message and SW cold start lands in
  // the perf ring so the Diagnostics report can show what wakes the worker.
  browser.alarms.onAlarm.addListener((alarm) => {
    perfMark('bg.alarmWake', { name: alarm.name });
  });
  browser.runtime.onMessage.addListener((message: unknown) => {
    const type =
      typeof message === 'object' && message !== null && 'type' in message
        ? String((message as { type: unknown }).type)
        : 'unknown';
    perfMark('bg.message', { type });
  });
});
