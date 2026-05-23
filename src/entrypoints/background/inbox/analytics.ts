/**
 * Analytics management for the extension
 */

import { browser } from 'wxt/browser';
import { log, logError } from '@/utils/logger.js';
import type { Analytics } from '@/utils/types.js';

export async function initializeAnalytics(): Promise<void> {
  try {
    const {
      analytics = {
        accountsCreated: 0,
        emailsReceived: 0,
        otpsDetected: 0,
        notificationsSent: 0,
        performance: {
          emailFetchTimes: [],
          providerLatency: {},
          uiRenderTimes: [],
        },
      },
    }: { analytics: Analytics } = (await browser.storage.local.get(['analytics'])) as {
      analytics: Analytics;
    };
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
      await browser.storage.local.set({ analytics });
      log('Analytics initialized:', analytics);
    }
  } catch (error: unknown) {
    logError('Error initializing analytics:', error);
  }
}

export async function incrementAnalytic(key: keyof Analytics): Promise<void> {
  try {
    const {
      analytics = {
        accountsCreated: 0,
        emailsReceived: 0,
        otpsDetected: 0,
        notificationsSent: 0,
      },
    }: { analytics: Analytics } = (await browser.storage.local.get(['analytics'])) as {
      analytics: Analytics;
    };
    (analytics[key] as number) = ((analytics[key] as number) || 0) + 1;
    await browser.storage.local.set({ analytics });
  } catch (error: unknown) {
    logError('Error updating analytics:', error);
  }
}

export async function getAnalytics(): Promise<Analytics> {
  const {
    analytics = {
      accountsCreated: 0,
      emailsReceived: 0,
      otpsDetected: 0,
      notificationsSent: 0,
      performance: {
        emailFetchTimes: [],
        providerLatency: {},
        uiRenderTimes: [],
      },
    },
  } = (await browser.storage.local.get(['analytics'])) as {
    analytics?: Analytics;
  };
  return analytics;
}

/**
 * Records an email fetch time in milliseconds
 * @param fetchTime - Time taken to fetch emails in milliseconds
 */
export async function recordEmailFetchTime(fetchTime: number): Promise<void> {
  try {
    const {
      analytics = {
        accountsCreated: 0,
        emailsReceived: 0,
        otpsDetected: 0,
        notificationsSent: 0,
        performance: {
          emailFetchTimes: [],
          providerLatency: {},
          uiRenderTimes: [],
        },
      },
    }: { analytics: Analytics } = (await browser.storage.local.get(['analytics'])) as {
      analytics: Analytics;
    };

    if (!analytics.performance) {
      analytics.performance = {
        emailFetchTimes: [],
        providerLatency: {},
        uiRenderTimes: [],
      };
    }

    // Keep only last 100 fetch times to avoid storage bloat
    analytics.performance.emailFetchTimes.push(fetchTime);
    if (analytics.performance.emailFetchTimes.length > 100) {
      analytics.performance.emailFetchTimes.shift();
    }

    await browser.storage.local.set({ analytics });
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
    const {
      analytics = {
        accountsCreated: 0,
        emailsReceived: 0,
        otpsDetected: 0,
        notificationsSent: 0,
        performance: {
          emailFetchTimes: [],
          providerLatency: {},
          uiRenderTimes: [],
        },
      },
    }: { analytics: Analytics } = (await browser.storage.local.get(['analytics'])) as {
      analytics: Analytics;
    };

    if (!analytics.performance) {
      analytics.performance = {
        emailFetchTimes: [],
        providerLatency: {},
        uiRenderTimes: [],
      };
    }

    if (!analytics.performance.providerLatency[provider]) {
      analytics.performance.providerLatency[provider] = [];
    }

    // Keep only last 50 latency measurements per provider
    analytics.performance.providerLatency[provider].push(latency);
    if (analytics.performance.providerLatency[provider].length > 50) {
      analytics.performance.providerLatency[provider].shift();
    }

    await browser.storage.local.set({ analytics });
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
    const {
      analytics = {
        accountsCreated: 0,
        emailsReceived: 0,
        otpsDetected: 0,
        notificationsSent: 0,
        performance: {
          emailFetchTimes: [],
          providerLatency: {},
          uiRenderTimes: [],
        },
      },
    }: { analytics: Analytics } = (await browser.storage.local.get(['analytics'])) as {
      analytics: Analytics;
    };

    if (!analytics.performance) {
      analytics.performance = {
        emailFetchTimes: [],
        providerLatency: {},
        uiRenderTimes: [],
      };
    }

    // Keep only last 50 render times to avoid storage bloat
    analytics.performance.uiRenderTimes.push(renderTime);
    if (analytics.performance.uiRenderTimes.length > 50) {
      analytics.performance.uiRenderTimes.shift();
    }

    await browser.storage.local.set({ analytics });
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
  const performance = analytics.performance || {
    emailFetchTimes: [],
    providerLatency: {},
    uiRenderTimes: [],
  };

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
