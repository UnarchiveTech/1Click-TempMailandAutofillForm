/**
 * NavbarOrderSettingsView follows storage - real component, jsdom.
 *
 * Two regressions are pinned here:
 *
 * 1. The page read its three keys once on mount and never subscribed. With a
 *    second settings surface open (the app tab, the popup) or another device
 *    over sync, the local copy went stale - and the page's own
 *    `if (autoArrange === v) return` / `if (minPrimary === p) return` guards then
 *    SWALLOWED the click the user meant as a change: the stale page showed ON, the
 *    user clicked ON, the guard read "no change", nothing was written, and the
 *    stored OFF stood. It now follows `storage.onChanged` exactly as the shell's
 *    navbar-preferences controller does, and drops the listener on destroy.
 *
 * 2. `customNavOrder` is user-writable and syncs between devices, so it can
 *    arrive with a key repeated (a raced write, a manual edit, a sync conflict).
 *    The reorder list is a KEYED each, where a repeated key is a Svelte error,
 *    not a cosmetic double row - the order is repaired with `normalizeNavOrder`
 *    on the way in, and every canonical item is still listed.
 *
 * The fake browser records `storage.onChanged` listeners so a test can emit a
 * change the way the extension does, and can assert the listener is gone after
 * unmount.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});

// ---- in-memory storage backing the mocked wxt/browser ------------------------
const storage: Record<string, unknown> = {};

type ChangeListener = (
  changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
  area: string
) => void;
const changeListeners = new Set<ChangeListener>();

const fakeBrowser = {
  runtime: { id: 'test-ext', sendMessage: async () => ({ success: true }) },
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return { ...storage };
        const arr = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const k of arr) if (k in storage) out[k] = storage[k];
        return out;
      },
      set: async (items: Record<string, unknown>) => {
        Object.assign(storage, items);
      },
    },
    onChanged: {
      addListener: (listener: ChangeListener) => {
        changeListeners.add(listener);
      },
      removeListener: (listener: ChangeListener) => {
        changeListeners.delete(listener);
      },
    },
  },
};
mock.module('wxt/browser', () => ({ browser: fakeBrowser }));

// Initialize svelte-i18n exactly like the app does (register 'en' + init) so
// $t() resolves real strings instead of raw keys.
await import('@/utils/i18n/i18n.js');
const { t, waitLocale } = await import('svelte-i18n');
const { get } = await import('svelte/store');
await waitLocale();

const { cleanupDom, renderComponent, unmountComponent } = await import(
  '../../helpers/svelte-harness.js'
);
const { DEFAULT_NAV_ORDER } = await import('@/utils/ui/nav-layout.js');

const VIEW = 'src/ui/views/settings/NavbarOrderSettingsView.svelte';
const flush = (ms = 40) => new Promise((r) => setTimeout(r, ms));

/** Apply a change the way the extension does: every registered listener runs. */
function emitChange(changes: Record<string, { newValue?: unknown }>) {
  for (const listener of [...changeListeners]) listener(changes, 'local');
}

/** A button of the auto-arrange group, by its label (On / Off). */
function toggle(label: 'On' | 'Off'): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find(
    (button) => button.textContent?.trim() === label
  );
  if (!found) throw new Error(`auto-arrange button not found: ${label}`);
  return found;
}

const isPressed = (label: 'On' | 'Off') => toggle(label).getAttribute('aria-pressed') === 'true';

/**
 * Rows of the reorder list, counted by their own move control: one per item, and
 * the control exists whether or not the item may move (the first/last row's is
 * disabled, not absent).
 */
function rowCount(): number {
  const moveUp = get(t)('common.moveUp');
  return [...document.querySelectorAll('button')].filter(
    (button) => button.getAttribute('aria-label') === moveUp
  ).length;
}

beforeEach(() => {
  for (const key of Object.keys(storage)) delete storage[key];
  changeListeners.clear();
  cleanupDom();
});

describe('NavbarOrderSettingsView follows storage', () => {
  test('a change made by another surface lands in this page, and the listener is released', async () => {
    storage.autoArrangeMore = false;
    const { instance } = await renderComponent(VIEW);
    await flush();
    expect(changeListeners.size).toBe(1);
    expect(isPressed('Off')).toBe(true);

    // The other settings page (or another device, over sync) turns it ON.
    storage.autoArrangeMore = true;
    emitChange({ autoArrangeMore: { newValue: true } });
    await flush();
    expect(isPressed('On')).toBe(true);
    expect(isPressed('Off')).toBe(false);

    await unmountComponent(instance);
    expect(changeListeners.size).toBe(0);
  });

  test('an external change cannot leave this page silently ignoring the click', async () => {
    storage.autoArrangeMore = true;
    const { instance } = await renderComponent(VIEW);
    await flush();
    expect(isPressed('On')).toBe(true);

    // Another surface turns auto-arrange OFF while this page is open.
    storage.autoArrangeMore = false;
    emitChange({ autoArrangeMore: { newValue: false } });
    await flush();
    expect(isPressed('Off')).toBe(true);

    // The user now asks for ON. While this page was stale it still believed ON
    // was current, so its `autoArrange === v` guard returned early and wrote
    // NOTHING - the stored OFF stood while the UI claimed otherwise.
    toggle('On').click();
    await flush();
    expect(storage.autoArrangeMore).toBe(true);

    await unmountComponent(instance);
  });

  test('the primary-items preference follows storage too', async () => {
    storage.minPrimaryItems = 'auto';
    const { instance } = await renderComponent(VIEW);
    await flush();
    const pressedAuto = () =>
      [...document.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find(
        (button) => button.textContent?.trim() === get(t)('settings.primaryItemsPrefAuto')
      );
    expect(pressedAuto()?.getAttribute('aria-pressed')).toBe('true');

    storage.minPrimaryItems = 2;
    emitChange({ minPrimaryItems: { newValue: 2 } });
    await flush();
    expect(pressedAuto()?.getAttribute('aria-pressed')).toBe('false');
    const two = [...document.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find(
      (button) => button.textContent?.trim() === '2'
    );
    expect(two?.getAttribute('aria-pressed')).toBe('true');

    await unmountComponent(instance);
  });

  test('a stored order with a repeated key still lists every item exactly once', async () => {
    // A raced write / sync conflict / manual edit: 'settings' twice, plus a key
    // from a retired view. A keyed each cannot take the duplicate at all.
    storage.customNavOrder = ['settings', 'settings', 'mailbox', 'retiredView'];
    const { instance } = await renderComponent(VIEW);
    await flush();

    expect(rowCount()).toBe(DEFAULT_NAV_ORDER.length);

    await unmountComponent(instance);
  });
});
