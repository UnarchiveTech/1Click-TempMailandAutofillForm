/**
 * Last-good storage snapshot so ErrorBoundary can "revert last action".
 * Snapshots are lightweight bags of critical keys (not full storage dump).
 */
import { getEmailMaps, setLogicalEmailMaps } from '@/utils/storage/storage-keys.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';

const SNAPSHOT_KEY = 'lastGoodUiSnapshot_v1';
const HISTORY_KEY = 'actionHistory_v1';
const MAX_HISTORY = 5;

const SNAPSHOT_KEYS = [
  'addresses',
  'activeAddressId',
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

/** Keep only bags whose address (case-insensitive) is in the allowed set. */
function filterBagsByAddresses(
  bags: Record<string, import('@/utils/types.js').Email[]>,
  allowed: Set<string>
): Record<string, import('@/utils/types.js').Email[]> {
  const out: Record<string, import('@/utils/types.js').Email[]> = {};
  for (const [addr, msgs] of Object.entries(bags)) {
    if (allowed.has(addr.toLowerCase())) out[addr] = msgs;
  }
  return out;
}

export async function saveLastGoodSnapshot(ext: Browser, label = 'auto'): Promise<void> {
  try {
    const bag = (await ext.storage.local.get([...SNAPSHOT_KEYS])) as Record<string, unknown>;
    // Only snapshot email bags for addresses in the live list - avoid
    // serializing every retained ID-keyed bag across all history entries.
    const liveAddrs = Array.isArray(bag.addresses)
      ? new Set(
          (bag.addresses as Array<{ address?: string }>)
            .map((r) => (r.address || '').toLowerCase())
            .filter(Boolean)
        )
      : new Set<string>();
    const logical = await getEmailMaps();
    const snap: UiSnapshot = {
      ...bag,
      storedEmails: filterBagsByAddresses(logical.storedEmails, liveAddrs),
      archivedEmails: filterBagsByAddresses(logical.archivedEmails, liveAddrs),
      _savedAt: Date.now(),
      _label: label,
    };
    const { [HISTORY_KEY]: hist = [] } = (await ext.storage.local.get([HISTORY_KEY])) as {
      [HISTORY_KEY]?: UiSnapshot[];
    };
    const next = [snap, ...(Array.isArray(hist) ? hist : [])].slice(0, MAX_HISTORY);
    await writeWithRetry({
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
    await writeWithRetry(restore);
    const logical = await getEmailMaps();
    await setLogicalEmailMaps(
      (target.storedEmails as Record<string, import('@/utils/types.js').Email[]>) ||
        logical.storedEmails,
      (target.archivedEmails as Record<string, import('@/utils/types.js').Email[]>) ||
        logical.archivedEmails
    );
    return true;
  } catch {
    /* ignore */
    return false;
  }
}

export async function hardResetFromBoundary(ext: Browser): Promise<void> {
  let resetMarker: { lastHardReset?: number; forceNewSessions?: boolean } | null = null;
  try {
    const response = (await ext.runtime.sendMessage({ type: 'hardReset' })) as {
      success?: boolean;
      lastHardReset?: number;
      forceNewSessions?: boolean;
    } | null;
    if (response?.success && response.forceNewSessions) {
      resetMarker = {
        lastHardReset: response.lastHardReset,
        forceNewSessions: true,
      };
    }
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
  if (resetMarker) {
    try {
      await writeWithRetry({
        lastHardReset: resetMarker.lastHardReset ?? Date.now(),
        forceNewSessions: true,
      });
    } catch {
      /* ignore */
    }
  }
}
