/**
 * Email storage management: store, archive, retrieve, and clean up emails
 */

import { browser } from 'wxt/browser';
import {
  type DetectOtpAndMagicOptions,
  detectOtpAndMagicLinksBatch,
} from '@/entrypoints/background/parsing/ai-detection.js';
import { matchesAddressTerm } from '@/features/address/email-filters.js';
import { addActivityEvent } from '@/utils/activity/activity-tracker.js';
import { copyToClipboardFromBackground } from '@/utils/clipboard/clipboard.js';
import { CONSTANTS } from '@/utils/constants.js';
import { tSync } from '@/utils/i18n/i18n-background.js';
import { log, logError, logWarn } from '@/utils/logger.js';
import { withLock } from '@/utils/mutex.js';
import { createBrowserNotification } from '@/utils/notifications/notification-permission.js';
import {
  playNotificationSound,
  playNotificationSoundIfEnabled,
} from '@/utils/notifications/notification-sound.js';
import { classifyEmailCodes } from '@/utils/otp/email-code-evidence.js';
import { maybeAutoCopyOtp } from '@/utils/otp/otp-auto-copy.js';
import { isRealOtp } from '@/utils/otp/otp-code.js';
import {
  getAddressIdForEmailAddress,
  getAddressIdFromIndex,
  getAnalyticsRecord,
  getArchivedEmailsForAddress,
  getEmailMaps,
  getEmailRetentionDays,
  getSeenEmailIds,
  getStoredEmailsForAddress,
  getStoredEmailsMap,
  isEmailStorageBagKey,
  parseNotificationSettings,
  resolveBagKey,
  setArchivedEmailsForAddress,
  setLogicalEmailMapsUnlockedForLockedCaller,
  setStoredEmailsForAddress,
} from '@/utils/storage/storage-keys.js';
import { isQuotaStorageError } from '@/utils/storage/storage-write.js';
import { safeStorageSet } from '@/utils/storage/storageMonitor.js';
import { toMs } from '@/utils/time/time.js';
import { timeAgo } from '@/utils/time/time-format.js';
import type { Address, Email, EmailFilters, NotificationSettings } from '@/utils/types.js';
import { broadcastOtpToTabs } from './otp-broadcast.js';

// Check if storage quota is exceeded. Delegates to the shared classifier that
// the write-retry primitive uses, so a quota failure reads the same whether it
// arrives raw from the browser or wrapped in the `StorageWriteError` a retried
// write throws (the browser's own error stays on it as `originalError`).
async function isQuotaExceeded(error: unknown): Promise<boolean> {
  return isQuotaStorageError(error);
}

/** Resolve bag for an address with case-insensitive key match. */
function bagForAddress(storedEmails: Record<string, Email[]>, address: string): Email[] {
  if (!address) return [];
  if (storedEmails[address]) return storedEmails[address] || [];
  const lower = address.toLowerCase();
  for (const [k, list] of Object.entries(storedEmails)) {
    if (k.toLowerCase() === lower) return list || [];
  }
  return [];
}

/**
 * Resolve the key under which an inbox's bag is actually stored, ignoring
 * address casing. Returns the existing key when one matches case-insensitively
 * (so writes land in the pre-existing bag instead of spawning a duplicate under
 * a differently-cased key), or the given address when no bag exists yet.
 * Email addresses are case-insensitive for these providers - a casing drift
 * (provider re-casing an address, backup restore, account edit) must not split
 * a mailbox's emails across two keys, which would silently break dedup,
 * notifications, and OTP broadcasts.
 */

export async function getStoredEmails(address: string, _isRetry = false): Promise<Email[]> {
  try {
    const addressId = await getAddressIdForEmailAddress(address);
    if (addressId) return getStoredEmailsForAddress(addressId, address);
    const storedEmails = await getStoredEmailsMap();
    return bagForAddress(storedEmails, address);
  } catch (error: unknown) {
    if (await isQuotaExceeded(error)) {
      if (_isRetry) {
        logError('Storage quota still exceeded after cleanup', { address });
        throw new Error('Storage quota exceeded. Please free up space.');
      }
      logError('Storage quota exceeded, attempting to clean up old emails', { address });
      const emailRetentionDays = await getEmailRetentionDays();
      await cleanupOldStoredEmails(emailRetentionDays, emailRetentionDays * 3);
      return getStoredEmails(address, true);
    }
    throw error;
  }
}

function enforceMaxArchivedEmailsLimit(archivedEmails: Record<string, Email[]>): void {
  const allArchived = Object.values(archivedEmails).flat();
  if (allArchived.length > CONSTANTS.MAX_ARCHIVED_EMAILS) {
    const before = allArchived.length;
    allArchived.sort((a, b) => {
      // archived_at is stored in ms today, but normalize through toMs (like
      // received_at) so a seconds-valued value (e.g. a backup import) can't
      // invert the newest-wins sort.
      const tA =
        toMs((a as Email & { archived_at?: number }).archived_at ?? 0) || toMs(a.received_at);
      const tB =
        toMs((b as Email & { archived_at?: number }).archived_at ?? 0) || toMs(b.received_at);
      return tB - tA;
    });
    // Keep the newest MAX records by object identity, NOT by email id: provider
    // ids are reused across addresses, so deduping by id would keep every copy
    // of a reused id and silently exceed the cap.
    const kept = new Set(allArchived.slice(0, CONSTANTS.MAX_ARCHIVED_EMAILS));
    // The hard cap is NOT a user setting (unlike retention days), so an
    // eviction must leave a trace instead of silently dropping oldest mail.
    const evicted = before - kept.size;
    if (evicted > 0) {
      logWarn('Archived-mail hard cap evicted oldest messages', {
        max: CONSTANTS.MAX_ARCHIVED_EMAILS,
        before,
        kept: kept.size,
        evicted,
      });
    }
    for (const address of Object.keys(archivedEmails)) {
      const keptInBag = archivedEmails[address].filter((e) => kept.has(e));
      if (keptInBag.length > 0) {
        archivedEmails[address] = keptInBag;
      } else {
        delete archivedEmails[address];
      }
    }
  }
}

export async function clearStoredEmails(address: string, skipLock = false): Promise<void> {
  const archive = async (): Promise<void> => {
    const addressId = await getAddressIdForEmailAddress(address);
    if (addressId) {
      // Use the logical aggregate adapter for this lifecycle move so the
      // global archived cap is enforced across all ID-keyed addresses, not
      // independently once per mailbox.
      const { storedEmails, archivedEmails } = await getEmailMaps();
      const storedKey = resolveBagKey(storedEmails, address);
      const archivedKey = resolveBagKey(archivedEmails, address);
      const stored =
        storedEmails[storedKey] || (await getStoredEmailsForAddress(addressId, address));
      const archived =
        archivedEmails[archivedKey] || (await getArchivedEmailsForAddress(addressId, address));
      if (stored.length === 0) return;
      const emailsToArchive = stored.map((email: Email) => ({
        ...email,
        archived: true,
        archived_at: Date.now(),
        original_inbox: address,
      }));
      delete storedEmails[storedKey];
      archivedEmails[archivedKey] = [...archived, ...emailsToArchive];
      enforceMaxArchivedEmailsLimit(archivedEmails);
      await setLogicalEmailMapsUnlockedForLockedCaller(storedEmails, archivedEmails);
      log(`Archived ${emailsToArchive.length} emails for expired inbox: ${address}`);
      return;
    }

    const { storedEmails, archivedEmails } = await getEmailMaps();
    let archivedCount = 0;
    // Case-insensitive key resolution: a casing drift must not leave the
    // mailbox's mail "unarchivable" (stored under one key, looked up under
    // another) - otherwise expired-inbox cleanup would silently miss it.
    const storedKey = resolveBagKey(storedEmails, address);
    const archivedKey = resolveBagKey(archivedEmails, address);
    if (storedEmails[storedKey] && storedEmails[storedKey].length > 0) {
      if (!archivedEmails[archivedKey]) archivedEmails[archivedKey] = [];
      const emailsToArchive = storedEmails[storedKey].map((email: Email) => ({
        ...email,
        archived: true,
        archived_at: Date.now(),
        original_inbox: address,
      }));
      archivedEmails[archivedKey].push(...emailsToArchive);
      archivedCount = emailsToArchive.length;
      delete storedEmails[storedKey];
    }
    enforceMaxArchivedEmailsLimit(archivedEmails);
    await setLogicalEmailMapsUnlockedForLockedCaller(storedEmails, archivedEmails);
    if (archivedCount > 0) log(`Archived ${archivedCount} emails for expired inbox: ${address}`);
  };

  const doArchive = skipLock ? archive : () => withLock('emails_storage_lock', archive);

  try {
    await doArchive();
  } catch (error: unknown) {
    if (await isQuotaExceeded(error)) {
      logError('Storage quota exceeded during archive, attempting cleanup', { address });
      const emailRetentionDays = await getEmailRetentionDays();
      await cleanupOldStoredEmails(emailRetentionDays, emailRetentionDays * 3, skipLock);
      await doArchive();
    } else {
      throw error;
    }
  }
}

/**
 * Archive mailbox messages and commit the matching address lifecycle changes
 * in one storage.local.set transaction. This prevents an address from staying
 * active after its messages have already moved to the archived bags if the
 * address write fails.
 *
 * The caller may hold the address lock; this function acquires the email
 * storage lock, matching the address-lock → email-lock order used by batch
 * deletion. `addresses` must be the validated raw records so encrypted tokens
 * remain ciphertext while the combined commit is written.
 */
export async function archiveStoredEmailsAndCommitAddresses(addresses: Address[]): Promise<void> {
  await withLock('emails_storage_lock', async () => {
    const { storedEmails, archivedEmails } = await getEmailMaps();
    const archivedAt = Date.now();

    for (const addressRecord of addresses) {
      if (!addressRecord.id || !addressRecord.address) continue;

      const storedKey = resolveBagKey(storedEmails, addressRecord.address);
      const archivedKey = resolveBagKey(archivedEmails, addressRecord.address);
      const stored =
        storedEmails[storedKey] ||
        (await getStoredEmailsForAddress(addressRecord.id, addressRecord.address));
      if (stored.length === 0) continue;

      const archived =
        archivedEmails[archivedKey] ||
        (await getArchivedEmailsForAddress(addressRecord.id, addressRecord.address));
      const emailsToArchive = stored.map((email: Email) => ({
        ...email,
        archived: true,
        archived_at: archivedAt,
        original_inbox: addressRecord.address,
      }));

      delete storedEmails[storedKey];
      archivedEmails[archivedKey] = [...archived, ...emailsToArchive];
    }

    enforceMaxArchivedEmailsLimit(archivedEmails);
    await setLogicalEmailMapsUnlockedForLockedCaller(storedEmails, archivedEmails, {
      addresses,
    });
  });
}

/**
 * Move emails from archivedEmails back into storedEmails when an inbox is
 * unarchived / restored / renewed, so Offline Saved history remains available.
 */
export async function restoreArchivedEmailsToStored(address: string): Promise<void> {
  await withLock('emails_storage_lock', async () => {
    // A record evicted into the archived overflow is NOT in `addresses`, but
    // keeps its index entry + ID-keyed bags - resolve through the index so the
    // restored mail lands back in its stable bag instead of being orphaned.
    const addressId =
      (await getAddressIdForEmailAddress(address)) || (await getAddressIdFromIndex(address));
    if (addressId) {
      const archived = await getArchivedEmailsForAddress(addressId, address);
      if (archived.length === 0) return;
      const existing = await getStoredEmailsForAddress(addressId, address);
      const seen = new Set(existing.map((e) => e.id));
      const merged = [...existing];
      for (const email of archived) {
        if (seen.has(email.id)) continue;
        seen.add(email.id);
        const {
          archived: _a,
          archived_at: _at,
          ...rest
        } = email as Email & {
          archived?: boolean;
          archived_at?: number;
        };
        merged.push({
          ...rest,
          local_only: true,
          local_only_since:
            rest.local_only_since || rest.local_deleted_at || rest.stored_at || Date.now(),
          original_inbox: rest.original_inbox || address,
        });
      }
      await setStoredEmailsForAddress(addressId, address, merged);
      await setArchivedEmailsForAddress(addressId, address, []);
      log(`Restored ${archived.length} archived emails for inbox: ${address}`);
      return;
    }

    const { storedEmails, archivedEmails } = await getEmailMaps();
    const archivedKey = resolveBagKey(archivedEmails, address);
    const archived = archivedEmails[archivedKey] || [];
    if (archived.length === 0) return;

    const storedKey = resolveBagKey(storedEmails, address);
    const existing = storedEmails[storedKey] || [];
    const seen = new Set(existing.map((e) => e.id));
    const merged = [...existing];
    for (const email of archived) {
      if (seen.has(email.id)) continue;
      seen.add(email.id);
      const {
        archived: _a,
        archived_at: _at,
        ...rest
      } = email as Email & {
        archived?: boolean;
        archived_at?: number;
      };
      merged.push({
        ...rest,
        local_only: true,
        local_only_since:
          rest.local_only_since || rest.local_deleted_at || rest.stored_at || Date.now(),
        original_inbox: rest.original_inbox || address,
      });
    }
    storedEmails[storedKey] = merged;
    delete archivedEmails[archivedKey];
    await setLogicalEmailMapsUnlockedForLockedCaller(storedEmails, archivedEmails);
    log(`Restored ${archived.length} archived emails for inbox: ${address}`);
  });
}

export async function getArchivedEmails(address?: string): Promise<Email[]> {
  if (address) {
    const addressId = await getAddressIdForEmailAddress(address);
    if (addressId) {
      const archived = await getArchivedEmailsForAddress(addressId, address);
      return archived.sort(
        (a: Email, b: Email) =>
          ((b as Email & { archived_at?: number }).archived_at || toMs(b.received_at) || 0) -
          ((a as Email & { archived_at?: number }).archived_at || toMs(a.received_at) || 0)
      );
    }
  }

  const { archivedEmails } = await getEmailMaps();

  if (address) {
    return (archivedEmails[resolveBagKey(archivedEmails, address)] || []).sort(
      (a: Email, b: Email) =>
        ((b as Email & { archived_at?: number }).archived_at || toMs(b.received_at) || 0) -
        ((a as Email & { archived_at?: number }).archived_at || toMs(a.received_at) || 0)
    );
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
  archivedRetentionDays: number = 90,
  skipLock: boolean = false
): Promise<void> {
  // 0 means "never delete" for each retention window independently - and any
  // non-positive value must count as keep-all too: a negative retention would
  // otherwise compute a FUTURE threshold and delete everything. The persisted
  // setting can only be 0 or a clamped positive day count (see
  // getEmailRetentionDays), so negatives only arrive from a corrupted record or
  // a direct caller; normalizing them to keep-all is the safe direction.
  if (activeRetentionDays <= 0 && archivedRetentionDays <= 0) {
    return;
  }

  const task = async () => {
    const { storedEmails, archivedEmails } = await getEmailMaps();

    const activeThreshold =
      activeRetentionDays <= 0 ? null : Date.now() - activeRetentionDays * 24 * 60 * 60 * 1000;
    const archivedThreshold =
      archivedRetentionDays <= 0 ? null : Date.now() - archivedRetentionDays * 24 * 60 * 60 * 1000;
    let totalCleaned = 0;

    for (const [address, emails] of Object.entries(storedEmails)) {
      const filteredEmails = emails.filter((email: Email & { stored_at?: number }) => {
        const emailAge = email.stored_at || toMs(email.received_at);
        return activeThreshold === null || emailAge > activeThreshold;
      });

      if (filteredEmails.length === 0) {
        // Delete the bag entirely when nothing survives - retaining `[]` would
        // leak one storage key per retired mailbox forever (storedEmails and
        // archivedEmails accumulate dead address keys over months of use).
        if (emails.length > 0) totalCleaned += emails.length;
        delete storedEmails[address];
      } else if (filteredEmails.length !== emails.length) {
        storedEmails[address] = filteredEmails;
        totalCleaned += emails.length - filteredEmails.length;
      }
    }

    for (const [address, emails] of Object.entries(archivedEmails)) {
      const filteredEmails = emails.filter(
        (email: Email & { archived_at?: number; stored_at?: number }) => {
          const emailAge =
            (email as Email & { archived_at?: number }).archived_at || toMs(email.received_at);
          return archivedThreshold === null || emailAge > archivedThreshold;
        }
      );

      if (filteredEmails.length === 0) {
        if (emails.length > 0) totalCleaned += emails.length;
        delete archivedEmails[address];
      } else if (filteredEmails.length !== emails.length) {
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
      try {
        await setLogicalEmailMapsUnlockedForLockedCaller(storedEmails, archivedEmails);
        log(`Cleaned up ${totalCleaned} old/excess emails`);
      } catch (error) {
        logError(
          'Failed to persist cleaned email bags',
          { totalCleaned },
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
  };

  if (skipLock) {
    await task();
  } else {
    await withLock('emails_storage_lock', task);
  }
}

/** Append newly-processed email IDs to a seen list (capped, oldest dropped).
 * `cap` is injectable for tests; the live constant is the production default. */
export function addSeenIds(
  existing: string[] | undefined,
  emails: Email[],
  cap: number = CONSTANTS.MAX_SEEN_EMAIL_IDS_PER_INBOX
): string[] {
  const next = existing ? [...existing] : [];
  for (const msg of emails) {
    const id = msg.id ? String(msg.id) : '';
    if (id && !next.includes(id)) next.push(id);
  }
  if (next.length > cap) next.splice(0, next.length - cap);
  return next;
}

export async function storeNewMessages(address: string, newMessages: Email[]): Promise<void> {
  // Classify before persistence and all side effects. Possible codes are kept
  // separately so automation/broadcast/cache consumers see supported OTPs only.
  newMessages = newMessages.map((message) => {
    const classification = classifyEmailCodes(
      message.subject,
      message.body_html || message.body_plain || message.body,
      message.otp || message.otpCandidate
    );
    return { ...message, ...classification, isOtp: !!classification.otp };
  });
  const messagesToProcess = await withLock('emails_storage_lock', async () => {
    const addressId = await getAddressIdForEmailAddress(address);
    if (!addressId) {
      logError('Cannot store messages without a registered address id', { address });
      return;
    }
    // Every 3.0 mailbox has one stable ID-keyed bag. The logical maps below
    // are only an in-memory adapter for shared cleanup/dedup code; they are
    // never persisted as aggregate storage keys.
    let addressStored = await getStoredEmailsForAddress(addressId);
    const addressArchived = await getArchivedEmailsForAddress(addressId);
    const storedEmails: Record<string, Email[]> = { [address]: addressStored };
    const storedKey = address;

    // Deduplicate per-inbox only: same message ID may appear in different addresses
    // (e.g. same sender sends to multiple addresses). Checking across ALL addresses
    // would incorrectly suppress a message in inbox B just because it exists in inbox A.
    const existingIds = new Set<string>();
    for (const e of addressStored) if (e.id) existingIds.add(String(e.id));
    for (const e of addressArchived) if (e.id) existingIds.add(String(e.id));

    // Durable seen-ID set: once an email has been processed it must never re-enter
    // the "new" pipeline, even if it fell out of the capped bag while the provider
    // still lists it. Without this, evicted mail was re-fetched, re-detected,
    // re-notified, and re-broadcast on every poll - and retention cleanup fought a
    // losing battle with the re-add loop.
    const seenEmailIds = await getSeenEmailIds();
    const seenKey = resolveBagKey(seenEmailIds, address);
    const seenBefore = seenEmailIds[seenKey] || [];
    for (const id of seenBefore) if (id) existingIds.add(String(id));

    const batchIds = new Set<string>();
    const uniqueNewMessages = newMessages.filter((msg: Email) => {
      const id = String(msg.id);
      if (existingIds.has(id) || batchIds.has(id)) return false;
      batchIds.add(id);
      return true;
    });

    if (uniqueNewMessages.length > 0) {
      for (const msg of uniqueNewMessages) {
        if (!msg.original_inbox) msg.original_inbox = address;
      }
      // Remember the newly-seen IDs (capped) so later eviction can't resurrect them.
      seenEmailIds[seenKey] = addSeenIds(seenBefore, uniqueNewMessages);

      storedEmails[storedKey].push(...uniqueNewMessages);
      storedEmails[storedKey].sort((a: Email, b: Email) => b.received_at - a.received_at);

      if (storedEmails[storedKey].length > CONSTANTS.MAX_STORED_EMAILS_PER_INBOX) {
        addressStored = storedEmails[storedKey] = storedEmails[storedKey].slice(
          0,
          CONSTANTS.MAX_STORED_EMAILS_PER_INBOX
        );
      }

      let success = false;
      try {
        // Persist the mailbox bag and its durable de-duplication IDs in one
        // storage.set call. A split write could leave either half behind if
        // the worker is stopped between operations.
        await setStoredEmailsForAddress(addressId, address, addressStored, { seenEmailIds });
        success = true;
      } catch (error) {
        logError('Failed to persist new messages before retry', {
          address,
          error: error instanceof Error ? error.message : String(error),
        });
        success = false;
      }
      if (!success) {
        logError('Storage quota exceeded, attempting cleanup before retry', { address });
        const emailRetentionDays = await getEmailRetentionDays();
        await cleanupOldStoredEmails(emailRetentionDays, emailRetentionDays * 3, true);

        // Re-read stored emails after cleanup so we merge our new messages into the cleaned list
        const refreshedMaps = await getEmailMaps();
        const refreshedStored = refreshedMaps.storedEmails;
        const refreshedKey = resolveBagKey(refreshedStored, address);
        if (!refreshedStored[refreshedKey]) refreshedStored[refreshedKey] = [];
        // Dedup against cleaned list again (also excluding already-seen IDs)
        const currentIds = new Set(refreshedStored[refreshedKey].map((e: Email) => String(e.id)));
        for (const id of seenBefore) if (id) currentIds.add(String(id));
        const retryBatchIds = new Set<string>();
        const refreshedUnique = newMessages.filter((msg: Email) => {
          const id = String(msg.id);
          if (currentIds.has(id) || retryBatchIds.has(id)) return false;
          retryBatchIds.add(id);
          return true;
        });
        // Remember anything that only became "new" after cleanup freed space.
        seenEmailIds[seenKey] = addSeenIds(seenEmailIds[seenKey], refreshedUnique);
        refreshedStored[refreshedKey].push(...refreshedUnique);
        refreshedStored[refreshedKey].sort((a: Email, b: Email) => b.received_at - a.received_at);
        if (refreshedStored[refreshedKey].length > CONSTANTS.MAX_STORED_EMAILS_PER_INBOX) {
          refreshedStored[refreshedKey] = refreshedStored[refreshedKey].slice(
            0,
            CONSTANTS.MAX_STORED_EMAILS_PER_INBOX
          );
        }

        try {
          await setLogicalEmailMapsUnlockedForLockedCaller(
            refreshedStored,
            refreshedMaps.archivedEmails,
            undefined,
            { seenEmailIds }
          );
          success = true;
        } catch (error) {
          logError('Failed to persist new messages after retention cleanup', {
            address,
            error: error instanceof Error ? error.message : String(error),
          });
          success = false;
        }
        if (!success) {
          // Last resort: aggressively trim the newest-message inbox (drop the
          // OLDEST emails beyond a small floor) so newly-received mail is never
          // silently dropped on quota exhaustion. Prefer dropping old mail over
          // losing the brand-new message the user is waiting for.
          logError('Storage quota exceeded after retention cleanup - trimming oldest emails', {
            address,
          });
          const floor = Math.min(CONSTANTS.MAX_STORED_EMAILS_PER_INBOX, 20);
          let trimmedStored = refreshedStored[refreshedKey] || [];
          if (trimmedStored.length > floor) {
            trimmedStored = trimmedStored.slice(0, floor);
            refreshedStored[refreshedKey] = trimmedStored;
          }
          try {
            await setLogicalEmailMapsUnlockedForLockedCaller(
              refreshedStored,
              refreshedMaps.archivedEmails,
              undefined,
              { seenEmailIds }
            );
            success = true;
          } catch (error) {
            logError('Failed to persist trimmed new messages', {
              address,
              error: error instanceof Error ? error.message : String(error),
            });
            success = false;
          }
          if (!success) {
            logError('Failed to store new messages even after trimming', { address });
          }
        }
        if (!success) {
          // Do not report side effects until both the message bag and seen-ID
          // durability have succeeded; otherwise later polls can re-notify mail.
          logError('Could not durably persist seen email IDs; suppressing side effects', {
            address,
          });
          // Keep the bag and seen-ID set consistent. If this batch remains in
          // the bag without durable seen IDs, it will be hidden on the next
          // poll but can re-enter the side-effect pipeline after bag eviction.
          // Removing it lets a later provider poll retry the whole operation.
          const failedBatchIds = new Set(uniqueNewMessages.map((msg) => String(msg.id)));
          const retryStored = (refreshedStored[refreshedKey] || []).filter(
            (msg) => !failedBatchIds.has(String(msg.id))
          );
          try {
            await setStoredEmailsForAddress(addressId, address, retryStored);
          } catch (error) {
            logError('Failed to roll back messages without durable seen IDs', {
              address,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          return null;
        }
      }
      if (CONSTANTS.DEBUG && success)
        log(`Stored ${uniqueNewMessages.length} new emails for ${address}`);

      // Defer side effects to outside the lock so slow tab communication
      // never blocks mailbox polling, cleanup, or other email mutations.
      return uniqueNewMessages;
    }
    return null;
  });

  // Process side effects (notifications, OTP broadcast, rules) outside the lock.
  if (messagesToProcess?.length) {
    await processNewMessages(address, messagesToProcess);
  }
}

export function filterMessages(messages: Email[], filters: EmailFilters = {}): Email[] {
  // Return a new array of fresh copies to avoid mutating input objects in place
  let filteredMessages = messages.map((msg) => ({ ...msg }));

  if (filters.searchQuery?.trim()) {
    const query = filters.searchQuery.toLowerCase().trim();
    filteredMessages = filteredMessages.filter((msg: Email) => {
      const subjectMatch = msg.subject?.toLowerCase().includes(query);
      const fromAddressMatch = msg.from?.toLowerCase().includes(query);
      const fromMatch = msg.from_name?.toLowerCase().includes(query);
      const bodyMatch = (msg.body_plain || msg.body || '').toLowerCase().includes(query);
      return subjectMatch || fromAddressMatch || fromMatch || bodyMatch;
    });
  }

  if (filters.hasOTP) {
    filteredMessages = filteredMessages.filter((msg: Email) => isRealOtp(msg.otp));
  }

  if (filters.senderDomain?.trim()) {
    const senderDomain = filters.senderDomain.trim();
    filteredMessages = filteredMessages.filter((msg: Email) =>
      matchesAddressTerm(msg.from || msg.from_name, senderDomain)
    );
  }

  if (filters.recipient?.trim()) {
    const recipient = filters.recipient.trim();
    filteredMessages = filteredMessages.filter((msg: Email) =>
      matchesAddressTerm(msg.original_inbox, recipient)
    );
  }

  if (filters.dateFrom) {
    const fromTime =
      typeof filters.dateFrom === 'string'
        ? new Date(filters.dateFrom).getTime()
        : filters.dateFrom;
    if (Number.isFinite(fromTime)) {
      filteredMessages = filteredMessages.filter((msg: Email) => toMs(msg.received_at) >= fromTime);
    }
  }

  if (filters.dateTo) {
    const toTime =
      typeof filters.dateTo === 'string'
        ? new Date(filters.dateTo).getTime() + 24 * 60 * 60 * 1000 - 1
        : filters.dateTo;
    if (Number.isFinite(toTime)) {
      filteredMessages = filteredMessages.filter((msg: Email) => toMs(msg.received_at) <= toTime);
    }
  }

  return filteredMessages;
}

async function processNewMessages(address: string, uniqueNewMessages: Email[]): Promise<void> {
  if (uniqueNewMessages.length === 0) return;

  try {
    const { addresses = [] } = (await browser.storage.local.get(['addresses'])) as {
      addresses?: Address[];
    };

    // Case-insensitive: a provider re-casing the address (or a backup restore)
    // must not make this lookup miss - that would silently kill notifications,
    // activity events, and the unread badge for the whole mailbox.
    const record = addresses.find((i) => i.address.toLowerCase() === address.toLowerCase());

    // Inbox rules (sender/subject/body match → tag · auto-archive · silence):
    // applied early so silenced messages never reach the notification path, and
    // OTP delivery (step 1) always stays live even for silenced senders.
    const ruleSilenced = new Set<string>();
    try {
      const { applyMailboxRulesToNewMessages } = await import(
        '@/features/address/mailbox-rules.js'
      );
      const ruleResult = await applyMailboxRulesToNewMessages(record, uniqueNewMessages);
      if (ruleResult.silencedIds.size > 0) {
        for (const id of ruleResult.silencedIds) ruleSilenced.add(id);
      }
    } catch (rulesError) {
      // Rules must never break the mail pipeline - but a broken rules engine
      // must not be indistinguishable from an unmatched rule (Automation
      // match-stats would silently show zero).
      logError('Failed to apply mailbox rules', rulesError);
    }

    // 1. Send OTP from new messages to active tab
    const latestNewMessageWithOtp = uniqueNewMessages
      .filter((msg: Email) => msg.otp)
      .sort((a: Email, b: Email) => b.received_at - a.received_at)[0];

    if (latestNewMessageWithOtp?.otp) {
      // Background workers must use tabs.sendMessage for webpage content
      // scripts; runtime.sendMessage only reaches extension contexts here.
      await broadcastOtpToTabs({
        otp: latestNewMessageWithOtp.otp,
        sender: latestNewMessageWithOtp.from,
        senderName: latestNewMessageWithOtp.from_name,
        subject: latestNewMessageWithOtp.subject,
        // Let wait-OTP panels reject codes addressed to a different inbox.
        recipient: address,
      });

      // M5: Update latestOtp cache in storage
      const latestOtpRecord = {
        otp: latestNewMessageWithOtp.otp,
        sender: latestNewMessageWithOtp.from || '',
        senderName: latestNewMessageWithOtp.from_name || '',
        context: [
          latestNewMessageWithOtp.from_name ? `From: ${latestNewMessageWithOtp.from_name}` : '',
          timeAgo(toMs(latestNewMessageWithOtp.received_at)),
        ]
          .filter(Boolean)
          .join(' | '),
        received_at: latestNewMessageWithOtp.received_at,
        recipient: address,
      };
      const currentLatestOtp = (
        (await browser.storage.local.get('latestOtp')) as {
          latestOtp?: { received_at: number };
        }
      ).latestOtp;
      const currentReceived = currentLatestOtp?.received_at || 0;
      if (latestNewMessageWithOtp.received_at > currentReceived) {
        await withLock('latest_otp_lock', async () => {
          const latest = (await browser.storage.local.get('latestOtp')) as {
            latestOtp?: { received_at?: number };
          };
          if (
            !latest.latestOtp ||
            latestNewMessageWithOtp.received_at > (latest.latestOtp.received_at || 0)
          ) {
            await safeStorageSet(browser, { latestOtp: latestOtpRecord });
          }
        });
      } // M6: Per-site auto-copy - when the OTP sender's domain is on the
      // user's `otpAutoCopyList`, push the code to the clipboard immediately.
      // Confirm with the value-free toast/notification (never the code itself,
      // shoulder-surfing). Only fires for genuinely new OTPs: re-fetching an
      // already-stored email has the same received_at, so this is skipped.
      await maybeAutoCopyOtp({
        otp: latestNewMessageWithOtp.otp,
        sender: latestNewMessageWithOtp.from || '',
        copy: (text) => copyToClipboardFromBackground(text),
        notify: (ok) => {
          try {
            // Audible confirmation for the auto-copy event - same custom sound
            // as new-email alerts, gated by the soundEnabled toggle.
            void playNotificationSoundIfEnabled();
            void browser.runtime.sendMessage({ type: 'otpAutoCopied', ok }).catch(() => {
              // No extension UI open - value-free desktop notification.
              createBrowserNotification('otp_auto_copy', {
                type: 'basic',
                iconUrl: 'icons/icon48.png',
                title: ok
                  ? tSync('notifications.otpAutoCopiedTitle')
                  : tSync('notifications.otpAutoCopyFailedTitle'),
                message: ok
                  ? tSync('notifications.otpAutoCopiedMessage')
                  : tSync('notifications.otpAutoCopyFailedMessage'),
              });
            });
          } catch {
            /* ignore */
          }
        },
      });
    }

    // 2. Track activity events for new emails
    if (record) {
      for (const msg of uniqueNewMessages) {
        await addActivityEvent('email_received', {
          address: record.address,
          emailId: msg.id,
          sender: msg.from_name || msg.from,
          subject: msg.subject,
        });

        if (msg.otp) {
          await addActivityEvent('otp_detected', {
            address: record.address,
            emailId: msg.id,
            otp: '••••',
            sender: msg.from_name || msg.from,
            subject: msg.subject,
          });
        }
      }
    }

    // 3. Update last message timestamp
    if (record) {
      // This is a whole-map read-modify-write. Polling fans out across inboxes,
      // so serialize the map update independently of the email-bag lock held by
      // storeNewMessages. Otherwise concurrent side-effect passes can each read
      // the same map and discard another inbox's timestamp.
      // Keep the email lock across the existence check and timestamp write.
      // Deletion takes this same lock before removing the address, so a side
      // effect pass that started before deletion cannot resurrect a timestamp
      // after the delete commits.
      await withLock('emails_storage_lock', async () => {
        const currentAddresses = (await browser.storage.local.get(['addresses'])) as {
          addresses?: Address[];
        };
        if (!(currentAddresses.addresses || []).some((item) => item.id === record.id)) return;

        await withLock('last_message_timestamps_lock', async () => {
          const { lastMessageTimestamps = {} } = (await browser.storage.local.get([
            'lastMessageTimestamps',
          ])) as {
            lastMessageTimestamps?: Record<string, number>;
          };
          let maxTimestamp = lastMessageTimestamps[record.id] || 0;
          for (const msg of uniqueNewMessages) {
            // received_at may be seconds OR milliseconds depending on provider
            // mapping - toMs normalizes both. A bare `* 1000` would inflate an
            // already-millisecond timestamp 1000× and corrupt the unread badge.
            const ts = toMs(msg.received_at);
            if (ts > maxTimestamp) maxTimestamp = ts;
          }
          lastMessageTimestamps[record.id] = maxTimestamp;
          await safeStorageSet(browser, { lastMessageTimestamps });
        });
      });
    }

    // 4. Tally analytics deltas; applied under analytics_lock at the end so a
    //    concurrent recordEmailRead / incrementAnalytic can't be clobbered.
    const emailsReceivedDelta = uniqueNewMessages.length;
    const newOtpCount = uniqueNewMessages.filter((msg: Email) => msg.otp).length;
    let notificationsSentDelta = 0;

    // 5. Send notifications for new messages
    const result = (await browser.storage.local.get(['notificationSettings'])) as {
      notificationSettings?: NotificationSettings;
    };
    // One default, shared with the writer (`parseNotificationSettings`), so the
    // values a toggle materializes can never disagree with what this gate
    // assumes for a record that never had them.
    const notificationSettings: NotificationSettings = parseNotificationSettings(
      result.notificationSettings
    );

    if (notificationSettings.enabled && record) {
      // Per-address snooze: skip OS notifications while muted for this mailbox
      let snoozedUntil = 0;
      try {
        const snoozeRes = (await browser.storage.local.get(['notificationSnoozeByAddress'])) as {
          notificationSnoozeByAddress?: Record<string, number>;
        };
        const map = snoozeRes.notificationSnoozeByAddress || {};
        snoozedUntil = map[record.address] || map[record.address.toLowerCase()] || 0;
      } catch (error) {
        // A corrupt/unreadable snooze map silently defeats per-address mute
        // (snoozedUntil falls back to 0 → notifications fire) - surface it.
        logError(
          'Failed to read notification snooze map',
          { address: record.address },
          error instanceof Error ? error : new Error(String(error))
        );
        snoozedUntil = 0;
      }
      // Snooze only gates OS notifications; other mail side effects still run.
      if (snoozedUntil <= Date.now()) {
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
        } catch (error) {
          // Failing open (notify all) is the safer default, but the decision
          // failure itself must not disappear - quiet hours / muted senders
          // would silently stop working.
          logError(
            'Notification policy decision failed - notifying all',
            { address: record.address },
            error instanceof Error ? error : new Error(String(error))
          );
          toNotify = uniqueNewMessages;
        }

        // Inbox rules: drop messages whose rule requested silence from the OS
        // notification batch (digest inclusion included). OTP delivery above is
        // unaffected - a verification code is never silenced.
        if (ruleSilenced.size > 0) {
          toNotify = toNotify.filter((m) => !ruleSilenced.has(m.id));
        }

        if (toNotify.length > 0) {
          if (notificationSettings.soundEnabled) {
            void playNotificationSound();
          }

          if (useDigest && toNotify.length > 1) {
            const otpN = toNotify.filter((m) => m.otp || m.isOtp).length;
            const notificationId = `email-digest:${record.id}`;
            createBrowserNotification(notificationId, {
              type: 'basic',
              iconUrl: 'icons/icon48.png',
              title: tSync('notifications.digestTitle', {
                count: toNotify.length,
                address: record.address,
              }),
              message:
                otpN === toNotify.length
                  ? tSync('notifications.digestMessageOtpOnly', { otp: otpN })
                  : otpN > 0
                    ? tSync('notifications.digestMessageOtp', {
                        otp: otpN,
                        other: toNotify.length - otpN,
                      })
                    : toNotify
                        .slice(0, 3)
                        .map((m) => m.subject || m.from_name || tSync('notifications.mail'))
                        .join(' · '),
              priority: 0,
              contextMessage: tSync('notifications.clickToOpenMailbox'),
              // Respect the soundEnabled toggle: mute the OS notification chime
              // when the user disabled sounds (custom AudioContext sound doesn't
              // run in the service worker anyway).
              silent: !notificationSettings.soundEnabled,
            });
            notificationsSentDelta += 1;
            await addActivityEvent('notification_sent', {
              address: record.address,
              message: `digest:${toNotify.length}`,
            });
          } else {
            toNotify.forEach((msg: Email) => {
              // magicLinks[] is the validated path (http(s)-only, detector
              // hard-rejects). The legacy flat `magicLinkUrl` field was read
              // here as a fallback but is written by NOTHING in the codebase
              // - and as an unvalidated string it would have bypassed every
              // detector rule if a restored backup ever carried it. Removed.
              const magicUrl = msg.magicLinks?.[0]?.url;
              // The magic URL itself must NOT be embedded in the id: SSO/magic
              // URLs routinely approach Chrome's 500-char notification-id limit
              // on their own (worse after encodeURIComponent), which fails
              // creation with "The notification's ID should be 500 characters
              // or less". The click handler re-resolves the URL from the
              // stored message instead.
              const notificationId = magicUrl
                ? `magiclink:${msg.id}:${record.id}`
                : `email:${msg.id}:${record.id}`;
              createBrowserNotification(notificationId, {
                type: 'basic',
                iconUrl: 'icons/icon48.png',
                title: magicUrl
                  ? tSync('notifications.magicLinkTitle', { address: record.address })
                  : tSync('notifications.newEmailTitle', { address: record.address }),
                message: `${msg.from_name || tSync('notifications.unknownSender')}: ${
                  msg.subject || tSync('notifications.noSubject')
                }`,
                priority: 0,
                contextMessage: magicUrl
                  ? tSync('notifications.clickToOpenMagicLink')
                  : tSync('notifications.clickToViewEmail'),
                // Respect the soundEnabled toggle: mute the OS notification chime.
                silent: !notificationSettings.soundEnabled,
              });
            });
            notificationsSentDelta += toNotify.length;
            for (const msg of toNotify) {
              await addActivityEvent('notification_sent', {
                address: record.address,
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
        const { recordAddressMailSignals } = await import(
          '@/features/intelligence/inbox-lifecycle.js'
        );
        await recordAddressMailSignals(record.id, record.address, uniqueNewMessages);
      } catch {
        /* ignore */
      }
    }

    // Apply the tallied deltas under the analytics lock so concurrent
    // recordEmailRead / incrementAnalytic mutations aren't clobbered.
    await withLock('analytics_lock', async () => {
      const analytics = await getAnalyticsRecord();
      analytics.emailsReceived = (analytics.emailsReceived || 0) + emailsReceivedDelta;
      if (newOtpCount > 0) {
        analytics.otpsDetected = (analytics.otpsDetected || 0) + newOtpCount;
      }
      if (notificationsSentDelta > 0) {
        analytics.notificationsSent = (analytics.notificationsSent || 0) + notificationsSentDelta;
      }
      await safeStorageSet(browser, { analytics });
    });
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
    if (key === 'readEmails' || isEmailStorageBagKey(key)) {
      emailsBytes += size;
    } else if (
      key.startsWith('settings_') ||
      key === 'identities' ||
      key === 'selectedIdentityId' ||
      key === 'autoCopy' ||
      key === 'autoRenew' ||
      key === 'preExpiryWindowMinutes' ||
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
  // 0 (or any non-positive value) means "never delete" - no emails will be
  // deleted. A negative value must not fall through: it would compute a future
  // threshold and report EVERY email as due for deletion.
  if (retentionDays <= 0) {
    return { activeEmails: 0, archivedEmails: 0, totalEmails: 0 };
  }

  const { storedEmails, archivedEmails } = await getEmailMaps();

  const threshold = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let activeEmailsToDelete = 0;
  let archivedEmailsToDelete = 0;

  for (const [_address, emails] of Object.entries(storedEmails)) {
    const filteredEmails = emails.filter((email: Email & { stored_at?: number }) => {
      const emailAge = email.stored_at || toMs(email.received_at);
      return emailAge <= threshold;
    });
    activeEmailsToDelete += filteredEmails.length;
  }

  for (const [_address, emails] of Object.entries(archivedEmails)) {
    const filteredEmails = emails.filter((email: Email & { archived_at?: number }) => {
      const emailAge =
        (email as Email & { archived_at?: number }).archived_at || toMs(email.received_at);
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
    const { storedEmails, archivedEmails } = await getEmailMaps();
    for (const msgs of Object.values(storedEmails)) {
      for (const m of msgs) {
        m.otp = null;
        m.otpCandidate = null;
      }
    }
    for (const msgs of Object.values(archivedEmails)) {
      for (const m of msgs) {
        m.otp = null;
        m.otpCandidate = null;
      }
    }
    await setLogicalEmailMapsUnlockedForLockedCaller(storedEmails, archivedEmails);
    await withLock('latest_otp_lock', () => browser.storage.local.remove('latestOtp'));
  });
}

/** One email captured for a rescan pass, keyed back to its stored bag by addr+id. */
interface RescanSnapshotItem {
  addr: string;
  archived: boolean;
  id: string;
  opts: DetectOtpAndMagicOptions;
}

/**
 * Re-run OTP + magic-link detection over already-stored emails (one inbox or
 * all) using the currently selected engine - the local algorithm, or the
 * batched AI detector when AI mode is configured. Updates stored `otp` /
 * `magicLinks` / `hasMagicLink` fields in place, refreshes the `latestOtp`
 * cache when a newer code is found, and returns a summary for the caller.
 *
 * The storage lock is only held around the brief snapshot read and the result
 * merge - never around the detection pass itself (AI batch calls are slow,
 * sequential network requests, and `storeNewMessages` / cleanup queue behind
 * the same lock, so holding it across detection would stall new-mail delivery
 * for the whole scan). Emails archived/deleted mid-scan are skipped by the
 * id-keyed merge, and a concurrent writer can't be clobbered because the merge
 * re-reads current storage under the lock and applies per-id diffs.
 */
/** Remove the persisted re-scan progress marker (finished / failed / no-op). */
async function clearAiRescanProgress(): Promise<void> {
  try {
    await browser.storage.local.remove('aiRescanProgress');
  } catch (error) {
    logWarn('Failed to clear AI rescan progress marker', error);
  }
}

export async function rescanStoredEmails(
  address?: string,
  includeArchived = false
): Promise<{ scanned: number; otpsDetected: number; magicLinksDetected: number }> {
  // Phase 1 - briefly under the lock: snapshot the emails in scope.
  const snapshot = await withLock('emails_storage_lock', async () => {
    const maps = includeArchived
      ? await getEmailMaps()
      : { storedEmails: await getStoredEmailsMap(), archivedEmails: {} };
    const snap: RescanSnapshotItem[] = [];
    for (const [archived, map] of [
      [false, maps.storedEmails],
      [true, maps.archivedEmails],
    ] as const) {
      for (const [addr, msgs] of Object.entries(map)) {
        // Case-insensitive so a casing drift can't exclude the inbox from a scan.
        if (address && addr.toLowerCase() !== address.toLowerCase()) continue;
        if (!Array.isArray(msgs) || msgs.length === 0) continue;
        for (const m of msgs) {
          snap.push({
            addr,
            archived,
            id: String(m.id),
            opts: {
              subject: m.subject || '',
              bodyHtml: m.body_html || '',
              bodyPlain: m.body_plain || m.body || '',
              receivedAt: m.received_at,
              from: m.from || '',
            },
          });
        }
      }
    }
    return snap;
  });

  if (snapshot.length === 0) {
    await clearAiRescanProgress();
    return { scanned: 0, otpsDetected: 0, magicLinksDetected: 0 };
  }

  // Phase 2 - outside the lock: run detection (AI batch = slow network calls).
  // Results align with the snapshot by position. bypassCache makes the re-scan
  // genuinely re-ask the model (a cached verdict - especially a wrong "no OTP"
  // one - would otherwise be replayed forever and the action would be a no-op).
  // onProgress publishes chunk counters so the Settings UI can show progress
  // (a re-scan can take minutes in AI mode).
  const results = await detectOtpAndMagicLinksBatch(
    snapshot.map((s) => s.opts),
    {
      bypassCache: true,
      onProgress: (done, total) => {
        void browser.storage.local
          .set({ aiRescanProgress: { done, total, at: Date.now() } })
          .catch(() => {
            /* best-effort progress */
          });
      },
    }
  );
  await clearAiRescanProgress();

  // Phase 3 - re-acquire the lock to merge into the CURRENT storage.
  return withLock('emails_storage_lock', async () => {
    const { storedEmails, archivedEmails } = await getEmailMaps();
    let otpsDetected = 0;
    let magicLinksDetected = 0;
    let changed = false;

    // Group snapshot positions by address so each bag is read once.
    const indicesByBag = new Map<string, number[]>();
    snapshot.forEach((item, i) => {
      const key = JSON.stringify([item.addr, item.archived]);
      const list = indicesByBag.get(key);
      if (list) list.push(i);
      else indicesByBag.set(key, [i]);
    });

    for (const indices of indicesByBag.values()) {
      const scope = snapshot[indices[0]];
      const bag = bagForAddress(scope.archived ? archivedEmails : storedEmails, scope.addr);
      if (bag.length === 0) continue;
      const byId = new Map(bag.map((m) => [String(m.id), m]));
      for (const i of indices) {
        const item = snapshot[i];
        const m = byId.get(item.id);
        if (!m) continue; // archived / deleted while scanning - skip
        const d = results[i];
        if (!d) continue;
        const classification = classifyEmailCodes(
          m.subject,
          m.body_html || m.body_plain || m.body,
          d.otp
        );
        const detectedOtp = classification.otp;
        if (
          m.otpCandidate !== classification.otpCandidate ||
          m.couponCode !== classification.couponCode ||
          m.isReminder !== classification.isReminder ||
          m.isDeal !== classification.isDeal
        ) {
          m.otpCandidate = classification.otpCandidate;
          m.couponCode = classification.couponCode;
          m.isReminder = classification.isReminder;
          m.isDeal = classification.isDeal;
          changed = true;
        }
        if (detectedOtp !== (m.otp || null) || !!detectedOtp !== !!m.isOtp) {
          m.otp = detectedOtp;
          m.isOtp = !!detectedOtp;
          if (detectedOtp) otpsDetected += 1;
          changed = true;
        }
        const detectedLinks = d.magicLinks || [];
        const hasDetectedLinks = detectedLinks.length > 0;
        if (
          JSON.stringify(detectedLinks) !== JSON.stringify(m.magicLinks || []) ||
          hasDetectedLinks !== !!m.hasMagicLink
        ) {
          m.magicLinks = detectedLinks;
          m.hasMagicLink = hasDetectedLinks;
          if (hasDetectedLinks) magicLinksDetected += 1;
          changed = true;
        }
      }
    }

    if (changed) {
      await setLogicalEmailMapsUnlockedForLockedCaller(storedEmails, archivedEmails);
    }

    // Reconcile the cached latestOtp with the resulting bags. A rescan may
    // invalidate a previously detected code, so merely writing a newer result
    // would leave a stale cache when the scan finds no remaining OTP.
    let newestOtp: Email | undefined;
    let newestOtpAddress = '';
    for (const [addr, msgs] of Object.entries(storedEmails)) {
      for (const m of msgs) {
        if (m.otp && (!newestOtp || m.received_at > newestOtp.received_at)) {
          newestOtp = m;
          newestOtpAddress = addr;
        }
      }
    }
    // Same lock as the live-delivery M5 writer and deletion recompute. Keep
    // the cached code only when it still corresponds to a stored OTP; otherwise
    // replace it with the newest remaining result or clear it.
    await withLock('latest_otp_lock', async () => {
      const current = (await browser.storage.local.get('latestOtp')) as {
        latestOtp?: {
          otp?: string;
          received_at?: number;
          recipient?: string;
        };
      };
      const cached = current.latestOtp;
      const cachedStillStored =
        !!cached?.otp &&
        Object.entries(storedEmails).some(
          ([addr, msgs]) =>
            addr.toLowerCase() === (cached.recipient || '').toLowerCase() &&
            msgs.some((msg) => msg.otp === cached.otp && msg.received_at === cached.received_at)
        );
      const candidateIsCached =
        !!newestOtp?.otp &&
        newestOtp.otp === cached?.otp &&
        newestOtp.received_at === cached?.received_at &&
        newestOtpAddress.toLowerCase() === (cached?.recipient || '').toLowerCase();
      if (
        cachedStillStored &&
        (!newestOtp || newestOtp.received_at <= (cached?.received_at || 0))
      ) {
        return;
      }
      if (!newestOtp?.otp) {
        if (cached) await browser.storage.local.remove('latestOtp');
        return;
      }
      if (!candidateIsCached) {
        await safeStorageSet(browser, {
          latestOtp: {
            otp: newestOtp.otp,
            sender: newestOtp.from || '',
            senderName: newestOtp.from_name || '',
            context: [
              newestOtp.from_name ? `From: ${newestOtp.from_name}` : '',
              timeAgo(toMs(newestOtp.received_at)),
            ]
              .filter(Boolean)
              .join(' | '),
            received_at: newestOtp.received_at,
            recipient: newestOtpAddress,
          },
        });
      }
    });

    return { scanned: snapshot.length, otpsDetected, magicLinksDetected };
  });
}
