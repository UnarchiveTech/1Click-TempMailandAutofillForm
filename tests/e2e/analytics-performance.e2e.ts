/**
 * e2e/analytics-performance.e2e.ts
 *
 * Covers the Activity view's Performance section on the REAL built extension:
 * the averages are aggregated in the background by getPerformanceSummary and
 * returned inside the getAnalytics message response (single source of truth -
 * the view consumes the summary instead of re-deriving the math inline), and
 * the toolbar reset returns the section to its empty state.
 *
 * Run: bun run test:e2e
 */
import { expect, test } from './fixtures';

const ANALYTICS_SEED = {
  activityEvents: [
    {
      id: 'e2e-reset-sentinel',
      type: 'hard_reset' as const,
      timestamp: 1,
      data: {},
    },
  ],
  analytics: {
    createdAt: Date.now(),
    accountsCreated: 3,
    emailsReceived: 5,
    otpsDetected: 2,
    notificationsSent: 1,
    extensionOpens: 4,
    emailsRead: 2,
    pageVisits: { mailbox: 1 },
    performance: {
      emailFetchTimes: [100, 200, 300],
      providerLatency: { gmail: [400, 600], outlook: [100] },
      uiRenderTimes: [50, 150],
    },
  },
};

function activityNavButton(page: import('playwright').Page) {
  return page.locator('.sidebar-nav [data-sidebar-destination]', {
    has: page.locator('span.truncate', { hasText: 'Activity' }),
  });
}

test.describe('Activity view - performance summary', () => {
  test('shows the background-computed averages for seeded samples', async ({
    sidepanelPage: page,
  }) => {
    await page.evaluate(
      (seed) =>
        new Promise<void>((resolve) => {
          chrome.storage.local.set(seed, () => resolve());
        }),
      ANALYTICS_SEED
    );

    await activityNavButton(page).click();
    const section = page.locator('#activity-section-performance');
    await expect(section).toBeVisible({ timeout: 10_000 });

    const body = await section.innerText();
    // avg(100, 200, 300) = 200ms email fetch (localized as "200 ms")
    expect(body).toContain('200 ms');
    // avg(50, 150) = 100ms UI render, and outlook avg([100]) = 100ms
    expect(body).toContain('100 ms');
    // avg(400, 600) = 500ms gmail latency
    expect(body).toContain('500 ms');
  });

  test('reset returns the performance section to its empty state', async ({
    sidepanelPage: page,
  }) => {
    await page.evaluate(
      (seed) =>
        new Promise<void>((resolve) => {
          chrome.storage.local.set(seed, () => resolve());
        }),
      ANALYTICS_SEED
    );

    await activityNavButton(page).click();
    const section = page.locator('#activity-section-performance');
    await expect(section).toBeVisible({ timeout: 10_000 });
    await expect(section).toContainText('200 ms', { timeout: 10_000 });

    // Toolbar reset → ConfirmDialog. The view passes `confirmLabel:
    // $t('common.reset')` and the dialog aligns its accessible name with the
    // visible label, so the confirm button is named 'Reset' - scoped to the
    // dialog, since the toolbar's own button contains the same word.
    await page.getByRole('button', { name: 'Reset Activity' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const confirmButton = page.getByRole('dialog').getByRole('button', { name: 'Reset' });
    const originalButton = await confirmButton.elementHandle();
    // Dialog visit tracking updates analytics itself. A refresh must preserve
    // this exact control, rather than replacing the dialog with a skeleton.
    await page.evaluate(async () => {
      const { analytics } = await chrome.storage.local.get('analytics');
      await chrome.storage.local.set({ analytics: { ...analytics, emailsReceived: 6 } });
    });
    await expect(page.locator('#activity-section-visual')).toContainText('6');
    expect(await originalButton?.evaluate((button) => button.isConnected)).toBe(true);
    await confirmButton.click();
    await originalButton?.dispose();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect
      .poll(async () => {
        const stored = await page.evaluate(
          () =>
            new Promise<{
              analytics?: { performance?: { emailFetchTimes?: number[] } };
              activityEvents?: Array<{ id?: string }>;
            }>((resolve) => {
              chrome.storage.local.get(
                ['analytics', 'activityEvents'],
                (result: {
                  analytics?: { performance?: { emailFetchTimes?: number[] } };
                  activityEvents?: Array<{ id?: string }>;
                }) => resolve(result)
              );
            })
        );
        return {
          sentinelRemains: (stored.activityEvents ?? []).some(
            (event) => event.id === 'e2e-reset-sentinel'
          ),
          emailFetchTimes: stored.analytics?.performance?.emailFetchTimes ?? null,
        };
      })
      .toEqual({ sentinelRemains: false, emailFetchTimes: [] });

    // Empty performance → the card is replaced by the N/A empty state.
    await expect(section).toContainText('N/A', { timeout: 10_000 });
    await expect(section).not.toContainText('200 ms');
  });
});

test('Activity grids adapt to pane width beyond two columns without overflowing', async ({
  sidepanelPage: page,
}) => {
  await page.evaluate((seed) => chrome.storage.local.set(seed), ANALYTICS_SEED);
  await page.setViewportSize({ width: 360, height: 820 });
  await page.goto(page.url().replace(/sidepanel\.html.*/, 'sidepanel.html?view=analytics'));
  const charts = page.locator('[data-activity-grid="charts"]');
  await expect(charts).toBeVisible();
  const report = () =>
    charts.evaluate((grid) => {
      const box = grid.getBoundingClientRect();
      const children = Array.from(grid.children).map((child) => ({
        full: child.classList.contains('activity-full-row'),
        box: child.getBoundingClientRect(),
      }));
      return {
        columns: new Set(
          children.filter((child) => !child.full).map((child) => Math.round(child.box.left))
        ).size,
        contained: children.every(
          (child) => child.box.left >= box.left - 1 && child.box.right <= box.right + 1
        ),
        readable: children
          .filter((child) => !child.full)
          .every((child) => child.box.width >= Math.min(320, box.width) - 1),
        fullWidth:
          children.filter((child) => child.full).length === 1 &&
          children
            .filter((child) => child.full)
            .every((child) => Math.abs(child.box.width - box.width) < 1),
      };
    });
  expect(await report()).toEqual({ columns: 1, contained: true, readable: true, fullWidth: true });
  await page.setViewportSize({ width: 1800, height: 1000 });
  await expect(page.locator('.sidebar-nav')).toBeVisible();
  await expect.poll(async () => (await report()).columns).toBeGreaterThan(2);
  expect(await report()).toMatchObject({ contained: true, readable: true, fullWidth: true });
  // Leave room below the three-column boundary in every engine. At 1220px
  // Firefox's overlay scrollbar leaves exactly 984px (3 × 320px + 2 × 12px).
  await page.setViewportSize({ width: 1180, height: 820 });
  // ResizeObserver-driven fitting settles after setViewportSize returns. Do
  // not compare the collapsed layout against stale columns from 1800px.
  await expect.poll(async () => (await report()).columns).toBe(2);
  const expanded = (await report()).columns;
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await expect.poll(async () => (await report()).columns).toBeGreaterThan(expanded);
  expect(await report()).toMatchObject({ contained: true, readable: true, fullWidth: true });
});
