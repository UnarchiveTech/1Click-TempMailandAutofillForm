/**
 * Unit tests for the shared mirror/check helpers in scripts/mirror-locales.ts.
 *
 * missingKeys() drives the --check pre-commit guard: it must report exactly the
 * keys mergeKeys() would add, walking nested objects the same way (arrays and
 * scalars are atomic, and a string-vs-object conflict is left untouched by
 * both - mirror parity).
 */

import { describe, expect, test } from 'bun:test';
import { mergeKeys, missingKeys } from '../../../scripts/mirror-locales';

describe('mirror-locales missingKeys', () => {
  test('reports missing nested leaf keys as dotted paths', () => {
    const source = { inbox: { printNotOpened: 'x', deep: { leaf: 'y' } }, common: { ok: 'z' } };
    const target = { inbox: { printNotOpened: 'x', deep: {} }, common: { ok: 'z' } };
    expect(missingKeys(target, source)).toEqual(['inbox.deep.leaf']);
  });

  test('an empty target reports every source key at its full dotted path', () => {
    expect(missingKeys({}, { a: { b: 'x' }, c: 'y' })).toEqual(['a', 'c']);
  });

  test('a string-vs-object conflict is NOT reported (mirror parity)', () => {
    // mergeKeys() leaves a key alone when only one side is an object, so the
    // check must not flag it either.
    const source = { a: { b: 'x' } };
    expect(missingKeys({ a: 'wrong' }, source)).toEqual([]);
  });

  test('arrays are atomic, matching mergeKeys', () => {
    expect(missingKeys({ ok: 'x' }, { list: ['a', 'b'], ok: 'x' })).toEqual(['list']);
    expect(missingKeys({ list: ['c'] }, { list: ['a', 'b'] })).toEqual([]);
  });

  test('mergeKeys adds exactly the keys missingKeys reports', () => {
    const source = { a: { b: 'x', c: 'y' }, d: ['z'] };
    const target = { a: { b: 'x' } };
    expect(missingKeys(target, source)).toEqual(['a.c', 'd']);
    expect(mergeKeys(structuredClone(target), source)).toEqual(source);
  });
});
