<script lang="ts">
import type { Snippet } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import Icon from '@/ui/components/icons/Icon.svelte';
import { logError } from '@/utils/logger.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import { DEFAULT_CONTAINER_WIDTH } from '@/utils/ui/breakpoints.js';
import { ELEVATION } from '@/utils/ui/elevation.js';
import { toastStore } from '@/utils/ui/toastStore.js';

let {
  layoutSplit,
  layoutVerticalSplit,
  splitModeFlash = false,
  showSplitPane,
  splitPaneCollapsed,
  hideDetailWhileSelecting = false,
  splitListWidthPx,
  listMinWidth = 360,
  listMaxWidth = 640,
  listMaxWidthPct = 55,
  detailMinWidth = 360,
  detailClass = 'relative flex-1 overflow-hidden flex flex-col rounded-xl bg-md-surface',
  detailStyle,
  detailId,
  detailRef = $bindable<HTMLElement | null>(null),
  mainPaneRelative = true,
  main,
  detail,
  onToggleSplitPane,
  onWidthChange,
  onExpandSplitPane,
}: {
  layoutSplit: boolean;
  layoutVerticalSplit: boolean;
  splitModeFlash?: boolean;
  showSplitPane: boolean;
  splitPaneCollapsed: boolean;
  hideDetailWhileSelecting?: boolean;
  splitListWidthPx: number;
  listMinWidth?: number;
  listMaxWidth?: number;
  listMaxWidthPct?: number;
  detailMinWidth?: number;
  detailClass?: string;
  detailStyle?: string;
  detailId?: string;
  detailRef?: HTMLElement | null;
  mainPaneRelative?: boolean;
  main: Snippet;
  detail: Snippet;
  onToggleSplitPane: () => void;
  onWidthChange: (width: number) => void;
  onExpandSplitPane: () => void;
} = $props();

let splitListHeightPx = $state(360);
let selectionDetailExpanded = $state(false);
$effect(() => {
  if (!hideDetailWhileSelecting) selectionDetailExpanded = false;
});
const renderSplitPane = $derived(
  showSplitPane && !(layoutVerticalSplit && hideDetailWhileSelecting && !selectionDetailExpanded)
);

const layoutClass = $derived(
  layoutSplit
    ? 'flex-row gap-[7.5px]'
    : layoutVerticalSplit
      ? 'flex-col gap-2 overflow-y-auto'
      : 'flex-col'
);

const listStyle = $derived(
  layoutSplit
    ? renderSplitPane
      ? `width: ${splitListWidthPx}px; min-width: ${listMinWidth}px; max-width: min(${listMaxWidth}px, ${listMaxWidthPct}%); flex-shrink: 0;`
      : 'min-width: 0; max-width: none; flex: 1 1 0%;'
    : layoutVerticalSplit
      ? renderSplitPane
        ? `min-width: 0; height: ${splitListHeightPx}px; min-height: 220px; max-height: 65%; flex-shrink: 0;`
        : 'min-width: 0; min-height: 0; max-height: none; flex: 1 1 0%;'
      : 'min-width: 0;'
);

const resolvedDetailStyle = $derived(
  detailStyle ?? (layoutSplit ? `min-width: ${detailMinWidth}px;` : 'min-height: 280px;')
);

// --- Split-pane divider (drag-resize + collapse toggle) ---
let activeMove: ((event: PointerEvent) => void) | null = null;
let activeUp: (() => void) | null = null;
let splitRoot = $state<HTMLElement | null>(null);

function resizeBounds(vertical: boolean) {
  if (vertical)
    return {
      min: 220,
      max: Math.max(
        220,
        Math.min(
          700,
          (splitRoot?.clientHeight || 600) * 0.65,
          (splitRoot?.clientHeight || 600) - 296
        )
      ),
    };
  const width = splitRoot?.clientWidth || DEFAULT_CONTAINER_WIDTH;
  return {
    min: listMinWidth,
    max: Math.max(
      listMinWidth,
      Math.min(listMaxWidth, (width * listMaxWidthPct) / 100, width - detailMinWidth - 16)
    ),
  };
}

async function persistSize(vertical: boolean, size: number) {
  try {
    await writeWithRetry(vertical ? { splitListHeightPx: size } : { splitListWidthPx: size });
  } catch (error) {
    logError('Failed to save split pane size', error);
    toastStore.error($t('errors.storageWriteFailed'));
  }
}

function onResizeKeydown(event: KeyboardEvent) {
  const vertical = layoutVerticalSplit;
  const rtl = splitRoot && getComputedStyle(splitRoot).direction === 'rtl';
  const less = vertical ? 'ArrowUp' : rtl ? 'ArrowRight' : 'ArrowLeft';
  const more = vertical ? 'ArrowDown' : rtl ? 'ArrowLeft' : 'ArrowRight';
  if (
    ![less, more, 'Home', 'End'].includes(event.key) ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  )
    return;
  event.preventDefault();
  event.stopPropagation();
  const bounds = resizeBounds(vertical);
  const current = vertical ? splitListHeightPx : splitListWidthPx;
  const next =
    event.key === 'Home'
      ? bounds.min
      : event.key === 'End'
        ? bounds.max
        : Math.min(
            bounds.max,
            Math.max(
              bounds.min,
              current + (event.key === more ? 1 : -1) * (event.shiftKey ? 50 : 10)
            )
          );
  if (vertical) splitListHeightPx = next;
  else onWidthChange(next);
  void persistSize(vertical, next);
}

$effect(() => {
  let cancelled = false;
  void browser.storage.local
    .get('splitListHeightPx')
    .then((result) => {
      const height = (result as { splitListHeightPx?: number }).splitListHeightPx;
      if (!cancelled && typeof height === 'number' && Number.isFinite(height)) {
        splitListHeightPx = Math.min(700, Math.max(220, height));
      }
    })
    .catch(() => {
      /* Keep the default when layout preferences are unavailable. */
    });
  return () => {
    cancelled = true;
  };
});

function stopDrag() {
  if (activeMove) window.removeEventListener('pointermove', activeMove);
  if (activeUp) window.removeEventListener('pointerup', activeUp);
  activeMove = null;
  activeUp = null;
}

function beginDrag(event: PointerEvent) {
  event.preventDefault();
  const vertical = layoutVerticalSplit;
  const startPosition = vertical ? event.clientY : event.clientX;
  const startX = event.clientX;
  const startWidth = splitListWidthPx;
  const startHeight = splitListHeightPx;
  let finalSize = vertical ? startHeight : startWidth;
  const bounds = resizeBounds(vertical);

  const move = (current: PointerEvent) => {
    if (vertical) {
      finalSize = Math.min(
        bounds.max,
        Math.max(bounds.min, startHeight + (current.clientY - startPosition))
      );
      splitListHeightPx = finalSize;
      return;
    }

    const direction = splitRoot && getComputedStyle(splitRoot).direction === 'rtl' ? -1 : 1;
    finalSize = Math.min(
      bounds.max,
      Math.max(bounds.min, startWidth + (current.clientX - startX) * direction)
    );
    onWidthChange(finalSize);
  };
  const up = () => {
    stopDrag();
    void persistSize(vertical, finalSize);
  };

  stopDrag();
  activeMove = move;
  activeUp = up;
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

$effect(() => () => stopDrag());
</script>

<style>
  /* Split pane divider column (portrait/horizontal layout) */
  .split-divider-col {
    position: relative;
  }
  .split-divider-col::before {
    content: '';
    position: absolute;
    inset: 0;
    left: 50%;
    width: 1px;
    background: var(--md-outline-variant, rgba(0, 0, 0, 0.12));
    opacity: 0.4;
    /* Decorative only - as a positioned element it paints ABOVE the static
       resize-handle button, so without this it swallows every pointer event
       along the exact column centerline and the divider can't be grabbed. */
    pointer-events: none;
  }

  /* Collapse toggle button - appears on hover for discoverability */
  .split-collapse-btn {
    opacity: 0;
    transition: opacity 150ms ease, transform 150ms ease;
  }
  .split-divider-col:hover .split-collapse-btn,
  .split-divider-row:hover .split-collapse-btn,
  .split-collapse-btn:focus-visible {
    opacity: 1;
  }

  .split-divider-row {
    position: relative;
  }
  .split-divider-row::before {
    content: '';
    position: absolute;
    inset-inline: 0;
    top: 50%;
    height: 1px;
    background: var(--md-outline-variant, rgba(0, 0, 0, 0.12));
    opacity: 0.4;
    pointer-events: none;
  }

  /* Re-expand strip (shown when split pane collapsed) */
  .split-reexpand-strip {
    opacity: 0.6;
    transition: opacity 150ms ease, background-color 150ms ease;
  }
  .split-reexpand-strip:hover {
    opacity: 1;
  }
</style>

<div bind:this={splitRoot} class="flex flex-1 min-h-0 overflow-hidden {layoutClass} {splitModeFlash ? 'split-mode-flash' : ''}">
  <div
    data-mainview
    class="{mainPaneRelative ? 'relative ' : ''}{layoutSplit
      ? renderSplitPane
        ? 'shrink-0 flex flex-col h-full min-h-0'
        : 'flex-1 min-w-0 flex flex-col h-full min-h-0'
      : layoutVerticalSplit
        ? renderSplitPane
          ? 'shrink-0 flex flex-col'
          : 'flex-1 min-h-0 flex flex-col h-full'
        : 'flex-1 min-h-0 flex flex-col h-full'}"
    style={listStyle}
  >
    {@render main()}
  </div>

  {#if renderSplitPane}
    {#if layoutSplit}
      <div class="split-divider-col shrink-0 flex flex-col items-center relative z-10" style="width: 20px;">
        <button
          type="button"
          class="split-collapse-btn absolute top-1/2 -translate-y-1/2 z-20 flex items-center justify-center
            w-5 h-10 rounded-full bg-md-surface-container border border-md-outline-variant/40
            text-md-on-surface-variant hover:bg-md-secondary-container active:bg-md-secondary-container-pressed hover:text-md-on-secondary-container
            hover:border-md-secondary transition-all {ELEVATION.level1}"
          aria-label={splitPaneCollapsed ? $t('common.expandDetailPane') : $t('common.collapseDetailPane')}
          onclick={onToggleSplitPane}
        >
          <Icon name={splitPaneCollapsed ? 'chevronRight' : 'chevronLeft'} class="w-3 h-3" />
        </button>
        <div
          tabindex="0"
          class="split-resize-handle w-full h-full cursor-col-resize border-0 p-0 bg-transparent focus-visible:outline-2 focus-visible:outline-md-primary focus-visible:outline-offset-[-2px]
            hover:bg-md-primary/20 active:bg-md-primary/30"
          aria-label={$t('common.resizePanes')}
          onpointerdown={beginDrag}
          onkeydown={onResizeKeydown}
          role="slider"
          aria-orientation="horizontal"
          aria-valuemin={listMinWidth}
          aria-valuemax={resizeBounds(false).max}
          aria-valuenow={Math.round(splitListWidthPx)}
        ></div>
      </div>
    {:else if layoutVerticalSplit}
      <div class="split-divider-row relative z-10 flex h-3 shrink-0 items-center justify-center">
        <div
          tabindex="0"
          class="absolute inset-0 z-10 h-full w-full cursor-row-resize border-0 bg-transparent p-0 hover:bg-md-primary/15 active:bg-md-primary/25 focus-visible:outline-2 focus-visible:outline-md-primary focus-visible:outline-offset-[-2px]"
          aria-label={$t('common.resizePanes')}
          onpointerdown={beginDrag}
          onkeydown={onResizeKeydown}
          role="slider"
          aria-orientation="vertical"
          aria-valuemin={220}
          aria-valuemax={resizeBounds(true).max}
          aria-valuenow={Math.round(splitListHeightPx)}
        ></div>
        <button
          type="button"
          class="split-collapse-btn absolute z-20 flex h-5 w-10 items-center justify-center rounded-full border border-md-outline-variant/40 bg-md-surface-container text-md-on-surface-variant hover:border-md-secondary hover:bg-md-secondary-container hover:text-md-on-secondary-container active:bg-md-secondary-container-pressed transition-all {ELEVATION.level1}"
          aria-label={$t('common.collapseDetailPane')}
          onclick={onToggleSplitPane}
        >
          <Icon name="chevronDown" class="h-3 w-3" />
        </button>
      </div>
    {/if}
    <div
      data-splitview
      id={detailId}
      bind:this={detailRef}
      class={detailClass}
      style={resolvedDetailStyle}
    >
      {@render detail()}
    </div>
  {:else if layoutVerticalSplit && hideDetailWhileSelecting && !splitPaneCollapsed}
    <div class="split-divider-row relative z-10 flex h-3 shrink-0 items-center justify-center">
      <button
        type="button"
        class="absolute z-20 flex h-5 w-10 items-center justify-center rounded-full border border-md-outline-variant/40 bg-md-surface-container text-md-on-surface-variant hover:border-md-secondary hover:bg-md-secondary-container hover:text-md-on-secondary-container active:bg-md-secondary-container-pressed transition-all {ELEVATION.level1}"
        aria-label={$t('common.expandDetailPane')}
        title={$t('common.expandDetailPane')}
        onclick={() => (selectionDetailExpanded = true)}
      >
        <Icon name="chevronUp" class="h-3 w-3" />
      </button>
    </div>
  {/if}

  {#if (layoutSplit || layoutVerticalSplit) && splitPaneCollapsed}
    <button
      type="button"
      class="split-reexpand-strip shrink-0 flex items-center justify-center gap-1
        text-label-sm font-medium text-md-on-surface-variant hover:text-md-on-secondary-container
       hover:bg-md-secondary-container active:bg-md-secondary-container-pressed transition-all border-md-outline-variant/30
        {layoutSplit ? 'flex-col w-8 border-s' : 'flex-row h-8 border-t'}"
      aria-label={$t('common.expandSplitPane')}
      onclick={onExpandSplitPane}
    >
      <Icon name={layoutSplit ? 'chevronLeft' : 'chevronUp'} class="w-3.5 h-3.5" />
      <span class="text-label-sm {layoutSplit ? '[writing-mode:vertical-rl] rotate-180' : ''}">
        {$t('layout.splitPane')}
      </span>
    </button>
  {/if}
</div>
