<script lang="ts">
import IconArchive from '@/components/icons/IconArchive.svelte';
import IconDownload from '@/components/icons/IconDownload.svelte';
import IconEditSquare from '@/components/icons/IconEditSquare.svelte';
import IconInbox from '@/components/icons/IconInbox.svelte';
import IconRefresh from '@/components/icons/IconRefresh.svelte';
import IconSearch from '@/components/icons/IconSearch.svelte';
import IconTrash from '@/components/icons/IconTrash.svelte';
import IconX from '@/components/icons/IconX.svelte';
import { canUnarchive } from '@/features/inbox/inbox-management.js';
import type { Account } from '@/utils/types.js';

let {
  context = 'popup',
  onBack = () => {},
  mgmtTab = 'active',
  mgmtSearch = '',
  selectedAddresses = new Set(),
  mgmtAccounts = [],
  allSelected = false,
  loadingInboxes = false,
  onTabChange = () => {},
  onSearchChange = () => {},
  onToggleSelectAll = () => {},
  onToggleSelect = () => {},
  onArchiveSelected = () => {},
  onUnarchiveSelected = () => {},
  onDeleteSelected = () => {},
  onExportSelected = () => {},
  onOpenEmailDetail = () => {},
  onArchiveAccount = () => {},
  onUnarchiveAccount = () => {},
  onExportAccountEmails = () => {},
  onGenerateNewAddress = () => {},
  onEditAccount = () => {},
  onExtendAccount = () => {},
} = $props<{
  context?: 'popup' | 'sidepanel' | 'app';
  onBack?: () => void;
  mgmtTab?: string;
  mgmtSearch?: string;
  selectedAddresses?: Set<string>;
  mgmtAccounts?: Account[];
  allSelected?: boolean;
  loadingInboxes?: boolean;
  onTabChange?: (tab: string) => void;
  onSearchChange?: (value: string) => void;
  onToggleSelectAll?: () => void;
  onToggleSelect?: (id: string) => void;
  onArchiveSelected?: () => void;
  onUnarchiveSelected?: () => void;
  onDeleteSelected?: () => void;
  onExportSelected?: () => void;
  onOpenEmailDetail?: (account: Account) => void;
  onArchiveAccount?: (account: Account) => void;
  onUnarchiveAccount?: (account: Account) => void;
  onExportAccountEmails?: (account: Account) => void;
  onGenerateNewAddress?: () => void;
  onEditAccount?: (account: Account) => void;
  onExtendAccount?: (account: Account) => void;
}>();
</script>


<!-- Tabs -->
<div class="flex gap-1 px-4 pt-3 pb-2">
  <div class="flex gap-1 p-1 rounded-full bg-md-surface-variant flex-1">
    <button
      class="flex-1 flex items-center justify-center gap-2 px-3 py-1 rounded-full transition-all duration-200 {mgmtTab === 'active' ? 'bg-md-surface shadow-sm' : ''}"
      onclick={() => onTabChange('active')}
    >
      <span class="text-xs font-bold {mgmtTab === 'active' ? 'text-md-on-surface' : 'text-md-on-surface/40'}">Live</span>
    </button>
    <button
      class="flex-1 flex items-center justify-center gap-2 px-3 py-1 rounded-full transition-all duration-200 {mgmtTab === 'expired' || mgmtTab === 'archived' ? 'bg-md-surface shadow-sm' : ''}"
      onclick={() => onTabChange('expired')}
    >
      <span class="text-xs font-bold {mgmtTab === 'expired' || mgmtTab === 'archived' ? 'text-md-on-surface' : 'text-md-on-surface/40'}">Inactive</span>
    </button>
  </div>
</div>

<!-- Search -->
<div class="px-4 pb-2">
  <div class="relative">
    <input
      type="text"
      placeholder="Search addresses or tags..."
      class="w-full bg-md-surface-container-low rounded-lg px-3 py-1.5 text-sm outline-none placeholder:text-md-on-surface/40"
      value={mgmtSearch}
      oninput={(e) => onSearchChange((e.target as HTMLInputElement).value)}
      aria-label="Search addresses"
    />
    {#if mgmtSearch}
      <button
        class="absolute right-3 top-1/2 -translate-y-1/2 text-md-on-surface/40 hover:text-md-on-surface/70"
        aria-label="Clear search"
        onclick={() => onSearchChange('')}
      >
        <IconX class="w-4 h-4" />
      </button>
    {/if}
  </div>
</div>

<!-- Select All + bulk actions -->
<div class="flex items-center gap-2 px-4 py-2 border-b border-md-secondary-container">
  <label class="flex items-center gap-2 cursor-pointer flex-1">
    <input
      type="checkbox"
      class="w-4 h-4 rounded"
      checked={allSelected}
      onchange={onToggleSelectAll}
    />
    <span class="text-sm font-medium">Select All</span>
    <span class="text-xs text-md-on-surface/50">{selectedAddresses.size} selected</span>
  </label>
  <!-- Bulk: Archive -->
  {#if mgmtTab === 'archived'}
    <button
      class="w-8 h-8 flex items-center justify-center rounded-lg border-0 bg-md-success/15 hover:bg-md-success/30 disabled:opacity-30 transition-colors"
      aria-label="Unarchive selected"
      disabled={selectedAddresses.size === 0}
      onclick={onUnarchiveSelected}
    >
      <IconArchive class="w-4 h-4 text-md-success" />
    </button>
  {:else}
    <button
      class="w-8 h-8 flex items-center justify-center rounded-lg border-0 bg-md-warning/15 hover:bg-md-warning/30 disabled:opacity-30 transition-colors"
      aria-label="Archive selected"
      disabled={selectedAddresses.size === 0}
      onclick={onArchiveSelected}
    >
      <IconArchive class="w-4 h-4 text-md-warning" />
    </button>
  {/if}
  <!-- Bulk: Delete -->
  <button
    class="w-8 h-8 flex items-center justify-center rounded-lg border-0 bg-md-error/15 hover:bg-md-error/30 disabled:opacity-30 transition-colors"
    aria-label="Delete selected"
    disabled={selectedAddresses.size === 0}
    onclick={onDeleteSelected}
  >
    <IconTrash class="w-4 h-4 text-md-error" />
  </button>
  <!-- Bulk: Export/Download -->
  <button
    class="w-8 h-8 flex items-center justify-center rounded-lg border-0 bg-md-primary/15 hover:bg-md-primary/30 disabled:opacity-30 transition-colors"
    aria-label="Export selected"
    disabled={selectedAddresses.size === 0}
    onclick={onExportSelected}
  >
    <IconDownload class="w-4 h-4 text-md-secondary" />
  </button>
</div>

<!-- Account cards list -->
<div class="flex-1 overflow-y-auto divide-y divide-md-secondary-container" style="scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--md-outline, #75777f) 0.2, transparent) transparent;">
  {#if loadingInboxes}
    <!-- Skeleton loader -->
    {#each Array(3) as _}
      <div class="flex items-start gap-3 px-4 py-3">
        <div class="skeleton h-5 w-5 shrink-0 rounded-lg"></div>
        <div class="flex-1 space-y-2">
          <div class="skeleton h-4 w-3/4"></div>
          <div class="skeleton h-3 w-1/2"></div>
          <div class="skeleton h-3 w-2/3"></div>
        </div>
        <div class="flex gap-1">
          <div class="skeleton h-8 w-8 rounded-lg"></div>
          <div class="skeleton h-8 w-8 rounded-lg"></div>
        </div>
      </div>
    {/each}
  {:else}
    {#each mgmtAccounts as account}
      <div class="flex items-start gap-3 px-4 py-3 hover:bg-md-secondary-container/50">
        <!-- Checkbox -->
        <input
          type="checkbox"
          class="w-4 h-4 mt-1 shrink-0 rounded"
          checked={selectedAddresses.has(account.id)}
          onchange={() => onToggleSelect(account.id)}
        />
        <!-- Info -->
        <button
          class="flex-1 min-w-0 text-left bg-transparent border-0 p-0"
          onclick={() => onOpenEmailDetail(account)}
        >
          <div class="font-bold text-sm truncate">{account.address}</div>
          <div class="text-xs text-md-secondary mt-0.5">Created: {account.created}, Last Used: {account.lastUsed}</div>
          <div class="text-xs text-md-secondary">Provider: {account.provider}</div>
          <div class="text-xs text-md-primary">Received Mails: {account.received}</div>
        </button>
        <!-- Row actions -->
        <div class="flex items-center gap-1 shrink-0 mt-1">
          {#if account.providerConfig?.expiry?.renewable}
            <button
              class="w-8 h-8 flex items-center justify-center rounded-lg border-0 bg-md-primary/15 hover:bg-md-primary/30 transition-colors"
              aria-label="Edit email address"
              onclick={() => onEditAccount(account)}
            >
              <IconEditSquare class="w-4 h-4 text-md-primary" />
            </button>
            <button
              class="w-8 h-8 flex items-center justify-center rounded-lg border-0 bg-md-success/15 hover:bg-md-success/30 transition-colors"
              aria-label="Extend email expiry"
              onclick={() => onExtendAccount(account)}
            >
              <IconRefresh class="w-4 h-4 text-md-success" />
            </button>
          {/if}
          {#if mgmtTab === 'archived' && canUnarchive(account)}
            <button
              class="w-8 h-8 flex items-center justify-center rounded-lg border-0 bg-md-success/15 hover:bg-md-success/30 transition-colors"
              aria-label="Unarchive {account.address}"
              onclick={() => onUnarchiveAccount(account)}
            >
              <IconArchive class="w-4 h-4 text-md-success" />
            </button>
          {:else if mgmtTab !== 'archived'}
            <button
              class="w-8 h-8 flex items-center justify-center rounded-lg border-0 bg-md-warning/15 hover:bg-md-warning/30 transition-colors"
              aria-label="Archive {account.address}"
              onclick={() => onArchiveAccount(account)}
            >
              <IconArchive class="w-4 h-4 text-md-warning" />
            </button>
          {/if}
          <button
            class="w-8 h-8 flex items-center justify-center rounded-lg border-0 bg-md-primary/15 hover:bg-md-primary/30 transition-colors"
            aria-label="Export {account.address}"
            onclick={() => onExportAccountEmails(account)}
          >
            <IconDownload class="w-4 h-4 text-md-secondary" />
          </button>
        </div>
      </div>
    {:else}
      <div class="px-4 py-8 text-center">
        <IconInbox class="w-12 h-12 text-md-on-surface/30 mx-auto mb-3" />
        <p class="text-sm text-md-on-surface/50 mb-3">No {mgmtTab} addresses found</p>
        {#if mgmtTab === 'active'}
          <button class="px-3 py-1.5 text-sm rounded-lg bg-md-primary text-md-on-primary hover:bg-md-primary/90 transition-colors" onclick={onGenerateNewAddress}>
            Generate New Address
          </button>
        {/if}
      </div>
    {/each}
  {/if}
</div>
