<script lang="ts">
/**
 * THE selection strip - one component for every multi-select list.
 *
 * It reads whichever surface is live from the selection registry (mailbox,
 * addresses, identities, saved logins) and renders that list's facts and actions;
 * the actions themselves come from the closed vocabulary in
 * `@/utils/ui/selection-api.js`, so a new list is a publisher, not a new strip.
 *
 * It used to be the last item of the mailbox's fanned bottom strips, which meant
 * it was positioned inside the list view - so in split view (list + detail panes
 * side by side) it was clipped to the list pane and could not span the shell, and
 * the other three lists each kept a private copy of the same idea in their own
 * markup. Here it sits at shell level and every list is driven through
 * `SelectionApi`, so a button here runs the identical code path as the row
 * context menu, the keyboard bindings and the drag-onto-action drop targets.
 *
 * It is a pure renderer: it holds no selection of its own and never closes one
 * itself - `run()` on the owning list does that.
 */
import { t } from 'svelte-i18n';
import Icon from '@/ui/components/icons/Icon.svelte';
import { ELEVATION } from '@/utils/ui/elevation.js';
import { onStripDragOver } from '@/utils/ui/gesture-selection.js';
import { NAV_FLOAT_CONTENT_WIDTH_CSS } from '@/utils/ui/nav-layout.js';
import { PORTAL_Z_CLASS } from '@/utils/ui/portal-layers.js';
import { responsiveButtonLayout } from '@/utils/ui/responsive-button-layout.js';
import type { SelectionActionId } from '@/utils/ui/selection-api.js';
import { SELECTION_ACTION_CLASS, SELECTION_ACTION_META } from '@/utils/ui/selection-api.js';
import { activeSelectionStore } from '@/utils/ui/selection-registry.js';

let {
  /**
   * Reports how much vertical space the bar occupies - its height PLUS the gap it
   * floats above the bottom chrome - so the shell can lift the view's strips clear
   * of it. Reporting the height alone would leave the strips tucked 4px under it.
   */
  onMeasure = (_offsetPx: number) => {},
}: { onMeasure?: (offsetPx: number) => void } = $props();

/** Gap between the strip and the bottom chrome (the floating nav island). */
const BAR_GAP_PX = 4;

const current = $derived($activeSelectionStore);

let barEl = $state<HTMLElement | null>(null);

// The lists' own bottom chrome sits in the same band, so the shell raises it by
// this height while the strip is up. Measured, never guessed: the height depends
// on the locale and on how many actions the list offers (separate fitted rows).
$effect(() => {
  const el = barEl;
  if (!el) {
    onMeasure(0);
    return;
  }
  const measure = () => onMeasure(Math.round(el.getBoundingClientRect().height) + BAR_GAP_PX);
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(el);
  return () => observer.disconnect();
});

const selectAllLabel = $derived.by(() => {
  const state = current?.state;
  if (!state) return '';
  if (state.allMatched) {
    return $t('inbox.emailActions.allSelected', { values: { n: state.matchingTotal } });
  }
  if (state.count > 0 && state.universeCounted && state.matchingTotal > state.count) {
    return $t('inbox.emailActions.selectAllMatching', { values: { n: state.matchingTotal } });
  }
  return $t('inbox.emailActions.selectAll');
});

function runAction(action: SelectionActionId, e: DragEvent | MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  void current?.api.run(action);
}
</script>

{#if current}
  <div
    class="absolute inset-x-0 flex justify-center pointer-events-none selection-slide-up {PORTAL_Z_CLASS.chrome}"
    style="bottom: calc(var(--bottom-safe-area, 44px) + {BAR_GAP_PX}px);"
  >
    <div
      bind:this={barEl}
      class="pointer-events-auto flex flex-col items-stretch gap-1.5 box-border min-w-0 max-w-full px-2 py-2 bg-md-secondary-container rounded-xl {ELEVATION.level3} border border-md-outline-variant/30"
      style:width={NAV_FLOAT_CONTENT_WIDTH_CSS}
      role="toolbar"
      data-selection-strip
      aria-label={$t('address.selectedCount', { values: { n: current.state.count } })}
    >
      <div class="w-full flex flex-nowrap items-center gap-3" use:responsiveButtonLayout data-action-tier="S">
        <button
          type="button"
          class="flex-1 min-w-0 h-10 px-4 rounded-lg text-sm font-bold whitespace-nowrap bg-md-surface/80 text-md-on-surface active:brightness-95"
          onclick={(e) => {
            e.stopPropagation();
            current?.api.selectAll();
          }}
        >
          <span class="btn-label">{selectAllLabel}</span>
        </button>

        <button
          type="button"
          class="flex-1 min-w-0 h-10 px-4 rounded-lg text-sm font-bold bg-transparent text-md-on-secondary-container hover:bg-md-surface-variant/60 active:bg-md-surface-variant/80 tabular-nums whitespace-nowrap"
          aria-label={$t('inbox.emailActions.deselectAll')}
          onclick={(e) => {
            e.stopPropagation();
            current?.api.deselectAll();
          }}
        ><span class="btn-label">{$t('inbox.emailActions.deselectAll')} ({current.state.count})</span></button>
      </div>

      {#if current.state.actions.length > 0}
        <div class="w-full flex flex-nowrap items-center gap-2 border-t border-md-outline-variant/25 pt-1.5" use:responsiveButtonLayout data-action-tier="XS">
          {#each current.state.actions as action (action)}
            {@const meta = SELECTION_ACTION_META[action]}
            <button
              type="button"
              class="{SELECTION_ACTION_CLASS[meta.variant]} flex-1 min-w-0 h-8 px-3 rounded-lg font-bold text-xs flex items-center justify-center gap-1 whitespace-nowrap"
              title={meta.titleKey ? $t(meta.titleKey) : $t(meta.labelKey)}
              data-drop-action={meta.dropAction}
              ondragover={(e) => {
                onStripDragOver(e);
                if (e.dataTransfer) e.dataTransfer.dropEffect = meta.dropEffect;
              }}
              ondragenter={(e) => {
                e.preventDefault();
              }}
              ondrop={(e) => runAction(action, e)}
              onclick={(e) => runAction(action, e)}
            >
              <Icon name={meta.icon} class="w-5 h-5" />
              <span class="btn-label">{$t(meta.labelKey)}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}
