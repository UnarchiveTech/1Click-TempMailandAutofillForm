<script lang="ts">
import { t } from 'svelte-i18n';
import Icon from '@/ui/components/icons/Icon.svelte';

type EmptyStateKind = 'address' | 'mailbox' | 'identity';

let {
  kind,
  overlay = false,
}: {
  kind: EmptyStateKind;
  /** Render as a click-through placeholder inside a split host (pointer-events-none + marker). */
  overlay?: boolean;
} = $props();

const copy = {
  address: {
    icon: 'inbox',
    title: 'address.noAddressSelected',
    hint: 'address.splitEmptyHint',
    tips: ['address.splitTipSelect', 'address.splitTipCreate', 'address.splitTipDomain'],
  },
  mailbox: {
    icon: 'mail',
    title: 'inbox.noMessageSelected',
    hint: 'inbox.splitEmptyHint',
    tips: ['inbox.splitTipSelect', 'inbox.splitTipNavigate', 'inbox.splitTipSearch'],
  },
  identity: {
    icon: 'editSquare',
    title: 'identities.splitEmptyTitle',
    hint: 'identities.splitEmptyHint',
    tips: [],
  },
} as const;

const current = $derived(copy[kind]);
</script>

<div
  class="flex-1 flex flex-col items-center justify-center px-6 text-center gap-3 bg-md-surface-container-low/40 {overlay ? 'pointer-events-none' : ''}"
  data-autofill-split-placeholder={overlay || undefined}
>
  <Icon name={current.icon} class="w-12 h-12 text-md-on-surface/20" />
  <div class="text-sm font-semibold text-md-on-surface/70">{$t(current.title)}</div>
  <p class="text-xs text-md-on-surface/45 max-w-xs leading-relaxed">{$t(current.hint)}</p>
  {#if current.tips.length > 0}
    <ul class="text-xs text-md-on-surface/50 space-y-1.5 text-start max-w-xs mt-1">
      {#each current.tips as tip}
        <li class="flex gap-2"><span class="text-md-primary font-bold">·</span>{$t(tip)}</li>
      {/each}
    </ul>
  {/if}
</div>
