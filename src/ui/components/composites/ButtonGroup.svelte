<script lang="ts">
import { type Snippet, untrack } from 'svelte';
import type { HTMLAttributes } from 'svelte/elements';
import {
  ACTION_BTN_TIERS,
  type ActionBtnTier,
  responsiveButtonLayout,
} from '@/utils/ui/responsive-button-layout.js';

interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children: Snippet;
  /** Locked for the mounted group's lifetime; width fitting never changes tiers. */
  tier?: ActionBtnTier;
  /** Icon-over-label drop targets share a taller hit area. */
  stacked?: boolean;
}

let { children, tier, stacked, class: extraClass, style, ...attributes }: Props = $props();
const lockedTier = untrack(() => tier ?? 'S');
const lockedStacked = untrack(() => stacked === true);
const spec = ACTION_BTN_TIERS[lockedTier];
const sizing = `--group-font:${spec.labelFont}px;--group-height:${lockedStacked ? 56 : spec.height}px;--group-pad:${spec.sidePadding}px;--group-icon:${spec.icon}px;--group-inner-gap:${spec.iconGap}px;--group-gap:${spec.interButtonGap}px;`;
</script>

<div
  {...attributes}
  class="button-group {extraClass ?? ''}"
  style="{sizing}{style ?? ''}"
  data-action-tier={lockedTier}
  data-stacked={lockedStacked || undefined}
  data-responsive-button-layout-interior="fit"
  use:responsiveButtonLayout
>
  {@render children()}
</div>

<style>
.button-group {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: flex-start;
  width: 100%;
  gap: var(--group-gap);
}
.button-group > :global(.md-action) {
  flex: 1 1 0%;
  min-width: 0;
  height: var(--group-height);
  padding: 0 var(--group-pad);
  font-size: var(--group-font);
  gap: var(--group-inner-gap);
  white-space: nowrap;
  overflow: visible;
}
.button-group > :global(.md-action svg) {
  width: var(--group-icon);
  height: var(--group-icon);
}
.button-group[data-stacked] > :global(.md-action) {
  flex-direction: column;
  padding-block: 6px;
  border-radius: 8px;
}
</style>
