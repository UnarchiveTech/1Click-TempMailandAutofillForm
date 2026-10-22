import { afterAll, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// crypto.ts imports wxt/browser at module load - provide an in-memory storage
// mock whose vault_security_config we can flip between protected/standard to
// exercise the VaultLockedError path deterministically.
const localStore: Record<string, unknown> = {
  vault_security_config: { mode: 'password' },
};
const sessionStore: Record<string, unknown> = {};

function readFrom(
  store: Record<string, unknown>,
  keys?: string | string[] | null
): Record<string, unknown> {
  if (keys === null || keys === undefined) return { ...store };
  const list = Array.isArray(keys) ? keys : [keys];
  const result: Record<string, unknown> = {};
  for (const key of list) if (key in store) result[key] = store[key];
  return result;
}

mock.module('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: async (keys?: string | string[] | null) => readFrom(localStore, keys),
        set: async (items: Record<string, unknown>) => Object.assign(localStore, items),
        remove: async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete localStore[key];
        },
      },
      session: {
        get: async (keys?: string | string[] | null) => readFrom(sessionStore, keys),
        set: async (items: Record<string, unknown>) => Object.assign(sessionStore, items),
        remove: async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete sessionStore[key];
        },
      },
    },
    runtime: { id: 'test-extension' },
  },
}));

const { clearCachedMasterKey, decrypt, decryptSecret, encrypt, encryptSecret, VaultLockedError } =
  await import('@/utils/security/crypto.js');

function setVaultMode(mode: 'password' | 'standard'): void {
  clearCachedMasterKey();
  localStore.vault_security_config = { mode };
  // Ensure no stale raw key lingers between mode switches.
  delete sessionStore['1click_master_encryption_key'];
}

describe('crypto vault-lock type preservation', () => {
  test('encrypt while a password vault is locked rejects with VaultLockedError (not EncryptionError)', async () => {
    setVaultMode('password');
    await expect(encrypt('secret')).rejects.toBeInstanceOf(VaultLockedError);
  });

  test('decrypt while a password vault is locked rejects with VaultLockedError (not DecryptionError)', async () => {
    setVaultMode('password');
    await expect(decrypt('_enc_:AAAAAAAAAAAAAAAAAAAA')).rejects.toBeInstanceOf(VaultLockedError);
  });

  test('encryptSecret propagates VaultLockedError so setAddresses can route to unlock', async () => {
    setVaultMode('password');
    await expect(encryptSecret('token')).rejects.toBeInstanceOf(VaultLockedError);
  });

  test('decryptSecret still degrades to "" when locked (by-design soft API)', async () => {
    setVaultMode('password');
    await expect(decryptSecret('_enc_:AAAAAAAAAAAAAAAAAAAA')).resolves.toBe('');
  });

  test('standard mode still encrypts and round-trips (guards did not break normal flow)', async () => {
    setVaultMode('standard');
    const ciphertext = await encrypt('hello');
    expect(typeof ciphertext).toBe('string');
    expect(ciphertext.length).toBeGreaterThan(0);
    expect(await decrypt(ciphertext)).toBe('hello');
  });
});
