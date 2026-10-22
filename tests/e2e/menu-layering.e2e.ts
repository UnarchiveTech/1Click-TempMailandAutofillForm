import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { extensionUrl } from './preview-harness';

/** Check actual hit testing as well as geometry: z-index alone proves neither. */
async function usable(page: Page, menu: Locator) {
  await expect(menu).toBeVisible();
  await expect
    .poll(() =>
      menu.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const bounds =
          rect.left >= 7 &&
          rect.top >= 7 &&
          rect.right <= innerWidth - 7 &&
          rect.bottom <= innerHeight - 7;
        const points = [
          [rect.left + rect.width / 2, rect.top + 6],
          [rect.left + rect.width / 2, rect.bottom - 6],
        ];
        const hit = points.every(([x, y]) => {
          const target = document.elementFromPoint(x, y);
          return !!target && node.contains(target);
        });
        return { bounds, hit, portaled: node.parentElement === document.body };
      })
    )
    .toEqual({ bounds: true, hit: true, portaled: true });
  // Also sample the exact overlap with the real floating navbar when present.
  expect(
    await menu.evaluate((node) => {
      const nav = document.querySelector('[data-tour="footer-nav"]');
      if (!nav) return true;
      const a = node.getBoundingClientRect();
      const b = nav.getBoundingClientRect();
      const left = Math.max(a.left, b.left);
      const right = Math.min(a.right, b.right);
      const top = Math.max(a.top, b.top);
      const bottom = Math.min(a.bottom, b.bottom);
      if (left >= right || top >= bottom) return true;
      const target = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
      return !!target && node.contains(target);
    })
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const shell of ['popup', 'sidepanel', 'app']) {
  const viewport = { width: shell === 'app' ? 1000 : 360, height: 600 };
  test(`${shell}: mailbox menus and nested filters stay above navigation`, async ({
    extensionPage: page,
    extensionId,
  }, info) => {
    await page.setViewportSize(viewport);
    await page.evaluate(async () =>
      chrome.storage.local.set({
        savedSearchFilters: [
          {
            id: 'test-filter',
            name: 'Verification',
            searchQuery: 'is:otp',
            hasOTP: true,
            senderDomain: '',
            dateFrom: '',
            dateTo: '',
            createdAt: Date.now(),
          },
        ],
      })
    );
    await page.goto(extensionUrl(extensionId, `${shell}.html?view=mailbox`));
    await page.locator('#button-filter').click();
    const root = page.locator('body > [data-anchored-flyout]').last();
    await usable(page, root);
    for (const name of ['From', 'Sort', 'Date range', 'Saved Filters']) {
      const parent = page.getByRole('menu', { name: 'Filters', exact: true });
      const item = parent.getByRole('menuitem', { name, exact: true });
      if (shell === 'app') await item.hover();
      else await item.click();
      const child = page.locator('body > [data-anchored-flyout]').last();
      await usable(page, child);
      await child.getByRole('button', { name: 'Back', exact: true }).click();
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: 'Filters', exact: true })).toHaveCount(0);
    await page.locator('#button-tab-view').click();
    const view = page.locator('body > [data-anchored-flyout]').last();
    await usable(page, view);
    await page.screenshot({
      path: info.outputPath('mailbox-view-menu.png'),
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
    await page.locator('#button-account-notifications').click({ button: 'right' });
    const snooze = page.locator('body > [data-anchored-flyout]').last();
    await usable(page, snooze);
    await page.keyboard.press('Escape');
    await expect(page.locator('body > [data-anchored-flyout]')).toHaveCount(0);
    await page.locator('#inbox-search-input').focus();
    await page.locator('#button-filter-presets').click();
    await usable(page, page.locator('body > [data-anchored-flyout]').last());
    await page.keyboard.press('Escape');
    await expect(page.locator('body > [data-anchored-flyout]')).toHaveCount(0);
  });

  test(`${shell}: address row, saved-login, activity and contrast menus are reachable`, async ({
    extensionPage: page,
    extensionId,
  }, info) => {
    await page.setViewportSize(viewport);
    await page.evaluate(async () => {
      const { addresses } = await chrome.storage.local.get('addresses');
      await chrome.storage.local.set({
        addresses: Array.from({ length: 12 }, (_, i) => ({
          ...addresses[0],
          id: i ? `inbox-${i}` : addresses[0].id,
          address: i ? `user${i}@example.com` : addresses[0].address,
        })),
        loginInfo: [
          {
            id: 'test-login',
            domain: 'shop.example',
            email: addresses[0].address,
            password: '',
            timestamp: Date.now(),
          },
        ],
      });
    });
    await page.goto(extensionUrl(extensionId, `${shell}.html?view=addresses`));
    const row = page.locator('[data-address="user11@example.com"]');
    await row.scrollIntoViewIfNeeded();
    await row.getByRole('button', { name: 'More actions', exact: true }).click();
    await usable(page, page.locator('body > [data-anchored-flyout]').last());
    await page.screenshot({
      path: info.outputPath('bottom-address-menu.png'),
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
    await page.goto(extensionUrl(extensionId, `${shell}.html?view=loginInfo`));
    await page.locator('#button-savedlogin-filter').click();
    await usable(page, page.locator('body > [data-anchored-flyout]').last());
    await page.keyboard.press('Escape');
    await page.goto(extensionUrl(extensionId, `${shell}.html?view=analytics`));
    const activity = page.getByRole('combobox', { name: 'Filter by action type', exact: true });
    await activity.scrollIntoViewIfNeeded();
    await activity.click();
    await usable(page, page.getByRole('listbox', { name: 'Filter by action type', exact: true }));
    await page.screenshot({ path: info.outputPath('activity-menu.png'), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await page.getByRole('group', { name: 'Theme mode', exact: true }).click({ button: 'right' });
    await usable(page, page.getByRole('menu', { name: 'Contrast', exact: true }));
    await page.getByRole('menuitemradio', { name: 'Medium', exact: true }).click();
    await expect(page.getByRole('menu', { name: 'Contrast', exact: true })).toHaveCount(0);
  });

  test(`${shell}: slash suggestions and More menu escape page clipping`, async ({
    extensionPage: page,
    extensionId,
  }, info) => {
    await page.setViewportSize(viewport);
    await page.goto(extensionUrl(extensionId, `${shell}.html?view=addresses`));
    const input = page.getByRole('textbox', { name: 'Search addresses', exact: true });
    await input.fill('/');
    const suggestions = page.locator('body > [data-anchored-flyout]').last();
    await usable(page, suggestions);
    await page.screenshot({
      path: info.outputPath('search-shortcuts.png'),
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
    if (shell !== 'app') {
      await expect(input).toBeFocused();
      await expect(page.locator('body > [data-anchored-flyout]')).toHaveCount(0);
      await input.fill('/tag');
      await usable(page, page.locator('body > [data-anchored-flyout]').last());
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'More', exact: true }).hover();
      const more = page.getByRole('menu', { name: 'More destinations', exact: true });
      await usable(page, more);
      // A body portal must retain the navbar's tokens without inheriting them
      // from its former footer parent (geometry/hit testing cannot prove this).
      expect(
        await more.evaluate((node) => {
          const style = getComputedStyle(node);
          const item = node.querySelector('button');
          const itemStyle = item && getComputedStyle(item);
          return {
            rounded: Number.parseFloat(style.borderTopLeftRadius) > 0,
            padded: !!itemStyle && Number.parseFloat(itemStyle.paddingLeft) > 0,
            iconGap:
              !!itemStyle && Number.parseFloat(itemStyle.getPropertyValue('--nav-icon-gap')) > 0,
          };
        })
      ).toEqual({ rounded: true, padded: true, iconGap: true });
      await page.screenshot({ path: info.outputPath('more-menu.png'), animations: 'disabled' });
      await page.keyboard.press('Escape');
      await expect(more).toHaveCount(0);
    }
  });

  test(`${shell}: dark RTL menus stay reachable after resize`, async ({
    extensionPage: page,
    extensionId,
  }, info) => {
    await page.setViewportSize(viewport);
    await page.evaluate(async () => {
      await chrome.storage.local.set({
        language: 'ar',
        locale: 'ar',
        preferredLanguage: 'ar',
        themeMode: 'dark',
        contrastLevel: 'standard',
      });
    });
    await page.goto(extensionUrl(extensionId, `${shell}.html?view=mailbox`));
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark-standard');
    await page.locator('#button-filter').click();
    const root = page.locator('body > [data-anchored-flyout]').last();
    await usable(page, root);
    const from = root.getByRole('menuitem').first();
    if (shell === 'app') await from.hover();
    else await from.click();
    const child = page.locator('body > [data-anchored-flyout]').last();
    await usable(page, child);
    await page.screenshot({ path: info.outputPath('rtl-submenu.png'), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await expect(page.locator('body > [data-anchored-flyout]')).toHaveCount(1);
    await page.setViewportSize({ width: viewport.width + 20, height: viewport.height + 100 });
    await usable(page, page.locator('body > [data-anchored-flyout]'));
    await page.keyboard.press('Escape');
    if (shell !== 'app') {
      await page.locator('.floating-nav button[aria-expanded]').hover();
      const more = page.locator('.more-menu-nav');
      await usable(page, more);
      await page.screenshot({ path: info.outputPath('rtl-more-menu.png'), animations: 'disabled' });
    }
  });
}
