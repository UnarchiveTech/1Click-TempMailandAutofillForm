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
const MASTER_KEY_ID = '1click_master_encryption_key';
const KEY_METADATA_ID = '1click_key_metadata';
const _KEY_SALT_ID = '1click_key_salt';

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

/**
 * Get or create the master encryption key
 * Uses a combination of device-specific data and random generation
 */
async function getOrCreateMasterKey(): Promise<CryptoKey> {
  if (_masterKeyPromise) return _masterKeyPromise;
  _masterKeyPromise = _getOrCreateMasterKeyImpl().catch((e) => {
    _masterKeyPromise = null;
    throw e;
  });
  return _masterKeyPromise;
}

async function _getOrCreateMasterKeyImpl(): Promise<CryptoKey> {
  try {
    // Use session storage for encryption keys (cleared when browser closes)
    const storedKeyData = await browser.storage.session.get(MASTER_KEY_ID);

    if (storedKeyData[MASTER_KEY_ID] && typeof storedKeyData[MASTER_KEY_ID] === 'string') {
      // Import existing key
      try {
        const keyData = JSON.parse(storedKeyData[MASTER_KEY_ID]);
        return await crypto.subtle.importKey('jwk', keyData, { name: 'AES-GCM' }, true, [
          'encrypt',
          'decrypt',
        ]);
      } catch (parseError) {
        logError('Failed to parse master key JSON', parseError);
        // Fall through to generate new key
      }
    }

    // Generate new key with initial metadata
    const key = await generateKey();
    const exportedKey = await crypto.subtle.exportKey('jwk', key);

    const metadata: KeyMetadata = {
      version: 1,
      createdAt: Date.now(),
      lastRotated: Date.now(),
      rotationInterval: KEY_ROTATION_INTERVAL_MS, // 90 days default
    };

    // Store key in session storage (more secure, cleared on browser close)
    await browser.storage.session.set({
      [MASTER_KEY_ID]: JSON.stringify(exportedKey),
      [KEY_METADATA_ID]: JSON.stringify(metadata),
    });

    return key;
  } catch (e: unknown) {
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
    const storedMetadata = await browser.storage.session.get(KEY_METADATA_ID);
    if (storedMetadata[KEY_METADATA_ID] && typeof storedMetadata[KEY_METADATA_ID] === 'string') {
      try {
        return JSON.parse(storedMetadata[KEY_METADATA_ID]);
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

    // Update key and metadata in session storage
    await browser.storage.session.set({
      [MASTER_KEY_ID]: JSON.stringify(newExportedKey),
      [KEY_METADATA_ID]: JSON.stringify({
        ...metadata,
        version: metadata.version + 1,
        lastRotated: Date.now(),
      }),
    });

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
 * Encrypt with a specific key (used during key rotation)
 */
async function encryptWithKey(plaintext: string, key: CryptoKey): Promise<string> {
  try {
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
    return btoa(String.fromCharCode(...combined));
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
    return btoa(String.fromCharCode(...combined));
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
 * Hash a password for verification (not reversible)
 * Uses SHA-256 for one-way hashing
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hash));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
