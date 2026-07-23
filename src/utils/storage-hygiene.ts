/**
 * Storage growth controls — caps for storedEmails, favicon cache, identity avatars.
 * Runs best-effort on periodic cleanup; safe to call from background or UI.
 */

import { browser } from 'wxt/browser';
import { logDebug } from '@/utils/logger.js';

export const STORAGE_CAPS = {
  /** Max messages kept per inbox address */
  maxEmailsPerInbox: 200,
  /** Max distinct inbox bags in storedEmails */
  maxInboxBags: 80,
  /** Max favicon cache entries */
  maxFavicons: 120,
  /** Max profilePicture data-URL length (chars) ~ 200KB base64 */
  maxProfilePictureChars: 220_000,
  /** Max total approximate storedEmails payload size (chars JSON) before aggressive prune */
  storedEmailsSoftBudgetChars: 4_000_000,
} as const;

export function clampProfilePictureDataUrl(dataUrl: string | null | undefined): string | null {
  if (!dataUrl) return null;
  if (dataUrl.length <= STORAGE_CAPS.maxProfilePictureChars) return dataUrl;
  return null; // reject oversized — caller should show error
}

export function isProfilePictureTooLarge(dataUrl: string | null | undefined): boolean {
  return !!dataUrl && dataUrl.length > STORAGE_CAPS.maxProfilePictureChars;
}

/** Trim one inbox's email array to newest N. */
export function trimEmailList<T extends { received_at?: number }>(
  emails: T[],
  max: number = STORAGE_CAPS.maxEmailsPerInbox
): T[] {
  if (!Array.isArray(emails) || emails.length <= max) return emails || [];
  return [...emails].sort((a, b) => (b.received_at || 0) - (a.received_at || 0)).slice(0, max);
}

/**
 * Prune storedEmails map: per-inbox cap + drop least-recently-active bags.
 */
export function pruneStoredEmailsMap(
  map: Record<string, unknown[]>,
  activeAddresses: string[] = []
): Record<string, unknown[]> {
  const active = new Set(activeAddresses.map((a) => a.toLowerCase()));
  const next: Record<string, unknown[]> = {};

  const entries = Object.entries(map || {}).map(([addr, list]) => {
    const trimmed = trimEmailList((Array.isArray(list) ? list : []) as { received_at?: number }[]);
    const newest = trimmed[0]?.received_at || 0;
    return { addr, list: trimmed as unknown[], newest, isActive: active.has(addr.toLowerCase()) };
  });

  // Prefer active inboxes, then by newest mail
  entries.sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return b.newest - a.newest;
  });

  for (const e of entries.slice(0, STORAGE_CAPS.maxInboxBags)) {
    next[e.addr] = e.list;
  }
  return next;
}

/** Cap favicon cache object by dropping arbitrary excess keys. */
export function pruneFaviconCache(
  cache: Record<string, unknown>,
  max = STORAGE_CAPS.maxFavicons
): Record<string, unknown> {
  const keys = Object.keys(cache || {});
  if (keys.length <= max) return cache || {};
  const next: Record<string, unknown> = {};
  for (const k of keys.slice(keys.length - max)) {
    next[k] = cache[k];
  }
  return next;
}

/**
 * Run full hygiene pass on browser.storage.local.
 */
export async function runStorageHygiene(): Promise<{
  emailsPruned: boolean;
  faviconsPruned: boolean;
  avatarsStripped: number;
}> {
  let emailsPruned = false;
  let faviconsPruned = false;
  let avatarsStripped = 0;

  try {
    const res = (await browser.storage.local.get([
      'storedEmails',
      'inboxes',
      'faviconCache',
      'identities',
    ])) as {
      storedEmails?: Record<string, unknown[]>;
      inboxes?: Array<{ address?: string }>;
      faviconCache?: Record<string, unknown>;
      identities?: Array<Record<string, unknown>>;
    };

    const patch: Record<string, unknown> = {};

    if (res.storedEmails) {
      const active = (res.inboxes || []).map((i) => i.address || '').filter(Boolean);
      const pruned = pruneStoredEmailsMap(res.storedEmails, active);
      if (Object.keys(pruned).length !== Object.keys(res.storedEmails).length) {
        emailsPruned = true;
      } else {
        // also if any list was trimmed
        for (const k of Object.keys(pruned)) {
          const a = res.storedEmails[k];
          if (Array.isArray(a) && a.length !== (pruned[k]?.length || 0)) {
            emailsPruned = true;
            break;
          }
        }
      }
      if (emailsPruned) patch.storedEmails = pruned;
    }

    if (res.faviconCache && Object.keys(res.faviconCache).length > STORAGE_CAPS.maxFavicons) {
      patch.faviconCache = pruneFaviconCache(res.faviconCache);
      faviconsPruned = true;
    }

    if (Array.isArray(res.identities)) {
      let changed = false;
      const next = res.identities.map((id) => {
        const pic = id.profilePicture;
        if (typeof pic === 'string' && pic.length > STORAGE_CAPS.maxProfilePictureChars) {
          avatarsStripped += 1;
          changed = true;
          return { ...id, profilePicture: null };
        }
        return id;
      });
      if (changed) patch.identities = next;
    }

    if (Object.keys(patch).length > 0) {
      await browser.storage.local.set(patch);
      logDebug(
        `storage hygiene: emails=${emailsPruned} favicons=${faviconsPruned} avatars=${avatarsStripped}`
      );
    }
  } catch (e) {
    logDebug(`storage hygiene failed: ${String(e)}`);
  }

  return { emailsPruned, faviconsPruned, avatarsStripped };
}
