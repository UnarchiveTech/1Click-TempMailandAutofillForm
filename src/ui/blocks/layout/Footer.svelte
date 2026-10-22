<script lang="ts">
import { onDestroy, tick } from 'svelte';
import { locale, t } from 'svelte-i18n';
import { registerEscapeTier } from '@/features/keyboard-shortcuts/escape-stack.js';
import type { View } from '@/features/types/view-types.js';
import { layoutStore } from '@/ui/blocks/layout/layout-store.svelte.js';
import {
  activeFabActionStore,
  type FloatingActionDescriptor,
} from '@/ui/components/composites/fab-action-store.js';
import ProviderCreateMenu from '@/ui/components/composites/ProviderCreateMenu.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import NavIconIndicator from '@/ui/components/primitives/NavIconIndicator.svelte';
import type { Address, ProviderInstance } from '@/utils/types.js';
import { anchoredFlyout } from '@/utils/ui/anchored-flyout.js';
import {
  BODY_FONT_FAMILY,
  createLabelMetrics,
  fitLabelFontSize,
  resolveLabelFontFamily,
  resolveLabelTrackingPx,
} from '@/utils/ui/fit-label-font.js';
import {
  badgeAnchorText,
  fitNavPill,
  navBadgeEndPadPx,
  navBadgePlacementPx,
  navBadgeWidthPx,
} from '@/utils/ui/fit-nav-pill.js';
import {
  arrangeMoreItems,
  moreClickIntent,
  moreSnapshotVerdict,
  splitMoreRows,
} from '@/utils/ui/more-menu-layout.js';
import {
  MORE_ITEM_PAD_BLOCK_PX,
  MORE_ITEM_PAD_X_PX,
  type MoreItem,
  NAV_BADGE_HEIGHT_PX,
  NAV_DOT_GAP_PX,
  NAV_DOT_INK_GAP_PX,
  NAV_DOT_SIZE_PX,
  NAV_FAB_SIZE_PX,
  NAV_FLOAT_BOTTOM_PX,
  NAV_FLOAT_INSET_PX,
  NAV_ICON_GAP_PX,
  NAV_ICON_SIZE_PX,
  NAV_ITEM_PAD_BLOCK_PX,
  NAV_ITEM_PAD_X_MAX_PX,
  NAV_LABEL_DEFAULT_FONT_PX,
  NAV_LABEL_FONT_WEIGHT,
  NAV_LABEL_MIN_FONT_PX,
  NAV_RESERVED_OUTER_PX,
  navBadgeTextFor,
  navIconSizePx,
  navKeyForView,
  navTokenStyle,
} from '@/utils/ui/nav-layout.js';
import { PORTAL_Z_CLASS } from '@/utils/ui/portal-layers.js';
import {
  fabIconForKind,
  fabKindForView,
  fabLabelKeyForKind,
  isFabActionDisabled,
  type OrganizeTabKind,
  type SidebarFabKind,
} from '@/utils/ui/sidebar-fab.js';

/**
 * Rendered geometry of the floating pill / More menu (mirrors the component
 * style block). The values shared with the nav layout math - inset, FAB size,
 * inter-item gap, item padding and the label font - come from
 * `@/utils/ui/nav-layout.js`, so this component cannot hold a second copy of
 * them; only the More-menu-only numbers are local.
 */
const NAV_ICON_GAP = NAV_ICON_GAP_PX; // .nav-item.active .nav-icon margin-inline-end
const MORE_MENU_PAD = 4; // .more-menu-nav padding
const MORE_GAP = 4; // .more-menu-nav gap
const MORE_ITEM_PAD_X = MORE_ITEM_PAD_X_PX; // .more-menu-item inline padding

/** Views that light up the More tab as active (subset left in More after expansion) */
const DEEP_MORE_VIEWS = new Set<View>([
  'tagManagement',
  'labelManagement',
  'filtersManagement',
  'keybindings',
  'mailProvider',
  'storagePerformance',
  'constantsSettings',
  'diagnostics',
]);

export type FooterFabKind = SidebarFabKind;

let {
  currentView = 'mailbox',
  onNavigate = () => {},
  accounts = [],
  unreadByAddress = {},
  loading = false,
  onFabClick = () => {},
  onCreateAddressWithProvider = (_providerId: string, _instanceId?: string) => {},
  onOpenProviderSettings = () => {},
  onLongPressNavbar = () => {},
  providerInstances = [] as ProviderInstance[],
  organizeTab = 'tags' as OrganizeTabKind,
  scrollChromeHidden = false,
}: {
  currentView?: View;
  onNavigate?: (view: View) => void;
  accounts?: Address[];
  unreadByAddress?: Record<string, number>;
  loading?: boolean;
  onFabClick?: (kind: FooterFabKind) => void;
  /** Right-click FAB → create with specific provider/instance */
  onCreateAddressWithProvider?: (providerId: string, instanceId?: string) => void;
  /** Gear on provider menu → mail provider settings */
  onOpenProviderSettings?: () => void;
  /** Long-press floating navbar → open Customize Navigation Bar */
  onLongPressNavbar?: () => void;
  providerInstances?: ProviderInstance[];
  organizeTab?: OrganizeTabKind;
  /** Temporarily hide the floating controls while a scroll gesture is active. */
  scrollChromeHidden?: boolean;
} = $props();

let dynamicFab = $derived($activeFabActionStore);

let longPressTimer: ReturnType<typeof setTimeout> | null = null;
let longPressTriggered = false;
let pointerStartX = 0;
let pointerStartY = 0;

function startNavbarLongPress(e: PointerEvent) {
  // What the gesture STARTED with decides whether its click opens or closes the
  // More menu (see `handlePrimaryClick`), so this records before any bail-out.
  moreWasOpenAtPointerDown = moreOpen;
  if (e.button !== 0) return;
  pointerStartX = e.clientX;
  pointerStartY = e.clientY;
  longPressTriggered = false;
  if (longPressTimer) clearTimeout(longPressTimer);
  longPressTimer = setTimeout(() => {
    longPressTriggered = true;
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(50);
      } catch {
        /* ignore */
      }
    }
    if (onLongPressNavbar) {
      onLongPressNavbar();
    }
  }, 500);
}

function cancelNavbarLongPress() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

// Neither pending timer may fire into an unmounted footer (the long-press one
// vibrates and invokes the FAB action; the other closes a menu that is gone).
onDestroy(() => {
  cancelNavbarLongPress();
  cancelMoreClose();
});

function checkNavbarPointerMove(e: PointerEvent) {
  if (!longPressTimer) return;
  const dx = Math.abs(e.clientX - pointerStartX);
  const dy = Math.abs(e.clientY - pointerStartY);
  if (dx > 10 || dy > 10) {
    cancelNavbarLongPress();
  }
}

let moreOpen = $state(false);
/**
 * Whether More was open when the current pointer gesture began.
 *
 * A touch tap delivers an emulated `mouseenter` BEFORE its click, and that hover
 * is the path that opens the menu - so the tap's own click must not toggle it
 * straight back shut (tapping More flashed the menu and nothing could keep it
 * open: More was unusable on touch). Recording the state at pointerdown tells
 * the two apart: a click whose gesture STARTED with the menu open is a real
 * close, and one whose gesture started closed belongs to the open it caused.
 */
let moreWasOpenAtPointerDown = false;
let providerMenuOpen = $state(false);
let providerMenuPos = $state({ x: 0, y: 0 });
/** Leave-delay so More submenu doesn't feel sticky / flicker */
let moreCloseTimer: ReturnType<typeof setTimeout> | null = null;
const MORE_LEAVE_MS = 280;

function cancelMoreClose() {
  if (moreCloseTimer != null) {
    clearTimeout(moreCloseTimer);
    moreCloseTimer = null;
  }
}

function openMoreMenu() {
  cancelMoreClose();
  if (moreItems.length > 0) {
    freezeMoreMenu();
    moreOpen = true;
  }
}

function scheduleCloseMore() {
  cancelMoreClose();
  moreCloseTimer = setTimeout(() => {
    moreOpen = false;
    moreRows = null;
    moreCloseTimer = null;
  }, MORE_LEAVE_MS);
}

function closeMoreNow() {
  cancelMoreClose();
  moreOpen = false;
  moreRows = null;
}

// More is body-portaled, but its anchor disappears when the navigation hides.
// Close it with that anchor rather than leaving an orphaned menu on screen.
$effect(() => {
  if (scrollChromeHidden) closeMoreNow();
});

// Escape dismisses the menu like every other transient surface (registration is
// surface-owned, so the tier cannot outlive the menu). Without it Escape fell
// through to the global handler and NAVIGATED away while the menu was open - a
// panel declaring `role="menu"` had no dismissal path of its own.
$effect(() => {
  if (!moreOpen) return;
  return registerEscapeTier('nav.moreMenu', closeMoreNow);
});

function openProviderMenu(e: MouseEvent | KeyboardEvent) {
  e.preventDefault();
  e.stopPropagation();
  const menuW = 240;
  const menuH = 300;
  const rect =
    e.currentTarget instanceof HTMLElement ? e.currentTarget.getBoundingClientRect() : null;
  let x = e instanceof MouseEvent ? e.clientX : rect?.left || 8;
  let y = e instanceof MouseEvent ? e.clientY : rect?.bottom || 8;
  x = Math.max(8, Math.min(x, window.innerWidth - menuW - 8));
  y = Math.max(8, Math.min(y - 40, window.innerHeight - menuH - 8));
  if (y < 8) y = 8;
  providerMenuPos = { x, y };
  providerMenuOpen = true;
  closeMoreNow();
}

function onProviderMenuKeydown(event: KeyboardEvent) {
  if (
    fabKind === 'createAddress' &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))
  )
    openProviderMenu(event);
}

function pickProvider(providerId: string, instanceId?: string) {
  providerMenuOpen = false;
  onCreateAddressWithProvider(providerId, instanceId);
}

let totalUnread = $derived(
  (Object.entries(unreadByAddress) as [string, number][])
    .filter(([addr]) =>
      accounts.some(
        (a: Address) =>
          (a.address || '').toLowerCase() === addr.toLowerCase() && a.status === 'active'
      )
    )
    .reduce((sum, [, count]) => sum + count, 0)
);

let unreadTooltip = $derived.by(() => {
  if (!totalUnread) return $t('nav.mailbox');
  const activeWithUnread = (Object.entries(unreadByAddress) as [string, number][])
    .filter(
      ([addr, count]) =>
        count > 0 &&
        accounts.some(
          (a: Address) =>
            (a.address || '').toLowerCase() === addr.toLowerCase() && a.status === 'active'
        )
    )
    .map(([addr, count]) => $t('nav.unreadForAddress', { values: { address: addr, n: count } }));
  if (activeWithUnread.length === 0) return $t('nav.mailbox');
  return activeWithUnread.join('\n');
});

type NavIndicator = { count: number; ariaLabel?: string; tooltip?: string };
// Indicator data is keyed by canonical nav item id. Each item chooses its own
// display mode in settings; adding another indicator does not change rendering.
let navIndicators = $derived<Record<string, NavIndicator>>({
  mailbox: {
    count: totalUnread,
    ariaLabel:
      totalUnread > 0 ? $t('nav.mailboxUnread', { values: { n: totalUnread } }) : undefined,
    tooltip: unreadTooltip,
  },
});

function indicatorCountFor(key: View | 'more'): number {
  const count = navIndicators[navKeyForView(key)]?.count;
  return typeof count === 'number' && Number.isFinite(count) ? Math.max(0, count) : 0;
}

function indicatorModeFor(key: View | 'more'): 'dot' | 'count' {
  return layoutStore.navIndicatorModes[navKeyForView(key)] ?? 'dot';
}

function hasIndicator(key: View | 'more'): boolean {
  return indicatorCountFor(key) > 0;
}

function countIndicatorTextFor(key: View | 'more'): string | null {
  const count = indicatorCountFor(key);
  return count > 0 && indicatorModeFor(key) === 'count' ? navBadgeTextFor(count) : null;
}

/** Use the largest currently rendered count, matching the previous mailbox fit. */
function activeCountBadgeText(items: ReadonlyArray<{ view: View | 'more' }>): string | null {
  let widest: string | null = null;
  let widestPx = 0;
  for (const item of items) {
    const text = countIndicatorTextFor(item.view);
    if (!text) continue;
    const width = navBadgeWidthPx(text, measureLabelPx);
    if (width > widestPx) {
      widest = text;
      widestPx = width;
    }
  }
  return widest;
}

function moreIndicatorTooltip(): string {
  return moreItems
    .map((item) =>
      hasIndicator(item.view) ? navIndicators[navKeyForView(item.view)]?.tooltip : undefined
    )
    .filter((value): value is string => !!value)
    .join('\n');
}

let footerRootEl = $state<HTMLElement | null>(null);
let floatingNavEl = $state<HTMLElement | null>(null);
let navItemEls: Record<string, HTMLButtonElement> = {};
let pillWidth = $state(0);
let pillOffset = $state(0);
let pillReady = $state(false);
let pillEpoch = $state(0);
/** Dynamic nav label font-size (px) - fitted so no label truncates */
let navFontPx = $state(NAV_LABEL_DEFAULT_FONT_PX);
/** Fitted per-side item padding (px) - the fitter's second lever. */
let navPadX = $state(NAV_ITEM_PAD_X_MAX_PX);
/** Fitted end-side padding of the badge item - clear of the badge box. */
let navPadXEnd = $state(NAV_ITEM_PAD_X_MAX_PX);
/**
 * Block-start padding the pill's items reserve for the count's superscript lane
 * (>= the authored `NAV_ITEM_PAD_BLOCK_PX`). Fitted var, like `--nav-item-pad-x`:
 * it is the only lever that can open room ABOVE the label's ink without moving
 * the label itself.
 */
let navPadBlockStartPx = $state(NAV_ITEM_PAD_BLOCK_PX);
/**
 * Block-end inset of the pill's count: the distance from the item's bottom edge
 * to the badge's, so the badge sits on the last glyph's ink top-right corner.
 * Pre-fit fallback mirrors the pre-superscript `top: 2px` state; the first fit
 * replaces it before any count can render (unread arrives from storage).
 */
let navBadgeBottomPx = $state(
  NAV_ICON_SIZE_PX + 2 * NAV_ITEM_PAD_BLOCK_PX - 2 - NAV_BADGE_HEIGHT_PX
);
/**
 * Label width the fitter could not place (px). Non-zero means the labels are
 * wider than the widest island that fits, so the fitted font+padding are at
 * their floors and the label must be clipped inside its own button box - the
 * only case where truncation is allowed, and the reason nothing can ever paint
 * outside the pill background.
 */
let navOverBudgetPx = $state(0);
/** Token that supersedes an in-flight pill measurement (see the settle loop). */
let pillTrackToken = 0;

/**
 * Svelte action: register each nav button for elastic-pill measurement.
 *
 * The key is the primary slot, `View | 'more'` - the overflow button carries the
 * `'more'` pseudo-view, which is why the parameter is not simply `View`.
 */
function navItemAction(node: HTMLButtonElement, view: View | 'more') {
  navItemEls[view] = node;
  pillEpoch += 1;
  return {
    update(nextView: View | 'more') {
      if (nextView !== view) {
        delete navItemEls[view];
        view = nextView;
        navItemEls[view] = node;
        pillEpoch += 1;
      }
    },
    destroy() {
      delete navItemEls[view];
      pillEpoch += 1;
    },
  };
}

let navLayout = $derived(layoutStore.navLayout);

let primaryNav = $derived(navLayout.primaryNav);
let moreItems = $derived(navLayout.moreItems);

/** Any indicated item collapsed into More contributes a dot to its trigger. */
let moreHasIndicator = $derived(moreItems.some((item) => hasIndicator(item.view)));

/**
 * Frozen More-submenu rows (arrays of items), snapshotted when the menu OPENS.
 * The menu never reshuffles live - unread arriving must not move the rows under
 * the pointer - so the arrange/split answer is computed once per opening.
 *
 * A snapshot is not a licence to outlive its inputs, though. The MEMBERSHIP it
 * was arranged from is re-read on every resize (see the snapshot-lifetime effect
 * below): when the live More list differs, the rows are re-arranged, and when
 * More itself empties they are dropped and the menu closed. What stays frozen is
 * the FIT: a font growth mid-open (unread arriving, a locale landing) can leave a
 * row packed for the old width, which overflows with an ellipsis rather than
 * sliding an item out from under the pointer - accepted, and the lesser evil.
 */
let moreRows = $state<MoreItem[][] | null>(null);
/**
 * Per-item label font overrides (view → px) for the one case the rows cannot
 * solve: a single item wider than its own row. Shrunk in place from the
 * pill-inherited size toward the pill floor, then cut with an ellipsis.
 */
let moreItemFontPx = $state<Record<string, number>>({});
/** The views the frozen rows were arranged from (for the snapshot-lifetime check). */
let moreFrozenViews = $derived((moreRows ?? []).flat().map((item) => item.view));
/**
 * End-side padding of the More menu's badge item. The menu used to reserve
 * NOTHING for the count, so it painted over the label (the pill reserved 8px of
 * a 17-24px badge - the same bug, one surface later).
 */
let moreBadgeEndPadPx = $state(MORE_ITEM_PAD_X);
/** More-menu block-start padding (the same superscript lane as the pill's). */
let morePadBlockStartPx = $state(MORE_ITEM_PAD_BLOCK_PX);
/** More-menu badge block-end inset (see `navBadgeBottomPx`). */
let moreBadgeBottomPx = $state(
  NAV_ICON_SIZE_PX + 2 * MORE_ITEM_PAD_BLOCK_PX - 2 - NAV_BADGE_HEIGHT_PX
);

let MORE_VIEWS = $derived.by(() => {
  const s = new Set<View>(DEEP_MORE_VIEWS);
  for (const m of moreItems) s.add(m.view);
  // Organize deep links only highlight More while organize itself lives in More
  // (otherwise the promoted Organize nav item is the single active indicator).
  if (!navLayout.moreViewSet.has('organize')) {
    s.delete('tagManagement');
    s.delete('labelManagement');
    s.delete('filtersManagement');
  }
  return s;
});

let fabKind = $derived(dynamicFab?.kind ?? fabKindForView(currentView, { organizeTab }));

let fabLabel = $derived(
  dynamicFab?.label ??
    (dynamicFab?.labelKey
      ? ($t(dynamicFab.labelKey) as string)
      : ($t(fabLabelKeyForKind(fabKind)) as string))
);

let fabIcon = $derived(dynamicFab?.icon ?? fabIconForKind(fabKind));

function isPrimaryActive(view: View | 'more'): boolean {
  if (view === 'more') return MORE_VIEWS.has(currentView) && moreItems.length > 0;
  if (view === 'addresses') return currentView === 'addresses' || currentView === 'addressView';
  if (view === 'mailbox') return currentView === 'mailbox' || currentView === 'mailView';
  if (view === 'organize')
    return (
      currentView === 'organize' ||
      currentView === 'tagManagement' ||
      currentView === 'labelManagement' ||
      currentView === 'filtersManagement'
    );
  if (view === 'autofill')
    return (
      currentView === 'autofill' || currentView === 'loginInfo' || currentView === 'identities'
    );
  return currentView === view;
}

function handlePrimaryClick(view: View | 'more', event?: MouseEvent) {
  if (view === 'more') {
    cancelMoreClose();
    // The click/gesture matrix lives in `moreClickIntent` (pure, unit-tested):
    // a tap's own emulated hover must not be undone by its click, while a mouse
    // click and a keyboard activation (Enter / Space, `detail === 0`) are real
    // toggles.
    const intent = moreClickIntent({
      open: moreOpen,
      keyboard: !event || event.detail === 0,
      wasOpenAtPointerDown: moreWasOpenAtPointerDown,
    });
    if (intent === 'ignore') return;
    // The ONE open path. The rows must be frozen WITH the open, or the menu
    // renders `moreRows ?? []` - an empty island: hover used to be the only
    // freezer, so a keyboard or tap open (no mouseenter) opened nothing at all.
    if (intent === 'close') closeMoreNow();
    else openMoreMenu();
    return;
  }
  closeMoreNow();
  onNavigate(view);
}

function handleMoreItem(view: View) {
  closeMoreNow();
  onNavigate(view);
}

function handleFab() {
  if (isFabActionDisabled(fabKind, loading)) return;
  if (dynamicFab?.onclick) {
    dynamicFab.onclick();
  } else {
    onFabClick(fabKind);
  }
}

/**
 * The active item's box in nav coordinates, exactly as laid out.
 *
 * Bounding rects of the nav and the button, differenced: the button is an
 * in-flow child of the nav and neither is transformed, so this is the same
 * geometry CSS will use - and unlike `offsetWidth`/`offsetLeft` it is exact
 * rather than integer-rounded, which is what lets the indicator match the
 * segment instead of being a pixel off.
 */
function activeNavItemBox(): { w: number; left: number } | null {
  const nav = floatingNavEl;
  if (!nav) return null;
  const activeKey = primaryNav.find((item) => isPrimaryActive(item.view))?.view;
  if (!activeKey) return null;
  const target = navItemEls[String(activeKey)];
  if (!target?.isConnected) return null;
  const navRect = nav.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  return { w: targetRect.width, left: targetRect.left - navRect.left };
}

/**
 * The indicator IS the segment: same box, no overhang.
 *
 * It used to be `width + 6` at `left - 3`, which is asymmetric the moment the
 * active item is the first one - `left - 3` clamps to 0 at the island's edge, so
 * ALL 6px of overhang landed on the right and ate the gap to the next label
 * (3px left for "ที่อยู่" instead of the item's own 6px of padding). On the last
 * item the same arithmetic pushed the fill 3px OUTSIDE the island. Matching the
 * button box removes both, is the standard segmented-control look, and spends no
 * width: the pill clears every neighbour by exactly that item's padding.
 */
function applyPillBox(box: { w: number; left: number }): void {
  pillWidth = box.w;
  pillOffset = box.left;
  pillReady = true;
}

/**
 * Re-measure the pill until the active item's box stops moving.
 *
 * A single measurement is always stale: the active icon animates its width
 * 0 → 18px over ~280ms, so measuring right after the view changes (or before
 * the fitted label font has been applied) returns a box up to ~21px narrower
 * than the item ends up - the indicator then covers only part of the icon and
 * label, which is the "icon outside the pill" users see. The previous version
 * approximated this with fixed timers registered on mount, which never fired
 * for a tab change at all. Tracking frames is independent of the transition's
 * duration and of *why* the box moved (icon expand, font re-fit, locale).
 */
function trackPillUntilSettled(token: number): void {
  if (typeof requestAnimationFrame !== 'function') return;
  const deadline = performance.now() + 600;
  let lastW = -1;
  let lastLeft = -1;
  let stableFrames = 0;
  const step = () => {
    if (token !== pillTrackToken) return; // superseded by a newer measurement
    const box = activeNavItemBox();
    if (!box) {
      pillReady = false;
      return;
    }
    if (box.w === lastW && box.left === lastLeft) {
      if (++stableFrames >= 2) return; // settled
    } else {
      stableFrames = 0;
      lastW = box.w;
      lastLeft = box.left;
    }
    applyPillBox(box);
    if (performance.now() < deadline) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function updatePillPosition() {
  pillTrackToken += 1;
  const box = activeNavItemBox();
  if (!box) {
    pillReady = false;
    return;
  }
  applyPillBox(box);
  trackPillUntilSettled(pillTrackToken);
}

/** The stack the nav labels are actually painted with (never a hardcoded one). */
let labelFontFamily = BODY_FONT_FAMILY;
/** The labels' own letter-spacing (px) the fit must reserve for; see the resolver. */
let labelTrackingPx = 0;
/**
 * The shared canvas measurement (widths AND vertical ink), rebuilt whenever the
 * rendered stack resolves to a different family - one implementation for both
 * numbers, and the same one `tests/visual/preview-responsive-button-layout.html` runs, so the
 * harness cannot measure a face the pill does not paint.
 */
let labelMetrics = $state(createLabelMetrics(BODY_FONT_FAMILY));

/** Measure a label exactly as the button paints it: same stack, same weight. */
function measureLabelPx(text: string, sizePx: number, weight: number): number {
  if (typeof document === 'undefined') return 0;
  return labelMetrics.width(text, sizePx, weight);
}

/**
 * The same canvas, read for the label's vertical ink instead of its width.
 * `fontBoundingBox*` is the face's ascent/descent (the box the browser centres
 * the line on) and `actualBoundingBoxAscent` is where the glyphs' ink stops
 * rising - read for the letter the count caps (`badgeAnchorText`), so a Thai
 * tone mark over an early consonant cannot lift the count off the letter it sits
 * on. The font box still comes from the whole label, because that is what the
 * rendered line box is built from.
 */
function measureLabelInkPx(text: string, sizePx: number, weight: number) {
  const anchor = badgeAnchorText(text);
  const ink = labelMetrics.ink(text, sizePx, weight, anchor);
  return {
    ...ink,
    inkRightPx:
      measureLabelPx(text, sizePx, weight) -
      measureLabelPx(anchor, sizePx, weight) +
      ink.inkRightPx,
  };
}

function navDotPlacementFor(label: string, fontPx: number): { xPx: number; yPx: number } {
  const ink = measureLabelInkPx(label, fontPx, NAV_LABEL_FONT_WEIGHT);
  const inkTopPx =
    (fontPx - (ink.fontAscentPx + ink.fontDescentPx)) / 2 + ink.fontAscentPx - ink.inkAscentPx;
  return {
    xPx: ink.inkRightPx - NAV_DOT_SIZE_PX / 2,
    yPx: inkTopPx - NAV_DOT_SIZE_PX - NAV_DOT_INK_GAP_PX,
  };
}

/**
 * Badge placement for one surface, from the label the count hangs off.
 *
 * The lane is reserved whether or not the count is currently visible - the ink
 * metrics that size it come from the LABEL, never from the digits - so unread
 * mail arriving can never resize the island.
 */
function badgePlacementFor(
  label: string | null,
  fontPx: number,
  padBlockStartPx: number,
  padBlockEndPx: number
): { padBlockStartPx: number; bottomInsetPx: number } {
  if (!label) {
    // No count on this surface (the mailbox item is not the one that carries it
    // here): keep the authored padding and park the box at the item's top, so a
    // badge that does appear before the next fit is still inside the item.
    return {
      padBlockStartPx,
      bottomInsetPx: NAV_ICON_SIZE_PX + padBlockStartPx + padBlockEndPx - NAV_BADGE_HEIGHT_PX,
    };
  }
  const ink = measureLabelInkPx(label, fontPx, NAV_LABEL_FONT_WEIGHT);
  return navBadgePlacementPx({
    padBlockStartPx,
    padBlockEndPx,
    contentHeightPx: NAV_ICON_SIZE_PX,
    labelFontPx: fontPx,
    ...ink,
  });
}

/**
 * Fit the pill's label font, then its item padding, into the width the island
 * actually has. `fitNavPill` owns the levers (font → padding, never below the
 * tier padding floor) and reports what it could not place, so this function is
 * only the DOM side: how wide the island is, what the labels say, and how wide
 * the unread badge renders.
 */
function fitNavFontSize() {
  if (!footerRootEl) return;
  // Bind the measurement to the rendered font AND its letter-spacing, so neither
  // a font-stack change nor the label's own tracking can leave the fitter
  // measuring a row narrower than the browser paints it. The 0.5px per character
  // the strip rule adds is the difference between "fits" and a sliced glyph on
  // every label.
  const family = resolveLabelFontFamily(footerRootEl);
  const tracking = resolveLabelTrackingPx(footerRootEl); // shared with the probe
  if (family !== labelFontFamily || tracking !== labelTrackingPx) {
    labelFontFamily = family;
    labelTrackingPx = tracking;
    labelMetrics = createLabelMetrics(family, tracking);
  }
  const lang = typeof $locale === 'string' ? $locale : 'en';
  const labels = primaryNav.map((item) => $t(item.labelKey));
  // Pill width = footer minus FAB + gap + the float inset on both sides.
  const avail = Math.max(
    140,
    (footerRootEl.clientWidth || layoutStore.navShellWidth) - NAV_RESERVED_OUTER_PX
  );
  const badgeItems = primaryNav.filter((item) =>
    item.view === 'more' ? moreHasIndicator : hasIndicator(item.view)
  );
  const extraChromePx = (fontPx: number) =>
    badgeItems.reduce(
      (sum, item) => sum + (isPrimaryActive(item.view) ? 0 : navIconSizePx(fontPx) + NAV_ICON_GAP),
      0
    );
  const fit = fitNavPill({
    labels,
    availPx: avail,
    lang,
    hasActiveIcon: primaryNav.some((item) => isPrimaryActive(item.view)),
    badgeText: null,
    badgeCount: 0,
    dotCount: 0,
    extraChromePx,
    iconSizeFor: navIconSizePx,
    measure: measureLabelPx,
  });
  navFontPx = fit.fontPx;
  navPadX = fit.padX;
  navPadXEnd = fit.padXEnd;
  navOverBudgetPx = fit.overBudgetPx;
  // The count is a superscript on the mailbox label's ink, so the item reserves
  // the lane that lets its box sit on the last glyph's ink top-right corner.

  const placements = badgeItems.map((item) =>
    badgePlacementFor($t(item.labelKey), fit.fontPx, NAV_ITEM_PAD_BLOCK_PX, NAV_ITEM_PAD_BLOCK_PX)
  );
  navPadBlockStartPx = NAV_ITEM_PAD_BLOCK_PX;
  navBadgeBottomPx =
    placements[0]?.bottomInsetPx ??
    NAV_ICON_SIZE_PX + 2 * NAV_ITEM_PAD_BLOCK_PX - 2 - NAV_BADGE_HEIGHT_PX;
}

/**
 * Arrange and split the More submenu, frozen at menu-open time.
 *
 * Sizes are INHERITED, not fitted: the menu renders the pill's fitted label
 * font (`navFontPx`), so a submenu item is exactly as big as its pill sibling
 * would be - one size source, no second fitter drifting below the pill floor.
 * Each item's width is that size plus the menu's own always-visible icon
 * chrome (the pill only pays the icon lane once, on its active item).
 */
function freezeMoreMenu() {
  if (!footerRootEl || moreItems.length === 0) {
    moreRows = null;
    return;
  }
  // Menu span is the island + FAB width (footer minus the float inset on both
  // sides) - strictly wider than the pill row, which is the headroom the rows
  // pack into. Strip the menu's own padding for the real item slots.
  const menuMaxW = Math.max(
    140,
    (footerRootEl.clientWidth || layoutStore.navShellWidth) - 2 * NAV_FLOAT_INSET_PX
  );
  const contentW = Math.max(0, menuMaxW - MORE_MENU_PAD * 2);
  const badgeItems = moreItems.filter(
    (item) => hasIndicator(item.view) && indicatorModeFor(item.view) === 'count'
  );
  const badgeText = activeCountBadgeText(badgeItems);
  const badgeW = navBadgeWidthPx(badgeText, measureLabelPx);
  const endPadFor = (_item: MoreItem): number => MORE_ITEM_PAD_X;
  const dotSpaceFor = (_item: MoreItem): number => 0;
  const widthFor = (item: MoreItem, fontPx: number): number =>
    measureLabelPx($t(item.labelKey), fontPx, NAV_LABEL_FONT_WEIGHT) +
    MORE_ITEM_PAD_X +
    endPadFor(item) +
    dotSpaceFor(item) +
    navIconSizePx(fontPx) +
    NAV_ICON_GAP;
  const widths = moreItems.map((item) => widthFor(item, navFontPx));
  const order = arrangeMoreItems(
    moreItems.map((_, i) => i),
    widths,
    contentW,
    MORE_GAP,
    layoutStore.autoArrangeMore
  );
  const rows = splitMoreRows({
    itemWidthsPx: order.map((i) => widths[i]),
    contentWidthPx: contentW,
    gapPx: MORE_GAP,
  });
  // A single item wider than its own row cannot be solved by arrangement, so
  // it shrinks in place - pill size down toward the pill floor - and whatever
  // still does not fit is cut with an ellipsis (the label's belt).
  const shrunk: Record<string, number> = {};
  for (const row of rows) {
    if (row.length !== 1) continue;
    const item = moreItems[order[row[0]]];
    if (widthFor(item, navFontPx) <= contentW) continue;
    shrunk[item.view] = fitLabelFontSize(
      [
        {
          text: $t(item.labelKey),
          availableWidth: Math.max(
            0,
            contentW -
              MORE_ITEM_PAD_X -
              endPadFor(item) -
              dotSpaceFor(item) -
              navIconSizePx(navFontPx) -
              NAV_ICON_GAP
          ),
        },
      ],
      {
        basePx: navFontPx,
        minPx: NAV_LABEL_MIN_FONT_PX,
        weight: NAV_LABEL_FONT_WEIGHT,
        fontFamily: labelFontFamily,
        // The menu's labels are `.nav-label` too - the same per-character
        // tracking the pill fit reserves, or the last letter is shaved.
        letterSpacingPx: resolveLabelTrackingPx(footerRootEl),
      }
    );
  }
  moreItemFontPx = shrunk;
  moreRows = rows.map((row) => row.map((k) => moreItems[order[k]]));
}

/**
 * The More menu's badge reserve and superscript lane at the inherited size.
 * The mailbox item carries the unread count here too, from the same helpers
 * as the pill - the menu used to reserve nothing and painted over its label.
 */
function updateMoreMenuPlacement() {
  if (!footerRootEl || moreItems.length === 0) return;
  const badgeItems = moreItems.filter(
    (item) => hasIndicator(item.view) && indicatorModeFor(item.view) === 'count'
  );
  const badgeText = activeCountBadgeText(badgeItems);
  const badgeW = navBadgeWidthPx(badgeText, measureLabelPx);
  moreBadgeEndPadPx = navBadgeEndPadPx(badgeW, MORE_ITEM_PAD_X);
  // Same superscript lane as the pill, at the menu's own padding and the
  // inherited font: the count rides the mailbox label's ink here too.
  const placements = badgeItems.map((item) =>
    badgePlacementFor(
      $t(item.labelKey),
      moreItemFontPx[item.view] ?? navFontPx,
      MORE_ITEM_PAD_BLOCK_PX,
      MORE_ITEM_PAD_BLOCK_PX
    )
  );
  morePadBlockStartPx = MORE_ITEM_PAD_BLOCK_PX;
  moreBadgeBottomPx = placements[0]?.bottomInsetPx ?? moreBadgeBottomPx;
}

function primaryBadgeBottomFor(item: { labelKey: string; view: View | 'more' }): number {
  return badgePlacementFor(
    $t(item.labelKey),
    navFontPx,
    NAV_ITEM_PAD_BLOCK_PX,
    NAV_ITEM_PAD_BLOCK_PX
  ).bottomInsetPx;
}

function moreItemBadgeBottomFor(item: MoreItem): number {
  return badgePlacementFor(
    $t(item.labelKey),
    moreItemFontPx[item.view] ?? navFontPx,
    MORE_ITEM_PAD_BLOCK_PX,
    MORE_ITEM_PAD_BLOCK_PX
  ).bottomInsetPx;
}

/**
 * The frozen snapshot's lifetime belongs to the membership that produced it.
 *
 * `freezeMoreMenu` snapshots the rows at open time, which is what keeps an item
 * from moving under the pointer mid-aim. But `moreItems` is derived from the
 * shell width: widening the island past the widest stage promotes EVERY item and
 * leaves More empty, which hides the menu through
 * `{#if moreOpen && moreItems.length > 0}` while `moreOpen` stays true - so
 * narrowing the shell again used to re-show the menu, uninvited, still rendering
 * rows for a dead membership (possibly items that are now pills). A menu whose
 * More list changed is re-arranged for the live items; one whose list emptied is
 * closed, never resurrected.
 */
$effect(() => {
  if (!moreOpen) return;
  const verdict = moreSnapshotVerdict(
    moreFrozenViews,
    moreItems.map((item) => item.view)
  );
  if (verdict === 'close') closeMoreNow();
  else if (verdict === 'refreeze') freezeMoreMenu();
});

$effect(() => {
  const indicatorModes = layoutStore.navIndicatorModes;
  if (moreOpen && indicatorModes) {
    freezeMoreMenu();
  }
});

// Reposition elastic pill + refit fonts when active tab / nav set / labels / locale change.
// Width is a prop from AppLayout (single measurement owner) - `primaryNav` derives from
// it, so a shell resize re-triggers this effect without any local observer.
$effect(() => {
  void currentView;
  void primaryNav;
  void moreOpen;
  void pillEpoch;
  void $t;
  void $locale;
  // The badge text is part of the fit (it reserves real width), so unread
  // changes must re-fit, not just re-render.
  void totalUnread;
  void layoutStore.navShellWidth;
  void layoutStore.navLabelWidths;
  void layoutStore.navIndicatorModes;
  void tick().then(() => {
    fitNavFontSize();
    updateMoreMenuPlacement();
    updatePillPosition();
  });
});
</script>

<!--
  Floating bottom nav (Google Photos style):
  fixed island over content - pill bar + circular FAB, elastic active indicator.
  pointer-events only on interactive children so content can receive clicks around the island.
-->
<div
  class="footer-float pointer-events-none shrink-0 w-full {scrollChromeHidden ? 'scroll-chrome-hidden' : ''}"
  data-scroll-hidden={scrollChromeHidden ? 'true' : 'false'}
  bind:this={footerRootEl}
  style="--footer-float-inset: {NAV_FLOAT_INSET_PX}px; --footer-float-bottom: {NAV_FLOAT_BOTTOM_PX}px; --fab-size: {NAV_FAB_SIZE_PX}px; --nav-font-size: {NAV_LABEL_DEFAULT_FONT_PX}px; {navTokenStyle()};"
>
  <!-- More menu: same visual language as floating nav (icon only when active).
       Keyboard users Tab through the items (the panel is a list of buttons, not
       a roving-focus menu) and dismiss it with Escape, which registers as an
       escape tier while the panel is open. -->
  {#if moreOpen && moreItems.length > 0}
    <!-- The shared flyout handles outside clicks without covering its own trigger. -->
    <div
      use:anchoredFlyout={{ anchor: () => footerRootEl, placement: 'top-end', onClose: closeMoreNow }}
      class="pointer-events-auto absolute bottom-full mb-2 left-1/2 -translate-x-1/2 {PORTAL_Z_CLASS.accountMenu} more-menu-nav"
      role="menu"
      tabindex="-1"
      aria-label={$t('nav.moreMenu')}
      style="{navTokenStyle()}; --footer-float-inset: {NAV_FLOAT_INSET_PX}px; --nav-font-size: {navFontPx}px; --more-menu-pad-block-start: {morePadBlockStartPx}px; --nav-badge-bottom: {moreBadgeBottomPx}px; --nav-badge-inset: {MORE_ITEM_PAD_X}px; --nav-dot-size: {NAV_DOT_SIZE_PX}px; --nav-dot-gap: {NAV_DOT_GAP_PX}px;"
      onmouseenter={cancelMoreClose}
      onmouseleave={scheduleCloseMore}
    >
      {#each moreRows ?? [] as row, ri (ri)}
        <div class="more-menu-row">
          {#each row as item (item.view)}
        <!-- The SAME predicate the pill uses. The inline `currentView ===
             item.view` copy this replaces only ever matched the hub itself, so
             with a hub in More a deep view (mailView, addressView, loginInfo,
             identities…) left every menu item unhighlighted. -->
        {@const active = isPrimaryActive(item.view)}
        {@const indicator = navIndicators[navKeyForView(item.view)]}
        {@const indicated = hasIndicator(item.view)}
        {@const countText = countIndicatorTextFor(item.view)}
        {@const itemLabel = $t(item.labelKey)}
        {@const itemDot = indicated && !countText}
        <button
          type="button"
          role="menuitem"
          class="more-menu-item {active ? 'active' : ''} {countText ? 'has-badge' : ''} {itemDot ? 'has-dot' : ''}"
          style="--more-menu-pad-x-end: {moreBadgeEndPadPx}px; --nav-font-size: {moreItemFontPx[item.view] ?? navFontPx}px; --nav-icon-size: {navIconSizePx(moreItemFontPx[item.view] ?? navFontPx)}px; --nav-badge-bottom: {moreItemBadgeBottomFor(item)}px; --nav-dot-size: {NAV_DOT_SIZE_PX}px; --nav-dot-gap: {NAV_DOT_GAP_PX}px;"
          onclick={() => handleMoreItem(item.view)}
          aria-current={active ? 'page' : undefined}
          aria-label={indicated ? indicator?.ariaLabel : undefined}
          data-tooltip={indicated ? indicator?.tooltip : undefined}
        >
          <span class="nav-icon" aria-hidden="true">
            <Icon name={item.iconName} class="w-full h-full" filled={active} />
            {#if countText || itemDot}<NavIconIndicator {countText} iconSizePx={navIconSizePx(moreItemFontPx[item.view] ?? navFontPx)} />{/if}
          </span>
          <span class="nav-label">{itemLabel}</span>
        </button>
          {/each}
        </div>
      {/each}
    </div>
  {/if}

  <!-- Floating island: nav pill + FAB. The pill needs a real horizontal inset
       (--footer-float-inset) on BOTH sides so it reads as floating instead of
       hugging the shell edges. -->
  <div class="bottom-nav-container pointer-events-auto flex items-stretch justify-center gap-1.5 w-full">
    <nav
      class="floating-nav relative flex items-center min-w-0 max-w-full"
      bind:this={floatingNavEl}
      aria-label={$t('nav.mainNav')}
      data-tour="footer-nav"
      style="--nav-font-size: {navFontPx}px; --nav-icon-size: {navIconSizePx(navFontPx)}px; --nav-item-pad-x: {navPadX}px; --nav-item-pad-x-end: {navPadXEnd}px; --nav-item-pad-block-start: {navPadBlockStartPx}px; --nav-item-pad-block-end: {NAV_ITEM_PAD_BLOCK_PX}px; --nav-badge-bottom: {navBadgeBottomPx}px; --nav-badge-inset: {navPadX}px; --nav-dot-size: {NAV_DOT_SIZE_PX}px; --nav-dot-gap: {NAV_DOT_GAP_PX}px;"
      data-nav-overflow={navOverBudgetPx > 0 ? 'true' : undefined}
      onpointerdown={startNavbarLongPress}
      onpointermove={checkNavbarPointerMove}
      onpointerup={cancelNavbarLongPress}
      onpointercancel={cancelNavbarLongPress}
    >
      <!-- Elastic active pill (measures real button width like Google Photos) -->
      {#if pillReady}
        <div
          class="pill-indicator"
          style="width: {pillWidth}px; transform: translateX({pillOffset}px);"
          aria-hidden="true"
        ></div>
      {/if}

      {#each primaryNav as item (item.view)}
        {@const isActive = isPrimaryActive(item.view)}
        {@const isMore = item.view === 'more'}
        {@const label = $t(item.labelKey)}
        {@const indicator = navIndicators[navKeyForView(item.view)]}
        {@const indicated = hasIndicator(item.view)}
        {@const countText = countIndicatorTextFor(item.view)}
        {@const labelDot = indicated && !isMore && !countText}
        <button
          type="button"
          class="nav-item {isActive ? 'active' : ''} {countText ? 'has-badge' : ''} {labelDot || (isMore && moreHasIndicator) ? 'has-dot' : ''}"
          style="--nav-badge-bottom: {item.view !== 'more' ? primaryBadgeBottomFor(item) : navBadgeBottomPx}px;"
          use:navItemAction={item.view}
          aria-label={indicated ? indicator?.ariaLabel || label : label}
          aria-current={isActive ? 'page' : undefined}
          aria-expanded={item.view === 'more' ? moreOpen : undefined}
          onclick={(e) => {
            e.stopPropagation();
            if (longPressTriggered) {
              e.preventDefault();
              longPressTriggered = false;
              return;
            }
            handlePrimaryClick(item.view, e);
            void tick().then(updatePillPosition);
          }}
          onmouseenter={() => {
            if (item.view === 'more' && moreItems.length > 0) openMoreMenu();
            else if (moreOpen) scheduleCloseMore();
          }}
          onmouseleave={() => {
            if (item.view === 'more') scheduleCloseMore();
          }}
          data-tooltip={indicated ? indicator?.tooltip : isMore && moreHasIndicator ? moreIndicatorTooltip() : undefined}
        >
          <span class="nav-icon" aria-hidden="true">
            <Icon name={item.iconName} class="w-full h-full" filled={isActive} />
            {#if countText || labelDot || (isMore && moreHasIndicator)}<NavIconIndicator {countText} iconSizePx={navIconSizePx(navFontPx)} />{/if}
          </span>
          <span class="nav-label">{label}</span>
        </button>
      {/each}
    </nav>

    {#if fabKind !== 'none'}
      <button
        type="button"
        id="footer-contextual-fab"
        onkeydown={onProviderMenuKeydown}
        class="fab-btn fab-pop shrink-0 {fabKind === 'refresh'
          ? 'fab-primary'
          : fabKind === 'ghostLogin' || fabKind === 'ghost' || fabKind === 'ghostExpand'
            ? 'fab-ghost'
            : 'fab-primary'}"
        aria-label={fabLabel}
        title={fabLabel}
        disabled={isFabActionDisabled(fabKind, loading)}
        oncontextmenu={(e) => {
          if (fabKind === 'createAddress') {
            openProviderMenu(e);
          } else {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onclick={(e) => {
          e.stopPropagation();
          handleFab();
        }}
      >
        <Icon
          name={providerMenuOpen && fabKind === 'createAddress' ? 'chevronDown' : fabIcon}
          class="w-5 h-5 {loading && fabKind === 'refresh' ? 'animate-spin' : ''}"
        />
      </button>
    {/if}
  </div>

  <ProviderCreateMenu
    open={providerMenuOpen && fabKind === 'createAddress'}
    x={providerMenuPos.x}
    y={providerMenuPos.y}
    {providerInstances}
    onClose={() => (providerMenuOpen = false)}
    onPick={pickProvider}
    onOpenProviderSettings={() => {
      providerMenuOpen = false;
      onOpenProviderSettings();
    }}
  />
</div>

<style>
  /*
   * Floating footer island - Google Photos-style pill nav + circular FAB.
   * Uses MD theme tokens so light/dark schemes stay consistent.
   */
  .footer-float {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 20;
    /* The three float vars (inset / bottom gap / label font default) are set on
       this element by the template from the nav-layout constants, so the whole
       subtree inherits one value each - no per-declaration literal fallbacks,
       which is how 15 ended up written in four places. */
    padding: 0 0 var(--footer-float-bottom) 0;
    background: transparent;
    transition: opacity 180ms ease, transform 180ms ease, visibility 180ms ease;
  }

  .footer-float.scroll-chrome-hidden {
    opacity: 0;
    visibility: hidden;
    transform: translateY(calc(100% + 8px));
    pointer-events: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .footer-float {
      transition: none;
    }
  }

  /* Symmetric x-axis inset - the floating pill keeps clear space on BOTH
     sides, so it looks like a floating island, not a full-width bar. */
  .bottom-nav-container {
    padding-inline: var(--footer-float-inset);
  }

  .floating-nav {
    display: flex;
    align-items: center;
    position: relative;
    /* Apple Liquid Glass material: the fill stays very translucent - the blur
       and saturation do the work - with a bright specular rim and inner glow.
       The MD surface token keeps it theme-aware (flips with light/dark). */
    background-color: color-mix(in srgb, var(--md-surface-container-high) 32%, transparent);
    backdrop-filter: blur(42px) saturate(1.8) brightness(1.08);
    border-radius: var(--nav-island-radius);
    padding: 0px;
    border: 0;
    /* MD3 floating-surface elevation level 2. The border and translucent
       surface provide the glass treatment without a second custom shadow. */
    box-shadow: var(--md-elevation-2);
  }

  /* Specular rim: a 1px glass border that is brightest along the top edge and
     fades toward the bottom - the "light catches the rim" liquid-glass look.
     (Gradient + mask-composite keeps the rounded pill corners intact.) */
  .floating-nav::before,
  .more-menu-nav::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    padding: 1px;
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--md-on-surface) 32%, transparent) 0%,
      color-mix(in srgb, var(--md-on-surface) 12%, transparent) 35%,
      color-mix(in srgb, var(--md-on-surface) 6%, transparent) 70%,
      color-mix(in srgb, var(--md-on-surface) 2%, transparent) 100%
    );
    -webkit-mask: linear-gradient(var(--md-on-surface) 0 0) content-box, linear-gradient(var(--md-on-surface) 0 0);
    -webkit-mask-composite: xor;
    mask: linear-gradient(var(--md-on-surface) 0 0) content-box, linear-gradient(var(--md-on-surface) 0 0);
    mask-composite: exclude;
    pointer-events: none;
    z-index: 3;
  }

  .pill-indicator {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    height: 100%;
    min-height: 100%;
    background-color: var(--md-secondary-container);
    border-radius: var(--nav-item-radius);
    /* The selected segment has to read against the GLASS island, not against
       the opaque MD3 surface the container token is tuned for. Measured over the
       composited island, `secondaryContainer` is only 1.21:1 in light-standard
       (#dce7c8 on #f8f8f4) - so the selection was effectively invisible and the
       only pill-shaped fill you could notice was the 8% hover wash sitting 1.07:1
       away from the real one, on an INACTIVE item.
       The edge is drawn in `--md-on-surface` because that role is always at the
       far end of the theme's lightness range: it lifts the segment to 1.9:1
       (light-standard), 2.8:1 (dark-standard) and 6-10:1 (medium/high) without
       regressing any theme. Deepening the FILL instead was measured and
       rejected: mixing the container 20% toward its on-color took the active
       label to 3.45:1 in light-medium, below AA, and still lost separation in
       the high-contrast themes. */
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--md-on-surface) 22%, transparent);
    z-index: 1;
    pointer-events: none;
    box-sizing: border-box;
    transition:
      transform var(--motion-slow, 0.35s) var(--motion-ease, cubic-bezier(0.2, 0, 0, 1)),
      width var(--motion-slow, 0.35s) var(--motion-ease, cubic-bezier(0.2, 0, 0, 1));
  }
  @media (prefers-reduced-motion: reduce) {
    .pill-indicator {
      transition: none;
    }
    .nav-icon {
      transition: none;
    }
    .fab-btn {
      transition: none;
    }
  }

  /* More overflow menu - pill island matching floating-nav.
     Rows are arranged by `more-menu-layout.ts` (fewest rows that fit, no
     orphan row) and frozen while the menu is open; the menu inherits the
     pill's fitted label size, so items read exactly like their pill siblings.
     The menu grows freely upward with more pages - the max-height is only a
     viewport belt for an absurd future, never a row cap. */
  .more-menu-nav {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    flex-wrap: nowrap;
    justify-content: center;
    gap: 4px 4px;
    max-width: calc(100% - 2 * var(--footer-float-inset));
    max-height: 60vh;
    overflow-y: auto;
    padding: 4px;
    /* Same corner radius as the navbar items inside it: the floating pill
       reads as one shape because its items sit flush (padding 0) and the
       selection floats mid-island, never against the island's own corners -
       while here the corner items sit 4px from the island's corners, so a
       larger island radius (36 vs the items' 28) is compared directly and
       reads as a bubble around mini pills. */
    border-radius: var(--nav-item-radius);
    /* Same Apple Liquid Glass material as the floating-nav pill */
    background-color: color-mix(in srgb, var(--md-surface-container-high) 32%, transparent);
    backdrop-filter: blur(42px) saturate(1.8) brightness(1.08);
    border: 0;
    /* Menus use MD3 elevation level 2 rather than the floating-nav level. */
    box-shadow: var(--md-elevation-2);
  }
  /* One arranged row: items keep their fitted width (never shrink - the rows
     were packed to fit), centered like the pill row above. */
  .more-menu-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: 100%;
  }
  .more-menu-item {
    position: relative;
    z-index: 2;
    background: transparent;
    border: none;
    outline: none;
    color: var(--md-on-surface-variant);
    font-size: var(--nav-font-size);
    /* Painted from the same constant every measurement passes (see
       NAV_LABEL_FONT_WEIGHT): a bolder face is wider, so a fit that measured a
       lighter one shaves the label's last letter. */
    font-weight: var(--nav-label-weight);
    /* The block-start half is the count's superscript lane here too (the menu
       reserves the same room from its own authored padding). */
    padding: var(--more-menu-pad-block-start) var(--more-menu-pad-x) var(--more-menu-pad-block-end);
    border-radius: var(--nav-item-radius);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    white-space: nowrap;
    transition: color 0.25s ease, background-color 0.2s ease;
    /* The rows are packed to fit, so the flex box must never shave them -
       the fitter's answer has to stay achievable (see `fit-nav-pill.ts`). */
    flex-shrink: 0;
    /* The shrink belt's other half. An item the arrangement could not fit is
       CLAMPED to its own row and its label cuts with the ellipsis below, instead
       of widening the panel past its `max-width` cap and spilling into a
       horizontal scrollbar (the panel's `overflow-y: auto` computes
       overflow-x: auto too). Without this the item had no width limit at all, so
       the ellipsis rule could never paint - the belt was a promise the CSS did
       not keep. */
    max-width: 100%;
    overflow: hidden;
  }
  /* A shrunk single item cuts its label with an ellipsis. Scoped to the menu:
     the pill keeps its clip belt for the over-budget report.

     `min-width: 0` is load-bearing, not tidiness. Clamping the ITEM (above) is
     not enough on its own: the label is a flex item whose automatic minimum size
     is its content width, and Chromium does NOT zero it for
     `overflow-x: clip` + `overflow-y: visible` (measured: the clamped item hid a
     full-width label without ever ellipsizing it). With the floor lifted the
     label shrinks to the item's content box and the ellipsis paints - the
     vertical half of the shared rule stays untouched, so descenders still show. */
  .more-menu-item .nav-label {
    text-overflow: ellipsis;
    min-width: 0;
  }
  /* Hover may not touch the ACTIVE item - and may not impersonate it either: a
     wash on an inactive item is the same pill shape as the selection, so the
     only thing telling them apart would be a ~1.1:1 lightness difference in the
     default themes. The selection keeps its edge (above); hover stays a plain
     wash. */
  .more-menu-item:hover:not(.active) {
    color: var(--md-on-surface);
    background-color: color-mix(in srgb, var(--md-on-surface-variant) 8%, transparent);
  }
  .more-menu-item.active {
    color: var(--md-on-secondary-container);
    background-color: var(--md-secondary-container);
  }
  /* Same reserve as the pill's badge item, from the same helper: the count can
     never sit on the label, in any locale. */
  .more-menu-item.has-badge {
    padding-inline-end: var(--more-menu-pad-x);
  }
  .more-menu-item.has-dot {
    padding-inline-end: var(--more-menu-pad-x);
    overflow: visible;
  }
  /* Menu items always show their icon (unlike the collapsing nav pill). */
  .more-menu-item .nav-icon {
    display: inline-flex;
    width: var(--nav-icon-size);
    height: var(--nav-icon-size);
    opacity: 1;
    margin-inline-end: var(--nav-icon-gap);
    flex-shrink: 0;
    transform: scale(1);
  }

  .nav-item {
    position: relative;
    z-index: 2;
    background: transparent;
    border: none;
    outline: none;
    color: var(--md-on-surface-variant);
    font-size: var(--nav-font-size);
    /* Painted from the same constant every measurement passes (see
       NAV_LABEL_FONT_WEIGHT): a bolder face is wider, so a fit that measured a
       lighter one shaves the label's last letter. */
    font-weight: var(--nav-label-weight);
    /* Fitted, not authored: the inline padding is the fitter's second lever once
       the font floor is reached (floor = the XS/S tiers' 4px minimum side
       padding), and the block-start padding is the count's superscript lane -
       the room the badge needs ABOVE the label's ink, which no `top:` on the
       button can express. The lane is reserved on every item so unread mail
       cannot resize the island. */
    padding: var(--nav-item-pad-block-start) var(--nav-item-pad-x) var(--nav-item-pad-block-end);
    border-radius: var(--nav-item-radius);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    white-space: nowrap;
    min-width: 0;
    max-width: none;
    box-sizing: border-box;
    transition: color 0.25s ease, background-color 0.25s ease;
  }

  .nav-item:hover:not(.active) {
    color: var(--md-on-surface);
    background-color: color-mix(in srgb, var(--md-on-surface-variant) 8%, transparent);
  }

  .nav-item.active {
    color: var(--md-on-secondary-container);
  }

  .nav-item:focus-visible {
    outline: 2px solid var(--md-primary);
    outline-offset: 2px;
  }

  /* Icon collapses when inactive; expands when active (Gemini reference) */
  .nav-icon {
    position: relative;
    display: inline-flex;
    width: 0;
    height: var(--nav-icon-size);
    opacity: 0;
    margin-inline-end: 0;
    flex-shrink: 0;
    transform: scale(0.6);
    overflow: visible;
    /* Bolding is the OFFICIAL FILL1 glyph (icon-variants.ts), driven per item by
       the `filled` prop - the MD3 active-destination rule - not a CSS stroke:
       stroke double-bolded the already-solid filled glyph and bolded inactive
       menu icons the spec leaves outlined. */
    transition:
      opacity 0.25s ease 0.05s,
      transform 0.25s ease 0.05s,
      width 0.28s cubic-bezier(0.2, 0, 0, 1),
      margin 0.28s cubic-bezier(0.2, 0, 0, 1);
  }

  .nav-item.active .nav-icon,
  .nav-item.has-badge .nav-icon,
  .nav-item.has-dot .nav-icon {
    width: var(--nav-icon-size);
    margin-inline-end: var(--nav-icon-gap);
    opacity: 1;
    transform: scale(1);
  }

  .nav-label {
    position: relative;
    /* The FITTED size, explicitly. The global strip rule
       (`styles.css` → `.nav-label`) pins every strip label to
       `--md-type-label-medium-size` (12px), which silently overrode the fit: a row
       the fitter sized at 11px painted 12px, i.e. ~8% wider than reserved, and the
       flexbox took that back by shaving the last letter off every item. The label
       is the one thing that must render at exactly the size the fitter bought. */
    font-size: var(--nav-font-size);
    line-height: 1;
    /* Horizontal-only containment: the label can never paint outside its own
       button, so it can never paint outside the pill background that is sized
       to that button. `overflow-y: visible` deliberately keeps descenders
       (line-height: 1 leaves the glyph ink taller than the line box). Labels
       are measured and fitted, so this clips nothing in practice - it is the
       belt for the one case the fitter reports:
       `navOverBudgetPx > 0` (see data-nav-overflow). */
    overflow-x: clip;
    overflow-y: visible;
    min-width: 0;
    text-overflow: clip;
    white-space: nowrap;
  }
  .nav-icon :global(svg) {
    width: var(--nav-icon-size);
    height: var(--nav-icon-size);
    flex-shrink: 0;
  }
  .nav-label.has-dot {
    overflow: visible;
  }
  .nav-item.has-dot {
    padding-inline-end: var(--nav-item-pad-x);
  }

  /* The badge item deliberately clips NOTHING. `overflow: clip` here also
     rounds the clip at the item's 28px radius, and the count sits in exactly
     that corner: the box's top-right was sliced by the pill's own rim (deeper
     the taller the item grew), so the count read as coming through the edge
     instead of sitting inside it. The label contains its own ink via
     `.nav-label { overflow-x: clip }`, so the item-level clip was never
     load-bearing for it. */
  .nav-item.has-badge {
    /* Set from the measured badge box plus the row's own side padding, not a
       flat 22px guess: a two-digit count needs more room than the round "9" the
       old value was sized for, and the reserve is also what keeps the count a
       full side-padding clear of the segment's rim. */
    padding-inline-end: var(--nav-item-pad-x);
  }

  .nav-item-dot {
    position: absolute;
    left: var(--nav-dot-x);
    top: var(--nav-dot-y);
    width: var(--nav-dot-size);
    height: var(--nav-dot-size);
    border-radius: 50%;
    background: var(--md-error);
    pointer-events: none;
  }

  .nav-dot {
    position: absolute;
    left: var(--nav-dot-x);
    top: var(--nav-dot-y);
    width: var(--nav-dot-size);
    height: var(--nav-dot-size);
    border-radius: 50%;
    background: var(--md-error);
    pointer-events: none;
  }

  /* Circular FAB - height matches floating-nav via stretch + aspect-ratio */
  .fab-btn {
    align-self: stretch;
    width: auto;
    height: auto;
    aspect-ratio: 1 / 1;
    /* Square, and stretched to the pill's height: the floor is
       NAV_FAB_SIZE_PX (see nav-layout.ts), injected as --fab-size. */
    min-width: var(--fab-size);
    min-height: var(--fab-size);
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border: none;
    outline: none;
    box-shadow: var(--md-elevation-3);
    transition:
      transform var(--motion-fast, 120ms) var(--motion-ease, ease-out),
      box-shadow var(--motion-fast, 120ms) var(--motion-ease, ease-out),
      background-color var(--motion-fast, 120ms) var(--motion-ease, ease-out),
      opacity var(--motion-fast, 120ms) linear;
  }

  .fab-btn:hover:not(:disabled) {
    transform: scale(1.02);
    /* MD3 FAB interaction: level 3 resting → level 4 hovered. */
    box-shadow: var(--md-elevation-4);
  }

  .fab-btn:active:not(:disabled) {
    transform: scale(0.98);
    box-shadow: var(--md-elevation-2);
  }

  .fab-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .fab-btn:focus-visible {
    outline: 2px solid var(--md-primary);
    outline-offset: 2px;
  }

  .fab-primary {
    background-color: var(--md-primary);
    color: var(--md-on-primary);
  }

  .fab-primary:hover:not(:disabled) {
    filter: brightness(1.08);
  }

  .fab-ghost {
    background-color: color-mix(in srgb, var(--md-surface-container-high) 92%, transparent);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    color: var(--md-primary);
    border: 1px solid color-mix(in srgb, var(--md-outline-variant) 50%, transparent);
  }

  .fab-ghost:hover:not(:disabled) {
    background-color: color-mix(in srgb, var(--md-primary) 12%, var(--md-surface-container-high));
  }

  .fab-pop {
    animation: fab-in 160ms var(--motion-ease, ease-out);
  }

  /* Entry animations declare no fill mode: a retaining fill keeps the animated
     transform, which leaves a permanent stacking context behind and jails every
     overlay inside the element (see the rule at the top of src/styles.css and
     `bun run audit-z-layers`). The `to` pose is the element's own. */
  @keyframes fab-in {
    from {
      opacity: 0;
      transform: scale(0.96) translateY(4px);
    }
    to {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pill-indicator {
      transition: none;
    }
    .nav-icon {
      transition: none;
    }
    .fab-pop {
      animation: none;
    }
    .fab-btn {
      transition: none;
    }
  }
</style>
