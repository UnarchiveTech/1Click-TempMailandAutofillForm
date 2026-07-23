import { describe, expect, test } from 'bun:test';
import {
  getLifecycleStatus,
  isArchived,
  isLive,
  isTimeExpired,
  resolveDragLifecycleAction,
} from '@/utils/account-status.js';

describe('account-status', () => {
  test('live vs expired (expiresAt 0 is not expired)', () => {
    const live = { accountStatus: 'active', expiresAt: Date.now() + 60_000 };
    const neverExpires = { accountStatus: 'active', expiresAt: 0 };
    const expired = { accountStatus: 'active', expiresAt: Date.now() - 1000 };
    expect(isLive(live)).toBe(true);
    expect(isLive(neverExpires)).toBe(true);
    expect(isTimeExpired(expired)).toBe(true);
    expect(isLive(expired)).toBe(false);
  });

  test('archived takes precedence over clock', () => {
    const a = { accountStatus: 'archived', expiresAt: Date.now() + 99999 };
    expect(isArchived(a)).toBe(true);
    expect(getLifecycleStatus(a)).toBe('archived');
    expect(isLive(a)).toBe(false);
  });

  test('drag live/inactive actions', () => {
    const live = { accountStatus: 'active', expiresAt: Date.now() + 99999, provider: 'x' };
    expect(resolveDragLifecycleAction(live, 'inactive')).toBe('archive');
    expect(resolveDragLifecycleAction(live, 'live')).toBe('noop');

    const archived = { accountStatus: 'archived', expiresAt: Date.now() + 99999 };
    expect(resolveDragLifecycleAction(archived, 'live')).toBe('unarchive');
    expect(resolveDragLifecycleAction(archived, 'inactive')).toBe('noop');

    const expired = {
      accountStatus: 'active',
      expiresAt: Date.now() - 1000,
      provider: 'unknown-provider-xyz',
    };
    // unknown provider → no renew
    expect(resolveDragLifecycleAction(expired, 'live')).toBe('error_no_renew');
  });
});
