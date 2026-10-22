import { describe, expect, test } from 'bun:test';
import {
  getContrastColor,
  getTagInkColor,
  hexToRgba,
  hslToHex,
  rgbToHex,
} from '@/utils/theme/color-utils';

describe('rgbToHex', () => {
  test('converts rgb() to hex', () => {
    expect(rgbToHex('rgb(76, 102, 43)')).toBe('#4c662b');
  });

  test('converts rgba() to hex (ignores alpha)', () => {
    expect(rgbToHex('rgba(255, 0, 0, 0.5)')).toBe('#ff0000');
  });

  test('returns hex as-is if already hex', () => {
    expect(rgbToHex('#4C662B')).toBe('#4C662B');
  });

  test('returns lowercase hex', () => {
    expect(rgbToHex('#FF00AA')).toBe('#FF00AA');
  });

  test('returns var() as-is', () => {
    expect(rgbToHex('var(--md-primary)')).toBe('var(--md-primary)');
  });

  test('returns #000000 for unparseable input', () => {
    expect(rgbToHex('not-a-color')).toBe('#000000');
    expect(rgbToHex('')).toBe('#000000');
    expect(rgbToHex('blue')).toBe('#000000');
  });

  test('handles zero values', () => {
    expect(rgbToHex('rgb(0, 0, 0)')).toBe('#000000');
  });

  test('handles max values', () => {
    expect(rgbToHex('rgb(255, 255, 255)')).toBe('#ffffff');
  });

  test('handles single-digit hex padding', () => {
    // rgb(1, 2, 3) → #010203
    expect(rgbToHex('rgb(1, 2, 3)')).toBe('#010203');
  });

  test('handles mixed spacing in rgba', () => {
    expect(rgbToHex('rgba(10,20,30,0.8)')).toBe('#0a141e');
  });

  test('handles rgb with no alpha', () => {
    expect(rgbToHex('rgb(128, 64, 32)')).toBe('#804020');
  });

  test('handles percentage based values', () => {
    expect(rgbToHex('rgb(50%, 50%, 50%)')).toBe('#808080');
    expect(rgbToHex('rgba(100%, 0%, 0%, 0.5)')).toBe('#ff0000');
  });

  test('handles space-separated values', () => {
    expect(rgbToHex('rgb(128 64 32)')).toBe('#804020');
    expect(rgbToHex('rgba(255 0 0 / 0.5)')).toBe('#ff0000');
    expect(rgbToHex('rgb(50% 50% 50%)')).toBe('#808080');
  });
});

describe('hexToRgba', () => {
  test('converts 6-digit hex with alpha', () => {
    expect(hexToRgba('#6750a4', 0.2)).toBe('rgba(103, 80, 164, 0.2)');
  });

  test('expands 3-digit hex', () => {
    expect(hexToRgba('#fff', 0.5)).toBe('rgba(255, 255, 255, 0.5)');
    expect(hexToRgba('#0f0', 1)).toBe('rgba(0, 255, 0, 1)');
  });

  test('is case-insensitive', () => {
    expect(hexToRgba('#FF00AA', 0.1)).toBe('rgba(255, 0, 170, 0.1)');
  });

  test('returns empty string for non-hex input', () => {
    expect(hexToRgba('var(--md-primary)', 0.5)).toBe('');
    expect(hexToRgba('blue', 0.5)).toBe('');
    expect(hexToRgba('', 0.5)).toBe('');
  });
});

describe('hslToHex', () => {
  test('converts primary hues', () => {
    expect(hslToHex(0, 1, 0.5)).toBe('#ff0000');
    expect(hslToHex(120, 1, 0.5)).toBe('#00ff00');
    expect(hslToHex(240, 1, 0.5)).toBe('#0000ff');
  });

  test('converts secondary hues', () => {
    expect(hslToHex(60, 1, 0.5)).toBe('#ffff00');
    expect(hslToHex(180, 1, 0.5)).toBe('#00ffff');
    expect(hslToHex(300, 1, 0.5)).toBe('#ff00ff');
  });

  test('handles grayscale (zero saturation)', () => {
    expect(hslToHex(0, 0, 0)).toBe('#000000');
    expect(hslToHex(123, 0, 1)).toBe('#ffffff');
  });

  test('normalizes out-of-range values', () => {
    expect(hslToHex(360, 1, 0.5)).toBe('#ff0000');
    expect(hslToHex(-120, 1, 0.5)).toBe('#0000ff'); // -120° ≡ 240°
    expect(hslToHex(120, 2, 0.5)).toBe('#00ff00');
    expect(hslToHex(120, 1, 0)).toBe('#000000');
  });

  test('returns lowercase hex', () => {
    expect(hslToHex(0, 1, 0.5)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

/**
 * ONE ink rule for every tag chip - the pill, the dialog's own chips and the
 * address-list row all read `getTagInkColor`. These pin the rule itself, because a
 * chip that carries its own formula is how one tag ends up painted two ways: the
 * pill used a WCAG-luminance 0.45 threshold, which put WHITE ink on emerald while
 * the very same color got dark ink two pixels away.
 */
describe('getTagInkColor / getContrastColor', () => {
  test('a light fill gets the dark surface ink, a dark fill the light one', () => {
    expect(getTagInkColor('#F59E0B')).toBe('var(--md-on-surface)'); // Amber
    expect(getTagInkColor('#6366F1')).toBe('var(--md-on-primary)'); // Indigo
  });

  test('the whole palette is decided, with no color left to a second rule', () => {
    // The palette the tag dialog offers, in order. Pinning every one means a new
    // swatch cannot arrive without its ink being decided here first.
    const palette = [
      '#6366F1',
      '#EC4899',
      '#10B981',
      '#F59E0B',
      '#3B82F6',
      '#8B5CF6',
      '#EF4444',
      '#06B6D4',
    ];
    for (const color of palette) {
      expect(['var(--md-on-surface)', 'var(--md-on-primary)']).toContain(getTagInkColor(color));
    }
    // Emerald specifically: the pill's retired 0.45-luminance rule said WHITE here,
    // while dark ink is the readable one (≈6.8:1 versus ≈2.6:1).
    expect(getTagInkColor('#10B981')).toBe('var(--md-on-surface)');
  });

  test('an unparseable color falls back to the light ink rather than guessing', () => {
    expect(getTagInkColor('var(--x)')).toBe('var(--md-on-primary)');
    expect(getTagInkColor('not a color')).toBe('var(--md-on-primary)');
  });

  test('a 3-digit hex is read, not rejected', () => {
    // Dark ink on white, light ink on black - the right way round.
    expect(getTagInkColor('#fff')).toBe('var(--md-on-surface)');
    expect(getTagInkColor('#000')).toBe('var(--md-on-primary)');
  });

  test('getContrastColor returns the ink hexes it maps from', () => {
    expect(getContrastColor('#F59E0B')).toBe('#1a1c16');
    expect(getContrastColor('#6366F1')).toBe('#ffffff');
  });
});
