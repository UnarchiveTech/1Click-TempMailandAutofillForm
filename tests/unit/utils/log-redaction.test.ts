import { describe, expect, test } from 'bun:test';

import { REDACTED_MESSAGE_FIELDS, redactMessageForLog } from '@/utils/log-redaction.js';

describe('redactMessageForLog', () => {
  test('blanks every secret-bearing payload field', () => {
    const redacted = redactMessageForLog({
      type: 'encryptData',
      text: 'hunter2',
      credential: { password: 'a-real-password' },
      sessionCredentials: { token: 'a-real-token' },
      username: 'new-login-name',
      expectedUsername: 'old-login-name',
      encrypted: 'ciphertext',
      decrypted: 'plaintext',
    });
    for (const field of REDACTED_MESSAGE_FIELDS) {
      expect(redacted[field]).toBe('[REDACTED]');
    }
    // Guard the specific regression: an OTP / pre-encryption plaintext in `text`
    // must never survive the redaction.
    expect(JSON.stringify(redacted)).not.toContain('hunter2');
    expect(JSON.stringify(redacted)).not.toContain('a-real-password');
  });

  test('leaves non-secret fields intact so the log stays useful', () => {
    const redacted = redactMessageForLog({ type: 'getStorageViaBg', keys: ['themeColors'] });
    expect(redacted).toEqual({ type: 'getStorageViaBg', keys: ['themeColors'] });
  });

  test('does not invent fields that were absent', () => {
    const redacted = redactMessageForLog({ type: 'ping' });
    expect(Object.keys(redacted)).toEqual(['type']);
  });

  test('never returns a non-object payload verbatim', () => {
    expect(redactMessageForLog('a raw secret string')).toEqual({});
    expect(redactMessageForLog(null)).toEqual({});
    expect(redactMessageForLog(undefined)).toEqual({});
  });
});
