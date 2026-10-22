import { defineConfig } from '@playwright/test';
import { requireRunSignupAuthorization } from './tests/live/authorization';

// Fail before launching a browser or contacting either production service.
requireRunSignupAuthorization(process.env.RUNSIGNUP_LIVE);

export default defineConfig({
  testDir: './tests/live',
  testMatch: '**/*.live.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  repeatEach: 1,
  forbidOnly: true,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  outputDir: '.wxt/runsignup-automated',
  reporter: [['list']],
  use: { trace: 'off', video: 'off', screenshot: 'off' },
});
