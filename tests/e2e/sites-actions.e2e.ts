import { expect, test } from './fixtures';
import { extensionUrl } from './preview-harness';

for (const shell of ['popup', 'sidepanel', 'app']) {
  test(`${shell}: Sites shares search and opens the correct linked inbox`, async ({
    extensionPage: page,
    extensionId,
  }, info) => {
    await page.setViewportSize({
      width: shell === 'app' ? 1440 : 360,
      height: shell === 'app' ? 900 : 640,
    });
    await page.evaluate(async () => {
      const { addresses } = await chrome.storage.local.get('addresses');
      const now = Date.now();
      await chrome.storage.local.set({
        addresses: [
          ...addresses,
          { ...addresses[0], id: 'site-inbox', address: 'receipts@example.com' },
        ],
        emailStorageAddressIndex: {
          'demo-inbox-1': 'demo.user@example.com',
          'site-inbox': 'receipts@example.com',
        },
        'storedEmailsByAddress_site-inbox': [
          {
            id: 'site-message',
            from: 'billing@shop.example',
            subject: 'Correct site inbox',
            received_at: now,
            body_plain: 'Receipt for this inbox',
          },
        ],
        loginInfo: [
          {
            id: 'site-login',
            domain: 'shop.example',
            email: 'receipts@example.com',
            password: '',
            timestamp: now,
          },
        ],
      });
    });
    await page.goto(extensionUrl(extensionId, `${shell}.html?view=autofill`));
    await page.getByRole('tab', { name: 'Sites', exact: true }).click();
    const sites = page.locator('[data-sites-view]');
    const search = sites.getByRole('textbox', { name: 'Search saved sites', exact: true });
    await expect(search).toHaveAttribute('data-app-search', '');
    await search.fill('nonexistent-site');
    await expect(sites).toContainText('No sites match your search');
    await sites.getByRole('button', { name: 'Clear search', exact: true }).last().click();
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    await search.fill('shop.example');
    await search.press('Escape');
    await sites
      .getByRole('button', { name: /shop\.example/ })
      .first()
      .click();
    const address = sites.locator('[data-site-address="receipts@example.com"]');
    await expect(address.getByRole('button', { name: 'Open inbox', exact: true })).toBeVisible();
    await page.evaluate(() => {
      let copied = '';
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            copied = value;
          },
          readText: async () => copied,
        },
      });
    });
    await address.getByRole('button', { name: 'Copy email', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('receipts@example.com');
    await page.screenshot({ path: info.outputPath('sites-actions.png'), animations: 'disabled' });
    await sites.getByRole('button', { name: 'Open saved logins', exact: true }).click();
    await expect(page.getByRole('tab', { name: /^Saved Logins/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(page.locator('[data-selectable-row="site-login"]')).toBeVisible();
    await page.getByRole('tab', { name: 'Sites', exact: true }).click();
    await sites
      .getByRole('button', { name: /shop\.example/ })
      .first()
      .click();
    await sites
      .locator('[data-site-address="receipts@example.com"]')
      .getByRole('button', { name: 'Open inbox', exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await chrome.storage.local.get('activeAddressId')).activeAddressId
        )
      )
      .toBe('site-inbox');
    await expect(page.getByText('Correct site inbox', { exact: true }).first()).toBeVisible();
  });
}
