import { describe, expect, test } from 'bun:test';
import { highlightMatches, parseSearchShortcuts } from '@/utils/search-shortcuts.js';

describe('parseSearchShortcuts', () => {
  test('returns empty defaults for empty queries', () => {
    const parsed = parseSearchShortcuts('');
    expect(parsed.searchQuery).toBe('');
    expect(parsed.otpOnly).toBe(false);
    expect(parsed.senderDomain).toBe('');
    expect(parsed.senderEmail).toBe('');
    expect(parsed.recipient).toBe('');
    expect(parsed.subject).toBe('');
  });

  test('parses is:otp shortcut', () => {
    const parsed = parseSearchShortcuts('is:otp test query');
    expect(parsed.otpOnly).toBe(true);
    expect(parsed.searchQuery).toBe('test query');
  });

  test('parses from: domain and from: email shortcut', () => {
    const parsedDomain = parseSearchShortcuts('from:github.com notification');
    expect(parsedDomain.senderDomain).toBe('github.com');
    expect(parsedDomain.senderEmail).toBe('');
    expect(parsedDomain.searchQuery).toBe('notification');

    const parsedEmail = parseSearchShortcuts('from:support@github.com code');
    expect(parsedEmail.senderDomain).toBe('');
    expect(parsedEmail.senderEmail).toBe('support@github.com');
    expect(parsedEmail.searchQuery).toBe('code');
  });

  test('parses to: recipient shortcut', () => {
    const parsed = parseSearchShortcuts('to:user@domain.com welcome');
    expect(parsed.recipient).toBe('user@domain.com');
    expect(parsed.searchQuery).toBe('welcome');
  });

  test('parses subject shortcut', () => {
    const parsed = parseSearchShortcuts('subject:verify welcome email');
    expect(parsed.subject).toBe('verify');
    expect(parsed.searchQuery).toBe('welcome email');
  });

  test('handles quoted terms in query', () => {
    const parsed = parseSearchShortcuts('from:google.com "security alert"');
    expect(parsed.senderDomain).toBe('google.com');
    expect(parsed.searchQuery).toBe('security alert');
  });
});

describe('highlightMatches', () => {
  test('highlights single matching term', () => {
    const html = highlightMatches('Hello world', ['world']);
    expect(html).toBe(
      'Hello <mark class="bg-md-primary-container text-md-on-primary-container rounded px-0.5">world</mark>'
    );
  });

  test('highlights multiple terms using alternation', () => {
    const html = highlightMatches('Hello world standard text', ['world', 'text']);
    expect(html).toContain(
      '<mark class="bg-md-primary-container text-md-on-primary-container rounded px-0.5">world</mark>'
    );
    expect(html).toContain(
      '<mark class="bg-md-primary-container text-md-on-primary-container rounded px-0.5">text</mark>'
    );
  });

  test('ignores term lengths > 100 to prevent ReDoS', () => {
    const longTerm = 'a'.repeat(101);
    const html = highlightMatches('Hello world', [longTerm, 'world']);
    expect(html).toBe(
      'Hello <mark class="bg-md-primary-container text-md-on-primary-container rounded px-0.5">world</mark>'
    );
  });
});
