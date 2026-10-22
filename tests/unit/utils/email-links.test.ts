import { describe, expect, test } from 'bun:test';
import {
  extractEmailLinks,
  extractLinksFromEmail,
  isSocialMediaLink,
  linkifyHtmlBareUrls,
  splitEmailLinks,
} from '@/utils/email/email-links.js';

describe('separate media links', () => {
  test('recognizes extensionless responsive image sources without fetching them', () => {
    const result = splitEmailLinks({
      body_html:
        '<picture><source srcset="https://cdn.test/small 1x, https://cdn.test/large 2x"></picture>',
    });
    expect(result.links).toEqual([]);
    expect(result.media.map((link) => link.url)).toEqual([
      'https://cdn.test/small',
      'https://cdn.test/large',
    ]);
  });
  test('separates media by pathname and embedded source without fetching', () => {
    const result = splitEmailLinks({
      body_html:
        '<a href="https://site.test/account">Account<img src="https://cdn.test/opaque?id=1"></a><video src="https://cdn.test/movie" poster="https://cdn.test/poster"></video>',
      body_plain:
        'https://cdn.test/photo.PNG?token=a https://cdn.test/audio.mp3 https://site.test/?next=photo.png',
    });
    expect(result.links.map((link) => link.url)).toEqual([
      'https://site.test/account',
      'https://site.test/?next=photo.png',
    ]);
    expect(result.media.map((link) => link.url)).toEqual([
      'https://cdn.test/movie',
      'https://cdn.test/poster',
      'https://cdn.test/photo.PNG?token=a',
      'https://cdn.test/audio.mp3',
      'https://cdn.test/opaque?id=1',
    ]);
  });
  test('keeps attachments separate and rejects executable or relative media sources', () => {
    const result = splitEmailLinks({
      body_html:
        '<img src="javascript:alert(1)"><img src="/local.png"><img src="https://cdn.test/file.png">',
      attachments: [{ downloadUrl: 'https://cdn.test/file.png' }],
    });
    expect(result).toEqual({ links: [], media: [] });
  });
});

describe('social destination classification', () => {
  test('recognizes platform hosts and subdomains, retaining every extracted link', () => {
    const links = extractEmailLinks({
      bodyPlain:
        'https://www.instagram.com/shop https://m.youtube.com/watch?v=1 https://shop.example/receipt',
    });
    expect(links.map(isSocialMediaLink)).toEqual([true, true, false]);
  });

  test('does not trust labels, suffix lookalikes or redirect query parameters', () => {
    for (const url of [
      'https://notfacebook.com/',
      'https://facebook.com.evil.example/',
      'https://example.com/?next=https://x.com',
    ]) {
      expect(isSocialMediaLink({ url, label: 'Facebook', host: 'facebook.com' })).toBe(false);
    }
    expect(isSocialMediaLink({ url: 'invalid', label: 'X', host: 'x.com' })).toBe(false);
  });
});

describe('extractEmailLinks', () => {
  test('extracts anchor links with anchor-text labels', () => {
    const links = extractEmailLinks({
      bodyHtml:
        '<p>Hi! <a href="https://example.com/confirm?token=abc">Confirm your email</a> or ' +
        '<a href="https://other.org/login">Sign in</a></p>',
    });
    expect(links).toHaveLength(2);
    expect(links[0]).toEqual({
      url: 'https://example.com/confirm?token=abc',
      label: 'Confirm your email',
      host: 'example.com',
    });
    expect(links[1].url).toBe('https://other.org/login');
    expect(links[1].label).toBe('Sign in');
  });

  test('extracts bare URLs from plain text', () => {
    const links = extractEmailLinks({
      bodyPlain: 'Visit https://example.com/docs and https://blog.example.com/post',
    });
    expect(links).toHaveLength(2);
    expect(links[0].url).toBe('https://example.com/docs');
    expect(links[1].host).toBe('blog.example.com');
  });

  test('extracts bare URLs from HTML that has no anchors', () => {
    const links = extractEmailLinks({
      bodyHtml: '<p>Go to https://example.com now</p>',
    });
    expect(links).toHaveLength(1);
    // URL canonicalization adds the trailing slash for the root path.
    expect(links[0].url).toBe('https://example.com/');
  });

  test('dedupes the same URL across sources', () => {
    const links = extractEmailLinks({
      bodyHtml: '<a href="https://example.com/a">A</a> https://example.com/a',
      bodyPlain: 'https://example.com/a',
    });
    expect(links).toHaveLength(1);
  });

  test('anchor text wins over bare-URL label', () => {
    const links = extractEmailLinks({
      bodyHtml: '<a href="https://example.com/a">Click here</a> https://example.com/a',
    });
    expect(links[0].label).toBe('Click here');
  });

  test('skips non-http(s) schemes and mailto links', () => {
    const links = extractEmailLinks({
      bodyHtml:
        '<a href="mailto:hi@example.com">Email us</a> <a href="tel:+123">Call</a> ' +
        '<a href="data:text/plain,hi">Data</a> https://example.com/ok',
      bodyPlain: 'ftp://example.com/file',
    });
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe('https://example.com/ok');
  });

  test('relative hrefs are dropped', () => {
    const links = extractEmailLinks({
      bodyHtml: '<a href="/local/page">Local</a> <a href="https://example.com/x">X</a>',
    });
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe('https://example.com/x');
  });

  test('strips tags from anchor labels and decodes entities', () => {
    const links = extractEmailLinks({
      bodyHtml:
        '<a href="https://example.com/a"><b>Bold</b> &amp; <i>italic</i></a> ' +
        '<a href="https://example.com/b">A &quot;quoted&quot; link</a>',
    });
    expect(links[0].label).toBe('Bold & italic');
    expect(links[1].label).toBe('A "quoted" link');
  });

  test('trailing punctuation is trimmed from bare URLs', () => {
    const links = extractEmailLinks({
      bodyPlain: 'See https://example.com/page, and also https://example.com/other!',
    });
    expect(links[0].url).toBe('https://example.com/page');
    expect(links[1].url).toBe('https://example.com/other');
  });

  test('strips www. prefix from display host', () => {
    const links = extractEmailLinks({
      bodyHtml: '<a href="https://www.example.com/a">A</a>',
    });
    expect(links[0].host).toBe('example.com');
  });

  test('empty input yields no links', () => {
    expect(extractEmailLinks({})).toHaveLength(0);
    expect(extractEmailLinks({ bodyHtml: '<p>no links</p>' })).toHaveLength(0);
  });

  /**
   * ReDoS regression. The anchor walk used to be ONE regex,
   * /<a\b([^>]*)\bhref…[^>]*>([\s\S]*?)<\/a>/gi, whose greedy `[^>]*` ran to
   * end-of-input on every `<a` when the body held no `>`, then backtracked
   * cubically. A 28.8 KB body of '<a href="' repeats blocked the calling
   * thread for 126 SECONDS (measured) - and it runs inside MailView's
   * `$derived`, synchronously, over the RAW body of every message in the
   * thread, so any sender could freeze the whole UI. The bound below is ~1000x
   * the fixed per-body cost, so it rejects the blowup without being
   * timing-flaky.
   */
  test('unterminated <a floods stay linear and cannot freeze the UI', () => {
    const bodies = [
      '<a href="'.repeat(3200),
      '<a '.repeat(3200),
      '<a href="https://x.example/">text '.repeat(3200),
      `<a ${'x'.repeat(200)}`.repeat(3200),
    ];
    for (const body of bodies) {
      const started = performance.now();
      const links = extractEmailLinks({ bodyHtml: body });
      expect(performance.now() - started).toBeLessThan(500);
      expect(Array.isArray(links)).toBe(true);
    }
    // Parity: the old regex never matched an unterminated anchor, so the bare
    // URL the sender left inside one is still reported (once, deduped).
    const links = extractEmailLinks({
      bodyHtml: '<a href="https://x.example/">text '.repeat(3200),
    });
    expect(links.map((l) => l.host)).toEqual(['x.example']);
  }, 10_000);

  test('a > inside an EARLIER quoted attribute does not hide the href', () => {
    // The old regex bounded the open tag with `[^>]*`, so a `>` inside any
    // attribute value cut the tag short and the following `href` was never
    // seen - the link was silently dropped (0 links). The walk now binds the
    // tag with the quote-aware findTagEnd first, so the href is found.
    const links = extractEmailLinks({
      bodyHtml: '<a title="a>b" href="https://example.com/real">Real</a>',
    });
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe('https://example.com/real');
    expect(links[0].label).toBe('Real');
  });

  test('an <a> without href is still stripped from the bare-URL pass', () => {
    // Parity with the previous <a\b[\s\S]*?<\/a> strip: the span is removed
    // before bare-URL matching, so its inner URL is not double-reported.
    expect(extractEmailLinks({ bodyHtml: '<a>https://example.com/inside</a>' })).toHaveLength(0);
  });
});

describe('extractLinksFromEmail', () => {
  test('works with an Email-shaped object', () => {
    const links = extractLinksFromEmail({
      body_html: '<a href="https://example.com/x">X</a>',
      body_plain: 'https://example.com/y',
    });
    expect(links).toHaveLength(2);
    expect(links[0].url).toBe('https://example.com/x');
    expect(links[1].url).toBe('https://example.com/y');
  });
});

describe('linkifyHtmlBareUrls', () => {
  test('wraps a bare URL in the text with a safe anchor', () => {
    const out = linkifyHtmlBareUrls('<p>Go to https://example.com now</p>');
    expect(out).toContain(
      '<a href="https://example.com/" target="_blank" rel="noopener noreferrer"'
    );
    expect(out).toContain('>https://example.com</a>');
  });

  test('extract decodes entities so copied URLs are real URLs', () => {
    const links = extractEmailLinks({
      bodyHtml:
        '<a href="https://example.com/x?id=1&amp;t=2">X</a> https://example.com/y?a=3&amp;b=4',
    });
    expect(links.map((l) => l.url)).toEqual([
      'https://example.com/x?id=1&t=2',
      'https://example.com/y?a=3&b=4',
    ]);
  });

  test('leaves existing anchors untouched', () => {
    const input =
      '<p><a href="https://example.com/a">Already linked</a> and https://example.com/b</p>';
    const out = linkifyHtmlBareUrls(input);
    expect(out).toContain('<a href="https://example.com/a">Already linked</a>');
    // The bare URL got linked, the anchor did not get re-wrapped.
    expect(out).toContain('href="https://example.com/b"');
    expect(out.match(/<a\b/g)?.length).toBe(2);
  });

  test('skips non-http(s) schemes', () => {
    const out = linkifyHtmlBareUrls('<p>mailto:hi@example.com ftp://example.com/x</p>');
    expect(out).not.toContain('<a ');
  });

  test('returns the input unchanged when there is nothing to link', () => {
    const input = '<p>plain text</p>';
    expect(linkifyHtmlBareUrls(input)).toBe(input);
    expect(linkifyHtmlBareUrls('')).toBe('');
  });

  test('decodes entity-encoded query params exactly once (no double-escape)', () => {
    const out = linkifyHtmlBareUrls('<p>see https://example.com/x?a=1&amp;b=2</p>');
    // `&amp;` in the source text is the entity for `&`. The output must encode
    // it exactly once in the href (browser decodes it back to `&` on click)
    // and show the real `&`-bearing text - NOT a double-escaped `&amp;amp;`.
    expect(out).toContain('href="https://example.com/x?a=1&amp;b=2"');
    expect(out).toContain('>https://example.com/x?a=1&amp;b=2</a>');
    expect(out).not.toContain('&amp;amp;');
  });

  test('does not corrupt URLs inside tag attributes (img src)', () => {
    // Regression: wrapping a URL found inside an attribute value would inject
    // <a> markup into the attribute and break the tag's parsing.
    const input = '<div><img src="https://cdn.example.com/a.png" alt="pic"></div>';
    expect(linkifyHtmlBareUrls(input)).toBe(input);
  });

  test('linkifies text URLs while leaving other tags fully intact', () => {
    const input =
      'See https://x.com/a <img src="https://cdn.example.com/b.png" alt="pic"> and https://y.com/c';
    const out = linkifyHtmlBareUrls(input);
    // Text URLs got linked…
    expect(out).toContain('href="https://x.com/a"');
    expect(out).toContain('href="https://y.com/c"');
    // …but the img tag (including its src attribute) is byte-for-byte intact.
    expect(out).toContain('<img src="https://cdn.example.com/b.png" alt="pic">');
    expect(out.match(/<a\b/g)?.length).toBe(2);
  });

  test('protects URLs inside attribute values of other tags too', () => {
    const input =
      '<blockquote cite="https://quote.example.com/s">q</blockquote>' +
      '<div style="background-image: url(https://img.example.com/bg.png)">x</div>';
    const out = linkifyHtmlBareUrls(input);
    expect(out).toBe(input);
  });

  test('does not treat a greater-than inside a quoted attribute as the tag end', () => {
    const input = '<div title="quoted > https://example.com/path">visible text</div>';
    const out = linkifyHtmlBareUrls(input);
    expect(out).toBe(input);
    expect(out).not.toContain('<a ');
  });

  test('does not linkify URLs in anchors with greater-than attribute values', () => {
    const input =
      '<a title="quoted > https://example.com/path" href="https://safe.example/">Open</a>';
    expect(linkifyHtmlBareUrls(input)).toBe(input);
  });
});
