/**
 * Lightweight autofill blocklist module (reads, checks, writes, notifications).
 *
 * This module exists separately from `storage-keys.ts` to avoid pulling in
 * the entire `email-service.ts` → `providers.jsonc` chain (~60 KB) into the
 * content-script bundle. It only depends on `wxt/browser`, so the content
 * script and background share one implementation. `storage-keys.ts` re-exports
 * these helpers for callers that already import from it.
 */

import { browser } from 'wxt/browser';
import { withLock } from '@/utils/mutex.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';

/** Returns the autofill blocklist (list of blocked domain strings). */
export async function getAutofillBlocklist(): Promise<string[]> {
  const { autofillBlocklist = [] } = (await browser.storage.local.get(['autofillBlocklist'])) as {
    autofillBlocklist?: string[];
  };
  return autofillBlocklist;
}

/**
 * Normalize a domain string for blocklist comparison: lowercase, strip scheme
 * and path, drop the port and a leading `www.` so `https://www.Example.com:8080/`
 * becomes `example.com`. Entries and visited hosts are normalized the same way,
 * so blocking `example.com` also covers `www.example.com` (and vice versa).
 */
export function normalizeBlocklistDomain(domain: string): string {
  return (domain || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .replace(/:\d+$/, '')
    .replace(/^www\./, '');
}

/**
 * True when `domain` is blocked by `blocklist` - an exact match or any
 * subdomain of a blocked entry. Blocking `example.com` therefore also blocks
 * `www.example.com` and `login.example.com`, since an address that wants
 * autofill disabled on a site means the whole site.
 */
export function isBlockedByList(domain: string, blocklist: string[]): boolean {
  const d = normalizeBlocklistDomain(domain);
  if (!d) return false;
  return blocklist.some((entry) => {
    const e = normalizeBlocklistDomain(entry);
    if (!e) return false;
    return d === e || d.endsWith(`.${e}`);
  });
}

/** Check if a domain is in the autofill blocklist (exact or subdomain). */
export async function isDomainBlocked(domain: string): Promise<boolean> {
  const blocklist = await getAutofillBlocklist();
  return isBlockedByList(domain, blocklist);
}

/** Persists the autofill blocklist. */
export async function setAutofillBlocklist(blocklist: string[]): Promise<void> {
  await writeWithRetry({ autofillBlocklist: blocklist });
}

/**
 * Add a domain to the autofill blocklist (deduped case/`www.`-insensitively).
 * Resolves `true` only when the stored list actually changed, so callers can
 * skip change notifications for no-op adds.
 */
export async function addToAutofillBlocklist(domain: string): Promise<boolean> {
  const cleaned = normalizeBlocklistDomain(domain);
  if (!cleaned) return false;
  // Locked read-modify-write: the context menu and the Settings toggle can
  // fire concurrently, and two interleaved get/push/set pairs drop an entry.
  // (mutex.ts is import-free, so this stays out of the content-script bundle
  // budget this module's docstring protects.)
  return withLock('autofill_blocklist_lock', async () => {
    const blocklist = await getAutofillBlocklist();
    if (isBlockedByList(cleaned, blocklist)) return false;
    blocklist.push(cleaned);
    await setAutofillBlocklist(blocklist);
    return true;
  });
}

/**
 * Remove the blocklist entries that block `domain` itself or one of its
 * subdomains. This is intentionally broader than exact matching: when the
 * user is on `login.example.com`, the context-menu action must remove the
 * `example.com` entry that caused the block.
 */
export async function removeFromAutofillBlocklist(domain: string): Promise<boolean> {
  const normalizedDomain = normalizeBlocklistDomain(domain);
  return withLock('autofill_blocklist_lock', async () => {
    const blocklist = await getAutofillBlocklist();
    const filtered = blocklist.filter((entry) => {
      const normalizedEntry = normalizeBlocklistDomain(entry);
      if (!normalizedEntry || !normalizedDomain) return true;
      return !(
        normalizedDomain === normalizedEntry || normalizedDomain.endsWith(`.${normalizedEntry}`)
      );
    });
    if (filtered.length === blocklist.length) return false;
    await setAutofillBlocklist(filtered);
    return true;
  });
}

export interface AutofillBlocklistToggleResult {
  /** True when the stored blocklist actually changed. */
  changed: boolean;
  /** True when the domain is now blocked (post-toggle state). */
  blocked: boolean;
}

/**
 * Flip a domain's block state: remove it when blocked, add it when not. This
 * is the single toggle used by the context menu and the Settings current-site
 * affordance, so neither has to re-derive the blocked-check/remove/add branch.
 */
export async function toggleAutofillBlocklist(
  domain: string
): Promise<AutofillBlocklistToggleResult> {
  const normalized = normalizeBlocklistDomain(domain);
  if (!normalized) return { changed: false, blocked: false };
  // Single locked read-modify-write, NOT get-then-remove/add: the old shape
  // re-read the list in a second lock acquisition, so two concurrent toggles
  // could both observe the same pre-state and collapse into one flip.
  return withLock('autofill_blocklist_lock', async () => {
    const blocklist = await getAutofillBlocklist();
    if (isBlockedByList(normalized, blocklist)) {
      const filtered = blocklist.filter((entry) => {
        const normalizedEntry = normalizeBlocklistDomain(entry);
        if (!normalizedEntry) return true;
        return !(normalized === normalizedEntry || normalized.endsWith(`.${normalizedEntry}`));
      });
      if (filtered.length === blocklist.length) return { changed: false, blocked: true };
      await setAutofillBlocklist(filtered);
      return { changed: true, blocked: false };
    }
    blocklist.push(normalized);
    await setAutofillBlocklist(blocklist);
    return { changed: true, blocked: true };
  });
}

/** Notify every injected frame after an extension-page blocklist edit. */
export async function notifyAutofillBlocklistChanged(): Promise<void> {
  try {
    const tabs = await browser.tabs.query({});
    await Promise.all(
      tabs
        .filter((tab) => typeof tab.id === 'number')
        .map((tab) =>
          browser.tabs
            .sendMessage(tab.id as number, { type: 'autofillBlocklistChanged' })
            .catch(() => undefined)
        )
    );
  } catch {
    // Restricted pages and missing tab access are expected; their next scan
    // will read the updated storage value.
  }
}
