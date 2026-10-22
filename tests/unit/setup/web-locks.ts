/**
 * Minimal same-process Web Locks shim for Bun tests. Production code uses the
 * browser implementation; this shim serializes named critical sections so
 * unit tests exercise the same `withLock` contract.
 */
type LockRequestOptions = { signal?: AbortSignal };

const tails = new Map<string, Promise<void>>();

const locks = {
  async request<T>(
    name: string,
    optionsOrCallback: LockRequestOptions | (() => Promise<T>),
    maybeCallback?: () => Promise<T>
  ): Promise<T> {
    const options = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
    if (!callback) throw new TypeError('Web Locks request requires a callback');

    const predecessor = tails.get(name) ?? Promise.resolve();
    let release!: () => void;
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = predecessor.then(() => turn);
    tails.set(name, tail);

    try {
      const signal = options?.signal;
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (signal) {
        await Promise.race([
          predecessor,
          new Promise<never>((_, reject) => {
            signal.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true }
            );
          }),
        ]);
      } else {
        await predecessor;
      }
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return await callback();
    } finally {
      release();
      if (tails.get(name) === tail) tails.delete(name);
    }
  },
};

Object.defineProperty(globalThis.navigator, 'locks', {
  configurable: true,
  value: locks,
  writable: true,
});
