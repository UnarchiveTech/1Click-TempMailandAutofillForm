import { describe, expect, test } from 'bun:test';
import { rgbToHex } from '@/utils/color-utils';

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
