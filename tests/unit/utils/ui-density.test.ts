import { afterAll, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
/**
 * Density migration contract (review-2-luna §2.4): legacy `comfortable`/
 * `compact` values stored by older builds normalize to `expanded`; only the
 * exact new value `minimised` selects the icon-only rail. This is an
 * intentional, semantic-changing migration - upgrading compact users get the
 * expanded layout, so the mapping must stay locked.
 */

// storage-keys.ts imports `browser` from wxt/browser at module evaluation,
// so provide a minimal mock before importing (same pattern as
// email-storage-keys.test.ts). normalizeUiDensity itself is pure.
const fakeBrowser = {
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
    },
    session: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
    },
  },
};

mock.module('wxt/browser', () => ({ browser: fakeBrowser }));
Object.assign(globalThis, { browser: fakeBrowser });

const { normalizeUiDensity } = await import('@/utils/storage/storage-keys.js');

describe('normalizeUiDensity (legacy density migration)', () => {
  test('legacy comfortable maps to expanded', () => {
    expect(normalizeUiDensity('comfortable')).toBe('expanded');
  });

  test('legacy compact maps to expanded (intentional semantic change)', () => {
    expect(normalizeUiDensity('compact')).toBe('expanded');
  });

  test('the new minimised value is preserved (icon-only rail)', () => {
    expect(normalizeUiDensity('minimised')).toBe('minimised');
  });

  test('the new expanded value is preserved', () => {
    expect(normalizeUiDensity('expanded')).toBe('expanded');
  });

  test('missing or malformed stored values default to expanded', () => {
    expect(normalizeUiDensity(undefined)).toBe('expanded');
    expect(normalizeUiDensity(null)).toBe('expanded');
    expect(normalizeUiDensity(42)).toBe('expanded');
    expect(normalizeUiDensity({})).toBe('expanded');
    expect(normalizeUiDensity('')).toBe('expanded');
  });
});
