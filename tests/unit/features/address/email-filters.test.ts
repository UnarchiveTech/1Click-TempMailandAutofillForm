import { describe, expect, test } from 'bun:test';
import { type EmailFilterOptions, filterEmails } from '@/features/address/email-filters.js';
import type { Email } from '@/utils/types.js';

let seq = 0;
function makeEmail(overrides: Partial<Email> = {}): Email {
  seq += 1;
  return {
    id: `m${seq}`,
    from: 'sender@example.com',
    from_name: 'Sender',
    subject: 'Subject',
    body: '',
    body_plain: '',
    received_at: 1_700_000_000,
    unread: false,
    ...overrides,
  } as Email;
}

const all = (): Email[] => [
  makeEmail({
    id: 'a',
    from: 'alice@acme.com',
    from_name: 'Alice',
    subject: 'Welcome to Acme',
    body_plain: 'hello world',
    received_at: 1000,
    otp: '123456',
    isOtp: true,
    original_inbox: 'inbox@acme.com',
  }),
  makeEmail({
    id: 'b',
    from: 'bob@other.org',
    from_name: 'Bob',
    subject: 'Reset your password',
    body_plain: 'code 999000',
    received_at: 2000,
    original_inbox: 'inbox@acme.com',
  }),
  makeEmail({
    id: 'c',
    from: 'alice@acme.com',
    from_name: 'Alice',
    subject: 'Receipt',
    body_plain: 'thanks',
    received_at: 3000,
    original_inbox: 'alt@acme.com',
  }),
];

describe('filterEmails', () => {
  test('returns all when no options', () => {
    expect(filterEmails(all(), {}).length).toBe(3);
  });

  test('does not mutate the input array', () => {
    const input = all();
    const snapshot = input.map((e) => e.id);
    filterEmails(input, { sortBy: 'oldest' });
    expect(input.map((e) => e.id)).toEqual(snapshot);
  });

  test('search matches subject, from, from_name, body', () => {
    expect(filterEmails(all(), { searchQuery: 'welcome' }).map((e) => e.id)).toEqual(['a']);
    expect(filterEmails(all(), { searchQuery: 'bob' }).map((e) => e.id)).toEqual(['b']);
    expect(filterEmails(all(), { searchQuery: '999000' }).map((e) => e.id)).toEqual(['b']);
  });

  test('search matches message labels/tags', () => {
    const emails = [makeEmail({ id: 'x', subject: 'noop' })];
    const out = filterEmails(emails, {
      searchQuery: 'vip',
      emailLabelsById: { x: ['vip'] },
    });
    expect(out.map((e) => e.id)).toEqual(['x']);
  });

  test('message labels do not bleed across inboxes with colliding provider IDs', () => {
    const emails = [
      makeEmail({ id: 'same', original_inbox: 'a@example.com' }),
      makeEmail({ id: 'same', original_inbox: 'b@example.com' }),
    ];
    const out = filterEmails(emails, {
      searchQuery: 'banking',
      emailLabelsById: { 'a@example.com_same': ['Banking'] },
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.original_inbox).toBe('a@example.com');
  });

  test('otpOnly keeps only OTP emails', () => {
    expect(filterEmails(all(), { otpOnly: true }).map((e) => e.id)).toEqual(['a']);
  });

  test("otpOnly excludes the '------' no-OTP placeholder", () => {
    const emails = [
      makeEmail({ id: 'placeholder', otp: '------' }),
      makeEmail({ id: 'real', otp: '123456', isOtp: true }),
      makeEmail({ id: 'none', otp: undefined }),
    ];
    expect(filterEmails(emails, { otpOnly: true }).map((e) => e.id)).toEqual(['real']);
  });

  test('unreadOnly keeps only unread emails', () => {
    const emails = [
      makeEmail({ id: 'read', unread: false }),
      makeEmail({ id: 'unread', unread: true }),
    ];
    expect(filterEmails(emails, { unreadOnly: true }).map((e) => e.id)).toEqual(['unread']);
  });

  test('hasAttachment keeps only emails with attachments', () => {
    const emails = [
      makeEmail({ id: 'att', attachments: [{ filename: 'video.mp4', mimeType: 'video/mp4' }] }),
      makeEmail({ id: 'plain', attachments: [] }),
      makeEmail({ id: 'none', subject: 'no attachments field' }),
    ];
    expect(filterEmails(emails, { hasAttachment: true }).map((e) => e.id)).toEqual(['att']);
    // off → everything
    expect(
      filterEmails(emails, {})
        .map((e) => e.id)
        .sort()
    ).toEqual(['att', 'none', 'plain']);
  });

  test('hasAttachment matches the provider flag even without a manifest', () => {
    const emails = [
      makeEmail({ id: 'flagged', attachments: undefined, hasAttachment: true }),
      makeEmail({ id: 'plain', attachments: undefined, hasAttachment: false }),
      makeEmail({ id: 'none' }),
    ];
    expect(filterEmails(emails, { hasAttachment: true }).map((e) => e.id)).toEqual(['flagged']);
  });

  test('hasAttachment combines with otpOnly (AND)', () => {
    const emails = [
      makeEmail({
        id: 'att-otp',
        otp: '111111',
        isOtp: true,
        attachments: [{ filename: 'scan.pdf', mimeType: 'application/pdf' }],
      }),
      makeEmail({
        id: 'att-only',
        attachments: [{ filename: 'doc.txt', mimeType: 'text/plain' }],
      }),
    ];
    expect(filterEmails(emails, { otpOnly: true, hasAttachment: true }).map((e) => e.id)).toEqual([
      'att-otp',
    ]);
  });

  test('senderDomain substring filter', () => {
    expect(filterEmails(all(), { senderDomain: 'acme' }).map((e) => e.id)).toEqual(['c', 'a']);
  });

  test('full-domain senderDomain matches boundaries, not lookalikes', () => {
    const emails = [
      makeEmail({ id: 'exact', from: 'alice@acme.com' }),
      makeEmail({ id: 'sub', from: 'bob@sub.acme.com' }),
      makeEmail({ id: 'lookalike', from: 'eve@notacme.com' }),
      makeEmail({ id: 'evil', from: 'mallory@acme.com.evil.com' }),
    ];
    expect(
      filterEmails(emails, { senderDomain: 'acme.com' })
        .map((e) => e.id)
        .sort()
    ).toEqual(['exact', 'sub']);
  });

  test('full-domain senderDomain handles RFC-style From headers', () => {
    const emails = [
      makeEmail({ id: 'rfc', from: 'Alice <alice@acme.com>', from_name: 'Alice' }),
      makeEmail({ id: 'lookalike', from: 'Eve <eve@notacme.com>', from_name: 'Eve' }),
    ];
    expect(filterEmails(emails, { senderDomain: 'acme.com' }).map((e) => e.id)).toEqual(['rfc']);
  });

  test('full-domain recipient matches boundaries, not lookalikes', () => {
    const emails = [
      makeEmail({ id: 'exact', original_inbox: 'inbox@acme.com' }),
      makeEmail({ id: 'lookalike', original_inbox: 'inbox@notacme.com' }),
    ];
    expect(filterEmails(emails, { recipient: 'acme.com' }).map((e) => e.id)).toEqual(['exact']);
  });

  test('senderEmail exact (case-insensitive) match', () => {
    expect(filterEmails(all(), { senderEmail: 'Alice@ACME.com' }).map((e) => e.id)).toEqual([
      'c',
      'a',
    ]);
  });

  test('senderEmail matches RFC-style "Name <addr>" From headers', () => {
    const emails = [
      makeEmail({ id: 'rfc', from: 'Alice <alice@acme.com>', from_name: 'Alice' }),
      makeEmail({ id: 'other', from: 'eve@acme.com', from_name: 'Eve' }),
    ];
    expect(filterEmails(emails, { senderEmail: 'alice@acme.com' }).map((e) => e.id)).toEqual([
      'rfc',
    ]);
  });

  test('notSenderEmail excludes RFC-style "Name <addr>" From headers', () => {
    const emails = [
      makeEmail({ id: 'rfc', from: 'Alice <alice@acme.com>', from_name: 'Alice' }),
      makeEmail({ id: 'other', from: 'eve@acme.com', from_name: 'Eve' }),
    ];
    expect(filterEmails(emails, { notSenderEmail: 'alice@acme.com' }).map((e) => e.id)).toEqual([
      'other',
    ]);
  });

  test('recipient filters by original_inbox', () => {
    expect(filterEmails(all(), { recipient: 'alt' }).map((e) => e.id)).toEqual(['c']);
  });

  test('subject substring filter', () => {
    expect(filterEmails(all(), { subject: 'reset' }).map((e) => e.id)).toEqual(['b']);
  });

  test('notSenderDomain excludes matching sender domains', () => {
    // alice@acme.com (a, c) and bob@other.org (b) → excluding acme leaves only b
    expect(filterEmails(all(), { notSenderDomain: 'acme' }).map((e) => e.id)).toEqual(['b']);
  });

  test('notSenderEmail excludes the exact sender email', () => {
    expect(filterEmails(all(), { notSenderEmail: 'alice@acme.com' }).map((e) => e.id)).toEqual([
      'b',
    ]);
  });

  test('notRecipient excludes matching recipient addresses', () => {
    // c has original_inbox 'alt@acme.com', a+b use 'inbox@acme.com';
    // default sort is newest-first (b=2000 before a=1000)
    expect(filterEmails(all(), { notRecipient: 'alt' }).map((e) => e.id)).toEqual(['b', 'a']);
  });

  test('notSubject excludes matching subjects', () => {
    // b's subject 'Reset your password' is excluded; newest-first: c then a
    expect(filterEmails(all(), { notSubject: 'reset' }).map((e) => e.id)).toEqual(['c', 'a']);
  });

  test('exclusion combines with a positive filter (AND)', () => {
    const out = filterEmails(all(), {
      senderDomain: 'acme.com',
      notSubject: 'receipt', // drops c (Receipt), keeps a (Welcome to Acme)
    });
    expect(out.map((e) => e.id)).toEqual(['a']);
  });

  test('selectedSenders multi-select (OR)', () => {
    expect(filterEmails(all(), { selectedSenders: ['other.org'] }).map((e) => e.id)).toEqual(['b']);
  });

  test('date range filter', () => {
    const X = 1_700_000_000_000; // unambiguous ms epoch (>1e12 → isMs true)
    const DAY = 86_400_000;
    const emails = [
      makeEmail({ id: 'd1', received_at: X }),
      makeEmail({ id: 'd2', received_at: X + 2 * DAY }),
      makeEmail({ id: 'd3', received_at: X + 4 * DAY }),
    ];
    // dateFrom excludes the oldest (d1); newest-desc → [d3, d2]
    expect(
      filterEmails(emails, { dateFrom: new Date(X + DAY).toISOString() }).map((e) => e.id)
    ).toEqual(['d3', 'd2']);
    // dateTo (inclusive of that whole day) keeps d1+d2, excludes d3
    expect(
      filterEmails(emails, { dateTo: new Date(X + 2 * DAY).toISOString() }).map((e) => e.id)
    ).toEqual(['d2', 'd1']);
  });

  test('combines filters (AND of all predicates)', () => {
    const out = filterEmails(all(), {
      senderDomain: 'acme.com',
      searchQuery: 'welcome',
    });
    expect(out.map((e) => e.id)).toEqual(['a']);
  });
});

describe('filterEmails sorting', () => {
  const opts = (sortBy: string): EmailFilterOptions => ({ sortBy });

  test('newest (default) descending', () => {
    expect(filterEmails(all(), opts('newest')).map((e) => e.id)).toEqual(['c', 'b', 'a']);
  });

  test('oldest ascending', () => {
    expect(filterEmails(all(), opts('oldest')).map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  test('senderNameAsc', () => {
    expect(filterEmails(all(), opts('senderNameAsc')).map((e) => e.id)).toEqual(['a', 'c', 'b']);
  });

  test('senderNameDesc', () => {
    expect(filterEmails(all(), opts('senderNameDesc')).map((e) => e.id)).toEqual(['b', 'a', 'c']);
  });

  test('senderEmailAsc / Desc', () => {
    expect(filterEmails(all(), opts('senderEmailAsc')).map((e) => e.id)).toEqual(['a', 'c', 'b']);
    expect(filterEmails(all(), opts('senderEmailDesc')).map((e) => e.id)).toEqual(['b', 'a', 'c']);
  });

  test('subjectAsc / Desc', () => {
    // subjects: 'receipt'(c) < 'reset your password'(b) < 'welcome to acme'(a)
    expect(filterEmails(all(), opts('subjectAsc')).map((e) => e.id)).toEqual(['c', 'b', 'a']);
    expect(filterEmails(all(), opts('subjectDesc')).map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  test('unknown sortBy falls back to newest', () => {
    expect(filterEmails(all(), opts('nonsense')).map((e) => e.id)).toEqual(['c', 'b', 'a']);
  });

  test('ties broken by id (localeCompare) deterministically', () => {
    const same = [
      makeEmail({ id: 'z', received_at: 5, from: 'a@x.com', subject: 's' }),
      makeEmail({ id: 'a', received_at: 5, from: 'a@x.com', subject: 's' }),
    ];
    expect(filterEmails(same, { sortBy: 'newest' }).map((e) => e.id)).toEqual(['a', 'z']);
  });
});
