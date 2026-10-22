import { mkdir } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const outputDir = process.env.DOCS_SCREENSHOT_DIR || 'docs-site/public/screenshots';
/** Keep documentation captures representative of the real extension popup. */
const POPUP_VIEWPORT = { width: 360, height: 600 } as const;
const SETTLE_MS = 300;

/**
 * Extra demo content seeded ONLY by this suite (fixtures.ts keeps its minimal
 * single-inbox seed so other suites' counts never shift). Applied once via
 * chrome.storage.local.set, then the page reloads - theme switches preserve
 * storage, so one seed covers both light and dark passes.
 */
const RICH_SEED = {
  addresses: [
    {
      id: 'demo-inbox-1',
      address: 'demo.user@example.com',
      provider: 'demo',
      status: 'active',
      accountStatus: 'active',
      autoExtend: true,
      createdAt: Date.now() - 3600_000,
      expiresAt: Date.now() + 86400_000,
      sidToken: 'demo-token-1',
      token: 'demo-token-1',
      tags: [{ name: 'Shopping', color: '#7c4dff' }],
    },
    {
      id: 'demo-inbox-2',
      address: 'checkout.temp@example.com',
      provider: 'demo',
      status: 'active',
      accountStatus: 'active',
      autoExtend: false,
      createdAt: Date.now() - 7200_000,
      expiresAt: Date.now() + 3600_000,
      sidToken: 'demo-token-2',
      token: 'demo-token-2',
      tags: [{ name: 'Trials', color: '#0b8043' }],
    },
  ],
  emailStorageAddressIndex: {
    'demo-inbox-1': 'demo.user@example.com',
    'demo-inbox-2': 'checkout.temp@example.com',
  },
  'storedEmailsByAddress_demo-inbox-1': [
    {
      id: 'demo-seed-1',
      from: 'security@github.com',
      from_name: 'GitHub',
      subject: 'Your verification code',
      body_plain: 'Your GitHub verification code is 482901.',
      body_html: '<p>Your GitHub verification code is 482901.</p>',
      received_at: Date.now() - 60_000,
      unread: true,
      otp: '482901',
      isOtp: true,
      original_inbox: 'demo.user@example.com',
    },
    {
      id: 'demo-seed-2',
      from: 'hello@linear.app',
      from_name: 'Linear',
      subject: 'Sign in to Linear',
      body_plain: 'Click here to sign in: https://linear.app/magic/demo-token-abc',
      body_html:
        '<p>Click <a href="https://linear.app/magic/demo-token-abc">here</a> to sign in.</p>',
      received_at: Date.now() - 300_000,
      unread: true,
      hasMagicLink: true,
      magicLinks: [
        { url: 'https://linear.app/magic/demo-token-abc', label: 'Sign in', score: 0.9 },
      ],
      original_inbox: 'demo.user@example.com',
    },
    {
      id: 'demo-seed-3',
      from: 'receipts@store.example',
      from_name: 'Example Store',
      subject: 'Your order confirmation #4812',
      body_plain: 'Thanks for your order #4812. Total $24.00.',
      body_html: '<p>Thanks for your order <b>#4812</b>. Total $24.00.</p>',
      received_at: Date.now() - 900_000,
      unread: false,
      original_inbox: 'demo.user@example.com',
    },
  ],
  'storedEmailsByAddress_demo-inbox-2': [
    {
      id: 'demo-seed-4',
      from: 'noreply@shop.example',
      from_name: 'Shop',
      subject: 'Your 10% welcome code',
      body_plain: 'Welcome! Your code is WELCOME10.',
      body_html: '<p>Welcome! Your code is <b>WELCOME10</b>.</p>',
      received_at: Date.now() - 120_000,
      unread: true,
      original_inbox: 'checkout.temp@example.com',
    },
  ],
  emailStorageMetadata: {
    'demo-inbox-1': {
      messageCount: 3,
      unreadCount: 2,
      latestReceivedAt: Date.now() - 60_000,
      latestOtpAt: Date.now() - 60_000,
      hasMagicLink: true,
      revision: 2,
    },
    'demo-inbox-2': {
      messageCount: 1,
      unreadCount: 1,
      latestReceivedAt: Date.now() - 120_000,
      latestOtpAt: 0,
      hasMagicLink: false,
      revision: 1,
    },
  },
  readEmails: {},
  activeAddressId: 'demo-inbox-1',
  selectedEmail: 'demo.user@example.com',
  identities: [
    {
      id: 'demo-identity-1',
      name: 'Alex Rivera',
      firstNames: 'Alex',
      lastNames: 'Rivera',
      username: 'alex.rivera92',
      useRandomPassword: true,
      phone: '+1 555-0142',
      preferredEmail: '__random_active__',
      country: 'US',
      city: 'Austin',
      isDefault: true,
      createdAt: Date.now() - 7 * 86400_000,
    },
    {
      id: 'demo-identity-2',
      name: 'Sam Chen',
      firstNames: 'Sam',
      lastNames: 'Chen',
      username: 'sam.chen',
      useRandomPassword: false,
      customPassword: 'DemoPass!234',
      phone: '+1 555-0188',
      preferredEmail: 'demo.user@example.com',
      country: 'US',
      city: 'Seattle',
      isDefault: false,
      createdAt: Date.now() - 2 * 86400_000,
    },
  ],
  selectedIdentityId: 'demo-identity-1',
  loginInfo: [
    {
      id: 'demo-login-1',
      domain: 'github.com',
      timestamp: Date.now() - 86400_000,
      email: 'demo.user@example.com',
      username: 'alex.rivera92',
      password: 'DemoPass!234',
      website: 'https://github.com/signup',
      filledFields: ['email', 'password', 'username'],
      verified: true,
      verifiedAt: Date.now() - 86000_000,
    },
    {
      id: 'demo-login-2',
      domain: 'linear.app',
      timestamp: Date.now() - 3600_000,
      email: 'checkout.temp@example.com',
      username: 'sam.chen',
      password: 'DemoPass!567',
      website: 'https://linear.app/signup',
      filledFields: ['email', 'password'],
      verified: false,
    },
  ],
  activityEvents: [
    {
      id: 'demo-act-1',
      type: 'address_created',
      timestamp: Date.now() - 3600_000,
      data: { address: 'demo.user@example.com' },
    },
    {
      id: 'demo-act-2',
      type: 'email_received',
      timestamp: Date.now() - 300_000,
      data: {
        address: 'demo.user@example.com',
        sender: 'Linear',
        subject: 'Sign in to Linear',
      },
    },
    {
      id: 'demo-act-3',
      type: 'otp_detected',
      timestamp: Date.now() - 60_000,
      data: {
        address: 'demo.user@example.com',
        sender: 'GitHub',
        otp: '482901',
      },
    },
    {
      id: 'demo-act-4',
      type: 'auto_fill',
      timestamp: Date.now() - 30_000,
      data: { website: 'github.com', address: 'demo.user@example.com' },
    },
  ],
  // NOTE: catalog entries use `tag` (not `name`) - see CatalogTag in
  // OrganizeView.svelte. A `{name,…}` entry leaves `c.tag` undefined and the
  // tag-group render crashes the app into the error boundary.
  mailboxTagCatalog: [
    { tag: 'Shopping', color: '#7c4dff' },
    { tag: 'Trials', color: '#0b8043' },
  ],
  // fixtures.ts seeds `demoMode: true` into every test page - that puts the
  // "Exit demo mode" pill over every capture. Docs shots want the clean
  // production chrome, so force it off here. The seeded `provider: 'demo'`
  // addresses still resolve offline (callers check the provider as well as the
  // flag), and no surprise simulated mail arrives mid-capture.
  demoMode: false,
  // ActivityView counters come from the `analytics` record via getAnalytics -
  // without it the Activity shot is all zeros despite the seeded events above.
  analytics: {
    createdAt: Date.now() - 7 * 86400_000,
    accountsCreated: 2,
    emailsReceived: 4,
    otpsDetected: 1,
    notificationsSent: 3,
    extensionOpens: 12,
    emailsRead: 3,
    pageVisits: { mailbox: 9, addresses: 4, autofill: 3 },
    // Non-empty timings so the Activity Performance section captures with
    // charts instead of an empty state.
    performance: {
      emailFetchTimes: [180, 240, 210, 260],
      providerLatency: { demo: [320, 290, 310] },
      uiRenderTimes: [18, 22, 16, 20],
    },
  },
  // One mailbox rule so the Automation hub (default Mailbox tab) captures with
  // content instead of an empty state. Shape = MailboxRule (mailbox-rules.ts).
  mailboxRules: [
    {
      id: 'demo-rule-1',
      name: 'Silence store promos',
      enabled: true,
      field: 'sender',
      contains: 'store.example',
      silenceNotifications: true,
      createdAt: Date.now() - 2 * 86400_000,
      updatedAt: Date.now() - 2 * 86400_000,
    },
  ],
  // Label catalog + one saved search so the Organize Labels/Filters tabs
  // capture with content. Shapes: EmailLabelDef / SavedSearchFilter.
  emailLabelCatalog: [
    { name: 'Receipts', color: '#0b8043' },
    { name: 'Security', color: '#d32f2f' },
  ],
  savedSearchFilters: [
    {
      id: 'demo-filter-1',
      name: 'OTP only',
      searchQuery: '',
      hasOTP: true,
      senderDomain: '',
      selectedSenders: [],
      dateFrom: '',
      dateTo: '',
      createdAt: Date.now() - 86400_000,
    },
  ],
  // One site rule so the Automation Site rules tab captures with content.
  // Shape = SiteRule (features/intelligence/site-rules.ts).
  siteRules: [
    {
      id: 'demo-site-1',
      name: 'GitHub uses Alex Rivera',
      enabled: true,
      domainPattern: 'github.com',
      identityId: 'demo-identity-1',
      createdAt: Date.now() - 86400_000,
      updatedAt: Date.now() - 86400_000,
    },
  ],
};

/**
 * Go to a navbar destination: primary button first, More overflow fallback.
 * Both lookups stay scoped to Main navigation - a global button fallback is
 * banned here: content buttons (e.g. "Autofill entire form") start with nav
 * labels and a loose match would click into content instead of navigating.
 */
async function openNavItem(page: Page, label: string): Promise<void> {
  // A previous view may have tripped the global error boundary (nav gone).
  // Reload to a healthy mailbox rather than hanging on a missing More button.
  if (
    await page
      .getByText('Something went wrong')
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    await page.reload();
    await page.waitForSelector('#app > *', { timeout: 10_000 });
    await page.waitForTimeout(SETTLE_MS);
  }
  const mainNav = page.getByRole('navigation', { name: 'Main navigation' });
  const direct = mainNav.getByRole('button', { name: new RegExp(label, 'i') }).first();
  if (await direct.isVisible().catch(() => false)) {
    await direct.click();
    return;
  }
  const more = mainNav.getByRole('button', { name: 'More' }).first();
  await expect(more).toBeVisible();
  // The compact navbar opens More when the More button is activated. Its click-away layer covers the
  // trigger after opening, so test the actual supported keyboard-to-menu path.
  await more.press('Enter');
  const menuItem = page.getByRole('menuitem', { name: new RegExp(label, 'i') });
  await expect(menuItem).toBeVisible();
  await menuItem.click();
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((themeName) => {
    return new Promise<void>((resolve) => {
      chrome.storage.local.set({ themeMode: themeName, contrastLevel: 'standard' }, () =>
        resolve()
      );
    });
  }, theme);
  await page.reload();
  await page.waitForSelector('#app > *', { timeout: 10_000 });
  await page.waitForTimeout(SETTLE_MS);
}

async function capture(page: Page, name: string, directory: string): Promise<void> {
  await expect(page.locator('#app > *').first()).toBeVisible();
  await page.screenshot({ path: `${directory}/${name}.png`, fullPage: false });
}

/** Smooth-scroll settle for ScrollSpy chip navigation (behavior: 'smooth'). */
const SCROLL_SETTLE_MS = 700;

/**
 * Click a Tabs-pill tab by label (Organize / Automation hubs use role="tab").
 * Scoped to tab roles only - never falls through to content buttons.
 */
async function clickTab(page: Page, label: string): Promise<void> {
  const tab = page.getByRole('tab', { name: new RegExp(label, 'i') }).first();
  if (await tab.isVisible().catch(() => false)) {
    await tab.click();
    await page.waitForTimeout(SETTLE_MS);
  }
}

/**
 * Jump a ScrollSpy view (Activity, Settings) to a section via its own chip -
 * the component's scroll math handles sticky offsets; we just wait out the
 * smooth scroll before capturing.
 */
async function spyTo(page: Page, sectionId: string): Promise<void> {
  const chip = page.locator(`[data-spy-id="${sectionId}"]`).first();
  if (await chip.isVisible().catch(() => false)) {
    await chip.click();
    await page.waitForTimeout(SCROLL_SETTLE_MS);
  }
}

/**
 * Error-boundary watchdog. If the app crashed (global boundary replaces the
 * whole shell incl. nav), record the view, dump the page error for diagnosis,
 * reload to a healthy mailbox, and let the suite continue with the next view -
 * one crashing view must never cost all 38 screenshots or time out the run.
 */
async function recoverIfCrashed(
  page: Page,
  viewName: string,
  crashedViews: string[],
  pageErrors: string[]
): Promise<void> {
  const boundary = page.getByText('Something went wrong').first();
  if (!(await boundary.isVisible().catch(() => false))) return;
  crashedViews.push(viewName);
  console.log(
    `[docs-screenshots] error boundary on "${viewName}". Recent pageerrors: ${JSON.stringify(pageErrors.slice(-3))}`
  );
  await page.reload();
  await page.waitForSelector('#app > *', { timeout: 10_000 });
  await page.waitForTimeout(SETTLE_MS);
}

async function goBack(page: Page): Promise<void> {
  const back = page.getByRole('button', { name: 'Back' }).first();
  if (await back.isVisible().catch(() => false)) {
    await back.click();
    await page.waitForTimeout(SETTLE_MS);
  }
}

test.describe('Documentation screenshots', () => {
  test('captures every docs view in light and dark themes', async ({ extensionPage }, testInfo) => {
    // 38 captures (19 per theme incl. hub tabs + scrolled sections) + reloads -
    // far beyond the 30s global default.
    test.setTimeout(300_000);
    const directory = testInfo.project.metadata.preview
      ? testInfo.outputPath('docs-screenshots')
      : outputDir;
    await mkdir(directory, { recursive: true });
    await extensionPage.setViewportSize(POPUP_VIEWPORT);

    // Rich seed (this suite only) - fixtures.ts stays minimal for other suites.
    await extensionPage.evaluate((seed) => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set(seed, () => resolve());
      });
    }, RICH_SEED);
    await extensionPage.reload();
    await extensionPage.waitForSelector('#app > *', { timeout: 10_000 });
    await extensionPage.waitForTimeout(SETTLE_MS);

    // Views that hit the global error boundary + the pageerrors behind them.
    // Asserted empty at the end so a crash is loud AND diagnosed, while the
    // remaining views still get their screenshots.
    const crashedViews: string[] = [];
    const pageErrors: string[] = [];
    extensionPage.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });
    const shot = async (viewName: string, file: string): Promise<void> => {
      await capture(extensionPage, file, directory);
      await recoverIfCrashed(extensionPage, viewName, crashedViews, pageErrors);
    };

    for (const theme of ['light', 'dark'] as const) {
      await setTheme(extensionPage, theme);

      // 1. Mailbox list
      await shot(`mailbox-overview (${theme})`, `mailbox-overview-${theme}`);

      // 2. Mailbox detail (open first seeded mail, then back)
      const verificationEmail = extensionPage.locator('text=Your verification code').first();
      const emailRow = verificationEmail.locator('xpath=ancestor::*[@role="button"][1]');
      await expect(emailRow).toBeVisible();
      await emailRow.focus();
      await emailRow.press('Enter');
      await expect(extensionPage.getByRole('button', { name: 'Back' }).first()).toBeVisible({
        timeout: 8000,
      });
      await extensionPage.waitForTimeout(SETTLE_MS);
      await shot(`mailbox-detail (${theme})`, `mailbox-detail-${theme}`);
      await goBack(extensionPage);

      // 3. Addresses
      await openNavItem(extensionPage, 'Addresses');
      await extensionPage.waitForTimeout(SETTLE_MS);
      await shot(`addresses (${theme})`, `addresses-${theme}`);

      // 4. Autofill profiles (keeps the historic `autofill-*` filename)
      await openNavItem(extensionPage, 'Autofill');
      await extensionPage.waitForTimeout(SETTLE_MS);
      await shot(`autofill (${theme})`, `autofill-${theme}`);

      // 5. Autofill credentials vault
      const credTab = extensionPage.getByRole('tab', { name: /Saved Logins/i }).first();
      if (await credTab.isVisible().catch(() => false)) {
        await credTab.click();
      } else {
        const credBtn = extensionPage.getByRole('button', { name: /Saved Logins/i }).first();
        if (await credBtn.isVisible().catch(() => false)) {
          await credBtn.click();
        }
      }
      await extensionPage.waitForTimeout(SETTLE_MS);
      await shot(`autofill-credentials (${theme})`, `autofill-credentials-${theme}`);

      // 6. Organize hub (Tags default + Labels + Saved Searches tabs)
      await openNavItem(extensionPage, 'Organize');
      await extensionPage.waitForTimeout(SETTLE_MS);
      await shot(`organize (${theme})`, `organize-${theme}`);
      await clickTab(extensionPage, 'Labels');
      await shot(`organize-labels (${theme})`, `organize-labels-${theme}`);
      await clickTab(extensionPage, 'Saved Searches');
      await shot(`organize-filters (${theme})`, `organize-filters-${theme}`);

      // 7. Automation rules hub (Mailbox rules default + Site rules tab)
      await openNavItem(extensionPage, 'Automation');
      await extensionPage.waitForTimeout(SETTLE_MS);
      await shot(`automation (${theme})`, `automation-${theme}`);
      await clickTab(extensionPage, 'Site rules');
      await shot(`automation-sites (${theme})`, `automation-sites-${theme}`);

      // 8. Activity (Visual default + Performance + Recent feed via ScrollSpy)
      await openNavItem(extensionPage, 'Activity');
      await extensionPage.waitForTimeout(SETTLE_MS);
      await shot(`activity (${theme})`, `activity-${theme}`);
      await spyTo(extensionPage, 'performance');
      await shot(`activity-performance (${theme})`, `activity-performance-${theme}`);
      await spyTo(extensionPage, 'storage');
      await shot(`activity-storage (${theme})`, `activity-storage-${theme}`);
      await spyTo(extensionPage, 'feed');
      await shot(`activity-recent (${theme})`, `activity-recent-${theme}`);

      // 9. Settings (General top + Appearance / Autofill / Data sections)
      await openNavItem(extensionPage, 'Settings');
      await extensionPage.waitForSelector('.settings-scroll', { timeout: 10_000 });
      await extensionPage.waitForTimeout(SETTLE_MS);
      await shot(`settings (${theme})`, `settings-${theme}`);
      await spyTo(extensionPage, 'appearance');
      await shot(`settings-appearance (${theme})`, `settings-appearance-${theme}`);
      await spyTo(extensionPage, 'autofill');
      await shot(`settings-autofill (${theme})`, `settings-autofill-${theme}`);
      await spyTo(extensionPage, 'data');
      await shot(`settings-data (${theme})`, `settings-data-${theme}`);

      // 10. About
      await openNavItem(extensionPage, 'About');
      await extensionPage.waitForTimeout(SETTLE_MS);
      await shot(`about (${theme})`, `about-${theme}`);
    }

    expect(crashedViews).toEqual([]);
  });
});
