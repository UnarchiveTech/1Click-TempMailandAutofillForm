import { afterAll, describe, expect, mock, test } from 'bun:test';

mock.module('wxt/browser', () => ({
  browser: {
    storage: {
      onChanged: { addListener: () => {} },
      local: { get: async () => ({}) },
    },
    runtime: { onMessage: { addListener: () => {} } },
  },
}));
const { ARGON2ID_KDF, hashPassword, verifyPassword } = await import('@/utils/security/crypto');
afterAll(() => mock.restore());

describe('hashPassword', () => {
  test('stores a versioned Argon2id profile, salt, and 256-bit output', async () => {
    const hash = await hashPassword('hello');
    expect(hash).toMatch(/^argon2id\$format=1\$v=19\$m=19456,t=2,p=1\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  });

  test('produces different hashes for the same input with random salts', async () => {
    const h1 = await hashPassword('password123');
    const h2 = await hashPassword('password123');
    expect(h1).not.toBe(h2);
  });

  test('produces different hashes for different inputs', async () => {
    const h1 = await hashPassword('abc');
    const h2 = await hashPassword('def');
    const h1Parts = h1.split('$');
    const h2Parts = h2.split('$');
    expect(h1Parts[h1Parts.length - 1]).not.toBe(h2Parts[h2Parts.length - 1]);
  });

  test('is deterministic when the same salt is supplied', async () => {
    const first = await hashPassword('hello');
    const saltHex = first.split('$')[4];
    expect(await hashPassword('hello', saltHex)).toBe(first);
  });

  test('handles empty, unicode, and long passwords', async () => {
    for (const password of ['', 'héllo wörld', 'x'.repeat(10000)]) {
      await expect(hashPassword(password)).resolves.toMatch(/^argon2id\$/);
    }
  });

  test('rejects non-current profiles and malformed salts', async () => {
    await expect(hashPassword('secret', 'abc')).rejects.toThrow('Invalid salt hex');
    expect(
      await verifyPassword(
        'secret',
        `argon2id$format=1$v=19$m=19456,t=2,p=1$${'a'.repeat(32)}$${'b'.repeat(64)}`
      )
    ).toBe(false);
    expect(ARGON2ID_KDF.algorithm).toBe('argon2id');
  });
});

describe('verifyPassword', () => {
  test('correct password verifies and wrong password fails', async () => {
    const hash = await hashPassword('secret');
    expect(await verifyPassword('secret', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  test('rejects old and malformed formats without deriving a key', async () => {
    expect(await verifyPassword('anything', 'notahash')).toBe(false);
    expect(await verifyPassword('secret', `${'a'.repeat(32)}:${'b'.repeat(64)}`)).toBe(false);
    expect(await verifyPassword('secret', 'argon2id$format=1$v=19$m=999999999,t=2,p=1$x$y')).toBe(
      false
    );
  });
});
