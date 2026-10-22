/**
 * e2e/shortcut-settings-nav.e2e.ts
 *
 * Regression coverage for the Keyboard Shortcuts cheat-sheet (Shift+?) gear
 * button added to KeyboardShortcutsCheatSheet.svelte. The gear must close the
 * overlay and land the user on the Keyboard Shortcuts *settings* page in every
 * layout:
 *
 *   1. Popup (narrow, fixed 360px shell): the app has no split pane, so the
 *      gear navigates to the full-page Keyboard Shortcuts settings view
 *      (currentView = 'keybindings').
 *   2. Wide sidepanel (≥1280px, split layout): the gear docks the Keyboard
 *      Shortcuts editor into the split pane next to the Settings hub
 *      (splitSecondaryView = 'keybindings'), even when the sheet was opened
 *      from a non-Settings view such as the mailbox.
 *
 * Run: bun run test:e2e
 */
import { expect, test } from './fixtures';

const SHEET_DIALOG = 'Keyboard Shortcuts';
const GEAR_LABEL = 'Open keyboard shortcuts settings';
/** Subtitle rendered only by the full Keyboard Shortcuts settings view. */
const SETTINGS_SUBTITLE = 'Customize hotkeys for quick actions';

async function openCheatSheet(page: import('playwright').Page) {
  // Focus must not be inside an input, or the global '?' shortcut is suppressed.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('?');
  const sheet = page.getByRole('dialog', { name: SHEET_DIALOG });
  await expect(sheet).toBeVisible({ timeout: 10_000 });
  return sheet;
}

async function setWideSidepanel(page: import('playwright').Page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForSelector('.sidebar-nav', { timeout: 10_000 });
}

test.describe('cheat-sheet gear → Keyboard Shortcuts settings', () => {
  test('popup (narrow): gear opens the full-page Keyboard Shortcuts settings view', async ({
    extensionPage: page,
  }) => {
    // The popup shell is a fixed 360px column regardless of the tab viewport.
    const shell = page.locator('#app > div > div.w-\\[360px\\]').first();
    await expect(shell).toBeAttached({ timeout: 10_000 });

    const sheet = await openCheatSheet(page);
    await expect(sheet.getByRole('button', { name: GEAR_LABEL })).toBeVisible();

    await sheet.getByRole('button', { name: GEAR_LABEL }).click();

    // The overlay closes and the full-page settings view replaces it.
    await expect(sheet).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText(SETTINGS_SUBTITLE)).toBeVisible({ timeout: 10_000 });
    // View-only markers that never appear on the cheat sheet:
    await expect(
      page.getByRole('heading', { level: 2, name: 'System & Navigation Shortcuts' })
    ).toBeVisible();
    // The rows are editable (view renders an Edit action per shortcut).
    await expect(page.getByRole('button', { name: 'Edit' }).first()).toBeVisible();
  });

  test('wide sidepanel: gear from the mailbox docks the settings view into the split pane', async ({
    sidepanelPage: page,
  }) => {
    await setWideSidepanel(page);

    // Start on the mailbox (not the Settings hub) to prove the gear docks
    // regardless of where the sheet was opened from.
    await expect(page.locator('[data-mainview]').first()).toBeAttached({ timeout: 10_000 });

    const sheet = await openCheatSheet(page);
    await expect(sheet.getByRole('button', { name: GEAR_LABEL })).toBeVisible();
    await sheet.getByRole('button', { name: GEAR_LABEL }).click();

    // Overlay closes; Keyboard Shortcuts settings appear docked beside a
    // Settings-surface main pane in the wide layout.
    await expect(sheet).toBeHidden({ timeout: 10_000 });
    const detail = page.locator('[data-splitview]').filter({ hasText: SETTINGS_SUBTITLE }).first();
    await expect(detail).toBeVisible({ timeout: 10_000 });
    await expect(detail.getByText(SETTINGS_SUBTITLE)).toBeVisible();
    await expect(detail.getByRole('button', { name: 'Edit' }).first()).toBeVisible();
  });
});
