import { afterAll, expect, mock, test } from 'bun:test';
import type { ClipboardPurgeRecord } from '@/utils/clipboard/clipboard.js';

const storage: Record<string, unknown> = {};
const api = {
  storage: {
    local: {
      get: async () => ({ ...storage }),
      set: async (values: Record<string, unknown>) => {
        Object.assign(storage, values);
      },
    },
  },
  alarms: { get: async () => undefined, create: async () => {}, clear: async () => true },
  notifications: { clear: async () => true },
};
mock.module('wxt/browser', () => ({ browser: api }));
mock.module('@/utils/storage/storage-write.js', () => ({
  writeWithRetry: async (values: Record<string, unknown>) => {
    Object.assign(storage, values);
  },
}));
mock.module('@/utils/mutex.js', () => ({
  withLock: async (_name: string, task: () => Promise<unknown>) => task(),
}));
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
let clipboard = '';
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    clipboard: {
      writeText: async (value: string) => {
        clipboard = value;
      },
      readText: async () => clipboard,
    },
  },
});
const { copyToClipboardAndSchedulePurge, scheduleBackgroundPurge } = await import(
  '@/utils/clipboard/clipboard.js'
);
const { normalizeClipboardPrivacy } = await import('@/utils/clipboard/clipboard-settings.js');
afterAll(async () => {
  await copyToClipboardAndSchedulePurge('', 0);
  mock.restore();
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else Reflect.deleteProperty(globalThis, 'navigator');
});
const records = () => (storage.clipboardPurgeQueue ?? []) as ClipboardPurgeRecord[];
test('normalizes missing, fractional and invalid persisted clipboard durations', () => {
  expect(normalizeClipboardPrivacy(undefined)).toEqual({
    autoPurgeEnabled: true,
    purgeAfterSeconds: 30,
  });
  expect(normalizeClipboardPrivacy({ autoPurgeEnabled: false, purgeAfterSeconds: 7.4 })).toEqual({
    autoPurgeEnabled: false,
    purgeAfterSeconds: 7,
  });
  expect(normalizeClipboardPrivacy({ purgeAfterSeconds: Infinity }).purgeAfterSeconds).toBe(30);
  expect(normalizeClipboardPrivacy({ purgeAfterSeconds: 301 }).purgeAfterSeconds).toBe(30);
});
async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 100 && !predicate(); i += 1)
    await new Promise((resolve) => setTimeout(resolve, 2));
  expect(predicate()).toBe(true);
}

test('sensitive copies use the chosen delay; recopy refreshes the hash deadline', async () => {
  storage.clipboardPrivacy = { autoPurgeEnabled: true, purgeAfterSeconds: 10 };
  const started = Date.now();
  expect(await copyToClipboardAndSchedulePurge('test-secret')).toBe(true);
  await waitFor(() => records().length === 1);
  expect(records()[0].purgeAt - started).toBeGreaterThanOrEqual(10000);
  expect(records()[0].purgeAt - started).toBeLessThan(10500);
  expect(JSON.stringify(records())).not.toContain('test-secret');
  await scheduleBackgroundPurge('test-secret', 20000);
  expect(records()).toHaveLength(1);
  expect(records()[0].purgeAt - Date.now()).toBeGreaterThan(19000);
  await copyToClipboardAndSchedulePurge('', 0);
});

test('disabled auto-purge creates no new schedule and a verified local wipe retires its record', async () => {
  storage.clipboardPurgeQueue = [];
  storage.clipboardPrivacy = { autoPurgeEnabled: false, purgeAfterSeconds: 5 };
  expect(await copyToClipboardAndSchedulePurge('disabled-test')).toBe(true);
  expect(records()).toEqual([]);
  expect(await copyToClipboardAndSchedulePurge('short-test', 30)).toBe(true);
  await waitFor(() => records().length === 1);
  await waitFor(() => clipboard === '' && records().length === 0);
});
