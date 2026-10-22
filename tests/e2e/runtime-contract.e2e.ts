/** Shared transport contract, also checked against native Chromium APIs. */
import { expect, test } from './fixtures';
import { extensionUrl } from './preview-harness';
import { demoSeedStorage } from './seed';

test('runtime uses production handlers for stored data and rejects invalid provider changes', async ({
  extensionPage: page,
}) => {
  const seed = [
    {
      ...demoSeedStorage().addresses[0],
      id: 'runtime-contract-inbox',
      address: 'contract@example.com',
    },
  ];
  await page.evaluate((addresses) => chrome.storage.local.set({ addresses }), seed);
  const actual = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'getAddresses' }));
  expect(actual).toEqual({ success: true, addresses: seed });
  const rejected = await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'setProvider', provider: 'nonexistent-e2e-provider' })
  );
  expect(rejected.success).toBe(false);
  expect(rejected.error).toBeTruthy();
});

test('storage shares changes between shells and preserves null defaults and separate areas', async ({
  extensionPage: page,
  context,
  extensionId,
}) => {
  const observer = await context.newPage();
  try {
    await observer.goto(extensionUrl(extensionId, 'app.html'));
    await observer.evaluate(() => {
      const events: unknown[] = [];
      (globalThis as unknown as { __storageEvents: unknown[] }).__storageEvents = events;
      chrome.storage.onChanged.addListener(
        (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => {
          if ('e2eContract' in changes) events.push({ area, change: changes.e2eContract });
        }
      );
    });
    await page.evaluate(async () => {
      await chrome.storage.local.set({ e2eContract: null });
      await chrome.storage.session.set({ e2eContract: 'session' });
    });
    await expect
      .poll(() =>
        observer.evaluate(
          () => (globalThis as unknown as { __storageEvents: unknown[] }).__storageEvents
        )
      )
      .toEqual([
        { area: 'local', change: { newValue: null } },
        { area: 'session', change: { newValue: 'session' } },
      ]);
    expect(
      await observer.evaluate(() =>
        chrome.storage.local.get({ e2eContract: 'fallback', absent: 'default' })
      )
    ).toEqual({ e2eContract: null, absent: 'default' });
    expect(await observer.evaluate(() => chrome.storage.session.get('e2eContract'))).toEqual({
      e2eContract: 'session',
    });
    await page.evaluate(() => chrome.storage.local.remove('e2eContract'));
    await expect
      .poll(() => observer.evaluate(() => chrome.storage.local.get('e2eContract')))
      .toEqual({});
  } finally {
    await observer.close();
  }
});
