import { browser } from 'wxt/browser';
import type { ClipboardPurgeRecord } from '@/utils/clipboard/clipboard.js';

/**
 * Unresolved clipboard purge record counts for the Settings → Privacy warning
 * (review-2-luna §2.10, review-2-glm §10.3). Read-only: the queue itself is
 * owned by `processClipboardPurgeQueue` in `clipboard.ts` (the background alarm
 * retries with backoff and only prunes on verified wipe or proven content
 * change), so this module must NEVER mutate the stored queue.
 */
const CLIPBOARD_PURGE_QUEUE_KEY = 'clipboardPurgeQueue';

/**
 * Failed wipe attempts before a record counts as ALERTING (review-2-glm §10.3:
 * a user-visible indicator "after N failed attempts", not on the first
 * transient hiccup). With the retry backoff (1→2→4 min) a record crosses this
 * after ~7 minutes of continuous failure - long enough to skip one-off skips
 * (popup closed mid-wipe), short enough to surface a real problem the same
 * session. The desktop notification still fires later, at the queue's
 * MAX_PURGE_ATTEMPTS milestone in clipboard.ts.
 */
export const CLIPBOARD_PURGE_ALERT_ATTEMPTS = 3;

export interface ClipboardPurgeStatus {
  /** Records still scheduled for their first purge attempt. */
  pending: number;
  /** Records whose wipe could not be verified at least once and are retrying. */
  stuck: number;
  /** Records whose failed attempts reached CLIPBOARD_PURGE_ALERT_ATTEMPTS. */
  alerting: number;
  /** Highest retry count among the stuck records (0 when none). */
  maxAttempts: number;
}

export async function getClipboardPurgeStatus(): Promise<ClipboardPurgeStatus> {
  try {
    const res = (await browser.storage.local.get([CLIPBOARD_PURGE_QUEUE_KEY])) as {
      clipboardPurgeQueue?: ClipboardPurgeRecord[];
    };
    const queue = Array.isArray(res.clipboardPurgeQueue) ? res.clipboardPurgeQueue : [];
    let pending = 0;
    let stuck = 0;
    let alerting = 0;
    let maxAttempts = 0;
    for (const record of queue) {
      if (record?.hash && typeof record.purgeAt === 'number') {
        if (typeof record.attempts === 'number' && record.attempts > 0) {
          stuck += 1;
          maxAttempts = Math.max(maxAttempts, record.attempts);
          if (record.attempts >= CLIPBOARD_PURGE_ALERT_ATTEMPTS) alerting += 1;
        } else {
          pending += 1;
        }
      }
    }
    return { pending, stuck, alerting, maxAttempts };
  } catch {
    /* non-critical status read - default to "nothing unresolved" */
    return { pending: 0, stuck: 0, alerting: 0, maxAttempts: 0 };
  }
}
