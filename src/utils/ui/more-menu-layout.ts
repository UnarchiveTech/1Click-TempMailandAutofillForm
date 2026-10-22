/**
 * More-submenu arrangement (rows).
 *
 * The More menu used to be one flat `flex-wrap` box: the browser decided where
 * rows broke, so a row of exactly one item appeared whenever the widths landed
 * that way, and nothing kept the rows balanced as pages were added. This module
 * owns the row math instead - pure in, rows out, no DOM - so it is unit
 * testable and the component only renders the answer:
 *
 *  1. **Fewest rows that fit.** Items pack greedily in display order - each row
 *     takes the longest fitting prefix - so the earlier rows fill first
 *     (top-heavy by construction) and one row is used whenever everything
 *     fits it. With the order fixed, no layout uses fewer rows: any feasible
 *     first row is a prefix the greedy row contains.
 *  2. **No orphan row by construction.** A row of exactly one item only ever
 *     appears when that item fits in NEITHER neighbour row: it opened its row
 *     because it did not fit beside the previous one, and it stayed single
 *     because the next item did not fit beside it (a row only ever grows
 *     after that). There is deliberately no merge pass - it would be dead
 *     code. A wide item nobody can share with is a full row, not an aesthetic
 *     failure, and the menu is wide enough (island + FAB span) that this is
 *     the rarest of rare cases.
 *  3. **Fix-only auto-arrange.** With the setting on, the canonical order is
 *     kept whenever it already yields the fewest rows; only when another order
 *     fits in fewer rows is a single swap taken (the first one that saves a row,
 *     scanning left to right, so the canonical order wins every tie). The pill
 *     and the primary↔More boundary are never touched - this reorders the
 *     submenu only.
 *
 * Sizes are NOT fitted here: the menu inherits the pill's fitted font and side
 * padding (one size source), and each item's width is measured at that size by
 * the caller, with the menu's own always-visible icon chrome added.
 *
 * It also owns the OPEN-state bookkeeping, so the component wires answers rather
 * than deriving them inline: `moreClickIntent` (what a click on the More button
 * means, given the gesture and whether it came from the keyboard) and
 * `moreSnapshotVerdict` (whether the rows frozen at open still describe the live
 * membership).
 */

/** Item widths in display order, measured at the menu's (pill-inherited) font. */
export type MoreMenuSplitInput = {
  itemWidthsPx: number[];
  /** Usable row width: the menu content box minus its own padding. */
  contentWidthPx: number;
  /** Inter-item gap inside a row. */
  gapPx: number;
};

/** A row's laid-out width: items plus the gaps between them (adjacent items). */
export function moreRowWidthPx(rowWidthsPx: number[], gapPx: number): number {
  if (rowWidthsPx.length === 0) return 0;
  return rowWidthsPx.reduce((sum, w) => sum + w, 0) + gapPx * (rowWidthsPx.length - 1);
}

/**
 * Split widths into the fewest rows that fit.
 *
 * Returns rows of indices into `itemWidthsPx`. A row that holds exactly one
 * item is full (it fits in no neighbour row) - never an orphan. See the
 * module header for why no merge pass follows: it could never fire.
 */
export function splitMoreRows(input: MoreMenuSplitInput): number[][] {
  const { itemWidthsPx, contentWidthPx, gapPx } = input;
  const rows: number[][] = [];
  // Fewest rows: fill each row until the next item stops fitting. Earlier rows
  // fill first, so even widths split balanced and top-heavy (3+2, never 2+3).
  for (let i = 0; i < itemWidthsPx.length; i += 1) {
    const last = rows[rows.length - 1];
    const width = itemWidthsPx[i];
    if (
      last &&
      moreRowWidthPx(
        last.map((idx) => itemWidthsPx[idx]),
        gapPx
      ) +
        gapPx +
        width <=
        contentWidthPx
    ) {
      last.push(i);
    } else {
      rows.push([i]);
    }
  }
  return rows;
}

/**
 * Order the submenu items for the fewest rows.
 *
 * `false` (or ≤2 items, or more than 8) returns the input untouched: the pill
 * order is never violated for looks, and the swap search stays bounded. When
 * on, the canonical order wins every tie - a reorder only happens when another
 * order fits in strictly fewer rows.
 */
export function arrangeMoreItems<T>(
  items: T[],
  itemWidthsPx: number[],
  contentWidthPx: number,
  gapPx: number,
  autoArrange: boolean
): T[] {
  const n = items.length;
  if (!autoArrange || n <= 2 || n > 8 || itemWidthsPx.length !== n) return items;
  const base = items.map((_, i) => i);
  const rowCount = (order: number[]): number =>
    splitMoreRows({
      itemWidthsPx: order.map((i) => itemWidthsPx[i]),
      contentWidthPx,
      gapPx,
    }).length;
  let best = base;
  let bestRows = rowCount(base);
  // One pairwise swap is the cheapest visible change; anything needing more than
  // that is a width problem for the row split (or the shrink belt), not for the
  // order. Every candidate IS a single swap, so every candidate displaces the
  // same two items - there is no cheaper arrangement to prefer, and the strict
  // `rows < bestRows` is the whole rule: on a tie the candidate reached first
  // (lowest i, then lowest j) wins, which is what keeps the canonical order
  // whenever it already needs the fewest rows.
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const candidate = [...base];
      candidate[i] = base[j];
      candidate[j] = base[i];
      const rows = rowCount(candidate);
      if (rows < bestRows) {
        best = candidate;
        bestRows = rows;
      }
    }
  }
  return best.map((i) => items[i]);
}

/**
 * Normalize the persisted auto-arrange preference. ON by default: an unset,
 * malformed, or truthy value arranges; only an explicit `false` (or its
 * stored string/zero spellings) turns it off.
 */
export function normalizeAutoArrangeMore(raw: unknown): boolean {
  if (raw === false || raw === 'false' || raw === 0) return false;
  return true;
}

/**
 * How a click on the More button should be interpreted.
 *
 * `open`   - the menu was closed: open it (and freeze the rows with it).
 * `close`  - a real toggle: the gesture that produced this click began with the
 *            menu already open (a mouse click, or a second tap).
 * `ignore` - the click belongs to the gesture that JUST opened the menu.
 *
 * The `ignore` case is what a touch tap needs: a tap delivers an emulated
 * `mouseenter` before its click, that hover is the path that opens the menu, and
 * toggling on the same tap's click flashed the menu shut again - More was
 * unusable on touch. A keyboard activation reports `detail === 0` and has no
 * pointer gesture at all, so it is always a plain toggle.
 */
export type MoreClickIntent = 'open' | 'close' | 'ignore';

export function moreClickIntent(state: {
  /** Is the menu open right now? */
  open: boolean;
  /** Did the activation come from the keyboard (`detail === 0`)? */
  keyboard: boolean;
  /** Was the menu already open when this pointer gesture began? */
  wasOpenAtPointerDown: boolean;
}): MoreClickIntent {
  if (!state.open) return 'open';
  if (state.keyboard) return 'close';
  return state.wasOpenAtPointerDown ? 'close' : 'ignore';
}

/** What an OPEN More menu must do when its live item list is re-read. */
export type MoreSnapshotVerdict = 'keep' | 'refreeze' | 'close';

/**
 * Does the frozen More snapshot still describe the LIVE membership?
 *
 * The rows are arranged once, when the menu opens, so an item never moves under
 * the pointer while the user is aiming at it. Membership is not cosmetic
 * though: the primary/More split moves items as the shell resizes, and at the
 * widest stage More is EMPTY - so the `{#if moreOpen && moreItems.length > 0}`
 * that hides an empty menu leaves `moreOpen` true, and narrowing the shell
 * again used to pop the menu back open with rows arranged for a membership that
 * no longer existed (including items that are now pills).
 *
 *   - `close`    - More is empty: nothing to show now, and nothing to come back to.
 *   - `refreeze` - the membership changed: re-arrange the rows for the live items.
 *   - `keep`     - the same items as when the menu opened.
 *
 * The comparison is a SET match, not a sequence one, and that matters:
 * `arrangeMoreItems` is allowed to reorder the rows for fewer lines, so
 * comparing its own output against the input sequence would read as "a different
 * membership" on every pass and re-freeze forever.
 */
export function moreSnapshotVerdict(
  frozenViews: readonly string[],
  liveViews: readonly string[]
): MoreSnapshotVerdict {
  if (liveViews.length === 0) return 'close';
  if (frozenViews.length !== liveViews.length) return 'refreeze';
  const live = new Set(liveViews);
  return frozenViews.every((view) => live.has(view)) ? 'keep' : 'refreeze';
}
