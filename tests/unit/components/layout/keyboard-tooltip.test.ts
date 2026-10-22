import { afterEach, beforeEach, expect, test } from 'bun:test';
import {
  createKeyboardTooltipController,
  type KeyboardTooltipDeps,
} from '@/ui/blocks/layout/use-keyboard-tooltip.svelte.js';
import { DEFAULT_KEYBINDINGS } from '@/utils/types.js';
import { createListSelectionState, createSelectionApi } from '@/utils/ui/selection-api.js';
import { publishSelectionSurface, resetSelectionRegistry } from '@/utils/ui/selection-registry.js';
import { cleanupDom, setupDom } from '../../helpers/svelte-harness.js';

beforeEach(() => {
  setupDom();
  cleanupDom();
  resetSelectionRegistry();
});
afterEach(() => {
  cleanupDom();
  resetSelectionRegistry();
});

/** The controller's deps with only the pieces a test cares about overridden. */
function makeDeps(
  overrides: { set?: Partial<KeyboardTooltipDeps['set']>; toggleSplitPane?: () => void } = {}
): KeyboardTooltipDeps {
  const noop = () => {};
  const closed = () => false;
  return {
    get: {
      currentView: () => 'mailbox',
      mgmtTab: () => 'active',
      selectedAddresses: () => new Set(),
      mgmtSearch: () => '',
      selectedThread: () => [],
      currentEmailDetail: () => null,
      confirmDialog: () => null,
      qrDialogOpen: closed,
      createAddressDialogOpen: closed,
      commandPaletteOpen: closed,
      cheatSheetOpen: closed,
      exportWizardOpen: closed,
      showExportBackupDialog: closed,
      showImportBackupDialog: closed,
      addressViewTagDialogOpen: closed,
      keybindings: () => DEFAULT_KEYBINDINGS,
      activeNavigationList: () => [],
      currentNavigationIndex: () => -1,
      headerBackAvailable: closed,
    },
    set: {
      setCurrentView: noop,
      setCheatSheetOpen: noop,
      setCommandPaletteOpen: noop,
      setActiveTooltip: noop,
      ...overrides.set,
    },
    shortcuts: {
      refreshMailbox: noop,
      createAddress: noop,
      copyEmail: noop,
      copyOtp: noop,
      closeConfirm: noop,
      closeQrDialog: noop,
      setSelectedAddresses: noop,
      setMgmtSearch: noop,
      setSelectedMessage: noop,
      setCurrentEmailDetail: noop,
    },
    toggleSplitPane: overrides.toggleSplitPane,
    openMessageDetail: noop,
    showToast: noop,
    getTranslation: (key) => key,
  };
}

const press = (
  controller: { handleKeydown: (e: KeyboardEvent) => void },
  init: KeyboardEventInit
) => {
  const event = new KeyboardEvent('keydown', { cancelable: true, ...init });
  controller.handleKeydown(event);
  return event;
};

test('a view-owned modal suppresses global copy and navigation shortcuts', () => {
  const calls: string[] = [];
  const record = () => calls.push('action');
  const closed = () => false;
  const deps: KeyboardTooltipDeps = {
    get: {
      currentView: () => 'mailbox',
      mgmtTab: () => 'active',
      selectedAddresses: () => new Set(),
      mgmtSearch: () => '',
      selectedThread: () => [],
      currentEmailDetail: () => null,
      confirmDialog: () => null,
      qrDialogOpen: closed,
      createAddressDialogOpen: closed,
      commandPaletteOpen: closed,
      cheatSheetOpen: closed,
      exportWizardOpen: closed,
      showExportBackupDialog: closed,
      showImportBackupDialog: closed,
      addressViewTagDialogOpen: closed,
      keybindings: () => DEFAULT_KEYBINDINGS,
      activeNavigationList: () => [],
      currentNavigationIndex: () => -1,
      headerBackAvailable: closed,
    },
    set: {
      setCurrentView: record,
      setCheatSheetOpen: record,
      setCommandPaletteOpen: record,
      setActiveTooltip: () => {},
    },
    shortcuts: {
      refreshMailbox: record,
      createAddress: record,
      copyEmail: record,
      copyOtp: record,
      closeConfirm: record,
      closeQrDialog: record,
      setSelectedAddresses: record,
      setMgmtSearch: record,
      setSelectedMessage: record,
      setCurrentEmailDetail: record,
    },
    openMessageDetail: record,
    showToast: record,
    getTranslation: (key) => key,
  };
  const controller = createKeyboardTooltipController(deps);
  const modal = document.createElement('div');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  document.body.append(modal);
  const pressKey = (key: string) =>
    controller.handleKeydown(new KeyboardEvent('keydown', { key, ctrlKey: true }));
  for (const key of ['c', 'o', 'r', 'n', 'k']) pressKey(key);
  expect(calls).toEqual([]);
  modal.remove();
  pressKey('c');
  pressKey('o');
  expect(calls).toEqual(['action', 'action']);
});

/*
 * The four system shortcuts the Settings reference promises. Each was listed in
 * `KeyboardShortcutsView` and handled nowhere, so the product documented a
 * capability it did not have; these tests are what keep the promise honest.
 */

test('Ctrl/Cmd+Shift+P opens the command palette, and Ctrl+P stays the browser’s', () => {
  const opened: boolean[] = [];
  const controller = createKeyboardTooltipController(
    makeDeps({ set: { setCommandPaletteOpen: (open) => opened.push(open) } })
  );
  press(controller, { key: 'P', ctrlKey: true, shiftKey: true });
  press(controller, { key: 'p', metaKey: true, shiftKey: true });
  expect(opened).toEqual([true, true]);
  // The alternate chord is Shift-qualified: Ctrl+P alone is print, not ours.
  press(controller, { key: 'p', ctrlKey: true });
  expect(opened).toEqual([true, true]);
});

test('Ctrl/Cmd+Shift+S toggles the split pane', () => {
  let toggles = 0;
  const controller = createKeyboardTooltipController(
    makeDeps({
      toggleSplitPane: () => {
        toggles += 1;
      },
    })
  );
  press(controller, { key: 'S', ctrlKey: true, shiftKey: true });
  press(controller, { key: 's', metaKey: true, shiftKey: true });
  expect(toggles).toBe(2);
  // Without a split-pane target the chord is not claimed at all.
  const bare = createKeyboardTooltipController(makeDeps());
  expect(press(bare, { key: 's', ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
});

test('Ctrl/Cmd+A ticks the published list, and falls through when there is none', () => {
  let selectAllCalls = 0;
  publishSelectionSurface({
    surface: 'mailbox',
    state: createListSelectionState(['archive', 'delete']),
    api: {
      ...createSelectionApi(),
      selectAll: () => {
        selectAllCalls += 1;
      },
    },
  });
  const controller = createKeyboardTooltipController(makeDeps());
  expect(press(controller, { key: 'a', ctrlKey: true }).defaultPrevented).toBe(true);
  expect(selectAllCalls).toBe(1);

  // No list published (a settings page): the chord must stay the browser's, or
  // the extension would swallow select-all everywhere. The handler lives on the
  // window, so the registry is the only thing telling it where a list is.
  resetSelectionRegistry();
  const orphan = press(controller, { key: 'a', metaKey: true });
  expect(orphan.defaultPrevented).toBe(false);
  expect(selectAllCalls).toBe(1);
});

test('Delete runs the selection’s own delete action, and only when it offers one', () => {
  const ran: string[] = [];
  const withDelete = createListSelectionState(['archive', 'delete']);
  withDelete.active = true;
  withDelete.count = 2;
  publishSelectionSurface({
    surface: 'mailbox',
    state: withDelete,
    api: { ...createSelectionApi(), run: (action) => void ran.push(action) },
  });
  const controller = createKeyboardTooltipController(makeDeps());
  expect(press(controller, { key: 'Delete' }).defaultPrevented).toBe(true);
  expect(press(controller, { key: 'Backspace' }).defaultPrevented).toBe(true);
  expect(ran).toEqual(['delete', 'delete']);

  // A list that does not advertise `delete` must not be deleted onto: the
  // keyboard runs the strip's own action list, never a guess at one.
  resetSelectionRegistry();
  const noDelete = createListSelectionState(['archive']);
  noDelete.active = true;
  noDelete.count = 1;
  const ran2: string[] = [];
  publishSelectionSurface({
    surface: 'addresses',
    state: noDelete,
    api: { ...createSelectionApi(), run: (action) => void ran2.push(action) },
  });
  const ignored = press(controller, { key: 'Delete' });
  expect(ignored.defaultPrevented).toBe(false);
  expect(ran2).toEqual([]);

  // With nothing selected there is nothing to delete.
  resetSelectionRegistry();
  const idle = createListSelectionState(['delete']);
  publishSelectionSurface({ surface: 'identities', state: idle, api: createSelectionApi() });
  expect(press(controller, { key: 'Delete' }).defaultPrevented).toBe(false);
});
