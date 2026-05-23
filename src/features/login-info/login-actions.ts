import type { Browser } from 'wxt/browser';
import { logError } from '@/utils/logger.js';
import type { CredentialsHistoryItem } from '@/utils/types.js';

export interface LoginState {
  savedLogins: CredentialsHistoryItem[];
}

export interface LoginSetters {
  setSavedLogins: (logins: CredentialsHistoryItem[]) => void;
}

export async function loadLoginInfo(ext: Browser, setters: LoginSetters) {
  try {
    const result = (await ext.storage.local.get(['loginInfo'])) as {
      loginInfo?: CredentialsHistoryItem[];
    };
    const loginInfo = result.loginInfo || [];
    // Add id field for each login item
    const savedLogins = loginInfo.map((item, i) => ({
      ...item,
      id: `${item.domain}-${item.username || 'unknown'}-${i}`,
    }));
    setters.setSavedLogins(savedLogins);
  } catch (e: unknown) {
    logError('loadLoginInfo error:', undefined, e instanceof Error ? e : new Error(String(e)));
  }
}
