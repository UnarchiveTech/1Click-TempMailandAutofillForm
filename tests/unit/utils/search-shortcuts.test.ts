import { describe, expect, test } from 'bun:test';
import {
  highlightMatches,
  parseSearchShortcuts,
  reconcileBooleanPill,
  reconcileSavedFilterQuery,
} from '@/utils/search/search-shortcuts.js';

describe('parseSearchShortcuts', () => {
  test('returns empty defaults for empty queries', () => {
    const parsed = parseSearchShortcuts('');
    expect(parsed.searchQuery).toBe('');
    expect(parsed.otpOnly).toBe(false);
    expect(parsed.otpOnlySet).toBe(false);
    expect(parsed.hasAttachment).toBe(false);
    expect(parsed.hasAttachmentSet).toBe(false);
    expect(parsed.senderDomain).toBe('');
    expect(parsed.senderEmail).toBe('');
    expect(parsed.recipient).toBe('');
    expect(parsed.subject).toBe('');
    expect(parsed.notSenderDomain).toBe('');
    expect(parsed.notSenderEmail).toBe('');
    expect(parsed.notRecipient).toBe('');
    expect(parsed.notSubject).toBe('');
  });

  test('parses is:otp shortcut', () => {
    const parsed = parseSearchShortcuts('is:otp test query');
    expect(parsed.otpOnly).toBe(true);
    expect(parsed.searchQuery).toBe('test query');
  });

  test('parses has:attachment shortcut', () => {
    const parsed = parseSearchShortcuts('has:attachment invoices');
    expect(parsed.hasAttachment).toBe(true);
    expect(parsed.searchQuery).toBe('invoices');
    expect(parsed.highlightTerms).toContain('has:attachment');
  });

  test('is case-insensitive for has:attachment', () => {
    const parsed = parseSearchShortcuts('HAS:ATTACHMENT');
    expect(parsed.hasAttachment).toBe(true);
    expect(parsed.searchQuery).toBe('');
  });

  test('negated !is:otp clears the OTP flag explicitly', () => {
    const parsed = parseSearchShortcuts('!is:otp invoices');
    expect(parsed.otpOnly).toBe(false);
    expect(parsed.otpOnlySet).toBe(true);
    expect(parsed.searchQuery).toBe('invoices');
    expect(parsed.highlightTerms).toContain('!is:otp');
  });

  test('negated !has:attachment clears the attachment flag explicitly', () => {
    const parsed = parseSearchShortcuts('!has:attachment receipts');
    expect(parsed.hasAttachment).toBe(false);
    expect(parsed.hasAttachmentSet).toBe(true);
    expect(parsed.searchQuery).toBe('receipts');
    expect(parsed.highlightTerms).toContain('!has:attachment');
  });

  test('last shortcut token wins when both forms appear', () => {
    expect(parseSearchShortcuts('is:otp !is:otp').otpOnly).toBe(false);
    expect(parseSearchShortcuts('!is:otp is:otp').otpOnly).toBe(true);
    expect(parseSearchShortcuts('has:attachment !has:attachment').hasAttachment).toBe(false);
    expect(parseSearchShortcuts('!has:attachment has:attachment').hasAttachment).toBe(true);
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

  test('parses negated !from: domain shortcut', () => {
    const parsed = parseSearchShortcuts('!from:github.com notification');
    expect(parsed.notSenderDomain).toBe('github.com');
    expect(parsed.senderDomain).toBe('');
    expect(parsed.searchQuery).toBe('notification');
    expect(parsed.highlightTerms).toContain('!from:github.com');
  });

  test('parses negated !from: email shortcut', () => {
    const parsed = parseSearchShortcuts('!from:support@github.com code');
    expect(parsed.notSenderEmail).toBe('support@github.com');
    expect(parsed.senderEmail).toBe('');
    expect(parsed.searchQuery).toBe('code');
  });

  test('parses negated !to: recipient shortcut', () => {
    const parsed = parseSearchShortcuts('!to:user@domain.com welcome');
    expect(parsed.notRecipient).toBe('user@domain.com');
    expect(parsed.recipient).toBe('');
    expect(parsed.searchQuery).toBe('welcome');
  });

  test('parses negated !subject: shortcut', () => {
    const parsed = parseSearchShortcuts('!subject:verify welcome email');
    expect(parsed.notSubject).toBe('verify');
    expect(parsed.subject).toBe('');
    expect(parsed.searchQuery).toBe('welcome email');
  });

  test('negated shortcuts are case-insensitive', () => {
    const parsed = parseSearchShortcuts('!FROM:GITHUB.COM');
    expect(parsed.notSenderDomain).toBe('github.com');
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

describe('reconcileBooleanPill', () => {
  test('turning ON adds the positive pill and removes the negated form', () => {
    expect(reconcileBooleanPill([], 'is:otp', true)).toEqual(['is:otp']);
    expect(reconcileBooleanPill(['!is:otp', 'from:x'], 'is:otp', true)).toEqual([
      'from:x',
      'is:otp',
    ]);
    expect(reconcileBooleanPill(['is:otp'], 'is:otp', true)).toEqual(['is:otp']);
  });

  test('turning OFF removes both forms (chip owns the off state)', () => {
    expect(reconcileBooleanPill(['is:otp'], 'is:otp', false)).toEqual([]);
    expect(reconcileBooleanPill(['!is:otp', 'from:x'], 'is:otp', false)).toEqual(['from:x']);
    expect(reconcileBooleanPill([], 'is:otp', false)).toEqual([]);
  });

  test('works for has:attachment identically', () => {
    expect(reconcileBooleanPill(['has:attachment'], 'has:attachment', true)).toEqual([
      'has:attachment',
    ]);
    expect(
      reconcileBooleanPill(['has:attachment', '!has:attachment'], 'has:attachment', false)
    ).toEqual([]);
  });

  test('does not mutate the input array', () => {
    const input = ['is:otp', 'from:x'];
    const out = reconcileBooleanPill(input, 'is:otp', false);
    expect(input).toEqual(['is:otp', 'from:x']);
    expect(out).not.toBe(input);
  });
});

describe('reconcileSavedFilterQuery', () => {
  test('adds a missing is:otp pill when the saved flag is on', () => {
    expect(reconcileSavedFilterQuery('invoices', true, false)).toBe('is:otp invoices');
  });

  test('removes a stale is:otp pill when the saved flag is off', () => {
    expect(reconcileSavedFilterQuery('is:otp invoices', false, false)).toBe('invoices');
  });

  test('preserves the free-text remainder', () => {
    // Positive is:otp is re-appended after the other pills; order is irrelevant
    // to the parser, only presence matters.
    expect(reconcileSavedFilterQuery('is:otp !from:x hello world', true, false)).toBe(
      '!from:x is:otp hello world'
    );
  });

  test('keeps non-boolean pills untouched', () => {
    expect(reconcileSavedFilterQuery('from:github.com', false, false)).toBe('from:github.com');
  });

  test('preserves the saved unread toggle and honors explicit negation', () => {
    expect(reconcileSavedFilterQuery('invoices', false, false, true)).toBe('is:unread invoices');
    expect(reconcileSavedFilterQuery('!is:unread invoices', false, false)).toBe('invoices');
    expect(reconcileSavedFilterQuery('is:unread invoices', false, false, false)).toBe('invoices');
  });
});
