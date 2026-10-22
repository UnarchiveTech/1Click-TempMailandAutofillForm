import { describe, expect, test } from 'bun:test';
import {
  buildJsonExportPayload,
  generateMBOXContent,
  generateSingleEMLContent,
} from '@/features/address/inbox-export.js';
import type { Address, Email } from '@/utils/types.js';

function makeAddress(): Address {
  return {
    id: 'acc1',
    address: 'buffy@example.com',
    provider: 'demo',
    createdAt: 1,
    expiresAt: Number.MAX_SAFE_INTEGER,
  };
}

function makeEmail(overrides: Partial<Email> = {}): Email {
  return {
    id: 'msg1',
    subject: 'Invoice #42',
    from: 'sender@corp.com',
    from_name: 'Corp Billing',
    body: 'Your invoice is attached.',
    body_plain: 'Your invoice is attached.',
    received_at: 1_700_000_000,
    ...overrides,
  };
}

describe('buildJsonExportPayload', () => {
  test('embeds an attachments manifest with filename + mimeType per file', () => {
    const msgs = [
      makeEmail({
        attachments: [
          {
            filename: 'invoice.pdf',
            mimeType: 'application/pdf',
            partNumber: '2',
            downloadUrl: 'https://x/invoice.pdf',
          },
          { filename: 'receipt.png', mimeType: 'image/png' },
        ],
      }),
      makeEmail({ id: 'msg2', attachments: [{ filename: 'scan.jpg', mimeType: 'image/jpeg' }] }),
      makeEmail({ id: 'msg3' }), // no attachments
    ];

    const payload = buildJsonExportPayload(makeAddress(), msgs);

    expect(payload.address).toBe('buffy@example.com');
    expect(payload.attachments).toHaveLength(3);
    expect(payload.attachments[0]).toMatchObject({
      messageId: 'msg1',
      subject: 'Invoice #42',
      filename: 'invoice.pdf',
      mimeType: 'application/pdf',
      partNumber: '2',
      downloadUrl: 'https://x/invoice.pdf',
    });
    expect(payload.attachments[1]).toMatchObject({
      messageId: 'msg1',
      filename: 'receipt.png',
      mimeType: 'image/png',
    });
    expect(payload.attachments[2]).toMatchObject({
      messageId: 'msg2',
      filename: 'scan.jpg',
      mimeType: 'image/jpeg',
    });
    // Full messages keep their attachment metadata too (survives JSON round-trip)
    expect(payload.messages[0].attachments?.[0]?.mimeType).toBe('application/pdf');
  });

  test('emits an empty manifest when no message has attachments', () => {
    const payload = buildJsonExportPayload(makeAddress(), [makeEmail(), makeEmail({ id: 'msg2' })]);
    expect(payload.attachments).toEqual([]);
  });
});

describe('generateSingleEMLContent', () => {
  test('keeps single-part text/plain EML when there are no attachments', () => {
    const eml = generateSingleEMLContent(makeAddress(), makeEmail());

    expect(eml).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(eml).not.toContain('multipart/mixed');
    expect(eml).not.toContain('Content-Disposition: attachment');
  });

  test('single-part EML labels an HTML body as text/html so clients render it', () => {
    const eml = generateSingleEMLContent(
      makeAddress(),
      makeEmail({ body_plain: undefined, body: undefined, body_html: '<p>HTML only</p>' })
    );

    expect(eml).toContain('Content-Type: text/html; charset=UTF-8');
    expect(eml).not.toContain('Content-Type: text/plain');
    expect(eml).not.toContain('multipart/mixed');
    expect(eml).toContain('<p>HTML only</p>');
    expect(eml).not.toContain('No content');
  });

  test('single-part EML stays text/plain when only a plain body exists', () => {
    const eml = generateSingleEMLContent(makeAddress(), makeEmail());

    expect(eml).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(eml).not.toContain('Content-Type: text/html');
    expect(eml).not.toContain('multipart/mixed');
  });

  test('emits multipart/mixed with one part per attachment preserving filename + mimeType', () => {
    const eml = generateSingleEMLContent(
      makeAddress(),
      makeEmail({
        attachments: [
          { filename: 'invoice.pdf', mimeType: 'application/pdf' },
          { filename: 'scan photo.png', mimeType: 'image/png' },
        ],
      })
    );

    expect(eml).toContain('MIME-Version: 1.0');
    expect(eml).toMatch(/Content-Type: multipart\/mixed; boundary="[^"]+"/);
    expect(eml).toContain('Content-Type: application/pdf; name="invoice.pdf"');
    expect(eml).toContain('Content-Disposition: attachment; filename="invoice.pdf"');
    expect(eml).toContain('Content-Type: image/png; name="scan photo.png"');
    expect(eml).toContain('Content-Disposition: attachment; filename="scan photo.png"');
    // Body part still present
    expect(eml).toContain('Your invoice is attached.');
    // Properly terminated multipart
    const boundary = eml.match(/boundary="([^"]+)"/)?.[1];
    expect(boundary).toBeTruthy();
    expect(eml).toContain(`--${boundary}--`);
    // Each attachment part appears exactly once
    expect(eml.match(/Content-Disposition: attachment;/g)).toHaveLength(2);
  });

  test('sanitizes header injection attempts in filenames', () => {
    const eml = generateSingleEMLContent(
      makeAddress(),
      makeEmail({
        attachments: [{ filename: 'evil"\r\nBcc: victim@example.com', mimeType: 'text/plain' }],
      })
    );

    expect(eml).not.toContain('\r\nBcc: victim@example.com');
    expect(eml).toContain('filename="evil___Bcc: victim@example.com"');
  });

  test('sanitizes CR/LF from synthesized message headers', () => {
    const account = makeAddress();
    account.address = 'buffy@example.com\r\nX-Injected: account';
    const eml = generateSingleEMLContent(
      account,
      makeEmail({
        id: 'msg-1\nX-Injected: id',
        from: 'sender@example.com\r\nBcc: victim@example.com',
        subject: 'Invoice\nX-Injected: subject',
      })
    );

    expect(eml).not.toMatch(/\r?\n(?:X-Injected|Bcc):/);
    expect(eml).toContain('From: sender@example.com__Bcc: victim@example.com');
    expect(eml).toContain('Subject: Invoice_X-Injected: subject');
  });

  test('uses HTML body part when body_html is present', () => {
    const eml = generateSingleEMLContent(
      makeAddress(),
      makeEmail({
        body_html: '<p>Hello</p>',
        attachments: [{ filename: 'a.zip', mimeType: 'application/zip' }],
      })
    );

    expect(eml).toContain('Content-Type: text/html; charset=UTF-8');
    expect(eml).toContain('<p>Hello</p>');
  });

  test('emits the raw MIME source verbatim when raw_source is present', () => {
    const rawSource =
      'Delivered-To: buffy@example.com\r\n' +
      'From: info@talisteam.com\r\n' +
      'Content-Type: multipart/alternative; boundary="bnd"\r\n' +
      '\r\n' +
      '--bnd\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>original</p>\r\n--bnd--\r\n';
    const eml = generateSingleEMLContent(makeAddress(), makeEmail({ raw_source: rawSource }));

    expect(eml).toContain('Delivered-To: buffy@example.com');
    expect(eml).toContain('From: info@talisteam.com');
    expect(eml).toContain('multipart/alternative');
    expect(eml).toContain('<p>original</p>');
    // The synthesized fallback headers must NOT appear (raw source is used verbatim)
    expect(eml).not.toContain('Content-Transfer-Encoding: 8bit');
  });

  test('raw source keeps a trailing newline for clean file endings', () => {
    const eml = generateSingleEMLContent(
      makeAddress(),
      makeEmail({ raw_source: 'From: x@y.z\r\n\r\nbody' })
    );
    expect(eml.endsWith('\n')).toBe(true);
  });
});

describe('generateMBOXContent', () => {
  test('reuses the EML builder so attachment parts survive in MBOX', () => {
    const mbox = generateMBOXContent(makeAddress(), [
      makeEmail({
        attachments: [
          { filename: 'invoice.pdf', mimeType: 'application/pdf' },
          { filename: 'photo.png', mimeType: 'image/png' },
        ],
      }),
    ]);

    // MBOX separator line present
    expect(mbox.startsWith('From sender@corp.com ')).toBe(true);
    // Attachment metadata preserved via multipart/mixed
    expect(mbox).toContain('multipart/mixed');
    expect(mbox).toContain('Content-Type: application/pdf; name="invoice.pdf"');
    expect(mbox).toContain('Content-Disposition: attachment; filename="photo.png"');
    expect(mbox).toMatch(/Content-Disposition: attachment;/g);
  });

  test('keeps single-part messages when there are no attachments', () => {
    const mbox = generateMBOXContent(makeAddress(), [makeEmail()]);

    expect(mbox).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(mbox).not.toContain('multipart/mixed');
    expect(mbox).not.toContain('Content-Disposition: attachment');
  });

  test('escapes lines starting with "From " (mboxrd) inside the message', () => {
    const mbox = generateMBOXContent(makeAddress(), [
      makeEmail({ body_plain: 'From the desk of the sender\nFrom another line\nNormal line' }),
    ]);

    expect(mbox).toContain('>From the desk of the sender');
    expect(mbox).toContain('>From another line');
    expect(mbox).toContain('Normal line');
    // Only the MBOX separator starts with an unescaped "From "
    const fromLines = mbox.split('\n').filter((l) => l.startsWith('From '));
    expect(fromLines).toHaveLength(1);
  });

  test('separates multiple messages with blank lines', () => {
    const mbox = generateMBOXContent(makeAddress(), [makeEmail(), makeEmail({ id: 'msg2' })]);

    expect(mbox.match(/^From /gm)).toHaveLength(2);
    expect(mbox).toContain('\n\nFrom ');
    // Exactly one blank line between messages (not two)
    expect(mbox).not.toContain('\n\n\nFrom ');
  });

  test('From header carries the sender address, not the display name alone', () => {
    const mbox = generateMBOXContent(makeAddress(), [makeEmail()]);

    expect(mbox).toContain('From: sender@corp.com');
    expect(mbox).not.toContain('From: Corp Billing');
  });
});
