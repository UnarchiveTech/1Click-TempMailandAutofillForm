import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { SETTINGS_SYNC_KEYS } from '@/features/settings/use-extension-storage-sync.js';
import { DEBUG } from '@/utils/constants.js';
import { getCurrentLocale, preloadTranslations, tSync } from '@/utils/i18n-utils.js';
import { initializeDefaultProvider } from '@/utils/instance-manager.js';
import { initLogger, log, logDebug, logError, logInfo } from '@/utils/logger.js';
import {
  addToAutofillBlocklist,
  getAutofillBlocklist,
  getSelectedProvider,
  removeFromAutofillBlocklist,
} from '@/utils/storage-keys.js';
import { lockVault } from '@/utils/vault-lock.js';
import { initializeAnalytics } from './inbox/analytics.js';
import {
  checkNewEmails,
  createInbox,
  setupInboxExpiryCheck,
  setupPeriodicEmailCheck,
} from './inbox/inbox-manager.js';
import { type OtpDetectionMode, setOtpDetectionMode } from './parsing/otp.js';
import { registerMessageHandler } from './runtime/message-handler.js';
import { autofillActiveTab, ensureTabAutofillReady } from './tab-autofill.js';

async function syncOtpDetectionMode() {
  try {
    const { otpDetectionMode } = (await browser.storage.local.get(['otpDetectionMode'])) as {
      otpDetectionMode?: OtpDetectionMode;
    };
    if (otpDetectionMode) setOtpDetectionMode(otpDetectionMode);
  } catch {
    /* ignore */
  }
}

/** Count unread emails across all inboxes and set the badge. */
async function setupUnreadBadge() {
  async function updateBadge() {
    const {
      storedEmails = {},
      readEmails = {},
      customColor,
    } = (await browser.storage.local.get(['storedEmails', 'readEmails', 'customColor'])) as {
      storedEmails?: Record<string, { id: string }[]>;
      readEmails?: Record<string, boolean>;
      customColor?: string;
    };
    let unread = 0;
    for (const [addr, msgs] of Object.entries(storedEmails)) {
      unread += msgs.filter((m) => {
        const mExt = m as { id: string; original_inbox?: string };
        const key = `${mExt.original_inbox || addr}_${m.id}`;
        return !readEmails[key] && !readEmails[m.id];
      }).length;
    }
    await browser.action.setBadgeBackgroundColor({ color: customColor || '#4c662b' });
    await browser.action.setBadgeText({ text: unread > 0 ? String(unread) : '' });
  }

  // Update on every relevant storage change
  browser.storage.onChanged.addListener((changes) => {
    if (changes.storedEmails || changes.readEmails || changes.customColor) {
      updateBadge().catch((e) => logError('updateBadge error', e));
    }
  });

  // Set initial badge on service worker start
  await updateBadge();
}

async function getActiveInboxAddress(): Promise<string> {
  try {
    const res = (await browser.storage.local.get(['activeInboxId', 'inboxes'])) as {
      activeInboxId?: string;
      inboxes?: Array<{ id?: string; address?: string; status?: string }>;
    };
    const list = res.inboxes || [];
    const byId = list.find((i) => i.id === res.activeInboxId && i.address);
    if (byId?.address) return byId.address;
    const active = list.find((i) => i.status === 'active' && i.address);
    return active?.address || list[0]?.address || '';
  } catch {
    return '';
  }
}

async function openExtensionView(view: string, extra?: Record<string, unknown>): Promise<void> {
  const payload = { openView: view, openViewAt: Date.now(), ...extra };
  try {
    await browser.storage.local.set(payload);
  } catch {
    /* ignore */
  }
  try {
    await browser.storage.session.set(payload);
  } catch {
    /* session may be unavailable */
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

/** Right-click on page + right-click on extension toolbar icon (action). */
function setupContextMenu() {
  // Non-empty tuple required by @types/chrome ContextType[]
  const actionContexts: ['action'] = ['action'];

  function createActionMenu(id: string, title: string, extra?: Record<string, unknown>) {
    try {
      browser.contextMenus.create({
        id,
        title,
        contexts: actionContexts,
        ...extra,
      } as Parameters<typeof browser.contextMenus.create>[0]);
    } catch (e) {
      logDebug(`contextMenus.create ${id} failed`, e);
    }
  }

  function sep(id: string) {
    try {
      browser.contextMenus.create({
        id,
        type: 'separator',
        contexts: actionContexts,
      } as Parameters<typeof browser.contextMenus.create>[0]);
    } catch {
      /* ignore */
    }
  }

  browser.contextMenus
    .removeAll()
    .then(async () => {
      await preloadTranslations(await getCurrentLocale());
      const addr = (await getActiveInboxAddress()) || tSync('contextMenu.noAddressYet');

      // —— Extension icon (toolbar) menu ——
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
      // Flat address list (no nested parent — Chrome action menus drop siblings when nested)
      try {
        await rebuildAddressSubmenu();
      } catch (e) {
        logDebug('rebuildAddressSubmenu failed', e);
      }

      // —— Page context menu ——
      try {
        browser.contextMenus.create({
          id: 'create-temp-email',
          title: tSync('contextMenu.createTempEmail'),
          contexts: ['page', 'link', 'editable'],
        });
        browser.contextMenus.create({
          id: 'separator-autofill',
          type: 'separator',
          contexts: ['page'],
        });
        browser.contextMenus.create({
          id: 'page-autofill-form',
          title: tSync('contextMenu.autofillThisPage'),
          contexts: ['page', 'editable'],
        });
        browser.contextMenus.create({
          id: 'autofill-toggle-blocklist',
          title: tSync('contextMenu.excludeFromAutofill'),
          contexts: ['page'],
        });
      } catch (e) {
        logDebug('page context menus failed', e);
      }
    })
    .catch((e) => logError('contextMenus.removeAll failed', e));

  async function refreshActionEmailTitle() {
    try {
      const addr = (await getActiveInboxAddress()) || tSync('contextMenu.noAddressYet');
      await browser.contextMenus.update('action-active-email', { title: addr });
    } catch {
      /* menu may not exist yet */
    }
  }

  async function rebuildAddressSubmenu() {
    try {
      // Flat list under action context (max ~8) — nested parent menus are unreliable on Chrome.
      const res = (await browser.storage.local.get(['inboxes'])) as {
        inboxes?: Array<{ id?: string; address?: string; accountStatus?: string }>;
      };
      const list = (res.inboxes || [])
        .filter((i) => i.address && i.accountStatus !== 'deleted')
        .slice(0, 8);

      for (let i = 0; i < 12; i++) {
        await browser.contextMenus.remove(`action-address-item-${i}`).catch(() => {});
      }
      await browser.contextMenus.remove('action-address-empty').catch(() => {});
      await browser.contextMenus.remove('action-addresses-parent').catch(() => {});

      if (list.length === 0) {
        createActionMenu('action-address-empty', tSync('contextMenu.noAddressesYet'), {
          enabled: false,
        });
        return;
      }
      list.forEach((inbox, idx) => {
        const title = inbox.address || inbox.id || 'address';
        // Truncate long addresses for the action menu
        const short = title.length > 36 ? `${title.slice(0, 33)}…` : title;
        createActionMenu(`action-address-item-${idx}`, short);
      });
      try {
        await browser.storage.session.set({
          actionAddressMenuMap: Object.fromEntries(
            list.map((inbox, idx) => [`action-address-item-${idx}`, inbox.id || ''])
          ),
        });
      } catch {
        /* session optional */
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
      const isBlocked = blocklist.includes(domain);

      await browser.contextMenus.update('autofill-toggle-blocklist', {
        title: isBlocked ? `Remove "${domain}" from Autofill Blocklist` : 'Exclude from Autofill',
      });
      await refreshActionEmailTitle();
      // Password-manager-style cue: badge when signup form present
      void ensureTabAutofillReady(tabId).catch(() => {});
    } catch {
      // Tab may not have a valid URL (e.g. about:blank)
    }
  }

  browser.tabs.onActivated.addListener((activeInfo) => {
    updateContextMenuForTab(activeInfo.tabId).catch(() => {});
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'complete' || changeInfo.url) {
      updateContextMenuForTab(tabId).catch(() => {});
    }
    if (changeInfo.url) {
      browser.storage.session.remove('sessionCredentials').catch(() => {});
    }
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.activeInboxId || changes.inboxes) {
      void refreshActionEmailTitle();
      void rebuildAddressSubmenu();
    }
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    const id = String(info.menuItemId);

    if (id === 'action-autofill-page' || id === 'page-autofill-form') {
      const result = await autofillActiveTab();
      if (!result.ok) {
        const msg =
          result.reason === 'no_form'
            ? 'No signup form found. Refresh the page if you just installed the extension.'
            : result.reason === 'need_refresh'
              ? 'Refresh this page so autofill can run, then try again.'
              : 'Could not autofill this page.';
        browser.notifications
          .create(`af_${Date.now()}`, {
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'Autofill',
            message: msg,
          })
          .catch(() => {});
      }
      return;
    }

    if (id === 'action-create-temp-email' || id === 'create-temp-email') {
      try {
        const provider = await getSelectedProvider();
        if (!provider) return;
        const inbox = await createInbox(provider);
        // Select new mailbox + open popup mailbox view on next open
        try {
          await browser.storage.local.set({
            activeInboxId: inbox.id,
            openView: 'main',
            openViewAt: Date.now(),
          });
          await browser.storage.session.set({
            openView: 'main',
            openViewAt: Date.now(),
          });
        } catch {
          /* ignore */
        }
        if (tab?.id) {
          await browser.scripting
            .executeScript({
              target: { tabId: tab.id },
              func: (text: string) => navigator.clipboard.writeText(text),
              args: [inbox.address],
            })
            .catch(() => {});
          const status = await ensureTabAutofillReady(tab.id, {
            notifyIfRefreshNeeded: true,
          });
          if (status === 'form') {
            browser.notifications
              .create(`ctx_form_${inbox.address}`, {
                type: 'basic',
                iconUrl: 'icons/icon128.png',
                title: 'Temp email ready',
                message: `${inbox.address}\nSignup form detected — use Autofill this page or the on-page button.`,
              })
              .catch(() => {});
          } else {
            browser.notifications
              .create(`ctx_${inbox.address}`, {
                type: 'basic',
                iconUrl: 'icons/icon128.png',
                title: 'Temp Email Created',
                message: `${inbox.address}\nCopied to clipboard!`,
              })
              .catch(() => {});
          }
        } else {
          browser.notifications
            .create(`ctx_${inbox.address}`, {
              type: 'basic',
              iconUrl: 'icons/icon128.png',
              title: 'Temp Email Created',
              message: `${inbox.address}`,
            })
            .catch(() => {});
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
        if (DEBUG) log(`Context menu createInbox error: ${e}`);
      }
      return;
    }

    if (id === 'action-report-issue') {
      try {
        const { GITHUB_ISSUES_URL } = await import('@/utils/constants.js');
        await browser.tabs.create({
          url: GITHUB_ISSUES_URL,
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
        // openPopup often requires user gesture / may be unavailable — fall back to app
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
        const inboxId = mapRes.actionAddressMenuMap?.[id] || '';
        if (!inboxId) return;
        await browser.storage.local.set({
          activeInboxId: inboxId,
          openView: 'main',
          openViewAt: Date.now(),
        });
        await browser.storage.session.set({ openView: 'main', openViewAt: Date.now() });
        await openExtensionView('main');
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
        const blocklist = await getAutofillBlocklist();
        const isBlocked = blocklist.includes(domain);

        if (isBlocked) {
          await removeFromAutofillBlocklist(domain);
          browser.notifications
            .create(`unblocked_${domain}`, {
              type: 'basic',
              iconUrl: 'icons/icon128.png',
              title: 'Autofill Re-enabled',
              message: `Autofill is now enabled for ${domain}`,
            })
            .catch(() => {});
        } else {
          await addToAutofillBlocklist(domain);
          browser.notifications
            .create(`blocked_${domain}`, {
              type: 'basic',
              iconUrl: 'icons/icon128.png',
              title: 'Autofill Excluded',
              message: `Autofill is now disabled for ${domain}`,
            })
            .catch(() => {});
        }

        if (targetTab.id) await updateContextMenuForTab(targetTab.id);
        if (targetTab.id) {
          await browser.tabs
            .sendMessage(targetTab.id, { type: 'autofillBlocklistChanged' })
            .catch(() => {});
        }
        // Refresh action menu title for exclude item
        try {
          const stillBlocked = (await getAutofillBlocklist()).includes(domain);
          await browser.contextMenus.update('action-exclude-autofill', {
            title: stillBlocked
              ? `Remove "${domain}" from Autofill Blocklist`
              : 'Exclude from Autofill',
          });
        } catch {
          /* ignore */
        }
      } catch (e) {
        if (DEBUG) log(`Context menu blocklist error: ${e}`);
      }
    }
  });
}

/** Omnibox keyword "1c" — search signup credentials / open Autofill manager (PM-style address bar). */
function setupOmnibox() {
  try {
    browser.omnibox.setDefaultSuggestion({
      description:
        '1Click · Search signup credentials or type: fill | profiles | mailbox | settings',
    });
  } catch (e) {
    logDebug('omnibox.setDefaultSuggestion unavailable', e);
    return;
  }

  browser.omnibox.onInputChanged.addListener((text, suggest) => {
    void (async () => {
      const q = (text || '').trim().toLowerCase();
      const suggestions: { content: string; description: string }[] = [];

      if (!q || 'fill'.startsWith(q) || 'autofill'.startsWith(q)) {
        suggestions.push({
          content: 'fill',
          description: 'Autofill signup form on the current tab',
        });
      }
      if (!q || 'profiles'.startsWith(q) || 'profile'.startsWith(q)) {
        suggestions.push({
          content: 'profiles',
          description: 'Open Autofill manager → Profiles',
        });
      }
      if (!q || 'credentials'.startsWith(q) || 'cred'.startsWith(q)) {
        suggestions.push({
          content: 'credentials',
          description: 'Open Autofill manager → Credentials (signup)',
        });
      }
      if (!q || 'mailbox'.startsWith(q) || 'mail'.startsWith(q)) {
        suggestions.push({
          content: 'mailbox',
          description: 'Open Mailbox',
        });
      }
      if (!q || 'settings'.startsWith(q)) {
        suggestions.push({
          content: 'settings',
          description: 'Open Settings',
        });
      }

      try {
        const { loginInfo = [] } = (await browser.storage.local.get(['loginInfo'])) as {
          loginInfo?: Array<{ email?: string; website?: string; domain?: string; id?: string }>;
        };
        const hits = (loginInfo || [])
          .filter((row) => {
            if (!q) return false;
            const hay = `${row.email || ''} ${row.website || ''} ${row.domain || ''}`.toLowerCase();
            return hay.includes(q);
          })
          .slice(0, 5);
        for (const row of hits) {
          const site = row.website || row.domain || 'site';
          const email = row.email || '';
          suggestions.push({
            content: `cred:${row.id || email}`,
            description: `Credential · ${email} · ${site}`,
          });
        }
      } catch {
        /* ignore */
      }

      suggest(suggestions.slice(0, 8));
    })();
  });

  browser.omnibox.onInputEntered.addListener((text, disposition) => {
    void (async () => {
      const cmd = (text || '').trim().toLowerCase();
      if (cmd === 'fill' || cmd === 'autofill') {
        await autofillActiveTab();
        return;
      }
      if (cmd === 'profiles' || cmd === 'profile') {
        await browser.storage.local.set({ openView: 'autofill', autofillTab: 'profiles' });
        await openExtensionView('autofill');
        return;
      }
      if (cmd === 'credentials' || cmd === 'cred' || cmd.startsWith('cred:')) {
        await browser.storage.local.set({ openView: 'autofill', autofillTab: 'credentials' });
        await openExtensionView('autofill');
        return;
      }
      if (cmd === 'mailbox' || cmd === 'mail') {
        await openExtensionView('main');
        return;
      }
      if (cmd === 'settings') {
        await openExtensionView('settings');
        return;
      }
      // Default: open autofill hub
      await browser.storage.local.set({ openView: 'autofill' });
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

  async function isMirroringLocked(): Promise<boolean> {
    try {
      const res = await browser.storage.session.get('_sync_mirroring_lock');
      return !!res._sync_mirroring_lock;
    } catch {
      return false;
    }
  }

  async function setMirroringLock(locked: boolean): Promise<void> {
    try {
      if (locked) {
        await browser.storage.session.set({ _sync_mirroring_lock: true });
      } else {
        await browser.storage.session.remove('_sync_mirroring_lock');
      }
    } catch {
      /* ignore session storage lock errors */
    }
  }

  // local → sync: when a setting changes locally, push it to sync
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    void (async () => {
      if (await isMirroringLocked()) return;
      const toSync: Record<string, unknown> = {};
      for (const key of Object.keys(changes)) {
        if (syncKeysSet.has(key)) {
          toSync[key] = changes[key].newValue;
        }
      }
      if (Object.keys(toSync).length > 0) {
        await setMirroringLock(true);
        await browser.storage.sync
          .set(toSync)
          .catch((e: unknown) => logError('storage.sync mirror (local→sync) failed', e))
          .finally(async () => {
            await setMirroringLock(false);
          });
      }
    })();
  });

  // sync → local: when a setting arrives from another device, apply it locally
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    void (async () => {
      if (await isMirroringLocked()) return;
      const toLocal: Record<string, unknown> = {};
      for (const key of Object.keys(changes)) {
        if (syncKeysSet.has(key)) {
          toLocal[key] = changes[key].newValue;
        }
      }
      if (Object.keys(toLocal).length > 0) {
        await setMirroringLock(true);
        await browser.storage.local
          .set(toLocal)
          .catch((e: unknown) => logError('storage.sync mirror (sync→local) failed', e))
          .finally(async () => {
            await setMirroringLock(false);
          });
      }
    })();
  });
}

function setupVaultAutoLockCheck(): void {
  // Avoid resetting the alarm's interval if it is already scheduled (restarting MV3 service worker)
  browser.alarms
    .get('vault_idle_autolock_check')
    .then((alarm) => {
      if (!alarm) {
        browser.alarms.create('vault_idle_autolock_check', { periodInMinutes: 5 });
      }
    })
    .catch((e) => logError('alarms.get failed', e));

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'vault_idle_autolock_check') {
      void (async () => {
        try {
          const sessionRes = (await browser.storage.session.get(['_last_vault_activity'])) as {
            _last_vault_activity?: number;
          };
          const lastActivity = sessionRes._last_vault_activity || Date.now();
          if (Date.now() - lastActivity > 15 * 60 * 1000) {
            await lockVault();
            logInfo('Vault auto-locked due to 15 minutes of inactivity.');
          }
        } catch (err) {
          logError('Failed during vault auto-lock check', err);
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
      if (DEBUG) logDebug(`DeclarativeNetRequest rule added for UA: ${customUA}`);
    } else {
      await browser.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [ruleId],
      });
      if (DEBUG) logDebug('DeclarativeNetRequest rule cleared for UA (using default)');
    }
  } catch (err) {
    logError('declarativeNetRequest UA spoofing rule failed', err);
  }
}

/**
 * Toolbar click must open the POPUP, never the side panel by default.
 * Side panel stays available via action context menu ("Open Side Panel").
 * Uses chrome.* first — WXT's browser polyfill can lag behind sidePanel APIs.
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
  } catch {
    /* ignore */
  }
}

export default defineBackground(() => {
  // Synchronous-first attempt so the first icon click after SW wake is correct
  void configureToolbarDefaultUi();

  // Load user provider JSON overrides before any create/check calls
  void (async () => {
    try {
      const { loadProviderOverridesFromStorage } = await import('@/utils/email-service.js');
      await loadProviderOverridesFromStorage(browser);
    } catch {
      /* bundled providers remain */
    }
  })();
  // ── Register all event listeners SYNCHRONOUSLY first ───────────────
  // In MV3, the service worker can be terminated mid-await. Listeners
  // registered after an awaited operation may not be live when an event
  // arrives. Per Chrome guidance, register top-level event listeners
  // synchronously, then perform async initialization below.
  registerMessageHandler();
  setupPeriodicEmailCheck(checkNewEmails);
  setupInboxExpiryCheck();
  setupUnreadBadge();
  setupContextMenu();
  setupOmnibox();
  setupStorageSyncMirror();
  setupVaultAutoLockCheck();

  browser.runtime.onInstalled.addListener((details: { reason: string }) => {
    if (DEBUG) logDebug(`Extension installed/updated: ${details.reason}`);
    void configureToolbarDefaultUi();
    if (details.reason === 'install') {
      browser.storage.local.clear().then(() => {
        if (DEBUG) log('Storage cleared on install');
      });
    }
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
    })();
  });

  try {
    browser.runtime.onStartup.addListener(() => {
      void configureToolbarDefaultUi();
    });
  } catch {
    /* onStartup may be unavailable */
  }

  // Commands: open autofill manager
  try {
    browser.commands.onCommand.addListener((command) => {
      if (command === 'open-autofill-manager') {
        void openExtensionView('autofill');
      }
    });
  } catch {
    /* commands optional */
  }

  // Handle notification clicks - open extension and navigate to email
  browser.notifications.onClicked.addListener(async (notificationId: string) => {
    if (DEBUG) log(`Notification clicked: ${notificationId}`);

    // Parse notification ID to extract email ID and inbox ID
    // Format: email:{emailId}:{inboxId}
    if (notificationId.startsWith('email:')) {
      const parts = notificationId.split(':');
      if (parts.length === 3) {
        const emailId = parts[1];
        const inboxId = parts[2];

        // Store the selected email to open
        await browser.storage.local.set({
          pendingEmailOpen: {
            emailId,
            inboxId,
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
      if (changes.selectedIdentityId || changes.identities) {
        updateUserAgentSessionRule().catch(() => {});
      }
    }
  });

  // ── Async initialization (does not block event delivery) ───────────
  (async () => {
    try {
      await initLogger().catch(() => {});
      if (DEBUG) log('=== BACKGROUND SCRIPT STARTED ===');
      await syncOtpDetectionMode();
      await updateUserAgentSessionRule().catch(() => {});

      initializeAnalytics();
      initializeDefaultProvider();

      // Preload translations for current locale (async, non-blocking for events)
      const locale = await getCurrentLocale();
      await preloadTranslations(locale);
      // Also preload English as fallback
      if (locale !== 'en') {
        await preloadTranslations('en');
      }

      if (DEBUG) logDebug('=== BACKGROUND SCRIPT INITIALIZED ===');
    } catch (_e) {
      // Safe logging fallback
    }
  })();
});
