import { describe, expect, test } from 'bun:test';
import { CONTENT_DEFAULT_THEME_COLORS } from '@/utils/content/content-default-theme-colors.js';
import {
  DEFAULT_THEME_SEED,
  generateThemeColors,
  generateThemeColorsSync,
  generateThemeCSS,
} from '@/utils/theme/theme-generator.js';

describe('theme-generator', () => {
  test('generates valid light and dark CSS variables from seed color', async () => {
    const seedColor = '#3f51b5'; // Blue
    const theme = await generateThemeCSS(seedColor);

    expect(theme.light).toContain('[data-theme="custom"]');
    expect(theme.light).toContain('--md-primary');
    expect(theme.light).toContain('--md-secondary');

    expect(theme.dark).toContain('[data-theme="dark"]');
    expect(theme.dark).toContain('--md-primary');
    expect(theme.dark).toContain('--md-secondary');
  });

  test('contrastLevel adjusts primary, container, and surface tones', async () => {
    const seedColor = '#63A002'; // Green
    const standard = await generateThemeColors(seedColor, false, 0);
    const high = await generateThemeColors(seedColor, false, 1.0);

    // High contrast primary is darker than standard in light mode
    expect(high['--md-primary']).not.toEqual(standard['--md-primary']);
    expect(high['--md-on-surface']).not.toEqual(standard['--md-on-surface']);
    expect(high['--md-outline']).not.toEqual(standard['--md-outline']);

    const standardDark = await generateThemeColors(seedColor, true, 0);
    const highDark = await generateThemeColors(seedColor, true, 1.0);

    // High contrast primary is lighter than standard in dark mode
    expect(highDark['--md-primary']).not.toEqual(standardDark['--md-primary']);
    expect(highDark['--md-on-surface']).not.toEqual(standardDark['--md-on-surface']);
  });

  test('content-script default palette matches the solver for DEFAULT_THEME_SEED', () => {
    // The content script themes its shadow-DOM UI with this precomputed
    // palette instead of bundling the ~80 KB color solver. If the seed or the
    // palette mapping changes, regenerate the static module with:
    //   bun run generate-content-theme
    expect(CONTENT_DEFAULT_THEME_COLORS).toEqual(
      generateThemeColorsSync(DEFAULT_THEME_SEED, false, 0)
    );
    expect(Object.keys(CONTENT_DEFAULT_THEME_COLORS).length).toBeGreaterThan(30);
  });

  test('different seed colors generate distinct harmonious palettes', async () => {
    const blue = await generateThemeColors('#2563EB', false, 0);
    const red = await generateThemeColors('#DC2626', false, 0);

    expect(blue['--md-primary']).not.toEqual(red['--md-primary']);
    expect(blue['--md-primary-container']).not.toEqual(red['--md-primary-container']);
    expect(blue['--md-surface-variant']).not.toEqual(red['--md-surface-variant']);
  });
});
