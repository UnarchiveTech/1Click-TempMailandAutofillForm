import { get } from 'svelte/store';
import { locale, t } from 'svelte-i18n';
import { localeFontScale } from '@/utils/i18n/locale-font-scale.js';
import { resolveLabelTrackingPx } from '@/utils/ui/fit-label-font.js';
import { normalizeAutoArrangeMore } from '@/utils/ui/more-menu-layout.js';
import {
  computeNavLayout,
  NAV_BADGE_FONT_PX,
  NAV_BADGE_MIN_W_PX,
  NAV_BADGE_PAD_X_PX,
  NAV_BADGE_WIDEST_TEXT,
  NAV_ITEM_PAD_X_MIN_PX,
  NAV_ITEM_PADDING_PX,
  NAV_LABEL_DEFAULT_FONT_PX,
  NAV_LABEL_FONT_WEIGHT,
  NAV_LABEL_KEYS,
  NAV_LABEL_MIN_FONT_PX,
  type NavIndicatorMode,
  normalizeNavIndicatorModes,
  normalizeNavOrder,
  normalizePrimaryItemsPref,
  type PrimaryItemsPref,
} from '@/utils/ui/nav-layout.js';

/**
 * Single source of truth for the adaptive chrome layout.
 *
 * All layout chrome (Header, SidebarNav, Footer, and AppLayout's shell logic)
 * reads the nav stage, the measured label widths, and the More-menu contents
 * from here instead of duplicating state/props.
 *
 * Ownership:
 *   - AppLayout measures the shell width (ResizeObserver) and calls
 *     setNavShellWidth; it owns the label-measurement TRIGGER (locale change,
 *     first mount) because svelte-i18n initializes asynchronously.
 *   - The nav split itself (primary vs More) is computed here from the shell
 *     width + measured label widths (locale-aware, see nav-layout.ts).
 *
 * Pattern: runes must live inside a function so exported state can be
 * reassigned (Svelte forbids reassigning exported module-level state). Getters
 * keep every read reactive.
 */
export const layoutStore = (() => {
  /** Shell width driving the nav ladder (measured by AppLayout). */
  let navShellWidth = $state(typeof window !== 'undefined' ? window.innerWidth : 360);

  /** User-customized navbar order (NavbarOrder settings; empty = canonical). */
  let customNavOrder = $state<string[]>([]);

  /**
   * User preference for how many items stay primary before the rest collapse
   * into More ('auto' = fit as many as possible, 1|2|3 = force that many).
   * Persisted as the `minPrimaryItems` storage key by NavbarOrderSettingsView.
   */
  let minPrimaryItems = $state<PrimaryItemsPref>('auto');

  /**
   * Whether the More submenu may reorder itself for fewer rows (fix-only: the
   * canonical order wins every tie). Submenu-only - the pill and the
   * primary↔More boundary never reorder. Persisted as the `autoArrangeMore`
   * storage key by NavbarOrderSettingsView; ON by default.
   */
  let autoArrangeMore = $state(true);

  /** Per-item status display. Missing/new items normalize to the dot default. */
  let navIndicatorModes = $state<Record<string, NavIndicatorMode>>(
    normalizeNavIndicatorModes(undefined)
  );

  /** Measured translated nav-label widths (label text + .nav-item padding). */
  let navLabelWidths = $state<Record<string, number>>({});

  /**
   * The same items at the pill's FLOOR font and padding - the smallest the row
   * can ever be drawn. Membership may drop below `MIN_PRIMARY_ITEMS` only when
   * even this does not fit (see `computeNavLayout`).
   */
  let navFloorItemWidths = $state<Record<string, number>>({});

  /** Adaptive nav layout: primary items, More contents, stage - locale-aware. */
  const navLayout = $derived(
    computeNavLayout(
      navShellWidth,
      customNavOrder,
      navLabelWidths,
      minPrimaryItems,
      navFloorItemWidths
    )
  );

  function setNavShellWidth(width: number) {
    navShellWidth = width;
  }

  /** Set the user's navbar order (invalid/duplicate/obsolete keys are repaired). */
  function setCustomNavOrder(order: string[]) {
    customNavOrder = normalizeNavOrder(order);
  }

  /** Set the user's primary-items preference (normalizes invalid input). */
  function setMinPrimaryItems(pref: unknown) {
    minPrimaryItems = normalizePrimaryItemsPref(pref);
  }

  /** Set the More-submenu auto-arrange preference (defaults ON). */
  function setAutoArrangeMore(pref: unknown) {
    autoArrangeMore = normalizeAutoArrangeMore(pref);
  }

  function setNavIndicatorModes(pref: unknown) {
    navIndicatorModes = normalizeNavIndicatorModes(pref);
  }

  /**
   * Re-measure the translated nav labels at the locale's reference font size
   * (the pill's pre-fit default × localeFontScale - both read from the
   * nav-layout constants, so this probe cannot measure at a size the pill never
   * renders). Call on mount and whenever the locale changes.
   *
   * Each item's width is what the PILL has to pay for it, not just its text:
   *
   *   - the item's own padding, and
   *   - the unread count's reserve on the item that carries it, laid out by the
   *     browser with the badge's real styles (never re-derived from a formula)
   *     and always sized for the widest count, so unread arriving cannot resize
   *     the island.
   *
   * Membership that ignores the reserve calls a row affordable that the pill then
   * has to pay for another way - which is how a narrow shell ended up shaving a
   * few pixels off every label's last letter instead of dropping one item into
   * More. The row-level icon lane is deducted in `fitPrimaryCount` instead, since
   * exactly one item pays it.
   */
  function refreshNavLabelWidths() {
    if (typeof document === 'undefined') return;
    const lang = typeof get(locale) === 'string' ? get(locale) : 'en';
    const fontPx = NAV_LABEL_DEFAULT_FONT_PX * localeFontScale(lang);
    const holder = document.createElement('div');
    holder.setAttribute('aria-hidden', 'true');
    holder.style.cssText = `position:fixed;left:-9999px;top:0;visibility:hidden;pointer-events:none;white-space:nowrap;font-weight:${NAV_LABEL_FONT_WEIGHT};z-index:-1;`;
    holder.style.fontSize = `${fontPx}px`;
    const entries: Array<[string, HTMLSpanElement]> = [];
    const floorEntries: Array<[string, HTMLSpanElement]> = [];
    const tFn = get(t);
    for (const { key, labelKey } of NAV_LABEL_KEYS) {
      const span = document.createElement('span');
      span.textContent = tFn(labelKey);
      holder.appendChild(span);
      entries.push([key, span]);
      // The same label at the pill's floor font, for the affordability test.
      const floorSpan = document.createElement('span');
      floorSpan.textContent = tFn(labelKey);
      floorSpan.style.fontSize = `${NAV_LABEL_MIN_FONT_PX * localeFontScale(lang)}px`;
      holder.appendChild(floorSpan);
      floorEntries.push([key, floorSpan]);
    }
    // The count's own box, in the same holder: the pill reserves it on the
    // mailbox item whether or not there is unread mail.
    const badge = document.createElement('span');
    badge.textContent = NAV_BADGE_WIDEST_TEXT;
    badge.style.cssText = `display:inline-block;box-sizing:border-box;min-width:${NAV_BADGE_MIN_W_PX}px;padding:0 ${NAV_BADGE_PAD_X_PX}px;font-size:${NAV_BADGE_FONT_PX}px;font-weight:700;line-height:1;white-space:nowrap;`;
    holder.appendChild(badge);
    document.body.appendChild(holder);
    const badgeReservePx = Math.ceil(badge.getBoundingClientRect().width);
    // The label's own tracking (0.5px per character from the global strip rule)
    // is part of every label's width, and the probe's spans do not carry it -
    // measuring without it under-reserves each item, which is how membership kept
    // one item too many and left the fit to shave the difference off every label.
    const tracking = resolveLabelTrackingPx(document.querySelector('.floating-nav'));
    const labelWidth = (span: HTMLSpanElement): number =>
      Math.ceil(span.getBoundingClientRect().width + tracking * (span.textContent?.length ?? 0));
    const next: Record<string, number> = {};
    const floorNext: Record<string, number> = {};
    for (const [key, span] of entries) {
      const carriesCount = navIndicatorModes[key] === 'count';
      next[key] = labelWidth(span) + NAV_ITEM_PADDING_PX + (carriesCount ? badgeReservePx : 0);
    }
    for (const [key, span] of floorEntries) {
      const carriesCount = navIndicatorModes[key] === 'count';
      floorNext[key] =
        labelWidth(span) + NAV_ITEM_PAD_X_MIN_PX * 2 + (carriesCount ? badgeReservePx : 0);
    }
    holder.remove();
    navLabelWidths = next;
    navFloorItemWidths = floorNext;
  }

  return {
    get navShellWidth() {
      return navShellWidth;
    },
    get customNavOrder() {
      return customNavOrder;
    },
    get minPrimaryItems() {
      return minPrimaryItems;
    },
    get autoArrangeMore() {
      return autoArrangeMore;
    },
    get navIndicatorModes() {
      return navIndicatorModes;
    },
    get navLabelWidths() {
      return navLabelWidths;
    },
    get navFloorItemWidths() {
      return navFloorItemWidths;
    },
    get navLayout() {
      return navLayout;
    },
    setNavShellWidth,
    setCustomNavOrder,
    setMinPrimaryItems,
    setAutoArrangeMore,
    setNavIndicatorModes,
    refreshNavLabelWidths,
  };
})();
