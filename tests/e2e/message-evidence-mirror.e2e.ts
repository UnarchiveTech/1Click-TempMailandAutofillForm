import { expect, test } from './fixtures';

const negativeCases = [
  { id: 'phone-area', body: '<p>Tel: (123) 4567</p>', oldOtp: '1234567' },
  { id: 'spanish-hours', body: '<div>24 horas</div>', oldOtp: '24horas' },
  { id: 'english-months', body: '<div>18 months</div>', oldOtp: '18months' },
  { id: 'numeric-duration', body: '<div>1234 segundos</div>', oldOtp: '1234' },
  { id: 'phone-short', body: '<p>Phone: 123456</p>', oldOtp: '123456' },
  { id: 'phone-spanish', body: '<p>Teléfono: 12345678</p>', oldOtp: '12345678' },
  { id: 'phone-international', body: '<div>Call us: +1 (202) 555-0199</div>', oldOtp: '5550199' },
  { id: 'phone-groups', body: '<div>Phone: 020 1234 5678</div>', oldOtp: '12345678' },
  { id: 'tel-anchor', body: '<a href="tel:123456"><span>123456</span></a>', oldOtp: '123456' },
];

test('duration and telephone corpus is rejected in stored results and both message surfaces', async ({
  extensionPage: page,
}) => {
  await page.evaluate(async (cases) => {
    await chrome.storage.local.set({
      threadGrouping: false,
      locale: 'en',
      preferredLanguage: 'en',
      stripsEdgeCollapsed: true,
      'storedEmailsByAddress_demo-inbox-1': [
        ...cases.map((item, index) => ({
          id: item.id,
          subject: `Verification notice ${item.id}`,
          body_html: item.body,
          otp: item.oldOtp,
          from: 'mail@example.com',
          received_at: Date.now() - index * 1000,
          original_inbox: 'demo.user@example.com',
        })),
        {
          id: 'genuine',
          subject: 'Your verification code',
          body_html: '<a href="tel:482901">482901</a><p>Your verification code: 482901</p>',
          otp: '482901',
          from: 'security@example.com',
          received_at: Date.now() - 20_000,
          original_inbox: 'demo.user@example.com',
        },
      ],
    });
    const result = await chrome.runtime.sendMessage({
      type: 'rescanEmailsForDetection',
      includeArchived: true,
    });
    if (!result?.success) throw new Error('Detection rescan failed');
  }, negativeCases);
  const persisted = await page.evaluate(
    async () =>
      (await chrome.storage.local.get('storedEmailsByAddress_demo-inbox-1'))[
        'storedEmailsByAddress_demo-inbox-1'
      ]
  );
  for (const item of negativeCases) {
    const result = persisted.find((message: { id: string }) => message.id === item.id);
    expect(result.otp).toBeNull();
    expect(result.otpCandidate).toBeNull();
  }
  expect(persisted.find((message: { id: string }) => message.id === 'genuine').otp).toBe('482901');
  await page.reload();
  for (const item of negativeCases) {
    const row = page.locator(`#email-item-${item.id}`);
    await expect(row).toHaveCount(1);
    await expect(row.locator('[id^="otp-badge-"]')).toHaveCount(0);
    await page.locator(`#email-button-${item.id}`).click();
    await expect(page.locator('[data-message-header] [data-otp-uncertain]')).toHaveCount(0);
    await expect(page.locator('[data-message-header]')).not.toContainText('OTP:');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
  }
  await expect(page.locator('#otp-badge-genuine')).toContainText('482901');
});

test('Deal badge is classified separately and Unsubscribe appears only in details and opens sender flow', async ({
  extensionPage: page,
  context,
}, info) => {
  const unsubscribeUrl = 'http://localhost:5173/demo/unsubscribe-test.html?token=test-token';
  await page.setViewportSize({ width: 360, height: 640 });
  await page.evaluate(async (url) => {
    await chrome.storage.local.set({
      locale: 'en',
      preferredLanguage: 'en',
      stripsEdgeCollapsed: true,
      threadGrouping: false,
      'storedEmailsByAddress_demo-inbox-1': [
        {
          id: 'offer',
          subject: 'Oferta especial',
          body_html: `<p>20% de descuento durante 24 horas</p><a href="${url}">Darse de baja</a>`,
          from: 'offers@example.com',
          received_at: Date.now(),
          original_inbox: 'demo.user@example.com',
        },
      ],
    });
    const result = await chrome.runtime.sendMessage({
      type: 'rescanEmailsForDetection',
      includeArchived: true,
    });
    if (!result?.success) throw new Error('Detection rescan failed');
  }, unsubscribeUrl);
  await page.reload();
  const row = page.locator('#email-item-offer');
  await expect(row.locator('.message-deal-badge')).toHaveText('Deal');
  await expect(page.locator('[data-unsubscribe-badge]')).toHaveCount(0);
  await expect(row.locator('[id^="otp-badge-"]')).toHaveCount(0);
  await page.locator('#email-button-offer').click();
  const header = page.locator('[data-message-header]');
  await expect(header.locator('.message-deal-badge')).toHaveText('Deal');
  const unsubscribe = header.getByRole('button', { name: 'Unsubscribe', exact: true });
  await expect(unsubscribe).toHaveAttribute('title', /sender may require confirmation/);
  await page.screenshot({ path: info.outputPath('deal-unsubscribe.png'), animations: 'disabled' });
  const destinationPromise = context.waitForEvent('page');
  await unsubscribe.press('Enter');
  const destination = await destinationPromise;
  await expect(destination).toHaveURL(unsubscribeUrl);
  await expect(destination.getByRole('heading', { name: 'Confirm unsubscribe' })).toBeVisible();
  await destination.close();
  await expect(page.getByText('Unsubscribed', { exact: true })).toHaveCount(0);
});
