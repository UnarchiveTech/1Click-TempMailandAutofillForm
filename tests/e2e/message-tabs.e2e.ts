import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import ar from '../../src/locales/ar.json' with { type: 'json' };
import en from '../../src/locales/en.json' with { type: 'json' };
import { expect, test } from './fixtures';
import { extensionUrl } from './preview-harness';
import { demoSeedStorage } from './seed';

const subjects = [
  'First receipt',
  'Second alert',
  'Third invoice',
  'Fourth update',
  'Fifth document',
  'Sixth message',
];

test('message tabs popup bootstrap has no runtime errors', async ({ context, extensionId }) => {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.log(error.stack);
  });
  try {
    await page.goto(extensionUrl(extensionId, 'popup.html'));
    await page.evaluate(async (seed) => chrome.storage.local.set(seed), demoSeedStorage());
    await page.reload();
    await expect(page.locator('#app nav, #app footer').first()).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});

for (const width of [1000, 1440]) {
  for (const lang of ['en', 'ar']) {
    test(`message tabs: ${width}px ${lang}`, async ({ extensionPage: page, extensionId }) => {
      const messages = lang === 'en' ? en : ar;
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(
        async ({ lang, subjects }) => {
          const now = Date.now();
          const emails = subjects.map((subject, index) => ({
            id: `tab-mail-${index}`,
            subject,
            from: `sender${index}@example.com`,
            from_name: `Sender ${index}`,
            received_at: now - index * 10_000,
            original_inbox: 'demo.user@example.com',
            body_html: Array.from(
              { length: 100 },
              (_, line) => `<p>${subject} paragraph ${line}</p>`
            ).join(''),
            body_plain: `${subject} content`,
          }));
          await chrome.storage.local.set({
            language: lang,
            locale: lang,
            preferredLanguage: lang,
            'storedEmailsByAddress_demo-inbox-1': emails,
            readEmails: {},
          });
        },
        { lang, subjects }
      );
      await page.goto(extensionUrl(extensionId, 'app.html?view=mailbox'));
      await page.waitForFunction((locale) => document.documentElement.lang === locale, lang);
      const list = page.locator('[data-mainview]');
      const row = page.locator('[data-message-tabs]');
      const body = page.locator('[data-message-scroll]');
      const open = async (subject: string) => {
        await list.getByText(subject, { exact: true }).click();
      };
      const tab = (subject: string) => row.getByRole('tab').filter({ hasText: subject });

      await open(subjects[0]);
      await expect(row.getByRole('tab')).toHaveCount(1);
      await expect(body).toBeVisible();
      await body.evaluate((node) => {
        node.scrollTop = 350;
      });
      await expect.poll(() => body.evaluate((node) => node.scrollTop)).toBeGreaterThan(300);
      await open(subjects[1]);
      await expect(row.getByRole('tab')).toHaveCount(2);
      await tab(subjects[0]).click();
      await expect.poll(() => body.evaluate((node) => node.scrollTop)).toBeGreaterThan(300);
      await open(subjects[0]);
      await expect(row.getByRole('tab')).toHaveCount(2);
      await tab(subjects[0]).press(lang === 'ar' ? 'ArrowLeft' : 'ArrowRight');
      await expect(tab(subjects[1])).toHaveAttribute('aria-selected', 'true');
      await expect(tab(subjects[1])).toBeFocused();
      await tab(subjects[1]).press('Delete');
      await expect(row.getByRole('tab')).toHaveCount(1);
      await expect(tab(subjects[0])).toHaveAttribute('aria-selected', 'true');

      // Collapse destroys the reader DOM while retaining the session tab state.
      await page
        .getByRole('button', { name: messages.common.collapseDetailPane, exact: true })
        .click();
      await expect(row).toHaveCount(0);
      await page
        .getByRole('button', { name: messages.common.expandSplitPane, exact: true })
        .click();
      await expect(row.getByRole('tab')).toHaveCount(1);
      await expect.poll(() => body.evaluate((node) => node.scrollTop)).toBeGreaterThan(300);

      if (width === 1000) {
        await list
          .getByRole('button', { name: messages.inbox.emailActions.selectAll, exact: true })
          .first()
          .click();
        await expect(row).toHaveCount(0);
        await expect(
          page.getByRole('button', { name: messages.common.expandDetailPane, exact: true })
        ).toBeVisible();
        await page
          .locator('[data-selection-strip]')
          .getByRole('button', { name: messages.inbox.emailActions.deselectAll, exact: true })
          .click();
        await expect(row.getByRole('tab')).toHaveCount(1);
        await expect.poll(() => body.evaluate((node) => node.scrollTop)).toBeGreaterThan(300);
      }

      for (const subject of subjects.slice(1)) await open(subject);
      await expect(row.getByRole('tab')).toHaveCount(6);
      expect(
        await row.getByRole('tablist').evaluate((node) => node.scrollWidth > node.clientWidth)
      ).toBe(true);
      await row.getByRole('combobox', { name: messages.inbox.messageTabsLabel }).click();
      await expect(page.getByRole('listbox')).toBeVisible();
      await page.getByRole('option').filter({ hasText: subjects[0] }).click();
      await expect(tab(subjects[0])).toHaveAttribute('aria-selected', 'true');
      const output = path.resolve('audit/message-tabs');
      await mkdir(output, { recursive: true });
      await page.screenshot({
        path: path.join(output, `${width}-${lang}.png`),
        animations: 'disabled',
      });

      // The reader's archive action closes only its tab and opens a neighbour.
      await page
        .locator('[data-message-tab-panel]')
        .getByRole('button', { name: messages.common.archive, exact: true })
        .click();
      await expect(row.getByRole('tab')).toHaveCount(5);
      await expect(tab(subjects[0])).toHaveCount(0);
      for (const subject of subjects.slice(1)) {
        const label = messages.inbox.closeMessageTab.replace('{subject}', subject);
        await row.getByRole('button', { name: label, exact: true }).click();
      }
      await expect(row).toHaveCount(0);
      await expect(page.locator('[data-message-tab-panel]')).toBeFocused();
    });
  }
}

test('compact popup keeps the existing single-message route', async ({ extensionPage: page }) => {
  await page.setViewportSize({ width: 360, height: 600 });
  await page.getByText('Your verification code', { exact: true }).click();
  await expect(page.locator('[data-message-scroll]')).toBeVisible();
  await expect(page.locator('[data-message-tabs]')).toHaveCount(0);
});

test('message tabs isolate identical IDs across inboxes and react to removal', async ({
  extensionPage: page,
  extensionId,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(async () => {
    const { addresses } = await chrome.storage.local.get('addresses');
    const first = addresses[0];
    const second = { ...first, id: 'demo-inbox-2', address: 'second@example.com' };
    const message = {
      id: '42',
      from: 'sender@example.com',
      received_at: Date.now(),
      body_plain: 'Scoped message content',
    };
    await chrome.storage.local.set({
      addresses: [first, second],
      emailStorageAddressIndex: { [first.id]: first.address, [second.id]: second.address },
      [`storedEmailsByAddress_${first.id}`]: [
        { ...message, subject: 'First inbox receipt', original_inbox: first.address },
      ],
      [`storedEmailsByAddress_${second.id}`]: [
        { ...message, subject: 'Second inbox receipt', original_inbox: second.address },
      ],
      readEmails: {},
    });
  });
  await page.goto(extensionUrl(extensionId, 'app.html?view=mailbox'));
  const list = page.locator('[data-mainview]');
  const tabs = page.locator('[data-message-tabs]');
  await list.getByText('First inbox receipt', { exact: true }).click();
  await list.getByRole('button', { name: en.address.nextAddress, exact: true }).click();
  await list.getByText('Second inbox receipt', { exact: true }).click();
  await expect(tabs.getByRole('tab')).toHaveCount(2);
  await expect
    .poll(async () =>
      page.evaluate(async () => (await chrome.storage.local.get('readEmails')).readEmails)
    )
    .toMatchObject({ 'demo.user@example.com_42': true, 'second@example.com_42': true });
  await tabs.getByRole('tab').filter({ hasText: 'First inbox receipt' }).click();
  await expect(list.getByText('Second inbox receipt', { exact: true })).toBeVisible();
  await page
    .locator('[data-message-tab-panel]')
    .getByRole('button', { name: en.inbox.emailActions.markUnread, exact: true })
    .click();
  await expect(tabs.getByRole('tab')).toHaveCount(1);
  await expect(tabs.getByRole('tab', { name: 'Second inbox receipt', exact: true })).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const { readEmails } = await chrome.storage.local.get('readEmails');
        return {
          first: !!readEmails['demo.user@example.com_42'],
          second: !!readEmails['second@example.com_42'],
        };
      })
    )
    .toEqual({ first: false, second: true });
  // Another extension surface removes the message while this tab remains open.
  await page.evaluate(async () =>
    chrome.storage.local.set({ 'storedEmailsByAddress_demo-inbox-2': [] })
  );
  await expect(tabs).toHaveCount(0);
  await expect(page.locator('[data-message-scroll]')).toHaveCount(0);
  await page.reload();
  await expect(tabs).toHaveCount(0);
});
