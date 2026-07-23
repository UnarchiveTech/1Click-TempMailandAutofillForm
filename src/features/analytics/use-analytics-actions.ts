import type { Browser } from 'wxt/browser';
import {
  type AnalyticsData,
  loadAnalytics as loadAnalyticsAction,
  resetAnalytics as resetAnalyticsAction,
} from '@/features/analytics/analytics-actions.js';

export interface AnalyticsActionsState {
  get analytics(): AnalyticsData;
  get analyticsLoading(): boolean;
}

export interface AnalyticsActionsSetters {
  setAnalytics: (analytics: AnalyticsData) => void;
  setAnalyticsLoading: (loading: boolean) => void;
}

export function useAnalyticsActions(
  ext: Browser,
  state: AnalyticsActionsState,
  setters: AnalyticsActionsSetters
) {
  async function loadAnalytics() {
    await loadAnalyticsAction(
      ext,
      {
        analytics: state.analytics,
        analyticsLoading: state.analyticsLoading,
      },
      setters
    );
  }

  async function resetAnalytics() {
    await resetAnalyticsAction(
      ext,
      {
        analytics: state.analytics,
        analyticsLoading: state.analyticsLoading,
      },
      setters
    );
  }

  return {
    loadAnalytics,
    resetAnalytics,
  };
}
