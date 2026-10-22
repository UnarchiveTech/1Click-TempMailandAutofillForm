import { expect, test } from './fixtures';

test.afterEach(async ({ sidepanelPage: page }, info) => {
  if (info.status !== info.expectedStatus) {
    const errors = await page.locator('details pre').allTextContents();
    console.log('Activity browser error details:', errors);
    await info.attach('activity-errors', { body: errors.join('\n'), contentType: 'text/plain' });
  }
});

async function seedActivity(page: import('playwright').Page) {
  await page.evaluate(async () => {
    const now = Date.now();
    await chrome.storage.local.remove(['activityDailyHistory', 'activityDashboard']);
    await chrome.storage.local.set({
      autoRefreshInterval: 0,
      activityEvents: [
        {
          id: 'site-event',
          type: 'auto_fill',
          timestamp: now,
          data: { website: 'github.com', address: 'demo.user@example.com' },
        },
        {
          id: 'message-event',
          type: 'email_received',
          timestamp: now - 60000,
          data: {
            address: 'demo.user@example.com',
            emailId: 'demo-seed-1',
            subject: 'Find this receipt',
            sender: 'GitHub',
          },
        },
        {
          id: 'failure-event',
          type: 'toast_notification',
          timestamp: now - 120000,
          data: {
            message: 'Provider unavailable',
            toastType: 'error',
            provider: 'example-provider',
          },
        },
        {
          id: 'older-event',
          type: 'address_created',
          timestamp: now - 10 * 86400000,
          data: { address: 'old@example.test' },
        },
      ],
    });
  });
  await page.goto(page.url().replace(/sidepanel\.html.*/, 'sidepanel.html?view=analytics'));
  await expect(page.locator('[data-activity-explorer]')).toBeVisible();
}

test('Activity search, failure and date filters retain context during refresh', async ({
  sidepanelPage: page,
}) => {
  await seedActivity(page);
  const explorer = page.locator('[data-activity-explorer]');
  const search = explorer.getByRole('textbox', {
    name: 'Search actions, websites, addresses or providers',
  });
  await search.fill('github');
  await expect(explorer.locator('[data-activity-event]')).toHaveCount(2);
  const samples = () =>
    page.evaluate(
      async () =>
        ((await chrome.storage.local.get('analytics')).analytics?.performance?.uiRenderTimes ?? [])
          .length
    );
  const beforeRefresh = await samples();
  const input = await search.elementHandle();
  await page.evaluate(async () => {
    await chrome.storage.local.set({ autoRefreshInterval: 25 });
  });
  await expect.poll(samples).toBeGreaterThan(beforeRefresh);
  await expect(search).toHaveValue('github');
  expect(await input?.evaluate((element) => element.isConnected)).toBe(true);
  await input?.dispose();
  await page.evaluate(async () => {
    await chrome.storage.local.set({ autoRefreshInterval: 0 });
  });
  await search.fill('example-provider');
  await expect(explorer.locator('[data-activity-event]')).toHaveCount(1);
  await search.fill('');
  await explorer.getByRole('checkbox', { name: 'Failures only' }).check();
  await expect(explorer.locator('[data-activity-event]')).toHaveCount(1);
  await explorer.getByRole('button', { name: 'Event details', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('example-provider');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await explorer.getByRole('checkbox', { name: 'Failures only' }).uncheck();
  await explorer.getByRole('combobox', { name: 'Timeline period' }).click();
  await page.getByRole('option', { name: 'Last 7 days', exact: true }).click();
  await expect(explorer.locator('[data-activity-event]')).toHaveCount(3);
  await explorer.getByRole('combobox', { name: 'Timeline period' }).click();
  await page.getByRole('option', { name: 'Custom dates', exact: true }).click();
  await explorer.getByLabel('From', { exact: true }).fill('2026-12-31');
  await explorer.getByLabel('To', { exact: true }).fill('2026-01-01');
  await expect(explorer).toContainText('End date must not precede start date.');
  await expect(explorer.locator('[data-activity-event]')).toHaveCount(0);
});

test('Activity dashboard hide and order persist and can reset', async ({ sidepanelPage: page }) => {
  await seedActivity(page);
  await page.getByRole('button', { name: 'Customize dashboard', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox').first().uncheck();
  await expect(page.locator('[data-activity-card="timeSaved"]')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Move up', exact: true }).nth(1).click();
  await expect
    .poll(async () =>
      page.evaluate(
        async () => (await chrome.storage.local.get('activityDashboard')).activityDashboard?.[0]?.id
      )
    )
    .toBe('expiry');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  // Reload returns to the default mailbox; the preference belongs to Activity.
  await page.goto(page.url().replace(/sidepanel\.html.*/, 'sidepanel.html?view=analytics'));
  await expect(page.locator('[data-activity-card]').first()).toHaveAttribute(
    'data-activity-card',
    'expiry'
  );
  await expect(page.locator('[data-activity-card="timeSaved"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Customize dashboard', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Reset to defaults', exact: true })
    .click();
  await expect(page.locator('[data-activity-card="timeSaved"]')).toHaveCount(1);
});

test('Activity chart activation filters the timeline with keyboard focus', async ({
  sidepanelPage: page,
}) => {
  await seedActivity(page);
  const firstHour = page.locator('[data-activity-card="hours"] [role="button"]').first();
  await firstHour.focus();
  await page.keyboard.press('Enter');
  const explorer = page.locator('[data-activity-explorer]');
  await expect(explorer.getByRole('button', { name: 'Clear chart filter' })).toBeVisible();
  await expect(
    explorer.getByRole('textbox', { name: 'Search actions, websites, addresses or providers' })
  ).toBeFocused();
  await explorer.getByRole('button', { name: 'Clear chart filter' }).click();
  await expect(explorer.locator('[data-activity-event]')).toHaveCount(4);
});

test('Activity event opens its source message and handles a deleted inbox visibly', async ({
  sidepanelPage: page,
}) => {
  await seedActivity(page);
  await page
    .locator('[data-activity-event="message-event"]')
    .getByRole('button', { name: 'Open message', exact: true })
    .click();
  await expect(
    page.getByText('Your GitHub verification code is 482901.', { exact: false }).first()
  ).toBeVisible();
  await page.goto(page.url().replace(/sidepanel\.html.*/, 'sidepanel.html?view=analytics'));
  await page
    .locator('[data-activity-event="older-event"]')
    .getByRole('button', { name: 'Open inbox', exact: true })
    .click();
  await expect(page.getByText('Address not found', { exact: true }).first()).toBeVisible();
});

test('Activity action rows fit the narrow popup in every supported language', async ({
  sidepanelPage: page,
}) => {
  // Eight cold document/dictionary loads share one case. Keep per-assertion
  // bounds while giving the Firefox/WebKit engine loop its own total budget.
  test.setTimeout(120_000);
  await seedActivity(page);
  await page.setViewportSize({ width: 360, height: 640 });
  for (const language of ['en', 'ar', 'de', 'es', 'fr', 'ja', 'th', 'zh']) {
    await page.evaluate(
      async (language) =>
        chrome.storage.local.set({ preferredLanguage: language, locale: language, language }),
      language
    );
    await page.goto(new URL('popup.html?view=analytics', page.url()).href);
    const explorer = page.locator('[data-activity-explorer]');
    await expect(explorer.locator('[data-activity-event="site-event"]')).toHaveCount(1);
    await page.waitForFunction((language) => document.documentElement.lang === language, language);
    await page.evaluate(() => document.fonts.ready);
    await expect
      .poll(() => explorer.evaluate((node) => node.scrollWidth - node.clientWidth), {
        message: `${language} timeline must fit the popup`,
      })
      .toBeLessThanOrEqual(1);
    const clipped = await explorer
      .locator('[data-activity-event] button.md-action')
      .evaluateAll((buttons) =>
        buttons
          .filter((button) => button.scrollWidth > button.clientWidth + 1)
          .map((button) => button.textContent)
      );
    expect(clipped, `${language} actions must not clip their labels`).toEqual([]);
  }
});

test('Activity website and failure actions navigate to filtered logins and Diagnostics', async ({
  sidepanelPage: page,
}) => {
  await seedActivity(page);
  await page
    .locator('[data-activity-event="site-event"]')
    .getByRole('button', { name: 'View logins', exact: true })
    .click();
  await expect(page.getByRole('textbox').filter({ visible: true }).first()).toHaveValue(
    'github.com'
  );
  await page.goto(new URL('sidepanel.html?view=analytics', page.url()).href);
  await page
    .locator('[data-activity-event="failure-event"]')
    .getByRole('button', { name: 'Diagnostics', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: /^Diagnostics\b/ })).toBeVisible();
});
