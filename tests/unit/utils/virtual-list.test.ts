import { describe, expect, test } from 'bun:test';
import { createVirtualListMeasurementCache, getVirtualListWindow } from '@/utils/ui/virtual-list';

describe('getVirtualListWindow', () => {
  test('returns an empty window for an empty list', () => {
    expect(getVirtualListWindow(0, 0, 400, 72)).toEqual({
      start: 0,
      end: 0,
      paddingBefore: 0,
      paddingAfter: 0,
    });
  });

  test('keeps a small list fully renderable', () => {
    expect(getVirtualListWindow(3, 0, 400, 72, 6)).toEqual({
      start: 0,
      end: 3,
      paddingBefore: 0,
      paddingAfter: 0,
    });
  });

  test('adds overscan around the visible range', () => {
    expect(getVirtualListWindow(100, 720, 216, 72, 2)).toEqual({
      start: 8,
      end: 15,
      paddingBefore: 576,
      paddingAfter: 6120,
    });
  });

  test('clamps the range at the beginning and end', () => {
    expect(getVirtualListWindow(10, 10000, 300, 60, 4)).toEqual({
      start: 5,
      end: 10,
      paddingBefore: 300,
      paddingAfter: 0,
    });
  });

  test('supports variable row heights', () => {
    expect(getVirtualListWindow(4, 45, 100, (index) => [40, 80, 120, 60][index], 0)).toEqual({
      start: 1,
      end: 3,
      paddingBefore: 40,
      paddingAfter: 60,
    });
  });

  test('normalizes invalid geometry inputs', () => {
    expect(getVirtualListWindow(4, -20, 0, 0, -2)).toEqual({
      start: 0,
      end: 1,
      paddingBefore: 0,
      paddingAfter: 3,
    });
  });

  test('a new measured-height snapshot replaces cached offsets at the same row count', () => {
    const cache = createVirtualListMeasurementCache();
    const estimated = () => 72;
    const before = getVirtualListWindow(100, 720, 216, estimated, 2, cache);
    const measured = (index: number) => (index < 20 ? 90 : 72);
    const after = getVirtualListWindow(100, 720, 216, measured, 2, cache);
    expect(before.start).toBe(8);
    expect(after).toEqual(getVirtualListWindow(100, 720, 216, measured, 2));
    expect(after.start).toBe(6);
    expect(cache.offsets[20]).toBe(1800);
  });
});
