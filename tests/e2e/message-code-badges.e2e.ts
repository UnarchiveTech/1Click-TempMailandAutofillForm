import { expect, test } from './fixtures';
import { extensionUrl } from './preview-harness';
import { demoSeedStorage } from './seed';

test('message badges distinguish verification, uncertain codes, coupons and reminders', async ({
  context,
  extensionId,
}, info) => {
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 360, height: 600 });
    await page.goto(extensionUrl(extensionId, 'popup.html'));
    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'getAddresses' }));
    const seed = demoSeedStorage();
    const rows = [
      {
        id: 'supported',
        subject: 'Your verification code: 482901',
        body_plain: 'Your verification code: 482901',
        otp: '482901',
      },
      { id: 'uncertain', subject: 'Unlabelled message', body_plain: '654321', otp: '654321' },
      { id: 'coupon', subject: 'Special offer', body_plain: 'Coupon code: SAVE20', otp: 'SAVE20' },
      {
        id: 'reminder',
        subject: 'Appointment reminder',
        body_plain: '20th November 2026, 5 pm - 6 pm',
        otp: '2026',
      },
    ].map((row, index) => ({
      ...row,
      from: 'mail@example.com',
      received_at: Math.floor(Date.now() / 1000) - index,
      original_inbox: 'demo.user@example.com',
    }));
    await page.evaluate((data) => chrome.storage.local.set(data), {
      ...seed,
      locale: 'en',
      preferredLanguage: 'en',
      'storedEmailsByAddress_demo-inbox-1': rows,
    });
    await page.reload();
    const supported = page.locator('#email-item-supported');
    await expect(supported.locator('#otp-badge-supported')).toContainText('OTP: 482901');
    await expect(supported.locator('[data-otp-uncertain]')).toHaveCount(0);
    const uncertain = page.locator('#email-item-uncertain [data-otp-uncertain]');
    await expect(uncertain).toContainText('OTP: 654321');
    await expect(uncertain.locator('svg')).toHaveCount(1);
    await expect(uncertain).toHaveAttribute('aria-label', /Possible OTP/);
    const coupon = page.locator('#email-item-coupon');
    await expect(coupon.locator('[data-coupon-badge]')).toContainText('Coupon: SAVE20');
    const ticket = coupon.locator('[data-coupon-badge] svg');
    await expect(ticket).toHaveCSS('width', '14px');
    await expect(ticket).toHaveCSS('height', '14px');
    await expect(coupon.locator('[id^="otp-badge-"]')).toHaveCount(0);
    const reminder = page.locator('#email-item-reminder');
    await expect(reminder).toContainText('Reminder');
    await expect(reminder.locator('[id^="otp-badge-"]')).toHaveCount(0);
    const collapse = page.getByRole('button', {
      name: 'Collapse strips',
      exact: true,
    });
    if (await collapse.isVisible()) await collapse.click();
    await expect(page.locator('[data-strip-dock-content]')).not.toBeVisible();
    await uncertain.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath('message-badges-popup.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await reminder.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath('message-reminder-popup.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await page.locator('#email-button-coupon').click();
    await expect(page.locator('[data-coupon-badge]')).toContainText('Coupon: SAVE20');
    await page.screenshot({
      path: info.outputPath('message-coupon-detail.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.locator('#email-button-uncertain').press('Enter');
    await expect(page.locator('[data-message-header] [data-otp-uncertain]')).toContainText(
      'OTP: 654321'
    );
    await page.screenshot({
      path: info.outputPath('message-uncertain-detail.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.locator('#email-button-reminder').press('Enter');
    await expect(
      page.locator('[data-message-header]').getByText('Reminder', { exact: true })
    ).toBeVisible();
    await expect(page.locator('[data-message-header] [data-otp-uncertain]')).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath('message-reminder-detail.png'),
      fullPage: true,
      animations: 'disabled',
    });
  } finally {
    await page.close();
  }
});
