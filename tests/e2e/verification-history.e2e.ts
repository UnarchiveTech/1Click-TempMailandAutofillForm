import { expect, test } from './fixtures';
import { extensionUrl } from './preview-harness';
import { demoSeedStorage } from './seed';

test('inline verification groups retain recipients and support keyboard switching', async ({
  context,
  extensionId,
}, info) => {
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 360, height: 600 });
    await page.goto(extensionUrl(extensionId, 'popup.html'));
    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'getAddresses' }));
    const seed = demoSeedStorage();
    const now = Date.now();
    const messages = [0, 1, 2, 3].map((offset) => ({
      id: `github-${offset}`,
      from: 'security@github.com',
      from_name: 'GitHub',
      subject: 'Verification',
      body_plain: `Your verification code: 12345${offset}`,
      received_at: now - (4 - offset) * 60_000,
      otp: `12345${offset}`,
      original_inbox: 'demo.user@example.com',
    }));
    await page.evaluate((data) => chrome.storage.local.set(data), {
      ...seed,
      locale: 'en',
      preferredLanguage: 'en',
      verificationPreferences: { maxAgeMinutes: 30, grouping: 'address' },
      addresses: [
        ...seed.addresses,
        { ...seed.addresses[0], id: 'second', address: 'second@example.com' },
      ],
      emailStorageAddressIndex: { ...seed.emailStorageAddressIndex, second: 'second@example.com' },
      'storedEmailsByAddress_demo-inbox-1': messages,
      storedEmailsByAddress_second: [
        {
          ...messages[3],
          id: 'other',
          subject: 'Second inbox source',
          otp: '654321',
          body_plain: 'Your verification code: 654321',
          original_inbox: 'second@example.com',
        },
      ],
    });
    await page.reload();
    const strip = page.locator('#verification-strip');
    await strip
      .getByRole('button', { name: 'Expand verification details', exact: true })
      .press('Enter');
    const history = strip.locator('[data-verification-history]');
    await expect(history.locator('[data-verification-item]')).toHaveCount(2);
    await page.screenshot({
      path: info.outputPath('verification-current.png'),
      animations: 'disabled',
    });
    await history
      .getByRole('button', { name: 'Show earlier and expired items', exact: true })
      .click();
    await expect(history.locator('[data-verification-item]')).toHaveCount(5);
    await expect(history.locator('[data-verification-group]')).toHaveCount(2);
    await expect(
      history.locator('[data-verification-group]').first().locator('[data-verification-item]')
    ).toHaveCount(4);
    await history.getByRole('button', { name: 'By website', exact: true }).press('Enter');
    await expect(history.locator('[data-verification-group]')).toHaveCount(1);
    await expect(history.locator('h4')).toHaveCount(2);
    await expect(history.locator('h4').filter({ hasText: 'second@example.com' })).toBeVisible();
    const group = history.locator('[data-verification-group]').first();
    await group.locator('summary').press('Enter');
    await expect(group.locator('[data-verification-item]').first()).not.toBeVisible();
    await group.locator('summary').press('Enter');
    await expect(group.locator('[data-verification-item]').first()).toBeVisible();
    await page.screenshot({
      path: info.outputPath('verification-history.png'),
      animations: 'disabled',
    });
    await expect(history.getByRole('button', { name: 'By website', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await chrome.storage.local.get('verificationPreferences')).verificationPreferences
              .grouping
        )
      )
      .toBe('website');
    expect(
      await history.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
    ).toBe(true);
    await page.reload();
    await strip
      .getByRole('button', { name: 'Expand verification details', exact: true })
      .press('Enter');
    await expect(history.getByRole('button', { name: 'By website', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await history
      .locator('[data-verification-item]')
      .filter({ hasText: '654321' })
      .getByRole('button', { name: 'Open source message', exact: true })
      .press('Enter');
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await chrome.storage.local.get('activeAddressId')).activeAddressId
        )
      )
      .toBe('second');
    await expect(page.getByText('Second inbox source', { exact: true }).first()).toBeVisible();
  } finally {
    await page.close();
  }
});

test('a newer expired code cannot revive an earlier code; the time limit can be changed', async ({
  extensionPage,
}) => {
  const page = extensionPage;
  const now = Date.now();
  await page.evaluate(
    (now) =>
      chrome.storage.local.set({
        verificationPreferences: { maxAgeMinutes: 30, grouping: 'address' },
        'storedEmailsByAddress_demo-inbox-1': [
          {
            id: 'older',
            from: 'security@github.com',
            received_at: now - 20 * 60_000,
            otp: '111111',
            body_plain: 'Your verification code: 111111',
            otpExpiresAt: now + 40 * 60_000,
          },
          {
            id: 'newer',
            from: 'security@github.com',
            received_at: now - 10 * 60_000,
            otp: '222222',
            body_plain: 'Your verification code: 222222',
            otpExpiresAt: now + 5 * 60_000,
          },
        ],
      }),
    now
  );
  await page.reload();
  await expect(page.locator('#button-copy-current-otp')).toHaveText('222222');
  await page.clock.setSystemTime(now + 6 * 60_000);
  await expect(page.locator('#button-copy-current-otp')).toHaveCount(0);
  const strip = page.locator('#verification-strip');
  await strip
    .getByRole('button', { name: 'Expand verification details', exact: true })
    .press('Enter');
  await strip.getByRole('button', { name: 'Show earlier and expired items', exact: true }).click();
  await expect(
    strip.locator('[data-verification-item]').filter({ hasText: '111111' })
  ).toHaveAttribute('data-status', 'earlier');
  await expect(
    strip.locator('[data-verification-item]').filter({ hasText: '222222' })
  ).toHaveAttribute('data-status', 'expired');
  await page.clock.setSystemTime(Date.now());
  await page.evaluate(() =>
    chrome.storage.local.set({ openView: 'settings', openViewAt: Date.now() })
  );
  const limit = page.locator('#verification-time-limit');
  await limit.fill('15');
  await limit.press('Enter');
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await chrome.storage.local.get('verificationPreferences')).verificationPreferences
            .maxAgeMinutes
      )
    )
    .toBe(15);
});
