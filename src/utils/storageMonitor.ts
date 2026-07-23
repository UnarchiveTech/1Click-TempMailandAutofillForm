/**
 * Storage monitoring utilities for browser extension storage.
 * Tracks usage, handles approaching limits, and manages optional unlimitedStorage permission.
 */

import { browser } from 'wxt/browser';
import { STORAGE_CRITICAL_THRESHOLD, STORAGE_WARNING_THRESHOLD } from '@/utils/constants.js';
import { logDebug, logError } from '@/utils/logger.js';

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
  return navigator.userAgent.toLowerCase().includes('firefox');
}

/**
 * Ensure unlimitedStorage is available.
 * Now a required manifest permission — no optional request needed.
 */
export async function requestUnlimitedStorage(): Promise<boolean> {
  if (isFirefox()) {
    logDebug('storageMonitor: Firefox - treating storage as unlimited');
    return true;
  }

  try {
    if (await hasUnlimitedStoragePermission()) {
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
      try {
        await browser.storage.local.set({ storageQuotaWarning: false });
      } catch {
        /* ignore */
      }
    }
    return granted;
  } catch (e) {
    logError('storageMonitor: unlimitedStorage check failed', e);
    // Required permission — treat as granted on failure
    return true;
  }
}

/**
 * Check if storage usage is approaching the warning threshold (4.5MB).
 */
export async function isStorageNearLimit(): Promise<boolean> {
  const usage = await getStorageUsage();
  return usage >= STORAGE_WARNING_THRESHOLD;
}

/**
 * Check if storage usage is at the critical threshold (4.8MB).
 */
export async function isStorageCritical(): Promise<boolean> {
  const usage = await getStorageUsage();
  return usage >= STORAGE_CRITICAL_THRESHOLD;
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
  if (projectedUsage >= STORAGE_CRITICAL_THRESHOLD) {
    return { canWrite: false, shouldPromptPermission: true, currentUsage };
  }

  if (projectedUsage >= STORAGE_WARNING_THRESHOLD) {
    return { canWrite: true, shouldPromptPermission: true, currentUsage };
  }

  return { canWrite: true, shouldPromptPermission: false, currentUsage };
}

/**
 * Format bytes to a human-readable string (e.g. "4.2 MB").
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
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
    // Basic estimation: serialize the data to write
    const estimatedSize = JSON.stringify(data).length;
    const check = await beforeStorageWrite(estimatedSize);

    if (check.shouldPromptPermission) {
      await ext.storage.local.set({ storageQuotaWarning: true });
    }

    if (!check.canWrite) {
      logError('safeStorageSet: Write blocked due to storage quota limits.');
      return false;
    }

    await ext.storage.local.set(data);
    return true;
  } catch (error: unknown) {
    logError('safeStorageSet: Write failed', error);
    return false;
  }
}
