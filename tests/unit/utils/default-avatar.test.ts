/**
 * Unit tests for SVG data-URL avatar generation (default-avatar.ts).
 *
 * Regression coverage:
 *  1. XML escaping - a name whose first char is `&`, `<`, etc. previously
 *     produced a malformed data URL that would not render.
 *  2. Code-point-safe letter extraction - emoji/astral initials must not be
 *     split into a lone surrogate.
 */
import { describe, expect, test } from 'bun:test';

import { generateDefaultAvatarDataUrl } from '@/utils/theme/default-avatar.js';

function decode(svgUrl: string): string {
  if (svgUrl.startsWith('data:image/svg+xml;base64,')) {
    const b64 = svgUrl.slice('data:image/svg+xml;base64,'.length);
    return Buffer.from(b64, 'base64').toString('utf8');
  }
  // Non-Latin1 letters (emoji) make btoa throw → URI-encoded fallback.
  expect(svgUrl.startsWith('data:image/svg+xml,')).toBe(true);
  return decodeURIComponent(svgUrl.slice('data:image/svg+xml,'.length));
}

describe('generateDefaultAvatarDataUrl', () => {
  test('uses the seed first letter by default and uppercases it', () => {
    const svg = decode(generateDefaultAvatarDataUrl('alice'));
    expect(svg).toContain('>A</text>');
  });

  test('explicit letter wins over the seed', () => {
    const svg = decode(generateDefaultAvatarDataUrl('bob', 'z'));
    expect(svg).toContain('>Z</text>');
  });

  test('empty seed falls back to D', () => {
    const svg = decode(generateDefaultAvatarDataUrl(''));
    expect(svg).toContain('>D</text>');
  });

  test('XML-special initials are escaped so the SVG stays well-formed', () => {
    for (const special of ['&', '<', '>', '"', "'"]) {
      const svg = decode(generateDefaultAvatarDataUrl(`x`, special));
      // The raw special char must NOT appear inside the <text> node.
      expect(svg.includes(`>${special}</text>`)).toBe(false);
    }
    const ampersand = decode(generateDefaultAvatarDataUrl('x', '&'));
    expect(ampersand).toContain('&amp;');
    expect(ampersand).toContain('</text>');
    const lt = decode(generateDefaultAvatarDataUrl('x', '<'));
    expect(lt).toContain('&lt;');
    expect(lt).toContain('</text>');
  });

  test('emoji initial is kept whole (no lone surrogate)', () => {
    const svg = decode(generateDefaultAvatarDataUrl('🌟Developer'));
    const text = svg.match(/font-weight="700">(.*?)<\/text>/)?.[1] ?? '';
    expect(Array.from(text)).toHaveLength(1);
    expect(text).toBe('🌟');
  });

  test('is deterministic for the same seed', () => {
    expect(generateDefaultAvatarDataUrl('same@x.com')).toBe(
      generateDefaultAvatarDataUrl('same@x.com')
    );
  });
});
