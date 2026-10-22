/**
 * Gesture token system - requires explicit user interaction in the extension
 * UI (popup / sidepanel / app tab) before privileged operations like
 * createAddress can be invoked from a content script context.
 *
 * Security model:
 * - Tokens are HMAC-SHA256 signed with a random 256-bit secret generated on
 *   first use and persisted in storage.local - NOT derived from the extension
 *   runtime ID, which is public knowledge for any store-published extension
 *   (CWS URL, AMO listing, externally_connectable messaging, …). An
 *   ID-derived key would let any web page mint valid tokens itself and invoke
 *   privileged handlers (createAddressWithGesture) with zero user interaction;
 *   the random secret is unguessable from outside the extension.
 * - Tokens carry a purpose string, originating tab id, timestamp, and random nonce.
 * - Tokens are single-use: the background script tracks consumed token
 *   nonces in session storage.
 * - Tokens expire after GESTURE_TOKEN_EXPIRY_MS (5 s) - the user must
 *   have opened the extension UI within this window.
 */

import { browser } from 'wxt/browser';
import { withLock } from '@/utils/mutex.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';

/** How long a gesture token remains valid (5 seconds). */
export const GESTURE_TOKEN_EXPIRY_MS = 5_000;

const GESTURE_TOKEN_PREFIX = 'gt2';
const CONSUMED_TOKENS_KEY = 'gesture_token_nonces';
const MAX_CONSUMED_GESTURE_TOKENS = 100;

interface ConsumedGestureNonce {
  nonce: string;
  expiresAt: number;
}

const GESTURE_SECRET_KEY = 'gestureTokenSecret';

function pendingTokenKey(purpose: string, tabId: number): string {
  return `${purpose}:${tabId}`;
}

/**
 * Read the persisted 256-bit HMAC secret, generating and persisting a fresh
 * random one on first use (or when the stored value is corrupt).
 */
async function getOrCreateSecretHex(): Promise<string> {
  const { [GESTURE_SECRET_KEY]: stored } = (await browser.storage.local.get(
    GESTURE_SECRET_KEY
  )) as { [GESTURE_SECRET_KEY]?: string };
  if (typeof stored === 'string' && /^[0-9a-f]{64}$/.test(stored)) return stored;
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const hex = bytesToHex(raw);
  await writeWithRetry({ [GESTURE_SECRET_KEY]: hex });
  return hex;
}

/** Derive the HMAC signing key from the persisted random secret. */
async function getSigningKey(): Promise<CryptoKey> {
  const secret = hexToBytes(await getOrCreateSecretHex());
  return crypto.subtle.importKey(
    'raw',
    secret as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const pairs = hex.match(/.{2}/g);
  if (!pairs) return new Uint8Array(0);
  return Uint8Array.from(pairs.map((p) => parseInt(p, 16)));
}

/** A signed, time-limited gesture token. */
export interface GestureToken {
  token: string;
  expiresAt: number;
}

/**
 * Generate a new gesture token for the given purpose.
 * Called from the background script when the extension UI is opened
 * with a reason that implies user interaction (e.g. autofill-create-address).
 */
export async function generateGestureToken(purpose: string, tabId: number): Promise<GestureToken> {
  if (!Number.isSafeInteger(tabId) || tabId < 0) throw new Error('Invalid gesture tab');
  const key = await getSigningKey();
  const timestamp = Date.now();
  let nonce: string = crypto.randomUUID?.() || '';
  if (!nonce) {
    const nonceBytes = new Uint8Array(16);
    crypto.getRandomValues(nonceBytes);
    nonce = bytesToHex(nonceBytes);
  }
  const payload = `${GESTURE_TOKEN_PREFIX}|${purpose}|${tabId}|${timestamp}|${nonce}`;
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payload) as BufferSource
  );
  const sigHex = bytesToHex(new Uint8Array(sig));
  const token = `${payload}|${sigHex}`;
  return { token, expiresAt: timestamp + GESTURE_TOKEN_EXPIRY_MS };
}

/**
 * Validate a gesture token: verify signature, check expiry, and enforce
 * single-use by tracking the nonce in session storage.
 *
 * Returns `true` only when the token is genuine, unexpired, and unused.
 */
export async function validateAndConsumeGestureToken(
  token: string,
  expectedPurpose: string,
  expectedTabId: number
): Promise<boolean> {
  try {
    if (!Number.isSafeInteger(expectedTabId) || expectedTabId < 0) return false;
    const key = await getSigningKey();
    const parts = token.split('|');
    if (parts.length !== 6) return false;
    const [prefix, purpose, tabIdStr, timestampStr, nonce, signature] = parts;
    if (prefix !== GESTURE_TOKEN_PREFIX) return false;
    if (purpose !== expectedPurpose) return false;
    if (tabIdStr !== String(expectedTabId)) return false;

    const timestamp = parseInt(timestampStr, 10);
    if (!Number.isSafeInteger(timestamp)) return false;
    const age = Date.now() - timestamp;
    if (age < 0 || age > GESTURE_TOKEN_EXPIRY_MS) return false;

    const payload = `${prefix}|${purpose}|${tabIdStr}|${timestampStr}|${nonce}`;
    const sigBytes = hexToBytes(signature) as BufferSource;
    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      new TextEncoder().encode(payload) as BufferSource
    );
    if (!isValid) return false;

    // Enforce single-use: track the nonce in session storage. The check+push+set
    // is a read-modify-write over one session key - two tabs consuming the SAME
    // unexpired token concurrently could both read a list without the nonce and
    // both write it back (double-use). Serialize the RMW through the gesture
    // mutex so exactly one consumer can ever clear a nonce.
    return await withLock('gesture_tokens_lock', async () => {
      const { [CONSUMED_TOKENS_KEY]: consumedRaw } = (await browser.storage.session.get(
        CONSUMED_TOKENS_KEY
      )) as { [CONSUMED_TOKENS_KEY]?: Array<string | ConsumedGestureNonce> };
      const now = Date.now();
      // Migrate the old string-only format conservatively: any legacy nonce
      // may still belong to a valid token for at most one expiry window.
      let migratedLegacyEntries = false;
      const fresh: ConsumedGestureNonce[] = Array.isArray(consumedRaw)
        ? consumedRaw
            .map((entry) => {
              if (typeof entry === 'string') {
                migratedLegacyEntries = true;
                return { nonce: entry, expiresAt: now + GESTURE_TOKEN_EXPIRY_MS };
              }
              if (
                typeof entry === 'object' &&
                entry !== null &&
                typeof (entry as ConsumedGestureNonce).nonce === 'string' &&
                Number.isSafeInteger((entry as ConsumedGestureNonce).expiresAt)
              ) {
                return entry as ConsumedGestureNonce;
              }
              return null;
            })
            .filter((entry): entry is ConsumedGestureNonce => entry !== null)
            .filter((entry) => entry.expiresAt >= now)
        : [];
      // Persist migration even when this consume is rejected as a duplicate or
      // at capacity; otherwise legacy strings would receive a fresh expiry on
      // every retry and could keep the nonce set locked indefinitely.
      if (migratedLegacyEntries) {
        await browser.storage.session.set({ [CONSUMED_TOKENS_KEY]: fresh });
      }
      if (fresh.some((entry) => entry.nonce === nonce)) return false; // already used
      // Fail closed at capacity instead of evicting a nonce whose token could
      // still be valid. Entries expire quickly, so this only throttles an
      // unusually high number of token consumptions inside five seconds.
      if (fresh.length >= MAX_CONSUMED_GESTURE_TOKENS) return false;
      fresh.push({ nonce, expiresAt: timestamp + GESTURE_TOKEN_EXPIRY_MS });
      // Awaited: the nonce write MUST land before the lock releases, or two
      // contexts racing the same unexpired token could both read a list
      // without the nonce and both validate (double-use).
      await browser.storage.session.set({ [CONSUMED_TOKENS_KEY]: fresh });

      return true;
    });
  } catch {
    return false;
  }
}

/**
 * Store a gesture token in session storage so the content script can
 * retrieve it. Called by the background when `openExtensionUi` is invoked
 * with `reason: 'autofill-create-address'`.
 */
export async function storePendingGestureToken(
  token: GestureToken,
  purpose: string,
  tabId: number
): Promise<void> {
  if (!Number.isSafeInteger(tabId) || tabId < 0) throw new Error('Invalid gesture tab');
  await withLock('gesture_tokens_lock', async () => {
    const { pendingGestureTokens = {} } = (await browser.storage.session.get([
      'pendingGestureTokens',
    ])) as {
      pendingGestureTokens?: Record<string, { token: string; expiresAt: number; tabId: number }>;
    };
    pendingGestureTokens[pendingTokenKey(purpose, tabId)] = {
      token: token.token,
      expiresAt: token.expiresAt,
      tabId,
    };
    await browser.storage.session.set({ pendingGestureTokens });
  });
}

/**
 * Retrieve and consume a pending gesture token for the given purpose.
 * Returns the token string, or null if no valid token exists.
 * The read-modify-write is serialized so only one consumer ever receives
 * any given pending token.
 */
export async function consumePendingGestureToken(
  purpose: string,
  tabId: number
): Promise<string | null> {
  if (!Number.isSafeInteger(tabId) || tabId < 0) return null;
  return withLock('gesture_tokens_lock', async () => {
    const { pendingGestureTokens } = (await browser.storage.session.get([
      'pendingGestureTokens',
    ])) as {
      pendingGestureTokens?: Record<string, { token: string; expiresAt: number; tabId: number }>;
    };
    const key = pendingTokenKey(purpose, tabId);
    if (!pendingGestureTokens?.[key]) return null;
    const entry = pendingGestureTokens[key];
    if (entry.expiresAt < Date.now()) {
      delete pendingGestureTokens[key];
      await browser.storage.session.set({ pendingGestureTokens });
      return null;
    }
    if (entry.tabId !== tabId) {
      delete pendingGestureTokens[key];
      await browser.storage.session.set({ pendingGestureTokens });
      return null;
    }
    delete pendingGestureTokens[key];
    await browser.storage.session.set({ pendingGestureTokens });
    return entry.token;
  });
}
