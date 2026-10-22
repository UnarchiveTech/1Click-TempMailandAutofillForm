import { describe, expect, test } from 'bun:test';
import { createDefaultIdentity } from '@/features/identities/identity-actions.js';
import { PREFERRED_EMAIL_RANDOM_ACTIVE } from '@/utils/provider/blocked-temp-mail-sites.js';

describe('createDefaultIdentity', () => {
  test('follows the currently active mailbox instead of randomly selecting one', () => {
    const identity = createDefaultIdentity();

    expect(identity.isDefault).toBe(true);
    expect(identity.preferredEmail).toBe('');
    expect(identity.preferredEmail).not.toBe(PREFERRED_EMAIL_RANDOM_ACTIVE);
  });
});
