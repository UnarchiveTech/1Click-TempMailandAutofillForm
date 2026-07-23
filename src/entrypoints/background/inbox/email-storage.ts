/**
 * Email storage management: store, archive, retrieve, and clean up emails
 */

import { browser } from 'wxt/browser';
import { addActivityEvent } from '@/utils/activity-tracker.js';
import { DEBUG, MAX_ARCHIVED_EMAILS, MAX_STORED_EMAILS_PER_INBOX } from '@/utils/constants.js';
import { log, logError } from '@/utils/logger.js';
import { withLock } from '@/utils/mutex.js';
import {
  getAnalyticsRecord,
  getEmailMaps,
  getEmailRetentionDays,
  getStoredEmailsMap,
} from '@/utils/storage-keys.js';
import { safeStorageSet } from '@/utils/storageMonitor.js';
import { timeAgo } from '@/utils/time.js';
import type { Account, Email, EmailFilters, NotificationSettings } from '@/utils/types.js';

/**
 * Play a notification sound using Web Audio API
 */
function playNotificationSound() {
  try {
    // We only initialize audio context if we are in a DOM environment (popup/sidepanel).
    // Service workers do not have access to window or AudioContext.
    const audioContext =
      typeof window !== 'undefined'
        ? new (
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
          )()
        : null;

    if (!audioContext) return;

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 800; // Hz
    oscillator.type = 'sine';
    gainNode.gain.value = 0.1; // Volume

    const cleanup = () => {
      try {
        if (audioContext.state !== 'closed') {
          void audioContext.close();
        }
      } catch {
        /* ignore cleanup errors */
      }
    };

    oscillator.onended = cleanup;
    setTimeout(cleanup, 500);

    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.2); // 200ms beep
  } catch (e) {
    if (DEBUG) log('Failed to play notification sound:', e);
  }
}

const _ACTIVE_EMAIL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const _ARCHIVED_EMAIL_RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

// Check if storage quota is exceeded
async function isQuotaExceeded(error: unknown): Promise<boolean> {
  if (error instanceof DOMException) {
    return error.name === 'QuotaExceededError' || error.code === 22;
  }
  if (error instanceof Error && error.message.includes('quota')) {
    return true;
  }
  return false;
}

/** Resolve bag for an address with case-insensitive key match. */
function bagForAddress(storedEmails: Record<string, Email[]>, inboxAddress: string): Email[] {
  if (!inboxAddress) return [];
  if (storedEmails[inboxAddress]?.length) return storedEmails[inboxAddress] || [];
  if (storedEmails[inboxAddress]) return storedEmails[inboxAddress] || [];
  const lower = inboxAddress.toLowerCase();
  for (const [k, list] of Object.entries(storedEmails)) {
    if (k.toLowerCase() === lower) return list || [];
  }
  return [];
}

export async function getStoredEmails(inboxAddress: string): Promise<Email[]> {
  try {
    const storedEmails = await getStoredEmailsMap();
    return bagForAddress(storedEmails, inboxAddress);
  } catch (error: unknown) {
    if (await isQuotaExceeded(error)) {
      logError('Storage quota exceeded, attempting to clean up old emails', { inboxAddress });
      // Try to clean up old emails based on retention settings
      const emailRetentionDays = await getEmailRetentionDays();
      await cleanupOldStoredEmails(emailRetentionDays, emailRetentionDays * 3);
      // Retry getting stored emails
      try {
        const storedEmails = await getStoredEmailsMap();
        return bagForAddress(storedEmails, inboxAddress);
      } catch (retryError: unknown) {
        if (await isQuotaExceeded(retryError)) {
          logError('Storage quota still exceeded after cleanup', { inboxAddress });
          return [];
        } else {
          throw retryError;
        }
      }
    } else {
      throw error;
    }
  }
}

function enforceMaxArchivedEmailsLimit(archivedEmails: Record<string, Email[]>): void {
  const allArchived: Array<{ address: string; email: Email }> = [];
  for (const [address, emails] of Object.entries(archivedEmails)) {
    for (const email of emails) {
      allArchived.push({ address, email });
    }
  }
  if (allArchived.length > MAX_ARCHIVED_EMAILS) {
    allArchived.sort((a, b) => {
      const tA = a.email.archived_at || a.email.received_at * 1000;
      const tB = b.email.archived_at || b.email.received_at * 1000;
      return tB - tA;
    });
    const kept = allArchived.slice(0, MAX_ARCHIVED_EMAILS);
    const newArchivedEmails: Record<string, Email[]> = {};
    for (const item of kept) {
      if (!newArchivedEmails[item.address]) {
        newArchivedEmails[item.address] = [];
      }
      newArchivedEmails[item.address].push(item.email);
    }
    for (const address of Object.keys(archivedEmails)) {
      if (newArchivedEmails[address]) {
        archivedEmails[address] = newArchivedEmails[address];
      } else {
        delete archivedEmails[address];
      }
    }
  }
}

export async function clearStoredEmails(inboxAddress: string): Promise<void> {
  async function doArchive(): Promise<void> {
    const { storedEmails, archivedEmails } = await getEmailMaps();
    if (storedEmails[inboxAddress] && storedEmails[inboxAddress].length > 0) {
      if (!archivedEmails[inboxAddress]) archivedEmails[inboxAddress] = [];
      const emailsToArchive = storedEmails[inboxAddress].map((email: Email) => ({
        ...email,
        archived: true,
        archived_at: Date.now(),
        original_inbox: inboxAddress,
      }));
      archivedEmails[inboxAddress].push(...emailsToArchive);
      enforceMaxArchivedEmailsLimit(archivedEmails);
      delete storedEmails[inboxAddress];
      await browser.storage.local.set({ storedEmails, archivedEmails });
      log(`Archived ${emailsToArchive.length} emails for expired inbox: ${inboxAddress}`);
    }
  }

  try {
    await doArchive();
  } catch (error: unknown) {
    if (await isQuotaExceeded(error)) {
      logError('Storage quota exceeded during archive, attempting cleanup', { inboxAddress });
      const emailRetentionDays = await getEmailRetentionDays();
      await cleanupOldStoredEmails(emailRetentionDays, emailRetentionDays * 3);
      await doArchive();
    } else {
      throw error;
    }
  }
}

export async function getArchivedEmails(inboxAddress?: string): Promise<Email[]> {
  const { archivedEmails } = await getEmailMaps();

  if (inboxAddress) {
    return archivedEmails[inboxAddress] || [];
  }

  const allArchived: Email[] = [];
  for (const emails of Object.values(archivedEmails)) {
    allArchived.push(...emails);
  }

  return allArchived.sort(
    (a: Email, b: Email) =>
      ((b as Email & { archived_at?: number }).archived_at || 0) -
      ((a as Email & { archived_at?: number }).archived_at || 0)
  );
}

export async function cleanupOldStoredEmails(
  activeRetentionDays: number = 30,
  archivedRetentionDays: number = 90
): Promise<void> {
  // If retention is 0, never delete
  if (activeRetentionDays === 0 && archivedRetentionDays === 0) {
    return;
  }

  const { storedEmails, archivedEmails } = await getEmailMaps();

  const activeThreshold =
    activeRetentionDays === 0 ? 0 : Date.now() - activeRetentionDays * 24 * 60 * 60 * 1000;
  const archivedThreshold =
    archivedRetentionDays === 0 ? 0 : Date.now() - archivedRetentionDays * 24 * 60 * 60 * 1000;
  let totalCleaned = 0;

  for (const [address, emails] of Object.entries(storedEmails)) {
    const filteredEmails = emails.filter((email: Email & { stored_at?: number }) => {
      const emailAge = email.stored_at || email.received_at * 1000;
      return emailAge > activeThreshold;
    });

    if (filteredEmails.length !== emails.length) {
      storedEmails[address] = filteredEmails;
      totalCleaned += emails.length - filteredEmails.length;
    }
  }

  for (const [address, emails] of Object.entries(archivedEmails)) {
    const filteredEmails = emails.filter(
      (email: Email & { archived_at?: number; stored_at?: number }) => {
        const emailAge = email.archived_at || email.stored_at || email.received_at * 1000;
        return emailAge > archivedThreshold;
      }
    );

    if (filteredEmails.length !== emails.length) {
      archivedEmails[address] = filteredEmails;
      totalCleaned += emails.length - filteredEmails.length;
    }
  }

  const originalCount = Object.values(archivedEmails).flat().length;
  enforceMaxArchivedEmailsLimit(archivedEmails);
  const newCount = Object.values(archivedEmails).flat().length;
  if (originalCount !== newCount) {
    totalCleaned += originalCount - newCount;
  }

  if (totalCleaned > 0) {
    await safeStorageSet(browser, { storedEmails, archivedEmails });
    log(`Cleaned up ${totalCleaned} old/excess emails`);
  }
}

export async function storeNewMessages(inboxAddress: string, newMessages: Email[]): Promise<void> {
  await withLock('emails_storage_lock', async () => {
    const storedEmails = await getStoredEmailsMap();
    if (!storedEmails[inboxAddress]) {
      storedEmails[inboxAddress] = [];
    }

    // Deduplicate messages by ID to avoid duplicates
    const existingIds = new Set(storedEmails[inboxAddress].map((e: Email) => e.id));
    const uniqueNewMessages = newMessages.filter((msg: Email) => !existingIds.has(msg.id));

    if (uniqueNewMessages.length > 0) {
      for (const msg of uniqueNewMessages) {
        if (!msg.original_inbox) msg.original_inbox = inboxAddress;
      }
      storedEmails[inboxAddress].push(...uniqueNewMessages);
      storedEmails[inboxAddress].sort((a: Email, b: Email) => b.received_at - a.received_at);

      if (storedEmails[inboxAddress].length > MAX_STORED_EMAILS_PER_INBOX) {
        storedEmails[inboxAddress] = storedEmails[inboxAddress].slice(
          0,
          MAX_STORED_EMAILS_PER_INBOX
        );
      }

      await safeStorageSet(browser, { storedEmails });
      if (DEBUG) log(`Stored ${uniqueNewMessages.length} new emails for ${inboxAddress}`);

      // Process side effects for new messages
      await processNewMessages(inboxAddress, uniqueNewMessages);
    }
  });
}

export function filterMessages(messages: Email[], filters: EmailFilters = {}): Email[] {
  // Return a new array of fresh copies to avoid mutating input objects in place
  let filteredMessages = messages.map((msg) => ({
    ...msg,
    stored_at: msg.stored_at || Date.now(),
  }));

  if (filters.searchQuery?.trim()) {
    const query = filters.searchQuery.toLowerCase().trim();
    filteredMessages = filteredMessages.filter((msg: Email) => {
      const subjectMatch = msg.subject?.toLowerCase().includes(query);
      const fromMatch = msg.from_name?.toLowerCase().includes(query);
      const bodyMatch = msg.body_plain?.toLowerCase().includes(query);
      return subjectMatch || fromMatch || bodyMatch;
    });
  }

  if (filters.hasOTP) {
    filteredMessages = filteredMessages.filter(
      (msg: Email) => msg.otp && msg.otp.trim().length > 0
    );
  }

  if (filters.senderDomain?.trim()) {
    const senderDomain = filters.senderDomain.toLowerCase().trim();
    filteredMessages = filteredMessages.filter((msg: Email) => {
      const sender = msg.from || msg.from_name || '';
      return sender.toLowerCase().includes(senderDomain);
    });
  }

  if (filters.recipient?.trim()) {
    const recipient = filters.recipient.toLowerCase().trim();
    filteredMessages = filteredMessages.filter((msg: Email) => {
      const originalInbox = msg.original_inbox || '';
      return originalInbox.toLowerCase().includes(recipient);
    });
  }

  if (filters.dateFrom) {
    const fromTime =
      typeof filters.dateFrom === 'string'
        ? new Date(filters.dateFrom).getTime()
        : filters.dateFrom;
    filteredMessages = filteredMessages.filter((msg: Email) => msg.received_at * 1000 >= fromTime);
  }

  if (filters.dateTo) {
    const toTime =
      typeof filters.dateTo === 'string'
        ? new Date(filters.dateTo).getTime() + 24 * 60 * 60 * 1000 - 1
        : filters.dateTo;
    filteredMessages = filteredMessages.filter((msg: Email) => msg.received_at * 1000 <= toTime);
  }

  return filteredMessages;
}

export async function applyFiltersAndProcessMessages(
  messages: Email[],
  filters: EmailFilters = {},
  _inbox?: Account
): Promise<Email[]> {
  // Backward compatibility wrapper
  return filterMessages(messages, filters);
}

async function processNewMessages(inboxAddress: string, uniqueNewMessages: Email[]): Promise<void> {
  if (uniqueNewMessages.length === 0) return;

  try {
    const { inboxes = [], lastMessageTimestamps = {} } = (await browser.storage.local.get([
      'inboxes',
      'lastMessageTimestamps',
    ])) as {
      inboxes?: Account[];
      lastMessageTimestamps?: Record<string, number>;
    };

    const inbox = inboxes.find((i) => i.address === inboxAddress);

    // 1. Send OTP from new messages to active tab
    const latestNewMessageWithOtp = uniqueNewMessages
      .filter((msg: Email) => msg.otp)
      .sort((a: Email, b: Email) => b.received_at - a.received_at)[0];

    if (latestNewMessageWithOtp?.otp) {
      try {
        browser.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs.length > 0 && tabs[0].id) {
            browser.tabs
              .sendMessage(tabs[0].id, {
                type: 'fillOTP',
                otp: latestNewMessageWithOtp.otp,
                sender: latestNewMessageWithOtp.from,
                senderName: latestNewMessageWithOtp.from_name,
                subject: latestNewMessageWithOtp.subject,
              })
              .catch(() => {});
          }
        });
      } catch {}

      // M5: Update latestOtp cache in storage
      const latestOtpRecord = {
        otp: latestNewMessageWithOtp.otp,
        sender: latestNewMessageWithOtp.from || '',
        senderName: latestNewMessageWithOtp.from_name || '',
        context: [
          latestNewMessageWithOtp.from_name ? `From: ${latestNewMessageWithOtp.from_name}` : '',
          timeAgo(latestNewMessageWithOtp.received_at),
        ]
          .filter(Boolean)
          .join(' | '),
        received_at: latestNewMessageWithOtp.received_at,
      };
      const currentLatestOtp = (
        (await browser.storage.local.get('latestOtp')) as {
          latestOtp?: { received_at: number };
        }
      ).latestOtp;
      const currentReceived = currentLatestOtp?.received_at || 0;
      if (latestNewMessageWithOtp.received_at > currentReceived) {
        await safeStorageSet(browser, { latestOtp: latestOtpRecord });
      }
    }

    // 2. Track activity events for new emails
    if (inbox) {
      for (const msg of uniqueNewMessages) {
        await addActivityEvent('email_received', {
          inboxAddress: inbox.address,
          emailId: msg.id,
          sender: msg.from_name || msg.from,
          subject: msg.subject,
        });

        if (msg.otp) {
          await addActivityEvent('otp_detected', {
            inboxAddress: inbox.address,
            emailId: msg.id,
            otp: '••••',
            sender: msg.from_name || msg.from,
            subject: msg.subject,
          });
        }
      }
    }

    // 3. Update last message timestamp
    if (inbox) {
      let maxTimestamp = lastMessageTimestamps[inbox.id] || 0;
      for (const msg of uniqueNewMessages) {
        const ts = msg.received_at * 1000;
        if (ts > maxTimestamp) maxTimestamp = ts;
      }
      lastMessageTimestamps[inbox.id] = maxTimestamp;
      await safeStorageSet(browser, { lastMessageTimestamps });
    }

    // 4. Update email received analytics & OTP analytics
    const analytics = await getAnalyticsRecord();
    analytics.emailsReceived = (analytics.emailsReceived || 0) + uniqueNewMessages.length;

    const newOtpCount = uniqueNewMessages.filter((msg: Email) => msg.otp).length;
    if (newOtpCount > 0) {
      analytics.otpsDetected = (analytics.otpsDetected || 0) + newOtpCount;
    }

    // 5. Send notifications for new messages
    const result = (await browser.storage.local.get(['notificationSettings'])) as {
      notificationSettings?: NotificationSettings;
    };
    const notificationSettings: NotificationSettings = result.notificationSettings ?? {
      enabled: true,
      soundEnabled: true,
      expiryWarningThreshold: 60 * 60 * 1000,
    };

    if (notificationSettings.enabled && inbox) {
      // Per-address snooze: skip OS notifications while muted for this mailbox
      let snoozedUntil = 0;
      try {
        const snoozeRes = (await browser.storage.local.get(['notificationSnoozeByAddress'])) as {
          notificationSnoozeByAddress?: Record<string, number>;
        };
        const map = snoozeRes.notificationSnoozeByAddress || {};
        snoozedUntil = map[inbox.address] || map[inbox.address.toLowerCase()] || 0;
      } catch {
        snoozedUntil = 0;
      }
      if (snoozedUntil > Date.now()) {
        // Still track analytics? Skip notifications only
      } else {
        // Intelligence: quiet hours / OTP-only / muted senders / digest
        let toNotify = uniqueNewMessages;
        let useDigest = false;
        try {
          const { filterEmailsForNotification } = await import(
            '@/features/intelligence/notification-policy.js'
          );
          const decision = await filterEmailsForNotification(uniqueNewMessages);
          if (!decision.allow) {
            toNotify = [];
          } else {
            toNotify = decision.emails;
            useDigest = decision.digest;
          }
        } catch {
          toNotify = uniqueNewMessages;
        }

        if (toNotify.length > 0) {
          if (notificationSettings.soundEnabled) {
            playNotificationSound();
          }

          if (useDigest && toNotify.length > 1) {
            const otpN = toNotify.filter((m) => m.otp || m.isOtp).length;
            const notificationId = `email-digest:${inbox.id}:${Date.now()}`;
            browser.notifications.create(notificationId, {
              type: 'basic',
              iconUrl: 'icons/icon48.png',
              title: `${toNotify.length} new in ${inbox.address}`,
              message:
                otpN > 0
                  ? `${otpN} OTP · ${toNotify.length - otpN} other`
                  : toNotify
                      .slice(0, 3)
                      .map((m) => m.subject || m.from_name || 'Mail')
                      .join(' · '),
              priority: 0,
              contextMessage: 'Click to open mailbox',
            });
            analytics.notificationsSent = (analytics.notificationsSent || 0) + 1;
            await addActivityEvent('notification_sent', {
              inboxAddress: inbox.address,
              message: `digest:${toNotify.length}`,
            });
          } else {
            toNotify.forEach((msg: Email) => {
              const notificationId = `email:${msg.id}:${inbox.id}`;
              browser.notifications.create(notificationId, {
                type: 'basic',
                iconUrl: 'icons/icon48.png',
                title: `New Email in ${inbox.address}`,
                message: `${msg.from_name || 'Unknown Sender'}: ${msg.subject || 'No Subject'}`,
                priority: 0,
                contextMessage: 'Click to view email',
              });
            });
            analytics.notificationsSent = (analytics.notificationsSent || 0) + toNotify.length;
            for (const msg of toNotify) {
              await addActivityEvent('notification_sent', {
                inboxAddress: inbox.address,
                emailId: msg.id,
                sender: msg.from_name || msg.from,
                subject: msg.subject,
              });
            }
          }
        }
      } // end not-snoozed

      // Lifecycle: mail signals for this inbox
      try {
        const { recordInboxMailSignals } = await import(
          '@/features/intelligence/inbox-lifecycle.js'
        );
        await recordInboxMailSignals(inbox.id, inbox.address, uniqueNewMessages);
      } catch {
        /* ignore */
      }
    }

    await safeStorageSet(browser, { analytics });
  } catch (error: unknown) {
    logError('Error processing new messages side effects:', error);
  }
}

export async function getStorageUsage(): Promise<{
  totalBytes: number;
  totalMB: number;
  breakdown: Record<string, number>;
  categories: { emails: number; settings: number; cached: number; other: number };
}> {
  const result = await browser.storage.local.get(null);
  let totalBytes = 0;
  const breakdown: Record<string, number> = {};
  let emailsBytes = 0;
  let settingsBytes = 0;
  let cachedBytes = 0;
  let otherBytes = 0;

  for (const [key, value] of Object.entries(result)) {
    const size = new Blob([JSON.stringify(value)]).size;
    totalBytes += size;
    breakdown[key] = size;

    // Categorize by key prefix
    if (key === 'storedEmails' || key === 'archivedEmails') {
      emailsBytes += size;
    } else if (
      key.startsWith('settings_') ||
      key === 'identities' ||
      key === 'selectedIdentityId' ||
      key === 'autoCopy' ||
      key === 'autoRenew' ||
      key === 'selectedProvider' ||
      key === 'developerSettings' ||
      key === 'enableLogging' ||
      key === 'emailRetentionDays' ||
      key === 'useCustomPassword' ||
      key === 'customPassword' ||
      key === 'useCustomName' ||
      key === 'customFirstName' ||
      key === 'customLastName' ||
      key === 'customColor' ||
      key === 'contrastLevel'
    ) {
      settingsBytes += size;
    } else if (key === 'favicon_success_cache' || key === 'providerInstances') {
      cachedBytes += size;
    } else {
      otherBytes += size;
    }
  }

  return {
    totalBytes,
    totalMB: totalBytes / (1024 * 1024),
    breakdown,
    categories: {
      emails: emailsBytes / (1024 * 1024),
      settings: settingsBytes / (1024 * 1024),
      cached: cachedBytes / (1024 * 1024),
      other: otherBytes / (1024 * 1024),
    },
  };
}

export async function getEmailsToBeDeleted(
  retentionDays: number
): Promise<{ activeEmails: number; archivedEmails: number; totalEmails: number }> {
  // If retention is 0, no emails will be deleted
  if (retentionDays === 0) {
    return { activeEmails: 0, archivedEmails: 0, totalEmails: 0 };
  }

  const { storedEmails, archivedEmails } = await getEmailMaps();

  const threshold = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let activeEmailsToDelete = 0;
  let archivedEmailsToDelete = 0;

  for (const [_address, emails] of Object.entries(storedEmails)) {
    const filteredEmails = emails.filter((email: Email & { stored_at?: number }) => {
      const emailAge = email.stored_at || email.received_at * 1000;
      return emailAge <= threshold;
    });
    activeEmailsToDelete += filteredEmails.length;
  }

  for (const [_address, emails] of Object.entries(archivedEmails)) {
    const filteredEmails = emails.filter((email: Email & { archived_at?: number }) => {
      const emailAge =
        (email as Email & { archived_at?: number }).archived_at || email.received_at * 1000;
      return emailAge <= threshold;
    });
    archivedEmailsToDelete += filteredEmails.length;
  }

  return {
    activeEmails: activeEmailsToDelete,
    archivedEmails: archivedEmailsToDelete,
    totalEmails: activeEmailsToDelete + archivedEmailsToDelete,
  };
}

export async function clearAllOtps(): Promise<void> {
  await withLock('emails_storage_lock', async () => {
    const storedEmails = await getStoredEmailsMap();
    for (const msgs of Object.values(storedEmails)) {
      for (const m of msgs) {
        m.otp = null;
      }
    }
    await browser.storage.local.set({ storedEmails });
    await browser.storage.local.remove('latestOtp');
  });
}
