/** Same scenarios and assertions; API boundaries simulated, production bundles real. */
import { defineConfig } from '@playwright/test';
import type { test } from './tests/e2e/fixtures';

// Keep main process and workers on the same path; worker argv omits CLI filters.
const runName = (process.env.E2E_MIRROR_RUN || 'all').replace(/[^a-z0-9_-]/gi, '_');
const evidenceDirectory = `.wxt/e2e-mirror/${runName}`;

export default defineConfig<Parameters<typeof test.use>[0]>({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  metadata: { evidenceDirectory },
  outputDir: `${evidenceDirectory}/results`,
  reporter: [
    ['list'],
    ['./tests/e2e/mirror-reporter.ts'],
    ['html', { outputFolder: `${evidenceDirectory}/report`, open: 'never' }],
  ],
  webServer: {
    command: 'bun scripts/demo-server.ts',
    url: 'http://localhost:5173/demo/signup-social.html',
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    {
      name: 'mirror-chrome',
      metadata: { preview: true, target: 'chrome', lane: 'engine-preview' },
      use: { browserName: 'chromium', extensionTarget: 'chrome' },
    },
    {
      name: 'mirror-firefox',
      metadata: { preview: true, target: 'firefox', lane: 'engine-preview' },
      use: { browserName: 'firefox', extensionTarget: 'firefox' },
    },
    {
      name: 'mirror-safari-webkit',
      metadata: { preview: true, target: 'safari', lane: 'engine-preview' },
      use: { browserName: 'webkit', extensionTarget: 'safari' },
    },
  ],
});
