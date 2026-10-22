/**
 * Floating-nav panels for `tests/visual/preview-responsive-button-layout.html`.
 *
 * These panels are the pill's half of the harness: the responsive-button-layout panels
 * (A-L) verify the row algorithm itself, and these verify that the nav pill is
 * measured against the SAME tier model rather than against a second copy of the
 * CSS. Nothing here re-implements app logic - every number arrives from
 * `./preview-responsive-button-layout-module.js` (the bundled, generated copy of the real
 * modules):
 *
 *   - the label strings come from `src/locales/*.json`,
 *   - the membership (how many items stay primary) from `computeNavLayout`, fed
 *     by the same hidden-span probe `layoutStore.refreshNavLabelWidths` uses,
 *   - the font/padding/badge fit from `fitNavPill` + `navBadgePlacementPx`,
 *   - the geometry from `navTokenStyle()` / `NAV_TOKEN_VARS`,
 *   - the floors, typography steps and coupled gap from `ACTION_BTN_TIERS` and
 *     the responsive fitting's own helpers.
 *
 * PASS covers the contract that must hold in every locale: tier floors, the
 * badge reserve (the count's box starts on the last letter's ink end and keeps
 * the row's own side padding to the segment's rim), nothing painting outside its
 * own button, the active fill covering its icon + label, and no neighbour label
 * under the fill. The panels ALSO print what §8's responsive fitting would land on for the
 * same row (`buttonLayoutShadow`), because the pill currently spends typography
 * before spacing - a divergence that is reported, never silently asserted away.
 */

import {
  ACTION_BTN_TIERS,
  ACTION_BTN_TYPOGRAPHY_STEPS,
  BODY_FONT_FAMILY,
  badgeAnchorText,
  computeNavLayout,
  coupledIconGap,
  createLabelMetrics,
  fitNavPill,
  iconForFont,
  localeFontScale,
  NAV_BADGE_FONT_PX,
  NAV_BADGE_GAP_PX,
  NAV_BADGE_MIN_W_PX,
  NAV_BADGE_PAD_X_PX,
  NAV_BADGE_WIDEST_TEXT,
  NAV_FAB_SIZE_PX,
  NAV_FLOAT_INSET_PX,
  NAV_GAP_PX,
  NAV_ICON_GAP_PX,
  NAV_ICON_SIZE_PX,
  NAV_ITEM_PAD_BLOCK_PX,
  NAV_ITEM_PAD_X_MAX_PX,
  NAV_ITEM_PAD_X_MIN_PX,
  NAV_ITEM_PADDING_PX,
  NAV_LABEL_DEFAULT_FONT_PX,
  NAV_LABEL_FONT_WEIGHT,
  NAV_LABEL_KEYS,
  NAV_LABEL_MIN_FONT_PX,
  NAV_LABELS,
  NAV_RESERVED_OUTER_PX,
  navBadgePlacementPx,
  navBadgeWidthPx,
  navKeyCarriesUnreadCount,
  navTokenStyle,
} from './preview-responsive-button-layout-module.js';

/**
 * The nav icon: a stand-in glyph. It is drawn at `--nav-icon-size`, so the box
 * the fit reserves and the box the row renders are the same token.
 */
const ICON =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/></svg>';

/**
 * The tier the pill's numbers are compared against. Its floors (`minFont` 12,
 * `minSidePad` 4) are the ones the nav was pinned to long before this harness
 * existed - `NAV_LABEL_BASE_FONT_PX === ACTION_BTN_TIERS.S.labelFont` and
 * `NAV_ITEM_PAD_X_MIN_PX === ACTION_BTN_TIERS.XS.minSidePad` are unit-tested -
 * so the model is not a new invention here, it is the one the code already cites.
 */
const TIER = 'S';

/** RTL locales: the count's side and the ink comparisons mirror. */
const RTL = new Set(['ar']);

/**
 * Slack for a glyph's own side bearing: paints a fraction of a pixel outside its
 * advance box in every face (0.25-0.73px measured), and is never truncation.
 */
const INK_BEARING_TOLERANCE_PX = 1;

const CASES = [
  { id: 'M', lang: 'en', shell: 360, badge: '12', activeIndex: 1 },
  { id: 'N', lang: 'de', shell: 360, badge: '12', activeIndex: 1 },
  // The count on the ACTIVE segment - the case the count-on-the-pill's-edge
  // screenshot came from.
  { id: 'O', lang: 'th', shell: 360, badge: '12', activeIndex: 0 },
  { id: 'P', lang: 'ja', shell: 344, badge: '12', activeIndex: 1 },
  { id: 'Q', lang: 'ar', shell: 360, badge: '99+', activeIndex: 2 },
  // Floors: widest locale, narrowest shell, three-digit count.
  { id: 'R', lang: 'th', shell: 320, badge: '99+', activeIndex: 2 },
];

/**
 * The label's own letter-spacing, in px - the app's global strip rule adds
 * `--md-type-label-medium-tracking` (0.5px) to EVERY nav label, and `measureText`
 * ignores it. Measuring without it is how every last letter in the real navbar
 * ended up sliced: the fit reserved half a pixel less per character than the
 * browser paints. Read from a live label, else from the token.
 */
function labelTrackingPx() {
  const live = document.querySelector('.nav-label');
  if (live) return parseFloat(getComputedStyle(live).letterSpacing) || 0;
  const token = getComputedStyle(document.documentElement).getPropertyValue(
    '--md-type-label-medium-tracking'
  );
  const rem = parseFloat(token);
  return token.includes('rem') ? rem * 16 : rem || 0;
}

const metrics = createLabelMetrics(BODY_FONT_FAMILY, labelTrackingPx());
const r1 = (n) => Math.round(n * 10) / 10;
const labelFor = (lang, labelKey) => NAV_LABELS[lang]?.[labelKey] ?? labelKey;

/**
 * The app's own probe: every nav label rendered at the locale's reference font
 * size (the pill's pre-fit default × `localeFontScale`), plus the item padding -
 * the input `computeNavLayout` uses to decide membership.
 */
function measureNavItemWidths(lang) {
  const holder = document.createElement('div');
  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = `position:fixed;left:-9999px;top:0;visibility:hidden;pointer-events:none;white-space:nowrap;font-weight:${NAV_LABEL_FONT_WEIGHT};z-index:-1;`;
  holder.style.fontSize = `${NAV_LABEL_DEFAULT_FONT_PX * localeFontScale(lang)}px`;
  holder.style.fontFamily = BODY_FONT_FAMILY;
  const spans = [];
  for (const { key, labelKey } of NAV_LABEL_KEYS) {
    const span = document.createElement('span');
    span.textContent = labelFor(lang, labelKey);
    holder.appendChild(span);
    spans.push([key, span]);
  }
  // The unread count's own box, in the same holder - the reserve membership has
  // to pay for on the item that carries it, laid out by the browser with the
  // badge's real styles rather than re-derived from a formula.
  const badge = document.createElement('span');
  badge.textContent = NAV_BADGE_WIDEST_TEXT;
  badge.style.cssText = `display:inline-block;box-sizing:border-box;min-width:${NAV_BADGE_MIN_W_PX}px;padding:0 ${NAV_BADGE_PAD_X_PX}px;font-size:${NAV_BADGE_FONT_PX}px;font-weight:700;line-height:1;white-space:nowrap;`;
  holder.appendChild(badge);
  document.body.appendChild(holder);
  const badgeReservePx = Math.ceil(badge.getBoundingClientRect().width);
  const widths = {};
  const floorWidths = {};
  for (const [key, span] of spans) {
    const carriesCount = navKeyCarriesUnreadCount(key);
    widths[key] =
      Math.ceil(span.getBoundingClientRect().width) +
      NAV_ITEM_PADDING_PX +
      (carriesCount ? badgeReservePx : 0);
    // The same item at the pill's FLOOR font and padding: membership may only
    // drop below its preferred count when even this does not fit the shell.
    holder.style.fontSize = `${NAV_LABEL_MIN_FONT_PX * localeFontScale(lang)}px`;
    floorWidths[key] =
      Math.ceil(span.getBoundingClientRect().width) +
      NAV_ITEM_PAD_X_MIN_PX * 2 +
      (carriesCount ? badgeReservePx : 0);
    holder.style.fontSize = `${NAV_LABEL_DEFAULT_FONT_PX * localeFontScale(lang)}px`;
  }
  holder.remove();
  return { widths, floorWidths };
}

/**
 * What §8's responsive fitting would land on for this exact row, evaluated from the tier
 * table (never from a hardcoded expected pair): spend side padding 2px at a
 * time, step typography ONE defined step when the 0.75×F gate would be crossed,
 * then continue padding to its floor once typography is at its minimum.
 */
function buttonLayoutShadow({ labelSum, itemCount, availPx, badgeW }) {
  const tier = ACTION_BTN_TIERS[TIER];
  const steps = ACTION_BTN_TYPOGRAPHY_STEPS[TIER];
  const laneFor = (fontPx, padPx) => iconForFont(TIER, fontPx) + coupledIconGap(TIER, padPx);
  const totalFor = (fontPx, padPx) =>
    labelSum(fontPx) + itemCount * 2 * padPx + badgeW + laneFor(fontPx, padPx);
  let fontPx = steps[0];
  let padPx = tier.sidePadding;
  const path = [`F${fontPx}/P${padPx}`];
  const step = (nextFont, nextPad) => {
    fontPx = nextFont;
    padPx = nextPad;
    const state = `F${fontPx}/P${padPx}`;
    if (path[path.length - 1] !== state) path.push(state);
  };
  for (;;) {
    if (totalFor(fontPx, padPx) <= availPx) return { fontPx, padPx, path, fits: true };
    const nextPad = padPx - 2;
    if (nextPad >= tier.minSidePad && nextPad >= 0.75 * fontPx) {
      step(fontPx, nextPad);
      continue;
    }
    const index = steps.indexOf(fontPx);
    if (index >= 0 && index < steps.length - 1) {
      // The 0.75×F gate blocked the next padding step: compress typography by
      // ONE defined step and re-measure before spending more spacing.
      step(steps[index + 1], padPx);
      continue;
    }
    if (padPx > tier.minSidePad) {
      // Typography is at its floor: padding continues to its own floor.
      step(fontPx, Math.max(tier.minSidePad, nextPad));
      continue;
    }
    return { fontPx, padPx, path, fits: false };
  }
}

/** The painted ink of a label: its Range, intersected with every clipping box. */
function paintedInk(label) {
  const range = document.createRange();
  range.selectNodeContents(label);
  let box = range.getBoundingClientRect();
  const cs = getComputedStyle(label);
  const own = label.getBoundingClientRect();
  box = {
    left: cs.overflowX === 'visible' ? box.left : Math.max(box.left, own.left),
    right: cs.overflowX === 'visible' ? box.right : Math.min(box.right, own.right),
    top: cs.overflowY === 'visible' ? box.top : Math.max(box.top, own.top),
    bottom: cs.overflowY === 'visible' ? box.bottom : Math.min(box.bottom, own.bottom),
  };
  // Nothing above the label may clip the badge either - the item must not.
  const item = label.closest('.nav-item');
  const itemCs = item ? getComputedStyle(item) : null;
  const itemBox = item?.getBoundingClientRect();
  if (
    item &&
    itemCs &&
    itemBox &&
    (itemCs.overflowX !== 'visible' || itemCs.overflowY !== 'visible')
  ) {
    box = {
      left: itemCs.overflowX === 'visible' ? box.left : Math.max(box.left, itemBox.left),
      right: itemCs.overflowX === 'visible' ? box.right : Math.min(box.right, itemBox.right),
      top: itemCs.overflowY === 'visible' ? box.top : Math.max(box.top, itemBox.top),
      bottom: itemCs.overflowY === 'visible' ? box.bottom : Math.min(box.bottom, itemBox.bottom),
    };
  }
  return box;
}

/**
 * How much of a label the browser actually HIDES (px): the layout ink the
 * label's own clip box cuts off.
 *
 * This is the only honest truncation probe. `scrollWidth - clientWidth` looks
 * like one and is not: both are integer-rounded DOM properties, so a label whose
 * advance width is 43.74 reports 44 vs 43 - "1px truncated" - while its ink sits
 * 0.39px past a box that has 10px of button padding around it and nothing is
 * hidden at all. That made the verdict depend on whether the label's width
 * happened to have a fractional part, which is DPR- and font-dependent, so the
 * same fit passed in headless Chromium and failed in the app's webview. The ink
 * is the evidence: if it lies inside the clip box, nothing was cut, whatever the
 * rounded integers say.
 *
 * The tolerance absorbs the glyph's own side bearing, which legitimately paints
 * a fraction of a pixel outside the advance box (measured at 0.25-0.73px in the
 * shipped faces) and is never truncation.
 */
function hiddenInkPx(label) {
  const range = document.createRange();
  range.selectNodeContents(label);
  const ink = range.getBoundingClientRect();
  const own = label.getBoundingClientRect();
  const hidden = Math.max(0, ink.right - own.right, own.left - ink.left);
  return hidden > INK_BEARING_TOLERANCE_PX ? r1(hidden) : 0;
}

function renderPanel(panel, entry, ctx) {
  const { labels, fit, placement, badgeText, activeIndex, badgeIndex, shell } = ctx;
  const items = labels
    .map((label, index) => {
      const active = index === activeIndex;
      const withBadge = index === badgeIndex;
      return `<button type="button" class="nav-item${active ? ' active' : ''}${withBadge ? ' has-badge' : ''}">
        <span class="nav-icon" aria-hidden="true">${ICON}</span>
        <span class="nav-label">${label}</span>
        ${withBadge ? `<span class="nav-badge" aria-hidden="true">${badgeText}</span>` : ''}
      </button>`;
    })
    .join('');
  const stage = document.createElement('div');
  stage.className = 'nav-stage';
  stage.setAttribute('dir', RTL.has(entry.lang) ? 'rtl' : 'ltr');
  // The label face is the app's own stack (never the page's), so the canvas the
  // fitter measures through and the pixels on screen are the same face.
  stage.style.fontFamily = BODY_FONT_FAMILY;
  stage.style.width = `${shell}px`;
  // The island root carries the token block (the component's own call) and the
  // float/FAB vars the container reads, from the same constants.
  stage.innerHTML = `<div class="footer-float" style="${navTokenStyle()}; --footer-float-inset: ${NAV_FLOAT_INSET_PX}px; --fab-size: ${NAV_FAB_SIZE_PX}px;">
      <div class="bottom-nav-container" style="gap: ${NAV_GAP_PX}px">
        <nav class="floating-nav" id="row${entry.id}" style="--nav-font-size: ${fit.fontPx}px; --nav-item-pad-x: ${fit.padX}px; --nav-item-pad-x-end: ${fit.padXEnd}px; --nav-item-pad-block-start: ${placement.padBlockStartPx}px; --nav-item-pad-block-end: ${NAV_ITEM_PAD_BLOCK_PX}px; --nav-badge-bottom: ${placement.bottomInsetPx}px; --nav-badge-inset: ${fit.padX}px;">
          <div class="pill-indicator" aria-hidden="true"></div>${items}
        </nav>
        <button type="button" class="fab-placeholder" aria-hidden="true" tabindex="-1"></button>
      </div>
    </div>`;
  panel.querySelector('.stage-slot').replaceWith(stage);
}

/** Build one nav case: fit it from the app's own inputs, render, and measure. */
function buildCase(entry) {
  const lang = entry.lang;
  const { widths, floorWidths } = measureNavItemWidths(lang);
  const layout = computeNavLayout(entry.shell, [], widths, 'auto', floorWidths);
  const labels = layout.primaryNav.map((item) => labelFor(lang, item.labelKey));
  const availPx = Math.max(140, entry.shell - NAV_RESERVED_OUTER_PX);
  const badgeIndex = layout.primaryNav.findIndex((item) => item.view === 'mailbox');
  const badgeText = entry.badge;
  const badgeLabel = labelFor(lang, layout.primaryNav[badgeIndex]?.labelKey ?? 'nav.mailbox');
  const activeIndex = Math.min(entry.activeIndex, labels.length - 1);
  const fit = fitNavPill({
    labels,
    availPx,
    lang,
    badgeText,
    hasActiveIcon: activeIndex >= 0,
    measure: metrics.width,
  });
  const placement = navBadgePlacementPx({
    padBlockStartPx: NAV_ITEM_PAD_BLOCK_PX,
    padBlockEndPx: NAV_ITEM_PAD_BLOCK_PX,
    contentHeightPx: NAV_ICON_SIZE_PX,
    labelFontPx: fit.fontPx,
    ...metrics.ink(badgeLabel, fit.fontPx, NAV_LABEL_FONT_WEIGHT, badgeAnchorText(badgeLabel)),
  });
  const badgeW = navBadgeWidthPx(badgeText, metrics.width);
  return {
    ...entry,
    labels,
    layout,
    fit,
    placement,
    badgeLabel,
    badgeIndex,
    badgeW,
    availPx,
    badgeText,
    activeIndex,
  };
}

/** Measure the rendered pill and decide the panel's verdict + divergence note. */
function measureCase(caseId, ctx, panel) {
  const nav = panel.querySelector('.floating-nav');
  const items = [...nav.querySelectorAll('.nav-item')];
  const active = items[ctx.activeIndex];
  const badge = nav.querySelector('.nav-badge');
  const navRect = nav.getBoundingClientRect();
  const tier = ACTION_BTN_TIERS[TIER];
  const rtl = RTL.has(ctx.lang);

  // The app's indicator IS the active segment's box: size it from the measured
  // box (exactly what `applyPillBox` does) and check what it actually covers.
  const activeRect = active.getBoundingClientRect();
  const indicator = nav.querySelector('.pill-indicator');
  indicator.style.width = `${activeRect.width}px`;
  indicator.style.transform = `translateX(${activeRect.left - navRect.left}px)`;
  const indicatorRect = indicator.getBoundingClientRect();

  const painted = items.map((item) => {
    const label = item.querySelector('.nav-label');
    return { item, label, ink: paintedInk(label), box: item.getBoundingClientRect() };
  });
  const activePaint = painted[ctx.activeIndex];
  const iconRect = active.querySelector('.nav-icon').getBoundingClientRect();

  const spills = painted
    .filter((p) => p.ink.left < p.box.left - 0.5 || p.ink.right > p.box.right + 0.5)
    .map((p) => p.label.textContent);
  // How much of a label the browser is actually hiding. See `hiddenInkPx`:
  // `scrollWidth - clientWidth` is integer rounding, not truncation.
  const truncated = painted
    .map((p) => ({ text: p.label.textContent, cut: hiddenInkPx(p.label) }))
    .filter((t) => t.cut > 0);
  const neighboursUnderPill = painted
    .filter((_, index) => index !== ctx.activeIndex)
    .filter(
      (p) =>
        Math.min(p.ink.right, indicatorRect.right) - Math.max(p.ink.left, indicatorRect.left) > 0.5
    )
    .map((p) => p.label.textContent);
  const coversActive =
    iconRect.left >= indicatorRect.left - 0.5 &&
    iconRect.right <= indicatorRect.right + 0.5 &&
    activePaint.ink.left >= indicatorRect.left - 0.5 &&
    activePaint.ink.right <= indicatorRect.right + 0.5;
  const insideIsland =
    indicatorRect.left >= navRect.left - 0.5 && indicatorRect.right <= navRect.right + 0.5;
  // Every segment inside the island's own background, and the island inside its
  // allotted width: the fit reserves what the row needs, so an over-budget row
  // must shrink its labels (row 8.3's truncation) - never paint a button outside
  // the pill background the row is sized to.
  const itemsOutsideIsland = items
    .filter((item) => {
      const box = item.getBoundingClientRect();
      return box.left < navRect.left - 0.5 || box.right > navRect.right + 0.5;
    })
    .map((item) => item.querySelector('.nav-label')?.textContent ?? '?');
  const islandBox = nav.parentElement.getBoundingClientRect();
  const islandInContent = navRect.width <= islandBox.width - 2 * NAV_FLOAT_INSET_PX + 0.5;

  let badgeReport = null;
  if (badge) {
    const badgeRect = badge.getBoundingClientRect();
    const owner = badge.closest('.nav-item');
    const ownerBox = owner.getBoundingClientRect();
    const ownerInk = painted[items.indexOf(owner)].ink;
    const labelRect = owner.querySelector('.nav-label').getBoundingClientRect();
    const labelCs = getComputedStyle(owner.querySelector('.nav-label'));
    const fontPx = parseFloat(labelCs.fontSize);
    const ink = metrics.ink(
      owner.querySelector('.nav-label').textContent,
      fontPx,
      Number(labelCs.fontWeight) || NAV_LABEL_FONT_WEIGHT,
      badgeAnchorText(owner.querySelector('.nav-label').textContent)
    );
    const inkTop =
      labelRect.top +
      (fontPx - (ink.fontAscentPx + ink.fontDescentPx)) / 2 +
      ink.fontAscentPx -
      ink.inkAscentPx;
    badgeReport = {
      w: r1(badgeRect.width),
      // 0 = the count's box begins where the last letter's ink ends.
      gapToInkEnd: r1(rtl ? ownerInk.left - badgeRect.right : badgeRect.left - ownerInk.right),
      // 0 = the count's box sits exactly on that letter's ink top.
      bottomVsInkTop: r1(badgeRect.bottom - inkTop),
      // The space between the count and the segment's rim - the row's own side
      // padding, floored at the tier's minimum side padding.
      rimClearance: r1(rtl ? badgeRect.left - ownerBox.left : ownerBox.right - badgeRect.right),
      // The item must not clip the count (its rounded clip sliced the corner).
      ownerOverflow: getComputedStyle(owner).overflowX,
      padBlockStart: r1(parseFloat(getComputedStyle(owner).paddingBlockStart)),
    };
  }

  const labelSum = (sizePx) =>
    ctx.labels.reduce(
      (total, label) => total + metrics.width(label, sizePx, NAV_LABEL_FONT_WEIGHT),
      0
    );
  const shadow = buttonLayoutShadow({
    labelSum,
    itemCount: ctx.labels.length,
    availPx: ctx.availPx,
    badgeW: ctx.badgeW,
  });

  const problems = [];
  // 1. The tier's floors, from the tier table itself.
  if (ctx.fit.padX < tier.minSidePad)
    problems.push(`padX ${ctx.fit.padX}px < tier floor ${tier.minSidePad}px`);
  if (ctx.fit.fontPx < NAV_LABEL_MIN_FONT_PX)
    problems.push(`font ${ctx.fit.fontPx}px < pill floor ${NAV_LABEL_MIN_FONT_PX}px`);
  // 2. The badge reserve is a natural-width term, not a guess.
  if (r1(ctx.fit.padXEnd) !== r1(ctx.fit.padX + NAV_BADGE_GAP_PX + ctx.fit.badgeW)) {
    problems.push(`badge reserve ${r1(ctx.fit.padXEnd)}px ≠ padX + badgeW`);
  }
  // 3. Nothing paints outside its own button; truncation only when the fit says so.
  if (spills.length) problems.push(`labels paint outside their button: ${spills.join(', ')}`);
  if (truncated.length && !ctx.fit.overBudgetPx)
    problems.push(
      `truncated without an over-budget fit: ${truncated.map((t) => t.text).join(', ')}`
    );
  // 4. The active fill covers its own icon + label and no neighbour's ink.
  if (!coversActive) problems.push('active fill misses its icon or label');
  if (!insideIsland) problems.push('active fill leaves the island');
  if (itemsOutsideIsland.length) {
    problems.push(`segments paint outside the island: ${itemsOutsideIsland.join(', ')}`);
  }
  if (!islandInContent) problems.push('island exceeds its allotted width');
  if (neighboursUnderPill.length)
    problems.push(`active fill covers a neighbour label: ${neighboursUnderPill.join(', ')}`);
  // 5. The count.
  if (badgeReport) {
    // The count's box begins AT the ink end. The fitter reserves from the canvas
    // advance while the box is laid out by the renderer, so the two disagree by a
    // fraction (measured worst case here: 1.4px for a three-glyph `99+`) - the
    // box may therefore start up to 2px AFTER the ink, never before it (that is
    // the count covering the letter it caps).
    if (badgeReport.gapToInkEnd < -0.5 || badgeReport.gapToInkEnd > 2) {
      problems.push(`count is ${badgeReport.gapToInkEnd}px off the last letter's ink end`);
    }
    if (Math.abs(badgeReport.bottomVsInkTop) > 1)
      problems.push(`count is ${badgeReport.bottomVsInkTop}px off the ink top`);
    if (badgeReport.rimClearance < tier.minSidePad - 0.5) {
      problems.push(
        `count keeps only ${badgeReport.rimClearance}px to the segment rim (< the ${tier.minSidePad}px tier floor)`
      );
    }
    if (badgeReport.ownerOverflow === 'clip' || badgeReport.ownerOverflow === 'hidden') {
      problems.push('badge item clips the count');
    }
  }

  // The divergence note the discussion needs, measured - never a FAIL: these are
  // the numbers §8 would change, not invariants the pill claims today.
  const divergence = [
    `icon ${NAV_ICON_SIZE_PX}px vs model ${iconForFont(TIER, shadow.fontPx)}px (at the model's own font)`,
    `icon→label gap ${NAV_ICON_GAP_PX}px vs tier ${tier.iconGap}px / coupled ${coupledIconGap(TIER, shadow.padPx)}px`,
    `pad baseline ${NAV_ITEM_PAD_X_MAX_PX}px vs tier ${tier.sidePadding}px`,
    `font ${ctx.fit.fontPx}px (continuous scan) vs steps [${ACTION_BTN_TYPOGRAPHY_STEPS[TIER].join(', ')}]`,
  ];

  const verdict = problems.length === 0 ? 'PASS' : 'FAIL';
  const verdictEl = document.getElementById(`v-${caseId}`);
  verdictEl.textContent = verdict;
  verdictEl.className = `verdict ${verdict === 'PASS' ? 'ok' : 'bad'}`;
  if (problems.length) verdictEl.title = problems.join(' · ');

  const report = [
    `membership ${ctx.labels.length} items (computeNavLayout @${ctx.shell}px): ${ctx.labels.map((l, i) => (i === ctx.activeIndex ? `[${l}]` : l)).join(' · ')}`,
    `fit        font=${ctx.fit.fontPx}px  padX=${ctx.fit.padX}px  endPad=${ctx.fit.padXEnd}px  badgeW=${r1(ctx.badgeW)}px${ctx.fit.overBudgetPx ? `  OVER BUDGET ${ctx.fit.overBudgetPx}px (floors spent → labels clip inside their own box)` : ''}`,
    `tier model ${TIER}: floors font≥${tier.minFont} / pad≥${tier.minSidePad} / gap≥${tier.minGap}; this row: ${divergence.join(' · ')}`,
    `responsive fitting    shadow path ${shadow.path.join(' → ')} → ${shadow.fits ? `F${shadow.fontPx}/P${shadow.padPx}` : 'over budget at the floors'} for the same labels${shadow.fits ? '' : " (the responsive fitting's own answer is fewer items, or truncation)"}`,
    `pill       covers icon+label: ${coversActive}; inside the island: ${insideIsland}; segments inside the island: ${itemsOutsideIsland.length ? itemsOutsideIsland.join(', ') : 'all'}; neighbour ink under the fill: ${neighboursUnderPill.length || 'none'}`,
    `paint      ${spills.length ? `OUTSIDE: ${spills.join(', ')}` : 'every label paints inside its own button'}${truncated.length ? `; clipped: ${truncated.map((t) => `${t.text} −${t.cut}px`).join(', ')}` : '; no clipping'}`,
    badgeReport
      ? `count      ${badgeReport.w}px box → ${badgeReport.gapToInkEnd}px from the last letter's ink end (0 = box starts where the ink ends), bottom ${badgeReport.bottomVsInkTop}px from the ink top (0 = superscript on that letter), ${badgeReport.rimClearance}px to the segment rim (row padding; floor ${tier.minSidePad}px); item overflow ${badgeReport.ownerOverflow}`
      : 'count      none in this row',
  ];
  panel.querySelector('.report').textContent = report.join('\n');

  return {
    verdict,
    problems,
    report,
    fit: ctx.fit,
    labels: ctx.labels,
    membership: ctx.layout.stage,
    badge: badgeReport,
    divergence,
    buttonLayoutShadow: shadow,
    truncated,
    spills,
    coversActive,
    insideIsland,
  };
}

/**
 * Mount every nav panel into `#navGrid`, measure it, and publish the verdicts as
 * `window.__navPanels` (the check scripts wait for that).
 *
 * Async so the measuring happens after the faces are loaded and layout has
 * settled. The fit is a CANVAS measurement of the label font, so a panel built
 * while a face is still loading fits against a fallback and freezes that verdict
 * for the life of the page - one more way the same numbers could read differently
 * here and in the CLI. The app's own fitter re-measures by frame for the same
 * reason (the active item's icon transition makes a single measurement stale).
 */
export async function mountNavPanels() {
  await document.fonts.ready;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const grid = document.getElementById('navGrid');
  const all = {};
  for (const entry of CASES) {
    const ctx = buildCase(entry);
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
      <h2>${entry.id} - floating nav · ${entry.lang} · ${entry.shell}px · badge ${entry.badge} <span class="verdict" id="v-${entry.id}">…</span></h2>
      <div class="stage-slot"></div>
      <div class="meta report"></div>`;
    grid.appendChild(panel);
    renderPanel(panel, entry, ctx);
    all[entry.id] = measureCase(entry.id, ctx, panel);
  }
  window.__navPanels = all;
  return all;
}
