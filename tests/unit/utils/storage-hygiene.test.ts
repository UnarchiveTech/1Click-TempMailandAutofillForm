import { describe, expect, test } from 'bun:test';
import {
  clampProfilePictureDataUrl,
  pruneStoredEmailsMap,
  STORAGE_CAPS,
  trimEmailList,
} from '@/utils/storage-hygiene.js';

describe('storage-hygiene', () => {
  test('trimEmailList keeps newest', () => {
    const list = Array.from({ length: 5 }, (_, i) => ({ received_at: i + 1 }));
    const trimmed = trimEmailList(list, 3);
    expect(trimmed).toHaveLength(3);
    expect(trimmed[0].received_at).toBe(5);
  });

  test('pruneStoredEmailsMap prefers active addresses', () => {
    const map: Record<string, unknown[]> = {};
    for (let i = 0; i < 5; i++) {
      map[`a${i}@test.com`] = [{ received_at: i }];
    }
    const pruned = pruneStoredEmailsMap(map, ['a4@test.com']);
    expect(Object.keys(pruned)).toContain('a4@test.com');
  });

  test('profile picture size cap', () => {
    const ok = `data:image/png;base64,${'a'.repeat(100)}`;
    const big = `data:image/png;base64,${'a'.repeat(STORAGE_CAPS.maxProfilePictureChars + 10)}`;
    expect(clampProfilePictureDataUrl(ok)).toBe(ok);
    expect(clampProfilePictureDataUrl(big)).toBeNull();
  });
});
