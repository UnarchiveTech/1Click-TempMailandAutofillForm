/**
 * Periodic check management
 * Handles setup of periodic email checking and cleanup alarms
 */

import { browser } from 'wxt/browser';
import { DEBUG, EMAIL_CLEANUP_INTERVAL_MS } from '@/utils/constants.js';
import { log, logDebug, logError } from '@/utils/logger.js';
import { getAutoRefreshInterval, getEmailRetentionDays, getInboxes } from '@/utils/storage-keys.js';
import type { Alarm, Email, EmailFilters } from '@/utils/types.js';
import { cleanupOldStoredEmails, storeNewMessages } from './email-storage.js';

let periodicAlarmListenerRegistered = false;

export async function updateRefreshAlarm(intervalMs: number): Promise<void> {
  await browser.alarms.clear('checkEmails');
  if (intervalMs > 0) {
    const periodInMinutes = Math.max(intervalMs / 60 / 1000, 0.1); // Chrome minimum is ~0.1 min in dev
    await browser.alarms.create('checkEmails', { periodInMinutes });
    if (DEBUG) log(`Refresh alarm updated: ${intervalMs / 1000}s`);
  } else {
    if (DEBUG) log('Refresh alarm cleared (manual only mode)');
  }
}

export function setupPeriodicEmailCheck(
  checkNewEmailsFn: (inboxId: string, filters: EmailFilters) => Promise<Email[]>
): void {
  if (DEBUG) log('=== SETTING UP PERIODIC EMAIL CHECK ===');

  (async () => {
    try {
      const intervalMs = await getAutoRefreshInterval();
      if (intervalMs > 0) {
        if (DEBUG) log(`Email check interval: ${intervalMs / 1000}s`);
        const existingCheck = await browser.alarms.get('checkEmails');
        if (!existingCheck) {
          await browser.alarms.create('checkEmails', {
            periodInMinutes: Math.max(intervalMs / 60 / 1000, 0.1),
          });
        }
      } else {
        if (DEBUG) log('Auto-refresh is disabled (manual only mode).');
        await browser.alarms.clear('checkEmails');
      }
      const existingCleanup = await browser.alarms.get('cleanupStoredEmails');
      if (!existingCleanup) {
        await browser.alarms.create('cleanupStoredEmails', {
          periodInMinutes: EMAIL_CLEANUP_INTERVAL_MS / 60 / 1000,
        });
      }
    } catch (e) {
      logError(
        'Failed to create periodic alarms:',
        undefined,
        e instanceof Error ? e : new Error(String(e))
      );
    }
  })();

  if (DEBUG) log('=== ALARMS CREATED ===');

  if (periodicAlarmListenerRegistered) return;

  browser.alarms.onAlarm.addListener(async (alarm: Alarm) => {
    if (DEBUG) logDebug(`=== ALARM FIRED: ${alarm.name} ===`);

    if (alarm.name === 'checkEmails') {
      try {
        if (DEBUG) log('=== PERIODIC EMAIL CHECK STARTED ===');
        // Site-rule auto-archive due inboxes
        try {
          const { getDueArchiveInboxIds, clearArchiveSchedule } = await import(
            '@/features/intelligence/site-rules.js'
          );
          const due = await getDueArchiveInboxIds();
          if (due.length > 0) {
            const list = await getInboxes();
            let changed = false;
            for (const id of due) {
              const idx = list.findIndex((i) => i.id === id);
              if (idx >= 0 && list[idx].accountStatus !== 'archived') {
                list[idx] = { ...list[idx], accountStatus: 'archived' };
                changed = true;
              }
              await clearArchiveSchedule(id);
            }
            if (changed) {
              const { setInboxes } = await import('@/utils/storage-keys.js');
              await setInboxes(list);
            }
          }
        } catch {
          /* rules optional */
        }

        const inboxes = await getInboxes();
        if (DEBUG) log(`Found ${inboxes.length} inboxes`);

        if (inboxes.length === 0) {
          if (DEBUG) log('No inboxes to check, skipping');
          return;
        }

        const activeInboxes = inboxes.filter((i) => i.accountStatus !== 'archived');
        const concurrency = 3;

        for (let i = 0; i < activeInboxes.length; i += concurrency) {
          const chunk = activeInboxes.slice(i, i + concurrency);
          await Promise.allSettled(
            chunk.map(async (inbox) => {
              try {
                if (DEBUG) log(`Checking emails for inbox: ${inbox.address}`);

                // Run checkNewEmailsFn with an 8-second timeout guard
                const checkPromise = checkNewEmailsFn(inbox.id, {});
                const timeoutPromise = new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error('Fetch timeout')), 8000)
                );

                const messages = await Promise.race([checkPromise, timeoutPromise]);
                if (DEBUG) log(`Fetched ${messages.length} messages for ${inbox.address}`);

                // Store fetched emails so UI can read them from storage
                if (messages.length > 0) {
                  await storeNewMessages(inbox.address, messages);
                  if (DEBUG) log(`Stored ${messages.length} messages for ${inbox.address}`);
                }
              } catch (e) {
                logError(
                  `Error checking emails for inbox ${inbox.address}:`,
                  undefined,
                  e instanceof Error ? e : new Error(String(e))
                );
              }
            })
          );
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
        const emailRetentionDays = await getEmailRetentionDays();
        await cleanupOldStoredEmails(emailRetentionDays, emailRetentionDays * 3); // Archived retention is 3x active retention
        // Cap bags / favicons / oversized avatars (quota hygiene)
        try {
          const { runStorageHygiene } = await import('@/utils/storage-hygiene.js');
          await runStorageHygiene();
        } catch {
          /* optional */
        }
      } catch (error: unknown) {
        logError(
          'Error in stored emails cleanup:',
          undefined,
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
  });
  periodicAlarmListenerRegistered = true;
}
