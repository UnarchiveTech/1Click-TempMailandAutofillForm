import { expect, test } from './fixtures';

test('ordinary links open and media links stay separate from attachments', async ({
  extensionPage: page,
  context,
}, info) => {
  await page.setViewportSize({ width: 360, height: 600 });
  await page.evaluate(async () => {
    await chrome.storage.local.set({
      'storedEmailsByAddress_demo-inbox-1': [
        {
          id: 'links-fixture',
          from: 'mail@example.com',
          subject: 'Your documents',
          body_html:
            '<a href="https://api.guerrillamail.com/__e2e__/ordinary">Account</a><img src="https://api.guerrillamail.com/__e2e__/photo.png"><a href="https://api.guerrillamail.com/__e2e__/receipt.pdf">Receipt</a>',
          received_at: Date.now(),
          original_inbox: 'demo.user@example.com',
          attachments: [
            {
              filename: 'receipt.pdf',
              mimeType: 'application/pdf',
              downloadUrl: 'https://api.guerrillamail.com/__e2e__/receipt.pdf',
            },
          ],
        },
      ],
    });
  });
  await page.reload();
  await page.locator('#email-button-links-fixture').click();
  const header = page.locator('[data-message-header]');
  await header.getByRole('button', { name: 'Links in this email (1)', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('[data-email-link]')).toHaveCount(1);
  await expect(dialog).toContainText('Account');
  await context.route('https://api.guerrillamail.com/__e2e__/ordinary', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Ordinary destination</h1>' })
  );
  const opened = context.waitForEvent('page');
  await dialog.getByRole('button', { name: 'Open link', exact: true }).click();
  const destination = await opened;
  await expect(destination).toHaveURL('https://api.guerrillamail.com/__e2e__/ordinary');
  await destination.close();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await header.getByRole('button', { name: 'Media links', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Media links');
  await expect(page.getByRole('dialog').locator('[data-email-link]')).toHaveCount(1);
  await expect(page.getByRole('dialog')).toContainText('/photo.png');
  await expect(page.getByRole('dialog')).not.toContainText('receipt.pdf');
  await page.screenshot({ path: info.outputPath('media-links.png'), animations: 'disabled' });
});

test('site choices enforce permanent, tab-only and denied access; renewal is a full primary border', async ({
  extensionPage: page,
  context,
}, info) => {
  page.on('pageerror', (error) => console.error('Consent fixture page error:', error.message));
  await page.setViewportSize({ width: 360, height: 640 });
  const website = await context.newPage();
  const url = 'https://api.guerrillamail.com/__e2e__/consent';
  await website.route('https://api.guerrillamail.com/__e2e__/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body>Consent test</body></html>',
    })
  );
  await website.goto(url);
  await website.bringToFront();
  await page.evaluate(async () => {
    const stored = await chrome.storage.local.get('addresses');
    await chrome.storage.local.set({
      addresses: stored.addresses.map((address: Record<string, unknown>) => ({
        ...address,
        provider: 'guerrilla',
        autoExtend: true,
        createdAt: Date.now() - 3500000,
        expiresAt: Date.now() + 100000,
      })),
      stripsEdgeCollapsed: false,
    });
  });
  await page.reload();
  if (await page.getByText('Error details', { exact: true }).isVisible()) {
    await page.getByText('Error details', { exact: true }).click();
    throw new Error(await page.locator('#app').innerText());
  }
  const accessTab = page
    .locator('[data-strip-dock]')
    .getByRole('tab', { name: 'Site access', exact: true });
  await expect(accessTab)
    .toBeVisible({ timeout: 5000 })
    .catch(async () => {
      const details = page.getByText('Error details', { exact: true });
      if (await details.isVisible()) await details.click();
      throw new Error(await page.locator('body').innerText());
    });
  await accessTab.click();
  const strip = page.locator('.bottom-strip-webmcp');
  const tabId = await page.evaluate(
    async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id
  );
  if (typeof tabId !== 'number') throw new Error('Missing website tab');
  const readTool = () =>
    page.evaluate(async (id) => {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: id },
        func: async () =>
          chrome.runtime.sendMessage({ type: 'webmcpTool', tool: 'get_active_email', args: {} }),
      });
      return result.result;
    }, tabId);
  await strip.getByRole('button', { name: 'Allow once', exact: true }).click();
  await expect(strip.getByRole('button', { name: 'Allow once', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  expect((await readTool()).success).toBe(true);
  await page.screenshot({ path: info.outputPath('site-access.png'), animations: 'disabled' });
  const border = page.locator('.account-selector-outer');
  await expect(border.locator('path.track')).toHaveAttribute('stroke-opacity', '0');
  await expect(border.locator('path.progress')).toHaveAttribute('stroke', 'var(--md-primary)');
  const dash = await border.locator('path.progress').getAttribute('stroke-dasharray');
  const trackDash = await border.locator('path.track').getAttribute('stroke-dasharray');
  const progressParts = (dash || '').split(' ').map(Number);
  const trackParts = (trackDash || '').split(' ').map(Number);
  expect(progressParts).toHaveLength(2);
  expect(trackParts).toHaveLength(2);
  expect(progressParts[0]).toBeCloseTo(trackParts[0], 10);
  expect(progressParts[1]).toBeCloseTo(trackParts[1], 10);
  await website.goto(`${url}?navigation=1`);
  await expect.poll(async () => (await readTool()).success).toBe(false);
  await strip.getByRole('button', { name: 'Allow all', exact: true }).click();
  // The old URL is no longer current: stale consent controls must fail visibly.
  await expect(page.getByText('Operation failed', { exact: false }).first()).toBeVisible();
  await website.bringToFront();
  await page.reload();
  await page
    .locator('[data-strip-dock]')
    .getByRole('tab', { name: 'Site access', exact: true })
    .click();
  await strip.getByRole('button', { name: 'Allow once', exact: true }).click();
  await expect(strip.getByRole('button', { name: 'Allow once', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  expect((await readTool()).success).toBe(true);
  await website.reload();
  await expect.poll(async () => (await readTool()).success).toBe(false);
  await strip.getByRole('button', { name: 'Allow all', exact: true }).click();
  await expect(strip.getByRole('button', { name: 'Allow all', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  expect((await readTool()).success).toBe(true);
  await strip.getByRole('button', { name: 'Never', exact: true }).click();
  await expect(strip.getByRole('button', { name: 'Never', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  expect((await readTool()).success).toBe(false);
  await strip.getByRole('button', { name: 'Allow once', exact: true }).click();
  await expect(strip.getByRole('button', { name: 'Allow once', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await website.close();
  await expect
    .poll(() =>
      page.evaluate(
        async (id) => (await chrome.storage.session.get(`webmcpOnce_${id}`))[`webmcpOnce_${id}`],
        tabId
      )
    )
    .toBeUndefined();
});
