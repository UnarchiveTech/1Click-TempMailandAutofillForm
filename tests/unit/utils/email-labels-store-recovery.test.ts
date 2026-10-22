import { afterAll, describe, expect, mock, test } from 'bun:test';

type Changes = Record<string, { newValue?: unknown }>;
type ChangeListener = (changes: Changes, area: string) => void;

const stored: Record<string, unknown> = {};
const changeListeners = new Set<ChangeListener>();
let failNextRead = false;

const fakeBrowser = {
  runtime: {
    onMessage: { addListener: () => undefined },
  },
  storage: {
    local: {
      get: async (keys: string[]) => {
        if (failNextRead) {
          failNextRead = false;
          throw new Error('temporary storage failure');
        }
        return Object.fromEntries(
          keys.filter((key) => key in stored).map((key) => [key, stored[key]])
        );
      },
      set: async (items: Record<string, unknown>) => Object.assign(stored, items),
      remove: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key];
      },
    },
    onChanged: {
      addListener: (listener: ChangeListener) => changeListeners.add(listener),
      removeListener: (listener: ChangeListener) => changeListeners.delete(listener),
    },
  },
};

mock.module('wxt/browser', () => ({ browser: fakeBrowser }));
Object.assign(globalThis, { browser: fakeBrowser });

const { emailLabelsStore } = await import('@/utils/storage/email-labels-store.js');
// Logger initialization reads storage during module import; target the store's
// first read below rather than making the unrelated logger read fail.
failNextRead = true;

afterAll(() => {
  mock.restore();
  changeListeners.clear();
});

describe('emailLabelsStore startup recovery', () => {
  test('does not publish an empty map on read failure and recovers on storage change', async () => {
    const snapshots: Array<{ map: Record<string, string[]>; status: string }> = [];
    const unsubscribe = emailLabelsStore.subscribe((map, status) =>
      snapshots.push({ map, status })
    );

    try {
      await emailLabelsStore.init();
      expect(snapshots.map((snapshot) => snapshot.status)).toEqual(['loading', 'error']);
      expect(changeListeners.size).toBeGreaterThan(0);

      stored.emailLabels = { 'inbox@example.com_email1': ['important'] };
      for (const listener of changeListeners) {
        listener({ emailLabels: { newValue: stored.emailLabels } }, 'local');
      }
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(snapshots[snapshots.length - 1]).toEqual({
        map: { 'inbox@example.com_email1': ['important'] },
        status: 'ready',
      });

      const laterSnapshots: Array<{ map: Record<string, string[]>; status: string }> = [];
      const unsubscribeLater = emailLabelsStore.subscribe((map, status) =>
        laterSnapshots.push({ map, status })
      );
      expect(laterSnapshots).toEqual([
        { map: { 'inbox@example.com_email1': ['important'] }, status: 'ready' },
      ]);
      unsubscribeLater();
    } finally {
      unsubscribe();
    }
  });

  test('a slower stale read cannot replace a newer label snapshot', async () => {
    const originalGet = fakeBrowser.storage.local.get;
    let releaseFirst: (() => void) | undefined;
    let reads = 0;
    fakeBrowser.storage.local.get = async (keys) => {
      reads += 1;
      if (reads === 1) {
        const snapshot = Object.fromEntries(
          keys.filter((key) => key in stored).map((key) => [key, stored[key]])
        );
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        return snapshot;
      }
      return originalGet(keys);
    };

    try {
      stored.emailLabels = { 'inbox@example.com_email1': ['old'] };
      const first = emailLabelsStore.refresh();
      stored.emailLabels = { 'inbox@example.com_email1': ['new'] };
      await emailLabelsStore.refresh();
      releaseFirst?.();
      await first;
      expect(emailLabelsStore.getSnapshot()).toEqual({ 'inbox@example.com_email1': ['new'] });
      expect(emailLabelsStore.getStatus()).toBe('ready');
    } finally {
      releaseFirst?.();
      fakeBrowser.storage.local.get = originalGet;
    }
  });
});
