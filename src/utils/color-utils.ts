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
  // If already hex or var(), return as-is
  if (rgb.startsWith('#') || rgb.startsWith('var(')) {
    return rgb;
  }

  // Parse rgb(r, g, b) or rgba(r, g, b, a)
  const rgbMatch = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
  if (!rgbMatch) {
    return '#000000'; // Fallback to black if parsing fails
  }

  const r = parseInt(rgbMatch[1], 10);
  const g = parseInt(rgbMatch[2], 10);
  const b = parseInt(rgbMatch[3], 10);

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
