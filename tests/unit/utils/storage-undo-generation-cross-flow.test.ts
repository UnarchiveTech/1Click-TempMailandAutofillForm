/**
 * Cross-flow stale-generation guard: the shared revision counter now spans the
 * delete-undo, the replace-import undo AND the MailProviderView domain-switch
 * undo. These tests prove the two directions that were previously unguarded:
 *
 *   • a landed REPLACE IMPORT marks a revision, so a delete-undo offered
 *     before it can no longer walk the imported surface back, and the undo the
 *     import itself offers carries that revision (`summary.undoRevision`);
 *   • a landed import-undo RESTORE is itself a surface mutation, so undos
 *     offered before it are invalidated too.
 *
 * The domain-switch wiring is proven in
 * tests/unit/components/settings/mail-provider-undo.test.ts (real component).
 */

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

import * as realEmailService from '@/utils/email/email-service.js';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});

const localStore: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};

function pick(
  store: Record<string, unknown>,
  keys?: string | string[] | null
): Record<string, unknown> {
  if (keys === null || keys === undefined) return { ...store };
  const list = Array.isArray(keys) ? keys : [keys];
  const out: Record<string, unknown> = {};
  for (const k of list) if (k in store) out[k] = store[k];
  return out;
}

const mockBrowser = {
  runtime: { id: 'test-cross-flow' },
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => pick(localStore, keys),
      set: async (items: Record<string, unknown>) => Object.assign(localStore, items),
      remove: async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete localStore[k];
      },
    },
    session: {
      get: async (keys?: string | string[] | null) => pick(sessionStore, keys),
      set: async (items: Record<string, unknown>) => Object.assign(sessionStore, items),
      remove: async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete sessionStore[k];
      },
    },
  },
};

(globalThis as unknown as { browser?: unknown }).browser = mockBrowser;
mock.module('wxt/browser', () => ({ browser: mockBrowser }));
// importBackup consults provider config for expiry policy - pin it so the test
// does not depend on the bundled catalog, while keeping every OTHER export of
// email-service real: the import graph reaches modules that import more of it
// (e.g. DEFAULT_PROVIDER), and a partial mock starves those bindings
// ("Export named 'DEFAULT_PROVIDER' not found").
mock.module('@/utils/email/email-service.js', () => ({
  ...realEmailService,
  loadProviderConfig: (id: string) => {
    if (id === 'guerrilla') {
      return { id, expiry: { renewable: true, duration: 3600000 } };
    }
    throw new Error(`Unknown provider: ${id}`);
  },
}));

const { restoreImportUndo, IMPORT_UNDO_KEY } = await import('@/utils/storage/storage-snapshot.js');
const { __resetUndoGenerationForTests, isUndoCurrent, markAddressMutation } = await import(
  '@/utils/storage/undo-generation.js'
);
const { importBackup } = await import('@/features/settings/backup-actions.js');

const NOW = Date.now();

function address(id: string, email: string) {
  return {
    id,
    address: email,
    provider: 'guerrilla',
    createdAt: NOW - 60_000,
    expiresAt: NOW + 3_600_000,
    accountStatus: 'active' as const,
  };
}

beforeEach(async () => {
  for (const k of Object.keys(localStore)) delete localStore[k];
  for (const k of Object.keys(sessionStore)) delete sessionStore[k];
  await __resetUndoGenerationForTests();
});

describe('shared undo revision across flows', () => {
  test('a mutation in a separately loaded context invalidates the first context', async () => {
    const otherContextSpec = '../../../src/utils/storage/undo-generation.ts?other-context';
    const otherContext = (await import(
      otherContextSpec
    )) as typeof import('@/utils/storage/undo-generation.js');
    const first = await markAddressMutation();
    expect(await isUndoCurrent(first)).toBe(true);
    expect(await otherContext.isUndoCurrent(first)).toBe(true);
    const second = await otherContext.markAddressMutation();
    expect(second).not.toBe(first);
    expect(await isUndoCurrent(first)).toBe(false);
    expect(await isUndoCurrent(second)).toBe(true);
    expect(await otherContext.isUndoCurrent(second)).toBe(true);
  });

  test('a missing shared marker refuses undo', async () => {
    const issued = await markAddressMutation();
    await __resetUndoGenerationForTests();
    expect(await isUndoCurrent(issued)).toBe(false);
  });

  test('an unreadable shared marker fails closed', async () => {
    const issued = await markAddressMutation();
    const read = mockBrowser.storage.local.get;
    mockBrowser.storage.local.get = async () => {
      throw new Error('storage unavailable');
    };
    try {
      expect(await isUndoCurrent(issued)).toBe(false);
    } finally {
      mockBrowser.storage.local.get = read;
    }
  });

  test('a landed import-undo restore invalidates undos offered before it', async () => {
    localStore[IMPORT_UNDO_KEY] = {
      capturedAt: NOW,
      addresses: [address('addr-a', 'a@example.com')],
      activeAddressId: 'addr-a',
      emailStorageAddressIndex: { 'addr-a': 'a@example.com' },
      archivedAddressOverflow: [],
      storedEmailsById: {},
      archivedEmailsById: {},
      emailStorageMetadata: {},
    };

    // An undo (e.g. a delete-undo) offered while the import toast was up.
    const revisionBeforeRestore = await markAddressMutation();

    const restored = await restoreImportUndo(mockBrowser as never);
    expect(restored).toBe(true);
    expect((localStore.addresses as Array<{ id: string }>).map((a) => a.id)).toEqual(['addr-a']);

    // The restore LANDED: the earlier undo is stale, a fresh one is current.
    expect(await isUndoCurrent(revisionBeforeRestore)).toBe(false);
    expect(await isUndoCurrent(await markAddressMutation())).toBe(true);
    // The snapshot is consumed (one-shot undo), as before.
    expect(localStore[IMPORT_UNDO_KEY]).toBeUndefined();
  });

  test('a landed replace-import stamps its undo revision and stales older undos', async () => {
    // A delete-undo offered before the import ran.
    const staleUndoRevision = await markAddressMutation();

    const payload = {
      version: '3',
      exportDate: new Date(NOW).toISOString(),
      data: {
        addresses: [address('imp-1', 'imp@example.com')],
        storedEmails: {},
        archivedEmails: {},
      },
    };
    const summary = await importBackup(
      mockBrowser as never,
      payload as never,
      {
        categories: ['addresses'],
        includeEmails: true,
        expiredMode: 'all',
        conflictPolicy: 'replace',
      } as never,
      async () => {}
    );

    expect(summary.importedAddresses).toBe(1);
    expect((localStore.addresses as Array<{ id: string }>).map((a) => a.id)).toEqual(['imp-1']);
    expect(summary.undoAvailable).toBe(true);
    expect(typeof summary.undoRevision).toBe('string');
    // The undo THIS import offered still describes the newest state…
    expect(await isUndoCurrent(summary.undoRevision as string)).toBe(true);
    // …and the pre-import undo can no longer revert the import.
    expect(await isUndoCurrent(staleUndoRevision)).toBe(false);
  });
});
