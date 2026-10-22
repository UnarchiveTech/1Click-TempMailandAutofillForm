import { expect, test } from './fixtures';
import { extensionUrl } from './preview-harness';

for (const shell of ['popup', 'sidepanel', 'app']) {
  test(`${shell}: profile dropdown visibly follows arrows and preserves focus after selection`, async ({
    extensionPage: page,
    extensionId,
  }, info) => {
    await page.setViewportSize({
      width: shell === 'app' ? 1440 : 360,
      height: shell === 'app' ? 900 : 640,
    });
    await page.goto(extensionUrl(extensionId, `${shell}.html?view=autofill`));
    await page.locator('[data-selectable-row]').first().waitFor();
    await page.locator(shell === 'app' ? '#sidebar-create-cta' : '#footer-contextual-fab').click();
    const modal = page.locator('.identity-overlay');
    const dropdown = modal.getByRole('combobox', { name: 'Gender', exact: true });
    await dropdown.click();
    await page.keyboard.press('ArrowDown');
    const activeId = await dropdown.getAttribute('aria-activedescendant');
    if (!activeId) throw new Error('No active dropdown option');
    const active = page.locator(`[id="${activeId}"]`);
    // Capture the settled menu, not a partially transparent entry animation.
    await expect
      .poll(() => page.getByRole('listbox').evaluate((node) => getComputedStyle(node).opacity))
      .toBe('1');
    await page.screenshot({ path: info.outputPath('dropdown-active-choice.png') });
    await expect(active).toContainText('Male');
    await expect(active).toHaveClass(/row-surface-active/);
    const activeBackground = await active.evaluate(
      (node) => getComputedStyle(node).backgroundColor
    );
    const restingBackground = await page
      .getByRole('option', { name: 'Female', exact: true })
      .evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(activeBackground).not.toBe(restingBackground);
    await page.getByRole('option', { name: 'Female', exact: true }).click();
    await expect(dropdown).toBeFocused();
    await expect(dropdown).toContainText('Female');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await page.keyboard.press('Space');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(modal).toBeVisible();
    await expect(dropdown).toBeFocused();
    await page.screenshot({ path: info.outputPath('dropdown-selection-focus.png') });
  });
}

test('open email reflects HTML rendering changes from another extension window', async ({
  context,
  extensionPage: page,
  extensionId,
}) => {
  await page.evaluate(async () => {
    const key = 'storedEmailsByAddress_demo-inbox-1';
    const stored = await chrome.storage.local.get(key);
    const emails = stored[key] as Array<Record<string, unknown>>;
    await chrome.storage.local.set({
      [key]: emails.map((email) => ({
        ...email,
        body_html: '<p style="padding:7px">Your GitHub verification code is 482901.</p>',
      })),
      htmlRenderingSettings: { style: true },
    });
  });
  const email = page.getByRole('button', {
    name: /Email from security@github\.com: Your verification code/,
  });
  await email.focus();
  await page.keyboard.press('Enter');
  const paragraph = page.locator('.email-body p');
  await expect(paragraph).toHaveAttribute('style', /padding:\s*7px/);

  const writer = await context.newPage();
  try {
    await writer.goto(extensionUrl(extensionId, 'sidepanel.html?view=settings'));
    await writer.evaluate(() =>
      chrome.storage.local.set({ htmlRenderingSettings: { style: false } })
    );
    await expect(paragraph).not.toHaveAttribute('style');
    // Removing the preference restores defaults in an already-open reader.
    await writer.evaluate(() => chrome.storage.local.remove('htmlRenderingSettings'));
    await expect(paragraph).toHaveAttribute('style', /padding:\s*7px/);
  } finally {
    await writer.close();
  }
});
