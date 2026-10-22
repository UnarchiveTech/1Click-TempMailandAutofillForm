/**
 * Storage monitoring utilities for browser extension storage.
 * Tracks usage, handles approaching limits, and manages optional unlimitedStorage permission.
 */

import { browser } from 'wxt/browser';
import { CONSTANTS } from '@/utils/constants.js';
import { tSync } from '@/utils/i18n/i18n-background.js';
import { logDebug, logError, logWarn } from '@/utils/logger.js';
import { writeWithRetry } from './storage-write.js';

/**
 * Get current browser.storage.local usage in bytes.
 * Returns 0 if unavailable.
 */
export async function getStorageUsage(): Promise<number> {
  try {
    const bytes = await browser.storage.local.getBytesInUse();
    return bytes;
  } catch (e) {
    logError('storageMonitor: failed to get storage usage', e);
    return 0;
  }
}

/**
 * Check if unlimitedStorage is available.
 * Declared as a required permission in the manifest (Chrome rejects it as optional).
 */
export async function hasUnlimitedStoragePermission(): Promise<boolean> {
  if (isFirefox()) return true;
  try {
    return await browser.permissions.contains({ permissions: ['unlimitedStorage'] });
  } catch {
    // Required permission is always present once installed
    return true;
  }
}

/**
 * Detect if the current browser is Firefox.
 * Firefox does not use the unlimitedStorage permission (large quota by default).
 */
export function isFirefox(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('firefox');
}

/**
 * Ensure unlimitedStorage is available.
 * Now a required manifest permission - no optional request needed.
 */
export async function requestUnlimitedStorage(): Promise<boolean> {
  if (isFirefox()) {
    logDebug('storageMonitor: Firefox - treating storage as unlimited');
    return true;
  }

  try {
    if (await hasUnlimitedStoragePermission()) {
      // Deliberately NOT the retry wrapper: this flag is cosmetic, the permission
      // answer is already decided, and backing off here would only delay it.
      try {
        await browser.storage.local.set({ storageQuotaWarning: false });
      } catch {
        /* ignore */
      }
      return true;
    }
    // Fallback: try request if somehow not granted (legacy installs)
    const granted = await browser.permissions.request({ permissions: ['unlimitedStorage'] });
    if (granted) {
      logDebug('storageMonitor: unlimitedStorage permission granted');
      // Best-effort flag write, same as the branch above (see the note there).
      try {
        await browser.storage.local.set({ storageQuotaWarning: false });
      } catch {
        /* ignore */
      }
    }
    return granted;
  } catch (e) {
    logError('storageMonitor: unlimitedStorage check failed', e);
    // Required permission - treat as granted on failure
    return true;
  }
}

/**
 * Check if storage usage is approaching the warning threshold (4.5MB).
 */
export async function isStorageNearLimit(): Promise<boolean> {
  const usage = await getStorageUsage();
  return usage >= CONSTANTS.STORAGE_WARNING_THRESHOLD;
}

/**
 * Check if storage usage is at the critical threshold (4.8MB).
 */
export async function isStorageCritical(): Promise<boolean> {
  const usage = await getStorageUsage();
  return usage >= CONSTANTS.STORAGE_CRITICAL_THRESHOLD;
}

/**
 * Result from beforeStorageWrite check.
 */
export interface StorageWriteCheck {
  /** Whether the write should proceed normally */
  canWrite: boolean;
  /** Whether the caller should prompt the user to grant unlimitedStorage */
  shouldPromptPermission: boolean;
  /** Current bytes in use */
  currentUsage: number;
}

/**
 * Check storage state before a write operation.
 * @param estimatedWriteSize Estimated size in bytes of data about to be written.
 * Returns guidance on whether to proceed, fallback, or prompt the user.
 */
export async function beforeStorageWrite(estimatedWriteSize = 0): Promise<StorageWriteCheck> {
  const currentUsage = await getStorageUsage();
  const projectedUsage = currentUsage + estimatedWriteSize;

  if (await hasUnlimitedStoragePermission()) {
    return { canWrite: true, shouldPromptPermission: false, currentUsage };
  }

  // Critical threshold (4.8 MB) is always hit before the hard 5 MB limit,
  // so the limit check is subsumed here.
  if (projectedUsage >= CONSTANTS.STORAGE_CRITICAL_THRESHOLD) {
    return { canWrite: false, shouldPromptPermission: true, currentUsage };
  }

  if (projectedUsage >= CONSTANTS.STORAGE_WARNING_THRESHOLD) {
    return { canWrite: true, shouldPromptPermission: true, currentUsage };
  }

  return { canWrite: true, shouldPromptPermission: false, currentUsage };
}

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = BYTES_PER_KB * 1024;
const BYTES_PER_GB = BYTES_PER_MB * 1024;

/**
 * Format bytes to a human-readable, LOCALIZED string (e.g. "4.2 MB" / ja
 * "4.2 MB", fr "4,2 Mo" style unit labels). This is the single home of the
 * byte formatter - backup-actions re-exports it so the UI can't drift between
 * two hand-rolled copies with different rounding. Units come from the
 * preferences.storage* locale keys instead of hardcoded English.
 *
 * Tiers (1024-based, matching the KB/MB/GB labels the locale keys render):
 *   < 1 KB   → integer bytes
 *   < 1 MB   → 1 decimal  (no caller shows sub-KB storage, so this stays
 *                          lossless-enough without adding a decimal)
 *   < 1 GB   → 2 decimals
 *   >= 1 GB  → 2 decimals (import-backup files routinely exceed 1 GiB, which
 *                          previously rendered as an unwieldy "3072.00 MB")
 * Values just under a boundary round UP into the lower tier's label (e.g.
 * 1 MiB - 1 byte → "1024.0 KB") - intentional and consistent: the number is
 * correct for its unit, only the tier label is conservative.
 */
export function formatBytes(bytes: number): string {
  if (bytes < BYTES_PER_KB) return tSync('preferences.storageBytes', { n: bytes });
  if (bytes < BYTES_PER_MB) {
    return tSync('preferences.storageKilobytes', { n: (bytes / BYTES_PER_KB).toFixed(1) });
  }
  if (bytes < BYTES_PER_GB) {
    return tSync('preferences.storageMegabytes', { n: (bytes / BYTES_PER_MB).toFixed(2) });
  }
  return tSync('preferences.storageGigabytes', { n: (bytes / BYTES_PER_GB).toFixed(2) });
}

/**
 * Safe wrapper for browser.storage.local.set that checks quota limits.
 * Sets the 'storageQuotaWarning' flag if approaching or exceeding limit.
 */
export async function safeStorageSet(
  ext: typeof browser,
  data: Record<string, unknown>
): Promise<boolean> {
  try {
    const hasUnlimited = await hasUnlimitedStoragePermission();
    if (!hasUnlimited) {
      let estimatedSize = 0;
      try {
        estimatedSize = new TextEncoder().encode(JSON.stringify(data)).byteLength;
      } catch (err) {
        logError('safeStorageSet: Could not stringify data for size estimation', err);
        // If the size cannot be determined, fail closed for quota estimation.
        estimatedSize = Number.MAX_SAFE_INTEGER;
      }
      const check = await beforeStorageWrite(estimatedSize);

      if (check.shouldPromptPermission) {
        await writeWithRetry({ storageQuotaWarning: true }, { area: ext.storage.local });
      }

      if (!check.canWrite) {
        logError('safeStorageSet: Write blocked due to storage quota limits.');
        return false;
      }
    }

    await writeWithRetry(data, {
      area: ext.storage.local,
      onRetry: ({ attempt, attempts, delayMs, kind }) =>
        logWarn('safeStorageSet: retrying write after a transient storage failure', {
          attempt,
          attempts,
          delayMs,
          kind,
        }),
    });
    return true;
  } catch (error: unknown) {
    // A transient hiccup has already survived the retry budget by now; a
    // permanent one (per-item quota, invalidated context) never had a chance.
    // Either way the caller's failure contract is unchanged - it just no longer
    // fires for a write that succeeded on the second attempt.
    logError('safeStorageSet: Write failed', error);
    return false;
  }
}
