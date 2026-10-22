/**
 * Regression tests for the content-script message guard.
 *
 * The injected content script's onMessage listener is reachable by any other
 * extension, so the guard must reject forged senders AND restrict message
 * types to the allowlist the script actually handles.
 */
import { describe, expect, test } from 'bun:test';
import {
  CONTENT_SCRIPT_MESSAGE_TYPES,
  contentScriptMessageKey,
  isTrustedContentScriptMessage,
} from '@/utils/content/content-message-guard.js';

const OWN_ID = 'our-extension-id';
const EVIL_ID = 'another-extensions-id';

describe('isTrustedContentScriptMessage - sender check', () => {
  test('rejects a forged (different) sender id', () => {
    expect(isTrustedContentScriptMessage({ type: 'fillOTP', otp: '123456' }, EVIL_ID, OWN_ID)).toBe(
      false
    );
    // Even a plausible name close to ours must fail.
    expect(isTrustedContentScriptMessage({ type: 'ping' }, 'our-extension-id-fake', OWN_ID)).toBe(
      false
    );
  });

  test('rejects missing sender ids and missing own id (fail closed)', () => {
    expect(isTrustedContentScriptMessage({ type: 'ping' }, undefined, OWN_ID)).toBe(false);
    expect(isTrustedContentScriptMessage({ type: 'ping' }, OWN_ID, '')).toBe(false);
    expect(isTrustedContentScriptMessage({ type: 'ping' }, undefined, '')).toBe(false);
  });

  test('accepts a matching sender id', () => {
    expect(isTrustedContentScriptMessage({ type: 'ping' }, OWN_ID, OWN_ID)).toBe(true);
  });

  test('accepts every allowlisted message type from our own extension', () => {
    const samples: Array<[string, unknown]> = [
      ['startSignup', { type: 'startSignup' }],
      ['fillOTP', { type: 'fillOTP', otp: '482901' }],
      ['ping', { type: 'ping' }],
      ['checkFormDetected', { type: 'checkFormDetected' }],
      ['rescanForms', { type: 'rescanForms' }],
      ['refillSavedLogin', { type: 'refillSavedLogin', credential: {} }],
      ['autofillBlocklistChanged', { type: 'autofillBlocklistChanged' }],
      ['sitePrivacySettingsChanged', { type: 'sitePrivacySettingsChanged' }],
      ['collectPerfMarks', { type: 'collectPerfMarks' }],
    ];
    expect(samples).toHaveLength(CONTENT_SCRIPT_MESSAGE_TYPES.size);
    for (const [name, message] of samples) {
      expect(isTrustedContentScriptMessage(message, OWN_ID, OWN_ID)).toBe(true);
      expect(contentScriptMessageKey(message)).toBe(name);
    }
  });

  test('rejects unknown message types even from our own extension (allowlist)', () => {
    const unknowns: unknown[] = [
      { type: 'deleteEverything' },
      { type: 'getStorageViaBg', keys: ['addresses'] }, // background-only message
      { type: 'otpCopied' }, // UI-only message
      { type: '' },
      { action: '' },
      { action: 'startSignup' },
      { noKeyAtAll: true },
    ];
    for (const message of unknowns) {
      expect(isTrustedContentScriptMessage(message, OWN_ID, OWN_ID)).toBe(false);
    }
  });

  test('rejects non-object payloads', () => {
    for (const message of [null, undefined, 'ping', 42, ['fillOTP']]) {
      expect(isTrustedContentScriptMessage(message, OWN_ID, OWN_ID)).toBe(false);
    }
  });
});
