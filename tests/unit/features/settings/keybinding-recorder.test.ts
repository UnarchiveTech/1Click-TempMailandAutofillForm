import { describe, expect, test } from 'bun:test';
import {
  countCustomizedKeybindings,
  formatKeybinding,
  isDefaultBinding,
  isInvalidShortcut,
  isReservedShortcut,
} from '@/features/settings/keybinding-recorder.svelte.js';
import { DEFAULT_KEYBINDINGS, type Keybindings } from '@/utils/types.js';

function keyEvent(
  key: string,
  mods: Partial<{ ctrl: boolean; meta: boolean; shift: boolean; alt: boolean }> = {}
) {
  return {
    key,
    ctrlKey: mods.ctrl ?? false,
    metaKey: mods.meta ?? false,
    shiftKey: mods.shift ?? false,
    altKey: mods.alt ?? false,
  };
}

describe('isReservedShortcut', () => {
  test('rejects Ctrl/Cmd + letter without Alt', () => {
    expect(isReservedShortcut(keyEvent('w', { ctrl: true }))).toBe(true);
    expect(isReservedShortcut(keyEvent('W', { ctrl: true }))).toBe(true);
    expect(isReservedShortcut(keyEvent('t', { meta: true }))).toBe(true);
    expect(isReservedShortcut(keyEvent('n', { ctrl: true, shift: true }))).toBe(true);
  });

  test('accepts Alt-modified and unmodified combos', () => {
    expect(isReservedShortcut(keyEvent('a', { alt: true, shift: true }))).toBe(false);
    expect(isReservedShortcut(keyEvent('a', { ctrl: true, alt: true }))).toBe(false);
    expect(isReservedShortcut(keyEvent('a'))).toBe(false);
    expect(isReservedShortcut(keyEvent('Escape'))).toBe(false);
  });
});

describe('isInvalidShortcut', () => {
  test('rejects modifier-only and unmodified printable keys', () => {
    expect(isInvalidShortcut(keyEvent('Control'))).toBe(true);
    expect(isInvalidShortcut(keyEvent('g'))).toBe(true);
  });

  test('accepts modified printable keys and unmodified non-printable keys', () => {
    expect(isInvalidShortcut(keyEvent('g', { ctrl: true }))).toBe(false);
    expect(isInvalidShortcut(keyEvent('Escape'))).toBe(false);
  });
});

describe('formatKeybinding', () => {
  const tr = (key: string) =>
    ({
      'keyboardShortcuts.ctrlCmd': 'Ctrl',
      'keyboardShortcuts.shift': 'Shift',
      'keyboardShortcuts.alt': 'Alt',
    })[key] ?? key;

  test('renders modifiers and uppercased key', () => {
    expect(formatKeybinding({ key: 'r', ctrlKey: true, metaKey: true }, tr)).toBe('Ctrl + R');
    expect(formatKeybinding({ key: 'a', altKey: true, shiftKey: true }, tr)).toBe(
      'Shift + Alt + A'
    );
    expect(formatKeybinding({ key: 'Escape' }, tr)).toBe('ESCAPE');
  });
});

describe('isDefaultBinding', () => {
  test('matches defaults structurally, ignoring key case', () => {
    expect(isDefaultBinding(DEFAULT_KEYBINDINGS.refreshMailbox, 'refreshMailbox')).toBe(true);
    expect(isDefaultBinding({ key: 'R', ctrlKey: true, metaKey: true }, 'refreshMailbox')).toBe(
      true
    );
  });

  test('flags any changed modifier or key', () => {
    expect(isDefaultBinding({ key: 'r' }, 'refreshMailbox')).toBe(false);
    expect(isDefaultBinding({ key: 'x', ctrlKey: true, metaKey: true }, 'refreshMailbox')).toBe(
      false
    );
  });
});

describe('countCustomizedKeybindings', () => {
  test('counts only actions diverging from defaults', () => {
    const custom: Keybindings = {
      ...DEFAULT_KEYBINDINGS,
      refreshMailbox: { key: 'x', ctrlKey: true, metaKey: true },
      closeDialogs: { key: 'q' },
    };
    expect(countCustomizedKeybindings(DEFAULT_KEYBINDINGS)).toBe(0);
    expect(countCustomizedKeybindings(custom)).toBe(2);
  });
});
