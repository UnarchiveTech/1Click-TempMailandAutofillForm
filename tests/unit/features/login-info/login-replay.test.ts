import { afterAll, describe, expect, mock, test } from 'bun:test';
import type { AddressStatus } from '@/utils/types.js';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// findSiteReplayForDomain walks: wxt/browser → crypto.ts (decrypt) →
// vault-lock.ts (isVaultLocked) → intelligence/storage.js (site profile).
// Provide in-memory mocks so the module graph loads and behaves deterministically.
const store: Record<string, unknown> = {};
mock.module('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: async (keys?: string | string[] | null) => {
          if (keys === null || keys === undefined) return { ...store };
          const arr = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of arr) if (k in store) out[k] = store[k];
          return out;
        },
        set: async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        },
      },
      session: {
        get: async () => ({}),
      },
    },
    runtime: { id: 'ext' },
  },
}));

// Identity decrypt: stored passwords come back as-is (ciphertext detection
// mirrors the real heuristic so short plaintext passwords are replayable).
const decryptedValues: string[] = [];
mock.module('@/utils/security/crypto.js', () => ({
  decrypt: async (s: string) => {
    decryptedValues.push(s);
    return s;
  },
  encrypt: async (s: string) => s,
  looksLikeCiphertext: (s: string) => s.length >= 40 && /^[A-Za-z0-9+/]+={0,2}$/.test(s),
}));

let vaultLocked = false;
mock.module('@/utils/storage/vault-lock.js', () => ({
  isVaultLocked: async () => vaultLocked,
}));

const { findSiteReplayForDomain } = await import(
  '@/features/login-info/saved-login-credentials.js'
);

const NOW = Date.now();

test('decrypts only matching live credentials even with thousands of saved logins', async () => {
  vaultLocked = false;
  store.siteProfiles = {};
  store.addresses = [makeAddress(), makeAddress({ id: 'expired', expiresAt: NOW - 1000 })];
  store.loginInfo = [
    ...Array.from({ length: 5000 }, (_, n) => ({
      domain: `site-${n}.test`,
      email: 'other@x.com',
      password: `other-${n}`,
      timestamp: n,
    })),
    {
      domain: 'example.com',
      email: 'first@x.com',
      password: 'first-password',
      addressId: 'live',
      timestamp: NOW,
    },
    {
      domain: 'example.com',
      email: 'recent@x.com',
      password: 'recent-password',
      addressId: 'live',
      timestamp: NOW + 1,
    },
    {
      domain: 'example.com',
      email: 'expired@x.com',
      password: 'expired-password',
      addressId: 'expired',
      timestamp: NOW + 2,
    },
  ];
  decryptedValues.length = 0;
  store.autofillLoginPreference = 'recent';
  expect((await findSiteReplayForDomain('login.example.com')).credential?.email).toBe(
    'recent@x.com'
  );
  expect(decryptedValues).toEqual(['first-password', 'recent-password']);
  decryptedValues.length = 0;
  store.autofillLoginPreference = 'listOrder';
  expect((await findSiteReplayForDomain('login.example.com')).credential?.email).toBe(
    'first@x.com'
  );
  expect(decryptedValues).toEqual(['first-password', 'recent-password']);
  delete store.autofillLoginPreference;
});

function makeAddress(
  overrides: Partial<{
    id: string;
    address: string;
    // The persisted vocabulary, not `string`: this fixture seeds records the
    // liveness helpers compare, so a token that is not one of the three would
    // seed a state the app cannot produce.
    accountStatus: AddressStatus;
    expiresAt: number;
  }> = {}
) {
  return {
    id: overrides.id ?? 'live',
    address: overrides.address ?? 'live@x.com',
    provider: 'guerrilla',
    accountStatus: overrides.accountStatus ?? 'active',
    expiresAt: overrides.expiresAt ?? NOW + 60_000,
  };
}

describe('findSiteReplayForDomain - inbox liveness', () => {
  test('drops credentials whose inbox is archived, deleted, or expired', async () => {
    store.addresses = [
      makeAddress({ id: 'live', address: 'live@x.com' }),
      makeAddress({ id: 'dead-arch', address: 'd1@x.com', accountStatus: 'archived' }),
      makeAddress({ id: 'dead-del', address: 'd2@x.com', accountStatus: 'deleted' }),
      makeAddress({ id: 'dead-exp', address: 'd3@x.com', expiresAt: NOW - 1000 }),
    ];
    store.loginInfo = [
      {
        domain: 'example.com',
        email: 'live@x.com',
        password: 'pw-live',
        addressId: 'live',
        timestamp: 4,
      },
      {
        domain: 'example.com',
        email: 'd1@x.com',
        password: 'pw-d1',
        addressId: 'dead-arch',
        timestamp: 3,
      },
      {
        domain: 'example.com',
        email: 'd2@x.com',
        password: 'pw-d2',
        addressId: 'dead-del',
        timestamp: 2,
      },
      {
        domain: 'example.com',
        email: 'd3@x.com',
        password: 'pw-d3',
        addressId: 'dead-exp',
        timestamp: 1,
      },
    ];
    const result = await findSiteReplayForDomain('example.com');
    expect(result.credential?.email).toBe('live@x.com');
    expect(result.hasSavedLogin).toBe(true);
  });

  test('credentials imported without an addressId are still replayable', async () => {
    store.addresses = [];
    store.loginInfo = [
      { domain: 'example.com', email: 'imported@x.com', password: 'pw', timestamp: 1 },
    ];
    const result = await findSiteReplayForDomain('example.com');
    expect(result.credential?.email).toBe('imported@x.com');
  });

  test('a dead inbox is not offered even when it is the only match', async () => {
    store.addresses = [
      makeAddress({ id: 'dead-exp', address: 'only@x.com', expiresAt: NOW - 1000 }),
    ];
    store.loginInfo = [
      {
        domain: 'example.com',
        email: 'only@x.com',
        password: 'pw',
        addressId: 'dead-exp',
        timestamp: 1,
      },
    ];
    const result = await findSiteReplayForDomain('example.com');
    expect(result.credential).toBeNull();
  });

  test('regression: a DEAD lastAddressId in the site profile is not surfaced', async () => {
    // The site profile never forgets an address on its own, and the content
    // script switches the ACTIVE inbox to `lastAddressId` when it differs -
    // a dead id here re-pointed the active mailbox at an inbox that can never
    // receive an OTP again.
    store.addresses = [makeAddress({ id: 'live', address: 'live@x.com' })];
    store.siteProfiles = {
      'example.com': {
        domain: 'example.com',
        lastAddressId: 'dead-exp',
        lastEmail: 'dead@x.com',
        successCount: 3,
        failureCount: 0,
        fieldKindsSeen: [],
        preferredMode: 'replay',
        updatedAt: 1,
      },
    };
    // No matching credential for the domain: the profile pointer used to be
    // returned verbatim (vault-locked and no-password paths behave the same).
    store.loginInfo = [];

    const result = await findSiteReplayForDomain('example.com');
    expect(result.credential).toBeNull();
    // The expired inbox's pointer is suppressed instead of surfaced.
    expect(result.lastAddressId).toBeUndefined();
  });

  test('a live credential outranks a dead profile pointer', async () => {
    store.addresses = [makeAddress({ id: 'live', address: 'live@x.com' })];
    store.siteProfiles = {
      'example.com': {
        domain: 'example.com',
        lastAddressId: 'dead-exp',
        lastEmail: 'dead@x.com',
        successCount: 3,
        failureCount: 0,
        fieldKindsSeen: [],
        preferredMode: 'replay',
        updatedAt: 1,
      },
    };
    store.loginInfo = [
      {
        domain: 'example.com',
        email: 'live@x.com',
        password: 'pw-live',
        addressId: 'live',
        timestamp: 1,
      },
    ];

    const result = await findSiteReplayForDomain('example.com');
    // The live credential is found and ITS address is what surfaces - never
    // the dead profile pointer.
    expect(result.credential?.email).toBe('live@x.com');
    expect(result.lastAddressId).toBe('live');
  });

  test('a LIVE lastAddressId in the site profile is still surfaced', async () => {
    store.addresses = [
      makeAddress({ id: 'live', address: 'live@x.com' }),
      makeAddress({ id: 'other-live', address: 'other@x.com' }),
    ];
    store.siteProfiles = {
      'example.com': {
        domain: 'example.com',
        lastAddressId: 'other-live',
        lastEmail: 'other@x.com',
        successCount: 1,
        fieldKindsSeen: [],
        preferredMode: 'auto',
        updatedAt: 1,
      },
    };
    store.loginInfo = [
      {
        domain: 'example.com',
        email: 'live@x.com',
        password: 'pw-live',
        addressId: 'live',
        timestamp: 2,
      },
      {
        domain: 'example.com',
        email: 'other@x.com',
        password: 'pw-other',
        addressId: 'other-live',
        timestamp: 1,
      },
    ];

    const result = await findSiteReplayForDomain('example.com');
    expect(result.lastAddressId).toBe('other-live');
    // The profile address pool outranks anything but the profile email pool.
    expect(result.credential?.email).toBe('other@x.com');
  });
});

describe('findSiteReplayForDomain - vault-locked surfacing', () => {
  test('vault locked surfaces instead of silently returning “no replay”', async () => {
    vaultLocked = true;
    store.addresses = [makeAddress({ id: 'live', address: 'live@x.com' })];
    store.loginInfo = [
      { domain: 'example.com', email: 'live@x.com', password: 'pw', addressId: 'live' },
    ];
    const result = await findSiteReplayForDomain('example.com');
    expect(result.credential).toBeNull();
    expect(result.vaultLocked).toBe(true);
    expect(result.hasSavedLogin).toBe(true);
    vaultLocked = false;
  });

  test('vault locked with no saved login for the domain claims nothing (no false surface)', async () => {
    vaultLocked = true;
    store.addresses = [makeAddress({ id: 'live', address: 'live@x.com' })];
    store.loginInfo = [{ domain: 'other.com', email: 'x@y.com', password: 'pw' }];
    const result = await findSiteReplayForDomain('example.com');
    expect(result.vaultLocked).toBeFalsy();
    expect(result.hasSavedLogin).toBe(false);
    vaultLocked = false;
  });
});
