/**
 * Unit tests for the intelligence-store purge helpers:
 * `forgetAddressesFromIntelligence` and `forgetIdentitiesFromIntelligence`.
 *
 * These run when inboxes or identities are deleted, so a burned inbox must
 * not keep steering site replay (`lastAddressId` switches the ACTIVE inbox on
 * the next fill) and deleted identities must not keep occupying cap slots in
 * the sticky map / site profiles.
 *
 * Site profiles survive deletes (they describe the SITE - success counts,
 * field kinds, preferred mode); only the pointers naming the removed entity
 * are dropped.
 */

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});

const store: Record<string, unknown> = {};

const fakeBrowser = {
  runtime: { id: 'test-extension' },
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
      remove: async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
      },
    },
  },
};

mock.module('wxt/browser', () => ({ browser: fakeBrowser }));
Object.assign(globalThis, { browser: fakeBrowser });

const { forgetAddressesFromIntelligence, forgetIdentitiesFromIntelligence } = await import(
  '@/features/intelligence/storage.js'
);

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

describe('forgetAddressesFromIntelligence', () => {
  test('drops lastAddressId/lastEmail from the matching site profile, keeps the profile itself', async () => {
    store.siteProfiles = {
      'shop.example': {
        domain: 'shop.example',
        lastAddressId: 'a1',
        lastEmail: 'a1@x.com',
        lastIdentityId: 'id-keep',
        successCount: 4,
        failureCount: 1,
        fieldKindsSeen: ['email', 'password'],
        preferredMode: 'replay',
        updatedAt: 1,
      },
    };
    store.addressLifecycle = { a1: { addressId: 'a1', sitesUsed: ['shop.example'] } };

    await forgetAddressesFromIntelligence([{ id: 'a1', address: 'A1@x.com' }]);

    const profiles = store.siteProfiles as Record<string, Record<string, unknown>>;
    const profile = profiles['shop.example'];
    expect(profile.lastAddressId).toBeUndefined();
    expect(profile.lastEmail).toBeUndefined();
    // The site-level facts survive: they describe the site, not the inbox.
    expect(profile.lastIdentityId).toBe('id-keep');
    expect(profile.successCount).toBe(4);
    expect(profile.preferredMode).toBe('replay');

    const lifecycle = store.addressLifecycle as Record<string, unknown>;
    expect(lifecycle.a1).toBeUndefined();
  });

  test('email matching is case-insensitive, id matching is exact', async () => {
    store.siteProfiles = {
      'case.example': { domain: 'case.example', lastEmail: 'Burned@X.com', successCount: 0 },
      'other.example': { domain: 'other.example', lastAddressId: 'OTHER', successCount: 0 },
    };

    await forgetAddressesFromIntelligence([{ id: 'a1', address: 'burned@x.com' }]);

    const profiles = store.siteProfiles as Record<string, Record<string, unknown>>;
    expect(profiles['case.example'].lastEmail).toBeUndefined();
    // A different address must keep its pointer; an id that only shares the
    // email's casing must not be forgotten.
    expect(profiles['other.example'].lastAddressId).toBe('OTHER');
  });

  test('leaves unrelated profiles and lifecycle entries untouched', async () => {
    store.siteProfiles = {
      'keep.example': {
        domain: 'keep.example',
        lastAddressId: 'live',
        lastEmail: 'live@x.com',
        successCount: 2,
      },
    };
    store.addressLifecycle = { live: { addressId: 'live', sitesUsed: [] } };

    await forgetAddressesFromIntelligence([{ id: 'burned', address: 'burned@x.com' }]);

    const profiles = store.siteProfiles as Record<string, Record<string, unknown>>;
    expect(profiles['keep.example'].lastAddressId).toBe('live');
    expect(profiles['keep.example'].lastEmail).toBe('live@x.com');
    const lifecycle = store.addressLifecycle as Record<string, unknown>;
    expect(lifecycle.live).toBeDefined();
  });

  test('no-ops on an empty request', async () => {
    store.siteProfiles = { 'x.example': { domain: 'x.example', successCount: 0 } };
    await forgetAddressesFromIntelligence([]);
    expect(Object.keys(store.siteProfiles as object)).toEqual(['x.example']);
  });
});

describe('forgetIdentitiesFromIntelligence', () => {
  test('drops the sticky mapping and the site-profile lastIdentityId', async () => {
    store.identityStickyByDomain = { 'shop.example': 'gone', 'other.example': 'keep' };
    store.siteProfiles = {
      'shop.example': { domain: 'shop.example', lastIdentityId: 'gone', successCount: 0 },
      'other.example': { domain: 'other.example', lastIdentityId: 'keep', successCount: 0 },
    };

    await forgetIdentitiesFromIntelligence(['gone']);

    const sticky = store.identityStickyByDomain as Record<string, string>;
    expect(sticky['shop.example']).toBeUndefined();
    expect(sticky['other.example']).toBe('keep');

    const profiles = store.siteProfiles as Record<string, Record<string, unknown>>;
    expect(profiles['shop.example'].lastIdentityId).toBeUndefined();
    expect(profiles['other.example'].lastIdentityId).toBe('keep');
  });

  test('no-ops on an empty request', async () => {
    store.identityStickyByDomain = { 'x.example': 'i1' };
    await forgetIdentitiesFromIntelligence([]);
    expect(store.identityStickyByDomain).toEqual({ 'x.example': 'i1' });
  });
});
