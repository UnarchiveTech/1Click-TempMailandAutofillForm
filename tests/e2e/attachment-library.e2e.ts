import { expect, test } from './fixtures';
import { extensionUrl } from './preview-harness';

for (const shell of ['popup', 'sidepanel', 'app']) {
  test(`${shell}: attachment library searches every inbox, filters and previews source messages`, async ({
    extensionPage: page,
    extensionId,
    context,
  }, info) => {
    await page.setViewportSize({
      width: shell === 'app' ? 1440 : 360,
      height: shell === 'app' ? 900 : 640,
    });
    await page.evaluate(async () => {
      const now = Date.now();
      const message = (id: string, subject: string, filename: string, from: string) => ({
        id,
        received_at: now,
        subject,
        from,
        body_plain: `Source: ${subject}`,
        attachments: [
          {
            filename,
            mimeType: filename.endsWith('.pdf') ? 'application/pdf' : 'image/png',
            downloadUrl: 'https://api.guerrillamail.com/__e2e__/receipt',
          },
        ],
      });
      await chrome.storage.local.set({
        emailStorageAddressIndex: {
          'demo-inbox-1': 'demo.user@example.com',
          'library-inbox': 'receipts@example.com',
        },
        'storedEmailsByAddress_demo-inbox-1': [
          message('same-id', 'Shop receipt', 'shop-receipt.pdf', 'billing@shop.example'),
          {
            ...message('deleted', 'Deleted receipt', 'deleted.pdf', 'removed@example.com'),
            local_deleted: true,
          },
        ],
        'storedEmailsByAddress_library-inbox': [
          message('same-id', 'Travel ticket', 'ticket.png', 'travel@example.com'),
        ],
        'archivedEmailsByAddress_library-inbox': [
          message('archived', 'Archived invoice', 'invoice.pdf', 'archive@example.com'),
        ],
      });
    });
    await page.goto(extensionUrl(extensionId, `${shell}.html?view=mailbox`));
    const opener = page.getByRole('button', { name: 'Attachment library', exact: true });
    await opener.focus();
    await page.keyboard.press('Enter');
    const library = page.locator('[data-attachment-library]');
    const rows = library.locator('[data-attachment-entry]');
    await expect(rows).toHaveCount(3);
    await page.screenshot({ path: info.outputPath('attachment-library-all.png') });
    await expect(library).not.toContainText('deleted.pdf');
    await expect(library).toContainText('Archived');
    const search = library.getByRole('textbox', {
      name: 'Search filenames, senders, subjects or inboxes',
    });
    await search.fill('BILLING');
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText('shop-receipt.pdf');
    await library.locator('[data-filter-chip="query"]').click();
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    await expect(rows).toHaveCount(3);
    await search.fill('no-such-attachment');
    await expect(library).toContainText('No matching attachments');
    await library.getByRole('button', { name: 'Clear filters', exact: true }).last().click();
    await expect(rows).toHaveCount(3);
    const type = library.getByRole('combobox', { name: 'File type', exact: true });
    await type.click();
    await page.getByRole('option', { name: 'PDF', exact: true }).click();
    await expect(rows).toHaveCount(2);
    await expect(type).toBeFocused();
    const inbox = library.getByRole('combobox', { name: 'Inbox', exact: true });
    await inbox.click();
    await page.getByRole('option', { name: 'receipts@example.com', exact: true }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText('invoice.pdf');
    await expect(library.locator('[data-filter-chip]')).toHaveCount(2);
    await expect
      .poll(() =>
        library.evaluate(
          (node) => getComputedStyle(node.closest('[role="dialog"]') ?? node).opacity
        )
      )
      .toBe('1');
    await page.screenshot({ path: info.outputPath('attachment-library.png') });
    const view = rows.getByRole('button', { name: 'View message', exact: true });
    await view.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-attachment-source]')).toContainText(
      'Source: Archived invoice'
    );
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await page.screenshot({
      path: info.outputPath('attachment-source.png'),
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-attachment-source]')).toHaveCount(0);
    await expect(library).toBeVisible();
    await expect(view).toBeFocused();
    await expect(type).toContainText('PDF');
    await expect(inbox).toContainText('receipts@example.com');
    await view.click();
    await page.getByRole('button', { name: 'Back to results', exact: true }).click();
    await expect(view).toBeFocused();

    await context.route('https://api.guerrillamail.com/__e2e__/receipt', (route) =>
      route.fulfill({ body: 'Test attachment', contentType: 'text/plain' })
    );
    const downloadPage = context.waitForEvent('page');
    await rows.getByRole('button', { name: 'Download', exact: true }).click();
    const opened = await downloadPage;
    await expect.poll(() => opened.url()).toBe('https://api.guerrillamail.com/__e2e__/receipt');
    await opened.close();

    // A live bag removal must retire its attachments without reopening the dialog.
    await page.evaluate(() => chrome.storage.local.remove('archivedEmailsByAddress_library-inbox'));
    await expect(rows).toHaveCount(0);
    await expect(library).toContainText('No matching attachments');
    await page.keyboard.press('Escape');
    await expect(library).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
}

test('attachment library pagination, missing metadata and unsafe download URLs', async ({
  extensionPage: page,
}) => {
  await page.evaluate(async () => {
    const now = Date.now();
    await chrome.storage.local.set({
      'storedEmailsByAddress_demo-inbox-1': [
        ...Array.from({ length: 45 }, (_, i) => ({
          id: `attachment-${i}`,
          received_at: now - i,
          subject: `Invoice ${i}`,
          from: 'billing@shop.example',
          attachments: [
            {
              filename: `invoice-${i}.pdf`,
              mimeType: 'application/pdf',
              downloadUrl: 'javascript:alert(1)',
            },
          ],
        })),
        {
          id: 'flag-only',
          received_at: now - 1000,
          hasAttachment: true,
          subject: 'Missing manifest',
        },
      ],
    });
  });
  await page.getByRole('button', { name: 'Attachment library', exact: true }).click();
  const library = page.locator('[data-attachment-library]');
  const rows = library.locator('[data-attachment-entry]');
  await expect(rows).toHaveCount(40);
  await library.getByRole('button', { name: 'Show more attachments' }).click();
  await expect(rows).toHaveCount(46);
  await expect(library.getByRole('button', { name: 'Download', exact: true })).toHaveCount(0);
  const lastPreview = rows.last().getByRole('button', { name: 'View message', exact: true });
  await lastPreview.focus();
  const scrollTop = await library.evaluate((node) => node.closest('.scroll-body')?.scrollTop ?? 0);
  expect(scrollTop).toBeGreaterThan(0);
  await lastPreview.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.getByRole('button', { name: 'Back to results', exact: true }).click();
  await expect(lastPreview).toBeFocused();
  await expect
    .poll(() => library.evaluate((node) => node.closest('.scroll-body')?.scrollTop ?? 0))
    .toBe(scrollTop);
  await library.getByRole('textbox').fill('Missing manifest');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Attachment name unavailable');
  await expect(rows).toContainText('provider has not supplied');
});

for (const appearance of [
  {
    theme: 'dark',
    language: 'en',
    shell: 'sidepanel',
    title: 'Attachment library',
    fileType: 'File type',
    allTypes: 'All file types',
  },
  {
    theme: 'light',
    language: 'ar',
    shell: 'popup',
    title: 'مكتبة المرفقات',
    fileType: 'نوع الملف',
    allTypes: 'جميع أنواع الملفات',
  },
]) {
  test(`attachment library ${appearance.theme}/${appearance.language}: rendered filters remain inside the dialog`, async ({
    extensionPage: page,
    extensionId,
  }, info) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.evaluate(async ({ theme, language }) => {
      await chrome.storage.local.set({
        themeMode: theme,
        locale: language,
        preferredLanguage: language,
        'storedEmailsByAddress_demo-inbox-1': [
          {
            id: 'receipt',
            received_at: Date.now(),
            from: 'billing@shop.example',
            subject: 'Receipt',
            attachments: [{ filename: 'receipt.pdf', mimeType: 'application/pdf' }],
          },
        ],
      });
    }, appearance);
    await page.goto(extensionUrl(extensionId, `${appearance.shell}.html?view=mailbox`));
    await page.getByRole('button', { name: appearance.title, exact: true }).click();
    const library = page.locator('[data-attachment-library]');
    await expect(library.locator('[data-attachment-entry]')).toHaveCount(1);
    const geometry = await library.evaluate((node) => ({
      width: node.clientWidth,
      scrollWidth: node.scrollWidth,
      direction: getComputedStyle(node).direction,
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
    expect(geometry.direction).toBe(appearance.language === 'ar' ? 'rtl' : 'ltr');
    const fileType = library.getByRole('combobox', { name: appearance.fileType, exact: true });
    await fileType.click();
    await expect(
      page.getByRole('option', { name: appearance.allTypes, exact: true })
    ).toBeVisible();
    await page.getByRole('option', { name: 'PDF', exact: true }).click();
    await expect(fileType).toBeFocused();
    await page.screenshot({ path: info.outputPath('attachment-library-appearance.png') });
  });
}
