/**
 * Corrupt-storage degradation tests for the disposable-detector chip.
 *
 * The chip's data (active inbox, dismissals, background-created inboxes) all
 * arrive through the content bridge as UNTRUSTED data. The worst consumer is
 * `field.value = record.address` on the HOST PAGE's signup input - a corrupt
 * record without an address used to be able to write the literal string
 * "undefined" into a real form. These tests pin the degradation contract:
 *
 *   - a corrupt address LIST or a corrupt ENTRY yields no offerable record
 *     (null), never a record the fill path could stringify to "undefined"
 *   - a malformed background create-response degrades to `inbox: null`, which
 *     the caller renders as its createFailed tooltip - never a bad fill
 *   - a corrupt dismissed-DOMAIN MAP degrades to "no dismissals" so a
 *     corrupted write cannot be canonized back into the next persist
 *   - healthy data flows through unchanged
 */

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

type SendPayload = Record<string, unknown>;

/** Controllable fake for the content→background bridge. */
const bridgeState: {
  storage: Record<string, unknown>;
  createResponse: unknown;
  calls: SendPayload[];
} = { storage: {}, createResponse: null, calls: [] };

mock.module('wxt/browser', () => ({
  browser: {
    runtime: {
      sendMessage: (message: SendPayload) => {
        bridgeState.calls.push(message);
        if (message.type === 'getStorageViaBg') {
          const keys = Array.isArray(message.keys) ? message.keys : [message.keys];
          const data: Record<string, unknown> = {};
          for (const key of keys)
            if (key in bridgeState.storage) data[key] = bridgeState.storage[key];
          return { success: true, data };
        }
        if (message.type === 'createAddressWithGesture') {
          return bridgeState.createResponse;
        }
        return { success: true };
      },
    },
  },
}));

afterAll(() => {
  mock.restore();
});

const detector = await import('@/entrypoints/content/disposable/disposable-detector.js');

beforeEach(() => {
  bridgeState.storage = {};
  bridgeState.createResponse = null;
  bridgeState.calls = [];
});

const HOUR = 60 * 60 * 1000;

describe('getActiveAddress on corrupt storage', () => {
  test('healthy storage: the active address is returned', async () => {
    bridgeState.storage = {
      activeAddressId: 'a1',
      addresses: [{ id: 'a1', address: 'live@x.com' }],
    };
    expect(await detector.getActiveAddress()).toEqual({ id: 'a1', address: 'live@x.com' });
  });

  test('corrupt address ENTRY (no address) yields null - never a fillable record', async () => {
    bridgeState.storage = {
      activeAddressId: 'a1',
      addresses: [{ id: 'a1' }],
    };
    expect(await detector.getActiveAddress()).toBeNull();
  });

  test('corrupt entry TYPES (null, string) in the list are skipped, not thrown on', async () => {
    bridgeState.storage = {
      activeAddressId: 'a1',
      addresses: [null, 'live@x.com', 42, { id: 'a1', address: 'real@x.com' }],
    };
    // The garbage entries are skipped; the one well-formed match is found.
    expect((await detector.getActiveAddress())?.address).toBe('real@x.com');
  });

  test('a DEAD active address (archived) is not offerable even when pointed at', async () => {
    bridgeState.storage = {
      activeAddressId: 'a1',
      addresses: [{ id: 'a1', address: 'dead@x.com', accountStatus: 'archived' }],
    };
    expect(await detector.getActiveAddress()).toBeNull();
  });

  test('a corrupt EXPIRY (string timestamp) reads as dead - garbage cannot resurrect a mailbox', async () => {
    bridgeState.storage = {
      activeAddressId: 'a1',
      addresses: [{ id: 'a1', address: 'stale@x.com', expiresAt: String(Date.now() - HOUR) }],
    };
    expect(await detector.getActiveAddress()).toBeNull();
  });

  test('corrupt addresses LIST (non-array) degrades to null', async () => {
    bridgeState.storage = { activeAddressId: 'a1', addresses: 'garbage' };
    expect(await detector.getActiveAddress()).toBeNull();
    bridgeState.storage = { activeAddressId: 'a1', addresses: { 0: {} } };
    expect(await detector.getActiveAddress()).toBeNull();
  });
});

describe('createTempAddress on malformed background responses', () => {
  test('a response whose inbox lacks an address degrades to inbox:null', async () => {
    bridgeState.createResponse = { success: true, inbox: { id: 'n1' } };
    const result = await detector.createTempAddress();
    expect(result.inbox).toBeNull();
  });

  test('a non-object inbox degrades to inbox:null', async () => {
    bridgeState.createResponse = { success: true, inbox: 'immediate@x.com' };
    expect((await detector.createTempAddress()).inbox).toBeNull();
  });

  test('a healthy response still returns the inbox (guard is invisible)', async () => {
    bridgeState.createResponse = {
      success: true,
      inbox: { id: 'n1', address: 'fresh@x.com' },
    };
    expect((await detector.createTempAddress()).inbox).toEqual({
      id: 'n1',
      address: 'fresh@x.com',
    });
  });
});

describe('isDomainDismissed on a corrupt dismissed-domain map', () => {
  test('a non-object map degrades to not-dismissed', async () => {
    bridgeState.storage = { dismissedDisposableDomains: 'garbage' };
    expect(await detector.isDomainDismissed('example.com')).toBe(false);
    bridgeState.storage = { dismissedDisposableDomains: [1, 2, 3] };
    expect(await detector.isDomainDismissed('example.com')).toBe(false);
  });

  test('corrupt timestamp VALUES are ignored, not trusted', async () => {
    bridgeState.storage = {
      dismissedDisposableDomains: { 'example.com': 'recently' },
    };
    expect(await detector.isDomainDismissed('example.com')).toBe(false);
  });

  test('a healthy recent dismissal still reads as dismissed', async () => {
    bridgeState.storage = {
      dismissedDisposableDomains: { 'example.com': Date.now() - 1000 },
    };
    expect(await detector.isDomainDismissed('example.com')).toBe(true);
  });
});
