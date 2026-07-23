import type { Browser } from 'wxt/browser';
import { decryptCredentials } from '@/features/login-info/login-crypto.js';
import { logError } from '@/utils/logger.js';
import { withLock } from '@/utils/mutex.js';
import type { CredentialsHistoryItem } from '@/utils/types.js';

export interface LoginState {
  savedLogins: CredentialsHistoryItem[];
}

export interface LoginSetters {
  setSavedLogins: (
    v: CredentialsHistoryItem[] | ((prev: CredentialsHistoryItem[]) => CredentialsHistoryItem[])
  ) => void;
}

/**
 * Generate a stable ID for a credential item based on its content.
 * Uses domain + username + timestamp to create a deterministic identifier
 * that remains stable even if items are reordered.
 */
function stableLoginId(item: CredentialsHistoryItem): string {
  // If item already has a stable id (not index-based), reuse it
  if (item.id && !item.id.match(/-\d+$/)) {
    return item.id;
  }
  const raw = `${item.domain}|${item.username ?? ''}|${item.timestamp}`;
  return `login_${raw.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

export async function loadLoginInfo(ext: Browser, setters: LoginSetters) {
  try {
    const result = (await ext.storage.local.get(['loginInfo'])) as {
      loginInfo?: CredentialsHistoryItem[];
    };
    const loginInfo = result.loginInfo || [];
    // Decrypt passwords (encrypted at rest by form-filler.ts) then assign stable ids
    const decrypted = await decryptCredentials(loginInfo);
    const savedLogins = decrypted.map((item) => ({
      ...item,
      id: stableLoginId(item),
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
    await withLock('login_info_lock', async () => {
      const result = (await ext.storage.local.get(['loginInfo'])) as {
        loginInfo?: CredentialsHistoryItem[];
      };
      const loginInfo = result.loginInfo || [];

      // Find by stable ID instead of reconstructed index-based ID
      const targetIndex = loginInfo.findIndex((item) => stableLoginId(item) === id);

      if (targetIndex === -1) {
        setters.setSavedLogins((prev) => prev.filter((l) => l.id !== id));
        return;
      }

      const next = loginInfo.filter((_, i) => i !== targetIndex);
      await ext.storage.local.set({ loginInfo: next });

      const reloaded = (await decryptCredentials(next)).map((item) => ({
        ...item,
        id: stableLoginId(item),
      }));
      setters.setSavedLogins(reloaded);
    });
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
    await withLock('login_info_lock', async () => {
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

      const reloaded = (await decryptCredentials(next)).map((item) => ({
        ...item,
        id: stableLoginId(item),
      }));
      setters.setSavedLogins(reloaded);
    });
  } catch (e: unknown) {
    logError('reorderLoginInfo error:', undefined, e instanceof Error ? e : new Error(String(e)));
  }
}

/** Reorder full loginInfo array by stable item id (safe with search/filter). */
export async function reorderLoginInfoById(
  ext: Browser,
  setters: LoginSetters,
  sourceId: string,
  targetId: string
): Promise<void> {
  if (!sourceId || !targetId || sourceId === targetId) return;
  try {
    await withLock('login_info_lock', async () => {
      const result = (await ext.storage.local.get(['loginInfo'])) as {
        loginInfo?: CredentialsHistoryItem[];
      };
      const loginInfo = (result.loginInfo || []).map((item) => ({
        ...item,
        id: item.id || stableLoginId(item),
      }));
      const fromIndex = loginInfo.findIndex((item) => item.id === sourceId);
      const toIndex = loginInfo.findIndex((item) => item.id === targetId);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;

      const next = [...loginInfo];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);

      await ext.storage.local.set({ loginInfo: next });

      const reloaded = (await decryptCredentials(next)).map((item) => ({
        ...item,
        id: stableLoginId(item),
      }));
      setters.setSavedLogins(reloaded);
    });
  } catch (e: unknown) {
    logError(
      'reorderLoginInfoById error:',
      undefined,
      e instanceof Error ? e : new Error(String(e))
    );
  }
}
