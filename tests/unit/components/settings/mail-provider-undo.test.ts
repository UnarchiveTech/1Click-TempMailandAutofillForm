/**
 * Domain-switch undo toasts in MailProviderView - real component, jsdom.
 *
 * Two regressions are pinned here:
 *
 * 1. A failed undo write used to vanish: the rejection escaped to Toast.svelte's
 *    generic logError catch, so the user saw no error toast, never saw the
 *    "undone" confirmation, and the revert callbacks silently never ran. The
 *    undo write must now surface `errors.storageWriteFailed` and skip the
 *    revert bookkeeping.
 *
 * 2. Every switch used to show its own undo toast carrying its own snapshot. A
 *    still-visible older toast clicked after a newer switch would clobber the
 *    newer switch's address writes with its stale snapshot. A newer switch now
 *    removes the older undo toast (generation token + toast id).
 *
 * The component module keeps `domainSwitchGeneration` at module scope, so it
 * carries across tests in this file - harmless: every check compares a
 * captured generation against the CURRENT one, which stays consistent within
 * and across tests. `toastStore.clear()` in beforeEach resets the dedupe
 * window so identical toast text from a previous test can't suppress this
 * test's toast.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Toast } from '@/ui/blocks/feedback/toast-types.js';
import type { Address } from '@/utils/types.js';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});

// ---- in-memory storage backing the mocked wxt/browser -----------------------
const storage: Record<string, unknown> = {};
/**
 * While armed, EVERY `storage.local.set` rejects (simulating a storage failure
 * that outlives a retry).
 *
 * It fails every attempt on purpose: writes go through `writeWithRetry`, whose
 * contract is to absorb a one-off transient/quota failure (50 ms → 200 ms
 * backoff, four attempts). Arming a single failure would therefore make the
 * write SUCCEED on the second attempt - a test that wants the failure path has
 * to keep the area broken for the whole write.
 */
let failLocalSets = false;

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
        if (failLocalSets) throw new Error('quota exceeded');
        Object.assign(storage, items);
      },
    },
    onChanged: { addListener: () => {}, removeListener: () => {} },
  },
};
mock.module('wxt/browser', () => ({ browser: fakeBrowser }));

// Initialize svelte-i18n exactly like the app does (register 'en' + init) so
// $t() resolves real strings instead of raw keys.
await import('@/utils/i18n/i18n.js');
const { waitLocale } = await import('svelte-i18n');
await waitLocale();

const { cleanupDom, renderComponent, unmountComponent } = await import(
  '../../helpers/svelte-harness.js'
);
const { toastStore } = await import('@/utils/ui/toastStore.js');
const { __resetUndoGenerationForTests, markAddressMutation } = await import(
  '@/utils/storage/undo-generation.js'
);

// Guerrilla Mail: bundled provider with multiDomain enabled (11 domains) and
// multiInstance disabled - so the view renders exactly two comboboxes and the
// Default Domain card.
const PROVIDER = 'guerrilla';
const USERNAME = 'undo.test';
const ADDRESS = `${USERNAME}@guerrillamail.com`;
const DOMAIN_KEY = `domainIndex_${PROVIDER}_${USERNAME}`;
const NOW = Date.now();

function seedStorage() {
  storage.addresses = [
    {
      id: 'addr-1',
      address: ADDRESS,
      provider: PROVIDER,
      createdAt: NOW - 60_000,
      expiresAt: NOW + 3_600_000,
      accountStatus: 'active',
    },
  ] satisfies Partial<Address>[];
}

function currentToasts(): Toast[] {
  const out: Toast[] = [];
  const unsubscribe = toastStore.subscribe((t) => {
    out.length = 0;
    out.push(...t);
  });
  unsubscribe();
  return out;
}

const flush = (ms = 80) => new Promise((r) => setTimeout(r, ms));

/** Find the (only) live undo toast, narrowing for the assertion that follows. */
function requireUndoToast(message?: string): Toast {
  const found = currentToasts().find(
    (t) => t.undoAction && (message === undefined || t.message === message)
  );
  expect(found).toBeDefined();
  if (!found) throw new Error('undo toast missing');
  return found;
}

async function mountView() {
  const onSetDefaultDomain = mock((_v: string) => {});
  const onSaveSettings = mock(() => {});
  const { instance } = await renderComponent('src/ui/views/settings/MailProviderView.svelte', {
    selectedProvider: PROVIDER,
    defaultDomain: '',
    allAddresses: storage.addresses as Address[],
    onSetDefaultDomain,
    onSaveSettings,
  });
  // jsdom ships no scrollIntoView; the open Dropdown's scroll-into-view effect
  // would otherwise throw an error boundary the moment a menu opens. jsdom's
  // HTMLElement is installed by setupDom() inside renderComponent, so the
  // prototype patch happens here, not at module load.
  const htmlProto = (
    globalThis as unknown as { HTMLElement?: { prototype: Record<string, unknown> } }
  ).HTMLElement?.prototype;
  if (htmlProto && typeof htmlProto.scrollIntoView !== 'function') {
    htmlProto.scrollIntoView = () => {};
  }
  return { instance, onSetDefaultDomain, onSaveSettings };
}

/** The Default Domain select is the LAST combobox in the view's DOM order. */
async function openDomainMenu() {
  const comboboxes = [...document.querySelectorAll<HTMLButtonElement>('[role="combobox"]')];
  expect(comboboxes.length).toBeGreaterThanOrEqual(2);
  const trigger = comboboxes[comboboxes.length - 1];
  if (!trigger) throw new Error('domain combobox not found');
  trigger.click();
  await flush();
}

function optionButton(label: string): HTMLButtonElement {
  const options = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')];
  const found = options.find((o) => o.textContent?.includes(label));
  if (!found) throw new Error(`option not found: ${label}`);
  return found;
}

function dialogButton(label: string): HTMLButtonElement {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')];
  const found = buttons.find((b) => b.textContent?.trim() === label);
  if (!found) throw new Error(`dialog button not found: ${label}`);
  return found;
}

/** Drive a full "also change existing addresses" switch through the real dialog. */
async function switchExistingAddressesTo(domain: string) {
  await openDomainMenu();
  optionButton(`@${domain}`).click();
  await flush();
  const scopeButtons = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
  ].filter((b) => b.textContent?.includes('Also change existing addresses'));
  expect(scopeButtons.length).toBe(1);
  const scopeButton = scopeButtons[0];
  if (!scopeButton) throw new Error('scope button missing');
  scopeButton.click();
  dialogButton('Apply').click();
  await flush();
}

beforeEach(async () => {
  for (const k of Object.keys(storage)) delete storage[k];
  failLocalSets = false;
  toastStore.clear();
  await __resetUndoGenerationForTests();
});

describe('MailProviderView domain-switch undo', () => {
  test('undo reverts the stored domain index and confirms with a toast', async () => {
    seedStorage();
    const { instance, onSetDefaultDomain } = await mountView();

    await switchExistingAddressesTo('sharklasers.com');
    expect(storage[DOMAIN_KEY]).toBe(1); // sharklasers.com is index 1

    const undoToast = requireUndoToast('Updated 1 address to @sharklasers.com');

    await undoToast.undoAction?.();
    await flush();

    // Snapshot restored: the key was absent before the switch → undo writes 0.
    expect(storage[DOMAIN_KEY]).toBe(0);
    // Apply ("sharklasers.com") + revert ("").
    expect(onSetDefaultDomain).toHaveBeenCalledTimes(2);
    expect(onSetDefaultDomain.mock.calls[1]?.[0]).toBe('');
    expect(currentToasts().some((t) => t.message === 'Domain switch undone')).toBe(true);

    await unmountComponent(instance);
    cleanupDom();
  });

  test('failed undo write shows an error toast and skips the revert', async () => {
    seedStorage();
    const { instance, onSetDefaultDomain } = await mountView();

    await switchExistingAddressesTo('sharklasers.com');
    expect(storage[DOMAIN_KEY]).toBe(1);

    // Arm AFTER the apply so the switch write itself succeeds, and leave it
    // armed through every retry the write wrapper makes.
    failLocalSets = true;
    const undoToast = requireUndoToast();
    await undoToast.undoAction?.();
    await flush();
    failLocalSets = false;

    // The revert never landed: index unchanged, no success confirmation.
    expect(storage[DOMAIN_KEY]).toBe(1);
    const messages = currentToasts().map((t) => t.message);
    expect(messages).toContain('Failed to write to storage');
    expect(messages).not.toContain('Domain switch undone');
    // Revert bookkeeping skipped: only the apply touched the default domain.
    expect(onSetDefaultDomain).toHaveBeenCalledTimes(1);

    await unmountComponent(instance);
    cleanupDom();
  });

  test('a superseded undo says so instead of failing silently', async () => {
    seedStorage();
    const { instance, onSetDefaultDomain } = await mountView();

    await switchExistingAddressesTo('sharklasers.com');
    expect(storage[DOMAIN_KEY]).toBe(1);
    const undoToast = requireUndoToast('Updated 1 address to @sharklasers.com');

    // A newer surface mutation lands OUTSIDE the view (a delete, an import…)
    // while the switch's undo toast is still on screen. The shared revision
    // counter - not the view's old private one - sees it.
    await markAddressMutation();

    await undoToast.undoAction?.();
    await flush();

    // Nothing reverted, and the user is told why instead of a silent no-op.
    expect(storage[DOMAIN_KEY]).toBe(1);
    expect(onSetDefaultDomain).toHaveBeenCalledTimes(1);
    expect(
      currentToasts().some(
        (t) => t.message === 'A newer change replaced that action - nothing was undone'
      )
    ).toBe(true);
    expect(currentToasts().some((t) => t.message === 'Domain switch undone')).toBe(false);

    await unmountComponent(instance);
    cleanupDom();
  });

  test('a newer switch removes the older undo toast so its stale snapshot is unreachable', async () => {
    seedStorage();
    const { instance, onSetDefaultDomain } = await mountView();

    await switchExistingAddressesTo('sharklasers.com'); // writes 1, snapshot { key: 0 }
    await switchExistingAddressesTo('grr.la'); // writes 2, snapshot { key: 1 }

    // Only the NEWEST switch's undo toast remains reachable.
    const undoToasts = currentToasts().filter((t) => t.undoAction);
    expect(undoToasts.length).toBe(1);
    const newestUndo = requireUndoToast('Updated 1 address to @grr.la');

    await newestUndo.undoAction?.();
    await flush();

    // Undo restores the second switch's previous index (1) - NOT the stale
    // first snapshot (0), which would have clobbered the newer switch.
    expect(storage[DOMAIN_KEY]).toBe(1);
    // Apply #1 + apply #2 + revert.
    expect(onSetDefaultDomain).toHaveBeenCalledTimes(3);
    expect(onSetDefaultDomain.mock.calls[2]?.[0]).toBe('');

    await unmountComponent(instance);
    cleanupDom();
  });
});
