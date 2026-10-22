import { describe, expect, test } from 'bun:test';
import { randomChance, randomInt, randomIntBetween } from '@/utils/security/secure-random.js';

describe('randomInt bounds', () => {
  test('throws for non-positive or non-integer bounds', () => {
    expect(() => randomInt(0)).toThrow(RangeError);
    expect(() => randomInt(-5)).toThrow(RangeError);
    expect(() => randomInt(3.5)).toThrow(RangeError);
    expect(() => randomInt(Number.NaN)).toThrow(RangeError);
  });

  test('throws instead of hanging when maxExclusive > 2^32', () => {
    // Regression: limit collapsed to 0 for bounds above 2^32, so
    // `values[0] >= 0` was always true and the rejection loop spun forever.
    expect(() => randomInt(0x100000000 + 1)).toThrow(RangeError);
    expect(() => randomInt(5_000_000_000)).toThrow(RangeError);
    expect(() => randomIntBetween(0, 0x100000000)).toThrow(RangeError);
  });

  test('accepts exactly 2^32 (full uint32 range)', () => {
    for (let i = 0; i < 50; i++) {
      const v = randomInt(0x100000000);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(0x100000000);
    }
  });

  test('stays within bounds for a large sub-2^32 range', () => {
    for (let i = 0; i < 50; i++) {
      const v = randomIntBetween(7_000_000_000, 9_999_999_999);
      expect(v).toBeGreaterThanOrEqual(7_000_000_000);
      expect(v).toBeLessThanOrEqual(9_999_999_999);
    }
  });
});

describe('randomChance', () => {
  test('handles the boundaries deterministically', () => {
    expect(randomChance(0)).toBe(false);
    expect(randomChance(-1)).toBe(false);
    expect(randomChance(1)).toBe(true);
    expect(randomChance(2)).toBe(true);
  });

  test('fires at roughly the requested rate for p = 0.5', () => {
    const N = 20_000;
    let hits = 0;
    for (let i = 0; i < N; i++) {
      if (randomChance(0.5)) hits += 1;
    }
    const rate = hits / N;
    // ±28σ - essentially guaranteed to hold unless the bucket math is broken.
    expect(rate).toBeGreaterThan(0.45);
    expect(rate).toBeLessThan(0.55);
  });

  test('never fires for probabilities below one bucket (floor, not round)', () => {
    // 0.00001 * 65536 ≈ 0.66 buckets. The old Math.round() implementation
    // rounded this UP to 1 bucket (~1/65536 ≈ 15× the requested rate); with
    // Math.floor() the threshold is 0, so it must NEVER fire.
    const N = 200_000;
    let hits = 0;
    for (let i = 0; i < N; i++) {
      if (randomChance(0.00001)) hits += 1;
    }
    expect(hits).toBe(0);
  });

  test('fires at exactly 1/65536 for p = 1/65536', () => {
    // The bucket threshold is integral: p = 1/65536 lands exactly on bucket 1.
    const N = 65536 * 8;
    let hits = 0;
    for (let i = 0; i < N; i++) {
      if (randomChance(1 / 65536)) hits += 1;
    }
    expect(hits).toBeGreaterThan(0);
    expect(hits).toBeLessThan(32); // expected 8 - very generous bound
  });
});
