import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { DEBUG } from '@/utils/constants.js';
import { getCurrentLocale, preloadTranslations } from '@/utils/i18n-utils.js';
import { initializeDefaultProvider } from '@/utils/instance-manager.js';
import { log, logDebug, logError } from '@/utils/logger.js';
import {
  addToAutofillBlocklist,
  getAutofillBlocklist,
  getSelectedProvider,
  removeFromAutofillBlocklist,
} from '@/utils/storage-keys.js';
import { initializeAnalytics } from './inbox/analytics.js';
import {
  checkNewEmails,
  createInbox,
  setupInboxExpiryCheck,
  setupPeriodicEmailCheck,
} from './inbox/inbox-manager.js';
import { registerMessageHandler } from './runtime/message-handler.js';

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

/** Register right-click context menus for temp email and autofill blocklist. */
function setupContextMenu() {
  browser.contextMenus.create({
    id: 'create-temp-email',
    title: 'Create Temp Email',
    contexts: ['page', 'link', 'editable'],
  });

  browser.contextMenus.create({
    id: 'separator-autofill',
    type: 'separator',
    contexts: ['page'],
  });

  browser.contextMenus.create({
    id: 'autofill-toggle-blocklist',
    title: 'Exclude from Autofill',
    contexts: ['page'],
  });

  // Update context menu title dynamically based on current tab's blocklist status
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
    } catch {
      // Tab may not have a valid URL (e.g. about:blank)
    }
  }

  // Update context menu when user switches tabs
  browser.tabs.onActivated.addListener(async (activeInfo) => {
    await updateContextMenuForTab(activeInfo.tabId);
  });

  // Update context menu when page navigates
  browser.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (changeInfo.url) {
      await updateContextMenuForTab(tabId);
    }
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'create-temp-email') {
      try {
        const provider = await getSelectedProvider();
        if (!provider) return;
        const inbox = await createInbox(provider);
        if (tab?.id) {
          await browser.scripting.executeScript({
            target: { tabId: tab.id },
            func: (text: string) => navigator.clipboard.writeText(text),
            args: [inbox.address],
          });
        }
        browser.notifications.create(`ctx_${inbox.address}`, {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'Temp Email Created',
          message: `${inbox.address}\nCopied to clipboard!`,
        });
      } catch (e) {
        if (DEBUG) log(`Context menu createInbox error: ${e}`);
      }
      return;
    }

    if (info.menuItemId === 'autofill-toggle-blocklist') {
      try {
        if (!tab?.url) return;
        const url = new URL(tab.url);
        const domain = url.hostname;
        const blocklist = await getAutofillBlocklist();
        const isBlocked = blocklist.includes(domain);

        if (isBlocked) {
          // Remove from blocklist
          await removeFromAutofillBlocklist(domain);
          browser.notifications.create(`unblocked_${domain}`, {
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'Autofill Re-enabled',
            message: `Autofill is now enabled for ${domain}`,
          });
        } else {
          // Add to blocklist
          await addToAutofillBlocklist(domain);
          browser.notifications.create(`blocked_${domain}`, {
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'Autofill Excluded',
            message: `Autofill is now disabled for ${domain}`,
          });
        }

        // Update context menu title after change
        if (tab.id) await updateContextMenuForTab(tab.id);

        // Notify content script to refresh autofill state
        if (tab.id) {
          await browser.tabs.sendMessage(tab.id, { type: 'autofillBlocklistChanged' }).catch(() => {
            // Content script may not be loaded
          });
        }
      } catch (e) {
        if (DEBUG) log(`Context menu blocklist error: ${e}`);
      }
    }
  });
}

export default defineBackground(async () => {
  if (DEBUG) log('=== BACKGROUND SCRIPT STARTED ===');

  // Preload translations for current locale
  const locale = await getCurrentLocale();
  await preloadTranslations(locale);
  // Also preload English as fallback
  if (locale !== 'en') {
    await preloadTranslations('en');
  }

  // Register alarm listeners and setup periodic checks on EVERY service worker start
  // In MV3, service workers can be terminated and restarted, so we must setup alarms on every start
  initializeAnalytics();
  setupPeriodicEmailCheck(checkNewEmails);
  setupInboxExpiryCheck();
  initializeDefaultProvider();
  registerMessageHandler();
  setupUnreadBadge();
  setupContextMenu();

  if (DEBUG) logDebug('=== BACKGROUND SCRIPT INITIALIZED ===');

  browser.runtime.onInstalled.addListener((details: { reason: string }) => {
    if (DEBUG) logDebug(`Extension installed/updated: ${details.reason}`);
    if (details.reason === 'install') {
      browser.storage.local.clear().then(() => {
        if (DEBUG) log('Storage cleared on install');
      });
    }
  });

  // Handle notification clicks - open extension and navigate to email
  browser.notifications.onClicked.addListener(async (notificationId: string) => {
    if (DEBUG) log(`Notification clicked: ${notificationId}`);

    // Parse notification ID to extract email ID and inbox ID
    // Format: email_{emailId}_{inboxId}
    if (notificationId.startsWith('email_')) {
      const parts = notificationId.split('_');
      if (parts.length >= 3) {
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
});
