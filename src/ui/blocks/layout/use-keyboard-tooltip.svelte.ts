import { createShortcutDiscovery } from '@/features/keyboard-shortcuts/shortcut-discovery.js';
import {
  handleKeydown as handleKeydownAction,
  type ShortcutsCallbacks,
} from '@/features/keyboard-shortcuts/shortcuts.js';
import type { View } from '@/features/types/view-types.js';
import type { ToastType } from '@/ui/blocks/feedback/toast-types.js';
import type { Address, Email, Keybindings } from '@/utils/types.js';
import { chooseKeyboardTarget } from '@/utils/ui/selection-keyboard.js';
import { publishedSelections, selectionKeyboardTarget } from '@/utils/ui/selection-registry.js';
import type { ConfirmDialogState } from '@/utils/ui/shared-ui.js';

export interface TooltipPosition {
  text: string;
  x: number;
  y: number;
  align?: 'center' | 'start';
}

export interface KeyboardTooltipDeps {
  /** Reactive state read through getters so $state proxies stay live. */
  get: {
    currentView: () => View;
    mgmtTab: () => string;
    selectedAddresses: () => Set<string>;
    mgmtSearch: () => string;
    selectedThread: () => Email[];
    currentEmailDetail: () => Address | null;
    confirmDialog: () => ConfirmDialogState | null;
    qrDialogOpen: () => boolean;
    createAddressDialogOpen: () => boolean;
    commandPaletteOpen: () => boolean;
    cheatSheetOpen: () => boolean;
    exportWizardOpen: () => boolean;
    showExportBackupDialog: () => boolean;
    showImportBackupDialog: () => boolean;
    addressViewTagDialogOpen: () => boolean;
    keybindings: () => Keybindings;
    activeNavigationList: () => { id: string; emails: Email[] }[];
    currentNavigationIndex: () => number;
    headerBackAvailable: () => boolean;
  };
  /** State writes (AppLayout $state proxies). */
  set: {
    setCurrentView: (view: View) => void;
    setCheatSheetOpen: (open: boolean) => void;
    setShortcutDiscoveryOpen?: (open: boolean) => void;
    setCommandPaletteOpen: (open: boolean) => void;
    setActiveTooltip: (tip: TooltipPosition | null) => void;
  };
  /** Shortcut actions for `handleKeydownAction` (view switching, mail ops, …). */
  shortcuts: Omit<ShortcutsCallbacks, 'setCurrentView' | 'focusSearch' | 'navigateMessageList'>;
  openMessageDetail: (thread: Email[]) => void;
  /** Toggle the split pane - the same target the divider's collapse control
   *  and the header's control use (Ctrl/Cmd+Shift+S). */
  toggleSplitPane?: () => void;
  showToast: (message: string, type?: ToastType) => void;
  getTranslation: (key: string, vars?: Record<string, string | number>) => string;
}

/**
 * Keyboard shortcuts (global keydown, search focus, message-list navigation) and
 * the global hover tooltip. Both register window-level listeners owned by the
 * caller; the controller only owns the logic and the private tooltip timing.
 */
export function createKeyboardTooltipController(deps: KeyboardTooltipDeps) {
  const { get, set } = deps;
  const discovery = createShortcutDiscovery(
    (open) => set.setShortcutDiscoveryOpen?.(open),
    () => set.setCheatSheetOpen(true),
    () =>
      !get.cheatSheetOpen() &&
      document.querySelector('[aria-modal="true"]:not([hidden])') === null &&
      !(
        document.activeElement instanceof HTMLElement &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) ||
          document.activeElement.isContentEditable)
      )
  );

  /** Prefer current page search; fall back to mailbox search (navigate if needed). */
  function focusAppSearch(): boolean {
    const selectors = [
      '[data-mailbox-search] input',
      '[data-app-search]',
      '#mailbox-search',
      'input[type="search"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector<HTMLInputElement>(sel);
      if (el && !el.disabled && el.offsetParent !== null) {
        el.focus();
        el.select?.();
        return true;
      }
    }
    return false;
  }

  /** j/k message-list navigation (mailbox or split detail). */
  function navigateMessageList(direction: 'next' | 'prev') {
    // Only navigate when mailbox list is available (mailbox or message detail / split)
    if (get.currentView() !== 'mailbox' && get.currentView() !== 'mailView') {
      set.setCurrentView('mailbox');
    }
    const list = get.activeNavigationList();
    if (!list.length) {
      deps.showToast(deps.getTranslation('inbox.noMessagesToNavigate'), 'info');
      return;
    }
    let idx = get.currentNavigationIndex();
    if (idx < 0) {
      idx = direction === 'next' ? -1 : 0;
    }
    const nextIdx = direction === 'next' ? idx + 1 : idx - 1;
    if (nextIdx < 0 || nextIdx >= list.length) {
      deps.showToast(
        deps.getTranslation(
          direction === 'next' ? 'inbox.endOfMessageList' : 'inbox.startOfMessageList'
        ),
        'info'
      );
      return;
    }
    deps.openMessageDetail(list[nextIdx].emails);
  }

  /** Global keydown: app-level shortcuts, then delegate keybindings to the shortcuts module. */
  function handleKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    const isInput =
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable);

    // Suppress global shortcuts while a blocking modal is open (only Escape to
    // close the dialog is allowed, handled inside handleKeydownAction).
    const modalOpen =
      !!get.confirmDialog() ||
      get.qrDialogOpen() ||
      get.createAddressDialogOpen() ||
      get.commandPaletteOpen() ||
      get.cheatSheetOpen() ||
      get.exportWizardOpen() ||
      get.showExportBackupDialog() ||
      get.showImportBackupDialog() ||
      get.addressViewTagDialogOpen() ||
      // View-owned dialogs and the vault unlock dialog do not belong to the
      // shell's boolean list. Their rendered modal semantics cover them too.
      document.querySelector('[aria-modal="true"]:not([hidden])') !== null;

    if (event.key !== '?' && event.key !== 'Shift') discovery.cancel();
    if (
      !isInput &&
      !modalOpen &&
      !event.isComposing &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      event.key === '?'
    ) {
      event.preventDefault();
      discovery.press(event.code);
      return;
    }

    // "/" focuses search on any page (before other handlers steal it)
    if (
      !isInput &&
      !modalOpen &&
      event.key === '/' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      if (!focusAppSearch()) {
        // Navigate to mailbox so mailbox search exists, then focus
        if (get.currentView() !== 'mailbox' && get.currentView() !== 'mailView') {
          set.setCurrentView('mailbox');
        }
        queueMicrotask(() => {
          if (!focusAppSearch()) {
            // last resort after view paint
            setTimeout(() => void focusAppSearch(), 50);
          }
        });
      }
      return;
    }

    // Ctrl/Cmd+K command palette
    if (
      !isInput &&
      !modalOpen &&
      (event.key === 'k' || event.key === 'K') &&
      (event.ctrlKey || event.metaKey) &&
      !event.altKey
    ) {
      event.preventDefault();
      set.setCommandPaletteOpen(!get.commandPaletteOpen());
      return;
    }

    // Ctrl/Cmd+Shift+P - the alternate command-palette chord the Settings
    // reference documents (the primary is Ctrl/Cmd+K above).
    if (
      !isInput &&
      !modalOpen &&
      !event.isComposing &&
      (event.key === 'p' || event.key === 'P') &&
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      !event.altKey
    ) {
      event.preventDefault();
      set.setCommandPaletteOpen(!get.commandPaletteOpen());
      return;
    }

    // Ctrl/Cmd+Shift+S - toggle the split pane, mirroring the header control.
    if (
      !isInput &&
      !modalOpen &&
      !event.isComposing &&
      (event.key === 's' || event.key === 'S') &&
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      !event.altKey &&
      deps.toggleSplitPane
    ) {
      event.preventDefault();
      deps.toggleSplitPane();
      return;
    }

    // Ctrl/Cmd+A - tick every row the focused list matches. Falls through to
    // the browser's select-all when no list is published (a settings page),
    // so the chord is only claimed where the promise is the list's.
    if (
      !isInput &&
      !modalOpen &&
      !event.isComposing &&
      (event.key === 'a' || event.key === 'A') &&
      (event.ctrlKey || event.metaKey) &&
      !event.shiftKey &&
      !event.altKey
    ) {
      const target = chooseKeyboardTarget(publishedSelections(), {
        fallback: selectionKeyboardTarget(),
      });
      if (target) {
        event.preventDefault();
        target.api.selectAll();
        return;
      }
    }

    // Delete / Backspace - run the selection's OWN delete action, so the
    // keyboard can never delete something the strip would not offer.
    if (
      !isInput &&
      !modalOpen &&
      !event.isComposing &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      (event.key === 'Delete' || event.key === 'Backspace')
    ) {
      const target = chooseKeyboardTarget(publishedSelections(), {
        fallback: selectionKeyboardTarget(),
      });
      if (target?.state.active && target.state.actions.includes('delete')) {
        event.preventDefault();
        void target.api.run('delete');
        return;
      }
    }

    handleKeydownAction(
      event,
      {
        currentView: get.currentView(),
        mgmtTab: get.mgmtTab(),
        selectedAddresses: get.selectedAddresses(),
        mgmtSearch: get.mgmtSearch(),
        qrDialogOpen: get.qrDialogOpen(),
        confirmDialog: get.confirmDialog(),
        selectedMessage: get.selectedThread(),
        currentEmailDetail: get.currentEmailDetail(),
        modalOpen,
        headerBackAvailable: get.headerBackAvailable(),
      },
      {
        ...deps.shortcuts,
        setCurrentView: (view) => set.setCurrentView(view),
        focusSearch: () => {
          if (!focusAppSearch()) {
            if (get.currentView() !== 'mailbox') set.setCurrentView('mailbox');
            queueMicrotask(() => void focusAppSearch());
          }
        },
        navigateMessageList,
      },
      get.keybindings()
    );
  }

  // --- Global tooltip logic ---
  let tooltipTimeout: ReturnType<typeof setTimeout> | null = null;
  let hoveredElement: HTMLElement | null = null;

  function handleMouseOver(e: MouseEvent) {
    const target = (e.target as HTMLElement).closest('[title], [data-tooltip]') as HTMLElement;
    if (!target) return;
    if (hoveredElement === target) return;

    clearTooltip();
    hoveredElement = target;

    let text = target.getAttribute('data-tooltip') || '';
    if (!text && target.hasAttribute('title')) {
      text = target.getAttribute('title') || '';
      target.setAttribute('data-tooltip', text);
      target.removeAttribute('title');
    }

    if (!text) return;

    const isMultiline = text.includes('\n');
    const align: 'center' | 'start' = isMultiline ? 'start' : 'center';

    tooltipTimeout = setTimeout(() => {
      const rect = target.getBoundingClientRect();
      const isRtl =
        typeof window !== 'undefined' && window.getComputedStyle(target).direction === 'rtl';
      let x: number;
      if (align === 'start') {
        x = isRtl ? rect.right : rect.left;
      } else {
        x = rect.left + rect.width / 2;
      }
      set.setActiveTooltip({
        text,
        x,
        y: rect.bottom + 6,
        align,
      });
    }, 400);
  }

  function handleMouseOut(e: MouseEvent) {
    if (hoveredElement && !hoveredElement.contains(e.relatedTarget as Node)) {
      clearTooltip();
    }
  }

  function clearTooltip() {
    if (tooltipTimeout) {
      clearTimeout(tooltipTimeout);
      tooltipTimeout = null;
    }
    set.setActiveTooltip(null);
    hoveredElement = null;
  }

  /** Position the tooltip element near the hovered target; call from a $effect. */
  function positionTooltip(tooltipRef: HTMLElement | null, activeTooltip: TooltipPosition | null) {
    if (!activeTooltip || !tooltipRef) return;
    const rect = tooltipRef.getBoundingClientRect();
    const padding = 8;
    const align = activeTooltip.align ?? 'center';
    let left = activeTooltip.x;
    let top = activeTooltip.y;

    if (align === 'start') {
      const isRtl =
        hoveredElement != null
          ? window.getComputedStyle(hoveredElement).direction === 'rtl'
          : document.documentElement.dir === 'rtl' ||
            window.getComputedStyle(document.documentElement).direction === 'rtl';
      if (isRtl) {
        // Anchor is target's inline-end (right in LTR coords) - tooltip's end aligns to it
        left = activeTooltip.x - rect.width;
        // Clamp: keep inside viewport with padding
        if (left < padding) left = padding;
        if (left + rect.width > window.innerWidth - padding) {
          left = window.innerWidth - rect.width - padding;
        }
      } else {
        // Anchor is target's inline-start (left) - no centering transform
        if (left + rect.width > window.innerWidth - padding) {
          left = window.innerWidth - rect.width - padding;
        }
        if (left < padding) left = padding;
      }
      // Bottom nav sits at viewport bottom - bottom+6 is outside, flip above target
      if (top + rect.height > window.innerHeight - padding) {
        const targetRect = hoveredElement?.getBoundingClientRect();
        if (targetRect) {
          top = targetRect.top - rect.height - 6;
        }
      }
      tooltipRef.style.left = `${left}px`;
      tooltipRef.style.top = `${top}px`;
      tooltipRef.style.transform = 'none';
      tooltipRef.style.opacity = '1';
      return;
    }

    if (left - rect.width / 2 < padding) {
      left = rect.width / 2 + padding;
    }
    if (left + rect.width / 2 > window.innerWidth - padding) {
      left = window.innerWidth - rect.width / 2 - padding;
    }

    if (top + rect.height > window.innerHeight - padding) {
      const targetRect = hoveredElement?.getBoundingClientRect();
      if (targetRect) {
        top = targetRect.top - rect.height - 6;
      }
    }

    tooltipRef.style.left = `${left}px`;
    tooltipRef.style.top = `${top}px`;
    tooltipRef.style.transform = 'translate(-50%, 0)';
    tooltipRef.style.opacity = '1';
  }

  return {
    handleKeydown,
    handleKeyup: discovery.release,
    clearDiscovery: discovery.cancel,
    focusAppSearch,
    navigateMessageList,
    handleMouseOver,
    handleMouseOut,
    clearTooltip,
    positionTooltip,
  };
}
