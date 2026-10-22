import { afterAll, expect, mock, test } from 'bun:test';
import type { AnalyticsSetters, AnalyticsState } from '@/features/analytics/analytics-actions.js';

afterAll(() => mock.restore());
mock.module('@/utils/logger.js', () => ({
  logError: () => {},
  logWarn: () => {},
  logInfo: () => {},
  logDebug: () => {},
  log: () => {},
}));
const { loadAnalytics } = await import('@/features/analytics/analytics-actions.js');

test('initial analytics show loading; subsequent background refreshes preserve the mounted view', async () => {
  const state: AnalyticsState = {
    analytics: {
      createdAt: undefined,
      accountsCreated: 0,
      emailsReceived: 0,
      otpsDetected: 0,
      notificationsSent: 0,
    },
    analyticsLoading: false,
  };
  const loadingStates: boolean[] = [];
  const setters: AnalyticsSetters = {
    setAnalytics: (analytics) => {
      state.analytics = analytics;
    },
    setAnalyticsLoading: (loading) => {
      state.analyticsLoading = loading;
      loadingStates.push(loading);
    },
  };
  let received = 1;
  const ext = {
    runtime: {
      sendMessage: async () => ({
        success: true,
        analytics: { createdAt: 123, emailsReceived: received },
      }),
    },
  } as unknown as Browser;
  await loadAnalytics(ext, state, setters);
  expect(loadingStates).toEqual([true, false]);
  expect(state.analytics.emailsReceived).toBe(1);
  loadingStates.length = 0;
  received = 2;
  await loadAnalytics(ext, state, setters);
  expect(loadingStates).toEqual([]);
  expect(state.analytics.emailsReceived).toBe(2);
});
