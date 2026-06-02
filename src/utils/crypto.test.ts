import { describe, expect, test } from 'bun:test';
import { hashPassword } from './crypto';

// ── hashPassword (pure, no browser dependency) ──────────────────────────────

describe('hashPassword', () => {
  test('returns a hex string of length 64', async () => {
    const hash = await hashPassword('hello');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('is deterministic for same input', async () => {
    const h1 = await hashPassword('password123');
    const h2 = await hashPassword('password123');
    expect(h1).toBe(h2);
  });

  test('produces different hashes for different inputs', async () => {
    const h1 = await hashPassword('abc');
    const h2 = await hashPassword('def');
    expect(h1).not.toBe(h2);
  });

  test('handles empty string', async () => {
    const hash = await hashPassword('');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('hashes to known SHA-256 value for "hello"', async () => {
    const hash = await hashPassword('hello');
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  test('handles unicode characters', async () => {
    const hash = await hashPassword('héllo wörld');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('handles long input', async () => {
    const long = 'x'.repeat(10000);
    const hash = await hashPassword(long);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('produces consistent output format', async () => {
    for (let i = 0; i < 10; i++) {
      const hash = await hashPassword(`test-${i}`);
      expect(hash.length).toBe(64);
    }
  });
});
