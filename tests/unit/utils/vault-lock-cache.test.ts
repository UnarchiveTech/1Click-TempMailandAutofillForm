import { describe, expect, mock, test } from 'bun:test';

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

describe('lockVault', () => {
  test('clears the cached protected-vault key as well as session storage', async () => {
    const { MASTER_KEY_ID, clearCachedMasterKey, decrypt, encrypt } = await import(
      '@/utils/crypto.js'
    );
    const { lockVault } = await import('@/utils/vault-lock.js');

    clearCachedMasterKey();
    resetStorage();
    localStorage.vault_security_config = { mode: 'password' };

    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ]);
    sessionStorage[MASTER_KEY_ID] = JSON.stringify(await crypto.subtle.exportKey('jwk', key));

    const ciphertext = await encrypt('protected secret');
    expect(await decrypt(ciphertext)).toBe('protected secret');

    await lockVault();

    expect(sessionStorage[MASTER_KEY_ID]).toBeUndefined();
    await expect(decrypt(ciphertext)).rejects.toThrow();
  });
});

describe('setInboxes', () => {
  test('encrypts tokens at rest and fails closed while the vault is locked', async () => {
    const { MASTER_KEY_ID, clearCachedMasterKey } = await import('@/utils/crypto.js');
    const { setInboxes } = await import('@/utils/storage-keys.js');

    clearCachedMasterKey();
    resetStorage();
    await setInboxes([
      {
        id: 'inbox-1',
        address: 'person@example.com',
        provider: 'guerrilla',
        token: 'raw-token',
        sidToken: 'raw-session-token',
      },
    ] as never);

    const persistedInboxes = localStorage.inboxes as Array<{ token?: string; sidToken?: string }>;
    expect(persistedInboxes[0].token).toStartWith('_enc_:');
    expect(persistedInboxes[0].token).not.toContain('raw-token');
    expect(persistedInboxes[0].sidToken).toStartWith('_enc_:');
    expect(persistedInboxes[0].sidToken).not.toContain('raw-session-token');

    clearCachedMasterKey();
    resetStorage();
    localStorage.vault_security_config = { mode: 'password' };
    expect(sessionStorage[MASTER_KEY_ID]).toBeUndefined();

    await expect(
      setInboxes([
        {
          id: 'inbox-1',
          address: 'person@example.com',
          provider: 'guerrilla',
          token: 'raw-token',
        },
      ] as never)
    ).rejects.toThrow();

    expect(localStorage.inboxes).toBeUndefined();
  });
});
