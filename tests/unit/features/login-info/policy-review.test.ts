import { afterAll, beforeEach, expect, mock, test } from 'bun:test';

afterAll(() => mock.restore());
const store: Record<string, unknown> = {};
const browser = {
  runtime: { id: 'test-extension' },
  storage: {
    local: {
      get: async (key: string) => ({ [key]: structuredClone(store[key]) }),
      set: async (items: Record<string, unknown>) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        Object.assign(store, items);
      },
    },
  },
};
mock.module('wxt/browser', () => ({ browser }));
mock.module('@/utils/logger.js', () => ({ logError: () => {}, logWarn: () => {} }));
const { setPolicyReviewed } = await import('@/features/login-info/policy-review.js');
beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

test('concurrent review changes preserve each other and existing entries', async () => {
  store.policyReviewedMap = { existing: true, invalid: 'true' };
  await Promise.all([setPolicyReviewed('first', true), setPolicyReviewed('second', true)]);
  expect(store.policyReviewedMap).toEqual({ existing: true, first: true, second: true });
  await setPolicyReviewed('first', false);
  expect(store.policyReviewedMap).toEqual({ existing: true, first: false, second: true });
});

test('a corrupt map is repaired without spreading array or string entries', async () => {
  for (const invalid of [null, 'broken', [true]]) {
    store.policyReviewedMap = invalid;
    await setPolicyReviewed('one', true);
    expect(store.policyReviewedMap).toEqual({ one: true });
  }
});
