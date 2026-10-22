/**
 * e2e/nav-order.e2e.ts
 *
 * The navbar is flag-driven: each top-level view declares a navBarItem with an
 * explicit `order` field (registry in src/utils/ui/nav-layout.ts), and both the
 * floating Footer (popup/sidepanel) and the Sidebar (wide layouts) must render
 * items strictly in that sequence.
 *
 * These tests assert the rendered order end-to-end:
 *   1. Default: primary pill + More menu = the order-field sequence 1..8.
 *   2. Custom: a persisted customNavOrder permutation is mirrored identically
 *      by the footer (primary + More) and the sidebar - both read the same
 *      registry, so they can never disagree.
 *
 * Run: bun run test:e2e
 */
import { expect, test } from './fixtures';

/** English labels of the 8 canonical nav items in order-field sequence. */
const DEFAULT_ORDER = [
  'Mailbox',
  'Addresses',
  'Autofill',
  'Organize',
  'Automation',
  'Activity',
  'Settings',
  'About',
];

async function seedNavOrder(page: import('playwright').Page, order: string[]) {
  await page.evaluate((o) => {
    return new Promise<void>((resolve) => {
      chrome.storage.local.set({ customNavOrder: o }, () => resolve());
    });
  }, order);
}

async function seedMinPrimary(page: import('playwright').Page, pref: 'auto' | 1 | 2 | 3) {
  await page.evaluate((p) => {
    return new Promise<void>((resolve) => {
      chrome.storage.local.set({ minPrimaryItems: p }, () => resolve());
    });
  }, pref);
}

/**
 * Reads the footer's full sequence: the primary pill items (minus the More
 * button) followed by the More menu items, in rendered order.
 */
async function readFooterSequence(page: import('playwright').Page): Promise<string[]> {
  const primary = await page.$$eval('.floating-nav .nav-item .nav-label', (els) =>
    els.map((e) => e.textContent?.trim() ?? '')
  );
  const withoutMore = primary.filter((label) => label !== 'More');
  const moreButton = page.getByRole('button', { name: 'More' });
  await moreButton.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  const more = await page.$$eval('[role="menu"] [role="menuitem"] .nav-label', (els) =>
    els.map((e) => e.textContent?.trim() ?? '')
  );
  return [...withoutMore, ...more];
}

/** Reads the sidebar's nav buttons (all items, wide layout ≥800px). */
async function readSidebarSequence(page: import('playwright').Page): Promise<string[]> {
  return page.$$eval('.sidebar-nav [data-sidebar-destination] span.truncate', (els) =>
    els.map((e) => e.textContent?.trim() ?? '')
  );
}

test('footer and sidebar render items in order-field sequence (1..8)', async ({
  extensionPage,
  sidepanelPage,
}) => {
  // Popup: compact footer - primary pill + More menu must span all 8 in order.
  await seedMinPrimary(extensionPage, 3);
  await extensionPage.reload();
  await extensionPage.waitForSelector('.floating-nav', { timeout: 10_000 });
  const footer = await readFooterSequence(extensionPage);
  console.log('FOOTER_DEFAULT:', JSON.stringify(footer));
  expect(footer).toEqual(DEFAULT_ORDER);

  // Sidepanel at ≥800px: sidebar shows all 8 in the same order.
  await sidepanelPage.setViewportSize({ width: 1000, height: 700 });
  await sidepanelPage.waitForSelector('.sidebar-nav', { timeout: 10_000 });
  const sidebar = await readSidebarSequence(sidepanelPage);
  console.log('SIDEBAR_DEFAULT:', JSON.stringify(sidebar));
  expect(sidebar).toEqual(DEFAULT_ORDER);
});

test('footer and sidebar mirror a custom order permutation', async ({
  extensionPage,
  sidepanelPage,
}) => {
  // A full 8-key permutation (missing keys would be re-appended by design).
  const custom = [
    'activity',
    'about',
    'automation',
    'settings',
    'organize',
    'addresses',
    'mailbox',
    'autofill',
  ];
  const customLabels = [
    'Activity',
    'About',
    'Automation',
    'Settings',
    'Organize',
    'Addresses',
    'Mailbox',
    'Autofill',
  ];

  // Same extension context → storage is shared; both pages read it.
  await seedNavOrder(extensionPage, custom);
  await extensionPage.reload();
  await extensionPage.waitForSelector('.floating-nav', { timeout: 10_000 });
  const footer = await readFooterSequence(extensionPage);
  console.log('FOOTER_CUSTOM:', JSON.stringify(footer));
  expect(footer).toEqual(customLabels);

  await sidepanelPage.setViewportSize({ width: 1000, height: 700 });
  await sidepanelPage.reload();
  await sidepanelPage.waitForSelector('.sidebar-nav', { timeout: 10_000 });
  const sidebar = await readSidebarSequence(sidepanelPage);
  console.log('SIDEBAR_CUSTOM:', JSON.stringify(sidebar));
  expect(sidebar).toEqual(customLabels);
});

test('a forced minPrimaryItems pref yields a compact footer with a bigger More menu', async ({
  extensionPage,
  sidepanelPage,
}) => {
  // Force exactly 2 primary items - the rest must collapse into More, even
  // though the auto mode would show far more.
  await seedMinPrimary(extensionPage, 2);
  await extensionPage.reload();
  await extensionPage.waitForSelector('.floating-nav', { timeout: 10_000 });

  const primary = await extensionPage.$$eval('.floating-nav .nav-item .nav-label', (els) =>
    els.map((e) => e.textContent?.trim() ?? '')
  );
  console.log('FOOTER_PREF_2:', JSON.stringify(primary));
  expect(primary).toEqual(['Mailbox', 'Addresses', 'More']); // forced 2 + More button

  const moreButton = extensionPage.getByRole('button', { name: 'More' });
  await moreButton.press('Enter');
  await expect(extensionPage.getByRole('menu')).toBeVisible();
  const more = await extensionPage.$$eval('[role="menu"] [role="menuitem"] .nav-label', (els) =>
    els.map((e) => e.textContent?.trim() ?? '')
  );
  console.log('MORE_PREF_2:', JSON.stringify(more));
  expect(more).toEqual(['Autofill', 'Organize', 'Automation', 'Activity', 'Settings', 'About']);

  // The sidebar (≥800px) is the full nav - the pref only governs the compact
  // footer, so the sidebar still shows all 8.
  await sidepanelPage.setViewportSize({ width: 1000, height: 700 });
  await sidepanelPage.reload();
  await sidepanelPage.waitForSelector('.sidebar-nav', { timeout: 10_000 });
  const sidebar = await readSidebarSequence(sidepanelPage);
  console.log('SIDEBAR_PREF_2:', JSON.stringify(sidebar));
  expect(sidebar).toEqual(DEFAULT_ORDER);
});
