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
