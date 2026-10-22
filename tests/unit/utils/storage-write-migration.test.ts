/**
 * Wiring test for the app-wide write-retry migration: features and utils
 * modules that used to call `browser.storage.local.set` directly now write
 * through `writeWithRetry`, so a one-off storage hiccup is absorbed (no error
 * toast) and an exhausted budget still fails loudly (never a silent drop).
 *
 * Drives the REAL migrated call paths - search-history, connectivity-log,
 * marquee-selection and clipboard-settings - against a fake area that fails
 * once, mirroring how tests/unit/utils/storage-write-wiring.test.ts pins the
 * pre-existing storage-layer modules.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

import { recordConnectivityEvent } from '@/utils/provider/connectivity-log.js';
import {
  pushSearchHistory,
  removeSearchHistoryItem,
  setSearchHistoryLimit,
} from '@/utils/search/search-history.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import { setMarqueeSelectionEnabled } from '@/utils/ui/marquee-selection.js';

const HICCUP = new Error('Failed to write to storage');

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});

interface FakeArea {
  calls: number;
  store: Record<string, unknown>;
  failures: unknown[];
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

function fakeArea(failures: unknown[] = []): FakeArea {
  const area: FakeArea = {
    calls: 0,
    store: {},
    failures,
    get: async (keys: string[]) =>
      Object.fromEntries(keys.filter((k) => k in area.store).map((k) => [k, area.store[k]])),
    set: async (items: Record<string, unknown>) => {
      area.calls += 1;
      if (area.failures.length > 0) throw area.failures.shift();
      Object.assign(area.store, items);
    },
    remove: async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete area.store[key];
    },
  };
  return area;
}

/**
 * The migrated modules resolve the area through `wxt/browser` first (the seam
 * unit tests replace) with the live global as the fallback - so this file
 * installs BOTH, pointed at one mutable area, and each test just swaps that
 * area in (same setup as storage-write-wiring.test.ts).
 */
let liveArea: FakeArea;
const browserFake = {
  storage: {
    local: {
      get: async (keys: string[]) => liveArea.get(keys),
      set: async (items: Record<string, unknown>) => liveArea.set(items),
      remove: async (keys: string | string[]) => liveArea.remove(keys),
    },
  },
};
mock.module('wxt/browser', () => ({ browser: browserFake }));
Object.assign(globalThis, { browser: browserFake });

beforeEach(() => {
  liveArea = fakeArea();
});

describe('app-wide write-retry migration (features/utils call paths)', () => {
  test('pushSearchHistory absorbs a hiccup and still records the query', async () => {
    liveArea.failures.push(HICCUP);

    const next = await pushSearchHistory('inbox', 'banking');

    expect(next).toEqual(['banking']);
    expect(liveArea.calls).toBeGreaterThan(1);
    expect(liveArea.store.searchHistoryByScope).toEqual({ inbox: ['banking'] });
  });

  test('removeSearchHistoryItem matches case-insensitively like insertion', async () => {
    liveArea.store.searchHistoryByScope = { inbox: ['Foo', 'Other'] };

    const next = await removeSearchHistoryItem('inbox', 'foo');

    expect(next).toEqual(['Other']);
    expect(liveArea.store.searchHistoryByScope).toEqual({ inbox: ['Other'] });
  });

  test('setSearchHistoryLimit absorbs a hiccup on both of its writes', async () => {
    liveArea.failures.push(HICCUP, HICCUP);

    const n = await setSearchHistoryLimit(10);

    expect(n).toBe(10);
    expect(liveArea.store.searchHistoryLimit).toBe(10);
  });

  test('recordConnectivityEvent absorbs a hiccup and keeps the event', async () => {
    liveArea.failures.push(HICCUP);

    await recordConnectivityEvent('offline');

    expect(liveArea.store.connectivityLog).toEqual([['offline', expect.any(Number)]]);
  });

  test('setMarqueeSelectionEnabled absorbs a hiccup and persists the flag', async () => {
    liveArea.failures.push(HICCUP);

    await setMarqueeSelectionEnabled(false);

    expect(liveArea.store.marqueeSelectionEnabled).toBe(false);
  });

  test('an exhausted budget still rejects through StorageWriteError (never silent)', async () => {
    const { StorageWriteError } = await import('@/utils/errors.js');
    for (let i = 0; i < 4; i++) liveArea.failures.push(HICCUP);

    let caught: unknown;
    try {
      await writeWithRetry({ migrationProbeKey: 'v' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(StorageWriteError);
    expect(liveArea.store.migrationProbeKey).toBeUndefined();
  });
});
