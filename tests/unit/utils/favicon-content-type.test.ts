import { describe, expect, test } from 'bun:test';
import { normalizeFaviconContentType } from '@/utils/ui/favicon-content-type.js';

describe('normalizeFaviconContentType', () => {
  test('keeps real image MIME types', () => {
    expect(normalizeFaviconContentType('image/png')).toBe('image/png');
    expect(normalizeFaviconContentType('image/svg+xml')).toBe('image/svg+xml');
    expect(normalizeFaviconContentType('image/x-icon')).toBe('image/x-icon');
    expect(normalizeFaviconContentType('image/vnd.microsoft.icon')).toBe(
      'image/vnd.microsoft.icon'
    );
  });

  test('drops media-type parameters and normalizes case/whitespace', () => {
    expect(normalizeFaviconContentType('IMAGE/PNG; charset=binary')).toBe('image/png');
    expect(normalizeFaviconContentType('  image/webp  ')).toBe('image/webp');
  });

  test('collapses a non-image type to the generic icon type', () => {
    // The header is attacker-controlled: non-image bytes must never be cached
    // under their declared type in the favicon cache.
    expect(normalizeFaviconContentType('text/html')).toBe('image/x-icon');
    expect(normalizeFaviconContentType('application/octet-stream')).toBe('image/x-icon');
    expect(normalizeFaviconContentType('text/html; charset=utf-8')).toBe('image/x-icon');
    expect(normalizeFaviconContentType('image')).toBe('image/x-icon');
  });

  test('falls back to the generic icon type for a missing or empty header', () => {
    expect(normalizeFaviconContentType(null)).toBe('image/x-icon');
    expect(normalizeFaviconContentType(undefined)).toBe('image/x-icon');
    expect(normalizeFaviconContentType('')).toBe('image/x-icon');
    expect(normalizeFaviconContentType('   ')).toBe('image/x-icon');
  });
});
