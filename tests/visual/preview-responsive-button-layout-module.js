// GENERATED FILE - do not edit.
// Source: tests/visual/preview-responsive-button-layout-entry.ts (bun run generate-responsive-button-layout-module)
// Bun: 1.4.3
// src/utils/i18n/locale-font-scale.ts
function localeFontScale(lang) {
  const l = (lang || "en").toLowerCase().split("-")[0];
  switch (l) {
    case "de":
    case "fr":
      return 0.88;
    case "es":
    case "ar":
      return 0.9;
    case "ja":
    case "zh":
    case "th":
      return 0.95;
    default:
      return 1;
  }
}
// src/utils/ui/fit-label-font.ts
var BODY_FONT_FAMILY = 'Roboto, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", "Helvetica Neue", Arial, sans-serif';
var DEFAULT_FONT = BODY_FONT_FAMILY;
function resolveLabelFontFamily(el) {
  if (!el || typeof getComputedStyle !== "function")
    return BODY_FONT_FAMILY;
  const resolved = getComputedStyle(el).fontFamily;
  return resolved || BODY_FONT_FAMILY;
}
function advanceWithTrackingPx(rawWidthPx, text, letterSpacingPx) {
  return rawWidthPx + letterSpacingPx * text.length;
}
function createLabelMetrics(fontFamily = DEFAULT_FONT, letterSpacingPx = 0) {
  let ctx = null;
  const context = () => {
    if (typeof document === "undefined")
      return null;
    if (!ctx)
      ctx = document.createElement("canvas").getContext("2d");
    return ctx;
  };
  const setFont = (c, sizePx, weight) => {
    c.font = `${weight} ${sizePx}px ${fontFamily}`;
  };
  return {
    width(text, sizePx, weight) {
      const c = context();
      if (!c)
        return 0;
      setFont(c, sizePx, weight);
      return advanceWithTrackingPx(c.measureText(text).width, text, letterSpacingPx);
    },
    ink(text, sizePx, weight, anchor) {
      const c = context();
      const fallback = {
        inkAscentPx: 0,
        inkRightPx: 0,
        fontAscentPx: sizePx,
        fontDescentPx: 0
      };
      if (!c)
        return fallback;
      setFont(c, sizePx, weight);
      const whole = c.measureText(text);
      const anchored = anchor === undefined || anchor === text ? whole : c.measureText(anchor);
      return {
        inkAscentPx: anchored.actualBoundingBoxAscent ?? 0,
        inkRightPx: anchored.actualBoundingBoxRight ?? anchored.width,
        fontAscentPx: whole.fontBoundingBoxAscent ?? sizePx,
        fontDescentPx: whole.fontBoundingBoxDescent ?? 0
      };
    }
  };
}
// src/ui/views/AboutView.nav.ts
var navBarItem = {
  order: 8,
  key: "about",
  view: "about",
  labelKey: "nav.about",
  iconName: "info"
};

// src/ui/views/ActivityView.nav.ts
var navBarItem2 = {
  order: 6,
  key: "activity",
  view: "analytics",
  labelKey: "nav.activity",
  iconName: "analytics"
};

// src/ui/views/AutomationView.nav.ts
var navBarItem3 = {
  order: 5,
  key: "automation",
  view: "automation",
  labelKey: "nav.automation",
  iconName: "automation"
};

// src/ui/views/addresses/AddressesView.nav.ts
var navBarItem4 = {
  order: 2,
  key: "addresses",
  view: "addresses",
  labelKey: "nav.addresses",
  iconName: "allInbox"
};

// src/ui/views/autofill/AutofillView.nav.ts
var navBarItem5 = {
  order: 3,
  key: "autofill",
  view: "autofill",
  labelKey: "nav.autofill",
  iconName: "editSquare"
};

// src/ui/views/mailbox/MailboxView.nav.ts
var navBarItem6 = {
  order: 1,
  key: "mailbox",
  view: "mailbox",
  labelKey: "nav.mailbox",
  iconName: "inbox"
};

// src/ui/views/OrganizeView.nav.ts
var navBarItem7 = {
  order: 4,
  key: "organize",
  view: "organize",
  labelKey: "nav.organize",
  iconName: "gridView"
};

// src/ui/views/SettingsView.nav.ts
var navBarItem8 = {
  order: 7,
  key: "settings",
  view: "settings",
  labelKey: "common.settings",
  iconName: "settings"
};

// src/utils/ui/breakpoints.ts
var NAV_SEVEN_MIN = 520;
var NAV_SIX_MIN = 440;
var NAV_PLUS_ORGANIZE_MIN = 400;

// src/utils/ui/nav-layout.ts
var NAV_ITEM_PADDING_PX = 28;
var NAV_GAP_PX = 6;
var NAV_FLOAT_INSET_PX = 15;
var NAV_FLOAT_CONTENT_WIDTH_CSS = `calc(100% - ${2 * NAV_FLOAT_INSET_PX}px)`;
var NAV_FAB_SIZE_PX = 36;
var NAV_SCALE_HEADROOM_PX = 4;
var NAV_LABEL_DEFAULT_FONT_PX = 13;
var NAV_LABEL_BASE_FONT_PX = 14;
var NAV_LABEL_MIN_FONT_PX = 10;
var NAV_ITEM_PAD_X_MAX_PX = NAV_ITEM_PADDING_PX / 2;
var NAV_ITEM_PAD_X_MIN_PX = 4;
var NAV_ICON_SIZE_PX = 18;
var NAV_ITEM_PAD_BLOCK_PX = 8;
var MORE_ITEM_PAD_BLOCK_PX = 6;
var MORE_ITEM_PAD_X_PX = 10;
var NAV_LABEL_FONT_WEIGHT = 700;
var NAV_BADGE_FONT_PX = 9;
var NAV_BADGE_HEIGHT_PX = 14;
var NAV_DOT_SIZE_PX = 7;
var NAV_DOT_GAP_PX = 4;
var NAV_ICON_GAP_PX = 3;
var NAV_ITEM_RADIUS_PX = 28;
var NAV_ISLAND_RADIUS_PX = 36;
var NAV_BADGE_PAD_X_PX = 3;
var NAV_BADGE_MIN_W_PX = 14;
var NAV_BADGE_WIDEST_TEXT = "99+";
function navBadgeTextFor(totalUnread) {
  return totalUnread > 99 ? NAV_BADGE_WIDEST_TEXT : String(totalUnread);
}
var NAV_BADGE_GAP_PX = 0;
var NAV_RESERVED_OUTER_PX = 2 * NAV_FLOAT_INSET_PX + NAV_FAB_SIZE_PX + NAV_GAP_PX + NAV_SCALE_HEADROOM_PX;
var MIN_PRIMARY_ITEMS = 3;
var NAV_PILL_ICON_LANE_PX = NAV_ICON_SIZE_PX + NAV_ICON_GAP_PX;
var NAV_FLAGS = [
  navBarItem6,
  navBarItem4,
  navBarItem5,
  navBarItem7,
  navBarItem3,
  navBarItem2,
  navBarItem8,
  navBarItem
];
var NAV_FLAGS_ORDERED = [...NAV_FLAGS].sort((a, b) => a.order - b.order);
var DEFAULT_NAV_ORDER = NAV_FLAGS_ORDERED.map((f) => f.key);
var NAV_LABEL_KEYS = [
  ...NAV_FLAGS_ORDERED.map((f) => ({ key: f.key, labelKey: f.labelKey })),
  { key: "more", labelKey: "nav.more" }
];
var NAV_ITEM_BY_KEY = new Map(NAV_FLAGS.map((f) => [f.key, { view: f.view, labelKey: f.labelKey, iconName: f.iconName }]));
var NAV_KEY_BY_VIEW = new Map(NAV_FLAGS.map((flag) => [flag.view, flag.key]));
var SUBPAGE_VIEWS = new Set([
  "loginInfo",
  "addressView",
  "mailView",
  "identities",
  "keybindings",
  "tagManagement",
  "filtersManagement",
  "labelManagement",
  "mailProvider",
  "storagePerformance",
  "constantsSettings",
  "diagnostics",
  "playground"
]);
function validateNavFlags(flags) {
  const seenKeys = new Set;
  const seenViews = new Set;
  const seenOrders = new Set;
  for (const flag of flags) {
    if (seenKeys.has(flag.key)) {
      throw new Error(`Navbar flag: duplicate key '${flag.key}' - each navbar item needs a unique key.`);
    }
    if (seenViews.has(flag.view)) {
      throw new Error(`Navbar flag: duplicate view '${flag.view}' - each navbar item needs a unique view.`);
    }
    if (!Number.isInteger(flag.order) || flag.order < 1) {
      throw new Error(`Navbar flag: '${flag.key}' has invalid order ${flag.order} - order must be a positive integer.`);
    }
    if (seenOrders.has(flag.order)) {
      throw new Error(`Navbar flag: order collision - '${flag.key}' and another flag both declare order ${flag.order}. Each navbar item needs a unique order.`);
    }
    if (SUBPAGE_VIEWS.has(flag.view)) {
      throw new Error(`Navbar flag: '${flag.view}' is a sub-page view and cannot be promoted to the navbar.`);
    }
    seenKeys.add(flag.key);
    seenViews.add(flag.view);
    seenOrders.add(flag.order);
  }
  for (let i = 1;i <= flags.length; i++) {
    if (!seenOrders.has(i)) {
      throw new Error(`Navbar flag: order gap - no flag declares order ${i} of 1..${flags.length}. Orders must be exactly 1..${flags.length} (renumber when adding or removing items).`);
    }
  }
}
validateNavFlags(NAV_FLAGS);
function stageForWidth(w) {
  if (w >= NAV_SEVEN_MIN)
    return "seven";
  if (w >= NAV_SIX_MIN)
    return "six";
  if (w >= NAV_PLUS_ORGANIZE_MIN)
    return "plus_organize";
  return "compact";
}
function fitPrimaryCount(shellWidth, orderedViews, measured, pref, floorMeasured) {
  const avail = shellWidth - NAV_RESERVED_OUTER_PX - NAV_PILL_ICON_LANE_PX;
  const forced = pref !== "auto";
  const widthOf = (widths, key) => widths[key] ?? 64;
  if (!forced) {
    let total = 0;
    for (const v of orderedViews)
      total += widthOf(measured, v);
    if (total <= avail)
      return orderedViews.length;
  }
  const greedy = (widths) => {
    const availPrimary = avail - widthOf(widths, "more");
    let running = 0;
    let count = 0;
    for (const v of orderedViews) {
      const w = widthOf(widths, v);
      if (running + w > availPrimary)
        break;
      running += w;
      count++;
    }
    return count;
  };
  const count = greedy(measured);
  if (forced)
    return Math.max(1, Math.min(count, pref));
  const preferred = Math.max(MIN_PRIMARY_ITEMS, count);
  if (!floorMeasured)
    return preferred;
  const affordable = Math.max(1, greedy(floorMeasured));
  return Math.max(1, Math.min(preferred, affordable));
}
function stageLabelForCount(count) {
  if (count >= 8)
    return "seven";
  if (count >= 5)
    return "six";
  if (count === 4)
    return "plus_organize";
  return "compact";
}
function navItemFor(key) {
  return NAV_ITEM_BY_KEY.get(key) ?? { view: "mailbox", labelKey: "nav.mailbox", iconName: "inbox" };
}
function navKeyCarriesUnreadCount(key) {
  return NAV_ITEM_BY_KEY.get(key)?.view === "mailbox";
}
function normalizeNavOrder(raw) {
  const ordered = [];
  const seen = new Set;
  for (const value of Array.isArray(raw) ? raw : []) {
    if (typeof value !== "string" || seen.has(value))
      continue;
    if (!DEFAULT_NAV_ORDER.includes(value))
      continue;
    seen.add(value);
    ordered.push(value);
  }
  for (const key of DEFAULT_NAV_ORDER)
    if (!seen.has(key))
      ordered.push(key);
  return ordered;
}
function computeNavLayout(shellWidth, customNavOrder = [], measuredItemWidths = {}, minPrimary = "auto", floorItemWidths = {}) {
  const fallbackStage = stageForWidth(shellWidth);
  const fullOrder = normalizeNavOrder(customNavOrder);
  const hasMeasurements = Object.keys(measuredItemWidths).length > 0;
  const fallbackLadder = fallbackStage === "seven" ? 8 : fallbackStage === "six" ? 5 : fallbackStage === "plus_organize" ? 4 : 3;
  const countVisible = hasMeasurements ? fitPrimaryCount(shellWidth, fullOrder, measuredItemWidths, minPrimary, Object.keys(floorItemWidths).length ? floorItemWidths : undefined) : minPrimary === "auto" ? fallbackLadder : Math.min(fallbackLadder, minPrimary);
  if (countVisible >= 8) {
    return {
      stage: "seven",
      primaryNav: fullOrder.map(navItemFor),
      moreItems: [],
      moreViewSet: new Set
    };
  }
  const primaryKeys = fullOrder.slice(0, countVisible);
  const overflowKeys = fullOrder.slice(countVisible);
  const primaryNav = [
    ...primaryKeys.map(navItemFor),
    { view: "more", labelKey: "nav.more", iconName: "moreHoriz" }
  ];
  const moreItems = overflowKeys.map(navItemFor);
  return {
    stage: hasMeasurements ? stageLabelForCount(countVisible) : fallbackStage,
    primaryNav,
    moreItems,
    moreViewSet: new Set(moreItems.map((m) => m.view))
  };
}
var NAV_TOKEN_VARS = {
  "--nav-item-radius": NAV_ITEM_RADIUS_PX,
  "--nav-island-radius": NAV_ISLAND_RADIUS_PX,
  "--nav-icon-size": NAV_ICON_SIZE_PX,
  "--nav-icon-gap": NAV_ICON_GAP_PX,
  "--nav-label-weight": String(NAV_LABEL_FONT_WEIGHT),
  "--nav-badge-height": NAV_BADGE_HEIGHT_PX,
  "--nav-badge-font-size": NAV_BADGE_FONT_PX,
  "--nav-badge-pad-x": NAV_BADGE_PAD_X_PX,
  "--nav-badge-min-w": NAV_BADGE_MIN_W_PX,
  "--more-menu-pad-x": MORE_ITEM_PAD_X_PX,
  "--more-menu-pad-block-end": MORE_ITEM_PAD_BLOCK_PX
};
function navTokenStyle() {
  return Object.entries(NAV_TOKEN_VARS).map(([name, value]) => `${name}: ${typeof value === "number" ? `${value}px` : value}`).join("; ");
}

// src/utils/ui/fit-nav-pill.ts
var COMBINING_MARK_RE = /\p{M}/u;
function badgeAnchorText(label) {
  const chars = [...label];
  let start = chars.length - 1;
  while (start > 0 && COMBINING_MARK_RE.test(chars[start]))
    start -= 1;
  return chars.slice(Math.max(0, start)).join("");
}
var NAV_ACTIVE_ICON_PX = NAV_ICON_SIZE_PX + NAV_ICON_GAP_PX;
var NAV_BADGE_WEIGHT = 700;
var NAV_BADGE_RIM_CLEARANCE_PX = 2;
var NAV_FONT_STEP_PX = 0.25;
var roundQuarter = (value) => Math.round(value * 100) / 100;
function navBadgeWidthPx(badgeText, measure) {
  if (!badgeText)
    return 0;
  return Math.max(NAV_BADGE_MIN_W_PX, measure(badgeText, NAV_BADGE_FONT_PX, NAV_BADGE_WEIGHT) + 2 * NAV_BADGE_PAD_X_PX);
}
function navBadgeEndPadPx(badgeWidth, padX) {
  return badgeWidth > 0 ? padX + NAV_BADGE_GAP_PX + badgeWidth : padX;
}
function navBadgePlacementPx(input) {
  const { padBlockEndPx, contentHeightPx, labelFontPx, inkAscentPx } = input;
  const inkTopFromLabelTop = (labelFontPx - (input.fontAscentPx + input.fontDescentPx)) / 2 + input.fontAscentPx - inkAscentPx;
  const centering = (contentHeightPx - labelFontPx) / 2;
  const needed = NAV_BADGE_HEIGHT_PX + NAV_BADGE_RIM_CLEARANCE_PX - centering - inkTopFromLabelTop;
  const padBlockStartPx = roundQuarter(Math.max(input.padBlockStartPx, needed));
  const itemHeightPx = contentHeightPx + padBlockStartPx + padBlockEndPx;
  const inkTopFromItemTop = padBlockStartPx + centering + inkTopFromLabelTop;
  const bottomInsetPx = roundQuarter(Math.max(0, Math.min(itemHeightPx - inkTopFromItemTop, itemHeightPx - NAV_BADGE_HEIGHT_PX)));
  return { padBlockStartPx, bottomInsetPx };
}
function fitNavPill(input) {
  const { labels, availPx, lang, badgeText, hasActiveIcon, measure } = input;
  const badgeCount = input.badgeCount ?? (badgeText ? 1 : 0);
  const dotCount = input.dotCount ?? 0;
  const base = NAV_LABEL_BASE_FONT_PX * localeFontScale(lang);
  const badgeW = navBadgeWidthPx(badgeText, measure);
  const endPadFor = (padX) => navBadgeEndPadPx(badgeW, padX);
  const fixedWidth = (padX, sizePx) => labels.length * padX * 2 + badgeCount * (endPadFor(padX) - padX) + dotCount * (NAV_DOT_SIZE_PX + NAV_DOT_GAP_PX) + (typeof input.extraChromePx === "function" ? input.extraChromePx(sizePx) : input.extraChromePx ?? 0) + (hasActiveIcon ? input.iconSizeFor ? input.iconSizeFor(sizePx) + NAV_ICON_GAP_PX : NAV_ACTIVE_ICON_PX : 0);
  const sumAt = (sizePx) => {
    let total = 0;
    for (const label of labels)
      total += label ? measure(label, sizePx, NAV_LABEL_FONT_WEIGHT) : 0;
    return total;
  };
  const overAt = (sizePx, pad) => Math.max(0, roundQuarter(sumAt(sizePx) + fixedWidth(pad, sizePx) - availPx));
  let padX = NAV_ITEM_PAD_X_MAX_PX;
  let fontPx = base;
  while (overAt(fontPx, padX) > 0) {
    const nextPad = padX - 2;
    if (nextPad >= NAV_ITEM_PAD_X_MIN_PX && nextPad >= 0.75 * fontPx) {
      padX = nextPad;
      continue;
    }
    if (fontPx > NAV_LABEL_MIN_FONT_PX) {
      fontPx = roundQuarter(Math.max(NAV_LABEL_MIN_FONT_PX, fontPx - NAV_FONT_STEP_PX));
      continue;
    }
    if (padX > NAV_ITEM_PAD_X_MIN_PX) {
      padX = Math.max(NAV_ITEM_PAD_X_MIN_PX, nextPad);
      continue;
    }
    break;
  }
  const overBudgetPx = overAt(fontPx, padX);
  return { fontPx, padX, padXEnd: endPadFor(padX), badgeW, overBudgetPx };
}
// src/utils/ui/responsive-button-layout.ts
var ACTION_BTN_TIERS = {
  XS: {
    labelFont: 14,
    height: 32,
    sidePadding: 12,
    interButtonGap: 8,
    icon: 20,
    iconGap: 4,
    minFont: 12,
    minIcon: 16,
    minSidePad: 4,
    minGap: 3
  },
  S: {
    labelFont: 14,
    height: 40,
    sidePadding: 16,
    interButtonGap: 12,
    icon: 20,
    iconGap: 8,
    minFont: 12,
    minIcon: 16,
    minSidePad: 4,
    minGap: 3
  },
  M: {
    labelFont: 16,
    height: 56,
    sidePadding: 24,
    interButtonGap: 8,
    icon: 24,
    iconGap: 8,
    minFont: 14,
    minIcon: 20,
    minSidePad: 8,
    minGap: 5
  },
  L: {
    labelFont: 24,
    height: 96,
    sidePadding: 48,
    interButtonGap: 8,
    icon: 32,
    iconGap: 12,
    minFont: 16,
    minIcon: 24,
    minSidePad: 12,
    minGap: 8
  },
  XL: {
    labelFont: 32,
    height: 136,
    sidePadding: 64,
    interButtonGap: 8,
    icon: 40,
    iconGap: 16,
    minFont: 24,
    minIcon: 32,
    minSidePad: 16,
    minGap: 11
  }
};
var ACTION_BTN_TIER_DEFAULT = "S";
function iconForFont(tier, fontPx) {
  return tier === "L" || tier === "XL" ? fontPx + 8 : 2 * fontPx - 8;
}
var ACTION_BTN_TYPOGRAPHY_STEPS = {
  XS: [14, 12],
  S: [14, 12],
  M: [16, 14],
  L: [24, 16],
  XL: [32, 24]
};
function nextTypographyStep(tier, fontPx) {
  const steps = ACTION_BTN_TYPOGRAPHY_STEPS[tier];
  const index = steps.indexOf(fontPx);
  return index >= 0 && index < steps.length - 1 ? steps[index + 1] : null;
}
var PAD_GAP_RATIO = 1.75;
function coupledIconGap(tier, padPx) {
  const t = ACTION_BTN_TIERS[tier];
  return Math.max(t.minGap, Math.round(padPx / PAD_GAP_RATIO));
}
var INTER_BUTTON_GAP_PADDING_RATIO = 0.75;
var MIN_INTER_BUTTON_GAP = 4;
function interButtonGapForPadding(tier, padPx, renderedGap) {
  const t = ACTION_BTN_TIERS[tier];
  const padding = Math.min(t.sidePadding, Math.max(t.minSidePad, padPx));
  return Math.min(renderedGap, t.interButtonGap, Math.max(MIN_INTER_BUTTON_GAP, INTER_BUTTON_GAP_PADDING_RATIO * padding));
}
var EPS = 0.01;
function resolveTier(node, options) {
  const attr = node.dataset.actionTier?.toUpperCase();
  if (attr && attr in ACTION_BTN_TIERS)
    return attr;
  return options.tier ?? ACTION_BTN_TIER_DEFAULT;
}
function responsiveButtonLayout(node, options = {}) {
  let tier = ACTION_BTN_TIER_DEFAULT;
  let spec = ACTION_BTN_TIERS[tier];
  let resizeObserver = null;
  let mutationObserver = null;
  let frameId = null;
  const columnButtons = new WeakSet;
  const authoredGaps = new WeakMap;
  const authoredFlexWraps = new WeakMap;
  const authoredJustifyContents = new WeakMap;
  const authoredHeights = new WeakMap;
  const activeButtons = new Set;
  let activeButtonContainer = null;
  let fontsCleanup = null;
  let settleFrameId = null;
  function scheduleSettleEvaluation() {
    if (settleFrameId !== null)
      return;
    settleFrameId = requestAnimationFrame(() => {
      settleFrameId = null;
      evaluateLayout();
    });
  }
  function scheduleEvaluation() {
    if (frameId !== null)
      return;
    frameId = requestAnimationFrame(() => {
      frameId = null;
      evaluateLayout();
      scheduleSettleEvaluation();
    });
  }
  function attachFontsListener() {
    if (typeof document === "undefined" || !document.fonts)
      return;
    let active = true;
    const onFontsDone = () => {
      if (!active)
        return;
      scheduleEvaluation();
    };
    document.fonts.addEventListener("loadingdone", onFontsDone);
    if (document.fonts.status === "loading") {
      document.fonts.ready.then(onFontsDone).catch(() => {});
    }
    fontsCleanup = () => {
      active = false;
      document.fonts.removeEventListener("loadingdone", onFontsDone);
    };
  }
  function getButtons() {
    return Array.from(node.querySelectorAll('button, a, [role="button"]')).filter((button) => button.getClientRects().length > 0);
  }
  function getLabels(button) {
    return Array.from(button.querySelectorAll(".btn-label, span"));
  }
  function restoreAuthoredGap(container) {
    if (authoredGaps.has(container)) {
      container.style.gap = authoredGaps.get(container) ?? "";
    }
  }
  function applyInterButtonGap(container, gapPx) {
    if (!authoredGaps.has(container)) {
      authoredGaps.set(container, container.style.gap);
    }
    container.style.gap = `${gapPx}px`;
  }
  function prepareElements(buttons) {
    for (const button of buttons) {
      button.style.whiteSpace = "nowrap";
      button.style.overflow = "visible";
      for (const label of getLabels(button)) {
        label.style.whiteSpace = "nowrap";
        label.style.overflow = "visible";
        label.style.flexShrink = "0";
        label.style.textOverflow = "";
        label.style.minWidth = "";
        label.style.maxWidth = "";
      }
    }
  }
  function forceInterior(button, state) {
    activeButtons.add(button);
    const isVertical = columnButtons.has(button) || getComputedStyle(button).flexDirection === "column";
    if (isVertical)
      columnButtons.add(button);
    if (isVertical && node.dataset.responsiveButtonLayoutInterior !== "fit")
      return;
    button.style.fontSize = `${state.font}px`;
    button.style.paddingLeft = `${state.pad}px`;
    button.style.paddingRight = `${state.pad}px`;
    button.style.gap = `${state.band}px`;
    if (!isVertical) {
      if (!authoredHeights.has(button)) {
        authoredHeights.set(button, {
          value: button.style.getPropertyValue("height"),
          priority: button.style.getPropertyPriority("height")
        });
      }
      button.style.setProperty("height", `${spec.height}px`);
    }
    const iconSize = iconForFont(tier, state.font);
    for (const icon of button.querySelectorAll("svg")) {
      icon.style.width = `${iconSize}px`;
      icon.style.height = `${iconSize}px`;
    }
  }
  function measureWidths(buttons, state) {
    for (const button of buttons) {
      button.style.flex = "0 0 auto";
      button.style.width = "";
      button.style.minWidth = "max-content";
      forceInterior(button, state);
    }
    return buttons.map((button) => button.getBoundingClientRect().width);
  }
  function measureGap(buttons) {
    const rects = buttons.map((button) => button.getBoundingClientRect());
    let total = 0;
    let count = 0;
    for (let i = 0;i < rects.length - 1; i += 1) {
      const gap = Math.max(rects[i + 1].left - rects[i].right, rects[i].left - rects[i + 1].right);
      if (gap >= 0) {
        total += gap;
        count += 1;
      }
    }
    return count ? total / count : 0;
  }
  function applyEqualStretch(buttons, state) {
    for (const button of buttons) {
      button.style.flex = "1 1 0%";
      button.style.width = "";
      button.style.minWidth = "max-content";
      forceInterior(button, state);
    }
  }
  function applyNaturalWidths(buttons, widths, state, available) {
    const spare = Math.max(0, available - widths.reduce((sum, width) => sum + width, 0));
    const extra = spare / buttons.length;
    for (const [index, button] of buttons.entries()) {
      const width = (widths[index] ?? 0) + extra;
      button.style.flex = width ? `0 0 ${width}px` : "0 0 auto";
      button.style.width = width ? `${width}px` : "";
      button.style.minWidth = "0";
      forceInterior(button, state);
    }
  }
  function applyTruncation(buttons, state) {
    for (const button of buttons) {
      button.style.flex = "1 1 0%";
      button.style.width = "";
      button.style.minWidth = "0";
      forceInterior(button, state);
      for (const label of getLabels(button)) {
        if (label.querySelector("svg"))
          continue;
        label.style.flexShrink = "1";
        label.style.minWidth = "0";
        label.style.maxWidth = "100%";
        label.style.overflow = "hidden";
        label.style.textOverflow = "ellipsis";
        label.style.whiteSpace = "nowrap";
      }
    }
  }
  function evaluateLayout() {
    tier = resolveTier(node, options);
    spec = ACTION_BTN_TIERS[tier];
    const buttons = getButtons();
    if (!buttons.length)
      return;
    prepareElements(buttons);
    if (node.clientWidth <= 0)
      return;
    const container = buttons[0]?.parentElement ?? node;
    if (!authoredFlexWraps.has(container)) {
      authoredFlexWraps.set(container, container.style.flexWrap);
    }
    container.style.flexWrap = "nowrap";
    activeButtonContainer = container;
    restoreAuthoredGap(container);
    if (authoredJustifyContents.has(container)) {
      container.style.justifyContent = authoredJustifyContents.get(container) ?? "";
    }
    const computed = getComputedStyle(container);
    if (["space-between", "space-around", "space-evenly"].includes(computed.justifyContent)) {
      if (!authoredJustifyContents.has(container)) {
        authoredJustifyContents.set(container, container.style.justifyContent);
      }
      container.style.justifyContent = "flex-start";
    }
    const padLeft = parseFloat(computed.paddingLeft) || 0;
    const padRight = parseFloat(computed.paddingRight) || 0;
    const groupWidth = container.clientWidth - padLeft - padRight;
    const base = { font: spec.labelFont, pad: spec.sidePadding, band: spec.iconGap };
    const widthsAtBase = measureWidths(buttons, base);
    const cssGap = parseFloat(computed.columnGap);
    const gapPx = Number.isFinite(cssGap) ? cssGap : measureGap(buttons);
    const baselineGap = interButtonGapForPadding(tier, base.pad, gapPx);
    if (baselineGap < gapPx)
      applyInterButtonGap(container, baselineGap);
    const available = Math.max(0, groupWidth - baselineGap * (buttons.length - 1));
    const equalShare = available / buttons.length;
    const naturalTotal = widthsAtBase.reduce((sum, width) => sum + width, 0);
    if (naturalTotal <= available + EPS) {
      if (widthsAtBase.every((width) => width <= equalShare + EPS)) {
        applyEqualStretch(buttons, base);
        node.dataset.responsiveButtonLayoutState = "stretch";
      } else {
        applyNaturalWidths(buttons, widthsAtBase, base, available);
        node.dataset.responsiveButtonLayoutState = "natural";
      }
      return;
    }
    const state = { ...base };
    const fits = (s) => measureWidths(buttons, s).reduce((sum, width) => sum + width, 0) <= Math.max(0, groupWidth - interButtonGapForPadding(tier, s.pad, gapPx) * (buttons.length - 1)) + EPS;
    let fitted = null;
    let phase = "trunc";
    let pad = spec.sidePadding;
    let padOnly = true;
    while (!fitted) {
      state.pad = pad;
      if (fits(state)) {
        fitted = { ...state };
        phase = state.font < spec.labelFont ? "font" : padOnly ? "pad" : "coupled";
        break;
      }
      let nextPad;
      let nextBand;
      if (padOnly) {
        const twoStep = pad - 2;
        if (twoStep >= spec.minSidePad && twoStep >= PAD_GAP_RATIO * spec.iconGap) {
          nextPad = twoStep;
          nextBand = spec.iconGap;
        } else if (pad - 1 >= spec.minSidePad) {
          nextPad = pad - 1;
          nextBand = coupledIconGap(tier, nextPad);
          padOnly = false;
        } else {
          break;
        }
      } else {
        if (pad - 1 >= spec.minSidePad) {
          nextPad = pad - 1;
          nextBand = coupledIconGap(tier, nextPad);
        } else {
          break;
        }
      }
      const nextFont = nextTypographyStep(tier, state.font);
      if (nextFont !== null && nextPad < 0.75 * state.font) {
        state.font = nextFont;
        continue;
      }
      pad = nextPad;
      state.band = nextBand;
    }
    if (fitted) {
      const availableAtFit = Math.max(0, groupWidth - interButtonGapForPadding(tier, fitted.pad, gapPx) * (buttons.length - 1));
      applyNaturalWidths(buttons, measureWidths(buttons, fitted), fitted, availableAtFit);
      node.dataset.responsiveButtonLayoutState = phase;
    } else {
      const floor = {
        font: spec.minFont,
        pad: spec.minSidePad,
        band: coupledIconGap(tier, spec.minSidePad)
      };
      applyTruncation(buttons, floor);
      node.dataset.responsiveButtonLayoutState = "trunc";
    }
    const finalPad = fitted ? fitted.pad : spec.minSidePad;
    const finalGap = interButtonGapForPadding(tier, finalPad, gapPx);
    if (finalGap < gapPx)
      applyInterButtonGap(container, finalGap);
    else
      restoreAuthoredGap(container);
  }
  resizeObserver = new ResizeObserver(scheduleEvaluation);
  mutationObserver = new MutationObserver(scheduleEvaluation);
  resizeObserver.observe(node);
  const container = node.querySelector('button, a, [role="button"]')?.parentElement ?? node;
  if (container !== node)
    resizeObserver.observe(container);
  mutationObserver.observe(node, {
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      "class",
      "hidden",
      "data-action-tier",
      "data-responsive-button-layout-interior"
    ],
    subtree: true
  });
  evaluateLayout();
  scheduleSettleEvaluation();
  attachFontsListener();
  return {
    update: scheduleEvaluation,
    destroy() {
      fontsCleanup?.();
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      for (const button of activeButtons) {
        const height = authoredHeights.get(button);
        if (height) {
          if (height.value)
            button.style.setProperty("height", height.value, height.priority);
          else
            button.style.removeProperty("height");
        }
      }
      activeButtons.clear();
      if (activeButtonContainer && authoredFlexWraps.has(activeButtonContainer)) {
        activeButtonContainer.style.flexWrap = authoredFlexWraps.get(activeButtonContainer) ?? "";
      }
      if (activeButtonContainer) {
        restoreAuthoredGap(activeButtonContainer);
        if (authoredJustifyContents.has(activeButtonContainer)) {
          activeButtonContainer.style.justifyContent = authoredJustifyContents.get(activeButtonContainer) ?? "";
        }
      }
      if (frameId !== null)
        cancelAnimationFrame(frameId);
      if (settleFrameId !== null)
        cancelAnimationFrame(settleFrameId);
    }
  };
}
// tests/visual/.preview-responsive-button-layout-bundle-entry.ts
var __responsiveButtonLayoutBundleKeepAlive = [localeFontScale, BODY_FONT_FAMILY, createLabelMetrics, resolveLabelFontFamily, badgeAnchorText, fitNavPill, navBadgeEndPadPx, navBadgePlacementPx, navBadgeWidthPx, computeNavLayout, MORE_ITEM_PAD_BLOCK_PX, MORE_ITEM_PAD_X_PX, NAV_BADGE_FONT_PX, NAV_BADGE_GAP_PX, NAV_BADGE_HEIGHT_PX, NAV_BADGE_MIN_W_PX, NAV_BADGE_PAD_X_PX, NAV_BADGE_WIDEST_TEXT, NAV_FAB_SIZE_PX, NAV_FLOAT_INSET_PX, NAV_GAP_PX, NAV_ICON_GAP_PX, NAV_ICON_SIZE_PX, NAV_ISLAND_RADIUS_PX, NAV_ITEM_PAD_BLOCK_PX, NAV_ITEM_PAD_X_MAX_PX, NAV_ITEM_PAD_X_MIN_PX, NAV_ITEM_PADDING_PX, NAV_ITEM_RADIUS_PX, NAV_LABEL_DEFAULT_FONT_PX, NAV_LABEL_FONT_WEIGHT, NAV_LABEL_KEYS, NAV_LABEL_MIN_FONT_PX, NAV_PILL_ICON_LANE_PX, NAV_RESERVED_OUTER_PX, NAV_TOKEN_VARS, navBadgeTextFor, navKeyCarriesUnreadCount, navTokenStyle, ACTION_BTN_TIER_DEFAULT, ACTION_BTN_TIERS, ACTION_BTN_TYPOGRAPHY_STEPS, coupledIconGap, iconForFont, interButtonGapForPadding, nextTypographyStep, responsiveButtonLayout];
export {
  ACTION_BTN_TIERS,
  ACTION_BTN_TIER_DEFAULT,
  ACTION_BTN_TYPOGRAPHY_STEPS,
  BODY_FONT_FAMILY,
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
  NAV_ITEM_PADDING_PX,
  NAV_ITEM_PAD_BLOCK_PX,
  NAV_ITEM_PAD_X_MAX_PX,
  NAV_ITEM_PAD_X_MIN_PX,
  NAV_ITEM_RADIUS_PX,
  NAV_LABEL_DEFAULT_FONT_PX,
  NAV_LABEL_FONT_WEIGHT,
  NAV_LABEL_KEYS,
  NAV_LABEL_MIN_FONT_PX,
  NAV_PILL_ICON_LANE_PX,
  NAV_RESERVED_OUTER_PX,
  NAV_TOKEN_VARS,
  __responsiveButtonLayoutBundleKeepAlive,
  badgeAnchorText,
  computeNavLayout,
  coupledIconGap,
  createLabelMetrics,
  fitNavPill,
  iconForFont,
  interButtonGapForPadding,
  localeFontScale,
  navBadgeEndPadPx,
  navBadgePlacementPx,
  navBadgeTextFor,
  navBadgeWidthPx,
  navKeyCarriesUnreadCount,
  navTokenStyle,
  nextTypographyStep,
  resolveLabelFontFamily,
  responsiveButtonLayout
};

// Generated from src/locales/*.json - do not edit.
export const NAV_LABELS = {
  "ar": {
    "nav.mailbox": "البريد",
    "nav.addresses": "العناوين",
    "nav.autofill": "التعبئة التلقائية",
    "nav.organize": "تنظيم",
    "nav.automation": "الأتمتة",
    "nav.activity": "النشاط",
    "common.settings": "الإعدادات",
    "nav.about": "حول",
    "nav.more": "المزيد"
  },
  "de": {
    "nav.mailbox": "Postfach",
    "nav.addresses": "Adressen",
    "nav.autofill": "Autofill",
    "nav.organize": "Organisieren",
    "nav.automation": "Automatisierung",
    "nav.activity": "Aktivität",
    "common.settings": "Einstellungen",
    "nav.about": "Info",
    "nav.more": "Mehr"
  },
  "en": {
    "nav.mailbox": "Mailbox",
    "nav.addresses": "Addresses",
    "nav.autofill": "Autofill",
    "nav.organize": "Organize",
    "nav.automation": "Automation",
    "nav.activity": "Activity",
    "common.settings": "Settings",
    "nav.about": "About",
    "nav.more": "More"
  },
  "es": {
    "nav.mailbox": "Buzón",
    "nav.addresses": "Direcciones",
    "nav.autofill": "Autocompletar",
    "nav.organize": "Organizar",
    "nav.automation": "Automatización",
    "nav.activity": "Actividad",
    "common.settings": "Ajustes",
    "nav.about": "Acerca de",
    "nav.more": "Más"
  },
  "fr": {
    "nav.mailbox": "Boîte mail",
    "nav.addresses": "Adresses",
    "nav.autofill": "Auto-remplissage",
    "nav.organize": "Organiser",
    "nav.automation": "Automatisation",
    "nav.activity": "Activité",
    "common.settings": "Paramètres",
    "nav.about": "À propos",
    "nav.more": "Plus"
  },
  "ja": {
    "nav.mailbox": "メールボックス",
    "nav.addresses": "アドレス",
    "nav.autofill": "自動入力",
    "nav.organize": "整理",
    "nav.automation": "自動化",
    "nav.activity": "アクティビティ",
    "common.settings": "設定",
    "nav.about": "情報",
    "nav.more": "その他"
  },
  "th": {
    "nav.mailbox": "กล่องจดหมาย",
    "nav.addresses": "ที่อยู่",
    "nav.autofill": "เติมอัตโนมัติ",
    "nav.organize": "จัดระเบียบ",
    "nav.automation": "ระบบอัตโนมัติ",
    "nav.activity": "กิจกรรม",
    "common.settings": "การตั้งค่า",
    "nav.about": "เกี่ยวกับ",
    "nav.more": "เพิ่มเติม"
  },
  "zh": {
    "nav.mailbox": "邮箱",
    "nav.addresses": "地址",
    "nav.autofill": "自动填充",
    "nav.organize": "整理",
    "nav.automation": "自动化",
    "nav.activity": "活动",
    "common.settings": "设置",
    "nav.about": "关于",
    "nav.more": "更多"
  }
};

// Generated from src/locales/*.json - do not edit.
export const ABOUT_LABELS = {
  "ar": {
    "about.sourceCode": "الشيفرة المصدرية",
    "about.demo": "عرض تجريبي",
    "about.website": "الموقع الإلكتروني",
    "diagnostics.title": "التشخيص",
    "about.storeChrome": "متجر Chrome",
    "about.storeFirefox": "إضافات Firefox (قريبًا)",
    "about.reportIssue": "الإبلاغ عن مشكلة",
    "productTour.replay": "جولة المنتج",
    "nav.keyboardShortcuts": "اختصارات لوحة المفاتيح",
    "about.documentation": "التوثيق"
  },
  "de": {
    "about.sourceCode": "Quellcode",
    "about.demo": "Demo",
    "about.website": "Website",
    "diagnostics.title": "Diagnose",
    "about.storeChrome": "Chrome Web Store",
    "about.storeFirefox": "Firefox-Add-ons (demnächst)",
    "about.reportIssue": "Problem melden",
    "productTour.replay": "Produkttour starten",
    "nav.keyboardShortcuts": "Tastenkürzel",
    "about.documentation": "Dokumentation"
  },
  "en": {
    "about.sourceCode": "Source Code",
    "about.demo": "Demo",
    "about.website": "Website",
    "diagnostics.title": "Diagnostics",
    "about.storeChrome": "Chrome Web Store",
    "about.storeFirefox": "Firefox add-ons (coming soon)",
    "about.reportIssue": "Report an Issue",
    "productTour.replay": "Take product tour",
    "nav.keyboardShortcuts": "Keyboard shortcuts",
    "about.documentation": "Documentation"
  },
  "es": {
    "about.sourceCode": "Código fuente",
    "about.demo": "Demostración",
    "about.website": "Sitio web",
    "diagnostics.title": "Diagnósticos",
    "about.storeChrome": "Chrome Web Store",
    "about.storeFirefox": "Complementos de Firefox (próximamente)",
    "about.reportIssue": "Informar de un problema",
    "productTour.replay": "Hacer tour del producto",
    "nav.keyboardShortcuts": "Atajos de teclado",
    "about.documentation": "Documentación"
  },
  "fr": {
    "about.sourceCode": "Code source",
    "about.demo": "Démo",
    "about.website": "Site web",
    "diagnostics.title": "Diagnostic",
    "about.storeChrome": "Chrome Web Store",
    "about.storeFirefox": "Modules Firefox (bientôt)",
    "about.reportIssue": "Signaler un problème",
    "productTour.replay": "Lancer la visite",
    "nav.keyboardShortcuts": "Raccourcis clavier",
    "about.documentation": "Documentation"
  },
  "ja": {
    "about.sourceCode": "ソースコード",
    "about.demo": "デモ",
    "about.website": "ウェブサイト",
    "diagnostics.title": "診断",
    "about.storeChrome": "Chrome ウェブストア",
    "about.storeFirefox": "Firefox アドオン（近日）",
    "about.reportIssue": "問題を報告",
    "productTour.replay": "プロダクトツアー",
    "nav.keyboardShortcuts": "キーボードショートカット",
    "about.documentation": "ドキュメント"
  },
  "th": {
    "about.sourceCode": "ซอร์สโค้ด",
    "about.demo": "สาธิต",
    "about.website": "เว็บไซต์",
    "diagnostics.title": "การวินิจฉัย",
    "about.storeChrome": "Chrome Web Store",
    "about.storeFirefox": "ส่วนเสริม Firefox (เร็วๆ นี้)",
    "about.reportIssue": "รายงานปัญหา",
    "productTour.replay": "เริ่มต้นแนะนำการใช้งานแอป",
    "nav.keyboardShortcuts": "แป้นพิมพ์ลัด",
    "about.documentation": "เอกสาร"
  },
  "zh": {
    "about.sourceCode": "源代码",
    "about.demo": "演示",
    "about.website": "网站",
    "diagnostics.title": "诊断",
    "about.storeChrome": "Chrome 网上应用店",
    "about.storeFirefox": "Firefox 附加组件（即将推出）",
    "about.reportIssue": "报告问题",
    "productTour.replay": "产品导览",
    "nav.keyboardShortcuts": "键盘快捷键",
    "about.documentation": "文档"
  }
};
