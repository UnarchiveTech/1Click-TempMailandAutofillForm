import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { extensionUrl } from './preview-harness';

/** Reach controls through the real tab order, never locator.focus()/click(). */
async function tabTo(page: Page, target: Locator) {
  await target.waitFor({ state: 'visible' });
  const visited: string[] = [];
  let backwards = false;
  let unchanged = 0;
  for (let i = 0; i < 250; i++) {
    if (await target.evaluateAll((nodes) => nodes.some((node) => node === document.activeElement)))
      return;
    visited.push(
      await page.evaluate(() => `${document.activeElement?.tagName}#${document.activeElement?.id}`)
    );
    const before = await page.evaluateHandle(() => document.activeElement);
    await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab');
    unchanged = (await page.evaluate((element) => document.activeElement === element, before))
      ? unchanged + 1
      : 0;
    await before.dispose();
    // Firefox can leave the content focus on its last control while Tab moves
    // into browser chrome. Traverse back with Shift+Tab instead of assuming
    // every engine wraps from the last page control to the first.
    if (!backwards && unchanged >= 2) {
      backwards = true;
      unchanged = 0;
    }
  }
  throw new Error(
    `Control was not reachable through Tab: ${target}; visited: ${JSON.stringify(visited.slice(0, 40))}; target: ${await target.evaluate((node) => node.outerHTML)}`
  );
}

async function open(page: Page, id: string, view: string, shell = 'app', width = 360) {
  await page.setViewportSize({ width, height: width > 800 ? 900 : 640 });
  await page.goto(extensionUrl(id, `${shell}.html?view=${view}`));
  await page.locator('.view-crossfade').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(
    () => !document.querySelector('.app-loading-skeleton') && document.querySelector('nav, footer')
  );
}

async function selectFirst(page: Page) {
  await tabTo(page, page.locator('[data-selectable-row] button[aria-pressed]').first());
  await page.keyboard.press('Space');
  await expect(page.locator('[data-selection-strip]')).toBeVisible();
}

for (const shell of ['popup', 'sidepanel', 'app']) {
  test(`${shell}: Enter on Deselect never runs Archive`, async ({
    extensionPage: page,
    extensionId,
  }) => {
    await open(page, extensionId, 'addresses', shell);
    await selectFirst(page);
    await tabTo(
      page,
      page.locator('[data-selection-strip]').getByRole('button', { name: 'Deselect', exact: true })
    );
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-selection-strip]')).toHaveCount(0);
    const addresses = await page.evaluate(
      async () => (await chrome.storage.local.get('addresses')).addresses
    );
    expect(
      addresses.find((address: { id: string }) => address.id === 'demo-inbox-1').accountStatus
    ).toBe('active');
  });

  test(`${shell}: palette Close preserves the current page`, async ({
    extensionPage: page,
    extensionId,
  }) => {
    await open(page, extensionId, 'settings', shell);
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
    await tabTo(page, palette.getByRole('button', { name: 'Close', exact: true }));
    await page.keyboard.press('Enter');
    await expect(palette).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Select Theme', exact: true })).toBeVisible();
    await expect(page.locator('#inbox-search-input')).toHaveCount(0);
  });

  test(`${shell}: avatar Space selects mail and identities`, async ({
    extensionPage: page,
    extensionId,
  }) => {
    await open(page, extensionId, 'mailbox', shell);
    await selectFirst(page);
    await expect(page.locator('[data-selectable-row]')).toHaveCount(1);
    await open(page, extensionId, 'autofill', shell);
    await selectFirst(page);
    await expect(page.locator('.identity-overlay')).toHaveCount(0);
  });
}

test('Create Profile contains focus, handles Escape, and restores its opener', async ({
  extensionPage: page,
  extensionId,
}, info) => {
  await open(page, extensionId, 'autofill');
  const trigger = page.locator('#footer-contextual-fab');
  await tabTo(page, trigger);
  await page.keyboard.press('Enter');
  const modal = page.locator('.identity-overlay');
  await expect
    .poll(() => modal.evaluate((node) => node.contains(document.activeElement)))
    .toBe(true);
  for (let i = 0; i < 45; i++) {
    await page.keyboard.press(i % 3 === 0 ? 'Shift+Tab' : 'Tab');
    expect(await modal.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  }
  await page.screenshot({ path: info.outputPath('profile-keyboard-focus.png') });
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('untouched Create mailbox tag closes with Escape', async ({
  extensionPage: page,
  extensionId,
}) => {
  await open(page, extensionId, 'organize');
  const trigger = page.getByRole('button', { name: 'New tag', exact: true });
  await tabTo(page, trigger);
  await page.keyboard.press('Enter');
  const modal = page.getByRole('dialog', { name: 'Create mailbox tag', exact: true });
  await expect
    .poll(() => modal.evaluate((node) => node.contains(document.activeElement)))
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('nested custom color keeps Tab inside and restores its trigger', async ({
  extensionPage: page,
  extensionId,
}) => {
  await open(page, extensionId, 'mailbox');
  await tabTo(page, page.getByRole('button', { name: 'Add tags', exact: true }));
  await page.keyboard.press('Enter');
  const tags = page.getByRole('dialog', { name: 'Set Tags', exact: true });
  const trigger = tags.getByRole('button', { name: 'Custom color', exact: true });
  await tabTo(page, trigger);
  await page.keyboard.press('Enter');
  const picker = page.getByRole('dialog', { name: 'Custom color', exact: true });
  await expect
    .poll(() => picker.evaluate((node) => node.contains(document.activeElement)))
    .toBe(true);
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab');
    expect(await picker.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(tags).toBeVisible();
  await expect(trigger).toBeFocused();
});

test('mailbox arrows and range selection cross virtual windows', async ({
  extensionPage: page,
  extensionId,
}) => {
  test.setTimeout(90_000);
  await page.evaluate(async () => {
    const key = 'storedEmailsByAddress_demo-inbox-1';
    const existing = (await chrome.storage.local.get(key))[key][0];
    const messages = Array.from({ length: 100 }, (_, i) => ({
      ...existing,
      id: `keyboard-${i}`,
      subject: `Keyboard message ${i}`,
      received_at: Date.now() - i * 60_000,
    }));
    await chrome.storage.local.set({
      [key]: messages,
      emailStorageMetadata: {
        'demo-inbox-1': { messageCount: 100, unreadCount: 100, revision: 2 },
      },
    });
  });
  await open(page, extensionId, 'mailbox');
  await tabTo(page, page.locator('[data-selectable-row="keyboard-0"] [data-row-primary]'));
  for (let i = 1; i <= 60; i++) {
    await page.keyboard.press('ArrowDown');
    await expect(
      page.locator(`[data-selectable-row="keyboard-${i}"] [data-row-primary]`)
    ).toBeFocused();
  }
  await page.keyboard.press('Shift+ArrowDown');
  await expect(
    page.locator('[data-selectable-row="keyboard-61"] button[aria-pressed]').first()
  ).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('x');
  await expect(page.locator('[data-selection-strip]')).toHaveCount(0);
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowUp');
  await expect(
    page.locator('[data-selectable-row="keyboard-41"] [data-row-primary]')
  ).toBeFocused();
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowDown');
  for (const id of [42, 43, 44])
    await expect(
      page.locator(`[data-selectable-row="keyboard-${id}"] button[aria-pressed]`).first()
    ).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-selection-strip]')).toHaveCount(0);
  await expect(page.locator('#inbox-search-input')).toBeVisible();
});

test('provider chooser focuses its contents and closes with Escape', async ({
  extensionPage: page,
  extensionId,
}) => {
  await open(page, extensionId, 'mailbox');
  const trigger = page.locator('#footer-contextual-fab');
  await tabTo(page, trigger);
  await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu', { name: 'New address', exact: true });
  await expect
    .poll(() => menu.evaluate((node) => node.contains(document.activeElement)))
    .toBe(true);
  await page.keyboard.press('ArrowDown');
  expect(await menu.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('search history survives Tab and can be removed from the keyboard', async ({
  extensionPage: page,
  extensionId,
}) => {
  await open(page, extensionId, 'mailbox');
  const search = page.locator('#inbox-search-input');
  await tabTo(page, search);
  await page.keyboard.type('github');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await tabTo(page, search);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await tabTo(page, page.getByRole('button', { name: 'github', exact: true }));
  // Poll beyond the former blur timeout rather than relying on a blind sleep.
  const started = Date.now();
  await expect
    .poll(
      async () =>
        Date.now() - started > 300 &&
        (await page
          .getByRole('button', { name: 'github', exact: true })
          .evaluate((node) => node === document.activeElement))
    )
    .toBe(true);
  const remove = page.getByRole('button', { name: 'Remove search', exact: true });
  await tabTo(page, remove);
  await page.keyboard.press('Enter');
  await expect(remove).toHaveCount(0);
  await expect(search).toBeFocused();
});

test('focused Undo remains available beyond the ordinary expiry', async ({
  extensionPage: page,
  extensionId,
}) => {
  await open(page, extensionId, 'addresses');
  await selectFirst(page);
  await tabTo(
    page,
    page.locator('[data-selection-strip]').getByRole('button', { name: 'Archive', exact: true })
  );
  await page.keyboard.press('Space');
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await tabTo(page, undo);
  const started = Date.now();
  await expect
    .poll(async () => Date.now() - started > 11_000 && (await undo.isVisible()), {
      timeout: 15_000,
    })
    .toBe(true);
  await expect(undo).toBeFocused();
  await page.keyboard.press('Enter');
  await expect
    .poll(async () =>
      page.evaluate(
        async () => (await chrome.storage.local.get('addresses')).addresses[0].accountStatus
      )
    )
    .toBe('active');
  await expect.poll(() => page.evaluate(() => document.activeElement !== document.body)).toBe(true);
});

test('pane size changes with arrows and respects Home/End limits', async ({
  extensionPage: page,
  extensionId,
}) => {
  await open(page, extensionId, 'mailbox', 'app', 1440);
  const handle = page.getByRole('slider', { name: 'Resize panes', exact: true });
  await tabTo(page, handle);
  const before = Number(await handle.getAttribute('aria-valuenow'));
  await page.keyboard.press('ArrowLeft');
  await expect
    .poll(async () => Number(await handle.getAttribute('aria-valuenow')))
    .toBeLessThan(before);
  await page.keyboard.press('Home');
  await expect(handle).toHaveAttribute(
    'aria-valuenow',
    (await handle.getAttribute('aria-valuemin')) || ''
  );
  await page.keyboard.press('End');
  await expect
    .poll(async () => Number(await handle.getAttribute('aria-valuenow')))
    .toBe(Math.round(Number(await handle.getAttribute('aria-valuemax'))));
});

test('address keyboard reorder moves one position and preserves the focused record', async ({
  extensionPage: page,
  extensionId,
}) => {
  await page.evaluate(async () => {
    const first = (await chrome.storage.local.get('addresses')).addresses[0];
    await chrome.storage.local.set({
      addresses: ['a', 'b', 'c'].map((id) => ({ ...first, id, address: `${id}@example.com` })),
    });
  });
  await open(page, extensionId, 'addresses');
  const first = page.locator('[data-selectable-row="a"] [data-row-primary]');
  await tabTo(page, first);
  await page.keyboard.press('Alt+Shift+ArrowDown');
  await expect
    .poll(async () =>
      page
        .locator('[data-selectable-row]')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-selectable-row')))
    )
    .toEqual(['b', 'a', 'c']);
  await expect(first).toBeFocused();
  await page.keyboard.press('Alt+Shift+ArrowUp');
  await expect
    .poll(async () =>
      page
        .locator('[data-selectable-row]')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-selectable-row')))
    )
    .toEqual(['a', 'b', 'c']);
});

test('profiles reorder by keyboard in both directions without opening the editor', async ({
  extensionPage: page,
  extensionId,
}) => {
  await page.evaluate(async () =>
    chrome.storage.local.set({
      identities: ['a', 'b', 'c'].map((id) => ({
        id,
        name: `Profile ${id}`,
        firstNames: 'Test',
        lastNames: id,
        useRandomPassword: true,
        isDefault: id === 'a',
        createdAt: Date.now(),
      })),
      selectedIdentityId: 'a',
    })
  );
  await open(page, extensionId, 'autofill');
  const first = page.locator('[data-selectable-row="a"] [data-row-primary]');
  await tabTo(page, first);
  await page.keyboard.press('Alt+Shift+ArrowDown');
  await expect
    .poll(() =>
      page
        .locator('[data-selectable-row]')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-selectable-row')))
    )
    .toEqual(['b', 'a', 'c']);
  await expect(first).toBeFocused();
  await page.keyboard.press('Alt+Shift+ArrowUp');
  await expect
    .poll(() =>
      page
        .locator('[data-selectable-row]')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-selectable-row')))
    )
    .toEqual(['a', 'b', 'c']);
  await expect(page.locator('.identity-overlay')).toHaveCount(0);
});

test('saved logins reorder by keyboard within their site', async ({
  extensionPage: page,
  extensionId,
}) => {
  await page.evaluate(async () =>
    chrome.storage.local.set({
      loginInfo: ['a', 'b', 'c'].map((id) => ({
        id,
        domain: 'example.com',
        email: `${id}@example.com`,
        username: id,
        password: '',
        timestamp: Date.now(),
        website: 'https://example.com/signup',
      })),
    })
  );
  await open(page, extensionId, 'autofill');
  await tabTo(page, page.getByRole('tab', { selected: true }).first());
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /^Saved Logins/ })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  const first = page.locator('[data-selectable-row="a"] [data-row-primary]');
  await tabTo(page, first);
  await page.keyboard.press('Alt+Shift+ArrowDown');
  await expect
    .poll(() =>
      page
        .locator('[data-selectable-row]')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-selectable-row')))
    )
    .toEqual(['b', 'a', 'c']);
  await expect(first).toBeFocused();
});

test('account drawer reorders from a focused row without dragging', async ({
  extensionPage: page,
  extensionId,
}) => {
  await page.evaluate(async () => {
    const first = (await chrome.storage.local.get('addresses')).addresses[0];
    await chrome.storage.local.set({
      addresses: ['a', 'b', 'c'].map((id) => ({ ...first, id, address: `${id}@example.com` })),
      activeAddressId: 'a',
      selectedEmail: 'a@example.com',
    });
  });
  await open(page, extensionId, 'mailbox');
  await tabTo(page, page.locator('#button-open-dropdown'));
  await page.keyboard.press('Enter');
  const rows = page.locator('[data-account-selector-pane] [data-marquee-id]');
  const first = page.locator('[data-account-selector-pane] [data-marquee-id="a"]');
  const control = first.locator('button, [role="button"][tabindex="0"]').first();
  await tabTo(page, control);
  await page.keyboard.press('Alt+Shift+ArrowDown');
  await expect
    .poll(() =>
      rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-marquee-id')))
    )
    .toEqual(['b', 'a', 'c']);
  await expect(control).toBeFocused();
});

test('vertical pane resizing and RTL horizontal resizing follow their orientation', async ({
  extensionPage: page,
  extensionId,
}) => {
  await open(page, extensionId, 'mailbox', 'app', 1000);
  const vertical = page.getByRole('slider', { name: 'Resize panes', exact: true });
  await tabTo(page, vertical);
  await expect(vertical).toHaveAttribute('aria-orientation', 'vertical');
  await page.keyboard.press('Home');
  const before = Number(await vertical.getAttribute('aria-valuenow'));
  await page.keyboard.press('Shift+ArrowDown');
  await expect
    .poll(async () => Number(await vertical.getAttribute('aria-valuenow')))
    .toBe(before + 50);
  await open(page, extensionId, 'mailbox', 'app', 1440);
  // Exercise the direction branch without changing translated locator names.
  await page.evaluate(() => {
    document.documentElement.dir = 'rtl';
  });
  const horizontal = page.getByRole('slider', { name: 'Resize panes', exact: true });
  await tabTo(page, horizontal);
  await page.keyboard.press('Home');
  const width = Number(await horizontal.getAttribute('aria-valuenow'));
  await page.keyboard.press('ArrowLeft');
  await expect
    .poll(async () => Number(await horizontal.getAttribute('aria-valuenow')))
    .toBe(width + 10);
});
