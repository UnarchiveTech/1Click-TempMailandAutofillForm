/**
 * Lightweight async mutex with cross-context exclusion through Web Locks or
 * IndexedDB transactions when Web Locks is unavailable.
 *
 * The in-memory queue handles same-context contention. Web Locks coordinates
 * extension pages and the service worker; a held IndexedDB read/write
 * transaction provides the fallback. If neither API is available, or lock
 * acquisition times out, fail closed rather than running the task unlocked.
 */
export class Mutex {
  private queue: Promise<void> = Promise.resolve();
  public activeCount = 0;
  private readonly acquireTimeoutMs: number;

  constructor(acquireTimeoutMs: number = 10_000) {
    this.acquireTimeoutMs = acquireTimeoutMs;
  }

  async runExclusive<T>(task: () => Promise<T>): Promise<T> {
    this.activeCount++;
    let release: () => void = () => {};
    const lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    const currentQueue = this.queue;
    this.queue = this.queue.then(
      () => lock,
      () => lock
    );

    let timerId: ReturnType<typeof setTimeout> | undefined;
    let lockAcquired = false;
    const timeout = new Promise<never>((_, reject) => {
      timerId = setTimeout(
        () => reject(new Error(`Mutex acquisition timeout after ${this.acquireTimeoutMs / 1000}s`)),
        this.acquireTimeoutMs
      );
    });

    try {
      await Promise.race([currentQueue, timeout]);
      lockAcquired = true;
      if (timerId !== undefined) clearTimeout(timerId);
      return await Promise.resolve().then(() => task());
    } catch (e) {
      if (!lockAcquired) release();
      throw e;
    } finally {
      if (timerId !== undefined) clearTimeout(timerId);
      if (lockAcquired) release();
      this.activeCount--;
    }
  }
}

const namedMutexes = new Map<string, Mutex>();

export const LOCKS = {
  ADDRESS_STORAGE: 'address_storage_lock',
  EMAILS_STORAGE: 'emails_storage_lock',
  ANALYTICS: 'analytics_lock',
  ACTIVITY_EVENTS: 'activity_events_lock',
  IDENTITIES: 'identities_lock',
  LOGIN_INFO: 'login_info_lock',
  SESSION_CREDENTIALS: 'session_credentials_lock',
  CUSTOM_INSTANCES: 'custom_instances_lock',
  AUTOFILL_FAILURE_COUNTS: 'autofill_failure_counts_lock',
  PROVIDER_HEALTH: 'provider_health_lock',
  SITE_PROFILES: 'site_profiles_lock',
  SEARCH_HISTORY: 'search_history_lock',
  FIELD_MAPS: 'field_maps_lock',
  ADDRESS_LIFECYCLE: 'address_lifecycle_lock',
  IDENTITY_STICKY: 'identity_sticky_lock',
  MAILBOX_RULE_STATS: 'mailbox_rule_stats_lock',
  SMART_SETTINGS: 'smart_settings_lock',
  VAULT_UNLOCK_LOCKOUT: 'vault_unlock_lockout',
  GESTURE_TOKENS: 'gesture_tokens_lock',
  VAULT_ACTIVITY: 'vault_activity_lock',
  SYNC_MIRRORING: '_sync_mirroring_lock',
} as const;

export type LockName = (typeof LOCKS)[keyof typeof LOCKS] | (string & Record<never, never>);

/** Tasks actively running inside their cross-context critical sections. */
const heldTaskCounts = new Map<string, number>();

/** TTL for interrupted background session guards (not used for mutexes). */
export const PERSISTENT_LOCK_TTL_MS = 30_000;

/** Default Web Locks acquire timeout. */
export const WEB_LOCKS_REQUEST_TIMEOUT_MS = 10_000;
const WEB_LOCKS_TIMEOUT_OVERRIDES = new Map<string, number>();

// IndexedDB is the cross-context fallback for browsers without Web Locks. A
// read/write transaction is exclusive for its object store and is released by
// the browser if its owning document/worker closes. Keep each named lock in a
// separate store so unrelated locks (including nested locks) remain usable.
const FALLBACK_LOCK_DB = '1click-cross-context-locks';
const FALLBACK_LOCK_DB_VERSION = 1;
const FALLBACK_LOCK_STORE_PREFIX = 'lock:';
const FALLBACK_LOCK_KEEPALIVE_KEY = '__keepalive__';
const FALLBACK_LOCK_NAMES = new Set([
  ...Object.values(LOCKS),
  'activity_events_lock',
  'analytics_lock',
  'archive_alarm_lock',
  'archive_schedule_lock',
  'site_rules_lock',
  'mailbox_rules_lock',
  'autofill_blocklist_lock',
  'background_storage_write_lock',
  'clipboard_purge_lock',
  'email_labels_lock',
  'latest_otp_lock',
  'vault_rekey_lock',
  'content_reload_required_tabs_lock',
]);
let fallbackLockDbPromise: Promise<IDBDatabase> | undefined;

function fallbackLockStoreName(lockName: string): string {
  // WebMCP uses one lock per action. Unknown names share a safe fallback store;
  // this can serialize unrelated custom locks, but never weakens exclusion.
  const knownName =
    lockName.startsWith('webmcp_') && lockName.endsWith('_cooldown_lock')
      ? 'webmcp_action_cooldown_lock'
      : FALLBACK_LOCK_NAMES.has(lockName)
        ? lockName
        : '__unknown_lock__';
  return `${FALLBACK_LOCK_STORE_PREFIX}${knownName}`;
}

function openFallbackLockDatabase(): Promise<IDBDatabase> {
  if (fallbackLockDbPromise) return fallbackLockDbPromise;
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(
      new Error('IndexedDB unavailable; refusing to run without cross-context exclusion')
    );
  }

  fallbackLockDbPromise = new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(FALLBACK_LOCK_DB, FALLBACK_LOCK_DB_VERSION);
    } catch (error) {
      fallbackLockDbPromise = undefined;
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const lockName of FALLBACK_LOCK_NAMES) {
        const storeName = `${FALLBACK_LOCK_STORE_PREFIX}${lockName}`;
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
      }
      for (const storeName of [
        `${FALLBACK_LOCK_STORE_PREFIX}webmcp_action_cooldown_lock`,
        `${FALLBACK_LOCK_STORE_PREFIX}__unknown_lock__`,
      ]) {
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        fallbackLockDbPromise = undefined;
      };
      resolve(db);
    };
    request.onerror = () => {
      fallbackLockDbPromise = undefined;
      reject(request.error ?? new Error('Failed to open IndexedDB lock database'));
    };
  });
  return fallbackLockDbPromise;
}

/** Test helper - close the cached IndexedDB connection between fallback tests. */
export async function __resetIndexedDbFallbackForTests(): Promise<void> {
  const dbPromise = fallbackLockDbPromise;
  fallbackLockDbPromise = undefined;
  if (!dbPromise) return;
  try {
    (await dbPromise).close();
  } catch {
    // A failed database open has no connection to close.
  }
}

/** Cross-context fallback that holds an exclusive IDB transaction for the task. */
export async function requestIndexedDbLock<T>(
  lockName: string,
  callback: () => Promise<T>,
  timeoutMs: number = WEB_LOCKS_REQUEST_TIMEOUT_MS
): Promise<T> {
  const db = await openFallbackLockDatabase();
  const storeName = fallbackLockStoreName(lockName);

  return new Promise<T>((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = db.transaction(storeName, 'readwrite');
    } catch (error) {
      reject(error);
      return;
    }

    const store = transaction.objectStore(storeName);
    let keepAlive = true;
    let callbackStarted = false;
    let callbackSettled = false;
    let callbackFailed = false;
    let transactionSettled = false;
    let callbackValue: T;
    let callbackError: unknown;
    let transactionError: unknown;
    const finish = () => {
      if (!callbackSettled || !transactionSettled) return;
      if (callbackFailed) reject(callbackError);
      else if (transactionError !== undefined) reject(transactionError);
      else resolve(callbackValue);
    };

    const acquireTimer = setTimeout(() => {
      if (callbackStarted) return;
      transactionError = new Error(`IndexedDB lock acquisition timeout after ${timeoutMs / 1000}s`);
      try {
        transaction.abort();
      } catch {
        // The transaction may already be aborting; its events settle the request.
      }
    }, timeoutMs);

    const keepTransactionAlive = () => {
      if (!keepAlive) return;
      let request: IDBRequest;
      try {
        request = store.get(FALLBACK_LOCK_KEEPALIVE_KEY);
      } catch (error) {
        keepAlive = false;
        transactionError = error;
        return;
      }
      request.onsuccess = keepTransactionAlive;
      request.onerror = () => {
        keepAlive = false;
        transactionError = request.error ?? new Error('IndexedDB lock keepalive failed');
      };
    };

    const acquireRequest = store.get(FALLBACK_LOCK_KEEPALIVE_KEY);
    acquireRequest.onsuccess = () => {
      if (transactionError !== undefined) return;
      callbackStarted = true;
      clearTimeout(acquireTimer);
      keepTransactionAlive();
      Promise.resolve()
        .then(callback)
        .then(
          (value) => {
            callbackValue = value;
            callbackSettled = true;
            keepAlive = false;
            finish();
          },
          (error: unknown) => {
            callbackError = error;
            callbackFailed = true;
            callbackSettled = true;
            keepAlive = false;
            finish();
          }
        );
    };
    acquireRequest.onerror = () => {
      clearTimeout(acquireTimer);
      transactionError = acquireRequest.error ?? new Error('IndexedDB lock acquisition failed');
      callbackSettled = true;
      keepAlive = false;
      finish();
    };
    transaction.oncomplete = () => {
      clearTimeout(acquireTimer);
      transactionSettled = true;
      if (!callbackStarted) {
        callbackSettled = true;
        transactionError ??= new Error('IndexedDB lock ended before acquisition');
      }
      finish();
    };
    transaction.onabort = () => {
      clearTimeout(acquireTimer);
      transactionSettled = true;
      transactionError ??= transaction.error ?? new Error('IndexedDB lock transaction aborted');
      if (!callbackStarted) callbackSettled = true;
      finish();
    };
    transaction.onerror = () => {
      transactionError ??= transaction.error ?? new Error('IndexedDB lock transaction failed');
    };
  });
}

/** Opt a lock name into a custom Web Locks acquire timeout. */
export function setWebLocksTimeout(lockName: LockName, timeoutMs: number | undefined): void {
  if (timeoutMs === undefined) {
    WEB_LOCKS_TIMEOUT_OVERRIDES.delete(lockName);
    return;
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(
      `setWebLocksTimeout: timeoutMs must be a positive finite number, got ${timeoutMs}`
    );
  }
  WEB_LOCKS_TIMEOUT_OVERRIDES.set(lockName, timeoutMs);
}

/** Effective Web Locks acquire timeout for a lock name. */
export function getWebLocksTimeout(lockName: LockName): number {
  return WEB_LOCKS_TIMEOUT_OVERRIDES.get(lockName) ?? WEB_LOCKS_REQUEST_TIMEOUT_MS;
}

/** Test helper - clear all per-lock Web Locks timeout overrides. */
export function __clearWebLocksTimeoutOverridesForTests(): void {
  WEB_LOCKS_TIMEOUT_OVERRIDES.clear();
}

export interface WebLocksLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
  request<T>(
    name: string,
    options: { signal?: AbortSignal },
    callback: () => Promise<T>
  ): Promise<T>;
}

function getWebLocks(): WebLocksLike | null {
  try {
    const locks = (globalThis as { navigator?: { locks?: WebLocksLike } }).navigator?.locks;
    return locks && typeof locks.request === 'function' ? locks : null;
  } catch {
    return null;
  }
}

/** Request a Web Lock with a bounded wait; never retries a granted callback. */
export async function requestWebLockWithTimeout<T>(
  webLocks: WebLocksLike,
  lockName: string,
  callback: () => Promise<T>,
  timeoutMs: number = WEB_LOCKS_REQUEST_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await webLocks.request(lockName, { signal: controller.signal }, callback);
  } finally {
    clearTimeout(timer);
  }
}

/** True while a task is active in this context. Web Locks covers other contexts. */
export function isLockHeld(lockName: LockName): boolean {
  return (heldTaskCounts.get(lockName) ?? 0) > 0;
}

/** Run under a named cross-context lock; reject instead of running unlocked. */
export async function withLock<T>(lockName: LockName, task: () => Promise<T>): Promise<T> {
  let mutex = namedMutexes.get(lockName);
  if (!mutex) {
    mutex = new Mutex();
    namedMutexes.set(lockName, mutex);
  }

  const runTaskWithHeldMarker = async (): Promise<T> => {
    heldTaskCounts.set(lockName, (heldTaskCounts.get(lockName) ?? 0) + 1);
    try {
      return await task();
    } finally {
      const remaining = (heldTaskCounts.get(lockName) ?? 1) - 1;
      if (remaining > 0) heldTaskCounts.set(lockName, remaining);
      else heldTaskCounts.delete(lockName);
    }
  };

  return mutex.runExclusive(async () => {
    const webLocks = getWebLocks();
    if (!webLocks) {
      return requestIndexedDbLock(lockName, runTaskWithHeldMarker, getWebLocksTimeout(lockName));
    }
    return requestWebLockWithTimeout(
      webLocks,
      `1click:${lockName}`,
      runTaskWithHeldMarker,
      getWebLocksTimeout(lockName)
    );
  });
}
/**
 * Helper lock specifically for address storage operations.
 */
export async function withAddressLock<T>(task: () => Promise<T>): Promise<T> {
  return withLock(LOCKS.ADDRESS_STORAGE, task);
}

/**
 * Coalesces concurrent identical tasks behind one shared promise.
 *
 * NOT a lock: callers never wait in a queue for their own turn - while a task
 * for a key is in flight, later callers with the same key SHARE its promise
 * instead of starting a second run. A settled result stays retained for
 * `ttlMs` after completion, so a burst that starts just after completion
 * still shares it (bounded staleness by design); after the TTL the next
 * caller starts fresh. Rejections propagate to every sharer, and the entry
 * is retained for the TTL afterwards too - a retry storm against a failing
 * task is bounded the same way as a success burst.
 *
 * In-memory only (like the Mutex queue): a service-worker restart empties
 * the map, which is always safe - the worst case is one extra run.
 */
export class InFlightCoalescer {
  private readonly ttlMs: number;
  private readonly entries = new Map<string, { promise: Promise<unknown> }>();
  private readonly onReuse?: (key: string) => void;

  constructor(ttlMs: number, onReuse?: (key: string) => void) {
    this.ttlMs = ttlMs;
    this.onReuse = onReuse;
  }

  /** Share the in-flight (or TTL-retained) run for `key`, or start one. */
  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const existing = this.entries.get(key);
    if (existing) {
      this.onReuse?.(key);
      return existing.promise as Promise<T>;
    }
    const promise = task().finally(() => {
      // Retain the settled result for the TTL, then drop it so the next
      // caller starts fresh. The identity guard keeps a late timer from
      // deleting an entry that a newer run has legitimately replaced.
      setTimeout(() => {
        if (this.entries.get(key)?.promise === promise) this.entries.delete(key);
      }, this.ttlMs);
    });
    // Set synchronously: promise callbacks run as microtasks, so no coalesced
    // caller can observe the map before the entry exists.
    this.entries.set(key, { promise });
    return promise as Promise<T>;
  }

  /**
   * Drop one entry (write-through invalidation). An in-flight task is NOT
   * cancelled - current sharers keep the shared promise - but the next caller
   * starts a fresh run instead of sharing the stale retained result.
   */
  delete(key: string): void {
    this.entries.delete(key);
  }

  /** Drop every entry (test reset). In-flight tasks are NOT cancelled. */
  clear(): void {
    this.entries.clear();
  }

  /** True while a run for `key` is in flight or TTL-retained. */
  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** Snapshot of live keys (in-flight + retained) - for precise invalidation scans. */
  keys(): string[] {
    return [...this.entries.keys()];
  }
}

export interface TtlReadCacheOptions<K> {
  /**
   * Single home for the cache-key encoding: reads and write-through
   * invalidations both derive their entries from it, so the key spelling
   * cannot drift between the read handler and the write handlers.
   */
  encodeKey: (input: K) => string;
  /** Telemetry - invoked when a caller shares an in-flight or TTL-retained run. */
  onReuse?: (key: string) => void;
  /**
   * Telemetry - invoked ONLY when the underlying task actually starts (a
   * cache miss: no in-flight run, nothing TTL-retained). Never fired for
   * sharers, so `onReuse`/`onRun` pairs give the exact hit-rate of the cache
   * (hits ÷ (hits + runs)) without instrumenting the task itself.
   */
  onRun?: (key: string) => void;
}

/**
 * A keyed TTL read-cache built on `InFlightCoalescer`.
 *
 * `run`/`has` inherit the coalescer's contract exactly: concurrent identical
 * reads share one task run, a settled result stays retained for `ttlMs`, and
 * rejections are retained on the same terms. What the cache ADDS is the
 * write-invalidate half of the contract:
 *
 * - `invalidate(input)` - write-through invalidation for the entity a write
 *   path just rewrote, keyed through the same `encodeKey` as reads.
 * - `invalidateAll()` - drop every entry (a writer that rewrote the cache's
 *   whole domain of truth, e.g. a backup import).
 * - `invalidateWhere(predicate)` - precise invalidation over the live keys
 *   (a write that intersects only SOME retained entries).
 *
 * In-flight tasks are never cancelled (coalescer semantics): their sharers
 * keep the shared promise; the next caller after any invalidation starts a
 * fresh run. In-memory only - a service-worker restart empties the cache,
 * which is always safe (worst case one extra run).
 */
export class TtlReadCache<K> {
  private readonly coalescer: InFlightCoalescer;
  private readonly encodeKey: (input: K) => string;
  private readonly onRun?: (key: string) => void;

  constructor(ttlMs: number, options: TtlReadCacheOptions<K>) {
    this.coalescer = new InFlightCoalescer(ttlMs, options.onReuse);
    this.encodeKey = options.encodeKey;
    this.onRun = options.onRun;
  }

  /**
   * Share the in-flight (or TTL-retained) run for `input`, or start one.
   * The task wrapper is what makes `onRun` exact: the coalescer invokes the
   * task only when it starts a fresh run (sharers receive the shared
   * promise without touching the task), so the hook fires exactly on cache
   * misses - including a retry after a retained failure, which is real
   * background work and belongs in the denominator.
   */
  run<T>(input: K, task: () => Promise<T>): Promise<T> {
    const onRun = this.onRun;
    if (!onRun) return this.coalescer.run(this.encodeKey(input), task);
    const key = this.encodeKey(input);
    return this.coalescer.run(key, () => {
      onRun(key);
      return task();
    });
  }

  /** Write-through invalidation for exactly the read `input` would produce. */
  invalidate(input: K): void {
    this.coalescer.delete(this.encodeKey(input));
  }

  /** Drop every entry (the cache's whole domain of truth was rewritten). */
  invalidateAll(): void {
    this.coalescer.clear();
  }

  /** Drop only the live entries whose key matches `predicate`. */
  invalidateWhere(predicate: (key: string) => boolean): void {
    for (const key of this.coalescer.keys()) {
      if (predicate(key)) this.coalescer.delete(key);
    }
  }

  /** True while a run for `input` is in flight or TTL-retained. */
  has(input: K): boolean {
    return this.coalescer.has(this.encodeKey(input));
  }
}

/** Test helper - clear in-memory mutex registry (does not touch storage.session). */
export function __clearMutexRegistryForTests(): void {
  namedMutexes.clear();
}
