import { expect, test } from './fixtures';
import { extensionUrl } from './preview-harness';

for (const shell of ['popup', 'sidepanel', 'app']) {
  test(`${shell}: Addresses filters, display sorting, stats and remembered-site navigation`, async ({
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
          { ...addresses[0], tags: [{ name: 'Work', color: '#6750a4' }], expiresAt: now + 3600000 },
          {
            ...addresses[0],
            id: 'second',
            address: 'second@example.com',
            tags: [],
            expiresAt: now + 600000,
          },
        ],
        emailStorageAddressIndex: {
          'demo-inbox-1': 'demo.user@example.com',
          second: 'second@example.com',
        },
        storedEmailsByAddress_second: [],
        siteProfiles: {
          'shop.example': {
            domain: 'shop.example',
            lastEmail: 'demo.user@example.com',
            lastAddressId: 'demo-inbox-1',
            updatedAt: now,
            successCount: 1,
            failureCount: 0,
            fieldKindsSeen: [],
          },
        },
      });
    });
    await page.goto(extensionUrl(extensionId, `${shell}.html?view=addresses`));
    const rows = page.locator('[data-address][data-selectable-row]');
    await expect(rows).toHaveCount(2);
    await page.getByRole('combobox', { name: 'Sort addresses', exact: true }).click();
    await page.getByRole('option', { name: 'Expiring soon', exact: true }).click();
    await expect(rows.first()).toHaveAttribute('data-address', 'second@example.com');
    await expect(rows.first()).toHaveAttribute('draggable', 'false');
    await page.getByRole('combobox', { name: 'Sort addresses', exact: true }).click();
    await page.getByRole('option', { name: 'Custom order', exact: true }).click();
    await expect(rows.first()).toHaveAttribute('data-address', 'demo.user@example.com');
    await page.locator('#button-addresses-filter').click();
    await page.getByRole('menuitemcheckbox', { name: 'Has tags', exact: true }).click();
    await page.locator('button.fixed.inset-0').click({ position: { x: 4, y: 4 } });
    await expect(rows).toHaveCount(1);
    await expect(page.locator('[data-filter-chip="tags"]')).toBeVisible();
    await page.screenshot({
      path: info.outputPath('addresses-filters.png'),
      animations: 'disabled',
    });
    await page.locator('[data-filter-chip="tags"]').click();
    await expect(rows).toHaveCount(2);
    await rows.first().getByRole('button').filter({ hasText: 'demo.user@example.com' }).click();
    const lifecycle = page.locator('[data-address-stats="lifecycle"]');
    await expect(lifecycle).toBeVisible();
    await expect(lifecycle).not.toHaveAttribute('open', '');
    await lifecycle.locator('summary').press('Enter');
    await expect(lifecycle).toHaveAttribute('open', '');
    await page.getByRole('button', { name: /Used on .* site/ }).click();
    await page.getByTitle('Open site details for shop.example', { exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Sites', exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    const site = page.locator('[data-sites-view]');
    await expect(site.getByRole('textbox', { name: 'Search saved sites' })).toHaveValue(
      'shop.example'
    );
    await expect(site.getByRole('button', { name: /shop\.example/ }).first()).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    await page.screenshot({ path: info.outputPath('remembered-site.png'), animations: 'disabled' });
  });

  test(`${shell}: Organize search, usage drilldowns and separate saved-search actions`, async ({
    extensionPage: page,
    extensionId,
  }, info) => {
    await page.setViewportSize({
      width: shell === 'app' ? 1440 : 360,
      height: shell === 'app' ? 900 : 640,
    });
    await page.evaluate(async () => {
      const { addresses } = await chrome.storage.local.get('addresses');
      await chrome.storage.local.set({
        addresses: [{ ...addresses[0], tags: [{ name: 'Work', color: '#6750a4' }] }],
        emailLabels: { 'demo.user@example.com_demo-seed-1': ['Receipts'] },
        emailLabelCatalog: [{ name: 'Receipts', color: '#6750a4' }],
        savedSearchFilters: [
          {
            id: 'work-filter',
            name: 'Work messages',
            searchQuery: 'verification',
            hasOTP: false,
            senderDomain: '',
            dateFrom: '',
            dateTo: '',
            sortBy: 'newest',
            createdAt: Date.now(),
          },
        ],
      });
    });
    await page.goto(extensionUrl(extensionId, `${shell}.html?view=organize`));
    const search = page.getByRole('textbox', {
      name: 'Search tags or linked addresses…',
      exact: true,
    });
    await search.fill('demo.user@example.com');
    await search.press('Tab');
    const usage = page.getByRole('button', { name: 'Show addresses tagged Work', exact: true });
    await expect(usage).toBeVisible();
    await page.screenshot({ path: info.outputPath('organize-tags.png'), animations: 'disabled' });
    await usage.click();
    await expect(page.locator('[data-organize-usage="tag"]')).toContainText(
      'demo.user@example.com'
    );
    await page.getByRole('dialog').press('Escape');
    await expect(page.locator('[data-organize-usage]')).toHaveCount(0);
    await page.getByRole('tab', { name: /^Labels/ }).click();
    await page.getByRole('textbox', { name: 'Search labels…', exact: true }).fill('missing');
    await expect(page.getByText('No results match your search', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Clear search', exact: true }).last().click();
    await page.getByRole('button', { name: 'Show messages labeled Receipts', exact: true }).click();
    await expect(page.locator('[data-organize-usage="label"]')).toContainText(
      'Your verification code'
    );
    await page.screenshot({ path: info.outputPath('label-usage.png'), animations: 'disabled' });
    await page
      .locator('[data-organize-usage="label"]')
      .getByRole('button', { name: /Your verification code/ })
      .click();
    await expect(page.locator('[data-organize-usage]')).toHaveCount(0);
    await expect(page.getByText('Your verification code', { exact: true }).first()).toBeVisible();
    await page.goto(extensionUrl(extensionId, `${shell}.html?view=organize`));
    await page.getByRole('tab', { name: /^Saved Searches/ }).click();
    await page
      .getByRole('textbox', { name: 'Search saved searches or criteria…', exact: true })
      .fill('verification');
    await page
      .getByRole('textbox', { name: 'Search saved searches or criteria…', exact: true })
      .press('Tab');
    await page.getByRole('button', { name: 'Edit filter Work messages', exact: true }).click();
    await expect(page.locator('#edit-filter-q')).toHaveValue('verification');
    await page.getByRole('dialog').press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Apply saved search Work messages', exact: true })
      .click();
    await expect(page.getByRole('textbox', { name: /Search emails/i }).first()).toHaveValue(
      'verification'
    );
  });
}
