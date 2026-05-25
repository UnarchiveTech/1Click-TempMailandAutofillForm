/**
 * Storage monitoring utilities for browser extension storage.
 * Tracks usage, handles approaching limits, and manages optional unlimitedStorage permission.
 */

import { browser } from 'wxt/browser';
import {
  STORAGE_CRITICAL_THRESHOLD,
  STORAGE_LIMIT,
  STORAGE_WARNING_THRESHOLD,
} from '@/utils/constants.js';
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
 * Check if the unlimitedStorage optional permission is currently granted.
 */
export async function hasUnlimitedStoragePermission(): Promise<boolean> {
  try {
    return await browser.permissions.contains({ permissions: ['unlimitedStorage'] });
  } catch {
    return false;
  }
}

/**
 * Detect if the current browser is Firefox.
 * Firefox does not support the unlimitedStorage permission.
 */
export function isFirefox(): boolean {
  return navigator.userAgent.toLowerCase().includes('firefox');
}

/**
 * Request the unlimitedStorage optional permission from the user.
 * Skips the request on Firefox (not supported) and returns false.
 * Must be called from a user gesture context (e.g., button click).
 */
export async function requestUnlimitedStorage(): Promise<boolean> {
  if (isFirefox()) {
    logDebug('storageMonitor: Firefox detected — unlimitedStorage not supported, skipping request');
    return false;
  }

  try {
    const granted = await browser.permissions.request({ permissions: ['unlimitedStorage'] });
    if (granted) {
      logDebug('storageMonitor: unlimitedStorage permission granted');
    } else {
      logDebug('storageMonitor: unlimitedStorage permission denied by user');
    }
    return granted;
  } catch (e) {
    logError('storageMonitor: failed to request unlimitedStorage permission', e);
    return false;
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

  if (projectedUsage >= STORAGE_LIMIT) {
    return { canWrite: false, shouldPromptPermission: true, currentUsage };
  }

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
