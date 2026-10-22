/**
 * Bounded-concurrency fan-out: runs `task` over every item keeping at most
 * `limit` in flight at once, and returns the results in input order.
 *
 * The bound exists so a large batch can't stampede the network or hold a
 * shared lock for the duration of N sequential requests. Tasks are expected to
 * isolate their own failures (matching the failure-isolation contracts bulk
 * lifecycles rely on); an unhandled rejection from one task aborts the fan-out
 * exactly like an error in the middle of a sequential loop would.
 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const safeLimit = Math.max(1, Math.floor(limit));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex;
      if (index >= items.length) return;
      nextIndex += 1;
      results[index] = await task(items[index] as T, index);
    }
  };

  const workers = Array.from({ length: Math.min(safeLimit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
