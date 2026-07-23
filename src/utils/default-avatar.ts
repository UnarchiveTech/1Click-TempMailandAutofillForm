/**
 * Generate a lightweight SVG data-URL avatar for default identities.
 * No network; deterministic from seed string.
 */

const PALETTE = ['#4c662b', '#386663', '#586249', '#795900', '#6b4f2a', '#3d5a80', '#7b2d8e'];

function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Simple initials avatar as data:image/svg+xml */
export function generateDefaultAvatarDataUrl(seed: string, letter?: string): string {
  const ch = (letter || seed.trim()[0] || 'D').toUpperCase().slice(0, 1);
  const bg = PALETTE[hashSeed(seed || ch) % PALETTE.length];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">` +
    `<rect width="128" height="128" rx="64" fill="${bg}"/>` +
    `<text x="64" y="64" dy=".36em" text-anchor="middle" fill="#ffffff" ` +
    `font-family="system-ui,-apple-system,sans-serif" font-size="58" font-weight="700">${ch}</text>` +
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
