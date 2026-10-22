import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Locator, Page } from 'playwright';
import { ACTIVITY_PAGE_KEYS } from '../../src/features/types/view-types';
import ar from '../../src/locales/ar.json' with { type: 'json' };
import en from '../../src/locales/en.json' with { type: 'json' };
import { expect, test } from './fixtures';
import { extensionUrl } from './preview-harness';

async function settle(page: Page) {
  await expect(page.locator('.view-crossfade').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function checkDialog(page: Page, name: string, output: string, customSurface?: Locator) {
  const surface =
    customSurface ??
    page.locator('[role="dialog"] .dialog-surface, [role="dialog"] .dialog-padding').last();
  await expect(surface).toBeVisible();
  const regions = surface.locator('.dialog-inset');
  const insets = await regions.evaluateAll((nodes) =>
    nodes.map((node) => {
      const css = getComputedStyle(node);
      return { start: parseFloat(css.paddingInlineStart), end: parseFloat(css.paddingInlineEnd) };
    })
  );
  if (insets.length) {
    for (const inset of insets) {
      expect(inset.end).toBe(16);
      expect(inset.start).toBeGreaterThanOrEqual(16);
    }
  } else {
    expect(
      await surface.evaluate((node) => parseFloat(getComputedStyle(node).paddingInlineEnd))
    ).toBe(16);
  }
  await surface.screenshot({ path: path.join(output, `${name}.png`), animations: 'disabled' });
  if (name === 'address-drawer') {
    await page.locator('#button-close-dialog').click();
  } else {
    await page.keyboard.press('Escape');
  }
  await expect(surface).toHaveCount(0);
}

for (const shell of [
  { file: 'popup.html', width: 360, height: 600 },
  { file: 'sidepanel.html', width: 420, height: 800 },
  { file: 'app.html', width: 1000, height: 800 },
]) {
  for (const lang of ['en', 'ar']) {
    test(`${shell.file}: compact page and dialog gutters ${lang}`, async ({
      extensionPage: page,
      extensionId,
    }) => {
      test.setTimeout(180_000);
      page.setDefaultTimeout(12_000);
      const output = path.resolve('audit/compact-gutters', shell.file.replace('.html', ''), lang);
      const messages = lang === 'en' ? en : ar;
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width: shell.width, height: shell.height });
      await page.evaluate(async (locale) => {
        await chrome.storage.local.set({
          language: locale,
          locale,
          preferredLanguage: locale,
          dialogPresentationBottomSheet: false,
        });
      }, lang);
      const metrics = [];
      for (const view of ACTIVITY_PAGE_KEYS) {
        console.log(`Checking ${shell.file} ${lang}: ${view}`);
        await page.goto(extensionUrl(extensionId, `${shell.file}?view=${view}`), {
          waitUntil: 'domcontentloaded',
        });
        await settle(page);
        await page.waitForFunction((locale) => document.documentElement.lang === locale, lang);
        const owner = page.locator('.page-inset, .page-inset-wide').first();
        await expect(owner).toBeVisible();
        const padding = await owner.evaluate((node) => {
          const css = getComputedStyle(node);
          return {
            start: css.paddingInlineStart,
            end: css.paddingInlineEnd,
            top: css.paddingTop,
            bottom: css.paddingBottom,
          };
        });
        expect(padding.start).toBe('8px');
        expect(padding.end).toBe('8px');
        expect(padding.top).toBe('8px');
        metrics.push({ view, ...padding });
        await page.screenshot({ path: path.join(output, `${view}.png`), animations: 'disabled' });
      }

      // Reach shared dialogs and both presentations through actual mailbox controls.
      for (const sheet of [false, true]) {
        await page.evaluate(async (bottomSheet) => {
          await chrome.storage.local.set({ dialogPresentationBottomSheet: bottomSheet });
        }, sheet);
        await page.goto(extensionUrl(extensionId, `${shell.file}?view=mailbox`), {
          waitUntil: 'domcontentloaded',
        });
        await settle(page);
        await page
          .locator('.account-selector-container')
          .getByRole('button', { name: messages.inbox.showQrAria })
          .click();
        await checkDialog(page, `qr-${sheet ? 'sheet' : 'dialog'}`, output);
        const tagButton = page
          .locator('.account-selector-container')
          .getByRole('button')
          .filter({ hasText: messages.common.addTag });
        await tagButton.click();
        await checkDialog(page, `tags-${sheet ? 'sheet' : 'dialog'}`, output);
      }
      await page.keyboard.press('Control+k');
      await checkDialog(page, 'command-palette', output);
      await page.keyboard.press('?');
      await checkDialog(page, 'keyboard-shortcuts', output);

      await page.evaluate(async () => {
        await chrome.storage.local.set({ dialogPresentationBottomSheet: false });
      });
      await page.goto(extensionUrl(extensionId, `${shell.file}?view=mailbox`), {
        waitUntil: 'domcontentloaded',
      });
      await settle(page);
      await page.locator('#button-open-dropdown').click();
      const drawer = page.locator('[data-account-selector-pane]');
      await expect(drawer).toBeVisible();
      expect(await drawer.evaluate((node) => getComputedStyle(node).paddingInlineEnd)).toBe('8px');
      expect(await drawer.evaluate((node) => getComputedStyle(node).paddingTop)).toBe('25px');
      await checkDialog(page, 'address-drawer', output, page.locator('#account-selector-dialog'));

      await page.goto(extensionUrl(extensionId, `${shell.file}?view=identities`), {
        waitUntil: 'domcontentloaded',
      });
      await settle(page);
      await page.getByRole('button', { name: messages.nav.fabCreateIdentity, exact: true }).click();
      await expect(page.locator('#create-identity-name')).toBeVisible();
      await checkDialog(
        page,
        'identity-editor',
        output,
        page.locator('.identity-overlay .dialog-surface')
      );

      await page.goto(extensionUrl(extensionId, `${shell.file}?view=settings`), {
        waitUntil: 'domcontentloaded',
      });
      await settle(page);
      await page
        .locator('#setting-vault-lock')
        .getByRole('button', { name: messages.preferences.vaultMasterPassword, exact: true })
        .click();
      await checkDialog(page, 'master-password', output);
      await page
        .getByRole('button', { name: messages.preferences.exportDataAria, exact: true })
        .click();
      await checkDialog(page, 'export-backup', output);
      await writeFile(path.join(output, 'metrics.json'), JSON.stringify(metrics, null, 2));
    });
  }
}
