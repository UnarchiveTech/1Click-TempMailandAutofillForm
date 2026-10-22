<script module lang="ts">
export type MailboxStripId =
  | 'health'
  | 'verification'
  | 'autofill'
  | 'savedLogin'
  | 'filter'
  | 'renewal'
  | 'suggestion'
  | 'siteAccess';
export interface MailboxStripTab {
  id: MailboxStripId;
  label: string;
  attention?: boolean;
  count?: number;
}
</script>

<script lang="ts">
import type { Snippet } from 'svelte';
import { t } from 'svelte-i18n';
import IconButton from '@/ui/components/primitives/IconButton.svelte';
import { ELEVATION } from '@/utils/ui/elevation.js';
import { controlSurface } from '@/utils/ui/row-surface.js';

let { items, active, collapsed, onSelect, onCollapse, children }: {
  items: MailboxStripTab[];
  active: MailboxStripId;
  collapsed: boolean;
  onSelect: (id: MailboxStripId) => void;
  onCollapse: (collapsed: boolean) => void;
  children: Snippet;
} = $props();

function choose(id: MailboxStripId) {
  onSelect(id);
  onCollapse(false);
}

function navigate(event: KeyboardEvent, index: number) {
  const rtl = getComputedStyle(event.currentTarget as HTMLElement).direction === 'rtl';
  let next = index;
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = items.length - 1;
  else if (event.key === 'ArrowRight') next += rtl ? -1 : 1;
  else if (event.key === 'ArrowLeft') next += rtl ? 1 : -1;
  else return;
  event.preventDefault();
  event.stopPropagation();
  next = (next + items.length) % items.length;
  const button = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next];
  choose(items[next].id);
  button?.focus({ preventScroll: true });
  button?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
</script>

<section data-strip-dock class="rounded-2xl border border-md-outline-variant/40 bg-md-surface-container {ELEVATION.level1} overflow-hidden pointer-events-auto" aria-label={$t('stripDock.title')}>
  <div class="flex min-w-0 items-center border-b border-md-outline-variant/30">
    {#if items.length > 1}
      <div role="tablist" aria-label={$t('stripDock.title')} class="flex min-w-0 flex-1 overflow-x-auto overscroll-contain">
        {#each items as item, index (item.id)}
          <button type="button" id="strip-tab-{item.id}" role="tab" aria-selected={active === item.id} aria-controls="strip-panel-{item.id}" tabindex={active === item.id ? 0 : -1}
            class="flex min-h-10 shrink-0 items-center justify-center gap-1.5 px-3 text-sm font-medium text-md-on-surface {controlSurface(active === item.id, 'underline')}"
            onclick={(event) => { event.stopPropagation(); choose(item.id); }} onkeydown={(event) => navigate(event, index)}>
            {item.label}
            {#if item.count}<span class="text-xs tabular-nums">{item.count}</span>{/if}
            {#if item.attention}<span class="size-1.5 rounded-full bg-md-error" aria-hidden="true"></span>{/if}
          </button>
        {/each}
      </div>
    {:else}
      <span id="strip-tab-{active}" class="min-w-0 flex-1 px-3 py-2 text-sm font-medium text-md-on-surface truncate">{items[0]?.label}</span>
    {/if}
    <IconButton icon={collapsed ? 'chevronUp' : 'chevronDown'} size="md" ariaLabel={collapsed ? $t('inbox.expandStrips') : $t('inbox.collapseStrips')} aria-expanded={!collapsed} onclick={() => onCollapse(!collapsed)} />
  </div>
  <div hidden={collapsed} class="max-h-[min(20rem,45vh)] overflow-y-auto overscroll-contain" data-strip-dock-content>
    {#each items as item (item.id)}
      <div id="strip-panel-{item.id}" role={items.length > 1 ? 'tabpanel' : 'region'} aria-labelledby="strip-tab-{item.id}" hidden={active !== item.id}>
        {#if active === item.id}{@render children()}{/if}
      </div>
    {/each}
  </div>
</section>
