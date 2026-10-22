/**
 * Email label catalog - the source of truth for label colors.
 *
 * Mirrors the address-tag catalog (`mailboxTagCatalog`): labels are defined as
 * `{ name, color }` entries persisted under `emailLabelCatalog`.
 */
import { browser } from 'wxt/browser';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import { hslToHex } from '@/utils/theme/color-utils.js';

export interface EmailLabelDef {
  name: string;
  color: string;
}

/** FNV-1a 32-bit hash - deterministic, fast, good avalanche for short strings. */
function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Derive a stable, distinct color for a label name that has no catalog color.
 * Same name always yields the same color (case-insensitive); different names
 * are spread across the hue wheel using golden-angle spacing so they stay
 * visually distinguishable without user input.
 */
export function hashLabelColor(name: string): string {
  const seed = hashString(name.trim().toLowerCase());
  const hue = (seed * 137.508) % 360; // golden angle ≈ 137.508°
  return hslToHex(hue, 0.68, 0.45);
}

function isValidEntry(value: unknown): value is EmailLabelDef {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string' &&
    (value as { name: string }).name.trim().length > 0 &&
    typeof (value as { color?: unknown }).color === 'string'
  );
}

function filterValid(raw: unknown): EmailLabelDef[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidEntry);
}

/** Read the persisted label catalog. */
export async function getEmailLabelCatalog(): Promise<EmailLabelDef[]> {
  try {
    const { emailLabelCatalog } = (await browser.storage.local.get(['emailLabelCatalog'])) as {
      emailLabelCatalog?: unknown;
    };
    return filterValid(emailLabelCatalog);
  } catch {
    return [];
  }
}

/** Persist the label catalog. */
export async function setEmailLabelCatalog(defs: EmailLabelDef[]): Promise<void> {
  await writeWithRetry({ emailLabelCatalog: defs.filter(isValidEntry) });
}

/**
 * Resolve a label's color (case-insensitive) from the catalog, falling back to a
 * stable hash-derived color for labels that are not yet in the catalog.
 */
export function labelColorFor(defs: EmailLabelDef[], name: string): string {
  const lower = name.toLowerCase();
  for (const def of defs) {
    if (def.name.toLowerCase() === lower) return def.color;
  }
  return hashLabelColor(name);
}

/**
 * Merge any of `names` that are not already in the catalog, assigning each a
 * stable hash-derived color. Returns the new catalog (not persisted - callers
 * persist when they choose). Used by the label dialogs so ad-hoc labels render
 * colored; callers may override the assigned color afterwards.
 */
export function mergeLabelsIntoCatalog(defs: EmailLabelDef[], names: string[]): EmailLabelDef[] {
  const known = new Set(defs.map((d) => d.name.toLowerCase()));
  const merged = defs.slice();
  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed || known.has(trimmed.toLowerCase())) continue;
    merged.push({ name: trimmed, color: hashLabelColor(trimmed) });
    known.add(trimmed.toLowerCase());
  }
  return merged;
}
