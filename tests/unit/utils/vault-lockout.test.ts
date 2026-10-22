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

const VAULT_LOCKOUT_KEY = 'vault_unlock_lockout';

/**
 * Seed a password-protected vault with the current Argon2id profile.
 */
async function setupVault(correctPassword = 'right-password'): Promise<void> {
  const { encryptMasterKeyWithPassword, ARGON2ID_KDF } = await import('@/utils/security/crypto.js');
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  const keyJson = JSON.stringify(await crypto.subtle.exportKey('jwk', key));
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = Array.from(saltBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const encryptedMasterKey = await encryptMasterKeyWithPassword(
    keyJson,
    correctPassword,
    salt,
    ARGON2ID_KDF
  );
  localStorage.vault_security_config = {
    mode: 'password',
    salt,
    encryptedMasterKey,
    kdf: ARGON2ID_KDF,
  };
}

describe('unlockVaultWithPassword brute-force lockout', () => {
  test('first lockout uses the 30-second tier (not 5 minutes)', async () => {
    const { clearCachedMasterKey } = await import('@/utils/security/crypto.js');
    const { unlockVaultWithPassword } = await import('@/utils/storage/vault-lock.js');

    clearCachedMasterKey();
    resetStorage();
    await setupVault();

    let result: { success: boolean; lockedOutUntil?: number } | undefined;
    for (let i = 0; i < 5; i++) {
      result = await unlockVaultWithPassword('wrong-password');
    }
    expect(result?.success).toBe(false);
    expect(result?.lockedOutUntil).toBeDefined();
    const duration = (result?.lockedOutUntil ?? 0) - Date.now();
    // Tier 0 = 30_000 ms. The old code skipped tier 0 and applied 5 minutes here.
    expect(duration).toBeGreaterThan(25_000);
    expect(duration).toBeLessThan(35_000);

    // While locked out, even the correct password is blocked.
    const blocked = await unlockVaultWithPassword('right-password');
    expect(blocked.success).toBe(false);
    expect(blocked.lockedOutUntil).toBeDefined();
  });

  test('attempt counter resets after lockout expiry; next lockout escalates to 5 minutes', async () => {
    const { clearCachedMasterKey } = await import('@/utils/security/crypto.js');
    const { unlockVaultWithPassword } = await import('@/utils/storage/vault-lock.js');

    clearCachedMasterKey();
    resetStorage();
    await setupVault();

    // 5 wrong attempts → 30s lockout, stored tier becomes 1.
    let result: { success: boolean; lockedOutUntil?: number } | undefined;
    for (let i = 0; i < 5; i++) {
      result = await unlockVaultWithPassword('wrong-password');
    }
    expect(result?.lockedOutUntil).toBeDefined();

    // Simulate the lockout expiring (record kept, but past).
    const record = localStorage[VAULT_LOCKOUT_KEY] as {
      attempts: number;
      lockedUntil: number;
      tier: number;
    };
    expect(record.tier).toBe(1);
    localStorage[VAULT_LOCKOUT_KEY] = { ...record, lockedUntil: Date.now() - 1 };

    // A single failure right after expiry must NOT immediately re-trigger a
    // longer lockout - the counter resets and the user gets fresh attempts.
    const one = await unlockVaultWithPassword('wrong-password');
    expect(one.success).toBe(false);
    expect(one.lockedOutUntil).toBeUndefined();
    const afterOne = localStorage[VAULT_LOCKOUT_KEY] as { attempts: number; tier: number };
    expect(afterOne.attempts).toBe(1);
    expect(afterOne.tier).toBe(1);

    // 4 more failures → 5 total → next lockout tier (5 minutes).
    let last: { success: boolean; lockedOutUntil?: number } | undefined;
    for (let i = 0; i < 4; i++) {
      last = await unlockVaultWithPassword('wrong-password');
    }
    expect(last?.success).toBe(false);
    expect(last?.lockedOutUntil).toBeDefined();
    const duration = (last?.lockedOutUntil ?? 0) - Date.now();
    expect(duration).toBeGreaterThan(250_000);
    expect(duration).toBeLessThan(350_000);
  });

  test('successful unlock clears lockout state', async () => {
    const { clearCachedMasterKey } = await import('@/utils/security/crypto.js');
    const { unlockVaultWithPassword } = await import('@/utils/storage/vault-lock.js');

    clearCachedMasterKey();
    resetStorage();
    await setupVault();

    for (let i = 0; i < 3; i++) {
      await unlockVaultWithPassword('wrong-password');
    }
    expect(localStorage[VAULT_LOCKOUT_KEY]).toBeDefined();

    const ok = await unlockVaultWithPassword('right-password');
    expect(ok.success).toBe(true);
    expect(localStorage[VAULT_LOCKOUT_KEY]).toBeUndefined();
  });
});

describe('unlockVaultWithBiometrics brute-force lockout', () => {
  test('locks biometric retries after five failed assertions', async () => {
    const { encryptMasterKeyWithPassword } = await import('@/utils/security/crypto.js');
    const { unlockVaultWithBiometrics } = await import('@/utils/storage/vault-lock.js');
    resetStorage();

    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ]);
    const keyJson = JSON.stringify(await crypto.subtle.exportKey('jwk', key));
    const salt = '11'.repeat(16);
    const encryptedMasterKey = await encryptMasterKeyWithPassword(
      keyJson,
      '22'.repeat(32),
      salt,
      (await import('@/utils/security/crypto.js')).ARGON2ID_KDF
    );
    localStorage.vault_security_config = {
      mode: 'biometrics',
      salt,
      encryptedMasterKey,
      kdf: (await import('@/utils/security/crypto.js')).ARGON2ID_KDF,
      biometricCredentialId: '01',
    };

    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const originalNavigatorValue = globalThis.navigator;
    let assertionCount = 0;
    const fakeNavigator = {
      locks: originalNavigatorValue.locks,
      credentials: {
        get: async () => {
          assertionCount++;
          return {
            getClientExtensionResults: () => ({
              prf: { results: { first: new Uint8Array(32).fill(0x33) } },
            }),
          };
        },
      },
    };
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: fakeNavigator,
    });

    try {
      for (let i = 0; i < 5; i++) {
        expect(await unlockVaultWithBiometrics()).toBe(false);
      }
      expect(assertionCount).toBe(5);
      const lockout = localStorage[VAULT_LOCKOUT_KEY] as { lockedUntil: number };
      expect(lockout.lockedUntil).toBeGreaterThan(Date.now());
      expect(await unlockVaultWithBiometrics()).toBe(false);
      expect(assertionCount).toBe(5);
    } finally {
      if (originalNavigator) {
        Object.defineProperty(globalThis, 'navigator', originalNavigator);
      } else {
        Reflect.deleteProperty(globalThis, 'navigator');
      }
    }
  }, 15_000);
});
