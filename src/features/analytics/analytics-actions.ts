import { logError, logWarn } from '@/utils/logger.js';
import { DEFAULT_ANALYTICS } from '@/utils/storage/storage-keys.js';
import type { PerformanceSummary, StorageTrendPoint } from '@/utils/types.js';

export interface AnalyticsData {
  createdAt: string | number | undefined;
  accountsCreated: number;
  emailsReceived: number;
  otpsDetected: number;
  notificationsSent: number;
  extensionOpens?: number;
  emailsRead?: number;
  pageVisits?: Record<string, number>;
  /** Sampled storage footprint history (persisted in the background). */
  storageTrend?: StorageTrendPoint[];
  performance?: {
    emailFetchTimes: number[];
    providerLatency: Record<string, number[]>;
    uiRenderTimes: number[];
  };
  /** Derived averages from the background (getAnalytics response); never persisted. */
  performanceSummary?: PerformanceSummary;
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
  state: AnalyticsState,
  setters: AnalyticsSetters
) {
  // Background samples and dialog-visit tracking refresh this data frequently.
  // Once loaded, retain the view and its focused controls during refreshes.
  const showLoading = state.analytics.createdAt === undefined;
  try {
    if (showLoading) setters.setAnalyticsLoading(true);
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
        storageTrend: Array.isArray(loaded.storageTrend) ? loaded.storageTrend : [],
        performance: {
          emailFetchTimes: loaded.performance?.emailFetchTimes || [],
          providerLatency: loaded.performance?.providerLatency || {},
          uiRenderTimes: loaded.performance?.uiRenderTimes || [],
        },
        performanceSummary: response.performanceSummary,
      };
      setters.setAnalytics(normalized);
    }
  } catch (e: unknown) {
    logError('loadAnalytics error:', undefined, e instanceof Error ? e : new Error(String(e)));
  } finally {
    if (showLoading) setters.setAnalyticsLoading(false);
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
        storageTrend: [],
        performance: {
          emailFetchTimes: [],
          providerLatency: {},
          uiRenderTimes: [],
        },
      };
      setters.setAnalytics(resetData);
    } else {
      // success:false - the reset did NOT happen; leave the data untouched and
      // leave a trace instead of looking like a no-op.
      logWarn('resetAnalytics rejected by background', {
        error: (response as { error?: unknown } | undefined)?.error,
      });
    }
  } catch (e: unknown) {
    logError('resetAnalytics error:', undefined, e instanceof Error ? e : new Error(String(e)));
  }
}
