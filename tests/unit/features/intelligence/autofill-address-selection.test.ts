import { describe, expect, test } from 'bun:test';
import {
  findUnusedLiveAddress,
  isEmailUsedInLoginEntries,
} from '@/entrypoints/content/autofill/form-filler.js';
import type { CredentialsHistoryItem } from '@/utils/types.js';

function login(overrides: Partial<CredentialsHistoryItem>): CredentialsHistoryItem {
  return {
    id: 'login-1',
    domain: 'example.com',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('autofill address reuse eligibility', () => {
  test('does not mark an address used when only autofill is pending submission', () => {
    expect(
      isEmailUsedInLoginEntries('active@example.com', [
        login({ email: 'active@example.com', signupStatus: 'pending_submit' }),
      ])
    ).toBe(false);
  });

  test('marks submitted and verified addresses as consumed', () => {
    expect(
      isEmailUsedInLoginEntries('used@example.com', [
        login({ email: 'used@example.com', signupStatus: 'submitted' }),
      ])
    ).toBe(true);
    expect(
      isEmailUsedInLoginEntries('verified@example.com', [
        login({ email: 'verified@example.com', signupStatus: 'verified' }),
      ])
    ).toBe(true);
  });

  test('does not treat a username-only match as email usage', () => {
    expect(
      isEmailUsedInLoginEntries('available@example.com', [
        login({ username: 'available@example.com', signupStatus: 'verified' }),
      ])
    ).toBe(false);
  });

  test('chooses an existing live unused address before creating a new one', () => {
    expect(
      findUnusedLiveAddress(
        [
          { id: 'used', address: 'used@example.com' },
          { id: 'available', address: 'available@example.com' },
          { id: 'archived', address: 'archived@example.com', accountStatus: 'archived' },
        ],
        [login({ email: 'used@example.com', signupStatus: 'verified' })]
      )?.address
    ).toBe('available@example.com');
  });
});
