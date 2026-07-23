/**
 * Activity event tracking for timeline
 */

import { browser } from 'wxt/browser';
import { withLock } from '@/utils/mutex.js';
import { randomToken } from '@/utils/secure-random.js';
import type { ActivityEvent, ActivityEventType } from '@/utils/types.js';

const MAX_ACTIVITY_EVENTS = 100;

export async function getActivityEvents(): Promise<ActivityEvent[]> {
  const result = (await browser.storage.local.get(['activityEvents'])) as {
    activityEvents?: ActivityEvent[];
  };
  return result.activityEvents || [];
}

export async function addActivityEvent(
  type: ActivityEventType,
  data: ActivityEvent['data']
): Promise<void> {
  await withLock('activity_events_lock', async () => {
    const events = await getActivityEvents();
    const newEvent: ActivityEvent = {
      id: `${type}_${Date.now()}_${randomToken(9)}`,
      type,
      timestamp: Date.now(),
      data,
    };

    // Add new event at the beginning
    events.unshift(newEvent);

    // Keep only the most recent events
    if (events.length > MAX_ACTIVITY_EVENTS) {
      events.splice(MAX_ACTIVITY_EVENTS);
    }

    await browser.storage.local.set({ activityEvents: events });
  });
}

export async function clearActivityEvents(): Promise<void> {
  await browser.storage.local.remove(['activityEvents']);
}

export async function addToastNotification(
  message: string,
  toastType: 'success' | 'error' | 'warning' | 'info'
): Promise<void> {
  await addActivityEvent('toast_notification', {
    message,
    toastType,
  });
}

export async function addAutoExtendEvent(inboxAddress: string, provider?: string): Promise<void> {
  await addActivityEvent('auto_extend', {
    inboxAddress,
    ...(provider && { provider }),
  });
}

export async function addHardResetEvent(): Promise<void> {
  await addActivityEvent('hard_reset', {});
}
