/**
 * Unit tests for the shared code-point-safe avatar initial helper.
 *
 * Every avatar surface (the `Avatar` primitive, the default-avatar SVG
 * generator, the sender-avatar stack, and address cards) derives its letter
 * through this function, so the surrogate-pair contract is pinned here once.
 */
import { describe, expect, test } from 'bun:test';

import { avatarInitial } from '@/utils/theme/avatar-initials.js';

describe('avatarInitial', () => {
  test('uppercases the first ASCII letter', () => {
    expect(avatarInitial('alice')).toBe('A');
    expect(avatarInitial('alice@example.com')).toBe('A');
  });

  test('keeps an astral first character whole (no lone surrogate)', () => {
    const initial = avatarInitial('🌟Developer');
    expect(initial).toBe('🌟');
    expect(Array.from(initial)).toHaveLength(1);
  });

  test('keeps a CJK first character whole', () => {
    expect(avatarInitial('名字')).toBe('名');
  });

  test('trims surrounding whitespace before selecting the initial', () => {
    expect(avatarInitial('   bob  ')).toBe('B');
    expect(avatarInitial('  🌟Star')).toBe('🌟');
  });

  test('falls back for empty, whitespace-only, null and undefined input', () => {
    expect(avatarInitial('')).toBe('?');
    expect(avatarInitial('   ')).toBe('?');
    expect(avatarInitial(null)).toBe('?');
    expect(avatarInitial(undefined)).toBe('?');
  });

  test('honours a custom fallback', () => {
    expect(avatarInitial('', 'D')).toBe('D');
    expect(avatarInitial(null, 'D')).toBe('D');
  });

  test('keeps non-letter first characters as-is', () => {
    expect(avatarInitial('7up')).toBe('7');
    expect(avatarInitial('-dash')).toBe('-');
  });

  test('honours an empty-string fallback (filter-chip call shape)', () => {
    // FilterList sender chips pass `''` as the fallback; the Avatar primitive
    // then supplies its own '?' for an empty result, so this must not throw or
    // silently fall back to the default.
    expect(avatarInitial('', '')).toBe('');
    expect(avatarInitial('   ', '')).toBe('');
    expect(avatarInitial('sender@example.com', '')).toBe('S');
  });
});
