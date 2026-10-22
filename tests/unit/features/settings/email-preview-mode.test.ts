import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

/**
 * `emailPreviewMode` settings round-trip.
 *
 * The mailbox list can preview a hovered message either as a floating tooltip
 * card (legacy behavior, default) or by expanding the row in place. The mode
 * is stored in `browser.storage.local.emailPreviewMode`, saved by
 * `saveSettings` and loaded by `loadSettings` - this pins the round-trip and
 * the clamp-to-default behavior for stale/corrupt values.
 */

import { defaultDomainKey } from '@/utils/storage/storage-keys.js';
import type { EmailPreviewMode } from '@/utils/types.js';
import { DEFAULT_KEYBINDINGS } from '@/utils/types.js';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});

const store: Record<string, unknown> = {};

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
        Object.assign(store, items);
      },
      remove: async () => {},
    },
  },
  alarms: { create: async () => {}, clear: async () => {} },
};

// Only `wxt/browser` is mocked - the real settings-actions and i18n (English
// fallback) modules stay intact.
mock.module('wxt/browser', () => ({ browser: fakeBrowser }));
Object.assign(globalThis, { browser: fakeBrowser });

const { loadSettings, saveSettings } = await import('@/features/settings/settings-actions.js');

function makeHarness() {
  const state: Record<string, unknown> = {};
  const setters = new Proxy(
    {},
    {
      get: (_t, prop: string) => {
        if (prop === 'setShowToast') return () => {};
        if (prop === 'loadAddresses') return async () => {};
        return (value: unknown) => {
          // setEmailPreviewMode -> emailPreviewMode
          state[prop.replace(/^set/, '').replace(/^./, (c) => c.toLowerCase())] = value;
        };
      },
    }
  );
  return { state, setters: setters as Parameters<typeof loadSettings>[2] };
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

describe('emailPreviewMode setting', () => {
  test('saveSettings persists the selected mode', async () => {
    const { state, setters } = makeHarness();
    state.emailPreviewMode = 'expanded';
    // Minimal state for the save path; unrelated keys are asserted below.
    await saveSettings(
      fakeBrowser as unknown as typeof browser,
      {
        autoCopy: false,
        autoRenew: false,
        autoRenewScope: 'ask',
        autoRenewWindowMinutes: 10,
        selectedProvider: 'guerrilla',
        providerInstances: [],
        selectedProviderInstance: null,
        customColor: '',
        globalZoomEnabled: false,
        showDeveloperSettings: false,
        enableLogging: false,
        savingSettings: false,
        settingsLoading: false,
        emailRetentionDays: 30,
        faviconCaching: 'local',
        notificationsEnabled: true,
        soundEnabled: true,
        expiryWarningThreshold: 3_600_000,
        keybindings: DEFAULT_KEYBINDINGS,
        autoRefreshInterval: 30_000,
        emailPreviewMode: 'expanded',
        defaultDomain: '',
      } as Parameters<typeof saveSettings>[1],
      setters
    );
    expect(store.emailPreviewMode).toBe('expanded');
  });

  test('saveSettings persists clearing the provider default domain', async () => {
    const { setters } = makeHarness();
    const key = defaultDomainKey('guerrilla');
    store[key] = 'old.example';
    await saveSettings(
      fakeBrowser as unknown as typeof browser,
      {
        autoCopy: false,
        autoRenew: false,
        autoRenewScope: 'ask',
        autoRenewWindowMinutes: 10,
        selectedProvider: 'guerrilla',
        providerInstances: [],
        selectedProviderInstance: null,
        customColor: '',
        globalZoomEnabled: false,
        showDeveloperSettings: false,
        enableLogging: false,
        savingSettings: false,
        settingsLoading: false,
        emailRetentionDays: 30,
        faviconCaching: 'local',
        notificationsEnabled: true,
        soundEnabled: true,
        expiryWarningThreshold: 3_600_000,
        keybindings: DEFAULT_KEYBINDINGS,
        autoRefreshInterval: 30_000,
        emailPreviewMode: 'tooltip',
        defaultDomain: '',
      } as Parameters<typeof saveSettings>[1],
      setters
    );

    expect(store[key]).toBe('');
  });

  test('loadSettings round-trips an expanded preference', async () => {
    store.emailPreviewMode = 'expanded';
    const { state, setters } = makeHarness();
    await loadSettings(fakeBrowser as unknown as typeof browser, {} as never, setters);
    expect(state.emailPreviewMode).toBe<EmailPreviewMode>('expanded');
  });

  test('loadSettings clamps stale/corrupt values to the tooltip default', async () => {
    // A stale value from an older experimental build.
    store.emailPreviewMode = 'inline-mega';
    const { state, setters } = makeHarness();
    await loadSettings(fakeBrowser as unknown as typeof browser, {} as never, setters);
    expect(state.emailPreviewMode).toBe<EmailPreviewMode>('tooltip');
  });

  test('loadSettings defaults global zoom to disabled', async () => {
    const { state, setters } = makeHarness();
    await loadSettings(fakeBrowser as unknown as typeof browser, {} as never, setters);
    expect(state.globalZoomEnabled).toBe(false);
  });

  test('loadSettings restores enabled global zoom', async () => {
    store.globalZoomEnabled = true;
    const { state, setters } = makeHarness();
    await loadSettings(fakeBrowser as unknown as typeof browser, {} as never, setters);
    expect(state.globalZoomEnabled).toBe(true);
  });
});
