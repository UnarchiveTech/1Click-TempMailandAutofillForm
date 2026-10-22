import { describe, expect, it } from 'bun:test';
import { findTagEnd, parseAnchors, stripAnchors, stripTagSpans } from '@/utils/email/html-scan.js';

describe('parseAnchors', () => {
  it('returns href, inner HTML and exclusive span for a double-quoted anchor', () => {
    const html = 'x<a href="https://example.com/a">Hello</a>y';
    expect(parseAnchors(html)).toEqual([
      {
        href: 'https://example.com/a',
        hasHref: true,
        innerHtml: 'Hello',
        start: 1,
        end: html.length - 1,
      },
    ]);
  });

  it('accepts single-quoted and unquoted href values', () => {
    expect(parseAnchors(`<a href='https://a.example/x'>A</a>`)[0].href).toBe('https://a.example/x');
    expect(parseAnchors('<a href=https://b.example/y>B</a>')[0].href).toBe('https://b.example/y');
  });

  it('reports an anchor with no href but keeps its span', () => {
    const [anchor] = parseAnchors('<a>no href</a>');
    expect(anchor.hasHref).toBe(false);
    expect(anchor.href).toBe('');
    expect(anchor.innerHtml).toBe('no href');
  });

  it('finds the href when an EARLIER quoted attribute contains >', () => {
    // A `[^>]*` bound would cut the tag at the `>` inside `title`, hiding href.
    const [anchor] = parseAnchors('<a title="a>b" href="https://example.com/real">Real</a>');
    expect(anchor.href).toBe('https://example.com/real');
    expect(anchor.innerHtml).toBe('Real');
  });

  it('keeps href entity-encoded (callers decode exactly once)', () => {
    expect(parseAnchors('<a href="https://x.example/?a=1&amp;b=2">X</a>')[0].href).toBe(
      'https://x.example/?a=1&amp;b=2'
    );
  });

  it('reports closed anchors in order and skips an unterminated trailing one', () => {
    const anchors = parseAnchors(
      '<a href="https://one.example/a">One</a><a href="https://two.example/b">Two</a><a href="https://three.example/c">Three'
    );
    expect(anchors.map((a) => a.href)).toEqual(['https://one.example/a', 'https://two.example/b']);
    // Spans are disjoint and ascending.
    expect(anchors[0].end).toBeLessThanOrEqual(anchors[1].start);
  });

  it('returns nothing for a body of unterminated anchors', () => {
    expect(parseAnchors('<a href="'.repeat(500))).toEqual([]);
    expect(parseAnchors('')).toEqual([]);
    expect(parseAnchors('<p>plain</p>')).toEqual([]);
  });

  it('does not visit an <a> nested inside an already-consumed span', () => {
    const anchors = parseAnchors(
      '<a href="https://outer.example/">a<a href="https://in.example/">b</a>'
    );
    expect(anchors.map((a) => a.href)).toEqual(['https://outer.example/']);
  });
});

describe('stripAnchors', () => {
  it('replaces each closed anchor span with one space', () => {
    expect(stripAnchors('keep <a href="https://x.example/">X</a> tail')).toBe('keep   tail');
  });

  it('is the identity when there is nothing to strip', () => {
    const html = 'no anchors <p>here</p>';
    expect(stripAnchors(html)).toBe(html);
  });

  it('leaves an unterminated anchor in place so its bare URL stays visible', () => {
    const html = '<a href="https://leak.example/x">text ';
    expect(stripAnchors(html)).toBe(html);
  });
});

describe('findTagEnd', () => {
  it('ignores > inside quotes and skips a whole HTML comment', () => {
    // The `>` inside the quoted title is at index 11 and must be ignored; the
    // real tag end is the final `>` at index 14.
    expect(findTagEnd('<a title="a>b">', 0)).toBe(14);
    expect(findTagEnd('<!-- a > b -->', 0)).toBe(13);
    expect(findTagEnd('<a href="unterminated', 0)).toBe(-1);
  });
});

describe('stripTagSpans', () => {
  /** The regex the UI's body previews shipped with, kept as the oracle. */
  const reference = (html: string, replacement: string) => html.replace(/<[^>]*>/g, replacement);

  const CORPUS = [
    '',
    'plain text',
    '<p>a</p>\n\n  b <i>c</i>',
    '<>',
    '<><>',
    'a<>b',
    '<a<b>',
    '<<>',
    '<',
    'a<',
    'a>b<c',
    '5 &lt; 6 and <a href="#">link</a>',
    '<<<<>>>>',
    '<a href="x">y</a><br/><img src="z">',
    'nested <p>one <b>two</b></p> done',
  ];

  it('is byte-identical to the /<[^>]*>/g regex it replaces, both replacements', () => {
    for (const html of CORPUS) {
      expect([html, stripTagSpans(html, '')]).toEqual([html, reference(html, '')]);
      expect([html, stripTagSpans(html, ' ')]).toEqual([html, reference(html, ' ')]);
    }
  });

  it('stays linear where the regex is quadratic (no `>` in the body)', () => {
    // 200k `<` characters with no `>` is the shape the regex takes minutes on.
    const hostile = '<'.repeat(200_000);
    const started = Date.now();
    expect(stripTagSpans(hostile)).toBe(hostile);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
