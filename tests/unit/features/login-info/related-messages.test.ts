import { expect, test } from 'bun:test';
import { buildRelatedMessages } from '@/features/login-info/related-messages.js';
import type { Email } from '@/utils/types.js';

const login = { domain: 'accounts.shop.example', email: 'me@example.com' };
const mail = (id: string, fields: Partial<Email> = {}): Email => ({
  id,
  from: 'Shop <billing@shop.example>',
  received_at: 100,
  subject: 'Receipt',
  ...fields,
});

test('matches the login mailbox and site, not subject mentions or lookalike domains', () => {
  const entries = buildRelatedMessages(
    login,
    {
      'ME@EXAMPLE.COM': [
        mail('receipt'),
        mail('other', { from: 'somebody@unrelated.example', subject: 'shop.example receipt' }),
        mail('suffix', { from: 'x@shop.example.evil.test' }),
      ],
      'someone@example.com': [mail('private')],
    },
    {}
  );
  expect(entries.map((entry) => entry.message.id)).toEqual(['receipt']);
  expect(buildRelatedMessages({ ...login, email: null }, {}, {})).toEqual([]);
});

test('keeps shared-host tenants separate and associates extracted sign-in links', () => {
  const entries = buildRelatedMessages(
    { ...login, domain: 'a.github.io' },
    {
      'me@example.com': [
        mail('neighbor', { from: 'x@b.github.io' }),
        mail('link', {
          from: 'x@delivery.example',
          magicLinks: [{ url: 'https://a.github.io/login', score: 1 }],
          hasMagicLink: true,
        }),
      ],
    },
    {}
  );
  expect(entries.map((entry) => entry.message.id)).toEqual(['link']);
});

test('merges duplicates, excludes active tombstones and sorts by date', () => {
  const entries = buildRelatedMessages(
    login,
    {
      'me@example.com': [
        mail('same', { local_deleted: true }),
        mail('recent', { received_at: 200 }),
      ],
    },
    { 'me@example.com': [mail('same'), mail('old')] }
  );
  expect(entries.map((entry) => entry.message.id)).toEqual(['recent', 'old']);
  expect(entries[1].archived).toBe(true);
});

test('classifies verification, security, receipts and other messages conservatively', () => {
  const entries = buildRelatedMessages(
    login,
    {
      'me@example.com': [
        mail('otp', { otp: '123456' }),
        mail('security', { subject: 'New login alert' }),
        mail('receipt'),
        mail('other', { subject: 'Newsletter' }),
      ],
    },
    {}
  );
  expect(Object.fromEntries(entries.map((entry) => [entry.message.id, entry.kind]))).toEqual({
    otp: 'verification',
    security: 'security',
    receipt: 'receipt',
    other: 'other',
  });
});
