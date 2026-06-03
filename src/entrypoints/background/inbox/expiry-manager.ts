/**
 * Inbox expiry management
 * Handles inbox expiry checking, auto-renewal, and expiry notifications
 */

import { browser } from 'wxt/browser';
import { EmailService, loadProviderConfig } from '@/utils/email-service.js';
import { InboxCreationError } from '@/utils/errors.js';
import { logError } from '@/utils/logger.js';
import { getInboxes, setInboxes } from '@/utils/storage-keys.js';
import type { Account, NotificationSettings } from '@/utils/types.js';

type NotificationType = 'expired' | 'renewed' | 'expiring-soon';

function createInboxNotification(type: NotificationType, address: string): void {
  const messages: Record<NotificationType, { title: string; message: string }> = {
    expired: {
      title: 'Inbox Expired',
      message: `The inbox ${address} has expired. Emails are preserved locally.`,
    },
    renewed: {
      title: 'Inbox Auto-Renewed',
      message: `The inbox ${address} has been automatically renewed.`,
    },
    'expiring-soon': {
      title: 'Inbox Expiring Soon',
      message: `The inbox ${address} will expire in less than 1 hour.`,
    },
  };
  const { title, message } = messages[type];
  browser.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title,
    message,
    priority: 1,
  });
}

export async function checkInboxExpiry(): Promise<void> {
  try {
    const {
      inboxes = [],
      notificationSettings = {
        enabled: true,
        soundEnabled: true,
        expiryWarningThreshold: 60 * 60 * 1000,
      },
    } = (await browser.storage.local.get(['inboxes', 'notificationSettings'])) as {
      inboxes?: Account[];
      notificationSettings?: NotificationSettings;
    };

    if (!notificationSettings?.enabled || inboxes.length === 0) return;

    const now = Date.now();
    const updatedInboxes = [...inboxes];
    const warningThreshold = notificationSettings.expiryWarningThreshold || 60 * 60 * 1000; // Default to 1 hour

    for (let i = 0; i < updatedInboxes.length; i++) {
      const inbox = updatedInboxes[i];

      if (inbox.expiresAt && inbox.expiresAt <= now) {
        if (inbox.autoExtend) {
          const providerConfig = loadProviderConfig(inbox.provider);
          if (!providerConfig.expiry?.renewable) {
            // Provider doesn't support renewal, keep as expired (don't auto-archive)
            // The inbox will show as "Expired" in the UI

            if (notificationSettings?.enabled) {
              createInboxNotification('expired', inbox.address);
            }
            continue;
          }
          try {
            // Auto-renew inbox using EmailService
            const config = loadProviderConfig(inbox.provider);
            const service = new EmailService(config, browser);

            if (!inbox.token && !inbox.sidToken) {
              throw new InboxCreationError(inbox.provider, {
                inboxId: inbox.id,
                reason: 'missing-token',
              });
            }

            const currentUser = inbox.address.split('@')[0];
            const newEmailResponse = await service.executeOperation('createInbox', {
              forceNewSession: true,
            });

            if (!newEmailResponse.token) {
              throw new InboxCreationError(inbox.provider, {
                inboxId: inbox.id,
                reason: 'missing-new-token',
              });
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

            const allInboxes = await getInboxes();
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
              await setInboxes(allInboxes);
              updatedInboxes[i] = renewedInbox;
            }

            if (notificationSettings?.enabled) {
              createInboxNotification('renewed', inbox.address);
            }
          } catch (renewError: unknown) {
            logError('Failed to auto-renew inbox', {
              inboxAddress: inbox.address,
              error: renewError,
            });
            // Keep as expired (don't auto-archive)
            if (notificationSettings?.enabled) {
              createInboxNotification('expired', inbox.address);
            }
            continue;
          }
        } else {
          // Keep as expired (don't auto-archive)
          if (notificationSettings?.enabled) {
            createInboxNotification('expired', inbox.address);
          }
          continue;
        }
      }

      const timeLeft = inbox.expiresAt ? inbox.expiresAt - now : null;
      if (timeLeft && timeLeft <= warningThreshold && !inbox.expiryNotified) {
        if (notificationSettings?.enabled) {
          createInboxNotification('expiring-soon', inbox.address);
        }
        updatedInboxes[i] = { ...inbox, expiryNotified: true };
      }
    }

    await setInboxes(updatedInboxes);
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
