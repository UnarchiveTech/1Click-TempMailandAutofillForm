import { afterAll, describe, expect, mock, test } from 'bun:test';
import { StorageWriteError } from '@/utils/errors.js';
import {
  areaOf,
  classifyStorageWriteError,
  isQuotaStorageError,
  removeAreaOf,
  removeWithRetry,
  STORAGE_WRITE_RETRY,
  type StorageWriteArea,
  writeWithRetry,
} from '@/utils/storage/storage-write.js';

interface FakeArea extends StorageWriteArea {
  calls: number;
  store: Record<string, unknown>;
  /** Errors to throw, one per call; an exhausted list means "write succeeds". */
  failures: unknown[];
}

function fakeArea(failures: unknown[] = []): FakeArea {
  const area: FakeArea = {
    calls: 0,
    store: {},
    failures,
    set: async (items: Record<string, unknown>) => {
      area.calls += 1;
      if (area.failures.length > 0) throw area.failures.shift();
      Object.assign(area.store, items);
    },
  };
  return area;
}

/** Deterministic seams: no real sleeping, no jitter. */
function seams(delays: number[]) {
  return {
    sleep: async (ms: number) => {
      delays.push(ms);
    },
    random: () => 0.5,
  };
}

const HICCUP = new Error('Failed to write to storage');

test('injected native storage methods retain their StorageArea receiver', async () => {
  const local = {
    items: {} as Record<string, unknown>,
    async set(items: Record<string, unknown>) {
      expect(this).toBe(local);
      Object.assign(this.items, items);
    },
    async remove(keys: string | string[]) {
      expect(this).toBe(local);
      for (const key of Array.isArray(keys) ? keys : [keys]) delete this.items[key];
    },
  };
  const ext = { storage: { local } };
  await writeWithRetry({ restored: true }, areaOf(ext));
  expect(local.items.restored).toBe(true);
  await removeWithRetry('restored', removeAreaOf(ext));
  expect(local.items).toEqual({});
});

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});

/**
 * The area a call with NO explicit area resolves. `wxt/browser` is the seam the
 * app's storage code resolves first, so this file replaces it AND the live
 * global, pointed at one mutable area - a test cannot know which seam wins
 * (another file's mock can leak), and installing only one would make the result
 * depend on that.
 */
let liveArea: FakeArea;
const browserFake = {
  storage: {
    local: {
      get: async () => ({}),
      set: async (items: Record<string, unknown>) => liveArea.set(items),
      // A real area has `remove`; `removeWithRetry` resolves through the same
      // seam as the write path, so the fake must not be the only one missing it.
      remove: async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete liveArea.store[k];
      },
    },
  },
};
mock.module('wxt/browser', () => ({ browser: browserFake }));
Object.assign(globalThis, { browser: browserFake });

describe('classifyStorageWriteError', () => {
  test('total-quota exhaustion is retryable (another context can free the bytes)', () => {
    expect(classifyStorageWriteError(new Error('QUOTA_BYTES quota exceeded'))).toBe('quota');
    expect(
      classifyStorageWriteError(new Error('storage.local.set: the quota has been exceeded'))
    ).toBe('quota');
    // Firefox/Safari name it without a 'quota' substring.
    expect(classifyStorageWriteError({ name: 'QuotaExceededError', message: 'nope' })).toBe(
      'quota'
    );
    expect(classifyStorageWriteError({ code: 22, message: 'nope' })).toBe('quota');
  });

  test('per-item quota is permanent - replaying the identical payload cannot help', () => {
    expect(classifyStorageWriteError(new Error('QUOTA_BYTES_PER_ITEM quota exceeded'))).toBe(
      'permanent'
    );
    expect(classifyStorageWriteError(new Error('QUOTA_BYTES per item quota exceeded'))).toBe(
      'permanent'
    );
  });

  test('an invalidated extension context is permanent', () => {
    expect(classifyStorageWriteError(new Error('Extension context invalidated.'))).toBe(
      'permanent'
    );
  });

  test('an unrecognised failure is treated as retryable, not as a permanent one', () => {
    expect(classifyStorageWriteError(new Error('I/O error'))).toBe('transient');
    expect(classifyStorageWriteError(null)).toBe('transient');
    expect(classifyStorageWriteError('boom')).toBe('transient');
  });
});

describe('isQuotaStorageError', () => {
  test('sees through the wrapper a retried write throws', () => {
    const wrapped = new StorageWriteError(
      'storedEmailsByAddress_a1',
      { attempts: 4 },
      new Error('QUOTA_BYTES quota exceeded')
    );
    expect(isQuotaStorageError(wrapped)).toBe(true);
    expect(isQuotaStorageError(new Error('QUOTA_BYTES_PER_ITEM quota exceeded'))).toBe(true);
  });

  test('is false for a non-quota failure and for an empty value', () => {
    expect(isQuotaStorageError(new Error('Failed to write to storage'))).toBe(false);
    expect(isQuotaStorageError(undefined)).toBe(false);
  });
});

describe('writeWithRetry', () => {
  test('a one-off hiccup never reaches the caller', async () => {
    const area = fakeArea([HICCUP]);
    const delays: number[] = [];

    await writeWithRetry({ k: 1 }, { area, ...seams(delays) });

    expect(area.calls).toBe(2);
    expect(area.store).toEqual({ k: 1 });
    // First step of the backoff, unjittered.
    expect(delays).toEqual([STORAGE_WRITE_RETRY.baseDelayMs]);
  });

  test('a quota failure is retried too (space can free up between attempts)', async () => {
    const area = fakeArea([new Error('QUOTA_BYTES quota exceeded')]);
    const kinds: string[] = [];

    await writeWithRetry({ k: 1 }, { area, ...seams([]), onRetry: ({ kind }) => kinds.push(kind) });

    expect(area.calls).toBe(2);
    expect(kinds).toEqual(['quota']);
  });

  test('backoff doubles per attempt, and the final attempt never sleeps after itself', async () => {
    const area = fakeArea([HICCUP, HICCUP, HICCUP, HICCUP]);
    const delays: number[] = [];

    await expect(writeWithRetry({ k: 1 }, { area, ...seams(delays) })).rejects.toThrowError(
      StorageWriteError
    );

    // Also the self-consistency check on the defaults: four attempts need
    // 50 + 100 + 200 ms, so the default budget must not cut the policy short.
    expect(area.calls).toBe(STORAGE_WRITE_RETRY.attempts);
    expect(delays).toEqual([50, 100, 200]);
    expect(delays.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(
      STORAGE_WRITE_RETRY.maxTotalDelayMs
    );
  });

  test('worst-case jitter clamps the last step instead of dropping an attempt', async () => {
    // Without the clamp this is the flake: 50 + 100 + 200 ms nominal, jittered
    // ×1.25 = 437 ms, would cross the 400 ms budget and silently cost the 4th try.
    const area = fakeArea([HICCUP, HICCUP, HICCUP, HICCUP]);
    const delays: number[] = [];

    await writeWithRetry(
      { k: 1 },
      {
        area,
        sleep: async (ms) => void delays.push(ms),
        random: () => 1,
      }
    ).catch(() => {});

    expect(area.calls).toBe(STORAGE_WRITE_RETRY.attempts);
    expect(delays.reduce((sum, ms) => sum + ms, 0)).toBe(STORAGE_WRITE_RETRY.maxTotalDelayMs);
  });

  test('a permanent failure is reported after ONE attempt, with no backoff', async () => {
    const area = fakeArea([new Error('QUOTA_BYTES_PER_ITEM quota exceeded'), HICCUP]);
    const delays: number[] = [];

    const error = await writeWithRetry({ k: 1 }, { area, ...seams(delays) }).catch((e) => e);

    expect(area.calls).toBe(1);
    expect(delays).toEqual([]);
    expect(error).toBeInstanceOf(StorageWriteError);
    expect(error.context?.kind).toBe('permanent');
  });

  test('the backoff budget caps how long a retry may hold a lock', async () => {
    const area = fakeArea([HICCUP, HICCUP, HICCUP, HICCUP, HICCUP, HICCUP]);
    const delays: number[] = [];

    await writeWithRetry(
      { k: 1 },
      {
        area,
        attempts: 10,
        baseDelayMs: 50,
        maxDelayMs: 400,
        maxTotalDelayMs: 300,
        ...seams(delays),
      }
    ).catch(() => {});

    // 50 + 100 = 150 fits the 300 ms budget; the next 200 ms step is clamped to
    // the 150 ms that is left, and after that the budget is spent.
    expect(delays).toEqual([50, 100, 150]);
    expect(area.calls).toBe(4);
    expect(delays.reduce((sum, ms) => sum + ms, 0)).toBe(300);
  });

  test('jitter stays inside its band and every delay is at least 1 ms', async () => {
    const low = fakeArea([HICCUP]);
    const high = fakeArea([HICCUP]);
    const lowDelays: number[] = [];
    const highDelays: number[] = [];

    await writeWithRetry(
      { k: 1 },
      { area: low, sleep: async (ms) => void lowDelays.push(ms), random: () => 0 }
    );
    await writeWithRetry(
      { k: 1 },
      { area: high, sleep: async (ms) => void highDelays.push(ms), random: () => 1 }
    );

    expect(lowDelays).toEqual([Math.round(50 * 0.75)]);
    expect(highDelays).toEqual([Math.round(50 * 1.25)]);
  });

  test('the exhausted failure carries the keys, the attempt count and the browser error', async () => {
    const area = fakeArea([HICCUP, HICCUP, HICCUP, HICCUP]);

    const error = await writeWithRetry(
      { 'a@example.com': [1], 'b@example.com': [2] },
      { area, ...seams([]) }
    ).catch((e) => e);

    expect(error).toBeInstanceOf(StorageWriteError);
    expect(error.context?.keys).toEqual(['a@example.com', 'b@example.com']);
    expect(error.context?.attempts).toBe(4);
    expect(error.originalError).toBe(HICCUP);
    // The app's own localized key, so a caller's toast keeps saying what it said.
    expect(error.translationKey).toBe('errors.storageWriteFailed');
  });

  test('an empty payload is not a storage round trip', async () => {
    const area = fakeArea();
    await writeWithRetry({}, { area, ...seams([]) });
    expect(area.calls).toBe(0);
  });

  test('with no area injected it writes through the resolved storage area', async () => {
    const area = fakeArea([HICCUP]);
    liveArea = area;

    await writeWithRetry({ k: 'live' }, seams([]));

    expect(area.calls).toBe(2);
    expect(area.store).toEqual({ k: 'live' });
  });
});

describe('removeWithRetry - the same policy for a removal', () => {
  interface FakeRemoveArea {
    calls: number;
    removed: string[][];
    /** Errors to throw, one per call; an exhausted list means "remove succeeds". */
    failures: unknown[];
    remove: (keys: string | string[]) => Promise<void>;
  }

  function fakeRemoveArea(failures: unknown[] = []): FakeRemoveArea {
    const area: FakeRemoveArea = {
      calls: 0,
      removed: [],
      failures,
      remove: async (keys: string | string[]) => {
        area.calls += 1;
        if (area.failures.length > 0) throw area.failures.shift();
        area.removed.push(Array.isArray(keys) ? keys : [keys]);
      },
    };
    return area;
  }

  test('a transient failure is retried and the removal lands', async () => {
    const area = fakeRemoveArea([HICCUP]);
    const delays: number[] = [];

    await removeWithRetry(['a', 'b'], { area, ...seams(delays) });

    expect(area.calls).toBe(2);
    expect(area.removed).toEqual([['a', 'b']]);
    expect(delays).toEqual([STORAGE_WRITE_RETRY.baseDelayMs]);
  });

  test('a permanent failure is not retried and surfaces as StorageWriteError', async () => {
    const area = fakeRemoveArea([new Error('QUOTA_BYTES_PER_ITEM quota exceeded')]);

    const error = await removeWithRetry('k', { area }).catch((e) => e);

    expect(error).toBeInstanceOf(StorageWriteError);
    // The write path's own key, so a caller's toast keeps saying what it said.
    expect(error.translationKey).toBe('errors.storageWriteFailed');
    expect(area.calls).toBe(1);
  });

  test('a single key string is accepted, and an empty list is not a round trip', async () => {
    const area = fakeRemoveArea();

    await removeWithRetry('k', { area });
    await removeWithRetry([], { area });

    expect(area.removed).toEqual([['k']]);
  });

  test('with no area injected it removes through the resolved storage area', async () => {
    const area = fakeArea();
    liveArea = area;
    area.store.k = 'v';

    await removeWithRetry('k', seams([]));

    expect(area.store).toEqual({});
  });
});
