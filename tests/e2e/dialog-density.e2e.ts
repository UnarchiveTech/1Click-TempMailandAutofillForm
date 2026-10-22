import { writeFile } from 'node:fs/promises';
import type { Page, TestInfo } from '@playwright/test';
import en from '../../src/locales/en.json' with { type: 'json' };
import type { Identity } from '../../src/utils/types';
import { expect, test } from './fixtures';
import { extensionUrl } from './preview-harness';

async function capture(
  page: Page,
  info: TestInfo,
  name: string,
  selector = '[data-dialog-density]'
) {
  const surface = page.locator(selector).last();
  await expect(surface).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const metrics = await surface.evaluate((node) => {
    const heading = node.querySelector<HTMLElement>('.dialog-heading');
    const description = node.querySelector<HTMLElement>('.dialog-description');
    const header = node.querySelector<HTMLElement>('.dialog-header');
    const style = getComputedStyle(node);
    return {
      density: (node as HTMLElement).dataset.dialogDensity,
      width: node.clientWidth,
      height: node.getBoundingClientRect().height,
      availableHeight: window.visualViewport?.height ?? window.innerHeight,
      titleSize: heading && getComputedStyle(heading).fontSize,
      titleLine: heading && getComputedStyle(heading).lineHeight,
      descriptionSize: description && getComputedStyle(description).fontSize,
      headerGap: header && getComputedStyle(header).rowGap,
      blockPadding: style.paddingTop,
      overflow: node.scrollWidth > node.clientWidth + 1,
    };
  });
  const roomy = metrics.width >= 480 && metrics.availableHeight >= 720;
  if (selector === '[data-dialog-density]') {
    expect(metrics.density).toBe(roomy ? 'roomy' : 'compact');
  }
  if (metrics.titleSize) {
    expect(metrics.titleSize).toBe(roomy ? '22px' : '16px');
    expect(metrics.titleLine).toBe(roomy ? '28px' : '24px');
  }
  if (metrics.descriptionSize) expect(metrics.descriptionSize).toBe('14px');
  if (metrics.headerGap) expect(metrics.headerGap).toBe(roomy ? '12px' : '8px');
  expect(metrics.overflow).toBe(false);
  expect(metrics.height).toBeLessThanOrEqual(metrics.availableHeight);
  await page.screenshot({ path: info.outputPath(`${name}.png`), animations: 'disabled' });
  await surface.screenshot({
    path: info.outputPath(`${name}-surface.png`),
    animations: 'disabled',
  });
  await writeFile(info.outputPath(`${name}.json`), JSON.stringify(metrics, null, 2));
  const scrolling = await surface.evaluate((node) => {
    const regions = [node, ...node.querySelectorAll<HTMLElement>('*')].filter(
      (element) =>
        element.scrollHeight > element.clientHeight + 2 &&
        /auto|scroll/.test(getComputedStyle(element).overflowY)
    );
    for (const region of regions) region.scrollTop = region.scrollHeight;
    return regions.length > 0;
  });
  if (scrolling) {
    await page.screenshot({
      path: info.outputPath(`${name}-scrolled.png`),
      animations: 'disabled',
    });
  }
  if (selector === '#account-selector-dialog') await page.locator('#button-close-dialog').click();
  else await page.keyboard.press('Escape');
}

for (const shell of [
  { file: 'popup', width: 360, height: 600 },
  { file: 'sidepanel', width: 420, height: 820 },
  { file: 'app', width: 1440, height: 900 },
]) {
  test(`${shell.file}: dialog profiles, custom shells and nested content`, async ({
    extensionPage: page,
    extensionId,
  }, info) => {
    test.setTimeout(180000);
    page.setDefaultTimeout(10000);
    await page.setViewportSize({ width: shell.width, height: shell.height });
    await page.evaluate(async () => {
      const { addresses } = await chrome.storage.local.get('addresses');
      const now = Date.now();
      await chrome.storage.local.set({
        locale: 'en',
        language: 'en',
        preferredLanguage: 'en',
        dialogPresentationBottomSheet: false,
        addresses: addresses.map((a: Record<string, unknown>) => ({
          ...a,
          tags: [{ name: 'Work', color: '#6750a4' }],
        })),
        identities: [
          {
            id: 'profile',
            name: 'Personal',
            firstNames: 'Alex',
            lastNames: 'River',
            createdAt: now,
            isDefault: true,
            useRandomPassword: true,
          } satisfies Identity,
        ],
        selectedIdentityId: 'profile',
        activityEvents: [
          {
            id: 'profile-review',
            type: 'email_received',
            timestamp: now,
            data: { address: 'demo.user@example.com', subject: 'Receipt' },
          },
        ],
        emailLabels: { 'demo.user@example.com_demo-seed-1': ['Receipts'] },
        emailLabelCatalog: [{ name: 'Receipts', color: '#6750a4' }],
        savedSearchFilters: [
          {
            id: 'filter',
            name: 'Work messages',
            searchQuery: 'verification',
            hasOTP: false,
            createdAt: now,
          },
        ],
        loginInfo: [
          {
            id: 'login',
            domain: 'shop.example',
            email: 'demo.user@example.com',
            password: '',
            timestamp: now,
          },
        ],
        'storedEmailsByAddress_demo-inbox-1': [
          {
            id: 'demo-seed-1',
            from: 'billing@shop.example',
            from_name: 'Shop',
            subject: 'Receipt',
            received_at: now,
            original_inbox: 'demo.user@example.com',
            body_plain: 'https://shop.example/receipt https://instagram.com/shop',
            attachments: [
              {
                filename: 'receipt.pdf',
                mimeType: 'application/pdf',
                downloadUrl: 'https://shop.example/receipt.pdf',
              },
            ],
          },
        ],
      });
    });
    const go = async (view: string) => {
      await page.goto(extensionUrl(extensionId, `${shell.file}.html?view=${view}`));
      await expect(page.locator('.view-crossfade').first()).toBeVisible();
    };

    await go('mailbox');
    await page.locator('#button-qr-code').click();
    await capture(page, info, 'qr');
    await page.locator('#button-open-dropdown').click();
    await capture(page, info, 'address-drawer', '#account-selector-dialog');
    await page.locator('#button-open-dropdown').click();
    await page.locator('#button-create-new-mail').click();
    await capture(page, info, 'create-address');
    await go('mailbox');
    await page.getByRole('button', { name: 'Edit tag Work', exact: true }).first().click();
    await page.getByRole('button', { name: en.tagManagement.customColor, exact: true }).click();
    await capture(page, info, 'custom-color');
    await capture(page, info, 'set-tags');
    await page.locator('#button-delete').click();
    await capture(page, info, 'delete-confirm');
    await page.getByRole('button', { name: en.attachmentLibrary.title, exact: true }).click();
    await capture(page, info, 'attachment-library');
    await page.keyboard.press('?');
    await capture(page, info, 'shortcuts');
    await page.keyboard.press('Control+k');
    await capture(page, info, 'command-palette');
    await page.locator('#inbox-search-input').focus();
    await page.locator('#button-manage-filters').click();
    await capture(page, info, 'manage-filters');
    await page.locator('#inbox-search-input').fill('receipt');
    await page.locator('#button-save-as-filter').click();
    await capture(page, info, 'save-filter');
    await go('mailbox');
    await page.locator('[data-selectable-row="demo-seed-1"] [data-row-primary]').click();
    await page
      .getByRole('button', { name: en.inbox.linksInEmail.replace('{n}', '2'), exact: true })
      .first()
      .click();
    await capture(page, info, 'message-links');
    await page.getByRole('button', { name: en.inbox.emailActions.addLabel, exact: true }).click();
    await capture(page, info, 'message-labels');
    await page.locator('#button-download').click();
    await capture(page, info, 'message-download');
    await go('addresses');
    await page.locator('[data-selectable-row="demo-inbox-1"] [data-row-primary]').click();
    await page.getByRole('button', { name: en.addressView.downloadEmails, exact: true }).click();
    await capture(page, info, 'export-wizard');

    await go('settings');
    await page
      .locator('#setting-vault-lock')
      .getByRole('button', { name: en.preferences.vaultMasterPassword, exact: true })
      .click();
    await capture(page, info, 'master-password');
    await page.getByRole('button', { name: en.preferences.exportDataAria, exact: true }).click();
    await capture(page, info, 'export-backup');
    await page.getByRole('button', { name: en.preferences.importDataAria, exact: true }).click();
    await capture(page, info, 'import-backup');
    await page.getByRole('switch', { name: en.webdav.enabledAria, exact: true }).click();
    await capture(page, info, 'webdav');
    await go('mailProvider');
    await page.getByRole('button', { name: en.mailProvider.editJsonOpen, exact: true }).click();
    await capture(page, info, 'provider-json');

    await go('identities');
    await page.getByRole('button', { name: en.nav.fabCreateIdentity, exact: true }).click();
    await expect(page.locator('#create-identity-name')).toBeVisible();
    await capture(page, info, 'identity-create');
    // Open the independent edit case from a fresh list route.
    await go('identities');
    await page.getByRole('button', { name: en.identities.edit, exact: true }).click();
    await capture(page, info, 'identity-edit');
    await go('autofill');
    await page.getByRole('tab', { name: /^Saved Logins/ }).click();
    await page.locator('[data-selectable-row="login"] [data-row-primary]').click();
    await page.getByRole('button', { name: en.relatedMessages.title, exact: true }).click();
    await capture(page, info, 'related-messages');

    await go('organize');
    await page.getByRole('button', { name: en.nav.fabCreateTag, exact: true }).click();
    await capture(page, info, 'tag-create');
    await page.getByRole('button', { name: 'Edit tag Work', exact: true }).first().click();
    await capture(page, info, 'tag-edit');
    await page
      .getByRole('button', {
        name: en.organize.openTagUsage.replace('{name}', 'Work'),
        exact: true,
      })
      .click();
    await capture(page, info, 'tag-usage');
    await page.getByRole('tab', { name: /^Labels/ }).click();
    await page.getByRole('button', { name: en.nav.fabCreateLabel, exact: true }).click();
    await capture(page, info, 'label-create');
    await page
      .getByRole('button', { name: en.labelManagement.rename, exact: true })
      .first()
      .click();
    await capture(page, info, 'label-rename');
    await page
      .getByRole('button', {
        name: en.organize.openLabelUsage.replace('{name}', 'Receipts'),
        exact: true,
      })
      .click();
    await capture(page, info, 'label-usage');
    await page.getByRole('tab', { name: /^(Filters|Saved Searches)/ }).click();
    await page
      .getByRole('button', {
        name: en.filtersManagement.editFilter.replace('{name}', 'Work messages'),
        exact: true,
      })
      .click();
    await capture(page, info, 'filter-edit');
    await page
      .getByRole('button', {
        name: en.filtersManagement.renameFilter.replace('{name}', 'Work messages'),
        exact: true,
      })
      .click();
    await capture(page, info, 'filter-rename');

    await go('automation');
    await page.getByRole('button', { name: en.automation.ruleAdd, exact: true }).click();
    await capture(page, info, 'mailbox-rule');
    await page.getByRole('tab').last().click();
    await page.getByRole('button', { name: en.intelligence.ruleAdd, exact: true }).click();
    await capture(page, info, 'site-rule');

    await go('analytics');
    await page.getByRole('button', { name: en.activityExplorer.dashboard, exact: true }).click();
    await capture(page, info, 'dashboard');
    await page
      .getByRole('button', { name: en.activityExplorer.details, exact: true })
      .first()
      .click();
    await capture(page, info, 'activity-event');
    await go('about');
    await page.getByRole('button', { name: en.about.sourceCode, exact: true }).click();
    await capture(page, info, 'source-code');
    await page.getByRole('button', { name: en.productTour.replay, exact: true }).click();
    await capture(page, info, 'product-tour');

    await page.evaluate(() => chrome.storage.local.set({ dialogPresentationBottomSheet: true }));
    await go('mailbox');
    await page.locator('#button-qr-code').click();
    await capture(page, info, 'qr-sheet');
    await page.getByRole('button', { name: 'Edit tag Work', exact: true }).first().click();
    await capture(page, info, 'tags-sheet');
  });
}

test('wide dialog changes density when its width or available height changes', async ({
  extensionPage: page,
  extensionId,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(extensionUrl(extensionId, 'app.html?view=mailbox'));
  await page.getByRole('button', { name: en.attachmentLibrary.title, exact: true }).click();
  const surface = page.locator('[data-dialog-density]').last();
  await expect(surface).toHaveAttribute('data-dialog-density', 'roomy');
  await page.setViewportSize({ width: 420, height: 820 });
  await expect(surface).toHaveAttribute('data-dialog-density', 'compact');
  await page.setViewportSize({ width: 900, height: 650 });
  await expect(surface).toHaveAttribute('data-dialog-density', 'compact');
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(surface).toHaveAttribute('data-dialog-density', 'roomy');
  await capture(page, info, 'resized-library');
});
