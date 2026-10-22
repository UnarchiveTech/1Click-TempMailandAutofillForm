import { afterAll, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
const localStorage: Record<string, unknown> = {};
const sessionStorage: Record<string, unknown> = {};

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
  Object.keys(localStorage).forEach((key) => {
    delete localStorage[key];
  });
  Object.keys(sessionStorage).forEach((key) => {
    delete sessionStorage[key];
  });
}

const browserMock = {
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
};

Object.assign(globalThis, { browser: browserMock });

mock.module('wxt/browser', () => ({
  browser: browserMock,
}));

describe('rotateEncryptionKey', () => {
  test('re-encrypts every master-key ciphertext store (tokens, settings, logins, identities)', async () => {
    const {
      clearCachedMasterKey,
      decrypt,
      encrypt,
      getOrCreateMasterKey,
      MASTER_KEY_ID,
      rotateEncryptionKey,
    } = await import('@/utils/security/crypto.js');
    const { getAddresses } = await import('@/utils/storage/storage-keys.js');

    clearCachedMasterKey();
    resetStorage();

    // Fresh standard-mode master key (persisted to local storage).
    await getOrCreateMasterKey();

    // Seed every store with old-key ciphertext.
    localStorage.passwordSettings = { customPassword: await encrypt('settings-pw') };
    localStorage.addresses = [
      {
        id: 'i1',
        address: 'a@example.com',
        provider: 'guerrilla',
        createdAt: 1,
        expiresAt: 0,
        token: `_enc_:${await encrypt('token-1')}`,
        sidToken: `_enc_:${await encrypt('sid-1')}`,
      },
      // Plaintext token must be left untouched (never encrypted by rotation).
      {
        id: 'i2',
        address: 'b@example.com',
        provider: 'guerrilla',
        createdAt: 1,
        expiresAt: 0,
        token: 'plain-token',
      },
    ];
    localStorage.loginInfo = [
      { domain: 'example.com', email: 'x@example.com', password: await encrypt('login-pw') },
    ];
    localStorage.identities = [
      { id: 'id1', name: 'One', customPassword: await encrypt('identity-pw') },
      // Short plaintext value must be left untouched (below ciphertext length).
      { id: 'id2', name: 'Two', customPassword: 'plain' },
    ];
    localStorage.aiApiKey = `_enc_:${await encrypt('ai-key')}`;
    localStorage.webdavConfig = {
      url: 'https://dav.example.com',
      passwordEnc: `_enc_:${await encrypt('dav-pw')}`,
      backupPasswordEnc: `_enc_:${await encrypt('dav-bk-pw')}`,
    };

    await rotateEncryptionKey();

    // Every ciphertext store decrypts with the (rotated) key.
    const passwordSettings = localStorage.passwordSettings as { customPassword: string };
    const loginInfo = localStorage.loginInfo as Array<{ password: string }>;
    const identities = localStorage.identities as Array<{ customPassword: string }>;
    expect(await decrypt(passwordSettings.customPassword)).toBe('settings-pw');
    const addresses = await getAddresses();
    expect(addresses.find((i) => i.id === 'i1')?.token).toBe('token-1');
    expect(addresses.find((i) => i.id === 'i1')?.sidToken).toBe('sid-1');
    expect(addresses.find((i) => i.id === 'i2')?.token).toBe('plain-token');
    expect(await decrypt(loginInfo[0].password)).toBe('login-pw');
    expect(await decrypt(identities[0].customPassword)).toBe('identity-pw');
    expect(identities[1].customPassword).toBe('plain');
    // aiApiKey + WebDAV passwords survive rotation (still `_enc_:`-prefixed).
    expect(await decrypt((localStorage.aiApiKey as string).slice('_enc_:'.length))).toBe('ai-key');
    const wc = localStorage.webdavConfig as { passwordEnc: string; backupPasswordEnc: string };
    expect(await decrypt(wc.passwordEnc.slice('_enc_:'.length))).toBe('dav-pw');
    expect(await decrypt(wc.backupPasswordEnc.slice('_enc_:'.length))).toBe('dav-bk-pw');

    // Rotated key persisted to local + session and remains usable.
    expect(typeof localStorage[MASTER_KEY_ID]).toBe('string');
    expect(typeof sessionStorage[MASTER_KEY_ID]).toBe('string');
  });

  test('refuses rotation while the vault is password-protected (no raw key written, nothing orphaned)', async () => {
    const { clearCachedMasterKey, MASTER_KEY_ID, rotateEncryptionKey } = await import(
      '@/utils/security/crypto.js'
    );

    clearCachedMasterKey();
    resetStorage();

    // Protected vault: raw key lives in SESSION only.
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ]);
    sessionStorage[MASTER_KEY_ID] = JSON.stringify(await crypto.subtle.exportKey('jwk', key));
    localStorage.vault_security_config = { mode: 'password' };
    localStorage.passwordSettings = { customPassword: 'existing-ciphertext' };
    // Rotation also requires key metadata (mirrors the KeyMetadata shape).
    localStorage['1click_key_metadata'] = JSON.stringify({
      version: 1,
      createdAt: Date.now(),
      lastRotated: Date.now(),
      rotationInterval: 90 * 24 * 60 * 60 * 1000,
    });
    localStorage[MASTER_KEY_ID] = 'must-not-change';

    let caught: unknown;
    try {
      await rotateEncryptionKey();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect((caught as { context?: { reason?: string } }).context?.reason).toBe(
      'protected-vault-rotation-unsupported'
    );
    // No writes at all: raw key and existing ciphertext are untouched.
    expect(localStorage[MASTER_KEY_ID]).toBe('must-not-change');
    expect((localStorage.passwordSettings as { customPassword: string }).customPassword).toBe(
      'existing-ciphertext'
    );
  });
});
