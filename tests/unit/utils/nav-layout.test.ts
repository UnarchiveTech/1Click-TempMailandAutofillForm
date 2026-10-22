import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { BODY_FONT_FAMILY } from '@/utils/ui/fit-label-font.js';
import {
  computeNavLayout,
  DEFAULT_NAV_ORDER,
  MIN_PRIMARY_ITEMS,
  MORE_ITEM_PAD_BLOCK_PX,
  MORE_ITEM_PAD_X_PX,
  NAV_BADGE_FONT_PX,
  NAV_BADGE_GAP_PX,
  NAV_BADGE_HEIGHT_PX,
  NAV_BADGE_MIN_W_PX,
  NAV_BADGE_PAD_X_PX,
  NAV_FAB_SIZE_PX,
  NAV_FLAGS,
  NAV_FLOAT_BOTTOM_PX,
  NAV_FLOAT_INSET_PX,
  NAV_GAP_PX,
  NAV_ICON_GAP_PX,
  NAV_ICON_SIZE_PX,
  NAV_ISLAND_RADIUS_PX,
  NAV_ITEM_PAD_BLOCK_PX,
  NAV_ITEM_PAD_X_MAX_PX,
  NAV_ITEM_PAD_X_MIN_PX,
  NAV_ITEM_PADDING_PX,
  NAV_ITEM_RADIUS_PX,
  NAV_LABEL_BASE_FONT_PX,
  NAV_LABEL_DEFAULT_FONT_PX,
  NAV_LABEL_MIN_FONT_PX,
  NAV_PILL_ICON_LANE_PX,
  NAV_RESERVED_OUTER_PX,
  NAV_SCALE_HEADROOM_PX,
  NAV_TOKEN_VARS,
  type NavBarFlag,
  navItemFor,
  normalizeNavOrder,
  normalizePrimaryItemsPref,
  SUBPAGE_VIEWS,
  stageForWidth,
  validateNavFlags,
} from '@/utils/ui/nav-layout';
import { ACTION_BTN_TIERS } from '@/utils/ui/responsive-button-layout.js';
import { stripComments } from '../../../scripts/source-lexer';
import { PROJECT_ROOT } from '../helpers/project-root';

/**
 * The navbar registry is flag-driven: views opt in via co-located *.nav.ts
 * exports. These tests lock in that the canonical order, labels and icons are
 * derived from the flags (never hand-maintained elsewhere) and that sub-page
 * views cannot be promoted.
 */
describe('nav flag registry', () => {
  test('the 8 canonical navbar keys derive from NAV_FLAGS in registry order', () => {
    expect(DEFAULT_NAV_ORDER).toEqual([
      'mailbox',
      'addresses',
      'autofill',
      'organize',
      'automation',
      'activity',
      'settings',
      'about',
    ]);
    expect(NAV_FLAGS.map((f) => f.key)).toEqual(DEFAULT_NAV_ORDER);
  });

  test('navItemFor derives labels/icons from the flags', () => {
    expect(navItemFor('automation')).toEqual({
      view: 'automation',
      labelKey: 'nav.automation',
      iconName: 'automation',
    });
    // Activity key renders the analytics view
    expect(navItemFor('activity')).toEqual({
      view: 'analytics',
      labelKey: 'nav.activity',
      iconName: 'analytics',
    });
    // Every canonical key resolves (unknown keys fall back to mailbox)
    for (const key of DEFAULT_NAV_ORDER) {
      expect(navItemFor(key).labelKey).toBeTruthy();
      expect(navItemFor(key).iconName).toBeTruthy();
    }
  });

  test('every flagged view is a top-level view (no sub-page promotions)', () => {
    for (const flag of NAV_FLAGS) {
      expect(SUBPAGE_VIEWS.has(flag.view), `${flag.view} is a sub-page view`).toBe(false);
    }
  });

  test('flags carry unique, positive, integer order values 1..N', () => {
    const orders = NAV_FLAGS.map((f) => f.order);
    expect(orders).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const o of orders) {
      expect(Number.isInteger(o)).toBe(true);
      expect(o).toBeGreaterThanOrEqual(1);
    }
  });

  test('the explicit order field (not array position) decides the order', () => {
    // Shuffle the registry array: NAV_FLAGS_ORDERED must still sort by order.
    const shuffled = [...NAV_FLAGS].reverse();
    const sorted = [...shuffled].sort((a, b) => a.order - b.order);
    expect(sorted.map((f) => f.key)).toEqual(DEFAULT_NAV_ORDER);
    expect(sorted.map((f) => f.key)).toEqual([
      'mailbox',
      'addresses',
      'autofill',
      'organize',
      'automation',
      'activity',
      'settings',
      'about',
    ]);
  });

  test('validateNavFlags rejects duplicate keys and duplicate views', () => {
    const base: NavBarFlag = { order: 1, key: 'k', view: 'about', labelKey: 'l', iconName: 'info' };
    expect(() => validateNavFlags([base, { ...base, view: 'settings' }])).toThrow(/duplicate key/);
    expect(() => validateNavFlags([base, { ...base, key: 'k2' }])).toThrow(/duplicate view/);
  });

  test('validateNavFlags rejects duplicate order values (collision)', () => {
    const a: NavBarFlag = { order: 1, key: 'k1', view: 'about', labelKey: 'l', iconName: 'info' };
    const b: NavBarFlag = {
      order: 1,
      key: 'k2',
      view: 'settings',
      labelKey: 'l',
      iconName: 'info',
    };
    expect(() => validateNavFlags([a, b])).toThrow(/order collision/);
  });

  test('validateNavFlags rejects order gaps (must be exactly 1..N)', () => {
    // Two flags with orders 1 and 3 → gap at 2
    expect(() =>
      validateNavFlags([
        { order: 1, key: 'k1', view: 'about', labelKey: 'l', iconName: 'info' },
        { order: 3, key: 'k2', view: 'settings', labelKey: 'l', iconName: 'info' },
      ])
    ).toThrow(/order gap.*2/);
    // Three flags with orders 1, 2, 4 → gap at 3
    expect(() =>
      validateNavFlags([
        { order: 1, key: 'k1', view: 'about', labelKey: 'l', iconName: 'info' },
        { order: 2, key: 'k2', view: 'settings', labelKey: 'l', iconName: 'info' },
        { order: 4, key: 'k3', view: 'autofill', labelKey: 'l', iconName: 'info' },
      ])
    ).toThrow(/order gap.*3/);
  });

  test('validateNavFlags accepts contiguous 1..N orders', () => {
    expect(() =>
      validateNavFlags([
        { order: 1, key: 'k1', view: 'about', labelKey: 'l', iconName: 'info' },
        { order: 2, key: 'k2', view: 'settings', labelKey: 'l', iconName: 'info' },
        { order: 3, key: 'k3', view: 'autofill', labelKey: 'l', iconName: 'info' },
      ])
    ).not.toThrow();
  });

  test('validateNavFlags rejects non-positive and non-integer orders', () => {
    expect(() =>
      validateNavFlags([{ order: 0, key: 'k', view: 'about', labelKey: 'l', iconName: 'info' }])
    ).toThrow(/positive integer/);
    expect(() =>
      validateNavFlags([{ order: 2.5, key: 'k', view: 'about', labelKey: 'l', iconName: 'info' }])
    ).toThrow(/positive integer/);
  });

  test('validateNavFlags rejects sub-page view promotion', () => {
    expect(() =>
      validateNavFlags([
        { order: 1, key: 'diag', view: 'diagnostics', labelKey: 'l', iconName: 'info' },
      ])
    ).toThrow(/sub-page/);
    expect(() =>
      validateNavFlags([
        { order: 1, key: 'mp', view: 'mailProvider', labelKey: 'l', iconName: 'info' },
      ])
    ).toThrow(/sub-page/);
  });

  test('the real registry passes validation', () => {
    expect(() => validateNavFlags(NAV_FLAGS)).not.toThrow();
  });
});

/**
 * Pre-measurement fallback: the fixed pixel ladder (520/440/400) is used until
 * the real translated label widths are measured.
 */
describe('computeNavLayout - fixed-ladder fallback (no measurements)', () => {
  test('stageForWidth maps widths to the four stages', () => {
    expect(stageForWidth(300)).toBe('compact');
    expect(stageForWidth(399)).toBe('compact');
    expect(stageForWidth(400)).toBe('plus_organize');
    expect(stageForWidth(439)).toBe('plus_organize');
    expect(stageForWidth(440)).toBe('six');
    expect(stageForWidth(519)).toBe('six');
    expect(stageForWidth(520)).toBe('seven');
  });

  test('≥520px: all 8 pages are primary, More is empty', () => {
    const layout = computeNavLayout(600);
    expect(layout.primaryNav.map((i) => i.view)).toEqual([
      'mailbox',
      'addresses',
      'autofill',
      'organize',
      'automation',
      'analytics',
      'settings',
      'about',
    ]);
    expect(layout.moreItems).toEqual([]);
    expect(layout.moreViewSet.size).toBe(0);
  });

  test('440-519px: 5 primary + More(activity, settings, about)', () => {
    const layout = computeNavLayout(500);
    expect(layout.primaryNav.map((i) => i.view)).toEqual([
      'mailbox',
      'addresses',
      'autofill',
      'organize',
      'automation',
      'more',
    ]);
    expect(layout.moreItems.map((i) => i.view)).toEqual(['analytics', 'settings', 'about']);
    expect(layout.moreViewSet.has('settings')).toBe(true);
  });

  test('400-439px: 4 primary + More', () => {
    const layout = computeNavLayout(420);
    expect(layout.primaryNav.map((i) => i.view)).toEqual([
      'mailbox',
      'addresses',
      'autofill',
      'organize',
      'more',
    ]);
    expect(layout.moreItems.map((i) => i.view)).toEqual([
      'automation',
      'analytics',
      'settings',
      'about',
    ]);
  });

  test('<400px: 3 primary + More(organize…)', () => {
    const layout = computeNavLayout(360);
    expect(layout.primaryNav.map((i) => i.view)).toEqual([
      'mailbox',
      'addresses',
      'autofill',
      'more',
    ]);
    expect(layout.moreItems.map((i) => i.view)).toEqual([
      'organize',
      'automation',
      'analytics',
      'settings',
      'about',
    ]);
  });
});

/**
 * Locale-aware mode: the split follows the MEASURED translated label widths,
 * so wide labels push items into More earlier than narrow labels.
 */
describe('computeNavLayout - measured label widths', () => {
  // Narrow labels (~40px text + 20px padding) - everything fits below 400px.
  const narrow: Record<string, number> = {
    mailbox: 60,
    addresses: 62,
    autofill: 58,
    organize: 60,
    automation: 62,
    activity: 58,
    settings: 60,
    about: 52,
    more: 55,
  };
  // Wide labels (e.g. long locales) - far fewer items fit at the same width.
  const wide: Record<string, number> = {
    mailbox: 96,
    addresses: 92,
    autofill: 88,
    organize: 98,
    automation: 104,
    activity: 96,
    settings: 92,
    about: 84,
    more: 70,
  };

  test('the 3-item floor yields only when even the FLOOR font cannot pay for it', () => {
    // The reference-font widths decide the preferred count; the floor-font widths
    // decide whether that count is affordable at all. 360px, labels wide enough
    // that only 2 fit at the reference font - the floor still holds at 3, because
    // the pill may shrink its text and the floor-font row fits.
    const reference: Record<string, number> = {
      mailbox: 100,
      addresses: 95,
      autofill: 76,
      organize: 92,
      automation: 96,
      activity: 90,
      settings: 88,
      about: 80,
      more: 67,
    };
    const floorFits: Record<string, number> = {
      mailbox: 70,
      addresses: 66,
      autofill: 55,
      organize: 64,
      automation: 66,
      activity: 62,
      settings: 60,
      about: 54,
      more: 45,
    };
    // `primaryNav` carries the More item too, so N primary items is length N + 1.
    const affordable = computeNavLayout(360, [], reference, 'auto', floorFits);
    expect(affordable.primaryNav.length).toBe(MIN_PRIMARY_ITEMS + 1);

    // A shell that cannot pay for three items even at the floor drops one into
    // More instead of shaving every label's last letter. (This is the 320px shell
    // in a wide locale, where the badge reserve and the active icon leave 244px.)
    const floorTooWide: Record<string, number> = {
      mailbox: 90,
      addresses: 85,
      autofill: 90,
      organize: 88,
      automation: 90,
      activity: 86,
      settings: 84,
      about: 78,
      more: 70,
    };
    const yielded = computeNavLayout(360, [], reference, 'auto', floorTooWide);
    expect(yielded.primaryNav.length).toBe(3);
    // The displaced view is still reachable - it moved into More, it did not
    // disappear.
    expect(yielded.moreItems.length).toBeGreaterThan(0);

    // And it never goes below one primary item, however narrow the shell.
    expect(computeNavLayout(200, [], reference, 'auto', floorTooWide).primaryNav.length).toBe(2);
  });

  test('the split reserves no inter-item gap - the row it calls affordable is the row the pill draws', () => {
    // `fitNavPill` sums each item's own padding and stops (`fixedWidth`): nav
    // items are adjacent, and the only gap in the row is the one to the FAB,
    // which `NAV_RESERVED_OUTER_PX` already subtracts. The split used to add
    // `NAV_GAP_PX` on top of every item - 6px per segment for a gap nobody
    // paints, i.e. 24-30px of the row - which is what dropped Thai at popup
    // width from three primary items to two.
    const usable = 360 - NAV_RESERVED_OUTER_PX - NAV_PILL_ICON_LANE_PX;
    const exact: Record<string, number> = {
      mailbox: 70,
      addresses: 63,
      autofill: 70,
      more: 60,
      organize: 999,
    };
    // 70 + 63 + 70 + 60 === usable: three primary items are kept because the row
    // fits EXACTLY, with nothing reserved between the segments.
    expect(70 + 63 + 70 + 60).toBe(usable);
    const layout = computeNavLayout(360, [], exact, 'auto', exact);
    expect(layout.primaryNav.map((i) => i.view)).toEqual([
      'mailbox',
      'addresses',
      'autofill',
      'more',
    ]);

    // One more pixel of label and the third segment really is unaffordable - the
    // boundary is the paint, not a 6px-per-item margin. That 1px is the whole
    // difference the phantom gap used to hide.
    const tight: Record<string, number> = { ...exact, autofill: 71 };
    expect(computeNavLayout(360, [], tight, 'auto', tight).primaryNav.length).toBe(3);
  });

  test('without floor measurements the floor stays unconditional, as before', () => {
    const reference: Record<string, number> = { mailbox: 100, addresses: 95, more: 67 };
    // No affordability data ⇒ the old behaviour: 3 primary items (+ More) at any
    // width, because the reference-font count alone may not lower the floor.
    expect(computeNavLayout(360, [], reference).primaryNav.length).toBe(MIN_PRIMARY_ITEMS + 1);
    expect(computeNavLayout(200, [], reference).primaryNav.length).toBe(MIN_PRIMARY_ITEMS + 1);
  });

  test('narrow labels keep more items primary than wide labels at the same width', () => {
    const narrowLayout = computeNavLayout(440, [], narrow);
    const wideLayout = computeNavLayout(440, [], wide);
    expect(narrowLayout.primaryNav.length).toBeGreaterThan(wideLayout.primaryNav.length);
  });

  test('wide labels overflow earlier into More', () => {
    const wideAt520 = computeNavLayout(520, [], wide);
    const wideAt800 = computeNavLayout(800, [], wide);
    expect(wideAt520.primaryNav.length).toBeLessThan(wideAt800.primaryNav.length);
  });

  test('never fewer than 3 primary items, never more than 8', () => {
    for (const shellWidth of [320, 440, 600, 900, 1200]) {
      const layout = computeNavLayout(shellWidth, [], wide);
      expect(layout.primaryNav.length, `@${shellWidth}`).toBeGreaterThanOrEqual(4); // 3 + More
      expect(layout.primaryNav.length).toBeLessThanOrEqual(8);
    }
  });

  test('all 8 fit without a More button when the shell is wide', () => {
    const layout = computeNavLayout(900, [], wide);
    expect(layout.primaryNav.map((i) => i.view)).not.toContain('more');
    expect(layout.moreItems).toEqual([]);
  });

  test('custom navbar order is respected and missing canonical items are appended', () => {
    const layout = computeNavLayout(440, ['automation', 'addresses'], narrow);
    // automation + addresses primary first, then everything else in canonical order
    expect(layout.primaryNav[0].view).toBe('automation');
    expect(layout.primaryNav[1].view).toBe('addresses');
    // the rest of the canonical set still exists (in More or primary)
    const views = new Set([
      ...layout.primaryNav.map((i) => i.view),
      ...layout.moreItems.map((i) => i.view),
    ]);
    for (const v of ['mailbox', 'autofill', 'organize', 'settings', 'about']) {
      expect(views.has(v as never)).toBe(true);
    }
  });

  test('a stored order that repeats a key cannot render the same view twice', () => {
    // Storage is user-writable and syncs between devices: a raced write, a manual
    // edit or a sync conflict can leave the same key in `customNavOrder` twice,
    // and the pill is a KEYED each - a repeated key is a Svelte error, not a
    // cosmetic double item.
    const layout = computeNavLayout(360, ['mailbox', 'mailbox', 'addresses', 'mailbox'], narrow);
    const rendered = [
      ...layout.primaryNav.map((item) => item.view),
      ...layout.moreItems.map((item) => item.view),
    ];
    expect(new Set(rendered).size).toBe(rendered.length);
    // …and the repair did not drop anything on the way: every canonical view is
    // still reachable, primary or in More.
    for (const view of ['mailbox', 'addresses', 'autofill', 'settings', 'about']) {
      expect(rendered).toContain(view as never);
    }
  });
});

/**
 * `customNavOrder` is user-writable and syncs between devices, so the nav
 * pipeline repairs it at its entry: invalid/obsolete keys and duplicates out,
 * missing canonical items appended. One place, so the pill, the More menu and
 * the reorder screen cannot each decide a different answer.
 */
describe('normalizeNavOrder', () => {
  test('a key repeated by a raced write survives once, at its first position', () => {
    const order = normalizeNavOrder(['settings', 'settings', 'mailbox', 'settings']);
    expect(order.filter((key) => key === 'settings')).toHaveLength(1);
    expect(order[0]).toBe('settings');
    expect(order[1]).toBe('mailbox');
    expect(new Set(order).size).toBe(DEFAULT_NAV_ORDER.length);
  });

  test('strangers, non-strings and an empty value all fall back to canonical', () => {
    const canonical = [...DEFAULT_NAV_ORDER];
    // An obsolete key from a retired view is dropped; the rest of the list is
    // kept and the canonical tail is appended.
    expect(normalizeNavOrder(['retiredView', 42, null, 'settings'])).toEqual([
      'settings',
      'mailbox',
      'addresses',
      'autofill',
      'organize',
      'automation',
      'activity',
      'about',
    ]);
    expect(normalizeNavOrder(undefined)).toEqual(canonical);
    expect(normalizeNavOrder([])).toEqual(canonical);
    expect(normalizeNavOrder('mailbox')).toEqual(canonical);
  });

  test('the repaired order is still the user’s order, with the rest appended', () => {
    expect(normalizeNavOrder(['automation', 'settings'])).toEqual([
      'automation',
      'settings',
      'mailbox',
      'addresses',
      'autofill',
      'organize',
      'activity',
      'about',
    ]);
  });
});

/**
 * The user-configurable primary-items preference (storage key
 * `minPrimaryItems`): 'auto' keeps the classic fit-as-many behavior (floor
 * MIN_PRIMARY_ITEMS), while 1|2|3 FORCE that many primary items - the rest
 * always go into More, even on wide shells.
 */
describe('computeNavLayout - primary-items preference', () => {
  // Wide measured labels that would normally fit all 8 at 800px.
  const wide: Record<string, number> = {
    mailbox: 70,
    addresses: 68,
    autofill: 66,
    organize: 70,
    automation: 72,
    activity: 68,
    settings: 70,
    about: 60,
    more: 55,
  };

  test('auto (default) still fits as many as possible - no regression', () => {
    const auto = computeNavLayout(800, [], wide, 'auto');
    expect(auto.primaryNav.map((i) => i.view)).not.toContain('more');
    expect(auto.moreItems).toEqual([]);
    // Explicit 4th arg omitted ≡ 'auto'
    expect(computeNavLayout(800, [], wide).moreItems).toEqual([]);
    // Compact shell still floors at MIN_PRIMARY_ITEMS
    const compact = computeNavLayout(320, [], wide);
    expect(compact.primaryNav.length).toBe(MIN_PRIMARY_ITEMS + 1); // 3 primary + More
  });

  test('a forced count caps primary items even on a wide shell', () => {
    const forced = computeNavLayout(800, [], wide, 2);
    expect(forced.primaryNav.map((i) => i.view)).toEqual(['mailbox', 'addresses', 'more']);
    expect(forced.moreItems.map((i) => i.view)).toEqual([
      'autofill',
      'organize',
      'automation',
      'analytics',
      'settings',
      'about',
    ]);
  });

  test('forced 1 shows a single primary item + More', () => {
    const forced = computeNavLayout(800, [], wide, 1);
    expect(forced.primaryNav.map((i) => i.view)).toEqual(['mailbox', 'more']);
    expect(forced.moreItems).toHaveLength(7);
  });

  test('forced count still respects the shell width (fewer only when they do not fit)', () => {
    // Ultra-narrow shell that cannot even fit 3 items.
    const forced = computeNavLayout(220, [], wide, 3);
    expect(forced.primaryNav.map((i) => i.view)).toEqual(['mailbox', 'more']);
    // The More button itself always keeps one primary item company.
    expect(forced.primaryNav.length).toBeGreaterThanOrEqual(2);
  });

  test('the fixed-ladder fallback (pre-measurement) honors a forced count', () => {
    const fallback = computeNavLayout(800, [], {}, 2);
    expect(fallback.primaryNav.map((i) => i.view)).toEqual(['mailbox', 'addresses', 'more']);
    expect(fallback.moreItems).toHaveLength(6);
    // Auto fallback is unchanged (ladder: all 8 fit at 800px)
    expect(computeNavLayout(800, [], {}).moreItems).toEqual([]);
  });

  test('forced count composes with a custom order', () => {
    const layout = computeNavLayout(800, ['settings', 'about'], wide, 1);
    expect(layout.primaryNav[0].view).toBe('settings');
    expect(layout.primaryNav[1].view).toBe('more');
    // The rest of the canonical set lives in More, in order.
    const moreViews = layout.moreItems.map((i) => i.view);
    expect(moreViews).toContain('mailbox');
    expect(moreViews).toContain('addresses');
    expect(moreViews).toContain('autofill');
  });

  test('normalizePrimaryItemsPref coerces unknown storage input to auto', () => {
    expect(normalizePrimaryItemsPref('auto')).toBe('auto');
    expect(normalizePrimaryItemsPref(1)).toBe(1);
    expect(normalizePrimaryItemsPref(2)).toBe(2);
    expect(normalizePrimaryItemsPref(3)).toBe(3);
    expect(normalizePrimaryItemsPref(undefined)).toBe('auto');
    expect(normalizePrimaryItemsPref(9)).toBe('auto');
    expect(normalizePrimaryItemsPref(0)).toBe('auto');
    expect(normalizePrimaryItemsPref('2')).toBe('auto');
    expect(normalizePrimaryItemsPref(null)).toBe('auto');
  });
});

// ── Floating-pill geometry ────────────────────────────────────────────────────
//
// The floating footer is a segmented NAV (elastic indicator, collapsing active
// icon, More overflow menu), deliberately outside `responsiveButtonLayout` - but it
// used to keep four copies of the float inset, three different label-font
// defaults (13 / 12 / 13) and two CSS variables for its own height. These
// constants are the single source, and the scans below fail if a component
// reintroduces a literal instead of reading them: a duplicated number is
// invisible until two of them disagree.

const read = (relativePath: string): string =>
  readFileSync(`${PROJECT_ROOT}/${relativePath}`, 'utf8');

/** Declarations of one CSS rule, so a scan can't match a different selector. */
function cssBlock(source: string, selector: string): string {
  const start = source.indexOf(`\n  ${selector} {`);
  if (start === -1) throw new Error(`CSS rule not found: ${selector}`);
  const end = source.indexOf('\n  }', start);
  return source.slice(start, end);
}

describe('floating pill geometry - one source per number', () => {
  test('the reserved outer width is derived, not typed in twice', () => {
    expect(NAV_RESERVED_OUTER_PX).toBe(
      2 * NAV_FLOAT_INSET_PX + NAV_FAB_SIZE_PX + NAV_GAP_PX + NAV_SCALE_HEADROOM_PX
    );
    // The 76 the nav split has always reserved, now explained by its parts
    // (2×15 inset + 36 FAB + 6 gap + 4 scale headroom) instead of "~40px FAB".
    expect(NAV_RESERVED_OUTER_PX).toBe(76);
  });

  test('pins the pill geometry the CSS and the fitters share', () => {
    expect([
      NAV_ITEM_PADDING_PX,
      NAV_GAP_PX,
      NAV_FLOAT_INSET_PX,
      NAV_FLOAT_BOTTOM_PX,
      NAV_FAB_SIZE_PX,
      NAV_SCALE_HEADROOM_PX,
      NAV_LABEL_DEFAULT_FONT_PX,
      NAV_LABEL_BASE_FONT_PX,
      NAV_LABEL_MIN_FONT_PX,
      NAV_ITEM_PAD_X_MAX_PX,
      NAV_ITEM_PAD_X_MIN_PX,
      NAV_BADGE_FONT_PX,
      NAV_BADGE_PAD_X_PX,
      NAV_BADGE_MIN_W_PX,
      NAV_BADGE_GAP_PX,
      NAV_ICON_SIZE_PX,
      NAV_ICON_GAP_PX,
      NAV_ITEM_RADIUS_PX,
      NAV_ITEM_PAD_BLOCK_PX,
      MORE_ITEM_PAD_X_PX,
      MORE_ITEM_PAD_BLOCK_PX,
      NAV_BADGE_HEIGHT_PX,
      // `NAV_BADGE_GAP_PX` is 0 by design (the count's box starts on the label's
      // ink end), and no badge-inset constant is needed any more: the count's
      // inset IS the row's own side padding (`--nav-badge-inset`), which is
      // itself floored at the tiers' minimum side padding.
      //
      // The pill's label floor is 10, not 11: it is the last lever before the row
      // either cuts a glyph or drops a segment the user asked to keep. At 11 a
      // 360px popup in Thai with a `99+` count was ~10px over and shaved
      // 4.38/1.08/2.98/1.89px off the four labels; at 10 the same row renders 4
      // segments with nothing cut.
    ]).toEqual([28, 6, 15, 10, 36, 4, 13, 14, 10, 14, 4, 9, 3, 14, 0, 18, 3, 28, 8, 10, 6, 14]);
  });

  test('icon indicators share rendering across the pill, More menu and sidebar', () => {
    const src = read('src/ui/blocks/layout/Footer.svelte');
    const sidebar = read('src/ui/blocks/layout/SidebarNav.svelte');
    expect(src.match(/<NavIconIndicator /g)?.length).toBe(2);
    expect(sidebar.match(/<NavIconIndicator /g)?.length).toBe(2);
    expect(src).toContain('extraChromePx');
    expect(src).not.toContain('width: calc(var(--nav-icon-size) + 8px)');
    expect(src).not.toContain('margin-right: calc(var(--nav-icon-gap) + 8px)');
    expect(src).toContain('iconSizePx={navIconSizePx(navFontPx)}');
  });

  test('indicators start at the icon centre and count text fits the contained badge', () => {
    const src = read('src/ui/components/primitives/NavIconIndicator.svelte');
    expect(src).toContain('top: 50%');
    expect(src).toContain('left: 50%');
    expect(src).toContain('transform: translateY(-100%)');
    expect(cssBlock(src, '.nav-badge')).toContain('font-size: 0.8em');
    expect(cssBlock(src, '.nav-badge')).toContain('height: var(--nav-indicator-limit)');
    expect(cssBlock(src, '.nav-badge')).toContain('letter-spacing: 0');
    expect(src).toMatch(/\.nav-icon-dot\s*\{\s*width: var\(--nav-dot-size\)/);
    expect(src).toContain('NAV_DOT_SIZE_PX');
    expect(src).toContain('labelFont * 0.8');
    expect(src).toContain('fitLabelFontSize');
  });

  test('every nav geometry number has one home: the token block or a per-fit var', () => {
    const src = read('src/ui/blocks/layout/Footer.svelte');
    // The bridge: `navTokenStyle()` emits the fixed geometry once, and the
    // island root injects it, so the app and the visual harness read the same
    // numbers (a CSS literal in a <style> block is a second copy no test can
    // compare against the constant it shadows).
    expect(src).toContain('{navTokenStyle()}');
    // Per-fit values are injected on their own surface, as before.
    for (const injected of [
      '--nav-font-size: {navFontPx}px',
      '--nav-item-pad-x: {navPadX}px',
      '--nav-item-pad-x-end: {navPadXEnd}px',
      '--nav-item-pad-block-start: {navPadBlockStartPx}px',
      '--nav-item-pad-block-end: {NAV_ITEM_PAD_BLOCK_PX}px',
      '--nav-badge-bottom: {navBadgeBottomPx}px',
      '--nav-badge-inset: {navPadX}px',
      '--more-menu-pad-block-start: {morePadBlockStartPx}px',
      '--more-menu-pad-x-end: {moreBadgeEndPadPx}px',
      '--nav-badge-bottom: {moreBadgeBottomPx}px',
      '--nav-badge-inset: {MORE_ITEM_PAD_X}px',
      '--nav-dot-size: {NAV_DOT_SIZE_PX}px',
      '--nav-dot-gap: {NAV_DOT_GAP_PX}px',
    ]) {
      expect(src).toContain(injected);
    }
    // Every var the nav CSS reads is either emitted by the token block or
    // injected per fit - a var nobody sets resolves to `unset` and silently
    // deletes a box (the icon becomes 0px wide, the badge height collapses).
    const tokenVars = new Set(Object.keys(NAV_TOKEN_VARS));
    // The preview still exercises the standalone label-badge fitter's geometry;
    // production corner badges are verified by the shared component and e2e.
    const styleBlock =
      src.slice(src.indexOf('<style'), src.indexOf('</style>')) +
      read('tests/visual/preview-responsive-button-layout.html');
    const readVars = new Set(
      [...styleBlock.matchAll(/var\((--(?:nav|more)-[a-z-]+)/g)].map((m) => m[1])
    );
    const perFit = new Set([
      '--nav-font-size',
      '--nav-item-pad-x',
      '--nav-item-pad-x-end',
      '--nav-item-pad-block-start',
      '--nav-item-pad-block-end',
      '--nav-badge-bottom',
      '--nav-badge-inset',
      '--nav-dot-size',
      '--nav-dot-gap',
      '--nav-dot-x',
      '--nav-dot-y',
      '--more-menu-pad-block-start',
      '--more-menu-pad-x-end',
    ]);
    for (const name of readVars) {
      expect(tokenVars.has(name) || perFit.has(name)).toBe(true);
    }
    // The token block's values are the constants themselves, and every geometry
    // var the CSS reads from it is covered (no token is emitted dead).
    expect(NAV_TOKEN_VARS['--nav-icon-size']).toBe(NAV_ICON_SIZE_PX);
    expect(NAV_TOKEN_VARS['--nav-icon-gap']).toBe(NAV_ICON_GAP_PX);
    expect(NAV_TOKEN_VARS['--nav-item-radius']).toBe(NAV_ITEM_RADIUS_PX);
    expect(NAV_TOKEN_VARS['--nav-island-radius']).toBe(NAV_ISLAND_RADIUS_PX);
    expect(NAV_TOKEN_VARS['--nav-badge-height']).toBe(NAV_BADGE_HEIGHT_PX);
    expect(NAV_TOKEN_VARS['--nav-badge-font-size']).toBe(NAV_BADGE_FONT_PX);
    expect(NAV_TOKEN_VARS['--nav-badge-pad-x']).toBe(NAV_BADGE_PAD_X_PX);
    expect(NAV_TOKEN_VARS['--nav-badge-min-w']).toBe(NAV_BADGE_MIN_W_PX);
    expect(NAV_TOKEN_VARS['--more-menu-pad-x']).toBe(MORE_ITEM_PAD_X_PX);
    expect(NAV_TOKEN_VARS['--more-menu-pad-block-end']).toBe(MORE_ITEM_PAD_BLOCK_PX);
    for (const name of tokenVars) {
      if (name === '--more-menu-pad-block-end') continue; // read, but as a var of its own line
      expect(readVars.has(name)).toBe(true);
    }
  });

  test('the padding floor is the action tiers\u2019 minimum side padding', () => {
    // The pill compresses its spacing after the font floor, but never past the
    // sanctioned hit-target minimum - that is what makes the stepped reduction
    // safe to automate.
    expect(NAV_ITEM_PAD_X_MIN_PX).toBe(ACTION_BTN_TIERS.XS.minSidePad);
    expect(NAV_ITEM_PAD_X_MAX_PX).toBe(NAV_ITEM_PADDING_PX / 2);
  });

  test('the pill reads at the action tiers\u2019 label font when it has room', () => {
    // Deliberate: the pill's fitter STARTS at the sanctioned XS/S label size, so
    // an unscaled locale renders nav labels at the same size as a tier-S button.
    expect(NAV_LABEL_BASE_FONT_PX).toBe(ACTION_BTN_TIERS.S.labelFont);
    // ...and floors BELOW the tiers' 12px floor on purpose, so no locale
    // truncates its nav labels at popup width.
    expect(NAV_LABEL_MIN_FONT_PX).toBeLessThan(ACTION_BTN_TIERS.S.minFont);
  });

  test('Footer.svelte takes every shared number from the constants', () => {
    const src = read('src/ui/blocks/layout/Footer.svelte');

    // The vars are injected once, from the constants, and inherited.
    expect(src).toContain('--footer-float-inset: {NAV_FLOAT_INSET_PX}px');
    expect(src).toContain('--footer-float-bottom: {NAV_FLOAT_BOTTOM_PX}px');
    expect(src).toContain('--fab-size: {NAV_FAB_SIZE_PX}px');
    expect(src).toContain('--nav-font-size: {NAV_LABEL_DEFAULT_FONT_PX}px');

    // ...so no declaration may carry its own literal fallback again.
    for (const drifted of [
      /var\(--footer-float-inset,\s*[\d.]+px\)/,
      /var\(--footer-float-bottom,\s*[\d.]+px\)/,
      /var\(--nav-font-size,\s*[\d.]+px\)/,
      /var\(--fab-size,\s*[\d.]+px\)/,
    ]) {
      expect(src).not.toMatch(drifted);
    }

    // The CSS that sizes the row agrees with the budget math.
    const fab = cssBlock(src, '.fab-btn');
    expect(fab).toContain('min-width: var(--fab-size)');
    expect(fab).toContain('min-height: var(--fab-size)');
    expect(fab).not.toMatch(/[\d.]+rem/);

    // The item padding is the fitter's second lever: the CSS reads a FITTED var
    // and the var is injected from `fitNavPill` - a literal here would silently
    // undo the compression in a wide locale, and the width the fit reserved
    // would no longer be the width the item uses.
    const navItem = cssBlock(src, '.nav-item');
    expect(navItem).toContain(
      'padding: var(--nav-item-pad-block-start) var(--nav-item-pad-x) var(--nav-item-pad-block-end)'
    );
    expect(navItem).toContain('font-size: var(--nav-font-size)');
    // The block-start half is the fitted superscript lane, injected from the
    // constants rather than authored here: the authored value is only its floor.
    expect(src).toContain('--nav-item-pad-block-start: {navPadBlockStartPx}px');
    expect(src).toContain('--nav-item-pad-block-end: {NAV_ITEM_PAD_BLOCK_PX}px');
    const badgeItem = cssBlock(src, '.nav-item.has-badge');
    expect(badgeItem).toContain('padding-inline-end: var(--nav-item-pad-x)');
    // ...and the badge item must clip NOTHING. `overflow: clip` rounds its clip
    // at the item's 28px radius, and the count sits in exactly that corner: the
    // box's top-right was sliced by the pill's own rim, which reads as the count
    // coming THROUGH the edge rather than sitting inside it. The label contains
    // its own ink (`.nav-label { overflow-x: clip }`), so nothing here needed the
    // item-level clip.
    expect(badgeItem).not.toContain('overflow');
    expect(cssBlock(src, '.nav-label')).toContain('overflow-x: clip');
    expect(src).toContain('--nav-item-pad-x: {navPadX}px; --nav-item-pad-x-end: {navPadXEnd}px;');
    expect(src).not.toMatch(/var\(--nav-item-pad-x[a-z-]*,\s*[\d.]+px\)/);

    // A label can never paint outside the button whose box the pill matches.
    const label = cssBlock(src, '.nav-label');
    expect(label).toContain('overflow-x: clip');
    expect(label).toContain('min-width: 0');

    // The nav↔FAB gap is the Tailwind utility beside the pill: gap-1.5 = 6px,
    // which is NAV_GAP_PX. The NAV ITEMS themselves must stay flush - the fit
    // reserves no inter-item gap (that reservation was one of the bugs), so a
    // `gap` on the pill's rule would push the row wider than the fit promised.
    expect(src).toMatch(/bottom-nav-container[^>]*gap-1\.5/);
    expect(NAV_GAP_PX).toBe(6);
    expect(cssBlock(src, '.floating-nav')).not.toMatch(/\bgap:/);

    // The pill's arithmetic lives in `fit-nav-pill.ts` (font → padding levers,
    // honest overflow report); this component only supplies the DOM numbers.
    const pillFit = read('src/utils/ui/fit-nav-pill.ts');
    expect(src).toContain("from '@/utils/ui/fit-nav-pill.js'");
    expect(src).toContain('fitNavPill({');
    expect(pillFit).toContain('NAV_LABEL_BASE_FONT_PX * localeFontScale');
    expect(pillFit).toContain('NAV_LABEL_MIN_FONT_PX');
    expect(pillFit).toContain('NAV_ITEM_PAD_X_MIN_PX');
    expect(pillFit).not.toMatch(/\d+ \* localeFontScale/);
    expect(pillFit).not.toMatch(/minPx: \d/);

    // The More menu inherits the pill's fitted size - one size source, so a
    // submenu item renders exactly as big as its pill sibling would. No second
    // fitter, and nothing below the pill floor.
    expect(src.match(/--nav-font-size: \{navFontPx\}px/g)?.length).toBe(2);
    expect(src).not.toContain('MORE_MENU_MIN_FONT_PX');
    // ...except the one case arrangement cannot solve: a single item wider
    // than its own row shrinks in place toward the pill floor, then cuts.
    expect(src).toContain('minPx: NAV_LABEL_MIN_FONT_PX');
    expect(src).not.toMatch(/minPx: \d/);
    expect(src).not.toMatch(/\d+ \* localeFontScale/);
  });

  test('the More submenu renders arranged rows, frozen while open', () => {
    const src = read('src/ui/blocks/layout/Footer.svelte');
    // The row math lives in `more-menu-layout.ts` (fewest rows that fit, no
    // orphan row, fix-only auto-arrange); the component only measures and
    // renders the answer.
    expect(src).toContain("from '@/utils/ui/more-menu-layout.js'");
    expect(src).toContain('arrangeMoreItems(');
    expect(src).toContain('splitMoreRows({');
    // Frozen at open: unread arriving or a locale swap mid-open must not move
    // the rows under the pointer. Both close paths plus the empty-menu early
    // return drop the snapshot.
    expect(src).toContain('freezeMoreMenu()');
    expect(src).toContain('moreRows ?? []');
    expect(src.match(/moreRows = null/g)?.length).toBe(3);
    // Rows are explicit row boxes - never a flat wrapping box whose breaks the
    // browser decides - and a row never shrinks its items: the rows were
    // packed to fit, so the flex box must keep the fitter's answer achievable.
    expect(src).toContain('class="more-menu-row"');
    expect(cssBlock(src, '.more-menu-row')).toContain('justify-content: center');
    expect(cssBlock(src, '.more-menu-item')).toContain('flex-shrink: 0');
    // A shrunk single cuts with an ellipsis; the pill keeps its clip belt.
    expect(cssBlock(src, '.more-menu-item .nav-label')).toContain('text-overflow: ellipsis');
    expect(cssBlock(src, '.nav-label')).toContain('text-overflow: clip');
    // The menu island carries the ITEM radius, not the pill island's: its
    // corner items sit 4px from the island's corners, so a larger island
    // radius is compared directly and reads as a bubble around mini pills.
    expect(cssBlock(src, '.more-menu-nav')).toContain('border-radius: var(--nav-item-radius)');
    expect(cssBlock(src, '.more-menu-nav')).not.toContain('nav-island-radius');
  });

  test('the More button opens through ONE path - freeze included', () => {
    const src = read('src/ui/blocks/layout/Footer.svelte');
    // Hover was the only freezer, so a keyboard (Enter) or touch open - neither
    // of which fires a mouseenter - flipped `moreOpen` alone and rendered
    // `moreRows ?? []`: an empty island. The click path now runs the same
    // open/freeze pair as hover.
    expect(src).toContain('moreClickIntent({');
    expect(src).toContain("if (intent === 'close') closeMoreNow();");
    expect(src).toContain('else openMoreMenu();');
    expect(src).not.toContain('moreOpen = !moreOpen;');
    // A tap's emulated hover opens the menu, so the tap's own click must not
    // toggle it shut; the gesture's starting state is what tells them apart.
    expect(src).toContain('moreWasOpenAtPointerDown = moreOpen;');
    expect(src).toContain('handlePrimaryClick(item.view, e);');
  });

  test('the More menu highlights through the SAME predicate as the pill', () => {
    const src = read('src/ui/blocks/layout/Footer.svelte');
    // The inline copy only matched the hub itself, so a hub in More left every
    // item unhighlighted for its deep views (mailView, addressView, loginInfo,
    // identities) while the pill lit up correctly.
    expect(src).toContain('{@const active = isPrimaryActive(item.view)}');
    expect(src).not.toContain("? currentView === 'organize'");
  });

  test('the shrink belt can actually paint its ellipsis, and Escape dismisses the menu', () => {
    const src = read('src/ui/blocks/layout/Footer.svelte');
    // Without a width limit and a clip on the ITEM, nothing ever narrowed the
    // label, so `text-overflow: ellipsis` never painted: the item widened the
    // panel to its cap and spilled into a horizontal scrollbar (the panel's
    // `overflow-y: auto` computes overflow-x: auto too).
    const item = cssBlock(src, '.more-menu-item');
    expect(item).toContain('max-width: 100%');
    expect(item).toContain('overflow: hidden');
    expect(item).toContain('flex-shrink: 0');
    // …and the OTHER half, measured in Chromium: clamping the item alone does
    // NOT let the ellipsis paint - the label keeps its content-width floor, so
    // the item just hides it. `min-width: 0` is what makes the label shrink to
    // the box and cut.
    const menuLabel = cssBlock(src, '.more-menu-item .nav-label');
    expect(menuLabel).toContain('text-overflow: ellipsis');
    expect(menuLabel).toContain('min-width: 0');
    // `role="menu"` declared a dismissal contract the panel did not keep: Escape
    // fell through to the global handler and navigated away with the menu open.
    expect(src).toContain("registerEscapeTier('nav.moreMenu', closeMoreNow)");
  });

  test('the frozen More snapshot does not outlive the membership it was taken from', () => {
    const src = read('src/ui/blocks/layout/Footer.svelte');
    // The verdict itself is the pure bookkeeping in `more-menu-layout.ts`
    // (tests/unit/utils/more-menu-layout.test.ts); this pins the wiring.
    expect(src).toContain('moreSnapshotVerdict(');
    // The call is formatter-wrapped, so assert the argument on its own line
    // rather than the exact call shape.
    expect(src).toContain('moreFrozenViews,');
    expect(src).toContain("if (verdict === 'close') closeMoreNow();");
    expect(src).toContain("else if (verdict === 'refreeze') freezeMoreMenu();");
    // WHY it matters: `{#if moreOpen && moreItems.length > 0}` hides a menu whose
    // More list emptied (the widest stage promotes every item) while `moreOpen`
    // stays true - so without this the next resize re-shows it, uninvited, still
    // rendering rows for the dead membership.
    expect(src).toContain('{#if moreOpen && moreItems.length > 0}');
    expect(src).toContain('let moreFrozenViews = $derived(');
  });

  test('a stored navbar order is repaired where it enters the store', () => {
    // Duplicates and strangers are dropped (and missing canonical items
    // appended) at the pipeline's entry, so no keyed nav list can meet either -
    // a repeated key is a Svelte error there, not a cosmetic double item.
    const src = read('src/ui/blocks/layout/layout-store.svelte.ts');
    expect(src).toContain('customNavOrder = normalizeNavOrder(order);');
  });

  test('the fitter measures the font the labels are painted with', () => {
    // A fit that measures a different face than the render is a geometry lie:
    // it says "fits", the paint overflows the box, and the label lands outside
    // the very pill that is sized to that box. The stack is resolved from the
    // live element the labels live in.
    const src = read('src/ui/blocks/layout/Footer.svelte');
    expect(src).toContain('const family = resolveLabelFontFamily(footerRootEl)');
    // ...and the measurement itself is rebuilt for that family AND for the
    // label's letter-spacing (the strip rule adds 0.5px per character, which
    // `measureText` ignores entirely) - a stale canvas bound to the old stack, or
    // one that skips the tracking, is the same lie one level down. Skipping the
    // tracking is not hypothetical: it is what sliced the last letter off every
    // nav item in the shipped build (3.31 / 2.88 / 2.11 / 1.50px hidden).
    expect(src).toContain('const tracking = resolveLabelTrackingPx(footerRootEl)');
    expect(src).toContain('labelMetrics = createLabelMetrics(family, tracking)');
    // The probe that decides membership must measure the same width the pill
    // paints, or it keeps an item the fit cannot afford.
    const storeSrc = read('src/ui/blocks/layout/layout-store.svelte.ts');
    expect(storeSrc).toContain("resolveLabelTrackingPx(document.querySelector('.floating-nav'))");
    // The canvas font string itself now lives in the ONE shared measurement
    // (`createLabelMetrics`), which both this component and the responsive fitting harness
    // call - the same code cannot measure two different faces.
    const measureSrc = read('src/utils/ui/fit-label-font.ts');
    expect(measureSrc).toContain(`c.font = \`\${weight} \${sizePx}px \${fontFamily}\``);
    expect(src).not.toContain('system-ui, Roboto');
    expect(measureSrc).not.toContain("'system-ui, Roboto");

    // ...and that default stack is the shell's own `body { font-family }`.
    const styles = read('src/styles.css');
    const bodyRule = styles.slice(styles.indexOf('\nbody {'), styles.indexOf('\nbody {') + 400);
    const family = bodyRule.slice(
      bodyRule.indexOf('font-family:') + 'font-family:'.length,
      bodyRule.indexOf(';', bodyRule.indexOf('font-family:'))
    );
    const normalize = (value: string): string =>
      value
        .replace(/\s+/g, ' ')
        .replace(/\s*,\s*/g, ', ')
        .trim();
    expect(normalize(family)).toBe(normalize(BODY_FONT_FAMILY));
  });

  test('the label-width probe measures at the font the pill renders', () => {
    const src = read('src/ui/blocks/layout/layout-store.svelte.ts');
    expect(src).toContain('NAV_LABEL_DEFAULT_FONT_PX * localeFontScale');
    expect(src).not.toMatch(/\d+ \* localeFontScale/);
  });

  test('the indicator IS the segment - same box, no overhang', () => {
    // It used to be `width + 6` at `left - 3` (i.e. a 3px bleed on each side).
    // That is asymmetric the moment the active item is the FIRST one: the offset
    // clamps at the island's edge, so all 6px of overhang landed on the right and
    // ate the neighbour's padding - the pill visibly touching the next label's
    // first letter. On the LAST item the same arithmetic pushed the fill 3px
    // outside the island. The two literals are the fix; the assignments pin what
    // replaced them. Scanned on the syntax-only view so the doc comment above
    // `applyPillBox`, which quotes both numbers, cannot satisfy or trip it.
    const src = stripComments(read('src/ui/blocks/layout/Footer.svelte'));
    expect(src).not.toMatch(/width\s*\+\s*6/);
    expect(src).not.toMatch(/left\s*-\s*3/);
    expect(src).toContain('pillWidth = box.w;');
    expect(src).toContain('pillOffset = box.left;');
    // The box is the active item's, differenced against the nav's own rect - the
    // same geometry CSS lays out, so the pill cannot disagree with the button.
    expect(src).toContain('left: targetRect.left - navRect.left');
  });

  test('the demo-mode badge is anchored to the island, not the shell safe area', () => {
    const src = read('src/ui/blocks/layout/FloatingFooter.svelte');
    expect(src).toContain('bottom: calc({NAV_FLOAT_BOTTOM_PX}px + {NAV_FAB_SIZE_PX}px + 0.5rem)');
    // `--footer-safe` is the CONTENT safe area, owned by AppShell: reading it
    // here is what let the badge drift away from the island above it. (The
    // comment above may still name it - the assertion is about a `var()` use.)
    expect(src).not.toMatch(/var\(--footer-safe/);
  });
});
