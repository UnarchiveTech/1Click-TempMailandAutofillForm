import { browser as wxtBrowser } from 'wxt/browser';
import { tSync } from '@/utils/i18n/i18n-background.js';
import { withLock } from '@/utils/mutex.js';
import { createBrowserNotification } from '@/utils/notifications/notification-permission.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import { logError, logInfo, logWarn } from '../logger.js';
import { loadClipboardPrivacy, purgeDurationMs } from './clipboard-settings.js';

let purgeTimeoutId: ReturnType<typeof setTimeout> | null = null;

/**
 * Resolve the browser API at CALL time. The `wxt/browser` export snapshots
 * `globalThis.browser` at module evaluation, which unit tests install only
 * later (and other tests in the same worker can replace) - so prefer the
 * live global whenever it exposes a storage area.
 */
function getBrowser(): typeof wxtBrowser {
  const live = (globalThis as { browser?: typeof wxtBrowser }).browser;
  return live && typeof live.storage === 'object' ? live : wxtBrowser;
}

async function resolvePurgeDurationMs(durationMs?: number): Promise<number | undefined> {
  if (durationMs !== undefined) return durationMs;
  try {
    return purgeDurationMs(await loadClipboardPrivacy());
  } catch {
    return 30000;
  }
}

/**
 * Clipboard purge record stored in extension storage so a background alarm
 * can clear sensitive data even if the page/context that initiated the copy
 * is unloaded before the page-scoped setTimeout fires.
 */
export interface ClipboardPurgeRecord {
  /** SHA-256 hex hash of the text that was copied (for content-matching) */
  hash: string;
  /** Epoch ms when the purge should execute */
  purgeAt: number;
  /** Original copy time, retained across retries for the UI countdown. */
  copiedAt?: number;
  /**
   * Number of times this record went due but the wipe could not be verified
   * (no active tab, clipboard read denied, injection failure). Each failed
   * attempt re-queues with an exponential backoff INSTEAD OF DROPPING the
   * record - a sensitive value that is still on the clipboard must keep
   * being retried; the record is only ever pruned when a verification
   * proves the text is gone (wiped, or clipboard content changed). Bumped
   * by `processClipboardPurgeQueue`; the alarm runs roughly every minute.
   */
  attempts?: number;
}

/** Base delay before retrying an unverifiable wipe (the alarm ticks ~1/min). */
const PURGE_RETRY_BACKOFF_MS = 60_000;
/** Doubling cap for the retry backoff (1min → max 32 min between attempts). */
const PURGE_RETRY_BACKOFF_CAP = 32;
/**
 * Milestone for observability logging, NOT a drop threshold: when a record
 * reaches this many failed attempts we log once that the wipe is still
 * pending, then keep retrying forever (at the capped 32-minute backoff).
 * Records are never pruned here - a value whose wipe could not be verified
 * may still be on the clipboard. The queue is explicitly capped at
 * MAX_PURGE_QUEUE_RECORDS so unreadable attempts cannot exhaust extension
 * storage; recovery of an oversized queue retains its newest records because
 * the clipboard itself can contain only its current value.
 */
const MAX_PURGE_ATTEMPTS = 12;

/**
 * Re-alert cadence for the desktop notification: after the first milestone
 * notification, repeat only every ALERT_REPEAT_EVERY_ATTEMPTS further failed
 * attempts (~16 minutes at the capped 32-minute backoff) instead of one
 * notification per minute.
 */
const ALERT_REPEAT_EVERY_ATTEMPTS = 32;
/** Notification id prefix - the background's onClicked handler routes these to Settings → Privacy. */
const CLIPBOARD_PURGE_ALERT_ID_PREFIX = 'clipboard-purge-alert:';
/**
 * The one stuck-purge card: milestone re-alerts replace it instead of stacking
 * a card per milestone (the Date.now() suffix used to pile them up). The prefix
 * is kept so click routing to Settings → Privacy survives.
 */
const STUCK_PURGE_ALERT_ID = `${CLIPBOARD_PURGE_ALERT_ID_PREFIX}stuck`;

/**
 * Dismiss the stuck-purge card once the wipe is verified gone - otherwise the
 * scary "still on the clipboard" warning lingers after the danger passed.
 * Best-effort: test fakes may not implement notifications.clear.
 *
 * Exported for the manual "Clear clipboard now" action, which resolves the same
 * warning through a user-driven wipe rather than through the alarm.
 */
export async function dismissStuckPurgeAlert(): Promise<void> {
  try {
    await getBrowser().notifications.clear(STUCK_PURGE_ALERT_ID);
  } catch {
    /* dismiss is best-effort */
  }
}

/** When the wipe cannot be verified, keep the record and push its due date. */
function retryDueRecord(record: ClipboardPurgeRecord): ClipboardPurgeRecord {
  const attempts = (record.attempts ?? 0) + 1;
  return {
    ...record,
    attempts,
    purgeAt: Date.now() + PURGE_RETRY_BACKOFF_MS * Math.min(2 ** attempts, PURGE_RETRY_BACKOFF_CAP),
  };
}

/** Stored key for the pending-purge records (shared with the manual clear action). */
export const CLIPBOARD_PURGE_QUEUE_KEY = 'clipboardPurgeQueue';
/**
 * Cross-context lock serializing every read-modify-write of the purge queue.
 * Shared with the manual clear action so a user-driven wipe and an alarm-side
 * sweep can never drop each other's records.
 */
export const CLIPBOARD_PURGE_LOCK = 'clipboard_purge_lock';
export const CLIPBOARD_PURGE_ALARM = 'clipboard_purge_check';
const CLIPBOARD_ALARM_MIN_DELAY_MS = 1000;
// A stuck/unreadable clipboard must not grow storage forever. The clipboard
// can hold only one current value, so retain the most recently scheduled
// records when recovering an older oversized queue.
const MAX_PURGE_QUEUE_RECORDS = 100;

/** Keep exactly one background wake at the earliest queued purge deadline. */
export async function scheduleNextClipboardPurgeAlarm(): Promise<number | null> {
  try {
    const browserApi = getBrowser();
    const existing = await browserApi.alarms.get(CLIPBOARD_PURGE_ALARM);
    const stored = (await browserApi.storage.local.get([CLIPBOARD_PURGE_QUEUE_KEY])) as {
      clipboardPurgeQueue?: ClipboardPurgeRecord[];
    };
    const queue = Array.isArray(stored.clipboardPurgeQueue) ? stored.clipboardPurgeQueue : [];
    const now = Date.now();
    const next = queue
      .map((record) => record.purgeAt)
      .filter((deadline) => Number.isFinite(deadline))
      .reduce<number | null>(
        (earliest, deadline) => (earliest === null ? deadline : Math.min(earliest, deadline)),
        null
      );
    if (next === null) {
      if (existing) await browserApi.alarms.clear(CLIPBOARD_PURGE_ALARM);
      return null;
    }
    const when = Math.max(next, now + CLIPBOARD_ALARM_MIN_DELAY_MS);
    if (
      existing &&
      existing.periodInMinutes === undefined &&
      Math.abs((existing.scheduledTime ?? 0) - when) < 1000
    ) {
      return when;
    }
    if (existing) await browserApi.alarms.clear(CLIPBOARD_PURGE_ALARM);
    await browserApi.alarms.create(CLIPBOARD_PURGE_ALARM, { when });
    return when;
  } catch (err) {
    logError('Failed to schedule clipboard purge alarm', err);
    return null;
  }
}

/**
 * Hash text using SHA-256 (available in both page and background contexts).
 * Used to match clipboard content before purging without storing the secret.
 */
async function hashClipboardText(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Register a purge record in extension storage so the background alarm
 * can clear the clipboard even if this page/context is destroyed.
 */
export async function scheduleBackgroundPurge(
  text: string,
  ms: number,
  copiedAt = Date.now()
): Promise<void> {
  try {
    const hash = await hashClipboardText(text);
    const record: ClipboardPurgeRecord = { hash, copiedAt, purgeAt: copiedAt + ms };
    // Serialize against the alarm-side consumer (processClipboardPurgeQueue):
    // two copies racing the same read-modify-write drop each other's records,
    // stranding sensitive text on the clipboard past its purge deadline.
    await withLock(CLIPBOARD_PURGE_LOCK, async () => {
      const existing = (await getBrowser().storage.local.get([CLIPBOARD_PURGE_QUEUE_KEY])) as {
        clipboardPurgeQueue?: ClipboardPurgeRecord[];
      };
      if (
        (existing.clipboardPurgeQueue || []).some(
          (r) => r.hash === hash && (r.copiedAt ?? 0) > copiedAt
        )
      )
        return;
      const queue = (existing.clipboardPurgeQueue || []).filter(
        (r) => Number.isFinite(r.purgeAt) && r.hash !== hash
      );
      if (ms > 0) queue.push(record);
      await writeWithRetry({
        [CLIPBOARD_PURGE_QUEUE_KEY]: queue.slice(-MAX_PURGE_QUEUE_RECORDS),
      });
    });
    void scheduleNextClipboardPurgeAlarm();
  } catch (err) {
    logError('Failed to schedule background clipboard purge', err);
  }
}

/**
 * Copy text to the clipboard and optionally schedule auto-clear
 * (duration from clipboard privacy settings, or explicit override).
 *
 * Pass durationMs = 0 to skip purge. Omit to use user settings.
 */
export async function copyToClipboardAndSchedulePurge(
  text: string,
  durationMs?: number
): Promise<boolean> {
  try {
    const ms = await resolvePurgeDurationMs(durationMs);
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (clipboard?.writeText) {
      if (ms && ms > 0 && !clipboard.readText) {
        throw new Error('Clipboard verification is unavailable while automatic purge is enabled.');
      }
      await clipboard.writeText(text);
    } else {
      // The legacy API cannot safely verify clipboard contents before wiping.
      // Keep it only for copies where auto-purge is explicitly disabled.
      if (ms && ms > 0) {
        throw new Error('Automatic clipboard purge requires the Clipboard API.');
      }
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      try {
        textArea.focus();
        textArea.select();
        if (!document.execCommand('copy')) throw new Error('Legacy clipboard copy was rejected.');
      } finally {
        textArea.remove();
      }
    }

    if (purgeTimeoutId) {
      clearTimeout(purgeTimeoutId);
      purgeTimeoutId = null;
    }

    if (ms && ms > 0) {
      const deadline = Date.now() + ms;
      logInfo(`Copied to clipboard. Scheduled auto-purge in ${ms / 1000}s.`);
      // Also register in extension storage so a background alarm can purge
      // even if this page/context is destroyed before the timeout fires
      void scheduleBackgroundPurge(text, ms, deadline - ms);
      purgeTimeoutId = setTimeout(async () => {
        purgeTimeoutId = null;
        try {
          if (typeof navigator !== 'undefined' && navigator.clipboard) {
            const hash = await hashClipboardText(text);
            let stored: Record<string, unknown> | null = null;
            try {
              stored = await getBrowser().storage.local.get([CLIPBOARD_PURGE_QUEUE_KEY]);
            } catch (error) {
              logError('Failed to inspect clipboard purge ownership', error);
            }
            if (stored && Array.isArray(stored.clipboardPurgeQueue)) {
              // A later copy in another extension window owns the new deadline.
              const records = stored.clipboardPurgeQueue as ClipboardPurgeRecord[];
              if (!records.some((record) => record.hash === hash && record.purgeAt <= deadline))
                return;
            }
            // Verify-before-wipe: only clear when the clipboard STILL holds the
            // exact text we copied. A blind writeText('') would destroy
            // whatever the user copied in the meantime. When we cannot read
            // the clipboard (no focus / permission), skip rather than risk
            // destroying user data.
            const current = await navigator.clipboard.readText().catch(() => null);
            if (current !== text) {
              logInfo(
                current === null
                  ? 'Clipboard purge skipped: could not verify clipboard contents.'
                  : 'Clipboard purge skipped: clipboard contents changed since copy.'
              );
              if (current !== null) await settleLocalPurge(text, deadline);
              return;
            }
            await navigator.clipboard.writeText('');
            if ((await navigator.clipboard.readText()) !== text) {
              logInfo('Verified sensitive data was cleared from clipboard.');
              await settleLocalPurge(text, deadline);
            }
          }
        } catch (err) {
          logError('Failed to auto-clear clipboard', err);
        }
      }, ms);
    } else {
      logInfo('Copied to clipboard (auto-purge disabled).');
      // An older window must not purge a value just re-copied with purge off.
      void scheduleBackgroundPurge(text, 0);
    }

    return true;
  } catch (error) {
    logError('Failed to copy to clipboard', error);
    return false;
  }
}

/** Retire only this copy's verified records; never consume a newer copy. */
async function settleLocalPurge(text: string, deadline: number): Promise<void> {
  const hash = await hashClipboardText(text);
  await withLock('clipboard_purge_lock', async () => {
    const stored = await getBrowser().storage.local.get([CLIPBOARD_PURGE_QUEUE_KEY]);
    const queue = Array.isArray(stored.clipboardPurgeQueue)
      ? (stored.clipboardPurgeQueue as ClipboardPurgeRecord[])
      : [];
    await writeWithRetry({
      [CLIPBOARD_PURGE_QUEUE_KEY]: queue.filter(
        (record) => record.hash !== hash || record.purgeAt > deadline
      ),
    });
  });
  void scheduleNextClipboardPurgeAlarm();
}

/** Reconcile pending clears while an extension document actually has focus.
 * A closed popup cannot read the clipboard; opening it provides a usable
 * verification context without injecting into a restricted or unfocused tab.
 */
export async function verifyClipboardPurgeInFocusedDocument(): Promise<void> {
  if (typeof document === 'undefined' || !document.hasFocus() || !navigator.clipboard?.readText)
    return;
  await withLock('clipboard_purge_lock', async () => {
    const stored = await getBrowser().storage.local.get([CLIPBOARD_PURGE_QUEUE_KEY]);
    const queue = Array.isArray(stored.clipboardPurgeQueue)
      ? (stored.clipboardPurgeQueue as ClipboardPurgeRecord[])
      : [];
    if (!queue.length) return;
    try {
      const current = await navigator.clipboard.readText();
      const currentHash = await hashClipboardText(current);
      const due = queue.some(
        (record) =>
          record.hash === currentHash &&
          (record.purgeAt <= Date.now() || (record.attempts ?? 0) > 0)
      );
      let verifiedHash = currentHash;
      if (due) {
        // Recheck immediately before writing, preserving a value copied meanwhile.
        if (!document.hasFocus() || (await navigator.clipboard.readText()) !== current) return;
        await navigator.clipboard.writeText('');
        verifiedHash = await hashClipboardText(await navigator.clipboard.readText());
      }
      const remaining = queue.filter((record) => record.hash === verifiedHash);
      if (remaining.length !== queue.length) {
        await writeWithRetry({ [CLIPBOARD_PURGE_QUEUE_KEY]: remaining });
        await dismissStuckPurgeAlert();
      }
    } catch (error) {
      // Keep the warning and its retry records when the browser refuses verification.
      logInfo('Focused clipboard verification remains pending', { error: String(error) });
    }
  });
  await scheduleNextClipboardPurgeAlarm();
}

/**
 * Copy text from a background/service-worker context, where there is no
 * focused document for the Clipboard API. Tries the direct path first (works
 * when an extension page holds focus), then injects a write into the focused
 * tab - the same strategy the purge alarm uses. Schedules auto-purge either way.
 */
export async function copyToClipboardFromBackground(
  text: string,
  durationMs?: number
): Promise<boolean> {
  if (!text) return false;

  const ms = await resolvePurgeDurationMs(durationMs);

  // 1) Direct write (extension page / Firefox background - document focused).
  const direct = await copyToClipboardAndSchedulePurge(text, ms);
  if (direct) return true;

  // 2) Inject into the focused tab (Chrome MV3 service worker has no document).
  try {
    const tabs = await getBrowser().tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (tabId === undefined) return false;
    const results = await getBrowser().scripting.executeScript({
      target: { tabId },
      func: (value: string, requireRead: boolean) => {
        if (!navigator.clipboard?.writeText || (requireRead && !navigator.clipboard.readText)) {
          return false;
        }
        return navigator.clipboard
          .writeText(value)
          .then(() => true)
          .catch(() => false);
      },
      args: [text, !!ms && ms > 0],
    });
    const ok = results?.[0]?.result === true;
    if (ok) {
      void scheduleBackgroundPurge(text, ms ?? 0);
    }
    return ok;
  } catch (err) {
    logError('Background clipboard copy failed', err);
    return false;
  }
}

/**
 * Background alarm entry point: scan the purge queue, clear clipboard for
 * any entries whose purgeAt has passed, and prune expired records.
 * Runs in the service worker context (no navigator.clipboard), so uses
 * scripting.executeScript to inject a clipboard-clear call into an active tab.
 *
 * The injected function RETURNS the outcome of the verify-then-wipe chain
 * (executeScript resolves `result` with the resolved promise value), so the
 * background knows whether the wipe actually happened. "Skip rather than
 * wipe" (clipboard unreadable / injection failed / no active tab) does NOT
 * prune the record - the sensitive text may still be on the clipboard, so
 * the record is retained with a retry backoff. Only outcomes that prove the
 * text is gone (hash matched → wiped, or hash differed → user copied
 * something else) drop the record.
 */
export async function processClipboardPurgeQueue(): Promise<void> {
  try {
    // Hold the same lock as scheduleBackgroundPurge for the whole
    // read-verify-write cycle: a copy landing between this read and the
    // surviving-records write below would otherwise be silently dropped from
    // the queue. The hold spans the tab query + injected verification - the
    // alarm ticks ~1/min and a delayed schedule just waits, which is strictly
    // safer than a lost purge record.
    await withLock(CLIPBOARD_PURGE_LOCK, async () => {
      const existing = (await getBrowser().storage.local.get([CLIPBOARD_PURGE_QUEUE_KEY])) as {
        clipboardPurgeQueue?: ClipboardPurgeRecord[];
      };
      const queue = (existing.clipboardPurgeQueue || [])
        .filter((record) => Number.isFinite(record.purgeAt))
        .slice(-MAX_PURGE_QUEUE_RECORDS);
      const now = Date.now();
      const due = queue.filter((r) => r.purgeAt <= now);
      const pending = queue.filter((r) => r.purgeAt > now);
      let retained: ClipboardPurgeRecord[] = [];

      if (due.length > 0) {
        let outcome: 'matched' | 'changed' | 'unreadable' | undefined;
        try {
          // Get the active tab to inject the verify-then-clear script
          const tabs = await getBrowser().tabs.query({ active: true, currentWindow: true });
          const tabId = tabs[0]?.id;
          if (tabId !== undefined) {
            const expectedHashes = due.map((r) => r.hash);
            const results = await getBrowser().scripting.executeScript({
              target: { tabId },
              // Verify-before-wipe: only clear when the clipboard still matches
              // one of the due purge records' hashes - a blind writeText('')
              // would destroy whatever the user copied since. When the clipboard
              // cannot be read (no focus / permission), skip the wipe entirely.
              // The returned promise chain reports which of these happened so
              // the queue only drops records whose text is provably gone.
              func: (hashes: string[]) => {
                const sha256Hex = async (t: string): Promise<string> => {
                  const data = new TextEncoder().encode(t);
                  const buf = await crypto.subtle.digest('SHA-256', data);
                  return Array.from(new Uint8Array(buf))
                    .map((b) => b.toString(16).padStart(2, '0'))
                    .join('');
                };
                if (!navigator.clipboard?.readText) return 'unreadable';
                return navigator.clipboard
                  .readText()
                  .then((t) => sha256Hex(t))
                  .then((h) => {
                    if (!hashes.includes(h)) return 'changed';
                    // Verified: the clipboard STILL holds one of our texts - wipe.
                    return navigator.clipboard
                      .writeText('')
                      .then(() => navigator.clipboard.readText())
                      .then((text) => sha256Hex(text))
                      .then((hash) => (hashes.includes(hash) ? 'unreadable' : 'matched'))
                      .catch(() => 'unreadable');
                  })
                  .catch(() => 'unreadable');
              },
              args: [expectedHashes],
            });
            const result = results?.[0]?.result;
            if (result === 'matched' || result === 'changed') {
              outcome = result;
            } else {
              // Unknown / unexpected result - treat as unverifiable and retry.
              outcome = 'unreadable';
            }
          } else {
            outcome = 'unreadable';
          }
        } catch (err) {
          logError('Background clipboard purge failed', err);
          outcome = 'unreadable';
        }

        if (outcome === 'matched') {
          logInfo(`Background alarm purged ${due.length} clipboard entr(y/ies).`);
          await dismissStuckPurgeAlert();
        } else if (outcome === 'changed') {
          logInfo(
            `Background alarm dropped ${due.length} clipboard purge entr(y/ies): clipboard contents changed since copy.`
          );
          await dismissStuckPurgeAlert();
        } else {
          // The wipe never happened - the sensitive text may still be on the
          // clipboard. NEVER prune the record (that would strand the value
          // there forever): retain due records with a retry backoff, subject
          // to the storage queue's hard size cap. Attempts are capped at
          // MAX_PURGE_ATTEMPTS purely as an observability milestone.
          retained = due.map(retryDueRecord);
          const reachedMilestone = retained.filter(
            (r) =>
              (r.attempts ?? 0) === MAX_PURGE_ATTEMPTS ||
              ((r.attempts ?? 0) > MAX_PURGE_ATTEMPTS &&
                ((r.attempts ?? 0) - MAX_PURGE_ATTEMPTS) % ALERT_REPEAT_EVERY_ATTEMPTS === 0)
          );
          if (reachedMilestone.length > 0) {
            logWarn(
              `${reachedMilestone.length} clipboard purge record(s) failed ${MAX_PURGE_ATTEMPTS} wipe attempts; they will KEEP retrying - the sensitive text may still be on the clipboard.`
            );
            // Loud notification (review-2-glm §10.3): the retained records are
            // otherwise silent - nothing user-visible says the clipboard may
            // still hold sensitive text. Id prefix routes the click to Settings
            // → Privacy (see background/index.ts notification click handler).
            // Stable stuck id: re-alerts replace the one card instead of
            // stacking a new card per milestone.
            createBrowserNotification(STUCK_PURGE_ALERT_ID, {
              type: 'basic',
              iconUrl: 'icons/icon48.png',
              title: tSync('notifications.clipboardPurgeStuckTitle'),
              message: tSync('notifications.clipboardPurgeStuckMessage', {
                n: reachedMilestone.length,
              }),
            });
          }
        }
      }

      // Persist the surviving records (pending + retained-for-retry)
      await writeWithRetry({
        [CLIPBOARD_PURGE_QUEUE_KEY]: [...pending, ...retained],
      });
      await scheduleNextClipboardPurgeAlarm();
    });
  } catch (err) {
    logError('Failed to process clipboard purge queue', err);
  }
}
