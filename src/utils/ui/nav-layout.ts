/**
 * Single source of truth for the adaptive bottom navigation layout.
 *
 * Both the floating Footer nav and the narrow-layout Header need to know which
 * primary pages currently live inside the More menu:
 *   - Footer renders the primary nav + the More overflow menu.
 *   - Header shows the page title of the active page ONLY while that page
 *     lives inside More (no hardcoded page list - driven by the same math,
 *     including the user's custom navbar order).
 *
 * NAVBAR ITEMS ARE FLAG-DRIVEN: each top-level view opts into the navbar by
 * exporting `navBarItem` from its co-located `*.nav.ts` module (see e.g.
 * src/ui/views/AutomationView.nav.ts). The NAV_FLAGS registry below collects
 * those flags and derives the canonical order, labels and icons - the reorder
 * settings UI, the sidebar and the More split all read from this one place, so
 * they can never drift. A view WITHOUT a flag is never in the navbar, and
 * sub-page views (settings subpages, detail pages, …) are rejected by
 * validateNavFlags - they cannot be promoted.
 *
 * The primary/More split is LOCALE-AWARE: when the translated label widths are
 * measured (AppLayout measures them per locale), items stay in the primary nav
 * only while they actually fit the shell width; wide labels (e.g. German)
 * push items into More earlier than narrow labels (e.g. English). The fixed
 * pixel ladder (stageForWidth) is only the pre-measurement fallback.
 */

import type { View } from '@/features/types/view-types.js';
import type { KnownIconName } from '@/ui/components/icons/icon-names.js';
import { navBarItem as aboutNavBarItem } from '@/ui/views/AboutView.nav.js';
import { navBarItem as activityNavBarItem } from '@/ui/views/ActivityView.nav.js';
import { navBarItem as automationNavBarItem } from '@/ui/views/AutomationView.nav.js';
import { navBarItem as addressesNavBarItem } from '@/ui/views/addresses/AddressesView.nav.js';
import { navBarItem as autofillNavBarItem } from '@/ui/views/autofill/AutofillView.nav.js';
import { navBarItem as mailboxNavBarItem } from '@/ui/views/mailbox/MailboxView.nav.js';
import { navBarItem as organizeNavBarItem } from '@/ui/views/OrganizeView.nav.js';
import { navBarItem as settingsNavBarItem } from '@/ui/views/SettingsView.nav.js';
import { NAV_PLUS_ORGANIZE_MIN, NAV_SEVEN_MIN, NAV_SIX_MIN } from '@/utils/ui/breakpoints.js';

export type NavItem = { view: View | 'more'; labelKey: string; iconName: KnownIconName };
export type MoreItem = { view: View; labelKey: string; iconName: KnownIconName };
export type NavStage = 'compact' | 'plus_organize' | 'six' | 'seven';

// ── Floating-pill geometry ───────────────────────────────────────────────────
//
// ONE source for every number that the pill's style block, its font fitters and
// the label-width probe all need. The pill is a segmented NAV (with an elastic
// active indicator, a collapsing active icon and a More overflow menu), not an
// action-button row, so it keeps its own fitter rather than `responsiveButtonLayout`
// (AGENTS.md §8 governs action rows). These constants are what stop the two
// geometry owners - `Footer.svelte`'s CSS and its budget math - from drifting:
// the same 15 used to be written in four places, and the label font default had
// three different values (13 / 12 / 13).

/** Horizontal padding of a .nav-item button (8px 14px). */
export const NAV_ITEM_PADDING_PX = 28;
/**
 * The `gap-1.5` between the pill and the FAB. NOT an inter-item gap: the nav
 * items sit flush against each other, and reserving `(n - 1) × 6` for a gap
 * that does not exist is precisely the arithmetic error that made every locale
 * render over budget and let the labels paint outside the pill.
 */
export const NAV_GAP_PX = 6;
/** Per-side float inset (`.bottom-nav-container` padding-inline). */
export const NAV_FLOAT_INSET_PX = 15;
/** Floating strips use the same available span as the navbar + FAB row.
 * Resolve against the owning pane, so split views stay inside their list pane. */
export const NAV_FLOAT_CONTENT_WIDTH_CSS = `calc(100% - ${2 * NAV_FLOAT_INSET_PX}px)`;
/**
 * Gap between the floating island and the shell's bottom edge
 * (`.footer-float` padding-bottom). The demo-mode badge is anchored to the
 * island through this same value - it used to read `--footer-safe`, a
 * different variable owned by the shell, so it drifted away from the island
 * whenever the safe area changed.
 */
export const NAV_FLOAT_BOTTOM_PX = 10;
/**
 * Circular FAB - `.fab-btn` min-width/min-height (2.25rem). It is square via
 * `aspect-ratio: 1/1` and stretches with the pill, so in a font-scaled locale
 * the rendered FAB can be slightly larger than this floor.
 */
export const NAV_FAB_SIZE_PX = 36;
/**
 * Headroom on the reserved outer width for the stretch above: a taller pill
 * (font-scaled locale) widens the FAB, which the split must not mistake for
 * label space.
 */
export const NAV_SCALE_HEADROOM_PX = 4;
/** Pre-fit label font (the fitters' initial state) - see the pill's CSS. */
export const NAV_LABEL_DEFAULT_FONT_PX = 13;
/**
 * Fitter starting size for the primary pill - 14, the label font of the XS/S
 * action tiers, so the pill at full size reads at the sanctioned button size.
 */
export const NAV_LABEL_BASE_FONT_PX = 14;
/**
 * Fitter floor for the primary pill. Deliberately BELOW the action tiers' 12px
 * floor: the pill must fit every locale's labels with no truncation at popup
 * width, and a wider language (German, Thai) needs the extra step.
 *
 * 10 rather than 11 because the FLOOR is the last lever before the row either
 * cuts a glyph or drops an item, and both of those are worse: a 360px popup in
 * Thai with a `99+` count is ~10px over at 11px, and the only alternatives were
 * a sliced last letter on every segment or a fourth segment in the More menu.
 * The loop below reaches this size ONLY while the row is still over budget, so a
 * row that fits at 11px never sees it - measured across en/de/ar/ja/zh/th at
 * 360px with and without a count, nothing shrank except the rows that were
 * otherwise over. The matching probe in `layout-store` measures affordability at
 * THIS font, so membership and the fit still answer the same question.
 */
export const NAV_LABEL_MIN_FONT_PX = 10;
/** Authored per-side item padding (`.nav-item { padding: 8px 14px }`). */
export const NAV_ITEM_PAD_X_MAX_PX = NAV_ITEM_PADDING_PX / 2;
/**
 * Item-padding floor - the XS/S action tiers' minimum side padding (pinned by
 * a test against `ACTION_BTN_TIERS.XS.minSidePad`), so compressing the pill's
 * spacing can never squeeze a hit target below the sanctioned minimum.
 */
export const NAV_ITEM_PAD_X_MIN_PX = 4;
/**
 * Reference icon height at the 14px label size. Production uses navIconSizePx
 * to scale the icon box with each fitted label; the standalone preview can
 * still use this reference size directly.
 */
export const NAV_ICON_SIZE_PX = 18;
/** Preserve the navbar's 18px icon / 14px label proportion at every fitted size. */
export function navIconSizePx(labelFontPx: number): number {
  return (NAV_ICON_SIZE_PX / NAV_LABEL_BASE_FONT_PX) * labelFontPx;
}
/**
 * Authored block padding of a nav item (`.nav-item { padding: 8px … }`, per
 * side). The block-START half is a floor, not a value: the badge placement may
 * raise it to open the superscript lane (see `navBadgePlacementPx`).
 */
export const NAV_ITEM_PAD_BLOCK_PX = 8;
/** Authored block padding of a More-menu row (row is `padding: var(--more-menu-pad-block-start) 10px 6px`). */
export const MORE_ITEM_PAD_BLOCK_PX = 6;
/**
 * More-menu item inline padding - the reserve `navBadgeEndPadPx` adds the badge
 * box to, and the count's own inset there. Shared so the CSS cannot hold a
 * second copy of it.
 */
export const MORE_ITEM_PAD_X_PX = 10;
/**
 * Label font weight - the value the pill AND the More menu paint their labels
 * with, and the weight every measurement of those labels MUST pass to the
 * canvas/span probes (`fitNavPill`, the badge placement ink, the More menu's
 * fitter, `layoutStore.refreshNavLabelWidths`). A bolder face is wider; a probe
 * that measures a lighter face than the one painted reserves less width than
 * the row spends, which is exactly how labels used to get their last letter
 * shaved. One constant, so paint and measurement cannot drift.
 */
export const NAV_LABEL_FONT_WEIGHT = 700;
/** Unread-badge glyph size (`.nav-badge { font-size: 9px }`). */
export const NAV_BADGE_FONT_PX = 9;
/**
 * Unread-badge box height, pinned to `.nav-badge { height: 14px; line-height: 14px }`.
 * The placement math needs it because the badge's box has to fit ABOVE the
 * label's glyph ink - it is a superscript, not a corner sticker.
 */
export const NAV_BADGE_HEIGHT_PX = 14;
export const NAV_DOT_SIZE_PX = 7;
/** Horizontal room reserved after the label for its status dot. */
export const NAV_DOT_GAP_PX = 4;
/** Clear space above the anchored glyph's ink before its status dot. */
export const NAV_DOT_INK_GAP_PX = 5;
/**
 * Icon→label gap inside an ACTIVE nav item (`.nav-item.active .nav-icon
 * { margin-inline-end }`). The pill's collapsed-icon transition is what makes
 * this its own token rather than the tier's `iconGap`; §8's coupled reduction
 * would derive it as `coupledIconGap(tier, padX)`.
 */
export const NAV_ICON_GAP_PX = 3;
/**
 * Nav item / pill / More-menu item AND More-menu island corner radius
 * (`.nav-item`, `.pill-indicator`, `.more-menu-item`, `.more-menu-nav
 * { border-radius }`). A token, not a literal, because the boxes must stay the
 * same shape: the active pill's fill is the item's own box, the indicator is a
 * second copy of that radius, and the menu island carries it too - its corner
 * items sit 4px from the island's corners, so a larger island radius is
 * compared directly and reads as a bubble around mini pills.
 */
export const NAV_ITEM_RADIUS_PX = 28;
/**
 * Island radius (`.floating-nav { border-radius }` only) - the floating pill's
 * own shape. The More menu island deliberately does NOT use it: it carries the
 * item radius instead (see above). Both are tokens so the pill, the menu and
 * the visual harness cannot disagree about the outline.
 */
export const NAV_ISLAND_RADIUS_PX = 36;
/** Unread-badge inline padding (`.nav-badge { padding: 0 3px }`, per side). */
export const NAV_BADGE_PAD_X_PX = 3;
/** Unread-badge minimum width (`.nav-badge { min-width: 14px }`). */
export const NAV_BADGE_MIN_W_PX = 14;
/**
 * The widest text the count ever renders. The badge's reserve is sized for THIS
 * and never for the current count, so unread arriving cannot resize the island -
 * and so membership reserves the same box the pill's fitter charges for.
 */
export const NAV_BADGE_WIDEST_TEXT = '99+';

/**
 * The count's text for a given unread total - the ONE spelling of `99+`, shared
 * by the pill, the More menu and the layout store's reserve probe, so the string
 * the fit reserves space for is the string that renders.
 */
export function navBadgeTextFor(totalUnread: number): string {
  return totalUnread > 99 ? NAV_BADGE_WIDEST_TEXT : String(totalUnread);
}
/**
 * Inline gap between the label's ink end and the badge's box - ZERO, by design.
 *
 * The count's bottom-LEFT corner sits ON the last letter's glyph-ink top-right
 * corner, so the badge's box begins exactly where that letter's ink ends. The
 * reserve is therefore the badge box plus the row's own side padding and nothing
 * else: any positive gap here pushes the count off the letter it caps.
 *
 * The count's distance to the segment's rim is NOT a constant of this file: it
 * is the running surface's own side padding, injected as `--nav-badge-inset`
 * (`padX` for the pill, the item padding for the More menu). A bespoke 2px
 * constant used to live here, which put the count at half the XS/S tiers' 4px
 * side-padding floor - and since the active segment's box IS the selected
 * pill's fill, the count then read as sitting on the pill's edge. Every row's
 * padding is itself floored at that tier minimum, so the count can never be
 * closer to a rim than the sanctioned spacing.
 */
export const NAV_BADGE_GAP_PX = 0;
/**
 * Reserved for the FAB + the gap + the floating inset on BOTH sides of the pill
 * plus the font-scale headroom (2×15 + 36 + 6 + 4 = 76). Shared by
 * `fitPrimaryCount` (which splits primary vs More) and the pill's font budget,
 * so the split and the fitting agree on one number and an item is never kept
 * that would stick out past the pill's rounded edges.
 */
export const NAV_RESERVED_OUTER_PX =
  2 * NAV_FLOAT_INSET_PX + NAV_FAB_SIZE_PX + NAV_GAP_PX + NAV_SCALE_HEADROOM_PX;
/** The More button may never push primary items below this count (auto mode). */
export const MIN_PRIMARY_ITEMS = 3;
/**
 * The pill's fixed, per-ROW cost that is not part of any item's label: the one
 * expanded icon the active primary item draws (icon + its gap). The fitter
 * charges it once and membership never used to, so a row that membership called
 * affordable could still be over budget by this much and shave every label.
 */
export const NAV_PILL_ICON_LANE_PX = NAV_ICON_SIZE_PX + NAV_ICON_GAP_PX;

/**
 * How many primary items stay visible before the rest collapse into More.
 *
 * - 'auto' (default): fit as many as the shell width allows, with a hard
 *   floor of MIN_PRIMARY_ITEMS (the classic locale-aware behavior).
 * - 1 | 2 | 3: the user FORCES a fixed count - at most that many items stay
 *   primary (fewer only if the shell is too narrow to fit them), and the
 *   rest always go into More, even on wide shells. Backed by the
 *   `minPrimaryItems` storage setting (see NavbarOrderSettingsView).
 */
export type PrimaryItemsPref = 'auto' | 1 | 2 | 3;

/** Coerce unknown storage input (garbage, missing, string) to a valid pref. */
export function normalizePrimaryItemsPref(raw: unknown): PrimaryItemsPref {
  if (raw === 1 || raw === 2 || raw === 3) return raw;
  return 'auto';
}

/**
 * A view's declaration that it wants a slot in the navbar. Views opt in by
 * exporting this from their co-located `*.nav.ts` module.
 *
 * `order` is the item's position in the navbar (1-based; must be unique and
 * exactly 1..N with no gaps - validateNavFlags throws on collisions and gaps,
 * and the build runs scripts/check-nav-flags.ts so a bad order fails the
 * build). Removing an item forces renumbering.
 *
 * `key` is the canonical navbar key (also the id persisted in customNavOrder);
 * `view` is the view rendered when the item is active - it may differ from the
 * key (e.g. the Activity item has key 'activity' but renders view 'analytics').
 */
export interface NavBarFlag {
  /** 1-based navbar position - unique, and exactly 1..N with no gaps. */
  order: number;
  key: string;
  view: View;
  labelKey: string;
  iconName: KnownIconName;
}

/**
 * The navbar registry - every item in the navbar. Adding a navbar item =
 * declare a flag in the view's *.nav.ts and list it here. The array order is
 * cosmetic; the authoritative order is each flag's explicit `order` field
 * (see NAV_FLAGS_ORDERED).
 */
export const NAV_FLAGS = [
  mailboxNavBarItem,
  addressesNavBarItem,
  autofillNavBarItem,
  organizeNavBarItem,
  automationNavBarItem,
  activityNavBarItem,
  settingsNavBarItem,
  aboutNavBarItem,
] as const satisfies readonly NavBarFlag[];

/** Canonical navbar keys (ids used in customNavOrder and label measurement). */
export type NavKey = (typeof NAV_FLAGS)[number]['key'];

/** NAV_FLAGS sorted by each flag's explicit `order` field. */
export const NAV_FLAGS_ORDERED: ReadonlyArray<(typeof NAV_FLAGS)[number]> = [...NAV_FLAGS].sort(
  (a, b) => a.order - b.order
);

/** Canonical navbar order, derived from the flags' `order` fields. */
export const DEFAULT_NAV_ORDER: NavKey[] = NAV_FLAGS_ORDERED.map((f) => f.key);

export type NavIndicatorMode = 'dot' | 'count';

/** Normalize item-keyed indicator preferences; every new nav item starts as a dot. */
export function normalizeNavIndicatorModes(raw: unknown): Record<string, NavIndicatorMode> {
  const input =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(
    DEFAULT_NAV_ORDER.map((key) => [key, input[key] === 'count' ? 'count' : 'dot'])
  );
}

/** Canonical nav keys + the More item, with their translation keys. */
export const NAV_LABEL_KEYS: ReadonlyArray<{ key: string; labelKey: string }> = [
  ...NAV_FLAGS_ORDERED.map((f) => ({ key: f.key, labelKey: f.labelKey })),
  { key: 'more', labelKey: 'nav.more' },
];

/** Canonical nav key → nav item (label key + Material Symbol icon name). */
const NAV_ITEM_BY_KEY = new Map<string, MoreItem>(
  NAV_FLAGS.map((f) => [f.key, { view: f.view, labelKey: f.labelKey, iconName: f.iconName }])
);
const NAV_KEY_BY_VIEW = new Map<string, string>(NAV_FLAGS.map((flag) => [flag.view, flag.key]));

/** Resolve a rendered view id back to the persisted canonical nav item key. */
export function navKeyForView(view: View | 'more'): string {
  return NAV_KEY_BY_VIEW.get(view) ?? view;
}

/**
 * Views that must NEVER appear as standalone navbar items - settings subpages
 * (mailProvider, diagnostics, …), detail pages (mailView, addressView, …) and
 * internal pages (playground). validateNavFlags rejects any flag referencing
 * one of these.
 */
export const SUBPAGE_VIEWS: ReadonlySet<View> = new Set<View>([
  'loginInfo',
  'addressView',
  'mailView',
  'identities',
  'keybindings',
  'tagManagement',
  'filtersManagement',
  'labelManagement',
  'mailProvider',
  'storagePerformance',
  'constantsSettings',
  'diagnostics',
  'playground',
]);

/**
 * Fail-fast validation for the navbar registry: duplicate keys, duplicate
 * views, duplicate/non-positive order values and sub-page promotions are
 * configuration errors and throw. Runs at module load AND via
 * scripts/check-nav-flags.ts during `bun run build`, so a collision fails
 * the build.
 */
export function validateNavFlags(flags: readonly NavBarFlag[]): void {
  const seenKeys = new Set<string>();
  const seenViews = new Set<View>();
  const seenOrders = new Set<number>();
  for (const flag of flags) {
    if (seenKeys.has(flag.key)) {
      throw new Error(
        `Navbar flag: duplicate key '${flag.key}' - each navbar item needs a unique key.`
      );
    }
    if (seenViews.has(flag.view)) {
      throw new Error(
        `Navbar flag: duplicate view '${flag.view}' - each navbar item needs a unique view.`
      );
    }
    if (!Number.isInteger(flag.order) || flag.order < 1) {
      throw new Error(
        `Navbar flag: '${flag.key}' has invalid order ${flag.order} - order must be a positive integer.`
      );
    }
    if (seenOrders.has(flag.order)) {
      throw new Error(
        `Navbar flag: order collision - '${flag.key}' and another flag both declare order ${flag.order}. Each navbar item needs a unique order.`
      );
    }
    if (SUBPAGE_VIEWS.has(flag.view)) {
      throw new Error(
        `Navbar flag: '${flag.view}' is a sub-page view and cannot be promoted to the navbar.`
      );
    }
    seenKeys.add(flag.key);
    seenViews.add(flag.view);
    seenOrders.add(flag.order);
  }

  // Orders must be exactly 1..N - a gap means an item was added or removed
  // without renumbering, which silently shifts the navbar order.
  for (let i = 1; i <= flags.length; i++) {
    if (!seenOrders.has(i)) {
      throw new Error(
        `Navbar flag: order gap - no flag declares order ${i} of 1..${flags.length}. Orders must be exactly 1..${flags.length} (renumber when adding or removing items).`
      );
    }
  }
}
validateNavFlags(NAV_FLAGS);

/**
 * Adaptive primary nav (base always: Mailbox · Addresses · Autofill).
 *
 * 7 items (≥520px): Mailbox · Addresses · Autofill · Organize · Automation · Activity · Settings · About
 * 6 items (≥440px): … + Organize · Automation · More(Activity · Settings · About)
 * 5 items (≥400px): … + Organize · More(Automation · Activity · Settings · About)
 * 4 items (<400px): … · More(Organize · Automation · Activity · Settings · About)
 *
 * NOTE: this pixel ladder is only the pre-measurement fallback. Once the real
 * translated label widths are known (see computeNavLayout), the split is
 * computed from measured widths instead.
 */
export function stageForWidth(w: number): NavStage {
  if (w >= NAV_SEVEN_MIN) return 'seven';
  if (w >= NAV_SIX_MIN) return 'six';
  if (w >= NAV_PLUS_ORGANIZE_MIN) return 'plus_organize';
  return 'compact';
}

/**
 * Locale-aware fit: how many primary items fit the shell width, given the
 * measured translated label widths (label text width + .nav-item padding + the
 * unread count's own reserve on the mailbox item). Falls back to a per-item
 * estimate when a view hasn't been measured.
 *
 * When `pref` is a fixed count (not 'auto'), it acts as a cap: at most that
 * many items stay primary (fewer only when the shell is too narrow to fit
 * them), and the More button is always shown - the user asked for a compact
 * bar, so even a wide shell keeps the overflow in More.
 */
function fitPrimaryCount(
  shellWidth: number,
  orderedViews: string[],
  measured: Record<string, number>,
  pref: PrimaryItemsPref,
  /**
   * Each item's width at the pill's FLOOR font and padding (see the store's
   * probe): the smallest the row can ever be drawn. Optional - without it the
   * `MIN_PRIMARY_ITEMS` floor is unconditional, as it was before the pill's
   * affordability could be tested at all.
   */
  floorMeasured?: Record<string, number>
): number {
  // What the pill is left with, not what the shell is: the FAB/inset reserve
  // AND the active item's icon lane, which the row pays once and every item
  // width below is measured without.
  const avail = shellWidth - NAV_RESERVED_OUTER_PX - NAV_PILL_ICON_LANE_PX;
  const forced = pref !== 'auto';
  /**
   * One segment's share of the row, and NOTHING between segments.
   *
   * The measured width already carries the item's own padding (and the count's
   * reserve on the item that pays it), and nav items are ADJACENT - `NAV_GAP_PX`
   * is the gap between the pill and the FAB, which `NAV_RESERVED_OUTER_PX`
   * already subtracts. The split used to add it per item anyway, reserving
   * `6 x (n + 1)` for a gap the row never spends; `fitNavPill`, which owns the
   * real row, has never counted it (`fixedWidth` sums padding + the one active
   * icon and stops). The two models disagreeing by 6px per item is what made
   * membership drop a primary item the pill could actually pay for - Thai at
   * popup width fell from Mailbox · Addresses · Autofill · More to three
   * segments. One row, one width model: this is the fitter's.
   */
  const widthOf = (widths: Record<string, number>, key: string): number => widths[key] ?? 64;

  // Auto mode: try the full set first (no More button needed) - all fit.
  if (!forced) {
    let total = 0;
    for (const v of orderedViews) total += widthOf(measured, v);
    if (total <= avail) return orderedViews.length;
  }

  // Otherwise reserve room for the More button and greedily keep items primary
  // while they fit (in the user's order). More is one more adjacent segment.
  const greedy = (widths: Record<string, number>): number => {
    const availPrimary = avail - widthOf(widths, 'more');
    let running = 0;
    let count = 0;
    for (const v of orderedViews) {
      const w = widthOf(widths, v);
      if (running + w > availPrimary) break;
      running += w;
      count++;
    }
    return count;
  };

  const count = greedy(measured);
  if (forced) return Math.max(1, Math.min(count, pref));
  // Auto mode PREFERS `MIN_PRIMARY_ITEMS` primary items: `count` is measured at
  // the REFERENCE font, and the pill may shrink its labels below that, which is
  // why the floor is normally reachable and stays unconditional.
  const preferred = Math.max(MIN_PRIMARY_ITEMS, count);
  if (!floorMeasured) return preferred;
  // The exception is the row that cannot be paid for even at the pill's FLOOR
  // font and padding. That state used to be invisible - membership called the
  // row affordable, the fitter reported `overBudgetPx`, and the flexbox spread
  // the deficit across EVERY label instead of declaring it, shaving a few pixels
  // off each last letter (a 320px shell in a wide locale with a count). The
  // responsive fitting's overflow lever for a row that cannot fit is fewer buttons, with
  // the displaced view still reachable through More - never a sliced glyph.
  const affordable = Math.max(1, greedy(floorMeasured));
  return Math.max(1, Math.min(preferred, affordable));
}

/** Map a measured count back to the closest ladder stage label (display only). */
function stageLabelForCount(count: number): NavStage {
  if (count >= 8) return 'seven';
  if (count >= 5) return 'six';
  if (count === 4) return 'plus_organize';
  return 'compact';
}

/** All canonical pages as nav items (no More) - shared by the sidebar. */
export function canonicalNavItems(): NavItem[] {
  return DEFAULT_NAV_ORDER.map(navItemFor);
}

/**
 * Canonical nav key → nav item (label key + Material Symbol icon name).
 * Exported so the reorder settings UI renders the exact same labels/icons as
 * the real nav (single source of truth - cannot drift).
 */
export function navItemFor(key: string): MoreItem {
  return (
    NAV_ITEM_BY_KEY.get(key) ?? { view: 'mailbox', labelKey: 'nav.mailbox', iconName: 'inbox' }
  );
}

/**
 * Whether the canonical nav item `key` is the one that carries the unread count.
 *
 * Deliberately NOT `navItemFor(key).view === 'mailbox'`: `navItemFor` falls back
 * to the mailbox item for keys it does not know, and `more` is one of them - so
 * that spelling would charge the count's reserve to the More button as well and
 * over-reserve the row by a badge's width.
 */
export function navKeyCarriesUnreadCount(key: string): boolean {
  return NAV_ITEM_BY_KEY.get(key)?.view === 'mailbox';
}

export interface NavLayout {
  stage: NavStage;
  primaryNav: NavItem[];
  moreItems: MoreItem[];
  /** Canonical view ids that currently live inside the More menu. */
  moreViewSet: ReadonlySet<View>;
}

/**
 * A stored/custom navbar order, repaired into a usable list.
 *
 * `customNavOrder` is user-writable and syncs between devices, so whatever the
 * nav renders from can be anything: an unknown key from a retired view, a
 * non-string, or a key repeated (two writes that raced, a manual edit, a sync
 * conflict). Every one of those is a duplicate or a stranger in a KEYED list
 * (`{#each primaryNav as item (item.view)}`) - and a repeated key is a Svelte
 * error, not a cosmetic double item. One repair, at the pipeline's entry, so the
 * pill, the More menu and the reorder screen cannot each answer differently:
 *
 *   - only canonical keys survive, each at most ONCE (first position wins);
 *   - every canonical key is present, the missing ones appended in canonical
 *     order, so an order stored by an older release still shows every item.
 *
 * An input carrying no usable key yields the canonical order - which is what
 * "empty means canonical" means downstream.
 */
export function normalizeNavOrder(raw: unknown): NavKey[] {
  const ordered: NavKey[] = [];
  const seen = new Set<string>();
  for (const value of Array.isArray(raw) ? raw : []) {
    if (typeof value !== 'string' || seen.has(value)) continue;
    if (!DEFAULT_NAV_ORDER.includes(value as NavKey)) continue;
    seen.add(value);
    ordered.push(value as NavKey);
  }
  for (const key of DEFAULT_NAV_ORDER) if (!seen.has(key)) ordered.push(key);
  return ordered;
}

export function computeNavLayout(
  shellWidth: number,
  customNavOrder: string[] = [],
  measuredItemWidths: Record<string, number> = {},
  minPrimary: PrimaryItemsPref = 'auto',
  /**
   * The same items measured at the pill's FLOOR font and padding. Letting the
   * `MIN_PRIMARY_ITEMS` floor yield is only sound against these numbers: the
   * reference-font count is conservative by design, so capping to it would drop
   * a normal 360px shell to two items.
   */
  floorItemWidths: Record<string, number> = {}
): NavLayout {
  const fallbackStage = stageForWidth(shellWidth);
  // Repaired first (invalid and duplicate keys dropped, missing canonical items
  // appended), so nothing downstream can render a stranger as a nav item or the
  // same view twice - a repeated key in a keyed list is an error, not a wart.
  const fullOrder = normalizeNavOrder(customNavOrder);

  const hasMeasurements = Object.keys(measuredItemWidths).length > 0;
  const fallbackLadder =
    fallbackStage === 'seven'
      ? 8
      : fallbackStage === 'six'
        ? 5
        : fallbackStage === 'plus_organize'
          ? 4
          : 3;
  const countVisible = hasMeasurements
    ? fitPrimaryCount(
        shellWidth,
        fullOrder,
        measuredItemWidths,
        minPrimary,
        Object.keys(floorItemWidths).length ? floorItemWidths : undefined
      )
    : minPrimary === 'auto'
      ? fallbackLadder
      : Math.min(fallbackLadder, minPrimary);

  if (countVisible >= 8) {
    return {
      stage: 'seven',
      primaryNav: fullOrder.map(navItemFor),
      moreItems: [],
      moreViewSet: new Set(),
    };
  }

  const primaryKeys = fullOrder.slice(0, countVisible);
  const overflowKeys = fullOrder.slice(countVisible);

  const primaryNav: NavItem[] = [
    ...primaryKeys.map(navItemFor),
    { view: 'more', labelKey: 'nav.more', iconName: 'moreHoriz' },
  ];
  const moreItems: MoreItem[] = overflowKeys.map(navItemFor);
  return {
    stage: hasMeasurements ? stageLabelForCount(countVisible) : fallbackStage,
    primaryNav,
    moreItems,
    moreViewSet: new Set<View>(moreItems.map((m) => m.view)),
  };
}

/** Map a (possibly deep / sub-page) view to its canonical primary nav key. */
export function parentNavKey(view: View): View {
  switch (view) {
    case 'addressAccentColors':
      return 'settings';
    case 'tagManagement':
    case 'labelManagement':
    case 'filtersManagement':
      return 'organize';
    default:
      return view;
  }
}

/**
 * The nav's FIXED rendered geometry, as CSS custom properties - the one bridge
 * from these constants into the stylesheet.
 *
 * Every box the pill, the indicator and the count are drawn from is one of these
 * values, so the stylesheet must not spell any of them: a literal in a `<style>`
 * block is a second copy that no test can compare against the constant it
 * shadows, while a var appears in exactly one place (`navTokenStyle()`) and is
 * read by the app AND by `tests/visual/preview-responsive-button-layout.html`.
 *
 * Fit-dependent numbers (`--nav-font-size`, `--nav-item-pad-x(-end)`,
 * `--nav-item-pad-block-start`, `--nav-badge-bottom`, `--nav-badge-inset`) are
 * injected per fit, per surface, as they already were.
 */
export const NAV_TOKEN_VARS = {
  '--nav-item-radius': NAV_ITEM_RADIUS_PX,
  '--nav-island-radius': NAV_ISLAND_RADIUS_PX,
  '--nav-icon-size': NAV_ICON_SIZE_PX,
  '--nav-icon-gap': NAV_ICON_GAP_PX,
  '--nav-label-weight': String(NAV_LABEL_FONT_WEIGHT),
  '--nav-badge-height': NAV_BADGE_HEIGHT_PX,
  '--nav-badge-font-size': NAV_BADGE_FONT_PX,
  '--nav-badge-pad-x': NAV_BADGE_PAD_X_PX,
  '--nav-badge-min-w': NAV_BADGE_MIN_W_PX,
  '--more-menu-pad-x': MORE_ITEM_PAD_X_PX,
  '--more-menu-pad-block-end': MORE_ITEM_PAD_BLOCK_PX,
} as const;

/** `NAV_TOKEN_VARS` as an inline `style` fragment, for the pill's island root. */
export function navTokenStyle(): string {
  return Object.entries(NAV_TOKEN_VARS)
    .map(([name, value]) => `${name}: ${typeof value === 'number' ? `${value}px` : value}`)
    .join('; ');
}
