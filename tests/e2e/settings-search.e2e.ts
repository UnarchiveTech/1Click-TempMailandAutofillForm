/**
 * e2e/settings-search.e2e.ts
 *
 * Regression coverage for the Settings search bar: live results panel
 * (rendered by the shared SearchBar composite), keyboard navigation,
 * Enter-to-navigate, empty state, and per-scope history chips.
 *
 * Run: bun run test:e2e
 */
import { expect, test } from './fixtures';

async function openSettings(page: import('playwright').Page) {
  // Use the keyboard toggle so a pre-click hover cannot close the More menu.
  await page.getByRole('button', { name: 'More' }).press('Enter');
  await page.getByRole('menuitem', { name: 'Settings' }).click({ force: true });
  await expect(page.locator('.settings-scroll')).toBeAttached({ timeout: 10_000 });
}

test.describe('Settings - search', () => {
  test('live results panel appears while typing and Enter navigates to the match', async ({
    extensionPage: page,
  }) => {
    await openSettings(page);

    const searchInput = page.getByRole('textbox', { name: 'Search settings' });
    await searchInput.click();
    await searchInput.fill('language');

    // Results panel (SearchBar role="listbox") shows the Language card row.
    const results = page.getByRole('listbox', { name: 'Search settings' });
    await expect(results).toBeVisible();
    const languageRow = results.getByRole('option', { name: /Language/ });
    await expect(languageRow).toBeVisible();

    // Arrow keys highlight rows; the first row is highlighted on ArrowDown.
    await searchInput.press('ArrowDown');
    await expect(languageRow).toHaveAttribute('aria-selected', 'true');

    // Enter navigates: the query clears and the target card pulses.
    await searchInput.press('Enter');
    await expect(searchInput).toHaveValue('');
    await expect(page.locator('#setting-language')).toHaveClass(/animate-pulse-highlight/);

    // The navigation was recorded in the 'settings' search-history scope.
    await searchInput.click();
    await expect(page.getByText('Recent searches')).toBeVisible();
    await expect(page.getByRole('button', { name: 'language' }).first()).toBeVisible();
  });

  test('shows empty state when nothing matches', async ({ extensionPage: page }) => {
    await openSettings(page);

    const searchInput = page.getByRole('textbox', { name: 'Search settings' });
    await searchInput.click();
    await searchInput.fill('zzz-no-such-setting');

    await expect(page.getByText('No matching settings found')).toBeVisible();
    // No option rows are rendered for a non-matching query.
    expect(await page.getByRole('option').count()).toBe(0);
  });

  test('Escape triggers the app-wide back shortcut (leaves Settings)', async ({
    extensionPage: page,
  }) => {
    await openSettings(page);

    const searchInput = page.getByRole('textbox', { name: 'Search settings' });
    await searchInput.click();
    await searchInput.fill('language');
    await expect(page.getByRole('listbox', { name: 'Search settings' })).toBeVisible();

    await searchInput.press('Escape');
    // The global Escape keybinding (close-dialogs shortcut) navigates back to
    // the mailbox even while typing - documented, pre-existing behavior.
    await expect(page.locator('.settings-scroll')).toBeHidden();
  });
});
