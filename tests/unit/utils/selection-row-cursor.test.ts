/**
 * The row cursor, against a real DOM.
 *
 * The cursor is `document.activeElement` on a `data-selectable-row` element, so
 * the cases worth pinning are the ones that make DOM-as-cursor honest rather
 * than merely convenient: entering a list from nothing lands INSIDE it, movement
 * clamps instead of wrapping or escaping, and a focused element that is not a row
 * (a row's own copy button, an input) is not mistaken for the cursor - which is
 * exactly the accident that would make `X` tick the wrong row.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import {
  focusedRow,
  focusedRowId,
  moveRowCursor,
  SELECTABLE_ROW_ATTR,
  selectableRows,
} from '@/utils/ui/selection-row-cursor.js';

const { setupDom, cleanupDom } = await import('../helpers/svelte-harness.js');
setupDom();

/** A list root holding one marked row per id, in order. */
function listWith(ids: string[]): HTMLElement {
  const container = document.createElement('div');
  for (const id of ids) {
    const row = document.createElement('div');
    row.setAttribute(SELECTABLE_ROW_ATTR, id);
    row.tabIndex = -1;
    container.appendChild(row);
  }
  document.body.appendChild(container);
  return container;
}

beforeEach(() => {
  cleanupDom();
  (document.activeElement as HTMLElement | null)?.blur?.();
});

describe('the row marker is one convention', () => {
  test('the queried attribute is the one the lists write in markup', () => {
    // Views cannot use the constant in a template (Svelte has no dynamic
    // attribute NAMES), so they spell `data-selectable-row` literally. This is
    // the assertion that keeps the two spellings from drifting apart.
    expect(SELECTABLE_ROW_ATTR).toBe('data-selectable-row');
  });

  test('only marked rows are rows, in DOM order', () => {
    const list = listWith(['a', 'b', 'c']);
    const unmarked = document.createElement('div');
    list.appendChild(unmarked);
    expect(selectableRows(list).map((r) => r.getAttribute(SELECTABLE_ROW_ATTR))).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(selectableRows(null)).toEqual([]);
  });
});

describe('moveRowCursor', () => {
  test('entering from no cursor lands inside the list, not one step short of it', () => {
    const list = listWith(['a', 'b', 'c']);
    expect(moveRowCursor(list, 1)).toBe('a');
    (document.activeElement as HTMLElement).blur();
    expect(moveRowCursor(list, -1)).toBe('c');
  });

  test('a step moves one row and reports where it landed', () => {
    const list = listWith(['a', 'b', 'c']);
    moveRowCursor(list, 1);
    expect(moveRowCursor(list, 1)).toBe('b');
    expect(focusedRowId(list)).toBe('b');
    expect(moveRowCursor(list, -1)).toBe('a');
  });

  test('movement clamps at both ends rather than wrapping', () => {
    const list = listWith(['a', 'b']);
    moveRowCursor(list, 1);
    expect(moveRowCursor(list, -1)).toBe('a');
    expect(moveRowCursor(list, -1)).toBe('a');
    moveRowCursor(list, 1);
    expect(moveRowCursor(list, 1)).toBe('b');
    expect(moveRowCursor(list, 1)).toBe('b');
  });

  test('an empty list has nowhere to move and says so', () => {
    expect(moveRowCursor(listWith([]), 1)).toBeNull();
    expect(moveRowCursor(null, 1)).toBeNull();
  });
});

describe('focusedRow', () => {
  test('reads the row the keyboard is on, and its id', () => {
    const list = listWith(['a', 'b']);
    moveRowCursor(list, 1);
    const rows = selectableRows(list);
    expect(focusedRow(list)).toBe(rows[0] as HTMLElement);
    expect(focusedRowId(list)).toBe('a');
    expect(focusedRowId(listWith(['x']))).toBeNull();
  });

  test('Tab into a row control gives arrows a row cursor', () => {
    const list = listWith(['a']);
    const row = selectableRows(list)[0] as HTMLElement;
    const inner = document.createElement('button');
    row.appendChild(inner);
    inner.focus();
    expect(focusedRow(list)).toBe(row);
    expect(focusedRowId(list)).toBe('a');
  });

  test('movement enters the next row through its native primary control', () => {
    const list = listWith(['a', 'b']);
    const rows = selectableRows(list);
    const primary = document.createElement('button');
    primary.setAttribute('data-row-primary', '');
    rows[1].appendChild(primary);
    rows[0].focus();
    expect(moveRowCursor(list, 1)).toBe('b');
    expect(document.activeElement).toBe(primary);
  });

  test('a focused row outside the given container does not answer for it', () => {
    const outside = listWith(['z']);
    const asked = listWith(['a']);
    moveRowCursor(outside, 1);
    expect(focusedRow(outside)).not.toBeNull();
    expect(focusedRow(asked)).toBeNull();
    expect(focusedRowId(asked)).toBeNull();
  });
});
