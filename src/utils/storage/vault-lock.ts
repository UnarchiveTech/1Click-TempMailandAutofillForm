import { browser } from 'wxt/browser';
import { logError } from '../logger.js';
import { withLock } from '../mutex.js';
import {
  ARGON2ID_KDF,
  type Argon2idKdf,
  clearCachedMasterKey,
  decryptMasterKeyWithPassword,
  encryptMasterKeyWithPassword,
  getOrCreateMasterKey,
  inspectCiphertextStores,
  isSupportedArgon2idKdf,
  MASTER_KEY_ID,
  reencryptCiphertextStores,
} from '../security/crypto.js';
import { writeWithRetry } from './storage-write.js';

export type VaultSecurityMode = 'standard' | 'password' | 'biometrics';

export type VaultAutoLockTimeout = '5m' | '15m' | '30m' | '1h' | 'session' | 'never';

export const VAULT_TIMEOUT_MS_MAP: Record<VaultAutoLockTimeout, number> = {
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  session: 0, // Locks on browser restart / session storage cleared
  never: Infinity, // Never auto-locks on idle
};

export function getVaultAutoLockTimeoutMs(timeout?: VaultAutoLockTimeout): number {
  if (!timeout) return 15 * 60 * 1000;
  return VAULT_TIMEOUT_MS_MAP[timeout] ?? 15 * 60 * 1000;
}

export interface VaultConfig {
  mode: VaultSecurityMode;
  salt?: string;
  encryptedMasterKey?: string;
  biometricCredentialId?: string;
  /** Versioned Argon2id profile used to wrap the master key. */
  kdf?: Argon2idKdf;
  /** Configurable auto-lock idle timeout (default: 15m). */
  autoLockTimeout?: VaultAutoLockTimeout;
}

const VAULT_CONFIG_KEY = 'vault_security_config';

/**
 * Local-storage backup of the PRE-change vault config, kept while a re-key
 * is pending fresh-lock verification so the change can be rolled back.
 */
const VAULT_CONFIG_BACKUP_KEY = 'vault_security_config_backup';
/** Session stash holding the OLD raw master key during a pending re-key. */
const VAULT_OLD_KEY_SESSION_KEY = 'vault_rekey_old_key';
/** Session stash holding the NEW raw master key once verification locks the vault. */
const VAULT_NEW_KEY_SESSION_KEY = 'vault_rekey_new_key';

/** Persistent local-storage key: restarting must not reset brute-force lockout. */
const VAULT_LOCKOUT_KEY = 'vault_unlock_lockout';
export const VAULT_LAST_ACTIVITY_KEY = '_last_vault_activity';

/** Max attempts before lockout. Lockout duration doubles each tier. */
const VAULT_MAX_ATTEMPTS = 5;
/** Lockout durations in ms: 30s, 5m, 30m, 2h, 12h */
const VAULT_LOCKOUT_DURATIONS = [30_000, 300_000, 1_800_000, 7_200_000, 43_200_000];

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
    /* ignore */
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
    /* ignore */
    return { mode: 'standard' };
  }
}

/**
 * Save vault security configuration.
 */
export async function saveVaultConfig(config: VaultConfig): Promise<void> {
  // The vault config IS the credential to every encrypted store: a hiccup that
  // drops it must be retried, not surfaced, or the next unlock sees no vault.
  await writeWithRetry({ [VAULT_CONFIG_KEY]: config });
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
    /* ignore */
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
    const encryptedMasterKey = await encryptMasterKeyWithPassword(
      keyJson,
      password,
      salt,
      ARGON2ID_KDF
    );

    // 3. Store encrypted master key & config, remove raw master key from local storage
    const config: VaultConfig = {
      mode: 'password',
      salt,
      encryptedMasterKey,
      kdf: ARGON2ID_KDF,
    };
    // Stage the unlocked key first, then switch mode and clear the persistent
    // JWK in one local-storage write. A crash can leave the old standard state
    // intact, but cannot leave a protected config beside the raw local key.
    await browser.storage.session.set({
      [MASTER_KEY_ID]: keyJson,
      [VAULT_LAST_ACTIVITY_KEY]: Date.now(),
    });
    await writeWithRetry({ [MASTER_KEY_ID]: null, [VAULT_CONFIG_KEY]: config });

    return true;
  } catch (error) {
    logError('Failed to setup Master Password', error);
    return false;
  }
}

/**
 * Unlock Vault using Master Password.
 * Implements brute-force protection: 5 failed attempts triggers an exponentially
 * increasing lockout (30s → 5min → 30min → 2h → 12h).
 */
/**
 * Unlock the vault with the master password.
 *
 * The whole attempt (including the brute-force lockout counter update) is
 * serialized through the lockout mutex: two concurrent contexts (popup +
 * sidepanel, sidepanel + app) could otherwise both read the same attempt
 * count, both write 5 → lockedUntil, and LOSE one tier escalation or one
 * counter reset - yielding a shorter lockout than intended. Serializing also
 * throttles concurrent Argon2id guesses, which is the point of the counter.
 */
export async function unlockVaultWithPassword(password: string): Promise<{
  success: boolean;
  lockedOutUntil?: number;
}> {
  return withLock('vault_unlock_lockout', () => unlockVaultWithPasswordUnlocked(password));
}

async function unlockVaultWithPasswordUnlocked(password: string): Promise<{
  success: boolean;
  lockedOutUntil?: number;
}> {
  try {
    // ── Brute-force lockout check ─────────────────────────────────────────
    const lockoutRes = (await browser.storage.local
      .get([VAULT_LOCKOUT_KEY])
      .catch(() => ({}))) as Record<string, unknown>;
    const lockout = lockoutRes[VAULT_LOCKOUT_KEY] as
      | { attempts: number; lockedUntil: number; tier: number }
      | undefined;

    const now = Date.now();
    if (lockout?.lockedUntil && lockout.lockedUntil > now) {
      logError('Vault unlock blocked - lockout active', undefined, undefined);
      return { success: false, lockedOutUntil: lockout.lockedUntil };
    }

    // ── Attempt unlock ────────────────────────────────────────────────────
    const config = await getVaultConfig();
    if (!config.salt || !config.encryptedMasterKey) {
      return { success: false };
    }

    const keyJson = await decryptMasterKeyWithPassword(
      config.encryptedMasterKey,
      password,
      config.salt,
      requireCurrentKdf(config.kdf)
    );

    if (!keyJson) {
      // ── Record failed attempt ──────────────────────────────────────────
      // `tier` stored on the record is the NEXT lockout tier index (0 = 30s,
      // 1 = 5m, …). The first lockout uses tier 0; each subsequent lockout
      // escalates one tier up to the 12h cap. After a lockout EXPIRES the
      // attempt counter resets so the user gets a fresh set of
      // VAULT_MAX_ATTEMPTS per tier - a single mistake after expiry must not
      // immediately re-trigger a longer lockout.
      const prevTier = lockout?.tier ?? 0;
      const freshAfterExpiry = !!lockout?.lockedUntil && lockout.lockedUntil <= now;
      const baseAttempts = freshAfterExpiry ? 0 : (lockout?.attempts ?? 0);
      const prevAttempts = baseAttempts + 1;
      if (prevAttempts >= VAULT_MAX_ATTEMPTS) {
        const tier = Math.min(prevTier, VAULT_LOCKOUT_DURATIONS.length - 1);
        const duration = VAULT_LOCKOUT_DURATIONS[tier];
        await browser.storage.local
          .set({
            [VAULT_LOCKOUT_KEY]: {
              attempts: prevAttempts,
              lockedUntil: now + duration,
              // Next lockout escalates one tier (capped at the longest).
              tier: Math.min(tier + 1, VAULT_LOCKOUT_DURATIONS.length - 1),
            },
          })
          .catch(() => {});
        return { success: false, lockedOutUntil: now + duration };
      }
      await browser.storage.local
        .set({
          [VAULT_LOCKOUT_KEY]: {
            attempts: prevAttempts,
            lockedUntil: 0,
            tier: prevTier,
          },
        })
        .catch(() => {});
      return { success: false };
    }

    // ── Success: clear lockout, store key ─────────────────────────────────
    await browser.storage.local.remove(VAULT_LOCKOUT_KEY as string).catch(() => {});
    await browser.storage.session.set({
      [MASTER_KEY_ID]: keyJson,
      [VAULT_LAST_ACTIVITY_KEY]: Date.now(),
    });
    // A successful unlock proves the CURRENT wrapped key round-trips with zero
    // session state - exactly what a browser restart experiences. Any pending
    // re-key rollback stash is therefore obsolete: sweep it.
    await sweepRekeyStash();
    return { success: true };
  } catch (error) {
    logError('Failed to unlock vault with password', error);
    return { success: false };
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

    // Use the vault's 16-byte Argon2id salt as the PRF input too, so setup
    // and later unlocks derive the same wrapping key with a valid salt.
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
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
    const secretBytes =
      firstVal instanceof ArrayBuffer
        ? new Uint8Array(firstVal)
        : new Uint8Array(firstVal.buffer, firstVal.byteOffset, firstVal.byteLength);
    const secretHex = Array.from(secretBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // 1. Get current master key JWK
    const key = await getOrCreateMasterKey();
    const exportedKey = await crypto.subtle.exportKey('jwk', key);
    const keyJson = JSON.stringify(exportedKey);

    // 2. Encrypt master key with the derived cryptographic secret
    const encryptedMasterKey = await encryptMasterKeyWithPassword(
      keyJson,
      secretHex,
      salt,
      ARGON2ID_KDF
    );

    const config: VaultConfig = {
      mode: 'biometrics',
      salt,
      encryptedMasterKey,
      biometricCredentialId: credIdHex,
      kdf: ARGON2ID_KDF,
    };
    // As in password setup, stage the key in session before atomically
    // committing protected mode and clearing the persistent JWK.
    await browser.storage.session.set({
      [MASTER_KEY_ID]: keyJson,
      [VAULT_LAST_ACTIVITY_KEY]: Date.now(),
    });
    await writeWithRetry({ [MASTER_KEY_ID]: null, [VAULT_CONFIG_KEY]: config });

    return true;
  } catch (error) {
    logError('Failed to setup biometric vault', error);
    return false;
  }
}

/**
 * Derive the WebAuthn PRF secret (Windows Hello / Touch ID) for the CURRENT
 * vault config - a real biometric/PIN user gesture. Shared by unlock and by
 * key rotation (which must re-wrap the fresh key with the SAME secret).
 * Returns null when the authenticator declines, PRF is missing, or the config
 * is incomplete.
 */
async function deriveBiometricSecret(): Promise<{ secretHex: string } | null> {
  try {
    const config = await getVaultConfig();
    if (!config.biometricCredentialId || !config.encryptedMasterKey || !config.salt) {
      return null;
    }

    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const credIdArr =
      config.biometricCredentialId.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) ?? [];
    const saltArr = config.salt.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) ?? [];
    if (credIdArr.length === 0 || saltArr.length === 0) {
      logError('Invalid biometric credential ID or salt format');
      return null;
    }
    const credIdBytes = new Uint8Array(credIdArr);
    const saltBytes = new Uint8Array(saltArr);

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

    if (!assertion) return null;

    const prfResults = (assertion as PublicKeyCredential).getClientExtensionResults().prf;
    if (!prfResults?.results?.first) {
      logError('WebAuthn PRF results missing or not supported on this device/browser');
      return null;
    }

    const firstVal = prfResults.results.first;
    const secretBytes =
      firstVal instanceof ArrayBuffer
        ? new Uint8Array(firstVal)
        : new Uint8Array(firstVal.buffer, firstVal.byteOffset, firstVal.byteLength);
    return {
      secretHex: Array.from(secretBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(''),
    };
  } catch (error) {
    logError('Failed to derive biometric secret', error);
    return null;
  }
}

/**
 * Unlock Vault using Biometrics / System PIN.
 */
export async function unlockVaultWithBiometrics(): Promise<boolean> {
  try {
    return await withLock('vault_unlock_lockout', async () => {
      let lockout: { attempts: number; lockedUntil: number; tier: number } | undefined;
      try {
        const lockoutRes = (await browser.storage.local.get([VAULT_LOCKOUT_KEY])) as Record<
          string,
          unknown
        >;
        lockout = lockoutRes[VAULT_LOCKOUT_KEY] as typeof lockout;
      } catch (error) {
        logError('Failed to read vault biometric lockout state', error);
        return false;
      }

      const now = Date.now();
      if (lockout?.lockedUntil && lockout.lockedUntil > now) return false;

      const config = await getVaultConfig();
      if (!config.encryptedMasterKey || !config.salt) return false;

      try {
        const secret = await deriveBiometricSecret();
        if (!secret) {
          await recordBiometricUnlockFailure(lockout);
          return false;
        }

        const keyJson = await decryptMasterKeyWithPassword(
          config.encryptedMasterKey,
          secret.secretHex,
          config.salt,
          requireCurrentKdf(config.kdf)
        );
        if (!keyJson) {
          await recordBiometricUnlockFailure(lockout);
          return false;
        }

        await browser.storage.session.set({
          [MASTER_KEY_ID]: keyJson,
          [VAULT_LAST_ACTIVITY_KEY]: Date.now(),
        });
        await browser.storage.local.remove(VAULT_LOCKOUT_KEY as string).catch(() => {});
        return true;
      } catch (error) {
        logError('Failed to unlock vault with biometrics', error);
        await recordBiometricUnlockFailure(lockout);
        return false;
      }
    });
  } catch (error) {
    logError('Failed to acquire biometric vault unlock lock', error);
    return false;
  }
}

/** Apply the same escalating failed-attempt lockout to biometric attempts. */
async function recordBiometricUnlockFailure(
  lockout: { attempts: number; lockedUntil: number; tier: number } | undefined
): Promise<void> {
  const now = Date.now();
  const freshAfterExpiry = !!lockout?.lockedUntil && lockout.lockedUntil <= now;
  const attempts = (freshAfterExpiry ? 0 : (lockout?.attempts ?? 0)) + 1;
  const tier = Math.min(lockout?.tier ?? 0, VAULT_LOCKOUT_DURATIONS.length - 1);
  const locked = attempts >= VAULT_MAX_ATTEMPTS;
  const duration = locked ? VAULT_LOCKOUT_DURATIONS[tier] : 0;
  await browser.storage.local
    .set({
      [VAULT_LOCKOUT_KEY]: {
        attempts,
        lockedUntil: locked ? now + duration : 0,
        tier: locked ? Math.min(tier + 1, VAULT_LOCKOUT_DURATIONS.length - 1) : tier,
      },
    })
    .catch((error: unknown) => logError('Failed to persist vault biometric lockout state', error));
}

/**
 * Iterations for an unlock-time master-key unwrap: the CURRENT count or
 * nothing else. 3.0.0 removed the 210k migration read and the unlock-time
 * legacy-KDF upgrade, so a record that was not wrapped at the current
 * strength cannot unlock - fail closed rather than guess, and never accept
 * a higher count either (it would contradict the stored config and make the
 * recorded work factor meaningless).
 */
function requireCurrentKdf(kdf?: unknown): Argon2idKdf {
  if (isSupportedArgon2idKdf(kdf)) return kdf;
  throw new Error('Vault KDF parameters are not supported by this version');
}

/**
 * Re-key the vault: mint a FRESH master key, migrate EVERY master-key
 * ciphertext store (saved-login passwords, identity custom passwords, inbox
 * tokens, settings custom password) onto it via the shared
 * `reencryptCiphertextStores` utility, and wrap the new key with a NEW master
 * password.
 *
 * This is the "change / reset master password" flow - and it also switches a
 * biometrics-protected vault to a password WITHOUT first disabling protection:
 *  - a password vault requires a fresh verification of the current password,
 *    even when its key is already available in this session;
 *  - a biometrics vault requires a fresh Windows Hello / Touch ID assertion
 *    instead of a typed password;
 *  - all-or-nothing: stores are swapped in memory first - any value that can't
 *    be decrypted with the old key aborts with `migration-failed` and NOTHING
 *    is written; otherwise the migrated stores + the new wrapped key commit in
 *    a single storage.local.set;
 *  - the raw key is never persisted to local storage (password mode keeps it
 *    in session only, exactly like setupMasterPassword).
 */
export async function rekeyVault(opts: {
  newPassword: string;
  currentPassword?: string;
  /**
   * Stash the OLD wrapped config + OLD raw key so the change can be rolled
   * back if the fresh-lock verification (`verifyVaultRekey`) never succeeds.
   * The change is NOT final until verification passes and the stash is swept.
   */
  prepareRollback?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  return withLock('vault_rekey_lock', () => rekeyVaultUnlocked(opts));
}

async function rekeyVaultUnlocked(opts: {
  newPassword: string;
  currentPassword?: string;
  prepareRollback?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const newPassword = opts?.newPassword || '';
    if (newPassword.length < 6) {
      return { success: false, error: 'password-too-short' };
    }

    const config = await getVaultConfig();
    if (config.mode === 'standard') {
      // Nothing to change - enabling protection is setupMasterPassword's job.
      return { success: false, error: 'not-protected' };
    }

    // 1. Prove fresh control of the existing vault before changing its key.
    // An unlocked session key alone is insufficient: someone at an unlocked
    // browser could otherwise replace the password without knowing it.
    if (config.mode === 'biometrics') {
      // Biometrics vaults have no typed password. Require a fresh assertion
      // even if this browser session already holds the decrypted key.
      const ok = await unlockVaultWithBiometrics();
      if (!ok) {
        return { success: false, error: 'biometric-unlock-failed' };
      }
    } else {
      if (!opts.currentPassword) {
        return { success: false, error: 'locked' };
      }
      const unlock = await unlockVaultWithPassword(opts.currentPassword);
      if (!unlock.success) {
        return {
          success: false,
          error: unlock.lockedOutUntil ? 'locked-out' : 'invalid-current-password',
        };
      }
    }

    // 1.5. (optional) Stash the old config + old raw key for rollback. The old
    // key is in session at this point (from the unlock above, or a prior
    // unlock in this browser session).
    if (opts?.prepareRollback && !(await stashVaultRekeyRollback(config))) {
      // Can't offer a rollback without the old key - refuse rather than
      // commit a change we couldn't undo.
      return { success: false, error: 'unknown' };
    }

    // 2. Fresh key; migrate every store old-key → new-key in memory (abort
    // BEFORE any write if any value can't be decrypted).
    const migration = await createFreshKeyAndMigrateStores();
    if (!migration.ok) {
      // Abort BEFORE any write - never persist a mixed-key state.
      return { success: false, error: migration.error };
    }
    const newKey = migration.newKey;
    const result = migration.migrated;

    // 3. Wrap the fresh key with the new password.
    const newKeyJson = JSON.stringify(await crypto.subtle.exportKey('jwk', newKey));
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const salt = Array.from(saltBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const encryptedMasterKey = await encryptMasterKeyWithPassword(
      newKeyJson,
      newPassword,
      salt,
      ARGON2ID_KDF
    );

    // 4. Atomic commit: migrated stores + the new vault config in ONE write.
    await writeWithRetry({
      ...result.data,
      [VAULT_CONFIG_KEY]: {
        mode: 'password',
        salt,
        encryptedMasterKey,
        kdf: ARGON2ID_KDF,
      },
    });

    // 5. Unlocked state: keep the raw key in SESSION only.
    await commitFreshKeyToSession(newKey);

    return { success: true };
  } catch (e) {
    logError('rekeyVault failed', e);
    return { success: false, error: 'unknown' };
  }
}

/**
 * Delete the pending re-key / rotation rollback stash. Called by a successful
 * unlock (which proves the CURRENT wrapped key round-trips - the stash is
 * obsolete) and by the biometric fresh-lock verification path.
 */
async function sweepRekeyStash(): Promise<void> {
  await browser.storage.local.remove(VAULT_CONFIG_BACKUP_KEY).catch(() => {});
  await browser.storage.session
    .remove([VAULT_OLD_KEY_SESSION_KEY, VAULT_NEW_KEY_SESSION_KEY])
    .catch(() => {});
}

/**
 * (optional) Stash the OLD wrapped config + OLD raw key so a re-key / rotation
 * can be rolled back if the fresh-lock verification (`verifyVaultRekey`) never
 * succeeds. The change is NOT final until verification passes and the stash is
 * swept. Returns `false` when the old key isn't in session - the caller must
 * refuse rather than commit a change it couldn't undo.
 */
export async function stashVaultRekeyRollback(config: VaultConfig): Promise<boolean> {
  const oldKeyJson = (await browser.storage.session.get([MASTER_KEY_ID]))[MASTER_KEY_ID] as
    | string
    | undefined;
  if (!oldKeyJson) {
    // Can't offer a rollback without the old key - refuse rather than
    // commit a change we couldn't undo.
    return false;
  }
  await browser.storage.session.set({ [VAULT_OLD_KEY_SESSION_KEY]: oldKeyJson });
  await writeWithRetry({ [VAULT_CONFIG_BACKUP_KEY]: config });
  return true;
}

/**
 * Mint a FRESH master key and re-encrypt every master-key ciphertext store
 * (saved-login passwords, identity custom passwords, inbox tokens, settings
 * custom password, the AI API key, and WebDAV connection/backup passwords)
 * onto it - all in memory, nothing persisted. Returns `ok: false` with
 * `migration-failed` when any value can't be decrypted with the old key; the
 * caller MUST abort BEFORE any write so a mixed-key state is never persisted.
 */
export async function createFreshKeyAndMigrateStores(): Promise<
  | { ok: true; newKey: CryptoKey; migrated: Awaited<ReturnType<typeof reencryptCiphertextStores>> }
  | { ok: false; error: string }
> {
  const oldKey = await getOrCreateMasterKey();
  const newKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  const stores = (await browser.storage.local.get([
    'loginInfo',
    'identities',
    'addresses',
    'passwordSettings',
    'aiApiKey',
    'webdavConfig',
  ])) as Record<string, unknown>;
  const migrated = await reencryptCiphertextStores(stores, oldKey, newKey);
  if (migrated.leftUntouched > 0) {
    // Abort BEFORE any write - never persist a mixed-key state.
    return { ok: false, error: 'migration-failed' };
  }
  return { ok: true, newKey, migrated };
}

/**
 * Commit a freshly-wrapped master key to the unlocked session: keep the raw
 * JWK in SESSION only (never local storage) and drop the module key cache so
 * the next read re-imports from session. Returns the exported JWK JSON.
 */
export async function commitFreshKeyToSession(newKey: CryptoKey): Promise<string> {
  const newKeyJson = JSON.stringify(await crypto.subtle.exportKey('jwk', newKey));
  await browser.storage.session.set({
    [MASTER_KEY_ID]: newKeyJson,
    [VAULT_LAST_ACTIVITY_KEY]: Date.now(),
  });
  await browser.storage.local.remove([MASTER_KEY_ID]);
  clearCachedMasterKey();
  return newKeyJson;
}

/**
 * Phase 2 of the change-password / rotate-key flow: prove the re-wrapped key
 * survives a REAL browser restart.
 *
 * Steps:
 *  1. Keep the NEW raw key available for a possible rollback (session stash),
 *  2. simulate a fresh restart - `lockVault()` wipes the session key AND the
 *     module key cache, so nothing but the stored wrapped blob remains,
 *  3. unlock through the exact restart code path: the NEW password
 *     (`unlockVaultWithPassword` derives purely from the stored config) for
 *     password vaults, or a biometric prompt for biometrics vaults (a rotation
 *     keeps the same protection).
 *
 * On success the change is final: the rollback stash is swept and the vault
 * ends UNLOCKED with the new key.
 *
 * On failure NOTHING is finalized: the vault stays locked, the stash stays in
 * place, and the caller may retry (each attempt is a normal unlock attempt,
 * so brute-force lockout still applies) or call `cancelVaultRekey()` to undo.
 */
export async function verifyVaultRekey(newPassword: string): Promise<{
  success: boolean;
  error?: 'verification-failed' | 'locked-out' | 'not-found' | 'unknown';
}> {
  try {
    // Only meaningful while a re-key prepared a rollback stash.
    const backup = (await browser.storage.local.get([VAULT_CONFIG_BACKUP_KEY]))[
      VAULT_CONFIG_BACKUP_KEY
    ];
    if (!backup) {
      return { success: false, error: 'not-found' };
    }

    // Preserve the NEW key for rollback, then wipe all session state.
    const newKeyJson = (await browser.storage.session.get([MASTER_KEY_ID]))[MASTER_KEY_ID] as
      | string
      | undefined;
    if (newKeyJson) {
      await browser.storage.session.set({ [VAULT_NEW_KEY_SESSION_KEY]: newKeyJson });
    }
    await lockVault();

    const config = await getVaultConfig();
    if (config.mode === 'biometrics') {
      // A rotation keeps biometrics - the fresh-lock proof is a biometric prompt.
      const ok = await unlockVaultWithBiometrics();
      if (!ok) {
        return { success: false, error: 'verification-failed' };
      }
      await sweepRekeyStash();
      return { success: true };
    }

    const unlock = await unlockVaultWithPassword(newPassword);
    if (unlock.success) {
      // Success sweep happens inside unlockVaultWithPassword.
      return { success: true };
    }
    return {
      success: false,
      error: unlock.lockedOutUntil ? 'locked-out' : 'verification-failed',
    };
  } catch (e) {
    logError('verifyVaultRekey failed', e);
    return { success: false, error: 'unknown' };
  }
}

/**
 * Undo a pending re-key: restore the OLD wrapped config and re-encrypt every
 * store back onto the OLD key, so the vault works again with the PREVIOUS
 * password. No-op (rolledBack: false) when no stash exists - e.g. the modal
 * was closed before the change ever ran.
 */
export async function cancelVaultRekey(): Promise<{ rolledBack: boolean }> {
  try {
    const backup = (await browser.storage.local.get([VAULT_CONFIG_BACKUP_KEY]))[
      VAULT_CONFIG_BACKUP_KEY
    ] as VaultConfig | undefined;
    if (!backup) {
      return { rolledBack: false };
    }
    return { rolledBack: await rollbackVaultRekey(backup) };
  } catch (e) {
    logError('cancelVaultRekey failed', e);
    return { rolledBack: false };
  }
}

/**
 * Internal rollback: restore `backup` config and migrate every store from the
 * NEW key back to the OLD key (both recovered from session stashes). Atomic -
 * if any value can't be decrypted, NOTHING is written.
 */
async function rollbackVaultRekey(backup: VaultConfig): Promise<boolean> {
  try {
    const sessionRes = (await browser.storage.session.get([
      MASTER_KEY_ID,
      VAULT_OLD_KEY_SESSION_KEY,
      VAULT_NEW_KEY_SESSION_KEY,
    ])) as Record<string, string | undefined>;
    // The NEW key lives under MASTER_KEY_ID until verification locks the vault
    // (then it's under VAULT_NEW_KEY_SESSION_KEY).
    const newKeyJson = sessionRes[VAULT_NEW_KEY_SESSION_KEY] ?? sessionRes[MASTER_KEY_ID];
    const oldKeyJson = sessionRes[VAULT_OLD_KEY_SESSION_KEY];
    if (!newKeyJson || !oldKeyJson) {
      logError('rollbackVaultRekey: missing key material', undefined, undefined);
      return false;
    }

    const oldKey = await crypto.subtle.importKey(
      'jwk',
      JSON.parse(oldKeyJson) as JsonWebKey,
      { name: 'AES-GCM' },
      true,
      ['encrypt', 'decrypt']
    );
    const newKey = await crypto.subtle.importKey(
      'jwk',
      JSON.parse(newKeyJson) as JsonWebKey,
      { name: 'AES-GCM' },
      true,
      ['encrypt', 'decrypt']
    );

    const stores = (await browser.storage.local.get([
      'loginInfo',
      'identities',
      'addresses',
      'passwordSettings',
      'aiApiKey',
      'webdavConfig',
    ])) as Record<string, unknown>;
    const result = await reencryptCiphertextStores(stores, newKey, oldKey);
    if (result.leftUntouched > 0) {
      // Never persist a mixed-key state.
      logError('rollbackVaultRekey: migration incomplete', undefined, undefined);
      return false;
    }

    await writeWithRetry({ ...result.data, [VAULT_CONFIG_KEY]: backup });
    await browser.storage.session.set({
      [MASTER_KEY_ID]: oldKeyJson,
      [VAULT_LAST_ACTIVITY_KEY]: Date.now(),
    });
    await browser.storage.session.remove([VAULT_OLD_KEY_SESSION_KEY, VAULT_NEW_KEY_SESSION_KEY]);
    await browser.storage.local.remove(VAULT_CONFIG_BACKUP_KEY);
    clearCachedMasterKey();
    return true;
  } catch (e) {
    logError('rollbackVaultRekey failed', e);
    return false;
  }
}

/**
 * Pre-flight check for a manual key rotation: how many credentials WILL be
 * migrated (re-encrypted onto a fresh key), and whether any ciphertext value
 * can't be decrypted (which would abort the rotation).
 *
 * When the vault is locked the raw key isn't available, so the migratable
 * count is STRUCTURAL (ciphertext-looking values) and `checked` is false -
 * decryptability is only verified once the rotation actually unlocks.
 */
export async function preflightVaultReKey(): Promise<{
  migratable: number;
  undecryptable: number;
  checked: boolean;
}> {
  try {
    const stores = (await browser.storage.local.get([
      'loginInfo',
      'identities',
      'addresses',
      'passwordSettings',
      'aiApiKey',
      'webdavConfig',
    ])) as Record<string, unknown>;
    if (await isVaultLocked()) {
      const { migratable } = await inspectCiphertextStores(stores, null);
      return { migratable, undecryptable: 0, checked: false };
    }
    const key = await getOrCreateMasterKey();
    const { migratable, undecryptable } = await inspectCiphertextStores(stores, key);
    return { migratable, undecryptable, checked: true };
  } catch (e) {
    logError('preflightVaultReKey failed', e);
    return { migratable: 0, undecryptable: 0, checked: false };
  }
}

/**
 * Manual key rotation for PROTECTED vaults: mint a FRESH master key and
 * re-encrypt every store onto it, re-wrapping the fresh key with the SAME
 * credential (the current password for password vaults, the same WebAuthn PRF
 * secret for biometrics vaults). The password / protection itself does NOT
 * change - only the key does.
 *
 * Like `rekeyVault` it supports `prepareRollback` + `verifyVaultRekey` so the
 * rotation is only final after the fresh-lock proof, and can be rolled back
 * (old key + old wrapped config restored) if the user cancels.
 */
export async function rotateVaultKey(opts: {
  currentPassword?: string;
  prepareRollback?: boolean;
}): Promise<{ success: boolean; error?: string; migratable?: number }> {
  return withLock('vault_rekey_lock', () => rotateVaultKeyUnlocked(opts));
}

async function rotateVaultKeyUnlocked(opts: {
  currentPassword?: string;
  prepareRollback?: boolean;
}): Promise<{ success: boolean; error?: string; migratable?: number }> {
  try {
    const config = await getVaultConfig();
    if (config.mode === 'standard') {
      return { success: false, error: 'not-protected' };
    }

    // 1. Ensure the current key is available AND capture the credential
    //    material needed to re-wrap the fresh key with the SAME protection.
    let rewrapPassword: string;
    if (config.mode === 'biometrics') {
      // One biometric prompt authenticates AND yields the PRF secret. The PRF
      // secret is deterministic per (credential, salt), so keeping the stored
      // salt means the same prompt re-wraps AND future unlocks work.
      const secret = await deriveBiometricSecret();
      if (!secret) {
        return { success: false, error: 'biometric-unlock-failed' };
      }
      rewrapPassword = secret.secretHex;
      if (await isVaultLocked()) {
        // deriveBiometricSecret already required salt + encryptedMasterKey.
        const keyJson = await decryptMasterKeyWithPassword(
          config.encryptedMasterKey ?? '',
          secret.secretHex,
          config.salt ?? '',
          requireCurrentKdf(config.kdf)
        );
        if (!keyJson) {
          return { success: false, error: 'biometric-unlock-failed' };
        }
        await browser.storage.session.set({
          [MASTER_KEY_ID]: keyJson,
          [VAULT_LAST_ACTIVITY_KEY]: Date.now(),
        });
      }
    } else {
      if (!opts.currentPassword) {
        return { success: false, error: 'locked' };
      }
      if (await isVaultLocked()) {
        const unlock = await unlockVaultWithPassword(opts.currentPassword);
        if (!unlock.success) {
          return {
            success: false,
            error: unlock.lockedOutUntil ? 'locked-out' : 'invalid-current-password',
          };
        }
      } else {
        // An unlocked session key proves only that this browser session was
        // unlocked earlier. Verify the password entered in the rotation form
        // against the currently persisted wrapping key before using it to wrap
        // the replacement key; otherwise a typo silently replaces the valid
        // password and locks the user out at the next lock.
        const currentConfigKey = await decryptMasterKeyWithPassword(
          config.encryptedMasterKey ?? '',
          opts.currentPassword,
          config.salt ?? '',
          requireCurrentKdf(config.kdf)
        );
        if (!currentConfigKey) {
          return { success: false, error: 'invalid-current-password' };
        }
        const session = (await browser.storage.session.get([MASTER_KEY_ID])) as {
          [MASTER_KEY_ID]?: string;
        };
        const sessionKey = session[MASTER_KEY_ID];
        if (!sessionKey) return { success: false, error: 'locked' };
        const wrappedJwk = JSON.parse(currentConfigKey) as JsonWebKey;
        const sessionJwk = JSON.parse(sessionKey) as JsonWebKey;
        if (!wrappedJwk.k || wrappedJwk.k !== sessionJwk.k) {
          return { success: false, error: 'invalid-current-password' };
        }
      }
      rewrapPassword = opts.currentPassword;
    }

    // 2. (optional) Rollback stash - same shape as rekeyVault.
    if (opts?.prepareRollback && !(await stashVaultRekeyRollback(config))) {
      return { success: false, error: 'unknown' };
    }

    // 3. Fresh key; migrate every store old-key → new-key in memory (abort
    // BEFORE any write if any value can't be decrypted).
    const migration = await createFreshKeyAndMigrateStores();
    if (!migration.ok) {
      // Abort BEFORE any write - never persist a mixed-key state.
      return { success: false, error: migration.error };
    }
    const newKey = migration.newKey;
    const result = migration.migrated;

    // 4. Re-wrap the fresh key with the SAME credential.
    const newKeyJson = JSON.stringify(await crypto.subtle.exportKey('jwk', newKey));
    const salt =
      config.mode === 'biometrics'
        ? (config.salt ?? '')
        : Array.from(crypto.getRandomValues(new Uint8Array(16)))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
    const encryptedMasterKey = await encryptMasterKeyWithPassword(
      newKeyJson,
      rewrapPassword,
      salt,
      ARGON2ID_KDF
    );

    // 5. Atomic commit: migrated stores + the new wrapped config (same mode).
    await writeWithRetry({
      ...result.data,
      [VAULT_CONFIG_KEY]: {
        ...config,
        salt,
        encryptedMasterKey,
        kdf: ARGON2ID_KDF,
      },
    });

    // 6. Unlocked state: keep the raw key in SESSION only.
    await commitFreshKeyToSession(newKey);

    return { success: true, migratable: result.swapped };
  } catch (e) {
    logError('rotateVaultKey failed', e);
    return { success: false, error: 'unknown' };
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

    // Commit standard mode and its raw key together, so a crash cannot leave
    // the protected config pointing at a newly persisted raw local key.
    await writeWithRetry({ [MASTER_KEY_ID]: keyJson, [VAULT_CONFIG_KEY]: { mode: 'standard' } });
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
    await browser.storage.session.remove([MASTER_KEY_ID, VAULT_LAST_ACTIVITY_KEY]);
    browser.runtime.sendMessage({ type: 'vaultLocked' }).catch(() => {});
  } catch (error) {
    logError('Failed to lock vault', error);
  }
}
