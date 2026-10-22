import { afterAll, describe, expect, mock, test } from 'bun:test';

afterAll(() => mock.restore());

const localStorage: Record<string, unknown> = {};
const sessionStorage: Record<string, unknown> = {};

function readStorage(store: Record<string, unknown>, keys?: string | string[]) {
  const requestedKeys = typeof keys === 'string' ? [keys] : keys || Object.keys(store);
  return Object.fromEntries(
    requestedKeys.flatMap((key) => (key in store ? [[key, store[key]]] : []))
  );
}

function removeStorage(store: Record<string, unknown>, keys: string | string[]) {
  for (const key of typeof keys === 'string' ? [keys] : keys) delete store[key];
}

function resetStorage() {
  for (const store of [localStorage, sessionStorage]) {
    for (const key of Object.keys(store)) delete store[key];
  }
}

const browserMock = {
  runtime: { id: 'test-extension', sendMessage: async () => ({}) },
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
};

Object.assign(globalThis, { browser: browserMock });
mock.module('wxt/browser', () => ({ browser: browserMock }));

const VAULT_CONFIG_KEY = 'vault_security_config';
const MASTER_KEY_ID = '1click_master_encryption_key';
const PASSWORD = 'right-password';

function randomSaltHex(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function seedPasswordVault(kdf?: unknown): Promise<void> {
  const { ARGON2ID_KDF, encryptMasterKeyWithPassword } = await import('@/utils/security/crypto.js');
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  const keyJson = JSON.stringify(await crypto.subtle.exportKey('jwk', key));
  const salt = randomSaltHex();
  const encryptedMasterKey = await encryptMasterKeyWithPassword(
    keyJson,
    PASSWORD,
    salt,
    ARGON2ID_KDF
  );
  localStorage[VAULT_CONFIG_KEY] = {
    mode: 'password',
    salt,
    encryptedMasterKey,
    ...(kdf === undefined ? {} : { kdf }),
  };
  delete localStorage[MASTER_KEY_ID];
  delete sessionStorage[MASTER_KEY_ID];
}

describe('vault Argon2id profile validation', () => {
  test('biometric setup wraps and subsequently unlocks with the same supported salt', async () => {
    const { clearCachedMasterKey, getOrCreateMasterKey } = await import(
      '@/utils/security/crypto.js'
    );
    const { setupBiometricVault, lockVault, unlockVaultWithBiometrics } = await import(
      '@/utils/storage/vault-lock.js'
    );
    resetStorage();
    clearCachedMasterKey();
    const key = await getOrCreateMasterKey();
    const keyJson = JSON.stringify(await crypto.subtle.exportKey('jwk', key));
    const prfInputs: Uint8Array[] = [];
    const secret = new Uint8Array(32).fill(7);
    const names = ['window', 'navigator', 'PublicKeyCredential'] as const;
    const descriptors = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
    const locks = globalThis.navigator?.locks;
    const credentialApi = { isUserVerifyingPlatformAuthenticatorAvailable: async () => true };
    try {
      Object.defineProperty(globalThis, 'window', {
        value: { PublicKeyCredential: credentialApi },
        configurable: true,
      });
      Object.defineProperty(globalThis, 'PublicKeyCredential', {
        value: credentialApi,
        configurable: true,
      });
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          locks,
          credentials: {
            create: async () => ({
              rawId: new Uint8Array([1, 2, 3]).buffer,
              getClientExtensionResults: () => ({ prf: { enabled: true } }),
            }),
            get: async (options: CredentialRequestOptions) => {
              const input = options.publicKey?.extensions?.prf?.eval?.first;
              if (!input) throw new Error('Missing PRF input');
              prfInputs.push(
                input instanceof ArrayBuffer
                  ? new Uint8Array(input.slice(0))
                  : new Uint8Array(input.buffer, input.byteOffset, input.byteLength).slice()
              );
              return { getClientExtensionResults: () => ({ prf: { results: { first: secret } } }) };
            },
          },
        },
        configurable: true,
      });

      expect(await setupBiometricVault()).toBe(true);
      const config = localStorage[VAULT_CONFIG_KEY] as { mode: string; salt: string };
      expect(config.mode).toBe('biometrics');
      expect(config.salt).toMatch(/^[0-9a-f]{32}$/);
      expect(localStorage[MASTER_KEY_ID]).toBeNull();
      await lockVault();
      expect(await unlockVaultWithBiometrics()).toBe(true);
      expect(sessionStorage[MASTER_KEY_ID]).toBe(keyJson);
      expect(prfInputs).toHaveLength(2);
      expect(prfInputs[0]).toHaveLength(16);
      expect(prfInputs[1]).toEqual(prfInputs[0]);
    } finally {
      names.forEach((name, index) => {
        const descriptor = descriptors[index];
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      });
      clearCachedMasterKey();
    }
  });

  test('unlocks with the current Argon2id profile', async () => {
    const { clearCachedMasterKey, ARGON2ID_KDF } = await import('@/utils/security/crypto.js');
    const { unlockVaultWithPassword } = await import('@/utils/storage/vault-lock.js');
    resetStorage();
    clearCachedMasterKey();
    await seedPasswordVault(ARGON2ID_KDF);

    expect(await unlockVaultWithPassword(PASSWORD)).toMatchObject({ success: true });
    expect(sessionStorage[MASTER_KEY_ID]).toBeDefined();
  });

  test('rejects missing KDF metadata without treating it as a password guess', async () => {
    const { clearCachedMasterKey } = await import('@/utils/security/crypto.js');
    const { unlockVaultWithPassword } = await import('@/utils/storage/vault-lock.js');
    resetStorage();
    clearCachedMasterKey();
    await seedPasswordVault();
    const before = JSON.stringify(localStorage[VAULT_CONFIG_KEY]);

    expect(await unlockVaultWithPassword(PASSWORD)).toMatchObject({ success: false });
    expect(localStorage.vault_unlock_lockout).toBeUndefined();
    expect(JSON.stringify(localStorage[VAULT_CONFIG_KEY])).toBe(before);
  });

  test('rejects unsupported or oversized Argon2id parameters before deriving', async () => {
    const { clearCachedMasterKey } = await import('@/utils/security/crypto.js');
    const { unlockVaultWithPassword } = await import('@/utils/storage/vault-lock.js');
    resetStorage();
    clearCachedMasterKey();
    await seedPasswordVault({
      algorithm: 'argon2id',
      formatVersion: 1,
      version: 19,
      memoryKiB: 999999999,
    });
    const before = JSON.stringify(localStorage[VAULT_CONFIG_KEY]);

    expect(await unlockVaultWithPassword(PASSWORD)).toMatchObject({ success: false });
    expect(JSON.stringify(localStorage[VAULT_CONFIG_KEY])).toBe(before);
    expect(sessionStorage[MASTER_KEY_ID]).toBeUndefined();
  });
});
