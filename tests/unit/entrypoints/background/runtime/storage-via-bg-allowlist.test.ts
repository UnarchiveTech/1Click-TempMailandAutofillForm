import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { RuntimeMessageSender } from '@/utils/types';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
/**
 * getStorageViaBg/setStorageViaBg gate content scripts on a key allowlist
 * (extension pages bypass). Reads are broad (autofill/OTP/disposable flows on
 * any page); WRITES are a strict subset - content must never be able to
 * corrupt extension-owned data (addresses, identities, passwordSettings,
 * sessionCredentials, …). This pins that split. The return-to-form handoff
 * (pendingAutofill*) is intentionally NOT here: content writes it through the
 * dedicated `flagReturnToForm` handler into ephemeral storage.session.
 */

let storage: Record<string, unknown> = {};

const storageGet = mock(async (key: string | string[]) => {
  if (typeof key === 'string') return { [key]: storage[key] };
  const out: Record<string, unknown> = {};
  for (const k of key) out[k] = storage[k];
  return out;
});

const storageSet = mock(async (items: Record<string, unknown>) => {
  Object.assign(storage, items);
});

// runtime.id is required: wxt/browser falls back to `chrome` when the global
// browser lacks it, and test files share one process - every fake must carry
// the id so the first module load pins a sane runtime.
const mockBrowser = {
  storage: { local: { get: storageGet, set: storageSet } },
  runtime: { id: 'test-extension' },
  commands: {},
  tabs: {},
};
mock.module('wxt/browser', () => ({ browser: mockBrowser }));

const { handlers } = await import('@/entrypoints/background/runtime/message-handler.js');

/** Content-script sender on example.com. */
const pageSender: RuntimeMessageSender = {
  id: 'ext-id',
  url: 'https://example.com/login',
  tab: { id: 1, url: 'https://example.com/login' },
};

/** Extension-page sender (bypasses the allowlist by design). */
const extensionSender: RuntimeMessageSender = {
  id: 'ext-id',
  url: 'chrome-extension://abcefefghi/popup.html',
};

function callHandler(
  handlerKey: 'getStorageViaBg' | 'setStorageViaBg' | 'routeIdentityForDomain',
  message: Record<string, unknown>,
  sender: RuntimeMessageSender
): Promise<unknown> {
  return new Promise((resolve) => {
    const handler = handlers[handlerKey] as unknown as (
      msg: Record<string, unknown>,
      s: RuntimeMessageSender,
      respond: (r: unknown) => void
    ) => Promise<void>;
    handler(message, sender, resolve).catch(() =>
      resolve({ success: false, error: 'handler threw' })
    );
  });
}

describe('setStorageViaBg content-write allowlist', () => {
  beforeEach(() => {
    storage = {};
    storageGet.mockReset();
    storageSet.mockReset();
    storageGet.mockImplementation(async (key: string | string[]) => {
      if (typeof key === 'string') return { [key]: storage[key] };
      const out: Record<string, unknown> = {};
      for (const k of key) out[k] = storage[k];
      return out;
    });
    storageSet.mockImplementation(async (items: Record<string, unknown>) => {
      Object.assign(storage, items);
    });
  });

  test('denies writing extension-owned addresses', async () => {
    const resp = await callHandler('setStorageViaBg', { items: { addresses: [] } }, pageSender);
    expect(resp).toEqual({
      success: false,
      error: 'errors.storageAccessDenied',
    });
    expect(storageSet).not.toHaveBeenCalled();
  });

  test('denies writing passwordSettings and identities', async () => {
    const resp = await callHandler(
      'setStorageViaBg',
      { items: { passwordSettings: { customPassword: 'x' }, identities: [] } },
      pageSender
    );
    expect(resp).toEqual({
      success: false,
      error: 'errors.storageAccessDenied',
    });
    expect(storageSet).not.toHaveBeenCalled();
  });

  test('allows one normalized same-site loginInfo item and preserves existing history', async () => {
    storage.loginInfo = [
      { domain: 'other.example', email: 'old@example.com', password: 'encrypted-old-value' },
    ];
    const resp = await callHandler(
      'setStorageViaBg',
      {
        items: {
          loginInfo: [
            {
              id: 'login_1',
              domain: 'example.com',
              email: 'new@example.com',
              timestamp: 123,
              password: '',
              extra: 'discarded',
            },
          ],
        },
      },
      pageSender
    );
    expect(resp).toEqual({ success: true });
    expect(storageSet).toHaveBeenCalledWith({
      loginInfo: [
        {
          id: 'login_1',
          domain: 'example.com',
          timestamp: 123,
          email: 'new@example.com',
          username: null,
        },
        { domain: 'other.example', email: 'old@example.com', password: 'encrypted-old-value' },
      ],
    });
  });

  test('rejects cross-domain, multi-record, and plaintext loginInfo writes', async () => {
    const badInputs = [
      [{ domain: 'attacker.test', email: 'a@attacker.test', timestamp: 1 }],
      [
        { domain: 'example.com', email: 'a@example.com', timestamp: 1 },
        { domain: 'example.com', email: 'b@example.com', timestamp: 2 },
      ],
      [{ domain: 'example.com', email: 'a@example.com', timestamp: 1, password: 'plaintext' }],
    ];
    for (const loginInfo of badInputs) {
      const resp = await callHandler('setStorageViaBg', { items: { loginInfo } }, pageSender);
      expect(resp).toEqual({ success: false, error: 'errors.domainMismatch' });
    }
    expect(storageSet).not.toHaveBeenCalled();
  });

  test('validates activeAddressId against stored addresses', async () => {
    storage.addresses = [{ id: 'known-address' }];
    const accepted = await callHandler(
      'setStorageViaBg',
      { items: { activeAddressId: 'known-address' } },
      pageSender
    );
    expect(accepted).toEqual({ success: true });
    expect(storageSet).toHaveBeenCalledWith({ activeAddressId: 'known-address' });

    storageSet.mockClear();
    const denied = await callHandler(
      'setStorageViaBg',
      { items: { activeAddressId: 'attacker-choice' } },
      pageSender
    );
    expect(denied).toEqual({ success: false, error: 'errors.storageAccessDenied' });
    expect(storageSet).not.toHaveBeenCalled();
  });

  test('denies writing the return-to-form keys (session-handoff only via flagReturnToForm)', async () => {
    const resp = await callHandler(
      'setStorageViaBg',
      {
        items: {
          pendingAutofillReturn: true,
          pendingAutofillUrl: 'https://example.com/form',
          pendingAutofillAt: 1234,
        },
      },
      pageSender
    );
    expect(resp).toEqual({
      success: false,
      error: 'errors.storageAccessDenied',
    });
    expect(storageSet).not.toHaveBeenCalled();
  });

  test('extension pages bypass the write allowlist', async () => {
    const resp = await callHandler(
      'setStorageViaBg',
      { items: { themeColors: { primary: '#000' } } },
      extensionSender
    );
    expect(resp).toEqual({ success: true });
    expect(storageSet).toHaveBeenCalledWith({ themeColors: { primary: '#000' } });
  });
});

describe('routeIdentityForDomain sender binding', () => {
  beforeEach(() => {
    storage = {};
    storageGet.mockReset();
    storageGet.mockImplementation(async (key: string | string[]) => {
      if (typeof key === 'string') return { [key]: storage[key] };
      const out: Record<string, unknown> = {};
      for (const k of key) out[k] = storage[k];
      return out;
    });
  });

  test('rejects routing an identity for a different domain than the sender tab', async () => {
    const resp = await callHandler(
      'routeIdentityForDomain',
      { domain: 'attacker.test', identities: [] },
      pageSender
    );
    expect(resp).toEqual({ success: false, error: 'errors.domainMismatch' });
    expect(storageGet).not.toHaveBeenCalled();
  });
});

describe('getStorageViaBg content-read allowlist', () => {
  test('redacts credentials and tokens from content-readable records', async () => {
    storage.addresses = [
      {
        id: 'a1',
        address: 'a@example.com',
        provider: 'guerrilla',
        createdAt: 1,
        expiresAt: 2,
        token: 'bearer',
        sidToken: 'session',
      },
    ];
    storage.identities = [
      {
        id: 'i1',
        name: 'Identity',
        firstNames: 'A',
        lastNames: 'User',
        useRandomPassword: false,
        customPassword: 'secret',
        isDefault: true,
        createdAt: 1,
      },
    ];
    storage.passwordSettings = { useCustom: true, customPassword: 'secret' };
    storage.loginInfo = [{ domain: 'example.com', password: 'secret', email: 'a@example.com' }];

    const resp = await callHandler(
      'getStorageViaBg',
      { keys: ['addresses', 'identities', 'passwordSettings', 'loginInfo'] },
      pageSender
    );
    expect(resp).toEqual({
      success: true,
      data: {
        addresses: [
          expect.not.objectContaining({ token: expect.anything(), sidToken: expect.anything() }),
        ],
        identities: [expect.objectContaining({ hasCustomPassword: true })],
        passwordSettings: { useCustom: true, hasCustomPassword: true },
        loginInfo: [{ domain: 'example.com', email: 'a@example.com' }],
      },
    });
    expect(
      (resp as { data: { addresses: Array<Record<string, unknown>> } }).data.addresses[0]
    ).not.toHaveProperty('token');
    expect(
      (resp as { data: { addresses: Array<Record<string, unknown>> } }).data.addresses[0]
    ).not.toHaveProperty('sidToken');
    expect(
      (resp as { data: { identities: Array<Record<string, unknown>> } }).data.identities[0]
    ).not.toHaveProperty('customPassword');
  });

  test('requires OTP opt-in before exposing latestOtp to a content script', async () => {
    storage.latestOtp = { otp: '123456', recipient: 'a@example.com' };
    const denied = await callHandler('getStorageViaBg', { keys: 'latestOtp' }, pageSender);
    expect(denied).toEqual({ success: false, error: 'errors.otpAccessNotEnabled' });

    storage.otpOptInList = ['example.com'];
    const allowed = await callHandler('getStorageViaBg', { keys: 'latestOtp' }, pageSender);
    expect(allowed).toEqual({ success: true, data: { latestOtp: storage.latestOtp } });
  });

  test('content can still read addresses (read side is broad)', async () => {
    storage.addresses = [{ id: 'a1' }];
    const resp = await callHandler('getStorageViaBg', { keys: 'addresses' }, pageSender);
    expect((resp as { success: boolean }).success).toBe(true);
  });

  test('content is still denied sensitive non-allowlisted keys', async () => {
    const resp = await callHandler('getStorageViaBg', { keys: 'masterKey' }, pageSender);
    expect(resp).toEqual({ success: false, error: 'errors.storageAccessDenied' });
  });

  // Keys with no content-script consumer (extension-page/background-only) were
  // dropped from the readable allowlist. Pinning the denials keeps the list
  // from rotting back into a stale grant.
  const EXTENSION_ONLY_KEYS = [
    'autofillBlocklist',
    'customEmailSettings',
    'instance_overrides',
    'otpAutoCopyList',
    'preferredLanguage',
    'sessionCredentials',
  ];

  test.each(EXTENSION_ONLY_KEYS)('content is denied the extension-only key %s', async (key) => {
    const resp = await callHandler('getStorageViaBg', { keys: key }, pageSender);
    expect(resp).toEqual({ success: false, error: 'errors.storageAccessDenied' });
  });

  test('extension pages can still read those keys directly', async () => {
    storage.preferredLanguage = 'de';
    storage.sessionCredentials = { site: { username: 'u' } };
    const resp = await callHandler(
      'getStorageViaBg',
      { keys: ['preferredLanguage', 'sessionCredentials'] },
      extensionSender
    );
    expect(resp).toEqual({
      success: true,
      data: { preferredLanguage: 'de', sessionCredentials: { site: { username: 'u' } } },
    });
  });
});
