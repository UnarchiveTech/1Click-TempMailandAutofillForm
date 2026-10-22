/**
 * Per-scope recent search history stored in extension local storage.
 * Used by search bars across Inbox, Manage, Settings, Identities, etc.
 */

import { browser } from 'wxt/browser';
import { LOCKS, withLock } from '@/utils/mutex.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';

const HISTORY_KEY = 'searchHistoryByScope';
const LIMIT_KEY = 'searchHistoryLimit';
export const DEFAULT_SEARCH_HISTORY_LIMIT = 5;
export const MIN_SEARCH_HISTORY_LIMIT = 3;
export const MAX_SEARCH_HISTORY_LIMIT = 20;

type HistoryMap = Record<string, string[]>;

async function readMap(): Promise<HistoryMap> {
  try {
    const res = (await browser.storage.local.get([HISTORY_KEY])) as {
      [HISTORY_KEY]?: HistoryMap;
    };
    const raw = res[HISTORY_KEY];
    if (!raw || typeof raw !== 'object') return {};
    return raw;
  } catch {
    /* ignore */
    return {};
  }
}

export async function getSearchHistoryLimit(): Promise<number> {
  try {
    const res = (await browser.storage.local.get([LIMIT_KEY])) as {
      [LIMIT_KEY]?: number;
    };
    const n = res[LIMIT_KEY];
    if (typeof n === 'number' && Number.isFinite(n)) {
      return Math.min(MAX_SEARCH_HISTORY_LIMIT, Math.max(MIN_SEARCH_HISTORY_LIMIT, Math.round(n)));
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_SEARCH_HISTORY_LIMIT;
}

export async function setSearchHistoryLimit(limit: number): Promise<number> {
  const n = Math.min(
    MAX_SEARCH_HISTORY_LIMIT,
    Math.max(MIN_SEARCH_HISTORY_LIMIT, Math.round(limit))
  );
  return withLock(LOCKS.SEARCH_HISTORY, async () => {
    await writeWithRetry({ [LIMIT_KEY]: n });
    // Trim all scopes to the new limit
    const map = await readMap();
    for (const key of Object.keys(map)) {
      map[key] = (map[key] || []).slice(0, n);
    }
    await writeWithRetry({ [HISTORY_KEY]: map });
    return n;
  });
}

export async function getSearchHistory(scope: string): Promise<string[]> {
  const limit = await getSearchHistoryLimit();
  const map = await readMap();
  return (map[scope] || []).slice(0, limit);
}

export async function pushSearchHistory(scope: string, query: string): Promise<string[]> {
  const q = query.trim();
  if (!q) return getSearchHistory(scope);
  return withLock(LOCKS.SEARCH_HISTORY, async () => {
    const limit = await getSearchHistoryLimit();
    const map = await readMap();
    const prev = map[scope] || [];
    const next = [q, ...prev.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, limit);
    map[scope] = next;
    await writeWithRetry({ [HISTORY_KEY]: map });
    return next;
  });
}

export async function removeSearchHistoryItem(scope: string, query: string): Promise<string[]> {
  return withLock(LOCKS.SEARCH_HISTORY, async () => {
    const map = await readMap();
    const prev = map[scope] || [];
    const normalizedQuery = query.trim().toLowerCase();
    const next = prev.filter(
      (x): x is string => typeof x === 'string' && x.trim().toLowerCase() !== normalizedQuery
    );
    map[scope] = next;
    await writeWithRetry({ [HISTORY_KEY]: map });
    return next;
  });
}

export async function clearSearchHistory(scope?: string): Promise<void> {
  await withLock(LOCKS.SEARCH_HISTORY, async () => {
    if (!scope) {
      await browser.storage.local.remove([HISTORY_KEY]);
      return;
    }
    const map = await readMap();
    delete map[scope];
    await writeWithRetry({ [HISTORY_KEY]: map });
  });
}
