/**
 * Inbox expiry management
 * Handles inbox expiry checking, auto-renewal, and expiry notifications
 */

import { browser } from 'wxt/browser';
import { EmailService, loadProviderConfig } from '@/utils/email-service.js';
import { InboxCreationError } from '@/utils/errors.js';
import { logError } from '@/utils/logger.js';
import { withInboxLock } from '@/utils/mutex.js';
import { deriveInboxTiming } from '@/utils/provider-expiry.js';
import { getInboxes, setInboxes } from '@/utils/storage-keys.js';
import type { Account, NotificationSettings } from '@/utils/types.js';

type NotificationType = 'expired' | 'renewed' | 'expiring-soon';

let expiryAlarmListenerRegistered = false;

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

    if (inboxes.length === 0) return;

    const now = Date.now();
    const updatedInboxes = [...inboxes];
    const warningThreshold = notificationSettings.expiryWarningThreshold || 60 * 60 * 1000; // Default to 1 hour
    const modifiedInboxes = new Map<string, Partial<Account>>();

    for (let i = 0; i < updatedInboxes.length; i++) {
      const inbox = updatedInboxes[i];
      const notifyExpiredOnce = () => {
        if (notificationSettings?.enabled && !inbox.expiryNotified) {
          createInboxNotification('expired', inbox.address);
        }
        modifiedInboxes.set(inbox.id, { ...modifiedInboxes.get(inbox.id), expiryNotified: true });
        updatedInboxes[i] = { ...updatedInboxes[i], expiryNotified: true };
      };

      if (inbox.expiresAt && inbox.expiresAt <= now) {
        if (inbox.autoExtend) {
          const providerConfig = loadProviderConfig(inbox.provider);
          if (!providerConfig.expiry?.renewable) {
            // Provider doesn't support renewal, keep as expired (don't auto-archive)
            notifyExpiredOnce();
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

            const renewalConfig = loadProviderConfig(inbox.provider);
            const currentUser = inbox.emailUser || inbox.address.split('@')[0];
            let renewalResponse: Record<string, unknown> = {};

            if (renewalConfig.expiry?.renewalMethod) {
              renewalResponse = await service.executeOperation(renewalConfig.expiry.renewalMethod, {
                auth: { token: (inbox.token || inbox.sidToken) as string },
                variables: { emailUser: currentUser },
              });
            }

            const newSidToken =
              typeof renewalResponse.token === 'string'
                ? renewalResponse.token
                : inbox.token || inbox.sidToken;
            const timing = deriveInboxTiming(renewalResponse, providerConfig);

            const prevCount = updatedInboxes[i].renewalCount ?? 0;
            const renewalUpdates = {
              token: newSidToken,
              sidToken: newSidToken,
              emailUser: currentUser,
              expiresAt: timing.expiresAt,
              expiryNotified: false,
              renewalCount: prevCount + 1,
            };

            modifiedInboxes.set(inbox.id, {
              ...modifiedInboxes.get(inbox.id),
              ...renewalUpdates,
            });

            updatedInboxes[i] = {
              ...updatedInboxes[i],
              ...renewalUpdates,
            };

            if (notificationSettings?.enabled) {
              createInboxNotification('renewed', inbox.address);
            }
          } catch (renewError: unknown) {
            logError('Failed to auto-renew inbox', {
              inboxAddress: inbox.address,
              error: renewError,
            });
            // Keep as expired
            notifyExpiredOnce();
            continue;
          }
        } else {
          // Not auto-renewing: apply user preference (archive by default, or delete permanently)
          notifyExpiredOnce();
          try {
            const { expiryAction = 'archive' } = (await browser.storage.local.get([
              'expiryAction',
            ])) as { expiryAction?: 'archive' | 'delete' };
            if (expiryAction === 'delete') {
              modifiedInboxes.set(inbox.id, {
                ...modifiedInboxes.get(inbox.id),
                accountStatus: 'deleted',
                status: 'deleted',
                expiryNotified: true,
              });
              updatedInboxes[i] = {
                ...updatedInboxes[i],
                accountStatus: 'deleted',
                status: 'deleted',
                expiryNotified: true,
              };
            } else {
              // Default: archive after expiry
              modifiedInboxes.set(inbox.id, {
                ...modifiedInboxes.get(inbox.id),
                accountStatus: 'archived',
                status: 'archived',
                expiryNotified: true,
              });
              updatedInboxes[i] = {
                ...updatedInboxes[i],
                accountStatus: 'archived',
                status: 'archived',
                expiryNotified: true,
              };
            }
          } catch {
            /* keep expired state if storage fails */
          }
          continue;
        }
      }

      const currentInboxState = updatedInboxes[i];
      const timeLeft = currentInboxState.expiresAt ? currentInboxState.expiresAt - now : null;
      if (timeLeft && timeLeft <= warningThreshold && !currentInboxState.expiryNotified) {
        if (notificationSettings?.enabled) {
          createInboxNotification('expiring-soon', currentInboxState.address);
        }
        modifiedInboxes.set(currentInboxState.id, {
          ...modifiedInboxes.get(currentInboxState.id),
          expiryNotified: true,
        });
        updatedInboxes[i] = { ...currentInboxState, expiryNotified: true };
      }
    }

    if (modifiedInboxes.size > 0) {
      await withInboxLock(async () => {
        const currentInboxes = await getInboxes();
        let changed = false;
        for (const [id, updates] of modifiedInboxes) {
          const idx = currentInboxes.findIndex((inb) => inb.id === id);
          if (idx !== -1) {
            currentInboxes[idx] = {
              ...currentInboxes[idx],
              ...updates,
            };
            changed = true;
          }
        }
        if (changed) {
          await setInboxes(currentInboxes);
        }
      });
    }
  } catch (error: unknown) {
    logError(
      'Error in inbox expiry check:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

export function setupInboxExpiryCheck(): void {
  // Chrome MV3: minimum period is 1 minute for packed extensions; keep at 1 min
  // and always re-assert the alarm on SW wake so sleep doesn't drop renewals.
  const PERIOD_MINUTES = 1;

  (async () => {
    try {
      // Re-create every SW start — clears drifted / missing alarms after sleep
      await browser.alarms.clear('checkInboxExpiry');
      await browser.alarms.create('checkInboxExpiry', {
        delayInMinutes: 0.1,
        periodInMinutes: PERIOD_MINUTES,
      });
    } catch (e) {
      logError(
        'Failed to create checkInboxExpiry alarm:',
        undefined,
        e instanceof Error ? e : new Error(String(e))
      );
    }
  })();

  // Immediate pass on SW start (user opened extension / browser woke SW)
  void checkInboxExpiry();

  if (!expiryAlarmListenerRegistered) {
    browser.alarms.onAlarm.addListener(async (alarm) => {
      if (alarm.name === 'checkInboxExpiry') {
        await checkInboxExpiry();
      }
    });
    // Also run expiry when email check wakes the SW (piggyback)
    browser.alarms.onAlarm.addListener(async (alarm) => {
      if (alarm.name === 'checkEmails') {
        try {
          await checkInboxExpiry();
        } catch {
          /* ignore */
        }
      }
    });
    expiryAlarmListenerRegistered = true;
  }
}
