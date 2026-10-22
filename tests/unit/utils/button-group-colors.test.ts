import { describe, expect, test } from 'bun:test';
import {
  contrast,
  hexToRgb,
  mix,
  readSource,
  THEME_NAMES,
  tokenOf,
} from '../helpers/theme-contrast.js';

const pairs = [
  ['primary', 'on-primary'],
  ['secondary', 'on-secondary'],
  ['tertiary', 'on-tertiary'],
  ['error', 'on-error'],
  ['surface', 'on-surface'],
  ['surface-container-high', 'on-surface'],
  ['surface', 'warning'],
] as const;

describe('ButtonGroup action colors', () => {
  for (const theme of THEME_NAMES) {
    test(`${theme}: label contrast survives idle, hover and press`, () => {
      for (const [background, foreground] of pairs) {
        const fill = hexToRgb(tokenOf(theme, `md-${background}`));
        const ink = hexToRgb(tokenOf(theme, `md-${foreground}`));
        for (const alpha of [0, 0.08, 0.12]) {
          expect(contrast(ink, mix(ink, fill, alpha))).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }

  test('shared feedback excludes disabled drop targets and uses ink overlays', () => {
    const css = readSource('src/styles/action-controls.css');
    expect(css).toMatch(/\.md-action:not\(:disabled\):not\(\[aria-disabled=['"]true['"]\]\):hover/);
    expect(css).toMatch(
      /\.md-action:not\(:disabled\):not\(\[aria-disabled=['"]true['"]\]\):active/
    );
    expect(css).toContain('currentColor 8%');
    expect(css).toContain('currentColor 12%');
    expect(css).not.toContain('filter:');
  });
});
