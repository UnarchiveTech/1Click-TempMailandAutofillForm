import { browser } from 'wxt/browser';

type StorageChange = {
  oldValue?: unknown;
  newValue?: unknown;
};

type StorageChanges = Record<string, StorageChange>;

export interface StorageSyncHandler {
  keys: string[];
  onChange: (changes: StorageChanges) => void | Promise<void>;
}

export function useExtensionStorageSync(handlers: StorageSyncHandler[]) {
  const listener = (changes: StorageChanges, areaName: string) => {
    if (areaName !== 'local') return;

    const changedKeys = new Set(Object.keys(changes));
    for (const handler of handlers) {
      if (handler.keys.some((key) => changedKeys.has(key))) {
        void handler.onChange(changes);
      }
    }
  };

  browser.storage.onChanged.addListener(listener);

  return () => {
    browser.storage.onChanged.removeListener(listener);
  };
}

export const SETTINGS_SYNC_KEYS = [
  'passwordSettings',
  'nameSettings',
  'autoCopy',
  'autoRenew',
  'preExpiryWindowMinutes',
  'selectedProvider',
  'customColor',
  'emailRetentionDays',
  'faviconCaching',
  // 'developerSettings' intentionally excluded - toggling developer options
  // updates local state directly and must not re-trigger loadSettings(),
  // which would cause a full settings reload and blank the settings page.
];

export const THEME_SYNC_KEYS = ['themeMode', 'contrastLevel'];
/** Toast master switch - synced via its own handler (no full settings reload). */
export const TOAST_SYNC_KEYS = ['toastsEnabled'];
// NOTE - despite the name, these are LOCAL storage-change watch keys used by
// useExtensionStorageSync() to reload UI state (e.g. loadAddresses) when local
// inbox/email keys change. They are NOT mirrored to browser.storage.sync: the
// cross-device mirror (setupStorageSyncMirror) only pushes SETTINGS_SYNC_KEYS,
// and emails stay local by design (too large / sensitive for sync quotas).
export const INBOX_SYNC_KEYS = ['addresses', 'activeAddressId', 'demoMode'];
export const IDENTITY_SYNC_KEYS = ['identities', 'selectedIdentityId'];
export const FILTER_SYNC_KEYS = ['savedSearchFilters'];
export const ANALYTICS_SYNC_KEYS = ['analytics'];
export const LOGIN_INFO_SYNC_KEYS = ['loginInfo'];
export const EMAIL_LABELS_SYNC_KEYS = ['emailLabels'];
export const STARRED_EMAILS_SYNC_KEYS = ['starredEmails'];
export const READ_EMAILS_SYNC_KEYS = ['readEmails'];
