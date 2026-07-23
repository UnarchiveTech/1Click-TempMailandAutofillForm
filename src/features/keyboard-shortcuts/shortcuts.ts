import type { Account, Email, Keybinding, Keybindings } from '@/utils/types.js';

export interface ShortcutsState {
  currentView: string;
  mgmtTab: string;
  selectedAddresses: Set<string>;
  mgmtSearch: string;
  qrDialogOpen: boolean;
  confirmDialog: { message: string; onConfirm: () => void } | null;
  selectedMessage: Email[] | null;
  currentEmailDetail: Account | null;
}

export interface ShortcutsCallbacks {
  refreshInbox: () => void;
  createInbox: () => void;
  copyEmail: () => void;
  copyOtp: () => void;
  closeConfirm: () => void;
  closeQrDialog: () => void;
  setCurrentView: (view: string) => void;
  setSelectedAddresses: (addresses: Set<string>) => void;
  setMgmtSearch: (search: string) => void;
  setSelectedMessage: (message: Email[] | null) => void;
  setCurrentEmailDetail: (detail: Account | null) => void;
  toggleAccountSelector?: () => void;
  focusSearch?: () => void;
  /** j/k message list navigation (optional) */
  navigateMessageList?: (direction: 'next' | 'prev') => void;
}

function matchesKeybinding(event: KeyboardEvent, binding: Keybinding): boolean {
  const keyMatch = event.key.toLowerCase() === binding.key.toLowerCase();
  const requiresPrimaryMod = Boolean(binding.ctrlKey || binding.metaKey);
  const hasPrimaryMod = Boolean(event.ctrlKey || event.metaKey);
  const primaryMatch = requiresPrimaryMod ? hasPrimaryMod : !hasPrimaryMod;
  const shiftMatch = binding.shiftKey ? event.shiftKey : !event.shiftKey;
  const altMatch = binding.altKey ? event.altKey : !event.altKey;

  return keyMatch && primaryMatch && shiftMatch && altMatch;
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

  // Refresh inbox
  if (matchesKeybinding(event, keybindings.refreshInbox)) {
    event.preventDefault();
    callbacks.refreshInbox();
    return;
  }
  // Create new inbox
  if (matchesKeybinding(event, keybindings.createInbox)) {
    event.preventDefault();
    callbacks.createInbox();
    return;
  }
  // Copy email (if not in input)
  if (matchesKeybinding(event, keybindings.copyEmail) && !typingInField) {
    event.preventDefault();
    callbacks.copyEmail();
    return;
  }
  // Copy OTP
  if (matchesKeybinding(event, keybindings.copyOtp) && !typingInField) {
    event.preventDefault();
    callbacks.copyOtp();
    return;
  }

  // Navigation shortcuts (Alt+Shift — avoid browser/site conflicts)
  if (
    !typingInField &&
    keybindings.openAddresses &&
    matchesKeybinding(event, keybindings.openAddresses)
  ) {
    event.preventDefault();
    callbacks.setCurrentView('mailSettings');
    return;
  }
  if (
    !typingInField &&
    keybindings.openIdentities &&
    matchesKeybinding(event, keybindings.openIdentities)
  ) {
    event.preventDefault();
    callbacks.setCurrentView('identities');
    return;
  }
  if (
    !typingInField &&
    keybindings.openSavedLogins &&
    matchesKeybinding(event, keybindings.openSavedLogins)
  ) {
    event.preventDefault();
    callbacks.setCurrentView('loginInfo');
    return;
  }
  if (
    !typingInField &&
    keybindings.toggleAccountSelector &&
    matchesKeybinding(event, keybindings.toggleAccountSelector)
  ) {
    event.preventDefault();
    callbacks.toggleAccountSelector?.();
    return;
  }
  if (
    !typingInField &&
    keybindings.focusSearch &&
    matchesKeybinding(event, keybindings.focusSearch)
  ) {
    event.preventDefault();
    callbacks.focusSearch?.();
    return;
  }

  // "/" always focuses search (Gmail-style), any page — not while typing
  if (!typingInField && event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    callbacks.focusSearch?.();
    return;
  }

  // j / k navigate message list (mailbox or split detail)
  if (
    !typingInField &&
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

  // Escape: Close dialogs
  if (matchesKeybinding(event, keybindings.closeDialogs)) {
    if (state.currentView === 'mailSettings') {
      callbacks.setCurrentView('main');
      callbacks.setSelectedAddresses(new Set());
      callbacks.setMgmtSearch('');
    } else if (
      state.currentView === 'settings' ||
      state.currentView === 'analytics' ||
      state.currentView === 'loginInfo' ||
      state.currentView === 'archivedEmails' ||
      state.currentView === 'about' ||
      state.currentView === 'identities'
    ) {
      callbacks.setCurrentView('main');
    } else if (state.currentView === 'emailDetail') {
      callbacks.setCurrentView('mailSettings');
      callbacks.setCurrentEmailDetail(null);
    } else if (state.currentView === 'messageDetail') {
      callbacks.setCurrentView('main');
      callbacks.setSelectedMessage(null);
    } else if (state.qrDialogOpen) {
      callbacks.closeQrDialog();
    } else if (state.confirmDialog) {
      callbacks.closeConfirm();
    }
  }
}
