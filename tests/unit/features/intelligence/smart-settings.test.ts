import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
const store: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};

const fakeBrowser = {
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return { ...store };
        const list = Array.isArray(keys) ? keys : [keys];
        const result: Record<string, unknown> = {};
        for (const key of list) if (key in store) result[key] = store[key];
        return result;
      },
      set: async (items: Record<string, unknown>) => {
        Object.assign(store, items);
      },
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
};

mock.module('wxt/browser', () => ({ browser: fakeBrowser }));
Object.assign(globalThis, { browser: fakeBrowser });

const { initializeSmartAutofillSettings, loadSmartAutofillSettings, saveSmartAutofillSettings } =
  await import('@/features/intelligence/smart-settings.js');

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  for (const key of Object.keys(sessionStore)) delete sessionStore[key];
});

describe('smart autofill settings migration', () => {
  test('fresh installation persists the opt-in false default', async () => {
    const settings = await initializeSmartAutofillSettings('install');

    expect(settings.autoClickSubmitButtons).toBe(false);
    expect(
      (store.smartAutofillSettings as { autoClickSubmitButtons: boolean }).autoClickSubmitButtons
    ).toBe(false);
  });

  test('upgrade never flips auto-submit ON without an explicit stored choice', async () => {
    // autoClickSubmitButtons auto-submits forms - consent-sensitive. An
    // upgraders with no stored choice falls back to the opt-in default
    // (false); it must not inherit the pre-opt-in default of true.
    store.smartAutofillSettings = { humanLikeFilling: false };

    const settings = await initializeSmartAutofillSettings('update');

    expect(settings.humanLikeFilling).toBe(false);
    expect(settings.autoClickSubmitButtons).toBe(false);
    expect((await loadSmartAutofillSettings()).autoClickSubmitButtons).toBe(false);
  });

  test('upgrade preserves an explicit false choice', async () => {
    store.smartAutofillSettings = { autoClickSubmitButtons: false };

    const settings = await initializeSmartAutofillSettings('update');

    expect(settings.autoClickSubmitButtons).toBe(false);
  });

  test('upgrade preserves an explicit true choice', async () => {
    store.smartAutofillSettings = { autoClickSubmitButtons: true };

    const settings = await initializeSmartAutofillSettings('update');

    expect(settings.autoClickSubmitButtons).toBe(true);
  });

  test('save clamps timing bounds to the same absolute caps as load', async () => {
    store.smartAutofillSettings = {
      timingMinMs: 99999,
      timingMaxMs: 99999,
    };

    const saved = await saveSmartAutofillSettings({ timingMinMs: 99999, timingMaxMs: 99999 });

    expect(saved.timingMinMs).toBe(500);
    expect(saved.timingMaxMs).toBe(2000);
    const reloaded = await loadSmartAutofillSettings();
    expect(reloaded.timingMinMs).toBe(500);
    expect(reloaded.timingMaxMs).toBe(2000);

    // min below the floor + max below min+10 → both raised to the floor
    const saved2 = await saveSmartAutofillSettings({ timingMinMs: 1, timingMaxMs: 5 });
    expect(saved2.timingMinMs).toBe(10);
    expect(saved2.timingMaxMs).toBe(20);
  });
});
