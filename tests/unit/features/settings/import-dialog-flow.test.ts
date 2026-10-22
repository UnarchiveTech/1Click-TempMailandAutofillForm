/**
 * UI-level test for the ImportBackupDialog flow.
 *
 * There is no Svelte component-test harness in this repo, so this drives the
 * EXACT module pipeline the dialog executes on import - parseBackupText →
 * resolveBackupPayload → inspectBackup (step 1 → 2) → previewImport (dry run)
 * → importBackup - against a plain backup created under a FOREIGN device
 * master key (the wipe-and-restore scenario). It then assembles the dialog's
 * own success message (handleImport's `parts` array) and asserts:
 *
 *   • the import PROCEEDS (no throw) - nothing to mix into on a fresh install,
 *   • structure is imported (inbox record, login, identity, settings),
 *   • the undecryptable ciphertext is dropped (tokens/passwords undefined),
 *   • the summary carries keyFingerprintMismatch + secretsDropped,
 *   • the surfaced message contains backup.secretsDroppedWarning.
 */

import { afterAll, describe, expect, mock, test } from 'bun:test';

import type { BackupCategory, BackupFileV3 } from '@/features/settings/backup-actions.js';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
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

// ── Self-contained REAL-AES mock of crypto.ts (same surface as the sibling
//    backup-actions.test.ts mock - bun's mock.module is process-global, so the
//    full export surface must be present or sibling files break). ─────────────

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
const ARGON2ID_KDF = {
  algorithm: 'argon2id' as const,
  formatVersion: 1,
  version: 19,
  memoryKiB: 19 * 1024,
  iterations: 2,
  parallelism: 1,
  hashLength: 32,
};

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
  const keyBytes = new Uint8Array(rawKey);
  return crypto.subtle.importKey('raw', keyBytes.buffer, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
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
  deriveKeyFromPassword: deriveArgon2id,
  ARGON2ID_KDF,
  isSupportedArgon2idKdf: (kdf: unknown) => JSON.stringify(kdf) === JSON.stringify(ARGON2ID_KDF),
  MASTER_KEY_ID: '1click_master_encryption_key',
}));
const { importBackup, inspectBackup, parseBackupText, previewImport, resolveBackupPayload } =
  await import('@/features/settings/backup-actions.js');
const { t } = await import('@/utils/i18n/i18n-utils.js');
const { storedEmailsByAddressKey } = await import('@/utils/storage/storage-keys.js');

// ── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;

function makeAddress(
  overrides: Partial<{ id: string; address: string; token?: string; sidToken?: string }> = {}
) {
  return {
    id: overrides.id ?? 'inbox-1',
    address: overrides.address ?? 'a@test.com',
    provider: 'guerrilla',
    createdAt: NOW - 3600000,
    expiresAt: NOW + 3600000,
    accountStatus: 'active' as const,
    token: overrides.token,
    sidToken: overrides.sidToken,
  };
}

function makeExt(initial: Record<string, unknown> = {}) {
  const store = { ...initial };
  return {
    store,
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
            Object.assign(store, items);
          },
        },
      },
    },
  };
}

// ── The dialog flow (mirrors ImportBackupDialog.handleImport) ────────────────

type StorageLike = {
  storage: {
    local: {
      get: (keys: string[] | null) => Promise<Record<string, unknown>>;
      set: (items: Record<string, unknown>) => Promise<void>;
    };
  };
};

async function dialogImport(ext: StorageLike, payload: BackupFileV3, categories: BackupCategory[]) {
  // step 1 → 2: dry run with the dialog defaults (select all present,
  // expiredMode 'all', conflictPolicy 'replace')
  const dryRun = await previewImport(
    ext,
    payload,
    { categories, includeEmails: true, expiredMode: 'all', conflictPolicy: 'replace' },
    NOW
  );
  // step 2 → 3: perform the import with the same selection
  const summary = await importBackup(
    ext,
    payload,
    { categories, includeEmails: true, expiredMode: 'all', conflictPolicy: 'replace' },
    async () => {},
    NOW
  );
  return { dryRun, summary };
}

/** Assemble the dialog's onSuccess message exactly like handleImport does. */
async function dialogSuccessMessage(summary: Awaited<ReturnType<typeof importBackup>>) {
  const parts: string[] = [];
  if (summary.importedAddresses)
    parts.push(await t('backup.summaryAddresses', { n: summary.importedAddresses }));
  if (summary.skippedExpiredAddresses)
    parts.push(await t('backup.summarySkippedExpired', { n: summary.skippedExpiredAddresses }));
  if (summary.imported.identities)
    parts.push(await t('backup.summaryIdentities', { n: summary.imported.identities }));
  if (summary.imported.savedLogins)
    parts.push(await t('backup.summaryLogins', { n: summary.imported.savedLogins }));
  if (summary.keyFingerprintMismatch) parts.push(await t('backup.keyMismatchWarning'));
  if (summary.secretsDropped) parts.push(await t('backup.secretsDroppedWarning'));
  return parts.join(' · ');
}

describe('ImportBackupDialog flow - plain backup under a FOREIGN device key', () => {
  test('import proceeds, drops undecryptable secrets, and surfaces the secretsDropped warning', async () => {
    // A backup exported on ANOTHER device: every secret is master-key
    // ciphertext under `foreignKey`, which this device cannot decrypt.
    const foreignKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ]);
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '2026-01-01T00:00:00.000Z',
      categories: 'all',
      data: {
        addresses: [
          makeAddress({
            id: 'fx-1',
            address: 'fx@test.com',
            token: `_enc_:${await encWithKey('tok-secret', foreignKey)}`,
            sidToken: `_enc_:${await encWithKey('sid-secret', foreignKey)}`,
          }),
        ],
        storedEmails: { 'fx@test.com': [{ id: 'e1', subject: 'foreign mail' }] },
        loginInfo: [
          { domain: 'example.com', password: await encWithKey('login-secret', foreignKey) },
        ],
        identities: [
          {
            id: 'i1',
            name: 'Foreign',
            customPassword: await encWithKey('ident-secret', foreignKey),
          },
        ],
        passwordSettings: {
          useCustom: true,
          customPassword: await encWithKey('ps-secret', foreignKey),
        },
        themeMode: 'dark',
      },
      keyFingerprint: 'f'.repeat(64), // the OLD device key (destroyed by the wipe)
    };

    // ── Step 1: parse the file (dialog: loadFromText → parseBackupText) ─────
    const parsed = await parseBackupText(JSON.stringify(payload));
    expect(parsed.kind).toBe('plain');

    // ── Step 1→2: resolve + inspect (dialog: applyPlainPayload → inspectBackup)
    const { payload: resolved } = await resolveBackupPayload(parsed);
    const inspection = inspectBackup(resolved, NOW);
    expect(inspection.counts.addressesTotal).toBe(1);
    expect(inspection.counts.identities).toBe(1);
    expect(inspection.counts.savedLogins).toBe(1);
    expect(inspection.counts.storedEmailBags).toBe(1);

    // ── Step 2: dry run on a fresh install (nothing to mix into) ────────────
    const { ext, store } = makeExt({});
    const { dryRun, summary } = await dialogImport(ext, resolved, [
      'settings',
      'identities',
      'savedLogins',
      'addresses',
    ]);

    // The user is shown the dry run; the import must be allowed to proceed.
    expect(dryRun.addressesToImport).toBe(1);
    expect(dryRun.willReplace).toBe(true);
    expect(dryRun.settingsKeys).toBe(2);

    // … but the dry run must warn BEFORE import: 2 inbox values (token +
    // sidToken) + 1 login + 1 identity + 1 settings customPassword = 5
    // credential values that cannot decrypt on this device and will drop.
    expect(dryRun.secretsImportBlocked).toBe(false);
    expect(dryRun.secretsDroppable).toBe(5);

    // ── Step 3: import proceeds (no throw), flags are set ───────────────────
    expect(summary.importedAddresses).toBe(1);
    expect(summary.keyFingerprintMismatch).toBe(true);
    expect(summary.secretsDropped).toBe(true);

    // The re-auth walkthrough must know WHICH addresses lost credentials.
    expect(summary.secretsDroppedAddresses).toEqual([
      { id: 'fx-1', address: 'fx@test.com', provider: 'guerrilla' },
    ]);

    // Structure imported …
    const importedAddress = (store.addresses as { id: string; address: string }[])[0];
    expect(importedAddress.id).toBe('fx-1');
    expect(importedAddress.address).toBe('fx@test.com');
    expect((store.loginInfo as unknown[]).length).toBe(1);
    expect((store.identities as unknown[]).length).toBe(1);
    // The email bag lands in the imported address's stable ID-keyed store.
    expect(store[storedEmailsByAddressKey('fx-1')]).toEqual([
      { id: 'e1', subject: 'foreign mail' },
    ]);
    expect(store.emailStorageAddressIndex).toEqual({ 'fx-1': 'fx@test.com' });
    expect((store.passwordSettings as { useCustom?: boolean }).useCustom).toBe(true);
    expect(store.themeMode).toBe('dark');

    // … but the undecryptable ciphertext is gone (would be permanent garbage).
    const storedAddress = (store.addresses as { token?: string; sidToken?: string }[])[0];
    expect(storedAddress.token).toBeUndefined();
    expect(storedAddress.sidToken).toBeUndefined();
    expect((store.loginInfo as { password?: string }[])[0].password).toBeUndefined();
    expect((store.identities as { customPassword?: string }[])[0].customPassword).toBeUndefined();
    expect((store.passwordSettings as { customPassword?: string }).customPassword).toBeUndefined();

    // ── The dialog's success message surfaces the warning ───────────────────
    const warning = await t('backup.secretsDroppedWarning');
    expect(warning).not.toBe('backup.secretsDroppedWarning'); // key resolves
    const message = await dialogSuccessMessage(summary);
    expect(message).toContain(warning);
    expect(message).toContain(await t('backup.keyMismatchWarning'));
  });

  test('expiry-mode filtering narrows the re-auth list to actually-imported addresses', async () => {
    const foreignKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ]);
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '2026-01-01T00:00:00.000Z',
      categories: 'all',
      data: {
        addresses: [
          makeAddress({
            id: 'live-1',
            address: 'live@test.com',
            token: `_enc_:${await encWithKey('tok-1', foreignKey)}`,
          }),
          // Expired and skipped by expiredMode 'skip' → must NOT appear in the
          // re-auth list even though its token was also dropped.
          makeAddress({
            id: 'gone-1',
            address: 'gone@test.com',
            token: `_enc_:${await encWithKey('tok-2', foreignKey)}`,
          }),
        ],
      },
      keyFingerprint: 'f'.repeat(64),
    };

    // Make the second inbox expired without touching its ciphertext token.
    const data = payload.data as { addresses: Array<Record<string, unknown>> };
    data.addresses[1] = { ...data.addresses[1], expiresAt: NOW - 1000 };

    const { ext } = makeExt({});
    const summary = await importBackup(
      ext,
      payload,
      {
        categories: ['addresses'],
        includeEmails: false,
        expiredMode: 'skip',
        conflictPolicy: 'replace',
      },
      async () => {},
      NOW
    );

    expect(summary.secretsDropped).toBe(true);
    expect(summary.importedAddresses).toBe(1);
    expect(summary.skippedExpiredAddresses).toBe(1);
    expect(summary.secretsDroppedAddresses).toEqual([
      { id: 'live-1', address: 'live@test.com', provider: 'guerrilla' },
    ]);
  });

  test('foreign-key backup over existing secrets is reported as blocked in the dry run', async () => {
    const foreignKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ]);
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      categories: 'all',
      data: {
        addresses: [
          makeAddress({
            id: 'blocked-1',
            address: 'blocked@test.com',
            token: `_enc_:${await encWithKey('tok-secret', foreignKey)}`,
          }),
        ],
      },
      keyFingerprint: 'f'.repeat(64),
    };

    // The install already holds secret-bearing data (an inbox with a token) -
    // importing the foreign backup would mix keys, so the dry run must warn
    // and the import itself must refuse.
    const { ext } = makeExt({
      addresses: [makeAddress({ id: 'mine-1', address: 'mine@test.com', token: 'local-token' })],
    });

    const dryRun = await previewImport(
      ext,
      payload,
      { categories: ['addresses'], includeEmails: false, conflictPolicy: 'replace' },
      NOW
    );
    expect(dryRun.secretsImportBlocked).toBe(true);
    expect(dryRun.secretsDroppable).toBe(0);

    await expect(
      importBackup(
        ext,
        payload,
        { categories: ['addresses'], includeEmails: false, conflictPolicy: 'replace' },
        async () => {},
        NOW
      )
    ).rejects.toThrow(/different device key/);
  });

  test('foreign fingerprint with no secret categories selected neither blocks nor drops', async () => {
    // A foreign-key backup whose SELECTED category carries no secrets - the
    // key-compat guard must stay silent (nothing would mix or drop).
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      categories: 'all',
      data: {
        savedSearchFilters: [{ id: 'f1', name: 'OTP' }],
      },
      keyFingerprint: 'f'.repeat(64),
    };

    const { ext, store } = makeExt({});
    const dryRun = await previewImport(
      ext,
      payload,
      { categories: ['filters'], conflictPolicy: 'replace' },
      NOW
    );
    expect(dryRun.secretsDroppable).toBe(0);
    expect(dryRun.secretsImportBlocked).toBe(false);
    expect(dryRun.newFilters).toBe(1);

    const summary = await importBackup(
      ext,
      payload,
      { categories: ['filters'], conflictPolicy: 'replace' },
      async () => {},
      NOW
    );
    // Mismatch is still noted, but nothing is blocked or dropped.
    expect(summary.keyFingerprintMismatch).toBe(true);
    expect(summary.secretsDropped).toBeFalsy();
    expect((store.savedSearchFilters as unknown[]).length).toBe(1);
  });

  test('foreign fingerprint whose ciphertext decrypts locally is neither blocked nor dropped', async () => {
    // Simulates a backup whose fingerprint is stale/different but whose secrets
    // are readable with the CURRENT key - the dry run must not promise a drop
    // and the import must keep the secrets intact.
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      categories: 'all',
      data: {
        addresses: [
          makeAddress({
            id: 'dec-1',
            address: 'dec@test.com',
            token: `_enc_:${await encWithKey('readable-token', testMasterKey)}`,
          }),
        ],
      },
      keyFingerprint: 'f'.repeat(64),
    };

    const { ext, store } = makeExt({});
    const dryRun = await previewImport(
      ext,
      payload,
      { categories: ['addresses'], includeEmails: false, conflictPolicy: 'replace' },
      NOW
    );
    expect(dryRun.secretsDroppable).toBe(0);
    expect(dryRun.secretsImportBlocked).toBe(false);

    const summary = await importBackup(
      ext,
      payload,
      { categories: ['addresses'], includeEmails: false, conflictPolicy: 'replace' },
      async () => {},
      NOW
    );
    expect(summary.keyFingerprintMismatch).toBe(true);
    expect(summary.secretsDropped).toBeFalsy();
    // The token survived the import and still decrypts with the local key.
    const stored = (store.addresses as { token: string }[])[0];
    await expect(decWithKey(stored.token.slice('_enc_:'.length), testMasterKey)).resolves.toBe(
      'readable-token'
    );
  });

  test('same-device backup (matching fingerprint) imports secrets untouched and shows no drop warning', async () => {
    const current = await getLocalFingerprint();
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      categories: 'all',
      data: {
        addresses: [
          makeAddress({
            id: 'own-1',
            address: 'own@test.com',
            token: `_enc_:${await encWithKey('tok-secret', testMasterKey)}`,
          }),
        ],
        storedEmails: { 'own@test.com': [{ id: 'e1' }] },
      },
      keyFingerprint: current,
    };

    const { ext, store } = makeExt({});
    const { dryRun, summary } = await dialogImport(ext, payload, ['addresses']);

    expect(dryRun.secretsDroppable).toBe(0);
    expect(dryRun.secretsImportBlocked).toBe(false);
    expect(summary.keyFingerprintMismatch).toBeFalsy();
    expect(summary.secretsDropped).toBeFalsy();
    // Token decrypts with the LOCAL key - nothing dropped.
    await expect(
      decWithKey(
        ((store.addresses as { token: string }[])[0].token as string).slice('_enc_:'.length),
        testMasterKey
      )
    ).resolves.toBe('tok-secret');
    const message = await dialogSuccessMessage(summary);
    expect(message).not.toContain(await t('backup.secretsDroppedWarning'));
  });
});

/** Fingerprint of the mocked local master key (mirrors getMasterKeyFingerprint). */
async function getLocalFingerprint(): Promise<string> {
  const jwk = await crypto.subtle.exportKey('jwk', testMasterKey);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(jwk))
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
