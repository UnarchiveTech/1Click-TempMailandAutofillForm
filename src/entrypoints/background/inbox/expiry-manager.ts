/**
 * Inbox expiry management
 * Handles inbox expiry checking, auto-renewal, and expiry notifications
 */

import { browser } from 'wxt/browser';
import { EXPIRY_WARNING_THRESHOLD_MS } from '@/utils/constants.js';
import { EmailService, loadProviderConfig } from '@/utils/email-service.js';
import { logError } from '@/utils/logger.js';
import type { Account, NotificationSettings } from '@/utils/types.js';

export async function checkInboxExpiry(): Promise<void> {
  try {
    const { inboxes = [], notificationSettings = { enabled: true } } =
      (await browser.storage.local.get(['inboxes', 'notificationSettings'])) as {
        inboxes?: Account[];
        notificationSettings?: NotificationSettings;
      };

    if (!notificationSettings?.enabled || inboxes.length === 0) return;

    const now = Date.now();
    const updatedInboxes = [...inboxes];

    for (let i = 0; i < updatedInboxes.length; i++) {
      const inbox = updatedInboxes[i];

      if (inbox.expiresAt && inbox.expiresAt <= now) {
        if (inbox.autoExtend) {
          const providerConfig = loadProviderConfig(inbox.provider);
          if (!providerConfig.expiry?.renewable) {
            // Provider doesn't support renewal, keep as expired (don't auto-archive)
            // The inbox will show as "Expired" in the UI

            if (notificationSettings?.enabled) {
              browser.notifications.create({
                type: 'basic',
                iconUrl: 'icons/icon48.png',
                title: 'Inbox Expired',
                message: `The inbox ${inbox.address} has expired. Emails are preserved locally.`,
                priority: 1,
              });
            }
            continue;
          }
          try {
            // Auto-renew inbox using EmailService
            const config = loadProviderConfig(inbox.provider);
            const service = new EmailService(config, browser);

            if (!inbox.token && !inbox.sidToken) {
              throw new Error('No token available for renewal');
            }

            const currentUser = inbox.address.split('@')[0];
            const newEmailResponse = await service.executeOperation('createInbox', {
              forceNewSession: true,
            });

            if (!newEmailResponse.token) {
              throw new Error('Failed to get fresh token for renewal');
            }

            const newSidToken = newEmailResponse.token as string;

            // Call renewal operation from config
            const renewalConfig = loadProviderConfig(inbox.provider);
            if (renewalConfig.expiry?.renewalMethod) {
              await service.executeOperation(renewalConfig.expiry.renewalMethod, {
                auth: { token: newSidToken },
                variables: { emailUser: currentUser },
              });
            }

            const { inboxes: allInboxes = [] } = (await browser.storage.local.get(['inboxes'])) as {
              inboxes?: Account[];
            };
            const inboxIndex = allInboxes.findIndex((i: Account) => i.id === inbox.id);

            if (inboxIndex !== -1) {
              const timestamp = newEmailResponse.timestamp as number;
              const renewedInbox = {
                ...allInboxes[inboxIndex],
                token: newSidToken,
                sidToken: newSidToken,
                expiresAt:
                  ((timestamp || 0) + (providerConfig.expiry?.duration || 3600000) / 1000) * 1000,
                expiryNotified: false,
              };

              allInboxes[inboxIndex] = renewedInbox;
              await browser.storage.local.set({ inboxes: allInboxes });
              updatedInboxes[i] = renewedInbox;
            }

            if (notificationSettings?.enabled) {
              browser.notifications.create({
                type: 'basic',
                iconUrl: 'icons/icon48.png',
                title: 'Inbox Auto-Renewed',
                message: `The inbox ${inbox.address} has been automatically renewed.`,
                priority: 1,
              });
            }
          } catch (renewError: unknown) {
            logError('Failed to auto-renew inbox', {
              inboxAddress: inbox.address,
              error: renewError,
            });
            // Keep as expired (don't auto-archive)
            if (notificationSettings?.enabled) {
              browser.notifications.create({
                type: 'basic',
                iconUrl: 'icons/icon48.png',
                title: 'Inbox Expired',
                message: `The inbox ${inbox.address} has expired. Emails are preserved locally.`,
                priority: 1,
              });
            }
            continue;
          }
        } else {
          // Keep as expired (don't auto-archive)
          if (notificationSettings?.enabled) {
            browser.notifications.create({
              type: 'basic',
              iconUrl: 'icons/icon48.png',
              title: 'Inbox Expired',
              message: `The inbox ${inbox.address} has expired. Emails are preserved locally.`,
              priority: 1,
            });
          }
          continue;
        }
      }

      const timeLeft = inbox.expiresAt ? inbox.expiresAt - now : null;
      if (timeLeft && timeLeft <= EXPIRY_WARNING_THRESHOLD_MS && !inbox.expiryNotified) {
        if (notificationSettings?.enabled) {
          browser.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon48.png',
            title: 'Inbox Expiring Soon',
            message: `The inbox ${inbox.address} will expire in less than 1 hour.`,
            priority: 1,
          });
        }
        updatedInboxes[i] = { ...inbox, expiryNotified: true };
      }
    }

    await browser.storage.local.set({ inboxes: updatedInboxes });
  } catch (error: unknown) {
    logError(
      'Error in inbox expiry check:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

export function setupInboxExpiryCheck(): void {
  const INBOX_EXPIRY_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute

  browser.alarms.create('checkInboxExpiry', {
    periodInMinutes: INBOX_EXPIRY_CHECK_INTERVAL_MS / 60 / 1000,
  });

  checkInboxExpiry();

  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'checkInboxExpiry') {
      await checkInboxExpiry();
    }
  });
}
