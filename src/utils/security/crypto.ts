/**
 * Cryptographic utilities for secure password storage using Web Crypto API
 * Uses AES-GCM encryption with a key derived from a master secret
 *
 * SECURITY NOTES:
 * - Keys are stored in extension storage (encrypted by browser's extension storage security)
 * - In production, consider using chrome.storage.session for more sensitive data
 * - Password-derived keys use Argon2id with a unique salt and memory-hard parameters
 */

import { browser } from 'wxt/browser';
import { CONSTANTS } from '../constants.js';
import { DecryptionError, EncryptionError, KeyRotationError } from '../errors.js';
import { logError } from '../logger.js';
import { withLock } from '../mutex.js';
import { writeWithRetry } from '../storage/storage-write.js';

/**
 * Versioned Argon2id profile used for password-derived vault and backup keys.
 * 19 MiB / 2 passes / 1 lane meets OWASP's current minimum recommendation.
 */
export const ARGON2ID_KDF = Object.freeze({
  algorithm: 'argon2id' as const,
  formatVersion: 1,
  version: 19,
  memoryKiB: 19 * 1024,
  iterations: 2,
  parallelism: 1,
  hashLength: 32,
});

export type Argon2idKdf = typeof ARGON2ID_KDF;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Accept only the profile this build can derive safely and consistently. */
export function isSupportedArgon2idKdf(value: unknown): value is Argon2idKdf {
  if (!value || typeof value !== 'object') return false;
  const kdf = value as Partial<Argon2idKdf>;
  return (
    kdf.algorithm === ARGON2ID_KDF.algorithm &&
    kdf.formatVersion === ARGON2ID_KDF.formatVersion &&
    kdf.version === ARGON2ID_KDF.version &&
    kdf.memoryKiB === ARGON2ID_KDF.memoryKiB &&
    kdf.iterations === ARGON2ID_KDF.iterations &&
    kdf.parallelism === ARGON2ID_KDF.parallelism &&
    kdf.hashLength === ARGON2ID_KDF.hashLength
  );
}

// Master encryption key (in production, this should be stored securely)
// For browser extensions, we use extension storage which is more secure than localStorage
export const MASTER_KEY_ID = '1click_master_encryption_key';
const KEY_METADATA_ID = '1click_key_metadata';
/** Mirrors vault-lock config key - avoid circular import with vault-lock.ts */
const VAULT_CONFIG_KEY = 'vault_security_config';

/** Thrown when encrypt/decrypt is attempted while password/biometrics vault is locked */
export class VaultLockedError extends Error {
  constructor(message = 'Vault is locked') {
    super(message);
    this.name = 'VaultLockedError';
  }
}

interface KeyMetadata {
  version: number;
  createdAt: number;
  lastRotated: number;
  rotationInterval: number; // milliseconds
}

/**
 * Generate a random encryption key
 */
async function generateKey(): Promise<CryptoKey> {
  return await crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256,
    },
    true,
    ['encrypt', 'decrypt']
  );
}

// Single in-flight promise so concurrent callers share one key generation.
let _masterKeyPromise: Promise<CryptoKey> | null = null;
let _masterKeyGeneration = 0;

export function clearCachedMasterKey(): void {
  _masterKeyGeneration += 1;
  _masterKeyPromise = null;
}

// Each extension page has its own module cache, while storage.session and
// runtime messages are shared across those pages. A lock in the service worker
// must revoke every page's cached CryptoKey, not only the worker's copy.
browser?.storage?.onChanged?.addListener((changes, areaName) => {
  if (areaName === 'session' && Object.keys(changes).includes(MASTER_KEY_ID)) {
    clearCachedMasterKey();
  }
});

browser?.runtime?.onMessage?.addListener((message) => {
  if ((message as { type?: string } | null)?.type === 'vaultLocked') {
    clearCachedMasterKey();
  }
});

/**
 * Get or create the master encryption key
 * Uses a combination of device-specific data and random generation
 */
export async function getOrCreateMasterKey(): Promise<CryptoKey> {
  const generation = _masterKeyGeneration;
  const cachedPromise = _masterKeyPromise;
  if (cachedPromise) {
    try {
      const key = await cachedPromise;
      // Lock, unlock, or rotation may have invalidated this module's cache
      // while storage reads / CryptoKey import were in flight. Never hand the
      // stale result to a caller after that invalidation.
      if (generation !== _masterKeyGeneration) return getOrCreateMasterKey();
      return key;
    } catch {
      if (generation !== _masterKeyGeneration) return getOrCreateMasterKey();
      // Another waiter may already have replaced the rejected promise. Reuse
      // that replacement instead of letting every waiter start its own load.
      if (_masterKeyPromise !== cachedPromise) return getOrCreateMasterKey();
      _masterKeyPromise = null;
    }
  }

  const loadGeneration = _masterKeyGeneration;
  let pendingPromise: Promise<CryptoKey>;
  pendingPromise = _getOrCreateMasterKeyImpl().catch((e) => {
    if (_masterKeyPromise === pendingPromise) _masterKeyPromise = null;
    throw e;
  });
  _masterKeyPromise = pendingPromise;
  try {
    const key = await pendingPromise;
    if (loadGeneration !== _masterKeyGeneration) return getOrCreateMasterKey();
    return key;
  } catch (error) {
    if (loadGeneration !== _masterKeyGeneration) return getOrCreateMasterKey();
    throw error;
  }
}

/**
 * Vault security mode from storage (no import of vault-lock to avoid cycles).
 * password/biometrics keep the raw key only in session while unlocked.
 */
async function getVaultSecurityMode(): Promise<'standard' | 'password' | 'biometrics'> {
  try {
    const res = (await browser.storage.local.get(VAULT_CONFIG_KEY)) as {
      [VAULT_CONFIG_KEY]?: { mode?: string };
    };
    const mode = res[VAULT_CONFIG_KEY]?.mode;
    if (mode === 'password' || mode === 'biometrics') return mode;
    return 'standard';
  } catch {
    /* ignore */
    return 'standard';
  }
}

async function _getOrCreateMasterKeyImpl(): Promise<CryptoKey> {
  try {
    const vaultMode = await getVaultSecurityMode();
    const isProtectedVault = vaultMode === 'password' || vaultMode === 'biometrics';

    // Protected vault: prefer session key only (raw key must not live in local)
    const sessionKeyData = await browser.storage.session.get(MASTER_KEY_ID);
    const localKeyData = await browser.storage.local.get(MASTER_KEY_ID);

    const sessionKeyJson =
      typeof sessionKeyData[MASTER_KEY_ID] === 'string' ? sessionKeyData[MASTER_KEY_ID] : '';
    const localKeyJson =
      typeof localKeyData[MASTER_KEY_ID] === 'string' ? localKeyData[MASTER_KEY_ID] : '';

    // Prefer session when protected (unlocked); otherwise local for standard mode.
    // SECURITY: in protected mode we NEVER fall back to a raw key in local
    // storage. A local raw key is only ever written by standard mode (or by
    // bugs / crash windows during setup), so using it while the session key is
    // missing would silently decrypt data while the vault reports itself
    // locked - a lock bypass. Locked means locked: require unlock instead.
    const rawKeyJson = isProtectedVault ? sessionKeyJson : localKeyJson || sessionKeyJson;

    if (rawKeyJson) {
      try {
        const keyData = JSON.parse(rawKeyJson);
        const importedKey = await crypto.subtle.importKey(
          'jwk',
          keyData,
          { name: 'AES-GCM' },
          true,
          ['encrypt', 'decrypt']
        );

        // Never write raw key back to local when vault is password/biometrics-protected
        if (!isProtectedVault && !localKeyJson && sessionKeyJson) {
          await writeWithRetry({ [MASTER_KEY_ID]: rawKeyJson });
        }

        return importedKey;
      } catch (parseError) {
        logError('Failed to parse master key JSON', parseError);
        // A key is PRESENT but unusable. Never mint a replacement: the new key
        // cannot decrypt ciphertext stored under the old one, so falling through
        // would silently orphan every encrypted record. Surface the failure.
        if (isProtectedVault) {
          throw new VaultLockedError(
            'Vault key is invalid or locked. Unlock the vault to continue.'
          );
        }
        throw parseError instanceof Error ? parseError : new Error('Stored master key is invalid');
      }
    }

    // Protected vault with no key in session/local → locked. Do not mint a new key.
    if (isProtectedVault) {
      throw new VaultLockedError('Vault is locked. Unlock before encrypting or decrypting.');
    }

    // Standard mode: generate new key with initial metadata
    const key = await generateKey();
    const exportedKey = await crypto.subtle.exportKey('jwk', key);

    const metadata: KeyMetadata = {
      version: 1,
      createdAt: Date.now(),
      lastRotated: Date.now(),
      rotationInterval: CONSTANTS.KEY_ROTATION_INTERVAL_MS, // 90 days default
    };

    const keyJson = JSON.stringify(exportedKey);
    const metadataJson = JSON.stringify(metadata);

    // Store key in local storage so encrypted data remains decryptable after browser restart
    await writeWithRetry({
      [MASTER_KEY_ID]: keyJson,
      [KEY_METADATA_ID]: metadataJson,
    });

    // Also mirror to session storage if session storage is available
    try {
      await browser.storage.session.set({
        [MASTER_KEY_ID]: keyJson,
        [KEY_METADATA_ID]: metadataJson,
      });
    } catch {
      // Ignore session storage errors
    }

    return key;
  } catch (e: unknown) {
    if (e instanceof VaultLockedError) throw e;
    logError(
      'Error managing encryption key:',
      undefined,
      e instanceof Error ? e : new Error(String(e))
    );
    throw new EncryptionError(
      { phase: 'getOrCreateMasterKey' },
      e instanceof Error ? e : undefined
    );
  }
}

/**
 * Get key metadata
 */
async function getKeyMetadata(): Promise<KeyMetadata | null> {
  try {
    const localMetadata = await browser.storage.local.get(KEY_METADATA_ID);
    const sessionMetadata = await browser.storage.session.get(KEY_METADATA_ID);
    const rawMetadataJson =
      (typeof localMetadata[KEY_METADATA_ID] === 'string' && localMetadata[KEY_METADATA_ID]) ||
      (typeof sessionMetadata[KEY_METADATA_ID] === 'string' && sessionMetadata[KEY_METADATA_ID]);

    if (rawMetadataJson) {
      try {
        return JSON.parse(rawMetadataJson);
      } catch (parseError) {
        logError('Failed to parse key metadata JSON', parseError);
        return null;
      }
    }
    return null;
  } catch (e: unknown) {
    logError(
      'Error getting key metadata:',
      undefined,
      e instanceof Error ? e : new Error(String(e))
    );
    return null;
  }
}

/**
 * Re-encrypt every master-key ciphertext store (login passwords, identity
 * custom passwords, inbox tokens, settings custom password, the AI API key,
 * and WebDAV connection/backup passwords) from ONE key to ANOTHER. Shared by:
 *  - `rotateEncryptionKey` (old local key → new local key)
 *  - backup cross-device restore (wrapped backup key → local key)
 *  - vault re-key on master-password change / reset (old key → fresh key)
 *
 * Guarantees:
 *  - Never mutates its input - returns a new bag (`data`).
 *  - Values that don't look like ciphertext (legacy plaintext) pass through
 *    untouched.
 *  - Values that FAIL to decrypt with `sourceKey` pass through untouched and
 *    are counted in `leftUntouched` so callers can abort before persisting a
 *    mixed-key state.
 *  - `_enc_:` prefixes on inbox tokens, the AI key, and WebDAV passwords are
 *    preserved.
 */
export async function reencryptCiphertextStores(
  data: Record<string, unknown>,
  sourceKey: CryptoKey,
  targetKey: CryptoKey
): Promise<{ data: Record<string, unknown>; swapped: number; leftUntouched: number }> {
  const out: Record<string, unknown> = { ...data };
  let swapped = 0;
  let leftUntouched = 0;

  const swap = async (
    value: string | null | undefined,
    prefix: string
  ): Promise<string | null | undefined> => {
    if (typeof value !== 'string' || value === '') return value;
    const prefixed = prefix !== '' && value.startsWith(prefix);
    const body = prefixed ? value.slice(prefix.length) : value;
    // The persisted marker is authoritative. Random valid ciphertext can
    // fall below the legacy plaintext-vs-ciphertext heuristic's entropy floor.
    if (!prefixed && !looksLikeCiphertext(body)) return value;
    try {
      const plain = await decryptWithKey(body, sourceKey);
      swapped++;
      return `${prefixed ? prefix : ''}${await encryptWithKey(plain, targetKey)}`;
    } catch {
      leftUntouched++;
      return value;
    }
  };

  // loginInfo[].password
  if (Array.isArray(out.loginInfo)) {
    out.loginInfo = await Promise.all(
      (out.loginInfo as Array<Record<string, unknown>>).map(async (item) => {
        if (!item || typeof item !== 'object') return item;
        const copy = { ...item };
        if (typeof copy.password === 'string') {
          copy.password = await swap(copy.password as string, '');
        }
        return copy;
      })
    );
  }

  // identities[].customPassword
  if (Array.isArray(out.identities)) {
    out.identities = await Promise.all(
      (out.identities as Array<Record<string, unknown>>).map(async (item) => {
        if (!item || typeof item !== 'object') return item;
        const copy = { ...item };
        if (typeof copy.customPassword === 'string') {
          copy.customPassword = await swap(copy.customPassword as string, '');
        }
        return copy;
      })
    );
  }

  // addresses[].token / sidToken (`_enc_:` prefixed)
  if (Array.isArray(out.addresses)) {
    out.addresses = await Promise.all(
      (out.addresses as Array<Record<string, unknown>>).map(async (item) => {
        if (!item || typeof item !== 'object') return item;
        const copy = { ...item };
        for (const k of ['token', 'sidToken'] as const) {
          if (typeof copy[k] === 'string') {
            copy[k] = await swap(copy[k] as string, '_enc_:');
          }
        }
        return copy;
      })
    );
  }

  // passwordSettings.customPassword
  if (
    out.passwordSettings &&
    typeof out.passwordSettings === 'object' &&
    !Array.isArray(out.passwordSettings)
  ) {
    const ps = out.passwordSettings as Record<string, unknown>;
    const copy = { ...ps };
    if (typeof copy.customPassword === 'string') {
      copy.customPassword = await swap(copy.customPassword as string, '');
    }
    out.passwordSettings = copy;
  }

  // aiApiKey (`_enc_:`-prefixed master-key secret)
  if (typeof out.aiApiKey === 'string') {
    out.aiApiKey = await swap(out.aiApiKey as string, '_enc_:');
  }

  // webdavConfig.passwordEnc / backupPasswordEnc (`_enc_:`-prefixed)
  if (
    out.webdavConfig &&
    typeof out.webdavConfig === 'object' &&
    !Array.isArray(out.webdavConfig)
  ) {
    const wc = { ...(out.webdavConfig as Record<string, unknown>) };
    for (const k of ['passwordEnc', 'backupPasswordEnc'] as const) {
      if (typeof wc[k] === 'string') {
        wc[k] = await swap(wc[k] as string, '_enc_:');
      }
    }
    out.webdavConfig = wc;
  }

  return { data: out, swapped, leftUntouched };
}

/**
 * Pre-flight inspection of the master-key ciphertext stores WITHOUT rewriting
 * anything: how many values WOULD be migrated by a re-key / rotation, and how
 * many ciphertext values could NOT be decrypted (a rotation that leaves any
 * behind would be aborted, so this is a warning signal).
 *
 * Mirrors the exact store walk of `reencryptCiphertextStores` (loginInfo
 * passwords, identity custom passwords, `_enc_:` inbox tokens, settings
 * custom password, the AI API key, and WebDAV connection/backup passwords).
 *
 * When `key` is null (vault locked - the raw key is unavailable) the counts
 * are STRUCTURAL: every ciphertext-looking value is counted as migratable and
 * decryptability can't be verified.
 */
export async function inspectCiphertextStores(
  data: Record<string, unknown>,
  key: CryptoKey | null
): Promise<{ migratable: number; undecryptable: number }> {
  let migratable = 0;
  let undecryptable = 0;

  const inspect = async (value: string | null | undefined, prefix: string) => {
    if (typeof value !== 'string' || value === '') return;
    const prefixed = prefix !== '' && value.startsWith(prefix);
    const body = prefixed ? value.slice(prefix.length) : value;
    // Match the migration boundary: explicitly marked values must be checked,
    // including malformed/foreign-key values that the caller must not mix in.
    if (!prefixed && !looksLikeCiphertext(body)) return;
    if (!key) {
      migratable++;
      return;
    }
    try {
      await decryptWithKey(body, key);
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
  if (typeof data.aiApiKey === 'string') {
    await inspect(data.aiApiKey as string, '_enc_:');
  }
  if (
    data.webdavConfig &&
    typeof data.webdavConfig === 'object' &&
    !Array.isArray(data.webdavConfig)
  ) {
    const wc = data.webdavConfig as Record<string, unknown>;
    for (const k of ['passwordEnc', 'backupPasswordEnc'] as const) {
      if (typeof wc[k] === 'string') {
        await inspect(wc[k] as string, '_enc_:');
      }
    }
  }

  return { migratable, undecryptable };
}

/**
 * Check if key rotation is needed
 */
export async function shouldRotateKey(): Promise<boolean> {
  const metadata = await getKeyMetadata();
  if (!metadata) return false;

  const now = Date.now();
  const timeSinceRotation = now - metadata.lastRotated;
  return timeSinceRotation > metadata.rotationInterval;
}

/**
 * Rotate the encryption key and re-encrypt EVERY store of master-key
 * ciphertext (inbox tokens, password settings, saved-login passwords,
 * identity custom passwords, the AI API key, and WebDAV connection/backup
 * passwords). A rotation that only re-encrypted one store would orphan every
 * other encrypted value (they'd become undecryptable).
 *
 * Phase 1 decrypts everything with the OLD key and aborts on any failure so
 * we never persist a mix of old-key and new-key ciphertext. Phase 2 writes
 * the re-encrypted payloads and the new key.
 *
 * SECURITY: rotation is refused while the vault is password/biometric
 * protected - the raw key must never be persisted to local storage, and
 * re-wrapping the new key with the user's password requires the password
 * itself, which the extension does not retain after unlock.
 */
export async function rotateEncryptionKey(): Promise<void> {
  await withLock('vault_rekey_lock', rotateEncryptionKeyUnlocked);
}

async function rotateEncryptionKeyUnlocked(): Promise<void> {
  try {
    await getOrCreateMasterKey(); // ensures the old key is derived/loaded
    const newKey = await generateKey();
    const newExportedKey = await crypto.subtle.exportKey('jwk', newKey);

    // Get current metadata
    const metadata = await getKeyMetadata();
    if (!metadata) throw new KeyRotationError({ reason: 'missing-metadata' });

    const vaultMode = await getVaultSecurityMode();
    if (vaultMode === 'password' || vaultMode === 'biometrics') {
      throw new KeyRotationError({ reason: 'protected-vault-rotation-unsupported' });
    }

    // ── Phase 1: swap every store old-key → new-key in memory. Any value
    //    that can't be decrypted with the old key ABORTS the rotation so we
    //    never persist a mix of old-key and new-key ciphertext. ─────────────
    const oldKey = await getOrCreateMasterKey();
    const stores = (await browser.storage.local.get([
      'passwordSettings',
      'addresses',
      'loginInfo',
      'identities',
      'aiApiKey',
      'webdavConfig',
    ])) as Record<string, unknown>;
    const result = await reencryptCiphertextStores(stores, oldKey, newKey);
    if (result.leftUntouched > 0) {
      throw new KeyRotationError({
        reason: 'decrypt-failed',
        detail: `${result.leftUntouched} value(s) could not be decrypted with the old key - rotation aborted`,
      });
    }

    // ── Phase 2: atomic commit. The re-encrypted payloads and the new key +
    //    metadata MUST land in ONE storage.local.set. Two separate writes
    //    leave a window (new payloads + OLD key) where an MV3 service worker
    //    killed between the awaits makes every encrypted token/password
    //    undecryptable. A single multi-key set is applied atomically, exactly
    //    like rekeyVault / rotateVaultKey. ──────────────────────────────────
    const newKeyJson = JSON.stringify(newExportedKey);
    const newMetadataJson = JSON.stringify({
      ...metadata,
      version: metadata.version + 1,
      lastRotated: Date.now(),
    });

    // Multi-key set stays ATOMIC through the retry wrapper (one set call per
    // attempt) - a retry can never split the payloads from the new key.
    await writeWithRetry({
      ...result.data,
      [MASTER_KEY_ID]: newKeyJson,
      [KEY_METADATA_ID]: newMetadataJson,
    });

    // Also update session storage if available
    try {
      await browser.storage.session.set({
        [MASTER_KEY_ID]: newKeyJson,
        [KEY_METADATA_ID]: newMetadataJson,
      });
    } catch {
      // Ignore session storage errors
    }

    // Invalidate cached key promise so future operations use the rotated key
    _masterKeyPromise = Promise.resolve(newKey);

    // Key rotation completed successfully
  } catch (e: unknown) {
    logError(
      'Error rotating encryption key:',
      undefined,
      e instanceof Error ? e : new Error(String(e))
    );
    if (e instanceof KeyRotationError) throw e;
    throw new KeyRotationError(
      { phase: 'rotateEncryptionKey' },
      e instanceof Error ? e : undefined
    );
  }
}

/**
 * Convert Uint8Array bytes to base64 string safely without stack overflow or non-ASCII exceptions.
 */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

/**
 * Encrypt data using a specific CryptoKey
 */
export async function encryptWithKey(plaintext: string, key: CryptoKey): Promise<string> {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);
    const iv = crypto.getRandomValues(new Uint8Array(CONSTANTS.ENCRYPTION_IV_LENGTH));
    const encrypted = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv,
      },
      key,
      data
    );

    // Combine IV and encrypted data
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);

    // Convert to base64 for storage
    return bytesToBase64(combined);
  } catch (e) {
    logError('Encryption error:', e);
    throw new EncryptionError({ phase: 'encryptWithKey' }, e instanceof Error ? e : undefined);
  }
}

/**
 * Encrypt a secret with the master key and prefix it with `_enc_:`, matching
 * how inbox tokens are persisted (`setAddresses`). Never call this while the
 * vault is locked - it would mint a new master key and orphan the record.
 */
export async function encryptSecret(plaintext: string): Promise<string> {
  if (!plaintext) return '';
  return `_enc_:${await encrypt(plaintext)}`;
}

/**
 * Decrypt a `_enc_:`-prefixed secret, or return the value unchanged when it
 * has no prefix (legacy plaintext) or the vault is locked/unavailable.
 * Returns '' only for an empty input.
 */
export async function decryptSecret(value: string): Promise<string> {
  if (!value) return '';
  if (!value.startsWith('_enc_:')) return value;
  try {
    return await decrypt(value.slice(6));
  } catch {
    /* vault locked / key changed - secret unavailable */
    return '';
  }
}

/**
 * Encrypt a plaintext string using AES-GCM
 */
export async function encrypt(plaintext: string): Promise<string> {
  try {
    const key = await getOrCreateMasterKey();
    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);

    // Generate random IV (Initialization Vector)
    const iv = crypto.getRandomValues(new Uint8Array(CONSTANTS.ENCRYPTION_IV_LENGTH));

    // Encrypt
    const encrypted = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv,
      },
      key,
      data
    );

    // Combine IV and encrypted data
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);

    // Convert to base64 for storage
    return bytesToBase64(combined);
  } catch (e) {
    logError('Encryption error:', e);
    // A locked password/biometrics vault must surface as VaultLockedError, not
    // be collapsed into a generic EncryptionError: getAddresses and other
    // vault-aware callers branch on the type to route the user to the unlock
    // flow instead of showing a misleading "failed to save" toast.
    if (e instanceof VaultLockedError || e instanceof EncryptionError) throw e;
    throw new EncryptionError({ phase: 'encrypt' }, e instanceof Error ? e : undefined);
  }
}

/**
 * Decrypt a base64-encoded encrypted string using a SPECIFIC CryptoKey.
 * Mirrors `encryptWithKey` (IV prepended to ciphertext). Used by the backup
 * import path to decrypt payloads with the wrapped (backup) master key before
 * re-encrypting them with the local key.
 */
export async function decryptWithKey(encryptedBase64: string, key: CryptoKey): Promise<string> {
  try {
    const combined = Uint8Array.from(atob(encryptedBase64), (c) => c.charCodeAt(0));
    if (combined.length <= CONSTANTS.ENCRYPTION_IV_LENGTH) {
      throw new Error('Invalid encrypted payload');
    }
    const iv = combined.slice(0, CONSTANTS.ENCRYPTION_IV_LENGTH);
    const encrypted = combined.slice(CONSTANTS.ENCRYPTION_IV_LENGTH);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);
    return new TextDecoder().decode(decrypted);
  } catch (e) {
    logError('Decryption error (with key):', e);
    throw new DecryptionError({ phase: 'decryptWithKey' }, e instanceof Error ? e : undefined);
  }
}

/**
 * Decrypt a base64-encoded encrypted string
 */
export async function decrypt(encryptedBase64: string): Promise<string> {
  try {
    const key = await getOrCreateMasterKey();

    // Decode base64
    const combined = Uint8Array.from(atob(encryptedBase64), (c) => c.charCodeAt(0));

    if (combined.length <= CONSTANTS.ENCRYPTION_IV_LENGTH) {
      throw new Error('Invalid encrypted payload');
    }

    // Extract IV (first CONSTANTS.ENCRYPTION_IV_LENGTH bytes)
    const iv = combined.slice(0, CONSTANTS.ENCRYPTION_IV_LENGTH);
    const encrypted = combined.slice(CONSTANTS.ENCRYPTION_IV_LENGTH);

    // Decrypt
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv,
      },
      key,
      encrypted
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (e) {
    logError('Decryption error:', e);
    // Same type-preservation contract as encrypt(): a locked vault must stay
    // VaultLockedError so callers can offer to unlock rather than report a
    // decoding failure.
    if (e instanceof VaultLockedError || e instanceof DecryptionError) throw e;
    throw new DecryptionError({ phase: 'decrypt' }, e instanceof Error ? e : undefined);
  }
}

/** Hash a password with the current Argon2id profile for local verification. */
export async function hashPassword(password: string, saltHex?: string): Promise<string> {
  if (saltHex !== undefined && (saltHex.length !== 32 || !/^(?:[0-9a-f]{2}){16}$/i.test(saltHex))) {
    throw new Error('Invalid salt hex');
  }
  const salt = saltHex
    ? Uint8Array.from((saltHex.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)))
    : crypto.getRandomValues(new Uint8Array(CONSTANTS.SALT_LENGTH));
  const derived = await deriveArgon2id(password, salt, ARGON2ID_KDF);
  return `argon2id$format=${ARGON2ID_KDF.formatVersion}$v=${ARGON2ID_KDF.version}$m=${ARGON2ID_KDF.memoryKiB},t=${ARGON2ID_KDF.iterations},p=${ARGON2ID_KDF.parallelism}$${bytesToHex(salt)}$${bytesToHex(derived)}`;
}

/**
 * Constant-time string comparison to prevent timing side-channel attacks.
 *
 * Always walks max(a, b) so a length mismatch does not return early (which
 * leaked length as a timing signal) and shorter-string padding keeps the
 * per-character work independent of content.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (storedHash.length > 220) return false;
  const parts = storedHash.split('$');
  if (
    parts.length !== 6 ||
    parts[0] !== 'argon2id' ||
    parts[1] !== `format=${ARGON2ID_KDF.formatVersion}` ||
    parts[2] !== `v=${ARGON2ID_KDF.version}`
  ) {
    return false;
  }
  if (
    parts[3] !==
    `m=${ARGON2ID_KDF.memoryKiB},t=${ARGON2ID_KDF.iterations},p=${ARGON2ID_KDF.parallelism}`
  ) {
    return false;
  }
  const saltHex = parts[4];
  if (!/^(?:[0-9a-f]{2}){16}$/i.test(saltHex) || !/^(?:[0-9a-f]{2}){32}$/i.test(parts[5])) {
    return false;
  }
  const candidate = await hashPassword(password, saltHex);
  return timingSafeEqual(candidate, storedHash);
}

/**
 * Detect whether a string is likely undecrypted base64 ciphertext rather than
 * a real password. Real passwords typically contain spaces, mixed case, or
 * punctuation; AES-GCM base64 output is a contiguous run of base64 chars
 * (A-Za-z0-9+/=) with no spaces and is usually >40 chars for our payload size.
 *
 * Lives here so `rotateEncryptionKey` can find every legacy ciphertext store
 * (login passwords / identity custom passwords were saved without a `_enc_:`
 * prefix). Re-exported by `saved-login-credentials.ts` for existing callers.
 *
 * ACCEPTED LIMITATION: the heuristic misclassifies long (>=40 char) random
 * base64-charset credentials - API keys / tokens a user saved as a password
 * are byte-for-byte indistinguishable from legacy ciphertext (both decode to
 * ~62% binary). This is information-theoretic, not a tuning gap: those stores
 * are unprefixed BY DESIGN (that is why shape detection exists), and a
 * foreign-key ciphertext blob (pinned by crypto-reencrypt.test.ts
 * "left untouched and counted") is identical input. Preferring shape keeps
 * dead/foreign-key ciphertext out of autofill replay and lets rotation abort
 * on undecryptable values - at the cost of the narrow token-password window
 * above. Do not remove this gate for loginInfo/identities without replacing
 * the cross-key abort contract it supports.
 */
export function looksLikeCiphertext(value: string): boolean {
  if (!value || value.length < 40) return false; // Minimum AES-GCM length for a small password

  // Sample first 88 base64 chars which decode to 66 bytes
  const sampleBase64 = value.length > 88 ? value.slice(0, 88) : value;
  const isBase64Only = /^[A-Za-z0-9+/]+={0,2}$/.test(sampleBase64);
  if (!isBase64Only) return false;

  try {
    const binary = atob(sampleBase64);
    let nonPrintableCount = 0;
    for (let i = 0; i < binary.length; i++) {
      const code = binary.charCodeAt(i);
      if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code > 126) {
        nonPrintableCount++;
      }
    }
    // AES-GCM raw binary has ~62% non-printable characters.
    // A base64-like password will have 0% if it decodes to ASCII, or some other distribution.
    // Use > 35% to confidently identify binary ciphertext.
    if (nonPrintableCount / binary.length > 0.35) {
      return true;
    }
  } catch {
    /* ignore */
    return false;
  }

  return false;
}

async function deriveArgon2id(
  password: string,
  salt: Uint8Array,
  kdf: Argon2idKdf = ARGON2ID_KDF
): Promise<Uint8Array> {
  if (!isSupportedArgon2idKdf(kdf)) throw new Error('Unsupported Argon2id parameters');
  if (password.length > 65_536) throw new Error('Password input is too long');
  // The package barrel embeds every supported hash algorithm. Import the
  // Argon2-only build so the background worker doesn't ship unrelated WASM.
  const { argon2id } = await import('hash-wasm/dist/argon2.umd.min.js');
  return await argon2id({
    // A fixed context prefix keeps the KDF input non-empty for helper callers
    // and domain-separates this format from raw-password Argon2 derivations.
    password: new TextEncoder().encode(`1click-extension-argon2id-v1\0${password}`),
    salt,
    iterations: kdf.iterations,
    parallelism: kdf.parallelism,
    memorySize: kdf.memoryKiB,
    hashLength: kdf.hashLength,
    outputType: 'binary',
  });
}

/** Derive an AES-GCM CryptoKey from a password using the supported Argon2id profile. */
export async function deriveKeyFromPassword(
  password: string,
  saltHex: string,
  kdf: Argon2idKdf = ARGON2ID_KDF
): Promise<CryptoKey> {
  if (saltHex.length !== 32 || !/^(?:[0-9a-f]{2}){16}$/i.test(saltHex)) {
    throw new Error('Invalid salt hex');
  }
  if (!isSupportedArgon2idKdf(kdf)) throw new Error('Unsupported Argon2id parameters');
  const salt = Uint8Array.from((saltHex.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)));
  const rawKey = await deriveArgon2id(password, salt, kdf);
  const keyBytes = new Uint8Array(rawKey);
  return await crypto.subtle.importKey(
    'raw',
    keyBytes.buffer,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt master key JWK JSON using an Argon2id-derived AES-GCM key.
 */
export async function encryptMasterKeyWithPassword(
  keyJson: string,
  password: string,
  saltHex: string,
  kdf: Argon2idKdf = ARGON2ID_KDF
): Promise<string> {
  const derivedKey = await deriveKeyFromPassword(password, saltHex, kdf);
  const iv = crypto.getRandomValues(new Uint8Array(CONSTANTS.ENCRYPTION_IV_LENGTH));
  const encoder = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    derivedKey,
    encoder.encode(keyJson)
  );
  const ivHex = Array.from(iv)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const dataHex = Array.from(new Uint8Array(encrypted))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${ivHex}:${dataHex}`;
}

/**
 * Decrypt master key JWK JSON using an Argon2id-derived AES-GCM key.
 */
export async function decryptMasterKeyWithPassword(
  encryptedPayload: string,
  password: string,
  saltHex: string,
  kdf: Argon2idKdf = ARGON2ID_KDF
): Promise<string | null> {
  try {
    const [ivHex, dataHex] = encryptedPayload.split(':');
    if (!ivHex || !dataHex) return null;
    const iv = Uint8Array.from((ivHex.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)));
    const data = Uint8Array.from((dataHex.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)));
    const derivedKey = await deriveKeyFromPassword(password, saltHex, kdf);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, derivedKey, data);
    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch {
    /* ignore */
    return null;
  }
}
