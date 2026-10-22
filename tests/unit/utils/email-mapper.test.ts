import { describe, expect, test } from 'bun:test';
import { computeUnreadCounts, mapEmailForDisplay } from '@/utils/email/email-mapper';
import {
  createEmailReadChecker,
  isEmailRead,
  setEmailReadState,
} from '@/utils/storage/storage-keys.js';

interface MapInput {
  id: string;
  from: string;
  from_name?: string;
  subject: string;
  body?: string;
  body_html?: string;
  received_at?: number;
  otp?: unknown;
  magicLinks?: Array<{ url: string; token?: string }>;
  hasMagicLink?: boolean;
  original_inbox?: string;
}

// The display stand-ins are REQUIRED (the mapper cannot localize itself - it is
// reachable from the background graph, where only minimal dictionaries exist),
// so the fixture supplies the English wording the real UI resolves through t().
const LABELS = {
  unknownSender: 'Unknown',
  noSubject: 'No Subject',
  invalidMessage: 'Invalid message',
};

describe('mailbox-scoped read state', () => {
  test('colliding IDs and legacy bare IDs cannot mark another inbox read', () => {
    const message = { id: '42', from: 'sender@example.com', subject: 'Hi' };
    const bags = {
      'a@example.com': [{ ...message, original_inbox: 'a@example.com' }],
      'b@example.com': [{ ...message, original_inbox: 'b@example.com' }],
    };
    const reads: Record<string, boolean> = { '42': true };
    expect(computeUnreadCounts(bags as never, reads)).toEqual({
      'a@example.com': 1,
      'b@example.com': 1,
    });
    setEmailReadState(reads, '42', ['A@EXAMPLE.COM'], true);
    expect(reads).toEqual({ '42': true, 'a@example.com_42': true });
    expect(computeUnreadCounts(bags as never, reads)).toEqual({
      'a@example.com': 0,
      'b@example.com': 1,
    });
    expect(
      mapEmailForDisplay(bags['b@example.com'][0] as never, reads, 'b@example.com', {
        labels: LABELS,
      }).unread
    ).toBe(true);
    setEmailReadState(reads, '42', ['b@example.com'], true);
    setEmailReadState(reads, '42', ['a@example.com'], false);
    expect(computeUnreadCounts(bags as never, reads)).toEqual({
      'a@example.com': 1,
      'b@example.com': 0,
    });
  });

  test('address casing is tolerated while underscore-bearing IDs keep their exact case', () => {
    const reads: Record<string, boolean> = { 'User@Example.COM_Ab_C': true };
    expect(isEmailRead(reads, 'Ab_C', 'user@example.com')).toBe(true);
    expect(isEmailRead(reads, 'ab_c', 'user@example.com')).toBe(false);
    const read = createEmailReadChecker(reads);
    expect(read('Ab_C', 'USER@example.com')).toBe(true);
    expect(read('ab_c', 'user@example.com')).toBe(false);
    setEmailReadState(reads, 'Ab_C', ['USER@example.com'], false);
    expect(reads).toEqual({});
  });

  test('a provider ID shaped like another inbox key cannot clear that inbox read flag', () => {
    const reads = { 'b@example.com_42': true };
    setEmailReadState(reads, 'b@example.com_42', ['a@example.com'], false);
    expect(isEmailRead(reads, '42', 'b@example.com')).toBe(true);
  });
});

function map(input: MapInput) {
  return mapEmailForDisplay(input as never, {}, input.original_inbox || 'a@example.com', {
    labels: LABELS,
    messageRetentionMs: 60 * 60 * 1000,
  });
}

describe('mapEmailForDisplay - unknown received_at', () => {
  test('receives a real seconds timestamp → messageExpiresAt = receivedMs + retention', () => {
    const received = 1_700_000_000; // seconds
    const out = map({ id: 'm1', from: 's@x.com', subject: 'Hi', received_at: received });
    expect(out.messageExpiresAt).toBe(received * 1000 + 60 * 60 * 1000);
    expect(out.received_at).toBe(received);
  });

  test('passes millisecond timestamps through unchanged', () => {
    const receivedMs = 1_700_000_000_000;
    const out = map({ id: 'm2', from: 's@x.com', subject: 'Hi', received_at: receivedMs });
    expect(out.messageExpiresAt).toBe(receivedMs + 60 * 60 * 1000);
  });

  test('omitted received_at → NO fabricated expiry (regression: used Date.now())', () => {
    const out = map({ id: 'm3', from: 's@x.com', subject: 'Hi' });
    expect(out.received_at).toBeUndefined();
    // The old code substituted Date.now(), so messageExpiresAt was always
    // defined (~now + retention) and re-freshened on every rebuild, so a
    // legacy message could never age out. Unknown age must mean no claim.
    expect(out.messageExpiresAt).toBeUndefined();
  });

  test('received_at = 0 → same unknown-age semantics as omitted', () => {
    const out = map({ id: 'm4', from: 's@x.com', subject: 'Hi', received_at: 0 });
    expect(out.messageExpiresAt).toBeUndefined();
  });

  test('unknown age + OTP → no fabricated OTP expiry', () => {
    const out = map({
      id: 'm5',
      from: 's@x.com',
      subject: 'Code: 123456',
      otp: '123456',
      body: 'Your code is 123456',
    });
    expect(out.isOtp).toBe(true);
    expect(out.otpExpiresAt).toBeUndefined();
  });

  test('unknown age + magic link → no fabricated link expiry', () => {
    const out = map({
      id: 'm6',
      from: 's@x.com',
      subject: 'Verify',
      body: 'Click https://example.com/magic?token=abc',
    });
    expect(out.messageExpiresAt).toBeUndefined();
    for (const link of out.magicLinks || []) {
      expect(link.expiresAt).toBeUndefined();
    }
  });

  test('expiry is stable across rebuilds when age is unknown (no fresh-now injection)', () => {
    const first = map({ id: 'm7', from: 's@x.com', subject: 'Hi' });
    const second = map({ id: 'm7', from: 's@x.com', subject: 'Hi' });
    expect(first.messageExpiresAt).toBe(second.messageExpiresAt);
    expect(first.messageExpiresAt).toBeUndefined();
  });
});
