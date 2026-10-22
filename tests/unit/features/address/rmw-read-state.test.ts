import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Address } from '@/utils/types.js';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});

const store: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};
/** Per-key artificial read latency (ms) - used to force chain overlap. */
const getDelayMs: Record<string, number> = {};
let failReadStateWrite = false;

const fakeBrowser = {
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return { ...store };
        const arr = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const k of arr) {
          if (k in store) out[k] = store[k];
          const delay = getDelayMs[k] ?? 0;
          if (delay > 0) await new Promise((r) => setTimeout(r, delay));
        }
        return out;
      },
      set: async (items: Record<string, unknown>) => {
        if (failReadStateWrite && 'readEmails' in items) {
          throw new Error('QUOTA_BYTES_PER_ITEM exceeded');
        }
        Object.assign(store, items);
      },
      remove: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
      },
    },
    session: {
      get: async (keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return { ...sessionStore };
        const list = Array.isArray(keys) ? keys : [keys];
        const result: Record<string, unknown> = {};
        for (const key of list) if (key in sessionStore) result[key] = sessionStore[key];
        return result;
      },
      set: async (items: Record<string, unknown>) => {
        Object.assign(sessionStore, items);
      },
      remove: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete sessionStore[key];
      },
    },
  },
};

// NOTE: only `wxt/browser` is mocked here (same contract as the sibling
// address-actions test) - the real rmw/address-actions/storage-keys modules
// run against the fake storage above.
mock.module('wxt/browser', () => ({ browser: fakeBrowser }));
Object.assign(globalThis, { browser: fakeBrowser });

const {
  __clearStoredObjectChainsForTests,
  parseNumberRecord,
  parseStringList,
  parseStringRecord,
  toggleDomainListItem,
  updateStoredObject,
} = await import('@/utils/storage/rmw.js');
const {
  __clearReadStateFlushTimerForTests,
  flushQueuedEmailReadState,
  queueEmailReadState,
  queueEmailReadStates,
  remapQueuedReadStateInbox,
} = await import('@/features/address/address-actions.js');
const { updateAddresses } = await import('@/utils/storage/storage-keys.js');

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  failReadStateWrite = false;
  for (const k of Object.keys(store)) delete store[k];
  for (const k of Object.keys(getDelayMs)) delete getDelayMs[k];
  __clearStoredObjectChainsForTests();
  __clearReadStateFlushTimerForTests();
});

describe('updateStoredObject serialization', () => {
  test('second update reads the value the first write landed (same-key lost update)', async () => {
    getDelayMs.profiles = 25; // force the second read to start while the first write is pending
    const p1 = updateStoredObject<Record<string, unknown>>(
      'profiles',
      (c) => ({ ...c, a: 1 }),
      (r) => ({ ...(r as object) })
    );
    const p2 = updateStoredObject<Record<string, unknown>>(
      'profiles',
      (c) => ({ ...c, b: 2 }),
      (r) => ({ ...(r as object) })
    );
    await Promise.all([p1, p2]);
    // A bare get→set pair would leave { b: 2 } or { a: 1 } - never both.
    expect(store.profiles).toEqual({ a: 1, b: 2 });
  });

  test('starredEmails-shaped concurrent toggles both survive (per-key regression)', async () => {
    getDelayMs.starredEmails = 25;
    const p1 = updateStoredObject<string[]>(
      'starredEmails',
      (c) => Array.from(new Set([...c, 'a@x_m1'])),
      parseStringList
    );
    const p2 = updateStoredObject<string[]>(
      'starredEmails',
      (c) => Array.from(new Set([...c, 'b@x_m2'])),
      parseStringList
    );
    const [r1, r2] = await Promise.all([p1, p2]);
    expect([...r1].sort()).toEqual(['a@x_m1']);
    expect([...r2].sort()).toEqual(['a@x_m1', 'b@x_m2']);
    // Stored shape stays an ARRAY - the shape `parseStringList` reads back.
    expect([...(store.starredEmails as string[])].sort()).toEqual(['a@x_m1', 'b@x_m2']);
  });

  test('a throwing updater rejects only its own call; the chain recovers', async () => {
    await expect(
      updateStoredObject<Record<string, unknown>>(
        'k',
        () => {
          throw new Error('quota');
        },
        (r) => ({ ...(r as object) })
      )
    ).rejects.toThrow('quota');
    const next = await updateStoredObject<Record<string, unknown>>(
      'k',
      (c) => ({ ...c, ok: true }),
      (r) => ({
        ...(r as object),
      })
    );
    expect(next).toEqual({ ok: true });
    expect(store.k).toEqual({ ok: true });
  });

  test('awaits the chain without writing (empty-op flush semantics)', async () => {
    getDelayMs.k = 20;
    const p1 = updateStoredObject<Record<string, unknown>>(
      'k',
      (c) => ({ ...c, v: 1 }),
      (r) => ({ ...(r as object) })
    );
    const { awaitStoredObjectChain } = await import('@/utils/storage/rmw.js');
    const tail = awaitStoredObjectChain('k'); // issued while the write is pending
    await Promise.all([p1, tail]);
    expect(store.k).toEqual({ v: 1 });
  });
});

describe('storage object parsers', () => {
  test('parseStringList drops non-string entries and non-list shapes', () => {
    expect(parseStringList(['a', 3, null, 'b'])).toEqual(['a', 'b']);
    expect(parseStringList('nope')).toEqual([]);
    expect(parseStringList(undefined)).toEqual([]);
    expect(parseStringList({ 0: 'a' })).toEqual([]);
  });

  test('parseStringRecord keeps only string-valued entries', () => {
    expect(parseStringRecord({ a: 'x', b: 2, c: null })).toEqual({ a: 'x' });
    expect(parseStringRecord('nope')).toEqual({});
    expect(parseStringRecord(undefined)).toEqual({});
  });

  test('parseNumberRecord keeps only finite number-valued entries', () => {
    expect(parseNumberRecord({ a: 5, b: 'x', c: null })).toEqual({ a: 5 });
    expect(parseNumberRecord({ nan: Number.NaN, inf: Number.POSITIVE_INFINITY })).toEqual({});
    expect(parseNumberRecord(undefined)).toEqual({});
    expect(parseNumberRecord(['5'])).toEqual({});
  });

  test('a snooze-shaped pair of concurrent edits keeps both addresses (regression)', async () => {
    // The shape both snooze surfaces write: read the map, set one address, write
    // the whole map back. Two writes in the same document (bell + snooze menu)
    // used to leave only the second address snoozed.
    getDelayMs.notificationSnoozeByAddress = 25;
    const p1 = updateStoredObject<Record<string, number>>(
      'notificationSnoozeByAddress',
      (c) => ({ ...c, 'a@x.test': 1 }),
      parseNumberRecord
    );
    const p2 = updateStoredObject<Record<string, number>>(
      'notificationSnoozeByAddress',
      (c) => ({ ...c, 'b@x.test': 2 }),
      parseNumberRecord
    );
    await Promise.all([p1, p2]);
    expect(store.notificationSnoozeByAddress).toEqual({ 'a@x.test': 1, 'b@x.test': 2 });
  });

  test('updateStoredObject writes a sanitized value over a corrupt record', async () => {
    store.starredEmails = ['keep', 42, { evil: true }, 'also-keep'];
    const next = await updateStoredObject<string[]>(
      'starredEmails',
      (c) => Array.from(new Set([...c, 'new'])),
      parseStringList
    );
    expect([...next].sort()).toEqual(['also-keep', 'keep', 'new']);
    expect([...(store.starredEmails as string[])].sort()).toEqual(['also-keep', 'keep', 'new']);
  });
});

describe('updateStoredObject read/write seams', () => {
  test('the seams replace the raw area round trip', async () => {
    const written: unknown[] = [];
    const next = await updateStoredObject<number>(
      'counter',
      (c) => c + 1,
      () => 0,
      {
        read: async () => 41,
        write: async (value) => {
          written.push(value);
        },
      }
    );

    expect(next).toBe(42);
    expect(written).toEqual([42]);
    // The seam OWNS persistence: nothing was written to the raw key.
    expect(store.counter).toBeUndefined();
  });
});

describe('updateAddresses (a key stored in a normalized form)', () => {
  const record = (id: string, address: string, provider: string): Address =>
    ({ id, address, provider, createdAt: 1, expiresAt: 2 }) as Address;
  const demo = (n: number) => record(`demo-inbox-${n}`, `demo.user${n}@example.com`, 'demo');
  const real = record('inbox-a', 'a@example.com', 'guerrilla');

  test('a concurrent append and filter both land (no lost update)', async () => {
    // The two flows the last read-modify-write row carried: creating a demo
    // inbox while leaving the playground. Both write the WHOLE list, so a raw
    // pair leaves whichever ran second and drops the other's edit.
    store.addresses = [demo(1), real];
    getDelayMs.addresses = 25;

    await Promise.all([
      updateAddresses((current) => [...current, demo(2)]),
      updateAddresses((current) => current.filter((i) => i.provider !== 'demo')),
    ]);

    // The filter ran against the list the append landed, so it saw both demo
    // inboxes; the real one is untouched.
    expect(store.addresses).toEqual([real]);
  });

  test('reads through getAddresses and writes through setAddresses', async () => {
    // `setAddresses` drops `status` (a computed display field) and dedupes by
    // id; going through it means an update cannot write back a less normalized
    // list than every other address writer.
    store.addresses = [{ ...demo(1), status: 'expired' }, { ...demo(1) }, real] as Address[];

    const intent = await updateAddresses((current) => current);

    // The return is the caller's intent (the read, as the updater left it) …
    expect(intent.map((i) => i.id)).toEqual(['demo-inbox-1', 'demo-inbox-1', 'inbox-a']);
    // … while what LANDED went through `setAddresses`: id duplicates dropped,
    // `status` stripped, so the return can never be less normalized than the
    // stored list every other reader sees.
    const stored = store.addresses as Address[];
    expect(stored.map((i) => i.id)).toEqual(['demo-inbox-1', 'inbox-a']);
    expect('status' in stored[0]).toBe(false);
  });
});

describe('shared updaters', () => {
  test('toggleDomainListItem removes case-insensitively and adds idempotently', () => {
    expect(toggleDomainListItem(['Foo.com'], 'foo.com', false)).toEqual([]);
    // Adding replaces any casing with the caller's key (callers pass a
    // normalized lower-cased domain, matching the pre-helper append path).
    expect(toggleDomainListItem(['Foo.com'], 'foo.com', true)).toEqual(['foo.com']);
    expect(toggleDomainListItem([], 'bar.com', true)).toEqual(['bar.com']);
    expect(toggleDomainListItem(['BAR.com'], 'bar.com', true)).toEqual(['bar.com']);
    expect(toggleDomainListItem(['x.com', 'not.com'], 'x.com', false)).toEqual(['not.com']);
  });
});

describe('queued read-state flush (address-actions)', () => {
  test('an op joining an empty flush waiting on another writer is also persisted', async () => {
    getDelayMs.readEmails = 30;
    const otherWrite = updateStoredObject(
      'readEmails',
      () => ({ base: true }),
      () => ({})
    );
    const emptyFlush = flushQueuedEmailReadState();
    await tick(1);
    await queueEmailReadState('joined', ['a@x.test'], true);
    const joinedFlush = flushQueuedEmailReadState();
    await Promise.all([otherWrite, emptyFlush, joinedFlush]);
    expect(store.readEmails).toEqual({ base: true, 'a@x.test_joined': true });
  });

  test('a failed flush rejects, retains its ops, and preserves newer intent on retry', async () => {
    store.readEmails = { untouched: true };
    getDelayMs.readEmails = 30;
    failReadStateWrite = true;
    await queueEmailReadState('e1', ['a@x.test'], true);
    const first = flushQueuedEmailReadState();
    await tick(1);
    await queueEmailReadState('e1', ['a@x.test'], false);
    await queueEmailReadState('e2', ['a@x.test'], true);
    const second = flushQueuedEmailReadState();
    const outcomes = await Promise.allSettled([first, second]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['rejected', 'rejected']);
    expect(store.readEmails).toEqual({ untouched: true });

    failReadStateWrite = false;
    await flushQueuedEmailReadState();
    expect(store.readEmails).toEqual({ untouched: true, 'a@x.test_e2': true });
  });

  test('bulk mark reports an error instead of success when the flush fails', async () => {
    const { markAddressesReadUnread } = await import('@/features/address/mailbox-read-state.js');
    const toasts: Array<{ message: string; type?: string }> = [];
    failReadStateWrite = true;
    await markAddressesReadUnread(
      {
        ext: fakeBrowser as unknown as Browser,
        getStoredEmails: () => ({
          'a@x.test': [{ id: 'e1' }] as import('@/utils/types.js').Email[],
        }),
        showToast: (message, type) => {
          toasts.push({ message, type });
        },
        getTranslation: (key) => key,
        queueReadStates: queueEmailReadStates,
        flushReadStates: flushQueuedEmailReadState,
      },
      [{ id: 'a', address: 'a@x.test' } as Address],
      true
    );
    expect(toasts).toEqual([{ message: 'toasts.operationFailed', type: 'error' }]);
    failReadStateWrite = false;
    await flushQueuedEmailReadState();
    expect(store.readEmails).toEqual({ 'a@x.test_e1': true });
  });

  test('queued single op replays only mailbox-scoped keys onto the current map', async () => {
    store.readEmails = { other: true };
    await queueEmailReadState('e1', ['a@x.test'], true);
    await flushQueuedEmailReadState();
    expect(store.readEmails).toEqual({
      other: true,
      'a@x.test_e1': true,
    });
  });

  test('bulk queueEmailReadStates + flush marks and unmarks a whole bag', async () => {
    store.readEmails = { 'a@x.test_old': true };
    queueEmailReadStates([
      { emailId: 'm1', casings: ['a@x.test', undefined], read: true },
      { emailId: 'm2', casings: ['a@x.test'], read: true },
    ]);
    await flushQueuedEmailReadState();
    expect(store.readEmails).toEqual({
      'a@x.test_old': true,
      'a@x.test_m1': true,
      'a@x.test_m2': true,
    });

    // Unread clears the compound key while leaving the other message read.
    queueEmailReadStates([{ emailId: 'm1', casings: ['a@x.test'], read: false }]);
    await flushQueuedEmailReadState();
    expect(store.readEmails).toEqual({
      'a@x.test_old': true,
      'a@x.test_m2': true,
    });
  });

  test('REGRESSION: a second flush queued behind a slow flush replays after its write (no fork)', async () => {
    // Old design: flush #2 read the map while flush #1's write was still
    // pending, then wrote its snapshot through the chain - clobbering the
    // first replay. The chain-internal drain makes #2 read #1's write.
    store.readEmails = { base: true };
    getDelayMs.readEmails = 100;

    await queueEmailReadState('e1', ['a@x.test'], true);
    const flush1 = flushQueuedEmailReadState();

    await tick(10); // flush #1's read is now pending; a new op arrives
    await queueEmailReadState('e2', ['b@x.test'], true);
    const flush2 = flushQueuedEmailReadState();

    await Promise.all([flush1, flush2]);
    expect(store.readEmails).toEqual({
      base: true,
      'a@x.test_e1': true,
      'b@x.test_e2': true,
    });
  });

  test('remapQueuedReadStateInbox rewrites pending casings before the flush lands', async () => {
    await queueEmailReadState('m1', ['old@x.test', undefined], true);
    await queueEmailReadState('m2', ['new@x.test'], true);
    remapQueuedReadStateInbox('OLD@x.test', 'new@x.test');
    await flushQueuedEmailReadState();
    expect(store.readEmails).toEqual({
      'new@x.test_m1': true,
      'new@x.test_m2': true,
    });
  });

  test('sanitized flush: corrupt read-state entries are dropped on rewrite', async () => {
    store.readEmails = { good: true, bad: 'x', worse: 3 } as Record<string, unknown>;
    await queueEmailReadState('e1', ['a@x.test'], true);
    await flushQueuedEmailReadState();
    expect(store.readEmails).toEqual({ good: true, 'a@x.test_e1': true });
  });

  test('flush with no queued ops resolves without writing', async () => {
    await flushQueuedEmailReadState();
    expect(store.readEmails).toBeUndefined();
  });
});
