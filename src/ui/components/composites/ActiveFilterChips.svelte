<script lang="ts">
import { tick } from 'svelte';
import { t } from 'svelte-i18n';
import Icon from '@/ui/components/icons/Icon.svelte';
import Btn from '@/ui/components/primitives/Btn.svelte';
import { controlSurface } from '@/utils/ui/row-surface.js';

let {
  filters,
  onRemove,
  onClear,
  onEmpty,
}: {
  filters: Array<{ id: string; label: string }>;
  onRemove: (id: string) => void;
  onClear: () => void;
  onEmpty?: () => void;
} = $props();
let root = $state<HTMLDivElement | null>(null);

async function remove(id: string, index: number) {
  onRemove(id);
  await tick();
  const buttons = root?.querySelectorAll<HTMLButtonElement>('[data-filter-chip]');
  if (buttons?.length) buttons[Math.min(index, buttons.length - 1)]?.focus();
  else onEmpty?.();
}
async function clear() {
  onClear();
  await tick();
  onEmpty?.();
}
</script>

{#if filters.length}
  <div bind:this={root} class="flex flex-wrap items-center gap-2" data-active-filter-chips>
    {#each filters as filter, index (filter.id)}
      <button type="button" data-filter-chip={filter.id}
        class="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-lg border border-md-outline-variant px-2 ui-label text-md-on-secondary-container {controlSurface(true)}"
        aria-label={$t('inbox.removeFilterPill', { values: { pill: filter.label } })}
        title={filter.label} onclick={() => void remove(filter.id, index)}>
        <span class="truncate">{filter.label}</span>
        <Icon name="close" class="h-4 w-4 shrink-0" />
      </button>
    {/each}
    <Btn variant="ghost" size="sm" label={$t('savedLoginInfo.clearFilters')} onclick={() => void clear()} />
  </div>
{/if}
