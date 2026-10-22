import type { Address } from '@/utils/types.js';

export type AddressTagEntry = { name: string; color: string };

/** The color every tag falls back to when its entry carries none. Exported so
 *  callers (the tag dialog's color picker) cannot spell a second default. */
export const DEFAULT_TAG_COLOR = '#6366F1';

/** Get tags list for an account (v3.0.0 multi-tag schema). */
export function addressTagsList(account: Address | null | undefined): AddressTagEntry[] {
  if (!account || !Array.isArray(account.tags)) return [];
  return account.tags
    .filter((t) => t?.name?.trim())
    .map((t) => ({ name: t.name.trim(), color: t.color || DEFAULT_TAG_COLOR }));
}

/**
 * Both tag schemas on one account as name+color pairs, de-duplicated by
 * LOWER-CASED name (one address counts once per tag).
 *
 * `tags[]` first, then the legacy `tag`/`tagColor` mirror - which normally repeats
 * `tags[0]`, so the de-dupe is what stops one address being counted twice.
 */
function tagEntriesOf(account: Address | null | undefined): AddressTagEntry[] {
  if (!account) return [];
  const entries: AddressTagEntry[] = [];
  const seen = new Set<string>();
  const push = (name: string | undefined, color: string | undefined) => {
    const trimmed = name?.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    entries.push({ name: trimmed, color: color || DEFAULT_TAG_COLOR });
  };
  for (const entry of addressTagsList(account)) push(entry.name, entry.color);
  push(account.tag, account.tagColor);
  return entries;
}

/**
 * Every tag name in use across `addresses`, de-duplicated CASE-INSENSITIVELY
 * (first spelling wins) and ordered A→Z.
 *
 * One spelling per tag, because the tag dialog lists these as separate chips: a
 * case-sensitive `Set` shows `Banking` and `banking` as two different tags, which
 * reads as the same tag printed twice. Both schemas are read - `tags[]` and the
 * legacy single `tag` (which mirrors `tags[0]`, so the union cannot double-add).
 */
export function existingTagNames(addresses: readonly Address[]): string[] {
  const byLower = new Map<string, string>();
  for (const account of addresses) {
    for (const name of tagNamesOf(account)) {
      const lower = name.toLowerCase();
      if (!byLower.has(lower)) byLower.set(lower, name);
    }
  }
  return [...byLower.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * tag name (lower-cased) → the distinct address emails that carry it, sorted.
 *
 * This is what answers "which mail addresses use this tag?" - the hover info on
 * every existing tag in the tag dialog. Keyed by the lower-cased name so a
 * lookup cannot miss because of casing, and kept as emails (not ids) because
 * that is the only handle the user recognizes.
 */
export function buildTagAddressUsage(addresses: readonly Address[]): Record<string, string[]> {
  const usage = Object.create(null) as Record<string, string[]>;
  for (const account of addresses) {
    if (!account?.address) continue;
    for (const name of tagNamesOf(account)) {
      const lower = name.toLowerCase();
      const list = usage[lower] ?? [];
      if (!list.includes(account.address)) list.push(account.address);
      usage[lower] = list;
    }
  }
  for (const list of Object.values(usage)) list.sort((a, b) => a.localeCompare(b));
  return usage;
}

/**
 * The color of each tag, keyed by the LOWER-CASED name.
 *
 * A tag is ONE tag regardless of casing - `buildTagAddressUsage` folds case, and so
 * do `existingTagNames` and the merge - so it is one color too. A map keyed by the
 * exact spelling (`colors[a.tag] = a.tagColor`) lets `Banking` and `banking` carry a
 * different color each, so the same tag paints a different chip per row.
 *
 * The winner is the color the MOST addresses write, ties going to the first one
 * seen - the same "most-used wins, ties keep the first" rule `caseVariantTags` uses
 * to pick the spelling a merge keeps, so the color and the spelling are never
 * chosen by two different rules.
 */
/** How many addresses write ONE tag in one color, plus the first-seen order. */
type ColorTally = { order: string[]; counts: Map<string, number> };

/**
 * lower-cased tag name → the colors written for it, with how many addresses write
 * each - the single tally both `buildTagColors` (which keeps one color) and
 * `colorVariantTags` (which reports the tags that have more than one) read.
 */
function tagColorTallies(addresses: readonly Address[]): Map<string, ColorTally> {
  const tallies = new Map<string, ColorTally>();
  for (const account of addresses) {
    for (const entry of tagEntriesOf(account)) {
      const key = entry.name.toLowerCase();
      const color = entry.color || DEFAULT_TAG_COLOR;
      const tally = tallies.get(key) ?? { order: [], counts: new Map<string, number>() };
      if (!tally.order.includes(color)) tally.order.push(color);
      tally.counts.set(color, (tally.counts.get(color) ?? 0) + 1);
      tallies.set(key, tally);
    }
  }
  return tallies;
}

/** The color the MOST addresses write, ties going to the first one seen. */
function winningColor(tally: ColorTally): string {
  let winner = DEFAULT_TAG_COLOR;
  let most = -1;
  for (const color of tally.order) {
    const count = tally.counts.get(color) ?? 0;
    if (count > most) {
      most = count;
      winner = color;
    }
  }
  return winner;
}

export function buildTagColors(addresses: readonly Address[]): Record<string, string> {
  const result = Object.create(null) as Record<string, string>;
  for (const [key, tally] of tagColorTallies(addresses)) result[key] = winningColor(tally);
  return result;
}

/**
 * The color of `tag` in a `buildTagColors` map, or `undefined` when no address
 * carries it (so a caller can fall back to its own color). Case-insensitive,
 * matching how the map is keyed: a chip asking for `Banking` finds the color
 * stored under `banking`.
 */
export function tagColorFor(
  colors: Record<string, string>,
  tag: string | null | undefined
): string | undefined {
  const key = (tag ?? '').trim().toLowerCase();
  if (!key) return undefined;
  return colors[key];
}

/** One casing of a tag, with how many addresses write it that way. */
export type TagSpelling = { name: string; addressCount: number };

/** A tag written under more than one casing, and the spelling a merge keeps. */
export type CaseVariantTag = {
  /** The spelling to keep. */
  canonical: string;
  /** Every spelling in use, `canonical` first (then most-used, then A→Z). */
  spellings: TagSpelling[];
};

/** Every spelling written on one account, both schemas, WITHOUT case de-dupe. */
function tagSpellingsOn(account: Address | null | undefined): string[] {
  if (!account) return [];
  const names = addressTagsList(account).map((entry) => entry.name);
  const legacy = account.tag?.trim();
  if (legacy) names.push(legacy);
  return names;
}

/**
 * Tags that exist under more than one casing - `Banking` on one address and
 * `banking` on another.
 *
 * Case is not a tag identity anywhere else in the app: `existingTagNames` de-dupes
 * by lower case, `addressMatchesTagSearch` folds the query, and the tag dialog and
 * the address writer both match case-insensitively. So a case split reads as ONE
 * tag everywhere the user looks while the stored data really holds two - and the
 * Organize hub made that visible the worst way, as one card per casing that only a
 * rename could fix, except its duplicate-name guard refuses the rename. This is
 * the detection the merge action needs.
 */
export function caseVariantTags(
  addresses: readonly Address[],
  /**
   * Names that exist without an address (the tag catalog) - a spelling pair that
   * was created but never assigned is still a split worth collapsing.
   */
  extraNames: readonly string[] = []
): CaseVariantTag[] {
  /** lower-cased name → (exact spelling → address count), in first-seen order. */
  const byLower = new Map<string, Map<string, number>>();
  const record = (raw: string | undefined, countAddress: boolean): void => {
    const name = raw?.trim();
    if (!name) return;
    const lower = name.toLowerCase();
    let spellings = byLower.get(lower);
    if (!spellings) {
      spellings = new Map<string, number>();
      byLower.set(lower, spellings);
    }
    if (!spellings.has(name)) spellings.set(name, 0);
    if (countAddress) spellings.set(name, (spellings.get(name) ?? 0) + 1);
  };
  for (const account of addresses) {
    const seen = new Set<string>();
    for (const name of tagSpellingsOn(account)) {
      if (seen.has(name)) continue; // one address counts once per spelling
      seen.add(name);
      record(name, true);
    }
  }
  for (const name of extraNames) record(name, false);

  const groups: CaseVariantTag[] = [];
  for (const spellings of byLower.values()) {
    if (spellings.size < 2) continue;
    const list: TagSpelling[] = [...spellings.entries()].map(([name, addressCount]) => ({
      name,
      addressCount,
    }));
    // The merge target is the spelling the most addresses already write, so the
    // fewest addresses are renamed. Ties keep the FIRST spelling seen - the one
    // `existingTagNames` shows - so the merge cannot move the tag under the user.
    let canonical = '';
    let mostUsed = -1;
    for (const spelling of list) {
      if (spelling.addressCount > mostUsed) {
        mostUsed = spelling.addressCount;
        canonical = spelling.name;
      }
    }
    groups.push({
      canonical,
      spellings: [
        ...list.filter((spelling) => spelling.name === canonical),
        ...list
          .filter((spelling) => spelling.name !== canonical)
          // Count first, then a plain code-unit compare: `localeCompare` folds
          // casings together and then orders them by the RUNTIME locale, which
          // would make the list (and any test of it) environment-dependent. This
          // list is only ever read out to the user, so determinism wins.
          .sort((a, b) => b.addressCount - a.addressCount || (a.name < b.name ? -1 : 1)),
      ],
    });
  }
  return groups.sort((a, b) => a.canonical.localeCompare(b.canonical));
}

/**
 * Every address carrying `canonical`'s tag rewritten to `canonical`'s spelling.
 *
 * - Case-variants collapse to the one spelling. With `color` given, every merged
 *   entry takes it - so the merge cannot leave one tag written in two colors;
 *   without it, each address keeps the color it already had.
 * - An address that somehow holds two casings of the same tag ends with ONE
 *   entry: the whole point of the merge is that a tag is one tag.
 * - The legacy `tag`/`tagColor` mirror follows `tags[0]`, exactly as
 *   `applyTagToAddresses` / `addressWithTags` in the Organize view write it, so
 *   both schemas stay in step.
 *
 * Unaffected addresses come back as the SAME object, so a caller can tell whether
 * anything needs persisting at all:
 * `next.some((account, i) => account !== addresses[i])`.
 */
/**
 * Rewrite the entries of ONE tag - matched by lower-cased name, in both schemas -
 * on every address that carries it.
 *
 * `rewrite` gets that address's `tags[]` and returns the new list:
 * `mergeTagSpellings` collapses the spellings with it, `unifyTagColors` recolors
 * them. Sharing the walk is what keeps the two from disagreeing about which
 * addresses count as carriers, which entries collapse, or how the legacy
 * `tag`/`tagColor` mirror follows `tags[0]`.
 *
 * An address nothing changes on comes back as the SAME object, so a caller can tell
 * whether anything needs persisting:
 * `next.some((account, i) => account !== addresses[i])`.
 */
function rewriteTag(
  addresses: Address[],
  tag: string,
  rewrite: (entries: AddressTagEntry[], account: Address) => AddressTagEntry[]
): Address[] {
  const lower = tag.trim().toLowerCase();
  if (!lower) return addresses;
  const matches = (name: string | undefined): boolean =>
    (name ?? '').trim().toLowerCase() === lower;
  return addresses.map((account) => {
    const tags = addressTagsList(account);
    const inList = tags.some((entry) => matches(entry.name));
    const inLegacy = matches(account.tag);
    if (!inList && !inLegacy) return account;

    const next = rewrite(tags, account);
    const first = next[0];
    const unchanged =
      next.length === tags.length &&
      next.every(
        (entry, index) => entry.name === tags[index]?.name && entry.color === tags[index]?.color
      ) &&
      account.tag === first?.name &&
      account.tagColor === first?.color;
    return unchanged
      ? account
      : { ...account, tags: next, tag: first?.name, tagColor: first?.color };
  });
}

export function mergeTagSpellings(
  addresses: Address[],
  canonical: string,
  /**
   * The color every merged entry takes - `buildTagColors(...)`'s answer for this
   * tag. Omitted means each address keeps the color it already had, which is what
   * lets a merge leave a tag written in two colors.
   */
  color?: string
): Address[] {
  const target = canonical.trim();
  if (!target) return addresses;
  const isVariant = (name: string | undefined): boolean =>
    (name ?? '').trim().toLowerCase() === target.toLowerCase();
  return rewriteTag(addresses, target, (tags, account) => {
    const inList = tags.some((entry) => isVariant(entry.name));
    const next: AddressTagEntry[] = [];
    let merged = false;
    for (const entry of tags) {
      if (!isVariant(entry.name)) {
        next.push(entry);
        continue;
      }
      if (merged) continue; // a second casing on the same address collapses away
      merged = true;
      next.push({ name: target, color: color || entry.color || DEFAULT_TAG_COLOR });
    }
    // The tag lived only on the legacy `tag` field - append rather than prepend,
    // so the address's primary tag (tags[0]) is not re-ordered by the merge.
    if (!inList) next.push({ name: target, color: color || account.tagColor || DEFAULT_TAG_COLOR });
    return next;
  });
}

/** One color a tag is written in, with how many addresses write it that way. */
export type TagColorUse = { color: string; addressCount: number };

/** A tag its addresses DISAGREE on the color of, and the color a cleanup keeps. */
export type ColorVariantTag = {
  /** The tag, in its first-seen spelling. */
  tag: string;
  /** The color to keep - the one the most addresses write (`buildTagColors`). */
  color: string;
  /** Every color in use, the kept one first, then by how many addresses write it. */
  colors: TagColorUse[];
};

/**
 * Tags whose addresses write them in more than one color.
 *
 * The color counterpart of `caseVariantTags`: `buildTagColors` paints such a tag in
 * ONE color everywhere, so the stored disagreement is invisible until a cleanup -
 * which is the state this detects, and the rule it reports is the very rule the
 * chips already render by (most-used wins, ties keep the first seen), so the card
 * and the fix can never disagree about which color survives.
 */
export function colorVariantTags(addresses: readonly Address[]): ColorVariantTag[] {
  const variants: ColorVariantTag[] = [];
  for (const [key, tally] of tagColorTallies(addresses)) {
    if (tally.order.length < 2) continue;
    const canonical = winningColor(tally);
    const use = (color: string): TagColorUse => ({
      color,
      addressCount: tally.counts.get(color) ?? 0,
    });
    const others = tally.order
      .filter((color) => color !== canonical)
      // Count first, then first-seen order: a deterministic list, never one ordered
      // by the runtime locale.
      .map(use)
      .sort((a, b) => b.addressCount - a.addressCount);
    variants.push({
      tag: key,
      color: canonical,
      colors: [use(canonical), ...others],
    });
  }
  return variants.sort((a, b) => a.tag.localeCompare(b.tag));
}

/**
 * Every address that carries `tag` rewritten to write it in `color`.
 *
 * The complement of `mergeTagSpellings`: the SPELLINGS are left exactly as they
 * are, only the color changes - including on an entry spelled differently, since a
 * tag is one tag regardless of casing. Addresses that already write the color, and
 * addresses without the tag, come back as the SAME object.
 */
export function unifyTagColors(addresses: Address[], tag: string, color: string): Address[] {
  const target = tag.trim();
  if (!target || !color) return addresses;
  const isSame = (name: string | undefined): boolean =>
    (name ?? '').trim().toLowerCase() === target.toLowerCase();
  // No `account` in this rewrite: only the entry's color changes here.
  return rewriteTag(addresses, target, (tags) => {
    const inList = tags.some((entry) => isSame(entry.name));
    const next = tags.map((entry) => (isSame(entry.name) ? { ...entry, color } : entry));
    // A tag living only on the legacy field has no `tags[]` entry to recolor, so the
    // mirror is written with it - the same shape `mergeTagSpellings` produces.
    if (!inList) next.push({ name: target, color });
    return next;
  });
}

/**
 * The `$t` shape - svelte-i18n's component formatter (options object with
 * `values`), the same shape `@/utils/errors.js` calls `UiTranslate`. Declared
 * here so a tag's hover text can be built without importing a UI module.
 */
type TagTranslate = (key: string, options: { values: Record<string, string | number> }) => string;

/**
 * The addresses that carry `tag`, looked up in a `buildTagAddressUsage` map.
 *
 * Keyed by the lower-cased name - the same key the map is built with - so a chip
 * can never miss because the tag is written `Banking` on one address and
 * `banking` on another.
 */
export function tagUsageEmails(
  usage: Record<string, string[]>,
  tag: string | null | undefined
): string[] {
  const key = (tag ?? '').trim().toLowerCase();
  if (!key) return [];
  return usage[key] ?? [];
}

/**
 * The hover detail for a tag - the addresses that carry it, rendered through
 * `tagManagement.usedBy` - or `undefined` when the tag is on no address yet, so a
 * caller shows NO tooltip rather than an empty "Used by:".
 *
 * ONE formatter for a tag's usage. The tag chip, the Organize hub card and the tag
 * dialog all hover through this, so the three cannot word the same tag
 * differently or name different addresses for it.
 */
export function tagUsedByLabel(
  t: TagTranslate,
  usage: Record<string, string[]>,
  tag: string | null | undefined
): string | undefined {
  const addresses = tagUsageEmails(usage, tag);
  if (addresses.length === 0) return undefined;
  return t('tagManagement.usedBy', { values: { addresses: addresses.join(', ') } });
}

/**
 * How many addresses carry ANY of `tags` - the reach of one edit that touches
 * several tags at once (a color pick rewrites every address carrying any of the
 * selected tags, so this is how many addresses move).
 *
 * An address carrying two of the tags counts ONCE: the edit moves that address,
 * not the pair. Casing is folded through `tagUsageEmails` - the same lookup the
 * chips' own counts use - so selecting `Banking` and `banking` (one tag, two
 * spellings) cannot count the same address twice. Tags nothing carries contribute
 * nothing, so the result can be 0.
 */
export function tagReachCount(usage: Record<string, string[]>, tags: readonly string[]): number {
  const reached = new Set<string>();
  for (const tag of tags) {
    for (const email of tagUsageEmails(usage, tag)) reached.add(email);
  }
  return reached.size;
}

/**
 * What a tag chip shows about a tag: how many addresses carry it, and the hover
 * detail naming them.
 */
export type TagUsage = {
  /** Number of distinct addresses carrying the tag (0 → no chip count). */
  count: number;
  /** `tagManagement.usedBy` with the addresses filled in. */
  label: string;
};

/**
 * The full usage of one tag, or `null` when nothing carries it.
 *
 * Count and hover text come out together from ONE helper on purpose: the chip's
 * number and the addresses it lists are the same fact, and computing them in two
 * places is how a chip ends up claiming "3" while hovering it names two addresses.
 */
export function tagUsageInfo(
  t: TagTranslate,
  usage: Record<string, string[]>,
  tag: string | null | undefined
): TagUsage | null {
  const emails = tagUsageEmails(usage, tag);
  if (emails.length === 0) return null;
  return {
    count: emails.length,
    label: t('tagManagement.usedBy', { values: { addresses: emails.join(', ') } }),
  };
}

/** Both tag schemas on one account, in `tags[]` order, de-duped case-insensitively. */
function tagNamesOf(account: Address | null | undefined): string[] {
  return tagEntriesOf(account).map((entry) => entry.name);
}

/** True if any tag name matches (case-insensitive substring). */
export function addressMatchesTagSearch(account: Address, search: string): boolean {
  if (!search) return true;
  const q = search.toLowerCase();
  return addressTagsList(account).some((t) => t.name.toLowerCase().includes(q));
}
