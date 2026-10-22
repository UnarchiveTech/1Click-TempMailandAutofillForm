import { afterAll, beforeAll, describe, expect, type Mock, mock, test } from 'bun:test';
import type { ClipboardPurgeRecord } from '@/utils/clipboard/clipboard';

// NOTE: `browser` from wxt/browser is captured at MODULE EVALUATION time
// (globalThis.browser?.runtime?.id ? that : chrome). This file installs the
// mock globals in beforeAll and then DYNAMICALLY imports the module under
// test, so the wxt/browser snapshot sees our mock. The other clipboard tests
// statically import and therefore cannot exercise processClipboardPurgeQueue
// (browser-storage calls would throw, which production code catches).
//
// All scenarios live in ONE test: bun may start async sibling tests at
// overlapping times, and the queue + clipboard mock state is shared across
// the suite - a single sequential test is deterministic.

// ── Typed stand-ins for the globals this queue depends on ───────────────────

/** The injected function's parameter list - production passes `args` positionally. */
type InjectedScript = {
  func: (...args: unknown[]) => unknown;
  args?: unknown[];
};
type ClipboardLike = {
  writeText: (text: string) => Promise<void>;
  readText: () => Promise<string>;
};
/** Just the browser surface `wxt/browser` + the purge queue touch. */
type BrowserMock = {
  runtime: { id: string };
  storage: {
    local: {
      get: Mock<(keys: string | string[]) => Promise<Record<string, unknown>>>;
      set: Mock<(values: Record<string, unknown>) => Promise<void>>;
    };
  };
  tabs: { query: Mock<() => Promise<Array<{ id: number }>>> };
  scripting: {
    executeScript: Mock<(details: InjectedScript) => Promise<Array<{ result: unknown }>>>;
  };
  notifications: {
    create: Mock<(...args: unknown[]) => Promise<unknown>>;
  };
  alarms?: unknown;
};

type GlobalHost = {
  browser?: BrowserMock;
  navigator?: { clipboard?: ClipboardLike };
};

const globalHost = globalThis as unknown as GlobalHost;

let processClipboardPurgeQueue: (() => Promise<void>) | null = null;
let originalBrowser: BrowserMock | undefined;
let originalClipboard: ClipboardLike | undefined;
let executeScriptMock: Mock<(details: InjectedScript) => Promise<Array<{ result: unknown }>>>;
let tabsQueryMock: Mock<() => Promise<Array<{ id: number }>>>;
let notificationsCreateMock: Mock<(...args: unknown[]) => Promise<unknown>>;
let storage: Record<string, unknown>;
let readTextMock: Mock<() => Promise<string>>;
let writeTextMock: Mock<(text: string) => Promise<void>>;

const sha256 = async (text: string): Promise<string> => {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

const dueRecordFor = async (text: string, overrides: Partial<ClipboardPurgeRecord> = {}) => {
  const hash = await sha256(text);
  return { hash, purgeAt: Date.now() - 1000, ...overrides } as ClipboardPurgeRecord;
};
const queue = () => storage.clipboardPurgeQueue as ClipboardPurgeRecord[];

const runPurge = async () => {
  if (!processClipboardPurgeQueue) throw new Error('Purge queue processor was not initialized');
  await processClipboardPurgeQueue();
};

/** Reset all per-step state so each scenario starts from a clean slate. */
const reset = () => {
  storage = { clipboardPurgeQueue: [] };
  readTextMock.mockClear();
  readTextMock.mockImplementation(() => Promise.resolve(''));
  writeTextMock.mockClear();
  executeScriptMock.mockClear();
  tabsQueryMock.mockClear();
  tabsQueryMock.mockImplementation(async () => [{ id: 1 }]);
  notificationsCreateMock.mockClear();
};

beforeAll(async () => {
  originalBrowser = globalHost.browser;
  originalClipboard = globalHost.navigator?.clipboard;
  readTextMock = mock<() => Promise<string>>(() => Promise.resolve(''));
  writeTextMock = mock<(text: string) => Promise<void>>(async (text) => {
    // A successful write changes what the next verification read returns.
    readTextMock.mockImplementation(() => Promise.resolve(text));
  });

  executeScriptMock = mock(async ({ func, args }: InjectedScript) => {
    // The browser resolves a promise returned by the injected function into
    // `results[0].result` - replicate that so the queue sees the outcome.
    const result = await func(...(args || []));
    return [{ result }];
  });
  tabsQueryMock = mock(async () => [{ id: 1 }]);
  notificationsCreateMock = mock(async () => ({}));

  storage = { clipboardPurgeQueue: [] };
  globalHost.browser = {
    // runtime.id makes @wxt-dev/browser pick up this mock instead of chrome
    runtime: { id: 'test-extension' },
    storage: {
      local: {
        get: mock(async (keys: string | string[]) => {
          const out: Record<string, unknown> = {};
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) out[k] = storage?.[k];
          return out;
        }),
        set: mock(async (vals: Record<string, unknown>) => {
          Object.assign(storage, vals);
        }),
      },
    },
    tabs: { query: tabsQueryMock },
    scripting: { executeScript: executeScriptMock },
    notifications: { create: notificationsCreateMock },
  };
  const nav = globalHost.navigator;
  if (nav) nav.clipboard = { readText: readTextMock, writeText: writeTextMock };
  else globalHost.navigator = { clipboard: { readText: readTextMock, writeText: writeTextMock } };

  const mod = await import('@/utils/clipboard/clipboard.js');
  processClipboardPurgeQueue = mod.processClipboardPurgeQueue;
});

afterAll(() => {
  globalHost.browser = originalBrowser;
  const nav = globalHost.navigator;
  if (!nav) return;
  if (originalClipboard) nav.clipboard = originalClipboard;
  else delete nav.clipboard;
});

test('verified wipe prunes, unverifiable wipe retains with backoff, changed content prunes', async () => {
  // ── Scenario 1: hash matched → wiped → record pruned ──────────────────
  reset();
  storage.clipboardPurgeQueue = [await dueRecordFor('otp-12345')];
  readTextMock.mockImplementation(() => Promise.resolve('otp-12345'));

  await runPurge();

  expect(queue()).toEqual([]);
  expect(writeTextMock).toHaveBeenCalledWith('');
  expect(executeScriptMock).toHaveBeenCalledTimes(1);

  // ── Scenario 2: clipboard unreadable → wipe skipped → record RETRIED ──
  reset();
  const before = Date.now();
  const unreadable = await dueRecordFor('otp-12345');
  storage.clipboardPurgeQueue = [unreadable];
  readTextMock.mockImplementation(() => Promise.reject(new Error('Not allowed')));

  await runPurge();

  const kept = queue();
  expect(kept).toHaveLength(1);
  expect(kept[0].hash).toBe(unreadable.hash);
  expect(kept[0].attempts).toBe(1);
  expect(kept[0].purgeAt).toBeGreaterThan(before);

  // ── Scenario 3: no active tab → no wipe possible → record RETRIED ──
  reset();
  tabsQueryMock.mockImplementation(async () => []);
  const noTab = await dueRecordFor('otp-12345');
  storage.clipboardPurgeQueue = [noTab];

  await runPurge();

  expect(executeScriptMock).not.toHaveBeenCalled();
  const noTabKept = queue();
  expect(noTabKept).toHaveLength(1);
  expect(noTabKept[0].attempts).toBe(1);
  expect(noTabKept[0].purgeAt).toBeGreaterThan(Date.now() - 1000);

  // ── Scenario 4: contents changed → text provably gone → pruned ──
  reset();
  storage.clipboardPurgeQueue = [await dueRecordFor('otp-12345')];
  readTextMock.mockImplementation(() => Promise.resolve('user-copied-something-else'));

  await runPurge();

  expect(queue()).toEqual([]);
  expect(writeTextMock).not.toHaveBeenCalledWith('');

  // ── Scenario 5: pending records untouched while due ones are handled ──
  reset();
  const pending: ClipboardPurgeRecord = {
    hash: await sha256('otp-future'),
    purgeAt: Date.now() + 60_000,
  };
  storage.clipboardPurgeQueue = [await dueRecordFor('otp-due'), pending];
  readTextMock.mockImplementation(() => Promise.resolve('otp-due'));

  await runPurge();

  expect(queue()).toEqual([pending]);

  // ── Scenario 6: attempts cap is a logging milestone, NOT a drop - the
  // record MUST be retained because the text may still be on the clipboard
  // (never prune unless provably gone). ──
  reset();
  const atCap = await dueRecordFor('otp-12345', { attempts: 11 });
  storage.clipboardPurgeQueue = [atCap];
  readTextMock.mockImplementation(() => Promise.reject(new Error('Not allowed')));

  await runPurge();

  const keptAtCap = queue();
  expect(keptAtCap).toHaveLength(1);
  expect(keptAtCap[0].hash).toBe(atCap.hash);
  expect(keptAtCap[0].attempts).toBe(12); // MAX_PURGE_ATTEMPTS reached, still retained
  expect(keptAtCap[0].purgeAt).toBeGreaterThan(Date.now() - 1000);

  // ── Scenario 7: past the cap the record is STILL retained and retried ──
  reset();
  const pastCap = await dueRecordFor('otp-12345', { attempts: 40 });
  storage.clipboardPurgeQueue = [pastCap];
  readTextMock.mockImplementation(() => Promise.reject(new Error('Not allowed')));

  await runPurge();

  const keptPastCap = queue();
  expect(keptPastCap).toHaveLength(1);
  expect(keptPastCap[0].attempts).toBe(41);
});

describe('stuck-purge alert notification (review-2-glm §10.3)', () => {
  test('fires at the milestone, carries a routed id, stays silent below it and between repeats', async () => {
    const alertAt = (attempts: number) =>
      (async () => {
        reset();
        storage.clipboardPurgeQueue = [await dueRecordFor('otp-12345', { attempts })];
        readTextMock.mockImplementation(() => Promise.reject(new Error('Not allowed')));
        await runPurge();
        return notificationsCreateMock.mock.calls.length;
      })();

    // Below the milestone (records are bumped before the check, so seeding 10
    // → attempts 11 < 12): retained but silent.
    expect(await alertAt(0)).toBe(0);
    expect(await alertAt(5)).toBe(0);
    expect(await alertAt(10)).toBe(0);

    // At the milestone: one notification with the routed id prefix.
    reset();
    storage.clipboardPurgeQueue = [await dueRecordFor('otp-12345', { attempts: 11 })];
    readTextMock.mockImplementation(() => Promise.reject(new Error('Not allowed')));
    await runPurge();
    expect(notificationsCreateMock).toHaveBeenCalledTimes(1);
    const [idArg, optsArg] = notificationsCreateMock.mock.calls[0] as unknown as [
      string,
      { title: string; message: string; type: string; iconUrl: string },
    ];
    expect(idArg).toStartWith('clipboard-purge-alert:');
    expect(optsArg.type).toBe('basic');
    expect(optsArg.title).toBeTruthy();
    expect(optsArg.message).toContain('1');

    // Just past the milestone (no repeat boundary): silent again.
    expect(await alertAt(12)).toBe(0);
    // At the first repeat boundary (MAX + 32): fires again.
    expect(await alertAt(43)).toBe(1);

    // Multiple stuck records reaching the milestone together: ONE notification
    // (the message carries the count) - not one per record.
    reset();
    storage.clipboardPurgeQueue = [
      await dueRecordFor('otp-12345', { attempts: 11 }),
      await dueRecordFor('otp-67890', { attempts: 11 }),
    ];
    readTextMock.mockImplementation(() => Promise.reject(new Error('Not allowed')));
    await runPurge();
    expect(notificationsCreateMock).toHaveBeenCalledTimes(1);
  });
});
