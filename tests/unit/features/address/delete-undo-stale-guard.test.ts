/**
 * The delete-undo toast restores the storage snapshot captured BEFORE the
 * delete, so it is only meaningful while the state it describes is still the
 * state on screen. These tests drive the REAL flows and prove the stale-
 * generation guard: an undo offered before a newer address-lifecycle mutation
 * refuses to run (and says so) instead of walking that newer work back, while a
 * fresh undo still restores exactly as before.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Address } from '@/utils/types.js';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});

const store: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};
/** Flip to make the fake background REJECT the next delete. */
let deleteShouldSucceed = true;

const fakeBrowser = {
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return { ...store };
        const list = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const key of list) if (key in store) out[key] = store[key];
        return out;
      },
      set: async (items: Record<string, unknown>) => Object.assign(store, items),
      remove: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
      },
    },
    session: {
      get: async () => ({ ...sessionStore }),
      set: async (items: Record<string, unknown>) => Object.assign(sessionStore, items),
      remove: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete sessionStore[key];
      },
    },
  },
  runtime: {
    sendMessage: async (message: { type?: string; addressIds?: string[]; addressId?: string }) => {
      if (message?.type === 'deleteAddresses') {
        const ids = message.addressIds || [];
        if (!deleteShouldSucceed) {
          return { results: ids.map((addressId) => ({ addressId, success: false })) };
        }
        store.addresses = ((store.addresses as Address[]) || []).filter(
          (record) => !ids.includes(record.id)
        );
        return { results: ids.map((addressId) => ({ addressId, success: true })) };
      }
      if (message?.type === 'deleteAddress') {
        if (!deleteShouldSucceed) return { success: false };
        store.addresses = ((store.addresses as Address[]) || []).filter(
          (record) => record.id !== message.addressId
        );
        return { success: true };
      }
      return { success: true };
    },
  },
};

mock.module('wxt/browser', () => ({ browser: fakeBrowser }));
Object.assign(globalThis, { browser: fakeBrowser });

const { archiveSelected, deleteSelected } = await import(
  '@/features/address/address-bulk-actions.js'
);
const { removeAddress } = await import('@/features/address/address-management.js');
const { __resetUndoGenerationForTests, isUndoCurrent, markAddressMutation } = await import(
  '@/features/address/undo-generation.js'
);

const SUPERSEDED = 'A newer change replaced that action - nothing was undone';
const DELETED = 'Delete undone';

interface Toast {
  message: string;
  undo: (() => Promise<void>) | null;
}

/** Last toast shown (`.at()` needs an ES2022 lib; this repo builds on ES2020). */
function lastToast(list: Toast[]): Toast | undefined {
  return list[list.length - 1];
}

function record(id: string, address: string, overrides: Partial<Address> = {}): Address {
  return {
    id,
    address,
    provider: 'guerrilla',
    createdAt: 1,
    expiresAt: 0,
    accountStatus: 'active',
    ...overrides,
  } as Address;
}

function addressIds(): string[] {
  return ((store.addresses as Address[]) || []).map((a) => a.id);
}

/** Toast recorder + auto-confirm, shared by both setter contracts. */
function makeSetters(confirm: () => Promise<void> | void) {
  const toasts: Toast[] = [];
  let confirmRun: Promise<void> | null = null;
  const setters = {
    setSelectedAddresses: () => {},
    setSelectedEmail: () => {},
    setEmails: () => {},
    setLoading: () => {},
    setDropdownOpen: () => {},
    loadAddresses: async () => {},
    closeConfirm: () => {},
    showConfirm: (_message: string, onConfirm: () => void) => {
      void confirm;
      confirmRun = Promise.resolve(onConfirm());
    },
    setShowToast: (
      toast: { message: string } | string,
      _type?: string,
      undoAction?: (() => void | Promise<void>) | null
    ) => {
      toasts.push({
        message: typeof toast === 'string' ? toast : toast.message,
        undo: (undoAction as (() => Promise<void>) | null) ?? null,
      });
    },
  };
  return {
    setters,
    toasts,
    /** Run the pending confirm handler (the delete flows are confirm-first). */
    runConfirm: async () => {
      await confirmRun;
    },
  };
}

const STATE = { selectedEmail: '', emails: [], loading: false };

beforeEach(async () => {
  for (const key of Object.keys(store)) delete store[key];
  for (const key of Object.keys(sessionStore)) delete sessionStore[key];
  deleteShouldSucceed = true;
  await __resetUndoGenerationForTests();
});

describe('undo generation guard', () => {
  test('a newer marking makes an earlier revision stale', async () => {
    const first = await markAddressMutation();
    expect(await isUndoCurrent(first)).toBe(true);
    const second = await markAddressMutation();
    expect(await isUndoCurrent(first)).toBe(false);
    expect(await isUndoCurrent(second)).toBe(true);
  });
});

describe('bulk delete-undo', () => {
  test('a fresh undo still restores the deleted inbox', async () => {
    store.addresses = [record('a1', 'one@x.com'), record('a2', 'two@x.com')];
    const { setters, toasts, runConfirm } = makeSetters(() => {});

    await deleteSelected(
      fakeBrowser as never,
      { selectedAddresses: new Set(['a1']) } as never,
      setters as never
    );
    await runConfirm();

    expect(addressIds()).toEqual(['a2']);
    const offer = toasts.find((t) => t.undo);
    expect(offer?.undo).toBeTruthy();

    await offer?.undo?.();

    expect(addressIds()).toEqual(['a2', 'a1']);
    expect(lastToast(toasts)?.message).toBe(DELETED);
  });

  test('an undo offered before a NEWER delete refuses to run', async () => {
    store.addresses = [record('a1', 'one@x.com'), record('a2', 'two@x.com')];
    const first = makeSetters(() => {});
    await deleteSelected(
      fakeBrowser as never,
      { selectedAddresses: new Set(['a1']) } as never,
      first.setters as never
    );
    await first.runConfirm();
    const firstOffer = first.toasts.find((t) => t.undo);

    // Newer delete while the first toast is still on screen.
    const second = makeSetters(() => {});
    await deleteSelected(
      fakeBrowser as never,
      { selectedAddresses: new Set(['a2']) } as never,
      second.setters as never
    );
    await second.runConfirm();
    expect(addressIds()).toEqual([]);

    await firstOffer?.undo?.();

    // Nothing came back - the stale snapshot was never written - and the user
    // is told, instead of a silent no-op or a false "Delete undone".
    expect(addressIds()).toEqual([]);
    expect(lastToast(first.toasts)?.message).toBe(SUPERSEDED);
    expect(first.toasts.some((t) => t.message === DELETED)).toBe(false);
  });

  test('a newer ARCHIVE invalidates a pending delete undo', async () => {
    store.addresses = [record('a1', 'one@x.com'), record('a2', 'two@x.com')];
    const del = makeSetters(() => {});
    await deleteSelected(
      fakeBrowser as never,
      { selectedAddresses: new Set(['a1']) } as never,
      del.setters as never
    );
    await del.runConfirm();
    const offer = del.toasts.find((t) => t.undo);

    const arch = makeSetters(() => {});
    await archiveSelected(
      fakeBrowser as never,
      { selectedAddresses: new Set(['a2']) } as never,
      arch.setters as never
    );
    const archived = (store.addresses as Address[]).find((a) => a.id === 'a2');

    await offer?.undo?.();

    expect(lastToast(del.toasts)?.message).toBe(SUPERSEDED);
    // The archive is untouched, and the deleted inbox stayed deleted.
    expect(addressIds()).toEqual(['a2']);
    expect(archived?.accountStatus).toBe('archived');
  });
});

describe('single delete-undo', () => {
  test('a fresh undo restores the inbox', async () => {
    store.addresses = [record('a1', 'one@x.com')];
    const { setters, toasts } = makeSetters(() => {});

    await removeAddress(
      fakeBrowser as never,
      record('a1', 'one@x.com'),
      STATE as never,
      setters as never
    );

    expect(addressIds()).toEqual([]);
    const offer = toasts.find((t) => t.undo);
    await offer?.undo?.();

    expect(addressIds()).toEqual(['a1']);
    expect(lastToast(toasts)?.message).toBe(DELETED);
  });

  test('an undo offered before a newer delete refuses to run', async () => {
    store.addresses = [record('a1', 'one@x.com'), record('a2', 'two@x.com')];
    const first = makeSetters(() => {});
    await removeAddress(
      fakeBrowser as never,
      record('a1', 'one@x.com'),
      STATE as never,
      first.setters as never
    );
    const firstOffer = first.toasts.find((t) => t.undo);

    const second = makeSetters(() => {});
    await removeAddress(
      fakeBrowser as never,
      record('a2', 'two@x.com'),
      STATE as never,
      second.setters as never
    );
    expect(addressIds()).toEqual([]);

    await firstOffer?.undo?.();

    expect(addressIds()).toEqual([]);
    expect(lastToast(first.toasts)?.message).toBe(SUPERSEDED);
  });

  test('a rejected delete leaves the pending undo valid (nothing changed)', async () => {
    store.addresses = [record('a1', 'one@x.com'), record('a2', 'two@x.com')];
    const first = makeSetters(() => {});
    await deleteSelected(
      fakeBrowser as never,
      { selectedAddresses: new Set(['a1']) } as never,
      first.setters as never
    );
    await first.runConfirm();
    const offer = first.toasts.find((t) => t.undo);

    // A second delete that the background REJECTS must not invalidate the undo
    // that still describes the truth.
    deleteShouldSucceed = false;
    const failed = makeSetters(() => {});
    await deleteSelected(
      fakeBrowser as never,
      { selectedAddresses: new Set(['a2']) } as never,
      failed.setters as never
    );
    await failed.runConfirm();

    await offer?.undo?.();

    expect(store.addresses as Address[]).toEqual([
      expect.objectContaining({ id: 'a2' }),
      expect.objectContaining({ id: 'a1' }),
    ]);
    expect(lastToast(first.toasts)?.message).toBe(DELETED);
  });
});
