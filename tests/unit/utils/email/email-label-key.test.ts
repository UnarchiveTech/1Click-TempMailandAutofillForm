import { describe, expect, test } from 'bun:test';
import {
  emailLabelKey,
  emailLabelKeyForEmail,
  migrateLegacyEmailLabelKeys,
} from '@/utils/email/email-label-key.js';
import type { Email } from '@/utils/types.js';

const mail = (id: string, original_inbox?: string): Email =>
  ({ id, received_at: 1, original_inbox }) as Email;

describe('email-label-key', () => {
  test('scopes labels to the normalized inbox address', () => {
    expect(emailLabelKey('42', 'Inbox@Example.com')).toBe('inbox@example.com_42');
    expect(emailLabelKeyForEmail(mail('42', 'Inbox@Example.com'), 'fallback@example.com')).toBe(
      'inbox@example.com_42'
    );
  });

  test('migrates legacy labels separately for colliding provider IDs', () => {
    const original = { '42': ['Banking'] };
    const migrated = migrateLegacyEmailLabelKeys(original, {
      storedEmails: {
        'a@example.com': [mail('42')],
        'b@example.com': [mail('42')],
      },
      archivedEmails: {},
    });

    expect(migrated).toEqual({
      'a@example.com_42': ['Banking'],
      'b@example.com_42': ['Banking'],
    });
    expect(original).toEqual({ '42': ['Banking'] });
  });

  test('keeps scoped entries and removes legacy labels for deleted messages', () => {
    const migrated = migrateLegacyEmailLabelKeys(
      {
        'gone-id': ['Old'],
        'a@example.com_42': ['Work'],
      },
      { storedEmails: { 'a@example.com': [mail('42')] }, archivedEmails: {} }
    );

    expect(migrated).toEqual({ 'a@example.com_42': ['Work'] });
  });
});
