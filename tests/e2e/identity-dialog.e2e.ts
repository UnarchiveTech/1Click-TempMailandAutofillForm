import { expect, test } from './fixtures';

test.describe('Identity editor actions', () => {
  test('shows Reset changes after editing a profile', async ({ sidepanelPage: page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.waitForSelector('.sidebar-nav', { timeout: 10_000 });
    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set(
          {
            identities: [
              {
                id: 'e2e-identity-1',
                name: 'Demo Profile',
                firstNames: 'Demo',
                lastNames: 'User',
                useRandomPassword: true,
                isDefault: true,
                createdAt: Date.now(),
              },
            ],
            selectedIdentityId: 'e2e-identity-1',
          },
          () => resolve()
        );
      });
    });
    await page.reload();
    await page.waitForSelector('#app > *', { timeout: 10_000 });

    await page.reload();
    await page.waitForSelector('#app > *', { timeout: 10_000 });
    await page.locator('.sidebar-nav [data-sidebar-destination]', { hasText: 'Autofill' }).click();
    await expect(page.getByRole('tab', { name: 'Identities' })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Edit Profile' }).first().click();
    await expect(page.locator('#edit-identity-name')).toBeVisible();

    await page.locator('#edit-identity-name').fill('Changed Profile');

    const resetButton = page.getByRole('button', { name: 'Reset changes' });
    await expect(resetButton).toBeVisible();
    await expect(resetButton).toContainText('Reset changes');
  });
});
