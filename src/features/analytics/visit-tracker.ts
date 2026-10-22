/**
 * Count a visit to a named view or dialog.
 *
 * The count belongs to the background: `analytics` is one record, and the
 * background increments it under `analytics_lock` for read mail, fetch timings,
 * extension opens and storage trends. A UI-side read-modify-write of the whole
 * key therefore lost whichever of those landed between its read and its write
 * - so the event is SENT (`recordPageVisit`) and the owner of the key performs
 * it. `getAnalytics` already reads the record back through that same module,
 * so the counter has one writer and one reader.
 */
import { browser } from 'wxt/browser';
import type { ActivityViewId } from '@/features/types/view-types.js';
import { logDebug } from '@/utils/logger.js';

export async function trackVisit(viewId: ActivityViewId): Promise<void> {
  if (!viewId) return;
  try {
    await browser.runtime.sendMessage({ type: 'recordPageVisit', viewId });
  } catch (error) {
    logDebug('Failed to record page visit', error);
  }
}
