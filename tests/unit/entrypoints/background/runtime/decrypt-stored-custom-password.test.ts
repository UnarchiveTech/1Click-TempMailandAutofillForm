import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { RuntimeMessageSender } from '@/utils/types';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
/**
 * decryptStoredCustomPassword replaces the raw text-carrying decryptData
 * primitive: the background must load the ciphertext from extension storage
 * itself (by source) instead of accepting it in the message, so a page-originated
 * message never carries ciphertext.
 *
 * NOTE: message-handler imports `browser` from 'wxt/browser', so we install
 * the fake via bun's `mock.module` BEFORE the dynamic import (same approach as
 * check-emails-bulk.test.ts / hard-reset-flag.test.ts).
 */

// Initialized at module scope: the background logger calls storage.local.get
// during message-handler's import, before any beforeEach has run.
const storageFixture: Record<string, unknown> = {
  passwordSettings: { useCustom: true, customPassword: 'not-really-encrypted' },
  identities: [{ id: 'identity-1', useRandomPassword: false, customPassword: 'blob' }],
};

const storageGet = mock(async (key: string | string[]) => {
  if (typeof key === 'string') return { [key]: storageFixture[key] };
  const out: Record<string, unknown> = {};
  for (const k of key) out[k] = storageFixture[k];
  return out;
});

// runtime.id is required: wxt/browser falls back to `chrome` when the global
// browser lacks it, and test files share one process - every fake must carry
// the id so the first module load pins a sane runtime.
const mockBrowser = {
  storage: { local: { get: storageGet } },
  runtime: { id: 'test-extension' },
  commands: {},
  tabs: {},
};
mock.module('wxt/browser', () => ({ browser: mockBrowser }));

const { handlers } = await import('@/entrypoints/background/runtime/message-handler.js');

type SendResponse = (response: unknown) => void;

/** Content-script sender on a tab whose hostname matches the claimed domain. */
const sender: RuntimeMessageSender = {
  id: 'ext-id',
  url: 'https://example.com/login',
  tab: { id: 1, url: 'https://example.com/login' },
};

function callHandler(message: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve) => {
    const handler = handlers.decryptStoredCustomPassword as unknown as (
      msg: Record<string, unknown>,
      s: RuntimeMessageSender,
      respond: SendResponse
    ) => Promise<void>;
    handler(message, sender, resolve).catch(() =>
      resolve({ success: false, error: 'handler threw' })
    );
  });
}

function messageFor(
  source: 'passwordSettings' | 'identity',
  extra?: Record<string, unknown>
): Record<string, unknown> {
  return { type: 'decryptStoredCustomPassword', source, domain: 'example.com', ...extra };
}

/**
 * Errors that indicate the handler bailed BEFORE attempting to load + decrypt.
 * These are the localized `errors.*` keys the payload carries (the English
 * detail now lives only in the log).
 */
const PRE_LOAD_ERRORS = new Set<string>(['errors.validationError']);

describe('decryptStoredCustomPassword storage scoping', () => {
  beforeEach(() => {
    storageGet.mockReset();
    storageGet.mockImplementation(async (key: string | string[]) => {
      if (typeof key === 'string') return { [key]: storageFixture[key] };
      const out: Record<string, unknown> = {};
      for (const k of key) out[k] = storageFixture[k];
      return out;
    });
  });

  test('passwordSettings source: legacy plaintext is passed through unchanged', async () => {
    // Values saved before the vault encrypted these stores are plaintext - the
    // background must return them as-is instead of failing decrypt() and
    // forcing content to fall back to its own storage read (which could not
    // distinguish plaintext from ciphertext).
    const resp = (await callHandler(messageFor('passwordSettings'))) as {
      success?: boolean;
      decrypted?: string;
      error?: string;
    };
    expect(storageGet).toHaveBeenCalledWith('passwordSettings');
    expect(resp.success).toBe(true);
    expect(resp.decrypted).toBe('not-really-encrypted');
  });

  test('passwordSettings source: ciphertext-shaped values reach real decryption', async () => {
    // A ciphertext-shaped blob must NOT pass through the legacy-plaintext
    // gate - it reaches decrypt(), which fails (locked / key unavailable in
    // this env) and reports the failure instead of leaking the raw value.
    storageFixture.passwordSettings = {
      useCustom: true,
      customPassword: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAh',
    };
    const resp = (await callHandler(messageFor('passwordSettings'))) as {
      success?: boolean;
      decrypted?: string;
      error?: string;
    };
    expect(storageGet).toHaveBeenCalledWith('passwordSettings');
    expect(resp.success).toBe(false);
    expect(resp.decrypted).toBeUndefined();
    // Failed at the decrypt step, not at a pre-load guard.
    expect(PRE_LOAD_ERRORS.has(resp.error ?? '')).toBe(false);
  });

  test('passwordSettings source returns Custom password not set when unset', async () => {
    storageFixture.passwordSettings = {};
    const resp = await callHandler(messageFor('passwordSettings'));
    expect(resp).toEqual({ success: false, error: 'errors.validationError' });
  });

  test('identity source: background resolves the identity by id (legacy plaintext)', async () => {
    const resp = (await callHandler(messageFor('identity', { identityId: 'identity-1' }))) as {
      success?: boolean;
      decrypted?: string;
      error?: string;
    };
    expect(storageGet).toHaveBeenCalledWith('identities');
    // 'blob' is not ciphertext-shaped - it is passed through as legacy
    // plaintext rather than failing at the decrypt step.
    expect(resp.success).toBe(true);
    expect(resp.decrypted).toBe('blob');
  });

  test('identity source rejects an unknown identityId', async () => {
    const resp = await callHandler(messageFor('identity', { identityId: 'nope' }));
    expect(resp).toEqual({ success: false, error: 'errors.validationError' });
  });

  test('identity source rejects an identity that uses a random password', async () => {
    // useRandomPassword with NO effective custom password (base or per-domain
    // override): there is nothing to decrypt - the guard fires.
    storageFixture.identities = [{ id: 'identity-1', useRandomPassword: true }];
    const resp = await callHandler(messageFor('identity', { identityId: 'identity-1' }));
    expect(resp).toEqual({ success: false, error: 'errors.validationError' });
  });

  test('identity source: a per-domain customPassword override wins over useRandomPassword', async () => {
    // The base identity is random-password-only, but the page's domain carries
    // a customPassword override - the OVERRIDE ciphertext must be resolved
    // (reach the decrypt step) instead of tripping the random-password guard.
    storageFixture.identities = [
      {
        id: 'identity-1',
        useRandomPassword: true,
        domainFieldOverrides: { 'example.com': { customPassword: 'override-blob' } },
      },
    ];
    const resp = (await callHandler(messageFor('identity', { identityId: 'identity-1' }))) as {
      success?: boolean;
      decrypted?: string;
      error?: string;
    };
    expect(storageGet).toHaveBeenCalledWith('identities');
    // 'override-blob' is not ciphertext-shaped - the override is resolved and
    // returned as legacy plaintext (the point: NO pre-load rejection and NO
    // random-password guard fired).
    expect(resp.success).toBe(true);
    expect(resp.decrypted).toBe('override-blob');
  });

  test('identity source returns Custom password not set when the identity has none', async () => {
    storageFixture.identities = [{ id: 'identity-1', useRandomPassword: false }];
    const resp = await callHandler(messageFor('identity', { identityId: 'identity-1' }));
    expect(resp).toEqual({ success: false, error: 'errors.validationError' });
  });

  test('the sender gate runs before any storage load', async () => {
    const resp = await callHandler({
      type: 'decryptStoredCustomPassword',
      source: 'passwordSettings',
      domain: 'attacker.net',
    });
    expect(resp).toEqual({ success: false, error: 'errors.domainMismatch' });
    expect(storageGet).not.toHaveBeenCalled();
  });
});
