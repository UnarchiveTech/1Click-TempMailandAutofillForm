import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { DEBUG } from '@/utils/constants.js';
import { getCurrentLocale, preloadTranslations } from '@/utils/i18n-utils.js';
import { initializeDefaultProvider } from '@/utils/instance-manager.js';
import { log, logDebug } from '@/utils/logger.js';
import { initializeAnalytics } from './inbox/analytics.js';
import {
  checkNewEmails,
  setupInboxExpiryCheck,
  setupPeriodicEmailCheck,
} from './inbox/inbox-manager.js';
import { registerMessageHandler } from './runtime/message-handler.js';

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
