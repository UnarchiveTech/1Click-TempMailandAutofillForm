/**
 * e2e/inbox-lifecycle.e2e.ts
 *
 * Fully automated browser tests: Playwright launches a real (headed) Chromium
 * with the built extension loaded, then drives the UI purely by script -
 * create a temp mail address, receive simulated mail, open the message, copy
 * the OTP - with zero human interaction. Demo mode keeps everything offline
 * and deterministic (no network, no real addresses).
 *
 * Run (build first, then test):
 *   bun run build
 *   bun run test:e2e -- inbox-lifecycle
 */

import { expect, test } from './fixtures';

/** The current active address shown in the top account bar. */
function activeAddress(page: import('@playwright/test').Page) {
  return page.getByRole('group', { name: 'Select email address' });
}

/**
 * Click the Mailbox destination in the MAIN navigation. Nav buttons now embed
 * their unread badge in the accessible name (e.g. "Mailbox, 2 unread"), so a
 * bare `name: 'Mailbox'` lookup can silently match a More-flyout item instead
 * of navigating. Scope to the nav element and match by substring.
 */
async function goToMailbox(page: import('@playwright/test').Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: /Mailbox/ })
    .click();
}

/**
 * Address rows inside the account drawer. Direct children of a `role=list`
 * only: each address renders as a wrapper listitem around AddressCard, which
 * itself carries role="listitem", so an unscoped listitem locator double
 * counts every address.
 */
function addressRows(page: import('@playwright/test').Page) {
  return page.locator('[role="list"] > [role="listitem"]').filter({ hasText: '@example.com' });
}

/**
 * Create a fresh address from the account drawer. The drawer's New Mail
 * Address button now opens CreateAddressDialog (Random preselected), which
 * must be confirmed before the address is created and becomes active.
 */
async function createNewAddress(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('#button-create-new-mail').click();
  const confirm = page.getByRole('button', { name: 'Create' });
  await expect(confirm).toBeVisible({ timeout: 5000 });
  await confirm.click();
}

test.describe('Inbox lifecycle - fully automated (no user interaction)', () => {
  test('creates a fresh temp mail address and it becomes the active address', async ({
    extensionPage,
  }) => {
    const addressBtn = activeAddress(extensionPage);

    // The seeded demo inbox is active initially.
    await expect(addressBtn).toContainText('demo.user');

    // Open the account drawer and create via New Address → Create dialog.
    await extensionPage.locator('button[aria-label*="Open account list"]').click();
    await expect(extensionPage.locator('#button-create-new-mail')).toBeVisible();
    await createNewAddress(extensionPage);

    // The active address changes away from the seeded one (drawer closes on
    // create). NB: new demo addresses are demo.user2@example.com, which still
    // CONTAINS the substring "demo.user" - match the full seeded address.
    await expect(addressBtn).not.toContainText('demo.user@example.com', {
      timeout: 10_000,
    });
    await expect(addressBtn).toContainText('@example.com');
  });

  test('the new address is persisted and appears in the account drawer', async ({
    extensionPage,
  }) => {
    // Open the drawer: only the seeded demo inbox is listed.
    await extensionPage.locator('button[aria-label*="Open account list"]').click();
    await expect(addressRows(extensionPage)).toHaveCount(1);

    // Create a new address (the drawer closes automatically on create).
    await createNewAddress(extensionPage);
    await expect(activeAddress(extensionPage)).not.toContainText('demo.user@example.com', {
      timeout: 10_000,
    });

    // Reopen the drawer: both addresses are listed now.
    await extensionPage.locator('button[aria-label*="Open account list"]').click();
    await expect(addressRows(extensionPage)).toHaveCount(2);
  });

  test('simulating incoming mail adds a message to the active inbox', async ({ extensionPage }) => {
    // The seeded inbox starts with exactly one message.
    await expect(extensionPage.getByText(/All\s*\(1\)/).first()).toBeVisible({ timeout: 10_000 });

    // More → Settings → Simulate new mail (demo mode only).
    // Keyboard activation avoids toggling the hover-open menu closed on click.
    await extensionPage.getByRole('button', { name: 'More' }).press('Enter');
    await extensionPage.getByRole('menuitem', { name: 'Settings' }).click();
    await extensionPage.waitForTimeout(400);
    const simulateBtn = extensionPage.getByRole('button', { name: /Simulate new mail/i });
    await expect(simulateBtn).toBeVisible();
    await simulateBtn.click();

    // Back to Mailbox: the counter increments to 2.
    await goToMailbox(extensionPage);
    await expect(extensionPage.getByText(/All\s*\(2\)/).first()).toBeVisible({ timeout: 8_000 });
  });

  test('opens the simulated email and exposes the Copy OTP action', async ({ extensionPage }) => {
    // Simulate mail (demoReceiveIndex 0 → GitHub verification email with OTP 482901).
    // Keyboard activation avoids toggling the hover-open menu closed on click.
    await extensionPage.getByRole('button', { name: 'More' }).press('Enter');
    await extensionPage.getByRole('menuitem', { name: 'Settings' }).click();
    await extensionPage.waitForTimeout(400);
    await extensionPage.getByRole('button', { name: /Simulate new mail/i }).click();
    await goToMailbox(extensionPage);

    // Two emails now share the subject - open the newest (first in the list).
    const emailCard = extensionPage
      .getByRole('button', { name: /Email from security@github\.com: Your verification code/ })
      .first();
    await emailCard.focus();
    await extensionPage.keyboard.press('Enter');
    await expect(extensionPage.locator('text=security@github.com')).toBeVisible();
    await expect(extensionPage.getByText(/482901/).first()).toBeVisible();

    // The Copy OTP badge is present and clicking it does not error. The badge
    // renders the code itself as its accessible name (OTP value, not the
    // "Copy OTP" tooltip text). force:true - the message hover-action strip
    // (Mark as unread etc.) floats over the header the badge sits in and
    // intercepts the pointer.
    const otpBadge = extensionPage.getByRole('button', { name: '482901' }).first();
    await expect(otpBadge).toBeVisible();
    await otpBadge.click({ force: true });
  });
});
