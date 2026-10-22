/**
 * Single source of truth for overlay stacking (extension UI).
 * Always portal dialogs to document.body when they must sit above AddressSelector
 * or any transform-containing ancestor.
 *
 * Scale (low → high):
 *  chrome (30) < account selector (40) < inline menus (50) < nav/more menus (100)
 *  < account ⋮ menus (110) < submenus (120) < offline banner (2000) < print bar (5000)
 *  < toast (9000) < modal dialogs (10000) < dialog menus (10001)
 *  < tour (10050) < tooltips (100000) < viewport restriction (110000)
 *
 * ── A number only works if no ancestor is a stacking context ───────────────
 * An overlay nested under a stacking-context ancestor is jailed: its z-index is
 * resolved inside that ancestor, so it can never paint above a SIBLING of it no
 * matter how large the number. `.view-crossfade` (every view's wrapper) kept a
 * retained `transform` from its entry animation, which made it exactly such an
 * ancestor - the floating nav island (a sibling, at `chrome`) painted ABOVE an
 * in-view menu at `menu`, so the language selector appeared behind the navbar.
 * Before raising a number, check the ancestor chain: `bun run audit-z-layers`
 * fails when an entry animation in `src/styles.css` retains a transform, and
 * the same rule is why a view's flyout must never rely on being above chrome.
 *
 * ── Content script overlays (page context) ────────────────────────────────
 * Content scripts inject UI into the *page* DOM, not the extension popup DOM.
 * The page may have arbitrary z-index values, so content-script overlays use
 * a very high z-index to guarantee visibility above all page content:
 *
 *   CONTENT_Z  = 2147483645   (wait-otp-panel.ts overlay)
 *   CONTENT_Z_TOOLTIP = 2147483646  (autofill hint tooltips)
 *
 * These are intentionally near the browser's max safe z-index (2147483647)
 * to defeat even aggressive page-level stacking contexts (e.g. fixed headers
 * with z-index: 999999). They do NOT participate in the extension UI scale
 * above because they render in a separate document context (the page's DOM).
 */
export const CONTENT_Z = {
  /** Autofill button containers (small icons next to form fields) */
  button: 10000,
  /** Wait-for-OTP panel and other injected floating panels (shadow DOM) */
  overlay: 2147483645,
  /** Autofill hint tooltips, conflict chips, and fill-all variant containers */
  tooltip: 2147483646,
  /** Autofill popup menus and button containers (highest content-script layer) */
  popup: 2147483647,
  /** Inline suggestion/warning chips (absolute, relative to form field) */
  chip: 10001,
} as const;

export const PORTAL_Z = {
  /**
   * App + view chrome: the floating nav island (and its demo badge) and the
   * sticky header strips a view owns. Chrome paints above view CONTENT but
   * below the first overlay layer, so a flyout anchored near the bottom edge is
   * never occluded by the nav island. Never raise chrome to beat a menu - an
   * overlay above `chrome` takes a layer from this scale.
   */
  chrome: 30,
  /** Inline dropdown menus anchored to a field/control (above page content) */
  menu: 50,
  /** In-pane overlays in split view (absolute; above pane content) */
  splitOverlay: 50,
  /** Floating more-menu / nav popovers */
  navMenu: 100,
  /** Drag-select marquee rectangles (fixed; above list rows) */
  marquee: 100,
  /** Drag marquee border (fixed; above marquee fill but below nav menus) */
  marqueeBorder: 140,
  /** Address selector overlay (must stay below dialogs) */
  accountSelector: 40,
  /** Address card ⋮ menus (fixed, still below dialogs) */
  accountMenu: 110,
  /** Portaled child menus above their parent menu, below modal dialogs. */
  submenu: 120,
  /** Offline banner */
  offlineBanner: 2000,
  /** Toasts (bottom-right; below modal dialogs so confirms stay readable) */
  toast: 9000,
  /** Confirm / Tag / Export / Import dialogs (body-portaled) */
  dialog: 10000,
  /** Dropdown menus opened INSIDE a body-portaled dialog/overlay (z-10000).
   * The menu is itself portaled to body, so it must stack above the dialog
   * surface; stays below the product tour. Pass via <Dropdown zIndex={...}>. */
  dialogMenu: 10001,
  /** Product tour */
  tour: 10050,
  /** Native-feeling tooltips at app root */
  tooltip: 100000,
  /** Non-dismissible guard when the extension viewport is below its minimum */
  viewportRestriction: 110000,
} as const;

/** Tailwind-friendly class fragments for common layers */
export const PORTAL_Z_CLASS = {
  chrome: 'z-[30]',
  menu: 'z-[50]',
  splitOverlay: 'z-[50]',
  navMenu: 'z-[100]',
  marquee: 'z-[100]',
  marqueeBorder: 'z-[140]',
  accountSelector: 'z-[40]',
  accountMenu: 'z-[110]',
  submenu: 'z-[120]',
  offlineBanner: 'z-[2000]',
  toast: 'z-[9000]',
  dialog: 'z-[10000]',
  dialogMenu: 'z-[10001]',
  tour: 'z-[10050]',
  tooltip: 'z-[100000]',
  viewportRestriction: 'z-[110000]',
} as const;

/**
 * Move an element to document.body if not already there.
 * Returns cleanup that re-parents or removes when appropriate.
 */
export function portalToBody(el: HTMLElement | null | undefined): () => void {
  if (!el || typeof document === 'undefined') return () => {};
  if (el.parentElement !== document.body) {
    document.body.appendChild(el);
  }
  return () => {
    try {
      if (el.parentElement === document.body) el.remove();
    } catch {
      /* ignore */
    }
  };
}

/**
 * Svelte `use:` action form of portalToBody.
 *
 * Returns the `{ destroy }` object form so it satisfies Svelte 5's
 * `Action` return contract (`void | ActionReturn`), which a bare
 * `() => void` cleanup does not. Use on blocking-dialog overlay roots:
 *   `<div use:portalDialogAction class="fixed inset-0 z-[10000]" ...>`
 */
export function portalDialogAction(node: HTMLElement): { destroy: () => void } {
  const cleanup = portalToBody(node);
  return { destroy: cleanup };
}

/**
 * Svelte `use:` action that moves a TRANSIENT FLYOUT to `document.body`.
 *
 * Same mechanics as `portalDialogAction`; the name is the only difference, and
 * it is the fix for a flyout that is (a) clipped by the scroll container it was
 * authored in and (b) jailed below app chrome by a stacking context between it
 * and the view root. A portaled flyout takes its layer in the ROOT stacking
 * context, where the scale's ordering is the one that holds on screen. See
 * `LanguageMenu.svelte` for the pattern (re-placed on scroll/resize, capped to
 * the space it has).
 */
export const portalFlyoutAction = portalDialogAction;

/**
 * Splitpane-aware portal action: portals to trigger's splitpane container if invoked inside splitpane,
 * else defaults to document.body.
 */
export function portalToTriggerContainer(
  node: HTMLElement,
  triggerElement?: HTMLElement | null
): { destroy: () => void } {
  if (!node || typeof document === 'undefined') return { destroy: () => {} };
  const targetContainer =
    (triggerElement?.closest(
      '#splitpane-container, .splitpane-pane, [data-splitpane-container]'
    ) as HTMLElement | null) || document.body;
  if (node.parentElement !== targetContainer) {
    targetContainer.appendChild(node);
  }
  return {
    destroy: () => {
      try {
        if (node.parentElement === targetContainer) node.remove();
      } catch {
        /* ignore */
      }
    },
  };
}
