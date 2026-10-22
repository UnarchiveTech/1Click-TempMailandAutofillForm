import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/web-demo',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:3100',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'bun scripts/serve-web-demo.ts',
    url: 'http://127.0.0.1:3100/1click/',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'demo-chromium',
      use: {
        browserName: 'chromium',
        launchOptions: process.env.PW_CHROMIUM_EXEC
          ? { executablePath: process.env.PW_CHROMIUM_EXEC }
          : {},
      },
    },
    { name: 'demo-firefox', use: { browserName: 'firefox' } },
    { name: 'demo-webkit', use: { browserName: 'webkit' } },
  ],
});
