/** Unsupported browser APIs must stay an explicit gap and leave the page usable. */
import { expect, test } from './fixtures';
import { extensionUrl } from './preview-harness';

test('WebMCP-unavailable engines leave signup usable without registration errors', async ({
  context,
  extensionId,
  extensionPage,
}) => {
  await extensionPage.evaluate(() =>
    chrome.storage.local.set({ developerSettings: { enableLogging: true } })
  );
  const page = await context.newPage();
  const errors: string[] = [];
  const messages: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => messages.push(message.text()));
  try {
    await page.goto('http://localhost:5173/demo/signup-checkout.html');
    const supported = await page.evaluate(() =>
      Boolean(
        (document as unknown as { modelContext?: unknown }).modelContext ??
          (navigator as unknown as { modelContext?: unknown }).modelContext
      )
    );
    test.skip(
      supported,
      'This engine exposes WebMCP; the registration suite covers its supported path'
    );
    if (extensionId.startsWith('http:'))
      await page.addScriptTag({
        url: extensionUrl(extensionId, 'content-scripts/webmcp-bridge.js'),
      });
    await expect(page.locator('html')).toHaveAttribute('data-oneclick-webmcp-injected', '1');
    // This diagnostic is emitted after the page script's final registration attempt.
    await expect
      .poll(() => messages.some((message) => message.includes('modelContext not available')))
      .toBe(true);
    await page.locator('#email').fill('feature-check@example.com');
    await expect(page.locator('#email')).toHaveValue('feature-check@example.com');
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});
