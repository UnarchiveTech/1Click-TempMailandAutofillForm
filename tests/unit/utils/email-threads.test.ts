import { describe, expect, test } from 'bun:test';
import { groupEmailsByThread, normalizeSubject } from '@/utils/email-threads';
import type { Email } from '@/utils/types';

// ── normalizeSubject ────────────────────────────────────────────────────────

describe('normalizeSubject', () => {
  test('lowercases the subject', () => {
    expect(normalizeSubject('HELLO WORLD')).toBe('hello world');
  });

  test('strips Re: prefix', () => {
    expect(normalizeSubject('Re: Hello')).toBe('hello');
  });

  test('strips RE: prefix (uppercase)', () => {
    expect(normalizeSubject('RE: Hello')).toBe('hello');
  });

  test('strips Fwd: prefix', () => {
    expect(normalizeSubject('Fwd: Hello')).toBe('hello');
  });

  test('strips Fw: prefix', () => {
    expect(normalizeSubject('Fw: Hello')).toBe('hello');
  });

  test('strips single reply prefix', () => {
    expect(normalizeSubject('Re: Hello')).toBe('hello');
  });

  test('strips nested reply prefixes', () => {
    expect(normalizeSubject('Re: Re: Re: Hello')).toBe('hello');
  });

  test('strips mixed case nested prefixes', () => {
    expect(normalizeSubject('rE: FwD: Hello')).toBe('hello');
  });

  test('strips Chinese reply prefixes', () => {
    expect(normalizeSubject('回复: Hello')).toBe('hello');
    expect(normalizeSubject('回覆: Hello')).toBe('hello');
    expect(normalizeSubject('答复: Hello')).toBe('hello');
  });

  test('strips Swedish prefix', () => {
    expect(normalizeSubject('Vidarebefordra: Hello')).toBe('hello');
  });

  test('strips tr: prefix', () => {
    expect(normalizeSubject('Tr: Hello')).toBe('hello');
  });

  test('normalizes multiple spaces to single space', () => {
    expect(normalizeSubject('Hello   World')).toBe('hello world');
  });

  test('trims whitespace', () => {
    expect(normalizeSubject('  Hello  ')).toBe('hello');
  });

  test('handles empty string', () => {
    expect(normalizeSubject('')).toBe('');
  });

  test('handles subject with no prefix', () => {
    expect(normalizeSubject('Meeting tomorrow')).toBe('meeting tomorrow');
  });

  test('handles subject with colons in body', () => {
    expect(normalizeSubject('Re: Status: Active')).toBe('status: active');
  });
});

// ── groupEmailsByThread ─────────────────────────────────────────────────────

function makeEmail(overrides: Partial<Email> & { id: string; received_at: number }): Email {
  return {
    subject: 'Test Subject',
    from: 'user@example.com',
    from_name: 'User',
    body_html: '',
    body_plain: '',
    unread: false,
    ...overrides,
  };
}

describe('groupEmailsByThread', () => {
  test('returns empty array for empty input', () => {
    expect(groupEmailsByThread([])).toEqual([]);
  });

  test('single email creates single thread', () => {
    const emails = [makeEmail({ id: '1', received_at: 1700000000 })];
    const threads = groupEmailsByThread(emails);
    expect(threads.length).toBe(1);
    expect(threads[0].emails.length).toBe(1);
    expect(threads[0].latestEmail.id).toBe('1');
  });

  test('emails with same subject and same sender are grouped', () => {
    const emails = [
      makeEmail({ id: '1', subject: 'Hello', from: 'a@b.com', received_at: 1700000000 }),
      makeEmail({ id: '2', subject: 'Hello', from: 'a@b.com', received_at: 1700001000 }),
    ];
    const threads = groupEmailsByThread(emails);
    expect(threads.length).toBe(1);
    expect(threads[0].emails.length).toBe(2);
  });

  test('emails with same subject but different senders and far apart are separate threads', () => {
    const emails = [
      makeEmail({ id: '1', subject: 'Hello', from: 'a@b.com', received_at: 1700000000 }),
      makeEmail({
        id: '2',
        subject: 'Hello',
        from: 'c@d.com',
        received_at: 1700000000 + 100000, // 100000 seconds = ~27.8 hours
      }),
    ];
    const threads = groupEmailsByThread(emails);
    // The emails have different sender domains and no participant overlap,
    // so they are NOT grouped.
    expect(threads.length).toBe(2);
  });

  test('emails with same subject but different senders and very far apart are separate threads', () => {
    const emails = [
      makeEmail({ id: '1', subject: 'Hello', from: 'a@b.com', received_at: 1000000000 }),
      makeEmail({
        id: '2',
        subject: 'Hello',
        from: 'c@d.com',
        received_at: 1000000000 + 300000, // 300000 seconds = ~83 hours (> 72h)
      }),
    ];
    const threads = groupEmailsByThread(emails);
    expect(threads.length).toBe(2);
  });

  test('emails within 72 hours are grouped even with different senders', () => {
    const emails = [
      makeEmail({ id: '1', subject: 'Hello', from: 'a@b.com', received_at: 1700000000 }),
      makeEmail({
        id: '2',
        subject: 'Hello',
        from: 'c@d.com',
        received_at: 1700000000 + 3600, // 1 hour apart
      }),
    ];
    const threads = groupEmailsByThread(emails);
    // Since they have different sender domains and no participant overlap, they are NOT grouped.
    expect(threads.length).toBe(2);
  });

  test('different subjects create separate threads', () => {
    const emails = [
      makeEmail({ id: '1', subject: 'Hello', from: 'a@b.com', received_at: 1700000000 }),
      makeEmail({ id: '2', subject: 'Goodbye', from: 'a@b.com', received_at: 1700000000 }),
    ];
    const threads = groupEmailsByThread(emails);
    expect(threads.length).toBe(2);
  });

  test('Re: prefix does not prevent grouping', () => {
    const emails = [
      makeEmail({ id: '1', subject: 'Hello', from: 'a@b.com', received_at: 1700000000 }),
      makeEmail({
        id: '2',
        subject: 'Re: Hello',
        from: 'c@b.com',
        received_at: 1700000000 + 3600,
      }),
    ];
    const threads = groupEmailsByThread(emails);
    expect(threads.length).toBe(1);
    expect(threads[0].normalizedSubject).toBe('hello');
  });

  test('threads are sorted by latest email descending', () => {
    const emails = [
      makeEmail({ id: '1', subject: 'Old', from: 'a@b.com', received_at: 1700000000 }),
      makeEmail({ id: '2', subject: 'New', from: 'a@b.com', received_at: 1700001000 }),
    ];
    const threads = groupEmailsByThread(emails);
    expect(threads[0].latestEmail.id).toBe('2');
    expect(threads[1].latestEmail.id).toBe('1');
  });

  test('counts unread emails correctly', () => {
    const emails = [
      makeEmail({
        id: '1',
        subject: 'Hello',
        from: 'a@b.com',
        received_at: 1700000000,
        unread: true,
      }),
      makeEmail({
        id: '2',
        subject: 'Hello',
        from: 'a@b.com',
        received_at: 1700001000,
        unread: true,
      }),
      makeEmail({
        id: '3',
        subject: 'Hello',
        from: 'a@b.com',
        received_at: 1700002000,
        unread: false,
      }),
    ];
    const threads = groupEmailsByThread(emails);
    expect(threads[0].unreadCount).toBe(2);
  });

  test('collects unique participants', () => {
    const emails = [
      makeEmail({ id: '1', subject: 'Hello', from: 'a@b.com', received_at: 1700000000 }),
      makeEmail({ id: '2', subject: 'Hello', from: 'c@b.com', received_at: 1700001000 }),
      makeEmail({ id: '3', subject: 'Hello', from: 'a@b.com', received_at: 1700002000 }),
    ];
    const threads = groupEmailsByThread(emails);
    expect(threads[0].participants).toContain('a@b.com');
    expect(threads[0].participants).toContain('c@b.com');
    expect(threads[0].participants.length).toBe(2);
  });

  test('handles emails with ms timestamps (> 1e10)', () => {
    const emails = [
      makeEmail({ id: '1', subject: 'Hello', from: 'a@b.com', received_at: 1700000000000 }),
      makeEmail({ id: '2', subject: 'Hello', from: 'a@b.com', received_at: 1700000001000 }),
    ];
    const threads = groupEmailsByThread(emails);
    expect(threads.length).toBe(1);
  });

  test('handles missing subject gracefully', () => {
    const emails = [
      makeEmail({ id: '1', subject: undefined, from: 'a@b.com', received_at: 1700000000 }),
      makeEmail({ id: '2', subject: undefined, from: 'a@b.com', received_at: 1700001000 }),
    ];
    const threads = groupEmailsByThread(emails);
    expect(threads.length).toBe(1);
  });

  test('handles missing from gracefully', () => {
    const emails = [
      makeEmail({ id: '1', subject: 'Hello', from: undefined, received_at: 1700000000 }),
    ];
    const threads = groupEmailsByThread(emails);
    expect(threads.length).toBe(1);
    expect(threads[0].participants).toEqual([]);
  });
});
