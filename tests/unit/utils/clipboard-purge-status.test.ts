import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';

const localStorage: Record<string, unknown> = {};

const browserMock = {
  runtime: { id: 'test-extension' },
  storage: {
    local: {
      get: async (keys?: string | string[]) => {
        const requested = typeof keys === 'string' ? [keys] : (keys ?? Object.keys(localStorage));
        return Object.fromEntries(
          requested.flatMap((key) => (key in localStorage ? [[key, localStorage[key]]] : []))
        );
      },
    },
  },
};

const globalHost = globalThis as unknown as { browser?: unknown };
const originalBrowser = globalHost.browser;

Object.assign(globalThis, { browser: browserMock });
mock.module('wxt/browser', () => ({ browser: browserMock }));

// Restore the process-wide browser mock AND the global we replaced, so the
// next test file's `getBrowser()` doesn't prefer our storage-only global over
// its own wxt/browser mock (AGENTS.md §5.14 - restore every module mock).
afterAll(() => {
  mock.restore();
  if (originalBrowser === undefined) delete (globalThis as Record<string, unknown>).browser;
  else globalHost.browser = originalBrowser;
});
let getClipboardPurgeStatus: typeof import('@/utils/clipboard/clipboard-purge-status.js')['getClipboardPurgeStatus'];
let CLIPBOARD_PURGE_ALERT_ATTEMPTS: number;

const setQueue = (records: unknown[]) => {
  localStorage.clipboardPurgeQueue = records;
};

beforeAll(async () => {
  const mod = await import('@/utils/clipboard/clipboard-purge-status.js');
  getClipboardPurgeStatus = mod.getClipboardPurgeStatus;
  CLIPBOARD_PURGE_ALERT_ATTEMPTS = mod.CLIPBOARD_PURGE_ALERT_ATTEMPTS;
});

beforeEach(() => {
  delete localStorage.clipboardPurgeQueue;
});

describe('getClipboardPurgeStatus', () => {
  test('empty / malformed queue → all zeros', async () => {
    expect(await getClipboardPurgeStatus()).toEqual({
      pending: 0,
      stuck: 0,
      alerting: 0,
      maxAttempts: 0,
    });
    setQueue([null, { noHash: true }, { hash: 'h' }, 42]);
    expect(await getClipboardPurgeStatus()).toEqual({
      pending: 0,
      stuck: 0,
      alerting: 0,
      maxAttempts: 0,
    });
  });

  test('pending vs stuck split, and alerting only past the threshold', async () => {
    const hash = 'a'.repeat(64);
    setQueue([
      { hash, purgeAt: Date.now() + 60_000 }, // pending: never attempted
      { hash, purgeAt: Date.now() + 60_000, attempts: 1 }, // stuck, below threshold
      { hash, purgeAt: Date.now() + 60_000, attempts: CLIPBOARD_PURGE_ALERT_ATTEMPTS - 1 },
      { hash, purgeAt: Date.now() + 60_000, attempts: CLIPBOARD_PURGE_ALERT_ATTEMPTS }, // at threshold → alerting
      { hash, purgeAt: Date.now() + 60_000, attempts: 25 }, // well past → alerting
    ]);
    const status = await getClipboardPurgeStatus();
    expect(status.pending).toBe(1);
    expect(status.stuck).toBe(4);
    expect(status.alerting).toBe(2);
    expect(status.maxAttempts).toBe(25);
  });
});
