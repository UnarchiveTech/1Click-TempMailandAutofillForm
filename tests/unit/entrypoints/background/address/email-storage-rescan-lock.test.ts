import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import {
  contentHash,
  setAiConfig,
  setOtpDetectionProvider,
} from '@/entrypoints/background/parsing/ai-detection.js';
import type { Email } from '@/utils/types.js';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// ── Mocks registered BEFORE the dynamic import of email-storage.js ──────────
// Only wxt/browser is module-mocked (in-memory storage). The detection engine
// is REAL - these tests run the actual batched AI path and gate the network
// layer by stubbing global fetch, so they can observe *when* detection runs
// relative to the storage lock. rescanStoredEmails must NOT hold
// `emails_storage_lock` while detection is in flight - new-mail delivery
// (storeNewMessages) and archive/cleanup queue behind that same lock.

const store: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};

const fakeBrowser = {
  runtime: { id: 'test-extension', sendMessage: async () => ({}) },
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

Object.assign(globalThis, { browser: fakeBrowser });

const { clearStoredEmails, rescanStoredEmails } = await import(
  '@/entrypoints/background/address/email-storage.js'
);
const { withLock } = await import('@/utils/mutex.js');
const { archivedEmailsByAddressKey, storedEmailsByAddressKey } = await import(
  '@/utils/storage/storage-keys.js'
);

/** Register an address record + index entry and store its ID-keyed bag. */
function seedMailbox(address: string, emails: import('@/utils/types.js').Email[]): void {
  const id = 'inbox-1';
  store.addresses = [{ id, address }];
  store.emailStorageAddressIndex = { [id]: address };
  store[storedEmailsByAddressKey(id)] = emails;
}

// Gated fetch stub - signals when the AI request starts and blocks until the
// test releases it, so the test can prove other lock users run meanwhile.
let enteredPromise: Promise<void>;
let signalEntered: () => void;
let gate: Promise<void>;
let releaseGate: () => void;
let fetchCalls = 0;

const realFetch = globalThis.fetch;
function installGatedFetch(replyContent: string = DEFAULT_REPLY): void {
  fetchCalls = 0;
  enteredPromise = new Promise<void>((r) => (signalEntered = r));
  gate = new Promise<void>((r) => (releaseGate = r));
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    signalEntered();
    await gate;
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: replyContent } }] }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

const DEFAULT_REPLY = '[{"index":0,"otp":null,"magicLink":null,"magicLinkLabel":null}]';
const OTP_REPLY = '[{"index":0,"otp":"482901","magicLink":null,"magicLinkLabel":null}]';

function otpEmail(): Email {
  return {
    id: 'e-otp',
    from: 'noreply@github.com',
    from_name: 'GitHub',
    subject: 'Your GitHub code is 482901',
    body_plain: 'Your GitHub code is 482901',
    received_at: Math.floor(Date.now() / 1000) - 120,
    stored_at: Date.now(),
  };
}

beforeEach(() => {
  installGatedFetch();
  for (const k of Object.keys(store)) delete store[k];
  // Real AI engine: provider + config must be live for detection to hit fetch.
  setOtpDetectionProvider('ai');
  setAiConfig('http://localhost:11434/v1', 'test-key', 'test-model');
});

afterEach(() => {
  globalThis.fetch = realFetch;
  // ai-detection keeps module-level engine state - restore the default so
  // sibling test files in the same process aren't left in AI mode.
  setOtpDetectionProvider('algorithm');
});

describe('rescanStoredEmails lock discipline', () => {
  test('does not hold the storage lock while detection is running', async () => {
    seedMailbox('a@test.com', [otpEmail()]);

    const rescanPromise = rescanStoredEmails();
    await enteredPromise; // AI request started → lock must already be free

    // A task on the SAME lock must run while detection is still gated.
    let lockTaskRan = false;
    const lockTask = withLock('emails_storage_lock', async () => {
      lockTaskRan = true;
    });

    const winner = await Promise.race([
      lockTask.then(() => 'lock-free' as const),
      rescanPromise.then(() => 'rescan-done' as const),
    ]);

    expect(winner).toBe('lock-free');
    expect(lockTaskRan).toBe(true);

    releaseGate();
    const summary = await rescanPromise;
    expect(fetchCalls).toBe(1);
    expect(summary).toEqual({ scanned: 1, otpsDetected: 0, magicLinksDetected: 0 });
  });

  test('archiving an inbox mid-scan does not block and does not resurrect archived mail', async () => {
    seedMailbox('a@test.com', [otpEmail()]);

    const rescanPromise = rescanStoredEmails();
    await enteredPromise;

    // Detection is in flight with the lock free - archiving must complete now,
    // not queue behind the rescan.
    await clearStoredEmails('a@test.com');

    releaseGate();
    const summary = await rescanPromise;

    expect(summary).toEqual({ scanned: 1, otpsDetected: 0, magicLinksDetected: 0 });
    // The mail moved out of the live ID-keyed bag into the archived bag; the
    // emptied live bag is removed (absent = empty on read), not left as `[]`.
    expect(store[storedEmailsByAddressKey('inbox-1')]).toBeUndefined();
    const archived = store[archivedEmailsByAddressKey('inbox-1')] as Email[];
    expect(archived?.length).toBe(1);
  });

  test('re-scan bypasses a poisoned AI cache and corrects stored detections', async () => {
    const email = otpEmail();
    seedMailbox('a@test.com', [email]);

    // Poison the cache with a "no OTP" verdict for this exact content hash -
    // without bypassCache the re-scan would replay it forever and never ask
    // the model again.
    const hash = contentHash(
      email.subject || '',
      email.body_html || '',
      email.body_plain || '',
      email.from || ''
    );
    store.aiDetectionCache = {
      // Signature is a config fingerprint - the raw key is never stored.
      sig: contentHash('http://localhost:11434/v1', 'test-key', 'test-model'),
      entries: { [hash]: { o: undefined, t: Date.now() } },
    };

    installGatedFetch(OTP_REPLY);
    const rescanPromise = rescanStoredEmails();
    await enteredPromise;
    releaseGate();
    const summary = await rescanPromise;

    // The poisoned entry was bypassed - the model was actually asked.
    expect(fetchCalls).toBe(1);
    expect(summary).toEqual({ scanned: 1, otpsDetected: 1, magicLinksDetected: 0 });
    const bag = store[storedEmailsByAddressKey('inbox-1')] as Email[];
    expect(bag[0].otp).toBe('482901');
    expect(bag[0].isOtp).toBe(true);
  });
});
