/**
 * User-configurable clipboard auto-purge (visible privacy control).
 */

import { browser } from 'wxt/browser';
import { writeWithRetry } from '@/utils/storage/storage-write.js';

export interface ClipboardPrivacySettings {
  /** Auto-clear clipboard after copy of OTP / sensitive values */
  autoPurgeEnabled: boolean;
  /** Purge delay in seconds (5-300) */
  purgeAfterSeconds: number;
}

export const DEFAULT_CLIPBOARD_PRIVACY: ClipboardPrivacySettings = {
  autoPurgeEnabled: true,
  purgeAfterSeconds: 30,
};

const KEY = 'clipboardPrivacy';

export function normalizeClipboardPrivacy(value: unknown): ClipboardPrivacySettings {
  const raw =
    value && typeof value === 'object' ? (value as Partial<ClipboardPrivacySettings>) : {};
  const seconds = Number(raw.purgeAfterSeconds);
  return {
    autoPurgeEnabled: raw.autoPurgeEnabled !== false,
    purgeAfterSeconds:
      Number.isFinite(seconds) && seconds >= 5 && seconds <= 300
        ? Math.round(seconds)
        : DEFAULT_CLIPBOARD_PRIVACY.purgeAfterSeconds,
  };
}

export async function loadClipboardPrivacy(): Promise<ClipboardPrivacySettings> {
  try {
    const res = (await browser.storage.local.get([KEY])) as {
      clipboardPrivacy?: Partial<ClipboardPrivacySettings>;
    };
    return normalizeClipboardPrivacy(res.clipboardPrivacy);
  } catch {
    /* ignore */
    return { ...DEFAULT_CLIPBOARD_PRIVACY };
  }
}

export async function saveClipboardPrivacy(settings: ClipboardPrivacySettings): Promise<void> {
  await writeWithRetry({
    [KEY]: {
      autoPurgeEnabled: !!settings.autoPurgeEnabled,
      purgeAfterSeconds: Math.max(5, Math.min(300, Math.round(settings.purgeAfterSeconds || 30))),
    },
  });
}

export function purgeDurationMs(settings: ClipboardPrivacySettings): number {
  if (!settings.autoPurgeEnabled) return 0; // 0 = no purge
  return settings.purgeAfterSeconds * 1000;
}
