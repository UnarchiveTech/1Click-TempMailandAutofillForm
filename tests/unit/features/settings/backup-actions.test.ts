import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import type { BackupFileV3, EncryptedBackupFile } from '@/features/settings/backup-actions.js';

const browserStorage: Record<string, unknown> = {};
function readBrowserStorage(keys?: string | string[]) {
  const requested = typeof keys === 'string' ? [keys] : keys || Object.keys(browserStorage);
  return Object.fromEntries(
    requested.flatMap((key) => (key in browserStorage ? [[key, browserStorage[key]]] : []))
  );
}
const browserMock = {
  runtime: {
    id: 'test-extension',
    onMessage: { addListener: () => {} },
    sendMessage: async () => ({}),
  },
  storage: {
    onChanged: { addListener: () => {} },
    local: {
      get: async (keys?: string | string[]) => readBrowserStorage(keys),
      set: async (values: Record<string, unknown>) => Object.assign(browserStorage, values),
      remove: async (keys: string | string[]) => {
        for (const key of typeof keys === 'string' ? [keys] : keys) delete browserStorage[key];
      },
    },
    session: {
      get: async (keys?: string | string[]) => readBrowserStorage(keys),
      set: async (values: Record<string, unknown>) => Object.assign(browserStorage, values),
      remove: async (keys: string | string[]) => {
        for (const key of typeof keys === 'string' ? [keys] : keys) delete browserStorage[key];
      },
    },
  },
};
Object.assign(globalThis, { browser: browserMock });
mock.module('wxt/browser', () => ({ browser: browserMock }));
const { ARGON2ID_KDF, clearCachedMasterKey } = await import('@/utils/security/crypto.js');

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// `getOrCreateMasterKey` memoizes its key in module state (security/crypto.ts),
// and this file's own crypto mock is registered after backup-actions.ts was
// statically imported - so that module bound the REAL implementation. Per-file
// isolation (bunfig.toml) already gives this file a fresh module registry, so
// no other file can leave a key here; this reset is belt-and-braces so the file
// still starts from a known key if the suite is ever run without isolation.
beforeAll(() => {
  clearCachedMasterKey();
});
mock.module('@/utils/email/email-service.js', () => ({
  DEFAULT_PROVIDER: 'guerrilla',
  loadProviderConfig: (id: string) => {
    if (id === 'guerrilla') {
      return { id, expiry: { renewable: true, duration: 3600000 } };
    }
    if (id === 'burner') {
      return { id, expiry: { renewable: false, duration: 86400000 } };
    }
    throw new Error(`Unknown provider: ${id}`);
  },
}));

// backup-actions dynamically imports crypto.ts for the key fingerprint AND the
// wrapped-master-key feature. Mock it with REAL AES-GCM + PBKDF2 primitives
// (self-contained, mirroring crypto.ts) so fingerprinting, key wrapping, and
// the cross-device re-encrypt round-trip are exercised for real.
const testMasterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
  'encrypt',
  'decrypt',
]);

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from((hex.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)));
}
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
async function encWithKey(plaintext: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  const combined = new Uint8Array(iv.length + ct.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ct), iv.length);
  return bytesToBase64(combined);
}
async function decWithKey(b64: string, key: CryptoKey): Promise<string> {
  const combined = base64ToBytes(b64);
  const iv = combined.slice(0, 12);
  const ct = combined.slice(12);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct));
}
async function deriveArgon2id(password: string, saltHex: string): Promise<CryptoKey> {
  const { argon2id } = await import('hash-wasm');
  const rawKey = await argon2id({
    password: new TextEncoder().encode(`1click-extension-argon2id-v1\0${password}`),
    salt: hexToBytes(saltHex),
    iterations: ARGON2ID_KDF.iterations,
    parallelism: ARGON2ID_KDF.parallelism,
    memorySize: ARGON2ID_KDF.memoryKiB,
    hashLength: ARGON2ID_KDF.hashLength,
    outputType: 'binary',
  });
  return crypto.subtle.importKey(
    'raw',
    new Uint8Array(rawKey).buffer,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}
async function wrapKey(
  jwkJson: string,
  password: string,
  saltHex: string,
  _kdf = ARGON2ID_KDF
): Promise<string> {
  const key = await deriveArgon2id(password, saltHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(jwkJson)
  );
  return `${bytesToHex(iv)}:${bytesToHex(new Uint8Array(ct))}`;
}
async function unwrapKey(
  payload: string,
  password: string,
  saltHex: string,
  _kdf = ARGON2ID_KDF
): Promise<string | null> {
  const [ivHex, dataHex] = payload.split(':');
  if (!ivHex || !dataHex) return null;
  try {
    const key = await deriveArgon2id(password, saltHex);
    const dec = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: hexToBytes(ivHex) as BufferSource },
      key,
      hexToBytes(dataHex) as BufferSource
    );
    return new TextDecoder().decode(dec);
  } catch {
    return null;
  }
}
function looksLikeCiphertext(value: string): boolean {
  if (!value || value.length < 40) return false;
  const sample = value.length > 88 ? value.slice(0, 88) : value;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(sample)) return false;
  try {
    const bin = atob(sample);
    let non = 0;
    for (let i = 0; i < bin.length; i++) {
      const c = bin.charCodeAt(i);
      if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c > 126) non++;
    }
    return non / bin.length > 0.35;
  } catch {
    return false;
  }
}
function testSaltHex(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
}

// Mirrors the real inspectCiphertextStores walk (loginInfo passwords, identity
// custom passwords, `_enc_:` inbox tokens, settings custom password) so the
// import wipe-restore guard can verify decryptability against the local key.
async function mockInspectCiphertextStores(
  data: Record<string, unknown>,
  key: CryptoKey | null
): Promise<{ migratable: number; undecryptable: number }> {
  let migratable = 0;
  let undecryptable = 0;
  const inspect = async (value: string | null | undefined, prefix: string) => {
    if (typeof value !== 'string' || value === '') return;
    const prefixed = prefix !== '' && value.startsWith(prefix);
    const body = prefixed ? value.slice(prefix.length) : value;
    if (!looksLikeCiphertext(body)) return;
    if (!key) {
      migratable++;
      return;
    }
    try {
      await decWithKey(body, key);
      migratable++;
    } catch {
      undecryptable++;
    }
  };
  if (Array.isArray(data.loginInfo)) {
    for (const item of data.loginInfo as Array<Record<string, unknown>>) {
      if (item && typeof item === 'object' && typeof item.password === 'string') {
        await inspect(item.password as string, '');
      }
    }
  }
  if (Array.isArray(data.identities)) {
    for (const item of data.identities as Array<Record<string, unknown>>) {
      if (item && typeof item === 'object' && typeof item.customPassword === 'string') {
        await inspect(item.customPassword as string, '');
      }
    }
  }
  if (Array.isArray(data.addresses)) {
    for (const item of data.addresses as Array<Record<string, unknown>>) {
      if (!item || typeof item !== 'object') continue;
      for (const k of ['token', 'sidToken'] as const) {
        if (typeof item[k] === 'string') {
          await inspect(item[k] as string, '_enc_:');
        }
      }
    }
  }
  if (
    data.passwordSettings &&
    typeof data.passwordSettings === 'object' &&
    !Array.isArray(data.passwordSettings)
  ) {
    const ps = data.passwordSettings as Record<string, unknown>;
    if (typeof ps.customPassword === 'string') {
      await inspect(ps.customPassword as string, '');
    }
  }
  return { migratable, undecryptable };
}

mock.module('@/utils/security/crypto.js', () => ({
  getOrCreateMasterKey: async () => testMasterKey,
  encrypt: async (s: string) => encWithKey(s, testMasterKey),
  decrypt: async (s: string) => decWithKey(s, testMasterKey),
  encryptWithKey: encWithKey,
  decryptWithKey: decWithKey,
  looksLikeCiphertext,
  inspectCiphertextStores: mockInspectCiphertextStores,
  encryptMasterKeyWithPassword: wrapKey,
  decryptMasterKeyWithPassword: unwrapKey,
  MASTER_KEY_ID: '1click_master_encryption_key',
}));
const {
  ALL_BACKUP_CATEGORIES,
  buildBackupPayload,
  dataContainsSecrets,
  decryptBackupPayload,
  encryptBackupPayload,
  filterAddressesForImport,
  getMasterKeyFingerprint,
  importBackup,
  inferPresentCategories,
  inspectBackup,
  isAddressExpired,
  keysForCategories,
  MIN_BACKUP_PASSWORD_LENGTH,
  MAX_BACKUP_IMPORT_BYTES,
  normalizeImportedAddress,
  parseBackupFile,
  parseBackupText,
  previewImport,
  reencryptPayloadToLocalKey,
  resolveExpiredMode,
  stripSecretsFromData,
} = await import('@/features/settings/backup-actions.js');
const { archivedEmailsByAddressKey, storedEmailsByAddressKey } = await import(
  '@/utils/storage/storage-keys.js'
);

const NOW = 1_700_000_000_000;

function makeAddress(
  overrides: Partial<{
    id: string;
    address: string;
    provider: string;
    expiresAt: number;
    accountStatus: 'active' | 'archived' | 'deleted';
    token?: string;
    sidToken?: string;
  }> = {}
) {
  return {
    id: overrides.id ?? 'inbox-1',
    address: overrides.address ?? 'a@test.com',
    provider: overrides.provider ?? 'guerrilla',
    createdAt: NOW - 3600000,
    expiresAt: overrides.expiresAt ?? NOW + 3600000,
    accountStatus: overrides.accountStatus ?? ('active' as const),
    token: overrides.token,
    sidToken: overrides.sidToken,
  };
}

function makeExt(initial: Record<string, unknown> = {}) {
  const store = { ...initial };
  const writes: Record<string, unknown>[] = [];
  return {
    store,
    writes,
    ext: {
      storage: {
        local: {
          get: async (keys: string[] | null) => {
            if (!keys) return { ...store };
            const out: Record<string, unknown> = {};
            for (const k of keys) {
              if (k in store) out[k] = store[k];
            }
            return out;
          },
          set: async (items: Record<string, unknown>) => {
            writes.push({ ...items });
            Object.assign(store, items);
          },
          remove: async (keys: string | string[]) => {
            for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
          },
        },
      },
    },
  };
}

describe('keysForCategories', () => {
  test('returns union of keys for selected categories', () => {
    const keys = keysForCategories(['identities', 'filters']);
    expect(keys).toContain('identities');
    expect(keys).toContain('selectedIdentityId');
    expect(keys).toContain('savedSearchFilters');
    expect(keys).not.toContain('addresses');
  });

  test('all categories cover settings and addresses keys', () => {
    const keys = keysForCategories([...ALL_BACKUP_CATEGORIES]);
    expect(keys).toContain('themeMode');
    expect(keys).toContain('addresses');
    expect(keys).toContain('savedSearchFilters');
  });
});

describe('isAddressExpired / normalizeImportedAddress', () => {
  test('detects expired inbox', () => {
    expect(isAddressExpired({ expiresAt: NOW - 1 }, NOW)).toBe(true);
    expect(isAddressExpired({ expiresAt: NOW + 1 }, NOW)).toBe(false);
  });

  test('non-renewable expired active → archived', () => {
    const record = makeAddress({
      provider: 'burner',
      expiresAt: NOW - 1000,
      accountStatus: 'active',
    });
    expect(normalizeImportedAddress(record as never, NOW).accountStatus).toBe('archived');
  });

  test('renewable expired stays active', () => {
    const record = makeAddress({
      provider: 'guerrilla',
      expiresAt: NOW - 1000,
      accountStatus: 'active',
    });
    expect(normalizeImportedAddress(record as never, NOW).accountStatus).toBe('active');
  });
});

describe('resolveExpiredMode / filterAddressesForImport', () => {
  test('legacy includeExpiredAddresses maps correctly', () => {
    expect(resolveExpiredMode({ categories: [], includeExpiredAddresses: true })).toBe('all');
    expect(resolveExpiredMode({ categories: [] })).toBe('skip');
    expect(resolveExpiredMode({ categories: [], expiredMode: 'renewableOnly' })).toBe(
      'renewableOnly'
    );
  });

  test('skip mode drops all expired', () => {
    const raw = [
      makeAddress({ id: 'live', expiresAt: NOW + 1 }),
      makeAddress({ id: 'dead-g', provider: 'guerrilla', expiresAt: NOW - 1 }),
      makeAddress({ id: 'dead-b', provider: 'burner', expiresAt: NOW - 1 }),
    ];
    const r = filterAddressesForImport(raw as never, 'skip', NOW);
    expect(r.accepted.map((a) => a.id)).toEqual(['live']);
    expect(r.skippedExpired).toBe(2);
  });

  test('renewableOnly imports only renewable expired', () => {
    const raw = [
      makeAddress({ id: 'dead-g', provider: 'guerrilla', expiresAt: NOW - 1 }),
      makeAddress({ id: 'dead-b', provider: 'burner', expiresAt: NOW - 1, address: 'b@t.com' }),
    ];
    const r = filterAddressesForImport(raw as never, 'renewableOnly', NOW);
    expect(r.accepted.map((a) => a.id)).toEqual(['dead-g']);
    expect(r.renewableExpired).toBe(1);
    expect(r.skippedExpired).toBe(1);
  });

  test('all mode imports expired non-renewable as archived', () => {
    const raw = [
      makeAddress({
        id: 'dead-b',
        provider: 'burner',
        expiresAt: NOW - 1,
        address: 'b@t.com',
        accountStatus: 'active',
      }),
    ];
    const r = filterAddressesForImport(raw as never, 'all', NOW);
    expect(r.accepted[0].accountStatus).toBe('archived');
    expect(r.nonRenewableExpired).toBe(1);
  });
});

describe('inferPresentCategories / inspectBackup', () => {
  test('infers categories from data keys', () => {
    const cats = inferPresentCategories({
      themeMode: 'dark',
      identities: [{ id: '1' }],
      addresses: [],
    });
    expect(cats).toContain('settings');
    expect(cats).toContain('identities');
    expect(cats).toContain('addresses');
  });

  test('inspect counts expired renewable vs non-renewable', () => {
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: new Date().toISOString(),
      data: {
        addresses: [
          makeAddress({ id: '1', provider: 'guerrilla', expiresAt: NOW + 1000 }),
          makeAddress({ id: '2', provider: 'guerrilla', expiresAt: NOW - 1000 }),
          makeAddress({
            id: '3',
            provider: 'burner',
            expiresAt: NOW - 1000,
            address: 'b@test.com',
          }),
        ],
        identities: [{ id: 'i1' }, { id: 'i2' }],
        loginInfo: [{ domain: 'x.com' }],
        savedSearchFilters: [{ id: 'f1' }],
        storedEmails: { 'a@test.com': [] },
      },
    };
    const inspection = inspectBackup(payload, NOW);
    expect(inspection.counts.addressesTotal).toBe(3);
    expect(inspection.counts.addressesActive).toBe(1);
    expect(inspection.counts.addressesExpired).toBe(2);
    expect(inspection.counts.addressesExpiredRenewable).toBe(1);
    expect(inspection.counts.addressesExpiredNonRenewable).toBe(1);
  });
});

describe('stripSecretsFromData', () => {
  test('removes passwords tokens and custom passwords', () => {
    const stripped = stripSecretsFromData({
      loginInfo: [{ domain: 'a.com', password: 'secret' }],
      identities: [{ id: '1', customPassword: 'x' }],
      addresses: [makeAddress({ token: 't', sidToken: 's' })],
      passwordSettings: { useCustom: true, customPassword: 'p' },
    });
    expect((stripped.loginInfo as { password?: string }[])[0].password).toBeUndefined();
    expect(
      (stripped.identities as { customPassword?: string }[])[0].customPassword
    ).toBeUndefined();
    expect((stripped.addresses as { token?: string }[])[0].token).toBeUndefined();
    expect(
      (stripped.passwordSettings as { customPassword?: string }).customPassword
    ).toBeUndefined();
  });
});

describe('buildBackupPayload', () => {
  test('exports only selected category keys and keeps master-key ciphertext (incl. customPassword)', async () => {
    const storage: Record<string, unknown> = {
      themeMode: 'dark',
      passwordSettings: { useCustom: true, customPassword: 'secret' },
      identities: [{ id: '1' }],
      addresses: [makeAddress()],
    };
    const ext = {
      storage: {
        local: {
          get: async (keys: string[] | null) => {
            if (!keys) return { ...storage };
            const out: Record<string, unknown> = {};
            for (const k of keys) {
              if (k in storage) out[k] = storage[k];
            }
            return out;
          },
        },
      },
    };

    const payload = await buildBackupPayload(ext, {
      categories: ['settings', 'identities'],
    });

    expect(payload.version).toBe('3.0');
    expect(payload.categories).toEqual(['settings', 'identities']);
    expect(payload.data.themeMode).toBe('dark');
    expect(payload.data.addresses).toBeUndefined();
    // customPassword is master-key ciphertext (like inbox tokens) - it ships
    // in normal backups so the wrap/re-encrypt/guard pipeline stays live.
    expect((payload.data.passwordSettings as { customPassword?: string }).customPassword).toBe(
      'secret'
    );
  });

  test('excludeSecrets strips inbox tokens', async () => {
    const storage = {
      addresses: [makeAddress({ token: 'abc', sidToken: 'def' })],
    };
    const ext = {
      storage: {
        local: {
          get: async () => ({ ...storage }),
        },
      },
    };
    const payload = await buildBackupPayload(ext, {
      categories: ['addresses'],
      excludeSecrets: true,
    });
    expect(payload.secretsExcluded).toBe(true);
    expect((payload.data.addresses as { token?: string }[])[0].token).toBeUndefined();
  });
});

describe('password encryption', () => {
  test('requires at least 12 characters for an encrypted backup', async () => {
    const payload: BackupFileV3 = { version: '3.0', exportDate: '', data: {} };
    await expect(
      encryptBackupPayload(payload, 'x'.repeat(MIN_BACKUP_PASSWORD_LENGTH - 1))
    ).rejects.toThrow('at least 12 characters');
    await expect(
      encryptBackupPayload(payload, 'x'.repeat(MIN_BACKUP_PASSWORD_LENGTH))
    ).resolves.toMatchObject({ encrypted: true });
  });

  test('round-trips encrypt/decrypt', async () => {
    const original: BackupFileV3 = {
      version: '3.0',
      exportDate: '2026-01-01T00:00:00.000Z',
      categories: 'all',
      data: { themeMode: 'dark', identities: [{ id: '1' }] },
    };
    const enc = await encryptBackupPayload(original, 'test-password');
    expect(enc.encrypted).toBe(true);
    expect(enc.salt).toBeTruthy();
    const dec = await decryptBackupPayload(enc, 'test-password');
    expect(dec.data.themeMode).toBe('dark');
    await expect(decryptBackupPayload(enc, 'wrong')).rejects.toThrow();
  });

  test('parseBackupText detects encrypted files', async () => {
    const original: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: { themeMode: 'light' },
    };
    const enc = await encryptBackupPayload(original, 'secret-password');
    const parsed = await parseBackupText(JSON.stringify(enc));
    expect(parsed.kind).toBe('encrypted');
  });
});

describe('previewImport', () => {
  test('reports new vs existing identities', async () => {
    const { ext } = makeExt({
      identities: [{ id: 'a' }],
      addresses: [],
    });
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: {
        identities: [{ id: 'a' }, { id: 'b' }],
        addresses: [
          makeAddress({ id: 'live', expiresAt: NOW + 1000 }),
          makeAddress({ id: 'dead', expiresAt: NOW - 1 }),
        ],
      },
    };
    const preview = await previewImport(
      ext,
      payload,
      { categories: ['identities', 'addresses'], expiredMode: 'skip' },
      NOW
    );
    expect(preview.newIdentities).toBe(1);
    expect(preview.skippedExistingIdentities).toBe(1);
    expect(preview.addressesToImport).toBe(1);
    expect(preview.skippedExpiredAddresses).toBe(1);
  });
});

describe('importBackup', () => {
  test('skips expired addresses when mode is skip', async () => {
    const { ext, store } = makeExt({ addresses: [] });
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: {
        addresses: [
          makeAddress({ id: 'live', expiresAt: NOW + 5000, address: 'live@test.com' }),
          makeAddress({ id: 'dead', expiresAt: NOW - 5000, address: 'dead@test.com' }),
        ],
        storedEmails: {
          'live@test.com': [{ id: 'e1' }],
          'dead@test.com': [{ id: 'e2' }],
        },
      },
    };

    const summary = await importBackup(
      ext,
      payload,
      { categories: ['addresses'], expiredMode: 'skip', includeEmails: true },
      async () => {},
      NOW
    );

    expect(summary.importedAddresses).toBe(1);
    expect(summary.skippedExpiredAddresses).toBe(1);
    expect((store.addresses as { id: string }[]).map((i) => i.id)).toEqual(['live']);
    // Only the accepted inbox's ID-keyed bag is written; the skipped one's is not.
    expect(store[storedEmailsByAddressKey('live')]).toEqual([{ id: 'e1' }]);
    expect(store[storedEmailsByAddressKey('dead')]).toBeUndefined();
  });

  test('de-proxies reactive payload data so email bags stay plain arrays', async () => {
    // The import dialog holds `payload` in Svelte `$state`, so `payload.data`
    // reaches importBackup as a deeply reactive proxy. Writing those proxies
    // straight to chrome.storage turns proxied arrays into {0:.., 1:..} objects
    // and empties every mailbox. Simulate that with a deep proxy carrying a
    // marker and assert the written bag is a plain, marker-free array.
    const MARKER = Symbol('reactive');
    const deepProxy = <T>(v: T): T => {
      if (v && typeof v === 'object') {
        return new Proxy(v as object, {
          get(t, k, r) {
            if (k === MARKER) return true;
            return deepProxy(Reflect.get(t, k, r));
          },
        }) as T;
      }
      return v;
    };

    const { ext, store } = makeExt();
    const raw: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: {
        addresses: [makeAddress({ id: 'live', address: 'live@test.com', expiresAt: NOW + 5000 })],
        storedEmails: { 'live@test.com': [{ id: 'e1', from: 'x@y.com' }] },
      },
    };
    const payload: BackupFileV3 = { ...raw, data: deepProxy(raw.data) };

    await importBackup(
      ext,
      payload,
      { categories: ['addresses'], includeEmails: true, expiredMode: 'all' },
      async () => {},
      NOW
    );

    const bag = store[storedEmailsByAddressKey('live')] as unknown[];
    expect(Array.isArray(bag)).toBe(true);
    expect(bag).toHaveLength(1);
    expect((bag[0] as { id: string }).id).toBe('e1');
    expect((bag as unknown as Record<PropertyKey, unknown>)[MARKER]).toBeUndefined();
  });

  test('replace email import recomputes metadata and prunes entries for dropped addresses', async () => {
    // Pre-existing mail metadata for two addresses; the backup only contains
    // 'live' (with new mail), so 'dead' leaves the index and its stale
    // metadata must be pruned (phantom badge counts), while 'live' is
    // recomputed from the imported bag.
    const { ext, store } = makeExt({
      addresses: [
        makeAddress({ id: 'live', address: 'live@test.com', expiresAt: NOW + 5000 }),
        makeAddress({ id: 'dead', address: 'dead@test.com', expiresAt: NOW + 5000 }),
      ],
    });
    store.emailStorageAddressIndex = { live: 'live@test.com', dead: 'dead@test.com' };
    store.emailStorageMetadata = {
      live: { messageCount: 9, unreadCount: 9, revision: 2 },
      dead: { messageCount: 9, unreadCount: 9, revision: 2 },
    };
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: {
        addresses: [makeAddress({ id: 'live', address: 'live@test.com', expiresAt: NOW + 5000 })],
        storedEmails: { 'live@test.com': [{ id: 'e1', received_at: 1 }] },
      },
    };

    await importBackup(
      ext,
      payload,
      {
        categories: ['addresses'],
        conflictPolicy: 'replace',
        includeEmails: true,
        expiredMode: 'all',
      },
      async () => {},
      NOW
    );

    expect(store.emailStorageAddressIndex).toEqual({ live: 'live@test.com' });
    expect(store.emailStorageMetadata).toMatchObject({
      live: { messageCount: 1, unreadCount: 1, revision: 3 },
    });
    expect((store.emailStorageMetadata as Record<string, unknown>).dead).toBeUndefined();
  });

  test('replace policy overwrites identities', async () => {
    const { ext, store } = makeExt({
      identities: [{ id: 'old', name: 'Old' }],
    });
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: {
        identities: [{ id: 'new', name: 'New' }],
      },
    };

    await importBackup(
      ext,
      payload,
      { categories: ['identities'], conflictPolicy: 'replace' },
      async () => {},
      NOW
    );

    expect((store.identities as { id: string }[]).map((i) => i.id)).toEqual(['new']);
  });

  test('merge keeps existing identity', async () => {
    const { ext, store } = makeExt({
      identities: [{ id: 'a', name: 'A' }],
    });
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: {
        identities: [
          { id: 'a', name: 'A-new' },
          { id: 'b', name: 'B' },
        ],
      },
    };

    await importBackup(ext, payload, { categories: ['identities'] }, async () => {}, NOW);

    const ids = (store.identities as { id: string; name: string }[]).map((i) => i.id);
    expect(ids).toEqual(['a', 'b']);
    expect((store.identities as { name: string }[])[0].name).toBe('A');
  });

  test('tracks renewableExpiredImported', async () => {
    const { ext } = makeExt({ addresses: [] });
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: {
        addresses: [
          makeAddress({
            id: 'g',
            provider: 'guerrilla',
            expiresAt: NOW - 1,
          }),
        ],
      },
    };
    const summary = await importBackup(
      ext,
      payload,
      { categories: ['addresses'], expiredMode: 'renewableOnly' },
      async () => {},
      NOW
    );
    expect(summary.renewableExpiredImported).toBe(1);
    expect(summary.importedAddresses).toBe(1);
  });

  test('prefers live inbox for activeAddressId over expired candidate', async () => {
    const { ext, store } = makeExt({ addresses: [], activeAddressId: 'prev' });
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: {
        activeAddressId: 'dead',
        addresses: [
          makeAddress({
            id: 'dead',
            provider: 'guerrilla',
            expiresAt: NOW - 1,
            address: 'd@test.com',
          }),
          makeAddress({
            id: 'live',
            provider: 'guerrilla',
            expiresAt: NOW + 10_000,
            address: 'l@test.com',
          }),
        ],
      },
    };

    await importBackup(
      ext,
      payload,
      { categories: ['addresses'], expiredMode: 'all', conflictPolicy: 'replace' },
      async () => {},
      NOW
    );

    expect(store.activeAddressId).toBe('live');
  });

  test('sets activeAddressId after hard-reset style empty storage import', async () => {
    const { ext, store } = makeExt({ addresses: [] });
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: {
        activeAddressId: 'a1',
        addresses: [
          makeAddress({
            id: 'a1',
            expiresAt: NOW + 5000,
            address: 'a@test.com',
          }),
        ],
      },
    };

    await importBackup(
      ext,
      payload,
      { categories: ['addresses'], expiredMode: 'all', conflictPolicy: 'replace' },
      async () => {},
      NOW
    );

    expect(store.activeAddressId).toBe('a1');
    expect((store.addresses as { id: string }[]).map((i) => i.id)).toEqual(['a1']);
  });

  test('merge keeps two logins on the same domain (work + personal)', async () => {
    const { ext, store } = makeExt({
      loginInfo: [{ domain: 'x.com', username: 'work@x.com', password: 'p1' }],
    });
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: {
        loginInfo: [
          { domain: 'x.com', username: 'work@x.com', password: 'p1' },
          { domain: 'x.com', username: 'personal@x.com', password: 'p2' },
          { domain: 'y.com', username: 'a@y.com', password: 'p3' },
        ],
      },
    };

    const summary = await importBackup(
      ext,
      payload,
      { categories: ['savedLogins'], conflictPolicy: 'merge' },
      async () => {},
      NOW
    );

    const logins = store.loginInfo as { domain: string; username: string }[];
    // The second login on x.com must survive - keying by bare domain would
    // silently discard it forever.
    expect(logins).toHaveLength(3);
    expect(logins.filter((l) => l.domain === 'x.com')).toHaveLength(2);
    expect(summary.imported.savedLogins).toBe(3);
  });

  test('merge dedups same-domain logins with the same username (case-insensitive)', async () => {
    const { ext, store } = makeExt({
      loginInfo: [{ domain: 'X.com', email: 'work@x.com', password: 'p1' }],
    });
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: {
        loginInfo: [{ domain: 'x.com', email: 'WORK@X.COM', password: 'p1' }],
      },
    };

    await importBackup(
      ext,
      payload,
      { categories: ['savedLogins'], conflictPolicy: 'merge' },
      async () => {},
      NOW
    );

    expect(store.loginInfo as unknown[]).toHaveLength(1);
  });

  test('merge dedups case-variant emailHistory entries', async () => {
    const { ext, store } = makeExt({
      emailHistory: [{ email: 'Foo@x.com', timestamp: NOW - 1000 }],
    });
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: {
        emailHistory: [{ email: 'foo@x.com', timestamp: NOW - 500 }],
      },
    };

    await importBackup(
      ext,
      payload,
      { categories: ['savedLogins'], conflictPolicy: 'merge' },
      async () => {},
      NOW
    );

    expect(store.emailHistory as unknown[]).toHaveLength(1);
  });

  test('replace import dedups case-variant email bag keys by message id', async () => {
    const { ext, store } = makeExt({ addresses: [] });
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: {
        addresses: [
          makeAddress({
            id: 'inbox-1',
            address: 'a@test.com',
            expiresAt: NOW + 5000,
          }),
        ],
        storedEmails: {
          'A@test.com': [{ id: 'e1' }, { id: 'e2' }],
          'a@test.com': [{ id: 'e2' }, { id: 'e3' }],
        },
      },
    };

    await importBackup(
      ext,
      payload,
      { categories: ['addresses'], includeEmails: true, conflictPolicy: 'replace' },
      async () => {},
      NOW
    );

    // Both keys canonicalize to a@test.com - the shared id 'e2' must appear
    // once, not inflate unreads / re-trigger notifications.
    const bag = store[storedEmailsByAddressKey('inbox-1')] as { id: string }[];
    expect(bag.map((m) => m.id)).toEqual(['e1', 'e2', 'e3']);
  });
});

describe('backup integrity + key fingerprint', () => {
  test('buildBackupPayload stamps integrityHash and keyFingerprint when secrets included', async () => {
    const { ext } = makeExt({ loginInfo: [{ domain: 'x.com', password: 'pw' }] });
    const payload = await buildBackupPayload(ext, { categories: ['savedLogins'] });
    expect(typeof payload.integrityHash).toBe('string');
    expect(typeof payload.keyFingerprint).toBe('string');
  });

  test('excludeSecrets omits keyFingerprint (no key material to protect)', async () => {
    const { ext } = makeExt({});
    const payload = await buildBackupPayload(ext, {
      categories: ['settings'],
      excludeSecrets: true,
    });
    expect(payload.keyFingerprint).toBeUndefined();
    expect(typeof payload.integrityHash).toBe('string');
  });

  test('parseBackupText verifies integrityHash on plain backups', async () => {
    const { ext } = makeExt({ themeMode: 'dark' });
    const payload = await buildBackupPayload(ext, { categories: ['settings'] });
    const parsed = await parseBackupText(JSON.stringify(payload));
    expect(parsed.kind).toBe('plain');
    if (parsed.kind === 'plain') {
      expect(parsed.payload.integrityHash).toBe(payload.integrityHash);
      expect(parsed.payload.data.themeMode).toBe('dark');
    }
  });

  test('parseBackupText rejects a tampered payload', async () => {
    const { ext } = makeExt({ themeMode: 'dark' });
    const payload = await buildBackupPayload(ext, { categories: ['settings'] });
    const tampered = { ...payload, data: { ...payload.data, themeMode: 'light' } };
    await expect(parseBackupText(JSON.stringify(tampered))).rejects.toThrow(/integrity/i);
  });

  test('parseBackupText enforces the size cap before parsing', async () => {
    const atCap = 'a'.repeat(MAX_BACKUP_IMPORT_BYTES);
    // At the cap the gate lets it through to JSON parsing (so the limit is
    // exclusive and a 50 MB backup is still importable)…
    await expect(parseBackupText(atCap)).rejects.toThrow(/Invalid JSON format/);
    // …and one code unit over is refused by the size gate itself, never parsed.
    await expect(parseBackupText(`${atCap}a`)).rejects.toThrow(/too large/i);
  });

  test('parseBackupFile refuses an oversized file without reading it', async () => {
    let read = false;
    const file = {
      size: MAX_BACKUP_IMPORT_BYTES + 1,
      text: async () => {
        read = true;
        return '{}';
      },
    } as unknown as File;
    await expect(parseBackupFile(file)).rejects.toThrow(/too large/i);
    expect(read).toBe(false);
  });

  test('import with mismatched fingerprint + existing secret data throws (no silent key mixing)', async () => {
    const { ext } = makeExt({ loginInfo: [{ domain: 'x.com', password: 'existing' }] });
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: { loginInfo: [{ domain: 'x.com', password: 'from-backup' }] },
      keyFingerprint: 'f'.repeat(64), // deliberately differs from the current key
    };
    await expect(
      importBackup(ext, payload, { categories: ['savedLogins'] }, async () => {}, NOW)
    ).rejects.toThrow(/different device key/i);
  });

  test('import with mismatched fingerprint but nothing to mix into proceeds with a flag', async () => {
    const { ext, store } = makeExt({});
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: { loginInfo: [{ domain: 'x.com', password: 'from-backup' }] },
      keyFingerprint: 'f'.repeat(64),
    };
    const summary = await importBackup(
      ext,
      payload,
      { categories: ['savedLogins'] },
      async () => {},
      NOW
    );
    expect(summary.keyFingerprintMismatch).toBe(true);
    expect((store.loginInfo as unknown[]).length).toBe(1);
  });

  test('matching fingerprint imports cleanly without a mismatch flag', async () => {
    const { ext } = makeExt({});
    const current = await getMasterKeyFingerprint();
    expect(current).toBeTruthy();
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: { loginInfo: [{ domain: 'x.com', password: 'pw' }] },
      keyFingerprint: current as string,
    };
    const summary = await importBackup(
      ext,
      payload,
      { categories: ['savedLogins'] },
      async () => {},
      NOW
    );
    expect(summary.keyFingerprintMismatch).toBeFalsy();
  });
});

describe('wrapped master key (cross-device restore)', () => {
  test('password-encrypted backups wrap the master key when secrets are present', async () => {
    const { ext } = makeExt({
      loginInfo: [{ domain: 'x.com', password: 'pw' }],
    });
    const payload = await buildBackupPayload(ext, { categories: ['savedLogins'] });
    const enc = await encryptBackupPayload(payload, 'backup-password');
    expect(typeof enc.wrappedMasterKey).toBe('string');
    expect(enc.wrappedMasterKey?.length).toBeGreaterThan(0);
  });

  test('backups without secrets do not wrap a key', async () => {
    const { ext } = makeExt({ themeMode: 'dark' });
    const payload = await buildBackupPayload(ext, { categories: ['settings'] });
    const enc = await encryptBackupPayload(payload, 'backup-password');
    expect(enc.wrappedMasterKey).toBeUndefined();
  });

  test('excludeSecrets backups do not wrap a key', async () => {
    const { ext } = makeExt({ loginInfo: [{ domain: 'x.com', password: 'pw' }] });
    const payload = await buildBackupPayload(ext, {
      categories: ['savedLogins'],
      excludeSecrets: true,
    });
    const enc = await encryptBackupPayload(payload, 'backup-password');
    expect(enc.wrappedMasterKey).toBeUndefined();
  });

  test('the wrapped key unwraps back to the device key with the backup password', async () => {
    const { ext } = makeExt({ loginInfo: [{ domain: 'x.com', password: 'pw' }] });
    const payload = await buildBackupPayload(ext, { categories: ['savedLogins'] });
    const enc = await encryptBackupPayload(payload, 'backup-password');
    const unwrapped = await unwrapKey(
      enc.wrappedMasterKey as string,
      'backup-password',
      enc.salt,
      ARGON2ID_KDF
    );
    const localJwk = JSON.stringify(await crypto.subtle.exportKey('jwk', testMasterKey));
    expect(unwrapped).toBe(localJwk);
    // Wrong password fails to unwrap.
    expect(
      await unwrapKey(enc.wrappedMasterKey as string, 'nope', enc.salt, ARGON2ID_KDF)
    ).toBeNull();
  });

  test('re-encrypts every secret store from the backup key to the local key', async () => {
    // Simulate a backup created on ANOTHER device: all secrets are encrypted
    // under `backupKey`, which differs from this install's `testMasterKey`.
    const backupKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ]);
    const backupJwk = JSON.stringify(await crypto.subtle.exportKey('jwk', backupKey));
    const salt = testSaltHex();
    const wrapped = await wrapKey(backupJwk, 'backup-password', salt, ARGON2ID_KDF);

    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: {
        loginInfo: [{ domain: 'x.com', password: await encWithKey('pw-secret', backupKey) }],
        identities: [{ id: 'i1', customPassword: await encWithKey('custom-pw', backupKey) }],
        addresses: [
          {
            id: 'b1',
            address: 'b@x.com',
            token: `_enc_:${await encWithKey('tok', backupKey)}`,
            sidToken: `_enc_:${await encWithKey('sid', backupKey)}`,
          },
        ],
        passwordSettings: { customPassword: await encWithKey('ps-pw', backupKey) },
      },
      keyFingerprint: 'f'.repeat(64), // differs from the local device
    };

    const result = await reencryptPayloadToLocalKey(
      payload,
      wrapped,
      'backup-password',
      salt,
      ARGON2ID_KDF
    );
    expect(result.reencrypted).toBe(true);
    expect(result.leftUntouched).toBe(0);

    const data = result.payload.data;
    // Every value now decrypts with the LOCAL master key.
    await expect(
      decWithKey((data.loginInfo as { password: string }[])[0].password, testMasterKey)
    ).resolves.toBe('pw-secret');
    await expect(
      decWithKey((data.identities as { customPassword: string }[])[0].customPassword, testMasterKey)
    ).resolves.toBe('custom-pw');
    const record = (data.addresses as { token: string; sidToken: string }[])[0];
    await expect(decWithKey(record.token.slice('_enc_:'.length), testMasterKey)).resolves.toBe(
      'tok'
    );
    await expect(decWithKey(record.sidToken.slice('_enc_:'.length), testMasterKey)).resolves.toBe(
      'sid'
    );
    await expect(
      decWithKey(
        (data.passwordSettings as { customPassword: string }).customPassword,
        testMasterKey
      )
    ).resolves.toBe('ps-pw');
    // Prefix preserved, fingerprint now matches the local device.
    expect(record.token.startsWith('_enc_:')).toBe(true);
    const localFingerprint = (await getMasterKeyFingerprint()) as string;
    expect(result.payload.keyFingerprint).toBe(localFingerprint);
  });

  test('re-encrypted payload no longer trips the import key-mixing guard', async () => {
    const backupKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ]);
    const backupJwk = JSON.stringify(await crypto.subtle.exportKey('jwk', backupKey));
    const salt = testSaltHex();
    const wrapped = await wrapKey(backupJwk, 'backup-password', salt, ARGON2ID_KDF);
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: { loginInfo: [{ domain: 'x.com', password: await encWithKey('pw', backupKey) }] },
      keyFingerprint: 'f'.repeat(64),
    };
    const { payload: reencrypted } = await reencryptPayloadToLocalKey(
      payload,
      wrapped,
      'backup-password',
      salt,
      ARGON2ID_KDF
    );

    // Existing data + previously-mismatching fingerprint would BLOCK…
    const { ext } = makeExt({ loginInfo: [{ domain: 'x.com', password: 'existing' }] });
    // …but after re-encryption the fingerprint matches, so import succeeds.
    const summary = await importBackup(
      ext,
      reencrypted,
      { categories: ['savedLogins'] },
      async () => {},
      NOW
    );
    expect(summary.keyFingerprintMismatch).toBeFalsy();
  });

  test('wrong password fails to unwrap - payload stays untouched (reencrypted: false)', async () => {
    const backupKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ]);
    const backupJwk = JSON.stringify(await crypto.subtle.exportKey('jwk', backupKey));
    const salt = testSaltHex();
    const wrapped = await wrapKey(backupJwk, 'backup-password', salt, ARGON2ID_KDF);
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: { loginInfo: [{ domain: 'x.com', password: await encWithKey('pw', backupKey) }] },
      keyFingerprint: 'f'.repeat(64),
    };
    const result = await reencryptPayloadToLocalKey(
      payload,
      wrapped,
      'wrong-pw',
      salt,
      ARGON2ID_KDF
    );
    expect(result.reencrypted).toBe(false);
    expect(result.payload).toBe(payload); // unchanged object
  });

  test('no wrapped key → reencrypted: false (plain backups stay device-bound)', async () => {
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: { loginInfo: [{ domain: 'x.com', password: 'pw' }] },
    };
    const result = await reencryptPayloadToLocalKey(payload, undefined, undefined, undefined);
    expect(result.reencrypted).toBe(false);
    expect(result.payload).toBe(payload);
  });
});

describe('per-address email storage import compatibility', () => {
  test('commits imported addresses and their mailbox bags in one storage write', async () => {
    const { ext, writes } = makeExt({ addresses: [] });
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: {
        addresses: [makeAddress({ id: 'a1', address: 'a@test.com' })],
        storedEmails: { 'a@test.com': [{ id: 'm1', received_at: 1 }] },
      },
    };

    await importBackup(
      ext,
      payload,
      { categories: ['addresses'], conflictPolicy: 'replace', includeEmails: true },
      async () => {},
      NOW
    );

    expect(
      writes.some((patch) => 'addresses' in patch && storedEmailsByAddressKey('a1') in patch)
    ).toBe(true);
  });

  test('prunes index AND orphaned bag keys when replacing addresses without importing emails', async () => {
    const { ext, store } = makeExt({
      addresses: [
        makeAddress({ id: 'a1', address: 'a@test.com' }),
        makeAddress({ id: 'b1', address: 'b@test.com' }),
      ],
      emailStorageAddressIndex: {
        a1: 'a@test.com',
        b1: 'b@test.com',
      },
      [storedEmailsByAddressKey('b1')]: [{ id: 'old-b1' }],
      [archivedEmailsByAddressKey('b1')]: [{ id: 'old-archived-b1' }],
    });
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: {
        addresses: [makeAddress({ id: 'a1', address: 'a@test.com' })],
      },
    };

    await importBackup(
      ext,
      payload,
      { categories: ['addresses'], conflictPolicy: 'replace', includeEmails: false },
      async () => {},
      NOW
    );

    expect(store.emailStorageAddressIndex).toEqual({ a1: 'a@test.com', b1: 'b@test.com' });
    // Settings/address-only replace imports leave mail bags untouched.
    expect(store[storedEmailsByAddressKey('b1')]).toEqual([{ id: 'old-b1' }]);
    expect(store[archivedEmailsByAddressKey('b1')]).toEqual([{ id: 'old-archived-b1' }]);
  });

  test('merge policy keeps every existing id, so no bag keys are pruned', async () => {
    const { ext, store } = makeExt({
      addresses: [makeAddress({ id: 'a1', address: 'a@test.com' })],
      emailStorageAddressIndex: { a1: 'a@test.com' },
      [storedEmailsByAddressKey('a1')]: [{ id: 'old-a1' }],
    });
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: {
        addresses: [makeAddress({ id: 'a1', address: 'a@test.com' })],
      },
    };

    await importBackup(
      ext,
      payload,
      { categories: ['addresses'], conflictPolicy: 'merge', includeEmails: false },
      async () => {},
      NOW
    );

    expect(store.emailStorageAddressIndex).toEqual({ a1: 'a@test.com' });
    expect(store[storedEmailsByAddressKey('a1')]).toEqual([{ id: 'old-a1' }]);
  });
});

describe('merge-mode email bag import', () => {
  test('merge with emails preserves overflow-only indexed mail and metadata', async () => {
    const overflowMeta = { messageCount: 1, unreadCount: 1, revision: 3 };
    const { ext, store } = makeExt({
      addresses: [makeAddress({ id: 'a1', address: 'a@test.com' })],
      emailStorageAddressIndex: { a1: 'a@test.com', overflow: 'saved@test.com' },
      [storedEmailsByAddressKey('a1')]: [{ id: 'existing' }],
      [storedEmailsByAddressKey('overflow')]: [{ id: 'saved-stored' }],
      [archivedEmailsByAddressKey('overflow')]: [{ id: 'saved-archived' }],
      emailStorageMetadata: { overflow: overflowMeta },
    });
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: {
        addresses: [makeAddress({ id: 'a1', address: 'a@test.com' })],
        storedEmails: { 'a@test.com': [{ id: 'imported' }] },
      },
    };

    await importBackup(
      ext,
      payload,
      { categories: ['addresses'], conflictPolicy: 'merge', includeEmails: true },
      async () => {},
      NOW
    );

    expect(store.emailStorageAddressIndex).toEqual({
      a1: 'a@test.com',
      overflow: 'saved@test.com',
    });
    expect(store[storedEmailsByAddressKey('overflow')]).toEqual([{ id: 'saved-stored' }]);
    expect(store[archivedEmailsByAddressKey('overflow')]).toEqual([{ id: 'saved-archived' }]);
    expect(store.emailStorageMetadata).toMatchObject({ overflow: overflowMeta });
    expect(store[storedEmailsByAddressKey('a1')]).toEqual([{ id: 'existing' }, { id: 'imported' }]);
  });

  test('merges imported bags into existing per-address lists, deduped by email id', async () => {
    const { ext, store } = makeExt({
      addresses: [makeAddress({ id: 'a1', address: 'a@test.com' })],
      emailStorageAddressIndex: { a1: 'a@test.com' },
      [storedEmailsByAddressKey('a1')]: [
        { id: 'e1', subject: 'old-1' },
        { id: 'e2', subject: 'old-2' },
      ],
      [archivedEmailsByAddressKey('a1')]: [{ id: 'e9', subject: 'archived-old' }],
    });
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: {
        addresses: [
          makeAddress({ id: 'a1', address: 'a@test.com' }),
          makeAddress({ id: 'b1', address: 'b@test.com' }),
        ],
        storedEmails: {
          'a@test.com': [
            { id: 'e2', subject: 'dup-2' },
            { id: 'e3', subject: 'new-3' },
          ],
          'b@test.com': [{ id: 'e4' }],
        },
        archivedEmails: {
          'a@test.com': [{ id: 'e9', subject: 'archived-dup' }, { id: 'e10' }],
        },
      },
    };

    const summary = await importBackup(
      ext,
      payload,
      { categories: ['addresses'], conflictPolicy: 'merge', includeEmails: true },
      async () => {},
      NOW
    );

    expect(summary.importedAddresses).toBe(2);
    const stored = store[storedEmailsByAddressKey('a1')] as { id: string }[];
    expect(stored.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
    const storedB = store[storedEmailsByAddressKey('b1')] as { id: string }[];
    expect(storedB.map((e) => e.id)).toEqual(['e4']);
    const archived = store[archivedEmailsByAddressKey('a1')] as { id: string }[];
    expect(archived.map((e) => e.id)).toEqual(['e9', 'e10']);
  });

  test('replace policy replaces email bags wholesale', async () => {
    const { ext, store } = makeExt({
      addresses: [makeAddress({ id: 'a1', address: 'a@test.com' })],
      emailStorageAddressIndex: { a1: 'a@test.com' },
      [storedEmailsByAddressKey('a1')]: [{ id: 'e1' }],
    });
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: {
        addresses: [makeAddress({ id: 'a1', address: 'a@test.com' })],
        storedEmails: { 'a@test.com': [{ id: 'e5' }] },
      },
    };

    await importBackup(
      ext,
      payload,
      { categories: ['addresses'], conflictPolicy: 'replace', includeEmails: true },
      async () => {},
      NOW
    );

    const stored = store[storedEmailsByAddressKey('a1')] as { id: string }[];
    expect(stored.map((e) => e.id)).toEqual(['e5']);
  });
});

describe('encrypted backup Argon2id profile', () => {
  test('export records the Argon2id profile used', async () => {
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: { themeMode: 'dark' },
    };
    const enc = await encryptBackupPayload(payload, 'backup-password');
    expect(enc.kdf).toEqual(ARGON2ID_KDF);
    const dec = await decryptBackupPayload(enc, 'backup-password');
    expect(dec.data.themeMode).toBe('dark');
  });

  test('rejects missing or unsupported KDF metadata before derivation', async () => {
    const base = {
      version: '3.0',
      encrypted: true as const,
      salt: testSaltHex(),
      ciphertext: '00:00',
    };
    await expect(
      decryptBackupPayload(base as EncryptedBackupFile, 'backup-password')
    ).rejects.toThrow();
    await expect(
      decryptBackupPayload(
        { ...base, kdf: { ...ARGON2ID_KDF, memoryKiB: 999999999 } } as EncryptedBackupFile,
        'backup-password'
      )
    ).rejects.toThrow();
  });

  test('wrapped master key uses the recorded Argon2id profile', async () => {
    const backupKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ]);
    const backupJwk = JSON.stringify(await crypto.subtle.exportKey('jwk', backupKey));
    const salt = testSaltHex();
    const wrapped = await wrapKey(backupJwk, 'backup-password', salt, ARGON2ID_KDF);
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: { loginInfo: [{ domain: 'x.com', password: await encWithKey('pw', backupKey) }] },
      keyFingerprint: 'f'.repeat(64),
    };
    // The wrapper and payload use the same profile, which must be passed through.
    const result = await reencryptPayloadToLocalKey(
      payload,
      wrapped,
      'backup-password',
      salt,
      ARGON2ID_KDF
    );
    expect(result.reencrypted).toBe(true);
    await expect(
      decWithKey(
        (result.payload.data.loginInfo as { password: string }[])[0].password,
        testMasterKey
      )
    ).resolves.toBe('pw');
  });

  test('a wrapped key without KDF metadata is not unwrapped', async () => {
    const backupKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ]);
    const backupJwk = JSON.stringify(await crypto.subtle.exportKey('jwk', backupKey));
    const salt = testSaltHex();
    const wrapped = await wrapKey(backupJwk, 'backup-password', salt);
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: { loginInfo: [{ domain: 'x.com', password: await encWithKey('pw', backupKey) }] },
      keyFingerprint: 'f'.repeat(64),
    };

    const result = await reencryptPayloadToLocalKey(payload, wrapped, 'backup-password', salt);
    // Unwrap failed → nothing was re-encrypted and the secrets are dropped.
    expect(result.reencrypted).toBe(false);
    expect(result.leftUntouched).toBe(0);
    // The login password is still the BACKUP-key ciphertext (untouched),
    // never a device-key re-encryption.
    await expect(
      decWithKey((result.payload.data.loginInfo as { password: string }[])[0].password, backupKey)
    ).resolves.toBe('pw');
  });
});

describe('wipe-and-restore plain backup (device key destroyed)', () => {
  test('undecryptable imported secrets are dropped, structure is kept, and the drop is flagged', async () => {
    const backupKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ]);
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: {
        loginInfo: [{ domain: 'x.com', password: await encWithKey('pw', backupKey) }],
        addresses: [
          makeAddress({
            id: 'w1',
            address: 'w@test.com',
            token: `_enc_:${await encWithKey('tok', backupKey)}`,
            sidToken: `_enc_:${await encWithKey('sid', backupKey)}`,
          }),
        ],
      },
      keyFingerprint: 'f'.repeat(64), // old key, wiped before restore
    };

    const { ext, store } = makeExt({});
    const summary = await importBackup(
      ext,
      payload,
      { categories: ['savedLogins', 'addresses'], expiredMode: 'all' },
      async () => {},
      NOW
    );

    expect(summary.keyFingerprintMismatch).toBe(true);
    expect(summary.secretsDropped).toBe(true);
    // Structure imported, secrets gone.
    expect((store.loginInfo as unknown[]).length).toBe(1);
    expect((store.loginInfo as { password?: string }[])[0].password).toBeUndefined();
    const record = (store.addresses as { id: string; token?: string; sidToken?: string }[])[0];
    expect(record.id).toBe('w1');
    expect(record.token).toBeUndefined();
    expect(record.sidToken).toBeUndefined();
  });

  test('decryptable secrets survive a mismatched fingerprint (decryptability decides)', async () => {
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: { loginInfo: [{ domain: 'x.com', password: await encWithKey('pw', testMasterKey) }] },
      keyFingerprint: 'f'.repeat(64), // stale fingerprint - values still decrypt locally
    };
    const { ext, store } = makeExt({});
    const summary = await importBackup(
      ext,
      payload,
      { categories: ['savedLogins'] },
      async () => {},
      NOW
    );
    expect(summary.keyFingerprintMismatch).toBe(true);
    expect(summary.secretsDropped).toBeFalsy();
    await expect(
      decWithKey((store.loginInfo as { password: string }[])[0].password, testMasterKey)
    ).resolves.toBe('pw');
  });

  test('same-device plain backup (matching fingerprint) imports secrets untouched', async () => {
    const current = (await getMasterKeyFingerprint()) as string;
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: {
        addresses: [
          makeAddress({
            id: 's1',
            address: 's@test.com',
            token: `_enc_:${await encWithKey('tok', testMasterKey)}`,
          }),
        ],
      },
      keyFingerprint: current,
    };
    const { ext, store } = makeExt({});
    const summary = await importBackup(
      ext,
      payload,
      { categories: ['addresses'] },
      async () => {},
      NOW
    );
    expect(summary.secretsDropped).toBeFalsy();
    await expect(
      decWithKey(
        ((store.addresses as { token: string }[])[0].token as string).slice('_enc_:'.length),
        testMasterKey
      )
    ).resolves.toBe('tok');
  });
});

describe('inbox rules in backups', () => {
  function makeRule(id: string, contains: string, extra: Record<string, unknown> = {}) {
    return { id, name: contains, enabled: true, field: 'sender', contains, ...extra };
  }

  test('keysForCategories maps the mailboxRules category to its storage key', () => {
    expect(keysForCategories(['mailboxRules'])).toEqual(['mailboxRules']);
    expect(keysForCategories([...ALL_BACKUP_CATEGORIES])).toContain('mailboxRules');
  });

  test('buildBackupPayload exports the rules and inspectBackup counts them', async () => {
    const rules = [makeRule('r1', 'github'), makeRule('r2', 'stripe', { tag: 'billing' })];
    const { ext } = makeExt({ mailboxRules: rules });
    const payload = await buildBackupPayload(ext, { categories: ['mailboxRules'] });
    expect(payload.data.mailboxRules).toEqual(rules);
    expect(payload.data.addresses).toBeUndefined();
    const insp = inspectBackup(payload, NOW);
    expect(insp.presentCategories).toContain('mailboxRules');
    expect(insp.counts.mailboxRules).toBe(2);
  });

  test('inferPresentCategories detects rules from the data key', () => {
    expect(inferPresentCategories({ mailboxRules: [makeRule('r1', 'github')] })).toContain(
      'mailboxRules'
    );
  });

  test('previewImport reports new vs existing rules', async () => {
    const existing = [makeRule('r1', 'github')];
    const incoming = [makeRule('r1', 'github'), makeRule('r2', 'stripe')];
    const { ext } = makeExt({ mailboxRules: existing });
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: { mailboxRules: incoming },
    };
    const preview = await previewImport(ext, payload, { categories: ['mailboxRules'] }, NOW);
    expect(preview.newRules).toBe(1);
    expect(preview.skippedExistingRules).toBe(1);
    // Replace policy counts everything as new.
    const replace = await previewImport(
      ext,
      payload,
      { categories: ['mailboxRules'], conflictPolicy: 'replace' },
      NOW
    );
    expect(replace.newRules).toBe(2);
  });

  test('importBackup merges rules by id and reports the summary count', async () => {
    const existing = [makeRule('r1', 'github', { tag: 'old' })];
    const incoming = [
      makeRule('r1', 'github', { tag: 'new' }),
      makeRule('r2', 'stripe', {
        forwardTo: 'attacker@example.com',
        autoCopyOtp: true,
        enabled: true,
      }),
    ];
    const { ext, store } = makeExt({ mailboxRules: existing });
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: { mailboxRules: incoming },
    };
    const summary = await importBackup(
      ext,
      payload,
      { categories: ['mailboxRules'], conflictPolicy: 'merge' },
      async () => {},
      NOW
    );
    expect(summary.imported.mailboxRules).toBe(2);
    const stored = store.mailboxRules as {
      id: string;
      tag?: string;
      enabled?: boolean;
      autoCopyOtp?: boolean;
      forwardTo?: string;
    }[];
    expect(stored).toHaveLength(2);
    // Merge keeps the EXISTING item on id collision (same as filters/identities).
    const r1 = stored.find((r) => r.id === 'r1');
    expect(r1?.tag).toBe('old');
    const r2 = stored.find((r) => r.id === 'r2');
    expect(r2?.enabled).toBe(false);
    expect(r2?.autoCopyOtp).toBe(false);
    expect(r2?.forwardTo).toBeUndefined();
  });

  test('importBackup replace policy replaces the whole rules list', async () => {
    const existing = [makeRule('r1', 'github')];
    const incoming = [makeRule('r2', 'stripe')];
    const { ext, store } = makeExt({ mailboxRules: existing });
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: { mailboxRules: incoming },
    };
    await importBackup(
      ext,
      payload,
      { categories: ['mailboxRules'], conflictPolicy: 'replace' },
      async () => {},
      NOW
    );
    const stored = store.mailboxRules as { id: string }[];
    expect(stored.map((r) => r.id)).toEqual(['r2']);
    expect(store.mailboxRules).toMatchObject([{ enabled: false, autoCopyOtp: false }]);
  });

  test('rules import cleanly alongside a mismatched fingerprint (no secrets to mix)', async () => {
    const rules = [makeRule('r1', 'github', { forwardTo: 'me@x.com' })];
    const { ext, store } = makeExt({});
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: { mailboxRules: rules },
      keyFingerprint: 'definitely-not-this-device',
    };
    const summary = await importBackup(
      ext,
      payload,
      { categories: ['mailboxRules'] },
      async () => {},
      NOW
    );
    expect(summary.imported.mailboxRules).toBe(1);
    expect(store.mailboxRules).toEqual([
      {
        id: 'r1',
        name: 'github',
        enabled: false,
        field: 'senderOrRecipient',
        matchingVersion: 2,
        contains: 'github',
        senderAllowlist: undefined,
        recipientAllowlist: undefined,
        label: undefined,
        autoArchiveDays: null,
        silenceNotifications: false,
        autoCopyOtp: false,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);
  });
});

describe('site rules in backups', () => {
  const siteRule = (id: string, domainPattern = 'example.com') => ({
    id,
    domainPattern,
    name: domainPattern,
    enabled: true,
    identityId: 'identity-1',
    providerId: 'guerrilla',
    autoArchiveDays: 3,
    includeSubdomains: false,
    createdAt: NOW,
    updatedAt: NOW,
  });

  test('full exports include site rules and separate category/count previews', async () => {
    const { ext } = makeExt({ siteRules: [siteRule('site-1')] });
    const payload = await buildBackupPayload(ext, { categories: [...ALL_BACKUP_CATEGORIES] });
    expect(payload.data.siteRules).toEqual([siteRule('site-1')]);
    const inspected = inspectBackup(payload);
    expect(inspected.counts.siteRules).toBe(1);
    expect(inspected.presentCategories).toContain('siteRules');
    expect(keysForCategories(['siteRules'])).toEqual(['siteRules']);
  });

  test('site rules round-trip disabled and preserve preferences with merge/replace', async () => {
    for (const conflictPolicy of ['merge', 'replace'] as const) {
      const { ext, store } = makeExt({ siteRules: [siteRule('existing', 'old.example')] });
      const payload: BackupFileV3 = {
        version: '3.0',
        exportDate: '',
        data: { siteRules: [siteRule('incoming')] },
      };
      const selection = { categories: ['siteRules'] as const, conflictPolicy };
      const preview = await previewImport(
        ext,
        payload,
        { ...selection, categories: ['siteRules'] },
        NOW
      );
      expect(preview.newRules).toBe(1);
      const summary = await importBackup(
        ext,
        payload,
        { ...selection, categories: ['siteRules'] },
        async () => {},
        NOW
      );
      expect(summary.imported.siteRules).toBe(1);
      expect(store.siteRules).toContainEqual({ ...siteRule('incoming'), enabled: false });
      expect((store.siteRules as unknown[]).length).toBe(conflictPolicy === 'merge' ? 2 : 1);
    }
  });

  test('replacing rules cancels their schedules while keeping the other rule family', async () => {
    const { ext, store } = makeExt({
      siteRules: [siteRule('old')],
      siteRuleArchiveSchedule: {
        inbox: {
          ruleId: 'old',
          domain: 'example.com',
          scheduledAt: NOW,
          archiveAt: NOW + 86400000,
          sources: [
            {
              ruleId: 'old',
              ruleKind: 'site',
              domain: 'example.com',
              scheduledAt: NOW,
              archiveAt: NOW + 86400000,
            },
            {
              ruleId: 'mail',
              ruleKind: 'mailbox',
              domain: 'example.com',
              scheduledAt: NOW,
              archiveAt: NOW + 7 * 86400000,
            },
          ],
        },
      },
    });
    await importBackup(
      ext,
      { version: '3.0', exportDate: '', data: { siteRules: [] } },
      { categories: ['siteRules'], conflictPolicy: 'replace' },
      async () => {},
      NOW
    );
    expect(store.siteRules).toEqual([]);
    expect((store.siteRuleArchiveSchedule as Record<string, { ruleId: string }>).inbox.ruleId).toBe(
      'mail'
    );
  });

  test('over-capacity import rejects without writing or evicting existing rules', async () => {
    const initial = Array.from({ length: 40 }, (_, index) =>
      siteRule(`old-${index}`, `old${index}.example`)
    );
    const { ext, store } = makeExt({ siteRules: initial });
    await expect(
      importBackup(
        ext,
        { version: '3.0', exportDate: '', data: { siteRules: [siteRule('new')] } },
        { categories: ['siteRules'], conflictPolicy: 'merge' },
        async () => {},
        NOW
      )
    ).rejects.toThrow('rule-limit-exceeded');
    expect(store.siteRules).toEqual(initial);
  });
});

describe('settings custom password in backups', () => {
  test('customPassword counts as a secret so encrypted backups wrap the key', async () => {
    const { ext } = makeExt({
      passwordSettings: {
        useCustom: true,
        customPassword: await encWithKey('ps-pw', testMasterKey),
      },
    });
    const payload = await buildBackupPayload(ext, { categories: ['settings'] });
    expect(dataContainsSecrets(payload.data)).toBe(true);
    const enc = await encryptBackupPayload(payload, 'backup-password');
    expect(typeof enc.wrappedMasterKey).toBe('string');
  });

  test('same-key settings restore carries customPassword through', async () => {
    const current = (await getMasterKeyFingerprint()) as string;
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: {
        passwordSettings: {
          useCustom: true,
          customPassword: await encWithKey('ps-pw', testMasterKey),
        },
      },
      keyFingerprint: current,
    };
    const { ext, store } = makeExt({});
    await importBackup(ext, payload, { categories: ['settings'] }, async () => {}, NOW);
    await expect(
      decWithKey(
        (store.passwordSettings as { customPassword: string }).customPassword,
        testMasterKey
      )
    ).resolves.toBe('ps-pw');
  });
});
