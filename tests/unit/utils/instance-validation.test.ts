import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  isPublicHostname,
  isSafeFetchUrl,
  validateCustomInstanceName,
  validateCustomInstanceUrl,
} from '@/utils/instance-validation';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('isSafeFetchUrl', () => {
  test('allows public https URLs', () => {
    expect(isSafeFetchUrl('https://mail.example.com/api').ok).toBe(true);
  });

  test('rejects http URLs for custom provider instances', () => {
    expect(isSafeFetchUrl('http://mail.example.com/api')).toEqual({
      ok: false,
      error: 'Only https URLs are allowed',
    });
  });

  test('rejects localhost and private networks', () => {
    expect(isSafeFetchUrl('https://localhost/api').ok).toBe(false);
    expect(isSafeFetchUrl('https://127.0.0.1/api').ok).toBe(false);
    expect(isSafeFetchUrl('https://192.168.1.10/api').ok).toBe(false);
  });

  test('rejects DNS rebinding helper domains', () => {
    expect(isSafeFetchUrl('https://127-0-0-1.nip.io/api').ok).toBe(false);
    expect(isSafeFetchUrl('https://10.0.0.1.sslip.io/api').ok).toBe(false);
  });
});

describe('hostname and name validation', () => {
  test('rejects private IPv6 and decimal IP address forms', () => {
    expect(isPublicHostname('::1')).toBe(false);
    expect(isPublicHostname('fc00::1')).toBe(false);
    expect(isPublicHostname('2130706433')).toBe(false);
  });

  test('rejects empty and unsafe instance names', () => {
    expect(() => validateCustomInstanceName('   ')).toThrow('Instance name cannot be empty');
    expect(() => validateCustomInstanceName('<script>')).toThrow(
      'Instance name contains invalid characters'
    );
  });
});

describe('validateCustomInstanceUrl', () => {
  test('accepts a public hostname when its A and AAAA answers are public', async () => {
    const fetchMock = mock(async () => new Response(JSON.stringify({ Answer: [] })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      validateCustomInstanceUrl('https://mail.example.com/api')
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('rejects a hostname that resolves to a private IPv4 address', async () => {
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({ Answer: [{ type: 1, data: '10.0.0.12' }] }))
    ) as unknown as typeof fetch;

    await expect(validateCustomInstanceUrl('https://mail.example.com/api')).rejects.toThrow(
      'URL hostname resolves to private network'
    );
  });

  test('fails closed when DNS validation cannot complete', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('network unavailable');
    }) as unknown as typeof fetch;

    await expect(validateCustomInstanceUrl('https://mail.example.com/api')).rejects.toThrow(
      'Unable to validate instance hostname'
    );
  });
});
