<script lang="ts">
import IconArchive from '@/components/icons/IconArchive.svelte';
import IconTrash from '@/components/icons/IconTrash.svelte';
import ExpiryPill from '@/components/ui/ExpiryPill.svelte';
import TagPill from '@/components/ui/TagPill.svelte';
import { loadProviderConfig } from '@/utils/email-service.js';
import { useCurrentTime } from '@/utils/time-store.js';
import type { Account } from '@/utils/types.js';

let {
  account,
  selectedEmail = '',
  isArchived = false,
  onSelectAccount = () => {},
  onToggleAutoExtend = () => {},
  onArchiveAccount = () => {},
  onUnarchiveAccount = () => {},
  onEditAccount = () => {},
  onRemoveAccount = () => {},
  onRestoreAccount = () => {},
  onTagAccount = () => {},
  isInAvailable = false,
  isInUnavailable = false,
  draggable = false,
  onDragStart = () => {},
  onDragEnd = () => {},
  onDrop = () => {},
  isDragging = false,
  isDropTarget = false,
} = $props<{
  account: Account;
  selectedEmail?: string;
  isArchived?: boolean;
  onSelectAccount?: (address: string) => void;
  onToggleAutoExtend?: (account: Account) => void;
  onArchiveAccount?: (account: Account) => void;
  onUnarchiveAccount?: (account: Account) => void;
  onEditAccount?: (account: Account) => void;
  onRemoveAccount?: (address: string) => void;
  onRestoreAccount?: (address: string) => void;
  onTagAccount?: (account: Account) => void;
  isInAvailable?: boolean;
  isInUnavailable?: boolean;
  draggable?: boolean;
  onDragStart?: (e: DragEvent, account: Account) => void;
  onDragEnd?: () => void;
  onDrop?: (e: DragEvent) => void;
  isDragging?: boolean;
  isDropTarget?: boolean;
}>();

// Use shared time store
const timeStore = useCurrentTime();
let currentTime = $state(timeStore.currentTime);

// Subscribe to time updates
$effect(() => {
  const unsubscribe = timeStore.subscribe(() => {
    currentTime = timeStore.currentTime;
  });
  return unsubscribe;
});

// Format time duration with hours if applicable
function formatTimeRemaining(minutes: number): string {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

const expiryTimeMinutes = $derived.by(() => {
  const expires = account.expiresAt || currentTime + 1000;
  const remainingMs = expires - currentTime;
  return Math.max(0, Math.ceil(remainingMs / (60 * 1000)));
});

// Get status tag for the account
const statusTag = $derived.by(() => {
  if (account.status === 'archived')
    return { label: 'Archived', color: 'bg-md-surface-variant/20 text-md-on-surface/60' };
  if (account.status === 'deleted')
    return { label: 'Deleted', color: 'bg-md-error/20 text-md-error' };
  if (account.status === 'expired')
    return { label: 'Expired', color: 'bg-md-error/20 text-md-error' };
  return null;
});

// Check if auto-renew is available for this account
const isAutoRenewAvailable = $derived.by(() => {
  const isExpired = currentTime >= (account.expiresAt || currentTime);
  const isAutoExtendDisabled = !account.autoExtend;

  try {
    const config = loadProviderConfig(account.provider);
    const supportsAutoRenew = config.expiry?.renewable || false;
    return isExpired && isAutoExtendDisabled && supportsAutoRenew;
  } catch {
    return false;
  }
});

// Check if provider supports auto-renew at all
const supportsAutoRenew = $derived.by(() => {
  try {
    const config = loadProviderConfig(account.provider);
    return config.expiry?.renewable || false;
  } catch {
    return false;
  }
});
</script>

<div 
  class="px-2 py-1.5 bg-md-surface-container-low rounded-xl group/item overflow-hidden {draggable ? 'cursor-move' : ''} {isDragging ? 'opacity-50' : ''} {isDropTarget ? 'border-2 border-md-primary' : ''}" 
  role="listitem"
  draggable={draggable}
  ondragstart={(e) => onDragStart(e, account)}
  ondragend={onDragEnd}
  ondragover={(e) => e.preventDefault()}
  ondrop={onDrop}
>
  <div class="flex gap-1 items-center">
    <!-- First column: email address, toggle, and tag -->
    <div class="flex flex-col gap-2 flex-1 min-w-0">
      <!-- Email address with status tag -->
      <div class="flex items-center gap-1">
        <button
          id="button-select-inbox-{account.id}"
          class="flex items-center text-left min-w-0 cursor-pointer bg-transparent border-0 p-0 overflow-hidden focus:outline-none focus:ring-2 focus:ring-md-primary/20 rounded"
          aria-label={`Select inbox ${account.address}`}
          onclick={() => onSelectAccount(account.address)}
        >
          <span class="font-semibold text-sm truncate {selectedEmail === account.address ? 'text-md-primary' : 'text-md-on-surface'}">
            {account.address}
          </span>
        </button>
        {#if statusTag}
          <span class="text-[9px] px-1.5 py-0.5 rounded-full {statusTag!.color} shrink-0">{statusTag!.label}</span>
        {/if}
      </div>

      <!-- Toggle button with time and tag pill -->
      <div class="flex items-center gap-1 flex-wrap w-fit shrink-0">
        <div class="flex items-center gap-1 rounded-full btn-primary border border-md-secondary-container/10">
          {#if supportsAutoRenew}
            <button
              id="button-toggle-auto-renew-{account.id}"
              class="inline-flex items-center justify-between h-5 w-[90px] rounded-full {account.autoExtend ? 'pl-2 pr-0' : 'pl-0 pr-2'} transition-colors duration-200 {account.autoExtend ? 'bg-md-primary' : 'bg-md-surface-variant/30'}"
              aria-label="Toggle auto-renew"
              onclick={(e) => { e.stopPropagation(); onToggleAutoExtend(account); }}
            >
              {#if account.autoExtend}
                <span class="text-[10px] font-semibold text-white flex-1 text-center">Auto-Renew</span>
                <span class="w-4.5 h-4.5 bg-white rounded-full shadow-sm shrink-0"></span>
              {:else}
                <span class="w-4.5 h-4.5 bg-white rounded-full shadow-sm shrink-0"></span>
                <span class="text-[10px] font-semibold text-white/80 flex-1 text-center">Expiry</span>
              {/if}
            </button>
          {/if}
          <span class="text-[10px] font-medium text-md-on-surface/60 whitespace-nowrap pr-1">
            {#if supportsAutoRenew}
              {#if expiryTimeMinutes >= 60}
                In {formatTimeRemaining(expiryTimeMinutes)}
              {:else}
                In {expiryTimeMinutes}m
              {/if}
            {:else}
              {#if expiryTimeMinutes >= 60}
                Expires in {formatTimeRemaining(expiryTimeMinutes)}
              {:else}
                Expires in {expiryTimeMinutes}m
              {/if}
            {/if}
          </span>
        </div>
        <TagPill
          tag={account.tag}
          tagColor={account.tagColor}
          onClick={() => onTagAccount(account)}
          showIcon={false}
        />
      </div>
    </div>


    <!-- Second column: Delete and Archive buttons -->
    <div class="flex flex-col gap-1 shrink-0">
      {#if account.status === 'deleted'}
        <button
          id="button-restore-{account.id}"
          class="text-[10px] px-2 py-1 rounded-full btn-error flex items-center justify-center gap-1"
          aria-label="Restore inbox {account.address}"
          onclick={(e) => { e.stopPropagation(); onRestoreAccount(account.address); }}
        >
          <IconArchive class="w-3 h-3" />
          <span>Restore</span>
        </button>
      {:else}
        <button
          id="button-delete-{account.id}"
          class="text-[10px] px-2 py-1 rounded-full btn-tertiary flex items-center justify-center gap-1"
          aria-label="Delete inbox {account.address}"
          onclick={(e) => { e.stopPropagation(); onRemoveAccount(account.address); }}
        >
          <IconTrash class="w-3 h-3" />
          <span>Delete</span>
        </button>
      {/if}
      {#if account.status === 'archived'}
        <button
          id="button-unarchive-{account.id}"
          class="text-[10px] px-2 py-1 rounded-full btn-error flex items-center justify-center gap-1"
          aria-label="Unarchive inbox {account.address}"
          onclick={(e) => { e.stopPropagation(); onUnarchiveAccount(account); }}
        >
          <IconArchive class="w-3 h-3" />
          <span>Unarchive</span>
        </button>
      {:else}
        <button
          id="button-archive-{account.id}"
          class="text-[10px] px-2 py-1 rounded-full btn-error flex items-center justify-center gap-1"
          aria-label="Archive inbox {account.address}"
          onclick={(e) => { e.stopPropagation(); onArchiveAccount(account); }}
        >
          <IconArchive class="w-3 h-3" />
          <span>Archive</span>
        </button>
      {/if}
    </div>
  </div>
</div>
