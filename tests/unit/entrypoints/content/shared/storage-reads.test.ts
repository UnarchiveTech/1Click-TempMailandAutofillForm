/**
 * Guarded single-key storage readers for content scripts (`shared/storage-reads.ts`).
 *
 * The production hazard these pin down: every single-key value a content script
 * reads arrives through the content bridge as untrusted data, and each call site
 * used to assert its own shape. A destructuring default covers only `undefined`
 * - `const { passwordSettings = {} } = …` yields `null` for a stored `null`, so
 * `passwordSettings.useCustom` threw a TypeError inside the fill path (autofill
 * died mid-form), and `nameSettings` had the identical hole. The rest of the
 * sites disagreed about defaults: `otpOptInList` trusted a non-array through
 * `.some`, `selectedProvider` forwarded junk as an explicit provider, and
 * `customPassword` was probed on a side that never receives it (the background
 * redacts the ciphertext and sets `hasCustomPassword` instead).
 *
 * These tests drive the REAL bridge (mock at `wxt/browser`), so they cover the
 * whole path: storage → bridge → accessor → consumer.
 */

import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test';

type StorageShape = Record<string, unknown>;

const storageState: { data: StorageShape } = { data: {} };

mock.module('wxt/browser', () => ({
  browser: {
    runtime: {
      sendMessage: (message: Record<string, unknown>) => {
        if (message.type === 'getStorageViaBg') {
          return { success: true, data: { ...storageState.data } };
        }
        if (message.type === 'generateIdentityField') {
          return { success: true, value: 'Ada Lovelace' };
        }
        if (message.type === 'decryptStoredCustomPassword') {
          return { success: true, decrypted: 'decrypted-from-background' };
        }
        return { success: true };
      },
    },
  },
}));

afterAll(() => {
  mock.restore();
});

const {
  readAutofillFeatureEnabled,
  readLoginInfo,
  readNameSettings,
  readOtpOptInList,
  readPasswordSettings,
  readSelectedProvider,
} = await import('@/entrypoints/content/shared/storage-reads.js');
const { getNamesToFill, getPasswordToFill, isEmailUsedInSavedLogins } = await import(
  '@/entrypoints/content/autofill/form-filler.js'
);

afterEach(() => {
  storageState.data = {};
});

describe('readPasswordSettings', () => {
  test('healthy redacted settings pass through', async () => {
    storageState.data = { passwordSettings: { useCustom: true, hasCustomPassword: true } };
    expect(await readPasswordSettings()).toEqual({ useCustom: true, hasCustomPassword: true });
  });

  test('a legacy/unredacted ciphertext still counts as "one exists"', async () => {
    // When the redaction step did not run, the content side sees the raw field.
    // Both signals fold into the same boolean so the two reads cannot drift.
    storageState.data = { passwordSettings: { useCustom: true, customPassword: 'enc:abc' } };
    expect(await readPasswordSettings()).toEqual({ useCustom: true, hasCustomPassword: true });
  });

  test('useCustom without a stored password is NOT a custom password', async () => {
    storageState.data = { passwordSettings: { useCustom: true, hasCustomPassword: false } };
    expect(await readPasswordSettings()).toEqual({ useCustom: true, hasCustomPassword: false });
    storageState.data = { passwordSettings: { useCustom: true, customPassword: '' } };
    expect(await readPasswordSettings()).toEqual({ useCustom: true, hasCustomPassword: false });
  });

  test('a stored `null` degrades instead of throwing (the old TypeError)', async () => {
    storageState.data = { passwordSettings: null };
    expect(await readPasswordSettings()).toEqual({ useCustom: false, hasCustomPassword: false });
  });

  test('corrupt values of every kind degrade to "no custom password"', async () => {
    for (const corrupt of [
      'garbage',
      42,
      [],
      true,
      { useCustom: 'yes', hasCustomPassword: 'yes' },
    ]) {
      storageState.data = { passwordSettings: corrupt };
      expect(await readPasswordSettings()).toEqual({ useCustom: false, hasCustomPassword: false });
    }
    storageState.data = {};
    expect(await readPasswordSettings()).toEqual({ useCustom: false, hasCustomPassword: false });
  });
});

describe('readNameSettings', () => {
  test('healthy settings pass through, trimmed', async () => {
    storageState.data = {
      nameSettings: { useCustom: true, firstName: ' Ada ', lastName: ' Lovelace ' },
    };
    expect(await readNameSettings()).toEqual({
      useCustom: true,
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
  });

  test('a stored `null` degrades instead of throwing', async () => {
    storageState.data = { nameSettings: null };
    expect(await readNameSettings()).toEqual({ useCustom: false, firstName: '', lastName: '' });
  });

  test('whitespace-only and non-string names read as absent', async () => {
    // `useCustom` is reported as stored; it is the CALLER that additionally
    // requires both names to be non-empty before filling them.
    storageState.data = { nameSettings: { useCustom: true, firstName: '   ', lastName: 42 } };
    expect(await readNameSettings()).toEqual({ useCustom: true, firstName: '', lastName: '' });
    storageState.data = { nameSettings: 'garbage' };
    expect(await readNameSettings()).toEqual({ useCustom: false, firstName: '', lastName: '' });
  });

  test('a non-boolean useCustom is not trusted', async () => {
    storageState.data = { nameSettings: { useCustom: 'true', firstName: 'A', lastName: 'B' } };
    expect(await readNameSettings()).toEqual({ useCustom: false, firstName: 'A', lastName: 'B' });
  });
});

describe('readLoginInfo', () => {
  test('a healthy list passes through unchanged', async () => {
    const entries = [{ id: 'l1', email: 'a@x.com', domain: 'x.com', timestamp: 1 }];
    storageState.data = { loginInfo: entries };
    expect(await readLoginInfo()).toEqual(entries);
  });

  test('a corrupt list is the empty list, never a throw', async () => {
    for (const corrupt of [null, 'garbage', 42, { 0: 'not-an-array' }]) {
      storageState.data = { loginInfo: corrupt };
      expect(await readLoginInfo()).toEqual([]);
    }
    storageState.data = {};
    expect(await readLoginInfo()).toEqual([]);
  });
});

describe('readSelectedProvider', () => {
  test('a real provider id passes through', async () => {
    storageState.data = { selectedProvider: 'gmail' };
    expect(await readSelectedProvider()).toBe('gmail');
  });

  test('an absent or garbage provider is "" so the background picks its default', async () => {
    for (const corrupt of [undefined, null, 42, {}, ['gmail'], '   ']) {
      storageState.data = { selectedProvider: corrupt };
      expect(await readSelectedProvider()).toBe('');
    }
  });
});

describe('readAutofillFeatureEnabled', () => {
  test('unset means ON (the shipped default)', async () => {
    storageState.data = {};
    expect(await readAutofillFeatureEnabled()).toBe(true);
  });

  test('only an explicit false disables it', async () => {
    storageState.data = { autofillFeatureEnabled: false };
    expect(await readAutofillFeatureEnabled()).toBe(false);
    storageState.data = { autofillFeatureEnabled: true };
    expect(await readAutofillFeatureEnabled()).toBe(true);
  });

  test('garbage never disables autofill', async () => {
    for (const corrupt of ['false', 0, null, {}]) {
      storageState.data = { autofillFeatureEnabled: corrupt };
      expect(await readAutofillFeatureEnabled()).toBe(true);
    }
  });
});

describe('readOtpOptInList', () => {
  test('a healthy list passes through unchanged', async () => {
    storageState.data = { otpOptInList: ['example.com', 'shop.test'] };
    expect(await readOtpOptInList()).toEqual(['example.com', 'shop.test']);
  });

  test('a corrupt list is the empty list - never opted in', async () => {
    for (const corrupt of [null, 'example.com', 42, {}]) {
      storageState.data = { otpOptInList: corrupt };
      expect(await readOtpOptInList()).toEqual([]);
    }
  });

  test('non-string entries are dropped', async () => {
    storageState.data = { otpOptInList: ['example.com', 42, null, { host: 'x.test' }, 'ok.test'] };
    expect(await readOtpOptInList()).toEqual(['example.com', 'ok.test']);
  });
});

// ---------------------------------------------------------------------------
// Consumer-level regressions: the accessors exist so the fill path survives the
// corrupt storage the individual sites used to throw on.
// ---------------------------------------------------------------------------

describe('fill-path consumers on corrupt storage', () => {
  test('getNamesToFill survives `nameSettings: null` (previously a TypeError)', async () => {
    storageState.data = { nameSettings: null };
    expect(await getNamesToFill()).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
      fullName: 'Ada Lovelace',
    });
  });

  test('getNamesToFill uses a stored custom name', async () => {
    storageState.data = {
      nameSettings: { useCustom: true, firstName: 'Grace', lastName: 'Hopper' },
    };
    expect(await getNamesToFill()).toEqual({
      firstName: 'Grace',
      lastName: 'Hopper',
      fullName: 'Grace Hopper',
    });
  });

  test('getPasswordToFill asks the background to decrypt when one exists', async () => {
    storageState.data = { passwordSettings: { useCustom: true, hasCustomPassword: true } };
    expect(await getPasswordToFill()).toBe('decrypted-from-background');
  });

  test('isEmailUsedInSavedLogins survives `loginInfo: null`', async () => {
    storageState.data = { loginInfo: null };
    expect(await isEmailUsedInSavedLogins('a@x.com')).toBe(false);
  });
});
