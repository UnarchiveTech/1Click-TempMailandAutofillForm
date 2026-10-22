import { describe, expect, test } from 'bun:test';
import {
  contrast,
  hexToRgb,
  mix,
  type Rgb,
  readSource,
  THEME_NAMES,
  tokenOf,
} from '../helpers/theme-contrast';

/**
 * The floating nav's selected segment must be legible against the GLASS island
 * in every theme - not just against the opaque MD3 surface the container token
 * is tuned for.
 *
 * This is a model-level guard, and deliberately so: the running app paints the
 * island as `color-mix(surface-container-high 32%, transparent)` over a
 * `backdrop-filter: blur(42px) saturate(1.8) brightness(1.08)` sample of the page,
 * and the pill as the opaque `secondary-container` on top. Those two composites
 * are what the eye actually compares, and no computed style exposes them - so
 * the arithmetic is done here, from the same tokens `src/styles/theme.css`
 * declares, for **all six themes** (a fix that reads well in `light-standard`
 * must not cost `light-medium`, which is how the fill-darkening alternative
 * failed at 3.45:1 label contrast).
 */

/** `filter: brightness()` then `saturate()` on the backdrop sample. */
const brightness = (rgb: Rgb, k: number): Rgb =>
  rgb.map((c) => Math.min(255, Math.round(c * k))) as Rgb;
const saturate = (rgb: Rgb, k: number): Rgb => {
  const l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return rgb.map((c) => Math.max(0, Math.min(255, Math.round(l + (c - l) * k)))) as Rgb;
};

/** The island's painted colour: 32% of the container token over a filtered page. */
const islandOf = (theme: string): Rgb =>
  mix(
    hexToRgb(tokenOf(theme, 'md-surface-container-high')),
    saturate(brightness(hexToRgb(tokenOf(theme, 'md-background')), 1.08), 1.8),
    0.32
  );

/** Reads the pill's own declarations so the guard tracks the real CSS. */
const footerSrc = readSource('src/ui/blocks/layout/Footer.svelte');
const pillBlock = (() => {
  const start = footerSrc.indexOf('\n  .pill-indicator {');
  return footerSrc.slice(start, footerSrc.indexOf('\n  }', start));
})();
const edgeAlpha = Number(
  pillBlock.match(/inset 0 0 0 1px color-mix\(in srgb, var\(--md-on-surface\) (\d+)%/)?.[1]
);

describe('floating nav - the selected segment is visible in every theme', () => {
  test('theme.css declares the six themes this guard covers', () => {
    expect(THEME_NAMES).toEqual([
      'light-standard',
      'dark-standard',
      'light-medium',
      'dark-medium',
      'light-high',
      'dark-high',
    ]);
  });

  test('the pill draws its edge in on-surface, not in the container role', () => {
    // `on-secondary-container` is tuned against the container itself, so on the
    // glass island it can land on the wrong side of the fill (measured: 2.68:1
    // in light-medium, below the fill's own 4.69:1). `on-surface` is always at
    // the far end of the theme's lightness range.
    expect(edgeAlpha).toBeGreaterThanOrEqual(18);
    expect(edgeAlpha).toBeLessThanOrEqual(28);
    expect(pillBlock).toContain('background-color: var(--md-secondary-container)');
  });

  test('the selection separates from the glass island in all six themes', () => {
    // Without the edge the pill has no declared separation at all - say so
    // rather than letting NaN comparisons quietly pass below.
    expect(Number.isFinite(edgeAlpha)).toBe(true);
    const failures: string[] = [];
    for (const theme of THEME_NAMES) {
      const island = islandOf(theme);
      const fill = hexToRgb(tokenOf(theme, 'md-secondary-container'));
      const edge = mix(hexToRgb(tokenOf(theme, 'md-on-surface')), fill, edgeAlpha / 100);
      const fillContrast = contrast(fill, island);
      const edgeContrast = contrast(edge, island);
      // Visible if EITHER the fill or its edge separates from the island.
      const visible = Math.max(fillContrast, edgeContrast);
      // 1.8 is the floor that the fill alone never reached in the two standard
      // themes (1.21 / 1.83 fill-only; 1.9 / 3.0 with the edge).
      if (visible < 1.8) {
        failures.push(
          `${theme}: fill ${fillContrast.toFixed(2)}:1, edge ${edgeContrast.toFixed(2)}:1 (max ${visible.toFixed(2)})`
        );
      }
    }
    expect(failures).toEqual([]);
  });

  test('the edge is an edge, not a second fill (it must not fight the label)', () => {
    for (const theme of THEME_NAMES) {
      const fill = hexToRgb(tokenOf(theme, 'md-secondary-container'));
      const edge = mix(hexToRgb(tokenOf(theme, 'md-on-surface')), fill, edgeAlpha / 100);
      // A hairline reads as a boundary while staying close to its own fill.
      expect(contrast(edge, fill)).toBeLessThan(2);
      // ...and the MD3 pairing's own label contrast must never be the casualty.
      expect(
        contrast(
          hexToRgb(tokenOf(theme, 'md-on-secondary-container')),
          hexToRgb(tokenOf(theme, 'md-secondary-container'))
        )
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('hover cannot be mistaken for the selection, nor repaint it', () => {
    // A wash on an inactive item is the SAME pill shape as the selection, and in
    // the standard themes it sits ~1.1:1 from the real fill - so the difference
    // has to be structural (the selection keeps its edge; hover does not) and the
    // active item must not be hovered at all.
    expect(footerSrc).toContain('.nav-item:hover:not(.active)');
    expect(footerSrc).toContain('.more-menu-item:hover:not(.active)');
    expect(footerSrc).not.toMatch(/\.nav-item:hover\s*\{/);
    expect(footerSrc).not.toMatch(/\.more-menu-item:hover\s*\{/);
    // The hover wash itself is a state layer, not a container: keep it faint.
    const hoverAlpha = footerSrc.match(
      /\.nav-item:hover:not\(\.active\) \{[^}]*on-surface-variant\) (\d+)%/
    )?.[1];
    expect(Number(hoverAlpha)).toBeLessThanOrEqual(10);
  });

  test('the selected segment is the only faint-pill candidate', () => {
    // Regression note for the reviewer: with the edge removed, light-standard
    // collapses back to the reported symptom (fill 1.21:1 vs the island, 1.07:1
    // vs an inactive item's hover wash) - which is exactly what this file pins.
    const theme = 'light-standard';
    const island = islandOf(theme);
    const fill = hexToRgb(tokenOf(theme, 'md-secondary-container'));
    expect(contrast(fill, island)).toBeLessThan(1.3);
    const hoverFill = mix(hexToRgb(tokenOf(theme, 'md-on-surface-variant')), island, 0.08);
    expect(contrast(hoverFill, fill)).toBeLessThan(1.2);
  });
});
