import { browser } from 'wxt/browser';
import {
  clearCachedMasterKey,
  decryptMasterKeyWithPassword,
  encryptMasterKeyWithPassword,
  getOrCreateMasterKey,
  MASTER_KEY_ID,
} from './crypto.js';
import { logError } from './logger.js';

export type VaultSecurityMode = 'standard' | 'password' | 'biometrics';

export interface VaultConfig {
  mode: VaultSecurityMode;
  salt?: string;
  encryptedMasterKey?: string;
  biometricCredentialId?: string;
}

const VAULT_CONFIG_KEY = 'vault_security_config';

/**
 * Check if WebAuthn platform authenticator (Windows Hello / Touch ID) is supported.
 */
export async function isBiometricSupported(): Promise<boolean> {
  try {
    if (typeof window === 'undefined' || !window.PublicKeyCredential) {
      return false;
    }
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Load current vault security configuration.
 */
export async function getVaultConfig(): Promise<VaultConfig> {
  try {
    const res = (await browser.storage.local.get([VAULT_CONFIG_KEY])) as {
      [VAULT_CONFIG_KEY]?: VaultConfig;
    };
    return res[VAULT_CONFIG_KEY] || { mode: 'standard' };
  } catch {
    return { mode: 'standard' };
  }
}

/**
 * Save vault security configuration.
 */
export async function saveVaultConfig(config: VaultConfig): Promise<void> {
  await browser.storage.local.set({ [VAULT_CONFIG_KEY]: config });
}

/**
 * Check if the Vault is currently locked (session Master Key is missing in password/biometrics mode).
 */
export async function isVaultLocked(): Promise<boolean> {
  const config = await getVaultConfig();
  if (config.mode === 'standard') {
    return false;
  }

  try {
    const sessionRes = (await browser.storage.session.get([MASTER_KEY_ID])) as {
      [MASTER_KEY_ID]?: string;
    };
    return !sessionRes[MASTER_KEY_ID];
  } catch {
    return true;
  }
}

/**
 * Enable Master Password protection.
 * Encrypts current Master Key with user's password and deletes raw key from local storage.
 */
export async function setupMasterPassword(password: string): Promise<boolean> {
  try {
    // 1. Get current master key JWK
    const key = await getOrCreateMasterKey();
    const exportedKey = await crypto.subtle.exportKey('jwk', key);
    const keyJson = JSON.stringify(exportedKey);

    // 2. Generate salt & encrypt master key
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const salt = Array.from(saltBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const encryptedMasterKey = await encryptMasterKeyWithPassword(keyJson, password, salt);

    // 3. Store encrypted master key & config, remove raw master key from local storage
    const config: VaultConfig = {
      mode: 'password',
      salt,
      encryptedMasterKey,
    };
    await saveVaultConfig(config);

    // Keep key in session storage
    await browser.storage.session.set({ [MASTER_KEY_ID]: keyJson });

    // Remove raw master key from persistent local storage
    await browser.storage.local.remove([MASTER_KEY_ID]);

    return true;
  } catch (error) {
    logError('Failed to setup Master Password', error);
    return false;
  }
}

/**
 * Unlock Vault using Master Password.
 */
export async function unlockVaultWithPassword(password: string): Promise<boolean> {
  try {
    const config = await getVaultConfig();
    if (!config.salt || !config.encryptedMasterKey) {
      return false;
    }

    const keyJson = await decryptMasterKeyWithPassword(
      config.encryptedMasterKey,
      password,
      config.salt
    );
    if (!keyJson) {
      return false;
    }

    // Write decrypted master key to session storage
    await browser.storage.session.set({ [MASTER_KEY_ID]: keyJson });
    return true;
  } catch (error) {
    logError('Failed to unlock vault with password', error);
    return false;
  }
}

/**
 * Enable Biometric / System PIN Protection (Windows Hello / Touch ID / WebAuthn).
 */
export async function setupBiometricVault(): Promise<boolean> {
  try {
    if (!(await isBiometricSupported())) {
      return false;
    }

    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = crypto.getRandomValues(new Uint8Array(16));

    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: '1Click Temp Mail Vault' },
        user: {
          id: userId,
          name: 'user@1click.local',
          displayName: '1Click Vault User',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
        },
        extensions: {
          prf: {},
        },
        timeout: 60000,
      },
    })) as PublicKeyCredential | null;

    if (!credential) return false;

    // Verify that the PRF extension was enabled by the authenticator
    const extResults = credential.getClientExtensionResults();
    if (!extResults?.prf?.enabled) {
      logError('WebAuthn PRF extension is not supported or not enabled by the authenticator');
      return false;
    }

    const credIdHex = Array.from(new Uint8Array(credential.rawId))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // Generate a 32-byte salt (as required by WebAuthn PRF specs)
    const saltBytes = crypto.getRandomValues(new Uint8Array(32));
    const salt = Array.from(saltBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // Immediately run get() to evaluate the salt and obtain the cryptographic secret
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [
          {
            id: credential.rawId,
            type: 'public-key',
          },
        ],
        userVerification: 'required',
        extensions: {
          prf: {
            eval: {
              first: saltBytes,
            },
          },
        },
        timeout: 60000,
      },
    })) as PublicKeyCredential | null;

    if (!assertion) return false;

    const prfResults = assertion.getClientExtensionResults().prf;
    if (!prfResults?.results?.first) {
      logError('WebAuthn PRF results missing or not supported on this device/browser');
      return false;
    }

    const firstVal = prfResults.results.first;
    const firstBuffer =
      firstVal instanceof ArrayBuffer ? firstVal : (firstVal as ArrayBufferView).buffer;
    const secretBytes = new Uint8Array(firstBuffer);
    const secretHex = Array.from(secretBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // 1. Get current master key JWK
    const key = await getOrCreateMasterKey();
    const exportedKey = await crypto.subtle.exportKey('jwk', key);
    const keyJson = JSON.stringify(exportedKey);

    // 2. Encrypt master key with the derived cryptographic secret
    const encryptedMasterKey = await encryptMasterKeyWithPassword(keyJson, secretHex, salt);

    const config: VaultConfig = {
      mode: 'biometrics',
      salt,
      encryptedMasterKey,
      biometricCredentialId: credIdHex,
    };
    await saveVaultConfig(config);

    // Keep key in session storage & remove from local storage
    await browser.storage.session.set({ [MASTER_KEY_ID]: keyJson });
    await browser.storage.local.remove([MASTER_KEY_ID]);

    return true;
  } catch (error) {
    logError('Failed to setup biometric vault', error);
    return false;
  }
}

/**
 * Unlock Vault using Biometrics / System PIN.
 */
export async function unlockVaultWithBiometrics(): Promise<boolean> {
  try {
    const config = await getVaultConfig();
    if (!config.biometricCredentialId || !config.encryptedMasterKey || !config.salt) {
      return false;
    }

    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const credIdBytes = new Uint8Array(
      config.biometricCredentialId.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []
    );

    const saltBytes = new Uint8Array(
      config.salt.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []
    );

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [
          {
            id: credIdBytes,
            type: 'public-key',
          },
        ],
        userVerification: 'required',
        extensions: {
          prf: {
            eval: {
              first: saltBytes,
            },
          },
        },
        timeout: 60000,
      },
    });

    if (!assertion) return false;

    const prfResults = (assertion as PublicKeyCredential).getClientExtensionResults().prf;
    if (!prfResults?.results?.first) {
      logError('WebAuthn PRF results missing or not supported on this device/browser');
      return false;
    }

    const firstVal = prfResults.results.first;
    const firstBuffer =
      firstVal instanceof ArrayBuffer ? firstVal : (firstVal as ArrayBufferView).buffer;
    const secretBytes = new Uint8Array(firstBuffer);
    const secretHex = Array.from(secretBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // Decrypt master key using the derived cryptographic secret
    const keyJson = await decryptMasterKeyWithPassword(
      config.encryptedMasterKey,
      secretHex,
      config.salt
    );
    if (!keyJson) return false;

    await browser.storage.session.set({ [MASTER_KEY_ID]: keyJson });
    return true;
  } catch (error) {
    logError('Failed to unlock vault with biometrics', error);
    return false;
  }
}

/**
 * Revert Vault to Standard Mode (unprotected local storage key).
 */
export async function disableVaultLock(): Promise<boolean> {
  try {
    const key = await getOrCreateMasterKey();
    const exportedKey = await crypto.subtle.exportKey('jwk', key);
    const keyJson = JSON.stringify(exportedKey);

    // Save key to local storage
    await browser.storage.local.set({ [MASTER_KEY_ID]: keyJson });
    await saveVaultConfig({ mode: 'standard' });
    return true;
  } catch (error) {
    logError('Failed to disable vault lock', error);
    return false;
  }
}

/**
 * Lock the vault by removing the decrypted Master Key from session storage.
 */
export async function lockVault(): Promise<void> {
  try {
    clearCachedMasterKey();
    await browser.storage.session.remove([MASTER_KEY_ID]);
  } catch (error) {
    logError('Failed to lock vault', error);
  }
}
