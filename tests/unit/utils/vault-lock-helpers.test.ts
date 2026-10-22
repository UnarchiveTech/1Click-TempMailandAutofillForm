import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// vault-lock.ts imports wxt/browser at module load - provide an in-memory mock
// so the helpers can be exercised against real crypto.subtle.
const localStore: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};

mock.module('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: async (keys?: string | string[] | null) => {
          if (keys === null || keys === undefined) return { ...localStore };
          const list = Array.isArray(keys) ? keys : [keys];
          const result: Record<string, unknown> = {};
          for (const key of list) if (key in localStore) result[key] = localStore[key];
          return result;
        },
        set: async (items: Record<string, unknown>) => {
          Object.assign(localStore, items);
        },
        remove: async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete localStore[key];
        },
      },
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

const { clearCachedMasterKey, decryptWithKey, encryptWithKey, MASTER_KEY_ID } = await import(
  '@/utils/security/crypto.js'
);
const { commitFreshKeyToSession, createFreshKeyAndMigrateStores, stashVaultRekeyRollback } =
  await import('@/utils/storage/vault-lock.js');

const OLD_KEY_SESSION_KEY = 'vault_rekey_old_key';
const CONFIG_BACKUP_KEY = 'vault_security_config_backup';

async function generateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

async function exportKeyJson(key: CryptoKey): Promise<string> {
  return JSON.stringify(await crypto.subtle.exportKey('jwk', key));
}

/** Place a real key in LOCAL storage (standard-mode vault) for getOrCreateMasterKey. */
async function seedLocalMasterKey(): Promise<CryptoKey> {
  const key = await generateKey();
  localStore[MASTER_KEY_ID] = await exportKeyJson(key);
  clearCachedMasterKey();
  return key;
}

const PASSWORD_CONFIG = {
  mode: 'password',
  salt: 'aabbccdd',
  encryptedMasterKey: 'encrypted-blob',
  kdf: {
    algorithm: 'argon2id',
    formatVersion: 1,
    version: 19,
    memoryKiB: 19 * 1024,
    iterations: 2,
    parallelism: 1,
    hashLength: 32,
  },
} as const;

beforeEach(() => {
  for (const key of Object.keys(localStore)) delete localStore[key];
  for (const key of Object.keys(sessionStore)) delete sessionStore[key];
  clearCachedMasterKey();
});

describe('stashVaultRekeyRollback', () => {
  test('stashes the old session key + config for rollback', async () => {
    sessionStore[MASTER_KEY_ID] = 'old-key-json';

    const ok = await stashVaultRekeyRollback({ ...PASSWORD_CONFIG });

    expect(ok).toBe(true);
    expect(sessionStore[OLD_KEY_SESSION_KEY]).toBe('old-key-json');
    expect(localStore[CONFIG_BACKUP_KEY]).toEqual({ ...PASSWORD_CONFIG });
  });

  test('refuses (false) and writes nothing when no session key exists', async () => {
    const sessionBefore = { ...sessionStore };
    const localBefore = { ...localStore };

    const ok = await stashVaultRekeyRollback({ ...PASSWORD_CONFIG });

    expect(ok).toBe(false);
    expect(sessionStore).toEqual(sessionBefore);
    expect(localStore).toEqual(localBefore);
  });
});

describe('createFreshKeyAndMigrateStores', () => {
  test('migrates every store onto a fresh key when all values decrypt', async () => {
    const oldKey = await seedLocalMasterKey();
    localStore.loginInfo = [
      { domain: 'x.com', password: await encryptWithKey('login-pw', oldKey) },
    ];
    localStore.identities = [
      { id: 'i1', customPassword: await encryptWithKey('custom-pw', oldKey) },
    ];
    localStore.addresses = [];
    localStore.passwordSettings = {};

    const res = await createFreshKeyAndMigrateStores();

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.migrated.swapped).toBe(2);
    expect(res.migrated.leftUntouched).toBe(0);
    // The fresh key actually decrypts the migrated data; the old key no longer does.
    const data = res.migrated.data as {
      loginInfo: Array<{ password: string }>;
      identities: Array<{ customPassword: string }>;
    };
    expect(await decryptWithKey(data.loginInfo[0].password, res.newKey)).toBe('login-pw');
    expect(await decryptWithKey(data.identities[0].customPassword, res.newKey)).toBe('custom-pw');
  });

  test('aborts with migration-failed and persists NOTHING when a value cannot be decrypted', async () => {
    await seedLocalMasterKey();
    // 40+ chars of base64 charset: looksLikeCiphertext passes, decryption fails.
    localStore.loginInfo = [{ domain: 'x.com', password: 'A'.repeat(80) }];
    const localBefore = { ...localStore };
    const sessionBefore = { ...sessionStore };

    const res = await createFreshKeyAndMigrateStores();

    expect(res).toEqual({ ok: false, error: 'migration-failed' });
    // Abort-before-write: the helper itself never touches storage.
    expect(localStore).toEqual(localBefore);
    expect(sessionStore).toEqual(sessionBefore);
  });
});

describe('commitFreshKeyToSession', () => {
  test('stores the JWK in session only and removes any local raw key', async () => {
    const key = await generateKey();
    localStore[MASTER_KEY_ID] = 'stale-local-key';

    const json = await commitFreshKeyToSession(key);

    const expected = await exportKeyJson(key);
    expect(json).toBe(expected);
    expect(sessionStore[MASTER_KEY_ID]).toBe(expected);
    expect(localStore[MASTER_KEY_ID]).toBeUndefined();
  });
});
