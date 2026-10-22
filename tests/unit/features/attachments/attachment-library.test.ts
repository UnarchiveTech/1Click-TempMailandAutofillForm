import { describe, expect, test } from 'bun:test';
import {
  attachmentDownloadUrl,
  attachmentFileType,
  attachmentTypeLabel,
  buildAttachmentLibrary,
  filterAttachmentLibrary,
} from '@/features/attachments/attachment-library.js';
import type { Email } from '@/utils/types.js';

const mail = (id: string, fields: Partial<Email> = {}): Email => ({
  id,
  received_at: 1_792_000_000,
  from: 'billing@shop.example',
  from_name: 'Shop',
  subject: 'September receipt',
  attachments: [{ filename: 'Receipt.PDF', mimeType: 'application/pdf' }],
  ...fields,
});

describe('Attachment library', () => {
  test('indexes active and archived messages with inbox-scoped IDs and stable file keys', () => {
    const entries = buildAttachmentLibrary(
      { 'a@example.com': [mail('same')], 'b@example.com': [mail('same')] },
      { 'c@example.com': [mail('archived')] }
    );
    expect(entries).toHaveLength(3);
    expect(new Set(entries.map((entry) => entry.key)).size).toBe(3);
    expect(entries.find((entry) => entry.inbox === 'c@example.com')?.archived).toBe(true);
    expect(entries.find((entry) => entry.inbox === 'a@example.com')?.key).toBe(
      buildAttachmentLibrary({ 'a@example.com': [mail('same')] }, {})[0].key
    );
  });

  test('merges duplicate bags without losing a manifest or reviving a deleted message', () => {
    const stored = mail('same', { attachments: undefined, subject: 'Updated subject' });
    const archived = mail('same');
    const entries = buildAttachmentLibrary(
      { 'A@example.com': [stored, mail('deleted', { local_deleted: true })] },
      { 'a@example.com': [archived, mail('deleted')] }
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].attachment?.filename).toBe('Receipt.PDF');
    expect(entries[0].message.subject).toBe('Updated subject');
    expect(entries[0].archived).toBe(false);
    expect(stored.attachments).toBeUndefined();
    expect(archived.original_inbox).toBeUndefined();
  });

  test('represents flag-only messages honestly and preserves files with duplicate names', () => {
    const entries = buildAttachmentLibrary(
      {
        'a@example.com': [
          mail('flag', { attachments: undefined, hasAttachment: true }),
          mail('empty', { attachments: undefined }),
          mail('multi', {
            attachments: [
              { filename: 'receipt.pdf', mimeType: 'application/pdf', partNumber: '1' },
              { filename: 'receipt.pdf', mimeType: 'application/pdf', partNumber: '2' },
            ],
          }),
        ],
      },
      {}
    );
    expect(entries).toHaveLength(3);
    expect(new Set(entries.map((entry) => entry.key)).size).toBe(3);
    expect(entries.find((entry) => entry.message.id === 'flag')?.attachment).toBeNull();
  });

  test('searches multiple terms across filenames, senders, subjects, inboxes and type', () => {
    const entries = buildAttachmentLibrary({ 'a@example.com': [mail('receipt')] }, {});
    for (const query of [
      'receipt',
      'BILLING',
      'shop September',
      'a@example.com pdf',
      'Ｒｅｃｅｉｐｔ',
    ]) {
      expect(filterAttachmentLibrary(entries, query)).toHaveLength(1);
    }
    expect(filterAttachmentLibrary(entries, 'receipt missing')).toHaveLength(0);
    expect(filterAttachmentLibrary(entries, '', 'application/pdf', 'A@EXAMPLE.COM')).toHaveLength(
      1
    );
    expect(filterAttachmentLibrary(entries, '', 'image/png')).toHaveLength(0);
  });

  test('normalizes provider MIME values and falls back to filename extensions', () => {
    expect(
      attachmentFileType({ filename: 'a.pdf', mimeType: 'APPLICATION/PDF; charset=binary' })
    ).toBe('application/pdf');
    expect(attachmentFileType({ filename: 'a.PDF', mimeType: 'application/octet-stream' })).toBe(
      'application/pdf'
    );
    expect(attachmentFileType({ filename: 'a.custom', mimeType: '' })).toBe('.custom');
    expect(attachmentTypeLabel('application/pdf')).toBe('PDF');
    expect(attachmentTypeLabel('application/x-custom')).toBe('application/x-custom');
  });

  test('sorts mixed seconds and milliseconds consistently', () => {
    const entries = buildAttachmentLibrary(
      {
        'a@example.com': [
          mail('older', { received_at: 1_700_000_000_000 }),
          mail('newer', { received_at: 1_792_000_000 }),
        ],
      },
      {}
    );
    expect(entries.map((entry) => entry.message.id)).toEqual(['newer', 'older']);
  });

  test('allows explicit HTTP(S) navigation and blocks executable or credential-bearing URLs', () => {
    expect(attachmentDownloadUrl('https://shop.example/receipt?token=123')).toBe(
      'https://shop.example/receipt?token=123'
    );
    for (const url of [
      null,
      'javascript:alert(1)',
      'data:text/html,x',
      'file:///secret',
      'blob:https://shop.example/id',
      '//shop.example/receipt',
      'https://user:secret@shop.example/file',
    ]) {
      expect(attachmentDownloadUrl(url)).toBeUndefined();
    }
  });
});
