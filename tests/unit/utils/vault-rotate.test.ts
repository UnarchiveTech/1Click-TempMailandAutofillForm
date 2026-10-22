import { afterAll, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// Same in-memory storage harness as vault-rekey.test.ts.
const localStorage: Record<string, unknown> = {};
const sessionStorage: Record<string, unknown> = {};
const testWebLocks = (globalThis.navigator as unknown as { locks?: unknown }).locks;

function readStorage(store: Record<string, unknown>, keys?: string | string[]) {
  const requestedKeys = typeof keys === 'string' ? [keys] : keys || Object.keys(store);
  return Object.fromEntries(
    requestedKeys.flatMap((key) => (key in store ? [[key, store[key]]] : []))
  );
}

function removeStorage(store: Record<string, unknown>, keys: string | string[]) {
  for (const key of typeof keys === 'string' ? [keys] : keys) {
    delete store[key];
  }
}

function resetStorage() {
  for (const store of [localStorage, sessionStorage]) {
    for (const key of Object.keys(store)) delete store[key];
  }
}

mock.module('wxt/browser', () => ({
  browser: {
    runtime: { id: 'test-extension' },
    storage: {
      local: {
        get: async (keys?: string | string[]) => readStorage(localStorage, keys),
        remove: async (keys: string | string[]) => removeStorage(localStorage, keys),
        set: async (values: Record<string, unknown>) => Object.assign(localStorage, values),
      },
      session: {
        get: async (keys?: string | string[]) => readStorage(sessionStorage, keys),
        remove: async (keys: string | string[]) => removeStorage(sessionStorage, keys),
        set: async (values: Record<string, unknown>) => Object.assign(sessionStorage, values),
      },
    },
  },
}));

const {
  clearCachedMasterKey,
  ARGON2ID_KDF,
  decryptMasterKeyWithPassword,
  decryptWithKey,
  encrypt,
  encryptMasterKeyWithPassword,
  encryptWithKey,
  getOrCreateMasterKey,
  MASTER_KEY_ID,
} = await import('@/utils/security/crypto.js');
const {
  cancelVaultRekey,
  lockVault,
  preflightVaultReKey,
  rotateVaultKey,
  setupMasterPassword,
  verifyVaultRekey,
} = await import('@/utils/storage/vault-lock.js');

const VAULT_CONFIG_KEY = 'vault_security_config';
const BACKUP_KEY = 'vault_security_config_backup';
const OLD_KEY_SESSION = 'vault_rekey_old_key';
const NEW_KEY_SESSION = 'vault_rekey_new_key';

async function seedStores() {
  await getOrCreateMasterKey();
  localStorage.passwordSettings = { useCustom: true, customPassword: await encrypt('ps-pw') };
  localStorage.addresses = [
    {
      id: 'i1',
      address: 'a@example.com',
      provider: 'guerrilla',
      token: `_enc_:${await encrypt('tok-1')}`,
      sidToken: `_enc_:${await encrypt('sid-1')}`,
    },
  ];
  localStorage.loginInfo = [
    { domain: 'example.com', email: 'x@example.com', password: await encrypt('login-pw') },
  ];
  localStorage.identities = [
    { id: 'id1', name: 'One', customPassword: await encrypt('identity-pw') },
  ];
  localStorage.aiApiKey = `_enc_:${await encrypt('ai-key')}`;
  localStorage.webdavConfig = {
    url: 'https://dav.example.com',
    passwordEnc: `_enc_:${await encrypt('dav-pw')}`,
    backupPasswordEnc: `_enc_:${await encrypt('dav-bk-pw')}`,
  };
}

async function seedProtectedVault(password: string) {
  await seedStores();
  const ok = await setupMasterPassword(password);
  expect(ok).toBe(true);
}

/** Decrypt the CURRENT config's wrapped key with `password`, then the first login. */
async function decryptStoresWith(password: string): Promise<{
  login: string | null;
  aiKey: string | null;
  davPw: string | null;
  davBkPw: string | null;
}> {
  const config = localStorage[VAULT_CONFIG_KEY] as {
    mode: string;
    salt: string;
    encryptedMasterKey: string;
    kdf?: typeof ARGON2ID_KDF;
  };
  const keyJson = await decryptMasterKeyWithPassword(
    config.encryptedMasterKey,
    password,
    config.salt,
    config.kdf
  );
  if (!keyJson) return { login: null, aiKey: null, davPw: null, davBkPw: null };
  const key = await crypto.subtle.importKey(
    'jwk',
    JSON.parse(keyJson) as JsonWebKey,
    { name: 'AES-GCM' },
    true,
    ['encrypt', 'decrypt']
  );
  const login = await decryptWithKey(
    (localStorage.loginInfo as Array<{ password: string }>)[0].password,
    key
  );
  const wc = localStorage.webdavConfig as { passwordEnc: string; backupPasswordEnc: string };
  const aiKey = await decryptWithKey((localStorage.aiApiKey as string).slice('_enc_:'.length), key);
  const davPw = await decryptWithKey(wc.passwordEnc.slice('_enc_:'.length), key);
  const davBkPw = await decryptWithKey(wc.backupPasswordEnc.slice('_enc_:'.length), key);
  return { login, aiKey, davPw, davBkPw };
}

describe('preflightVaultReKey', () => {
  test('reports how many credentials will be migrated when unlocked', async () => {
    resetStorage();
    clearCachedMasterKey();
    await seedProtectedVault('pw');

    // 1 login + 1 identity + 2 inbox tokens + 1 settings password +
    // 1 AI key + 2 WebDAV passwords = 8.
    const preflight = await preflightVaultReKey();
    expect(preflight.checked).toBe(true);
    expect(preflight.migratable).toBe(8);
    expect(preflight.undecryptable).toBe(0);
  });

  test('flags values that cannot be decrypted', async () => {
    resetStorage();
    clearCachedMasterKey();
    await seedProtectedVault('pw');

    // Corrupt one login with ciphertext from an unrelated key.
    const otherKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ]);
    (localStorage.loginInfo as Array<{ password: string }>)[0].password = await encryptWithKey(
      'foreign',
      otherKey
    );

    const preflight = await preflightVaultReKey();
    expect(preflight.checked).toBe(true);
    expect(preflight.migratable).toBe(7);
    expect(preflight.undecryptable).toBe(1);
  });

  test('locked vault gives a structural count (checked: false)', async () => {
    resetStorage();
    clearCachedMasterKey();
    await seedProtectedVault('pw');
    await lockVault();

    const preflight = await preflightVaultReKey();
    expect(preflight.checked).toBe(false);
    expect(preflight.migratable).toBe(8);
    expect(preflight.undecryptable).toBe(0);
  });
});

describe('rotateVaultKey', () => {
  test('rotates onto a fresh key wrapped with the SAME password', async () => {
    resetStorage();
    clearCachedMasterKey();
    await seedProtectedVault('same-pw');
    const configBefore = localStorage[VAULT_CONFIG_KEY] as { encryptedMasterKey: string };

    const result = await rotateVaultKey({ currentPassword: 'same-pw' });
    expect(result.success).toBe(true);
    expect(result.migratable).toBe(8);

    // Same password still unwraps - but it's a DIFFERENT wrapped blob now.
    const config = localStorage[VAULT_CONFIG_KEY] as {
      mode: string;
      salt: string;
      encryptedMasterKey: string;
    };
    expect(config.mode).toBe('password');
    expect(config.encryptedMasterKey).not.toBe(configBefore.encryptedMasterKey);
    await expect(decryptStoresWith('same-pw')).resolves.toEqual({
      login: 'login-pw',
      aiKey: 'ai-key',
      davPw: 'dav-pw',
      davBkPw: 'dav-bk-pw',
    });
    // Raw key lives in SESSION only.
    expect(typeof sessionStorage[MASTER_KEY_ID]).toBe('string');
    expect(localStorage[MASTER_KEY_ID]).toBeUndefined();
  });

  test('rotation is refused on a standard (unprotected) vault', async () => {
    resetStorage();
    clearCachedMasterKey();
    await getOrCreateMasterKey();

    const result = await rotateVaultKey({ currentPassword: 'x' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('not-protected');
  });

  test('wrong current password on a locked vault is rejected', async () => {
    resetStorage();
    clearCachedMasterKey();
    await seedProtectedVault('same-pw');
    await lockVault();

    const result = await rotateVaultKey({ currentPassword: 'wrong-pw' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('invalid-current-password');
    expect(sessionStorage[MASTER_KEY_ID]).toBeUndefined();
  });

  test('full flow: rotate → fresh-lock verify → stash swept, same password still works', async () => {
    resetStorage();
    clearCachedMasterKey();
    await seedProtectedVault('same-pw');

    const rotated = await rotateVaultKey({ currentPassword: 'same-pw', prepareRollback: true });
    expect(rotated.success).toBe(true);
    expect(localStorage[BACKUP_KEY]).toBeDefined();

    const verify = await verifyVaultRekey('same-pw');
    expect(verify.success).toBe(true);
    expect(localStorage[BACKUP_KEY]).toBeUndefined();
    expect(sessionStorage[OLD_KEY_SESSION]).toBeUndefined();
    expect(sessionStorage[NEW_KEY_SESSION]).toBeUndefined();
    await expect(decryptStoresWith('same-pw')).resolves.toEqual({
      login: 'login-pw',
      aiKey: 'ai-key',
      davPw: 'dav-pw',
      davBkPw: 'dav-bk-pw',
    });
  });

  test('cancel after a rotation restores the pre-rotation wrapped config', async () => {
    resetStorage();
    clearCachedMasterKey();
    await seedProtectedVault('same-pw');
    const configBefore = localStorage[VAULT_CONFIG_KEY] as { encryptedMasterKey: string };

    const rotated = await rotateVaultKey({ currentPassword: 'same-pw', prepareRollback: true });
    expect(rotated.success).toBe(true);

    const { rolledBack } = await cancelVaultRekey();
    expect(rolledBack).toBe(true);
    const config = localStorage[VAULT_CONFIG_KEY] as { encryptedMasterKey: string };
    expect(config.encryptedMasterKey).toBe(configBefore.encryptedMasterKey);
    expect(localStorage[BACKUP_KEY]).toBeUndefined();
    await expect(decryptStoresWith('same-pw')).resolves.toEqual({
      login: 'login-pw',
      aiKey: 'ai-key',
      davPw: 'dav-pw',
      davBkPw: 'dav-bk-pw',
    });
  });
});

describe('rotateVaultKey - biometrics', () => {
  const PRF_SECRET = new Uint8Array(32).fill(7);
  const PRF_SECRET_HEX = Array.from(PRF_SECRET)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  function mockBiometricUnlock(secret: Uint8Array | null) {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        userAgent: 'test',
        locks: testWebLocks,
        credentials: {
          get: async () =>
            secret === null
              ? null
              : {
                  getClientExtensionResults: () => ({
                    prf: { results: { first: secret } },
                  }),
                },
        },
      },
      configurable: true,
      writable: true,
    });
  }

  async function seedBiometricVault() {
    const key = await getOrCreateMasterKey();
    localStorage.passwordSettings = { useCustom: true, customPassword: await encrypt('ps-pw') };
    localStorage.addresses = [
      {
        id: 'i1',
        address: 'a@example.com',
        provider: 'guerrilla',
        token: `_enc_:${await encrypt('tok-1')}`,
        sidToken: `_enc_:${await encrypt('sid-1')}`,
      },
    ];
    localStorage.loginInfo = [
      { domain: 'example.com', email: 'x@example.com', password: await encrypt('login-pw') },
    ];
    localStorage.identities = [
      { id: 'id1', name: 'One', customPassword: await encrypt('identity-pw') },
    ];
    localStorage.aiApiKey = `_enc_:${await encrypt('ai-key')}`;
    localStorage.webdavConfig = {
      url: 'https://dav.example.com',
      passwordEnc: `_enc_:${await encrypt('dav-pw')}`,
      backupPasswordEnc: `_enc_:${await encrypt('dav-bk-pw')}`,
    };

    const keyJson = JSON.stringify(await crypto.subtle.exportKey('jwk', key));
    const salt = 'ab'.repeat(16);
    const encryptedMasterKey = await encryptMasterKeyWithPassword(
      keyJson,
      PRF_SECRET_HEX,
      salt,
      ARGON2ID_KDF
    );
    localStorage[VAULT_CONFIG_KEY] = {
      mode: 'biometrics',
      salt,
      encryptedMasterKey,
      biometricCredentialId: 'aa'.repeat(16),
      kdf: ARGON2ID_KDF,
    };
    delete localStorage[MASTER_KEY_ID];
    delete sessionStorage[MASTER_KEY_ID];
  }

  test('rotates a biometrics vault with one prompt, keeping biometrics protection', async () => {
    resetStorage();
    clearCachedMasterKey();
    mockBiometricUnlock(PRF_SECRET);
    await seedBiometricVault();

    const result = await rotateVaultKey({ prepareRollback: true });
    expect(result.success).toBe(true);
    expect(result.migratable).toBe(8);

    const config = localStorage[VAULT_CONFIG_KEY] as {
      mode: string;
      salt: string;
      encryptedMasterKey: string;
      biometricCredentialId: string;
      kdf?: typeof ARGON2ID_KDF;
    };
    // Protection unchanged - same credential, same salt, fresh wrapped key.
    expect(config.mode).toBe('biometrics');
    expect(config.biometricCredentialId).toBe('aa'.repeat(16));
    expect(config.salt).toBe('ab'.repeat(16));

    // The fresh key unwraps with the PRF secret and decrypts the stores.
    const keyJson = await decryptMasterKeyWithPassword(
      config.encryptedMasterKey,
      PRF_SECRET_HEX,
      config.salt,
      config.kdf
    );
    expect(keyJson).not.toBeNull();
    const key = await crypto.subtle.importKey(
      'jwk',
      JSON.parse(keyJson as string) as JsonWebKey,
      { name: 'AES-GCM' },
      true,
      ['encrypt', 'decrypt']
    );
    await expect(
      decryptWithKey((localStorage.loginInfo as Array<{ password: string }>)[0].password, key)
    ).resolves.toBe('login-pw');
    expect(typeof sessionStorage[MASTER_KEY_ID]).toBe('string');
  });

  test('fresh-lock verify for a biometrics rotation uses the biometric prompt', async () => {
    resetStorage();
    clearCachedMasterKey();
    mockBiometricUnlock(PRF_SECRET);
    await seedBiometricVault();

    const rotated = await rotateVaultKey({ prepareRollback: true });
    expect(rotated.success).toBe(true);
    expect(localStorage[BACKUP_KEY]).toBeDefined();

    const verify = await verifyVaultRekey('');
    expect(verify.success).toBe(true);
    expect(localStorage[BACKUP_KEY]).toBeUndefined();
    expect(sessionStorage[OLD_KEY_SESSION]).toBeUndefined();
    expect(sessionStorage[NEW_KEY_SESSION]).toBeUndefined();
    // Vault is unlocked again with the rotated key.
    expect(typeof sessionStorage[MASTER_KEY_ID]).toBe('string');
    const config = localStorage[VAULT_CONFIG_KEY] as {
      salt: string;
      encryptedMasterKey: string;
      kdf?: typeof ARGON2ID_KDF;
    };
    await expect(
      decryptMasterKeyWithPassword(
        config.encryptedMasterKey,
        PRF_SECRET_HEX,
        config.salt,
        config.kdf
      )
    ).not.toBeNull();
  });
});
