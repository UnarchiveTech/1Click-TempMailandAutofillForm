import type { Account, Email, Keybinding, Keybindings } from '@/utils/types.js';

export interface ShortcutsState {
  currentView: string;
  mgmtTab: string;
  selectedAddresses: Set<string>;
  mgmtSearch: string;
  qrDialogOpen: boolean;
  confirmDialog: { message: string; onConfirm: () => void } | null;
  selectedMessage: Email | null;
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
  setSelectedMessage: (message: Email | null) => void;
  setCurrentEmailDetail: (detail: Account | null) => void;
}

function matchesKeybinding(event: KeyboardEvent, binding: Keybinding): boolean {
  const keyMatch = event.key.toLowerCase() === binding.key.toLowerCase();
  const ctrlMatch = binding.ctrlKey
    ? event.ctrlKey || event.metaKey
    : !event.ctrlKey && !event.metaKey;
  const metaMatch = binding.metaKey
    ? event.metaKey || event.ctrlKey
    : !event.metaKey && !event.ctrlKey;
  const shiftMatch = binding.shiftKey ? event.shiftKey : !event.shiftKey;
  const altMatch = binding.altKey ? event.altKey : !event.altKey;

  return keyMatch && ctrlMatch && metaMatch && shiftMatch && altMatch;
}

export function handleKeydown(
  event: KeyboardEvent,
  state: ShortcutsState,
  callbacks: ShortcutsCallbacks,
  keybindings: Keybindings
) {
  // Refresh inbox
  if (matchesKeybinding(event, keybindings.refreshInbox)) {
    event.preventDefault();
    callbacks.refreshInbox();
  }
  // Create new inbox
  if (matchesKeybinding(event, keybindings.createInbox)) {
    event.preventDefault();
    callbacks.createInbox();
  }
  // Copy email (if not in input)
  if (
    matchesKeybinding(event, keybindings.copyEmail) &&
    !((event.target as HTMLElement).tagName === 'INPUT') &&
    !((event.target as HTMLElement).tagName === 'TEXTAREA')
  ) {
    event.preventDefault();
    callbacks.copyEmail();
  }
  // Copy OTP
  if (matchesKeybinding(event, keybindings.copyOtp)) {
    event.preventDefault();
    callbacks.copyOtp();
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
      state.currentView === 'about'
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
