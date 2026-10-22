import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// ── Mock 'wxt/browser' BEFORE importing gesture-token ────────────────────────
// gesture-token.ts imports { browser } from 'wxt/browser'. In Bun's test
// runner there is no extension context, so we mock the modules we need.

const sessionStore: Record<string, unknown> = {};
const localStore: Record<string, unknown> = {};

function pick(store: Record<string, unknown>, keys?: string | string[] | null) {
  if (keys === null || keys === undefined) return { ...store };
  const keyArr = Array.isArray(keys) ? keys : [keys];
  const result: Record<string, unknown> = {};
  for (const k of keyArr) {
    if (k in store) result[k] = store[k];
  }
  return result;
}

// A configurable write delay exposes fire-and-forget storage writes: if the
// consumed-nonce write were NOT awaited (void set), a slow set would leave the
// store stale when validate() resolves / the lock releases.
let sessionSetDelayMs = 0;

mock.module('wxt/browser', () => ({
  browser: {
    runtime: {
      id: 'test-extension-id-12345',
    },
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
        set: async (items: Record<string, unknown>) => {
          if (sessionSetDelayMs > 0) {
            await new Promise((r) => setTimeout(r, sessionSetDelayMs));
          }
          Object.assign(sessionStore, items);
        },
        remove: async (keys: string | string[]) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) delete sessionStore[k];
        },
      },
    },
  },
}));

// Dynamic import so the mock is registered first
const { generateGestureToken, validateAndConsumeGestureToken, GESTURE_TOKEN_EXPIRY_MS } =
  await import('@/utils/ui/gesture-token.js');

const encoder = new TextEncoder();
const TAB_ID = 42;
const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

/** Forge a token signed with a key the caller controls (e.g. the PUBLIC extension id). */
async function forgeToken(
  keyMaterial: string,
  purpose: string,
  tabId: number,
  timestamp: number,
  nonce: string
) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(keyMaterial),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const payload = `gt2|${purpose}|${tabId}|${timestamp}|${nonce}`;
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
  return `${payload}|${bytesToHex(sig)}`;
}

describe('gesture-token', () => {
  beforeEach(() => {
    for (const key of Object.keys(sessionStore)) {
      delete sessionStore[key];
    }
    for (const key of Object.keys(localStore)) {
      delete localStore[key];
    }
    sessionSetDelayMs = 0;
  });

  test('generateGestureToken produces a token with payload and expiry', async () => {
    const { token, expiresAt } = await generateGestureToken('autofill-create-address', TAB_ID);
    expect(token).toContain('gt2|autofill-create-address|');
    expect(expiresAt).toBeGreaterThan(Date.now());
    expect(expiresAt - Date.now()).toBeCloseTo(GESTURE_TOKEN_EXPIRY_MS, -2);
  });

  test('signing key is a random persisted 256-bit secret, not the extension id', async () => {
    await generateGestureToken('autofill-create-address', TAB_ID);
    const stored = localStore.gestureTokenSecret;
    expect(typeof stored).toBe('string');
    expect(stored).toMatch(/^[0-9a-f]{64}$/); // 256-bit secret, hex-encoded
    // Reuse the SAME persisted key across mints (no per-call reseed)
    const again = await generateGestureToken('autofill-create-address', TAB_ID);
    expect(localStore.gestureTokenSecret).toBe(stored);
    const ok = await validateAndConsumeGestureToken(again.token, 'autofill-create-address', TAB_ID);
    expect(ok).toBe(true);
  });

  test('rejects a token forged with the public extension id as the key', async () => {
    // The old scheme derived the HMAC key from browser.runtime.id, which any
    // web page knows (CWS/AMO listing, externally_connectable). A forged token
    // signed with that public key must now fail.
    const forged = await forgeToken(
      'test-extension-id-12345',
      'autofill-create-address',
      TAB_ID,
      Date.now(),
      'forged-nonce'
    );
    const ok = await validateAndConsumeGestureToken(forged, 'autofill-create-address', TAB_ID);
    expect(ok).toBe(false);
  });

  test('rotating the stored secret invalidates outstanding tokens', async () => {
    const { token } = await generateGestureToken('autofill-create-address', TAB_ID);
    // Simulate a new install / manual secret rotation
    localStore.gestureTokenSecret = 'f'.repeat(64);
    const ok = await validateAndConsumeGestureToken(token, 'autofill-create-address', TAB_ID);
    expect(ok).toBe(false);
  });

  test('consumed nonce write is awaited: slow storage still single-use', async () => {
    // With a slow session write, a fire-and-forget set (void) would release the
    // lock before the nonce lands - a second consumer would read a stale list
    // and both would validate. Because the write is awaited inside the lock,
    // the store is authoritative the moment validate() resolves.
    sessionSetDelayMs = 50;
    const { token } = await generateGestureToken('autofill-create-address', TAB_ID);
    const ok = await validateAndConsumeGestureToken(token, 'autofill-create-address', TAB_ID);
    expect(ok).toBe(true);
    // The nonce is already persisted when validate() returns (only true if the
    // set was awaited - a void write would still be in flight for ~50ms).
    expect(sessionStore.gesture_token_nonces).toContainEqual(
      expect.objectContaining({ nonce: token.split('|')[4] })
    );
    const again = await validateAndConsumeGestureToken(token, 'autofill-create-address', TAB_ID);
    expect(again).toBe(false);
  });

  test('validateAndConsumeGestureToken accepts a valid token', async () => {
    const { token } = await generateGestureToken('autofill-create-address', TAB_ID);
    const ok = await validateAndConsumeGestureToken(token, 'autofill-create-address', TAB_ID);
    expect(ok).toBe(true);
  });

  test('validateAndConsumeGestureToken rejects wrong purpose', async () => {
    const { token } = await generateGestureToken('autofill-create-address', TAB_ID);
    const ok = await validateAndConsumeGestureToken(token, 'other-purpose', TAB_ID);
    expect(ok).toBe(false);
  });

  test('validateAndConsumeGestureToken rejects malformed token', async () => {
    const ok = await validateAndConsumeGestureToken(
      'gt2|purpose|42|123|nonce|bad',
      'purpose',
      TAB_ID
    );
    expect(ok).toBe(false);
  });

  test('validateAndConsumeGestureToken rejects expired token', async () => {
    // Build a token with a timestamp far in the past
    const token = `gt2|autofill-create-address|${TAB_ID}|${Date.now() - GESTURE_TOKEN_EXPIRY_MS * 2}|nonce|invalidsig`;
    const ok = await validateAndConsumeGestureToken(token, 'autofill-create-address', TAB_ID);
    expect(ok).toBe(false);
  });

  test('validateAndConsumeGestureToken rejects wrong signature', async () => {
    const { token } = await generateGestureToken('autofill-create-address', TAB_ID);
    // Tamper with the signature
    const parts = token.split('|');
    parts[5] = '0'.repeat(parts[5].length);
    const tampered = parts.join('|');
    const ok = await validateAndConsumeGestureToken(tampered, 'autofill-create-address', TAB_ID);
    expect(ok).toBe(false);
  });

  test('validateAndConsumeGestureToken single-use: second consumption fails', async () => {
    const { token } = await generateGestureToken('autofill-create-address', TAB_ID);
    const ok1 = await validateAndConsumeGestureToken(token, 'autofill-create-address', TAB_ID);
    expect(ok1).toBe(true);
    const ok2 = await validateAndConsumeGestureToken(token, 'autofill-create-address', TAB_ID);
    expect(ok2).toBe(false);
  });

  test('validateAndConsumeGestureToken is single-use under CONCURRENT consumption', async () => {
    // Two tabs firing the same unexpired token at the same instant: the
    // check+push+set RMW is serialized through the gesture mutex, so exactly
    // one consumer wins regardless of interleaving (without the lock, both
    // could read the pre-push nonce list and both validate).
    const { token } = await generateGestureToken('autofill-create-address', TAB_ID);
    const results = await Promise.all([
      validateAndConsumeGestureToken(token, 'autofill-create-address', TAB_ID),
      validateAndConsumeGestureToken(token, 'autofill-create-address', TAB_ID),
    ]);
    expect(results.filter(Boolean).length).toBe(1);
    const again = await validateAndConsumeGestureToken(token, 'autofill-create-address', TAB_ID);
    expect(again).toBe(false);
  });

  test('gesture token is bound to the originating tab', async () => {
    const { token } = await generateGestureToken('autofill-create-address', TAB_ID);
    expect(await validateAndConsumeGestureToken(token, 'autofill-create-address', TAB_ID + 1)).toBe(
      false
    );
    expect(await validateAndConsumeGestureToken(token, 'autofill-create-address', TAB_ID)).toBe(
      true
    );
  });

  test('pending tokens are isolated by purpose and tab', async () => {
    const first = await generateGestureToken('autofill-create-address', TAB_ID);
    const second = await generateGestureToken('autofill-create-address', TAB_ID + 1);
    const { storePendingGestureToken, consumePendingGestureToken } = await import(
      '@/utils/ui/gesture-token.js'
    );
    await storePendingGestureToken(first, 'autofill-create-address', TAB_ID);
    await storePendingGestureToken(second, 'autofill-create-address', TAB_ID + 1);
    expect(await consumePendingGestureToken('autofill-create-address', TAB_ID)).toBe(first.token);
    expect(await consumePendingGestureToken('autofill-create-address', TAB_ID + 1)).toBe(
      second.token
    );
  });
});
