import { afterAll, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// vault-lock.ts uses real crypto.ts against browser storage - mirror the
// crypto-rotation test harness with an in-memory local + session store.
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
const { cancelVaultRekey, lockVault, rekeyVault, setupMasterPassword, verifyVaultRekey } =
  await import('@/utils/storage/vault-lock.js');

const VAULT_CONFIG_KEY = 'vault_security_config';

async function seedProtectedVault(oldPassword: string) {
  // Standard-mode key first, then encrypt every store with it.
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

  // Enable password protection (raw key moves to session only).
  const ok = await setupMasterPassword(oldPassword);
  expect(ok).toBe(true);
}

describe('rekeyVault', () => {
  test('migrates every store onto a fresh key wrapped by the NEW password', async () => {
    resetStorage();
    clearCachedMasterKey();
    await seedProtectedVault('old-pw');

    const result = await rekeyVault({ currentPassword: 'old-pw', newPassword: 'new-pw' });
    expect(result.success).toBe(true);

    // New password unwraps the (fresh) key; the old password no longer does.
    const config = localStorage[VAULT_CONFIG_KEY] as {
      mode: string;
      salt: string;
      encryptedMasterKey: string;
      kdf?: typeof ARGON2ID_KDF;
    };
    expect(config.mode).toBe('password');
    const newKeyJson = await decryptMasterKeyWithPassword(
      config.encryptedMasterKey,
      'new-pw',
      config.salt,
      config.kdf
    );
    expect(newKeyJson).not.toBeNull();
    expect(
      await decryptMasterKeyWithPassword(
        config.encryptedMasterKey,
        'old-pw',
        config.salt,
        config.kdf
      )
    ).toBeNull();

    // Raw key lives in SESSION only; local must not hold it.
    expect(typeof sessionStorage[MASTER_KEY_ID]).toBe('string');
    expect(localStorage[MASTER_KEY_ID]).toBeUndefined();

    // Every store decrypts with the NEW key.
    const newKey = await crypto.subtle.importKey(
      'jwk',
      JSON.parse(newKeyJson as string) as JsonWebKey,
      { name: 'AES-GCM' },
      true,
      ['encrypt', 'decrypt']
    );
    const logins = localStorage.loginInfo as Array<{ password: string }>;
    await expect(decryptWithKey(logins[0].password, newKey)).resolves.toBe('login-pw');
    const identities = localStorage.identities as Array<{ customPassword: string }>;
    await expect(decryptWithKey(identities[0].customPassword, newKey)).resolves.toBe('identity-pw');
    const addresses = localStorage.addresses as Array<{ token: string; sidToken: string }>;
    await expect(decryptWithKey(addresses[0].token.slice('_enc_:'.length), newKey)).resolves.toBe(
      'tok-1'
    );
    await expect(
      decryptWithKey(addresses[0].sidToken.slice('_enc_:'.length), newKey)
    ).resolves.toBe('sid-1');
    await expect(
      decryptWithKey(
        (localStorage.passwordSettings as { customPassword: string }).customPassword,
        newKey
      )
    ).resolves.toBe('ps-pw');
    // aiApiKey + WebDAV passwords survive the re-key under the NEW key.
    await expect(
      decryptWithKey((localStorage.aiApiKey as string).slice('_enc_:'.length), newKey)
    ).resolves.toBe('ai-key');
    const wc = localStorage.webdavConfig as { passwordEnc: string; backupPasswordEnc: string };
    await expect(decryptWithKey(wc.passwordEnc.slice('_enc_:'.length), newKey)).resolves.toBe(
      'dav-pw'
    );
    await expect(decryptWithKey(wc.backupPasswordEnc.slice('_enc_:'.length), newKey)).resolves.toBe(
      'dav-bk-pw'
    );
  });

  test('changing password while unlocked still requires the current password', async () => {
    resetStorage();
    clearCachedMasterKey();
    await seedProtectedVault('old-pw');

    const result = await rekeyVault({ newPassword: 'fresh-pw' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('locked');
    expect(
      await decryptMasterKeyWithPassword(
        (localStorage[VAULT_CONFIG_KEY] as { encryptedMasterKey: string }).encryptedMasterKey,
        'old-pw',
        (localStorage[VAULT_CONFIG_KEY] as { salt: string }).salt
      )
    ).not.toBeNull();
  });

  test('wrong current password is rejected even while the vault is unlocked', async () => {
    resetStorage();
    clearCachedMasterKey();
    await seedProtectedVault('old-pw');

    const result = await rekeyVault({ currentPassword: 'wrong-pw', newPassword: 'fresh-pw' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('invalid-current-password');
    const config = localStorage[VAULT_CONFIG_KEY] as {
      salt: string;
      encryptedMasterKey: string;
      kdf?: typeof ARGON2ID_KDF;
    };
    const keyJson = await decryptMasterKeyWithPassword(
      config.encryptedMasterKey,
      'old-pw',
      config.salt,
      config.kdf
    );
    expect(keyJson).not.toBeNull();
  });

  test('wrong current password on a LOCKED vault is rejected with nothing changed', async () => {
    resetStorage();
    clearCachedMasterKey();
    await seedProtectedVault('old-pw');
    await lockVault();
    // Snapshot only the data that must NOT change (the failed unlock itself
    // legitimately writes the brute-force attempt counter).
    const snapshot = () =>
      JSON.stringify({
        vaultConfig: localStorage[VAULT_CONFIG_KEY],
        loginInfo: localStorage.loginInfo,
        identities: localStorage.identities,
        addresses: localStorage.addresses,
        passwordSettings: localStorage.passwordSettings,
      });
    const before = snapshot();

    const result = await rekeyVault({ currentPassword: 'wrong-pw', newPassword: 'new-pw' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('invalid-current-password');
    expect(snapshot()).toBe(before);
    // Still locked - the vault key never entered the session.
    expect(sessionStorage[MASTER_KEY_ID]).toBeUndefined();
  });

  test('locked vault without a current password is rejected', async () => {
    resetStorage();
    clearCachedMasterKey();
    await seedProtectedVault('old-pw');
    await lockVault();

    const result = await rekeyVault({ newPassword: 'new-pw' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('locked');
  });

  test('a value that cannot be decrypted with the old key aborts - nothing written', async () => {
    resetStorage();
    clearCachedMasterKey();
    await seedProtectedVault('old-pw');

    // Corrupt one login password with ciphertext from an unrelated key.
    const otherKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ]);
    const foreign = await encryptWithKey('foreign', otherKey);
    (localStorage.loginInfo as Array<{ password: string }>)[0].password = foreign;
    const before = JSON.stringify(localStorage);

    const result = await rekeyVault({ currentPassword: 'old-pw', newPassword: 'new-pw' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('migration-failed');
    // Nothing changed: not even the vault config or stores.
    expect(JSON.stringify(localStorage)).toBe(before);
  });

  test('refuses to re-key when the vault has no password protection', async () => {
    resetStorage();
    clearCachedMasterKey();
    await getOrCreateMasterKey(); // standard mode only

    const result = await rekeyVault({ newPassword: 'new-pw' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('not-protected');
  });

  test('rejects a too-short new password', async () => {
    resetStorage();
    clearCachedMasterKey();
    await seedProtectedVault('old-pw');

    const result = await rekeyVault({ currentPassword: 'old-pw', newPassword: '123' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('password-too-short');
  });
});

describe('rekeyVault - biometrics → password switch', () => {
  /**
   * Seed a biometrics-protected vault. The PRF secret is DETERMINISTIC (all
   * 0x07 bytes) so the mocked `navigator.credentials.get` below can return it
   * and unlockVaultWithBiometrics can decrypt the wrapped master key.
   */
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
    // Standard-mode key first, then encrypt every store with it.
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

    // Wrap the master key with the PRF secret (same format as setupBiometricVault).
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
    // Biometrics vault keeps the raw key OUT of local storage; locked session.
    delete localStorage[MASTER_KEY_ID];
    delete sessionStorage[MASTER_KEY_ID];
  }

  test('locked biometrics vault switches to a password (no typed current password)', async () => {
    resetStorage();
    clearCachedMasterKey();
    mockBiometricUnlock(PRF_SECRET);
    await seedBiometricVault();

    const result = await rekeyVault({ newPassword: 'new-pw' });
    expect(result.success).toBe(true);

    // Mode flipped to password; the new password unwraps the FRESH key.
    const config = localStorage[VAULT_CONFIG_KEY] as {
      mode: string;
      salt: string;
      encryptedMasterKey: string;
      kdf?: typeof ARGON2ID_KDF;
    };
    expect(config.mode).toBe('password');
    const newKeyJson = await decryptMasterKeyWithPassword(
      config.encryptedMasterKey,
      'new-pw',
      config.salt,
      config.kdf
    );
    expect(newKeyJson).not.toBeNull();
    // The old biometric PRF secret must no longer unwrap anything.
    expect(
      await decryptMasterKeyWithPassword(
        config.encryptedMasterKey,
        PRF_SECRET_HEX,
        config.salt,
        config.kdf
      )
    ).toBeNull();

    // Raw key in SESSION only; every store decrypts with the NEW key.
    expect(typeof sessionStorage[MASTER_KEY_ID]).toBe('string');
    expect(localStorage[MASTER_KEY_ID]).toBeUndefined();
    const newKey = await crypto.subtle.importKey(
      'jwk',
      JSON.parse(newKeyJson as string) as JsonWebKey,
      { name: 'AES-GCM' },
      true,
      ['encrypt', 'decrypt']
    );
    const logins = localStorage.loginInfo as Array<{ password: string }>;
    await expect(decryptWithKey(logins[0].password, newKey)).resolves.toBe('login-pw');
    await expect(
      decryptWithKey(
        (localStorage.passwordSettings as { customPassword: string }).customPassword,
        newKey
      )
    ).resolves.toBe('ps-pw');
  });

  test('already-unlocked biometrics vault still requires a fresh assertion', async () => {
    resetStorage();
    clearCachedMasterKey();
    let promptCount = 0;
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        userAgent: 'test',
        locks: testWebLocks,
        credentials: {
          get: async () => {
            promptCount += 1;
            return {
              getClientExtensionResults: () => ({
                prf: { results: { first: PRF_SECRET } },
              }),
            };
          },
        },
      },
      configurable: true,
      writable: true,
    });
    await seedBiometricVault();
    // Simulate an unlocked session (key present in session storage).
    const key = await getOrCreateMasterKey();
    sessionStorage[MASTER_KEY_ID] = JSON.stringify(await crypto.subtle.exportKey('jwk', key));

    const result = await rekeyVault({ newPassword: 'new-pw' });
    expect(result.success).toBe(true);
    expect(promptCount).toBe(1);
    const config = localStorage[VAULT_CONFIG_KEY] as {
      salt: string;
      encryptedMasterKey: string;
      kdf?: typeof ARGON2ID_KDF;
    };
    expect(
      await decryptMasterKeyWithPassword(
        config.encryptedMasterKey,
        'new-pw',
        config.salt,
        config.kdf
      )
    ).not.toBeNull();
  });

  test('biometric unlock failure aborts with nothing changed', async () => {
    resetStorage();
    clearCachedMasterKey();
    mockBiometricUnlock(null); // authenticator declines
    await seedBiometricVault();
    const before = JSON.stringify({ ...localStorage, vault_unlock_lockout: undefined });

    const result = await rekeyVault({ newPassword: 'new-pw' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('biometric-unlock-failed');
    expect(JSON.stringify({ ...localStorage, vault_unlock_lockout: undefined })).toBe(before);
    expect(sessionStorage[MASTER_KEY_ID]).toBeUndefined();
  });
});

describe('rekeyVault - fresh-lock verification & rollback', () => {
  const BACKUP_KEY = 'vault_security_config_backup';
  const OLD_KEY_SESSION = 'vault_rekey_old_key';
  const NEW_KEY_SESSION = 'vault_rekey_new_key';

  /** Decrypt the CURRENT config's wrapped key with `password`, then the first login. */
  async function decryptStoresWith(password: string): Promise<{ login: string | null }> {
    const config = localStorage[VAULT_CONFIG_KEY] as {
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
    if (!keyJson) return { login: null };
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
    return { login };
  }

  test('rekey with prepareRollback stashes the old config + old key', async () => {
    resetStorage();
    clearCachedMasterKey();
    await seedProtectedVault('old-pw');

    const result = await rekeyVault({
      currentPassword: 'old-pw',
      newPassword: 'new-pw',
      prepareRollback: true,
    });
    expect(result.success).toBe(true);

    // Change is NOT final: old config backed up, old key stashed, NEW key live.
    expect((localStorage[BACKUP_KEY] as { mode: string }).mode).toBe('password');
    expect(typeof sessionStorage[OLD_KEY_SESSION]).toBe('string');
    expect(typeof sessionStorage[MASTER_KEY_ID]).toBe('string');
  });

  test('verify on a fresh lock proves the new password survives a restart, then sweeps the stash', async () => {
    resetStorage();
    clearCachedMasterKey();
    await seedProtectedVault('old-pw');
    await lockVault(); // start locked, exactly like a browser restart
    const result = await rekeyVault({
      currentPassword: 'old-pw',
      newPassword: 'new-pw',
      prepareRollback: true,
    });
    expect(result.success).toBe(true);
    expect(localStorage[BACKUP_KEY]).toBeDefined();
    expect(typeof sessionStorage[OLD_KEY_SESSION]).toBe('string');

    const verify = await verifyVaultRekey('new-pw');
    expect(verify.success).toBe(true);

    // Fresh-lock proof passed: stash swept, vault unlocked with the new key,
    // every store decrypts under the NEW password only.
    expect(localStorage[BACKUP_KEY]).toBeUndefined();
    expect(sessionStorage[OLD_KEY_SESSION]).toBeUndefined();
    expect(sessionStorage[NEW_KEY_SESSION]).toBeUndefined();
    expect(typeof sessionStorage[MASTER_KEY_ID]).toBe('string');
    await expect(decryptStoresWith('new-pw')).resolves.toEqual({ login: 'login-pw' });
    await expect(decryptStoresWith('old-pw')).resolves.toEqual({ login: null });
  });

  test('wrong password on the fresh lock keeps the change pending; cancel rolls it back', async () => {
    resetStorage();
    clearCachedMasterKey();
    await seedProtectedVault('old-pw');
    const result = await rekeyVault({
      currentPassword: 'old-pw',
      newPassword: 'new-pw',
      prepareRollback: true,
    });
    expect(result.success).toBe(true);

    const verify = await verifyVaultRekey('wrong-pw');
    expect(verify.success).toBe(false);
    expect(verify.error).toBe('verification-failed');
    // Nothing finalized: vault locked, stash intact for a retry or rollback.
    expect(sessionStorage[MASTER_KEY_ID]).toBeUndefined();
    expect(localStorage[BACKUP_KEY]).toBeDefined();
    expect(typeof sessionStorage[OLD_KEY_SESSION]).toBe('string');
    expect(typeof sessionStorage[NEW_KEY_SESSION]).toBe('string');

    // User gives up → the change is undone completely.
    const { rolledBack } = await cancelVaultRekey();
    expect(rolledBack).toBe(true);
    expect(localStorage[BACKUP_KEY]).toBeUndefined();
    expect(sessionStorage[OLD_KEY_SESSION]).toBeUndefined();
    expect(sessionStorage[NEW_KEY_SESSION]).toBeUndefined();
    expect((localStorage[VAULT_CONFIG_KEY] as { mode: string }).mode).toBe('password');
    await expect(decryptStoresWith('old-pw')).resolves.toEqual({ login: 'login-pw' });
    await expect(decryptStoresWith('new-pw')).resolves.toEqual({ login: null });
    // Vault unlocked again with the PREVIOUS password.
    expect(typeof sessionStorage[MASTER_KEY_ID]).toBe('string');
  });

  test('cancel before any verification also rolls back (new key still in session)', async () => {
    resetStorage();
    clearCachedMasterKey();
    await seedProtectedVault('old-pw');
    const result = await rekeyVault({
      currentPassword: 'old-pw',
      newPassword: 'new-pw',
      prepareRollback: true,
    });
    expect(result.success).toBe(true);
    // No verifyVaultRekey ran - the NEW key is still under MASTER_KEY_ID.
    expect(typeof sessionStorage[MASTER_KEY_ID]).toBe('string');

    const { rolledBack } = await cancelVaultRekey();
    expect(rolledBack).toBe(true);
    await expect(decryptStoresWith('old-pw')).resolves.toEqual({ login: 'login-pw' });
    expect(typeof sessionStorage[MASTER_KEY_ID]).toBe('string');
  });

  test('cancel with no pending stash is a no-op', async () => {
    resetStorage();
    clearCachedMasterKey();
    await seedProtectedVault('old-pw');

    const { rolledBack } = await cancelVaultRekey();
    expect(rolledBack).toBe(false);
    // Vault untouched and fully usable with the original password.
    await expect(decryptStoresWith('old-pw')).resolves.toEqual({ login: 'login-pw' });
  });
});
