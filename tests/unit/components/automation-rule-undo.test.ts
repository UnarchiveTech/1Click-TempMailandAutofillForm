/**
 * AutomationView rule-undo stale-generation guard - real component, jsdom.
 *
 * The rule delete/clear undos restore a whole-list snapshot, so they route
 * through the shared revision counter (rule 18). This drives the REAL flow -
 * seed storage → render → row Delete button → ConfirmDialog confirm → toast -
 * and pins both directions:
 *
 *   • the delete marks a revision, so a fresh undo restores the rule;
 *   • a mutation landing elsewhere while the toast is up (markAddressMutation
 *     from any other flow) stales that undo: it refuses to run and says so,
 *     instead of silently reverting the newer state.
 */

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});

const storage: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};
const alarms = new Map<string, { name: string; scheduledTime?: number }>();

const fakeBrowser = {
  runtime: { id: 'test-automation-undo', sendMessage: async () => ({ success: true }) },
  alarms: {
    get: async (name: string) => alarms.get(name),
    clear: async (name: string) => alarms.delete(name),
    create: async (name: string, info: { when?: number }) => {
      alarms.set(name, { name, scheduledTime: info.when });
    },
  },
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return { ...storage };
        const arr = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const k of arr) if (k in storage) out[k] = storage[k];
        return out;
      },
      set: async (items: Record<string, unknown>) => Object.assign(storage, items),
      remove: async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete storage[k];
      },
    },
    // AutomationView subscribes to label-catalog changes on mount; the real
    // API hangs onChanged off browser.storage (not off the local area).
    onChanged: { addListener: () => {}, removeListener: () => {} },
    session: {
      get: async (keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return { ...sessionStore };
        const arr = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const k of arr) if (k in sessionStore) out[k] = sessionStore[k];
        return out;
      },
      set: async (items: Record<string, unknown>) => Object.assign(sessionStore, items),
      remove: async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete sessionStore[k];
      },
    },
  },
};

mock.module('wxt/browser', () => ({ browser: fakeBrowser }));
mock.module('@/utils/ui/reduced-motion.svelte.js', () => ({
  useReducedMotion: () => ({ enabled: false }),
}));

// Initialize svelte-i18n exactly like the app does (register 'en' + init) so
// $t() resolves real strings instead of raw keys.
await import('@/utils/i18n/i18n.js');
const { waitLocale } = await import('svelte-i18n');
await waitLocale();

const { cleanupDom, renderComponent, unmountComponent } = await import(
  '../helpers/svelte-harness.js'
);
const { toastStore } = await import('@/utils/ui/toastStore.js');
const { __resetUndoGenerationForTests, markAddressMutation } = await import(
  '@/utils/storage/undo-generation.js'
);

import type { Toast } from '@/ui/blocks/feedback/toast-types.js';

const SUPERSEDED = 'A newer change replaced that action - nothing was undone';

function currentToasts(): Toast[] {
  const out: Toast[] = [];
  const unsubscribe = toastStore.subscribe((t) => {
    out.length = 0;
    out.push(...t);
  });
  unsubscribe();
  return out;
}

const flush = (ms = 60) => new Promise((r) => setTimeout(r, ms));

/** A mailbox rule the view's repository parse accepts (mailbox tab is default). */
function mailboxRule(id: string, contains: string) {
  return {
    id,
    name: contains,
    contains,
    field: 'sender',
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

beforeEach(async () => {
  for (const k of Object.keys(storage)) delete storage[k];
  for (const k of Object.keys(sessionStore)) delete sessionStore[k];
  alarms.clear();
  toastStore.clear();
  await __resetUndoGenerationForTests();
});

/** Render with one seeded mailbox rule (the default tab) and wait for loads. */
async function mountWithRule() {
  storage.mailboxRules = [mailboxRule('rule-1', 'example.com')];
  const { target, instance } = await renderComponent('src/ui/views/AutomationView.svelte', {});
  // The rule row's Delete button (the third per-row action; text label).
  const findDelete = () =>
    [...target.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === 'Delete'
    );
  const deadline = Date.now() + 2000;
  while (!findDelete() && Date.now() < deadline) await flush();
  const deleteBtn = findDelete();
  expect(deleteBtn).toBeDefined();
  return { target, instance, deleteBtn: deleteBtn as HTMLButtonElement };
}

/**
 * Drive delete → confirm → toast, returning the undo callback.
 *
 * The confirm button is matched on the label THIS flow passes
 * (`confirmLabel: $t('common.delete')` → "Delete"): the dialog now aligns its
 * accessible name with the visible label, so the 'Confirm' default no longer
 * names it. Scoped to the dialog, because the row's own Delete button carries
 * the same label and lives outside it.
 */
async function deleteRuleAndGetUndo(deleteBtn: HTMLButtonElement) {
  deleteBtn.click();
  await flush();
  const dialog = document.querySelector('[role="dialog"]');
  const confirmBtn = [...(dialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
    (b) => b.getAttribute('aria-label') === 'Delete'
  );
  expect(confirmBtn).toBeDefined();
  (confirmBtn as HTMLButtonElement).click();
  await flush();
  expect(storage.mailboxRules).toEqual([]);
  const offer = currentToasts().find((t) => t.undoAction);
  expect(offer).toBeDefined();
  return offer as Toast;
}

describe('AutomationView rule undo generation guard', () => {
  test('an imported actionless rule cannot be enabled and its checkbox remains off', async () => {
    storage.mailboxRules = [{ ...mailboxRule('empty', 'example.com'), enabled: false }];
    const rendered = await renderComponent('src/ui/views/AutomationView.svelte', {});
    await flush();
    const checkbox = rendered.target.querySelector<HTMLInputElement>(
      '#rule-row-empty input[type="checkbox"]'
    );
    expect(checkbox).not.toBeNull();
    checkbox?.click();
    await flush();
    expect(checkbox?.checked).toBe(false);
    expect((storage.mailboxRules as { enabled: boolean }[])[0].enabled).toBe(false);
    expect(
      currentToasts().some((toast) => toast.message === 'Choose at least one action for this rule.')
    ).toBe(true);
    await unmountComponent(rendered.instance);
    cleanupDom();
  });
  test('editing a disabled mailbox rule keeps it disabled', async () => {
    const { target, instance } = await mountWithRule();
    storage.mailboxRules = [
      { ...mailboxRule('rule-1', 'example.com'), enabled: false, label: 'Work' },
    ];
    await unmountComponent(instance);
    const rendered = await renderComponent('src/ui/views/AutomationView.svelte', {});
    await flush();
    const edit = rendered.target.querySelector<HTMLButtonElement>('button[aria-label="Edit"]');
    expect(edit).not.toBeNull();
    edit?.click();
    await flush();
    const dialog = document.querySelector('[role="dialog"]');
    const save = [...(dialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
      (button) => button.textContent?.trim() === 'Save'
    );
    save?.click();
    await flush();
    expect((storage.mailboxRules as { enabled: boolean }[])[0].enabled).toBe(false);
    expect(target).toBeDefined();
    await unmountComponent(rendered.instance);
    cleanupDom();
  });

  test('rule preview is read-only and identifies an earlier matching rule', async () => {
    storage.mailboxRules = [
      { ...mailboxRule('earlier', 'example.com'), label: 'Earlier' },
      { ...mailboxRule('draft', 'example.com'), label: 'Draft' },
    ];
    storage.storedEmails = {
      'inbox@example.com': [
        { id: 'mail-1', from: 'sender@example.com', subject: 'Invoice', received_at: Date.now() },
      ],
    };
    const rendered = await renderComponent('src/ui/views/AutomationView.svelte', {});
    await flush();
    const edits = rendered.target.querySelectorAll<HTMLButtonElement>('button[aria-label="Edit"]');
    edits[1]?.click();
    await flush();
    const before = JSON.stringify(storage);
    const dialog = document.querySelector('[role="dialog"]');
    const preview = [...(dialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
      (button) => button.textContent?.trim() === 'Test rule'
    );
    expect(preview).toBeDefined();
    preview?.click();
    await flush();
    expect(dialog?.textContent).toContain('Matches 1 message');
    expect(dialog?.textContent).toContain('An earlier rule wins: example.com');
    expect(JSON.stringify(storage)).toBe(before);
    await unmountComponent(rendered.instance);
    cleanupDom();
  });

  test('a fresh undo restores the deleted rule', async () => {
    const { target: _target, instance, deleteBtn } = await mountWithRule();

    const offer = await deleteRuleAndGetUndo(deleteBtn);
    expect(storage.mailboxRules).toEqual([]); // delete landed

    await offer.undoAction?.();
    await flush();

    expect((storage.mailboxRules as Array<{ id: string }>).map((r) => r.id)).toEqual(['rule-1']);
    expect(currentToasts().some((t) => t.message === SUPERSEDED)).toBe(false);

    await unmountComponent(instance);
    cleanupDom();
  });

  test('an undo offered before a newer mutation refuses to run and says so', async () => {
    const { target: _target, instance, deleteBtn } = await mountWithRule();

    const offer = await deleteRuleAndGetUndo(deleteBtn);
    expect(storage.mailboxRules).toEqual([]);

    // A newer surface mutation lands OUTSIDE this flow (a delete, an import,
    // a domain switch - anything that marks the shared counter).
    await markAddressMutation();

    await offer.undoAction?.();
    await flush();

    // The pre-delete snapshot was never written back - the rule stays deleted -
    // and the user is told why instead of a silent no-op.
    expect(storage.mailboxRules).toEqual([]);
    expect(currentToasts().some((t) => t.message === SUPERSEDED)).toBe(true);

    await unmountComponent(instance);
    cleanupDom();
  });
});
