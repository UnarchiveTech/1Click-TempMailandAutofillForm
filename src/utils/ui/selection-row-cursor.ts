/**
 * The row cursor: which row the keyboard is on, carried by the DOM.
 *
 * Multi-select lost its always-visible Select row, so the keyboard has to be
 * able to reach a list's rows and move between them. Doing that needs a notion
 * of "where the keyboard is" - and the cheapest honest one is `document`
 * focus on the row or its primary control:
 *
 *   - `data-selectable-row="<id>"` marks a row as selectable (and gives the
 *     keyboard layer the row's id without it knowing any list's shape), and
 *   - `tabindex="-1"` makes it programmatically focusable - `-1` and not `0`, so
 *     a list of 500 rows does not become 500 tab stops.
 *
 * The alternative - a `focusedId` in every list's state - buys a second copy of
 * a fact the platform already tracks, and with it the drift the row and
 * selection contracts were written to remove: the highlight and the cursor would
 * be two variables that can disagree instead of one. What focus also gets for
 * free is the two things a hand-rolled cursor must re-implement: `:focus-visible`
 * paints from the same focus state the browser manages, and focusing scrolls the
 * row into view, virtualization included.
 *
 * This helper moves DOM-backed lists. Virtual lists implement their own logical
 * moveFocus and render the destination before focusing its primary control.
 */

/** One convention, read by the keyboard layer and by every list's rows. */
export const SELECTABLE_ROW_ATTR = 'data-selectable-row';
export const SELECTABLE_ROW_SELECTOR = `[${SELECTABLE_ROW_ATTR}]`;

/** The selectable rows inside one list root, in DOM (i.e. visual) order. */
export function selectableRows(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(SELECTABLE_ROW_SELECTOR));
}

/**
 * The row the keyboard is on, or null.
 *
 * `container` is optional and only ever narrows the answer: without it the
 * caller is asking "is a row focused anywhere", which is what the shell's
 * keyboard layer needs before it will touch a keystroke.
 */
export function focusedRow(container: HTMLElement | null = null): HTMLElement | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  // Tab enters a row through its content or controls. Positional arrows/X use
  // that row; the keyboard router leaves native activation and editing alone.
  const row = active.closest<HTMLElement>(SELECTABLE_ROW_SELECTOR);
  if (!row || (container && !container.contains(row))) return null;
  return row;
}

/** The id a row carries, or null when it (or the marker) is missing. */
export function selectableRowId(row: HTMLElement | null): string | null {
  return row?.getAttribute(SELECTABLE_ROW_ATTR) || null;
}

/** The id under the cursor, without moving it. */
export function focusedRowId(container: HTMLElement | null): string | null {
  return selectableRowId(focusedRow(container));
}

/**
 * Move the cursor by `delta` and return the id it landed on (null when the list
 * has no rows). With no cursor yet the move ENTERS the list - at the first row
 * going down, at the last going up - so the first arrow press after clicking the
 * list's chrome still lands somewhere predictable.
 */
export function moveRowCursor(container: HTMLElement | null, delta: -1 | 1): string | null {
  const rows = selectableRows(container);
  if (rows.length === 0) return null;

  const current = focusedRow(container);
  const index = current ? rows.indexOf(current) : -1;
  // Entering from nothing counts as arriving from the far edge, so the first
  // press lands inside the list instead of a step short of it.
  const from = index === -1 ? (delta === 1 ? -1 : rows.length) : index;
  const next = Math.min(rows.length - 1, Math.max(0, from + delta));

  const row = rows[next];
  (row?.querySelector<HTMLElement>('[data-row-primary]') ?? row)?.focus();
  return selectableRowId(row ?? null);
}
