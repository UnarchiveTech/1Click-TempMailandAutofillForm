/**
 * Per-site field maps - remember which selectors worked for each field kind.
 */

import { browser } from 'wxt/browser';
import { buildSelectorHint } from '@/utils/dom/selector-hint.js';
import { LOCKS, withLock } from '@/utils/mutex.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import { normalizeDomain } from './storage.js';
import type { FormFieldKind } from './types.js';

// Re-exported for the existing `features/intelligence/index.ts` barrel and any
// other importer; the implementation lives in the dependency-free leaf module.
export { buildSelectorHint };

export interface FieldMapEntry {
  kind: FormFieldKind;
  /** Relative CSS selector that worked */
  selector: string;
  /** Success count for ranking */
  hits: number;
  lastUsedAt: number;
}

export interface SiteFieldMap {
  domain: string;
  entries: FieldMapEntry[];
  updatedAt: number;
}

const KEY = 'siteFieldMaps_v1';
const MAX_DOMAINS = 100;
const MAX_ENTRIES = 40;

export async function loadAllFieldMaps(): Promise<Record<string, SiteFieldMap>> {
  try {
    const res = (await browser.storage.local.get([KEY])) as {
      [KEY]?: Record<string, SiteFieldMap>;
    };
    return res[KEY] || {};
  } catch {
    /* ignore */
    return {};
  }
}

export async function getFieldMap(domain: string): Promise<SiteFieldMap | null> {
  const d = normalizeDomain(domain);
  if (!d) return null;
  const all = await loadAllFieldMaps();
  return all[d] || null;
}

async function recordFieldMapHitInternal(
  domain: string,
  kind: string,
  selector: string
): Promise<void> {
  const d = normalizeDomain(domain);
  if (!d || kind === 'unknown') return;

  await withLock(LOCKS.FIELD_MAPS, async () => {
    const all = await loadAllFieldMaps();
    const now = Date.now();
    const map: SiteFieldMap = all[d] || { domain: d, entries: [], updatedAt: now };
    const existing = map.entries.find(
      (entry) => entry.kind === kind && entry.selector === selector
    );

    if (existing) {
      existing.hits += 1;
      existing.lastUsedAt = now;
    } else {
      map.entries.push({ kind: kind as FormFieldKind, selector, hits: 1, lastUsedAt: now });
    }

    map.entries.sort((a, b) => b.hits - a.hits || b.lastUsedAt - a.lastUsedAt);
    map.entries = map.entries.slice(0, MAX_ENTRIES);
    map.updatedAt = now;
    all[d] = map;

    // Cap domains by recency.
    const sorted = Object.values(all).sort((a, b) => b.updatedAt - a.updatedAt);
    const trimmed: Record<string, SiteFieldMap> = {};
    for (const entry of sorted.slice(0, MAX_DOMAINS)) trimmed[entry.domain] = entry;
    await writeWithRetry({ [KEY]: trimmed });
  });
}

export async function recordFieldMapHit(
  domain: string,
  kind: FormFieldKind,
  el: Element
): Promise<void> {
  await recordFieldMapHitInternal(domain, kind, buildSelectorHint(el));
}

/** Record a field map hit by selector string (for background handler - no DOM access needed). */
export async function recordFieldMapHitBySelector(
  domain: string,
  kind: string,
  selector: string
): Promise<void> {
  await recordFieldMapHitInternal(domain, kind, selector);
}

/** Replace the learned selector for a kind after an explicit user correction. */
export async function setFieldMapCorrectionBySelector(
  domain: string,
  kind: FormFieldKind,
  selector: string
): Promise<void> {
  const d = normalizeDomain(domain);
  if (!d || kind === 'unknown' || !selector || selector.length > 512) return;

  await withLock(LOCKS.FIELD_MAPS, async () => {
    const all = await loadAllFieldMaps();
    const now = Date.now();
    const map: SiteFieldMap = all[d] || { domain: d, entries: [], updatedAt: now };
    map.entries = map.entries.filter((entry) => entry.kind !== kind);
    map.entries.unshift({ kind, selector, hits: 1_000_000, lastUsedAt: now });
    map.entries = map.entries.slice(0, MAX_ENTRIES);
    map.updatedAt = now;
    all[d] = map;

    const sorted = Object.values(all).sort((a, b) => b.updatedAt - a.updatedAt);
    const trimmed: Record<string, SiteFieldMap> = {};
    for (const entry of sorted.slice(0, MAX_DOMAINS)) trimmed[entry.domain] = entry;
    await writeWithRetry({ [KEY]: trimmed });
  });
}

/** Resolve best known element for a kind on this domain within a root. */
export function resolveMappedField(
  root: ParentNode,
  map: SiteFieldMap | null,
  kind: FormFieldKind
): HTMLElement | null {
  if (!map) return null;
  const candidates = map.entries.filter((e) => e.kind === kind).sort((a, b) => b.hits - a.hits);
  for (const c of candidates) {
    try {
      const el = root.querySelector(c.selector);
      if (el instanceof HTMLElement) {
        // Must be fillable-ish
        if (
          el instanceof HTMLInputElement ||
          el instanceof HTMLSelectElement ||
          el instanceof HTMLTextAreaElement
        ) {
          return el;
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'SyntaxError') {
        /* invalid selector */
        continue;
      }
      throw e;
    }
  }
  return null;
}
