/**
 * Analytics management for the extension
 */

import { log, logError } from '@/utils/logger.js';
import { withLock } from '@/utils/mutex.js';
import { DEFAULT_ANALYTICS, getAnalyticsRecord, setAnalyticsRecord } from '@/utils/storage-keys.js';
import type { Analytics } from '@/utils/types.js';

export async function initializeAnalytics(): Promise<void> {
  try {
    await withLock('analytics_lock', async () => {
      const analytics = await getAnalyticsRecord();
      if (!analytics.createdAt) {
        analytics.createdAt = Date.now();
        analytics.accountsCreated = 0;
        analytics.emailsReceived = 0;
        analytics.otpsDetected = 0;
        analytics.notificationsSent = 0;
        analytics.performance = {
          emailFetchTimes: [],
          providerLatency: {},
          uiRenderTimes: [],
        };
        await setAnalyticsRecord(analytics);
        log('Analytics initialized:', analytics);
      }
    });
  } catch (error: unknown) {
    logError('Error initializing analytics:', error);
  }
}

export async function incrementAnalytic(key: keyof Analytics): Promise<void> {
  try {
    await withLock('analytics_lock', async () => {
      const analytics = await getAnalyticsRecord();
      (analytics[key] as number) = ((analytics[key] as number) || 0) + 1;
      await setAnalyticsRecord(analytics);
    });
  } catch (error: unknown) {
    logError('Error updating analytics:', error);
  }
}

/** Count a UI surface open (popup / sidepanel / app). */
export async function recordExtensionOpen(): Promise<void> {
  try {
    await withLock('analytics_lock', async () => {
      const analytics = await getAnalyticsRecord();
      analytics.extensionOpens = (analytics.extensionOpens || 0) + 1;
      await setAnalyticsRecord(analytics);
    });
  } catch (error: unknown) {
    logError('Error recording extension open:', error);
  }
}

/** Count a visit to a named view/page. */
export async function recordPageVisit(viewId: string): Promise<void> {
  if (!viewId) return;
  try {
    await withLock('analytics_lock', async () => {
      const analytics = await getAnalyticsRecord();
      if (!analytics.pageVisits) analytics.pageVisits = {};
      analytics.pageVisits[viewId] = (analytics.pageVisits[viewId] || 0) + 1;
      await setAnalyticsRecord(analytics);
    });
  } catch (error: unknown) {
    logError('Error recording page visit:', error);
  }
}

/** Count an email marked read / opened. */
export async function recordEmailRead(): Promise<void> {
  try {
    await withLock('analytics_lock', async () => {
      const analytics = await getAnalyticsRecord();
      analytics.emailsRead = (analytics.emailsRead || 0) + 1;
      await setAnalyticsRecord(analytics);
    });
  } catch (error: unknown) {
    logError('Error recording email read:', error);
  }
}

export async function getAnalytics(): Promise<Analytics> {
  return getAnalyticsRecord();
}

/**
 * Records an email fetch time in milliseconds
 * @param fetchTime - Time taken to fetch emails in milliseconds
 */
export async function recordEmailFetchTime(fetchTime: number): Promise<void> {
  try {
    await withLock('analytics_lock', async () => {
      const analytics = await getAnalyticsRecord();
      if (!analytics.performance) {
        analytics.performance = createDefaultPerformance();
      }

      // Keep only last 100 fetch times to avoid storage bloat
      analytics.performance.emailFetchTimes.push(fetchTime);
      if (analytics.performance.emailFetchTimes.length > 100) {
        analytics.performance.emailFetchTimes.shift();
      }

      await setAnalyticsRecord(analytics);
    });
  } catch (error: unknown) {
    logError('Error recording email fetch time:', error);
  }
}

/**
 * Records provider latency in milliseconds
 * @param provider - The provider ID
 * @param latency - Latency time in milliseconds
 */
export async function recordProviderLatency(provider: string, latency: number): Promise<void> {
  try {
    await withLock('analytics_lock', async () => {
      const analytics = await getAnalyticsRecord();
      if (!analytics.performance) {
        analytics.performance = createDefaultPerformance();
      }

      if (!analytics.performance.providerLatency[provider]) {
        analytics.performance.providerLatency[provider] = [];
      }

      // Keep only last 50 latency measurements per provider
      analytics.performance.providerLatency[provider].push(latency);
      if (analytics.performance.providerLatency[provider].length > 50) {
        analytics.performance.providerLatency[provider].shift();
      }

      await setAnalyticsRecord(analytics);
    });
  } catch (error: unknown) {
    logError('Error recording provider latency:', error);
  }
}

/**
 * Records UI render time in milliseconds
 * @param renderTime - Time taken to render UI in milliseconds
 */
export async function recordUIRenderTime(renderTime: number): Promise<void> {
  try {
    await withLock('analytics_lock', async () => {
      const analytics = await getAnalyticsRecord();
      if (!analytics.performance) {
        analytics.performance = createDefaultPerformance();
      }

      // Keep only last 50 render times to avoid storage bloat
      analytics.performance.uiRenderTimes.push(renderTime);
      if (analytics.performance.uiRenderTimes.length > 50) {
        analytics.performance.uiRenderTimes.shift();
      }

      await setAnalyticsRecord(analytics);
    });
  } catch (error: unknown) {
    logError('Error recording UI render time:', error);
  }
}

/**
 * Calculates average from an array of numbers
 * @param values - Array of numbers
 * @returns Average value or 0 if array is empty
 */
function calculateAverage(values: number[]): number {
  if (!values || values.length === 0) return 0;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

function createDefaultPerformance() {
  const perf = DEFAULT_ANALYTICS.performance;
  if (!perf) {
    return { emailFetchTimes: [], providerLatency: {}, uiRenderTimes: [] };
  }
  return {
    emailFetchTimes: [...perf.emailFetchTimes],
    providerLatency: { ...perf.providerLatency },
    uiRenderTimes: [...perf.uiRenderTimes],
  };
}

/**
 * Gets performance metrics summary
 * @returns Object with average times for each metric
 */
export async function getPerformanceSummary(): Promise<{
  avgEmailFetchTime: number;
  avgProviderLatency: Record<string, number>;
  avgUIRenderTime: number;
}> {
  const analytics = await getAnalytics();
  const performance = analytics.performance || createDefaultPerformance();

  const avgProviderLatency: Record<string, number> = {};
  for (const [provider, latencies] of Object.entries(performance.providerLatency)) {
    avgProviderLatency[provider] = calculateAverage(latencies);
  }

  return {
    avgEmailFetchTime: calculateAverage(performance.emailFetchTimes),
    avgProviderLatency,
    avgUIRenderTime: calculateAverage(performance.uiRenderTimes),
  };
}

export async function resetAnalyticsData(): Promise<void> {
  try {
    await withLock('analytics_lock', async () => {
      const resetData: Analytics = {
        ...DEFAULT_ANALYTICS,
        createdAt: Date.now(),
        performance: {
          emailFetchTimes: [],
          providerLatency: {},
          uiRenderTimes: [],
        },
      };
      await setAnalyticsRecord(resetData);
    });
  } catch (error: unknown) {
    logError('Error resetting analytics:', error);
    throw error;
  }
}
