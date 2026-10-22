/**
 * e2e/settings-overflow.e2e.ts
 *
 * Regression guard for horizontal overflow on the Settings page.
 *
 * Background: the "Data, Storage & Performance" section used to overflow the
 * settings pane because <input> elements inside flex rows contribute their
 * intrinsic default width (~163px) to the row's min-content - two side-by-side
 * inputs forced the row to ~332px, which ballooned the section grid track and
 * overflowed the 335px pane. Fixed with flex-wrap (.input-row) + a container
 * query for the section grid. These tests lock that behaviour in.
 *
 * Run: bun run test:e2e
 */
import { expect, test } from './fixtures';

async function openSettings(page: import('playwright').Page) {
  // Use the keyboard toggle so a pre-click hover cannot close the More menu.
  await page.getByRole('button', { name: 'More' }).press('Enter');
  await page.getByRole('menuitem', { name: 'Settings' }).click({ force: true });
  await expect(page.locator('.settings-scroll')).toBeAttached({ timeout: 10_000 });
}

interface SettingsOverflow {
  missing: boolean;
  docOverflow: boolean;
  containerOverflow: boolean;
  containerScrollW: number;
  containerClientW: number;
  sections: Array<{ id: string; overflow: boolean; scrollW: number; clientW: number }>;
}

/**
 * Measures horizontal overflow of the settings scroll container and of every
 * settings section. A section's scrollWidth > clientWidth means some card
 * inside it forces the section (and the pane) wider than its column.
 */
async function measureSettingsOverflow(page: import('playwright').Page): Promise<SettingsOverflow> {
  return page.evaluate((): SettingsOverflow => {
    const container = document.querySelector('.settings-scroll') as HTMLElement | null;
    if (!container) {
      return {
        missing: true,
        docOverflow: false,
        containerOverflow: false,
        containerScrollW: 0,
        containerClientW: 0,
        sections: [],
      };
    }
    const doc = document.documentElement;
    const sections = Array.from(document.querySelectorAll('section[data-settings-section]'));
    return {
      missing: false,
      docOverflow: doc.scrollWidth > doc.clientWidth,
      containerOverflow: container.scrollWidth > container.clientWidth,
      containerScrollW: container.scrollWidth,
      containerClientW: container.clientWidth,
      sections: sections.map((sec) => {
        const s = sec as HTMLElement;
        return {
          id: sec.id,
          overflow: s.scrollWidth > s.clientWidth,
          scrollW: s.scrollWidth,
          clientW: s.clientWidth,
        };
      }),
    };
  });
}

test.describe('Settings - horizontal overflow regression', () => {
  for (const width of [380, 720, 1280]) {
    test(`no settings section overflows horizontally at ${width}px`, async ({ extensionPage }) => {
      await extensionPage.setViewportSize({ width, height: 800 });
      await openSettings(extensionPage);

      const result = await measureSettingsOverflow(extensionPage);
      expect(result.missing).not.toBe(true);
      if (result.missing) throw new Error('settings scroll container not found');

      // The document itself must not scroll horizontally
      expect(result.docOverflow).toBe(false);

      // The settings pane must not show a horizontal scrollbar
      expect(
        result.containerOverflow,
        `settings container ${result.containerScrollW}px > ${result.containerClientW}px`
      ).toBe(false);

      // No individual section may force its content wider than the pane
      const overflowing = result.sections.filter((s) => s.overflow);
      expect(
        overflowing,
        `sections wider than their column: ${JSON.stringify(overflowing)}`
      ).toEqual([]);
    });
  }
});
