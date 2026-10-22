/**
 * One selection contract, one strip, four lists.
 *
 * The contract's job is to make a NEW list cheap and a NEW action impossible to
 * half-add: the action vocabulary is closed (`SelectionActionId`), each member's
 * face is one row of `SELECTION_ACTION_META` that must resolve in `en.json`, and
 * `run(action)` is the only way the strip can invoke anything. So the assertions
 * here are mostly about completeness - a union member with no metadata row, or a
 * metadata key that does not exist, fails rather than rendering a raw key or a
 * blank button.
 *
 * The last block is the ratchet: the shape had drifted into three type
 * declarations and five placeholder literals across the layout, which type-checks
 * at the caller and is `undefined` at runtime. Nothing outside these modules may
 * re-declare it.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { get } from 'svelte/store';
import {
  createListSelectionState,
  createSelectionApi,
  SELECTION_ACTION_CLASS,
  SELECTION_ACTION_META,
  type SelectionActionId,
  type SelectionApi,
} from '@/utils/ui/selection-api.js';
import {
  activeSelectionStore,
  publishedSelections,
  publishSelectionSurface,
  resetSelectionRegistry,
  selectionFor,
  selectionKeyboardTarget,
} from '@/utils/ui/selection-registry.js';

const ROOT = process.cwd();
const EN = JSON.parse(readFileSync(join(ROOT, 'src/locales/en.json'), 'utf8')) as Record<
  string,
  unknown
>;

function localeValue(key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    if (node && typeof node === 'object') return (node as Record<string, unknown>)[part];
    return undefined;
  }, EN);
}

/** Every action the union declares, as a value list (the type alone cannot be walked). */
const ACTION_IDS = Object.keys(SELECTION_ACTION_META) as SelectionActionId[];

describe('the action vocabulary is closed and fully described', () => {
  test('every action has a face: icon, label, treatment and drop target', () => {
    for (const id of ACTION_IDS) {
      const meta = SELECTION_ACTION_META[id];
      expect(`${id}:${meta.icon.length > 0}:${meta.dropAction.length > 0}`).toBe(`${id}:true:true`);
      expect(['primary', 'secondary', 'tertiary', 'error']).toContain(meta.variant);
      expect(['move', 'copy']).toContain(meta.dropEffect);
      expect(SELECTION_ACTION_CLASS[meta.variant]).toStartWith('btn-');
    }
  });

  test('the labels are EXISTING locale keys - this table never changes a locale file', () => {
    // The whole point of a shared strip is that a list adds no list-specific copy.
    // A new key here would have to be added to all eight locales; a typo would
    // render the key itself (t() returns the key on a miss).
    for (const id of ACTION_IDS) {
      const meta = SELECTION_ACTION_META[id];
      expect([id, localeValue(meta.labelKey) !== undefined]).toEqual([id, true]);
      if (meta.titleKey) {
        expect([id, localeValue(meta.titleKey) !== undefined]).toEqual([id, true]);
      }
    }
  });

  test('the drop targets are distinct, so a drop lands on one action', () => {
    const tokens = ACTION_IDS.map((id) => SELECTION_ACTION_META[id].dropAction);
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});

describe('the inert placeholders are safe and distinct', () => {
  test('createSelectionApi returns a fresh object each time', () => {
    // A shared instance would let whichever list wired last blank out every other
    // holder, and stay invisible because the stubs are valid no-ops either way.
    const first = createSelectionApi();
    const second = createSelectionApi();
    expect(first).not.toBe(second);
    // Same surface, different object: the key sets match, the identities do not.
    expect(Object.keys(first).sort()).toEqual(Object.keys(second).sort());
  });

  test('every stub is a no-op that cannot throw before a list mounts', async () => {
    const api = createSelectionApi();
    for (const call of [api.cancel, api.selectAll, api.deselectAll, () => api.run('delete')]) {
      expect(call()).toBeUndefined();
    }
    // The keyboard verbs are stubs too: an unmounted list must not claim focus,
    // report a tick, or move anything.
    expect(api.hasFocusedRow()).toBe(false);
    expect(api.focusedIsSelected()).toBe(false);
    expect([api.moveFocus(1), api.setFocusedSelected(true)]).toEqual([undefined, undefined]);
    // The optional tag path is absent by default, and `void api.applyTag?.(…)` is
    // how the shell's drops call it - safe either way.
    expect(api.applyTag).toBeUndefined();
    await expect(Promise.resolve(api.applyTag?.('x'))).resolves.toBeUndefined();
  });

  test('createListSelectionState is inert, and carries the actions it is given', () => {
    // (The api stub above is exercised field-by-field in the same describe block
    // as the keyboard verbs, so a new verb cannot be added without a stub.)
    const bare = createListSelectionState();
    expect(bare.active).toBe(false);
    expect(bare.count).toBe(0);
    expect(bare.actions).toEqual([]);
    const seeded = createListSelectionState(['archive', 'delete']);
    expect(seeded.actions).toEqual(['archive', 'delete']);
    expect(seeded).not.toBe(bare);
  });
});

describe('the registry publishes the live surface', () => {
  const state = (active: boolean, count = 0) => ({
    ...createListSelectionState(['delete']),
    active,
    count,
  });

  test('an active selection wins the strip; a cleared one leaves it empty', () => {
    resetSelectionRegistry();
    const publish = publishSelectionSurface({
      surface: 'addresses',
      state: state(true, 3),
      api: createSelectionApi(),
    });
    expect(get(activeSelectionStore)?.surface).toBe('addresses');
    expect(get(activeSelectionStore)?.state.count).toBe(3);
    // An inactive surface is not the strip's business.
    publishSelectionSurface({ surface: 'logins', state: state(false), api: createSelectionApi() });
    expect(get(activeSelectionStore)?.surface).toBe('addresses');
    // Unmounting the list takes the strip down with it.
    publish();
    expect(get(activeSelectionStore)).toBeNull();
  });

  test('the most recently activated surface wins when two are live', () => {
    resetSelectionRegistry();
    publishSelectionSurface({
      surface: 'addresses',
      state: state(true),
      api: createSelectionApi(),
    });
    publishSelectionSurface({
      surface: 'identities',
      state: state(true),
      api: createSelectionApi(),
    });
    expect(get(activeSelectionStore)?.surface).toBe('identities');
    // A refresh of the older surface does not steal the strip back.
    publishSelectionSurface({
      surface: 'addresses',
      state: state(true),
      api: createSelectionApi(),
    });
    expect(get(activeSelectionStore)?.surface).toBe('identities');
  });

  test('a stale unregister cannot tear down the mount that replaced it', () => {
    // A re-mount publishes a new entry for the same surface before the old
    // effect's cleanup runs; the old cleanup must be a no-op, or the strip would
    // vanish while the replacement list is on screen.
    resetSelectionRegistry();
    const first = publishSelectionSurface({
      surface: 'mailbox',
      state: state(true),
      api: createSelectionApi(),
    });
    publishSelectionSurface({ surface: 'mailbox', state: state(true), api: createSelectionApi() });
    first();
    expect(get(activeSelectionStore)?.surface).toBe('mailbox');
    resetSelectionRegistry();
    expect(get(activeSelectionStore)).toBeNull();
  });

  test('selectionFor reaches one named surface, for the sidebar drops', () => {
    resetSelectionRegistry();
    const api: SelectionApi = { ...createSelectionApi(), run: () => {} };
    publishSelectionSurface({ surface: 'mailbox', state: state(false), api });
    // The mailbox's DROP targets act on the mailbox selection even while it is
    // dormant - that is why this lookup exists beside the reactive store.
    expect(selectionFor('mailbox')?.api).toBe(api);
    expect(selectionFor('addresses')).toBeNull();
    resetSelectionRegistry();
  });
});

describe('every list publishes through the one registry', () => {
  /** The four lists, and the surface each one publishes itself under. */
  const PUBLISHERS = [
    { file: 'src/ui/views/mailbox/MailboxView.svelte', surface: 'mailbox' },
    { file: 'src/ui/views/addresses/AddressesView.svelte', surface: 'addresses' },
    { file: 'src/ui/views/autofill/IdentitiesView.svelte', surface: 'identities' },
    { file: 'src/ui/views/autofill/SavedLoginsView.svelte', surface: 'logins' },
  ] as const;

  test('each list publishes its own surface through the registry', () => {
    for (const { file, surface } of PUBLISHERS) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      expect([file, source.includes("from '@/utils/ui/selection-registry.js'")]).toEqual([
        file,
        true,
      ]);
      // The surface id is a literal, so a renamed list cannot publish into a hole.
      expect([file, new RegExp(`surface:\\s*'${surface}'`).test(source)]).toEqual([file, true]);
      expect([file, /publishSelectionSurface\s*\(/.test(source)]).toEqual([file, true]);
    }
  });

  test('no list renders a selection strip of its own any more', () => {
    // The drift this replaces: each list carried its own strip markup (the
    // addresses list an always-visible Select row, the mailbox its own actions
    // strip), which in split view was clipped to the list pane. A list now
    // publishes FACTS and the shell renders the one strip - so a view that reads
    // the active surface, or that renders a strip component, is a regression.
    const stripComponents = ['ListSelectionBar', 'SelectionToolbar', 'MailboxSelectionBar'];
    for (const { file } of PUBLISHERS) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      expect([file, /activeSelectionStore/.test(source)]).toEqual([file, false]);
      const rendered = stripComponents.filter((name) => source.includes(`<${name}`));
      expect([file, rendered]).toEqual([file, []]);
    }
  });

  test('publishedSelections hands the keyboard layer every live list, to ASK them', () => {
    resetSelectionRegistry();
    expect(publishedSelections()).toEqual([]);
    const idle = { ...createListSelectionState(['delete']), active: false };
    const unregister = publishSelectionSurface({
      surface: 'addresses',
      state: idle,
      api: createSelectionApi(),
    });
    publishSelectionSurface({ surface: 'logins', state: { ...idle }, api: createSelectionApi() });
    // Both, active or not: "which list owns the focus" cannot be answered by
    // ordering, only by asking each one (`hasFocusedRow`).
    expect(
      publishedSelections()
        .map((entry) => entry.surface)
        .sort()
    ).toEqual(['addresses', 'logins']);
    unregister();
    expect(publishedSelections().map((entry) => entry.surface)).toEqual(['logins']);
    resetSelectionRegistry();
  });

  test('the keyboard target is the list on screen when nothing is selected', () => {
    resetSelectionRegistry();
    const idle = (active = false, count = 0) => ({
      ...createListSelectionState(['delete']),
      active,
      count,
    });
    // Nothing published → nothing to drive.
    expect(selectionKeyboardTarget()).toBeNull();

    // With no selection anywhere, the list that refreshed LAST is the one on
    // screen - this is what lets `X` start a selection at all, since an empty
    // selection means no surface is "active".
    publishSelectionSurface({ surface: 'addresses', state: idle(), api: createSelectionApi() });
    publishSelectionSurface({ surface: 'identities', state: idle(), api: createSelectionApi() });
    expect(selectionKeyboardTarget()?.surface).toBe('identities');

    // A live selection outranks every idle list, even one that refreshed after it.
    publishSelectionSurface({
      surface: 'mailbox',
      state: idle(true, 2),
      api: createSelectionApi(),
    });
    publishSelectionSurface({ surface: 'addresses', state: idle(), api: createSelectionApi() });
    expect(selectionKeyboardTarget()?.surface).toBe('mailbox');

    // Unmounting the active list hands the keys back to what is left.
    resetSelectionRegistry();
    expect(selectionKeyboardTarget()).toBeNull();
  });

  test('the published surface ids are exactly the four the union declares', () => {
    const contract = readFileSync(join(ROOT, 'src/utils/ui/selection-api.ts'), 'utf8');
    const union = /export type SelectionSurface =([^;]+);/.exec(contract)?.[1] ?? '';
    const declared = [...union.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(declared).toEqual(PUBLISHERS.map((p) => p.surface));
  });

  test('each list wires the keyboard verbs to its OWN row cursor', () => {
    // The "each list responds" proof: the shared layer routes a key to a list's
    // api, and this is what that api must do for the keystroke to reach a row -
    // the three verbs, the cursor helper, and the container the helper is given.
    const containers: Record<string, string> = {
      'src/ui/views/mailbox/MailboxView.svelte': 'listRootEl',
      'src/ui/views/addresses/AddressesView.svelte': 'listRootEl',
      'src/ui/views/autofill/IdentitiesView.svelte': 'identityListEl',
      'src/ui/views/autofill/SavedLoginsView.svelte': 'credentialsScrollEl',
    };
    for (const { file } of PUBLISHERS) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      const container = containers[file] as string;
      const missing = [
        'moveFocus:',
        'hasFocusedRow:',
        'focusedIsSelected:',
        'setFocusedSelected:',
      ].filter((verb) => !source.includes(verb));
      expect([file, missing]).toEqual([file, []]);
      // The virtual mailbox advances its logical list and renders the target
      // before focusing it; the other lists can move within their full DOM.
      if (file === 'src/ui/views/mailbox/MailboxView.svelte') {
        expect(source).toContain('moveFocus: moveMailboxCursor');
        expect(source).toContain('displayedEmails.findIndex');
        expect(source).toContain('virtualScrollTop = offset');
        expect(source).toContain('const estimateVirtualRowHeight = $derived.by(');
      } else expect([file, source.includes(`moveRowCursor(${container}`)]).toEqual([file, true]);
      expect([file, source.includes(`focusedRowId(${container})`)]).toEqual([file, true]);
      expect([file, source.includes(`bind:this={${container}}`)]).toEqual([file, true]);
      // Rows expose their stable id and a primary control. Its browser Tab
      // reachability is verified by keyboard-accessibility.e2e.ts; unrelated
      // attribute order is not part of this contract.
      expect([file, /data-selectable-row=\{[^}]+\}/.test(source)]).toEqual([file, true]);
      expect([file, source.includes('data-row-primary')]).toEqual([file, true]);
    }
  });

  test('the shell mounts the keyboard layer once, and the strip is its own surface', () => {
    const shell = readFileSync(join(ROOT, 'src/ui/blocks/layout/AppShell.svelte'), 'utf8');
    // Exactly one listener: a second would dispatch every key twice.
    expect(shell.match(/useSelectionKeyboard\(\)/g)?.length).toBe(1);
    // The strip marks itself so the layer can tell "focus is on the selection's
    // own controls" from "focus is somewhere else on the page".
    const strip = readFileSync(join(ROOT, 'src/ui/blocks/mail/ListSelectionBar.svelte'), 'utf8');
    expect(strip).toContain('data-selection-strip');
    const hook = readFileSync(
      join(ROOT, 'src/ui/blocks/layout/use-selection-keyboard.svelte.ts'),
      'utf8'
    );
    expect(hook).toContain('[data-selection-strip]');
  });

  test('the strip and shell read the active surface, and the strip renders once', () => {
    const readers: string[] = [];
    // `Bun.Glob` yields OS-separated paths; the assertions below are repo-relative
    // POSIX like every other path in this file.
    const sources = new Bun.Glob('src/**/*.{svelte,ts}').scanSync({ cwd: ROOT });
    for (const file of sources) {
      const relative = file.replace(/\\/g, '/');
      if (readFileSync(join(ROOT, file), 'utf8').includes('activeSelectionStore')) {
        readers.push(relative);
      }
    }
    expect(readers.sort()).toEqual([
      'src/ui/blocks/layout/AppLayout.svelte',
      'src/ui/blocks/layout/AppShell.svelte',
      'src/ui/blocks/mail/ListSelectionBar.svelte',
      'src/utils/ui/selection-registry.ts',
    ]);
    const shell = readFileSync(join(ROOT, 'src/ui/blocks/layout/AppShell.svelte'), 'utf8');
    expect(shell.match(/<ListSelectionBar/g)?.length).toBe(1);
    expect(shell).toContain('!selectionReplacesFooter');
    expect(shell).toContain("selectionReplacesFooter ? '0px'");
  });
});

describe('nothing else may re-declare the contract', () => {
  test('the contract and registry modules are the only declarations', () => {
    const contractModules = ['src/utils/ui/selection-api.ts', 'src/utils/ui/selection-registry.ts'];
    // Every consumer goes through those two files: no layout component may carry
    // a private copy of the shape (the drift that produced this module), and no
    // view may pass a selection api as a prop (the registry replaced the four
    // layers of `bind:` that could not reach a list rendered by another chain).
    const suspects = [
      'src/ui/blocks/layout/AppShell.svelte',
      'src/ui/blocks/layout/AppLayout.svelte',
      'src/ui/blocks/layout/MailboxSplitView.svelte',
      'src/ui/blocks/layout/AddressesSplitView.svelte',
      'src/ui/views/mailbox/MailboxView.svelte',
      'src/ui/blocks/mail/ListSelectionBar.svelte',
    ];
    for (const file of suspects) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      // A re-DECLARATION (a type alias or interface with a body), not the import
      // of the contract: `import { type SelectionApi }` is how a consumer names it.
      const redeclares =
        /(?:^|\n)\s*(?:export\s+)?(?:type|interface)\s+SelectionApi\s*(?:=\s*)?\{/.test(source);
      expect([file, redeclares]).toEqual([file, false]);
      expect([file, /\bSelectionApi\s*=\s*\$bindable/.test(source)]).toEqual([file, false]);
      expect([file, /createMailboxSelectionState|DEFAULT_SELECTION_API/.test(source)]).toEqual([
        file,
        false,
      ]);
      // …and each one names the contract module wherever it touches a selection.
      if (/selectionApi|\bapi=\{/.test(source)) {
        expect(source).toContain('selection-api.js');
      }
    }
    for (const module of contractModules) {
      expect(readFileSync(join(ROOT, module), 'utf8').length).toBeGreaterThan(200);
    }
  });
});
