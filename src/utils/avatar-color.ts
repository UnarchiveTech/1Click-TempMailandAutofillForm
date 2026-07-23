/**
 * MD3-only avatar fills - no Tailwind palette (pink/teal/etc.).
 * Hashes email → stable role so colors track theme / dark mode.
 */
export const MD3_AVATAR_COLORS = [
  'bg-md-primary text-md-on-primary',
  'bg-md-secondary text-md-on-secondary',
  'bg-md-tertiary text-md-on-tertiary',
  'bg-md-error text-md-on-error',
  'bg-md-primary-container text-md-on-primary-container',
  'bg-md-secondary-container text-md-on-secondary-container',
  'bg-md-tertiary-container text-md-on-tertiary-container',
  'bg-md-error-container text-md-on-error-container',
] as const;

/** Muted / read-state avatar shell */
export const MD3_AVATAR_MUTED = 'bg-md-outline-variant text-md-on-surface';

export function avatarColor(email: string): string {
  let hash = 0;
  const s = email || '';
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) & 0xffff;
  return MD3_AVATAR_COLORS[hash % MD3_AVATAR_COLORS.length];
}
