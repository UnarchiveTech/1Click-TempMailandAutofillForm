<script lang="ts">
/**
 * Ctrl/Cmd+K command palette - navigate views and fire common actions.
 */
import { tick } from 'svelte';
import { cubicOut } from 'svelte/easing';
import { fade, fly } from 'svelte/transition';
import { t } from 'svelte-i18n';
import type { View } from '@/features/types/view-types.js';
import Icon from '@/ui/components/icons/Icon.svelte';
import IconButton from '@/ui/components/primitives/IconButton.svelte';
import { subscribeBottomSheetPreference } from '@/utils/ui/bottom-sheet-preference.js';
import { beginDialogLifecycle } from '@/utils/ui/dialog-lifecycle.js';
import { ELEVATION } from '@/utils/ui/elevation.js';
import { PORTAL_Z_CLASS, portalToBody } from '@/utils/ui/portal-layers.js';
import { useReducedMotion } from '@/utils/ui/reduced-motion.svelte.js';
import { rowInk, rowSurface } from '@/utils/ui/row-surface.js';
import type { PaletteCommand } from './palette-command-types.js';

export type { PaletteCommand } from './palette-command-types.js';

let {
  open = $bindable(false),
  commands = [] as PaletteCommand[],
  onClose = () => {},
}: {
  open?: boolean;
  commands?: PaletteCommand[];
  onClose?: () => void;
} = $props();

let query = $state('');
let activeIdx = $state(0);
let inputEl = $state<HTMLInputElement | null>(null);
let overlayEl = $state<HTMLElement | null>(null);
let panelEl = $state<HTMLElement | null>(null);
let dialogLifecycle: ReturnType<typeof beginDialogLifecycle> | null = null;
let previousQuery = '';
const motionPreference = useReducedMotion();
let useBottomSheet = $state(false);

$effect(() =>
  subscribeBottomSheetPreference((value) => {
    useBottomSheet = value;
  })
);

let filtered = $derived.by(() => {
  const q = query.trim().toLowerCase();
  if (!q) return commands.filter((command: PaletteCommand) => !command.queryOnly);
  const matches: { command: PaletteCommand; rank: number; matchAt: number }[] = [];
  for (const command of commands) {
    const label = command.label.toLowerCase();
    const hay = `${label} ${command.hint || ''} ${command.keywords || ''}`.toLowerCase();
    const matchAt = hay.indexOf(q);
    if (matchAt < 0) continue;
    const rank = label === q ? 0 : label.startsWith(q) ? 1 : label.includes(q) ? 2 : 3;
    matches.push({ command, rank, matchAt });
  }
  return matches
    .sort((a, b) => a.rank - b.rank || a.matchAt - b.matchAt)
    .slice(0, 40)
    .map((result) => result.command);
});

$effect(() => {
  const currentQuery = query;
  const resultCount = filtered.length;
  if (currentQuery !== previousQuery) {
    previousQuery = currentQuery;
    activeIdx = 0;
  } else {
    activeIdx = resultCount > 0 ? Math.min(activeIdx, resultCount - 1) : 0;
  }
});

$effect(() => {
  const selectedIndex = activeIdx;
  if (!open || filtered.length === 0) return;
  void tick().then(() => {
    if (!open || activeIdx !== selectedIndex) return;
    panelEl
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  });
});

$effect(() => {
  if (open && overlayEl) return portalToBody(overlayEl);
});

$effect(() => {
  if (!open) {
    query = '';
    activeIdx = 0;
    return;
  }
  const lifecycle = beginDialogLifecycle({ lockBodyScroll: false, initialFocus: inputEl });
  dialogLifecycle = lifecycle;
  void tick().then(() => lifecycle.attach(panelEl, inputEl));
  return () => {
    lifecycle.cleanup();
    if (dialogLifecycle === lifecycle) dialogLifecycle = null;
  };
});

function close() {
  open = false;
  onClose();
}

function run(cmd: PaletteCommand) {
  close();
  queueMicrotask(() => cmd.run());
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    close();
    return;
  }
  if (e.target !== inputEl) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIdx = filtered.length ? Math.min(filtered.length - 1, activeIdx + 1) : 0;
    return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIdx = filtered.length ? Math.max(0, activeIdx - 1) : 0;
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    const cmd = filtered[activeIdx];
    if (cmd) run(cmd);
  }
}
</script>

{#if open}
  <div
    bind:this={overlayEl}
    class="dialog-viewport-inset fixed inset-0 {PORTAL_Z_CLASS.dialog} flex {useBottomSheet ? 'items-end' : 'items-start'} justify-center {useBottomSheet ? 'pb-0' : 'pt-[12vh]'} px-3"
    transition:fade={{ duration: motionPreference.enabled ? 0 : 120 }}
    role="dialog"
    aria-modal="true"
    aria-label={$t('commandPalette.title')}
    data-activity-dialog-key="dialog:commandPalette"
  >
    <!-- Backdrop (mouse-only dismiss; Escape is handled by the panel's key handler) -->
    <div
      class="fixed inset-0 -z-10 cursor-default bg-md-scrim-basic backdrop-blur-sm"
      aria-hidden="true"
      onclick={(e) => {
        e.stopPropagation();
        close();
      }}
    ></div>
    <div
      bind:this={panelEl}
      class="dialog-surface scroll-frame relative w-full {useBottomSheet ? 'max-w-full rounded-t-2xl' : 'max-w-md rounded-2xl'} border border-md-outline-variant/30 bg-md-surface-container {ELEVATION.level3} overflow-hidden z-10"
      transition:fly={{
        y: useBottomSheet ? 24 : 8,
        duration: motionPreference.enabled ? 0 : 200,
        easing: cubicOut,
      }}
      role="presentation"
      onkeydown={onKey}
    >
      <div class="dialog-inset scroll-edge flex items-center gap-2 py-2.5 border-b border-md-outline-variant/20">
        <Icon name="search" class="w-5 h-5 text-md-on-surface-variant shrink-0" />
        <input
          bind:this={inputEl}
          bind:value={query}
          type="search"
          class="flex-1 min-w-0 bg-transparent text-sm outline-none text-md-on-surface placeholder:text-md-on-surface/40"
          placeholder={$t('commandPalette.placeholder')}
          aria-label={$t('commandPalette.placeholder')}
          autocomplete="off"
        />
        <kbd class="text-label-sm font-mono px-1.5 py-0.5 rounded bg-md-surface-variant text-md-on-surface/50"
          >Esc</kbd
        >
        <IconButton
          icon="close"
          size="sm"
          ariaLabel={$t('common.close')}
          title={$t('common.close')}
          onclick={close}
        />
      </div>
      <ul class="dialog-inset scroll-body scroll-body-framed max-h-[min(50vh,320px)] overflow-y-auto py-1" role="listbox">
        {#if filtered.length === 0}
          <li class="px-3 py-4 text-sm text-md-on-surface-variant text-center">
            {$t('commandPalette.empty')}
          </li>
        {:else}
          {#each filtered as cmd, i (cmd.id)}
            <li role="option" aria-selected={i === activeIdx}>
              <button
                type="button"
                class="w-full flex items-center gap-2.5 px-3 py-2 text-start text-sm {rowSurface({ active: i === activeIdx })}
                  {rowInk('primary', i === activeIdx ? 'active' : 'plain')}"
                onmouseenter={() => (activeIdx = i)}
                onclick={() => run(cmd)}
              >
                {#if cmd.icon}
                  <Icon name={cmd.icon} class="w-5 h-5 shrink-0 {rowInk('icon', i === activeIdx ? 'active' : 'plain')}" />
                {/if}
                <span class="flex-1 min-w-0 truncate font-medium">{cmd.label}</span>
                {#if cmd.hint}
                  <span class="text-xs shrink-0 {rowInk('meta', i === activeIdx ? 'active' : 'plain')}">{cmd.hint}</span>
                {/if}
              </button>
            </li>
          {/each}
        {/if}
      </ul>
    </div>
  </div>
{/if}
