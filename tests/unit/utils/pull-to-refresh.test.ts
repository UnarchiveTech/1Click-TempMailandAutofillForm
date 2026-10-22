import { describe, expect, test } from 'bun:test';
import { pullDistanceFor } from '@/utils/ui/pull-to-refresh.js';

describe('pullDistanceFor - resist and clamp the pull drag', () => {
  test('applies the default 0.55 resistance', () => {
    expect(pullDistanceFor(200, 100)).toBeCloseTo(55);
  });

  test('never reports a negative (upward) drag', () => {
    expect(pullDistanceFor(80, 100)).toBe(0);
    expect(pullDistanceFor(100, 100)).toBe(0);
  });

  test('clamps at the default 88px ceiling', () => {
    expect(pullDistanceFor(300, 100)).toBe(88);
    expect(pullDistanceFor(1000, 0)).toBe(88);
  });

  test('honours custom resistance and ceiling', () => {
    expect(pullDistanceFor(100, 0, { resistance: 0.25 })).toBeCloseTo(25);
    expect(pullDistanceFor(1000, 0, { maxDistance: 120 })).toBe(120);
  });

  test('matches the pre-extraction inline math', () => {
    // Legacy: Math.min(Math.max(0, currentY - startY) * 0.55, 88)
    for (const [currentY, startY] of [
      [150, 100],
      [100, 100],
      [400, 120],
      [0, 0],
    ]) {
      expect(pullDistanceFor(currentY, startY)).toBe(
        Math.min(Math.max(0, currentY - startY) * 0.55, 88)
      );
    }
  });
});
