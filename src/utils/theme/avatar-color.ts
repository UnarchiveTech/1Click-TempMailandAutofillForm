/**
 * Dark-shaded avatar fills - saturated, high-contrast palette for letter
 * avatars. Replaces the pale Google pastels (#FDE293 / #F6BF26 etc.) which
 * looked washed / dull on both light and dark surfaces. White initials stay
 * AA-readable on all 7 swatches. Single source of truth: import these instead
 * of hardcoding per-view background colors.
 *
 * GOOGLE_AVATAR_HEX    → hex values (SVG data-URLs, default-avatar.ts)
 * GOOGLE_AVATAR_COLORS → literal Tailwind classes (JIT-safe, DOM avatars)
 */
export const GOOGLE_AVATAR_HEX = [
  '#C62828', // deep red
  '#EF6C00', // deep orange
  '#2E7D32', // deep green
  '#1565C0', // deep blue
  '#6A1B9A', // deep purple
  '#AD1457', // deep magenta
  '#6D4C00', // deep amber / brown
] as const;

/** Same dark palette as Tailwind classes with white initials (high contrast). */
export const GOOGLE_AVATAR_COLORS = [
  'bg-[#C62828] text-white',
  'bg-[#EF6C00] text-white',
  'bg-[#2E7D32] text-white',
  'bg-[#1565C0] text-white',
  'bg-[#6A1B9A] text-white',
  'bg-[#AD1457] text-white',
  'bg-[#6D4C00] text-white',
] as const;

/** Muted / read-state avatar shell - slightly darker than before so unread vs read pops */
export const AVATAR_MUTED = 'bg-md-surface-variant text-md-on-surface-variant';

/** Stable 16-bit hash - same seed always maps to the same avatar color. */
function avatarHash(email: string): number {
  let hash = 0;
  for (const character of email || '') {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) & 0xffff;
  }
  return hash;
}

/**
 * Stable hash of a seed (email / domain / name) → a Google-style avatar color.
 * Same email always maps to the same color so avatars stay consistent.
 */
export function avatarColor(email: string): string {
  return GOOGLE_AVATAR_COLORS[avatarHash(email) % GOOGLE_AVATAR_COLORS.length];
}
