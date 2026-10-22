import { expect, test } from '@playwright/test';
import ar from '../../src/locales/ar.json' with { type: 'json' };
import en from '../../src/locales/en.json' with { type: 'json' };

for (const [language, dictionary] of [
  ['en', en],
  ['ar', ar],
] as const) {
  test.describe(language, () => {
    test.use({ locale: language });
    for (const width of [1280, 375]) {
      test(`shared UI signup, OTP and reset at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        const errors: string[] = [];
        const outgoing: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
          if (message.type() === 'error') console.error('Demo browser:', message.text());
        });
        page.on('request', (request) => {
          if (
            !request.url().startsWith('http://127.0.0.1:3100/') &&
            !request.url().startsWith('data:')
          )
            outgoing.push(request.url());
        });
        await page.goto('/1click/');
        const sample = page.frameLocator('#sample');
        const extension = page.frameLocator('#extension');
        await expect(sample.locator('#email')).toBeVisible();
        if (width < 760) await page.getByRole('button', { name: '1Click', exact: true }).click();
        await expect(extension.locator('#app nav, #app footer').first()).toBeVisible();
        await page.getByRole('button', { name: dictionary.webDemo.fill, exact: true }).click();
        await expect(sample.locator('#email')).toHaveValue('alex.demo@example.com');
        await expect(sample.locator('#password')).not.toHaveValue('');
        await sample.locator('#signup button').click();
        await expect(sample.locator('#verification')).toBeAttached();
        await expect(
          extension.getByText('Your demo verification code', { exact: true }).first()
        ).toBeVisible();
        await page.getByRole('button', { name: dictionary.webDemo.fillOtp, exact: true }).click();
        await expect(sample.locator('input[name="otp"]')).toHaveValue(/^\d{6}$/);
        await sample.locator('#verification button').click();
        await expect(sample.locator('#result')).toHaveText(dictionary.webDemo.verified);
        await page.screenshot({
          path: `audit/web-demo/${test.info().project.name}-${language}-${width}.png`,
          fullPage: true,
        });
        if (width < 760) {
          await page.getByRole('button', { name: '1Click', exact: true }).click();
          await page.screenshot({
            path: `audit/web-demo/${test.info().project.name}-${language}-${width}-extension.png`,
            fullPage: true,
          });
        }
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
        ).toBe(true);
        await Promise.all([
          page.waitForURL((url) => url.searchParams.has('session')),
          page.getByRole('button', { name: dictionary.common.reset, exact: true }).click(),
        ]);
        await expect(
          page.getByRole('button', { name: dictionary.webDemo.fill, exact: true })
        ).toBeEnabled();
        // Firefox can retain about:blank in its automation frame registry
        // after the parent reload, even while the new same-origin documents
        // are complete. Read those actual documents through their owners.
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                document
                  .querySelector<HTMLIFrameElement>('#sample')
                  ?.contentDocument?.querySelector<HTMLInputElement>('#email')?.value
            )
          )
          .toBe('');
        await expect
          .poll(() =>
            page.evaluate(() => {
              const doc = document.querySelector<HTMLIFrameElement>('#extension')?.contentDocument;
              if (!doc?.querySelector('#app nav, #app footer')) return null;
              return doc.body.textContent?.includes('Your demo verification code') ?? false;
            })
          )
          .toBe(false);
        expect(errors).toEqual([]);
        expect(outgoing).toEqual([]);
      });
    }
  });
}
