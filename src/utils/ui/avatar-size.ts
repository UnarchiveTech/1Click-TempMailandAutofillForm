/**
 * The avatar size scale - the single home of every letter-avatar and favicon size.
 *
 * Every avatar in the app (`Avatar.svelte`, `FaviconImage.svelte`, and the few
 * discs that render a profile picture or a raw favicon `<img>`) states its size
 * as a TIER from this table, never as a raw px number and never as a `w-N h-N`
 * pair invented at the call site. The tier carries both what the component
 * needs (px, for the letter's font ratio and the Google-favicon request size)
 * and what a surrounding wrapper needs (`AVATAR_BOX`), so the two cannot
 * disagree.
 *
 * Why: before this table the same visual role shipped at eight different sizes.
 * The leading avatar of a *list row* alone was 35px in the mailbox, 36px in the
 * addresses list, 40px on the identity row and 28px in the mailbox's grouped
 * list; `size={35}` sat inside a `w-9 h-9` box (35 declared, 36 painted) because
 * a `w-*` class on the component suppresses the inline size style; and a favicon
 * in the address detail's usage map declared `size={16}` inside a `w-5 h-5` box
 * while painting `w-3.5 h-3.5` - three numbers, one 14px icon. A number at a
 * call site cannot be checked; a tier can (`bun run check-avatar-sizes`).
 *
 * Tiers (all are exact Tailwind spacing steps - `w-N` is N × 4px, so `AVATAR_BOX`
 * is derived from the px value and the test proves it):
 *
 * | tier  | px | role                                                                 |
 * |-------|----|----------------------------------------------------------------------|
 * | `xs`  | 16 | inline inside a text line: filter chips, provider pills, strips        |
 * | `sm`  | 20 | inline metadata: a message's sender, usage-map favicons, credits       |
 * | `md`  | 24 | overlapping sender stacks, and the favicon inside a 24px padded disc   |
 * | `lg`  | 28 | compact rows and strips: grouped mail rows, OTP/autofill strips, menus |
 * | `xl`  | 32 | the address card and the panel-header avatar                           |
 * | `row` | 36 | THE list-row avatar - one size for every list row                      |
 *
 * The one rule that matters most: **a list row's leading avatar is `row`** -
 * mailbox rows (both renderings), address rows, identity rows and saved-login
 * rows all take `row`, so two lists cannot show two sizes for the same thing.
 */

/** The rendered box of every avatar/favicon, in px, per tier. */
export const AVATAR_TIERS = {
  xs: 16,
  sm: 20,
  md: 24,
  lg: 28,
  xl: 32,
  row: 36,
} as const;

export type AvatarTier = keyof typeof AVATAR_TIERS;

/** Every tier, in ascending size order. */
export const AVATAR_TIER_NAMES = Object.keys(AVATAR_TIERS) as AvatarTier[];

/** The tier an avatar takes when a caller does not name one. */
export const DEFAULT_AVATAR_TIER: AvatarTier = 'sm';

/** Is this string a tier? Used by the size gate and by runtime tier lookups. */
export function isAvatarTier(value: unknown): value is AvatarTier {
  return typeof value === 'string' && AVATAR_TIER_NAMES.includes(value as AvatarTier);
}

/** The px box of a tier - the letter's font ratio and the favicon request size. */
export function avatarPx(tier: AvatarTier = DEFAULT_AVATAR_TIER): number {
  return AVATAR_TIERS[tier];
}

/**
 * The Tailwind box for a wrapper that must be exactly a tier's box - a flip-card
 * layer, a placeholder disc, a stack item. Every value is `w-<px/4> h-<px/4>`;
 * `tests/unit/utils/avatar-size.test.ts` recomputes each one, so a tier cannot
 * ship a box that is not its own size.
 */
export const AVATAR_BOX: Record<AvatarTier, string> = {
  xs: 'w-4 h-4', // 16
  sm: 'w-5 h-5', // 20
  md: 'w-6 h-6', // 24
  lg: 'w-7 h-7', // 28
  xl: 'w-8 h-8', // 32
  row: 'w-9 h-9', // 36
};

/**
 * The glyph inside an avatar box - a check tick on a selected row, a `person`
 * fallback, an alert triangle, a `+N` count. Sized from the same scale as the
 * box it sits in, so the tick in a 36px avatar is one size app-wide instead of
 * `w-4` in one view and `w-5` in the next.
 */
export const AVATAR_INK: Record<AvatarTier, string> = {
  xs: 'w-2 h-2', // 8
  sm: 'w-3 h-3', // 12
  md: 'w-3.5 h-3.5', // 14
  lg: 'w-4 h-4', // 16
  xl: 'w-4 h-4', // 16
  row: 'w-5 h-5', // 20
};
