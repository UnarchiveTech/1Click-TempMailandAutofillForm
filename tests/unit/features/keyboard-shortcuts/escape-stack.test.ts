import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  cancelTopEscapeTier,
  clearEscapeTiers,
  escapeTierDepth,
  registerEscapeTier,
  topEscapeTierId,
} from '@/features/keyboard-shortcuts/escape-stack.js';

/**
 * The stack is what makes "Escape cancels the innermost thing first" structural:
 * a surface's position is decided by when it became active, not by the order
 * someone listed the surfaces in the keydown handler.
 */

beforeEach(() => {
  clearEscapeTiers();
});

afterEach(() => {
  clearEscapeTiers();
});

describe('escape stack', () => {
  test('is empty until a surface registers', () => {
    expect(escapeTierDepth()).toBe(0);
    expect(topEscapeTierId()).toBeNull();
    expect(cancelTopEscapeTier()).toBe(false);
  });

  test('dismisses the most recently registered surface, one press at a time', () => {
    const cancelled: string[] = [];
    registerEscapeTier('mailbox.selection', () => cancelled.push('mailbox.selection'));
    registerEscapeTier('layout.accountSelector', () => cancelled.push('layout.accountSelector'));

    expect(topEscapeTierId()).toBe('layout.accountSelector');
    expect(cancelTopEscapeTier()).toBe(true);
    expect(cancelled).toEqual(['layout.accountSelector']);
  });

  test('a surface that re-registers moves back to the top', () => {
    const cancelled: string[] = [];
    const unregisterDrawer = registerEscapeTier('layout.accountSelector', () =>
      cancelled.push('drawer')
    );
    registerEscapeTier('mailbox.selection', () => cancelled.push('selection'));

    // Ticking a row re-runs the selection effect, so the selection is now the
    // surface the user last touched and Escape must dismiss it first.
    unregisterDrawer();
    registerEscapeTier('layout.accountSelector', () => cancelled.push('drawer'));

    expect(cancelTopEscapeTier()).toBe(true);
    expect(cancelled).toEqual(['drawer']);
  });

  test('unregistering removes only that surface', () => {
    const cancelled: string[] = [];
    const unregister = registerEscapeTier('a', () => cancelled.push('a'));
    registerEscapeTier('b', () => cancelled.push('b'));
    unregister();

    expect(escapeTierDepth()).toBe(1);
    expect(topEscapeTierId()).toBe('b');
  });

  test('unregistering twice is harmless', () => {
    const unregister = registerEscapeTier('a', () => {});
    unregister();
    unregister();

    expect(escapeTierDepth()).toBe(0);
  });

  test('a surface that declines to close stays armed for the next press', () => {
    let attempts = 0;
    registerEscapeTier('stubborn', () => {
      attempts += 1;
    });

    expect(cancelTopEscapeTier()).toBe(true);
    expect(cancelTopEscapeTier()).toBe(true);
    expect(attempts).toBe(2);
  });
});
