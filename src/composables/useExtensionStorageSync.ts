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
  'selectedProvider',
  'customColor',
  'developerSettings',
  'emailRetentionDays',
  'faviconCaching',
];

export const THEME_SYNC_KEYS = ['themeMode', 'contrastLevel'];
export const INBOX_SYNC_KEYS = ['inboxes', 'activeInboxId'];
export const IDENTITY_SYNC_KEYS = ['identities', 'selectedIdentityId'];
export const FILTER_SYNC_KEYS = ['savedSearchFilters'];
export const ANALYTICS_SYNC_KEYS = ['analytics'];
export const LOGIN_INFO_SYNC_KEYS = ['loginInfo'];
export const EMAIL_TAGS_SYNC_KEYS = ['emailTags'];
export const STARRED_EMAILS_SYNC_KEYS = ['starredEmails'];
export const READ_EMAILS_SYNC_KEYS = ['readEmails'];
