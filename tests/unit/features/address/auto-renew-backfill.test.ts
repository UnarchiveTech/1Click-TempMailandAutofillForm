import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { ManagementSetters } from '@/features/address/address-management.js';
import type { Address } from '@/utils/types.js';
import { DEFAULT_KEYBINDINGS } from '@/utils/types.js';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
const store: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};
let setCalls: Record<string, unknown>[] = [];

const fakeBrowser = {
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
        setCalls.push({ ...items });
        Object.assign(store, items);
      },
      remove: async () => {},
    },
    session: {
      get: async (keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return { ...sessionStore };
        const list = Array.isArray(keys) ? keys : [keys];
        const result: Record<string, unknown> = {};
        for (const key of list) if (key in sessionStore) result[key] = sessionStore[key];
        return result;
      },
      set: async (items: Record<string, unknown>) => {
        Object.assign(sessionStore, items);
      },
      remove: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete sessionStore[key];
      },
    },
  },
  alarms: { create: async () => {}, clear: async () => {} },
};

// Only `wxt/browser` is mocked - the real address-management, settings-actions,
// and i18n (English fallback) modules stay intact.
mock.module('wxt/browser', () => ({ browser: fakeBrowser }));
Object.assign(globalThis, { browser: fakeBrowser });

const { applyAutoRenewToAll } = await import('@/features/address/address-management.js');
const { saveSettings } = await import('@/features/settings/settings-actions.js');

const NOW = Date.now();

function addr(partial: Partial<Address> & { id: string }): Address {
  return {
    address: `${partial.id}@test.com`,
    provider: 'guerrilla',
    createdAt: NOW - 3600_000,
    expiresAt: NOW + 3600_000,
    autoExtend: false,
    accountStatus: 'active',
    ...partial,
  } as Address;
}

function makeSetters() {
  const toasts: unknown[] = [];
  let reactive: Address[] = [];
  const loadSkips: (boolean | undefined)[] = [];
  const setters = {
    setSelectedEmail: () => {},
    setEmails: () => {},
    setLoading: () => {},
    setDropdownOpen: () => {},
    setShowToast: (t: unknown) => toasts.push(t),
    loadAddresses: async (skip?: boolean) => {
      loadSkips.push(skip);
    },
    setAllAddresses: (v: Address[] | ((prev: Address[]) => Address[])) => {
      reactive = typeof v === 'function' ? v(reactive) : v;
    },
    setReactive: (list: Address[]) => {
      reactive = [...list];
    },
  };
  return {
    toasts,
    loadSkips,
    getReactive: () => reactive,
    setters: setters as ManagementSetters & {
      setReactive: (list: Address[]) => void;
    },
  };
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  for (const k of Object.keys(sessionStore)) delete sessionStore[k];
  setCalls = [];
});

describe('applyAutoRenewToAll', () => {
  test('explicitly enables live, expired, and archived addresses, while skipping deleted', async () => {
    const records = [
      addr({ id: 'live-off' }),
      addr({ id: 'live-on', autoExtend: true }),
      addr({
        id: 'archived',
        accountStatus: 'archived',
        archiveReason: 'manual',
        archivedAt: NOW - 5000,
        unarchiveAfterRenewal: false,
      }),
      addr({ id: 'deleted', accountStatus: 'deleted' }),
      addr({ id: 'expired', expiresAt: NOW - 1000 }),
    ];
    store.addresses = records;
    const ctx = makeSetters();
    ctx.setters.setReactive(records);

    const changed = await applyAutoRenewToAll(true, ctx.setters);

    expect(changed).toBe(3);
    const saved = store.addresses as Address[];
    const byId = Object.fromEntries(saved.map((a) => [a.id, a]));
    expect(byId['live-off'].autoExtend).toBe(true);
    expect(byId['live-on'].autoExtend).toBe(true);
    expect(byId.archived.autoExtend).toBe(true);
    expect(byId.archived.accountStatus).toBe('archived');
    expect(byId.archived.archiveReason).toBe('manual');
    expect(byId.archived.archivedAt).toBe(NOW - 5000);
    expect(byId.archived.unarchiveAfterRenewal).toBe(false);
    expect(byId.deleted.autoExtend).toBe(false);
    // Time-expired but not archived: re-armed so the expiry engine renews it.
    expect(byId.expired.autoExtend).toBe(true);
    // Reactive mirror matches storage.
    const reactiveById = Object.fromEntries(ctx.getReactive().map((a) => [a.id, a]));
    expect(reactiveById['live-off'].autoExtend).toBe(true);
    expect(reactiveById.archived.autoExtend).toBe(true);
    // Reload skips email reselection (toggle-pattern parity).
    expect(ctx.loadSkips).toEqual([true]);
    expect(ctx.toasts).toHaveLength(1);
  });

  test('disabling stops renewal for live and re-armed archived addresses', async () => {
    const records = [
      addr({ id: 'live', autoExtend: true }),
      addr({ id: 'archived', accountStatus: 'archived', autoExtend: true }),
    ];
    store.addresses = records;
    const ctx = makeSetters();
    ctx.setters.setReactive(records);

    const changed = await applyAutoRenewToAll(false, ctx.setters);

    expect(changed).toBe(2);
    const byId = Object.fromEntries((store.addresses as Address[]).map((a) => [a.id, a]));
    expect(byId.live.autoExtend).toBe(false);
    expect(byId.archived.autoExtend).toBe(false);
    expect(byId.archived.accountStatus).toBe('archived');
  });

  test('disabling also clears the renewal-failure streak it invalidates', async () => {
    // Turning auto-renew off makes the stored backoff describe a retry that
    // will never happen: the "retrying in X" banner reads the streak, and a
    // stale nextRetryAt would delay the first renewal of a later re-enable.
    const records = [
      addr({
        id: 'live',
        autoExtend: true,
        renewalFailCount: 3,
        lastFailureAt: NOW - 1000,
        nextRetryAt: NOW + 10 * 60 * 1000,
      }),
    ];
    store.addresses = records;
    const ctx = makeSetters();
    ctx.setters.setReactive(records);

    await applyAutoRenewToAll(false, ctx.setters);

    const live = (store.addresses as Address[])[0];
    expect(live.autoExtend).toBe(false);
    expect(live.renewalFailCount).toBe(0);
    expect(live.lastFailureAt).toBeUndefined();
    expect(live.nextRetryAt).toBeUndefined();
  });

  test('explicit re-enable clears obsolete failure state so renewal can start immediately', async () => {
    const records = [
      addr({
        id: 'live',
        autoExtend: false,
        renewalFailCount: 2,
        lastFailureAt: NOW - 1000,
        nextRetryAt: NOW + 5 * 60 * 1000,
      }),
    ];
    store.addresses = records;
    const ctx = makeSetters();
    ctx.setters.setReactive(records);

    await applyAutoRenewToAll(true, ctx.setters);

    const live = (store.addresses as Address[])[0];
    expect(live.autoExtend).toBe(true);
    expect(live.renewalFailCount).toBe(0);
    expect(live.lastFailureAt).toBeUndefined();
    expect(live.nextRetryAt).toBeUndefined();
  });

  test('returns 0 without writing when every address already matches', async () => {
    const records = [addr({ id: 'live', autoExtend: true })];
    store.addresses = records;
    const ctx = makeSetters();
    ctx.setters.setReactive(records);
    const writesBefore = setCalls.length;

    const changed = await applyAutoRenewToAll(true, ctx.setters);

    expect(changed).toBe(0);
    expect(setCalls.length).toBe(writesBefore);
  });
});

describe('saveSettings autoRenewScope (Firefox DataCloneError regression)', () => {
  test('persists the scope and emits a structured-clone-safe blob', async () => {
    const ctxToasts: unknown[] = [];
    const state = {
      autoCopy: false,
      autoRenew: true,
      autoRenewScope: 'all',
      autoRenewWindowMinutes: 10,
      selectedProvider: 'guerrilla',
      customColor: '',
      showDeveloperSettings: false,
      enableLogging: false,
      emailRetentionDays: 30,
      faviconCaching: 'local',
      notificationsEnabled: true,
      soundEnabled: true,
      expiryWarningThreshold: 3600000,
      keybindings: DEFAULT_KEYBINDINGS,
      autoRefreshInterval: 30000,
      emailPreviewEnabled: true,
      defaultDomain: '',
    };
    const setters = {
      setSavingSettings: () => {},
      setShowToast: (t: unknown) => ctxToasts.push(t),
    };

    await saveSettings(fakeBrowser as never, state as never, setters as never);

    expect(store.autoRenewScope).toBe('all');
    const blob = setCalls[0] as Record<string, unknown>;
    expect(blob.autoRenewScope).toBe('all');
    // The exact failure seen on Firefox: storage.local.set rejected the Svelte
    // $state Proxy. structuredClone is the same algorithm - it must not throw.
    expect(() => structuredClone(blob)).not.toThrow();
    expect(ctxToasts).toHaveLength(1);
  });
});
