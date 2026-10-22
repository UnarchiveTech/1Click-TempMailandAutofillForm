/**
 * Svelte Action: responsiveButtonLayout
 * Enforces AGENTS.md Rule 8 (Action Button Layout & Typography Rules).
 *
 * Tier-locked fitting:
 * - A row selects exactly one button-size tier (XS / S / M / L / XL) via a
 *   `data-action-tier` attribute on the row element or a `{ tier }` action
 *   option (attribute wins; default `S`). The tier is LOCKED for the row's
 *   lifetime - fitting only adjusts dimensions within the tier's floors and
 *   NEVER converts the row to another tier (e.g. M → S on a narrow viewport).
 * - Underfit → Equal Stretch (`flex-1`), with a per-button guard: if ANY
 *   button's natural width exceeds its equal share, the WHOLE row resolves to
 *   natural widths plus an equal share of spare width (group fit ≠ per-button
 *   fit). Every fitted state fills the row without a larger trailing inset.
 * - Overflow → responsive fitting, re-measuring after every change:
 *     1. Naturalize widths - the escape from an artificial equal-width
 *        behavior. Equal Stretch can never overflow (its shares sum to
 *        `available`), so natural widths are already in play by default and
 *        there is nothing to undo.
 *     2. Reduce side padding equally (2px steps), never below the tier's
 *        minimum side padding - and only while P ≥ 1.75 × G (P = side
 *        padding, G = icon→label gap, which stays at its authored value
 *        here). The last padding-only state sits at P ≈ 1.75 × G.
 *     3. 1.75× coupled reduction: the next padding reduction would push P
 *        below 1.75 × G, so every further 1px padding reduction carries the
 *        icon→label gap with it - G = round(P / 1.75), integer px - until the
 *        gap reaches its own minimum and locks (padding then continues alone
 *        down to its own minimum). Replaces any forced padL == gap == padR
 *        equality.
 *     4. Typography compression checkpoints (0.75× rule): side padding must
 *        also stay ≥ 0.75 × F (F = label font). BEFORE a padding reduction
 *        would push P below 0.75 × F, font + icon move down ONE defined
 *        typography step per tier (baseline → minimum, icons follow the
 *        icon↔font relation) and the whole layout is re-measured at the
 *        current spacing. Typography never shrinks pixel-by-pixel - only at
 *        these discrete checkpoints - and never below the tier's minimums.
 *     5. Inter-button gap tracks side padding in every fit state:
 *        B = min(authored gap, tier gap, max(4, 0.75 × P)). Smaller authored
 *        gaps stay smaller. There is no padding-budget delay; the 4px floor
 *        wins when the compact tier reaches its 4px padding floor.
 *        `available = groupWidth − B × (N − 1)` is recomputed at every step
 *        and the final B is applied to the row - restored to the authored
 *        proportionate baseline whenever the row widens.
 *     6. Floor reached and still overflowing → label truncation is finally
 *        permitted, and only here. Both axes are clamped, so a stacked
 *        (icon-over-label, `flex-direction: column`) drop target truncates its
 *        label instead of overflowing the tile and colliding with its
 *        neighbour.
 * - Authored CSS gaps are measured independently of distributed free space;
 *   space-between/around/evenly cannot enlarge the visual gap while fitting.
 * - Universal floor: XS and S converge on 12px font / 16px icon / 4px side
 *   padding / 3px icon→label gap (gap floors are the locked `Min gap` table
 *   values, which the 1.75× coupled reduction clamps at - the pure ratio
 *   would put the XS/S floor at round(4 / 1.75) ≈ 2px); every tier floors at
 *   its own table minimums.
 *
 * - Web-font readiness: a fit measured before a webfont arrives is sized for
 *   the fallback font, so the action re-evaluates whenever `document.fonts`
 *   reports a finished load (`ready` while a batch is loading, plus
 *   `loadingdone` for loads that start later). A late font swap therefore
 *   never leaves an action row fitted to fallback glyph widths.
 *
 * Action rows are single-line: the action locks `flex-wrap: nowrap` on the
 * buttons' parent before measuring, so every button is fitted against the same
 * available row width. Standard horizontal actions get the tier's exact
 * height; stacked actions retain their authored hit area.
 */

export type ActionBtnTier = 'XS' | 'S' | 'M' | 'L' | 'XL';

export interface ActionBtnTierSpec {
  /** Base label font size (px). */
  labelFont: number;
  /** Design height (px) enforced on horizontal buttons; stacked hit areas retain authored height. */
  height: number;
  /** Base left/right padding of each button (px). */
  sidePadding: number;
  /** Inter-button gap ceiling (px), further capped by current side padding. */
  interButtonGap: number;
  /** Base icon size (px). */
  icon: number;
  /** Base icon→label gap inside each button (px). */
  iconGap: number;
  /** Floor values. */
  minFont: number;
  minIcon: number;
  minSidePad: number;
  minGap: number;
}

export const ACTION_BTN_TIERS: Record<ActionBtnTier, ActionBtnTierSpec> = {
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
    minGap: 3,
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
    minGap: 3,
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
    minGap: 5,
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
    minGap: 8,
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
    minGap: 11,
  },
};

export const ACTION_BTN_TIER_DEFAULT: ActionBtnTier = 'S';

/** Deterministic per-tier relation: icon = 2·font − 8 (XS/S/M), icon = font + 8 (L/XL). */
export function iconForFont(tier: ActionBtnTier, fontPx: number): number {
  return tier === 'L' || tier === 'XL' ? fontPx + 8 : 2 * fontPx - 8;
}

/**
 * Defined typography compression steps (label font px) per tier, ordered from
 * the baseline down toward the tier's minimum. Typography compresses ONLY at
 * these discrete steps - never continuously pixel-by-pixel - and each step
 * moves toward the tier's minimum. Icons follow the tier's icon↔font
 * relation, so a step lands on the tier's defined minimum icon.
 */
export const ACTION_BTN_TYPOGRAPHY_STEPS: Record<ActionBtnTier, readonly number[]> = {
  XS: [14, 12],
  S: [14, 12],
  M: [16, 14],
  L: [24, 16],
  XL: [32, 24],
};

/** The next lower typography step for the tier, or `null` when already at the minimum. */
export function nextTypographyStep(tier: ActionBtnTier, fontPx: number): number | null {
  const steps = ACTION_BTN_TYPOGRAPHY_STEPS[tier];
  const index = steps.indexOf(fontPx);
  return index >= 0 && index < steps.length - 1 ? steps[index + 1] : null;
}

/**
 * Padding↔icon-gap ratio maintained during the coupled reduction (Overflow
 * step 3): while both compress together, the side padding stays 1.75× the
 * icon→label gap. (The old 1.5× ratio was raised to 1.75 so the padding
 * never becomes disproportionately close to the gap before typography steps.)
 */
export const PAD_GAP_RATIO = 1.75;

/**
 * Icon→label gap during the coupled reduction (Overflow step 3):
 * G = round(P / PAD_GAP_RATIO) in integer px, clamped at the tier's locked
 * Min gap. The minimum wins whenever the pure ratio would fall below it
 * (e.g. XS/S: round(4 / 1.75) = 2 < the locked 3px minimum → 3), so every
 * tier's floor band is its table Min gap.
 */
export function coupledIconGap(tier: ActionBtnTier, padPx: number): number {
  const t = ACTION_BTN_TIERS[tier];
  return Math.max(t.minGap, Math.round(padPx / PAD_GAP_RATIO));
}

export const INTER_BUTTON_GAP_PADDING_RATIO = 0.75;
export const MIN_INTER_BUTTON_GAP = 4;

/**
 * Gap between buttons in every fit state. Cap by the tier, authored CSS gap
 * and ¾ of current side padding; the 4px floor never widens a smaller authored
 * gap. Clamp padding to its locked tier's range, retaining fractional gaps.
 */
export function interButtonGapForPadding(
  tier: ActionBtnTier,
  padPx: number,
  renderedGap: number
): number {
  const t = ACTION_BTN_TIERS[tier];
  const padding = Math.min(t.sidePadding, Math.max(t.minSidePad, padPx));
  return Math.min(
    renderedGap,
    t.interButtonGap,
    Math.max(MIN_INTER_BUTTON_GAP, INTER_BUTTON_GAP_PADDING_RATIO * padding)
  );
}

export interface ResponsiveButtonLayoutOptions {
  tier?: ActionBtnTier;
}

export interface ResponsiveButtonLayoutHandle {
  update(): void;
  destroy(): void;
}

const EPS = 0.01;

interface FitState {
  font: number;
  pad: number;
  band: number;
}

function resolveTier(node: HTMLElement, options: ResponsiveButtonLayoutOptions): ActionBtnTier {
  const attr = node.dataset.actionTier?.toUpperCase();
  if (attr && attr in ACTION_BTN_TIERS) return attr as ActionBtnTier;
  return options.tier ?? ACTION_BTN_TIER_DEFAULT;
}

export function responsiveButtonLayout(
  node: HTMLElement,
  options: ResponsiveButtonLayoutOptions = {}
): ResponsiveButtonLayoutHandle {
  let tier: ActionBtnTier = ACTION_BTN_TIER_DEFAULT;
  let spec: ActionBtnTierSpec = ACTION_BTN_TIERS[tier];
  let resizeObserver: ResizeObserver | null = null;
  let mutationObserver: MutationObserver | null = null;
  let frameId: number | null = null;
  const columnButtons = new WeakSet<HTMLElement>();
  // Authored inline `gap` per container, snapshotted the first time the
  // responsive fitting compresses it so the compression can later be undone exactly
  // (rows normally author their gap via Tailwind classes → inline is '').
  const authoredGaps = new WeakMap<HTMLElement, string>();
  const authoredFlexWraps = new WeakMap<HTMLElement, string>();
  const authoredJustifyContents = new WeakMap<HTMLElement, string>();
  const authoredHeights = new WeakMap<HTMLElement, { value: string; priority: string }>();
  const activeButtons = new Set<HTMLElement>();
  let activeButtonContainer: HTMLElement | null = null;
  let fontsCleanup: (() => void) | null = null;

  /**
   * Re-evaluate one frame after a scheduled evaluation so the fit reflects
   * the SETTLED DOM, not a half-swapped one. Svelte swaps row content through
   * a sequence of DOM mutations (element attrs → icon → label text) that can
   * land across frames; the single coalesced rAF above can therefore measure
   * a button that still carries the OLD content (e.g. an "Archive" label
   * width on the new Unarchive button) and commit a fit sized for it. The
   * settle pass re-measures once the swap has fully landed, and is idempotent
   * when nothing changed (the old per-view fitActionButtonFonts also ran a
   * double pass for the same reason).
   */
  let settleFrameId: number | null = null;
  function scheduleSettleEvaluation(): void {
    if (settleFrameId !== null) return;
    settleFrameId = requestAnimationFrame(() => {
      settleFrameId = null;
      evaluateLayout();
    });
  }

  function scheduleEvaluation(): void {
    if (frameId !== null) return;
    frameId = requestAnimationFrame(() => {
      frameId = null;
      evaluateLayout();
      scheduleSettleEvaluation();
    });
  }

  /**
   * Re-evaluate once web fonts finish loading. Layout measured before a
   * webfont arrives is sized for the fallback font, whose glyphs can be
   * narrower or wider than the real face - the settle pass above only absorbs
   * Svelte's content swap, not a font that lands a frame or two later.
   * `document.fonts.ready` resolves when the batch that was loading at mount
   * is done; the `loadingdone` listener catches fonts that start loading
   * afterwards (locale swap, lazily imported @font-face, ...). Both funnel
   * into scheduleEvaluation, so a redundant signal is just a no-op measure.
   */
  function attachFontsListener(): void {
    if (typeof document === 'undefined' || !document.fonts) return;
    let active = true;
    const onFontsDone = (): void => {
      if (!active) return;
      scheduleEvaluation();
    };
    document.fonts.addEventListener('loadingdone', onFontsDone);
    if (document.fonts.status === 'loading') {
      void document.fonts.ready.then(onFontsDone).catch(() => {
        /* ignore: font readiness is best-effort; never rejects in practice */
      });
    }
    fontsCleanup = (): void => {
      active = false;
      document.fonts.removeEventListener('loadingdone', onFontsDone);
    };
  }

  function getButtons(): HTMLElement[] {
    // `display: none` controls must not consume equal-stretch space. Their
    // parent resize or a class/hidden mutation will trigger a fresh fit when
    // they become visible again.
    return Array.from(node.querySelectorAll<HTMLElement>('button, a, [role="button"]')).filter(
      (button) => button.getClientRects().length > 0
    );
  }

  function getLabels(button: HTMLElement): HTMLElement[] {
    return Array.from(button.querySelectorAll<HTMLElement>('.btn-label, span'));
  }

  function restoreAuthoredGap(container: HTMLElement): void {
    if (authoredGaps.has(container)) {
      container.style.gap = authoredGaps.get(container) ?? '';
    }
  }

  function applyInterButtonGap(container: HTMLElement, gapPx: number): void {
    if (!authoredGaps.has(container)) {
      authoredGaps.set(container, container.style.gap);
    }
    container.style.gap = `${gapPx}px`;
  }

  function prepareElements(buttons: HTMLElement[]): void {
    for (const button of buttons) {
      button.style.whiteSpace = 'nowrap';
      button.style.overflow = 'visible';

      for (const label of getLabels(button)) {
        label.style.whiteSpace = 'nowrap';
        label.style.overflow = 'visible';
        // A flex-shrinking label can be painted as if it disappeared when a
        // longer state label replaces a short one (e.g. Cancel → Reset).
        // Keep the label's real width available for measurement.
        label.style.flexShrink = '0';
        // Undo any truncation styles a previous 'trunc' evaluation left on
        // the label (ellipsis / shrink-to-zero) so a later non-truncated fit
        // measures and renders the full text again.
        label.style.textOverflow = '';
        label.style.minWidth = '';
        // Undo the cross-axis clamp a previous 'trunc' evaluation applied to a
        // stacked (icon-over-label) tile's label, so a later non-truncated fit
        // renders the full text again.
        label.style.maxWidth = '';
      }
    }
  }

  function forceInterior(button: HTMLElement, state: FitState): void {
    activeButtons.add(button);
    const isVertical =
      columnButtons.has(button) || getComputedStyle(button).flexDirection === 'column';
    if (isVertical) columnButtons.add(button);
    // Stacked icon-over-label drop targets keep authored sizing unless their
    // row explicitly opts in; some vertical controls have their own compact
    // hit-area contract.
    if (isVertical && node.dataset.responsiveButtonLayoutInterior !== 'fit') return;
    button.style.fontSize = `${state.font}px`;
    button.style.paddingLeft = `${state.pad}px`;
    button.style.paddingRight = `${state.pad}px`;
    button.style.gap = `${state.band}px`;
    if (!isVertical) {
      if (!authoredHeights.has(button)) {
        authoredHeights.set(button, {
          value: button.style.getPropertyValue('height'),
          priority: button.style.getPropertyPriority('height'),
        });
      }
      button.style.setProperty('height', `${spec.height}px`);
    }
    const iconSize = iconForFont(tier, state.font);
    for (const icon of button.querySelectorAll<SVGElement>('svg')) {
      icon.style.width = `${iconSize}px`;
      icon.style.height = `${iconSize}px`;
    }
  }

  /**
   * Measure while buttons are intrinsic-width and non-shrinkable. Measuring
   * after applying flex: 1 1 0% is the original bug: it reports the already
   * collapsed width, so the responsive fitting could keep Equal Stretch for a dirty label.
   */
  function measureWidths(buttons: HTMLElement[], state: FitState): number[] {
    for (const button of buttons) {
      button.style.flex = '0 0 auto';
      // Clear any pixel width a previous fit applied (applyNaturalWidths sets
      // `width`), otherwise the button measures at its OLD applied width
      // (max(width, max-content)) instead of its true natural width. Svelte
      // reuses sibling buttons across content swaps, so a stale `width`
      // silently poisons every later measurement and the responsive fitting commits a
      // fit sized for the previous content.
      button.style.width = '';
      button.style.minWidth = 'max-content';
      forceInterior(button, state);
    }
    return buttons.map((button) => button.getBoundingClientRect().width);
  }

  /**
   * Geometry fallback when the row does not declare a numeric CSS column gap.
   * Distributed alignment is removed before measuring so spare width cannot
   * masquerade as authored spacing. Facing edges work in both LTR and RTL.
   */
  function measureGap(buttons: HTMLElement[]): number {
    const rects = buttons.map((button) => button.getBoundingClientRect());
    let total = 0;
    let count = 0;
    for (let i = 0; i < rects.length - 1; i += 1) {
      // The VISUAL gap is the distance between the pair's FACING edges: LTR
      // faces are (right_i, left_i+1), RTL faces are (left_i, right_i+1).
      // Measuring the same two endpoints in the wrong direction spans AROUND
      // both buttons (−(gap + w_i + w_i+1)) - the naive left−right diff is
      // exactly that in RTL, and an abs() of it would poison the baseline with
      // a button-sized pseudo-gap. The max of the two diffs is the facing-edge
      // distance in either direction (the non-facing diff is deeply negative);
      // a negative result means the buttons overlap - an invalid baseline,
      // skipped just as the old >= 0 guard did.
      const gap = Math.max(rects[i + 1].left - rects[i].right, rects[i].left - rects[i + 1].right);
      if (gap >= 0) {
        total += gap;
        count += 1;
      }
    }
    return count ? total / count : 0;
  }

  function applyEqualStretch(buttons: HTMLElement[], state: FitState): void {
    for (const button of buttons) {
      button.style.flex = '1 1 0%';
      button.style.width = '';
      // Equal shares were proven safe by the per-button guard (natural width
      // ≤ share). Keep the intrinsic minimum in stretch mode too: min-w-0
      // would otherwise let a long dirty-state label collapse after the mode
      // is selected and be covered by the sibling button.
      button.style.minWidth = 'max-content';
      forceInterior(button, state);
    }
  }

  function applyNaturalWidths(
    buttons: HTMLElement[],
    widths: number[],
    state: FitState,
    available: number
  ): void {
    // Preserve each label's natural width while filling both ends of the row.
    // Spare space belongs inside the buttons, never after the last button or
    // between neighbours, where it would defeat the proportionate gap rule.
    const spare = Math.max(0, available - widths.reduce((sum, width) => sum + width, 0));
    const extra = spare / buttons.length;
    for (const [index, button] of buttons.entries()) {
      const width = (widths[index] ?? 0) + extra;
      button.style.flex = width ? `0 0 ${width}px` : '0 0 auto';
      button.style.width = width ? `${width}px` : '';
      button.style.minWidth = '0';
      forceInterior(button, state);
    }
  }

  function applyTruncation(buttons: HTMLElement[], state: FitState): void {
    for (const button of buttons) {
      button.style.flex = '1 1 0%';
      button.style.width = '';
      button.style.minWidth = '0';
      forceInterior(button, state);
      for (const label of getLabels(button)) {
        // Only text-bearing labels can truncate; skip icon wrappers.
        if (label.querySelector('svg')) continue;
        label.style.flexShrink = '1';
        label.style.minWidth = '0';
        // `minWidth: 0` + `overflow: hidden` bound the label on MAIN-axis flex
        // only. In a stacked (icon-over-label, `flex-direction: column`) tile
        // the label's width is the CROSS size, which neither property
        // constrains, so the label kept its natural width and painted outside
        // the tile - the row then reported an overflow even after step 6, and
        // its neighbours' labels overlapped (measured on the Account Selector
        // drawer's 4-tile strip in German at the 360px popup width).
        // `maxWidth: 100%` resolves against the tile's content box, clamping
        // the cross axis too, so truncation actually fits a stacked drop
        // target as §8.4 requires.
        label.style.maxWidth = '100%';
        label.style.overflow = 'hidden';
        label.style.textOverflow = 'ellipsis';
        label.style.whiteSpace = 'nowrap';
      }
    }
  }

  function evaluateLayout(): void {
    tier = resolveTier(node, options);
    spec = ACTION_BTN_TIERS[tier];

    const buttons = getButtons();
    if (!buttons.length) return;

    prepareElements(buttons);
    if (node.clientWidth <= 0) return;

    // The buttons' actual row is their parent. Wrapping is disabled so the
    // whole action group participates in one measurement. For nested rows (e.g.
    // the AddressesView selection strip, whose responsive fitting node is a flex-col
    // wrapper around an inner `w-full justify-between` button row) the parent
    // can be narrower than the node - measuring the node would over-allocate.
    const container = buttons[0]?.parentElement ?? node;
    if (!authoredFlexWraps.has(container)) {
      authoredFlexWraps.set(container, container.style.flexWrap);
    }
    container.style.flexWrap = 'nowrap';
    activeButtonContainer = container;
    // Undo any inter-button-gap compression a previous evaluation applied, so
    // the baseline measurement below reflects the authored spacing.
    restoreAuthoredGap(container);
    if (authoredJustifyContents.has(container)) {
      container.style.justifyContent = authoredJustifyContents.get(container) ?? '';
    }
    const computed = getComputedStyle(container);
    if (['space-between', 'space-around', 'space-evenly'].includes(computed.justifyContent)) {
      if (!authoredJustifyContents.has(container)) {
        authoredJustifyContents.set(container, container.style.justifyContent);
      }
      container.style.justifyContent = 'flex-start';
    }
    const padLeft = parseFloat(computed.paddingLeft) || 0;
    const padRight = parseFloat(computed.paddingRight) || 0;

    // Steps 1-2: group width = container width minus the container's own
    // horizontal padding; available button space removes the inter-button gap
    // capped by current button padding even before overflow is considered.
    const groupWidth = container.clientWidth - padLeft - padRight;
    const base: FitState = { font: spec.labelFont, pad: spec.sidePadding, band: spec.iconGap };
    const widthsAtBase = measureWidths(buttons, base);
    const cssGap = parseFloat(computed.columnGap);
    const gapPx = Number.isFinite(cssGap) ? cssGap : measureGap(buttons);
    const baselineGap = interButtonGapForPadding(tier, base.pad, gapPx);
    if (baselineGap < gapPx) applyInterButtonGap(container, baselineGap);
    const available = Math.max(0, groupWidth - baselineGap * (buttons.length - 1));
    const equalShare = available / buttons.length;
    const naturalTotal = widthsAtBase.reduce((sum, width) => sum + width, 0);

    // Step 5: determine the state.
    if (naturalTotal <= available + EPS) {
      // Underfit - Equal Stretch, with the per-button guard: if ANY button's
      // natural width exceeds its equal share, that button would clip, so the
      // whole row resolves to Natural Width instead (group fit ≠ per-button
      // fit). Keep the same proportionate gap used to calculate available space.
      if (widthsAtBase.every((width) => width <= equalShare + EPS)) {
        applyEqualStretch(buttons, base);
        node.dataset.responsiveButtonLayoutState = 'stretch';
      } else {
        applyNaturalWidths(buttons, widthsAtBase, base, available);
        node.dataset.responsiveButtonLayoutState = 'natural';
      }
      return;
    }

    // Overflow - responsive fitting, re-measuring after every change. Step 1 (naturalize
    // widths) is structural: only an artificial equal-width behavior can cause
    // an overflow, and Equal Stretch's shares sum to `available`, so natural
    // widths are already in play by default - nothing to undo.
    const state: FitState = { ...base };
    // Gap-aware available space: B = interButtonGapForPadding(s.pad, gapPx)
    // follows side padding at every step, preserving smaller authored gaps.
    const fits = (s: FitState): boolean =>
      measureWidths(buttons, s).reduce((sum, width) => sum + width, 0) <=
      Math.max(
        0,
        groupWidth - interButtonGapForPadding(tier, s.pad, gapPx) * (buttons.length - 1)
      ) +
        EPS;

    let fitted: FitState | null = null;
    let phase: 'pad' | 'coupled' | 'font' | 'trunc' = 'trunc';

    // Steps 2-4 (interleaved): walk the compression states in order, testing
    // each for fit. Side padding compresses per the existing rules - 2px
    // steps while P ≥ 1.75 × G, then 1px 1.75×-coupled steps that carry the
    // icon→label gap (G = round(P / 1.75)) down to the spacing floor. Two
    // independent constraints gate the walk:
    //   • P ≈ 1.75 × G  (padding keeps its 1.75× ratio to the icon→label gap)
    //   • P ≥ 0.75 × F (padding keeps at least 75% of the label font)
    // BEFORE any padding reduction that would push P below 0.75 × F, a
    // typography checkpoint fires: the font (and the icon, via the tier's
    // icon↔font relation) move down ONE defined typography step and the whole
    // layout is re-measured at the current spacing. Typography never shrinks
    // pixel-by-pixel - only at these discrete checkpoints - and never below
    // the tier's minimums.
    let pad = spec.sidePadding;
    let padOnly = true;
    while (!fitted) {
      state.pad = pad;
      if (fits(state)) {
        fitted = { ...state };
        phase = state.font < spec.labelFont ? 'font' : padOnly ? 'pad' : 'coupled';
        break;
      }

      let nextPad: number;
      let nextBand: number;
      if (padOnly) {
        const twoStep = pad - 2;
        if (twoStep >= spec.minSidePad && twoStep >= PAD_GAP_RATIO * spec.iconGap) {
          nextPad = twoStep;
          nextBand = spec.iconGap;
        } else if (pad - 1 >= spec.minSidePad) {
          // 1.75× coupling engages on the next 1px reduction.
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

      // Typography checkpoint: compress font + icon ONE defined step before
      // the reduction would push the padding below 0.75 × F.
      const nextFont = nextTypographyStep(tier, state.font);
      if (nextFont !== null && nextPad < 0.75 * state.font) {
        state.font = nextFont;
        continue;
      }

      pad = nextPad;
      state.band = nextBand;
    }

    if (fitted) {
      const availableAtFit = Math.max(
        0,
        groupWidth - interButtonGapForPadding(tier, fitted.pad, gapPx) * (buttons.length - 1)
      );
      applyNaturalWidths(buttons, measureWidths(buttons, fitted), fitted, availableAtFit);
      node.dataset.responsiveButtonLayoutState = phase;
    } else {
      // Step 6: floor reached and still overflowing - label truncation is
      // finally permitted, and only here. The tier remains locked: truncation
      // replaces tier conversion.
      const floor: FitState = {
        font: spec.minFont,
        pad: spec.minSidePad,
        band: coupledIconGap(tier, spec.minSidePad),
      };
      applyTruncation(buttons, floor);
      node.dataset.responsiveButtonLayoutState = 'trunc';
    }

    // Render the same gap that was used to measure the final padding state.
    const finalPad = fitted ? fitted.pad : spec.minSidePad;
    const finalGap = interButtonGapForPadding(tier, finalPad, gapPx);
    if (finalGap < gapPx) applyInterButtonGap(container, finalGap);
    else restoreAuthoredGap(container);
  }

  resizeObserver = new ResizeObserver(scheduleEvaluation);
  mutationObserver = new MutationObserver(scheduleEvaluation);
  resizeObserver.observe(node);
  // The buttons' parent row can resize independently of the responsive fitting node
  // (nested selection strips); re-fit when either changes.
  const container = node.querySelector('button, a, [role="button"]')?.parentElement ?? node;
  if (container !== node) resizeObserver.observe(container);
  mutationObserver.observe(node, {
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      'class',
      'hidden',
      'data-action-tier',
      'data-responsive-button-layout-interior',
    ],
    subtree: true,
  });
  evaluateLayout();
  // Initial mount may also measure mid-render (fonts not ready, content not
  // fully swapped in); a settle pass converges on the final layout.
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
          if (height.value) button.style.setProperty('height', height.value, height.priority);
          else button.style.removeProperty('height');
        }
      }
      activeButtons.clear();
      if (activeButtonContainer && authoredFlexWraps.has(activeButtonContainer)) {
        activeButtonContainer.style.flexWrap = authoredFlexWraps.get(activeButtonContainer) ?? '';
      }
      if (activeButtonContainer) {
        restoreAuthoredGap(activeButtonContainer);
        if (authoredJustifyContents.has(activeButtonContainer)) {
          activeButtonContainer.style.justifyContent =
            authoredJustifyContents.get(activeButtonContainer) ?? '';
        }
      }
      if (frameId !== null) cancelAnimationFrame(frameId);
      if (settleFrameId !== null) cancelAnimationFrame(settleFrameId);
    },
  };
}
