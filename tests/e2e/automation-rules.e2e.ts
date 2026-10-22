import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import ar from '../../src/locales/ar.json' with { type: 'json' };
import en from '../../src/locales/en.json' with { type: 'json' };
import { expect, test } from './fixtures';
import { extensionUrl } from './preview-harness';

for (const [language, messages] of [
  ['en', en],
  ['ar', ar],
] as const) {
  test(`automation editors preserve state and preview priority at popup width: ${language}`, async ({
    extensionPage,
    extensionId,
  }) => {
    const page = extensionPage;
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 360, height: 640 });
    await page.evaluate(async (language) => {
      const now = Date.now();
      await chrome.storage.local.set({
        language,
        locale: language,
        preferredLanguage: language,
        mailboxRules: [
          {
            id: 'mail-rule',
            name: 'github',
            field: 'sender',
            matchingVersion: 2,
            contains: 'github',
            enabled: false,
            label: 'Work',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'empty-rule',
            name: 'empty',
            field: 'sender',
            matchingVersion: 2,
            contains: 'nothing',
            enabled: false,
            createdAt: now,
            updatedAt: now,
          },
        ],
        mailboxRuleMatchStats: {
          'mail-rule': {
            count: 1,
            field: 'sender',
            lastMatchedAt: now,
            failedActions: 1,
            lastSucceeded: ['label'],
          },
        },
        siteRules: [
          {
            id: 'broad',
            name: 'example.com',
            domainPattern: 'example.com',
            enabled: true,
            providerId: 'guerrilla',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'specific',
            name: 'accounts.example.com',
            domainPattern: 'accounts.example.com',
            includeSubdomains: false,
            enabled: false,
            providerId: 'burner',
            createdAt: now,
            updatedAt: now,
          },
        ],
      });
      await chrome.storage.session.set({ automationActiveTab: 'mailbox' });
    }, language);
    await page.goto(extensionUrl(extensionId, 'app.html?view=automation'));
    await expect(
      page
        .locator('#rule-row-mail-rule')
        .getByText(
          messages.automation.ruleSucceededActions.replace(
            '{actions}',
            messages.automation.ruleSucceededLabel
          ),
          { exact: true }
        )
    ).toBeVisible();
    await page
      .locator('#rule-row-mail-rule')
      .getByRole('button', { name: messages.common.edit, exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    const evidenceDir = path.resolve('audit/automation-rules');
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({
      path: path.join(evidenceDir, `${language}-mailbox-top.png`),
      animations: 'disabled',
    });
    await dialog
      .getByRole('button', { name: messages.automation.rulePreview, exact: true })
      .click();
    await expect(dialog.getByText('Your verification code', { exact: true })).toBeVisible();
    await page.screenshot({
      path: path.join(evidenceDir, `${language}-mailbox-preview.png`),
      animations: 'disabled',
    });
    const save = dialog.getByRole('button', { name: messages.common.save, exact: true });
    await save.click();
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await chrome.storage.local.get('mailboxRules')).mailboxRules[0].enabled
        )
      )
      .toBe(false);
    await expect(dialog).toHaveCount(0);
    const rejectedToggle = page.locator('#rule-row-empty-rule').getByRole('checkbox');
    await rejectedToggle.click();
    await expect(rejectedToggle).not.toBeChecked();

    await page.getByRole('tab', { name: new RegExp(messages.intelligence.rulesTitle) }).click();
    const specific = page.locator('#rule-row-specific');
    await specific
      .getByRole('button', { name: messages.automation.ruleMoveUp, exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(async () => (await chrome.storage.local.get('siteRules')).siteRules[0].id)
      )
      .toBe('specific');
    await specific.getByRole('button', { name: messages.common.edit, exact: true }).click();
    await page.screenshot({
      path: path.join(evidenceDir, `${language}-site-top.png`),
      animations: 'disabled',
    });
    await dialog
      .getByLabel(messages.automation.rulePreviewWebsite, { exact: true })
      .fill('accounts.example.com');
    await dialog
      .getByRole('button', { name: messages.automation.rulePreview, exact: true })
      .click();
    await expect(
      dialog.getByText(
        messages.automation.rulePreviewWinner.replace('{rule}', 'accounts.example.com'),
        { exact: true }
      )
    ).toBeVisible();
    await page.screenshot({
      path: path.join(evidenceDir, `${language}-site-preview.png`),
      animations: 'disabled',
    });
    await dialog.getByRole('button', { name: messages.common.save, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await chrome.storage.local.get('siteRules')).siteRules[0].enabled
        )
      )
      .toBe(false);
    expect(errors).toEqual([]);
  });
}
