/**
 * e2e/split-deeplinks.e2e.ts
 *
 * Regression coverage for the wide-sidepanel (≥1280px) split layouts and the
 * tab / split-pane state props that AppShell writes internally and AppLayout
 * owns (bound two-way after the 2026-09 audit - a one-way pass silently
 * desynced the two copies, breaking AppLayout-side transitions such as the
 * Escape-back shortcut and the wide→narrow fold).
 *
 * Covered here, on the REAL built extension in a wide sidepanel context:
 *   1. splitSecondaryView - Settings hub sub-pages dock into the split pane
 *      (hub stays in the main pane), switch between docked views, and fold
 *      back into a full page when the container shrinks below 800px.
 *   2. autofillTabValue - a cold-start deep link (sidepanel.html?view=autofill
 *      &tab=credentials) lands on the Saved Logins tab; a shell-side tab
 *      click (Identities) is then overridden by an AppLayout-side storage
 *      deep-link that flips the visible tab back - the bound value/signal.
 *   3. organizeTabValue deep links - the sidebar's nested Tags/Labels/Saved
 *      Searches tabs switch the Organize page tab AND the contextual CTA
 *      (New tag / New label / New filter) via the shell-owned organize tab.
 *   4. splitListWidthPx - dragging the split divider resizes the list pane,
 *      persists the width to storage, and a fresh boot restores it.
 *
 * Run: bun run test:e2e
 */
import { expect, test } from './fixtures';

/** Sidebar primary nav button (first-level, ignores nested flyout buttons). */
function sidebarNavButton(page: import('playwright').Page, label: string) {
  return page.locator('.sidebar-nav [data-sidebar-destination]', {
    has: page.locator('span.truncate', { hasText: label }),
  });
}

/** Nested flyout button shown under the active primary item (mailbox folders, organize tabs). */
function sidebarNestedButton(page: import('playwright').Page, label: string) {
  return page.locator('.sidebar-nav [data-sidebar-submenu] > button', {
    has: page.locator('span.truncate', { hasText: label }),
  });
}

async function setWideSidepanel(page: import('playwright').Page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForSelector('.sidebar-nav', { timeout: 10_000 });
}

test.describe('wide sidepanel - split pane + tab deep links', () => {
  test('settings subpage docks in the split pane and folds to a full page when narrowed', async ({
    sidepanelPage: page,
  }) => {
    await setWideSidepanel(page);

    // Settings hub alone (no secondary docked yet → no split shell).
    await sidebarNavButton(page, 'Settings').click();
    await expect(page.locator('.settings-scroll')).toBeAttached({ timeout: 10_000 });
    await expect(page.locator('[data-splitview]:visible')).toHaveCount(0);

    // Keyboard shortcuts card → docks into the split pane (hub stays left).
    await page.locator('#setting-keybindings').click();
    const detail = page
      .locator('[data-splitview]')
      .filter({ hasText: 'Keyboard Shortcuts' })
      .first();
    await expect(detail).toBeVisible({ timeout: 10_000 });
    await expect(detail.getByText('Keyboard Shortcuts')).toBeVisible();
    await expect(page.locator('[data-mainview] #setting-keybindings')).toBeAttached();

    // The panes are side by side (detail to the right of the list/hub pane).
    const fallback = { x: 0, y: 0, width: 0, height: 0 };
    const mainBox = (await page.locator('[data-mainview]').boundingBox()) ?? fallback;
    const detailBox = (await detail.boundingBox()) ?? fallback;
    expect(mainBox.x).toBeLessThan(detailBox.x);

    // A different hub card swaps the docked secondary view.
    await page.locator('[data-mainview] #setting-storage').click();
    await expect(
      page.locator('[data-splitview]').filter({ hasText: 'Storage & Performance' }).first()
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-mainview] .settings-scroll')).toBeAttached();

    // Shrinking below the wide threshold folds the docked view into a full
    // page - this transition runs in AppLayout (layout measurement), so it is
    // only correct when AppLayout's splitSecondaryView is in sync with the
    // shell's write (the audit binding).
    await page.setViewportSize({ width: 640, height: 800 });
    await expect(page.locator('[data-splitview]:visible')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator('.sidebar-nav')).toHaveCount(0);
    await expect(page.getByText('Storage & Performance')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back' }).first()).toBeVisible();
  });

  test('autofill cold-start deep link + mid-session deep link override the visible tab', async ({
    sidepanelPage: page,
  }) => {
    await setWideSidepanel(page);

    // Cold-start deep link: sidepanel.html?view=autofill&tab=credentials is
    // consumed by view-handoff on boot (AppLayout-owned state flows into the
    // shell-rendered AutofillView through the bound tab value/signal).
    const base = page.url().split('?')[0];
    await page.goto(`${base}?view=autofill&tab=credentials`);
    const credentialsTab = page.getByRole('tab', { name: 'Saved Logins' });
    const identitiesTab = page.getByRole('tab', { name: 'Identities' });
    await expect(credentialsTab).toBeVisible({ timeout: 15_000 });
    await expect(credentialsTab).toHaveAttribute('aria-selected', 'true');

    // Shell-side click selects Identities (bound write into AppLayout).
    await identitiesTab.click();
    await expect(identitiesTab).toHaveAttribute('aria-selected', 'true');

    // AppLayout-side deep link (storage.onChanged listener) flips it back -
    // only works if the shell-rendered tab follows AppLayout's value/signal.
    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set(
          { openView: 'autofill', autofillTab: 'credentials', openViewAt: Date.now() },
          () => resolve()
        );
      });
    });
    await expect(credentialsTab).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 });
  });

  test('sidebar organize tab deep links switch the page tab and contextual CTA', async ({
    sidepanelPage: page,
  }) => {
    await setWideSidepanel(page);

    await sidebarNavButton(page, 'Organize').click();
    await expect(page.getByRole('tab', { name: 'Tags' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#sidebar-create-cta')).toHaveAttribute('aria-label', 'New tag');

    // Sidebar nested tab → Saved Searches (filters).
    await sidebarNestedButton(page, 'Saved Searches').click();
    await expect(page.getByRole('tab', { name: 'Saved Searches' })).toHaveAttribute(
      'aria-selected',
      'true',
      { timeout: 10_000 }
    );
    await expect(page.locator('#sidebar-create-cta')).toHaveAttribute('aria-label', 'New filter');

    // Sidebar nested tab → Labels.
    await sidebarNestedButton(page, 'Labels').click();
    await expect(page.getByRole('tab', { name: 'Labels' })).toHaveAttribute(
      'aria-selected',
      'true',
      {
        timeout: 10_000,
      }
    );
    await expect(page.locator('#sidebar-create-cta')).toHaveAttribute('aria-label', 'New label');

    // And back to Tags.
    await sidebarNestedButton(page, 'Tags').click();
    await expect(page.getByRole('tab', { name: 'Tags' })).toHaveAttribute('aria-selected', 'true', {
      timeout: 10_000,
    });
    await expect(page.locator('#sidebar-create-cta')).toHaveAttribute('aria-label', 'New tag');
  });

  test('dragging the split divider resizes the list pane and persists the width', async ({
    sidepanelPage: page,
  }) => {
    await setWideSidepanel(page);

    await sidebarNavButton(page, 'Autofill').click();
    await expect(page.getByRole('tab', { name: 'Identities' })).toBeVisible({ timeout: 10_000 });
    const resizeHandle = page.locator('.split-resize-handle:visible').first();
    await expect(resizeHandle).toBeVisible();
    const mainPane = page.locator('[data-mainview]:visible').first();
    let mainBeforeWidth = 0;
    await expect
      .poll(async () => {
        mainBeforeWidth = (await mainPane.boundingBox())?.width ?? 0;
        return mainBeforeWidth;
      })
      .toBeGreaterThan(0);

    // The collapse button legitimately owns the divider's vertical middle, so
    // grab the handle at the exact column centerline near the top. Dragging
    // from the center also guards the fix that keeps the decorative ::before
    // line from swallowing pointer events along that centerline.
    const handleBox = await resizeHandle.boundingBox();
    if (!handleBox) throw new Error('Visible split divider has no measurable bounding box');
    const dragX = handleBox.x + handleBox.width / 2;
    const dragY = handleBox.y + 40;
    await page.mouse.move(dragX, dragY);
    await page.mouse.down();
    await page.mouse.move(dragX + 140, dragY, { steps: 6 });
    await page.mouse.up();

    await expect
      .poll(async () => (await mainPane.boundingBox())?.width ?? 0)
      .toBeGreaterThan(mainBeforeWidth + 130);

    const storedWidth = await page.evaluate(
      () =>
        new Promise<number | undefined>((resolve) => {
          chrome.storage.local.get(['splitListWidthPx'], (r: { splitListWidthPx?: number }) =>
            resolve(r.splitListWidthPx as number | undefined)
          );
        })
    );
    expect(storedWidth).toBeDefined();
    expect(storedWidth ?? 0).toBeGreaterThan(mainBeforeWidth + 130);

    // Fresh boot restores the dragged width (layout measurement reads storage).
    const base = page.url().split('?')[0];
    await page.goto(base);
    await page.waitForSelector('.sidebar-nav', { timeout: 15_000 });
    await sidebarNavButton(page, 'Autofill').click();
    await expect(page.locator('[data-mainview]:visible').first()).toBeVisible({ timeout: 15_000 });
    // A visible shell can precede its restored pane's first layout. Poll the
    // same width assertion instead of turning a transient missing box into zero.
    await expect
      .poll(
        async () =>
          (await page.locator('[data-mainview]:visible').first().boundingBox())?.width ?? 0
      )
      .toBeGreaterThan(mainBeforeWidth + 130);
  });
});
