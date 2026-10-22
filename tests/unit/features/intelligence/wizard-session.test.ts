import { afterAll, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// wizard-session.ts stores in storage.session with a storage.local fallback
// and imports wxt/browser transitively (via ./storage.js).
const store: Record<string, unknown> = {};
mock.module('wxt/browser', () => ({
  browser: {
    storage: {
      session: {
        get: async (keys?: string | string[]) => {
          if (keys == null) return { ...store };
          const arr = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of arr) if (k in store) out[k] = store[k];
          return out;
        },
        set: async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        },
      },
      local: {
        get: async () => ({}),
        set: async () => {},
      },
    },
  },
}));

const { upsertWizardSession, getWizardSession, advanceWizardStep, clearWizardSession } =
  await import('@/features/intelligence/wizard-session.js');

describe('tab-scoped wizard sessions', () => {
  test('two tabs on the same domain do not overwrite each other', async () => {
    await upsertWizardSession({ domain: 'example.com', tabId: 1, step: 'otp', email: 'a@x.com' });
    await upsertWizardSession({ domain: 'example.com', tabId: 2, step: 'form', email: 'b@x.com' });

    const tab1 = await getWizardSession('example.com', 1);
    const tab2 = await getWizardSession('example.com', 2);
    expect(tab1?.step).toBe('otp');
    expect(tab1?.email).toBe('a@x.com');
    expect(tab2?.step).toBe('form');
    expect(tab2?.email).toBe('b@x.com');
  });

  test('concurrent writes preserve sessions for different domains', async () => {
    await Promise.all([
      upsertWizardSession({ domain: 'first.example', tabId: 11, step: 'otp' }),
      upsertWizardSession({ domain: 'second.example', tabId: 22, step: 'profile' }),
    ]);

    expect((await getWizardSession('first.example', 11))?.step).toBe('otp');
    expect((await getWizardSession('second.example', 22))?.step).toBe('profile');
  });

  test('getWizardSession without a tab returns the most recently updated session', async () => {
    await new Promise((r) => setTimeout(r, 5));
    await advanceWizardStep('example.com', 'profile', {}, 2);
    const latest = await getWizardSession('example.com');
    expect(latest?.tabId).toBe(2);
    expect(latest?.step).toBe('profile');
  });

  test('clearing one tab leaves the other tab’s session intact', async () => {
    await clearWizardSession('example.com', 1);
    expect(await getWizardSession('example.com', 1)).toBeNull();
    expect((await getWizardSession('example.com', 2))?.tabId).toBe(2);
  });

  test('shared (tab-less) sessions still work via the legacy key', async () => {
    await upsertWizardSession({ domain: 'legacy.com', step: 'otp' });
    const s = await getWizardSession('legacy.com');
    expect(s?.step).toBe('otp');
    expect(s?.tabId).toBeUndefined();
  });
});
