import type { View } from '@/features/types/view-types.js';
import type { Address, Email, Keybinding, Keybindings } from '@/utils/types.js';
import { DEFAULT_KEYBINDINGS } from '@/utils/types.js';

const KEYBINDING_ACTIONS = Object.keys(DEFAULT_KEYBINDINGS) as Array<keyof Keybindings>;

function hasSameDispatchBinding(a: Keybinding, b: Keybinding): boolean {
  // The dispatcher treats Ctrl and Meta as one platform-primary modifier.
  return (
    a.key.toLowerCase() === b.key.toLowerCase() &&
    Boolean(a.ctrlKey || a.metaKey) === Boolean(b.ctrlKey || b.metaKey) &&
    Boolean(a.shiftKey) === Boolean(b.shiftKey) &&
    Boolean(a.altKey) === Boolean(b.altKey)
  );
}

function isValidKeybinding(value: unknown): value is Keybinding {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.key === 'string' &&
    candidate.key.trim().length > 0 &&
    ['ctrlKey', 'metaKey', 'shiftKey', 'altKey'].every(
      (modifier) => candidate[modifier] === undefined || typeof candidate[modifier] === 'boolean'
    )
  );
}

function isSafePrintableBinding(binding: Keybinding): boolean {
  if (['control', 'meta', 'alt', 'shift'].includes(binding.key.toLowerCase())) return false;
  return !(
    binding.key.length === 1 &&
    !binding.ctrlKey &&
    !binding.metaKey &&
    !binding.shiftKey &&
    !binding.altKey
  );
}

/** Normalize old or malformed settings so no action becomes unreachable. */
export function normalizeKeybindings(value: unknown): Keybindings {
  const saved =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Partial<Record<keyof Keybindings, unknown>>)
      : {};
  const candidates = new Map<keyof Keybindings, Keybinding>();
  for (const action of KEYBINDING_ACTIONS) {
    const candidate = saved[action];
    candidates.set(
      action,
      isValidKeybinding(candidate) && isSafePrintableBinding(candidate)
        ? candidate
        : DEFAULT_KEYBINDINGS[action]
    );
  }

  const normalized = {} as Keybindings;
  const used: Keybinding[] = [];
  const assign = (action: keyof Keybindings, binding: Keybinding) => {
    normalized[action] = binding;
    used.push(binding);
  };

  // Keep default assignments first so a legacy conflicting custom shortcut
  // cannot displace another action's established default.
  for (const action of KEYBINDING_ACTIONS) {
    const candidate = candidates.get(action) as Keybinding;
    const fallback = DEFAULT_KEYBINDINGS[action];
    if (hasSameDispatchBinding(candidate, fallback)) assign(action, fallback);
  }

  // Keep valid, non-conflicting custom assignments after defaults are reserved.
  for (const action of KEYBINDING_ACTIONS) {
    if (normalized[action]) continue;
    const candidate = candidates.get(action) as Keybinding;
    if (!used.some((binding) => hasSameDispatchBinding(binding, candidate))) {
      assign(action, candidate);
    }
  }

  // Conflicting or malformed entries receive an unused default. Defaults are
  // unique, so this fills every action without leaving a first-match collision.
  for (const action of KEYBINDING_ACTIONS) {
    if (normalized[action]) continue;
    const fallback = KEYBINDING_ACTIONS.map((key) => DEFAULT_KEYBINDINGS[key]).find(
      (binding) => !used.some((existing) => hasSameDispatchBinding(existing, binding))
    );
    assign(action, fallback ?? DEFAULT_KEYBINDINGS[action]);
  }

  return normalized;
}

export interface ShortcutsState {
  currentView: View;
  mgmtTab: string;
  selectedAddresses: Set<string>;
  mgmtSearch: string;
  qrDialogOpen: boolean;
  confirmDialog: { message: string; onConfirm: () => void } | null;
  selectedMessage: Email[] | null;
  currentEmailDetail: Address | null;
  /** True when ANY blocking modal/dialog is open (create inbox, tag, import,
   * export, master password, etc.). Global nav/letter shortcuts are suppressed. */
  modalOpen: boolean;
  /** The current view shows the header's back affordance (deep sub-pages).
   * Escape mirrors that button - same target, same state cleanup. */
  headerBackAvailable: boolean;
}

export interface ShortcutsCallbacks {
  refreshMailbox: () => void;
  createAddress: () => void;
  copyEmail: () => void;
  copyOtp: () => void;
  closeConfirm: () => void;
  closeQrDialog: () => void;
  setCurrentView: (view: View) => void;
  setSelectedAddresses: (addresses: Set<string>) => void;
  setMgmtSearch: (search: string) => void;
  setSelectedMessage: (message: Email[] | null) => void;
  setCurrentEmailDetail: (detail: Address | null) => void;
  toggleAccountSelector?: () => void;
  focusSearch?: () => void;
  /** j/k message list navigation (optional) */
  navigateMessageList?: (direction: 'next' | 'prev') => void;
  /**
   * Escape tiers - dismisses the most recently opened transient surface: a
   * view's multi-select, an open editor, a layout drawer, a settings sub-page.
   * Returns false when no surface is registered, so Escape falls through to
   * navigation. Surfaces register themselves (see `escape-stack.ts`) rather than
   * each one being threaded up through the layout as its own boolean.
   */
  cancelEscapeTier?: () => boolean;
  /** Mirrors the header's back button on deep sub-pages. */
  headerBack?: () => void;
}

function matchesKeybinding(event: KeyboardEvent, binding: Keybinding): boolean {
  const hasModifier = Boolean(
    binding.ctrlKey || binding.metaKey || binding.shiftKey || binding.altKey
  );
  if (
    ['Control', 'Meta', 'Shift', 'Alt'].includes(binding.key) ||
    (!hasModifier && Array.from(binding.key).length === 1)
  ) {
    return false;
  }
  // Ignore legacy/customized bare printable keys. Older recorder versions
  // could persist them, and they would otherwise hijack ordinary page typing.
  if (
    binding.key.length === 1 &&
    !binding.ctrlKey &&
    !binding.metaKey &&
    !binding.shiftKey &&
    !binding.altKey
  ) {
    return false;
  }
  const keyMatch = event.key.toLowerCase() === binding.key.toLowerCase();
  const requiresPrimaryMod = Boolean(binding.ctrlKey || binding.metaKey);
  const hasPrimaryMod = Boolean(event.ctrlKey || event.metaKey);
  const primaryMatch = requiresPrimaryMod ? hasPrimaryMod : !hasPrimaryMod;
  const shiftMatch = binding.shiftKey ? event.shiftKey : !event.shiftKey;
  const altMatch = binding.altKey ? event.altKey : !event.altKey;

  return keyMatch && primaryMatch && shiftMatch && altMatch;
}

function hasAmbiguousKeybinding(event: KeyboardEvent, keybindings: Keybindings): boolean {
  let matches = 0;
  for (const binding of Object.values(keybindings)) {
    if (matchesKeybinding(event, binding)) {
      matches += 1;
      if (matches > 1) return true;
    }
  }
  return false;
}

export function handleKeydown(
  event: KeyboardEvent,
  state: ShortcutsState,
  callbacks: ShortcutsCallbacks,
  keybindings: Keybindings
) {
  const target = event.target as HTMLElement | null;
  const typingInField =
    !!target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable);

  // Guard legacy/imported settings too: ambiguous shortcuts must not silently
  // dispatch whichever action happens to appear first in this function.
  if (hasAmbiguousKeybinding(event, keybindings)) {
    if (!typingInField) event.preventDefault();
    return;
  }

  // Refresh inbox
  if (matchesKeybinding(event, keybindings.refreshMailbox) && !typingInField && !state.modalOpen) {
    event.preventDefault();
    callbacks.refreshMailbox();
    return;
  }
  // Create new inbox
  if (matchesKeybinding(event, keybindings.createAddress) && !typingInField && !state.modalOpen) {
    event.preventDefault();
    callbacks.createAddress();
    return;
  }
  // Copy email (outside inputs and blocking dialogs)
  if (matchesKeybinding(event, keybindings.copyEmail) && !typingInField && !state.modalOpen) {
    event.preventDefault();
    callbacks.copyEmail();
    return;
  }
  // Copy OTP
  if (matchesKeybinding(event, keybindings.copyOtp) && !typingInField && !state.modalOpen) {
    event.preventDefault();
    callbacks.copyOtp();
    return;
  }

  // Navigation shortcuts (Alt+Shift - avoid browser/site conflicts)
  if (
    !typingInField &&
    !state.modalOpen &&
    keybindings.openAddresses &&
    matchesKeybinding(event, keybindings.openAddresses)
  ) {
    event.preventDefault();
    callbacks.setCurrentView('addresses');
    return;
  }
  if (
    !typingInField &&
    !state.modalOpen &&
    keybindings.openIdentities &&
    matchesKeybinding(event, keybindings.openIdentities)
  ) {
    event.preventDefault();
    callbacks.setCurrentView('identities');
    return;
  }
  if (
    !typingInField &&
    !state.modalOpen &&
    keybindings.openSavedLogins &&
    matchesKeybinding(event, keybindings.openSavedLogins)
  ) {
    event.preventDefault();
    callbacks.setCurrentView('loginInfo');
    return;
  }
  if (
    !typingInField &&
    !state.modalOpen &&
    keybindings.toggleAccountSelector &&
    matchesKeybinding(event, keybindings.toggleAccountSelector)
  ) {
    event.preventDefault();
    callbacks.toggleAccountSelector?.();
    return;
  }
  if (
    !typingInField &&
    !state.modalOpen &&
    keybindings.focusSearch &&
    matchesKeybinding(event, keybindings.focusSearch)
  ) {
    event.preventDefault();
    callbacks.focusSearch?.();
    return;
  }

  // "/" always focuses search (Gmail-style), any page - not while typing / modal
  if (
    !typingInField &&
    !state.modalOpen &&
    event.key === '/' &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  ) {
    event.preventDefault();
    callbacks.focusSearch?.();
    return;
  }

  // j / k navigate message list (mailbox or split detail)
  if (
    !typingInField &&
    !state.modalOpen &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    (event.key === 'j' || event.key === 'J' || event.key === 'k' || event.key === 'K')
  ) {
    const dir = event.key.toLowerCase() === 'j' ? 'next' : 'prev';
    if (callbacks.navigateMessageList) {
      event.preventDefault();
      callbacks.navigateMessageList(dir);
      return;
    }
  }

  // Escape: cancel the innermost transient surface, then fall back to navigation.
  if (matchesKeybinding(event, keybindings.closeDialogs)) {
    if (state.modalOpen) {
      // Only allow dialog-close actions while a modal is open; suppress the
      // view-navigation Escape (the modal's own handler closes itself).
      if (state.qrDialogOpen) {
        callbacks.closeQrDialog();
      } else if (state.confirmDialog) {
        callbacks.closeConfirm();
      }
      return;
    }

    // Escape tier - the most recently opened transient surface wins, so a
    // multi-select, an open editor or a drawer is dismissed before the app
    // navigates away. The stack owns the ordering (see `escape-stack.ts`).
    if (callbacks.cancelEscapeTier?.()) {
      // Browser action popups treat an unhandled Escape as a request to dismiss
      // the popup itself. A transient surface (such as multi-selection) owns
      // this Escape, so cancel the browser default before returning.
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    // Deep sub-pages mirror the header's back affordance - same target, same
    // state cleanup as clicking it.
    if (state.headerBackAvailable && callbacks.headerBack) {
      callbacks.headerBack();
      return;
    }

    // Navigation fallback - nothing transient left to cancel.
    if (state.currentView === 'addresses') {
      callbacks.setCurrentView('mailbox');
      callbacks.setSelectedAddresses(new Set());
      callbacks.setMgmtSearch('');
    } else if (
      state.currentView === 'settings' ||
      state.currentView === 'analytics' ||
      state.currentView === 'loginInfo' ||
      state.currentView === 'about' ||
      state.currentView === 'identities' ||
      state.currentView === 'automation' ||
      state.currentView === 'organize'
    ) {
      callbacks.setCurrentView('mailbox');
    } else if (state.currentView === 'addressView') {
      callbacks.setCurrentView('addresses');
      callbacks.setCurrentEmailDetail(null);
    } else if (state.currentView === 'mailView') {
      callbacks.setCurrentView('mailbox');
      callbacks.setSelectedMessage(null);
    } else if (state.qrDialogOpen) {
      callbacks.closeQrDialog();
    } else if (state.confirmDialog) {
      callbacks.closeConfirm();
    }
  }
}
