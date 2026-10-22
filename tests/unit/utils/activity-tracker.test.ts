import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { activityDay } from '@/utils/activity/activity-history.js';

afterAll(() => {
  mock.restore();
});
const store: Record<string, unknown> = {};
const area = {
  get: async (keys: string | string[]) =>
    Object.fromEntries(
      (Array.isArray(keys) ? keys : [keys])
        .filter((key) => key in store)
        .map((key) => [key, structuredClone(store[key])])
    ),
  set: async (patch: Record<string, unknown>) => {
    Object.assign(store, structuredClone(patch));
  },
  remove: async (keys: string | string[]) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
  },
};
const fake = { runtime: { id: 'activity-test' }, storage: { local: area } };
mock.module('wxt/browser', () => ({ browser: fake }));
const { addActivityEvent, clearActivityEvents, getActivitySnapshot } = await import(
  '@/utils/activity/activity-tracker.js'
);
beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

test('first read migrates retained details exactly once', async () => {
  store.activityEvents = [
    { id: 'legacy', type: 'account_created', timestamp: Date.now(), data: {} },
  ];
  const first = await getActivitySnapshot();
  const second = await getActivitySnapshot();
  expect(first).toEqual(second);
  expect(first.history.days[0].counts.address_created).toBe(1);
  expect(first.events[0].type).toBe('address_created');
});
test('concurrent writers retain every daily count while bounding details to 100', async () => {
  await Promise.all(
    Array.from({ length: 125 }, () =>
      addActivityEvent('email_received', { address: 'a@example.test' })
    )
  );
  const snapshot = await getActivitySnapshot();
  expect(snapshot.events).toHaveLength(100);
  expect(
    snapshot.history.days.find((day) => day.day === activityDay(Date.now()))?.counts.email_received
  ).toBe(125);
});
test('reset removes details and summaries together, preserving dashboard preferences', async () => {
  await addActivityEvent('hard_reset', {});
  store.activityDashboard = [{ id: 'sites', visible: false }];
  await clearActivityEvents();
  expect(store.activityEvents).toBeUndefined();
  expect(store.activityDailyHistory).toBeUndefined();
  expect(store.activityDashboard).toEqual([{ id: 'sites', visible: false }]);
  expect((await getActivitySnapshot()).history.days).toEqual([]);
});
