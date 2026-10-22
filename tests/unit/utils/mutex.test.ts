import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  __clearMutexRegistryForTests,
  __clearWebLocksTimeoutOverridesForTests,
  __resetIndexedDbFallbackForTests,
  getWebLocksTimeout,
  Mutex,
  requestIndexedDbLock,
  requestWebLockWithTimeout,
  setWebLocksTimeout,
  WEB_LOCKS_REQUEST_TIMEOUT_MS,
  type WebLocksLike,
  withLock,
} from '@/utils/mutex.js';

function createFakeIndexedDb() {
  const storeQueues = new Map<string, Promise<void>>();
  const database = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => ({}),
    close: () => {},
    transaction: (storeName: string) => {
      const previous = storeQueues.get(storeName) ?? Promise.resolve();
      let releaseStore!: () => void;
      const heldStore = new Promise<void>((resolve) => (releaseStore = resolve));
      storeQueues.set(
        storeName,
        previous.then(() => heldStore)
      );
      let pending = 0;
      let complete = false;
      let acquired = false;
      let processing = false;
      const requests: Record<string, unknown>[] = [];
      const transaction: Record<string, unknown> = {
        error: null,
        abort: () => {
          if (complete) return;
          previous.then(() => {
            if (complete) return;
            complete = true;
            releaseStore();
            (transaction.onabort as (() => void) | null)?.();
          });
        },
        objectStore: () => ({
          get: () => {
            const request: Record<string, unknown> = { result: undefined, error: null };
            pending += 1;
            requests.push(request);
            processNext();
            return request;
          },
        }),
      };
      const maybeComplete = () => {
        if (!complete && acquired && pending === 0 && requests.length === 0) {
          complete = true;
          releaseStore();
          queueMicrotask(() => (transaction.oncomplete as (() => void) | null)?.());
        }
      };
      const processNext = () => {
        if (!acquired || processing || requests.length === 0 || complete) return;
        processing = true;
        const request = requests.shift();
        if (!request) {
          processing = false;
          maybeComplete();
          return;
        }
        setTimeout(() => {
          (request.onsuccess as (() => void) | null)?.();
          pending -= 1;
          processing = false;
          processNext();
          maybeComplete();
        });
      };
      previous.then(() => {
        acquired = true;
        processNext();
        maybeComplete();
      });
      return transaction;
    },
  };
  return {
    open: () => {
      const request: Record<string, unknown> = { result: database, error: null };
      queueMicrotask(() => {
        (request.onupgradeneeded as (() => void) | null)?.();
        queueMicrotask(() => (request.onsuccess as (() => void) | null)?.());
      });
      return request;
    },
  };
}

/**
 * Regression: a waiter that times out behind a never-releasing holder must
 * not let later callers bypass the active holder. Once the holder eventually
 * releases, the timed-out queue nodes must release in order and leave the
 * mutex usable.
 */
describe('Mutex timeout recovery', () => {
  test('timed-out waiters preserve exclusion and the queue recovers after release', async () => {
    const mutex = new Mutex(25);

    // Holder A wedges the mutex indefinitely.
    let releaseA: () => void = () => {};
    const holdA = mutex.runExclusive(() => new Promise<void>((resolve) => (releaseA = resolve)));

    // Waiter B sits behind A and times out.
    const waiterB = mutex.runExclusive(async () => 'b');
    await expect(waiterB).rejects.toThrow(/timeout/i);

    // Caller C arrives AFTER B timed out, but must not bypass A.
    let cAcquired = false;
    const waiterC = mutex.runExclusive(async () => {
      cAcquired = true;
      return 'c';
    });
    await expect(waiterC).rejects.toThrow(/timeout/i);
    expect(cAcquired).toBe(false);

    // A's original task releases; queued timeout nodes drain without overlap.
    releaseA();
    await holdA;

    // The mutex stays usable afterwards.
    const resultD = await mutex.runExclusive(async () => 'd');
    expect(resultD).toBe('d');
  });

  test('normal acquisition still serializes and releases (no regression)', async () => {
    const mutex = new Mutex(100);
    const order: string[] = [];
    await Promise.all([
      mutex.runExclusive(async () => {
        order.push('a-start');
        await new Promise((r) => setTimeout(r, 10));
        order.push('a-end');
      }),
      mutex.runExclusive(async () => {
        order.push('b');
      }),
    ]);
    expect(order).toEqual(['a-start', 'a-end', 'b']);
  });
});

/**
 * withLock layers Web Locks over the in-memory queue, and uses IndexedDB's
 * exclusive read/write transactions when the browser lacks Web Locks.
 */
describe('withLock cross-context locking behavior', () => {
  const sessionStore: Record<string, unknown> = {};
  const sessionKey = '__mutex_weblock_test';

  const fakeBrowser = {
    storage: {
      session: {
        get: async (keys?: string | string[] | null) => {
          if (keys === null || keys === undefined) return { ...sessionStore };
          const list = Array.isArray(keys) ? keys : [keys];
          const result: Record<string, unknown> = {};
          for (const key of list) if (key in sessionStore) result[key] = sessionStore[key];
          return result;
        },
        set: async (items: Record<string, unknown>) => {
          Object.assign(sessionStore, items);
        },
        remove: async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete sessionStore[key];
        },
      },
    },
  };

  const originalBrowser = (globalThis as { browser?: unknown }).browser;
  const originalIndexedDb = (globalThis as { indexedDB?: unknown }).indexedDB;
  const originalLocks = (globalThis as unknown as { navigator?: { locks?: unknown } }).navigator
    ?.locks;
  function setNavigatorLocks(locks: unknown): void {
    const nav = (globalThis as unknown as { navigator?: { locks?: unknown } }).navigator;
    if (nav)
      Object.defineProperty(nav, 'locks', { value: locks, configurable: true, writable: true });
  }

  beforeEach(() => {
    __clearMutexRegistryForTests();
    __clearWebLocksTimeoutOverridesForTests();
    for (const key of Object.keys(sessionStore)) delete sessionStore[key];
    (globalThis as { browser?: unknown }).browser = fakeBrowser;
    Object.defineProperty(globalThis, 'indexedDB', {
      value: createFakeIndexedDb(),
      configurable: true,
      writable: true,
    });
    setNavigatorLocks(undefined);
  });

  afterEach(async () => {
    await __resetIndexedDbFallbackForTests();
    setNavigatorLocks(originalLocks);
    if (originalBrowser === undefined) {
      delete (globalThis as { browser?: unknown }).browser;
    } else {
      (globalThis as { browser?: unknown }).browser = originalBrowser;
    }
    if (originalIndexedDb === undefined) {
      delete (globalThis as { indexedDB?: unknown }).indexedDB;
    } else {
      Object.defineProperty(globalThis, 'indexedDB', {
        value: originalIndexedDb,
        configurable: true,
        writable: true,
      });
    }
    for (const key of Object.keys(sessionStore)) delete sessionStore[key];
  });

  test('without navigator.locks it runs under the IndexedDB fallback lock', async () => {
    let taskRuns = 0;
    const result = await withLock('weblock_test', async () => {
      taskRuns += 1;
      return 'serialized';
    });
    expect(result).toBe('serialized');
    expect(taskRuns).toBe(1);
  });

  test('without Web Locks or IndexedDB it fails closed without running the task', async () => {
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
    await __resetIndexedDbFallbackForTests();
    let taskRuns = 0;
    await expect(
      withLock('weblock_test', async () => {
        taskRuns += 1;
      })
    ).rejects.toThrow(/indexeddb unavailable/i);
    expect(taskRuns).toBe(0);
  });

  test('IndexedDB fallback propagates task errors without retrying the task', async () => {
    sessionStore[sessionKey] = {
      holderId: 'other-context',
      acquiredAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };
    let taskRuns = 0;
    await expect(
      requestIndexedDbLock('weblock_test', async () => {
        taskRuns += 1;
        throw new Error('fallback task failed');
      })
    ).rejects.toThrow('fallback task failed');
    expect(taskRuns).toBe(1);
  });

  test('IndexedDB transactions serialize the same lock across contexts', async () => {
    let active = 0;
    let maximumActive = 0;
    const order: string[] = [];
    const run = (name: string) =>
      requestIndexedDbLock('weblock_test', async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        order.push(`${name}-start`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push(`${name}-end`);
        active -= 1;
      });

    await Promise.all([run('first'), run('second')]);
    expect(maximumActive).toBe(1);
    expect(order).toEqual(['first-start', 'first-end', 'second-start', 'second-end']);
  });

  test('granted web lock runs the task once under the lock and returns its result', async () => {
    const grantedLocks = {
      request: async <T>(_name: string, _opts: unknown, callback: () => Promise<T>): Promise<T> =>
        callback(),
    };
    setNavigatorLocks(grantedLocks);

    let taskRuns = 0;
    const result = await withLock('weblock_test', async () => {
      taskRuns += 1;
      return 42;
    });

    expect(result).toBe(42);
    expect(taskRuns).toBe(1);
    expect(sessionStore[sessionKey]).toBeUndefined();
  });

  test('wedged web-lock holder rejects without running the task', async () => {
    // Simulates the outcome of requestWebLockWithTimeout after the timeout:
    // the pending request is aborted (AbortError) before the callback ran.
    const wedgeLocks = {
      request: async <T>(
        _name: string,
        _opts: unknown,
        _callback: () => Promise<T>
      ): Promise<T> => {
        throw new DOMException('Aborted', 'AbortError');
      },
    };
    setNavigatorLocks(wedgeLocks);

    let taskRuns = 0;
    await expect(
      withLock('weblock_test', async () => {
        taskRuns += 1;
        return 'should-not-run';
      })
    ).rejects.toThrow(/abort/i);
    expect(taskRuns).toBe(0);
    expect(sessionStore[sessionKey]).toBeUndefined();
  });

  test('an error thrown by the task under a granted web lock propagates and never re-runs', async () => {
    const grantedLocks = {
      request: async <T>(_name: string, _opts: unknown, callback: () => Promise<T>): Promise<T> =>
        callback(),
    };
    setNavigatorLocks(grantedLocks);

    let taskRuns = 0;
    await expect(
      withLock('weblock_test', async () => {
        taskRuns += 1;
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(taskRuns).toBe(1);
  });

  test('setWebLocksTimeout overrides the default per lock name and clearing restores it', () => {
    try {
      expect(getWebLocksTimeout('weblock_test')).toBe(WEB_LOCKS_REQUEST_TIMEOUT_MS);
      setWebLocksTimeout('weblock_test', 500);
      expect(getWebLocksTimeout('weblock_test')).toBe(500);
      // Other lock names keep the default - the override is scoped by name.
      expect(getWebLocksTimeout('other_lock')).toBe(WEB_LOCKS_REQUEST_TIMEOUT_MS);
      setWebLocksTimeout('weblock_test', undefined);
      expect(getWebLocksTimeout('weblock_test')).toBe(WEB_LOCKS_REQUEST_TIMEOUT_MS);
    } finally {
      setWebLocksTimeout('weblock_test', undefined);
    }
  });

  test('setWebLocksTimeout rejects non-positive or non-finite values', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => setWebLocksTimeout('weblock_test', bad)).toThrow(/positive finite number/);
    }
    // Rejected values must not be registered.
    expect(getWebLocksTimeout('weblock_test')).toBe(WEB_LOCKS_REQUEST_TIMEOUT_MS);
  });

  test('a shortened per-lock timeout rejects quickly instead of waiting the default', async () => {
    // Faithful wedge: the request stays pending and only settles when the
    // AbortSignal fires - exactly what a real wedged cross-context holder
    // looks like to navigator.locks.request.
    const wedgeLocks: WebLocksLike = {
      request: <T>(
        _name: string,
        optionsOrCallback: { signal?: AbortSignal } | (() => Promise<T>),
        _maybeCallback?: () => Promise<T>
      ): Promise<T> => {
        if (typeof optionsOrCallback === 'function') {
          // 2-arg form - never used by requestWebLockWithTimeout.
          return optionsOrCallback();
        }
        return new Promise<T>((_resolve, reject) => {
          optionsOrCallback.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          );
        });
      },
    };
    setNavigatorLocks(wedgeLocks);

    try {
      setWebLocksTimeout('weblock_test', 25);
      const start = Date.now();
      let taskRuns = 0;
      await expect(
        withLock('weblock_test', async () => {
          taskRuns += 1;
          return 'should-not-run';
        })
      ).rejects.toThrow(/abort/i);
      expect(taskRuns).toBe(0);
      // The 25ms override was honored - with the 10s default this test would
      // time out long before rejection.
      expect(Date.now() - start).toBeLessThan(1000);
    } finally {
      setWebLocksTimeout('weblock_test', undefined);
    }
  });

  test('requestWebLockWithTimeout aborts a pending request and never starts the callback', async () => {
    const wedgeLocks: WebLocksLike = {
      request: <T>(
        _name: string,
        optionsOrCallback: { signal?: AbortSignal } | (() => Promise<T>),
        _maybeCallback?: () => Promise<T>
      ): Promise<T> => {
        if (typeof optionsOrCallback === 'function') {
          // 2-arg form - never used by requestWebLockWithTimeout.
          return optionsOrCallback();
        }
        return new Promise<T>((_resolve, reject) => {
          optionsOrCallback.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          );
        });
      },
    };

    let callbackInvoked = false;
    await expect(
      requestWebLockWithTimeout(
        wedgeLocks,
        'weblock_test',
        async () => {
          callbackInvoked = true;
          return 'never';
        },
        25
      )
    ).rejects.toThrow(/abort/i);
    expect(callbackInvoked).toBe(false);
  });
});
