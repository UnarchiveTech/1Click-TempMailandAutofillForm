<script lang="ts">
/**
 * Ctrl/Cmd+K command palette — navigate views and fire common actions.
 */
import { tick } from 'svelte';
import { t } from 'svelte-i18n';
import Icon from '@/components/icons/Icon.svelte';
import type { View } from '@/features/types/view-types.js';
import { setupFocusTrap } from '@/utils/focusTrap.js';
import { portalToBody } from '@/utils/portal-layers.js';

export type PaletteCommand = {
  id: string;
  label: string;
  hint?: string;
  icon?: string;
  keywords?: string;
  run: () => void;
};

let {
  open = $bindable(false),
  commands = [] as PaletteCommand[],
  onClose = () => {},
} = $props<{
  open?: boolean;
  commands?: PaletteCommand[];
  onClose?: () => void;
}>();

let query = $state('');
let activeIdx = $state(0);
let inputEl = $state<HTMLInputElement | null>(null);
let overlayEl = $state<HTMLElement | null>(null);
let panelEl = $state<HTMLElement | null>(null);
let cleanupTrap: (() => void) | null = null;

let filtered = $derived.by(() => {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter((c: PaletteCommand) => {
    const hay = `${c.label} ${c.hint || ''} ${c.keywords || ''}`.toLowerCase();
    return hay.includes(q);
  });
});

$effect(() => {
  void filtered;
  activeIdx = 0;
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
  void tick().then(() => {
    inputEl?.focus();
    if (panelEl) cleanupTrap = setupFocusTrap(panelEl);
  });
  return () => {
    cleanupTrap?.();
    cleanupTrap = null;
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
    close();
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIdx = Math.min(filtered.length - 1, activeIdx + 1);
    return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIdx = Math.max(0, activeIdx - 1);
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
    class="fixed inset-0 z-[10000] flex items-start justify-center pt-[12vh] px-3"
    role="dialog"
    aria-modal="true"
    aria-label={$t('commandPalette.title')}
  >
    <button
      type="button"
      class="absolute inset-0 bg-md-scrim/35 backdrop-blur-sm border-0 cursor-default"
      aria-label={$t('common.close')}
      onclick={close}
    ></button>
    <div
      bind:this={panelEl}
      class="relative w-full max-w-md rounded-2xl border border-md-outline-variant/30 bg-md-surface-container shadow-2xl overflow-hidden z-10"
      role="presentation"
      onkeydown={onKey}
    >
      <div class="flex items-center gap-2 px-3 py-2.5 border-b border-md-outline-variant/20">
        <Icon name="search" class="w-4 h-4 text-md-on-surface/45 shrink-0" />
        <input
          bind:this={inputEl}
          bind:value={query}
          type="search"
          class="flex-1 min-w-0 bg-transparent text-sm outline-none text-md-on-surface placeholder:text-md-on-surface/40"
          placeholder={$t('commandPalette.placeholder')}
          autocomplete="off"
        />
        <kbd class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-md-surface-variant text-md-on-surface/50"
          >Esc</kbd
        >
      </div>
      <ul class="max-h-[min(50vh,320px)] overflow-y-auto py-1" role="listbox">
        {#if filtered.length === 0}
          <li class="px-3 py-4 text-xs text-md-on-surface/45 text-center">
            {$t('commandPalette.empty')}
          </li>
        {:else}
          {#each filtered as cmd, i (cmd.id)}
            <li role="option" aria-selected={i === activeIdx}>
              <button
                type="button"
                class="w-full flex items-center gap-2.5 px-3 py-2 text-start text-sm transition-colors
                  {i === activeIdx
                    ? 'bg-md-secondary-container text-md-on-secondary-container'
                    : 'text-md-on-surface hover:bg-md-surface-variant/50'}"
                onmouseenter={() => (activeIdx = i)}
                onclick={() => run(cmd)}
              >
                {#if cmd.icon}
                  <Icon name={cmd.icon} class="w-4 h-4 shrink-0 opacity-80" />
                {/if}
                <span class="flex-1 min-w-0 truncate font-medium">{cmd.label}</span>
                {#if cmd.hint}
                  <span class="text-xs opacity-50 shrink-0">{cmd.hint}</span>
                {/if}
              </button>
            </li>
          {/each}
        {/if}
      </ul>
    </div>
  </div>
{/if}
