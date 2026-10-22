import { afterAll, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// reencryptCiphertextStores lives in crypto.ts, which imports wxt/browser at
// module load - provide an inert in-memory mock (the utility itself never
// touches storage).
const sessionStore: Record<string, unknown> = {};

mock.module('wxt/browser', () => ({
  browser: {
    storage: {
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      session: {
        get: async (keys?: string | string[] | null) => {
          if (keys === null || keys === undefined) return { ...sessionStore };
          const list = Array.isArray(keys) ? keys : [keys];
          const result: Record<string, unknown> = {};
          for (const key of list) if (key in sessionStore) result[key] = sessionStore[key];
          return result;
        },
        set: async (items: Record<string, unknown>) => {
          Object.assign(sessionStore, items);
        },
        remove: async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete sessionStore[key];
        },
      },
    },
    runtime: { id: 'test-extension' },
  },
}));

const {
  decryptWithKey,
  encryptWithKey,
  inspectCiphertextStores,
  looksLikeCiphertext,
  reencryptCiphertextStores,
} = await import('@/utils/security/crypto.js');

const sourceKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
  'encrypt',
  'decrypt',
]);
const targetKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
  'encrypt',
  'decrypt',
]);
const otherKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
  'encrypt',
  'decrypt',
]);

describe('reencryptCiphertextStores', () => {
  test('an explicit ciphertext marker is authoritative even when valid bytes look printable', async () => {
    // Fixed test key/nonce and plaintext "sid"; never used for production data.
    const fixtureKey = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(32),
      { name: 'AES-GCM' },
      true,
      ['encrypt', 'decrypt']
    );
    const ciphertext = 'QUFBQUFBQUFBQUFBKQrgX2v+s2iWKe5jXAmQY3xxAQ==';
    expect(looksLikeCiphertext(ciphertext)).toBe(false);
    await expect(decryptWithKey(ciphertext, fixtureKey)).resolves.toBe('sid');
    const data = { addresses: [{ sidToken: `_enc_:${ciphertext}` }] };
    expect(await inspectCiphertextStores(data, fixtureKey)).toEqual({
      migratable: 1,
      undecryptable: 0,
    });
    expect(await inspectCiphertextStores(data, null)).toEqual({ migratable: 1, undecryptable: 0 });
    expect(await inspectCiphertextStores(data, otherKey)).toEqual({
      migratable: 0,
      undecryptable: 1,
    });
    const result = await reencryptCiphertextStores(data, fixtureKey, targetKey);
    expect(result.swapped).toBe(1);
    expect(result.leftUntouched).toBe(0);
    const migrated = (result.data.addresses as Array<{ sidToken: string }>)[0].sidToken;
    await expect(decryptWithKey(migrated.slice('_enc_:'.length), targetKey)).resolves.toBe('sid');
  });

  test('a malformed explicitly marked ciphertext is counted as a failure, not legacy plaintext', async () => {
    const data = { aiApiKey: '_enc_:not-ciphertext' };
    expect(await inspectCiphertextStores(data, sourceKey)).toEqual({
      migratable: 0,
      undecryptable: 1,
    });
    const result = await reencryptCiphertextStores(data, sourceKey, targetKey);
    expect(result.leftUntouched).toBe(1);
    expect(result.swapped).toBe(0);
    expect(result.data).toEqual(data);
  });
  test('swaps every master-key ciphertext store and preserves _enc_: prefixes', async () => {
    const input = {
      loginInfo: [{ domain: 'x.com', password: await encryptWithKey('login-pw', sourceKey) }],
      identities: [{ id: 'i1', customPassword: await encryptWithKey('custom-pw', sourceKey) }],
      addresses: [
        {
          id: 'b1',
          token: `_enc_:${await encryptWithKey('tok', sourceKey)}`,
          sidToken: `_enc_:${await encryptWithKey('sid', sourceKey)}`,
        },
      ],
      passwordSettings: {
        useCustom: true,
        customPassword: await encryptWithKey('ps-pw', sourceKey),
      },
      aiApiKey: `_enc_:${await encryptWithKey('ai-key', sourceKey)}`,
      webdavConfig: {
        url: 'https://dav.example.com',
        passwordEnc: `_enc_:${await encryptWithKey('dav-pw', sourceKey)}`,
        backupPasswordEnc: `_enc_:${await encryptWithKey('backup-pw', sourceKey)}`,
      },
      // Unrelated keys ride along untouched.
      themeMode: 'dark',
    };

    const result = await reencryptCiphertextStores(input, sourceKey, targetKey);
    expect(result.swapped).toBe(8);
    expect(result.leftUntouched).toBe(0);

    const data = result.data;
    expect(data.themeMode).toBe('dark');
    await expect(
      decryptWithKey((data.loginInfo as { password: string }[])[0].password, targetKey)
    ).resolves.toBe('login-pw');
    await expect(
      decryptWithKey((data.identities as { customPassword: string }[])[0].customPassword, targetKey)
    ).resolves.toBe('custom-pw');
    const record = (data.addresses as { token: string; sidToken: string }[])[0];
    expect(record.token.startsWith('_enc_:')).toBe(true);
    await expect(decryptWithKey(record.token.slice('_enc_:'.length), targetKey)).resolves.toBe(
      'tok'
    );
    await expect(decryptWithKey(record.sidToken.slice('_enc_:'.length), targetKey)).resolves.toBe(
      'sid'
    );
    await expect(
      decryptWithKey(
        (data.passwordSettings as { customPassword: string }).customPassword,
        targetKey
      )
    ).resolves.toBe('ps-pw');

    // aiApiKey + WebDAV secrets are migrated and keep their `_enc_:` prefix.
    expect(data.aiApiKey).toMatch(/^_enc_:/);
    await expect(
      decryptWithKey((data.aiApiKey as string).slice('_enc_:'.length), targetKey)
    ).resolves.toBe('ai-key');
    const wc = data.webdavConfig as { passwordEnc: string; backupPasswordEnc: string };
    expect(wc.passwordEnc.startsWith('_enc_:')).toBe(true);
    expect(wc.backupPasswordEnc.startsWith('_enc_:')).toBe(true);
    await expect(decryptWithKey(wc.passwordEnc.slice('_enc_:'.length), targetKey)).resolves.toBe(
      'dav-pw'
    );
    await expect(
      decryptWithKey(wc.backupPasswordEnc.slice('_enc_:'.length), targetKey)
    ).resolves.toBe('backup-pw');

    // The old source key can no longer decrypt them (fresh ciphertext).
    await expect(
      decryptWithKey((data.loginInfo as { password: string }[])[0].password, sourceKey)
    ).rejects.toThrow();
  });

  test('never mutates its input', async () => {
    const input = {
      loginInfo: [{ domain: 'x.com', password: await encryptWithKey('pw', sourceKey) }],
    };
    const snapshot = JSON.stringify(input);
    await reencryptCiphertextStores(input, sourceKey, targetKey);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  test('passes legacy plaintext values through untouched', async () => {
    const input = {
      loginInfo: [{ domain: 'x.com', password: 'plain' }],
      identities: [{ id: 'i1', customPassword: 'plain' }],
      addresses: [{ id: 'b1', token: 'plain-token' }],
      aiApiKey: 'sk-plaintext',
      webdavConfig: { passwordEnc: 'plain-pw', backupPasswordEnc: 'plain-bk' },
    };
    const result = await reencryptCiphertextStores(input, sourceKey, targetKey);
    expect(result.swapped).toBe(0);
    expect(result.leftUntouched).toBe(0);
    expect(result.data).toEqual(input);
  });

  test('values that fail to decrypt with the source key are left untouched and counted', async () => {
    const foreign = await encryptWithKey('secret', otherKey); // NOT sourceKey
    const foreignPrefixed = `_enc_:${foreign}`;
    const input = {
      loginInfo: [{ domain: 'x.com', password: foreign }],
      identities: [{ id: 'i1', customPassword: await encryptWithKey('ok', sourceKey) }],
      aiApiKey: foreignPrefixed,
      webdavConfig: { passwordEnc: foreignPrefixed },
    };
    const result = await reencryptCiphertextStores(input, sourceKey, targetKey);
    expect(result.leftUntouched).toBe(3);
    expect(result.swapped).toBe(1);
    expect((result.data.loginInfo as { password: string }[])[0].password).toBe(foreign);
    expect(result.data.aiApiKey).toBe(foreignPrefixed);
    expect((result.data.webdavConfig as { passwordEnc: string }).passwordEnc).toBe(foreignPrefixed);
    await expect(
      decryptWithKey(
        (result.data.identities as { customPassword: string }[])[0].customPassword,
        targetKey
      )
    ).resolves.toBe('ok');
  });

  test('handles missing/empty stores and undefined values', async () => {
    const result = await reencryptCiphertextStores({}, sourceKey, targetKey);
    expect(result.swapped).toBe(0);
    expect(result.leftUntouched).toBe(0);
    expect(result.data).toEqual({});

    const withNulls = {
      loginInfo: [{ domain: 'x.com', password: undefined }],
      passwordSettings: { customPassword: null },
    };
    const r2 = await reencryptCiphertextStores(withNulls, sourceKey, targetKey);
    expect(r2.leftUntouched).toBe(0);
    expect((r2.data.loginInfo as { password?: string }[])[0].password).toBeUndefined();
  });
});
