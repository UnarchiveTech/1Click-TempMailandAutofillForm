import type { Browser } from 'wxt/browser';
import { logError } from '@/utils/logger.js';
import { DEFAULT_ANALYTICS } from '@/utils/storage-keys.js';

export interface AnalyticsData {
  createdAt: string | number | undefined;
  accountsCreated: number;
  emailsReceived: number;
  otpsDetected: number;
  notificationsSent: number;
  extensionOpens?: number;
  emailsRead?: number;
  pageVisits?: Record<string, number>;
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
      const loaded = response.analytics;
      const normalized: AnalyticsData = {
        createdAt: loaded.createdAt || Date.now(),
        accountsCreated: loaded.accountsCreated || 0,
        emailsReceived: loaded.emailsReceived || 0,
        otpsDetected: loaded.otpsDetected || 0,
        notificationsSent: loaded.notificationsSent || 0,
        extensionOpens: loaded.extensionOpens || 0,
        emailsRead: loaded.emailsRead || 0,
        pageVisits: loaded.pageVisits || {},
        performance: {
          emailFetchTimes: loaded.performance?.emailFetchTimes || [],
          providerLatency: loaded.performance?.providerLatency || {},
          uiRenderTimes: loaded.performance?.uiRenderTimes || [],
        },
      };
      setters.setAnalytics(normalized);
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
    const response = await ext.runtime.sendMessage({ type: 'resetAnalytics' });
    if (response?.success) {
      const resetData: AnalyticsData = {
        ...DEFAULT_ANALYTICS,
        createdAt: Date.now(),
        performance: {
          emailFetchTimes: [],
          providerLatency: {},
          uiRenderTimes: [],
        },
      };
      setters.setAnalytics(resetData);
    }
  } catch (e: unknown) {
    logError('resetAnalytics error:', undefined, e instanceof Error ? e : new Error(String(e)));
  }
}
