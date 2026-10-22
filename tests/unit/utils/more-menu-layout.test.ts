import { describe, expect, test } from 'bun:test';

import {
  arrangeMoreItems,
  moreClickIntent,
  moreRowWidthPx,
  moreSnapshotVerdict,
  normalizeAutoArrangeMore,
  splitMoreRows,
} from '@/utils/ui/more-menu-layout.js';

describe('moreRowWidthPx', () => {
  test('empty row takes no width', () => {
    expect(moreRowWidthPx([], 4)).toBe(0);
  });

  test('single item has no gap', () => {
    expect(moreRowWidthPx([50], 4)).toBe(50);
  });

  test('gaps sit between adjacent items only', () => {
    expect(moreRowWidthPx([40, 40, 40], 4)).toBe(128);
  });
});

describe('splitMoreRows', () => {
  test('no items, no rows', () => {
    expect(splitMoreRows({ itemWidthsPx: [], contentWidthPx: 300, gapPx: 4 })).toEqual([]);
  });

  test('everything fitting shares one row', () => {
    expect(
      splitMoreRows({ itemWidthsPx: [40, 40, 40, 40], contentWidthPx: 300, gapPx: 4 })
    ).toEqual([[0, 1, 2, 3]]);
  });

  test('even widths split balanced and top-heavy', () => {
    // 5 x 40px in 90px: greedy packs 2+2+1 and the trailing single fits in no
    // neighbour row (84+4+40 > 90), so it stays - a full row, not an orphan.
    const rows = splitMoreRows({
      itemWidthsPx: [40, 40, 40, 40, 40],
      contentWidthPx: 90,
      gapPx: 4,
    });
    expect(rows).toEqual([[0, 1], [2, 3], [4]]);
  });

  test('each row takes the longest fitting prefix', () => {
    // [50,50] fills 104px; the third 50 cannot join (158 > 140) but the 30
    // can join THAT row (138 <= 140) - later rows may hold more than earlier
    // ones when the widths allow it; order is what is preserved, not counts.
    const rows = splitMoreRows({
      itemWidthsPx: [50, 50, 50, 50, 30],
      contentWidthPx: 140,
      gapPx: 4,
    });
    expect(rows).toEqual([
      [0, 1],
      [2, 3, 4],
    ]);
  });

  test('a leftover single is full, never an orphan', () => {
    // 5 x 40px in 90px packs 2+2+1 and no rebalance fits: any row of three
    // needs 128px. The single fits in no neighbour row, so it stands.
    const widths = [40, 40, 40, 40, 40];
    const rows = splitMoreRows({ itemWidthsPx: widths, contentWidthPx: 90, gapPx: 4 });
    expect(rows).toEqual([[0, 1], [2, 3], [4]]);
    const prevWidth = moreRowWidthPx([widths[2], widths[3]], 4);
    expect(prevWidth + 4 + widths[4] > 90).toBe(true);
  });

  test('a single item wider than the row keeps its own row', () => {
    const rows = splitMoreRows({ itemWidthsPx: [400, 40], contentWidthPx: 300, gapPx: 4 });
    expect(rows).toEqual([[0], [1]]);
  });

  test('no row is an unmerged orphan, across many shapes', () => {
    // Deterministic PRNG - the property must hold for every shape, not one.
    let seed = 42;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    for (let round = 0; round < 200; round += 1) {
      const n = 1 + Math.floor(rand() * 8);
      const widths = Array.from({ length: n }, () => 20 + Math.floor(rand() * 100));
      const content = 100 + Math.floor(rand() * 220);
      const gap = 4;
      const rows = splitMoreRows({ itemWidthsPx: widths, contentWidthPx: content, gapPx: gap });
      // Every index appears exactly once, in order.
      expect(rows.flat()).toEqual(widths.map((_, i) => i));
      rows.forEach((row, r) => {
        const width = moreRowWidthPx(
          row.map((i) => widths[i]),
          gap
        );
        // A row either fits, or is one item nobody can share with.
        expect(width <= content || row.length === 1).toBe(true);
        if (row.length === 1 && rows.length > 1) {
          // ...and then it genuinely fits in neither neighbour row.
          const w = widths[row[0]];
          const prev = rows[r - 1];
          const next = rows[r + 1];
          if (prev) {
            expect(
              moreRowWidthPx(
                prev.map((i) => widths[i]),
                gap
              ) +
                gap +
                w >
                content
            ).toBe(true);
          }
          if (next) {
            expect(
              w +
                gap +
                moreRowWidthPx(
                  next.map((i) => widths[i]),
                  gap
                ) >
                content
            ).toBe(true);
          }
        }
      });
    }
  });
});

describe('arrangeMoreItems', () => {
  test('off keeps the canonical order untouched', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    expect(arrangeMoreItems(items, [55, 55, 45, 45, 45], 110, 4, false)).toEqual(items);
  });

  test('two or fewer items never reorder', () => {
    expect(arrangeMoreItems(['a', 'b'], [90, 90], 100, 4, true)).toEqual(['a', 'b']);
  });

  test('more than eight items skip the swap search', () => {
    const items = Array.from({ length: 9 }, (_, i) => `v${i}`);
    const widths = items.map(() => 60);
    expect(arrangeMoreItems(items, widths, 200, 4, true)).toEqual(items);
  });

  test('canonical order wins when it already fits fewest', () => {
    const items = ['a', 'b', 'c'];
    expect(arrangeMoreItems(items, [40, 40, 40], 300, 4, true)).toEqual(items);
  });

  test('a single swap is taken when it saves a row', () => {
    // Canonical packs 4 rows ([55],[55,45],[55,45],[45] at 110px); moving one
    // 45 beside the lone 55 pairs everything into 3. Any 3-row order displaces
    // exactly two items.
    const items = ['a', 'b', 'c', 'd', 'e', 'f'];
    const widths = [55, 55, 55, 45, 45, 45];
    const arranged = arrangeMoreItems(items, widths, 110, 4, true);
    const rows = splitMoreRows({
      itemWidthsPx: arranged.map((v) => widths[items.indexOf(v)]),
      contentWidthPx: 110,
      gapPx: 4,
    });
    expect(rows.length).toBe(3);
    expect(arranged.filter((v, i) => v !== items[i]).length).toBe(2);
  });

  test('mismatched widths return the input', () => {
    const items = ['a', 'b', 'c'];
    expect(arrangeMoreItems(items, [40, 40], 300, 4, true)).toEqual(items);
  });
});

/**
 * The More button's click, in full: the gesture's STARTING state plus whether the
 * activation came from the keyboard. A touch tap fires an emulated `mouseenter`
 * before its click, and that hover opens the menu - so the tap's own click must
 * not close it, or tapping More flashed the menu and nothing could keep it open.
 */
describe('moreClickIntent', () => {
  const state = (open: boolean, keyboard: boolean, wasOpenAtPointerDown: boolean) => ({
    open,
    keyboard,
    wasOpenAtPointerDown,
  });

  test('a closed menu opens', () => {
    expect(moreClickIntent(state(false, false, false))).toBe('open');
    expect(moreClickIntent(state(false, true, false))).toBe('open');
  });

  test('a mouse click on the open menu closes it', () => {
    // The hover that opened it happened before this gesture began, so the
    // pointerdown saw it open.
    expect(moreClickIntent(state(true, false, true))).toBe('close');
  });

  test('a touch tap keeps the menu its own emulated hover opened', () => {
    // First tap: the gesture began with the menu closed; the menu is open by the
    // time the click lands, and that click belongs to the open.
    expect(moreClickIntent(state(true, false, false))).toBe('ignore');
  });

  test('a keyboard activation is always a real toggle', () => {
    expect(moreClickIntent(state(true, true, false))).toBe('close');
    expect(moreClickIntent(state(true, true, true))).toBe('close');
  });
});

/**
 * The frozen rows of an OPEN More menu must not outlive the membership they were
 * arranged from. `moreItems` is derived from the shell width, and at the widest
 * stage it is EMPTY - which hides the menu while `moreOpen` stays true, so a
 * snapshot that survives its membership pops the menu back open on the next
 * resize, rendering rows for a world that no longer exists.
 */
describe('moreSnapshotVerdict - snapshot lifetime', () => {
  test('the same items keep the menu as it is, whatever order the rows packed in', () => {
    expect(moreSnapshotVerdict(['settings', 'about'], ['settings', 'about'])).toBe('keep');
    // `arrangeMoreItems` may reorder the rows for fewer lines; that is not a new
    // membership, and reading it as one would re-freeze on every effect pass.
    expect(moreSnapshotVerdict(['about', 'settings'], ['settings', 'about'])).toBe('keep');
  });

  test('a changed membership re-arranges the rows for the live items', () => {
    expect(moreSnapshotVerdict(['activity', 'settings', 'about'], ['settings', 'about'])).toBe(
      'refreeze'
    );
    // Same length, different items - one crossed the pill/More boundary.
    expect(moreSnapshotVerdict(['activity', 'settings'], ['automation', 'settings'])).toBe(
      'refreeze'
    );
  });

  test('an emptied More closes the menu rather than leaving it armed', () => {
    expect(moreSnapshotVerdict(['activity', 'settings'], [])).toBe('close');
    expect(moreSnapshotVerdict([], [])).toBe('close');
  });

  test('a menu that was never frozen is filled for a live non-empty More', () => {
    expect(moreSnapshotVerdict([], ['settings'])).toBe('refreeze');
  });
});

describe('normalizeAutoArrangeMore', () => {
  test('on by default', () => {
    expect(normalizeAutoArrangeMore(undefined)).toBe(true);
    expect(normalizeAutoArrangeMore(null)).toBe(true);
    expect(normalizeAutoArrangeMore(true)).toBe(true);
    expect(normalizeAutoArrangeMore('yes')).toBe(true);
  });

  test('only an explicit false turns it off', () => {
    expect(normalizeAutoArrangeMore(false)).toBe(false);
    expect(normalizeAutoArrangeMore('false')).toBe(false);
    expect(normalizeAutoArrangeMore(0)).toBe(false);
  });
});
