/**
 * The ONLY import surface of `tests/visual/preview-responsive-button-layout.html`.
 *
 * The page never transcribes app logic: the action responsive fitting, the nav pill's
 * fitter, its placement math, the shared canvas measurement and the nav's
 * geometry tokens are all re-exported here and bundled into
 * `tests/visual/preview-responsive-button-layout-module.js` by
 * `bun scripts/generate-responsive-button-layout-module.ts`. The preview therefore runs the code
 * the extension ships - a hand-copied module can only ever be as right as the
 * last person who remembered to update it, and it silently verified a snapshot
 * of the responsive fitting for as long as nobody did.
 *
 * The nav strings are NOT bundled from here: they are extracted from
 * `src/locales/*.json` by the generator (the `NAV_LABELS` export it appends),
 * so the nav panels render the REAL translated labels - the same strings
 * `computeNavLayout` measures - while the artifact stays a few KB instead of
 * inlining eight dictionaries into a preview page.
 */

export { localeFontScale } from '../../src/utils/i18n/locale-font-scale.js';
export {
  BODY_FONT_FAMILY,
  createLabelMetrics,
  resolveLabelFontFamily,
} from '../../src/utils/ui/fit-label-font.js';
export {
  badgeAnchorText,
  fitNavPill,
  navBadgeEndPadPx,
  navBadgePlacementPx,
  navBadgeWidthPx,
} from '../../src/utils/ui/fit-nav-pill.js';
export {
  computeNavLayout,
  MORE_ITEM_PAD_BLOCK_PX,
  MORE_ITEM_PAD_X_PX,
  NAV_BADGE_FONT_PX,
  NAV_BADGE_GAP_PX,
  NAV_BADGE_HEIGHT_PX,
  NAV_BADGE_MIN_W_PX,
  NAV_BADGE_PAD_X_PX,
  NAV_BADGE_WIDEST_TEXT,
  NAV_FAB_SIZE_PX,
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
  NAV_LABEL_DEFAULT_FONT_PX,
  NAV_LABEL_FONT_WEIGHT,
  NAV_LABEL_KEYS,
  NAV_LABEL_MIN_FONT_PX,
  NAV_PILL_ICON_LANE_PX,
  NAV_RESERVED_OUTER_PX,
  NAV_TOKEN_VARS,
  navBadgeTextFor,
  navKeyCarriesUnreadCount,
  navTokenStyle,
} from '../../src/utils/ui/nav-layout.js';
export {
  ACTION_BTN_TIER_DEFAULT,
  ACTION_BTN_TIERS,
  ACTION_BTN_TYPOGRAPHY_STEPS,
  coupledIconGap,
  iconForFont,
  interButtonGapForPadding,
  nextTypographyStep,
  responsiveButtonLayout,
} from '../../src/utils/ui/responsive-button-layout.js';
