/**
 * Periodic check management
 * Handles setup of periodic email checking and cleanup alarms
 */

import { browser } from 'wxt/browser';
import { DEBUG, EMAIL_CHECK_INTERVAL_MS, EMAIL_CLEANUP_INTERVAL_MS } from '@/utils/constants.js';
import { log, logDebug, logError } from '@/utils/logger.js';
import type { Alarm, Email, EmailFilters } from '@/utils/types.js';
import { cleanupOldStoredEmails, storeNewMessages } from './email-storage.js';

export function setupPeriodicEmailCheck(
  checkNewEmailsFn: (inboxId: string, filters: EmailFilters) => Promise<Email[]>
): void {
  if (DEBUG) log('=== SETTING UP PERIODIC EMAIL CHECK ===');
  if (DEBUG) log(`Email check interval: ${EMAIL_CHECK_INTERVAL_MS / 1000}s`);

  browser.alarms.create('checkEmails', {
    periodInMinutes: EMAIL_CHECK_INTERVAL_MS / 60 / 1000,
  });

  browser.alarms.create('cleanupStoredEmails', {
    periodInMinutes: EMAIL_CLEANUP_INTERVAL_MS / 60 / 1000,
  });

  if (DEBUG) log('=== ALARMS CREATED ===');

  browser.alarms.onAlarm.addListener(async (alarm: Alarm) => {
    if (DEBUG) logDebug(`=== ALARM FIRED: ${alarm.name} ===`);

    if (alarm.name === 'checkEmails') {
      try {
        if (DEBUG) log('=== PERIODIC EMAIL CHECK STARTED ===');
        const { inboxes = [] } = (await browser.storage.local.get(['inboxes'])) as {
          inboxes?: Array<{ id: string; address: string; accountStatus?: string }>;
        };
        if (DEBUG) log(`Found ${inboxes.length} inboxes`);

        if (inboxes.length === 0) {
          if (DEBUG) log('No inboxes to check, skipping');
          return;
        }

        for (const inbox of inboxes) {
          if (inbox.accountStatus === 'archived') {
            if (DEBUG) logDebug(`Skipping archived inbox: ${inbox.address}`);
            continue;
          }
          try {
            if (DEBUG) log(`Checking emails for inbox: ${inbox.address}`);
            const messages = await checkNewEmailsFn(inbox.id, {});
            if (DEBUG) log(`Fetched ${messages.length} messages for ${inbox.address}`);
            // Store fetched emails so UI can read them from storage
            if (messages.length > 0) {
              await storeNewMessages(inbox.address, messages);
              if (DEBUG) log(`Stored ${messages.length} messages for ${inbox.address}`);
            }
          } catch (e) {
            logError(
              'Error checking emails for inbox:',
              undefined,
              e instanceof Error ? e : new Error(String(e))
            );
          }
        }
        if (DEBUG) log('=== PERIODIC EMAIL CHECK COMPLETED ===');
      } catch (error: unknown) {
        logError(
          'Error in periodic email check:',
          undefined,
          error instanceof Error ? error : new Error(String(error))
        );
      }
    } else if (alarm.name === 'cleanupStoredEmails') {
      try {
        const { emailRetentionDays = 30 } = (await browser.storage.local.get([
          'emailRetentionDays',
        ])) as {
          emailRetentionDays?: number;
        };
        await cleanupOldStoredEmails(emailRetentionDays, emailRetentionDays * 3); // Archived retention is 3x active retention
      } catch (error: unknown) {
        logError(
          'Error in stored emails cleanup:',
          undefined,
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
  });
}
