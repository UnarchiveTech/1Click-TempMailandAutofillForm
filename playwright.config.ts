/**
 * playwright.config.ts
 *
 * Playwright configuration for the 1Click extension E2E test suite.
 *
 * Key decisions:
 *  - workers: 1     — Extensions share a Chromium persistent context; running
 *                     in parallel would require multiple Chrome instances which
 *                     is both slow and flaky. Single worker keeps tests stable.
 *  - headless: false — Chrome extensions are NOT supported in Playwright's
 *                     headless mode (this is a Playwright/Chrome limitation).
 *  - No baseURL     — We navigate to chrome-extension://<id>/popup.html URLs
 *                     which are resolved dynamically per test run via fixtures.ts.
 *  - timeout: 30s   — Extension startup + Svelte hydration can be slow in CI.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',

  // Extensions cannot run in parallel — one persistent context at a time
  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,

  reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }], ['list']],

  // Global timeout per test (extension startup is slow)
  timeout: 30_000,

  // Expect timeout for individual assertions
  expect: { timeout: 10_000 },

  use: {
    // No baseURL — tests use chrome-extension:// URLs resolved via fixtures.ts
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'extension-chrome',
      use: {
        // The browser/context launch is entirely handled in tests/e2e/fixtures.ts via
        // chromium.launchPersistentContext with --load-extension. We declare
        // Desktop Chrome here so Playwright knows to use Chromium binaries.
        ...devices['Desktop Chrome'],
      },
    },
  ],
});
