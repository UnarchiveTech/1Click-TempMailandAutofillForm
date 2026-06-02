import type { Browser } from 'wxt/browser';
import { logError } from '@/utils/logger.js';
import type { CredentialsHistoryItem } from '@/utils/types.js';

export interface LoginState {
  savedLogins: CredentialsHistoryItem[];
}

export interface LoginSetters {
  setSavedLogins: (
    v: CredentialsHistoryItem[] | ((prev: CredentialsHistoryItem[]) => CredentialsHistoryItem[])
  ) => void;
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

export async function deleteLoginById(
  ext: Browser,
  setters: LoginSetters,
  id: string
): Promise<void> {
  try {
    const result = (await ext.storage.local.get(['loginInfo'])) as {
      loginInfo?: CredentialsHistoryItem[];
    };
    const loginInfo = result.loginInfo || [];

    const targetIndex = loginInfo.findIndex((item, i) => {
      const candidateId = `${item.domain}-${item.username || 'unknown'}-${i}`;
      return candidateId === id;
    });

    if (targetIndex === -1) {
      setters.setSavedLogins((prev) => prev.filter((l) => l.id !== id));
      return;
    }

    const next = loginInfo.filter((_, i) => i !== targetIndex);
    await ext.storage.local.set({ loginInfo: next });

    const reloaded = next.map((item, i) => ({
      ...item,
      id: `${item.domain}-${item.username || 'unknown'}-${i}`,
    }));
    setters.setSavedLogins(reloaded);
  } catch (e: unknown) {
    logError('deleteLoginById error:', undefined, e instanceof Error ? e : new Error(String(e)));
  }
}

export async function reorderLoginInfo(
  ext: Browser,
  setters: LoginSetters,
  fromIndex: number,
  toIndex: number
): Promise<void> {
  if (fromIndex === toIndex) return;
  try {
    const result = (await ext.storage.local.get(['loginInfo'])) as {
      loginInfo?: CredentialsHistoryItem[];
    };
    const loginInfo = result.loginInfo || [];
    if (fromIndex < 0 || fromIndex >= loginInfo.length) return;
    if (toIndex < 0 || toIndex >= loginInfo.length) return;

    const next = [...loginInfo];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);

    await ext.storage.local.set({ loginInfo: next });

    const reloaded = next.map((item, i) => ({
      ...item,
      id: `${item.domain}-${item.username || 'unknown'}-${i}`,
    }));
    setters.setSavedLogins(reloaded);
  } catch (e: unknown) {
    logError('reorderLoginInfo error:', undefined, e instanceof Error ? e : new Error(String(e)));
  }
}
