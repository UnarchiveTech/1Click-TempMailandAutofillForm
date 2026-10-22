import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import en from '../../src/locales/en.json' with { type: 'json' };
import { expect, test } from './fixtures';
import { extensionUrl } from './preview-harness';

// Private backup files are supplied locally, never committed as test fixtures.
// Keep provider/AI/WebDAV endpoints unreachable during this restore audit.
test.use({ chromiumArgs: ['--host-resolver-rules=MAP * ~NOTFOUND'] });

test('local backup restores through the real import dialog', async ({ context, extensionId }) => {
  test.skip(!process.env.BACKUP_AUDIT_FILE, 'Set BACKUP_AUDIT_FILE to a local backup to audit.');
  test.setTimeout(120_000);
  const file = path.resolve(process.env.BACKUP_AUDIT_FILE || '');
  const backup = JSON.parse(await readFile(file, 'utf8'));
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.name));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(extensionUrl(extensionId, 'app.html'));
  await page.evaluate(async () =>
    chrome.storage.local.set({ developerSettings: { enableLogging: true } })
  );
  await page.reload();
  await page.getByRole('button', { name: en.backup.importTitle, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: en.backup.importTitle, exact: true });
  await expect(dialog).toBeVisible();
  await dialog.locator('input[type="file"]').setInputFiles(file);
  await expect(dialog.getByText(en.backup.chooseWhatToImport, { exact: true })).toBeVisible();
  const output = path.resolve('audit/backup-import-local');
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: path.join(output, 'preview.png'), animations: 'disabled' });
  await dialog.getByRole('button', { name: en.common.continue, exact: true }).click();
  await expect(dialog.getByText(en.backup.confirmTitle, { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: en.backup.importAction, exact: true }).click();
  await expect(dialog.getByText(en.backup.importComplete, { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await page.screenshot({ path: path.join(output, 'complete.png'), animations: 'disabled' });
  const audit = await page.evaluate(async (expected) => {
    const storage = await chrome.storage.local.get(null);
    const addresses = storage.addresses || [];
    const index = storage.emailStorageAddressIndex || {};
    const recordDifferences = (name: 'identities' | 'loginInfo', excluded: string[]) => {
      const differences: Record<string, number> = {};
      for (const source of expected[name] || []) {
        const actual = (storage[name] || []).find((item: { id: string }) => item.id === source.id);
        for (const field of Object.keys(source)) {
          if (excluded.includes(field)) continue;
          if (JSON.stringify(actual?.[field]) !== JSON.stringify(source[field]))
            differences[field] = (differences[field] || 0) + 1;
        }
      }
      return differences;
    };
    const comparisons = Object.entries(expected.storedEmails || {}).map(([owner, input]) => {
      const id = Object.keys(index).find((key) => index[key].toLowerCase() === owner.toLowerCase());
      const actual = storage[`storedEmailsByAddress_${encodeURIComponent(id || '')}`] || [];
      const originals = input as Array<Record<string, unknown>>;
      const byId = new Map(
        actual.map((message: Record<string, unknown>) => [String(message.id), message])
      );
      const mismatches: Record<string, number> = {};
      for (const source of originals) {
        const restored = byId.get(String(source.id)) as Record<string, unknown> | undefined;
        if (!restored) {
          mismatches.missing = (mismatches.missing || 0) + 1;
          continue;
        }
        for (const field of Object.keys(source)) {
          if (JSON.stringify(restored[field]) !== JSON.stringify(source[field]))
            mismatches[field] = (mismatches[field] || 0) + 1;
        }
      }
      return { expected: originals.length, actual: actual.length, mismatches };
    });
    return {
      expectedAddresses: expected.addresses?.length || 0,
      actualAddresses: addresses.length,
      identities: (storage.identities || []).length,
      logins: (storage.loginInfo || []).length,
      identityDifferences: recordDifferences('identities', ['customPassword']),
      loginDifferences: recordDifferences('loginInfo', ['password', 'totpSecret']),
      droppedLoginPasswords: (expected.loginInfo || []).filter(
        (source: { id: string; password?: string }) =>
          source.password &&
          !(storage.loginInfo || []).find(
            (item: { id: string; password?: string }) => item.id === source.id
          )?.password
      ).length,
      selectedIdentityRetained: storage.selectedIdentityId === expected.selectedIdentityId,
      selectedProviderRetained: storage.selectedProvider === expected.selectedProvider,
      languageRetained: storage.preferredLanguage === expected.preferredLanguage,
      activeAddressValid: addresses.some(
        (address: { id: string }) => address.id === storage.activeAddressId
      ),
      comparisons,
      totalEmails: comparisons.reduce((sum, bag) => sum + bag.actual, 0),
      cachedOtps: Object.keys(index)
        .flatMap((id) => storage[`storedEmailsByAddress_${encodeURIComponent(id)}`] || [])
        .filter((message: { otp?: string }) => !!message.otp).length,
    };
  }, backup.data);
  await writeFile(
    path.join(output, 'result.json'),
    JSON.stringify({ audit, runtimeErrors: errors }, null, 2)
  );
  console.log(JSON.stringify({ audit, runtimeErrors: errors }));
  expect(audit.actualAddresses).toBe(audit.expectedAddresses);
  expect(audit.identities).toBe(backup.data.identities?.length || 0);
  expect(audit.logins).toBe(backup.data.loginInfo?.length || 0);
  expect(audit.identityDifferences).toEqual({});
  expect(audit.loginDifferences).toEqual({});
  expect(audit.selectedIdentityRetained).toBe(true);
  expect(audit.selectedProviderRetained).toBe(true);
  expect(audit.languageRetained).toBe(true);
  expect(audit.activeAddressValid).toBe(true);
  for (const bag of audit.comparisons) {
    expect(bag.actual).toBe(bag.expected);
    expect(bag.mismatches).toEqual({});
  }
  expect(errors).toEqual([]);
  await dialog.getByRole('button', { name: en.common.close, exact: true }).click();
  await page.goto(extensionUrl(extensionId, 'app.html?view=mailbox'));
  await expect(page.locator('[data-mainview]')).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const state = await chrome.storage.local.get(null);
        return Object.entries(state)
          .filter(([key]) => key.startsWith('storedEmailsByAddress_'))
          .reduce((sum, [, value]) => sum + (Array.isArray(value) ? value.length : 0), 0);
      })
    )
    .toBe(0);
  const start = Date.now();
  const rescan = await page.evaluate(async () =>
    chrome.runtime.sendMessage({ type: 'rescanEmailsForDetection', includeArchived: true })
  );
  expect(rescan.success).toBe(true);
  expect(rescan.scanned).toBe(audit.totalEmails);
  const detection = await page.evaluate(async (expected) => {
    const state = await chrome.storage.local.get(null);
    const index = state.emailStorageAddressIndex || {};
    let otps = 0,
      invalidatedCachedOtps = 0,
      links = 0,
      mismatches = 0,
      count = 0;
    for (const [owner, source] of Object.entries(expected.storedEmails || {})) {
      const id = Object.keys(index).find((key) => index[key].toLowerCase() === owner.toLowerCase());
      const bag = [
        ...(state[`storedEmailsByAddress_${encodeURIComponent(id || '')}`] || []),
        ...(state[`archivedEmailsByAddress_${encodeURIComponent(id || '')}`] || []),
      ];
      count += bag.length;
      for (const original of source as Array<{ id: string; otp?: string }>) {
        const message = bag.find((item: { id: string }) => String(item.id) === String(original.id));
        if (message?.otp && message.otp !== original.otp) mismatches++;
        if (original.otp && !message?.otp) invalidatedCachedOtps++;
        if (message?.otp) otps++;
        if (message?.magicLinks?.length) links++;
      }
    }
    const bagCounts = Object.entries(state)
      .filter(
        ([key]) =>
          key.startsWith('storedEmailsByAddress_') || key.startsWith('archivedEmailsByAddress_')
      )
      .map(([key, value]) => ({
        archived: key.startsWith('archived'),
        count: Array.isArray(value) ? value.length : -1,
      }));
    return {
      count,
      otps,
      invalidatedCachedOtps,
      linkMessages: links,
      otpMismatches: mismatches,
      bagCounts,
    };
  }, backup.data);
  const detectionMs = Date.now() - start;
  console.log({ detection });
  expect(detection.count).toBe(audit.totalEmails);
  expect(detection.otps + detection.invalidatedCachedOtps).toBe(audit.cachedOtps);
  expect(detection.otpMismatches).toBe(0);
  expect(detectionMs).toBeLessThan(5000);
  await page.screenshot({ path: path.join(output, 'mailbox.png'), animations: 'disabled' });
  await writeFile(
    path.join(output, 'result.json'),
    JSON.stringify({ audit, detection, detectionMs, runtimeErrors: errors }, null, 2)
  );
  console.log(JSON.stringify({ detection, detectionMs }));
  await page.close();
});
