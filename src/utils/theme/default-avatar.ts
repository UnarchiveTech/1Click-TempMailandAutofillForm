/**
 * Generate a lightweight SVG data-URL avatar for default identities.
 * No network; deterministic from seed string.
 * Background colors come from the shared Google-style palette
 * (src/utils/theme/avatar-color.ts) so every avatar in the app looks consistent.
 */

import { GOOGLE_AVATAR_HEX } from '@/utils/theme/avatar-color.js';
import { avatarInitial } from '@/utils/theme/avatar-initials.js';

function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Escape the letter for embedding in the SVG XML - a raw `&`, `<`, `>` or
 * quote would produce a malformed data URL and the avatar would not render.
 */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Simple initials avatar as data:image/svg+xml */
export function generateDefaultAvatarDataUrl(seed: string, letter?: string): string {
  // Shared code-point-safe initial - charAt(0)/[0] would split an emoji/astral
  // first character into a lone surrogate and produce a broken glyph.
  const ch = avatarInitial(letter || seed, 'D');
  const bg = GOOGLE_AVATAR_HEX[hashSeed(seed || ch) % GOOGLE_AVATAR_HEX.length];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">` +
    `<rect width="128" height="128" rx="64" fill="${bg}"/>` +
    `<text x="64" y="64" dy=".36em" text-anchor="middle" fill="#ffffff" ` +
    `font-family="system-ui,-apple-system,sans-serif" font-size="58" font-weight="700">${escapeXml(ch)}</text>` +
    `</svg>`;
  // Prefer base64 for broad data-URL support in file inputs / img src
  try {
    if (typeof btoa === 'function') {
      return `data:image/svg+xml;base64,${btoa(svg)}`;
    }
  } catch {
    /* fall through */
  }
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
