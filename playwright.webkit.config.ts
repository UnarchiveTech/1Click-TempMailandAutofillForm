/**
 * playwright.webkit.config.ts
 *
 * Dedicated config for the WebKit engine smoke suite (tests/e2e-webkit/).
 * Kept separate from playwright.config.ts so the default `test:e2e` (Chromium
 * extension suite) never launches WebKit or runs engine-only specs.
 *
 * Run: bun run test:e2e:webkit
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e-webkit',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  webServer: {
    command: 'bun scripts/demo-server.ts',
    url: 'http://localhost:5173/demo/signup-checkout.html',
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
});
