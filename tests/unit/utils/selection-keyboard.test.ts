/**
 * The selection keys, resolved and dispatched.
 *
 * Multi-select used to be pointer-only, so these keys had nothing shared to act
 * on. Now every list publishes a `SelectionApi`, and the map that turns a
 * keystroke into one of its verbs is the whole of the keyboard's selection
 * support - adding a list adds no key handling, so this file is where that
 * support is pinned. The cases that matter are the ones a naive implementation
 * gets wrong:
 *
 *   - a Ctrl/Cmd/Alt chord is never ours (the user-rebindable shortcuts and the
 *     browser own those, and stealing Ctrl+A to select rows would break
 *     select-all-in-page);
 *   - Enter with nothing selected is NOT ours (it belongs to whatever the row
 *     has focused - opening a message, an identity's editor);
 *   - Shift+Arrow EXTENDS, which must never untick a row it moves through, and
 *     that is why the contract's write is `setFocusedSelected(boolean)` rather
 *     than a toggle.
 */
import { describe, expect, test } from 'bun:test';
import {
  createListSelectionState,
  createSelectionApi,
  type SelectionActionId,
  type SelectionApi,
} from '@/utils/ui/selection-api.js';
import {
  chooseKeyboardTarget,
  dispatchSelectionKey,
  resolveSelectionKey,
} from '@/utils/ui/selection-keyboard.js';
import type { PublishedSelection } from '@/utils/ui/selection-registry.js';

/** A keyboard event, as the resolver sees it (no DOM needed). */
function key(
  name: string,
  modifiers: Partial<{
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
  }> = {}
) {
  return {
    key: name,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...modifiers,
  };
}

describe('resolveSelectionKey claims the selection keys', () => {
  test('arrows move the cursor, Shift+arrows extend it', () => {
    expect(resolveSelectionKey(key('ArrowDown'), { selectionActive: false })).toEqual({
      kind: 'moveFocus',
      delta: 1,
    });
    expect(resolveSelectionKey(key('ArrowUp'), { selectionActive: false })).toEqual({
      kind: 'moveFocus',
      delta: -1,
    });
    expect(
      resolveSelectionKey(key('ArrowDown', { shiftKey: true }), { selectionActive: false })
    ).toEqual({ kind: 'extendFocus', delta: 1 });
    expect(
      resolveSelectionKey(key('ArrowUp', { shiftKey: true }), { selectionActive: false })
    ).toEqual({
      kind: 'extendFocus',
      delta: -1,
    });
  });

  test('X ticks the row under the cursor, in either case', () => {
    expect(resolveSelectionKey(key('x'), { selectionActive: false })).toEqual({
      kind: 'toggleFocused',
    });
    expect(resolveSelectionKey(key('X'), { selectionActive: true })).toEqual({
      kind: 'toggleFocused',
    });
    // Shift+X is not a second meaning - unclaimed rather than guessed.
    expect(resolveSelectionKey(key('X', { shiftKey: true }), { selectionActive: true })).toBeNull();
  });

  test('Enter runs the primary action ONLY once something is selected', () => {
    // Unclaimed with an empty selection: Enter belongs to the row under it.
    expect(resolveSelectionKey(key('Enter'), { selectionActive: false })).toBeNull();
    expect(resolveSelectionKey(key('Enter'), { selectionActive: true })).toEqual({
      kind: 'runPrimary',
    });
  });

  test('every chord is left alone', () => {
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey'] as const) {
      expect(
        resolveSelectionKey(key('x', { [modifier]: true }), { selectionActive: true })
      ).toBeNull();
      expect(
        resolveSelectionKey(key('ArrowDown', { [modifier]: true }), { selectionActive: true })
      ).toBeNull();
      expect(
        resolveSelectionKey(key('Enter', { [modifier]: true }), { selectionActive: true })
      ).toBeNull();
    }
  });

  test('unrelated keys are not claimed', () => {
    for (const name of ['j', 'k', '/', '?', 'a', 'Escape', 'Tab', ' ']) {
      expect(resolveSelectionKey(key(name), { selectionActive: true })).toBeNull();
    }
  });
});

describe('dispatchSelectionKey runs the command against the list', () => {
  /** An api that records what the keyboard asked of it. */
  function spyApi(initiallySelected = false) {
    const calls: string[] = [];
    const api: SelectionApi = {
      ...createSelectionApi(),
      moveFocus: (delta) => {
        calls.push(`moveFocus:${delta}`);
      },
      focusedIsSelected: () => initiallySelected,
      setFocusedSelected: (selected) => {
        calls.push(`set:${selected}`);
      },
      run: (action) => {
        calls.push(`run:${action}`);
      },
    };
    return { api, calls };
  }

  test('X flips the row under the cursor, whichever way it is', () => {
    const off = spyApi(false);
    dispatchSelectionKey({ kind: 'toggleFocused' }, off.api, ['delete']);
    expect(off.calls).toEqual(['set:true']);

    const on = spyApi(true);
    dispatchSelectionKey({ kind: 'toggleFocused' }, on.api, ['delete']);
    expect(on.calls).toEqual(['set:false']);
  });

  test('an arrow moves the cursor and touches no tick', () => {
    const { api, calls } = spyApi();
    dispatchSelectionKey({ kind: 'moveFocus', delta: -1 }, api, ['delete']);
    expect(calls).toEqual(['moveFocus:-1']);
  });

  test('Shift+Arrow ticks what it lands on - even a row that was already ticked', () => {
    // The case a toggle would get wrong: extending THROUGH a ticked row must
    // leave it ticked. Move first, then set(true) - never flip.
    const through = spyApi(true);
    dispatchSelectionKey({ kind: 'extendFocus', delta: 1 }, through.api, ['delete']);
    expect(through.calls).toEqual(['moveFocus:1', 'set:true']);

    const fresh = spyApi(false);
    dispatchSelectionKey({ kind: 'extendFocus', delta: 1 }, fresh.api, ['delete']);
    expect(fresh.calls).toEqual(['moveFocus:1', 'set:true']);
  });

  test("Enter runs the list's OWN first action, so the keyboard and the strip agree", () => {
    const { api, calls } = spyApi(true);
    const actions: SelectionActionId[] = ['unarchive', 'delete', 'tag'];
    dispatchSelectionKey({ kind: 'runPrimary' }, api, actions);
    expect(calls).toEqual(['run:unarchive']);
  });

  test('range selection waits for a virtual row to render and receive focus', async () => {
    let finishMove: (() => void) | undefined;
    const calls: string[] = [];
    const api = createSelectionApi();
    api.moveFocus = () =>
      new Promise<void>((resolve) => {
        finishMove = resolve;
      });
    api.setFocusedSelected = () => {
      calls.push('select');
    };
    dispatchSelectionKey({ kind: 'extendFocus', delta: 1 }, api, ['archive']);
    expect(calls).toEqual([]);
    finishMove?.();
    await Promise.resolve();
    expect(calls).toEqual(['select']);
  });

  test('a list with no actions advertises nothing for Enter to run', () => {
    const { api, calls } = spyApi(true);
    dispatchSelectionKey({ kind: 'runPrimary' }, api, []);
    expect(calls).toEqual([]);
  });
});

describe('chooseKeyboardTarget asks the lists, and guesses nothing', () => {
  function entry(surface: PublishedSelection['surface'], holdsFocus: boolean, active = false) {
    return {
      surface,
      state: { ...createListSelectionState(['delete']), active },
      api: { ...createSelectionApi(), hasFocusedRow: () => holdsFocus },
    } satisfies PublishedSelection;
  }

  test('the list whose own row cursor holds focus wins, whatever the order', () => {
    const other = entry('mailbox', false);
    const mine = entry('addresses', true);
    // Ordering is a guess: a second list being mounted must not answer for the
    // list the user is standing in.
    expect(chooseKeyboardTarget([other, mine])?.surface).toBe('addresses');
    expect(chooseKeyboardTarget([mine, other])?.surface).toBe('addresses');
  });

  test('with no row focused the fallback answers, and otherwise nothing does', () => {
    const idle = entry('identities', false);
    const fallback = entry('mailbox', false, true);
    expect(chooseKeyboardTarget([idle], { fallback })?.surface).toBe('mailbox');
    // Focus outside every list AND outside the strip: the keys belong to nobody.
    expect(chooseKeyboardTarget([idle], { fallback: null })).toBeNull();
    expect(chooseKeyboardTarget([])).toBeNull();
  });
});
