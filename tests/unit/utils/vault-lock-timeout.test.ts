import { describe, expect, test } from 'bun:test';
import { getVaultAutoLockTimeoutMs, VAULT_TIMEOUT_MS_MAP } from '@/utils/storage/vault-lock.js';

describe('Vault Auto-Lock Timeout', () => {
  test('returns correct milliseconds for each timeout option', () => {
    expect(VAULT_TIMEOUT_MS_MAP['5m']).toBe(5 * 60 * 1000);
    expect(VAULT_TIMEOUT_MS_MAP['15m']).toBe(15 * 60 * 1000);
    expect(VAULT_TIMEOUT_MS_MAP['30m']).toBe(30 * 60 * 1000);
    expect(VAULT_TIMEOUT_MS_MAP['1h']).toBe(60 * 60 * 1000);
    expect(VAULT_TIMEOUT_MS_MAP.session).toBe(0);
    expect(VAULT_TIMEOUT_MS_MAP.never).toBe(Infinity);
  });

  test('getVaultAutoLockTimeoutMs falls back to 15m default', () => {
    expect(getVaultAutoLockTimeoutMs(undefined)).toBe(15 * 60 * 1000);
    expect(getVaultAutoLockTimeoutMs('30m')).toBe(30 * 60 * 1000);
    expect(getVaultAutoLockTimeoutMs('1h')).toBe(60 * 60 * 1000);
    expect(getVaultAutoLockTimeoutMs('session')).toBe(0);
    expect(getVaultAutoLockTimeoutMs('never')).toBe(Infinity);
  });
});
