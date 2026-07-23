<script lang="ts">
/**
 * Resizable horizontal split: list | detail.
 * Persists list width ratio (0–1 of container) to storage when storageKey is set.
 */
import { onMount } from 'svelte';
import { browser } from 'wxt/browser';

let {
  enabled = true,
  /** Initial / bound list pane width in px (clamped) */
  listWidthPx = $bindable(420),
  minListPx = 260,
  maxListPx = 640,
  storageKey = 'splitListWidthPx',
  class: extraClass = '',
  list,
  detail,
} = $props<{
  enabled?: boolean;
  listWidthPx?: number;
  minListPx?: number;
  maxListPx?: number;
  storageKey?: string;
  class?: string;
  list: import('svelte').Snippet;
  detail: import('svelte').Snippet;
}>();

let rootEl = $state<HTMLElement | null>(null);
let dragging = $state(false);

function clampWidth(w: number, containerW: number): number {
  const max = Math.min(maxListPx, Math.max(minListPx, containerW * 0.55));
  const min = Math.min(minListPx, max);
  return Math.round(Math.min(max, Math.max(min, w)));
}

function onPointerDown(e: PointerEvent) {
  if (!enabled || !rootEl) return;
  e.preventDefault();
  dragging = true;
  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
}

function onPointerMove(e: PointerEvent) {
  if (!dragging || !rootEl) return;
  const rect = rootEl.getBoundingClientRect();
  const x = e.clientX - rect.left;
  listWidthPx = clampWidth(x, rect.width);
}

function onPointerUp(e: PointerEvent) {
  if (!dragging) return;
  dragging = false;
  try {
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  } catch {
    /* ignore */
  }
  if (storageKey) {
    void browser.storage.local.set({ [storageKey]: listWidthPx });
  }
}

onMount(() => {
  if (!storageKey) return;
  void browser.storage.local.get([storageKey]).then((r) => {
    const w = (r as Record<string, unknown>)[storageKey];
    if (typeof w === 'number' && w > 0) {
      const cw = rootEl?.clientWidth || 1280;
      listWidthPx = clampWidth(w, cw);
    }
  });
});
</script>

{#if enabled}
  <div
    class="flex flex-1 min-h-0 overflow-hidden flex-row {extraClass}"
    bind:this={rootEl}
    class:split-dragging={dragging}
  >
    <div
      class="shrink-0 overflow-hidden flex flex-col min-h-0 border-e border-md-outline-variant/30"
      style="width: {listWidthPx}px; min-width: {minListPx}px; max-width: min({maxListPx}px, 55%);"
    >
      {@render list()}
    </div>
    <button
      type="button"
      class="split-divider shrink-0 relative z-10 w-1.5 cursor-col-resize group touch-none
        bg-transparent hover:bg-md-primary/20 active:bg-md-primary/30 transition-colors border-0 p-0"
      aria-label="Resize split panes"
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
      onkeydown={(e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          listWidthPx = clampWidth(listWidthPx - 16, rootEl?.clientWidth || 1280);
          if (storageKey) void browser.storage.local.set({ [storageKey]: listWidthPx });
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          listWidthPx = clampWidth(listWidthPx + 16, rootEl?.clientWidth || 1280);
          if (storageKey) void browser.storage.local.set({ [storageKey]: listWidthPx });
        }
      }}
    >
      <span
        class="absolute inset-y-2 inset-x-0 mx-auto w-0.5 rounded-full bg-md-outline-variant/50
          group-hover:bg-md-primary group-focus-visible:bg-md-primary transition-colors"
      ></span>
    </button>
    <div class="flex-1 min-w-0 overflow-hidden flex flex-col min-h-0">
      {@render detail()}
    </div>
  </div>
{:else}
  <div class="flex flex-1 min-h-0 overflow-hidden flex-col {extraClass}">
    {@render list()}
  </div>
{/if}

<style>
  .split-dragging {
    user-select: none;
    cursor: col-resize;
  }
  .split-divider:focus-visible {
    outline: 2px solid var(--md-primary);
    outline-offset: 1px;
  }
  @media (prefers-reduced-motion: reduce) {
    .split-divider {
      transition: none;
    }
  }
</style>
