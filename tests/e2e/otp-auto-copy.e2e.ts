/**
 * e2e/otp-auto-copy.e2e.ts
 *
 * Per-site OTP auto-copy: when an OTP arrives from a sender domain on the
 * user's `otpAutoCopyList`, the background copies the code to the clipboard
 * and confirms with a VALUE-FREE toast (the code itself never appears in a
 * notification / toast - shoulder-surfing).
 *
 * Driven through demo mode's "Simulate new mail" (which runs the same
 * auto-copy path as real delivery) with the sender's domain opted in.
 *
 * Run (build first, then test):
 *   bun run build
 *   bun run test:e2e -- otp-auto-copy
 */

import { expect, test } from './fixtures';

const GITHUB_OTP = '482901'; // DEMO_SENDERS[0] - security@github.com

test.describe('Per-site OTP auto-copy', () => {
  test('copies an OTP from a listed domain to the clipboard and shows a value-free toast', async ({
    extensionPage,
  }) => {
    // 1. Opt in github.com for auto-copy and reset the demo receive index so
    //    the next simulated mail is the GitHub OTP (482901).
    await extensionPage.evaluate(
      () =>
        new Promise<void>((resolve) => {
          chrome.storage.local.set({ otpAutoCopyList: ['github.com'], demoReceiveIndex: 0 }, () =>
            resolve()
          );
        })
    );

    // 2. The manifest already declares clipboardWrite/clipboardRead, so the
    //    popup can copy + read the clipboard without extra grants. Nothing to
    //    do here - proceed to the delivery.

    // 3. More → Settings → Simulate new mail (demo mode only). Keyboard
    //    activation avoids toggling the hover-open menu closed on click.
    await extensionPage.getByRole('button', { name: 'More' }).press('Enter');
    await extensionPage.getByRole('menuitem', { name: 'Settings' }).click();
    await extensionPage.waitForTimeout(400);
    const simulateBtn = extensionPage.getByRole('button', { name: /Simulate new mail/i });
    await expect(simulateBtn).toBeVisible();
    await simulateBtn.click();

    // 4. The code lands in the clipboard (auto-copy fired for the listed
    //    sender domain).
    await extensionPage.bringToFront();
    await expect
      .poll(() => extensionPage.evaluate(() => navigator.clipboard.readText().catch(() => '')), {
        timeout: 10_000,
      })
      .toBe(GITHUB_OTP);

    // 5. The confirmation is value-free: the "OTP copied to clipboard" toast
    //    is visible and does NOT contain the code.
    const toast = extensionPage.getByText('OTP copied to clipboard').last();
    await expect(toast).toBeVisible();
    await expect(toast).not.toContainText(GITHUB_OTP);
  });

  test('does NOT auto-copy when the sender domain is not listed', async ({ extensionPage }) => {
    // Only apple.com is listed; the first simulated mail (GitHub) must not copy.
    await extensionPage.evaluate(
      () =>
        new Promise<void>((resolve) => {
          chrome.storage.local.set({ otpAutoCopyList: ['apple.com'], demoReceiveIndex: 0 }, () =>
            resolve()
          );
        })
    );
    // Start from a known-empty clipboard so a stale OS value can't fake a pass.
    await extensionPage.bringToFront();
    await extensionPage.evaluate(() => navigator.clipboard.writeText(''));

    await extensionPage.getByRole('button', { name: 'More' }).press('Enter');
    await extensionPage.getByRole('menuitem', { name: 'Settings' }).click();
    await extensionPage.waitForTimeout(400);
    await extensionPage.getByRole('button', { name: /Simulate new mail/i }).click();
    await extensionPage.waitForTimeout(1_500); // let any (wrong) copy settle

    await extensionPage.bringToFront();
    const clip = await extensionPage.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    expect(clip).not.toBe(GITHUB_OTP);
    await expect(extensionPage.getByText('OTP copied to clipboard')).toHaveCount(0);
  });
});
