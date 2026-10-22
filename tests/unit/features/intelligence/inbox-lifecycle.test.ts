import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

afterAll(() => mock.restore());

const localStore: Record<string, unknown> = {};
let lifecycleMap: Record<string, Record<string, unknown>> = {};
let storedEmails: Record<string, unknown[]> = {};

const fakeBrowser = {
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => {
        if (keys == null) return { ...localStore };
        const requested = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(
          requested.filter((key) => key in localStore).map((key) => [key, localStore[key]])
        );
      },
      set: async (items: Record<string, unknown>) => Object.assign(localStore, items),
      remove: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete localStore[key];
      },
    },
  },
};

mock.module('wxt/browser', () => ({ browser: fakeBrowser }));
mock.module('@/utils/mutex.js', () => ({
  LOCKS: { ADDRESS_LIFECYCLE: 'address-lifecycle' },
  withLock: async (_key: string, callback: () => unknown) => callback(),
}));
mock.module('@/utils/storage/storage-keys.js', () => ({
  getStoredEmailsMap: async () => storedEmails,
  resolveBagKey: (map: Record<string, unknown>, address: string) =>
    Object.keys(map).find((key) => key.toLowerCase() === address.toLowerCase()) || address,
}));
mock.module('@/features/intelligence/storage.js', () => ({
  loadAddressLifecycleMap: async () => structuredClone(lifecycleMap),
  saveAddressLifecycleMap: async (next: Record<string, Record<string, unknown>>) => {
    lifecycleMap = structuredClone(next);
  },
  normalizeDomain: (domain: string) => domain.toLowerCase(),
}));

const { recomputeLifecycleFromStorage, suggestLifecycleActions } = await import(
  '@/features/intelligence/inbox-lifecycle.js'
);

beforeEach(() => {
  for (const key of Object.keys(localStore)) delete localStore[key];
  lifecycleMap = {};
  storedEmails = {};
});

describe('inbox lifecycle activity timestamps', () => {
  test('replaces legacy synthetic timestamps with address age when no activity exists', async () => {
    const createdAt = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const account = {
      id: 'idle-inbox',
      address: 'idle@example.com',
      createdAt,
      expiresAt: Date.now() + 60 * 24 * 60 * 60 * 1000,
      accountStatus: 'active',
    } as never;
    lifecycleMap['idle-inbox'] = {
      addressId: 'idle-inbox',
      address: 'idle@example.com',
      sitesUsed: [],
      otpCount: 0,
      magicLinkCount: 0,
      autofillCount: 0,
      lastActivityAt: Date.now(),
      valueScore: 15,
      updatedAt: Date.now(),
    };

    await recomputeLifecycleFromStorage([account]);

    expect(lifecycleMap['idle-inbox']?.lastActivityAt).toBe(0);
    expect(lifecycleMap['idle-inbox']?.hasObservedActivity).toBe(false);
    const suggestions = await suggestLifecycleActions([account]);
    expect(suggestions.some((suggestion) => suggestion.kind === 'archive_idle')).toBe(true);
  });

  test('uses a stored message timestamp as real activity', async () => {
    const createdAt = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const receivedAt = Date.now() - 60_000;
    const account = {
      id: 'mailbox',
      address: 'mailbox@example.com',
      createdAt,
      expiresAt: Date.now() + 60 * 24 * 60 * 60 * 1000,
      accountStatus: 'active',
    } as never;
    storedEmails['mailbox@example.com'] = [
      { id: 'mail', received_at: Math.floor(receivedAt / 1000) },
    ];

    await recomputeLifecycleFromStorage([account]);

    expect(lifecycleMap.mailbox?.lastActivityAt).toBeGreaterThan(receivedAt - 2_000);
    expect(lifecycleMap.mailbox?.hasObservedActivity).toBe(true);
    const suggestions = await suggestLifecycleActions([account]);
    expect(suggestions.some((suggestion) => suggestion.kind === 'archive_idle')).toBe(false);
  });
});
