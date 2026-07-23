/**
 * Per-scope recent search history stored in extension local storage.
 * Used by search bars across Inbox, Manage, Settings, Identities, etc.
 */

import { browser } from 'wxt/browser';

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
  await browser.storage.local.set({ [LIMIT_KEY]: n });
  // Trim all scopes to the new limit
  const map = await readMap();
  for (const key of Object.keys(map)) {
    map[key] = (map[key] || []).slice(0, n);
  }
  await browser.storage.local.set({ [HISTORY_KEY]: map });
  return n;
}

export async function getSearchHistory(scope: string): Promise<string[]> {
  const limit = await getSearchHistoryLimit();
  const map = await readMap();
  return (map[scope] || []).slice(0, limit);
}

export async function pushSearchHistory(scope: string, query: string): Promise<string[]> {
  const q = query.trim();
  if (!q) return getSearchHistory(scope);
  const limit = await getSearchHistoryLimit();
  const map = await readMap();
  const prev = map[scope] || [];
  const next = [q, ...prev.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, limit);
  map[scope] = next;
  await browser.storage.local.set({ [HISTORY_KEY]: map });
  return next;
}

export async function removeSearchHistoryItem(scope: string, query: string): Promise<string[]> {
  const map = await readMap();
  const prev = map[scope] || [];
  const next = prev.filter((x) => x !== query);
  map[scope] = next;
  await browser.storage.local.set({ [HISTORY_KEY]: map });
  return next;
}

export async function clearSearchHistory(scope?: string): Promise<void> {
  if (!scope) {
    await browser.storage.local.remove([HISTORY_KEY]);
    return;
  }
  const map = await readMap();
  delete map[scope];
  await browser.storage.local.set({ [HISTORY_KEY]: map });
}
