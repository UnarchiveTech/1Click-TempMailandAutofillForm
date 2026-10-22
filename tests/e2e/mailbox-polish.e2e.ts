import { expect, test } from './fixtures';
import { extensionUrl } from './preview-harness';

test('message links show favicon or avatar, with social destinations grouped', async ({
  extensionPage: page,
}, info) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.evaluate(async () => {
    const key = 'storedEmailsByAddress_demo-inbox-1';
    const stored = await chrome.storage.local.get(key);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.fillStyle = '#6750a4';
    ctx.fillRect(0, 0, 32, 32);
    await chrome.storage.local.set({
      [key]: [
        {
          ...stored[key][0],
          body_plain: '',
          body_html:
            '<a href="https://shop.example/receipt">Receipt</a><a href="https://www.instagram.com/shop">Instagram</a><a href="https://x.com/shop">Updates</a>',
        },
      ],
      favicon_success_cache: {
        'instagram.com': { timestamp: Date.now(), url: canvas.toDataURL() },
      },
      favicon_error_cache: {
        'shop.example': { timestamp: Date.now() },
        'x.com': { timestamp: Date.now() },
      },
    });
  });
  await page.reload();
  await page.locator('[data-selectable-row]').first().click();
  await page.getByRole('button', { name: 'Links in this email (3)', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Website links (1)' })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Social media (2)' })).toBeVisible();
  await expect(dialog.locator('[data-email-link]')).toHaveCount(3);
  const image = dialog.locator('[data-email-link]').filter({ hasText: 'Instagram' }).locator('img');
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
    .toBe(32);
  expect(await image.evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
  const fallback = dialog
    .locator('[data-email-link]')
    .filter({ hasText: 'Receipt' })
    .locator('[aria-hidden="true"]');
  await expect(fallback.first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('message-links.png'), animations: 'disabled' });
});

test('autofill split control selects identities and opens the existing creation form', async ({
  extensionPage: page,
  demoSignupPage,
}, info) => {
  // This UI is an HTML tab while the form's tab stays active. Unlike a real
  // action popup, its entrance animation can be paused by the browser. Test
  // this chooser/layout journey with reduced motion; retain real clicks.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 360, height: 640 });
  await page.evaluate(async () => {
    await chrome.storage.local.set({
      identities: [
        { id: 'one', name: 'Personal', firstName: 'Alex', lastName: 'River' },
        { id: 'two', name: 'Work', firstName: 'Sam', lastName: 'Lake' },
      ],
      selectedIdentityId: 'one',
      stripsEdgeCollapsed: false,
    });
  });
  await page.reload();
  await demoSignupPage.page.bringToFront();
  const tab = page.locator('[data-strip-dock]').getByRole('tab', { name: 'Autofill', exact: true });
  await expect(tab).toBeVisible({ timeout: 20000 });
  await tab.click();
  await expect(page.locator('#button-autofill')).toHaveText('Autofill (Personal)');
  await page.locator('#button-identity-selector').click();
  await page.getByRole('option', { name: 'Work', exact: true }).click();
  await expect(page.locator('#button-autofill')).toHaveText('Autofill (Work)');
  expect(
    await page
      .locator('#button-autofill > span')
      .evaluate((node) => node.scrollWidth <= node.clientWidth)
  ).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await chrome.storage.local.get('selectedIdentityId')).selectedIdentityId
      )
    )
    .toBe('two');
  await page.locator('#button-identity-selector').click();
  await page.screenshot({ path: info.outputPath('autofill-split.png'), animations: 'disabled' });
  await page.getByRole('option', { name: 'Create new identity', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('archived renewable mailbox exposes its toggle and address details retain every tag', async ({
  extensionPage: page,
  extensionId,
}, info) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.evaluate(async () => {
    const { addresses } = await chrome.storage.local.get('addresses');
    await chrome.storage.local.set({
      addresses: [
        {
          ...addresses[0],
          provider: 'guerrilla',
          accountStatus: 'archived',
          status: 'archived',
          archiveReason: 'manual',
          autoExtend: false,
          expiresAt: Date.now() + 3600000,
          tags: [
            { name: 'Work', color: '#6750a4' },
            { name: 'Shopping', color: '#386a20' },
          ],
        },
      ],
    });
  });
  await page.goto(extensionUrl(extensionId, 'popup.html?view=mailbox'));
  const renewal = page.getByRole('group', { name: 'Auto-renew', exact: true });
  await expect(renewal).toBeVisible();
  await renewal.getByRole('button', { name: 'On', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto(extensionUrl(extensionId, 'popup.html?view=addresses'));
  await page.getByRole('tab', { name: /^Inactive/ }).click();
  await page
    .locator('[data-address][data-selectable-row]')
    .first()
    .getByRole('button')
    .filter({ hasText: 'demo.user@example.com' })
    .click();
  await expect(page.locator('[data-address-stats="lifecycle"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit tag Shopping', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('address-details.png'), animations: 'disabled' });
});
