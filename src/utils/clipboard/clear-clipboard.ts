/**
 * Manual "Clear clipboard now" action (Settings → Privacy).
 *
 * The auto-purge path (`clipboard.ts`) is verify-BEFORE-wipe: it only clears when
 * the clipboard still holds the text it copied, so it can never destroy a value
 * the user copied since. A manual clear is the opposite request - the user asked
 * for the clipboard to be empty - so this wipes unconditionally and then
 * REPORTS whether the result could be verified.
 *
 * The outcome is a stable code (`ClearClipboardOutcome`), never prose: the
 * caller renders a locale key, so this module stays bundle-neutral and the
 * message can never drift into English.
 *
 * A VERIFIED empty clipboard also settles the pending purge records: nothing
 * they guard can still be on the clipboard, so the stored queue and the
 * stuck-warning card are retired immediately instead of waiting for the alarm.
 * A record created after this clear started is kept - its copy may have landed
 * while the wipe was in flight (a record without `copiedAt` is a legacy shape
 * and is treated as settled).
 */

import { browser } from 'wxt/browser';
import { logError } from '@/utils/logger.js';
import { withLock } from '@/utils/mutex.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import {
  CLIPBOARD_PURGE_LOCK,
  CLIPBOARD_PURGE_QUEUE_KEY,
  type ClipboardPurgeRecord,
  dismissStuckPurgeAlert,
  scheduleNextClipboardPurgeAlarm,
} from './clipboard.js';

/** What the manual clear managed to prove. */
export type ClearClipboardOutcome = 'cleared' | 'unverified' | 'unavailable';

/** The slice of `navigator.clipboard` this action uses. */
export interface ClipboardWriteApi {
  writeText?: (value: string) => Promise<void>;
  readText?: () => Promise<string>;
}

export interface ClearClipboardDeps {
  /** Clipboard API override (tests). Defaults to `navigator.clipboard`. */
  clipboard?: ClipboardWriteApi | null;
  /** Queue settle seam (tests). Defaults to the stored purge queue. */
  settle?: (startedAt: number) => Promise<void>;
  /** Clock seam for the "records copied after this point survive" boundary. */
  now?: () => number;
}

/**
 * Records that must survive a verified clear: only those copied after the clear
 * began. Everything else can no longer be on the clipboard, because the
 * clipboard was just proven empty.
 */
export function remainingPurgeRecords(
  queue: ClipboardPurgeRecord[],
  startedAt: number
): ClipboardPurgeRecord[] {
  return queue.filter(
    (record) => typeof record.copiedAt === 'number' && record.copiedAt > startedAt
  );
}

/**
 * Retire the purge records a verified wipe made unreachable, then let the alarm
 * (and the stuck-warning card) reflect the new truth.
 */
async function settleStoredPurgeQueue(startedAt: number): Promise<void> {
  await withLock(CLIPBOARD_PURGE_LOCK, async () => {
    const stored = (await browser.storage.local.get([CLIPBOARD_PURGE_QUEUE_KEY])) as {
      clipboardPurgeQueue?: ClipboardPurgeRecord[];
    };
    const queue = Array.isArray(stored.clipboardPurgeQueue) ? stored.clipboardPurgeQueue : [];
    const remaining = remainingPurgeRecords(queue, startedAt);
    if (remaining.length === queue.length) return;
    await writeWithRetry({ [CLIPBOARD_PURGE_QUEUE_KEY]: remaining });
  });
  await dismissStuckPurgeAlert();
  await scheduleNextClipboardPurgeAlarm();
}

/**
 * Wipe the clipboard now and report whether the result is verified.
 *
 * `unavailable` - the Clipboard API cannot write here (the clipboard is untouched);
 * `unverified`  - the write was attempted but the clipboard could not be read back
 *                 or came back non-empty (never claim a clear that was not proven);
 * `cleared`     - the clipboard was read back empty, and the purge queue was settled.
 */
export async function clearClipboardNow(
  deps: ClearClipboardDeps = {}
): Promise<ClearClipboardOutcome> {
  const api =
    deps.clipboard !== undefined
      ? deps.clipboard
      : typeof navigator !== 'undefined'
        ? navigator.clipboard
        : undefined;
  const write = api?.writeText;
  if (!api || !write) return 'unavailable';

  const startedAt = (deps.now ?? Date.now)();
  try {
    await write.call(api, '');
  } catch (error) {
    logError('Manual clipboard clear failed', error);
    return 'unavailable';
  }

  const read = api.readText;
  let verifiedEmpty = false;
  if (read) {
    try {
      verifiedEmpty = (await read.call(api)) === '';
    } catch (error) {
      logError('Manual clipboard clear could not be verified', error);
    }
  }
  if (!verifiedEmpty) return 'unverified';

  try {
    await (deps.settle ?? settleStoredPurgeQueue)(startedAt);
  } catch (error) {
    // The wipe itself succeeded; a settle failure only leaves records the alarm
    // resolves on its next verified pass, so the outcome stays 'cleared'.
    logError('Failed to settle clipboard purge queue after manual clear', error);
  }
  return 'cleared';
}
