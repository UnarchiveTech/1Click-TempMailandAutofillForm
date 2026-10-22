import { expect, test } from './fixtures';
import { extensionUrl } from './preview-harness';

for (const shell of ['popup', 'sidepanel', 'app']) {
  test(`${shell}: a delayed language load preserves the mounted Settings page`, async ({
    extensionPage: page,
    extensionId,
  }) => {
    let delayedLocale = false;
    await page.route(/\/ja(?:\.json)?-[^/]+\.js(?:\?|$)/, async (route) => {
      delayedLocale = true;
      // Model a slow dictionary response, long enough to expose the loading
      // state. This is controlled network latency, not a UI readiness wait.
      await new Promise((resolve) => setTimeout(resolve, 800));
      // Let the context's target-build resource route serve the response in
      // engine previews; continue() would skip it and hit the demo server.
      await route.fallback();
    });
    await page.goto(extensionUrl(extensionId, `${shell}.html?view=settings`));
    const settings = page.locator('.settings-scroll');
    await expect(settings).toBeVisible();
    const originalSettings = await settings.elementHandle();
    const search = page.getByRole('textbox', { name: 'Search settings' });
    const originalSearch = await search.elementHandle();
    await search.fill('language:japanese');
    await expect(page.getByRole('option').first()).toBeVisible();
    await search.press('ArrowDown');
    await search.press('Enter');
    await page.waitForFunction(() => document.documentElement.lang === 'ja');
    expect(delayedLocale).toBe(true);
    expect(await originalSettings?.evaluate((node) => node.isConnected)).toBe(true);
    await expect(settings).toBeVisible();
    // Its accessible name is now Japanese; retain the actual original node
    // rather than querying it again by its former English label.
    expect(await originalSearch?.evaluate((node) => node.isConnected)).toBe(true);
    expect(await originalSearch?.evaluate((node) => (node as HTMLInputElement).value)).toBe('');
    await originalSearch?.dispose();
    await originalSettings?.dispose();
  });
}
