/**
 * Unit tests for `InFlightCoalescer` (src/utils/mutex.ts).
 *
 * The primitive lets concurrent identical tasks share one run: while a task
 * for a key is in flight, later callers with the same key receive its promise
 * instead of starting a second run; a settled result stays retained for the
 * TTL so a burst just after completion still shares it; rejections propagate
 * to every sharer and are retained on the same terms, bounding retry storms.
 *
 * These tests pin the contract that makes the inbox-check coalescing safe:
 * one provider fetch for N simultaneous OTP panels, TTL-bounded staleness,
 * and per-key isolation.
 */

import { describe, expect, test } from 'bun:test';
import { InFlightCoalescer, TtlReadCache } from '@/utils/mutex.js';

/** Flush microtasks so promise continuations and `.finally` run. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('InFlightCoalescer', () => {
  test('concurrent calls share one run', async () => {
    let runs = 0;
    const coalescer = new InFlightCoalescer(50);
    const task = async (): Promise<number> => {
      runs += 1;
      await new Promise((r) => setTimeout(r, 5));
      return 42;
    };
    const [a, b, c] = await Promise.all([
      coalescer.run('k', task),
      coalescer.run('k', task),
      coalescer.run('k', task),
    ]);
    expect(runs).toBe(1);
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(c).toBe(42);
  });

  test('sequential calls after the TTL start fresh runs', async () => {
    let runs = 0;
    const coalescer = new InFlightCoalescer(20);
    const run = (): Promise<number> =>
      coalescer.run('k', async () => {
        runs += 1;
        return runs;
      });
    await run();
    await flush();
    await new Promise((r) => setTimeout(r, 40)); // past the TTL
    expect(await run()).toBe(2);
    expect(runs).toBe(2);
  });

  test('a burst within the TTL shares the retained result', async () => {
    let runs = 0;
    const coalescer = new InFlightCoalescer(5_000);
    const run = (): Promise<number> =>
      coalescer.run('k', async () => {
        runs += 1;
        return runs;
      });
    expect(await run()).toBe(1);
    expect(await run()).toBe(1); // retained, not re-run
    expect(runs).toBe(1);
  });

  test('rejections propagate to every sharer and are retained for the TTL', async () => {
    let runs = 0;
    const coalescer = new InFlightCoalescer(5_000);
    const run = (): Promise<number> =>
      coalescer.run('k', async () => {
        runs += 1;
        throw new Error('boom');
      });
    const p1 = run();
    const p2 = run();
    await expect(p1).rejects.toThrow('boom');
    await expect(p2).rejects.toThrow('boom');
    expect(runs).toBe(1);
    // Retained failure: a third caller inside the TTL shares the same reject.
    await expect(run()).rejects.toThrow('boom');
    expect(runs).toBe(1);
  });

  test('different keys never share', async () => {
    let runs = 0;
    const coalescer = new InFlightCoalescer(5_000);
    await Promise.all([
      coalescer.run('a', async () => {
        runs += 1;
        return 'A';
      }),
      coalescer.run('b', async () => {
        runs += 1;
        return 'B';
      }),
    ]);
    expect(runs).toBe(2);
  });

  test('has() tracks in-flight and retained state, clear() drops everything', async () => {
    const coalescer = new InFlightCoalescer(5_000);
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const p = coalescer.run('k', async () => {
      await gate;
      return 1;
    });
    expect(coalescer.has('k')).toBe(true);
    release();
    await p;
    expect(coalescer.has('k')).toBe(true); // retained
    coalescer.clear();
    expect(coalescer.has('k')).toBe(false);
  });

  test('a settled entry replaced inside the TTL survives the stale timer', async () => {
    // Custom clock-free proof: after clear() + re-run, the ORIGINAL entry's
    // timer must not delete the NEW one. Both entries share the same key, so
    // the identity guard (promise equality) is what protects the second run.
    const coalescer = new InFlightCoalescer(5_000);
    await coalescer.run('k', async () => 1);
    coalescer.clear();
    const second = coalescer.run('k', async () => 2);
    await second;
    expect(await coalescer.run('k', async () => 3)).toBe(2);
    coalescer.clear();
  });

  test('keys() snapshots in-flight and retained keys', async () => {
    const coalescer = new InFlightCoalescer(5_000);
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const pending = coalescer.run('in-flight', async () => {
      await gate;
      return 1;
    });
    await coalescer.run('retained', async () => 2);

    expect(coalescer.keys().sort()).toEqual(['in-flight', 'retained']);

    release();
    await pending;
    coalescer.clear();
    expect(coalescer.keys()).toEqual([]);
  });

  test('delete() invalidates one retained entry without touching others', async () => {
    const coalescer = new InFlightCoalescer(5_000);
    expect(await coalescer.run('a', async () => 1)).toBe(1);
    expect(await coalescer.run('b', async () => 2)).toBe(2);

    coalescer.delete('a');
    expect(coalescer.has('a')).toBe(false);
    expect(coalescer.has('b')).toBe(true);
    // Next caller for 'a' starts fresh instead of sharing the stale result.
    expect(await coalescer.run('a', async () => 11)).toBe(11);
    expect(await coalescer.run('b', async () => 22)).toBe(2); // still retained

    // Deleting an unknown key is a no-op.
    coalescer.delete('never-ran');
    coalescer.clear();
  });

  test('delete() lets an in-flight task finish; sharers keep its result', async () => {
    const coalescer = new InFlightCoalescer(5_000);
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const first = coalescer.run('k', async () => {
      await gate;
      return 'in-flight';
    });
    const sharer = coalescer.run('k', async () => 'never');

    coalescer.delete('k');
    // New callers start a fresh run immediately...
    expect(await coalescer.run('k', async () => 'fresh')).toBe('fresh');
    // ...while pre-delete sharers still receive the original run's result.
    release();
    expect(await first).toBe('in-flight');
    expect(await sharer).toBe('in-flight');
    coalescer.clear();
  });
});

describe('TtlReadCache', () => {
  interface Row {
    domain: string;
    tabId?: number | null;
  }
  const makeCache = (onReuse?: (key: string) => void): TtlReadCache<Row> =>
    new TtlReadCache<Row>(5_000, {
      encodeKey: ({ domain, tabId }) => `s|${domain}|${tabId ?? ''}`,
      onReuse,
    });

  test('run() shares one task for identical inputs; encodeKey normalizes them', async () => {
    let runs = 0;
    const cache = makeCache();
    const task = async (): Promise<string> => {
      runs += 1;
      return 'snap';
    };
    // Same domain+tab via distinct object identities - one key, one run.
    const [a, b, c] = await Promise.all([
      cache.run({ domain: 'x.com', tabId: 1 }, task),
      cache.run({ domain: 'x.com', tabId: 1 }, task),
      cache.run({ domain: 'x.com', tabId: 1 }, task),
    ]);
    expect(runs).toBe(1);
    expect([a, b, c]).toEqual(['snap', 'snap', 'snap']);
    // Tab-scoped: a different tab never shares.
    expect(await cache.run({ domain: 'x.com', tabId: 2 }, task)).toBe('snap');
    expect(runs).toBe(2);
  });

  test('invalidate() targets the encoded key; other entries survive', async () => {
    const cache = makeCache();
    let value = 1;
    const read = (tabId: number): Promise<number> =>
      cache.run({ domain: 'x.com', tabId }, async () => value);
    expect(await read(1)).toBe(1);
    expect(await read(2)).toBe(1);

    value = 2;
    // A stale retained read for tab 1 must go, but tab 2's is untouched.
    cache.invalidate({ domain: 'x.com', tabId: 1 });
    expect(await read(1)).toBe(2);
    expect(await read(2)).toBe(1);
  });

  test('invalidateAll() drops every entry; invalidateWhere() scans live keys', async () => {
    const cache = makeCache();
    let value = 1;
    const read = (tabId: number): Promise<number> =>
      cache.run({ domain: 'x.com', tabId }, async () => value);
    await Promise.all([read(1), read(2), read(3)]);

    value = 2;
    // Precise scan: drop only tab 2 (a partial write signal).
    cache.invalidateWhere((key) => key.endsWith('|2'));
    expect(await read(2)).toBe(2);
    expect(await read(1)).toBe(1); // still retained
    expect(await read(3)).toBe(1);

    // Whole-domain rewrite: everything goes.
    cache.invalidateAll();
    expect(await read(1)).toBe(2);
    expect(await read(3)).toBe(2);
  });

  test('has() reflects the encoded key; onReuse fires on shares', async () => {
    const reuseKeys: string[] = [];
    const cache = makeCache((key) => reuseKeys.push(key));
    await cache.run({ domain: 'a.com', tabId: 1 }, async () => 1);
    expect(cache.has({ domain: 'a.com', tabId: 1 })).toBe(true);
    expect(cache.has({ domain: 'a.com', tabId: 9 })).toBe(false);
    await cache.run({ domain: 'a.com', tabId: 1 }, async () => 1); // retained share
    expect(reuseKeys).toEqual(['s|a.com|1']);
    cache.invalidate({ domain: 'a.com', tabId: 1 });
    expect(cache.has({ domain: 'a.com', tabId: 1 })).toBe(false);
  });

  test('invalidate() never cancels an in-flight run; sharers keep its result', async () => {
    const cache = makeCache();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const first = cache.run({ domain: 'x.com', tabId: 1 }, async () => {
      await gate;
      return 'in-flight';
    });
    const sharer = cache.run({ domain: 'x.com', tabId: 1 }, async () => 'never');

    cache.invalidate({ domain: 'x.com', tabId: 1 });
    expect(await cache.run({ domain: 'x.com', tabId: 1 }, async () => 'fresh')).toBe('fresh');
    release();
    expect(await first).toBe('in-flight');
    expect(await sharer).toBe('in-flight');
    cache.invalidateAll();
  });

  test('onRun fires only on misses; onReuse fires only on shares', async () => {
    const runs: string[] = [];
    const reuses: string[] = [];
    const cache = new TtlReadCache<Row>(5_000, {
      encodeKey: ({ domain, tabId }) => `s|${domain}|${tabId ?? ''}`,
      onReuse: (k) => reuses.push(k),
      onRun: (k) => runs.push(k),
    });
    await cache.run({ domain: 'x.com', tabId: 1 }, async () => 1);
    await Promise.all([
      cache.run({ domain: 'x.com', tabId: 1 }, async () => 2),
      cache.run({ domain: 'x.com', tabId: 1 }, async () => 3),
    ]);
    // One miss, two sharers: hits ÷ (hits + runs) = 2/3 for this key.
    expect(runs).toEqual(['s|x.com|1']);
    expect(reuses).toEqual(['s|x.com|1', 's|x.com|1']);
    cache.invalidateAll();
  });

  test('onRun fires again after invalidation and after TTL expiry', async () => {
    const runs: string[] = [];
    const cache = new TtlReadCache<Row>(20, {
      encodeKey: ({ domain }) => `s|${domain}`,
      onRun: (k) => runs.push(k),
    });
    await cache.run({ domain: 'x.com' }, async () => 1);
    cache.invalidate({ domain: 'x.com' });
    await cache.run({ domain: 'x.com' }, async () => 2); // post-invalidate miss
    await new Promise((r) => setTimeout(r, 40)); // past the TTL
    await cache.run({ domain: 'x.com' }, async () => 3); // post-TTL miss
    expect(runs).toEqual(['s|x.com', 's|x.com', 's|x.com']);
    cache.invalidateAll();
  });

  test('a retained failure is a reuse, not a fresh run', async () => {
    const runs: string[] = [];
    let attempts = 0;
    const cache = new TtlReadCache<Row>(5_000, {
      encodeKey: ({ domain }) => `s|${domain}`,
      onRun: (k) => runs.push(k),
    });
    await expect(
      cache.run({ domain: 'x.com' }, async () => {
        attempts += 1;
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    // The failure is retained for the TTL: the next caller shares the
    // rejection (no second onRun - the coalescer saved a duplicate doomed
    // run) instead of retrying.
    await expect(
      cache.run({ domain: 'x.com' }, async () => {
        attempts += 1;
        return 'ok';
      })
    ).rejects.toThrow('boom');
    expect(attempts).toBe(1);
    expect(runs).toEqual(['s|x.com']);
    cache.invalidateAll();
  });
});
