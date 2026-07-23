/**
 * Lightweight in-memory Async Mutex lock to prevent race conditions
 * in concurrent read-modify-write operations.
 */
class Mutex {
  private queue: Promise<void> = Promise.resolve();

  /**
   * Acquire lock and execute the provided task sequentially.
   */
  async runExclusive<T>(task: () => Promise<T>): Promise<T> {
    let release: () => void = () => {};
    const lock = new Promise<void>((resolve) => {
      release = resolve;
    });

    const currentQueue = this.queue;
    this.queue = this.queue.then(() => lock);

    await currentQueue;

    try {
      return await task();
    } finally {
      release();
    }
  }
}

const namedMutexes = new Map<string, Mutex>();

/**
 * Run an async function within a named lock context.
 */
export async function withLock<T>(lockName: string, task: () => Promise<T>): Promise<T> {
  let mutex = namedMutexes.get(lockName);
  if (!mutex) {
    mutex = new Mutex();
    namedMutexes.set(lockName, mutex);
  }
  return mutex.runExclusive(task);
}

/**
 * Helper lock specifically for inbox storage operations.
 */
export async function withInboxLock<T>(task: () => Promise<T>): Promise<T> {
  return withLock('inbox_storage_lock', task);
}
