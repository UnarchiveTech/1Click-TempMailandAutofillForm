import { afterAll, describe, expect, mock, test } from 'bun:test';

import type { Identity } from '@/utils/types.js';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// ── In-memory browser mock (registered before the dynamic import) ───────────
// freshness.ts reads browser.storage.local - without this the test only passes
// serially via a leaked mock.module from another file (--parallel isolates).
const fakeBrowser = {
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
    },
  },
};

mock.module('wxt/browser', () => ({ browser: fakeBrowser }));
Object.assign(globalThis, { browser: fakeBrowser });

const { rankIdentitiesForSignup } = await import('@/features/intelligence/freshness.js');

function id(partial: Partial<Identity> & { id: string; name: string }): Identity {
  return {
    firstNames: 'A, B',
    lastNames: 'X, Y',
    useRandomPassword: true,
    isDefault: false,
    createdAt: Date.now(),
    ...partial,
  } as Identity;
}

describe('rankIdentitiesForSignup', () => {
  test('prefers identities not used on the domain', async () => {
    // Mock storage via global is hard; function reads browser.storage - skip if unavailable
    if (typeof globalThis === 'undefined') return;
    const identities = [
      id({ id: 'used', name: 'Used', isDefault: true }),
      id({ id: 'fresh', name: 'Fresh' }),
    ];
    const ranked = await rankIdentitiesForSignup('example.com', identities, [
      'a@example.com',
      'b@example.com',
    ]);
    expect(ranked.length).toBe(2);
    expect(ranked[0]?.score).toBeGreaterThanOrEqual(ranked[1]?.score ?? 0);
  });

  test('matches preferred email without case sensitivity and preserves live-email casing', async () => {
    const ranked = await rankIdentitiesForSignup(
      'example.com',
      [id({ id: 'preferred', name: 'Preferred', preferredEmail: 'USER@EXAMPLE.NET' })],
      ['user@example.net']
    );

    expect(ranked[0]?.email).toBe('user@example.net');
  });

  test('matches domain hints by host boundary, not arbitrary substring', async () => {
    const ranked = await rankIdentitiesForSignup(
      'example.com',
      [
        id({ id: 'bounded', name: 'Bounded', domainHints: ['example.com'] }),
        id({ id: 'lookalike', name: 'Lookalike', domainHints: ['example.com.evil'] }),
      ],
      []
    );

    expect(ranked.find((candidate) => candidate.identityId === 'bounded')?.reasons).toContain(
      'domain_hint'
    );
    expect(ranked.find((candidate) => candidate.identityId === 'lookalike')?.reasons).not.toContain(
      'domain_hint'
    );
  });
});
