/**
 * Retry-with-backoff for `browser.storage.local` writes.
 *
 * A storage write can fail for a reason that is gone a moment later: Chrome's
 * leveldb commit hiccups, a Firefox backend hiccup, or an error raised while a
 * concurrent context (another tab, the sidepanel, a periodic hygiene pass) is
 * mid-write. Today every one of those takes the same path as a genuinely
 * permanent failure - the promise rejects, the caller catches, and the user
 * gets a "Failed to write to storage" toast for a write that would have
 * succeeded on the next attempt. This module absorbs that class.
 *
 * ## What is retried, and what is not
 *
 * `classifyStorageWriteError` sorts a failure into three kinds:
 *
 * - `quota` - the TOTAL quota ran out (`QUOTA_BYTES quota exceeded`,
 *   `QuotaExceededError`, DOMException code 22, or Firefox's wording).
 *   Retried, because another context's delete or cleanup can free those bytes
 *   between attempts. Owning a *space* policy stays the caller's job
 *   (email-storage's retention cleanup, the periodic hygiene pass) - this only
 *   stops the hiccup from reaching the user as an error.
 * - `transient` - anything not recognisably permanent. Retried, because the
 *   cost of guessing wrong in this direction is a bounded delay before the
 *   SAME failure reaches the caller, while guessing wrong the other way drops
 *   a write.
 * - `permanent` - the write cannot succeed however often it is replayed:
 *   per-item quota (`QUOTA_BYTES_PER_ITEM`, one value too large for trimming
 *   *other* keys to fix) and an invalidated extension context. Reported after
 *   the FIRST attempt, so a real error is not delayed by pointless backoff.
 *
 * ## Never silent
 *
 * When the attempts are exhausted the write still fails - through the app's own
 * `StorageWriteError`, carrying `kind`, `attempts` and the key list in
 * `context` and the browser's error as `originalError`. Every caller therefore
 * keeps its current contract (the toast path included); the difference is that
 * a transient failure has to survive every attempt to reach it.
 *
 * ## Holding a lock
 *
 * Most storage writes happen inside `withLock(...)`, so a backoff sleep holds
 * that lock. Delays are therefore deliberately small (50 ms → 200 ms, 350 ms of
 * scheduled backoff for the default four attempts) and are only ever paid on the
 * failure path - a lock is held a moment longer instead of the write being lost.
 *
 * Reads are out of scope: `storage.local.get` failures have their own call-site
 * contracts (empty default, prompt to re-grant, …) and nothing here changes them.
 */
import { browser as wxtBrowser } from 'wxt/browser';
import { StorageWriteError } from '@/utils/errors.js';
import { logWarn } from '@/utils/logger.js';

/** The slice of a storage area this module writes through. */
export interface StorageWriteArea {
  set(items: Record<string, unknown>): Promise<void>;
}

/** The local area shape shared with the read-modify-write helper. */
export interface LocalStorageArea extends StorageWriteArea {
  get(keys: string[]): Promise<Record<string, unknown>>;
}

export type StorageWriteFailureKind = 'transient' | 'quota' | 'permanent';

export interface StorageWriteRetryInfo {
  /** Which attempt just failed (1-based). */
  attempt: number;
  /** How many attempts the write is allowed in total. */
  attempts: number;
  /** Backoff about to be slept before the next attempt. */
  delayMs: number;
  kind: StorageWriteFailureKind;
  keys: string[];
  error: unknown;
}

export interface StorageWriteRetryOptions {
  /** Total attempts, including the first. Defaults to 4. */
  attempts?: number;
  /** First backoff step; doubles per attempt, then jittered. Defaults to 50 ms. */
  baseDelayMs?: number;
  /** Ceiling for one backoff step. Defaults to 400 ms. */
  maxDelayMs?: number;
  /** Ceiling for the SUM of scheduled backoff, so a retry cannot hold a lock
   * (or a message handler) open indefinitely. Defaults to 400 ms, sized for the
   * default four attempts at their WORST jitter (50 + 100 + 200 = 350, ×1.25 =
   * 437.5 - so the last step is clamped rather than dropped). The bound is hard:
   * the sleeps this schedules can never sum past it, whatever the jitter draw. */
  maxTotalDelayMs?: number;
  /** Fraction of the step a delay may be jittered by, either way. Defaults to 0.25. */
  jitterRatio?: number;
  /** Called once per retry, after the failure and before the sleep. */
  onRetry?: (info: StorageWriteRetryInfo) => void;
  /** Area to write through. Defaults to the live `storage.local`. */
  area?: StorageWriteArea;
  /** Sleep seam (tests). Defaults to `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  /** Jitter seam (tests). Defaults to `Math.random`. */
  random?: () => number;
}

/** Default retry policy. Deliberately short - see the lock note above. The
 * budget is sized to the attempt count: 50 + 100 + 200 = 350 ≤ 400. */
export const STORAGE_WRITE_RETRY = {
  attempts: 4,
  baseDelayMs: 50,
  maxDelayMs: 400,
  maxTotalDelayMs: 400,
  jitterRatio: 0.25,
} as const;

/** DOMException.QUOTA_EXCEEDED_ERR - Safari/Firefox name their quota failure by code. */
const DOM_QUOTA_EXCEEDED_CODE = 22;
/** `QUOTA_BYTES_PER_ITEM quota exceeded` - one VALUE is too large, which no
 * amount of trimming other keys can fix, unlike the total-quota case. */
const PER_ITEM_QUOTA = /per[_\s-]?item/;
/** The extension was reloaded/updated out from under this context. */
const INVALIDATED_CONTEXT =
  /(extension context invalidated|context invalidated|message port closed)/;

/**
 * Resolve the local storage area at CALL time.
 *
 * The MODULE export wins on purpose: replacing `wxt/browser` is how every unit
 * test installs its storage fake, while a live `globalThis.browser` can be one
 * another test file left behind - honoring that first would silently bypass the
 * mock and write into the stale store (background suites went red exactly that
 * way). The global is a fallback for a context where the module has no storage
 * area at all, which is what bun sees outside an extension.
 */
export function resolveLocalArea(): LocalStorageArea {
  const fromModule = (wxtBrowser as { storage?: { local?: LocalStorageArea } } | undefined)?.storage
    ?.local;
  if (fromModule) return fromModule;
  const live = (globalThis as { browser?: typeof wxtBrowser }).browser;
  const fromGlobal = live?.storage?.local as unknown as LocalStorageArea | undefined;
  return (fromGlobal ?? fromModule) as LocalStorageArea;
}

/**
 * Write options for a caller that was HANDED its storage area.
 *
 * A module that takes `ext` as a parameter (so a test can inject a fake area)
 * reads through that area - so it must WRITE through it too. Resolving the live
 * `storage.local` for the write instead left the read half on the injected
 * store and the write half on the real one: a backup import wrote into a store
 * the test never looked at and failed with a `StorageWriteError` that described
 * a browser the test was not using (`importBackup(ext, …)`).
 *
 * Usage: `writeWithRetry(items, areaOf(ext))`. An area without `set` yields no
 * override (the default resolution) - callers that accept a read-only area
 * already guard that case before writing.
 */
export function areaOf(ext: {
  storage: { local: { set?: (items: Record<string, unknown>) => Promise<void> } };
}): StorageWriteRetryOptions {
  const set = ext.storage.local.set;
  // Native Chrome StorageArea methods require their original receiver.
  return set ? { area: { set: (items) => set.call(ext.storage.local, items) } } : {};
}

/**
 * Remove options for a caller that was HANDED its storage area - the sibling of
 * `areaOf`, for the same reason: the read half and the remove half must land in
 * the same store.
 *
 * Usage: `removeWithRetry(keys, removeAreaOf(ext))`. Like `areaOf`, an area
 * without `remove` yields no override, so the default resolution applies - a
 * caller that must not fall through to the live store guards the method first
 * (as the import sweep already did).
 */
export function removeAreaOf(ext: {
  storage: { local: { remove?: (keys: string | string[]) => Promise<void> } };
}): StorageRemoveRetryOptions {
  const remove = ext.storage.local.remove;
  return remove ? { area: { remove: (keys) => remove.call(ext.storage.local, keys) } } : {};
}

/** Sort a write failure by whether a retry can plausibly succeed. */
export function classifyStorageWriteError(error: unknown): StorageWriteFailureKind {
  const named = error as { name?: unknown; code?: unknown; message?: unknown } | null | undefined;
  const name = typeof named?.name === 'string' ? named.name.toLowerCase() : '';
  const message = typeof named?.message === 'string' ? named.message.toLowerCase() : '';
  const code = typeof named?.code === 'number' ? named.code : undefined;

  // Permanent first: a per-item quota failure is also message-identical to a
  // total-quota one apart from the marker, and an invalidated context can never
  // reach storage again.
  if (PER_ITEM_QUOTA.test(message)) return 'permanent';
  if (INVALIDATED_CONTEXT.test(message)) return 'permanent';
  if (name === 'quotaexceedederror' || code === DOM_QUOTA_EXCEEDED_CODE) return 'quota';
  if (message.includes('quota')) return 'quota';
  return 'transient';
}

/**
 * Is this failure the storage QUOTA running out - any quota, including the
 * per-item one?
 *
 * Distinct from `classifyStorageWriteError` on purpose: this answers "should a
 * caller free space and try again?" (yes even for per-item - the payload
 * shrinks once old mail is dropped), while the classifier answers "should this
 * wrapper blind-retry the identical payload?" (no for per-item).
 *
 * Walks the wrapping chain, because a caller can catch either the browser's own
 * error or a `StorageWriteError` whose `originalError` is that error.
 */
export function isQuotaStorageError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    const named = current as { name?: unknown; code?: unknown; message?: unknown };
    const name = typeof named.name === 'string' ? named.name.toLowerCase() : '';
    const message = typeof named.message === 'string' ? named.message.toLowerCase() : '';
    if (name === 'quotaexceedederror' || named.code === DOM_QUOTA_EXCEEDED_CODE) return true;
    if (message.includes('quota')) return true;
    current =
      (current as { originalError?: unknown }).originalError ??
      (current as { cause?: unknown }).cause;
  }
  return false;
}

function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(typeof value === 'string' ? value : String(value));
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential step with symmetric jitter, e.g. 50 → 100 → 200 ms (±25%). */
function nextDelayMs(
  attempt: number,
  resolved: Required<Pick<StorageWriteRetryOptions, 'baseDelayMs' | 'maxDelayMs' | 'jitterRatio'>>,
  random: () => number
): number {
  const step = Math.min(resolved.maxDelayMs, resolved.baseDelayMs * 2 ** (attempt - 1));
  const jitter = 1 - resolved.jitterRatio + random() * resolved.jitterRatio * 2;
  return Math.max(1, Math.round(step * jitter));
}

/**
 * Write `items` to `browser.storage.local` (or an injected area), retrying a
 * transient/quota failure with bounded exponential backoff.
 *
 * Resolves once a write lands. Rejects with `StorageWriteError` when the
 * attempts are exhausted or the failure is permanent - never silently drops the
 * write.
 */
export async function writeWithRetry(
  items: Record<string, unknown>,
  options: StorageWriteRetryOptions = {}
): Promise<void> {
  const keys = Object.keys(items);
  // `set({})` is a no-op round trip; skip it rather than wake the service worker.
  if (keys.length === 0) return;

  const area = options.area ?? resolveLocalArea();
  return retryStorageOp(() => area.set(items), keys, options, 'storageWrite');
}

/**
 * The retry engine shared by `writeWithRetry` and `removeWithRetry` - one home
 * for the policy, so a removal and a write cannot disagree about how many
 * attempts a transient failure gets, how much backoff may hold a lock open, or
 * when a failure is permanent rather than worth retrying.
 *
 * `op` is the whole operation (the caller resolves its own area), which is why
 * `area` is not part of `options` here: it is used before the first attempt,
 * not by the retry loop.
 *
 * `label` only names the operation in the give-up log.
 */
async function retryStorageOp(
  op: () => Promise<void>,
  keys: string[],
  options: Omit<StorageWriteRetryOptions, 'area'>,
  label: 'storageWrite' | 'storageRemove'
): Promise<void> {
  const attempts = options.attempts ?? STORAGE_WRITE_RETRY.attempts;
  const maxTotalDelayMs = options.maxTotalDelayMs ?? STORAGE_WRITE_RETRY.maxTotalDelayMs;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const resolved = {
    baseDelayMs: options.baseDelayMs ?? STORAGE_WRITE_RETRY.baseDelayMs,
    maxDelayMs: options.maxDelayMs ?? STORAGE_WRITE_RETRY.maxDelayMs,
    jitterRatio: options.jitterRatio ?? STORAGE_WRITE_RETRY.jitterRatio,
  };

  let attempt = 0;
  let scheduledDelay = 0;
  let kind: StorageWriteFailureKind = 'transient';
  let lastError: unknown;

  while (attempt < attempts) {
    attempt += 1;
    try {
      await op();
      return;
    } catch (error) {
      lastError = error;
      kind = classifyStorageWriteError(error);
    }

    // A permanent failure is not worth a single millisecond of delay.
    if (kind === 'permanent') break;
    if (attempt >= attempts) break;

    // Clamp to what is LEFT of the budget instead of abandoning the attempt: a
    // jittered final step must not be able to cut the policy short, and the sum
    // of sleeps must never cross the budget (that is the lock-hold promise).
    const remaining = maxTotalDelayMs - scheduledDelay;
    if (remaining <= 0) break;
    const delay = Math.min(nextDelayMs(attempt, resolved, random), remaining);
    scheduledDelay += delay;
    options.onRetry?.({ attempt, attempts, delayMs: delay, kind, keys, error: lastError });
    await sleep(delay);
  }

  logWarn(`${label}: giving up after retries`, {
    keys,
    attempts: attempt,
    kind,
    scheduledDelayMs: scheduledDelay,
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });
  throw new StorageWriteError(
    keys.join(', '),
    { attempts: attempt, kind, keys },
    toError(lastError)
  );
}

/** The slice of a storage area this module removes through. */
export interface StorageRemoveArea {
  remove(keys: string | string[]): Promise<void>;
}

export interface StorageRemoveRetryOptions extends Omit<StorageWriteRetryOptions, 'area'> {
  /** Area to remove through. Defaults to the live `storage.local`. */
  area?: StorageRemoveArea;
}

/**
 * Resolve the local area's `remove` at CALL time, mirroring `resolveLocalArea`'s
 * precedence exactly (module export first, live global as the last resort): a
 * remove that resolved the area differently from the write beside it would
 * delete from a store the read half never touched.
 */
function resolveLocalRemoveArea(): StorageRemoveArea {
  const fromModule = (wxtBrowser as { storage?: { local?: StorageRemoveArea } } | undefined)
    ?.storage?.local;
  if (fromModule) return fromModule;
  const live = (globalThis as { browser?: { storage?: { local?: StorageRemoveArea } } }).browser;
  return (live?.storage?.local ?? fromModule) as StorageRemoveArea;
}

/**
 * Remove `keys` from `browser.storage.local` (or an injected area) with the SAME
 * bounded retry policy as `writeWithRetry`.
 *
 * A removal is a write too: it can fail transiently, and the paths that use it
 * are cleanup sweeps whose silent failure leaves orphaned data in storage
 * forever (the import/undo bag-key sweeps). `StorageRemoveArea` is optional on
 * an injected area - a caller that cannot remove simply does not call this.
 *
 * Rejects with `StorageWriteError` when the attempts are exhausted or the
 * failure is permanent, so a caller that must know can; a best-effort sweep
 * catches and logs as it did before.
 */
export async function removeWithRetry(
  keys: string | string[],
  options: StorageRemoveRetryOptions = {}
): Promise<void> {
  const list = Array.isArray(keys) ? keys : [keys];
  // `remove([])` is a no-op round trip; skip it rather than wake the worker.
  if (list.length === 0) return;

  const area = options.area ?? resolveLocalRemoveArea();
  return retryStorageOp(() => area.remove(list), list, options, 'storageRemove');
}
