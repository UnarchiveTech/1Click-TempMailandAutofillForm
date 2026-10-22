import { describe, expect, test } from 'bun:test';
import {
  splitAllowlistInput,
  validateAllowlistEntry,
  validateAllowlistInput,
  validateAllowlistRaw,
} from '@/features/address/mailbox-rule-validation.js';

describe('splitAllowlistInput', () => {
  test('splits on commas and whitespace, trims, drops empties', () => {
    expect(splitAllowlistInput('a@x.com, b@y.com  c@z.com ,,')).toEqual([
      'a@x.com',
      'b@y.com',
      'c@z.com',
    ]);
  });

  test('empty and whitespace-only inputs split to nothing', () => {
    expect(splitAllowlistInput('')).toEqual([]);
    expect(splitAllowlistInput('   ,  ')).toEqual([]);
  });
});

describe('validateAllowlistRaw', () => {
  test('flags a space directly before or after @', () => {
    expect(validateAllowlistRaw('user @x.com')).toBe('spaceAroundAt');
    expect(validateAllowlistRaw('user@ x.com')).toBe('spaceAroundAt');
    expect(validateAllowlistRaw('a@x.com, user @y.com')).toBe('spaceAroundAt');
  });

  test('space used purely as a separator is fine', () => {
    expect(validateAllowlistRaw('a@x.com b@y.com')).toBeNull();
    expect(validateAllowlistRaw('a@x.com, @y.com')).toBeNull();
  });

  test('a space before @ after a comma is not flagged', () => {
    expect(validateAllowlistRaw('a@x.com, @y.com, @z.com')).toBeNull();
  });
});

describe('validateAllowlistEntry', () => {
  test('accepts full addresses, bare domains, and @domain forms', () => {
    expect(validateAllowlistEntry('a@x.com')).toBeNull();
    expect(validateAllowlistEntry('user+tag@sub.domain.co.uk')).toBeNull();
    expect(validateAllowlistEntry('x.com')).toBeNull();
    expect(validateAllowlistEntry('@x.com')).toBeNull();
    expect(validateAllowlistEntry('Foo@Bar.COM')).toBeNull();
  });

  test('missing TLD in domains and addresses', () => {
    expect(validateAllowlistEntry('example')).toBe('missingTld');
    expect(validateAllowlistEntry('@example')).toBe('missingTld');
    expect(validateAllowlistEntry('a@example')).toBe('missingTld');
  });

  test('missing domain after @', () => {
    expect(validateAllowlistEntry('a@')).toBe('missingDomain');
    expect(validateAllowlistEntry('@')).toBe('missingDomain');
  });

  test('multiple @ signs', () => {
    expect(validateAllowlistEntry('a@@x.com')).toBe('multipleAt');
    expect(validateAllowlistEntry('a@b@x.com')).toBe('multipleAt');
    expect(validateAllowlistEntry('@@x.com')).toBe('multipleAt');
  });

  test('pasted URL / mailto prefixes', () => {
    expect(validateAllowlistEntry('http://x.com')).toBe('invalidPrefix');
    expect(validateAllowlistEntry('https://x.com')).toBe('invalidPrefix');
    expect(validateAllowlistEntry('mailto:a@x.com')).toBe('invalidPrefix');
  });

  test('empty entries are not errors', () => {
    expect(validateAllowlistEntry('')).toBeNull();
    expect(validateAllowlistEntry('   ')).toBeNull();
  });
});

describe('validateAllowlistInput', () => {
  test('a clean multi-entry list passes', () => {
    expect(validateAllowlistInput('a@x.com, x.com, @y.com')).toEqual([]);
  });

  test('surfaces the raw space-around-@ error', () => {
    const errors = validateAllowlistInput('user @x.com, b@y.com');
    expect(errors[0]).toBe('spaceAroundAt');
  });

  test('flags every bad entry alongside the raw error', () => {
    const errors = validateAllowlistInput('user@ x.com, example, a@@b.com');
    expect(errors).toContain('spaceAroundAt');
    expect(errors).toContain('missingTld');
    expect(errors).toContain('multipleAt');
  });

  test('empty input is valid', () => {
    expect(validateAllowlistInput('')).toEqual([]);
    expect(validateAllowlistInput('  ,  ')).toEqual([]);
  });
});
