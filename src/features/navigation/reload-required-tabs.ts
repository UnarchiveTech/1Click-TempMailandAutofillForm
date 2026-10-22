/** Session storage key containing tab IDs whose content scripts predate an extension update. */
export const RELOAD_REQUIRED_TAB_IDS_KEY = 'reloadRequiredTabIds_v1';

/** Keep tab IDs read from extension storage finite, unique, non-negative integers. */
export function normalizeReloadRequiredTabIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter((id): id is number => typeof id === 'number' && Number.isInteger(id) && id >= 0)
    ),
  ];
}

/** Add or remove a tab ID without mutating the stored array. */
export function updateReloadRequiredTabIds(
  current: unknown,
  tabId: number,
  required: boolean
): number[] {
  const ids = normalizeReloadRequiredTabIds(current);
  if (!Number.isInteger(tabId) || tabId < 0) return ids;
  if (required) return ids.includes(tabId) ? ids : [...ids, tabId];
  return ids.filter((id) => id !== tabId);
}

/** Browser-internal pages cannot be refreshed through the tabs API. */
export function isReloadablePageUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
