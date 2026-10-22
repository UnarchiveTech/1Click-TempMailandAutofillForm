import { expect, test } from './fixtures';
import { extensionUrl } from './preview-harness';

for (const shell of ['popup', 'sidepanel', 'app']) {
  test(`${shell}: related-message timeline and hold-to-discover shortcuts`, async ({
    extensionPage: page,
    extensionId,
  }, info) => {
    await page.setViewportSize({
      width: shell === 'app' ? 1440 : 360,
      height: shell === 'app' ? 900 : 640,
    });
    await page.evaluate(async () => {
      const now = Date.now();
      const mail = (id: string, subject: string, extra = {}) => ({
        id,
        from: 'Shop <billing@shop.example>',
        subject,
        received_at: now,
        body_plain: `Message body: ${subject}`,
        ...extra,
      });
      await chrome.storage.local.set({
        loginInfo: [
          {
            id: 'timeline-login',
            domain: 'shop.example',
            email: 'demo.user@example.com',
            password: '',
            timestamp: now,
          },
        ],
        'storedEmailsByAddress_demo-inbox-1': [
          mail('verify', 'Verify your email', { otp: '123456' }),
          mail('receipt', 'Order receipt'),
          mail('security', 'New login alert'),
          mail('unrelated', 'shop.example receipt', { from: 'x@other.example' }),
          mail('deleted', 'Deleted receipt', { local_deleted: true }),
        ],
        'archivedEmailsByAddress_demo-inbox-1': [mail('archived', 'Archived receipt')],
      });
    });
    await page.goto(extensionUrl(extensionId, `${shell}.html?view=autofill`));
    await page.getByRole('tab', { name: /^Saved Logins/ }).click();
    await page.locator('[data-selectable-row="timeline-login"] [data-row-primary]').click();
    const opener = page.getByRole('button', { name: 'Related messages', exact: true });
    await opener.focus();
    await page.keyboard.press('Enter');
    const dialog = page.locator('[data-related-messages]');
    await expect(dialog.locator('[data-related-message]')).toHaveCount(4);
    await expect(dialog).not.toContainText('Deleted receipt');
    await page.screenshot({
      path: info.outputPath('related-messages.png'),
      animations: 'disabled',
    });
    const category = dialog.getByRole('combobox', { name: 'Category', exact: true });
    await category.click();
    await page.getByRole('option', { name: 'Security alerts', exact: true }).click();
    await expect(dialog.locator('[data-related-message]')).toHaveCount(1);
    await expect(dialog.locator('[data-filter-chip="kind"]')).toContainText('Security alerts');
    await dialog.getByRole('textbox').fill('no-matching-message');
    await expect(dialog).toContainText('No matching messages');
    await dialog.locator('[data-filter-chip="query"]').click();
    await expect(dialog.locator('[data-related-message]')).toHaveCount(1);
    await dialog.getByRole('button', { name: 'View message', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-related-source]')).toContainText(
      'Message body: New login alert'
    );
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await page.getByRole('button', { name: 'Back to results', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'View message', exact: true })).toBeFocused();
    await dialog.getByRole('button', { name: 'View message', exact: true }).press('Enter');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-related-source]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();

    // A held hint must not move focus or survive key release / window blur.
    await page.keyboard.down('Shift');
    await page.keyboard.down('Slash');
    await expect(page.locator('[data-shortcut-discovery]')).toBeVisible();
    await expect(opener).toBeFocused();
    await page.screenshot({
      path: info.outputPath('shortcut-discovery.png'),
      animations: 'disabled',
    });
    await page.keyboard.up('Slash');
    await page.keyboard.up('Shift');
    await expect(page.locator('[data-shortcut-discovery]')).toHaveCount(0);
    await page.keyboard.press('?');
    await expect(
      page.getByRole('dialog', { name: 'Keyboard Shortcuts', exact: true })
    ).toBeVisible();
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard Shortcuts', exact: true })).toHaveCount(
      0
    );
    const search = page.locator('[data-app-search]').first();
    await search.focus();
    await page.keyboard.press('?');
    await expect(page.locator('[data-shortcut-discovery]')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Keyboard Shortcuts', exact: true })).toHaveCount(
      0
    );
  });
}

test('clipboard countdown displays scheduled clearing, unverified retries and queue removal', async ({
  extensionPage: page,
}, info) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.evaluate(async () => {
    // Model an actual unverifiable clear. The preview clipboard is readable by
    // default, so its empty value would correctly retire a made-up hash.
    Object.defineProperty(navigator.clipboard, 'readText', {
      configurable: true,
      value: async () => {
        throw new Error('Clipboard read unavailable in this fixture');
      },
    });
    await chrome.storage.local.set({
      clipboardPurgeQueue: [
        { hash: 'test-hash', copiedAt: Date.now(), purgeAt: Date.now() + 12000 },
      ],
    });
  });
  const banner = page.locator('[data-clipboard-countdown]');
  await expect(banner).toContainText('Automatic clipboard clear in');
  await expect(banner.getByRole('timer')).toHaveAttribute('aria-live', 'off');
  await page.screenshot({
    path: info.outputPath('clipboard-countdown.png'),
    animations: 'disabled',
  });
  await page.evaluate(() =>
    chrome.storage.local.set({
      clipboardPurgeQueue: [
        { hash: 'test-hash', copiedAt: Date.now(), purgeAt: Date.now() + 60000, attempts: 1 },
      ],
    })
  );
  await expect(banner).toContainText('awaiting verification');
  await page.evaluate(() => chrome.storage.local.remove('clipboardPurgeQueue'));
  await expect(banner).toHaveCount(0);
});

for (const appearance of [
  { theme: 'dark', language: 'en', label: 'Related messages' },
  { theme: 'light', language: 'ar', label: 'الرسائل المرتبطة' },
]) {
  test(`related messages ${appearance.theme}/${appearance.language}: popup fits without horizontal overflow`, async ({
    extensionPage: page,
    extensionId,
  }, info) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.evaluate(
      async ({ theme, language }) =>
        chrome.storage.local.set({
          themeMode: theme,
          locale: language,
          preferredLanguage: language,
          loginInfo: [
            {
              id: 'appearance-login',
              domain: 'shop.example',
              email: 'demo.user@example.com',
              password: '',
              timestamp: Date.now(),
            },
          ],
          'storedEmailsByAddress_demo-inbox-1': [
            {
              id: 'receipt',
              from: 'billing@shop.example',
              subject: 'Test receipt',
              received_at: Date.now(),
              body_plain: 'Receipt body',
            },
          ],
        }),
      appearance
    );
    await page.goto(extensionUrl(extensionId, 'popup.html?view=loginInfo'));
    await page.locator('[data-selectable-row="appearance-login"] [data-row-primary]').click();
    await page.getByRole('button', { name: appearance.label, exact: true }).click();
    const dialog = page.locator('[data-related-messages]');
    await expect(dialog.locator('[data-related-message]')).toHaveCount(1);
    const geometry = await dialog.evaluate((node) => ({
      width: node.clientWidth,
      scroll: node.scrollWidth,
      direction: getComputedStyle(node).direction,
    }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1);
    expect(geometry.direction).toBe(appearance.language === 'ar' ? 'rtl' : 'ltr');
    await page.screenshot({
      path: info.outputPath('related-messages-appearance.png'),
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
  });
}

test('saved-password copy respects Privacy duration and disabling, without exposing the value in its countdown', async ({
  extensionPage: page,
  extensionId,
}) => {
  await page.evaluate(async () =>
    chrome.storage.local.set({
      clipboardPrivacy: { autoPurgeEnabled: true, purgeAfterSeconds: 9 },
      loginInfo: [
        {
          id: 'clipboard-login',
          domain: 'shop.example',
          email: 'demo.user@example.com',
          password: 'test-clipboard-password!',
          timestamp: Date.now(),
        },
      ],
    })
  );
  await page.goto(extensionUrl(extensionId, 'popup.html?view=autofill'));
  // Exercise the real copy component and scheduler with an isolated clipboard.
  await page.evaluate(() => {
    let value = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (next: string) => {
          value = next;
        },
        readText: async () => value,
      },
    });
  });
  await page.getByRole('tab', { name: /^Saved Logins/ }).click();
  await page.locator('[data-selectable-row="clipboard-login"] [data-row-primary]').click();
  const copy = page.getByRole('button', { name: 'Copy password', exact: true });
  await copy.click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const queue =
          (await chrome.storage.local.get('clipboardPurgeQueue')).clipboardPurgeQueue ?? [];
        return queue.length;
      })
    )
    .toBe(1);
  const queue = await page.evaluate(
    async () => (await chrome.storage.local.get('clipboardPurgeQueue')).clipboardPurgeQueue
  );
  expect(queue[0].purgeAt - queue[0].copiedAt).toBe(9000);
  expect(JSON.stringify(queue)).not.toContain('test-clipboard-password!');
  await expect(page.locator('[data-clipboard-countdown]')).not.toContainText(
    'test-clipboard-password!'
  );
  await page.evaluate(() =>
    chrome.storage.local.set({
      clipboardPrivacy: { autoPurgeEnabled: false, purgeAfterSeconds: 9 },
    })
  );
  await copy.click();
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await chrome.storage.local.get('clipboardPurgeQueue')).clipboardPurgeQueue?.length ?? 0
      )
    )
    .toBe(0);
  await expect(page.locator('[data-clipboard-countdown]')).toHaveCount(0);
});
