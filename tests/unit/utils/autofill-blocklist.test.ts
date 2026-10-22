import { describe, expect, test } from 'bun:test';
import { isBlockedByList, normalizeBlocklistDomain } from '@/utils/content/autofill-blocklist.js';

describe('normalizeBlocklistDomain', () => {
  test('lowercases, strips scheme, path, port and www', () => {
    expect(normalizeBlocklistDomain('https://www.Example.com:8080/login')).toBe('example.com');
    expect(normalizeBlocklistDomain('  EXAMPLE.COM  ')).toBe('example.com');
    expect(normalizeBlocklistDomain('mail.example.com')).toBe('mail.example.com');
    expect(normalizeBlocklistDomain('')).toBe('');
  });
});

describe('isBlockedByList', () => {
  test('exact match blocks', () => {
    expect(isBlockedByList('example.com', ['example.com'])).toBe(true);
    expect(isBlockedByList('example.com', ['other.com'])).toBe(false);
  });

  test('www variant of a blocked domain is blocked (and vice versa)', () => {
    expect(isBlockedByList('www.example.com', ['example.com'])).toBe(true);
    expect(isBlockedByList('example.com', ['www.example.com'])).toBe(true);
    expect(isBlockedByList('https://www.example.com/', ['example.com'])).toBe(true);
  });

  test('any subdomain of a blocked entry is blocked', () => {
    expect(isBlockedByList('login.example.com', ['example.com'])).toBe(true);
    expect(isBlockedByList('a.b.example.com', ['example.com'])).toBe(true);
    // A blocked subdomain must not block a sibling or the parent
    expect(isBlockedByList('example.com', ['login.example.com'])).toBe(false);
    expect(isBlockedByList('other.com', ['example.com'])).toBe(false);
  });

  test('suffix lookalikes are NOT blocked (dot boundary)', () => {
    expect(isBlockedByList('notexample.com', ['example.com'])).toBe(false);
    expect(isBlockedByList('example.com.evil.org', ['example.com'])).toBe(false);
  });

  test('empty inputs never match', () => {
    expect(isBlockedByList('', ['example.com'])).toBe(false);
    expect(isBlockedByList('example.com', [])).toBe(false);
    expect(isBlockedByList('example.com', [''])).toBe(false);
  });
});
