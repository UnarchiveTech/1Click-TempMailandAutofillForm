import { decryptCredentials } from '@/features/login-info/saved-login-credentials.js';
import { moveItemBefore } from '@/utils/array-utils.js';
import { logError } from '@/utils/logger.js';
import { withLock } from '@/utils/mutex.js';
import { arrayOrEmpty, isObjectRecord } from '@/utils/storage/storage-shape-guards.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
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
  if (item.id && !item.id.match(/-\d+$/)) {
    return item.id;
  }
  // Fallback for legacy items without an ID before they get saved with a UUID.
  // Use a string that won't change when credential updates (e.g. timestamp updates).
  const raw = `${item.domain}|${item.email || ''}|${item.username || ''}`;
  return `login_${raw.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

async function updateLoginInfo(
  ext: Browser,
  setters: LoginSetters,
  mutate: (items: CredentialsHistoryItem[]) => CredentialsHistoryItem[] | null,
  errorLabel: string,
  onNoChange?: (items: CredentialsHistoryItem[]) => void
): Promise<void> {
  await withLock('login_info_lock', async () => {
    const result = (await ext.storage.local.get(['loginInfo'])) as {
      loginInfo?: CredentialsHistoryItem[];
    };
    const current = result.loginInfo || [];
    const next = mutate(current);
    if (!next) {
      onNoChange?.(current);
      return;
    }

    await writeWithRetry({ loginInfo: next });
    const reloaded = (await decryptCredentials(next)).map((item) => ({
      ...item,
      id: stableLoginId(item),
    }));
    setters.setSavedLogins(reloaded);
  }).catch((error: unknown) => {
    logError(errorLabel, undefined, error instanceof Error ? error : new Error(String(error)));
  });
}

export async function loadLoginInfo(ext: Browser, setters: LoginSetters) {
  try {
    const loginInfo = await withLock('login_info_lock', async () => {
      const result = (await ext.storage.local.get(['loginInfo'])) as {
        loginInfo?: unknown;
      };
      // Shape guard (storage-shape-guards.ts): only object entries survive, so a
      // corrupt entry can never be MUTATED (`item.id = …` on a primitive string
      // throws under ESM) or written back - canonizing the corruption. Field-level
      // trust is unchanged (the file reads fields through `||` fallbacks).
      const current = arrayOrEmpty<Record<string, unknown>>(result.loginInfo).filter(
        (item): item is CredentialsHistoryItem => isObjectRecord(item)
      );

      let needsSave = false;
      for (const item of current) {
        if (!item.id || String(item.id).match(/-\d+$/)) {
          item.id = crypto.randomUUID();
          needsSave = true;
        }
      }

      if (needsSave) {
        await writeWithRetry({ loginInfo: current });
      }
      return current;
    });

    const decrypted = await decryptCredentials(loginInfo);
    setters.setSavedLogins(decrypted);
  } catch (e: unknown) {
    logError('loadLoginInfo error:', undefined, e instanceof Error ? e : new Error(String(e)));
  }
}

export async function deleteLoginById(
  ext: Browser,
  setters: LoginSetters,
  id: string
): Promise<void> {
  await updateLoginInfo(
    ext,
    setters,
    (items) => {
      const targetIndex = items.findIndex((item) => stableLoginId(item) === id);
      return targetIndex < 0 ? null : items.filter((_, index) => index !== targetIndex);
    },
    'deleteLoginById error:',
    () => setters.setSavedLogins((prev) => prev.filter((l) => l.id !== id))
  );
}

export async function reorderLoginInfo(
  ext: Browser,
  setters: LoginSetters,
  fromIndex: number,
  toIndex: number
): Promise<void> {
  if (fromIndex === toIndex) return;
  await updateLoginInfo(
    ext,
    setters,
    (items) => {
      if (fromIndex < 0 || fromIndex >= items.length) return null;
      if (toIndex < 0 || toIndex >= items.length) return null;
      return moveItemBefore(items, fromIndex, toIndex);
    },
    'reorderLoginInfo error:'
  );
}

/** Reorder full loginInfo array by stable item id (safe with search/filter). */
export async function reorderLoginInfoById(
  ext: Browser,
  setters: LoginSetters,
  sourceId: string,
  targetId: string
): Promise<void> {
  if (!sourceId || !targetId || sourceId === targetId) return;
  await updateLoginInfo(
    ext,
    setters,
    (items) => {
      const normalized = items.map((item) => ({ ...item, id: item.id || stableLoginId(item) }));
      const fromIndex = normalized.findIndex((item) => item.id === sourceId);
      const toIndex = normalized.findIndex((item) => item.id === targetId);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return null;

      return moveItemBefore(normalized, fromIndex, toIndex);
    },
    'reorderLoginInfoById error:'
  );
}
