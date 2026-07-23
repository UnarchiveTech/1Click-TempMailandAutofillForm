/**
 * Cryptographic utilities for secure password storage using Web Crypto API
 * Uses AES-GCM encryption with a key derived from a master secret
 *
 * SECURITY NOTES:
 * - Keys are stored in extension storage (encrypted by browser's extension storage security)
 * - In production, consider using chrome.storage.session for more sensitive data
 * - Key derivation uses PBKDF2 with a salt for additional security
 */

import { browser } from 'wxt/browser';
import {
  ENCRYPTION_IV_LENGTH,
  KEY_ROTATION_INTERVAL_MS,
  PBKDF2_ITERATIONS,
  SALT_LENGTH,
} from './constants.js';
import { DecryptionError, EncryptionError, KeyRotationError } from './errors.js';
import { logError } from './logger.js';

// Master encryption key (in production, this should be stored securely)
// For browser extensions, we use extension storage which is more secure than localStorage
export const MASTER_KEY_ID = '1click_master_encryption_key';
const KEY_METADATA_ID = '1click_key_metadata';
const _KEY_SALT_ID = '1click_key_salt';
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
 * Generate a random salt for key derivation
 */
async function _generateSalt(): Promise<Uint8Array> {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
}

/**
 * Derive a key from a master secret using PBKDF2
 * This provides better security than storing raw keys
 */
async function _deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
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

export function clearCachedMasterKey(): void {
  _masterKeyPromise = null;
}

/**
 * Get or create the master encryption key
 * Uses a combination of device-specific data and random generation
 */
export async function getOrCreateMasterKey(): Promise<CryptoKey> {
  if (_masterKeyPromise) return _masterKeyPromise;
  _masterKeyPromise = _getOrCreateMasterKeyImpl().catch((e) => {
    _masterKeyPromise = null;
    throw e;
  });
  return _masterKeyPromise;
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

    // Prefer session when protected (unlocked); otherwise local for standard mode
    const rawKeyJson = isProtectedVault
      ? sessionKeyJson || localKeyJson // local only as legacy fallback while unlocked session missing
      : localKeyJson || sessionKeyJson;

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
          await browser.storage.local.set({ [MASTER_KEY_ID]: rawKeyJson });
        }

        return importedKey;
      } catch (parseError) {
        logError('Failed to parse master key JSON', parseError);
        // Protected vault: never mint a replacement key (would orphan ciphertext)
        if (isProtectedVault) {
          throw new VaultLockedError(
            'Vault key is invalid or locked. Unlock the vault to continue.'
          );
        }
        // Standard mode: fall through to generate new key
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
      rotationInterval: KEY_ROTATION_INTERVAL_MS, // 90 days default
    };

    const keyJson = JSON.stringify(exportedKey);
    const metadataJson = JSON.stringify(metadata);

    // Store key in local storage so encrypted data remains decryptable after browser restart
    await browser.storage.local.set({
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
 * Rotate the encryption key and re-encrypt sensitive data
 * This is a critical operation that should be performed carefully
 */
export async function rotateEncryptionKey(): Promise<void> {
  try {
    const _oldKey = await getOrCreateMasterKey();
    const newKey = await generateKey();
    const newExportedKey = await crypto.subtle.exportKey('jwk', newKey);

    // Get current metadata
    const metadata = await getKeyMetadata();
    if (!metadata) throw new KeyRotationError({ reason: 'missing-metadata' });

    // Re-encrypt password settings with new key
    const passwordSettings = (await browser.storage.local.get('passwordSettings')) as {
      passwordSettings?: { customPassword?: string };
    };
    if (passwordSettings.passwordSettings?.customPassword) {
      // Decrypt with old key
      const decryptedPassword = await decrypt(passwordSettings.passwordSettings.customPassword);

      // Encrypt with new key
      const encryptedPassword = await encryptWithKey(decryptedPassword, newKey);

      // Update storage (password settings remain in local storage, only key moves to session)
      await browser.storage.local.set({
        passwordSettings: {
          ...passwordSettings.passwordSettings,
          customPassword: encryptedPassword,
        },
      });
    }

    const newKeyJson = JSON.stringify(newExportedKey);
    const newMetadataJson = JSON.stringify({
      ...metadata,
      version: metadata.version + 1,
      lastRotated: Date.now(),
    });

    // Update key and metadata in local storage (persistent across restarts)
    await browser.storage.local.set({
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
    const iv = crypto.getRandomValues(new Uint8Array(ENCRYPTION_IV_LENGTH));
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
 * Encrypt a plaintext string using AES-GCM
 */
export async function encrypt(plaintext: string): Promise<string> {
  try {
    const key = await getOrCreateMasterKey();
    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);

    // Generate random IV (Initialization Vector)
    const iv = crypto.getRandomValues(new Uint8Array(ENCRYPTION_IV_LENGTH));

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
    if (e instanceof EncryptionError) throw e;
    throw new EncryptionError({ phase: 'encrypt' }, e instanceof Error ? e : undefined);
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

    // Extract IV (first ENCRYPTION_IV_LENGTH bytes)
    const iv = combined.slice(0, ENCRYPTION_IV_LENGTH);
    const encrypted = combined.slice(ENCRYPTION_IV_LENGTH);

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
    throw new DecryptionError({ phase: 'decrypt' }, e instanceof Error ? e : undefined);
  }
}

/**
 * Hash a password for verification using PBKDF2.
 * Accepts an optional hex salt; generates a random one when absent.
 * Output format: "<hex-salt>:<hex-derived-key>" so the salt is stored
 * alongside the hash and verification stays deterministic.
 */
export async function hashPassword(password: string, saltHex?: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = saltHex
    ? Uint8Array.from((saltHex.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)))
    : crypto.getRandomValues(new Uint8Array(SALT_LENGTH));

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const saltStr = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const keyStr = Array.from(new Uint8Array(derived))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${saltStr}:${keyStr}`;
}

/**
 * Constant-time string comparison to prevent timing side-channel attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  let mismatch = a.length === b.length ? 0 : 1;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0 && a.length === b.length;
}

/**
 * Verify a password against a hash produced by hashPassword().
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [saltHex] = storedHash.split(':');
  if (!saltHex) return false;
  const candidate = await hashPassword(password, saltHex);
  return timingSafeEqual(candidate, storedHash);
}

/**
 * Derive an AES-GCM CryptoKey from a user password and salt using PBKDF2.
 */
export async function deriveKeyFromPassword(password: string, saltHex: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const salt = Uint8Array.from((saltHex.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt master key JWK JSON using PBKDF2 derived password key.
 */
export async function encryptMasterKeyWithPassword(
  keyJson: string,
  password: string,
  saltHex: string
): Promise<string> {
  const derivedKey = await deriveKeyFromPassword(password, saltHex);
  const iv = crypto.getRandomValues(new Uint8Array(ENCRYPTION_IV_LENGTH));
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
 * Decrypt master key JWK JSON using PBKDF2 derived password key.
 */
export async function decryptMasterKeyWithPassword(
  encryptedPayload: string,
  password: string,
  saltHex: string
): Promise<string | null> {
  try {
    const [ivHex, dataHex] = encryptedPayload.split(':');
    if (!ivHex || !dataHex) return null;
    const iv = Uint8Array.from((ivHex.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)));
    const data = Uint8Array.from((dataHex.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)));
    const derivedKey = await deriveKeyFromPassword(password, saltHex);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, derivedKey, data);
    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch {
    return null;
  }
}
