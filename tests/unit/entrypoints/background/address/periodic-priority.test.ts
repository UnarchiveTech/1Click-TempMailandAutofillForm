import { describe, expect, test } from 'bun:test';
import { prioritizeAddresses } from '@/entrypoints/background/address/periodic-checks.js';
import type { Address } from '@/utils/types.js';

function address(id: string): Address {
  return { id, address: `${id}@example.test` } as Address;
}

describe('prioritizeAddresses', () => {
  test('starts with the active address and walks toward nearby neighbors', () => {
    const addresses = 'abcdefghijkl'.split('').map(address);

    expect(prioritizeAddresses(addresses, 'i').map((item) => item.id)).toEqual([
      'i',
      'h',
      'j',
      'g',
      'k',
      'f',
      'l',
      'e',
      'd',
      'c',
      'b',
      'a',
    ]);
  });

  test('preserves the original order when no active address is available', () => {
    const addresses = ['a', 'b', 'c'].map(address);

    expect(prioritizeAddresses(addresses).map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(prioritizeAddresses(addresses, 'missing').map((item) => item.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});
