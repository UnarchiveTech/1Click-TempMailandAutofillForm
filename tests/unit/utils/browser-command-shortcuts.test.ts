import { describe, expect, test } from 'bun:test';
import { defaultAutofillShortcut } from '../../../src/utils/browser/command-shortcuts';

describe('browser-owned autofill shortcut defaults', () => {
  test('Firefox uses the binding verified by the native command and fill journey', () => {
    expect(defaultAutofillShortcut('firefox')).toBe('Alt+Shift+Z');
  });

  for (const browser of ['chrome', 'safari', 'edge', 'opera', 'chromium']) {
    test(`${browser} retains its existing default`, () => {
      expect(defaultAutofillShortcut(browser)).toBe('Alt+Shift+F');
    });
  }
});
