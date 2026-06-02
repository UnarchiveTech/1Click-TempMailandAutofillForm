<script lang="ts">
import { t } from 'svelte-i18n';
import Icon from '@/components/icons/Icon.svelte';
import DragHint from '@/components/ui/DragHint.svelte';
import FaviconImage from '@/components/ui/FaviconImage.svelte';
import { canUnarchive } from '@/features/inbox/inbox-management.js';
import type { Account, Email } from '@/utils/types.js';

const MAX_AVATARS = 4;

/**
 * Extract up to MAX_AVATARS unique senders for an account's emails,
 * preserving first-occurrence order. Returns the slice plus a remainder count.
 */
function getSenderAvatars(emails: Email[]): {
  senders: { email: string; letter: string }[];
  remainder: number;
} {
  const seen = new Set<string>();
  const senders: { email: string; letter: string }[] = [];
  for (const msg of emails) {
    if (!msg.from) continue;
    const lower = msg.from.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      const letter = (msg.from_name || msg.from || '?')[0].toUpperCase();
      senders.push({ email: msg.from, letter });
    }
    if (senders.length >= MAX_AVATARS + 1) break;
  }
  const overflow = Math.max(0, senders.length - MAX_AVATARS);
  return { senders: senders.slice(0, MAX_AVATARS), remainder: overflow };
}

let {
  context = 'popup',
  onBack = () => {},
  mgmtTab = 'active',
  mgmtSearch = '',
  selectedAddresses = new Set(),
  mgmtAccounts = [],
  allSelected = false,
  loadingInboxes = false,
  storedEmails = {} as Record<string, Email[]>,
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
  onReorderAccounts = (_fromIndex: number, _toIndex: number) => {},
} = $props<{
  context?: 'popup' | 'sidepanel' | 'app';
  onBack?: () => void;
  mgmtTab?: string;
  mgmtSearch?: string;
  selectedAddresses?: Set<string>;
  mgmtAccounts?: Account[];
  allSelected?: boolean;
  loadingInboxes?: boolean;
  storedEmails?: Record<string, Email[]>;
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
  onReorderAccounts?: (fromIndex: number, toIndex: number) => void;
}>();

let draggedAccountId = $state<string | null>(null);
let dropTargetAccountId = $state<string | null>(null);
let dragHintDismissed = $state(false);

function handleAccountDragHintDismiss(): void {
  dragHintDismissed = true;
}

function handleAccountDragStart(e: DragEvent, accountId: string) {
  draggedAccountId = accountId;
  dragHintDismissed = true;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', accountId);
  }
}

function handleAccountDragOver(e: DragEvent, accountId: string) {
  if (!draggedAccountId || draggedAccountId === accountId) return;
  e.preventDefault();
  dropTargetAccountId = accountId;
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move';
  }
}

function handleAccountDragLeave(accountId: string) {
  if (dropTargetAccountId === accountId) {
    dropTargetAccountId = null;
  }
}

function handleAccountDrop(e: DragEvent, targetId: string) {
  e.preventDefault();
  const sourceId = draggedAccountId;
  draggedAccountId = null;
  dropTargetAccountId = null;
  if (!sourceId || sourceId === targetId) return;
  const fromIndex = mgmtAccounts.findIndex((a: Account) => a.id === sourceId);
  const toIndex = mgmtAccounts.findIndex((a: Account) => a.id === targetId);
  if (fromIndex === -1 || toIndex === -1) return;
  onReorderAccounts(fromIndex, toIndex);
}

function handleAccountDragEnd() {
  draggedAccountId = null;
  dropTargetAccountId = null;
}
</script>


<!-- Tabs -->
<div class="flex gap-1 px-4 pt-3 pb-2">
  <div class="flex gap-1 p-1 rounded-full bg-md-surface-variant flex-1">
    <button
      class="flex-1 flex items-center justify-center gap-2 px-3 py-1 rounded-full transition-all duration-200 {mgmtTab === 'active' ? 'bg-md-surface shadow-sm' : ''}"
      onclick={() => onTabChange('active')}
    >
      <span class="text-xs font-bold {mgmtTab === 'active' ? 'text-md-on-surface' : 'text-md-on-surface/40'}">{$t('mailManagement.live')}</span>
    </button>
    <button
      class="flex-1 flex items-center justify-center gap-2 px-3 py-1 rounded-full transition-all duration-200 {mgmtTab === 'expired' || mgmtTab === 'archived' ? 'bg-md-surface shadow-sm' : ''}"
      onclick={() => onTabChange('expired')}
    >
      <span class="text-xs font-bold {mgmtTab === 'expired' || mgmtTab === 'archived' ? 'text-md-on-surface' : 'text-md-on-surface/40'}">{$t('mailManagement.inactive')}</span>
    </button>
  </div>
</div>

<!-- Search -->
<div class="px-4 pb-2">
  <div class="relative">
    <input
      type="text"
      placeholder={$t('mailManagement.searchAddressesOrTags')}
      class="w-full bg-md-surface-container-low rounded-lg px-3 py-1.5 text-sm outline-none placeholder:text-md-on-surface/40"
      value={mgmtSearch}
      oninput={(e) => onSearchChange((e.target as HTMLInputElement).value)}
      aria-label={$t('mailManagement.searchAddresses')}
    />
    {#if mgmtSearch}
      <button
        class="absolute right-3 top-1/2 -translate-y-1/2 text-md-on-surface/40 hover:text-md-on-surface/70"
        aria-label="Clear search"
        onclick={() => onSearchChange('')}
      >
        <Icon name="x" class="w-4 h-4" />
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
    <span class="text-sm font-medium">{$t('mailManagement.selectAll')}</span>
    <span class="text-xs text-md-on-surface/50">{$t('mailManagement.selectedCount', { default: 'mailManagement.selectedCountPlural', values: { n: selectedAddresses.size } })}</span>
  </label>
  <!-- Bulk: Archive -->
  {#if mgmtTab === 'archived'}
    <button
      class="w-8 h-8 flex items-center justify-center rounded-lg border-0 bg-md-success/15 hover:bg-md-success/30 disabled:opacity-30 transition-colors"
      aria-label={$t('mailManagement.unarchiveSelected')}
      disabled={selectedAddresses.size === 0}
      onclick={onUnarchiveSelected}
    >
      <Icon name="archive" class="w-4 h-4 text-md-success" />
    </button>
  {:else}
    <button
      class="w-8 h-8 flex items-center justify-center rounded-lg border-0 bg-md-warning/15 hover:bg-md-warning/30 disabled:opacity-30 transition-colors"
      aria-label={$t('mailManagement.archiveSelected')}
      disabled={selectedAddresses.size === 0}
      onclick={onArchiveSelected}
    >
      <Icon name="archive" class="w-4 h-4 text-md-warning" />
    </button>
  {/if}
  <!-- Bulk: Delete -->
  <button
    class="w-8 h-8 flex items-center justify-center rounded-lg border-0 bg-md-error/15 hover:bg-md-error/30 disabled:opacity-30 transition-colors"
    aria-label={$t('mailManagement.deleteSelected')}
    disabled={selectedAddresses.size === 0}
    onclick={onDeleteSelected}
  >
    <Icon name="trash" class="w-4 h-4 text-md-error" />
  </button>
  <!-- Bulk: Export/Download -->
  <button
    class="w-8 h-8 flex items-center justify-center rounded-lg border-0 bg-md-primary/15 hover:bg-md-primary/30 disabled:opacity-30 transition-colors"
    aria-label={$t('mailManagement.exportSelected')}
    disabled={selectedAddresses.size === 0}
    onclick={onExportSelected}
  >
    <Icon name="download" class="w-4 h-4 text-md-secondary" />
  </button>
</div>

<!-- Account cards list -->
<div class="flex-1 overflow-y-auto divide-y divide-md-secondary-container">
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
      {@const isDragging = draggedAccountId === account.id}
      {@const isDropTarget = dropTargetAccountId === account.id}
      {@const accountEmails = storedEmails[account.address] || []}
      {@const { senders, remainder } = getSenderAvatars(accountEmails)}
      <div
        class="relative flex items-start gap-3 px-4 py-3 hover:bg-md-secondary-container/50 transition-all {isDragging ? 'opacity-50' : ''} {isDropTarget ? 'ring-2 ring-md-primary rounded-xl' : ''}"
        draggable={true}
        role="listitem"
        ondragstart={(e) => handleAccountDragStart(e, account.id)}
        ondragover={(e) => handleAccountDragOver(e, account.id)}
        ondragleave={() => handleAccountDragLeave(account.id)}
        ondrop={(e) => handleAccountDrop(e, account.id)}
        ondragend={handleAccountDragEnd}
        aria-label={$t('mailManagement.dragToReorder', { values: { address: account.address } })}
      >
        {#if account === mgmtAccounts[0] && !dragHintDismissed}
          <DragHint
            hintKey="dragHintSeen_mailManagement"
            text={$t('mailManagement.dragHint')}
            visible={true}
            onDismiss={handleAccountDragHintDismiss}
          />
        {/if}

        <!-- Checkbox -->
        <input
          type="checkbox"
          class="w-4 h-4 mt-2 shrink-0 rounded"
          checked={selectedAddresses.has(account.id)}
          onchange={() => onToggleSelect(account.id)}
        />

        <!-- Info + sender avatar stack -->
        <button
          class="flex-1 min-w-0 text-left bg-transparent border-0 p-0"
          onclick={() => onOpenEmailDetail(account)}
        >
          <div class="font-bold text-sm truncate">{account.address}</div>

          {#if senders.length === 0}
            <!-- No emails received yet -->
            <p class="text-[10px] text-md-on-surface/35 italic mt-1 leading-tight">Not received any mail yet</p>
          {:else}
            <!-- Overlapping avatar stack (same favicon logic as EmailList) -->
            <div class="flex items-center mt-1.5">
              {#each senders as sender, i}
                <div
                  class="relative w-[22px] h-[22px] rounded-full ring-2 ring-md-surface overflow-hidden flex items-center justify-center bg-md-surface-container-low flex-shrink-0"
                  style="z-index: {MAX_AVATARS - i}; margin-left: {i === 0 ? '0' : '-6px'};"
                  title={sender.email}
                >
                  <FaviconImage
                    email={sender.email}
                    size={22}
                    class="absolute inset-0 w-full h-full object-cover"
                    fallbackLetter={sender.letter}
                    fallbackColor="bg-md-secondary"
                  />
                </div>
              {/each}
              {#if remainder > 0}
                <div
                  class="relative flex-shrink-0 w-[22px] h-[22px] rounded-full ring-2 ring-md-surface bg-md-surface-variant flex items-center justify-center"
                  style="z-index: 0; margin-left: -6px;"
                  title="+{remainder} more senders"
                >
                  <span class="text-[8px] font-bold text-md-on-surface/60 leading-none">+{remainder}</span>
                </div>
              {/if}
            </div>
          {/if}
        </button>

        <!-- Row actions -->
        <div class="flex items-center gap-1 shrink-0 mt-1">
          {#if account.providerConfig?.expiry?.renewable}
            <button
              class="w-8 h-8 flex items-center justify-center rounded-lg border-0 bg-md-primary/15 hover:bg-md-primary/30 transition-colors"
              aria-label={$t('mailManagement.editEmailAddress')}
              onclick={() => onEditAccount(account)}
            >
              <Icon name="editSquare" class="w-4 h-4 text-md-primary" />
            </button>
            <button
              class="w-8 h-8 flex items-center justify-center rounded-lg border-0 bg-md-success/15 hover:bg-md-success/30 transition-colors"
              aria-label={$t('mailManagement.extendEmailExpiry')}
              onclick={() => onExtendAccount(account)}
            >
              <Icon name="refresh" class="w-4 h-4 text-md-success" />
            </button>
          {/if}
          {#if mgmtTab === 'archived' && canUnarchive(account)}
            <button
              class="w-8 h-8 flex items-center justify-center rounded-lg border-0 bg-md-success/15 hover:bg-md-success/30 transition-colors"
              aria-label={$t('mailManagement.unarchiveAddress', { values: { address: account.address } })}
              onclick={() => onUnarchiveAccount(account)}
            >
              <Icon name="archive" class="w-4 h-4 text-md-success" />
            </button>
          {:else if mgmtTab !== 'archived'}
            <button
              class="w-8 h-8 flex items-center justify-center rounded-lg border-0 bg-md-warning/15 hover:bg-md-warning/30 transition-colors"
              aria-label={$t('mailManagement.archiveAddress', { values: { address: account.address } })}
              onclick={() => onArchiveAccount(account)}
            >
              <Icon name="archive" class="w-4 h-4 text-md-warning" />
            </button>
          {/if}
          <button
            class="w-8 h-8 flex items-center justify-center rounded-lg border-0 bg-md-primary/15 hover:bg-md-primary/30 transition-colors"
            aria-label={$t('mailManagement.exportAddress', { values: { address: account.address } })}
            onclick={() => onExportAccountEmails(account)}
          >
            <Icon name="download" class="w-4 h-4 text-md-secondary" />
          </button>
        </div>
      </div>
    {:else}
      <div class="px-4 py-8 text-center">
        <Icon name="inbox" class="w-12 h-12 text-md-on-surface/30 mx-auto mb-3" />
        <p class="text-sm text-md-on-surface/50 mb-3">{$t('mailManagement.noAddressesFound', { values: { tab: mgmtTab } })}</p>
        {#if mgmtTab === 'active'}
          <button class="px-3 py-1.5 text-sm rounded-lg bg-md-primary text-md-on-primary hover:bg-md-primary/90 transition-colors" onclick={onGenerateNewAddress}>
            {$t('mailManagement.generateNewAddress')}
          </button>
        {/if}
      </div>
    {/each}
  {/if}
</div>
