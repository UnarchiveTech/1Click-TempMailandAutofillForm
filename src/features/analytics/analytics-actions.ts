import type { Browser } from 'wxt/browser';
import { logError } from '@/utils/logger.js';

export interface AnalyticsData {
  createdAt: string | number | undefined;
  accountsCreated: number;
  emailsReceived: number;
  otpsDetected: number;
  notificationsSent: number;
  performance?: {
    emailFetchTimes: number[];
    providerLatency: Record<string, number[]>;
    uiRenderTimes: number[];
  };
}

export interface AnalyticsState {
  analytics: AnalyticsData;
  analyticsLoading: boolean;
}

export interface AnalyticsSetters {
  setAnalytics: (analytics: AnalyticsData) => void;
  setAnalyticsLoading: (loading: boolean) => void;
}

export async function loadAnalytics(
  ext: Browser,
  _state: AnalyticsState,
  setters: AnalyticsSetters
) {
  try {
    setters.setAnalyticsLoading(true);
    const response = await ext.runtime.sendMessage({ type: 'getAnalytics' });
    if (response?.success && response.analytics) {
      setters.setAnalytics(response.analytics);
    }
  } catch (e: unknown) {
    logError('loadAnalytics error:', undefined, e instanceof Error ? e : new Error(String(e)));
  } finally {
    setters.setAnalyticsLoading(false);
  }
}

export async function resetAnalytics(
  ext: Browser,
  _state: AnalyticsState,
  setters: AnalyticsSetters
) {
  try {
    const resetData: AnalyticsData = {
      createdAt: Date.now(),
      accountsCreated: 0,
      emailsReceived: 0,
      otpsDetected: 0,
      notificationsSent: 0,
      performance: {
        emailFetchTimes: [],
        providerLatency: {},
        uiRenderTimes: [],
      },
    };
    await ext.storage.local.set({ analytics: resetData });
    setters.setAnalytics(resetData);
  } catch (e: unknown) {
    logError('resetAnalytics error:', undefined, e instanceof Error ? e : new Error(String(e)));
  }
}
