const UINT32_RANGE = 0x100000000;

export function randomInt(maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
    throw new RangeError('maxExclusive must be a positive integer');
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
  const bucket = randomInt(0x10000); // 65536 equal buckets - enough precision for any UI probability
  return bucket < Math.round(probability * 0x10000);
}

export function randomItem<T>(items: readonly T[]): T | undefined {
  return items.length > 0 ? items[randomInt(items.length)] : undefined;
}

export function randomToken(length = 12): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length }, () => chars[randomInt(chars.length)]).join('');
}
