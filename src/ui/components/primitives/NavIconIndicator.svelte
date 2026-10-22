<script lang="ts">
import { fitLabelFontSize, resolveLabelFontFamily } from '@/utils/ui/fit-label-font.js';
import { NAV_DOT_SIZE_PX, NAV_LABEL_BASE_FONT_PX } from '@/utils/ui/nav-layout.js';

/** The parent is the actual icon box; its font follows the destination label. */
let { countText = null, iconSizePx }: { countText?: string | null; iconSizePx: number } = $props();
let badgeElement = $state<HTMLSpanElement>();
let countFontPx = $state(1);

$effect(() => {
  const element = badgeElement;
  const text = countText;
  const limit = iconSizePx / 2;
  if (!element || !text || !element.parentElement) return;
  let active = true;
  const fit = () => {
    if (!active || !element.parentElement) return;
    const labelFont = parseFloat(getComputedStyle(element.parentElement).fontSize);
    countFontPx = fitLabelFontSize([{ text, availableWidth: limit * 0.84 + 2 }], {
      // The shared fitter reserves 2px; supply that separately from usable ink width.
      basePx: Math.min(labelFont * 0.8, limit * 0.8),
      minPx: 0.25,
      weight: 700,
      fontFamily: resolveLabelFontFamily(element),
      letterSpacingPx: 0,
    });
  };
  fit();
  void document.fonts.ready.then(fit);
  return () => {
    active = false;
  };
});
</script>

<span
  class={countText ? 'nav-badge' : 'nav-icon-dot'}
  bind:this={badgeElement}
  style:--nav-dot-size={`${NAV_DOT_SIZE_PX / NAV_LABEL_BASE_FONT_PX}em`}
  style:--nav-indicator-limit={`${iconSizePx / 2}px`}
  style:font-size={countText ? `${countFontPx}px` : undefined}
  aria-hidden="true"
>{countText ?? ''}</span>

<style>
  .nav-badge,
  .nav-icon-dot {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translateY(-100%);
    background: var(--md-error);
    color: var(--md-on-error);
    pointer-events: none;
    z-index: 3;
  }

  .nav-badge {
    /* Always smaller than the label, including when the navbar font is fitted. */
    font-size: 0.8em;
    font-weight: 700;
    line-height: 1;
    letter-spacing: 0;
    /* The full badge stays in the icon's upper-right quarter. */
    width: var(--nav-indicator-limit);
    height: var(--nav-indicator-limit);
    padding: 0;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    white-space: nowrap;
  }

  .nav-icon-dot {
    width: var(--nav-dot-size);
    height: var(--nav-dot-size);
    border-radius: 50%;
  }
</style>
