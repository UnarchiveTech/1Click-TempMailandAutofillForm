<script lang="ts">
import { t } from 'svelte-i18n';
import Badge from '@/ui/components/primitives/Badge.svelte';
import InputField from '@/ui/components/primitives/InputField.svelte';
import ProviderPill from '@/ui/components/primitives/ProviderPill.svelte';
import { getLifecycleStatus, normalizeAddressEmail } from '@/utils/address/address-status.js';
import { loadProviderConfig } from '@/utils/email/email-service.js';
import { instanceLabelFor } from '@/utils/provider/provider-instance.js';
import { useCurrentTime } from '@/utils/time/time-store.js';
import type { Address } from '@/utils/types.js';
import { rowSurface } from '@/utils/ui/row-surface.js';

interface Props {
  allAddresses: Address[];
  selectedEmail: string;
  unreadByAddress: Record<string, number>;
  onPick: (address: string) => void;
  onClose: () => void;
}
let { allAddresses, selectedEmail, unreadByAddress, onPick, onClose }: Props = $props();

let query = $state<string | number>('');
let container = $state<HTMLDivElement>();
const clock = useCurrentTime();
const selectedKey = $derived(normalizeAddressEmail(selectedEmail));
const rows = $derived.by(() =>
  allAddresses
    .filter((address) => address.address && address.accountStatus !== 'deleted')
    .map((address) => {
      let providerName: string = address.provider;
      try {
        providerName = loadProviderConfig(address.provider).displayName || address.provider;
      } catch {
        /* Unknown providers still expose their saved address and id. */
      }
      const key = normalizeAddressEmail(address.address);
      return {
        address,
        key,
        search:
          `${key} ${providerName} ${instanceLabelFor(address.provider, address.instanceUrl || '')}`.toLowerCase(),
      };
    })
);
const unreadCounts = $derived.by(() => {
  const counts = new Map<string, number>();
  for (const [address, count] of Object.entries(unreadByAddress)) {
    const key = normalizeAddressEmail(address);
    counts.set(key, (counts.get(key) ?? 0) + count);
  }
  return counts;
});
const normalizedQuery = $derived(String(query).trim().toLowerCase());
const visibleRows = $derived(rows.filter((row) => row.search.includes(normalizedQuery)));

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    onClose();
    return;
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const buttons = Array.from(
    container?.querySelectorAll<HTMLButtonElement>('[data-address-option]') ?? []
  );
  if (!buttons.length) return;
  event.preventDefault();
  event.stopPropagation();
  const index = buttons.indexOf(event.target as HTMLButtonElement);
  const next =
    index < 0
      ? event.key === 'ArrowDown'
        ? 0
        : buttons.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next]?.focus();
}
</script>

<div
  bind:this={container}
  id="sidebar-address-picker"
  class="ms-4 mt-1 mb-2 min-w-0 rounded-xl border border-md-outline-variant/40 bg-md-surface overflow-hidden"
  role="group"
  aria-label={$t('address.searchAddresses')}
>
  <InputField
    id="sidebar-address-search"
    type="search"
    label={$t('address.searchAddresses')}
    bind:value={query}
    class="p-2"
    onkeydown={handleKeydown}
  />
  <div class="max-h-64 overflow-y-auto p-1 space-y-0.5">
    {#each visibleRows as row (row.address.id)}
      {@const active = row.key === selectedKey}
      {@const unread = unreadCounts.get(row.key) ?? 0}
      {@const status = getLifecycleStatus(row.address, $clock)}
      <button
        type="button"
        data-address-option
        class="w-full min-w-0 text-start px-2 py-2 rounded-lg {rowSurface({ active })} text-md-on-surface"
        aria-pressed={active}
        title={row.address.address}
        onkeydown={handleKeydown}
        onclick={(event) => {
          event.stopPropagation();
          onPick(row.address.address);
        }}
      >
        <span class="flex items-center gap-1 min-w-0">
          <bdi dir="ltr" class="truncate flex-1 ui-row-primary">{row.address.address}</bdi>
          {#if unread > 0}
            <span title={$t('address.unreadCount', { values: { n: unread } })}>
              <span class="sr-only">{$t('address.unreadCount', { values: { n: unread } })}</span>
              <span aria-hidden="true"><Badge size="sm" variant="primary" label={unread > 99 ? '99+' : String(unread)} /></span>
            </span>
          {/if}
        </span>
        <span class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 mt-1 ui-support text-md-on-surface-variant">
          <ProviderPill provider={row.address.provider} instanceUrl={row.address.instanceUrl} variant="inline" />
          <span class={status === 'expired' ? 'text-md-error' : ''}>
            {#if status === 'archived'}{$t('common.archived')}
            {:else if status === 'expired'}{$t('address.expiredStatus')}
            {:else}{$t('address.live')}{/if}
          </span>
        </span>
      </button>
    {:else}
      <p class="px-2 py-3 ui-support text-md-on-surface-variant" role="status">{$t('common.noMatchesHint')}</p>
    {/each}
  </div>
</div>

<style>
  button:focus-visible { outline: 2px solid var(--md-primary); outline-offset: -2px; }
  @media (pointer: coarse) { button { min-height: 48px; } }
</style>
