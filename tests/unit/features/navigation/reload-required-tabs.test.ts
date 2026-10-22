import { describe, expect, test } from 'bun:test';

import {
  isReloadablePageUrl,
  normalizeReloadRequiredTabIds,
  updateReloadRequiredTabIds,
} from '@/features/navigation/reload-required-tabs.js';

describe('reload-required tab state', () => {
  test('normalizes persisted tab IDs and removes duplicates', () => {
    expect(normalizeReloadRequiredTabIds([4, 2, 4, -1, 1.5, '3', null])).toEqual([4, 2]);
    expect(normalizeReloadRequiredTabIds({ tabId: 4 })).toEqual([]);
  });

  test('adds once and removes only the requested tab', () => {
    const current = [4, 2];
    expect(updateReloadRequiredTabIds(current, 2, true)).toEqual([4, 2]);
    expect(updateReloadRequiredTabIds(current, 7, true)).toEqual([4, 2, 7]);
    expect(updateReloadRequiredTabIds(current, 4, false)).toEqual([2]);
    expect(current).toEqual([4, 2]);
  });

  test('accepts only http and https pages for reload notices', () => {
    expect(isReloadablePageUrl('https://example.com/path')).toBe(true);
    expect(isReloadablePageUrl('http://localhost:3000')).toBe(true);
    expect(isReloadablePageUrl('chrome://extensions')).toBe(false);
    expect(isReloadablePageUrl('about:blank')).toBe(false);
    expect(isReloadablePageUrl(undefined)).toBe(false);
  });
});
