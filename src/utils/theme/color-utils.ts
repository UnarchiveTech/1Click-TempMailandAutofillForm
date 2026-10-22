/**
 * Color utility functions
 */

/**
 * Convert RGB color string to hex format
 * Supports formats: rgb(r, g, b), rgba(r, g, b, a)
 *
 * @param rgb - RGB color string (e.g., "rgb(76, 102, 43)" or "rgba(76, 102, 43, 0.5)")
 * @returns Hex color string (e.g., "#4C662B") or fallback "#000000" if parsing fails
 *
 * @example
 * ```ts
 * rgbToHex("rgb(76, 102, 43)") // returns "#4C662B"
 * rgbToHex("#4C662B") // returns "#4C662B" (unchanged)
 * rgbToHex("var(--md-primary)") // returns "var(--md-primary)" (unchanged)
 * ```
 */
export function rgbToHex(rgb: string): string {
  if (!rgb) return '#000000';
  // If already hex or var(), return as-is
  if (rgb.startsWith('#') || rgb.startsWith('var(')) {
    return rgb;
  }

  // Parse rgb(r, g, b), rgba(r, g, b, a), rgb(r g b), rgba(r g b / a)
  // Percentages are also supported (e.g. 50%)
  const match = rgb.match(
    /rgba?\((\d+%?)\s*[,/]?\s*(\d+%?)\s*[,/]?\s*(\d+%?)(?:\s*[,/]?\s*[\d.]+%?)?\)/
  );
  if (!match) {
    return '#000000'; // Fallback to black if parsing fails
  }

  const parseVal = (val: string): number => {
    if (val.endsWith('%')) {
      return Math.round((parseFloat(val) * 255) / 100);
    }
    return parseInt(val, 10);
  };

  const r = Math.max(0, Math.min(255, parseVal(match[1])));
  const g = Math.max(0, Math.min(255, parseVal(match[2])));
  const b = Math.max(0, Math.min(255, parseVal(match[3])));

  return (
    '#' +
    [r, g, b]
      .map((x) => {
        const hex = x.toString(16);
        return hex.length === 1 ? `0${hex}` : hex;
      })
      .join('')
  );
}

/**
 * Shared color contrast helpers - single source of truth for tag/badge ink.
 * Previously duplicated in Badge.svelte, OrganizeView.svelte, AddressesView.svelte
 * with divergent thresholds. Unified to YIQ 128 threshold.
 */

/**
 * Return a high-contrast ink color (dark #1a1c16 vs light #ffffff) for a hex
 * background. Uses YIQ luminance (299,587,114) threshold 128000 (~128 after /1000).
 */
export function getContrastColor(hex: string): string {
  try {
    const cleanHex = hex.replace('#', '');
    const fullHex =
      cleanHex.length === 3
        ? cleanHex[0] + cleanHex[0] + cleanHex[1] + cleanHex[1] + cleanHex[2] + cleanHex[2]
        : cleanHex;
    const r = parseInt(fullHex.slice(0, 2), 16);
    const g = parseInt(fullHex.slice(2, 4), 16);
    const b = parseInt(fullHex.slice(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return '#ffffff';
    return r * 299 + g * 587 + b * 114 > 128000 ? '#1a1c16' : '#ffffff';
  } catch {
    return '#ffffff';
  }
}

/**
 * Tag ink as CSS variable - maps contrast hex to theme tokens so tags stay
 * readable in light/dark themes. Light bg → dark surface ink, dark bg → primary (light) ink.
 */
export function getTagInkColor(hex: string): string {
  const hexTrim = hex.trim();
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hexTrim)) return 'var(--md-on-primary)';
  const contrast = getContrastColor(hexTrim);
  return contrast === '#ffffff' ? 'var(--md-on-primary)' : 'var(--md-on-surface)';
}

/**
 * Convert a 3- or 6-digit hex color to an `rgba()` string with the given alpha
 * (0..1). Returns an empty string when `hex` is not a plain hex color, so
 * callers can fall back to their default classes.
 *
 * @example
 * ```ts
 * hexToRgba('#6750a4', 0.2) // returns "rgba(103, 80, 164, 0.2)"
 * hexToRgba('#fff', 0.5)    // returns "rgba(255, 255, 255, 0.5)"
 * hexToRgba('var(--x)', 0.5) // returns ""
 * ```
 */
export function hexToRgba(hex: string, alpha: number): string {
  const hexTrim = hex.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hexTrim);
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hexTrim);
  const match = short || long;
  if (!match) return '';
  const to255 = (v: string) => (v.length === 1 ? parseInt(v + v, 16) : parseInt(v, 16));
  const r = to255(match[1]);
  const g = to255(match[2]);
  const b = to255(match[3]);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Convert HSL (h in degrees 0..360, s/l as 0..1 fractions) to a `#rrggbb` hex
 * string. Used to derive deterministic label colors from hashes.
 *
 * @example
 * ```ts
 * hslToHex(0, 1, 0.5)   // returns "#ff0000"
 * hslToHex(120, 1, 0.5) // returns "#00ff00"
 * hslToHex(240, 1, 0.5) // returns "#0000ff"
 * ```
 */
/**
 * Convert a hex color to its hue in whole degrees (0..359).
 * Returns `null` for non-hex / malformed input so callers can exclude
 * invalid colors (e.g. from conflict-avoidance sampling) instead of
 * silently treating them as hue 0.
 */
export function hexToHue(hex: string): number | null {
  const clean = hex.trim().replace(/^#/, '');
  const expanded =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return null;
  const r = parseInt(expanded.slice(0, 2), 16) / 255;
  const g = parseInt(expanded.slice(2, 4), 16) / 255;
  const b = parseInt(expanded.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return null;
  let hue = 0;
  if (max === r) hue = 60 * (((g - b) / delta) % 6);
  else if (max === g) hue = 60 * ((b - r) / delta + 2);
  else hue = 60 * ((r - g) / delta + 4);
  return Math.round((hue + 360) % 360);
}

export function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(1, s));
  const light = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) {
    r = c;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = c;
  } else if (hue < 180) {
    g = c;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = c;
  } else if (hue < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
