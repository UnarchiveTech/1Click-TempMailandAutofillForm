/**
 * Email storage management: store, archive, retrieve, and clean up emails
 */

import { browser } from 'wxt/browser';
import { addActivityEvent } from '@/utils/activity-tracker.js';
import { DEBUG, MAX_STORED_EMAILS_PER_INBOX } from '@/utils/constants.js';
import { log, logError } from '@/utils/logger.js';
import {
  getAnalyticsRecord,
  getEmailMaps,
  getEmailRetentionDays,
  getStoredEmailsMap,
  setAnalyticsRecord,
} from '@/utils/storage-keys.js';
import type { Account, Email, EmailFilters, NotificationSettings } from '@/utils/types.js';

/**
 * Play a notification sound using Web Audio API
 */
function playNotificationSound() {
  try {
    // Create audio context
    const audioContext = new (
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    )();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 800; // Hz
    oscillator.type = 'sine';
    gainNode.gain.value = 0.1; // Volume

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

export async function getStoredEmails(inboxAddress: string): Promise<Email[]> {
  try {
    const storedEmails = await getStoredEmailsMap();
    return storedEmails[inboxAddress] || [];
  } catch (error: unknown) {
    if (await isQuotaExceeded(error)) {
      logError('Storage quota exceeded, attempting to clean up old emails', { inboxAddress });
      // Try to clean up old emails based on retention settings
      const emailRetentionDays = await getEmailRetentionDays();
      await cleanupOldStoredEmails(emailRetentionDays, emailRetentionDays * 3);
      // Retry getting stored emails
      try {
        const storedEmails = await getStoredEmailsMap();
        return storedEmails[inboxAddress] || [];
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

  if (totalCleaned > 0) {
    await browser.storage.local.set({ storedEmails, archivedEmails });
    log(`Cleaned up ${totalCleaned} old emails`);
  }
}

export async function storeNewMessages(inboxAddress: string, newMessages: Email[]): Promise<void> {
  const storedEmails = await getStoredEmailsMap();
  if (!storedEmails[inboxAddress]) {
    storedEmails[inboxAddress] = [];
  }

  // Deduplicate messages by ID to avoid duplicates
  const existingIds = new Set(storedEmails[inboxAddress].map((e: Email) => e.id));
  const uniqueNewMessages = newMessages.filter((msg: Email) => !existingIds.has(msg.id));

  if (uniqueNewMessages.length > 0) {
    storedEmails[inboxAddress].push(...uniqueNewMessages);
    storedEmails[inboxAddress].sort((a: Email, b: Email) => b.received_at - a.received_at);

    if (storedEmails[inboxAddress].length > MAX_STORED_EMAILS_PER_INBOX) {
      storedEmails[inboxAddress] = storedEmails[inboxAddress].slice(0, MAX_STORED_EMAILS_PER_INBOX);
    }

    await browser.storage.local.set({ storedEmails });
    if (DEBUG) log(`Stored ${uniqueNewMessages.length} new emails for ${inboxAddress}`);
  }
}

export async function applyFiltersAndProcessMessages(
  messages: Email[],
  filters: EmailFilters = {},
  inbox: Account
): Promise<Email[]> {
  const result = (await browser.storage.local.get(['notificationSettings'])) as {
    notificationSettings?: NotificationSettings;
  };
  const notificationSettings: NotificationSettings = result.notificationSettings ?? {
    enabled: true,
    soundEnabled: true,
    expiryWarningThreshold: 60 * 60 * 1000, // Default 1 hour
  };

  const tsResult = (await browser.storage.local.get(['lastMessageTimestamps'])) as {
    lastMessageTimestamps?: Record<string, number>;
  };
  const lastMessageTimestamps: Record<string, number> = tsResult.lastMessageTimestamps ?? {};
  const lastTimestamp = lastMessageTimestamps[inbox.id] || 0;
  const newMessages = messages.filter((msg: Email) => msg.received_at * 1000 > lastTimestamp);

  // Send OTP from new messages to active tab
  if (newMessages.length > 0) {
    const latestNewMessageWithOtp = newMessages
      .filter((msg: Email) => msg.otp)
      .sort((a: Email, b: Email) => b.received_at - a.received_at)[0];

    if (latestNewMessageWithOtp) {
      try {
        // biome-ignore lint/suspicious/noExplicitAny: Chrome tabs API callback type not fully typed in WXT
        browser.tabs.query({ active: true, currentWindow: true }, (tabs: any[]) => {
          if (tabs.length > 0 && tabs[0].id) {
            browser.tabs
              .sendMessage(tabs[0].id, {
                type: 'fillOTP',
                otp: latestNewMessageWithOtp.otp,
              })
              .catch(() => {
                // Ignore if content script not loaded in the tab
              });
          }
        });
      } catch {
        // Ignore if no active tab or tab query fails
      }
    }
  }

  // Update last message timestamp
  if (messages.length > 0) {
    lastMessageTimestamps[inbox.id] = Math.max(
      ...messages.map((msg: Email) => msg.received_at * 1000)
    );
    await browser.storage.local.set({ lastMessageTimestamps });
  }

  // Track activity events for new emails
  for (const msg of newMessages) {
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
        otp: msg.otp,
        sender: msg.from_name || msg.from,
        subject: msg.subject,
      });
    }
  }

  // Update email received analytics
  const analytics = await getAnalyticsRecord();
  analytics.emailsReceived = (analytics.emailsReceived || 0) + newMessages.length;
  await setAnalyticsRecord(analytics);

  // Send notifications for new messages
  if (notificationSettings.enabled && newMessages.length > 0) {
    // Play sound if enabled
    if (notificationSettings.soundEnabled) {
      playNotificationSound();
    }

    newMessages.forEach((msg: Email) => {
      const notificationId = `email_${msg.id}_${inbox.id}`;
      browser.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: `New Email in ${inbox.address}`,
        message: `${msg.from_name || 'Unknown Sender'}: ${msg.subject || 'No Subject'}`,
        priority: 0,
        contextMessage: 'Click to view email',
      });
    });

    // Update notifications sent analytics
    analytics.notificationsSent = (analytics.notificationsSent || 0) + newMessages.length;
    await setAnalyticsRecord(analytics);

    // Track notification events
    for (const msg of newMessages) {
      await addActivityEvent('notification_sent', {
        inboxAddress: inbox.address,
        emailId: msg.id,
        sender: msg.from_name || msg.from,
        subject: msg.subject,
      });
    }
  }

  // Update OTP analytics
  const otpCount = messages.filter((msg: Email) => msg.otp).length;
  if (otpCount > 0) {
    // Re-read analytics to get latest value after the notifications write above
    const latestAnalytics = await getAnalyticsRecord();
    latestAnalytics.otpsDetected = (latestAnalytics.otpsDetected || 0) + otpCount;
    await setAnalyticsRecord(latestAnalytics);
  }

  // Apply filters
  let filteredMessages: Email[] = messages;

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

  if (filters.dateFrom) {
    filteredMessages = filteredMessages.filter(
      (msg: Email) => msg.received_at * 1000 >= filters.dateFrom!
    );
  }

  if (filters.dateTo) {
    filteredMessages = filteredMessages.filter(
      (msg: Email) => msg.received_at * 1000 <= filters.dateTo!
    );
  }

  filteredMessages.forEach((msg: Email) => {
    msg.stored_at = Date.now();
  });

  return filteredMessages;
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
