import { expect, test } from './fixtures';
import { extensionUrl } from './preview-harness';

test('unread badge rejects pre-fix cached counts for colliding message IDs', async ({
  extensionPage: page,
}) => {
  await page.evaluate(async () => {
    const { addresses } = await chrome.storage.local.get('addresses');
    const first = addresses[0];
    const message = {
      id: '42',
      from: 'sender@example.com',
      subject: 'Collision',
      received_at: Date.now(),
    };
    await chrome.storage.local.set({
      addresses: [first, { ...first, id: 'demo-inbox-2', address: 'second@example.com' }],
      emailStorageAddressIndex: { [first.id]: first.address, 'demo-inbox-2': 'second@example.com' },
      [`storedEmailsByAddress_${first.id}`]: [{ ...message, original_inbox: first.address }],
      'storedEmailsByAddress_demo-inbox-2': [{ ...message, original_inbox: 'second@example.com' }],
      readEmails: { '42': true, [`${first.address}_42`]: true },
      emailStorageMetadata: {
        [first.id]: { messageCount: 1, unreadCount: 0, revision: 1 },
        'demo-inbox-2': { messageCount: 1, unreadCount: 0, revision: 1 },
      },
    });
  });
  await expect
    .poll(async () => page.evaluate(async () => chrome.action.getBadgeText({})))
    .toBe('1');
});

test('a popup mutation invalidates an app tab snapshot undo', async ({
  extensionPage: app,
  context,
  extensionId,
}) => {
  await app.evaluate(async () => {
    const { addresses } = await chrome.storage.local.get('addresses');
    const first = addresses[0];
    await chrome.storage.local.set({
      addresses: [first, { ...first, id: 'demo-inbox-2', address: 'second@example.com' }],
      emailStorageAddressIndex: { [first.id]: first.address, 'demo-inbox-2': 'second@example.com' },
      'storedEmailsByAddress_demo-inbox-2': [],
    });
  });
  await app.setViewportSize({ width: 1000, height: 800 });
  await app.goto(extensionUrl(extensionId, 'app.html?view=addresses'));
  await app.getByRole('button', { name: 'Select demo.user@example.com', exact: true }).click();
  await app
    .locator('[data-selection-strip]')
    .getByRole('button', { name: 'Archive', exact: true })
    .click();
  const undo = app.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeVisible();
  const firstToken = await app.evaluate(
    async () => (await chrome.storage.local.get('_undo_generation'))._undo_generation
  );
  expect(typeof firstToken).toBe('string');

  const popup = await context.newPage();
  try {
    await popup.setViewportSize({ width: 360, height: 600 });
    await popup.goto(extensionUrl(extensionId, 'popup.html?view=addresses'));
    await popup.getByRole('button', { name: 'Select second@example.com', exact: true }).click();
    await popup
      .locator('[data-selection-strip]')
      .getByRole('button', { name: 'Archive', exact: true })
      .click();
    await expect(popup.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
    await expect
      .poll(async () =>
        app.evaluate(
          async () => (await chrome.storage.local.get('_undo_generation'))._undo_generation
        )
      )
      .not.toBe(firstToken);
    await undo.click();
    await expect(
      app
        .locator('p')
        .filter({ hasText: 'A newer change replaced that action - nothing was undone' })
    ).toBeVisible();
    const statuses = await app.evaluate(async () =>
      (await chrome.storage.local.get('addresses')).addresses.map(
        (address: { accountStatus: string }) => address.accountStatus
      )
    );
    expect(statuses).toEqual(['archived', 'archived']);
  } finally {
    await popup.close();
  }
});
