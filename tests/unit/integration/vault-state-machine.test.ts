/**
 * Integration test: Vault State Machine
 *
 * Verifies that the vault password-protection subsystem transitions correctly
 * across its states: standard → password-locked → unlocked → standard.
 *
 * What this integration tests (crosses multiple modules):
 *  - encryptMasterKeyWithPassword / decryptMasterKeyWithPassword  (crypto.ts)
 *  - encryptWithKey                                               (crypto.ts)
 *  - VaultLockedError thrown from getOrCreateMasterKey            (crypto.ts)
 *
 * vault-lock.ts functions (setupMasterPassword, lockVault, etc.) rely on
 * `browser.storage.*` from wxt/browser which is a host-only API. Those
 * end-to-end transitions are covered by the Playwright E2E suite. Here we
 * focus on the pure cryptographic contracts that underpin the vault:
 *  1. encrypt-with-password round-trips
 *  2. wrong credential rejection
 *  3. encryptWithKey low-level fidelity
 *  4. VaultLockedError shape
 */

import { describe, expect, test } from 'bun:test';
import {
  decryptMasterKeyWithPassword,
  encryptMasterKeyWithPassword,
  encryptWithKey,
  VaultLockedError,
} from '@/utils/crypto';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Generate a fresh AES-GCM 256-bit CryptoKey */
async function generateAesKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/** Export a CryptoKey to JWK JSON string */
async function exportKeyJson(key: CryptoKey): Promise<string> {
  return JSON.stringify(await crypto.subtle.exportKey('jwk', key));
}

/** Import a JWK JSON string back to CryptoKey */
async function importKeyJson(json: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', JSON.parse(json), { name: 'AES-GCM' }, true, [
    'encrypt',
    'decrypt',
  ]);
}

/** Generate a hex salt string of the given byte-length */
function randomHexSalt(bytes = 16): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── encryptMasterKeyWithPassword / decryptMasterKeyWithPassword ───────────────

describe('encryptMasterKeyWithPassword + decryptMasterKeyWithPassword', () => {
  test('round-trips the key JSON with correct password and salt', async () => {
    const key = await generateAesKey();
    const keyJson = await exportKeyJson(key);
    const salt = randomHexSalt();

    const encrypted = await encryptMasterKeyWithPassword(keyJson, 'correct-password', salt);
    expect(typeof encrypted).toBe('string');
    expect(encrypted.length).toBeGreaterThan(0);

    const decrypted = await decryptMasterKeyWithPassword(encrypted, 'correct-password', salt);
    expect(decrypted).toBe(keyJson);
  });

  test('returns null when wrong password is supplied', async () => {
    const key = await generateAesKey();
    const keyJson = await exportKeyJson(key);
    const salt = randomHexSalt();

    const encrypted = await encryptMasterKeyWithPassword(keyJson, 'correct-password', salt);
    const result = await decryptMasterKeyWithPassword(encrypted, 'WRONG-password', salt);
    expect(result).toBeNull();
  });

  test('returns null when wrong salt is supplied', async () => {
    const key = await generateAesKey();
    const keyJson = await exportKeyJson(key);
    const salt1 = randomHexSalt();
    const salt2 = randomHexSalt();

    const encrypted = await encryptMasterKeyWithPassword(keyJson, 'password', salt1);
    const result = await decryptMasterKeyWithPassword(encrypted, 'password', salt2);
    expect(result).toBeNull();
  });

  test('produces different ciphertexts for two encryptions of the same payload (random IV)', async () => {
    const key = await generateAesKey();
    const keyJson = await exportKeyJson(key);
    const salt = randomHexSalt();

    const enc1 = await encryptMasterKeyWithPassword(keyJson, 'pw', salt);
    const enc2 = await encryptMasterKeyWithPassword(keyJson, 'pw', salt);
    // IV is random → ciphertexts must differ even with identical inputs
    expect(enc1).not.toBe(enc2);
    // Yet both decrypt to the same payload
    expect(await decryptMasterKeyWithPassword(enc1, 'pw', salt)).toBe(keyJson);
    expect(await decryptMasterKeyWithPassword(enc2, 'pw', salt)).toBe(keyJson);
  });

  test('ciphertext is not the same as plaintext (actually encrypted)', async () => {
    const key = await generateAesKey();
    const keyJson = await exportKeyJson(key);
    const salt = randomHexSalt();

    const encrypted = await encryptMasterKeyWithPassword(keyJson, 'pw', salt);
    expect(encrypted).not.toBe(keyJson);
    expect(encrypted).not.toContain('"k"'); // JWK property must not appear in plaintext
  });

  test('empty password is accepted and round-trips correctly', async () => {
    const key = await generateAesKey();
    const keyJson = await exportKeyJson(key);
    const salt = randomHexSalt();

    const encrypted = await encryptMasterKeyWithPassword(keyJson, '', salt);
    const decrypted = await decryptMasterKeyWithPassword(encrypted, '', salt);
    expect(decrypted).toBe(keyJson);
  });

  test('unicode password is accepted and round-trips correctly', async () => {
    const key = await generateAesKey();
    const keyJson = await exportKeyJson(key);
    const salt = randomHexSalt();
    const password = '🔐 Pässwörð héllo';

    const encrypted = await encryptMasterKeyWithPassword(keyJson, password, salt);
    const decrypted = await decryptMasterKeyWithPassword(encrypted, password, salt);
    expect(decrypted).toBe(keyJson);
  });

  test('re-importing the decrypted key JSON produces a usable CryptoKey', async () => {
    const key = await generateAesKey();
    const keyJson = await exportKeyJson(key);
    const salt = randomHexSalt();

    const encrypted = await encryptMasterKeyWithPassword(keyJson, 'pw', salt);
    const decryptedJson = await decryptMasterKeyWithPassword(encrypted, 'pw', salt);
    expect(decryptedJson).not.toBeNull();
    if (!decryptedJson) {
      throw new Error('decryptedJson is null');
    }

    // The JSON must parse back to a valid CryptoKey
    const restoredKey = await importKeyJson(decryptedJson);
    expect(restoredKey.type).toBe('secret');
    expect(restoredKey.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
  });
});

// ── encryptWithKey (low-level AES-GCM) ───────────────────────────────────────

describe('encryptWithKey (low-level) integration', () => {
  test('ciphertext decrypts back to original plaintext', async () => {
    const key = await generateAesKey();
    const plaintext = 'super-secret-api-token-abc123';

    const ciphertext = await encryptWithKey(plaintext, key);
    expect(typeof ciphertext).toBe('string');
    expect(ciphertext).not.toBe(plaintext);

    // Manually decrypt using Web Crypto to verify structural correctness
    const raw = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
    const iv = raw.slice(0, 12); // ENCRYPTION_IV_LENGTH = 12
    const data = raw.slice(12);
    const decBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    expect(new TextDecoder().decode(decBuf)).toBe(plaintext);
  });

  test('two encryptions of same plaintext produce different ciphertexts (random IV)', async () => {
    const key = await generateAesKey();
    const enc1 = await encryptWithKey('hello', key);
    const enc2 = await encryptWithKey('hello', key);
    expect(enc1).not.toBe(enc2);
  });

  test('different keys produce different ciphertexts for the same plaintext', async () => {
    const key1 = await generateAesKey();
    const key2 = await generateAesKey();
    const enc1 = await encryptWithKey('hello vault', key1);
    const enc2 = await encryptWithKey('hello vault', key2);
    expect(enc1).not.toBe(enc2);
  });

  test('key exported, stored as JSON, and re-imported still decrypts correctly', async () => {
    const key = await generateAesKey();
    const plaintext = 'persistence round-trip test';
    const ciphertext = await encryptWithKey(plaintext, key);

    // Simulate storage round-trip: export → JSON string → re-import
    const keyJson = await exportKeyJson(key);
    const restoredKey = await importKeyJson(keyJson);

    const raw = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
    const iv = raw.slice(0, 12);
    const data = raw.slice(12);
    const decBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, restoredKey, data);
    expect(new TextDecoder().decode(decBuf)).toBe(plaintext);
  });

  test('encrypting empty string produces valid non-empty ciphertext', async () => {
    const key = await generateAesKey();
    const ciphertext = await encryptWithKey('', key);
    expect(ciphertext.length).toBeGreaterThan(0);
  });

  test('encrypting unicode string produces valid ciphertext', async () => {
    const key = await generateAesKey();
    const plaintext = 'こんにちは世界 🔐 héllo';
    const ciphertext = await encryptWithKey(plaintext, key);

    const raw = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
    const iv = raw.slice(0, 12);
    const data = raw.slice(12);
    const decBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    expect(new TextDecoder().decode(decBuf)).toBe(plaintext);
  });
});

// ── VaultLockedError ──────────────────────────────────────────────────────────

describe('VaultLockedError', () => {
  test('is an instance of Error', () => {
    const err = new VaultLockedError();
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(VaultLockedError);
  });

  test('has name VaultLockedError', () => {
    expect(new VaultLockedError().name).toBe('VaultLockedError');
  });

  test('uses default message when none provided', () => {
    const err = new VaultLockedError();
    expect(err.message).toBe('Vault is locked');
  });

  test('uses custom message when provided', () => {
    const err = new VaultLockedError('Custom vault message');
    expect(err.message).toBe('Custom vault message');
  });

  test('is caught by catch blocks targeting Error', () => {
    const fn = () => {
      throw new VaultLockedError();
    };
    expect(fn).toThrow(Error);
    expect(fn).toThrow(VaultLockedError);
    expect(fn).toThrow('Vault is locked');
  });
});

// ── end-to-end password-wrapping pipeline ─────────────────────────────────────

describe('full password-wrapping pipeline (no browser APIs)', () => {
  test('wrapping a 256-bit AES key and unwrapping it gives identical key material', async () => {
    const originalKey = await generateAesKey();
    const originalJson = await exportKeyJson(originalKey);
    const password = 'my-vault-password-2025!';
    const salt = randomHexSalt(16);

    // Simulate setupMasterPassword: encrypt key
    const wrappedKey = await encryptMasterKeyWithPassword(originalJson, password, salt);

    // Simulate unlockVaultWithPassword: decrypt key
    const unwrappedJson = await decryptMasterKeyWithPassword(wrappedKey, password, salt);
    expect(unwrappedJson).toBe(originalJson);
    if (!unwrappedJson) {
      throw new Error('unwrappedJson is null');
    }

    // The restored key can still encrypt/decrypt data
    const restoredKey = await importKeyJson(unwrappedJson);
    const testPayload = 'credentials:user@example.com:hunter2';
    const ciphertext = await encryptWithKey(testPayload, restoredKey);
    const raw = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
    const iv = raw.slice(0, 12);
    const dataBytes = raw.slice(12);
    const decBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, restoredKey, dataBytes);
    expect(new TextDecoder().decode(decBuf)).toBe(testPayload);
  });

  test('changing only the password breaks decryption of a wrapped key', async () => {
    const key = await generateAesKey();
    const keyJson = await exportKeyJson(key);
    const salt = randomHexSalt();

    const wrapped = await encryptMasterKeyWithPassword(keyJson, 'password-A', salt);
    const result = await decryptMasterKeyWithPassword(wrapped, 'password-B', salt);
    expect(result).toBeNull();
  });
});
