import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  cancelTopEscapeTier,
  clearEscapeTiers,
  registerEscapeTier,
} from '@/features/keyboard-shortcuts/escape-stack.js';
import {
  handleKeydown,
  type ShortcutsCallbacks,
  type ShortcutsState,
} from '@/features/keyboard-shortcuts/shortcuts.js';
import { DEFAULT_KEYBINDINGS } from '@/utils/types.js';

/**
 * Escape tiers: the innermost transient surface is cancelled first, so Escape
 * never navigates the user away while something they opened is still up.
 * `handleKeydown` is pure - same event, same state, same callbacks - so the
 * ordering is asserted directly instead of through the DOM.
 */

beforeEach(() => {
  clearEscapeTiers();
});

afterEach(() => {
  clearEscapeTiers();
});

function pressEscape(onPreventDefault: () => void = () => {}): KeyboardEvent {
  return {
    key: 'Escape',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    target: null,
    preventDefault: onPreventDefault,
    stopPropagation: () => {},
  } as unknown as KeyboardEvent;
}

function makeState(overrides: Partial<ShortcutsState> = {}): ShortcutsState {
  return {
    currentView: 'mailbox',
    mgmtTab: 'active',
    selectedAddresses: new Set<string>(),
    mgmtSearch: '',
    qrDialogOpen: false,
    confirmDialog: null,
    selectedMessage: null,
    currentEmailDetail: null,
    modalOpen: false,
    headerBackAvailable: false,
    ...overrides,
  };
}

/** Records which callback fired, so the tier that won is unambiguous. */
function makeCallbacks() {
  const calls: string[] = [];
  const record = (name: string) => () => {
    calls.push(name);
  };
  const callbacks: ShortcutsCallbacks = {
    refreshMailbox: record('refreshMailbox'),
    createAddress: record('createAddress'),
    copyEmail: record('copyEmail'),
    copyOtp: record('copyOtp'),
    closeConfirm: record('closeConfirm'),
    closeQrDialog: record('closeQrDialog'),
    setCurrentView: (view) => calls.push(`setCurrentView:${view}`),
    setSelectedAddresses: (addresses) => calls.push(`setSelectedAddresses:${addresses.size}`),
    setMgmtSearch: (search) => calls.push(`setMgmtSearch:${search}`),
    setSelectedMessage: record('setSelectedMessage'),
    setCurrentEmailDetail: record('setCurrentEmailDetail'),
    cancelEscapeTier: () => cancelTopEscapeTier(),
    headerBack: record('headerBack'),
  };
  return { calls, callbacks };
}

function escapeWith(stateOverrides: Partial<ShortcutsState> = {}, callbacks = makeCallbacks()) {
  handleKeydown(pressEscape(), makeState(stateOverrides), callbacks.callbacks, DEFAULT_KEYBINDINGS);
  return callbacks.calls;
}

describe('Escape tiers', () => {
  test('a registered surface wins over header back and navigation', () => {
    const cancelled: string[] = [];
    registerEscapeTier('mailbox.selection', () => cancelled.push('selection'));

    let defaultPrevented = false;
    const { calls, callbacks } = makeCallbacks();
    handleKeydown(
      pressEscape(() => {
        defaultPrevented = true;
      }),
      makeState({ currentView: 'mailView', headerBackAvailable: true }),
      callbacks,
      DEFAULT_KEYBINDINGS
    );

    expect(cancelled).toEqual(['selection']);
    expect(calls).toEqual([]);
    expect(defaultPrevented).toBe(true);
  });

  test('dismissing the top surface also dismisses a drawer opened over it', () => {
    const cancelled: string[] = [];
    registerEscapeTier('mailbox.selection', () => cancelled.push('selection'));
    registerEscapeTier('layout.accountSelector', () => cancelled.push('drawer'));

    expect(escapeWith()).toEqual([]);
    expect(cancelled).toEqual(['drawer']);
  });

  test('a blocking modal wins over every tier and only closes itself', () => {
    const cancelled: string[] = [];
    registerEscapeTier('mailbox.selection', () => cancelled.push('selection'));

    const calls = escapeWith({ modalOpen: true, qrDialogOpen: true, headerBackAvailable: true });

    expect(calls).toEqual(['closeQrDialog']);
    expect(cancelled).toEqual([]);
  });

  test('with no surface registered, a deep sub-page mirrors header back', () => {
    expect(escapeWith({ currentView: 'mailView', headerBackAvailable: true })).toEqual([
      'headerBack',
    ]);
  });

  test('a shell that wires no tier keeps the pre-tier navigation behaviour', () => {
    const { calls, callbacks } = makeCallbacks();
    delete callbacks.cancelEscapeTier;
    delete callbacks.headerBack;

    handleKeydown(
      pressEscape(),
      makeState({ currentView: 'mailView', headerBackAvailable: true }),
      callbacks,
      DEFAULT_KEYBINDINGS
    );

    expect(calls).toEqual(['setCurrentView:mailbox', 'setSelectedMessage']);
  });

  test('falls back to navigation when nothing transient is open', () => {
    expect(escapeWith({ currentView: 'addresses' })).toEqual([
      'setCurrentView:mailbox',
      'setSelectedAddresses:0',
      'setMgmtSearch:',
    ]);
    expect(escapeWith({ currentView: 'settings' })).toEqual(['setCurrentView:mailbox']);
    expect(escapeWith({ currentView: 'mailbox' })).toEqual([]);
  });
});

describe('legacy keybinding validation', () => {
  test('does not fire modifier-only or bare printable bindings', () => {
    const makeKeyEvent = (key: string, modifiers: Partial<KeyboardEvent> = {}) =>
      ({
        key,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        target: null,
        preventDefault: () => {},
        ...modifiers,
      }) as unknown as KeyboardEvent;
    const callbacks = makeCallbacks();
    const state = makeState();

    handleKeydown(makeKeyEvent('g'), state, callbacks.callbacks, {
      ...DEFAULT_KEYBINDINGS,
      createAddress: { key: 'g' },
    });
    handleKeydown(makeKeyEvent('Control', { ctrlKey: true }), state, callbacks.callbacks, {
      ...DEFAULT_KEYBINDINGS,
      createAddress: { key: 'Control', ctrlKey: true },
    });

    expect(callbacks.calls).toEqual([]);
  });
});

describe('clipboard shortcuts', () => {
  for (const key of ['c', 'o']) {
    test(`Ctrl+${key} is suppressed while a blocking modal is open`, () => {
      const { calls, callbacks } = makeCallbacks();
      const event = { ...pressEscape(), key, ctrlKey: true } as KeyboardEvent;
      handleKeydown(event, makeState({ modalOpen: true }), callbacks, DEFAULT_KEYBINDINGS);
      expect(calls).toEqual([]);
      handleKeydown(event, makeState(), callbacks, DEFAULT_KEYBINDINGS);
      expect(calls).toEqual([key === 'c' ? 'copyEmail' : 'copyOtp']);
    });
  }
});
