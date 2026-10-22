import { expect, test } from './fixtures';
import { extensionUrl } from './preview-harness';

test('mailbox folders stay in the visible sidebar while searching and return when it collapses', async ({
  extensionPage: page,
  extensionId,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(extensionUrl(extensionId, 'app.html?view=mailbox'));
  await expect(page.locator('[data-sidebar-submenu="mailbox"]')).toBeVisible();
  await expect(page.locator('[data-tour="email-list-tabs"]')).toHaveCount(0);
  await page.locator('#inbox-search-input').fill('GitHub');
  await expect(page.locator('[data-tour="email-list-tabs"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await expect(page.locator('[data-tour="email-list-tabs"]')).toBeVisible();
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
  await expect(page.locator('[data-tour="email-list-tabs"]')).toHaveCount(0);
  await page.locator('[data-sidebar-nav-item="mailbox"] [data-sidebar-disclosure]').click();
  await expect(page.locator('[data-tour="email-list-tabs"]')).toBeVisible();
});

test('refresh failure is the first dock category and disappears after recovery', async ({
  extensionPage: page,
}, info) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.evaluate(async () => {
    const { addresses } = await chrome.storage.local.get('addresses');
    await chrome.storage.local.set({
      stripsEdgeCollapsed: false,
      addresses: addresses.map((address: Record<string, unknown>) => ({
        ...address,
        mailboxRefreshFailure: {
          kind: 'provider',
          failedAt: Date.now(),
          errorKey: 'errors.networkErrorGeneric',
        },
      })),
    });
  });
  const dock = page.locator('[data-strip-dock]');
  await expect(dock.getByRole('tab').first()).toHaveAttribute('id', 'strip-tab-health');
  await dock.locator('#strip-tab-health').click();
  await expect(dock.getByRole('status')).toBeVisible();
  await page.screenshot({
    path: info.outputPath('mailbox-health-strip.png'),
    animations: 'disabled',
  });
  await expect(
    page.locator('[role="status"]').filter({ hasText: 'Mailbox refresh failed' })
  ).toHaveCount(0);
  await page.evaluate(async () => {
    const { addresses } = await chrome.storage.local.get('addresses');
    for (const address of addresses) delete address.mailboxRefreshFailure;
    await chrome.storage.local.set({ addresses });
  });
  await expect(dock.locator('#strip-tab-health')).toHaveCount(0);
});

test('Saved login details use a dismissible dialog and full-page expansion preserves the selected tab', async ({
  extensionPage: page,
  extensionId,
  context,
}, info) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.evaluate(async () =>
    chrome.storage.local.set({
      loginInfo: [
        {
          id: 'details-login',
          domain: 'example.com',
          email: 'demo.user@example.com',
          username: 'demouser',
          name: 'Demo User',
          password: '',
          filledFields: ['email', 'name'],
          timestamp: Date.now(),
        },
      ],
    })
  );
  await page.goto(extensionUrl(extensionId, 'popup.html?view=autofill'));
  await page.getByRole('tab', { name: /^Saved Logins/ }).click();
  await page.locator('[data-login-row="details-login"] [data-row-primary]').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Demo User');
  await page.screenshot({
    path: info.outputPath('saved-login-dialog.png'),
    animations: 'disabled',
  });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  const opened = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Open full page', exact: true }).click();
  const fullPage = await opened;
  await fullPage.setViewportSize({ width: 1440, height: 900 });
  await expect(fullPage.locator('[data-login-row="details-login"]')).toBeVisible();
  const submenu = fullPage.locator('[data-sidebar-submenu="autofill"]');
  await expect(submenu).toBeVisible();
  await expect(fullPage.getByRole('tab', { name: /^Saved Logins/ })).toHaveCount(0);
  await submenu.getByRole('button', { name: /^Identities/ }).click();
  await expect(fullPage.locator('[data-login-row="details-login"]')).toHaveCount(0);
  await submenu.getByRole('button', { name: /^Saved Logins/ }).click();
  await expect(fullPage.locator('[data-login-row="details-login"]')).toBeVisible();
  await fullPage.screenshot({
    path: info.outputPath('sidebar-saved-logins.png'),
    animations: 'disabled',
  });
  await fullPage.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await expect(fullPage.getByRole('tab', { name: /^Saved Logins/ })).toBeVisible();
  await fullPage.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
  await expect(fullPage.getByRole('tab', { name: /^Saved Logins/ })).toHaveCount(0);
});
