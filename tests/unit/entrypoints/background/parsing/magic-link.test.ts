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
});
