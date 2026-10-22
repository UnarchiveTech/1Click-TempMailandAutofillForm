/**
 * Degradation contract for storage-fed content-script autofill paths.
 *
 * Every address/login list a content script consumes arrives through the
 * content bridge as UNTRUSTED data: the whole value can be a non-array (a
 * quota-truncated write, a writer bug) and individual entries can be null,
 * primitives, or objects missing every field. Before `address-liveness.ts`
 * four near-duplicate filters guarded these with subtly different semantics -
 * two of them dereferenced non-array lists (unhandled TypeError inside a
 * click handler → the fill silently died) and two trusted numeric-STRING
 * expiries that `string <= number` compared as NaN (a dead mailbox read as
 * live and got filled).
 *
 * These tests pin the ONE degradation rule all four sites now share:
 *   - a corrupt LIST is the empty list - never a throw
 *   - a corrupt ENTRY is never live - skipped, never filled
 *   - a corrupt EXPIRY is dead - garbage must not resurrect a mailbox
 *   - clean data flows through unchanged (the guard is invisible when storage
 *     is healthy)
 */

import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test';

import {
  arrayOrEmpty,
  isAutofillEmailAvailable,
  isLiveMailboxAddress,
  isObjectRecord,
  sanitizeBackgroundInboxResponse,
  sanitizeTimestampMap,
} from '@/entrypoints/content/shared/address-liveness.js';

// ---------------------------------------------------------------------------
// Bridge-integrated path: getAutofillBlockReason reads storage THROUGH the
// content bridge, so the degradation must hold end-to-end (mock browser →
// bridge → form-filler), not only at the pure predicate level.
// ---------------------------------------------------------------------------

type StorageShape = Record<string, unknown>;

const storageState: { data: StorageShape } = { data: {} };

mock.module('wxt/browser', () => ({
  browser: {
    runtime: {
      sendMessage: (message: Record<string, unknown>) => {
        if (message.type === 'getStorageViaBg') {
          return { success: true, data: { ...storageState.data } };
        }
        return { success: true };
      },
    },
  },
}));

afterAll(() => {
  mock.restore();
});

const { getAutofillBlockReason } = await import('@/entrypoints/content/autofill/form-filler.js');

afterEach(() => {
  storageState.data = {};
});

const HOUR = 60 * 60 * 1000;

test('final signup email validation rejects expired, removed and archived preferred inboxes', () => {
  const live = { id: 'live', address: 'live@example.com', expiresAt: Date.now() + HOUR };
  const dead = { id: 'dead', address: 'old@example.com', expiresAt: Date.now() - 1 };
  expect(isAutofillEmailAvailable([live, dead], 'old@example.com')).toBe(false);
  expect(isAutofillEmailAvailable([live], 'old@example.com')).toBe(false);
  expect(isAutofillEmailAvailable([{ ...live, accountStatus: 'archived' }], live.address)).toBe(
    false
  );
  expect(isAutofillEmailAvailable([live], ' LIVE@EXAMPLE.COM ')).toBe(true);
  expect(isAutofillEmailAvailable([live], 'external@example.com', false)).toBe(true);
  expect(isAutofillEmailAvailable([dead], dead.address, false)).toBe(false);
  expect(isAutofillEmailAvailable(null, 'external@example.com', false)).toBe(false);
});

describe('address-liveness predicate (shared by all four filter sites)', () => {
  test('clean live entry passes', () => {
    expect(isLiveMailboxAddress({ id: 'a', address: 'a@x.com', accountStatus: 'active' })).toBe(
      true
    );
  });

  test('clean archived/deleted entries are not live', () => {
    expect(isLiveMailboxAddress({ address: 'a@x.com', accountStatus: 'archived' })).toBe(false);
    expect(isLiveMailboxAddress({ address: 'a@x.com', accountStatus: 'deleted' })).toBe(false);
  });

  test('clean expired entry is not live; missing/zero expiry is live', () => {
    const now = Date.now();
    expect(isLiveMailboxAddress({ address: 'a@x.com', expiresAt: now - HOUR }, now)).toBe(false);
    expect(isLiveMailboxAddress({ address: 'a@x.com', expiresAt: now + HOUR }, now)).toBe(true);
    expect(isLiveMailboxAddress({ address: 'a@x.com', expiresAt: 0 }, now)).toBe(true);
    expect(isLiveMailboxAddress({ address: 'a@x.com' }, now)).toBe(true);
  });

  test('corrupt entries are never live (nulls, primitives, address-less objects)', () => {
    expect(isLiveMailboxAddress(null)).toBe(false);
    expect(isLiveMailboxAddress(undefined)).toBe(false);
    expect(isLiveMailboxAddress('a@x.com')).toBe(false);
    expect(isLiveMailboxAddress(42)).toBe(false);
    expect(isLiveMailboxAddress({})).toBe(false);
    expect(isLiveMailboxAddress({ accountStatus: 'active' })).toBe(false);
    expect(isLiveMailboxAddress({ address: '' })).toBe(false);
  });

  test('corrupt expiry is DEAD, never silently live', () => {
    const now = Date.now();
    // A numeric string compares `string <= number` as NaN in raw JS - the old
    // duplicated filters read this dead mailbox as live. Garbage must not
    // resurrect a mailbox the background considers expired.
    expect(
      isLiveMailboxAddress({ address: 'a@x.com', expiresAt: '123' as unknown as number }, now)
    ).toBe(false);
    expect(
      isLiveMailboxAddress({ address: 'a@x.com', expiresAt: 'abc' as unknown as number }, now)
    ).toBe(false);
    expect(
      isLiveMailboxAddress({ address: 'a@x.com', expiresAt: {} as unknown as number }, now)
    ).toBe(false);
    expect(isLiveMailboxAddress({ address: 'a@x.com', expiresAt: Number.NaN }, now)).toBe(false);
  });

  test('arrayOrEmpty degrades corrupt list values to the empty list', () => {
    expect(arrayOrEmpty(undefined)).toEqual([]);
    expect(arrayOrEmpty(null)).toEqual([]);
    expect(arrayOrEmpty('garbage')).toEqual([]);
    expect(arrayOrEmpty({ 0: 'not', length: 1 })).toEqual([]);
    expect(arrayOrEmpty([1, 2, 3])).toEqual([1, 2, 3]);
  });

  test('isObjectRecord degrades corrupt record values to not-a-record', () => {
    expect(isObjectRecord(undefined)).toBe(false);
    expect(isObjectRecord(null)).toBe(false);
    expect(isObjectRecord('garbage')).toBe(false);
    expect(isObjectRecord(42)).toBe(false);
    // Arrays are not records: a map guard must not index an array's slots.
    expect(isObjectRecord([1, 2, 3])).toBe(false);
    expect(isObjectRecord({})).toBe(true);
  });

  test('sanitizeTimestampMap: non-object maps degrade to the empty map', () => {
    expect(sanitizeTimestampMap(undefined)).toEqual({});
    expect(sanitizeTimestampMap(null)).toEqual({});
    expect(sanitizeTimestampMap('garbage')).toEqual({});
    expect(sanitizeTimestampMap([1, 2, 3])).toEqual({});
  });

  test('sanitizeTimestampMap: corrupt timestamp VALUES are dropped, never canonized', () => {
    const out = sanitizeTimestampMap({
      'good.com': Date.now(),
      'recently.com': 'recently',
      'nan.com': Number.NaN,
      'empty.com': '',
    });
    expect(Object.keys(out)).toEqual(['good.com']);
  });

  test('sanitizeTimestampMap: healthy values flow through unchanged', () => {
    const ts = Date.now() - 1000;
    expect(sanitizeTimestampMap({ 'example.com': ts })).toEqual({ 'example.com': ts });
  });

  test('sanitizeBackgroundInboxResponse: malformed responses degrade to inbox:null', () => {
    // Non-record responses entirely.
    expect(sanitizeBackgroundInboxResponse(undefined)).toEqual({ inbox: null });
    expect(sanitizeBackgroundInboxResponse('garbage')).toEqual({ inbox: null });
    expect(sanitizeBackgroundInboxResponse(42)).toEqual({ inbox: null });
    // An inbox without an address - the "undefined into the host input" hazard.
    expect(sanitizeBackgroundInboxResponse({ success: true, inbox: { id: 'n1' } })).toEqual({
      inbox: null,
    });
    // A non-object inbox.
    expect(sanitizeBackgroundInboxResponse({ success: true, inbox: 'immediate@x.com' })).toEqual({
      inbox: null,
    });
    // A dead inbox (archived) must not pass the guard either.
    expect(
      sanitizeBackgroundInboxResponse({
        success: true,
        inbox: { id: 'n1', address: 'x@x.com', accountStatus: 'archived' },
      }).inbox
    ).toBeNull();
    // A corrupt expiry must not pass - garbage cannot resurrect a mailbox.
    expect(
      sanitizeBackgroundInboxResponse({
        success: true,
        inbox: { id: 'n1', address: 'x@x.com', expiresAt: '123' },
      }).inbox
    ).toBeNull();
  });

  test('sanitizeBackgroundInboxResponse: needsUserInteraction survives the guard', () => {
    // The flag reports a REAL flow (the background opened the extension UI),
    // not a failure - a malformed inbox must not erase it.
    expect(
      sanitizeBackgroundInboxResponse({ needsUserInteraction: true, inbox: { id: 'n1' } })
    ).toEqual({ inbox: null, needsUserInteraction: true });
    // A non-boolean flag is dropped, not trusted.
    expect(sanitizeBackgroundInboxResponse({ needsUserInteraction: 'yes' })).toEqual({
      inbox: null,
    });
  });

  test('sanitizeBackgroundInboxResponse: a healthy response passes through', () => {
    const inbox = { id: 'n1', address: 'fresh@x.com' };
    expect(sanitizeBackgroundInboxResponse({ success: true, inbox })).toEqual({ inbox });
  });
});

describe('getAutofillBlockReason end-to-end on corrupt storage', () => {
  test('healthy storage: a live active address returns null (no block)', async () => {
    storageState.data = {
      addresses: [{ id: 'a', address: 'a@x.com', accountStatus: 'active' }],
      activeAddressId: 'a',
      onboardingComplete: true,
    };
    expect(await getAutofillBlockReason()).toBeNull();
  });

  test('addresses as a non-array degrades to "no_active" - not a throw', async () => {
    storageState.data = { addresses: 'garbage', activeAddressId: 'a' };
    expect(await getAutofillBlockReason()).toBe('no_active');
    storageState.data = { addresses: { 0: 'not-an-array' } };
    expect(await getAutofillBlockReason()).toBe('no_active');
  });

  test('addresses as a list of garbage entries degrades to "no_active"', async () => {
    storageState.data = {
      addresses: [null, 'a@x.com', 42, {}, { accountStatus: 'active' }],
      activeAddressId: 'a',
    };
    expect(await getAutofillBlockReason()).toBe('no_active');
  });

  test('every entry corrupt EXPIRY (string timestamp) degrades to not fillable', async () => {
    storageState.data = {
      // String epoch-ms timestamps: `string <= number` was NaN, so the old
      // filter read these as live and autofill filled a dead mailbox. Nothing
      // is live now, so the reason is the same as an empty list ('no_active').
      addresses: [{ id: 'a', address: 'a@x.com', expiresAt: String(Date.now() - HOUR) }],
      activeAddressId: 'a',
    };
    expect(await getAutofillBlockReason()).toBe('no_active');
  });

  test('corrupt expiry on the ACTIVE pointer reports "expired" when a live alternative exists', async () => {
    // 'expired' is the preserved original semantic for "something is fillable
    // but the active pointer is not": corrupt expiry on the active address
    // must not slip past it.
    storageState.data = {
      addresses: [
        { id: 'dead', address: 'dead@x.com', expiresAt: String(Date.now() - HOUR) },
        { id: 'live', address: 'live@x.com', accountStatus: 'active' },
      ],
      activeAddressId: 'dead',
    };
    expect(await getAutofillBlockReason()).toBe('expired');
  });

  test('archived/deleted entries degrade to "no_active" even when pointed at', async () => {
    storageState.data = {
      addresses: [{ id: 'a', address: 'a@x.com', accountStatus: 'archived' }],
      activeAddressId: 'a',
    };
    expect(await getAutofillBlockReason()).toBe('no_active');
  });

  test('archived ACTIVE pointer reports "expired" even when a live fallback exists', async () => {
    // Preserved original semantic: the block reason names the ACTIVE pointer's
    // state ('expired') whenever any live mailbox exists - the fill flow then
    // offers the fallback/new-inbox path instead of silently filling the
    // archived one.
    storageState.data = {
      addresses: [
        { id: 'dead', address: 'dead@x.com', accountStatus: 'archived' },
        { id: 'live', address: 'live@x.com', accountStatus: 'active' },
      ],
      activeAddressId: 'dead',
    };
    expect(await getAutofillBlockReason()).toBe('expired');
  });
});
