const UINT32_RANGE = 0x100000000;

export function randomInt(maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
    throw new RangeError('maxExclusive must be a positive integer');
  }
  if (maxExclusive > UINT32_RANGE) {
    // Rejection sampling above 2^32 collapses `limit` to 0, so `values[0] >= 0`
    // is always true and the do/while spins forever. Refuse loudly instead of
    // freezing the extension. (No current caller exceeds 2^32.)
    throw new RangeError(`maxExclusive must be <= ${UINT32_RANGE}`);
  }

  const limit = Math.floor(UINT32_RANGE / maxExclusive) * maxExclusive;
  const values = new Uint32Array(1);
  do {
    crypto.getRandomValues(values);
  } while (values[0] >= limit);
  return values[0] % maxExclusive;
}

export function randomIntBetween(minInclusive: number, maxInclusive: number): number {
  return minInclusive + randomInt(maxInclusive - minInclusive + 1);
}

export function randomChance(probability: number): boolean {
  if (probability <= 0) return false;
  if (probability >= 1) return true;
  // Use a large power-of-two bucket count to avoid floating-point rounding skew.
  // UINT32_RANGE (2^32) is evenly divisible by itself, so every bucket is equal-sized.
  // `floor` (not `round`) so tiny probabilities never fire MORE often than requested
  // (e.g. p = 0.00001 must succeed ~1/100000 of the time, not round up to 1/65536 ≈ 1.5×).
  // Clamp to 0x10000 so a value just under 1 (whose product rounds up to 65536.0 in
  // floating point) still succeeds on every bucket instead of always returning false.
  const bucket = randomInt(0x10000); // 65536 equal buckets - enough precision for any UI probability
  const threshold = Math.min(0x10000, Math.floor(probability * 0x10000));
  return bucket < threshold;
}

export function randomItem<T>(items: readonly T[]): T | undefined {
  return items.length > 0 ? items[randomInt(items.length)] : undefined;
}

export function randomToken(length = 12): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length }, () => chars[randomInt(chars.length)]).join('');
}
