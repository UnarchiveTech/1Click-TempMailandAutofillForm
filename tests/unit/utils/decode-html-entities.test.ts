/**
 * Shared HTML-entity decoder (`src/utils/email/decode-html-entities.ts`).
 *
 * Regression root: two of the three former private copies used
 * `String.fromCharCode`, which silently DROPPED astral-plane characters -
 * any numeric entity above 0xFFFF (emoji in email subjects/labels) decoded
 * to ''. The canonical `otp.ts` copy used `String.fromCodePoint` with a
 * range guard; this utility unifies all three on that behavior.
 */

import { describe, expect, test } from 'bun:test';
import { decodeHtmlEntities } from '@/utils/email/decode-html-entities';

describe('decodeHtmlEntities', () => {
  test('decodes named entities', () => {
    expect(decodeHtmlEntities('a&amp;b&lt;c&gt;d&quot;e&#39;f&apos;g&#x27;h')).toBe(
      `a&b<c>d"e'f'g'h`
    );
  });

  test('decodes &nbsp; to a space', () => {
    expect(decodeHtmlEntities('a&nbsp;b')).toBe('a b');
  });

  test('regression: astral-plane decimal entities decode (no fromCharCode truncation)', () => {
    // 😀 = U+1F600 = &#128512;
    expect(decodeHtmlEntities('&#128512;')).toBe('\u{1F600}');
    expect(decodeHtmlEntities('Subject &#128512; here')).toBe('Subject \u{1F600} here');
  });

  test('regression: astral-plane hex entities decode', () => {
    // &#x1F600; / &#X1F600;
    expect(decodeHtmlEntities('&#x1F600;')).toBe('\u{1F600}');
    expect(decodeHtmlEntities('&#X1f600;')).toBe('\u{1F600}');
  });

  test('decodes BMP boundary code points', () => {
    expect(decodeHtmlEntities('&#65535;')).toBe('\uFFFF');
    expect(decodeHtmlEntities('&#65536;')).toBe('\u{10000}');
  });

  test('out-of-range numeric entities decode to empty (no NaN garbage, no throw)', () => {
    // 0x110000 and beyond are outside Unicode.
    expect(decodeHtmlEntities('&#1114112;')).toBe('');
    expect(decodeHtmlEntities('&#99999999999;')).toBe('');
  });

  test('lone surrogate halves decode to empty (fromCodePoint would throw)', () => {
    expect(decodeHtmlEntities('&#55296;')).toBe('');
    expect(decodeHtmlEntities('&#xD83D;')).toBe('');
    // A properly PAIRED surrogate encoding decodes to the character.
    expect(decodeHtmlEntities('&#128512;')).toBe('\u{1F600}');
  });

  test('leaves malformed references untouched', () => {
    expect(decodeHtmlEntities('&#128512 &#x1F600 &# 128512;')).toBe('&#128512 &#x1F600 &# 128512;');
  });

  test('URL semantics: a &amp;-encoded URL decodes to the real URL (single pass over named entities)', () => {
    // A single call decodes each entity present in the input, but does not
    // interpret a new entity reference produced while decoding &amp;.
    expect(decodeHtmlEntities('a&amp;b&lt;c')).toBe('a&b<c');
    expect(decodeHtmlEntities('&amp;lt;')).toBe('&lt;');
    expect(decodeHtmlEntities('&amp;#60;')).toBe('&#60;');
  });

  test('passes plain text through unchanged', () => {
    expect(decodeHtmlEntities('no entities here 123')).toBe('no entities here 123');
    expect(decodeHtmlEntities('')).toBe('');
  });
});
