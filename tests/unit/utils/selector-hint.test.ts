/**
 * The two extractions this suite pins:
 *
 *  1. `buildSelectorHint` lives in ONE dependency-free leaf module
 *     (`utils/dom/selector-hint.ts`). It used to be duplicated byte-for-byte in
 *     `features/intelligence/field-maps.ts` and `utils/content/content-bg-bridge.ts`
 *     (the second copy inlined "to avoid pulling the storage module into the
 *     content bundle"). The two graphs now share one implementation, so this
 *     test asserts BOTH re-export the same function object - a future edit that
 *     reintroduces a private copy fails here rather than drifting silently.
 *
 *  2. `subscribeBottomSheetPreference` is the ONE subscription behind every
 *     dialog's bottom-sheet/dialog switch, replacing six hand-rolled copies.
 *     It is plain `.ts` on purpose: the component-test harness compiles
 *     `.svelte` files but loads plain modules directly, so a `.svelte.ts` hook
 *     would throw `rune_outside_svelte` there.
 */
import { afterAll, describe, expect, mock, test } from 'bun:test';
import { JSDOM } from 'jsdom';

// The browser mock must be registered BEFORE any module that imports
// `wxt/browser` is loaded - field-maps, the content bridge and the
// bottom-sheet helper all do.
let listener: ((changes: Record<string, { newValue?: unknown }>, area: string) => void) | null =
  null;
const addListener = mock((fn: typeof listener) => {
  listener = fn;
});
const removeListener = mock(() => {});
mock.module('wxt/browser', () => ({
  browser: {
    storage: {
      local: { get: async () => ({}), set: async () => {} },
      onChanged: { addListener, removeListener },
    },
    runtime: { id: 'test-ext' },
  },
}));

const { buildSelectorHint } = await import('@/utils/dom/selector-hint.js');
const { subscribeBottomSheetPreference, DIALOG_BOTTOM_SHEET_KEY } = await import(
  '@/utils/ui/bottom-sheet-preference.js'
);
const viaBridge = await import('@/utils/content/content-bg-bridge.js');
const viaFieldMaps = await import('@/features/intelligence/field-maps.js');

afterAll(() => {
  mock.restore();
});

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'https://example.test/',
});
const w = dom.window;
Object.assign(globalThis, {
  window: w,
  document: w.document,
  Element: w.Element,
  HTMLElement: w.HTMLElement,
  CSS: w.CSS,
});

function branchWith(html: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host.firstElementChild as Element;
}

describe('buildSelectorHint', () => {
  test('prefers id, then name, then autocomplete, then a short aria-label', () => {
    expect(buildSelectorHint(branchWith('<input id="email" name="user">'))).toBe('input#email');
    expect(buildSelectorHint(branchWith('<input name="user">'))).toBe('input[name="user"]');
    expect(buildSelectorHint(branchWith('<input autocomplete="email">'))).toBe(
      'input[autocomplete="email"]'
    );
    // CSS.escape escapes the space, so the hint is `input[aria-label="Work\ email"]`.
    expect(buildSelectorHint(branchWith('<input aria-label="Work email">'))).toBe(
      'input[aria-label="Work\\ email"]'
    );
  });

  test('ignores an over-long aria-label and falls back to a form path, then the tag', () => {
    const long = 'x'.repeat(41);
    expect(buildSelectorHint(branchWith(`<input aria-label="${long}">`))).toBe('input');

    const host = document.createElement('div');
    host.innerHTML = '<form><input><input></form>';
    const form = host.querySelector('form') as HTMLFormElement;
    expect(buildSelectorHint(form.querySelectorAll('input')[1])).toBe('form input:nth-of-type(2)');
  });

  test('escapes selector-significant characters so the hint still targets the element', () => {
    const host = document.createElement('div');
    const el = branchWith('<input id="a.b:c">');
    host.appendChild(el);
    expect(host.querySelector(buildSelectorHint(el))).toBe(el);
  });

  test('the field-map layer and the content bridge share ONE implementation', () => {
    expect(viaBridge.buildSelectorHint).toBe(buildSelectorHint);
    expect(viaFieldMaps.buildSelectorHint).toBe(buildSelectorHint);
  });
});

describe('subscribeBottomSheetPreference', () => {
  test('names the shared storage key', () => {
    expect(DIALOG_BOTTOM_SHEET_KEY).toBe('dialogPresentationBottomSheet');
  });

  test('applies later changes, ignores the wrong area/key, then tears down', () => {
    const baselineAdds = addListener.mock.calls.length;
    const seen: boolean[] = [];
    const teardown = subscribeBottomSheetPreference((value) => seen.push(value));

    expect(addListener.mock.calls.length).toBe(baselineAdds + 1);

    const registered = listener;
    if (typeof registered !== 'function') throw new Error('the helper registered no listener');

    // A change in another extension surface re-applies.
    registered({ dialogPresentationBottomSheet: { newValue: true } }, 'local');
    expect(seen[seen.length - 1]).toBe(true);

    // The wrong area, or an unrelated key, is ignored.
    const before = seen.length;
    registered({ dialogPresentationBottomSheet: { newValue: false } }, 'sync');
    registered({ otherKey: { newValue: true } }, 'local');
    expect(seen.length).toBe(before);

    teardown();
    expect(removeListener).toHaveBeenCalledTimes(1);
  });
});
