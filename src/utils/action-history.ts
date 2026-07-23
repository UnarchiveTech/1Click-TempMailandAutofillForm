/**
 * Last-good storage snapshot so ErrorBoundary can "revert last action".
 * Snapshots are lightweight bags of critical keys (not full storage dump).
 */
import type { Browser } from 'wxt/browser';

const SNAPSHOT_KEY = 'lastGoodUiSnapshot_v1';
const HISTORY_KEY = 'actionHistory_v1';
const MAX_HISTORY = 5;

const SNAPSHOT_KEYS = [
  'inboxes',
  'storedEmails',
  'archivedEmails',
  'activeInboxId',
  'selectedEmail',
  'latestOtp',
  'identities',
  'loginInfo',
  'analytics',
  'selectedProvider',
  'autoRenew',
  'autoCopy',
  'themeMode',
  'savedSearchFilters',
  'starredEmails',
  'readEmails',
  'demoMode',
] as const;

export type UiSnapshot = Record<string, unknown> & { _savedAt?: number; _label?: string };

export async function saveLastGoodSnapshot(ext: Browser, label = 'auto'): Promise<void> {
  try {
    const bag = (await ext.storage.local.get([...SNAPSHOT_KEYS])) as Record<string, unknown>;
    const snap: UiSnapshot = { ...bag, _savedAt: Date.now(), _label: label };
    const { [HISTORY_KEY]: hist = [] } = (await ext.storage.local.get([HISTORY_KEY])) as {
      [HISTORY_KEY]?: UiSnapshot[];
    };
    const next = [snap, ...(Array.isArray(hist) ? hist : [])].slice(0, MAX_HISTORY);
    await ext.storage.local.set({
      [SNAPSHOT_KEY]: snap,
      [HISTORY_KEY]: next,
    });
  } catch {
    /* ignore snapshot failures */
  }
}

export async function revertLastAction(ext: Browser): Promise<boolean> {
  try {
    const { [HISTORY_KEY]: hist = [], [SNAPSHOT_KEY]: single } = (await ext.storage.local.get([
      HISTORY_KEY,
      SNAPSHOT_KEY,
    ])) as {
      [HISTORY_KEY]?: UiSnapshot[];
      [SNAPSHOT_KEY]?: UiSnapshot;
    };
    // Prefer previous history entry (index 1) so we undo the last mutation after a good state
    const list = Array.isArray(hist) ? hist : [];
    const target = list[1] || list[0] || single;
    if (!target || typeof target !== 'object') return false;

    const restore: Record<string, unknown> = {};
    for (const k of SNAPSHOT_KEYS) {
      if (k in target) restore[k] = target[k];
    }
    await ext.storage.local.set(restore);
    return true;
  } catch {
    return false;
  }
}

export async function hardResetFromBoundary(ext: Browser): Promise<void> {
  try {
    await ext.runtime.sendMessage({ action: 'hardReset' });
  } catch {
    /* ignore */
  }
  try {
    await ext.storage.local.clear();
  } catch {
    /* ignore */
  }
  try {
    if ('sync' in ext.storage && ext.storage.sync) {
      await ext.storage.sync.clear();
    }
  } catch {
    /* ignore */
  }
}
