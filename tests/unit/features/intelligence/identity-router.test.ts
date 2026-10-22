import { describe, expect, test } from 'bun:test';
import { routeIdentityForDomain } from '@/features/intelligence/identity-router.js';
import type { Identity } from '@/utils/types.js';

function mockIdentity(partial: Partial<Identity> & { id: string; name: string }): Identity {
  return {
    firstNames: 'Jane',
    lastNames: 'Doe',
    username: 'janedoe',
    useRandomPassword: true,
    isDefault: false,
    createdAt: Date.now(),
    ...partial,
  } as Identity;
}

describe('routeIdentityForDomain', () => {
  test('routes identity by domainHints', async () => {
    const identities = [
      mockIdentity({ id: '1', name: 'Default', isDefault: true }),
      mockIdentity({ id: '2', name: 'GitHub Work', domainHints: ['github.com'] }),
    ];

    const res = await routeIdentityForDomain('github.com', identities);
    expect(res.identityId).toBe('2');
    expect(res.reason).toBe('domain_hint');
    expect(res.identity?.name).toBe('GitHub Work');
  });

  test('routes identity by domainFieldOverrides', async () => {
    const identities = [
      mockIdentity({ id: '1', name: 'Default', isDefault: true }),
      mockIdentity({
        id: '2',
        name: 'Custom Domain Override',
        domainFieldOverrides: {
          'gitlab.com': { username: 'custom_gitlab_user' },
        },
      }),
    ];

    const res = await routeIdentityForDomain('sub.gitlab.com', identities);
    expect(res.identityId).toBe('2');
    expect(res.reason).toBe('domain_hint');
    expect(res.identity?.name).toBe('Custom Domain Override');
  });

  test('does not route unrelated tenants through a shared-host hint', async () => {
    const identities = [
      mockIdentity({ id: '1', name: 'Default', isDefault: true }),
      mockIdentity({ id: '2', name: 'Tenant', domainHints: ['github.io'] }),
    ];

    const res = await routeIdentityForDomain('customer.github.io', identities);

    expect(res.identityId).toBe('1');
    expect(res.reason).toBe('default');
  });

  test('falls back to default identity if no domain match', async () => {
    const identities = [
      mockIdentity({ id: '1', name: 'Default', isDefault: true }),
      mockIdentity({ id: '2', name: 'Specific', domainHints: ['specific.com'] }),
    ];

    const res = await routeIdentityForDomain('unrelated.com', identities);
    expect(res.identityId).toBe('1');
    expect(res.reason).toBe('default');
  });
});
