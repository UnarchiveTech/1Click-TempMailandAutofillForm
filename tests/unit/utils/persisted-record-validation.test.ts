import { describe, expect, test } from 'bun:test';
import {
  filterPersistedAddresses,
  filterPersistedIdentities,
  isPersistedAddress,
  isPersistedIdentity,
} from '@/utils/storage/storage-keys.js';

const validAddress = {
  id: 'address-1',
  address: 'user@example.com',
  provider: 'guerrilla',
  createdAt: 1_700_000_000_000,
  expiresAt: 1_700_000_100_000,
  token: '_enc_:ciphertext',
};

const validIdentity = {
  id: 'identity-1',
  name: 'Jane Doe',
  firstNames: 'Jane',
  lastNames: 'Doe',
  useRandomPassword: true,
  isDefault: false,
  createdAt: 1_700_000_000_000,
};

describe('persisted record validation', () => {
  test('accepts valid address records without stripping encrypted fields', () => {
    expect(isPersistedAddress(validAddress)).toBe(true);
    expect(filterPersistedAddresses([validAddress])).toEqual([validAddress]);
  });

  test('rejects malformed address records', () => {
    expect(isPersistedAddress({ ...validAddress, address: 'not-an-email' })).toBe(false);
    expect(isPersistedAddress({ ...validAddress, createdAt: 'old' })).toBe(false);
    expect(filterPersistedAddresses([validAddress, null, { id: 'missing-fields' }])).toEqual([
      validAddress,
    ]);
  });

  test('accepts older identities with optional fields omitted', () => {
    expect(isPersistedIdentity(validIdentity)).toBe(true);
    expect(filterPersistedIdentities([validIdentity])).toEqual([validIdentity]);
  });

  test('rejects malformed identity records', () => {
    expect(isPersistedIdentity({ ...validIdentity, useRandomPassword: 'yes' })).toBe(false);
    expect(isPersistedIdentity({ ...validIdentity, createdAt: Number.NaN })).toBe(false);
    expect(filterPersistedIdentities([validIdentity, undefined, { id: 'missing-fields' }])).toEqual(
      [validIdentity]
    );
  });
});
