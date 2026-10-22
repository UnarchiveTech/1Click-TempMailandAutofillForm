/**
 * Storage growth controls - caps for storedEmails, favicon cache, identity avatars.
 * Runs best-effort on periodic cleanup; safe to call from background or UI.
 */

import { browser } from 'wxt/browser';
import { MAX_PROFILE_PICTURE_DATA_URL_CHARS } from '@/utils/identity/profile-picture.js';
import { logDebug } from '@/utils/logger.js';
import { LOCKS, withLock } from '@/utils/mutex.js';
import {
  getEmailMaps,
  removeOrphanedEmailStorageBags,
  setLogicalEmailMapsUnlockedForLockedCaller,
} from '@/utils/storage/storage-keys.js';
import type { Email } from '@/utils/types.js';
import { writeWithRetry } from './storage-write.js';

export const STORAGE_CAPS = {
  /** Max messages kept per inbox address (must match MAX_STORED_EMAILS_PER_INBOX). */
  maxEmailsPerAddress: 100,
  /** Max distinct inbox bags in storedEmails */
  maxAddressBags: 80,
  /** Max favicon cache entries */
  maxFavicons: 120,
  /** Encoded counterpart of the identity editor's 500 KiB upload allowance. */
  maxProfilePictureChars: MAX_PROFILE_PICTURE_DATA_URL_CHARS,
  /** Max total approximate storedEmails payload size (chars JSON) before aggressive prune */
  storedEmailsSoftBudgetChars: 4_000_000,
  /** Per-inbox floor applied when the soft budget is exceeded. */
  softBudgetFloorPerAddress: 50,
  /** Per-bag floor for archived mail (last-resort soft-budget trim).
   *  Archived mail is the user's offline-saved history, so it is trimmed only
   *  after every stored bag already sits at its floor and the combined
   *  payload still exceeds the budget. */
  archivedSoftBudgetFloorPerAddress: 10,
} as const;

export function clampProfilePictureDataUrl(dataUrl: string | null | undefined): string | null {
  if (!dataUrl) return null;
  if (dataUrl.length <= STORAGE_CAPS.maxProfilePictureChars) return dataUrl;
  return null; // reject oversized - caller should show error
}

export function isProfilePictureTooLarge(dataUrl: string | null | undefined): boolean {
  return !!dataUrl && dataUrl.length > STORAGE_CAPS.maxProfilePictureChars;
}

/** Trim one inbox's email array to newest N. */
export function trimEmailList<T extends { received_at?: number }>(
  emails: T[],
  max: number = STORAGE_CAPS.maxEmailsPerAddress
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
    return {
      addr: addr.toLowerCase(),
      list: trimmed as unknown[],
      newest,
      isActive: active.has(addr.toLowerCase()),
      // Never prune session-scoped address bags
      isSession: /^session_/.test(addr),
    };
  });

  // Prefer session/active addresses, then by newest mail
  entries.sort((a, b) => {
    if (a.isSession !== b.isSession) return a.isSession ? -1 : 1;
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return b.newest - a.newest;
  });

  for (const e of entries.slice(0, STORAGE_CAPS.maxAddressBags)) {
    next[e.addr] = e.list;
  }
  return next;
}

/**
 * Soft-budget pass over the logical email maps.
 *
 * Halves every stored bag until each sits at `softBudgetFloorPerAddress`;
 * if the COMBINED stored + archived payload still exceeds the budget (archived
 * mail dominating - e.g. an import-restored archive on a quota-tight profile),
 * trims the oldest archived mail toward `archivedSoftBudgetFloorPerAddress` as
 * a last resort. Stored mail is trimmed first because archived mail is the
 * user's offline-saved history and the ingest-side cap is the primary control
 * on it. Returns the adjusted maps and which side(s) changed so
 * `runStorageHygiene` can persist both through setLogicalEmailMaps.
 */
export function applySoftEmailBudget(
  stored: Record<string, unknown[]>,
  archived: Record<string, unknown[]>,
  budgetChars: number = STORAGE_CAPS.storedEmailsSoftBudgetChars
): {
  stored: Record<string, unknown[]>;
  archived: Record<string, unknown[]>;
  trimmedStored: boolean;
  trimmedArchived: boolean;
} {
  let softStored = stored;
  let softArchived = archived;
  const totalChars = () =>
    JSON.stringify({ storedEmails: softStored, archivedEmails: softArchived }).length;
  while (totalChars() > budgetChars) {
    const storedAboveFloor = Object.values(softStored).some(
      (list) => list.length > STORAGE_CAPS.softBudgetFloorPerAddress
    );
    if (storedAboveFloor) {
      softStored = Object.fromEntries(
        Object.entries(softStored).map(([k, list]) => [
          k,
          trimEmailList(
            (Array.isArray(list) ? list : []) as { received_at?: number }[],
            Math.max(STORAGE_CAPS.softBudgetFloorPerAddress, Math.floor(list.length / 2))
          ),
        ])
      );
      continue;
    }
    const archivedAboveFloor = Object.values(softArchived).some(
      (list) => list.length > STORAGE_CAPS.archivedSoftBudgetFloorPerAddress
    );
    if (archivedAboveFloor) {
      softArchived = Object.fromEntries(
        Object.entries(softArchived).map(([k, list]) => [
          k,
          trimEmailList(
            (Array.isArray(list) ? list : []) as { received_at?: number }[],
            Math.max(STORAGE_CAPS.archivedSoftBudgetFloorPerAddress, Math.floor(list.length / 2))
          ),
        ])
      );
      continue;
    }
    break; // both stored and archived at their floors - nothing left to trim
  }
  return {
    stored: softStored,
    archived: softArchived,
    trimmedStored: softStored !== stored,
    trimmedArchived: softArchived !== archived,
  };
}

/**
 * Cap a favicon cache object (success or error cache), keeping the NEWEST
 * entries by timestamp. Both caches carry `{ timestamp }` entries; eviction
 * mirrors the favicon module's own LRU (oldest timestamp dropped first) so
 * hygiene and live writes agree on who survives. Keys without a usable
 * timestamp sort last.
 */
export function pruneFaviconCache(
  cache: Record<string, unknown>,
  max: number = STORAGE_CAPS.maxFavicons
): Record<string, unknown> {
  const entries = Object.entries(cache || {});
  if (entries.length <= max) return cache || {};
  const timestampOf = (entry: unknown): number => {
    const ts = (entry as { timestamp?: unknown } | null)?.timestamp;
    return typeof ts === 'number' ? ts : 0;
  };
  const sorted = entries.sort((a, b) => timestampOf(b[1]) - timestampOf(a[1]));
  const next: Record<string, unknown> = {};
  for (const [k, v] of sorted.slice(0, max)) {
    next[k] = v;
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
  let orphanedBagsRemoved = 0;

  try {
    // The favicon module stores its caches under `favicon_success_cache` /
    // `favicon_error_cache` (FAVICON_CACHE_KEY / FAVICON_ERROR_CACHE_KEY);
    // a historical pass pruned a `faviconCache` key nothing writes, so the
    // cap never fired. Both real caches are capped here as a storage-level
    // backstop behind the module's own LRU/expiry.
    const base = (await browser.storage.local.get([
      'favicon_success_cache',
      'favicon_error_cache',
      'identities',
    ])) as {
      favicon_success_cache?: Record<string, unknown>;
      favicon_error_cache?: Record<string, unknown>;
      identities?: Array<Record<string, unknown>>;
    };
    try {
      orphanedBagsRemoved = await removeOrphanedEmailStorageBags();
      if (orphanedBagsRemoved > 0) emailsPruned = true;
    } catch (error) {
      logDebug(`storage hygiene orphan-bag sweep failed: ${String(error)}`);
    }

    const patch: Record<string, unknown> = {};
    const res = base as {
      favicon_success_cache?: Record<string, unknown>;
      favicon_error_cache?: Record<string, unknown>;
      identities?: Array<Record<string, unknown>>;
    };

    // The whole email read → prune → write is one critical section. Locking
    // only setLogicalEmailMaps would still let an ingest land after this read
    // and then be overwritten by the stale pruned snapshot.
    await withLock(LOCKS.EMAILS_STORAGE, async () => {
      const emailMaps = await getEmailMaps();
      const currentAddresses = (await browser.storage.local.get(['addresses'])) as {
        addresses?: Array<{ address?: string }>;
      };
      const active = (currentAddresses.addresses || []).map((i) => i.address || '').filter(Boolean);
      const pruned = pruneStoredEmailsMap(emailMaps.storedEmails, active);
      let logicalEmailMapsChanged = false;
      let pruneChanged = Object.keys(pruned).length !== Object.keys(emailMaps.storedEmails).length;
      if (!pruneChanged) {
        for (const k of Object.keys(pruned)) {
          const a = emailMaps.storedEmails[k];
          if (Array.isArray(a) && a.length !== (pruned[k]?.length || 0)) {
            pruneChanged = true;
            break;
          }
        }
      }
      if (pruneChanged) {
        emailsPruned = true;
        logicalEmailMapsChanged = true;
      }
      // Soft budget: if the total stored + archived payload still exceeds the
      // budget after per-inbox capping, trim every stored bag to a lower floor
      // (halving), and only then - when stored sits at its floor and archived
      // dominates - trim the oldest archived mail toward its own lower floor.
      const budget = applySoftEmailBudget(pruned, emailMaps.archivedEmails);
      if (budget.trimmedStored) {
        emailsPruned = true;
        logicalEmailMapsChanged = true;
      }
      if (budget.trimmedArchived) {
        emailsPruned = true;
        logicalEmailMapsChanged = true;
      }
      if (logicalEmailMapsChanged || orphanedBagsRemoved > 0) {
        await setLogicalEmailMapsUnlockedForLockedCaller(
          (budget.trimmedStored ? budget.stored : pruned) as Record<string, Email[]>,
          (budget.trimmedArchived ? budget.archived : emailMaps.archivedEmails) as Record<
            string,
            Email[]
          >
        );
      }
    });

    if (
      res.favicon_success_cache &&
      Object.keys(res.favicon_success_cache).length > STORAGE_CAPS.maxFavicons
    ) {
      patch.favicon_success_cache = pruneFaviconCache(res.favicon_success_cache);
      faviconsPruned = true;
    }
    // The error cache has NO module-side LRU (only 24h expiry on read), so a
    // write-only-then-abandoned domain persisted forever - this cap is its
    // only size bound.
    if (
      res.favicon_error_cache &&
      Object.keys(res.favicon_error_cache).length > STORAGE_CAPS.maxFavicons
    ) {
      patch.favicon_error_cache = pruneFaviconCache(res.favicon_error_cache);
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

    if (Object.keys(patch).length > 0 || orphanedBagsRemoved > 0 || emailsPruned) {
      if (Object.keys(patch).length > 0) await writeWithRetry(patch);
      logDebug(
        `storage hygiene: emails=${emailsPruned} orphanBags=${orphanedBagsRemoved} favicons=${faviconsPruned} avatars=${avatarsStripped}`
      );
    }
  } catch (e) {
    logDebug(`storage hygiene failed: ${String(e)}`);
  }

  return { emailsPruned, faviconsPruned, avatarsStripped };
}
