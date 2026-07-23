/**
 * e2e/fixtures.ts
 *
 * Provides a `extensionPage` fixture that:
 *  1. Launches Chromium with --load-extension pointing to the built output
 *  2. Waits for the service worker to register (so background.js is alive)
 *  3. Returns a Page opened at the extension's popup.html URL
 *
 * Usage in tests:
 *   import { test, expect } from './fixtures';
 *   test('popup shows ...', async ({ extensionPage, extensionId }) => { ... });
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BrowserContext, test as base, chromium, type Page } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXTENSION_PATH = path.resolve(__dirname, '..', '..', '.output', 'chrome-mv3');

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  extensionPage: Page;
  sidepanelPage: Page;
}>({
  // Override context to launch with the unpacked extension
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires destructuring parameters
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false, // extensions require headed mode in Playwright
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    });
    await use(context);
    await context.close();
  },

  // Resolve the extension ID from the service worker URL
  extensionId: async ({ context }, use) => {
    // Wait for the background service worker to start
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker', { timeout: 10_000 });
    }
    // chrome-extension://<id>/background.js
    const id = background.url().split('/')[2];
    await use(id);
  },

  // A page opened at popup.html
  extensionPage: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    // Seed demoMode and completed onboarding
    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set(
          {
            demoMode: true,
            onboardingComplete: true,
            inboxes: [
              {
                id: 'demo-inbox-1',
                address: 'demo.user@example.com',
                provider: 'demo',
                status: 'active',
                accountStatus: 'active',
                autoExtend: true,
                createdAt: Date.now() - 3600_000,
                expiresAt: Date.now() + 86400_000,
                sidToken: 'demo-token-1',
                token: 'demo-token-1',
              },
            ],
            storedEmails: {
              'demo.user@example.com': [
                {
                  id: 'demo-seed-1',
                  from: 'security@github.com',
                  from_name: 'GitHub',
                  subject: 'Your verification code',
                  body_plain: 'Your GitHub verification code is 482901.',
                  body_html: '<p>Your GitHub verification code is 482901.</p>',
                  received_at: Date.now() - 60_000,
                  unread: true,
                  otp: '482901',
                  isOtp: true,
                  original_inbox: 'demo.user@example.com',
                },
              ],
            },
            activeInboxId: 'demo-inbox-1',
            selectedEmail: 'demo.user@example.com',
          },
          () => resolve()
        );
      });
    });
    await page.reload();
    await page.waitForSelector('#app > *', { timeout: 10_000 });
    await use(page);
    page.on('close', () => {}); // ignore teardown errors
    await page.close();
  },

  // A page opened at sidepanel.html
  sidepanelPage: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    // Seed demoMode and completed onboarding
    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set(
          {
            demoMode: true,
            onboardingComplete: true,
            inboxes: [
              {
                id: 'demo-inbox-1',
                address: 'demo.user@example.com',
                provider: 'demo',
                status: 'active',
                accountStatus: 'active',
                autoExtend: true,
                createdAt: Date.now() - 3600_000,
                expiresAt: Date.now() + 86400_000,
                sidToken: 'demo-token-1',
                token: 'demo-token-1',
              },
            ],
            storedEmails: {
              'demo.user@example.com': [
                {
                  id: 'demo-seed-1',
                  from: 'security@github.com',
                  from_name: 'GitHub',
                  subject: 'Your verification code',
                  body_plain: 'Your GitHub verification code is 482901.',
                  body_html: '<p>Your GitHub verification code is 482901.</p>',
                  received_at: Date.now() - 60_000,
                  unread: true,
                  otp: '482901',
                  isOtp: true,
                  original_inbox: 'demo.user@example.com',
                },
              ],
            },
            activeInboxId: 'demo-inbox-1',
            selectedEmail: 'demo.user@example.com',
          },
          () => resolve()
        );
      });
    });
    await page.reload();
    await page.waitForSelector('#app > *', { timeout: 10_000 });
    await use(page);
    page.on('close', () => {}); // ignore teardown errors
    await page.close();
  },
});

export { expect } from '@playwright/test';
