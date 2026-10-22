/**
 * Activity event tracking for timeline
 */

import { browser } from 'wxt/browser';
import { withLock } from '@/utils/mutex.js';
import { randomToken } from '@/utils/security/secure-random.js';
import type { StorageAreaLike } from '@/utils/storage/storage-repository.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import type { ActivityEvent, ActivityEventType } from '@/utils/types.js';
import {
  ACTIVITY_DETAIL_LIMIT,
  appendActivityHistory,
  parseActivityEvents,
  parseActivityHistory,
  pruneActivityHistory,
  seedActivityHistory,
} from './activity-history.js';

/**
 * Resolve the activity-events storage area at call time, not module scope.
 * A top-level `browser.storage.local` read crashes any bun-test process that
 * transitively imports this module without a wxt/browser mock (e.g. pure
 * crypto suites) - mirrors the lazy getBrowser() idiom in mutex.ts. The live
 * global is preferred so tests that assign `globalThis.browser` after import
 * still resolve their fake; resolve per call so a cached area cannot go stale.
 */
function getActivityArea() {
  const live = (globalThis as unknown as { browser?: { storage?: { local?: StorageAreaLike } } })
    .browser?.storage?.local;
  return live ?? browser.storage.local;
}

export async function getActivitySnapshot() {
  return withLock('activity_events_lock', async () => {
    const area = getActivityArea();
    const stored = await area.get(['activityEvents', 'activityDailyHistory']);
    const events = parseActivityEvents(stored.activityEvents);
    const existing = parseActivityHistory(stored.activityDailyHistory);
    const history = existing ? pruneActivityHistory(existing) : seedActivityHistory(events);
    if (JSON.stringify(existing) !== JSON.stringify(history))
      await writeWithRetry({ activityDailyHistory: history }, { area });
    return { events, history };
  });
}

export async function addActivityEvent(
  type: ActivityEventType,
  data: ActivityEvent['data']
): Promise<void> {
  await withLock('activity_events_lock', async () => {
    const area = getActivityArea();
    const stored = await area.get(['activityEvents', 'activityDailyHistory']);
    const events = parseActivityEvents(stored.activityEvents);
    const history =
      parseActivityHistory(stored.activityDailyHistory) ?? seedActivityHistory(events);
    const newEvent: ActivityEvent = {
      id: `${type}_${Date.now()}_${randomToken(9)}`,
      type,
      timestamp: Date.now(),
      data,
    };

    // Add new event at the beginning
    events.unshift(newEvent);

    // Keep only the most recent events
    if (events.length > ACTIVITY_DETAIL_LIMIT) {
      events.splice(ACTIVITY_DETAIL_LIMIT);
    }

    await writeWithRetry(
      { activityEvents: events, activityDailyHistory: appendActivityHistory(history, newEvent) },
      { area }
    );
  });
}

export async function clearActivityEvents(): Promise<void> {
  await withLock('activity_events_lock', async () => {
    await getActivityArea().remove(['activityEvents', 'activityDailyHistory']);
  });
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

export async function addAutoExtendEvent(address: string, provider?: string): Promise<void> {
  await addActivityEvent('auto_extend', {
    address,
    ...(provider && { provider }),
  });
}

export async function addHardResetEvent(): Promise<void> {
  await addActivityEvent('hard_reset', {});
}
