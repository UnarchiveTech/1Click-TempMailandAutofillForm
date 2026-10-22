import ar from '../../src/locales/ar.json' with { type: 'json' };
import { expect, test } from './fixtures';
import { extensionUrl } from './preview-harness';

test('website context controls ignore extension pages and return for a real web tab', async ({
  extensionPage: page,
  context,
}) => {
  const siteAccess = page
    .locator('[data-strip-dock]')
    .getByRole('tab', { name: 'Site access', exact: true });
  await expect(siteAccess).toHaveCount(0);
  const website = await context.newPage();
  const url = 'https://api.guerrillamail.com/__e2e__/website-context';
  await website.route(url, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body>Website context fixture</body></html>',
    })
  );
  await website.goto(url);
  await website.bringToFront();
  await page.reload();
  await expect(siteAccess).toBeVisible();
  await website.close();
  await page.bringToFront();
  await page.reload();
  await expect(siteAccess).toHaveCount(0);
});

for (const shell of ['popup', 'sidepanel', 'app']) {
  test(`${shell}: compact dock, explicit verification browsing and stable selection`, async ({
    extensionPage: page,
    extensionId,
  }, info) => {
    await page.setViewportSize({
      width: shell === 'app' ? 1100 : 360,
      height: shell === 'app' ? 800 : 640,
    });
    await page.evaluate(async () => {
      const now = Date.now();
      await chrome.storage.local.set({
        locale: 'en',
        preferredLanguage: 'en',
        stripsEdgeCollapsed: false,
        'storedEmailsByAddress_demo-inbox-1': [0, 1, 2].map((offset) => ({
          id: `dock-${offset}`,
          from: 'security@github.com',
          from_name: 'GitHub',
          subject: 'Verification',
          received_at: now - (offset + 1) * 60_000,
          body_plain: 'Your verification code',
          otp: `12345${offset}`,
          isOtp: true,
          original_inbox: 'demo.user@example.com',
        })),
      });
    });
    await page.goto(extensionUrl(extensionId, `${shell}.html?view=mailbox`));
    const dock = page.locator('[data-strip-dock]');
    const strip = page.locator('#verification-strip');
    await expect(dock).toBeVisible();
    // One category has a heading, not a redundant tab selector.
    await expect(dock.getByRole('tablist')).toHaveCount(0);
    const code = strip.locator('#button-copy-current-otp');
    await expect(code).toHaveText('123450');
    await expect(code.locator('svg')).toHaveCount(1);
    const copyWidth = await code.evaluate((node) => node.getBoundingClientRect().width);
    await code.click();
    await expect(code).toHaveAttribute('aria-label', 'Copied!');
    expect(await code.evaluate((node) => node.getBoundingClientRect().width)).toBe(copyWidth);
    await expect(
      strip.getByRole('button', { name: 'Previous verification item', exact: true })
    ).toBeDisabled();
    await strip.getByRole('button', { name: 'Next verification item', exact: true }).click();
    const arrow = strip
      .getByRole('button', { name: 'Previous verification item', exact: true })
      .locator('svg');
    await expect(arrow).toBeVisible();
    expect(await arrow.evaluate((node) => node.getBoundingClientRect().width)).toBe(20);
    await expect(strip.locator('#button-copy-verification')).toHaveText('123451');
    await expect(strip.locator('[data-verification-status]')).toHaveAttribute(
      'data-verification-status',
      'earlier'
    );
    await expect(
      strip.getByRole('button', { name: 'Verification history', exact: true })
    ).toHaveText('2/3');
    // New arrivals change the count without replacing the selected item.
    await page.evaluate(async () => {
      const key = 'storedEmailsByAddress_demo-inbox-1';
      const stored = await chrome.storage.local.get(key);
      await chrome.storage.local.set({
        [key]: [
          { ...stored[key][0], id: 'dock-new', otp: '999999', received_at: Date.now() },
          ...stored[key],
        ],
      });
    });
    await expect(
      strip.getByRole('button', { name: 'Verification history', exact: true })
    ).toHaveText('3/4');
    await expect(strip.locator('#button-copy-verification')).toHaveText('123451');
    await strip.getByRole('button', { name: 'Verification history', exact: true }).click();
    await expect(strip.locator('[data-verification-history]')).toBeVisible();
    await strip
      .getByRole('button', { name: 'Show earlier and expired items', exact: true })
      .click();
    await strip
      .locator('[data-verification-history]')
      .getByRole('button', { name: '123452', exact: true })
      .click();
    await expect(strip.locator('[data-verification-history]')).toHaveCount(0);
    await expect(strip.locator('#button-copy-verification')).toHaveText('123452');
    await dock.getByRole('button', { name: 'Collapse strips', exact: true }).click();
    await expect(dock.locator('[data-strip-dock-content]')).not.toBeVisible();
    await expect(dock).toBeVisible();
    await dock.getByRole('button', { name: 'Expand strips', exact: true }).click();
    await expect(strip.locator('#button-copy-verification')).toHaveText('123452');

    // Search creates a second contextual category. Blur restores the dock.
    await page.locator('#inbox-search-input').fill('is:otp');
    await page.locator('#inbox-search-input').blur();
    const filters = dock.getByRole('tab', { name: 'Filters applied', exact: true });
    await expect(filters).toBeVisible();
    await filters.click();
    await expect(dock.locator('[role="tabpanel"]:visible')).toHaveCount(1);
    await expect(strip).toHaveCount(0);
    await filters.press('Home');
    await expect(strip).toBeVisible();
    await expect(strip.locator('#button-copy-verification')).toHaveText('123452');
    await page.screenshot({ path: info.outputPath('strip-dock.png'), animations: 'disabled' });
    const height = await dock.evaluate((node) => node.getBoundingClientRect().height);
    await dock.hover();
    expect(await dock.evaluate((node) => node.getBoundingClientRect().height)).toBe(height);
    expect(await dock.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await dock.getByRole('button', { name: 'Collapse strips', exact: true }).click();
    await expect(filters).toBeVisible();
    await filters.click();
    await expect(dock.locator('[data-strip-dock-content]')).toBeVisible();
    await expect(filters).toHaveAttribute('aria-selected', 'true');
    await page.screenshot({
      path: info.outputPath('strip-dock-filters.png'),
      animations: 'disabled',
    });
    await dock.getByRole('button', { name: 'Collapse strips', exact: true }).click();
    await page.evaluate(async () => {
      const key = 'storedEmailsByAddress_demo-inbox-1';
      const stored = await chrome.storage.local.get(key);
      await chrome.storage.local.set({
        [key]: [
          { ...stored[key][0], id: 'dock-collapsed', otp: '777777', received_at: Date.now() },
          ...stored[key],
        ],
      });
    });
    await expect(filters).toHaveAttribute('aria-selected', 'true');
    await expect(dock.locator('[data-strip-dock-content]')).not.toBeVisible();
    await page.reload();
    await expect(dock).toBeVisible();
    await expect(dock.locator('[data-strip-dock-content]')).not.toBeVisible();
  });
}

test('dark RTL verification browsing includes marked expired items and magic links', async ({
  extensionPage: page,
}, info) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.evaluate(async () => {
    const now = Date.now();
    await chrome.storage.local.set({
      locale: 'ar',
      preferredLanguage: 'ar',
      language: 'ar',
      themeMode: 'dark',
      stripsEdgeCollapsed: false,
      'storedEmailsByAddress_demo-inbox-1': [
        {
          id: 'expired',
          from: 'security@github.com',
          otp: '100000',
          received_at: now - 60 * 60_000,
        },
        {
          id: 'magic',
          from: 'login@example.org',
          received_at: now - 60_000,
          magicLinks: [
            { url: 'https://example.org/verify?token=test', host: 'example.org', score: 1 },
          ],
        },
      ],
    });
  });
  await page.reload();
  const strip = page.locator('#verification-strip');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(
    strip.getByRole('button', { name: ar.inbox.openMagicLink, exact: true })
  ).toBeVisible();
  await strip.getByRole('button', { name: ar.stripDock.next, exact: true }).click();
  await expect(strip.locator('#button-copy-verification')).toHaveText('100000');
  await expect(strip.locator('[data-verification-status]')).toHaveAttribute(
    'data-verification-status',
    'expired'
  );
  await page.screenshot({ path: info.outputPath('strip-dock-rtl.png'), animations: 'disabled' });
});
