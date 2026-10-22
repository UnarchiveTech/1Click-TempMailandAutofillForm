/**
 * e2e/sidebar-rail.e2e.ts
 *
 * Regression coverage for the wide-layout sidebar rail (56px icon strip) and
 * its expand control. Two independent states can force the rail:
 *
 *   - `uiDensity === 'minimised'` (Settings → Density), and
 *   - `sidebarCollapsed === true` (the manual collapse button).
 *
 * The original bug: when BOTH were set, clicking the rail's expand button only
 * cleared one of them, so the rail stayed up and a second click was required.
 * SidebarNav now switches density back to `expanded` and clears the manual
 * collapse in the same handler, restoring the full labeled sidebar in one
 * click. These tests pin that end-to-end, including the persisted storage.
 *
 * Run: bun run test:e2e
 */
import { expect, test } from './fixtures';

/** Accessible names from src/locales/en.json (common.expandSidebar/collapseSidebar). */
const EXPAND_LABEL = 'Expand sidebar';
const COLLAPSE_LABEL = 'Collapse sidebar';

/** The rail is `w-14` (56px); the full sidebar is `w-[220px]`. */
const RAIL_MAX_WIDTH = 80;
const FULL_MIN_WIDTH = 180;

/**
 * The full sidebar's top-level nav labels - the same reader nav-order.e2e.ts
 * uses. Scoping to the destination control excludes disclosure and nested tab
 * labels, which render only in the full sidebar.
 */
const NAV_LABEL_SELECTOR = '.sidebar-nav [data-sidebar-destination] span.truncate';
const NAV_ITEM_COUNT = 8;

type LayoutPrefs = { uiDensity: 'expanded' | 'minimised'; sidebarCollapsed: boolean };

async function seedLayoutPrefs(page: import('playwright').Page, prefs: LayoutPrefs) {
  await page.evaluate((p) => {
    return new Promise<void>((resolve) => {
      chrome.storage.local.set(p, () => resolve());
    });
  }, prefs);
}

async function readLayoutPrefs(page: import('playwright').Page) {
  return page.evaluate(async () => {
    const result = await chrome.storage.local.get(['uiDensity', 'sidebarCollapsed']);
    return result as { uiDensity?: string; sidebarCollapsed?: boolean };
  });
}

/** Rendered width of the sidebar, used because it is the rail's observable contract. */
async function sidebarWidth(page: import('playwright').Page): Promise<number> {
  const box = await page.locator('aside.sidebar-nav').boundingBox();
  if (!box) throw new Error('sidebar-nav is not visible');
  return box.width;
}

/** Load the wide layout (≥800px) with the given persisted rail state. */
async function openRail(
  page: import('playwright').Page,
  prefs: LayoutPrefs
): Promise<import('playwright').Locator> {
  await page.setViewportSize({ width: 1000, height: 700 });
  await seedLayoutPrefs(page, prefs);
  await page.reload();
  const aside = page.locator('aside.sidebar-nav');
  await expect(aside).toBeVisible();
  return aside;
}

test('regression: a minimised + manually-collapsed rail expands in ONE click', async ({
  sidepanelPage,
}) => {
  const aside = await openRail(sidepanelPage, {
    uiDensity: 'minimised',
    sidebarCollapsed: true,
  });

  // Both states independently force the rail, so it must start collapsed…
  await expect(aside).toHaveAttribute('data-density', 'minimised');
  expect(await sidebarWidth(sidepanelPage)).toBeLessThan(RAIL_MAX_WIDTH);
  await expect(sidepanelPage.locator(NAV_LABEL_SELECTOR)).toHaveCount(0);
  await expect(sidepanelPage.getByRole('button', { name: EXPAND_LABEL })).toBeVisible();

  // …and ONE click on the rail's expand control…
  await sidepanelPage.getByRole('button', { name: EXPAND_LABEL }).click();

  // …must restore the full labeled sidebar despite both persisted states.
  await expect(aside).toHaveAttribute('data-density', 'expanded');
  await expect(sidepanelPage.getByRole('button', { name: EXPAND_LABEL })).toHaveCount(0);
  await expect(sidepanelPage.getByRole('button', { name: COLLAPSE_LABEL })).toBeVisible();
  expect(await sidebarWidth(sidepanelPage)).toBeGreaterThan(FULL_MIN_WIDTH);
  await expect(sidepanelPage.locator(NAV_LABEL_SELECTOR)).toHaveCount(NAV_ITEM_COUNT);

  // The single click also persists BOTH cleared states - no second click after reload.
  await expect
    .poll(async () => readLayoutPrefs(sidepanelPage))
    .toEqual({
      uiDensity: 'expanded',
      sidebarCollapsed: false,
    });
});

test('a minimised-only rail (not manually collapsed) expands in one click', async ({
  sidepanelPage,
}) => {
  const aside = await openRail(sidepanelPage, {
    uiDensity: 'minimised',
    sidebarCollapsed: false,
  });

  await expect(aside).toHaveAttribute('data-density', 'minimised');
  expect(await sidebarWidth(sidepanelPage)).toBeLessThan(RAIL_MAX_WIDTH);

  await sidepanelPage.getByRole('button', { name: EXPAND_LABEL }).click();

  await expect(aside).toHaveAttribute('data-density', 'expanded');
  expect(await sidebarWidth(sidepanelPage)).toBeGreaterThan(FULL_MIN_WIDTH);
  await expect
    .poll(async () => readLayoutPrefs(sidepanelPage))
    .toEqual({
      uiDensity: 'expanded',
      sidebarCollapsed: false,
    });
});

test('a manually-collapsed rail (density expanded) expands in one click', async ({
  sidepanelPage,
}) => {
  const aside = await openRail(sidepanelPage, {
    uiDensity: 'expanded',
    sidebarCollapsed: true,
  });

  await expect(aside).toHaveAttribute('data-density', 'expanded');
  expect(await sidebarWidth(sidepanelPage)).toBeLessThan(RAIL_MAX_WIDTH);

  await sidepanelPage.getByRole('button', { name: EXPAND_LABEL }).click();

  await expect(sidepanelPage.getByRole('button', { name: COLLAPSE_LABEL })).toBeVisible();
  expect(await sidebarWidth(sidepanelPage)).toBeGreaterThan(FULL_MIN_WIDTH);
  // The density was already expanded, so only the manual collapse flag changes.
  await expect
    .poll(async () => readLayoutPrefs(sidepanelPage))
    .toEqual({
      uiDensity: 'expanded',
      sidebarCollapsed: false,
    });
});

test('submenus expand deliberately and keep their state across navigation', async ({
  sidepanelPage,
}) => {
  const aside = await openRail(sidepanelPage, {
    uiDensity: 'expanded',
    sidebarCollapsed: false,
  });
  const mailboxTabs = aside.locator('[data-sidebar-submenu="mailbox"]');
  const addresses = aside.locator('[data-sidebar-nav-item="addresses"]');
  const addressTabs = addresses.locator('[data-sidebar-submenu="addresses"]');
  await expect(mailboxTabs).toBeVisible();
  await expect(addressTabs).toHaveCount(0);

  await addresses.locator('[data-sidebar-destination]').hover();
  await expect(addressTabs).toHaveCount(0);
  await addresses.locator('[data-sidebar-disclosure]').focus();
  await expect(addressTabs).toHaveCount(0);
  await addresses.locator('[data-sidebar-disclosure]').press('Enter');
  await expect(addressTabs).toBeVisible();
  expect(await addressTabs.evaluate((node) => getComputedStyle(node).position)).toBe('static');

  for (const tab of await addressTabs.getByRole('button').all()) {
    await tab.hover();
    await expect(addressTabs).toBeVisible();
    await expect(mailboxTabs).toBeVisible();
  }

  await addressTabs.getByRole('button', { name: 'Live', exact: false }).click();
  await expect(addresses.locator('[data-sidebar-destination]')).toHaveAttribute(
    'aria-current',
    'page'
  );
  await aside.locator('[data-sidebar-nav-item="mailbox"] [data-sidebar-destination]').click();
  await expect(addressTabs).toBeVisible();
  await addressTabs.getByRole('button').first().press('Escape');
  await expect(addressTabs).toHaveCount(0);
  await expect(addresses.locator('[data-sidebar-disclosure]')).toBeFocused();
});

test('the provider menu opens from the collapsed rail using the keyboard', async ({
  sidepanelPage,
}) => {
  const aside = await openRail(sidepanelPage, { uiDensity: 'expanded', sidebarCollapsed: true });
  await sidepanelPage.evaluate(() => chrome.storage.local.set({ selectedProvider: 'guerrilla' }));
  await aside.locator('#sidebar-create-cta').press('Shift+F10');
  const menu = sidepanelPage.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByText('(Default)', { exact: true })).toBeVisible();
  const fits = () =>
    menu.evaluate((node) => {
      const box = node.getBoundingClientRect();
      return (
        box.left >= 8 &&
        box.right <= innerWidth - 8 &&
        box.top >= 8 &&
        box.bottom <= innerHeight - 8
      );
    });
  await expect.poll(fits).toBe(true);
  await sidepanelPage.setViewportSize({ width: 850, height: 500 });
  await expect.poll(fits).toBe(true);
  await sidepanelPage.keyboard.press('Escape');
  await expect(sidepanelPage.getByRole('menu')).toHaveCount(0);
});

test('Settings remains the current destination on a direct Diagnostics page', async ({
  sidepanelPage,
}) => {
  await openRail(sidepanelPage, { uiDensity: 'expanded', sidebarCollapsed: false });
  await sidepanelPage.goto(
    sidepanelPage.url().replace(/sidepanel\.html.*/, 'sidepanel.html?view=diagnostics')
  );
  await expect(
    sidepanelPage.locator('[data-sidebar-nav-item="settings"] [data-sidebar-destination]')
  ).toHaveAttribute('aria-current', 'page');
});

test('address switching searches provider metadata and supports keyboard selection', async ({
  sidepanelPage,
}) => {
  await openRail(sidepanelPage, { uiDensity: 'expanded', sidebarCollapsed: false });
  await sidepanelPage.evaluate(async () => {
    const seed = await chrome.storage.local.get(['addresses', 'emailStorageAddressIndex']);
    await chrome.storage.local.set({
      addresses: [
        ...(seed.addresses as object[]),
        {
          id: 'sidebar-archived',
          address: 'archived@example.net',
          provider: 'guerrilla',
          accountStatus: 'archived',
          createdAt: Date.now(),
          expiresAt: Date.now() + 3600000,
        },
        {
          id: 'sidebar-deleted',
          address: 'deleted@example.net',
          provider: 'guerrilla',
          accountStatus: 'deleted',
          createdAt: Date.now(),
          expiresAt: Date.now() + 3600000,
        },
      ],
      emailStorageAddressIndex: {
        ...(seed.emailStorageAddressIndex as object),
        'sidebar-archived': 'archived@example.net',
      },
      'storedEmailsByAddress_sidebar-archived': [],
    });
  });
  await sidepanelPage.reload();
  const trigger = sidepanelPage.locator('[aria-controls="sidebar-address-picker"]');
  await trigger.click();
  const search = sidepanelPage.locator('#sidebar-address-search');
  const options = sidepanelPage.locator('[data-address-option]');
  await expect(search).toBeFocused();
  await expect(options).toHaveCount(2);
  await expect(options.filter({ hasText: 'demo.user@example.com' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await search.fill('guerrilla');
  await expect(options).toHaveCount(1);
  await expect(options).toContainText('Archived');
  await search.fill('not-a-match');
  await expect(options).toHaveCount(0);
  await search.press('Escape');
  await expect(trigger).toBeFocused();
  await trigger.click();
  await search.fill('archived@example.net');
  await search.press('ArrowDown');
  await expect(options).toBeFocused();
  await options.press('Enter');
  await expect(sidepanelPage.locator('#sidebar-address-picker')).toHaveCount(0);
  await expect(trigger).toHaveAttribute('title', 'archived@example.net');
});
