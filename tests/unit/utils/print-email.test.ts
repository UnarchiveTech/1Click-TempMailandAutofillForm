import { afterAll, describe, expect, mock, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import type { Email } from '@/utils/types.js';

afterAll(() => {
  mock.restore();
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else Reflect.deleteProperty(globalThis, 'document');
  printDom.window.close();
});

const MAILBOX = 'a@example.com';

const hostileMessage = {
  id: 'm1',
  subject: '<b>Subj</b>',
  from_name: 'Sender',
  from: MAILBOX,
  received_at: 1700000000000,
  body_html:
    '<p>Safe body</p><script>alert(1)</script><img src=x onerror=alert(2)><svg onload=alert(3)>',
};

mock.module('@/utils/storage/storage-keys.js', () => ({
  getEmailMaps: async () => ({
    storedEmails: { [MAILBOX]: [hostileMessage] },
    archivedEmails: {},
  }),
  resolveBagKey: (_map: Record<string, unknown>, address: string) => address,
}));

await import('@/utils/i18n/i18n.js');
const { waitLocale } = await import('svelte-i18n');
await waitLocale();

const { initSanitize } = await import('@/utils/email/sanitize-html.js');
await initSanitize();
const printDom = new JSDOM('<body></body>');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
Object.defineProperty(globalThis, 'document', {
  value: printDom.window.document,
  configurable: true,
});
const { buildEmailPrintHtml, prepareEmailPrintFromStorage, printHtmlDocument } = await import(
  '@/utils/email/print-email.js'
);

describe('print frame failures', () => {
  test('focus failure returns false, removes the frame and does not announce completion', () => {
    const doc = printDom.window.document;
    const iframe = doc.createElement('iframe');
    const createDescriptor = Object.getOwnPropertyDescriptor(doc, 'createElement');
    const appendDescriptor = Object.getOwnPropertyDescriptor(doc.body, 'appendChild');
    const appendChild = doc.body.appendChild.bind(doc.body);
    let restoreFocus = () => {};
    const append = mock((node: Node) => {
      const appended = appendChild(node);
      const win = iframe.contentWindow;
      if (win) {
        const focusDescriptor = Object.getOwnPropertyDescriptor(win, 'focus');
        Object.defineProperty(win, 'focus', {
          value: () => {
            throw new Error('Injected focus failure');
          },
          configurable: true,
        });
        restoreFocus = () => {
          if (focusDescriptor) Object.defineProperty(win, 'focus', focusDescriptor);
          else Reflect.deleteProperty(win, 'focus');
        };
      }
      return appended;
    });
    const createElement = mock(() => iframe);
    Object.defineProperty(doc.body, 'appendChild', { value: append, configurable: true });
    Object.defineProperty(doc, 'createElement', { value: createElement, configurable: true });
    const completed = mock();
    try {
      expect(printHtmlDocument('<p>Message</p>', 'Message', completed)).toBe(false);
      expect(createElement).toHaveBeenCalled();
      expect(append).toHaveBeenCalled();
      expect(doc.querySelector('iframe') === null).toBe(true);
      expect(completed).not.toHaveBeenCalled();
    } finally {
      restoreFocus();
      if (appendDescriptor) Object.defineProperty(doc.body, 'appendChild', appendDescriptor);
      else Reflect.deleteProperty(doc.body, 'appendChild');
      if (createDescriptor) Object.defineProperty(doc, 'createElement', createDescriptor);
      else Reflect.deleteProperty(doc, 'createElement');
    }
  });
});

describe('prepareEmailPrintFromStorage', () => {
  test('sanitizes hostile body HTML and keeps header fields entity-escaped', async () => {
    const prepared = await prepareEmailPrintFromStorage(MAILBOX, hostileMessage.id);
    expect(prepared).not.toBeNull();
    const html = (prepared as { html: string }).html;

    // Header fields are display text: escaped, never re-parsed as markup.
    expect(html).toContain('&lt;b&gt;Subj&lt;/b&gt;');
    expect(html).not.toContain('<b>Subj</b>');

    // Body travels through sanitizeHtml (the call-site check the
    // printHtmlDocument contract relies on): no live vector survives.
    expect(html).toContain('Safe body');
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/onerror\s*=/i);
    expect(html).not.toMatch(/onload\s*=/i);
    expect(html).not.toContain('alert(1)');
    expect(html).not.toContain('alert(2)');
    expect(html).not.toContain('alert(3)');

    expect((prepared as { title: string }).title).toBe(hostileMessage.subject);
  });

  test('returns null when the message id is unknown', async () => {
    expect(await prepareEmailPrintFromStorage(MAILBOX, 'missing')).toBeNull();
  });
});

describe('buildEmailPrintHtml', () => {
  test('embeds the pre-sanitized body as-is and escapes every header field', () => {
    const msg = {
      id: 'x',
      subject: 'Hi <script>alert(9)</script>',
      from_name: 'B <c>',
      from: 'b@example.com',
      received_at: 1700000000000,
    } as unknown as Email;
    const html = buildEmailPrintHtml(msg, '<p>already safe</p>');

    // The body half of the contract: builder embeds what the caller sanitized.
    expect(html).toContain('<p>already safe</p>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('alert(9)</script>');
    // from_name / from stay escaped display text inside the header.
    expect(html).toContain('B &lt;c&gt;');
    expect(html).not.toContain('B <c>');
  });
});
