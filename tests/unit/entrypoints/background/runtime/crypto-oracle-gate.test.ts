import { describe, expect, test } from 'bun:test';
import {
  assertCryptoOracleSender,
  handlers,
  MAX_CRYPTO_ORACLE_TEXT_LENGTH,
} from '@/entrypoints/background/runtime/message-handler';
import type { RuntimeMessageSender } from '@/utils/types';

/**
 * The encryption-oracle gate (assertCryptoOracleSender) hardens
 * encryptData / decryptStoredCustomPassword, which any page's content script
 * can reach: extension pages always pass; content scripts must claim the
 * hostname of the page they are injected on, verified against sender.tab.url.
 * The scoped decrypt handler's storage resolution lives in
 * decrypt-stored-custom-password.test.ts.
 */

/** Content-script sender on a real page tab. */
function pageSender(tabUrl: string): RuntimeMessageSender {
  const url = new URL(tabUrl);
  return {
    id: 'ext-id',
    url: url.href,
    tab: { id: 1, url: tabUrl },
  };
}

/** Extension-page (popup/sidepanel/app tab) sender. */
const extensionPageSender: RuntimeMessageSender = {
  id: 'ext-id',
  url: 'chrome-extension://abcefefghi/popup.html',
};

describe('assertCryptoOracleSender', () => {
  test('allows extension pages without a domain claim', () => {
    expect(() => assertCryptoOracleSender({}, extensionPageSender)).not.toThrow();
  });

  test('allows a content script on the claimed domain', () => {
    expect(() =>
      assertCryptoOracleSender({ domain: 'example.com' }, pageSender('https://example.com/login'))
    ).not.toThrow();
  });

  test('allows a parent credential scope claimed from its subdomain page', () => {
    expect(() =>
      assertCryptoOracleSender({ domain: 'example.com' }, pageSender('https://app.example.com'))
    ).not.toThrow();
  });

  test('rejects a subdomain credential claim from its parent page', () => {
    expect(() =>
      assertCryptoOracleSender({ domain: 'app.example.com' }, pageSender('https://example.com'))
    ).toThrow('Domain mismatch');
  });

  test('rejects a content script claiming another domain', () => {
    expect(() =>
      assertCryptoOracleSender({ domain: 'attacker.net' }, pageSender('https://example.com/login'))
    ).toThrow('Domain mismatch');
  });

  test('rejects a content script with no domain claim', () => {
    expect(() => assertCryptoOracleSender({}, pageSender('https://example.com/login'))).toThrow(
      'Domain mismatch'
    );
  });

  test('rejects a content script with no tab URL (unverifiable page)', () => {
    const sender: RuntimeMessageSender = { id: 'ext-id', url: 'https://example.com/' };
    expect(() => assertCryptoOracleSender({ domain: 'example.com' }, sender)).toThrow(
      'Domain mismatch'
    );
  });

  test('rejects a non-extension sender entirely', () => {
    const webPageSender: RuntimeMessageSender = { id: 'web-page-id', url: 'https://evil.com/' };
    expect(() => assertCryptoOracleSender({ domain: 'evil.com' }, webPageSender)).toThrow(
      'Domain mismatch'
    );
  });
});

// ── handler-level behavior (deterministic, gate fires before crypto runs) ────

type SendResponse = (response: unknown) => void;

function callHandler(
  handlerKey: 'encryptData' | 'decryptStoredCustomPassword',
  message: Record<string, unknown>,
  sender: RuntimeMessageSender
): Promise<unknown> {
  return new Promise((resolve) => {
    const handler = handlers[handlerKey] as unknown as (
      msg: Record<string, unknown>,
      s: RuntimeMessageSender,
      respond: SendResponse
    ) => Promise<void>;
    handler(message, sender, resolve).catch(() =>
      resolve({ success: false, error: 'handler threw' })
    );
  });
}

describe('encryptData / decryptStoredCustomPassword sender gate', () => {
  test('encryptData rejects a mismatched domain claim with Domain mismatch', async () => {
    const resp = await callHandler(
      'encryptData',
      { type: 'encryptData', text: 'anything', domain: 'attacker.net' },
      pageSender('https://example.com/login')
    );
    expect(resp).toEqual({ success: false, error: 'errors.domainMismatch' });
  });

  test('encryptData rejects a content sender with an unverifiable page (no tab)', async () => {
    const noTabSender: RuntimeMessageSender = { id: 'ext-id', url: 'https://example.com/' };
    const resp = await callHandler(
      'encryptData',
      { type: 'encryptData', text: 'anything' },
      noTabSender
    );
    expect(resp).toEqual({ success: false, error: 'errors.domainMismatch' });
  });

  test('encryptData rejects oversized text after a valid gate', async () => {
    const resp = await callHandler(
      'encryptData',
      {
        type: 'encryptData',
        text: 'x'.repeat(MAX_CRYPTO_ORACLE_TEXT_LENGTH + 1),
        domain: 'example.com',
      },
      pageSender('https://example.com/login')
    );
    expect(resp).toEqual({ success: false, error: 'errors.validationError' });
  });

  test('decryptStoredCustomPassword rejects a mismatched domain claim with Domain mismatch', async () => {
    const resp = await callHandler(
      'decryptStoredCustomPassword',
      { type: 'decryptStoredCustomPassword', source: 'passwordSettings', domain: 'attacker.net' },
      pageSender('https://example.com/login')
    );
    expect(resp).toEqual({ success: false, error: 'errors.domainMismatch' });
  });

  test('decryptStoredCustomPassword rejects an unknown source', async () => {
    const resp = await callHandler(
      'decryptStoredCustomPassword',
      {
        type: 'decryptStoredCustomPassword',
        source: 'elsewhere',
        domain: 'example.com',
      } as unknown as Record<string, unknown>,
      pageSender('https://example.com/login')
    );
    expect(resp).toEqual({ success: false, error: 'errors.invalidRequestFormat' });
  });

  test('decryptStoredCustomPassword rejects an identity source without identityId', async () => {
    const resp = await callHandler(
      'decryptStoredCustomPassword',
      {
        type: 'decryptStoredCustomPassword',
        source: 'identity',
        domain: 'example.com',
      } as unknown as Record<string, unknown>,
      pageSender('https://example.com/login')
    );
    expect(resp).toEqual({ success: false, error: 'errors.invalidRequestFormat' });
  });
});
