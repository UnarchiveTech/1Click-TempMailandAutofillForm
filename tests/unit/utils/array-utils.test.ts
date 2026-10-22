import { describe, expect, test } from 'bun:test';
import { moveItemBefore } from '@/utils/array-utils.js';

describe('moveItemBefore', () => {
  test('moves a row before a later target without skipping a slot', () => {
    expect(moveItemBefore(['A', 'B', 'C', 'D'], 0, 2)).toEqual(['B', 'A', 'C', 'D']);
    expect(moveItemBefore(['A', 'B', 'C', 'D'], 1, 3)).toEqual(['A', 'C', 'B', 'D']);
  });

  test('moves a row before an earlier target', () => {
    expect(moveItemBefore(['A', 'B', 'C', 'D'], 2, 0)).toEqual(['C', 'A', 'B', 'D']);
  });

  test('returns null for identical or invalid indices', () => {
    expect(moveItemBefore(['A', 'B'], 1, 1)).toBeNull();
    expect(moveItemBefore(['A', 'B'], -1, 0)).toBeNull();
    expect(moveItemBefore(['A', 'B'], 0, 2)).toBeNull();
  });
});
