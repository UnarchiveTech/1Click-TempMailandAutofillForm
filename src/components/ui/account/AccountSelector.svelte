<script lang="ts">
import { onDestroy } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import Icon from '@/components/icons/Icon.svelte';
import TagDialog from '@/components/overlays/TagDialog.svelte';
import FaviconImage from '@/components/ui/FaviconImage.svelte';
import { updateInboxTag } from '@/features/account/tag-actions.js';
import {
  DEFAULT_PROVIDER,
  loadAllProviderConfigs,
  loadProviderConfig,
  type ProviderConfig,
} from '@/utils/email-service.js';
import { logError } from '@/utils/logger.js';
import { domainIndexKey, getInboxes } from '@/utils/storage-keys.js';
import { useCurrentTime } from '@/utils/time-store.js';
import type { Account } from '@/utils/types.js';
import AccountCard from './AccountCard.svelte';

let {
  selectedEmail = '',
  accounts = [],
  allAccounts = [],
  displayedEmail = $bindable(''),
  onSelectAccount = () => {},
  onEditAccount = () => {},
  onCreateInbox = () => {},
  onNavigateToManage = () => {},
  onReloadAccounts = async () => {},
  onNavigateToSettings = () => {},
  onCreateInboxWithProvider = () => {},
  onToggleAutoExtend = () => {},
  onArchiveAccount = () => {},
  onUnarchiveAccount = () => {},
  onRemoveAccount = () => {},
  onRestoreAccount = () => {},
  onTagAccount = () => {},
  dropdownOpen = false,
  onDropdownOpenChange = () => {},
  showToast = () => {},
  selectedProviderInstance = null,
  defaultDomain = '',
} = $props<{
  selectedEmail?: string;
  accounts?: Account[];
  allAccounts?: Account[];
  displayedEmail?: string;
  onSelectAccount?: (address: string) => void;
  onEditAccount?: (account: Account) => void;
  onCreateInbox?: (provider?: string, instanceId?: string) => void;
  onNavigateToManage?: () => void;
  onReloadAccounts?: () => Promise<void>;
  onNavigateToSettings?: () => void;
  onCreateInboxWithProvider?: (providerId: string, instanceId?: string) => void;
  onToggleAutoExtend?: (account: Account) => void;
  onArchiveAccount?: (account: Account) => void;
  onUnarchiveAccount?: (account: Account) => void;
  onRemoveAccount?: (address: string) => void;
  onRestoreAccount?: (address: string) => void;
  onTagAccount?: (account: Account) => void;
  dropdownOpen?: boolean;
  onDropdownOpenChange?: (open: boolean) => void;
  showToast?: (message: string) => void;
  selectedProviderInstance?: string | null;
  defaultDomain?: string;
}>();

let openSection = $state<'live' | 'inactive'>('live');
let prevLiveCount = -1;
let prevInactiveCount = -1;

$effect(() => {
  const liveCount = accountsByCategory.live.length;
  const inactiveCount = accountsByCategory.available.length + accountsByCategory.unavailable.length;
  if (prevLiveCount !== -1) {
    if (liveCount < prevLiveCount && inactiveCount > prevInactiveCount) {
      openSection = 'inactive';
    } else if (inactiveCount < prevInactiveCount && liveCount > prevLiveCount) {
      openSection = 'live';
    }
  }
  prevLiveCount = liveCount;
  prevInactiveCount = inactiveCount;
});
let inactiveTab = $state<'available' | 'unavailable'>('available');
let availableCollapsed = $state(false);
let unavailableCollapsed = $state(false);
let selectedTagFilter = $state<string | null>(null);
let dropdownSearch = $state('');
let tagDialogOpen = $state(false);
let tagTargetAccount = $state<Account | null>(null);
let draggedAccount = $state<Account | null>(null);
let draggedFromSection = $state<'live' | 'inactive' | null>(null);
let dropTargetAccount = $state<Account | null>(null);
let localAccountOrder = $state<Account[] | null>(null);
let domainMenuOpen = $state(false);
let domainMenuPosition = $state({ x: 0, y: 0 });
let currentDomainIndex = $state(0);
let searchInputRef = $state<HTMLInputElement | null>(null);

// Derived values for email display
let emailParts = $derived.by(() => displayedEmail.split('@'));
let username = $derived.by(() => emailParts[0] || '');
let domain = $derived.by(() => emailParts[1] || '');
let isMultiDomain = $derived.by(() => {
  const account = allAccounts.find((a: Account) => a.address === selectedEmail);
  if (!account) return false;
  return loadProviderConfig(account.provider).multiDomain?.enabled ?? false;
});

// Storage key for domain index per inbox
function getDomainStorageKey(email: string, providerId: string): `domainIndex_${string}_${string}` {
  return domainIndexKey(providerId, email.split('@')[0]);
}

// Load persisted domain index when selected email changes
$effect(() => {
  if (!selectedEmail) return;
  const account = allAccounts.find((a: Account) => a.address === selectedEmail);
  if (!account) {
    currentDomainIndex = 0;
    displayedEmail = selectedEmail;
    return;
  }
  const providerConfig = loadProviderConfig(account.provider);
  if (!providerConfig.multiDomain?.enabled) {
    currentDomainIndex = 0;
    displayedEmail = selectedEmail;
    return;
  }
  const key = getDomainStorageKey(selectedEmail, account.provider);
  browser.storage.local.get([key]).then((result: Record<string, unknown>) => {
    const storedIndex = result[key] as number | undefined;
    if (storedIndex !== undefined) {
      currentDomainIndex = storedIndex;
    } else if (defaultDomain) {
      const domains = providerConfig.multiDomain?.domains || [];
      const defaultIndex = domains.indexOf(defaultDomain);
      currentDomainIndex = defaultIndex >= 0 ? defaultIndex : 0;
    } else {
      currentDomainIndex = 0;
    }
  });
});

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

// Wrap callbacks to clear cache before actions
const wrappedOnArchiveAccount = (account: Account) => {
  localAccountOrder = null;
  onArchiveAccount(account);
};

const wrappedOnUnarchiveAccount = (account: Account) => {
  localAccountOrder = null;
  onUnarchiveAccount(account);
};

const wrappedOnRemoveAccount = (address: string) => {
  localAccountOrder = null;
  onRemoveAccount(address);
};

const wrappedOnRestoreAccount = (address: string) => {
  localAccountOrder = null;
  onRestoreAccount(address);
};

// Calculate remaining time for current account
const remainingMinutes = $derived.by(() => {
  if (!currentAccount?.expiresAt) return 0;
  const remainingMs = currentAccount.expiresAt - currentTime;
  return Math.max(0, Math.ceil(remainingMs / (1000 * 60)));
});

// Calculate how long ago the account expired (in minutes)
const expiredAgoMinutes = $derived.by(() => {
  if (!currentAccount?.expiresAt) return 0;
  const elapsedMs = currentTime - currentAccount.expiresAt;
  return Math.max(0, Math.floor(elapsedMs / (1000 * 60)));
});

// Format expired-ago duration
function formatTimeAgo(minutes: number): string {
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}hr ${mins}m ago` : `${hours}hr ago`;
}

// Calculate progress percentage for expiry (0-100)
const progressPercentage = $derived.by(() => {
  if (!currentAccount?.expiresAt || remainingMinutes === 0) return 0;
  const maxExpiryTime = 60; // Default 60 minutes for full progress
  return Math.min(Math.max((remainingMinutes / maxExpiryTime) * 100, 0), 100);
});

// Build conic gradient for progress bar
let labelEl = $state<HTMLElement | null>(null);
let containerEl = $state<HTMLElement | null>(null);
let labelWidth = $state(0);
let containerWidth = $state(0);
let containerHeight = $state(0);

const borderGradient = $derived.by(() => {
  if (currentAccount?.status === 'expired' || currentAccount?.status === 'deleted') {
    return 'none';
  }

  // Compute gap angle dynamically based on where the label ends.
  // Label is at left:30px, so its right edge is at (30 + labelWidth) px from the left.
  // We compute the angle from the container center to that point.
  const labelRightPx = 30 + labelWidth + 4; // 4px breathing room
  const cx = containerWidth / 2;
  const cy = containerHeight / 2;
  const dx = labelRightPx - cx;
  const dy = 0 - cy; // top edge of container
  // Angle from 12 o'clock clockwise in degrees
  const gapAngleDeg = Math.atan2(dx, -dy) * (180 / Math.PI);
  // Clamp between 5° and 90° to avoid degenerate cases
  const clampedGap = Math.max(5, Math.min(90, gapAngleDeg));
  const gapPercentage = (clampedGap / 360) * 100;
  const availablePercentage = 100 - gapPercentage;
  const scaledProgress = (progressPercentage / 100) * availablePercentage;

  return `conic-gradient(
    from ${clampedGap}deg,
    var(--md-primary) 0% ${scaledProgress}%,
    var(--md-secondary-container) ${scaledProgress}% ${availablePercentage}%,
    var(--md-secondary-container) ${availablePercentage}% 100%
  )`;
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

function closeDropdown() {
  dropdownSearch = '';
  onDropdownOpenChange(false);
  // Return focus to trigger element
  if (triggerElement) {
    triggerElement.focus();
    triggerElement = null;
  }
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeDropdown();
  // Focus trap: prevent Tab from leaving the dialog
  if (e.key === 'Tab') {
    const focusableElements = document.querySelectorAll(
      '#account-selector-dialog button, #account-selector-dialog input, #account-selector-dialog [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0] as HTMLElement;
    const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

    if (e.shiftKey) {
      // Shift+Tab: if on first element, move to last
      if (document.activeElement === firstElement) {
        e.preventDefault();
        lastElement?.focus();
      }
    } else {
      // Tab: if on last element, move to first
      if (document.activeElement === lastElement) {
        e.preventDefault();
        firstElement?.focus();
      }
    }
  }
}

// Auto-focus search input when dialog opens
$effect(() => {
  if (dropdownOpen) {
    // Small delay to ensure DOM is updated
    setTimeout(() => {
      searchInputRef?.focus();
    }, 50);
  }
});

// Load providers dynamically
let allProviders = $derived.by((): ProviderConfig[] => {
  try {
    return Object.values(loadAllProviderConfigs());
  } catch {
    return [];
  }
});

function toggleSection(section: 'live' | 'inactive') {
  openSection = section;
}

// Filter accounts by search (address or tag)
let filteredAccounts = $derived.by(() => {
  // Only use localAccountOrder during active drag (draggedAccount !== null), otherwise always use fresh allAccounts
  const source =
    draggedAccount !== null && localAccountOrder !== null ? localAccountOrder : allAccounts;
  if (!dropdownSearch) return source;
  const search = dropdownSearch.toLowerCase();
  return source.filter(
    (a: Account) =>
      a.address.toLowerCase().includes(search) || a.tag?.toLowerCase().includes(search)
  );
});

// Filter accounts by tag
let tagFilteredAccounts = $derived.by(() => {
  if (!selectedTagFilter) return filteredAccounts;
  return filteredAccounts.filter((a: Account) => {
    if (selectedTagFilter === 'archived') return a.status === 'archived';
    if (selectedTagFilter === 'deleted') return a.status === 'deleted';
    if (selectedTagFilter === 'expired') return a.status === 'expired';
    return false;
  });
});

// Copy email address to clipboard
async function copyEmailToClipboard() {
  try {
    await navigator.clipboard.writeText(selectedEmail);
  } catch (err) {
    logError('Failed to copy email', err);
  }
}

let clickTimeout: ReturnType<typeof setTimeout> | null = null;
onDestroy(() => {
  if (clickTimeout) clearTimeout(clickTimeout);
});
let triggerElement: HTMLElement | null = null;

function handleSingleClick() {
  if (clickTimeout) {
    clearTimeout(clickTimeout);
    clickTimeout = null;
  }
  clickTimeout = setTimeout(() => {
    // Save trigger element for focus return
    triggerElement = document.activeElement as HTMLElement;
    onDropdownOpenChange(!dropdownOpen);
    clickTimeout = null;
  }, 250);
}

function handleDoubleClick() {
  if (clickTimeout) {
    clearTimeout(clickTimeout);
    clickTimeout = null;
  }
  copyEmailToClipboard();
  showToast($t('toasts.emailAddressCopied'));
}

function openAccountMenu(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  triggerElement = e.currentTarget as HTMLElement;
  domainMenuOpen = false;
  onDropdownOpenChange(true);
}

function openDomainMenu(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  // Position menu to the left of the click point to avoid cutoff on right side
  domainMenuPosition = { x: e.clientX - 160, y: e.clientY + 20 };
  domainMenuOpen = true;
}

// Helper to check if account can be recoverable
function isRecoverable(account: Account): boolean {
  const currentTime = Date.now();
  const expiresAt = account.expiresAt || currentTime;
  const isExpired = currentTime >= expiresAt;

  // Not expired = recoverable
  if (!isExpired) return true;
  // Expired but has auto-renew = recoverable
  if (account.autoExtend) return true;
  // Expired, no auto-renew, but provider supports auto-renew = recoverable (so user can enable it)
  try {
    const config = loadProviderConfig(account.provider);
    if (config.expiry?.renewable) return true;
  } catch {
    // If config fails to load, treat as not recoverable
  }
  // Otherwise unrecoverable
  return false;
}

// Group accounts by new categorization (Live, Available, Unavailable)
let accountsByCategory = $derived.by(() => {
  const live: Account[] = [];
  const available: Account[] = [];
  const unavailable: Account[] = [];

  tagFilteredAccounts.forEach((a: Account) => {
    const currentTime = Date.now();
    const expiresAt = a.expiresAt || currentTime;
    const isExpired = currentTime >= expiresAt;

    // Live: status is 'active' and not expired
    if (a.status === 'active' && !isExpired) {
      live.push(a);
    } else {
      // Inactive: everything else (archived, deleted, expired, or no status)
      if (isRecoverable(a)) {
        available.push(a);
      } else {
        unavailable.push(a);
      }
    }
  });

  // Don't sort - preserve storage order for drag-and-drop reordering
  // live.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  // available.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  // unavailable.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  return { live, available, unavailable };
});

// Reactive derived value for current account
let currentAccount = $derived.by(() => {
  if (!selectedEmail) return null;
  return allAccounts.find((a: Account) => a.address === selectedEmail) || null;
});

// Accounts of same status as current account for prev/next navigation
let currentStatusAccounts = $derived.by(() => {
  if (!selectedEmail) return [];
  const current = allAccounts.find((a: Account) => a.address === selectedEmail);
  if (!current) return [];
  return allAccounts.filter((a: Account) => a.status === current.status);
});

let currentIndexInStatus = $derived.by(() => {
  if (!selectedEmail) return -1;
  return currentStatusAccounts.findIndex((a: Account) => a.address === selectedEmail);
});

function goToPrev() {
  if (currentIndexInStatus > 0) {
    onSelectAccount(currentStatusAccounts[currentIndexInStatus - 1].address);
  }
}

function goToNext() {
  if (currentIndexInStatus < currentStatusAccounts.length - 1) {
    onSelectAccount(currentStatusAccounts[currentIndexInStatus + 1].address);
  }
}

async function updateTag(accountId: string, tag: string, color?: string) {
  await updateInboxTag(accountId, tag, browser, { onReloadAccounts }, color);
}

function openTagDialog() {
  if (!currentAccount) return;
  tagTargetAccount = currentAccount;
  tagDialogOpen = true;
}

function openTagDialogForAccount(account: Account) {
  tagTargetAccount = account;
  tagDialogOpen = true;
}

function closeTagDialog() {
  tagDialogOpen = false;
  tagTargetAccount = null;
}

function saveTag(tag: string, color: string) {
  if (!tagTargetAccount) return;
  updateTag(tagTargetAccount.id, tag, color);
  closeTagDialog();
}

// Drag and drop handlers
function handleDragStart(e: DragEvent, account: Account) {
  draggedAccount = account;
  draggedFromSection = openSection;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', account.id);
  }
}

// Cycle through provider domains and persist selection
async function cycleDomain() {
  if (!currentAccount) return;
  const providerConfig = loadProviderConfig(currentAccount.provider);
  if (!providerConfig.multiDomain?.enabled) return;
  const domains = providerConfig.multiDomain.domains;
  const nextIndex = (currentDomainIndex + 1) % domains.length;
  currentDomainIndex = nextIndex;
  const key = getDomainStorageKey(selectedEmail, currentAccount.provider);
  await browser.storage.local.set({ [key]: nextIndex });
}

// Keep displayedEmail in sync with currentDomainIndex
$effect(() => {
  if (!currentAccount) {
    displayedEmail = selectedEmail;
    return;
  }
  const providerConfig = loadProviderConfig(currentAccount.provider);
  if (!providerConfig.multiDomain?.enabled) {
    displayedEmail = selectedEmail;
    return;
  }
  const username = selectedEmail.split('@')[0];
  const domains = providerConfig.multiDomain.domains;
  displayedEmail = `${username}@${domains[currentDomainIndex]}`;
});

function handleDragEnd() {
  draggedAccount = null;
  draggedFromSection = null;
  dropTargetAccount = null;
}

function handleDragOver(e: DragEvent, targetAccount: Account) {
  e.preventDefault();
  dropTargetAccount = targetAccount;
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move';
  }
}

async function handleDrop(e: DragEvent, targetAccount: Account, section: 'live' | 'inactive') {
  e.preventDefault();
  dropTargetAccount = null;
  if (!draggedAccount || draggedAccount.id === targetAccount.id) return;

  // Only allow reordering within the same section
  if (draggedFromSection !== section) return;

  const sourceDragged = draggedAccount;
  handleDragEnd();

  try {
    const inboxes = await getInboxes();
    const inboxIndex = inboxes.findIndex((i: Account) => i.id === sourceDragged.id);
    const targetIndex = inboxes.findIndex((i: Account) => i.id === targetAccount.id);

    if (inboxIndex === -1 || targetIndex === -1) {
      logError('Drag-drop: could not find account IDs in storage', {
        sourceId: sourceDragged.id,
        targetId: targetAccount.id,
        allIds: inboxes.map((i) => i.id),
      });
      return;
    }

    // Remove dragged account and insert at new position
    const [movedAccount] = inboxes.splice(inboxIndex, 1);
    inboxes.splice(targetIndex, 0, movedAccount);

    // Optimistically reorder local display immediately
    const currentSource = localAccountOrder ?? allAccounts;
    const reordered = [...currentSource];
    const localDragIdx = reordered.findIndex((a: Account) => a.id === sourceDragged.id);
    const localTargetIdx = reordered.findIndex((a: Account) => a.id === targetAccount.id);
    if (localDragIdx !== -1 && localTargetIdx !== -1) {
      const [moved] = reordered.splice(localDragIdx, 1);
      reordered.splice(localTargetIdx, 0, moved);
      localAccountOrder = reordered;
    }

    await browser.storage.local.set({ inboxes });
    await onReloadAccounts();
    // Clear local override after parent state is updated
    localAccountOrder = null;
  } catch (error) {
    logError('Failed to reorder accounts', error);
    localAccountOrder = null;
  }
}
</script>


  <!-- Custom dropdown trigger -->
  <div class="relative mt-0 flex items-center gap-2">
    <!-- Floating status label above border -->
    {#if currentAccount}
      <div class="absolute -top-[8.5px] left-[30px] z-10">
        <span
          bind:this={labelEl}
          bind:clientWidth={labelWidth}
          class="px-0 text-[11px] font-semibold leading-none {currentAccount?.status === 'active' ? 'text-md-success' : (currentAccount?.status === 'expired' || currentAccount?.status === 'deleted') ? 'text-md-error' : 'text-md-on-surface/50'} {(currentAccount?.status === 'expired' || currentAccount?.status === 'deleted') ? 'bg-md-error/10' : 'bg-md-background'}"
        >
          {#if currentAccount.status === 'active'}
            {#if currentAccount.expiresAt}
              Live - {currentAccount.autoExtend ? `Auto-Renew in ${formatTimeRemaining(remainingMinutes)}` : `Expires in ${formatTimeRemaining(remainingMinutes)}`}
            {:else}
              Live
            {/if}
          {:else if currentAccount.status === 'expired'}
            Expired {formatTimeAgo(expiredAgoMinutes)}
          {:else if currentAccount.status === 'deleted'}
            Deleted
          {:else}
            Archived
          {/if}
        </span>
      </div>
    {/if}
    <div class="account-selector-outer flex-1 min-w-0" style="--border-gradient: {borderGradient};" bind:this={containerEl} bind:clientWidth={containerWidth} bind:clientHeight={containerHeight}>
      <div
        class="flex items-center gap-0 px-1 py-1.5 rounded-full border {currentAccount?.status === 'active' ? 'border-md-secondary-container/30' : (currentAccount?.status === 'expired' || currentAccount?.status === 'deleted') ? 'border-md-error/30' : 'border-md-outline-variant'} {(currentAccount?.status === 'expired' || currentAccount?.status === 'deleted') ? 'bg-md-error/10' : 'bg-md-surface-container-low'} flex-1 min-w-0 overflow-hidden"
        onclick={handleSingleClick}
        ondblclick={handleDoubleClick}
        onkeydown={(e) => { if (e.key === 'Enter') handleSingleClick(); }}
        role="button"
        tabindex="0"
        aria-label="Copy email address"
      >
      <!-- Prev button -->
      <button
        id="button-prev-address"
        class="shrink-0 w-5 h-5 flex items-center justify-center rounded text-md-primary hover:text-md-primary/80 transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
        onclick={(e) => { e.stopPropagation(); goToPrev(); }}
        disabled={currentIndexInStatus <= 0}
        aria-label="Previous address"
        title={currentIndexInStatus > 0 ? currentStatusAccounts[currentIndexInStatus - 1].address : undefined}
      >
        <Icon name="chevronLeft" class="w-3.5 h-3.5" />
      </button>

      <!-- Email text area: username (truncates) + domain container (shrinks, never overlaps) -->
      <div
        class="flex items-center min-w-0 flex-1 gap-0.5 cursor-pointer overflow-hidden"
        onclick={handleSingleClick}
        ondblclick={handleDoubleClick}
        onkeydown={(e) => { if (e.key === 'Enter') handleSingleClick(); }}
        role="button"
        tabindex="0"
        id="button-select-email"
        aria-label="Select email address"
        title={isMultiDomain && currentAccount ? `Same username works across ${loadProviderConfig(currentAccount.provider).multiDomain?.domains?.length || 0} domains: ${loadProviderConfig(currentAccount.provider).multiDomain?.domains?.slice(0, 3).join(', ') || ''}${(loadProviderConfig(currentAccount.provider).multiDomain?.domains?.length || 0) > 3 ? ', ...' : ''}` : selectedEmail}
      >
        <span class="font-medium text-sm text-md-on-surface truncate min-w-0">{username}</span>
        {#if isMultiDomain}
          <span
            class="inline-flex items-center gap-1 pr-1 py-0.5 text-xs font-medium rounded-md bg-md-secondary-container text-md-on-secondary-container hover:bg-md-secondary-container/80 transition-colors cursor-pointer overflow-hidden min-w-[calc(5ch+1.5rem)]"
            onclick={(e) => { e.stopPropagation(); cycleDomain(); }}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); cycleDomain(); } }}
            role="button"
            tabindex="0"
            aria-label="Cycle through domains"
          >
            <span class="truncate flex-1 min-w-0">@{domain}</span>
            <Icon name="globe" class="w-3 h-3 shrink-0" />
          </span>
        {:else}
          <span class="font-medium text-sm text-md-on-surface shrink-0">@{domain}</span>
        {/if}
      </div>

      <!-- +N badge -->
      {#if accounts.length > 1}
        <span class="text-xs font-semibold text-md-primary bg-md-primary/15 px-1.5 py-0.5 rounded-full shrink-0">+{accounts.length - 1}</span>
      {/if}

      <!-- Next button -->
      <button
        id="button-next-address"
        class="shrink-0 w-5 h-5 flex items-center justify-center rounded text-md-primary hover:text-md-primary/80 transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
        onclick={(e) => { e.stopPropagation(); goToNext(); }}
        disabled={currentIndexInStatus >= currentStatusAccounts.length - 1}
        aria-label="Next address"
        title={currentIndexInStatus < currentStatusAccounts.length - 1 ? currentStatusAccounts[currentIndexInStatus + 1].address : undefined}
      >
        <Icon name="chevronRight" class="w-3.5 h-3.5" />
      </button>

      <!-- Separator -->
      <span class="w-px h-4 bg-md-secondary-container/20 shrink-0"></span>

      <!-- Dropdown chevron -->
      <button
        id="button-open-dropdown"
        class="shrink-0 p-0.5 text-md-primary hover:text-md-primary/80 transition-colors"
        onclick={(e) => { e.stopPropagation(); onDropdownOpenChange(!dropdownOpen); }}
        oncontextmenu={openAccountMenu}
        aria-label="Open account list"
      >
        <Icon name="chevronDown" class="w-4 h-4" />
      </button>
    </div>
    </div>
    <!-- Plus button - outside pill -->
    <button
      id="button-generate-address"
      class="btn-primary w-8 h-8 flex items-center justify-center rounded-lg border-0 shrink-0"
      aria-label="Generate new address"
      oncontextmenu={openDomainMenu}
      onclick={async () => {
        const { selectedProvider } = await browser.storage.local.get(['selectedProvider']) as { selectedProvider?: string };
        const provider = selectedProvider || DEFAULT_PROVIDER;
        // Use the passed selectedProviderInstance prop instead of reading from storage
        if (selectedProviderInstance && selectedProviderInstance !== 'random') {
          onCreateInbox(provider, selectedProviderInstance);
        } else {
          onCreateInbox(provider);
        }
      }}
    >
      <Icon name="plus" class="w-5 h-5 text-md-primary-content" />
    </button>

    <!-- Domain context menu -->
    {#if domainMenuOpen}
      <button id="button-close-domain-menu" class="fixed inset-0 z-40 bg-transparent cursor-default" aria-label="Close menu" onclick={() => domainMenuOpen = false}></button>
      <div
        class="fixed z-50 bg-md-surface rounded-xl shadow-2xl border border-md-outline-variant py-2 w-45 max-h-96 overflow-y-auto"
        style="left: {domainMenuPosition.x}px; top: {domainMenuPosition.y}px;"
      >
        {#each allProviders as provider}
          {@const providerDomain = provider.websiteUrl ? new URL(provider.websiteUrl).hostname : provider.id + '.com'}
          <button id="button-provider-{provider.id}" class="w-full px-4 py-2 text-left hover:bg-md-surface-variant text-sm flex items-center gap-2" onclick={() => { onCreateInboxWithProvider(provider.id); domainMenuOpen = false; }} aria-label="Create inbox with {provider.displayName}">
            <FaviconImage domain={providerDomain} size={16} class="w-4 h-4" fallbackLetter={provider.displayName.charAt(0).toUpperCase()} fallbackColor="bg-md-secondary" />
            {provider.displayName}
          </button>
          {#if provider.multiInstance?.enabled && provider.multiInstance.instances}
            {#each provider.multiInstance.instances as instance}
              <button id="button-instance-{provider.id}-{instance.id}" class="w-full px-4 py-2 text-left hover:bg-md-surface-variant text-sm flex items-center gap-2 pl-8" onclick={() => { onCreateInboxWithProvider(provider.id, instance.id); domainMenuOpen = false; }} aria-label="Create inbox with {provider.displayName} instance {instance.displayName || instance.name}">
                <FaviconImage domain={providerDomain} size={16} class="w-4 h-4" fallbackLetter={provider.displayName.charAt(0).toUpperCase()} fallbackColor="bg-md-secondary" />
                {instance.displayName || instance.name}
              </button>
            {/each}
          {/if}
          {#if provider !== allProviders[allProviders.length - 1]}
            <div class="border-t border-md-outline-variant my-1"></div>
          {/if}
        {/each}
        <div class="border-t border-md-outline-variant my-1"></div>
        <button 
          id="button-manage-instances"
          class="w-full px-4 py-2 text-left hover:bg-md-surface-variant text-sm flex items-center gap-2 text-md-on-surface" 
          onclick={() => { 
            domainMenuOpen = false; 
            onNavigateToSettings();
          }}
        >
          <Icon name="instances" class="w-4 h-4" />
          Manage Instances
        </button>
        <button
          id="button-add-custom-instance"
          class="btn-primary w-full px-4 py-2 rounded text-xd flex items-center justify-center gap-2"
          onclick={() => {
            domainMenuOpen = false;
            onNavigateToSettings();
          }}
        >
          <Icon name="plus" class="w-4 h-4" />
          Add Custom Instance...
        </button>
      </div>
    {/if}

    {#if dropdownOpen}
      <!-- Backdrop to close -->
      <button
        id="button-close-dropdown-backdrop"
        class="fixed inset-0 z-10 cursor-default bg-transparent border-0"
        aria-label="Close dropdown"
        onclick={closeDropdown}
      ></button>

      <!-- Dropdown panel -->
      <div class="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
        <!-- Blurred backdrop -->
        <div class="absolute inset-0 bg-md-surface/30 backdrop-blur-sm" role="button" tabindex="-1" onclick={closeDropdown} onkeydown={handleKeyDown}></div>

        <!-- Dialog wrapper: close button above, card below -->
        <div class="relative z-10 flex flex-col items-end gap-2 w-[325px] h-[550px]">
          <!-- Close button above dialog (outside card) -->
          <button
            id="button-close-dialog"
            class="w-9 h-9 rounded-full bg-md-surface hover:bg-md-surface-variant flex items-center justify-center shadow-md transition-colors flex-shrink-0"
            aria-label="Close dialog"
            onclick={closeDropdown}
          >
            <Icon name="x" class="w-4 h-4 text-md-on-surface/70" />
          </button>

          <!-- Dialog card (separate from close button) -->
          <div id="account-selector-dialog" class="bg-md-surface rounded-xl shadow-2xl p-3 flex flex-col gap-2 w-full flex-1 overflow-hidden">
          <!-- Search bar -->
          <div class="relative">
            <input
              type="text"
              id="account-selector-search"
              placeholder="Search addresses or tags..."
              class="w-full bg-md-surface-container-low rounded-lg px-3 py-1.5 text-sm outline-none placeholder:text-md-on-surface/40"
              bind:value={dropdownSearch}
              aria-label="Search addresses"
            />
            {#if dropdownSearch}
              <button
                id="button-clear-search"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-md-on-surface/40 hover:text-md-on-surface/70"
                aria-label="Clear search"
                onclick={() => dropdownSearch = ''}
              >
                <Icon name="x" class="w-4 h-4" />
              </button>
            {/if}
          </div>

          <div class="space-y-1 flex-1">
            <!-- Live/Inactive tabs -->
            <div class="flex gap-1 p-1 rounded-full bg-md-surface-variant">
              <button
                id="button-tab-live"
                class="flex-none w-[100px] flex items-center justify-center gap-2 px-3 py-1 rounded-full transition-all duration-200 {openSection === 'live' ? 'bg-md-surface shadow-sm' : ''}"
                onclick={() => toggleSection('live')}
              >
                <div class="flex flex-col items-start">
                  <span class="text-[12px] font-bold {openSection === 'live' ? 'text-md-on-surface' : 'text-md-on-surface/40'}">Live</span>
                  <span class="text-[9px] font-medium {openSection === 'live' ? 'text-md-on-surface/50' : 'text-md-on-surface/30'}">Active</span>
                </div>
                <span class="text-[11px] font-bold px-1.5 py-0.5 rounded-full {openSection === 'live' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface-variant/20 text-md-on-surface/50'}">{accountsByCategory.live.length}</span>
              </button>
              <button
                id="button-tab-inactive"
                class="flex-1 flex items-center justify-center gap-2 px-3 py-1 rounded-full transition-all duration-200 {openSection === 'inactive' ? 'bg-md-surface shadow-sm' : ''}"
                onclick={() => toggleSection('inactive')}
              >
                <div class="flex flex-col items-start">
                  <span class="text-[12px] font-bold {openSection === 'inactive' ? 'text-md-on-surface' : 'text-md-on-surface/40'}">Inactive</span>
                  <span class="text-[9px] font-medium {openSection === 'inactive' ? 'text-md-on-surface/50' : 'text-md-on-surface/30'}">Archived, Deleted, Expired</span>
                </div>
                <span class="text-[11px] font-bold px-1.5 py-0.5 rounded-full {openSection === 'inactive' ? 'bg-md-surface-variant/30 text-md-on-surface' : 'bg-md-surface-variant/20 text-md-on-surface/50'}">{accountsByCategory.available.length + accountsByCategory.unavailable.length}</span>
              </button>
            </div>

            <!-- Live tab content -->
            {#if openSection === 'live'}
              <div
                class="space-y-1 mt-1 max-h-80 overflow-y-auto"
                role="list"
              >
                {#each accountsByCategory.live as account (account.id)}
                  <div
                    ondrop={(e) => handleDrop(e, account, 'live')}
                    ondragover={(e) => handleDragOver(e, account)}
                    role="listitem"
                  >
                    <AccountCard
                      {account}
                      {selectedEmail}
                      isInAvailable={false}
                      isInUnavailable={false}
                      draggable={true}
                      onDragStart={handleDragStart}
                      onDragEnd={handleDragEnd}
                      onDrop={(e) => handleDrop(e, account, 'live')}
                      isDragging={draggedAccount?.id === account.id}
                      isDropTarget={dropTargetAccount?.id === account.id}
                      onSelectAccount={(address) => { onSelectAccount(address); closeDropdown(); }}
                      onToggleAutoExtend={onToggleAutoExtend}
                      onArchiveAccount={wrappedOnArchiveAccount}
                      onUnarchiveAccount={wrappedOnUnarchiveAccount}
                      onEditAccount={onEditAccount}
                      onRemoveAccount={wrappedOnRemoveAccount}
                      onRestoreAccount={wrappedOnRestoreAccount}
                      onTagAccount={openTagDialogForAccount}
                    />
                  </div>
                {/each}
              </div>
            {/if}

            <!-- Inactive tab content -->
            {#if openSection === 'inactive'}
              <!-- Tag filter pills -->
              <div class="flex gap-1 mt-1 px-2 flex-wrap">
                <button
                  id="button-filter-all"
                  class="text-[10px] px-2 py-0.5 rounded-full {selectedTagFilter === null ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface-variant text-md-on-surface/60'} hover:bg-md-primary hover:text-md-on-primary transition-colors"
                  onclick={() => selectedTagFilter = null}
                >
                  All
                </button>
                <button
                  id="button-filter-archived"
                  class="text-[10px] px-2 py-0.5 rounded-full {selectedTagFilter === 'archived' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface-variant text-md-on-surface/60'} hover:bg-md-primary hover:text-md-on-primary transition-colors"
                  onclick={() => selectedTagFilter = selectedTagFilter === 'archived' ? null : 'archived'}
                >
                  Archived
                </button>
                <button
                  id="button-filter-deleted"
                  class="text-[10px] px-2 py-0.5 rounded-full {selectedTagFilter === 'deleted' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface-variant text-md-on-surface/60'} hover:bg-md-primary hover:text-md-on-primary transition-colors"
                  onclick={() => selectedTagFilter = selectedTagFilter === 'deleted' ? null : 'deleted'}
                >
                  Deleted
                </button>
                <button
                  id="button-filter-expired"
                  class="text-[10px] px-2 py-0.5 rounded-full {selectedTagFilter === 'expired' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface-variant text-md-on-surface/60'} hover:bg-md-primary hover:text-md-on-primary transition-colors"
                  onclick={() => selectedTagFilter = selectedTagFilter === 'expired' ? null : 'expired'}
                >
                  Expired
                </button>
              </div>

              <!-- Available collapsible section -->
              <div class="mt-2">
                <button
                  id="button-collapse-available"
                  class="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-md-surface-variant transition-colors"
                  onclick={() => availableCollapsed = !availableCollapsed}
                >
                  <span class="text-[11px] font-semibold text-md-on-surface">Available ({accountsByCategory.available.length})</span>
                  <Icon name="chevronDown" class={`w-4 h-4 text-md-on-surface/50 transition-transform ${availableCollapsed ? 'rotate-180' : ''}`} />
                </button>
                {#if !availableCollapsed && accountsByCategory.available.length > 0}
                  <div class="mt-1 space-y-1 max-h-60 overflow-y-auto">
                    {#each accountsByCategory.available as account (account.id)}
                      <div
                        ondrop={(e) => handleDrop(e, account, 'inactive')}
                        ondragover={(e) => handleDragOver(e, account)}
                        role="listitem"
                      >
                        <AccountCard
                          {account}
                          {selectedEmail}
                          isInAvailable={true}
                          isInUnavailable={false}
                          draggable={true}
                          onDragStart={handleDragStart}
                          onDragEnd={handleDragEnd}
                          onDrop={(e) => handleDrop(e, account, 'inactive')}
                          isDragging={draggedAccount?.id === account.id}
                          isDropTarget={dropTargetAccount?.id === account.id}
                          onSelectAccount={(address) => { onSelectAccount(address); closeDropdown(); }}
                          onToggleAutoExtend={onToggleAutoExtend}
                          onArchiveAccount={wrappedOnArchiveAccount}
                          onUnarchiveAccount={wrappedOnUnarchiveAccount}
                          onEditAccount={onEditAccount}
                          onRemoveAccount={wrappedOnRemoveAccount}
                          onRestoreAccount={wrappedOnRestoreAccount}
                          onTagAccount={openTagDialogForAccount}
                        />
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>

              <!-- Unavailable collapsible section -->
              <div class="mt-2">
                <button
                  id="button-collapse-unavailable"
                  class="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-md-surface-variant transition-colors"
                  onclick={() => unavailableCollapsed = !unavailableCollapsed}
                >
                  <span class="text-[11px] font-semibold text-md-on-surface">Unavailable ({accountsByCategory.unavailable.length})</span>
                  <Icon name="chevronDown" class={`w-4 h-4 text-md-on-surface/50 transition-transform ${unavailableCollapsed ? 'rotate-180' : ''}`} />
                </button>
                {#if !unavailableCollapsed && accountsByCategory.unavailable.length > 0}
                  <div class="mt-1 space-y-1 max-h-60 overflow-y-auto">
                    {#each accountsByCategory.unavailable as account (account.id)}
                      <div
                        ondrop={(e) => handleDrop(e, account, 'inactive')}
                        ondragover={(e) => handleDragOver(e, account)}
                        role="listitem"
                      >
                        <AccountCard
                          {account}
                          {selectedEmail}
                          isInAvailable={false}
                          isInUnavailable={true}
                          draggable={true}
                          onDragStart={handleDragStart}
                          onDragEnd={handleDragEnd}
                          onDrop={(e) => handleDrop(e, account, 'inactive')}
                          isDragging={draggedAccount?.id === account.id}
                          isDropTarget={dropTargetAccount?.id === account.id}
                          onSelectAccount={(address) => { onSelectAccount(address); closeDropdown(); }}
                          onToggleAutoExtend={onToggleAutoExtend}
                          onArchiveAccount={wrappedOnArchiveAccount}
                          onUnarchiveAccount={wrappedOnUnarchiveAccount}
                          onEditAccount={onEditAccount}
                          onRemoveAccount={wrappedOnRemoveAccount}
                          onRestoreAccount={wrappedOnRestoreAccount}
                          onTagAccount={openTagDialogForAccount}
                        />
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
            </div>

            <!-- Generate New Mail Address button -->
            <button
              id="button-create-new-address"
              class="btn-secondary w-full px-3 py-2 text-center text-sm flex items-center justify-center gap-2 rounded-lg transition-colors"
              onclick={async () => {
                closeDropdown();
                const { selectedProvider } = await browser.storage.local.get(['selectedProvider']) as { selectedProvider?: string };
                const provider = selectedProvider || DEFAULT_PROVIDER;
                // Use the passed selectedProviderInstance prop instead of reading from storage
                if (selectedProviderInstance && selectedProviderInstance !== 'random') {
                  onCreateInbox(provider, selectedProviderInstance);
                } else {
                  onCreateInbox(provider);
                }
              }}
            >
              <Icon name="plus" class="w-4 h-4" />
              Create New Mail Address
            </button>

            <button
              id="button-manage-addresses"
              class="w-full px-3 py-2 text-center bg-md-surface-variant text-sm flex items-center justify-center gap-2 text-md-on-surface hover:bg-transparent hover:text-md-on-surface/60 rounded-lg transition-colors"
              onclick={() => { closeDropdown(); onNavigateToManage(); }}
            >
              <Icon name="instances" class="w-4 h-4" />
              Manage All Addresses
            </button>
          </div>
          </div>
    </div>
  {/if}
</div>

<style>
  .account-selector-outer {
    display: flex;
    padding: 2px;
    border-radius: 9999px;
    background: var(--border-gradient);
  }
</style>

<!-- Tag Dialog -->
{#if tagDialogOpen && tagTargetAccount}
  <TagDialog
    open={tagDialogOpen}
    currentTag={tagTargetAccount.tag || ''}
    currentTagColor={tagTargetAccount.tagColor || null}
    onClose={closeTagDialog}
    onSave={saveTag}
    existingTags={Array.from(
      new Set(
        allAccounts.map((a: Account) => a.tag).filter((tag: string | undefined): tag is string => !!tag)
      )
    )}
    tagColors={Object.fromEntries(
      allAccounts
        .filter((a: Account) => a.tag && a.tagColor)
        .map((a: Account) => [a.tag!, a.tagColor!])
    )}
  />
{/if}
