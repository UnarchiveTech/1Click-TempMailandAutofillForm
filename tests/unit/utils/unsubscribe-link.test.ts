import { describe, expect, test } from 'bun:test';
import { findUnsubscribeLink } from '@/utils/email/unsubscribe-link.js';

describe('sender unsubscribe actions', () => {
  for (const label of [
    'Unsubscribe',
    'Darse de baja',
    'Abmelden',
    'Se désabonner',
    'إلغاء الاشتراك',
    '配信停止',
    '退订',
    'ยกเลิกรับ',
  ]) {
    test(`detects labelled action ${label}`, () => {
      expect(
        findUnsubscribeLink({
          body_html: `<a href="https://sender.test/leave?id=a&amp;b=c">${label}</a>`,
        })
      ).toBe('https://sender.test/leave?id=a&b=c');
    });
  }
  test('prefers a header HTTPS action, unfolds headers, and keeps email-only actions', () => {
    expect(
      findUnsubscribeLink({
        raw_source:
          'List-Unsubscribe: <mailto:leave@sender.test>,\r\n <https://sender.test/unsubscribe>\r\n\r\nBody',
        body_html: '<a href="https://other.test/unsubscribe">Unsubscribe</a>',
      })
    ).toBe('https://sender.test/unsubscribe');
    expect(
      findUnsubscribeLink({ raw_source: 'List-Unsubscribe: <mailto:leave@sender.test>\n\nBody' })
    ).toBe('mailto:leave@sender.test');
  });
  test('does not invent destinations or accept executable, relative or fake body headers', () => {
    expect(
      findUnsubscribeLink({
        body_html: '<a href="javascript:alert(1)">Unsubscribe</a><a href="/leave">Unsubscribe</a>',
      })
    ).toBeUndefined();
    expect(
      findUnsubscribeLink({ body_html: '<a href="https://sender.test/help">Help</a>' })
    ).toBeUndefined();
    expect(
      findUnsubscribeLink({ raw_source: 'Subject: hi\n\nList-Unsubscribe: <https://evil.test/>' })
    ).toBeUndefined();
  });
});
