/**
 * Site blocklist learning - count autofill failures; suggest block after N.
 */

import { browser } from 'wxt/browser';
import {
  addToAutofillBlocklist,
  isDomainBlocked,
  notifyAutofillBlocklistChanged,
} from '@/utils/content/autofill-blocklist.js';
import { withLock } from '@/utils/mutex.js';
import { arrayOrEmpty, sanitizeTimestampMap } from '@/utils/storage/storage-shape-guards.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import { loadSmartAutofillSettings } from './smart-settings.js';
import { normalizeDomain } from './storage.js';

const KEY = 'autofillFailureCounts_v1';
const SUGGEST_KEY = 'autofillBlockSuggestions_v1';

/** Cap on distinct failing domains tracked in storage (evicts the smallest). */
const MAX_FAILURE_DOMAINS = 300;

export async function recordAutofillFailure(domain: string): Promise<{
  count: number;
  shouldSuggestBlock: boolean;
}> {
  const d = normalizeDomain(domain);
  if (!d) return { count: 0, shouldSuggestBlock: false };
  // isDomainBlocked already covers exact AND subdomain matches (and normalizes
  // stored entries), so there is no separate subdomain check to hand-roll here.
  const isBlocked = await isDomainBlocked(d);
  if (isBlocked) return { count: 0, shouldSuggestBlock: false };

  const settings = await loadSmartAutofillSettings();
  // Read-modify-write under a lock: concurrent failure records from parallel
  // polls would otherwise drop each other's increments.
  return await withLock('autofill_failure_counts_lock', async () => {
    // Shape-guarded RMW (storage-shape-guards.ts): a corrupt stored map (string,
    // array, per-key garbage) degrades to {} instead of propagating NaN counts
    // or being written back with its corruption canonized.
    const res = (await browser.storage.local.get([KEY])) as {
      [KEY]?: unknown;
    };
    const map = sanitizeTimestampMap(res[KEY]);
    map[d] = (map[d] || 0) + 1;
    // Bound storage growth: abandoned failing domains would otherwise accumulate
    // a key in storage.local forever. When the map exceeds the cap, evict the
    // lowest-count entries (they never reached the suggest threshold) while
    // always keeping the just-incremented domain.
    const total = Object.keys(map).length;
    if (total > MAX_FAILURE_DOMAINS) {
      const others = Object.keys(map).filter((k) => k !== d);
      others.sort((a, b) => (map[a] || 0) - (map[b] || 0));
      const toDrop = total - MAX_FAILURE_DOMAINS;
      for (const k of others.slice(0, toDrop)) {
        delete map[k];
      }
    }
    await writeWithRetry({ [KEY]: map });

    const shouldSuggest = map[d] >= (settings.blockSuggestAfterFailures || 3);
    if (shouldSuggest) {
      const sug = (await browser.storage.local.get([SUGGEST_KEY])) as {
        [SUGGEST_KEY]?: unknown;
      };
      const list = new Set(
        arrayOrEmpty<string>(sug[SUGGEST_KEY]).filter((x) => typeof x === 'string' && x)
      );
      list.add(d);
      await writeWithRetry({ [SUGGEST_KEY]: [...list].slice(0, 40) });
    }
    return { count: map[d], shouldSuggestBlock: shouldSuggest };
  });
}

export async function recordAutofillSuccess(domain: string): Promise<void> {
  const d = normalizeDomain(domain);
  if (!d) return;
  try {
    await withLock('autofill_failure_counts_lock', async () => {
      const res = (await browser.storage.local.get([KEY, SUGGEST_KEY])) as {
        [KEY]?: unknown;
        [SUGGEST_KEY]?: unknown;
      };
      // Shape-guarded RMW: a corrupt stored map used to be spread with `{...x}`,
      // which on a primitive spreads its CHARACTERS as keys - canonizing the
      // corruption into the next write.
      const map = sanitizeTimestampMap(res[KEY]);
      delete map[d];
      const sug = arrayOrEmpty<string>(res[SUGGEST_KEY]).filter(
        (x) => typeof x === 'string' && x && x !== d
      );
      await writeWithRetry({ [KEY]: map, [SUGGEST_KEY]: sug });
    });
  } catch {
    /* ignore */
  }
}

export async function getBlockSuggestions(): Promise<string[]> {
  try {
    const res = (await browser.storage.local.get([SUGGEST_KEY])) as {
      [SUGGEST_KEY]?: unknown;
    };
    return arrayOrEmpty<string>(res[SUGGEST_KEY]).filter((x) => typeof x === 'string' && x);
  } catch {
    /* ignore */
    return [];
  }
}

export async function dismissBlockSuggestion(domain: string): Promise<void> {
  const d = normalizeDomain(domain);
  await withLock('autofill_failure_counts_lock', async () => {
    const list = (await getBlockSuggestions()).filter((x) => x !== d);
    await writeWithRetry({ [SUGGEST_KEY]: list });
    // Reset failure count so we don't re-suggest immediately
    try {
      const res = (await browser.storage.local.get([KEY])) as { [KEY]?: unknown };
      const map = sanitizeTimestampMap(res[KEY]);
      delete map[d];
      await writeWithRetry({ [KEY]: map });
    } catch {
      /* ignore */
    }
  });
}

export async function acceptBlockSuggestion(domain: string): Promise<void> {
  const d = normalizeDomain(domain);
  // Use the canonical shared add so suggestion-accept can never drift from the
  // context-menu / settings blocklist semantics, and notify only on a real change.
  const added = await addToAutofillBlocklist(d);
  if (added) void notifyAutofillBlocklistChanged();
  await dismissBlockSuggestion(d);
}
