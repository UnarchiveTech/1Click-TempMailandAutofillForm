import type { Account } from '@/utils/types.js';

export type AccountTagEntry = { name: string; color: string };

const DEFAULT_TAG_COLOR = '#6366F1';

/** Normalize legacy single tag + multi `tags[]` into one list for UI. */
export function accountTagsList(account: Account | null | undefined): AccountTagEntry[] {
  if (!account) return [];
  if (Array.isArray(account.tags) && account.tags.length > 0) {
    return account.tags
      .filter((t) => t?.name?.trim())
      .map((t) => ({ name: t.name.trim(), color: t.color || DEFAULT_TAG_COLOR }));
  }
  if (account.tag?.trim()) {
    return [{ name: account.tag.trim(), color: account.tagColor || DEFAULT_TAG_COLOR }];
  }
  return [];
}

/** True if any tag name matches (case-insensitive substring). */
export function accountMatchesTagSearch(account: Account, search: string): boolean {
  if (!search) return true;
  const q = search.toLowerCase();
  return accountTagsList(account).some((t) => t.name.toLowerCase().includes(q));
}
