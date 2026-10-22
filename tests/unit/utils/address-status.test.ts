import { describe, expect, test } from 'bun:test';
import type { AddressLike } from '@/utils/address/address-status.js';
import {
  canAutoRenew,
  getLifecycleStatus,
  isArchived,
  isLive,
  isTimeExpired,
  normalizeAddressEmail,
  resolveDragLifecycleAction,
} from '@/utils/address/address-status.js';

describe('account-status', () => {
  test('live vs expired (expiresAt 0 is not expired)', () => {
    // Annotated with the module's own type: these fixtures ARE address-like
    // objects, and the annotation is what makes a lifecycle value the compiler
    // checks rather than a widened `string`.
    const live: AddressLike = { accountStatus: 'active', expiresAt: Date.now() + 60_000 };
    const neverExpires: AddressLike = { accountStatus: 'active', expiresAt: 0 };
    const expired: AddressLike = { accountStatus: 'active', expiresAt: Date.now() - 1000 };
    expect(isLive(live)).toBe(true);
    expect(isLive(neverExpires)).toBe(true);
    expect(isTimeExpired(expired)).toBe(true);
    expect(isLive(expired)).toBe(false);
  });

  test('normalizes address matching input', () => {
    expect(normalizeAddressEmail('  User@Example.COM  ')).toBe('user@example.com');
    expect(normalizeAddressEmail('   ')).toBe('');
    expect(normalizeAddressEmail(undefined)).toBe('');
  });

  test('archived takes precedence over clock', () => {
    const a: AddressLike = { accountStatus: 'archived', expiresAt: Date.now() + 99999 };
    expect(isArchived(a)).toBe(true);
    expect(getLifecycleStatus(a)).toBe('archived');
    expect(isLive(a)).toBe(false);
  });

  test('drag live/inactive actions', () => {
    const live: AddressLike = {
      accountStatus: 'active',
      expiresAt: Date.now() + 99999,
      provider: 'x',
    };
    expect(resolveDragLifecycleAction(live, 'inactive')).toBe('archive');
    expect(resolveDragLifecycleAction(live, 'live')).toBe('noop');

    const archived: AddressLike = { accountStatus: 'archived', expiresAt: Date.now() + 99999 };
    expect(resolveDragLifecycleAction(archived, 'live')).toBe('unarchive');
    expect(resolveDragLifecycleAction(archived, 'inactive')).toBe('noop');

    const expired: AddressLike = {
      accountStatus: 'active',
      expiresAt: Date.now() - 1000,
      provider: 'unknown-provider-xyz',
    };
    // unknown provider → no renew
    expect(resolveDragLifecycleAction(expired, 'live')).toBe('error_no_renew');
  });

  test('an expired archived renewable inbox offers combined recovery', () => {
    const archived: AddressLike = {
      accountStatus: 'archived',
      expiresAt: Date.now() - 1000,
      provider: 'demo',
    };
    expect(canAutoRenew(archived)).toBe(false); // ordinary live-only actions stay guarded
    expect(resolveDragLifecycleAction(archived, 'live')).toBe('unarchive_and_renew');
    expect(
      resolveDragLifecycleAction({ ...archived, provider: 'unknown-provider-xyz' }, 'live')
    ).toBe('unarchive');
    expect(resolveDragLifecycleAction({ ...archived, accountStatus: 'deleted' }, 'live')).toBe(
      'noop'
    );
  });
});
