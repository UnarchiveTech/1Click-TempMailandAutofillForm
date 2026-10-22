import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { Address, Email } from '@/utils/types.js';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// ── Mocks registered BEFORE the dynamic import of address-manager.js ────────
// wxt/browser is replaced with in-memory storage so the real storage-keys /
// mutex pipeline runs against a controllable fake. The delete flows under test
// use bundled providers without a forgetMe operation (burner), so no network
// layer is ever reached; the bounded fan-out's parallel/isolated semantics
// are pinned directly against runWithConcurrency in the last describe.

const store: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};

const fakeBrowser = {
  runtime: { id: 'test-extension' },
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return { ...store };
        const arr = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const k of arr) if (k in store) out[k] = store[k];
        return out;
      },
      set: async (items: Record<string, unknown>) => {
        Object.assign(store, items);
      },
      remove: async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
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
mock.module('wxt/browser', () => ({ browser: fakeBrowser }));

const { archiveAddresses, deleteAddress, deleteAddresses, renewAddresses, unarchiveAddresses } =
  await import('@/entrypoints/background/address/address-manager.js');
const { archivedEmailsByAddressKey, storedEmailsByAddressKey } = await import(
  '@/utils/storage/storage-keys.js'
);
const { __clearMutexRegistryForTests } = await import('@/utils/mutex.js');
const { runWithConcurrency } = await import('@/utils/concurrency.js');

function liveAddress(id: string, address: string): Address {
  return {
    id,
    address,
    // 'burner' is a bundled provider WITHOUT a forgetMe operation, so the
    // delete path never constructs an EmailService / touches the network.
    provider: 'burner',
    accountStatus: 'active',
    expiresAt: Date.now() + 60_000,
    createdAt: Date.now(),
    autoExtend: false,
  } as Address;
}

/** Seed an address + ID-keyed bags as the 3.0 runtime adapter expects. */
function seedAddress(record: Address, messageIds: string[]): void {
  store.addresses = [...((store.addresses as Address[]) || []), record];
  const index = (store.emailStorageAddressIndex as Record<string, string>) || {};
  index[record.id] = record.address;
  store.emailStorageAddressIndex = index;
  if (messageIds.length > 0) {
    store[storedEmailsByAddressKey(record.id)] = messageIds.map((id, i) => ({
      id,
      received_at: Date.now() - i,
      subject: `msg-${id}`,
    })) satisfies Email[];
    store[archivedEmailsByAddressKey(record.id)] = [
      { id: `arch-${record.id}`, received_at: Date.now() - 1000, subject: 'old' },
    ] satisfies Email[];
  }
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  for (const k of Object.keys(sessionStore)) delete sessionStore[k];
  // bun distributes test files across a worker pool and (on this build) the
  // real module registry is SHARED between sibling files, so a sibling that
  // left the address lock pending would otherwise wedge every withAddressLock
  // here for up to the mutex acquire timeout. The registry-clear is the
  // sanctioned test helper: active sibling holders keep running, they just
  // disown the registry entry, and this file starts every test with a
  // pristine in-memory queue.
  __clearMutexRegistryForTests();
});

describe('deleteAddresses (batched bulk delete)', () => {
  test('permanently deletes scoped stars for stored and archived messages only in that inbox', async () => {
    const a1 = liveAddress('a1', 'a@test.com');
    const a2 = liveAddress('a2', 'b@test.com');
    seedAddress(a1, ['shared-id']);
    seedAddress(a2, ['shared-id']);
    store[archivedEmailsByAddressKey('a1')] = [
      { id: 'archived-id', received_at: 1, subject: 'archived' },
    ] satisfies Email[];
    store.starredEmails = [
      'a@test.com_shared-id',
      'b@test.com_shared-id',
      'a@test.com_archived-id',
      'unrelated@test.com_kept-id',
    ];
    store.emailLabels = {
      'a@test.com_shared-id': ['deleted inbox label'],
      'a@test.com_archived-id': ['deleted archived label'],
      'b@test.com_shared-id': ['surviving inbox label'],
      'unrelated@test.com_kept-id': ['unrelated label'],
    };

    const { results } = await deleteAddresses(['a1'], false);

    expect(results).toEqual([{ addressId: 'a1', success: true }]);
    expect(store.starredEmails).toEqual(['b@test.com_shared-id', 'unrelated@test.com_kept-id']);
    expect(store.emailLabels).toEqual({
      'b@test.com_shared-id': ['surviving inbox label'],
      'unrelated@test.com_kept-id': ['unrelated label'],
    });
  });

  test('deletes every requested inbox in one pass and returns per-id success', async () => {
    const a1 = liveAddress('a1', 'a@test.com');
    const a2 = liveAddress('a2', 'b@test.com');
    const a3 = liveAddress('a3', 'c@test.com');
    seedAddress(a1, ['e1', 'e2']);
    seedAddress(a2, ['e3']);
    seedAddress(a3, []);
    store.seenEmailIds = { 'a@test.com': ['e1'], other: ['x'] };
    store.lastMessageTimestamps = { a1: 100, a2: 200, a3: 300 };
    store.readEmails = {
      'a@test.com_e1': true,
      'a@test.com_e2': true,
      e3: true,
      other: true,
    };
    store.starredEmails = ['e1', 'e3', 'keep-me'];

    const { results } = await deleteAddresses(['a1', 'a2'], false);

    // Per-id success in request order; a3 untouched.
    expect(results).toEqual([
      { addressId: 'a1', success: true },
      { addressId: 'a2', success: true },
    ]);
    const remaining = store.addresses as Address[];
    expect(remaining.map((a) => a.id)).toEqual(['a3']);
    // Both bags + index entries removed in the same locked pass.
    expect(store[storedEmailsByAddressKey('a1')]).toBeUndefined();
    expect(store[archivedEmailsByAddressKey('a1')]).toBeUndefined();
    expect(store[storedEmailsByAddressKey('a2')]).toBeUndefined();
    expect(store[archivedEmailsByAddressKey('a2')]).toBeUndefined();
    expect((store.emailStorageAddressIndex as Record<string, string>).a1).toBeUndefined();
    expect((store.emailStorageAddressIndex as Record<string, string>).a3).toBe('c@test.com');
    // Side tables cleaned for the deleted ids only.
    expect(store.seenEmailIds).toEqual({ other: ['x'] });
    expect(store.lastMessageTimestamps).toEqual({ a3: 300 });
    expect(store.readEmails).toEqual({ other: true });
    // starred pruned to surviving ids.
    expect(store.starredEmails).toEqual(['keep-me']);
  });

  test('missing inboxes are isolated failures that never abort the batch', async () => {
    const a1 = liveAddress('a1', 'a@test.com');
    seedAddress(a1, ['e1']);

    const { results } = await deleteAddresses(['a1', 'ghost-id'], false);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ addressId: 'a1', success: true });
    expect(results[1]).toMatchObject({ addressId: 'ghost-id', success: false });
    expect((store.addresses as Address[]).map((a) => a.id)).toEqual([]);
  });

  test('regression: deleted inboxes are forgotten by the intelligence stores', async () => {
    // A deleted inbox must not keep steering site replay (lastAddressId
    // switches the ACTIVE inbox on the next fill) nor carry a lifecycle
    // value score until the recency cap evicts it. Runs the REAL purge
    // against the in-memory store - wiring and behavior together.
    const a1 = liveAddress('a1', 'a@test.com');
    const a2 = liveAddress('a2', 'b@test.com');
    seedAddress(a1, []);
    seedAddress(a2, []);
    store.siteProfiles = {
      'shop.example': {
        domain: 'shop.example',
        lastAddressId: 'a1',
        lastEmail: 'a@test.com',
        successCount: 2,
        fieldKindsSeen: [],
        preferredMode: 'replay',
        updatedAt: 1,
      },
      'other.example': {
        domain: 'other.example',
        lastAddressId: 'a2',
        successCount: 0,
        fieldKindsSeen: [],
        preferredMode: 'auto',
        updatedAt: 1,
      },
    };
    store.addressLifecycle = { a1: { addressId: 'a1' }, a2: { addressId: 'a2' } };

    const { results } = await deleteAddresses(['a1'], false);

    expect(results).toEqual([{ addressId: 'a1', success: true }]);
    const profiles = store.siteProfiles as Record<string, Record<string, unknown>>;
    // The profile itself survives (it describes the SITE)…
    const siteProfile = profiles['shop.example'];
    expect(siteProfile).toBeDefined();
    // …the burned inbox's pointers are gone…
    expect(siteProfile?.lastAddressId).toBeUndefined();
    expect(siteProfile?.lastEmail).toBeUndefined();
    expect(siteProfile?.successCount).toBe(2);
    // …and unrelated profiles/lifecycle entries are untouched.
    expect(profiles['other.example']?.lastAddressId).toBe('a2');
    const lifecycle = store.addressLifecycle as Record<string, unknown>;
    expect(lifecycle.a1).toBeUndefined();
    expect(lifecycle.a2).toBeDefined();
  });

  test('an intelligence-purge failure never fails the delete itself', async () => {
    // Make the purge fail by poisoning the store shape it reads.
    const a1 = liveAddress('a1', 'a@test.com');
    seedAddress(a1, []);
    store.siteProfiles = null;

    const { results } = await deleteAddresses(['a1'], false);

    expect(results).toEqual([{ addressId: 'a1', success: true }]);
    expect((store.addresses as Address[]).map((a) => a.id)).toEqual([]);
  });

  test('empty / non-string inputs resolve to an empty result, not an error', async () => {
    expect(await deleteAddresses([], false)).toEqual({ results: [] });
    expect(await deleteAddresses([42 as unknown as string], false)).toEqual({ results: [] });
    // A garbage-but-string id still resolves as an isolated not-found failure.
    const { results } = await deleteAddresses([''], false);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ addressId: '', success: false });
  });

  test('preserveEmails=true removes the inbox but keeps non-destructive tables intact', async () => {
    const a1 = liveAddress('a1', 'a@test.com');
    seedAddress(a1, ['e1']);
    store.seenEmailIds = { 'a@test.com': ['e1'] };
    store.readEmails = { 'a@test.com_e1': true };

    const { results } = await deleteAddresses(['a1'], true);

    expect(results).toEqual([{ addressId: 'a1', success: true }]);
    expect(store.addresses).toEqual([]);
    expect(store.seenEmailIds).toEqual({});
    // Original preserve path leaves readEmails alone (archived mail survives).
    expect(store.readEmails).toEqual({ 'a@test.com_e1': true });
  });
});

describe('runWithConcurrency (the bounded fan-out deleteAddresses uses for per-inbox forgetMe)', () => {
  test('a hanging task never blocks its siblings - all tasks start in parallel', async () => {
    const starts: string[] = [];
    let openGate: () => void = () => {
      throw new Error('gate was never initialized');
    };
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });

    const pending = runWithConcurrency(
      ['a@test.com', 'b@test.com', 'c@test.com'],
      3,
      async (addr) => {
        starts.push(addr);
        if (addr === 'b@test.com') await gate;
        return `done-${addr}`;
      }
    );

    // Event-driven: wait until ALL THREE have STARTED, with b still hanging.
    // A sequential fan-out could never start c before b completed, so this
    // directly pins the parallel contract the batch delete relies on.
    try {
      const deadline = Date.now() + 5_000;
      while (starts.length < 3) {
        if (Date.now() > deadline) throw new Error('fan-out did not start all tasks');
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(starts).toEqual(['a@test.com', 'b@test.com', 'c@test.com']);
    } finally {
      openGate();
    }

    await expect(pending).resolves.toEqual([
      'done-a@test.com',
      'done-b@test.com',
      'done-c@test.com',
    ]);
  });

  test('a throwing task is isolated - siblings complete and stay in order', async () => {
    // deleteAddresses wraps each per-inbox forgetMe call in its own try/catch
    // (one failing inbox must never abort the batch); this pins that exact
    // caller shape against the fan-out: the swallowed failure leaves a
    // per-slot result and the remaining tasks still run, in order.
    const results = await runWithConcurrency(
      ['a@test.com', 'b@test.com', 'c@test.com'],
      3,
      async (addr) => {
        try {
          if (addr === 'b@test.com') throw new Error('forget_me exploded');
          return `done-${addr}`;
        } catch {
          return `swallowed-${addr}`;
        }
      }
    );
    expect(results).toEqual(['done-a@test.com', 'swallowed-b@test.com', 'done-c@test.com']);
  });

  test('concurrency limit serializes when set to 1 and clamps to a sane floor', async () => {
    const order: number[] = [];
    await runWithConcurrency([1, 2, 3], 1, async (n) => {
      order.push(n);
      await new Promise((r) => setTimeout(r, 10));
      return n;
    });
    expect(order).toEqual([1, 2, 3]);
    expect(await runWithConcurrency<number, number>([], 0, async (n) => n)).toEqual([]);
  });
});

describe('archiveAddresses / unarchiveAddresses (batched lifecycle)', () => {
  test('archives every requested inbox in one pass, clearing stored bags, keeping others active', async () => {
    const a1 = liveAddress('a1', 'a@test.com');
    const a2 = liveAddress('a2', 'b@test.com');
    const a3 = liveAddress('a3', 'c@test.com');
    seedAddress(a1, ['e1', 'e2']);
    seedAddress(a2, ['e3']);
    seedAddress(a3, []);

    const { results } = await archiveAddresses(['a1', 'a2']);

    expect(results).toEqual([
      { addressId: 'a1', success: true },
      { addressId: 'a2', success: true },
    ]);
    const remaining = store.addresses as Address[];
    expect(remaining.find((a) => a.id === 'a1')?.accountStatus).toBe('archived');
    expect(remaining.find((a) => a.id === 'a2')?.accountStatus).toBe('archived');
    expect(remaining.find((a) => a.id === 'a3')?.accountStatus).toBe('active');
    // Stored emails moved to the archived bag (clearStoredEmails), not lost;
    // the emptied live bags are removed (absent = empty on read).
    expect(store[storedEmailsByAddressKey('a1')]).toBeUndefined();
    expect(
      (store[archivedEmailsByAddressKey('a1')] as Email[] | undefined)?.length
    ).toBeGreaterThan(0);
    expect(store[storedEmailsByAddressKey('a3')]).toBeUndefined();
  });

  test('unarchive restores archived status and brings Offline Saved history back to the live bag', async () => {
    const a1 = liveAddress('a1', 'a@test.com');
    const a2 = { ...liveAddress('a2', 'b@test.com'), accountStatus: 'archived' as const };
    seedAddress(a1, ['e1']);
    seedAddress(a2, []);
    // Seed an archived bag the way clearStoredEmails leaves it.
    store[archivedEmailsByAddressKey('a2')] = [
      { id: 'old-1', received_at: Date.now() - 5000, subject: 'history' },
    ] satisfies Email[];

    const { results } = await unarchiveAddresses(['a1', 'a2', 'ghost-id']);

    expect(results).toEqual([
      { addressId: 'a1', success: true },
      { addressId: 'a2', success: true },
      { addressId: 'ghost-id', success: false, error: 'errors.addressNotFound' },
    ]);
    expect((store.addresses as Address[]).find((a) => a.id === 'a2')?.accountStatus).toBe('active');
    // Archived bag moved into the stored bag as local_only history; the
    // emptied archived bag is removed (absent = empty on read).
    const restoredBag = store[storedEmailsByAddressKey('a2')] as Email[];
    expect(restoredBag.some((e) => e.id === 'old-1' && e.local_only)).toBe(true);
    expect(store[archivedEmailsByAddressKey('a2')]).toBeUndefined();
  });

  test('empty / non-string inputs are no-ops; missing ids are isolated failures', async () => {
    expect(await archiveAddresses([])).toEqual({ results: [] });
    expect(await unarchiveAddresses([99 as unknown as string])).toEqual({ results: [] });
    const a1 = liveAddress('a1', 'a@test.com');
    seedAddress(a1, []);

    const { results } = await archiveAddresses(['ghost-id']);
    expect(results[0]).toMatchObject({ addressId: 'ghost-id', success: false });
  });
});

describe('renewAddresses (batched renewal)', () => {
  test('failed manual auto-renew records the retry backoff for the alarm scheduler', async () => {
    const now = Date.now();
    const renewable = {
      ...liveAddress('a1', 'a@test.com'),
      provider: 'guerrilla',
      autoExtend: true,
      renewalFailCount: 0,
    } as Address;
    seedAddress(renewable, []);

    const { results } = await renewAddresses(['a1']);
    const stored = (store.addresses as Address[])[0];
    if (!stored) throw new Error('Expected renewed inbox record to remain stored');

    expect(results[0]).toMatchObject({
      addressId: 'a1',
      success: false,
      error: 'errors.renewNoToken',
    });
    expect(stored.renewalFailCount).toBe(1);
    expect(stored.lastFailureAt).toBeGreaterThanOrEqual(now);
    expect(stored.nextRetryAt).toBe((stored.lastFailureAt ?? 0) + 60_000);
  });

  test('non-renewable inboxes are per-id rejections - no network, no state change', async () => {
    const a1 = liveAddress('a1', 'a@test.com');
    const a2 = liveAddress('a2', 'b@test.com');
    seedAddress(a1, []);
    seedAddress(a2, []);
    const before = JSON.stringify(store.addresses);

    // burner has expiry.renewable=false / renewalMethod=null, so every inbox
    // resolves through the rejection branch before any EmailService is built.
    const { results } = await renewAddresses(['a1', 'a2']);

    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.success).toBe(false);
      // Stable errors.* code - the UI owns the human language.
      expect(r.error).toBe('errors.renewUnsupported');
    }
    expect(JSON.stringify(store.addresses)).toBe(before);
  });

  test('missing ids fail in request order alongside the resolved ones', async () => {
    const a1 = liveAddress('a1', 'a@test.com');
    seedAddress(a1, []);

    const { results } = await renewAddresses(['ghost-id', 'a1']);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ addressId: 'ghost-id', success: false });
    expect(results[1]).toMatchObject({ addressId: 'a1', success: false });
    expect(results[1]?.error).toBe('errors.renewUnsupported');
  });
});

describe('deleteAddress (single wrapper preserves the old contract)', () => {
  test('resolves success and removes the bag for a live inbox', async () => {
    const a1 = liveAddress('a1', 'a@test.com');
    seedAddress(a1, ['e1']);

    const result = await deleteAddress('a1', false);

    expect(result).toEqual({ addressId: 'a1', success: true });
    expect(store.addresses).toEqual([]);
    expect(store[storedEmailsByAddressKey('a1')]).toBeUndefined();
  });

  test('resolves a not-found failure instead of throwing', async () => {
    const result = await deleteAddress('ghost-id', false);
    expect(result).toMatchObject({ success: false });
    expect(result?.error).toBe('errors.addressNotFound');
  });
});
