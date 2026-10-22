import type { Keybinding, Keybindings } from '@/utils/types.js';
import { DEFAULT_KEYBINDINGS } from '@/utils/types.js';

/** Translation signature matching svelte-i18n's `t` (key → localized string). */
export type KeybindingTr = (key: string) => string;

/**
 * Browser/OS-reserved combos that a saved binding can never win: Ctrl/Cmd +
 * letter (without Alt) that the browser or OS intercepts first. Rejecting them
 * prevents a saved binding that would silently never fire.
 */
const RESERVED_PRIMARY_KEYS = [
  'w',
  'n',
  't',
  'r',
  'q',
  'p',
  's',
  'o',
  'a',
  'd',
  'e',
  'f',
  'l',
  'h',
  'j',
  'k',
  'u',
] as const;

export function isReservedShortcut(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>
): boolean {
  const key = event.key.toLowerCase();
  const primary = event.ctrlKey || event.metaKey;
  return primary && !event.altKey && (RESERVED_PRIMARY_KEYS as readonly string[]).includes(key);
}

function hasSameDispatchBinding(a: Keybinding, b: Keybinding): boolean {
  // The dispatcher treats Ctrl and Meta as one platform-primary modifier, so
  // the conflict check must compare the same effective combination.
  return (
    a.key.toLowerCase() === b.key.toLowerCase() &&
    Boolean(a.ctrlKey || a.metaKey) === Boolean(b.ctrlKey || b.metaKey) &&
    Boolean(a.shiftKey) === Boolean(b.shiftKey) &&
    Boolean(a.altKey) === Boolean(b.altKey)
  );
}

function isModifierKey(key: string): boolean {
  return key === 'Control' || key === 'Meta' || key === 'Shift' || key === 'Alt';
}

/** Reject modifier-only presses and unmodified printable keys as app shortcuts. */
export function isInvalidShortcut(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>
): boolean {
  const isModifier = ['Control', 'Meta', 'Shift', 'Alt'].includes(event.key);
  const hasModifier = event.ctrlKey || event.metaKey || event.shiftKey || event.altKey;
  return isModifier || (!hasModifier && Array.from(event.key).length === 1);
}

/** Human-readable combo, localized ("Ctrl + Shift + K"). */
export function formatKeybinding(binding: Keybinding, tr: KeybindingTr): string {
  const parts: string[] = [];
  if (binding.ctrlKey || binding.metaKey) parts.push(tr('keyboardShortcuts.ctrlCmd'));
  if (binding.shiftKey) parts.push(tr('keyboardShortcuts.shift'));
  if (binding.altKey) parts.push(tr('keyboardShortcuts.alt'));
  parts.push(binding.key.toUpperCase());
  return parts.join(' + ');
}

/** Structural equality against the default - locale-independent. */
export function isDefaultBinding(binding: Keybinding, action: keyof Keybindings): boolean {
  const def = DEFAULT_KEYBINDINGS[action];
  return (
    binding.key.toLowerCase() === def.key.toLowerCase() &&
    !!binding.ctrlKey === !!def.ctrlKey &&
    !!binding.metaKey === !!def.metaKey &&
    !!binding.shiftKey === !!def.shiftKey &&
    !!binding.altKey === !!def.altKey
  );
}

/** Number of actions customized away from their defaults (all actions). */
export function countCustomizedKeybindings(keybindings: Keybindings): number {
  return (Object.keys(keybindings) as (keyof Keybindings)[]).filter(
    (k) => !isDefaultBinding(keybindings[k], k)
  ).length;
}

export interface KeybindingRecorderOptions {
  /** Live getter for the current bindings (props can change between events). */
  getKeybindings: () => Keybindings;
  /** Persists the edited bindings (no-op when the view is read-only). */
  onSetKeybindings: (value: Keybindings) => void;
  /** Persists other settings state after a successful edit. */
  onSaveSettings: () => void;
  /** svelte-i18n translate function, e.g. `(key) => get(t)(key)`. */
  tr: KeybindingTr;
}

/**
 * Shared keybinding recorder used by the shortcuts editor and the settings
 * hub. Owns the recording state machine (start → capture → save/cancel) and
 * reconciles the two historical implementations:
 *
 * - Escape cancels recording without saving (previously only in the hub; the
 *   editor used to save `Escape` as the binding);
 * - Tab cancels without swallowing the keystroke (focus keeps moving);
 * - reserved browser combos (Ctrl/Cmd + letter without Alt) are rejected
 *   outright (previously only in the editor; the hub would save them).
 *
 * Mutations go through the returned `state` proxy so template reads stay
 * reactive.
 */
export function createKeybindingRecorder(opts: KeybindingRecorderOptions) {
  const state = $state({
    editingKeybinding: null as keyof Keybindings | null,
    recordingKeybinding: false,
    recordedKeys: '',
    recordingError: '',
    conflict: null as { attempted: keyof Keybindings; existing: keyof Keybindings } | null,
  });

  function startRecording(action: keyof Keybindings) {
    state.editingKeybinding = action;
    state.recordingKeybinding = true;
    state.recordedKeys = '';
    state.recordingError = '';
    state.conflict = null;
  }

  function cancelRecording() {
    state.recordingKeybinding = false;
    state.editingKeybinding = null;
    state.recordedKeys = '';
    state.recordingError = '';
    state.conflict = null;
  }

  function handleRecordingKeydown(event: KeyboardEvent) {
    // Escape cancels without saving (and must not bubble to close dialogs).
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelRecording();
      return;
    }
    // Tab cancels but keeps moving focus (a11y: don't trap the user).
    if (event.key === 'Tab') {
      cancelRecording();
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    state.recordingError = '';
    state.conflict = null;

    // Modifier keydown happens before the character keydown in a chord. Keep
    // recording and show the modifier preview instead of saving Ctrl/Shift/Alt
    // as a complete shortcut.
    if (isModifierKey(event.key)) {
      const modifiers: string[] = [];
      if (event.ctrlKey || event.metaKey) modifiers.push(opts.tr('keyboardShortcuts.ctrlCmd'));
      if (event.shiftKey) modifiers.push(opts.tr('keyboardShortcuts.shift'));
      if (event.altKey) modifiers.push(opts.tr('keyboardShortcuts.alt'));
      state.recordedKeys = modifiers.join(' + ');
      return;
    }

    // Unmodified printable keys fire during ordinary page use and are too
    // disruptive for global actions such as Copy OTP.
    if (isInvalidShortcut(event)) {
      state.recordedKeys = event.key.toUpperCase();
      state.recordingError = opts.tr('keyboardShortcuts.modifierRequired');
      return;
    }

    const parts: string[] = [];
    if (event.ctrlKey || event.metaKey) parts.push(opts.tr('keyboardShortcuts.ctrlCmd'));
    if (event.shiftKey) parts.push(opts.tr('keyboardShortcuts.shift'));
    if (event.altKey) parts.push(opts.tr('keyboardShortcuts.alt'));
    parts.push(event.key.toUpperCase());
    state.recordedKeys = parts.join(' + ');

    if (state.editingKeybinding && opts.onSetKeybindings) {
      // Reject browser/OS-reserved shortcuts (e.g. Ctrl+W closes the tab, Ctrl+N
      // opens a new window, Ctrl+T a new tab) so a saved binding can't hijack
      // them or get prevented by the browser before our handler runs.
      if (isReservedShortcut(event)) {
        // Rejected - clear the preview; the combo simply won't be saved.
        cancelRecording();
        return;
      }

      const newKeybindings = { ...opts.getKeybindings() };
      const binding = {
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      };
      const duplicate = (Object.keys(newKeybindings) as (keyof Keybindings)[]).find(
        (action) =>
          action !== state.editingKeybinding &&
          hasSameDispatchBinding(newKeybindings[action], binding)
      );
      if (duplicate) {
        state.conflict = { attempted: state.editingKeybinding, existing: duplicate };
        return;
      }
      newKeybindings[state.editingKeybinding] = binding;
      opts.onSetKeybindings(newKeybindings);
      opts.onSaveSettings();
    }

    cancelRecording();
  }

  function resetKeybinding(action: keyof Keybindings) {
    if (opts.onSetKeybindings) {
      const newKeybindings = { ...opts.getKeybindings() };
      const defaultBinding = DEFAULT_KEYBINDINGS[action];
      const duplicate = (Object.keys(newKeybindings) as (keyof Keybindings)[]).find(
        (other) => other !== action && hasSameDispatchBinding(newKeybindings[other], defaultBinding)
      );
      if (duplicate) {
        state.editingKeybinding = action;
        state.recordingKeybinding = false;
        state.recordedKeys = '';
        state.recordingError = '';
        state.conflict = { attempted: action, existing: duplicate };
        return;
      }
      newKeybindings[action] = defaultBinding;
      state.recordingError = '';
      state.conflict = null;
      opts.onSetKeybindings(newKeybindings);
      opts.onSaveSettings();
    }
  }

  function resetAll() {
    if (opts.onSetKeybindings) {
      state.recordingError = '';
      state.conflict = null;
      opts.onSetKeybindings({ ...DEFAULT_KEYBINDINGS });
      opts.onSaveSettings();
    }
  }

  return {
    state,
    startRecording,
    handleRecordingKeydown,
    cancelRecording,
    resetKeybinding,
    resetAll,
  };
}
