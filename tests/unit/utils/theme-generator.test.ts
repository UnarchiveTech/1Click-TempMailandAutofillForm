import { describe, expect, test } from 'bun:test';
import { generateThemeCSS } from '@/utils/theme-generator.js';

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
});
