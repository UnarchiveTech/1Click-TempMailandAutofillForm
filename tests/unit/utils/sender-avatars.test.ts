/**
 * Unit tests for sender/domain avatar ranking (sender-avatars.ts).
 *
 * Regression coverage:
 *  1. Domain ranking by mail volume in the recent window, with full-history
 *     fallback when the window is empty.
 *  2. Letter extraction is code-point safe (emoji sender names).
 */
import { describe, expect, test } from 'bun:test';

import { getDomainAvatarStack } from '@/utils/email/sender-avatars.js';
import type { Email } from '@/utils/types.js';

const HOUR = 60 * 60 * 1000;

function email(from: string, fromName: string | undefined, received_at: number): Email {
  return { from, from_name: fromName, received_at } as Email;
}

describe('getDomainAvatarStack', () => {
  test('ranks domains by volume within the window', () => {
    const now = Date.now();
    const mails = [
      email('a@one.com', 'Alice', now - 1000),
      email('b@one.com', 'Bob', now - 2000),
      email('c@two.com', 'Carol', now - 3000),
      email('d@one.com', 'Dave', now - 4000),
      email('e@two.com', 'Eve', now - 5000),
      email('f@three.com', 'Frank', now - 6000),
    ];
    const { senders, remainder } = getDomainAvatarStack(mails, 4, 24 * HOUR);
    expect(senders.map((s) => s.domain)).toEqual(['one.com', 'two.com', 'three.com']);
    expect(remainder).toBe(0);
  });

  test('falls back to full history when nothing is in the window', () => {
    const now = Date.now();
    const old = email('a@one.com', 'Alice', now - 30 * 24 * HOUR);
    const { senders } = getDomainAvatarStack([old], 4, 24 * HOUR);
    expect(senders[0].domain).toBe('one.com');
  });

  test('returns empty when there is no mail or no from field', () => {
    expect(getDomainAvatarStack([], 4)).toEqual({ senders: [], remainder: 0 });
    expect(getDomainAvatarStack([email('', undefined, Date.now())], 4)).toEqual({
      senders: [],
      remainder: 0,
    });
    expect(getDomainAvatarStack(undefined, 4)).toEqual({ senders: [], remainder: 0 });
  });

  test('extracts the letter from the display name, code-point safe for emoji', () => {
    const now = Date.now();
    const mails = [email('x@one.com', '🌟Boss', now - 1000)];
    const { senders } = getDomainAvatarStack(mails, 4, 24 * HOUR);
    expect(Array.from(senders[0].letter)).toHaveLength(1);
    expect(senders[0].letter).toBe('🌟');
  });

  test('falls back to the email address first char when no display name', () => {
    const now = Date.now();
    const mails = [email('alice@one.com', undefined, now - 1000)];
    const { senders } = getDomainAvatarStack(mails, 4, 24 * HOUR);
    expect(senders[0].letter).toBe('A');
  });

  test('limits to max senders and reports the remainder count', () => {
    const now = Date.now();
    const mails = [1, 2, 3, 4, 5, 6].map((n) => email(`a${n}@d${n}.com`, `S${n}`, now - n * 1000));
    const { senders, remainder } = getDomainAvatarStack(mails, 4, 24 * HOUR);
    expect(senders).toHaveLength(4);
    expect(remainder).toBe(2);
  });
});
