import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Locator, Page } from 'playwright';
import { expect, test } from './fixtures';

async function configure(page: Page, prefs: Record<string, unknown>) {
  await page.evaluate(async (settings) => {
    await chrome.storage.local.set(settings);
  }, prefs);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 });
}

async function assertCorner(indicator: Locator, label?: Locator) {
  await expect(indicator).toBeVisible();
  // The documented anchor is the indicator's bottom-left at the SVG centre;
  // its entire box must stay inside the upper-right quarter, including RTL.
  await expect
    .poll(async () =>
      indicator.evaluate((badge) => {
        const icon = badge.parentElement?.querySelector('svg');
        if (!icon) return false;
        const b = badge.getBoundingClientRect();
        const i = icon.getBoundingClientRect();
        return (
          Math.abs(b.left - (i.left + i.right) / 2) < 0.6 &&
          Math.abs(b.bottom - (i.top + i.bottom) / 2) < 0.6 &&
          b.right <= i.right + 0.6 &&
          b.top >= i.top - 0.6 &&
          b.width > 0 &&
          b.height > 0 &&
          i.width > 0
        );
      })
    )
    .toBe(true);
  if (label) {
    const countFont = await indicator.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const labelFont = await label.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(countFont).toBeGreaterThan(0);
    expect(countFont).toBeLessThanOrEqual(labelFont * 0.8);
    const countHeight = await indicator.evaluate((el) => parseFloat(getComputedStyle(el).height));
    expect(countHeight).toBeLessThan(labelFont);
  }
}

for (const lang of ['en', 'ar', 'th']) {
  test(`icon indicators stay in the upper-right quarter and counts fit below label size: ${lang}`, async ({
    extensionPage: page,
    sidepanelPage: wide,
  }) => {
    test.setTimeout(90_000);
    const output = path.resolve('audit/nav-indicators');
    await mkdir(output, { recursive: true });
    for (const mode of ['dot', 'count']) {
      console.log(`Checking ${lang} ${mode}: primary navbar`);
      await configure(page, {
        language: lang,
        locale: lang,
        preferredLanguage: lang,
        navIndicatorModes: { mailbox: mode },
        customNavOrder: [
          'mailbox',
          'addresses',
          'autofill',
          'organize',
          'automation',
          'activity',
          'settings',
          'about',
        ],
        minPrimaryItems: 1,
        'storedEmailsByAddress_demo-inbox-1': Array.from({ length: 100 }, (_, index) => ({
          id: `nav-indicator-${index}`,
          from: 'sender@example.com',
          subject: 'Unread message',
          received_at: Date.now(),
          unread: true,
          original_inbox: 'demo.user@example.com',
        })),
        emailStorageMetadata: {
          'demo-inbox-1': { messageCount: 100, unreadCount: 100, revision: 2 },
        },
      });
      const item = page
        .locator('.floating-nav .nav-item')
        .filter({ has: page.locator('.nav-icon-dot, .nav-badge') })
        .first();
      await assertCorner(
        item.locator('.nav-icon-dot, .nav-badge'),
        mode === 'count' ? item.locator('.nav-label') : undefined
      );
      if (mode === 'count') await expect(item.locator('.nav-badge')).toHaveText('99+');
      await page
        .locator('.floating-nav')
        .screenshot({ path: path.join(output, `popup-${lang}-${mode}.png`) });

      await configure(page, {
        customNavOrder: [
          'addresses',
          'mailbox',
          'autofill',
          'organize',
          'automation',
          'activity',
          'settings',
          'about',
        ],
      });
      const more = page.locator('.floating-nav .nav-item').filter({ hasText: /./ }).last();
      console.log(`Checking ${lang} ${mode}: More indicator`);
      await assertCorner(more.locator('.nav-icon-dot'));
      await more.press('Enter');
      const menuItem = page
        .locator('.more-menu-item')
        .filter({ has: page.locator('.nav-icon-dot, .nav-badge') });
      await assertCorner(
        menuItem.locator('.nav-icon-dot, .nav-badge'),
        mode === 'count' ? menuItem.locator('.nav-label') : undefined
      );
      console.log(`Capturing ${lang} ${mode}: More menu`);
      const menuBox = await page.locator('.more-menu-nav').boundingBox();
      if (!menuBox) throw new Error('More menu has no visible box');
      await page.screenshot({ path: path.join(output, `more-${lang}-${mode}.png`), clip: menuBox });
    }

    // The fitted popup can use a smaller label than the roomy one-item layout.
    await configure(page, {
      minPrimaryItems: 'auto',
      customNavOrder: [
        'mailbox',
        'addresses',
        'autofill',
        'organize',
        'automation',
        'activity',
        'settings',
        'about',
      ],
    });
    const fitted = page.locator('.floating-nav .nav-item.has-badge');
    await assertCorner(fitted.locator('.nav-badge'), fitted.locator('.nav-label'));
    await page
      .locator('.floating-nav')
      .screenshot({ path: path.join(output, `popup-${lang}-fitted-count.png`) });

    await wide.setViewportSize({ width: 1000, height: 800 });
    for (const collapsed of [false, true]) {
      console.log(`Checking ${lang}: ${collapsed ? 'rail' : 'expanded'} sidebar`);
      await configure(wide, { sidebarCollapsed: collapsed, uiDensity: 'expanded' });
      const sidebar = wide.locator('.sidebar-nav');
      const badge = sidebar.locator('.nav-badge');
      await assertCorner(badge);
      const badgeFont = await badge.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      const labelFont = await badge.evaluate((el) => {
        const button = el.closest('button');
        if (!button) throw new Error('Indicator has no navigation button');
        return parseFloat(getComputedStyle(button).fontSize);
      });
      expect(badgeFont).toBeLessThan(labelFont);
      await sidebar.screenshot({
        path: path.join(output, `sidebar-${lang}-${collapsed ? 'rail' : 'expanded'}.png`),
      });
    }
  });
}
