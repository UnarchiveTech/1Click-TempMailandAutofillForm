// Static imports (not `await import()`): toastStore is already statically
// imported by ToastContainer / use-toast / AppLayout and storageMonitor by
// the settings graph, so dynamic imports here cannot defer loading - they
// only emit INEFFECTIVE_DYNAMIC_IMPORT build warnings.
import { showToast } from '@/ui/blocks/layout/use-toast.js';
import { logError } from '@/utils/logger.js';
import { getStoredEmailsMap } from '@/utils/storage/storage-keys.js';
import { requestUnlimitedStorage } from '@/utils/storage/storageMonitor.js';
import { toMs } from '@/utils/time/time.js';
import type { Email } from '@/utils/types.js';
import { toastStore } from '@/utils/ui/toastStore.js';

export interface RetentionCleanupState {
  oldEmailCount: number;
  retentionCleanupDismissed: boolean;
}

export function createRetentionCleanup(
  ext: Browser,
  onStateChange: (patch: Partial<RetentionCleanupState>) => void,
  getTranslation: (key: string, vars?: Record<string, string | number>) => string,
  reloadAddresses: () => Promise<void>
) {
  async function checkRetentionCleanup(
    storedEmailsOverride?: Record<string, Email[]>
  ): Promise<void> {
    try {
      const { emailRetentionDays = 30 } = (await ext.storage.local.get(['emailRetentionDays'])) as {
        emailRetentionDays?: number;
      };
      const storedEmails = storedEmailsOverride ?? (await getStoredEmailsMap());
      if (emailRetentionDays <= 0) return;
      const threshold = Date.now() - emailRetentionDays * 24 * 60 * 60 * 1000;
      let count = 0;
      for (const msgs of Object.values(storedEmails ?? {})) {
        // A malformed bag (legacy import / partial write) must not crash the UI.
        if (!Array.isArray(msgs)) continue;
        for (const m of msgs) {
          const ts = m?.stored_at || toMs(m?.received_at);
          if (ts < threshold) count++;
        }
      }
      onStateChange({ oldEmailCount: count });
    } catch (error) {
      logError('Failed to compute retention cleanup count', error);
    }
  }

  function dismissRetentionCleanup() {
    onStateChange({ retentionCleanupDismissed: true });
  }

  async function cleanupOldEmailsNow() {
    try {
      const { emailRetentionDays = 30 } = (await ext.storage.local.get(['emailRetentionDays'])) as {
        emailRetentionDays?: number;
      };
      // "Never delete" (0 / non-positive) must never reach the background as a
      // cleanup request - the banner is already suppressed for it, but a stale
      // click (or a corrupted record) must not wipe mail the user asked to keep.
      if (!(emailRetentionDays > 0)) return;
      const response = await ext.runtime.sendMessage({
        type: 'cleanupOldStoredEmails',
        activeRetentionDays: emailRetentionDays,
        archivedRetentionDays: emailRetentionDays * 3,
      });
      if (!response?.success) {
        // Rejected (e.g. still running / storage error) - never dismiss the
        // banner or claim the cleanup ran.
        showToast(getTranslation('inbox.retentionCleanupFailed'), 'error');
        return;
      }
      onStateChange({ retentionCleanupDismissed: true, oldEmailCount: 0 });
      await reloadAddresses();
      showToast(getTranslation('inbox.retentionCleanupDone'));
    } catch (error) {
      logError('Failed to clean up old emails', error);
      showToast(getTranslation('inbox.retentionCleanupFailed'), 'error');
    }
  }

  async function handleRequestQuotaUnlimitedStorage() {
    try {
      const granted = await requestUnlimitedStorage();
      if (granted) {
        toastStore.success(getTranslation('settings.unlimitedStorageGranted'));
        // showQuotaBanner handled by caller
        await ext.storage.local.remove('storageQuotaWarning');
      } else {
        toastStore.error(getTranslation('settings.unlimitedStorageDenied'));
      }
    } catch (err) {
      logError('Failed to request unlimited storage', err);
      toastStore.error(getTranslation('toasts.operationFailed'));
    }
  }

  function dismissQuotaBanner() {
    // showQuotaBanner handled by caller
    void ext.storage.local.remove('storageQuotaWarning');
  }

  return {
    checkRetentionCleanup,
    dismissRetentionCleanup,
    cleanupOldEmailsNow,
    handleRequestQuotaUnlimitedStorage,
    dismissQuotaBanner,
  };
}
