/**
 * `notificationSettings` is a whole-key record with one reader (the background's
 * notification gate / expiry warnings) and one writer (the UI toggle) - which is
 * exactly the shape that loses a write: the toggle read the record, rebuilt it
 * from what it read, and wrote the whole thing back, so a sound preference or
 * expiry threshold changed in between was silently reverted.
 *
 * Two halves are pinned here:
 *  - the parser the writer and the reader now share (`parseNotificationSettings`)
 *    never turns a corrupt field into a silent "notifications off";
 *  - the toggle patches ONLY `enabled` against what storage holds when it runs,
 *    so a concurrent change to the same record survives.
 */

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});

const store: Record<string, unknown> = {};
/** Read delay per key, so a test can interleave two writers of one key. */
const getDelayMs: Record<string, number> = {};

const fakeBrowser = {
  runtime: { id: 'test-extension', sendMessage: async () => ({}) },
  storage: {
    local: {
      get: async (keys: string | string[]) => {
        const list = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const key of list) {
          const delay = getDelayMs[key] ?? 0;
          if (delay > 0) await new Promise((r) => setTimeout(r, delay));
          if (key in store) out[key] = store[key];
        }
        return out;
      },
      set: async (items: Record<string, unknown>) => Object.assign(store, items),
      remove: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
      },
    },
  },
};

mock.module('wxt/browser', () => ({ browser: fakeBrowser }));
Object.assign(globalThis, { browser: fakeBrowser });

const { __clearStoredObjectChainsForTests, parseNumberRecord, updateStoredObject } = await import(
  '@/utils/storage/rmw.js'
);
const { parseNotificationSettings, DEFAULT_NOTIFICATION_SETTINGS } = await import(
  '@/utils/storage/storage-keys.js'
);
const { toggleNotifications } = await import('@/features/address/address-actions.js');

const setters = {
  setNotificationsEnabled: () => {},
  setShowToast: () => {},
} as unknown as import('@/features/address/address-actions.js').AddressSetters;

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  for (const k of Object.keys(getDelayMs)) delete getDelayMs[k];
  __clearStoredObjectChainsForTests();
});

describe('parseNotificationSettings', () => {
  test('an absent or non-record value falls back to the defaults', () => {
    expect(parseNotificationSettings(undefined)).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    expect(parseNotificationSettings(null)).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    expect(parseNotificationSettings('nope')).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    expect(parseNotificationSettings([1, 2])).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
  });

  test('stored fields win; wrong-typed ones fall back rather than disable notifications', () => {
    expect(
      parseNotificationSettings({
        enabled: false,
        soundEnabled: 'yes',
        expiryWarningThreshold: 1234,
      })
    ).toEqual({
      enabled: false,
      soundEnabled: DEFAULT_NOTIFICATION_SETTINGS.soundEnabled,
      expiryWarningThreshold: 1234,
    });
    // A NaN threshold would make every expiry comparison false - the warning
    // would never fire. The default keeps it meaningful.
    expect(parseNotificationSettings({ expiryWarningThreshold: Number.NaN })).toEqual(
      DEFAULT_NOTIFICATION_SETTINGS
    );
  });
});

describe('toggleNotifications is a serialized read-modify-write', () => {
  test('patches only `enabled`; a concurrent sound change survives', async () => {
    store.notificationSettings = {
      enabled: true,
      soundEnabled: true,
      expiryWarningThreshold: 1234,
    };
    getDelayMs.notificationSettings = 25;

    const [, finalRecord] = await Promise.all([
      toggleNotifications(true, setters),
      updateStoredObject(
        'notificationSettings',
        (current) => ({ ...current, soundEnabled: false }),
        parseNotificationSettings
      ),
    ]);

    // The toggle wrote `enabled: false` over the record the sound change landed
    // in - both edits are present, and neither field the toggle never touched
    // was rebuilt from its stale read.
    expect(store.notificationSettings).toEqual({
      enabled: false,
      soundEnabled: false,
      expiryWarningThreshold: 1234,
    });
    expect(finalRecord.soundEnabled).toBe(false);
  });

  test('materializes the defaults on a fresh install, keeping the toggled field', async () => {
    await toggleNotifications(true, setters);
    expect(store.notificationSettings).toEqual({
      enabled: false,
      soundEnabled: DEFAULT_NOTIFICATION_SETTINGS.soundEnabled,
      expiryWarningThreshold: DEFAULT_NOTIFICATION_SETTINGS.expiryWarningThreshold,
    });
  });

  test('parseNumberRecord is the shape guard the snooze map is read through', () => {
    expect(parseNumberRecord({ 'a@x.test': 1 })).toEqual({ 'a@x.test': 1 });
    expect(parseNumberRecord({ 'a@x.test': 'later' })).toEqual({});
  });
});
