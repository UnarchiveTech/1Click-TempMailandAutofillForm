import { describe, expect, test } from 'bun:test';
import { useCurrentTime } from '@/utils/time-store';

describe('time-store', () => {
  test('returns current time dynamically', () => {
    const timeRef = useCurrentTime();
    expect(typeof timeRef.currentTime).toBe('number');
    expect(timeRef.currentTime).toBeLessThanOrEqual(Date.now());
  });

  test('subscribes and updates, and handles double unsubscribe cleanly', () => {
    const timeRef = useCurrentTime();
    let count = 0;
    const unsub = timeRef.subscribe(() => {
      count++;
    });

    expect(count).toBeGreaterThanOrEqual(1);

    // Unsubscribe first time
    unsub();

    // Unsubscribe second time (should be a no-op, shouldn't crash or cause issues)
    expect(() => unsub()).not.toThrow();
  });
});
