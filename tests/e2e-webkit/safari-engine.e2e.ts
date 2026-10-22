/**
 * tests/e2e-webkit/safari-engine.e2e.ts
 *
 * WebKit engine smoke for the SAFARI build output.
 *
 * Why this exists (and its limits):
 *   Playwright's WebKit cannot load browser extensions - no chrome.* APIs, no
 *   manifest, no service workers. Real Safari extension e2e therefore requires
 *   macOS (see docs/TEST_COVERAGE_PLAN.md). This suite closes part of that gap
 *   by executing the ACTUAL built Safari content scripts
 *   (.output/safari-mv3/content-scripts/*.js) inside a genuine WebKit engine
 *   against a real page, with a minimal extension-API stub.
 *
 * What it proves:
 *   - the production Safari bundles parse and execute on WebKit without
 *     uncaught errors (pageerror/console.error are tracked),
 *   - WebKit features the content script depends on (closed Shadow DOM,
 *     MutationObserver, input events) behave as the script expects,
 *   - typing/interacting with a real form under the injected scripts stays
 *     error-free (form-autofill DOM code paths are exercised at the engine
 *     level; background/storage messaging is stubbed).
 *
 * What it CANNOT prove (needs real Safari on macOS):
 *   extension pages, storage/messaging round-trips, theme/storage flows.
 *
 * Run:   bun run test:e2e:webkit     (config: playwright.webkit.config.ts)
 * Prereq: bun run build:safari  +  bun x playwright install webkit
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, expect, type Page, test, webkit } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILD_DIR = join(__dirname, '..', '..', '.output', 'safari-mv3', 'content-scripts');
const DEMO_SIGNUP_URL = 'http://localhost:5173/demo/signup-checkout.html';

// Minimal extension-API surface so the built content bundles can attach their
// listeners and resolve their storage/theme lookups without a real background.
const BROWSER_STUB = `
  (() => {
    if (window.__ocWebkitStub) return;
    window.__ocWebkitStub = true;
    const noop = () => {};
    const res = (v = {}) => Promise.resolve(v);
    const runtime = {
      id: 'test-extension-id',
      getURL: (p) => p,
      sendMessage: (message) => res(message?.type === 'clearSessionCredentials' ? { success: true } : {}),
      onMessage: { addListener: noop, removeListener: noop },
      onConnect: { addListener: noop },
      lastError: undefined,
    };
    const storage = {
      local: { get: () => res({}), set: () => res(), remove: () => res(), clear: () => res() },
      session: { get: () => res({}), set: () => res(), remove: () => res() },
      onChanged: { addListener: noop },
    };
    const tabs = { query: () => res([]), sendMessage: () => res({}), create: () => res({}) };
    const i18n = { getMessage: (k) => k, getUILanguage: () => 'en' };
    const api = {
      runtime, storage, tabs, i18n,
      contextMenus: { create: noop, removeAll: () => res(), onClicked: { addListener: noop } },
      notifications: { create: noop },
      alarms: { create: noop, onAlarm: { addListener: noop } },
      scripting: { executeScript: () => res([]) },
      commands: { onCommand: { addListener: noop } },
      action: {}, webNavigation: {}, permissions: {},
    };
    window.chrome = api;
    window.browser = api;
  })();
`;

function readContentScript(name: string): string {
  const file = join(BUILD_DIR, name);
  const code = readFileSync(file, 'utf8');
  if (!code.trim()) throw new Error(`Empty content script: ${file}`);
  return code;
}

test.describe('Safari content scripts on a WebKit engine', () => {
  let browser: Browser;

  test.beforeAll(async () => {
    browser = await webkit.launch({ headless: true });
  });

  test.afterAll(async () => {
    await browser?.close();
  });

  test('built bundles execute and form interaction stays error-free', async () => {
    const context = await browser.newContext();
    await context.addInitScript(BROWSER_STUB);

    const page: Page = await context.newPage();
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(DEMO_SIGNUP_URL, { waitUntil: 'domcontentloaded' });

    // Inject the production Safari bundles in load order (main first).
    const contentJs = readContentScript('content.js');
    const uaSpoofJs = readContentScript('ua-spoof.js');
    await page.addScriptTag({ content: contentJs });
    await page.addScriptTag({ content: uaSpoofJs });

    // Let idle/scan listeners settle, then interact like a user would with a
    // signup form: fill the first text input, blur it, click around.
    await page.waitForTimeout(1500);
    const firstInput = page.locator('input').first();
    await firstInput.waitFor({ state: 'visible', timeout: 10_000 });
    await firstInput.fill('user@example.com');
    await firstInput.blur();
    await page.mouse.click(30, 30);
    await page.waitForTimeout(1000);

    // Engine/execution assertions
    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    expect(
      consoleErrors.length,
      `console errors: ${consoleErrors.join(' | ')}`
    ).toBeLessThanOrEqual(0);

    // The fill actually reached the DOM through WebKit's event pipeline.
    const value = await firstInput.inputValue();
    expect(value).toBe('user@example.com');

    await context.close();
  });

  test('engine supports closed Shadow DOM the content host relies on', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(DEMO_SIGNUP_URL, { waitUntil: 'domcontentloaded' });

    const probe = await page.evaluate(async () => {
      const host = document.createElement('div');
      const root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = '<b class="probe">ok</b>';
      document.body.appendChild(host);
      const observerWorks = await new Promise<boolean>((resolveObserver) => {
        const mo = new MutationObserver(() => {
          mo.disconnect();
          resolveObserver(true);
        });
        mo.observe(host, { childList: true });
        host.appendChild(document.createElement('i'));
        setTimeout(() => resolveObserver(false), 500);
      });
      return {
        closedToOutside: host.shadowRoot === null,
        innerContent: root.querySelector('.probe')?.textContent ?? null,
        observerWorks,
      };
    });

    expect(probe.closedToOutside).toBe(true);
    expect(probe.innerContent).toBe('ok');
    expect(probe.observerWorks).toBe(true);
    await context.close();
  });
});
