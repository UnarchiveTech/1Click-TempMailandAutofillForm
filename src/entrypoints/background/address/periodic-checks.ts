import { browser } from 'wxt/browser';
import { purgePromotionalEmailsOlderThan24Hours } from '@/features/address/promotional-email-detector.js';
import {
  processDueArchiveSchedules,
  SITE_RULE_ARCHIVE_ALARM,
  scheduleNextArchiveAlarm,
} from '@/features/intelligence/site-rules.js';
import { isLive } from '@/utils/address/address-status.js';
import { CONSTANTS } from '@/utils/constants.js';
import { providerConfigsReady } from '@/utils/email/email-service.js';
import { log, logDebug, logError } from '@/utils/logger.js';
import { withAddressLock } from '@/utils/mutex.js';
import { runStorageHygiene } from '@/utils/storage/storage-hygiene.js';
import {
  getAddresses,
  getAutoRefreshInterval,
  getEmailRetentionDays,
  setAddresses,
} from '@/utils/storage/storage-keys.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import type { Address, AddressStatus, Alarm, Email, EmailFilters } from '@/utils/types.js';
import { cleanupOldStoredEmails, storeNewMessages } from './email-storage.js';

const EMAIL_POLLING_ALARM = 'checkEmails';
const EMAIL_POLLING_BASE_DEADLINE_KEY = 'emailPollingBaseDeadline';
const EMAIL_POLLING_BACKOFF_KEY = 'emailPollingBackoff';
const EMAIL_POLLING_MIN_DELAY_MS = 1000;

type PollingRetry = { count: number; nextRetryAt: number };
type PollingBackoffState = Record<string, PollingRetry>;

async function readPollingBackoff(): Promise<PollingBackoffState> {
  const result = (await browser.storage.local.get([EMAIL_POLLING_BACKOFF_KEY])) as {
    emailPollingBackoff?: unknown;
  };
  const value = result.emailPollingBackoff;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const valid: PollingBackoffState = {};
  for (const [id, retry] of Object.entries(value as Record<string, unknown>)) {
    if (!retry || typeof retry !== 'object') continue;
    const candidate = retry as { count?: unknown; nextRetryAt?: unknown };
    if (
      typeof candidate.count === 'number' &&
      Number.isFinite(candidate.count) &&
      typeof candidate.nextRetryAt === 'number' &&
      Number.isFinite(candidate.nextRetryAt)
    ) {
      valid[id] = {
        count: Math.max(1, Math.floor(candidate.count)),
        nextRetryAt: candidate.nextRetryAt,
      };
    }
  }
  return valid;
}

async function writePollingBackoff(backoff: PollingBackoffState): Promise<void> {
  await writeWithRetry({ [EMAIL_POLLING_BACKOFF_KEY]: backoff });
}

/** Schedule one shared one-shot at the next normal poll or retry deadline. */
export async function scheduleNextEmailPollingAlarm(): Promise<number | null> {
  const intervalMs = await getAutoRefreshInterval();
  const existing = await browser.alarms.get(EMAIL_POLLING_ALARM);
  if (intervalMs === 0) {
    if (existing) await browser.alarms.clear(EMAIL_POLLING_ALARM);
    return null;
  }

  const now = Date.now();
  const stored = (await browser.storage.local.get([EMAIL_POLLING_BASE_DEADLINE_KEY])) as {
    emailPollingBaseDeadline?: unknown;
  };
  const baseDeadline =
    typeof stored.emailPollingBaseDeadline === 'number' &&
    Number.isFinite(stored.emailPollingBaseDeadline) &&
    stored.emailPollingBaseDeadline > now
      ? stored.emailPollingBaseDeadline
      : now + intervalMs;
  const { addresses = [] } = (await browser.storage.local.get(['addresses'])) as {
    addresses?: Array<{ id?: string; accountStatus?: AddressStatus; expiresAt?: number }>;
  };
  const liveIds = new Set(
    addresses
      .filter(
        (address) => address.accountStatus !== 'archived' && address.accountStatus !== 'deleted'
      )
      .filter((address) => typeof address.expiresAt !== 'number' || address.expiresAt > now)
      .map((address) => address.id)
      .filter((id): id is string => Boolean(id))
  );
  const backoff = await readPollingBackoff();
  const retryDeadlines = Object.entries(backoff)
    .filter(([id]) => liveIds.has(id))
    .map(([, retry]) => retry.nextRetryAt)
    .filter((deadline) => Number.isFinite(deadline));
  const retryDeadline = retryDeadlines.reduce<number | null>(
    (earliest, deadline) => (earliest === null ? deadline : Math.min(earliest, deadline)),
    null
  );
  const deadline =
    retryDeadline !== null && retryDeadline <= now
      ? now + EMAIL_POLLING_MIN_DELAY_MS
      : retryDeadline === null
        ? baseDeadline
        : Math.min(baseDeadline, retryDeadline);
  if (baseDeadline !== stored.emailPollingBaseDeadline) {
    await writeWithRetry({ [EMAIL_POLLING_BASE_DEADLINE_KEY]: baseDeadline });
  }
  if (liveIds.size === 0) {
    if (existing) await browser.alarms.clear(EMAIL_POLLING_ALARM);
    return null;
  }
  if (
    existing &&
    existing.periodInMinutes === undefined &&
    Math.abs((existing.scheduledTime ?? 0) - deadline) < 1000
  ) {
    return deadline;
  }
  if (existing) await browser.alarms.clear(EMAIL_POLLING_ALARM);
  await browser.alarms.create(EMAIL_POLLING_ALARM, { when: deadline });
  return deadline;
}

export async function updateRefreshAlarm(intervalMs: number): Promise<void> {
  if (!Number.isFinite(intervalMs) || intervalMs < 0 || intervalMs > 3_600_000) {
    throw new Error('Refresh interval must be between 0 and 1hr');
  }
  await browser.alarms.clear(EMAIL_POLLING_ALARM);
  if (intervalMs === 0) {
    await browser.storage.local.remove(EMAIL_POLLING_BASE_DEADLINE_KEY);
    return;
  }
  const normalized = Math.max(10_000, intervalMs);
  await writeWithRetry({
    [EMAIL_POLLING_BASE_DEADLINE_KEY]: Date.now() + normalized,
  });
  await scheduleNextEmailPollingAlarm();
}

let registeredCheckFn: ((addressId: string, filters: EmailFilters) => Promise<Email[]>) | null =
  null;

// Module-scope singleton: setupPeriodicEmailCheck re-runs on hardReset, and a
// per-call closure added here would stack a duplicate storage listener on
// every re-registration (each one re-firing the reschedule on every
// addresses/interval change). The handler only calls module functions, so one
// registration serves all generations.
let pollingStorageListenerRegistered = false;
const onPollingStorageChange = (changes: Record<string, { newValue?: unknown }>, area: string) => {
  if (
    area === 'local' &&
    (changes.addresses || changes.autoRefreshInterval || changes.emailPollingBackoff)
  ) {
    void scheduleNextEmailPollingAlarm().catch((error) =>
      logError(
        'Failed to reschedule email polling:',
        undefined,
        error instanceof Error ? error : new Error(String(error))
      )
    );
  }
};

export function setupPeriodicEmailCheck(
  checkNewEmailsFn: (addressId: string, filters: EmailFilters) => Promise<Email[]>
): void {
  registeredCheckFn = checkNewEmailsFn;
  if (CONSTANTS.DEBUG) log('=== SETTING UP PERIODIC EMAIL CHECK ===');

  if (!pollingStorageListenerRegistered) {
    pollingStorageListenerRegistered = true;
    browser.storage.onChanged.addListener(onPollingStorageChange);
  }

  (async () => {
    try {
      const intervalMs = await getAutoRefreshInterval();
      // Auto-archive is independent of email polling and must still run when
      // the user disables automatic refresh.
      await scheduleNextArchiveAlarm();
      if (intervalMs > 0) {
        await scheduleNextEmailPollingAlarm();
      } else {
        await browser.alarms.clear(EMAIL_POLLING_ALARM);
      }
      const cleanupAlarm = await browser.alarms.get('cleanupStoredEmails');
      if (!cleanupAlarm) {
        if (CONSTANTS.DEBUG) log('Creating periodic alarm cleanupStoredEmails (interval: 360 min)');
        await browser.alarms.create('cleanupStoredEmails', {
          periodInMinutes: 360,
          delayInMinutes: 5,
        });
      }
    } catch (e) {
      logError(
        'Failed to create periodic alarms:',
        undefined,
        e instanceof Error ? e : new Error(String(e))
      );
    }
  })().catch(() => {
    /* ignore in test environments */
  });

  if (CONSTANTS.DEBUG) log('=== ALARMS CREATED ===');
}

/**
 * Put the selected address first, then walk outward through the current address
 * order. This makes the user's active mailbox and its Previous/Next neighbors
 * refresh before distant mailboxes while preserving a deterministic fair order.
 */
export function prioritizeAddresses(addresses: Address[], activeAddressId?: string): Address[] {
  if (!activeAddressId) return [...addresses];
  const activeIndex = addresses.findIndex((address) => address.id === activeAddressId);
  if (activeIndex < 0) return [...addresses];

  const ordered: Address[] = [addresses[activeIndex]];
  for (let distance = 1; distance < addresses.length; distance += 1) {
    const previous = addresses[activeIndex - distance];
    const next = addresses[activeIndex + distance];
    if (previous) ordered.push(previous);
    if (next) ordered.push(next);
  }
  return ordered;
}

let isCheckRunning = false;
const pollingFailures = new Map<string, PollingRetry>();
const POLLING_BACKOFF_BASE_MS = 30_000;
const POLLING_BACKOFF_MAX_MS = 15 * 60_000;

try {
  browser.alarms?.onAlarm?.addListener(async (alarm: Alarm) => {
    if (CONSTANTS.DEBUG) logDebug(`=== ALARM FIRED: ${alarm.name} ===`);

    if (alarm.name === SITE_RULE_ARCHIVE_ALARM) {
      try {
        await processDueArchiveSchedules(async (due) => {
          // Serialize the address update with creation, renewal, and other
          // archive operations so a read-modify-write cannot lose changes.
          await withAddressLock(async () => {
            const dueIds = new Set(due);
            const addresses = await getAddresses();
            let changed = false;
            const next = addresses.map((address) => {
              if (!dueIds.has(address.id) || address.accountStatus === 'deleted') {
                return address;
              }
              if (address.accountStatus === 'archived') return address;
              changed = true;
              return {
                ...address,
                accountStatus: 'archived' as const,
                archiveReason: 'scheduled' as const,
                archivedAt: Math.max(Date.now(), (address.archivedAt ?? 0) + 1),
                autoExtend: false,
              };
            });
            if (changed) await setAddresses(next);
          });
        });
      } catch (error) {
        logError(
          'Failed to process scheduled address archives:',
          undefined,
          error instanceof Error ? error : new Error(String(error))
        );
        // Keep retrying after a transient failure without waiting for a worker
        // restart. The schedule entry remains stored when processing fails.
        await scheduleNextArchiveAlarm().catch((scheduleError) =>
          logError(
            'Failed to reschedule address archive alarm:',
            undefined,
            scheduleError instanceof Error ? scheduleError : new Error(String(scheduleError))
          )
        );
      }
      return;
    }

    if (alarm.name === EMAIL_POLLING_ALARM) {
      // Wait for user provider overrides before any provider-dependent work.
      // Archive processing above does not need provider configuration.
      await providerConfigsReady;
      if (isCheckRunning) return;
      isCheckRunning = true;
      try {
        if (!registeredCheckFn) return;
        const intervalMs = await getAutoRefreshInterval();
        if (intervalMs === 0) {
          await browser.alarms.clear(EMAIL_POLLING_ALARM);
          return;
        }
        const now = Date.now();
        const backoff = await readPollingBackoff();
        pollingFailures.clear();
        for (const [id, retry] of Object.entries(backoff)) pollingFailures.set(id, retry);
        const baseState = (await browser.storage.local.get([EMAIL_POLLING_BASE_DEADLINE_KEY])) as {
          emailPollingBaseDeadline?: unknown;
        };
        const baseDue =
          typeof baseState.emailPollingBaseDeadline !== 'number' ||
          baseState.emailPollingBaseDeadline <= now;
        if (baseDue) {
          await writeWithRetry({
            [EMAIL_POLLING_BASE_DEADLINE_KEY]: now + intervalMs,
          });
        }
        if (CONSTANTS.DEBUG) log('=== PERIODIC EMAIL CHECK STARTED ===');
        const addresses = await getAddresses();
        const activeAddresses = addresses.filter((i) => isLive(i));

        if (activeAddresses.length === 0) {
          if (CONSTANTS.DEBUG) log('No active addresses, skipping periodic email check');
          await writePollingBackoff({});
          return;
        }

        const { activeAddressId } = (await browser.storage.local.get(['activeAddressId'])) as {
          activeAddressId?: string;
        };
        const prioritizedAddresses = prioritizeAddresses(activeAddresses, activeAddressId);

        const checkAddress = async (record: Address) => {
          const retry = pollingFailures.get(record.id);
          if (retry && retry.nextRetryAt > Date.now()) return;
          try {
            if (CONSTANTS.DEBUG) log(`Checking emails for address: ${record.address}`);

            if (!registeredCheckFn) return;
            const messages = await registeredCheckFn(record.id, {});
            pollingFailures.delete(record.id);
            if (CONSTANTS.DEBUG) log(`Fetched ${messages.length} messages for ${record.address}`);

            // Store fetched emails so UI can read them from storage
            if (messages.length > 0) {
              await storeNewMessages(record.address, messages);
              if (CONSTANTS.DEBUG) log(`Stored ${messages.length} messages for ${record.address}`);
            }
          } catch (error: unknown) {
            const previous = pollingFailures.get(record.id)?.count ?? 0;
            const count = previous + 1;
            const delay = Math.min(
              POLLING_BACKOFF_BASE_MS * 2 ** (count - 1),
              POLLING_BACKOFF_MAX_MS
            );
            pollingFailures.set(record.id, { count, nextRetryAt: Date.now() + delay });
            logError(
              `Error checking emails for ${record.address}:`,
              undefined,
              error instanceof Error ? error : new Error(String(error))
            );
          }
        };

        // Refresh the active address alone first. The remaining addresses use a
        // concurrency limit of three, so the active mailbox is never queued
        // behind unrelated mailboxes and the provider load remains bounded.
        const dueRetries = new Set(
          prioritizedAddresses
            .filter((record) => {
              const retry = pollingFailures.get(record.id);
              return retry && retry.nextRetryAt <= now;
            })
            .map((record) => record.id)
        );
        const candidates = baseDue
          ? prioritizedAddresses
          : prioritizedAddresses.filter((record) => dueRetries.has(record.id));
        const [priorityAddress, ...backgroundAddresses] = candidates;
        if (priorityAddress) await checkAddress(priorityAddress);

        // Process neighbors before distant addresses; Promise.allSettled keeps
        // one provider failure from stopping the rest of the background queue.
        const concurrency = 3;
        for (let i = 0; i < backgroundAddresses.length; i += concurrency) {
          const chunk = backgroundAddresses.slice(i, i + concurrency);
          await Promise.allSettled(chunk.map(checkAddress));
        }

        await writePollingBackoff(Object.fromEntries(pollingFailures));
        if (CONSTANTS.DEBUG) log('=== PERIODIC EMAIL CHECK COMPLETED ===');
      } catch (error: unknown) {
        await writePollingBackoff(Object.fromEntries(pollingFailures)).catch((writeError) =>
          logError(
            'Failed to persist email polling backoff:',
            undefined,
            writeError instanceof Error ? writeError : new Error(String(writeError))
          )
        );
        logError(
          'Error in periodic email check:',
          undefined,
          error instanceof Error ? error : new Error(String(error))
        );
      } finally {
        isCheckRunning = false;
        void scheduleNextEmailPollingAlarm().catch((error) =>
          logError(
            'Failed to schedule next email polling deadline:',
            undefined,
            error instanceof Error ? error : new Error(String(error))
          )
        );
      }
    } else if (alarm.name === 'cleanupStoredEmails') {
      try {
        const emailRetentionDays = await getEmailRetentionDays();
        await cleanupOldStoredEmails(emailRetentionDays, emailRetentionDays * 3); // Archived retention is 3x active retention
        // Auto-delete promotional emails older than 24h if enabled
        try {
          await purgePromotionalEmailsOlderThan24Hours(browser);
        } catch {
          /* optional */
        }
        // Cap bags / favicons / oversized avatars (quota hygiene)
        try {
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
} catch {
  /* ignore in test environments */
}
