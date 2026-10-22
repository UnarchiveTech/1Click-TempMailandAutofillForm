import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { extensionUrl } from './preview-harness';

const ROOT = join(import.meta.dirname, '../..');
const LANGUAGES = ['en', 'ar', 'de', 'es', 'fr', 'ja', 'th', 'zh'] as const;

test('all locales load losslessly in every UI shell and the background translation handler', async ({
  extensionPage: page,
  extensionId,
  extensionBuildPath,
}) => {
  test.setTimeout(90_000);
  const chunks = readdirSync(join(extensionBuildPath, 'chunks'));
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  for (const shell of ['popup', 'sidepanel', 'app']) {
    for (const language of LANGUAGES) {
      const source = JSON.parse(readFileSync(join(ROOT, `src/locales/${language}.json`), 'utf8'));
      const chunk = chunks.find((name) =>
        language === 'en' ? /^en-[^.]+\.js$/.test(name) : name.startsWith(`${language}.json-`)
      );
      expect(chunk, `Missing shipped dictionary for ${language}`).toBeDefined();

      await page.evaluate(async (code) => {
        await chrome.storage.local.set({ locale: code, preferredLanguage: code });
      }, language);
      // Let this document finish its dictionary and health responses before
      // navigation; canceled WebKit requests otherwise look like CORS failures.
      if (page.context().browser()?.browserType().name() === 'webkit') {
        await page.waitForLoadState('networkidle');
      }
      await page.goto(extensionUrl(extensionId, `${shell}.html`));
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await expect(page).toHaveTitle(source.actionTitle.tempMailAndAutofill);

      // Exercise the emitted modules in the extension's own CSP/context, not a
      // Node decoder. A dropped key or broken chunk import fails the full tree.
      const decoded = await page.evaluate(
        async ({ filename, keys }) => {
          const module = await import(chrome.runtime.getURL(`chunks/${filename}`));
          // Rolldown can rename the English default export used by static
          // imports. Locate the dictionary by its complete root-key contract.
          return Object.values(module).find(
            (value) =>
              value &&
              typeof value === 'object' &&
              Object.keys(value).length === keys.length &&
              keys.every((key) => key in value)
          );
        },
        { filename: chunk, keys: Object.keys(source) }
      );
      expect(decoded).toEqual(source);

      const translated = await page.evaluate(async () => {
        return chrome.runtime.sendMessage({
          type: 'translate',
          key: 'contentAutofill.destinationWarningTitle',
        });
      });
      expect(translated).toEqual({
        success: true,
        translated: source.contentAutofill.destinationWarningTitle,
      });
    }
  }
  expect(pageErrors).toEqual([]);
});
