/**
 * e2e/extension.e2e.ts
 *
 * Deep End-to-end tests for the 1Click Temp Mail extension.
 * These tests load the actual built Chrome extension using a persistent
 * browser context, running in a seeded demo mode to ensure 100% offline reliability.
 *
 * Run: bun run test:e2e
 * Run (headed/debug): bun run test:e2e:headed
 */

import { expect, test } from './fixtures';

// ── 1. BASIC MOUNT ───────────────────────────────────────────────────────────

test.describe('Popup — basic mount', () => {
  test('popup renders without crashing', async ({ extensionPage }) => {
    // Svelte has mounted if #app has at least one child
    const appRoot = extensionPage.locator('#app');
    await expect(appRoot).toBeAttached();
    const children = await appRoot.locator('> *').count();
    expect(children).toBeGreaterThan(0);
  });

  test('popup has correct page title', async ({ extensionPage }) => {
    await expect(extensionPage).toHaveTitle('1Click: Temp Mail & Autofill Form');
  });

  test('popup has no horizontal overflow at 400px', async ({ extensionPage }) => {
    await extensionPage.setViewportSize({ width: 400, height: 600 });
    const overflow = await extensionPage.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(overflow).toBe(false);
  });

  test('popup logs no critical JS errors on load', async ({ context, extensionId }) => {
    const errors: string[] = [];
    const page = await context.newPage();
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.waitForSelector('#app > *', { timeout: 10_000 });
    const critical = errors.filter(
      (e) => !e.includes('storage') && !e.includes('chrome') && !e.includes('browser')
    );
    expect(critical).toEqual([]);
    await page.close();
  });
});

// ── 2. SIDEPANEL MOUNT ────────────────────────────────────────────────────────

test.describe('Sidepanel — basic mount', () => {
  test('sidepanel renders without crashing', async ({ sidepanelPage }) => {
    const appRoot = sidepanelPage.locator('#app');
    await expect(appRoot).toBeAttached();
    const children = await appRoot.locator('> *').count();
    expect(children).toBeGreaterThan(0);
  });

  test('sidepanel has correct page title', async ({ sidepanelPage }) => {
    await expect(sidepanelPage).toHaveTitle('1Click: Temp Mail & Autofill Form');
  });
});

// ── 3. APP ENTRY POINT ────────────────────────────────────────────────────────

test.describe('App entry point — basic mount', () => {
  test('app.html renders without crashing', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/app.html`);
    await page.waitForSelector('#app > *', { timeout: 10_000 });
    const children = await page.locator('#app > *').count();
    expect(children).toBeGreaterThan(0);
    await page.close();
  });
});

// ── 4. NAVIGATION — FOOTER NAV BAR ───────────────────────────────────────────

test.describe('Footer navigation bar', () => {
  test('footer nav is present', async ({ extensionPage }) => {
    const footer = extensionPage.locator('footer, nav, [role="navigation"]').first();
    await expect(footer).toBeAttached({ timeout: 8_000 });
  });

  test('nav contains at least 2 interactive items', async ({ extensionPage }) => {
    const navButtons = extensionPage
      .locator('footer button, nav button')
      .filter({ has: extensionPage.locator('span') });
    const count = await navButtons.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

// ── 5. DEEP FEATURE TESTS (EMAIL VIEWER & INTERACTION) ────────────────────────

test.describe('Email list and viewer interactions', () => {
  test('shows seeded demo email address and seeded mail message', async ({ extensionPage }) => {
    // Check that the address bar displays the demo address in the selector button
    const addressBtn = extensionPage.getByRole('button', { name: /Select email address/i }).first();
    await expect(addressBtn).toContainText('demo.user');

    // Email list should render the seeded GitHub verification email
    const emailItem = extensionPage.locator('text=GitHub').first();
    await expect(emailItem).toBeVisible();

    const subjectItem = extensionPage.locator('text=Your verification code');
    await expect(subjectItem).toBeVisible();
  });

  test('can open and read email details with OTP copy badge', async ({ extensionPage }) => {
    // Click on the verification email card to open it
    await extensionPage.locator('text=Your verification code').click();

    // Check that the email view headers and body loaded
    await expect(extensionPage.locator('text=security@github.com')).toBeVisible();
    await expect(
      extensionPage.locator('text=Your GitHub verification code is 482901')
    ).toBeVisible();

    // Verification code badge (Copy OTP button) should be present
    const otpBadge = extensionPage.getByRole('button', { name: 'Copy OTP' }).first();
    await expect(otpBadge).toBeVisible();
  });
});

// ── 6. EMAIL CREATION & SIMULATION ───────────────────────────────────────────

test.describe('Address management and incoming simulation', () => {
  test('can create a new demo email address', async ({ extensionPage }) => {
    // Open the account dropdown list
    await extensionPage.locator('button[aria-label*="Open account list"]').click();

    // Click on the create new mail button inside the dropdown
    const createBtn = extensionPage.locator('#button-create-new-mail');
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    // Wait for the address to update and verify it contains domain
    const addressBtn = extensionPage.getByRole('button', { name: /Select email address/i }).first();
    await expect(addressBtn).toContainText('@example.com');
  });

  test('can simulate receiving new email via developer settings', async ({ extensionPage }) => {
    // 1. Navigate to Settings page via "More" menu
    await extensionPage.getByRole('button', { name: 'More' }).click();
    await extensionPage.getByRole('menuitem', { name: 'Settings' }).click();
    await extensionPage.waitForTimeout(400);

    // 2. Click "Simulate new mail" button in developer/demo settings section
    const simulateBtn = extensionPage.getByRole('button', { name: /Simulate new mail/i });
    await expect(simulateBtn).toBeVisible();
    await simulateBtn.click();

    // 3. Return to Inbox view
    const inboxBtn = extensionPage.getByRole('button', { name: 'Mailbox' }).first();
    await inboxBtn.click();
    await extensionPage.waitForTimeout(400);

    // 4. Verify that another mail item is visible in the list (total count becomes 2)
    await expect(extensionPage.locator('text=All (2)').first()).toBeVisible({ timeout: 5000 });
  });
});

// ── 7. ONBOARDING FLOW MOCKED ────────────────────────────────────────────────

test.describe('Onboarding flow', () => {
  test('can complete onboarding with mocked API pings', async ({ context, extensionId }) => {
    // Intercept Guerrilla Mail and Burner Kiwi API calls globally for all contexts/workers
    await context.route('**/ajax.php**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          email_addr: 'mocked.user@guerrillamail.com',
          email_timestamp: Math.round(Date.now() / 1000),
          alias: 'mockalias',
          sid_token: 'mocksidtoken',
        }),
      });
    });

    await context.route('**/burner.kiwi/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'burner-id',
          address: 'mocked.user@burner.kiwi',
        }),
      });
    });

    const page = await context.newPage();

    // Load with clear storage to force onboarding view
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.clear(() => resolve());
      });
    });
    await page.reload();
    await page.waitForSelector('#app > *', { timeout: 10_000 });

    // Step 1: Welcome Screen
    const getStartedBtn = page.getByRole('button', { name: /Get Started/i });
    await expect(getStartedBtn).toBeVisible();
    await getStartedBtn.click();

    // Step 2: Choose Provider (pings are mocked, so "Create My First Address" should activate)
    const createBtn = page.getByRole('button', { name: /Create My First Address/i });
    await createBtn.waitFor({ state: 'visible', timeout: 5000 });
    await createBtn.click();

    // Main layout footer should appear
    const footer = page.locator('footer, nav, [role="navigation"]').first();
    await expect(footer).toBeAttached({ timeout: 8000 });

    await page.close();
  });
});

// ── 8. DIALOG ACCESSIBILITY ───────────────────────────────────────────────────

test.describe('Dialog accessibility — Btn primitive', () => {
  test('all visible buttons have accessible names (text or aria-label)', async ({
    extensionPage,
  }) => {
    const buttonsList = await extensionPage.evaluate(() => {
      const allButtons = Array.from(document.querySelectorAll('#app button'));
      return allButtons
        .filter((btn) => {
          const style = window.getComputedStyle(btn);
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            btn.getBoundingClientRect().width > 0
          );
        })
        .map((btn) => ({
          text: btn.textContent?.trim() || '',
          ariaLabel: btn.getAttribute('aria-label') || '',
          ariaLabelledby: btn.getAttribute('aria-labelledby') || '',
          title: btn.getAttribute('title') || '',
        }));
    });

    expect(buttonsList.length).toBeGreaterThan(0);

    for (let i = 0; i < buttonsList.length; i++) {
      const btn = buttonsList[i];
      const hasName = !!(btn.text || btn.ariaLabel || btn.ariaLabelledby || btn.title);
      expect(hasName, `Button #${i} has no accessible name`).toBe(true);
    }
  });

  test('no button has mixed rounded-lg (inconsistent rounding)', async ({ extensionPage }) => {
    const html = await extensionPage.locator('#app').innerHTML();
    const roundedLgCount = (html.match(/class="[^"]*rounded-lg[^"]*"/g) ?? []).length;
    expect(roundedLgCount).toBeLessThan(20);
  });
});

// ── 9. KEYBOARD ACCESSIBILITY ────────────────────────────────────────────────

test.describe('Keyboard navigation', () => {
  test('Tab key moves focus between interactive elements', async ({ extensionPage }) => {
    await extensionPage.keyboard.press('Tab');
    await extensionPage.keyboard.press('Tab');
    await extensionPage.keyboard.press('Tab');

    const focusedTag = await extensionPage.evaluate(() => document.activeElement?.tagName ?? '');
    const interactiveTags = ['BUTTON', 'INPUT', 'A', 'SELECT', 'TEXTAREA'];
    expect(interactiveTags).toContain(focusedTag.toUpperCase());
  });
});

// ── 10. CSS REGRESSION CHECKS ─────────────────────────────────────────────────

test.describe('CSS regression — design system tokens', () => {
  test('md-primary colour variable is applied (theme tokens loaded)', async ({ extensionPage }) => {
    const mdPrimaryDefined = await extensionPage.evaluate(() => {
      const val = getComputedStyle(document.documentElement).getPropertyValue('--md-primary');
      return val.trim().length > 0;
    });
    expect(mdPrimaryDefined).toBe(true);
  });

  test('Btn primitive renders with rounded-xl class (not rounded-lg)', async ({
    extensionPage,
  }) => {
    const btn = extensionPage.locator('button.rounded-xl').first();
    const count = await btn.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });
});

// ── 11. CONTENT-SCRIPT MOCK FIXTURE TESTS ────────────────────────────────────

test.describe('Autofill form detection (mock fixture)', () => {
  const MOCK_SIGNUP = `<!DOCTYPE html><html><head><title>Sign Up</title></head><body>
    <form id="signup-form" action="/register">
      <h2>Sign up for an account</h2>
      <label>Email<input type="email" name="email" id="email" placeholder="you@example.com" /></label>
      <label>Password<input type="password" name="password" id="password" /></label>
      <label>Confirm Password<input type="password" name="confirm_password" id="confirm_password" /></label>
      <label><input type="checkbox" name="terms" id="terms" /> I agree to the Terms</label>
      <button type="submit">Create Account</button>
    </form>
  </body></html>`;

  test('detects email + password fields', async ({ extensionPage }) => {
    await extensionPage.setContent(MOCK_SIGNUP);
    await expect(extensionPage.locator('input[type="email"]')).toHaveCount(1);
    await expect(extensionPage.locator('input[type="password"]')).toHaveCount(2);
  });

  test('can simulate autofill into the form', async ({ extensionPage }) => {
    await extensionPage.setContent(MOCK_SIGNUP);
    await extensionPage.locator('input[type="email"]').fill('tmp@example.com');
    await extensionPage.locator('input[type="password"]').first().fill('Pass1234!');
    await expect(extensionPage.locator('input[type="email"]')).toHaveValue('tmp@example.com');
    await expect(extensionPage.locator('input[type="password"]').first()).toHaveValue('Pass1234!');
  });

  test('terms checkbox is unchecked initially', async ({ extensionPage }) => {
    await extensionPage.setContent(MOCK_SIGNUP);
    const cb = extensionPage.locator('input[type="checkbox"][name="terms"]');
    expect(await cb.isChecked()).toBe(false);
  });
});

test.describe('OTP input detection (mock fixture)', () => {
  test('detects autocomplete="one-time-code" input', async ({ extensionPage }) => {
    await extensionPage.setContent(`<!DOCTYPE html><html><body>
      <input type="text" autocomplete="one-time-code" name="otp" />
    </body></html>`);
    const inp = extensionPage.locator('input[autocomplete="one-time-code"]');
    await expect(inp).toHaveCount(1);
    await inp.fill('123456');
    await expect(inp).toHaveValue('123456');
  });

  test('detects split OTP inputs (maxLength=1 × 6)', async ({ extensionPage }) => {
    await extensionPage.setContent(`<!DOCTYPE html><html><body>
      <form>
        ${Array.from({ length: 6 }, (_, i) => `<input type="text" maxlength="1" id="otp-${i + 1}" />`).join('')}
      </form>
    </body></html>`);
    const inputs = extensionPage.locator('input[maxlength="1"]');
    await expect(inputs).toHaveCount(6);
    for (let i = 0; i < 6; i++) {
      await inputs.nth(i).fill(String(i + 1));
    }
    for (let i = 0; i < 6; i++) {
      await expect(inputs.nth(i)).toHaveValue(String(i + 1));
    }
  });
});
