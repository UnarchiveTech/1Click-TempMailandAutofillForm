/**
 * e2e/fixtures.ts
 *
 * Provides the native Chromium extension fixture and browser-engine previews.
 * Native runs load the extension and wait for its service worker. Preview runs
 * use the target build's production UI/background over a test API transport.
 *
 * Usage in tests:
 *   import { test, expect } from './fixtures';
 *   test('popup shows ...', async ({ extensionPage, extensionId }) => { ... });
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BrowserContext, test as base, chromium, expect, type Page } from '@playwright/test';
import type { CDPSession } from 'playwright-core';
import { retainClosedRoots } from './closed-shadow-probe';
import { type BuildTarget, buildPath, extensionUrl, installBuildPreview } from './preview-harness';
import { demoSeedStorage } from './seed';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Serve the local demo fixture on an origin with a required host permission.
 * Production builds don't grant localhost access to scripting.executeScript,
 * which the lightweight content gate uses to load the autofill runtime.
 * Playwright intercepts this URL below; the signup page never hits the network.
 */
const DEMO_SIGNUP_URL = 'https://api.guerrillamail.com/__e2e__/signup-checkout.html';

/**
 * Demo-mode storage seeded into every test page - 100% offline and deterministic.
 *
 * NOTE: mail must be seeded in the CURRENT 3.0 email-storage shape - an
 * `emailStorageAddressIndex` mapping addressId → address plus one
 * `storedEmailsByAddress_<addressId>` bag per mailbox (+ derived metadata).
 * The legacy flat `storedEmails` key is no longer read by getEmailMaps(), so
 * seeding it produces an empty mailbox (All (0)). See src/utils/storage/storage-keys.ts.
 */

export interface DemoSignupPage {
  page: Page;
  cdp: CDPSession | Page;
}

export const test = base.extend<{
  context: BrowserContext;
  extensionTarget: BuildTarget;
  extensionBuildPath: string;
  previewBase: string;
  chromiumArgs: string[];
  extensionId: string;
  extensionPage: Page;
  sidepanelPage: Page;
  demoSignupPage: DemoSignupPage;
}>({
  extensionTarget: ['chrome', { option: true }],
  chromiumArgs: [[], { option: true }],
  // Allow an immutable build copy when another task is rebuilding shared output.
  extensionBuildPath: [
    async ({ extensionTarget }, use) => use(buildPath(extensionTarget)),
    { option: true },
  ],
  // Native extension loading uses Chromium; previews use the project's engine.
  context: [
    async ({ browserName, playwright, extensionBuildPath, chromiumArgs }, use, testInfo) => {
      if (testInfo.project.metadata.preview) {
        const browser = await playwright[browserName].launch({
          args: browserName === 'chromium' ? chromiumArgs : [],
          // These ordinary preview tabs stand in for visible extension UI and
          // its background context. Avoid hidden-web-tab timer budgeting in
          // that simulation; native Firefox runs keep their real defaults.
          ...(browserName === 'firefox'
            ? {
                firefoxUserPrefs: {
                  'dom.min_background_timeout_value': 0,
                  'dom.min_background_timeout_value_without_budget_throttling': 0,
                  'dom.timeout.enable_budget_timer_throttling': false,
                },
              }
            : {}),
        });
        const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        await context.addInitScript(retainClosedRoots);
        try {
          await use(context);
        } finally {
          await context.close();
          await browser.close();
        }
        return;
      }
      if (browserName !== 'chromium') {
        throw new Error(`Extension e2e requires a chromium project (got "${browserName}")`);
      }
      // Keep each profile in the test's writable, isolated artifact directory.
      // Some Windows sandboxes allow Chrome to launch from OS temp but block its
      // extension storage there, leaving storage promises pending indefinitely.
      const context = await chromium.launchPersistentContext(
        testInfo.outputPath('chromium-profile'),
        {
          headless: false, // extensions require headed mode in Playwright
          // Explicit local override, shared with the browser geometry probes.
          ...(process.env.PW_CHROMIUM_EXEC ? { executablePath: process.env.PW_CHROMIUM_EXEC } : {}),
          args: [
            `--disable-extensions-except=${extensionBuildPath}`,
            `--load-extension=${extensionBuildPath}`,
            '--no-sandbox',
            '--disable-setuid-sandbox',
            ...chromiumArgs,
          ],
        }
      );
      try {
        await use(context);
      } finally {
        await context.close();
      }
    },
    { scope: 'test', timeout: 60_000 },
  ],

  previewBase: async ({ context, extensionTarget }, use, testInfo) => {
    await use(
      testInfo.project.metadata.preview ? await installBuildPreview(context, extensionTarget) : ''
    );
  },

  // Resolve the extension ID from the service worker URL
  extensionId: async ({ context, previewBase }, use) => {
    if (previewBase) {
      await use(previewBase);
      return;
    }
    // Wait for the background service worker to start
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker', { timeout: 10_000 });
    }
    // A fresh profile fires onInstalled asynchronously. Its storage.clear must
    // finish before test seeding; the persisted defaults are its completion marker.
    await expect
      .poll(() =>
        background.evaluate(async () => {
          const { smartAutofillSettings } = await chrome.storage.local.get('smartAutofillSettings');
          return !!smartAutofillSettings;
        })
      )
      .toBe(true);
    // chrome-extension://<id>/background.js
    const id = background.url().split('/')[2];
    await use(id);
  },

  // A page opened at popup.html
  extensionPage: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(extensionUrl(extensionId, 'popup.html'));
    // Seed demoMode and completed onboarding
    await page.evaluate((seed) => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set(seed, () => resolve());
      });
    }, demoSeedStorage());
    await page.reload();
    await page.waitForSelector('#app > *', { timeout: 10_000 });
    // An initial loading skeleton is also an app child. Wait for real shell controls.
    await page.waitForSelector('#app nav, #app footer', { timeout: 10_000 });
    await use(page);
    page.on('close', () => {}); // ignore teardown errors
    await page.close();
  },

  // A page opened at sidepanel.html
  sidepanelPage: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(extensionUrl(extensionId, 'sidepanel.html'));
    // Seed demoMode and completed onboarding
    await page.evaluate((seed) => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set(seed, () => resolve());
      });
    }, demoSeedStorage());
    await page.reload();
    await page.waitForSelector('#app > *', { timeout: 10_000 });
    await page.waitForSelector('#app nav, #app footer', { timeout: 10_000 });
    await use(page);
    page.on('close', () => {}); // ignore teardown errors
    await page.close();
  },

  // A real web page (the demo signup form) with demo state seeded, plus a CDP
  // session to drive the content script's CLOSED shadow-root controls
  // (Playwright locators cannot pierce closed shadow roots, and the injected
  // buttons reject synthetic clicks via event.isTrusted).
  demoSignupPage: async ({ context, extensionId, previewBase }, use) => {
    // chrome.storage is only reachable from extension pages / content worlds,
    // so seed demo state from a throwaway popup page first.
    const seeder = await context.newPage();
    await seeder.goto(extensionUrl(extensionId, 'popup.html'));
    await seeder.evaluate((seed) => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set(seed, () => resolve());
      });
    }, demoSeedStorage());
    await seeder.close();

    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 1000 });
    const cdp = previewBase ? page : await context.newCDPSession(page);
    const demoUrl = previewBase
      ? 'http://localhost:5173/demo/signup-checkout.html'
      : DEMO_SIGNUP_URL;
    await page.route(demoUrl, (route) =>
      route.fulfill({
        path: path.resolve(__dirname, '..', '..', 'demo', 'signup-checkout.html'),
        contentType: 'text/html',
      })
    );
    await page.goto(demoUrl);
    await use({ page, cdp });
    try {
      if ('send' in cdp) await cdp.detach();
    } catch {
      /* ignore */
    }
    await page.close();
  },
});

export { expect } from '@playwright/test';
