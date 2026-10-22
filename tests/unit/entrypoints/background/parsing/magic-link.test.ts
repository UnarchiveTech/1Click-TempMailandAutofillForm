import { describe, expect, it } from 'bun:test';
import {
  extractBestMagicLink,
  extractMagicLinks,
  MAGIC_LINK_SCORE_THRESHOLD,
  normalizeUrl,
} from '@/entrypoints/background/parsing/magic-link.js';

describe('normalizeUrl', () => {
  it('accepts https URLs', () => {
    expect(normalizeUrl('https://example.com/login?token=abc')).toBe(
      'https://example.com/login?token=abc'
    );
  });

  it('strips trailing punctuation', () => {
    expect(normalizeUrl('https://example.com/path.')).toBe('https://example.com/path');
  });

  it('rejects non-http schemes', () => {
    expect(normalizeUrl('mailto:a@b.com')).toBeNull();
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
  });

  it('decodes HTML entities', () => {
    expect(normalizeUrl('https://ex.com/a?x=1&amp;y=2')).toContain('y=2');
  });
});

describe('extractMagicLinks', () => {
  it('requires authentication intent rather than opaque marketing tokens or product names', () => {
    const html = `
      <a href="https://news.example.com/app-link/post?token=longrandomauthenticationtoken&action=comment">COMMENT</a>
      <a href="https://shop.example.com/products/magic-rgb-star-projector?variant=123">Magic RGB lamp Shop Now</a>
      <a href="https://mail.example.com/c/abcdefghijklmnopqrstuvwxyz">Sign up</a>
      <a href="https://news.example.com/click/abcdefghijklmnopqrstuvwxyz/abcdefghijklmnopqrstuvwxyz">Read this article</a>
      <a href="https://news.example.com/lesson?token=abcdefghijklmnopqrstuvwxyz&redirect=confirm">Lesson</a>
    `;
    expect(extractMagicLinks('Latest stories and discounts', html)).toEqual([]);
    expect(
      extractMagicLinks(
        'Your temporary login code',
        '<a href="https://app.example.com/loginwithemail?state=abcdefghijklmnopqrstuvwxyz">Sign in with Magic Link</a>'
      )
    ).toHaveLength(1);
  });
  it('detects verify email anchor + token query', () => {
    const html = `
      <p>Confirm your account</p>
      <a href="https://app.example.com/verify?token=abcdefghijklmnopqrstuvwxyz">Verify email</a>
    `;
    const links = extractMagicLinks('Verify your email', html, '');
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].url).toContain('verify');
    expect(links[0].score).toBeGreaterThanOrEqual(MAGIC_LINK_SCORE_THRESHOLD);
  });

  it('detects magic-link path in plain text', () => {
    const plain =
      'Click to sign in: https://auth.service.com/magic-link/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
    const links = extractMagicLinks('Your magic link', '', plain);
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].url).toContain('magic-link');
  });

  it('detects login with long token query', () => {
    const html = `<a href="https://site.io/auth/callback?code=supersecrettokenvalue123456">Log in</a>`;
    const links = extractMagicLinks('Sign in to Site', html);
    expect(links[0]?.host).toBe('site.io');
  });

  it('hard-rejects tracking paths even when they have strong auth signals', () => {
    const html =
      '<a href="https://click.example.com/verify/track?token=abcdefghijklmnopqrstuvwxyz123456">Verify email</a>';
    expect(extractMagicLinks('Welcome to Example', html)).toEqual([]);
  });

  it('rejects unsubscribe links', () => {
    const html = `<a href="https://news.example.com/unsubscribe?id=123">Unsubscribe</a>`;
    const links = extractMagicLinks('Newsletter', html);
    expect(links.every((l) => !l.url.includes('unsubscribe'))).toBe(true);
    expect(links.length).toBe(0);
  });

  it('rejects preference / list-manage links', () => {
    const html = `<a href="https://list-manage.com/profile?u=abc">Update preferences</a>`;
    const links = extractMagicLinks('Update prefs', html);
    expect(links.length).toBe(0);
  });

  it('does not flag pure marketing CTA without auth signals', () => {
    const html = `<a href="https://shop.example.com/summer-sale">Shop now</a>`;
    const links = extractMagicLinks('Summer sale', html);
    expect(links.length).toBe(0);
  });

  it('returns at most 3 links sorted by score', () => {
    const html = `
      <a href="https://a.com/magic?token=aaaaaaaaaaaaaaaaaa">Magic</a>
      <a href="https://b.com/verify?token=bbbbbbbbbbbbbbbbbb">Verify email</a>
      <a href="https://c.com/login?token=cccccccccccccccccc">Log in</a>
      <a href="https://d.com/auth?token=dddddddddddddddddd">Sign in</a>
    `;
    const links = extractMagicLinks('Sign in', html);
    expect(links.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < links.length; i++) {
      expect(links[i - 1].score).toBeGreaterThanOrEqual(links[i].score);
    }
  });

  it('extractBestMagicLink returns top or null', () => {
    expect(extractBestMagicLink('', '<p>hi</p>')).toBeNull();
    const best = extractBestMagicLink(
      'Confirm account',
      '<a href="https://app.example.com/confirm?token=abcdefghijklmnopqrst">Confirm account</a>'
    );
    expect(best).not.toBeNull();
    expect(best?.url).toContain('confirm');
  });

  it('rejects social hosts even with auth-looking paths', () => {
    const links = extractMagicLinks(
      'Sign in',
      '<a href="https://x.com/login?token=abcdefghijklmnopqrst">Log in</a>'
    );
    expect(links.length).toBe(0);
  });

  it('does NOT double-decode a double-encoded token (single-pass decode)', () => {
    // `%252F` decodes ONCE to `%2F`; looping until stable would corrupt it to `/`.
    const url = normalizeUrl('https://ex.com/a?t=abc%252Fdef');
    expect(url).toContain('t=abc%2Fdef');
    expect(url).not.toContain('t=abc/def');
  });

  it('decodes a single percent-encoding exactly once', () => {
    expect(normalizeUrl('https://ex.com/a?x=1%202')).toContain('x=1%202');
  });

  it('leaves malformed percent sequences untouched', () => {
    expect(normalizeUrl('https://ex.com/a?x=100%')).toContain('100%');
  });

  it('raises the bar: a weak token query below the new threshold is rejected', () => {
    // Scores 4 under the old threshold (base 1 + short token key 3); now 6 is
    // required. (`?t=` avoids the `token` PATH keyword double-count.)
    const links = extractMagicLinks('', '', 'https://site.com/x?t=ab');
    expect(links.length).toBe(0);
  });

  it('suppresses magic-link detection in transactional subjects (receipt/invoice)', () => {
    const html = '<a href="https://a.com/auth?token=abcdefghijklmnop">View your order</a>';
    // Without the negative subject this scores 11 (≥ threshold); "invoice" kills it.
    expect(extractMagicLinks('Your invoice #1234', html).length).toBe(0);
    expect(extractMagicLinks('Weekly digest - activity', html).length).toBe(0);
    expect(extractMagicLinks('Your subscription receipt', html).length).toBe(0);
  });

  it('still detects real magic links in a sign-in subject', () => {
    const html = '<a href="https://a.com/auth?token=abcdefghijklmnop">Sign in</a>';
    expect(extractMagicLinks('Sign in to A', html).length).toBeGreaterThan(0);
  });

  it('prefers the verify button over a higher-scoring sign-in anchor', () => {
    const html = `
      <a href="https://app.example.com/login?token=abcdefghijklmnopqrstuvwxyz&sid=1234567890">Log in</a>
      <a href="https://app.example.com/verify?token=abc">Verify email</a>
    `;
    const links = extractMagicLinks('Confirm your email', html);
    // The sign-in anchor out-scores the verify link…
    expect(links[0]?.url).toContain('login');
    // …but the BEST link (single-click surface) is the verify action.
    const best = extractBestMagicLink('Confirm your email', html);
    expect(best?.url).toContain('verify');
  });

  it('drops links from stale emails (older than the max age)', () => {
    const html = '<a href="https://a.com/verify?token=abcdefghijklmnopqrst">Verify email</a>';
    const fresh = extractMagicLinks('Verify your email', html, '', Date.now());
    expect(fresh.length).toBeGreaterThan(0);
    const stale = extractMagicLinks(
      'Verify your email',
      html,
      '',
      Date.now() - 30 * 24 * 60 * 60 * 1000
    );
    expect(stale.length).toBe(0);
  });

  it('detects unquoted href attributes', () => {
    const html = '<a href=https://shop.example.com/login?token=abcdefghijklmnopqrst>Log in</a>';
    const links = extractMagicLinks('Sign in to Shop', html);
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].url).toContain('shop.example.com');
  });

  it('boosts welcome subjects instead of penalizing them', () => {
    const html =
      '<a href="https://app.example.com/verify?token=abcdefghijklmnopqrst">Confirm your email</a>';
    const welcome = extractMagicLinks('Welcome to Acme!', html)[0];
    const neutral = extractMagicLinks('Acme update', html)[0];
    expect(welcome).toBeDefined();
    // Positive-subject boost (+2) and no transactional penalty (-8).
    expect(welcome.score).toBe(neutral.score + 2);
  });

  it('excludes identity-provider login hosts', () => {
    expect(
      extractMagicLinks(
        'New device sign-in',
        '<a href="https://github.com/login?return_to=abcdefghijklmnopqrst">Log in</a>'
      ).length
    ).toBe(0);
    expect(
      extractMagicLinks(
        'Sign in',
        '<a href="https://accounts.google.com/signin/v2/identifier?continue=abcdefghijklmnopqrst">Sign in</a>'
      ).length
    ).toBe(0);
  });

  it('keeps GitHub verify/email links eligible', () => {
    const links = extractMagicLinks(
      'Verify your email',
      '<a href="https://github.com/settings/emails/verify/abcdefghijklmnopqrst">Verify email</a>'
    );
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].url).toContain('settings/emails/verify');
  });

  it('does not treat t=/code=/hash= params as auth signals', () => {
    // Promo/tracking params like these previously added +3/+2 each.
    const links = extractMagicLinks(
      '',
      'https://shop.example.com/checkout?code=SUMMER20&t=1234567890123456&hash=abcdefghijklmnopqrstuvwxyz'
    );
    expect(links.length).toBe(0);
  });

  it('gives labels that START with an action the full +4', () => {
    // "Log in now" previously scored +3 (partial match) and fell below the
    // threshold (5); the starts-with rule brings it to 6.
    const links = extractMagicLinks('', '<a href="https://app.example.com/account">Log in now</a>');
    expect(links.length).toBe(1);
  });

  it('prefers the more descriptive label for duplicate URLs', () => {
    const html =
      '<a href="https://app.example.com/verify?token=abcdefghijklmnopqrst">Click here</a>' +
      '<a href="https://app.example.com/verify?token=abcdefghijklmnopqrst">Verify your email</a>';
    const links = extractMagicLinks('', html);
    expect(links[0].label).toBe('Verify your email');
  });

  /**
   * ReDoS / algorithmic-DoS regression, on the path that runs on EVERY
   * ingested message in the service worker (no ingest-time body cap exists, so
   * the sizes below are sender-controlled, not hypothetical):
   *
   *  - the anchor scan was CUBIC on unterminated `<a` tags - measured 30.6 s
   *    for an 18 KB body before it was replaced by the linear walk in
   *    html-anchors.ts;
   *  - `<[^>]+>` in stripTags was QUADRATIC on `<` with no `>` - measured 2.3 s
   *    for 125 KB.
   *
   * The 10 s guard is orders of magnitude above the fixed cost of these bodies
   * (sub-millisecond), so it cannot be flaky, while either blowup exceeds it.
   */
  it('stays linear on adversarial bodies that used to block the worker', () => {
    const bodies = [
      '<a href="'.repeat(4000), // cubic: 30.6 s at 18 KB before the fix
      '<'.repeat(200_000), // quadratic: 2.3 s at 125 KB before the fix
      '<script'.repeat(4000),
      '<style'.repeat(4000),
      '<!--'.repeat(4000),
    ];
    for (const body of bodies) {
      const started = performance.now();
      const links = extractMagicLinks('Verify your email', body);
      expect(performance.now() - started).toBeLessThan(500);
      expect(Array.isArray(links)).toBe(true);
    }
  }, 10_000);
});
