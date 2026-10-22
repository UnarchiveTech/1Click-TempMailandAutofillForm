/**
 * Unit tests for the shared sync-mirror utility (stored-prefs-sync.ts).
 *
 * This is the anti-flash mechanism generalizing the favicon fix: prefs that
 * gate FIRST-PAINT rendering are mirrored in memory so components read them
 * synchronously instead of popping from defaults after an async storage read.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// In-memory storage mock - same idiom as favicon.test.ts. Dynamic import
// ensures the mock is registered before the module under test loads.
const storageStore: Record<string, unknown> = {};
const onChangedListeners: Array<(c: Record<string, { newValue?: unknown }>, area: string) => void> =
  [];

mock.module('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: async (keys?: string | string[] | null) => {
          if (keys === null || keys === undefined) return { ...storageStore };
          const keyArr = Array.isArray(keys) ? keys : [keys];
          const result: Record<string, unknown> = {};
          for (const k of keyArr) if (k in storageStore) result[k] = storageStore[k];
          return result;
        },
        set: async (items: Record<string, unknown>) => {
          Object.assign(storageStore, items);
        },
        remove: async (keys: string | string[]) => {
          const keyArr = Array.isArray(keys) ? keys : [keys];
          for (const k of keyArr) delete storageStore[k];
        },
      },
      onChanged: {
        addListener: (fn: (c: Record<string, { newValue?: unknown }>, area: string) => void) => {
          onChangedListeners.push(fn);
        },
        removeListener: (fn: (c: Record<string, { newValue?: unknown }>, area: string) => void) => {
          const i = onChangedListeners.indexOf(fn);
          if (i >= 0) onChangedListeners.splice(i, 1);
        },
      },
    },
  },
}));

const {
  __resetStoredPrefsSyncForTests,
  peekStoredBooleanSync,
  peekStoredBooleansSync,
  peekStoredJsonSync,
  reconcileStoredBooleanPref,
  reconcileStoredJsonPref,
  updateStoredJsonMirror,
  warmStoredBooleanPrefs,
  warmStoredJsonPrefs,
} = await import('@/utils/storage/stored-prefs-sync');

function fireOnChanged(key: string, newValue: unknown): void {
  for (const fn of onChangedListeners) fn({ [key]: { newValue } }, 'local');
}

beforeEach(() => {
  for (const k of Object.keys(storageStore)) delete storageStore[k];
  // NOTE: do NOT clear onChangedListeners - the module registered its own
  // listener at import time and that reference must survive across tests.
  __resetStoredPrefsSyncForTests();
});

describe('stored-prefs-sync', () => {
  test('peek returns undefined while cold and after hydration when key is absent', async () => {
    expect(peekStoredBooleanSync('hideLabels')).toBeUndefined();
    await warmStoredBooleanPrefs(['hideLabels']);
    // Absent from storage → still unknown (callers keep their own default).
    expect(peekStoredBooleanSync('hideLabels')).toBeUndefined();
  });

  test('hydrated boolean resolves synchronously (true and false values)', async () => {
    storageStore.hideLabels = true;
    storageStore.showFavicons = false;
    await warmStoredBooleanPrefs(['hideLabels', 'showFavicons']);

    expect(peekStoredBooleanSync('hideLabels')).toBe(true);
    expect(peekStoredBooleanSync('showFavicons')).toBe(false);
  });

  test('absent keys stay unknown inside peekStoredBooleansSync (all-or-nothing)', async () => {
    storageStore.hideLabels = true;
    await warmStoredBooleanPrefs(['hideLabels', 'hideOtpLabels']);

    expect(peekStoredBooleansSync(['hideLabels'])).toEqual({ hideLabels: true });
    expect(peekStoredBooleansSync(['hideLabels', 'hideOtpLabels'])).toBeUndefined();
  });

  test('onChanged keeps the mirror coherent across contexts (set and remove)', async () => {
    storageStore.hideLabels = false;
    await warmStoredBooleanPrefs(['hideLabels']);
    expect(peekStoredBooleanSync('hideLabels')).toBe(false);

    fireOnChanged('hideLabels', true);
    expect(peekStoredBooleanSync('hideLabels')).toBe(true);

    fireOnChanged('hideLabels', undefined);
    // Removal → unknown again, not false.
    expect(peekStoredBooleanSync('hideLabels')).toBeUndefined();
  });

  test('reconcileStoredBooleanPref applies synchronously when warm', async () => {
    storageStore.showSearchSlashIcon = false;
    await warmStoredBooleanPrefs(['showSearchSlashIcon']);

    let applied: boolean | undefined;
    let appliedSync = false;
    const sync = reconcileStoredBooleanPref('showSearchSlashIcon', (v) => {
      applied = v;
      appliedSync = true;
    });

    expect(sync).toBe(true);
    expect(appliedSync).toBe(true);
    expect(applied).toBe(false);
  });

  test('reconcileStoredBooleanPref falls back to async apply when cold', async () => {
    storageStore.voiceSearchEnabled = false;
    let applied: boolean | undefined;
    const sync = reconcileStoredBooleanPref(
      'voiceSearchEnabled',
      (v) => {
        applied = v;
      },
      true
    );

    expect(sync).toBe(false);
    expect(applied).toBeUndefined(); // not applied synchronously
    await new Promise((r) => setTimeout(r, 0));
    expect(applied).toBe(false);
  });

  test('reconcileStoredBooleanPref async path uses fallback for absent keys', async () => {
    let applied: boolean | undefined;
    const sync = reconcileStoredBooleanPref(
      'preferHideOtpStrip',
      (v) => {
        applied = v;
      },
      true
    );
    expect(sync).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(applied).toBe(true);
  });

  test('json mirror round-trips maps and honors updateStoredJsonMirror', async () => {
    const map = { 'a@test.com': Date.now() + 60_000 };
    storageStore.notificationSnoozeByAddress = map;
    await warmStoredJsonPrefs(['notificationSnoozeByAddress']);

    expect(peekStoredJsonSync<Record<string, number>>('notificationSnoozeByAddress')).toEqual(map);

    const next = { ...map, 'b@test.com': Date.now() + 120_000 };
    updateStoredJsonMirror('notificationSnoozeByAddress', next);
    expect(peekStoredJsonSync<Record<string, number>>('notificationSnoozeByAddress')).toEqual(next);

    fireOnChanged('notificationSnoozeByAddress', { 'c@test.com': 1 });
    expect(peekStoredJsonSync<Record<string, number>>('notificationSnoozeByAddress')).toEqual({
      'c@test.com': 1,
    });
  });

  test('reconcileStoredJsonPref applies synchronously when warm', async () => {
    storageStore.notificationSnoozeByAddress = { 'x@test.com': 5 };
    await warmStoredJsonPrefs(['notificationSnoozeByAddress']);
    let applied: Record<string, number> | undefined;
    let called = false;
    const sync = reconcileStoredJsonPref<Record<string, number>>(
      'notificationSnoozeByAddress',
      (v) => {
        called = true;
        applied = v;
      }
    );

    expect(sync).toBe(true);
    expect(called).toBe(true);
    expect(applied).toEqual({ 'x@test.com': 5 });
  });

  test('updateStoredJsonMirror on a cold key does NOT fabricate a value', () => {
    // Writer paths call update* after computing a value; on a cold mirror
    // (never hydrated) it must stay cold so the async path still resolves.
    updateStoredJsonMirror('notificationSnoozeByAddress', {});
    expect(peekStoredJsonSync('notificationSnoozeByAddress')).toBeUndefined();
  });
});
