import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_TOOLBAR_BUTTON_VISIBILITY,
  parseToolbarButtonVisibility,
} from '@/features/settings/toolbar-visibility.js';

describe('message toolbar visibility preferences', () => {
  test('missing or corrupt preferences retain every default action', () => {
    for (const raw of [undefined, null, [], 'invalid', { archive: 'false' }]) {
      expect(parseToolbarButtonVisibility(raw)).toEqual(DEFAULT_TOOLBAR_BUTTON_VISIBILITY);
    }
  });
  test('valid booleans are applied independently, without unknown fields or shared mutation', () => {
    const parsed = parseToolbarButtonVisibility({ archive: false, star: false, other: false });
    expect(parsed.archive).toBe(false);
    expect(parsed.star).toBe(false);
    expect(parsed.print).toBe(true);
    expect(Object.keys(parsed)).toEqual(Object.keys(DEFAULT_TOOLBAR_BUTTON_VISIBILITY));
    expect(DEFAULT_TOOLBAR_BUTTON_VISIBILITY.archive).toBe(true);
  });
});
