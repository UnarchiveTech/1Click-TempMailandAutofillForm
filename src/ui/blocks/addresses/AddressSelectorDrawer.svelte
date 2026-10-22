<script lang="ts">
import { onDestroy, onMount, tick } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import { canUnarchive } from '@/features/address/address-management.js';
import { updateAddressTags } from '@/features/tags/tag-actions.js';
import AddressCard from '@/ui/blocks/addresses/AddressCard.svelte';
import TagDialog from '@/ui/blocks/dialogs/TagDialog.svelte';
import BottomSheet from '@/ui/components/composites/BottomSheet.svelte';
import ButtonGroup from '@/ui/components/composites/ButtonGroup.svelte';
import ModalDialog from '@/ui/components/composites/ModalDialog.svelte';
import SearchBar from '@/ui/components/composites/SearchBar.svelte';
import Tabs from '@/ui/components/composites/Tabs.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import Btn from '@/ui/components/primitives/Btn.svelte';
import {
  isArchived as isAddressArchivedStatus,
  isDeleted as isAddressDeletedStatus,
  isExpiredNotArchived,
  isLive,
  isTimeExpired,
  resolveDragLifecycleAction,
} from '@/utils/address/address-status.js';
import {
  addressMatchesTagSearch,
  addressTagsList,
  buildTagAddressUsage,
  buildTagColors,
  existingTagNames,
} from '@/utils/address/address-tags.js';
import {
  loadAllProviderConfigs,
  loadProviderConfig,
  type ProviderConfig,
} from '@/utils/email/email-service.js';
import { logError } from '@/utils/logger.js';
import { getAddresses, setAddresses } from '@/utils/storage/storage-keys.js';
import type { Address } from '@/utils/types.js';
import { beginDialogLifecycle } from '@/utils/ui/dialog-lifecycle.js';
import { ELEVATION } from '@/utils/ui/elevation.js';
import { keyboardReorder } from '@/utils/ui/keyboard-reorder.js';
import {
  collectIntersectingIds,
  isInteractiveTarget,
  isMarqueeSelectionEnabled,
  MARQUEE_THRESHOLD,
  normalizeMarquee,
} from '@/utils/ui/marquee-selection.js';
import { PORTAL_Z_CLASS, portalDialogAction } from '@/utils/ui/portal-layers.js';
import { controlSurface } from '@/utils/ui/row-surface.js';

const tabsIdPrefix = $props.id();

let {
  open = false,
  onClose = () => {},
  selectedEmail = '',
  accounts = [],
  allAddresses = [],
  onSelectAddress = () => {},
  onEditAddress = () => {},
  onCreateAddress = () => {},
  onNavigateToManage = () => {},
  onReloadAddresses = async () => {},
  onToggleAutoExtend = () => {},
  onArchiveAddress = () => {},
  onUnarchiveAddress = () => {},
  onRemoveAddress = () => {},
  onRestoreAddress = () => {},
  onTagAddress = () => {},
  onManageTags = () => {},
  onMarkAllRead = async (_account: Address) => {},
  onMarkAllUnread = async (_account: Address) => {},
  showToast = (_message: string, _type?: string, _undo?: (() => void | Promise<void>) | null) => {},
}: {
  open?: boolean;
  onClose?: () => void;
  selectedEmail?: string;
  accounts?: Address[];
  allAddresses?: Address[];
  onSelectAddress?: (address: string) => void;
  onEditAddress?: (account: Address) => void;
  onCreateAddress?: (provider?: string, instanceId?: string) => void;
  onNavigateToManage?: () => void;
  onReloadAddresses?: () => Promise<void>;
  onToggleAutoExtend?: (account: Address) => void;
  onArchiveAddress?: (account: Address) => void;
  onUnarchiveAddress?: (account: Address) => void;
  onRemoveAddress?: (address: string) => void;
  onRestoreAddress?: (address: string) => void;
  onTagAddress?: (account: Address) => void;
  onManageTags?: () => void;
  onMarkAllRead?: (account: Address) => void | Promise<void>;
  onMarkAllUnread?: (account: Address) => void | Promise<void>;
  showToast?: (message: string, type?: string, undo?: (() => void | Promise<void>) | null) => void;
} = $props();

type SelectorPresentation = 'dialog' | 'bottomSheet';

let openSection = $state<'live' | 'inactive'>('live');
let presentation = $state<SelectorPresentation>('dialog');
let prevLiveCount = -1;
let prevInactiveCount = -1;
let tabDropTarget = $state<'live' | 'inactive' | null>(null);
let crossTabPrompt = $state<{
  direction: 'toInactive' | 'toLive' | 'toLiveRenew';
  account: Address;
} | null>(null);

/** Marquee multi-select inside account selector */
let selectorSelectedIds = $state<Set<string>>(new Set());
let marqueeSelectionEnabled = $state(true);
let marqueeActive = $state(false);
let marqueeStart = $state<{ x: number; y: number } | null>(null);
let marqueeRect = $state<{
  left: number;
  top: number;
  right: number;
  bottom: number;
} | null>(null);
let listScrollEl = $state<HTMLElement | null>(null);

/** Confirm dialog for strip action drops (archive/delete/tag/auto-renew) */
let actionDropPrompt = $state<{
  action: 'archive' | 'delete' | 'tag' | 'autoRenew';
  account: Address;
} | null>(null);
let stripDropTarget = $state<'archive' | 'delete' | 'tag' | 'autoRenew' | null>(null);

$effect(() => {
  const liveCount = accountsByCategory.live.length;
  const inactiveCount = accountsByCategory.available.length + accountsByCategory.unavailable.length;
  if (prevLiveCount !== -1) {
    if (liveCount < prevLiveCount && inactiveCount > prevInactiveCount) {
      activeAddressIndex = 0;
      openSection = 'inactive';
    } else if (inactiveCount < prevInactiveCount && liveCount > prevLiveCount) {
      activeAddressIndex = 0;
      openSection = 'live';
    }
  }
  prevLiveCount = liveCount;
  prevInactiveCount = inactiveCount;
});

let availableCollapsed = $state(false);
let unavailableCollapsed = $state(false);
let selectedTagFilter = $state<string | null>(null);
let dropdownSearch = $state('');
let tagDialogOpen = $state(false);
let tagTargetAddress = $state<Address | null>(null);
let draggedAddress = $state<Address | null>(null);
let draggedFromSection = $state<'live' | 'inactive' | null>(null);
let dropTargetAddress = $state<Address | null>(null);
let localAddressOrder = $state<Address[] | null>(null);
let activeAddressIndex = $state(0);
let searchInputRef = $state<HTMLInputElement | null>(null);
let dialogRef = $state<HTMLElement | null>(null);
let dialogLifecycle = $state<ReturnType<typeof beginDialogLifecycle> | null>(null);
let overlayHost = $state<HTMLElement | null>(null);
let searchFocusTimer: ReturnType<typeof setTimeout> | null = null;

function setPresentation(value: unknown) {
  presentation = value === true || value === 'bottomSheet' ? 'bottomSheet' : 'dialog';
}

onMount(() => {
  let disposed = false;
  void browser.storage.local
    .get(['dialogPresentationBottomSheet'])
    .then((result) => {
      if (!disposed) setPresentation(result.dialogPresentationBottomSheet);
    })
    .catch((error) => {
      logError('Failed to load account selector presentation preference', error);
    });
  const onStorageChange = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && changes.dialogPresentationBottomSheet) {
      setPresentation(
        changes.dialogPresentationBottomSheet.newValue === true ? 'bottomSheet' : 'dialog'
      );
    }
    if (area === 'local' && changes.marqueeSelectionEnabled) {
      marqueeSelectionEnabled = changes.marqueeSelectionEnabled.newValue !== false;
    }
  };
  void isMarqueeSelectionEnabled().then((enabled) => {
    if (!disposed) marqueeSelectionEnabled = enabled;
  });
  browser.storage.onChanged.addListener(onStorageChange);
  return () => {
    disposed = true;
    browser.storage.onChanged.removeListener(onStorageChange);
  };
});

function closeOverlay() {
  dropdownSearch = '';
  actionDropPrompt = null;
  crossTabPrompt = null;
  removePortalOverlay();
  onClose();
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeOverlay();
  if (e.key === 'Tab') {
    const focusableElements = document.querySelectorAll(
      '#account-selector-dialog button, #account-selector-dialog input, #account-selector-dialog [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0] as HTMLElement;
    const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

    if (e.shiftKey) {
      if (document.activeElement === firstElement) {
        e.preventDefault();
        lastElement?.focus();
      }
    } else {
      if (document.activeElement === lastElement) {
        e.preventDefault();
        firstElement?.focus();
      }
    }
  }
}

// Auto-focus search input when dialog opens
$effect(() => {
  if (!open) return;
  searchFocusTimer = setTimeout(() => {
    searchFocusTimer = null;
    searchInputRef?.focus();
  }, 50);
  return () => {
    if (searchFocusTimer) {
      clearTimeout(searchFocusTimer);
      searchFocusTimer = null;
    }
  };
});

// Portal overlay to document.body so header/footer stacking never covers it.
// The overlay root uses `use:portalToBody` (see markup) - the action moves it
// to document.body on mount and removes it on destroy, avoiding the previous
// rAF + querySelector('.account-selector-overlay') timing fragility.
function removePortalOverlay() {
  try {
    if (overlayHost?.parentElement === document.body) overlayHost.remove();
  } catch {
    /* ignore */
  }
  overlayHost = null;
}

$effect(() => {
  if (!open || presentation === 'bottomSheet') return;
  const lifecycle = beginDialogLifecycle();
  dialogLifecycle = lifecycle;
  void tick().then(() => lifecycle.attach(dialogRef));
  return () => {
    lifecycle.cleanup();
    if (dialogLifecycle === lifecycle) dialogLifecycle = null;
  };
});

// Wrap callbacks to clear cache before actions
const wrappedOnArchiveAddress = (account: Address) => {
  localAddressOrder = null;
  onArchiveAddress(account);
};

const wrappedOnUnarchiveAddress = (account: Address) => {
  localAddressOrder = null;
  onUnarchiveAddress(account);
};

const wrappedOnRemoveAddress = (address: string) => {
  localAddressOrder = null;
  onRemoveAddress(address);
};

const wrappedOnRestoreAddress = (address: string) => {
  localAddressOrder = null;
  onRestoreAddress(address);
};

function findSelectedAddress(): Address | undefined {
  const selected = selectedEmail.trim().toLowerCase();
  if (!selected) return undefined;
  return allAddresses.find(
    (account: Address) => (account.address || '').trim().toLowerCase() === selected
  );
}

function toggleSection(section: 'live' | 'inactive') {
  activeAddressIndex = 0;
  openSection = section;
}

// Filter accounts by search (address or tag)
let filteredAddresses = $derived.by(() => {
  const source =
    draggedAddress !== null && localAddressOrder !== null ? localAddressOrder : allAddresses;
  const search = dropdownSearch.trim().toLowerCase();
  if (!search) return source;
  return source.filter(
    (a: Address) => a.address.toLowerCase().includes(search) || addressMatchesTagSearch(a, search)
  );
});

// Filter accounts by tag
let tagFilteredAddresses = $derived.by(() => {
  if (!selectedTagFilter) return filteredAddresses;
  return filteredAddresses.filter((a: Address) => {
    if (selectedTagFilter === 'archived') return isAddressArchivedStatus(a);
    if (selectedTagFilter === 'deleted') return isAddressDeletedStatus(a);
    if (selectedTagFilter === 'expired') return isExpiredNotArchived(a);
    return false;
  });
});

// Helper to check if account can be recoverable
function isRecoverable(account: Address): boolean {
  const isExpired = isTimeExpired(account);

  if (!isExpired) return true;
  if (account.autoExtend) return true;
  try {
    const config = loadProviderConfig(account.provider);
    if (config.expiry?.renewable) return true;
  } catch {
    /* ignore */
  }
  return false;
}

// Group accounts by categorization (Live, Available, Unavailable)
let accountsByCategory = $derived.by(() => {
  const live: Address[] = [];
  const available: Address[] = [];
  const unavailable: Address[] = [];

  tagFilteredAddresses.forEach((a: Address) => {
    if (isLive(a)) {
      live.push(a);
    } else {
      if (isRecoverable(a)) {
        available.push(a);
      } else {
        unavailable.push(a);
      }
    }
  });

  return { live, available, unavailable };
});

// Which addresses carry each tag - the hover info on every existing tag in the
// dialog. One derivation for the whole drawer, from the shared helper.
const tagAddressUsage = $derived(buildTagAddressUsage(allAddresses));
// And one color per tag, keyed case-insensitively like the usage map - a tag is
// one tag, so `banking` and `Banking` cannot paint two chips in the same list.
const allTagColors = $derived(buildTagColors(allAddresses));

async function openTagDialogForAddress(account: Address) {
  tagTargetAddress = account;
  tagDialogOpen = true;
}

function closeTagDialog() {
  tagDialogOpen = false;
  tagTargetAddress = null;
}

async function saveTags(tags: Array<{ name: string; color: string }>): Promise<boolean> {
  if (!tagTargetAddress) return true;
  const ok = await updateAddressTags(tagTargetAddress.id, tags, browser, {
    onReloadAddresses,
  });
  if (!ok) {
    // success:false (e.g. stale addressId deleted elsewhere) - keep the dialog
    // open (TagDialog gates its close on this) and surface the rejection.
    showToast($t('toasts.tagSaveFailed'), 'error');
    return false;
  }
  closeTagDialog();
  return true;
}

// Drag and drop handlers
let lastDraggedAddress: Address | null = null;

function handleDragStart(e: DragEvent, account: Address) {
  draggedAddress = account;
  lastDraggedAddress = account;
  draggedFromSection = openSection;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', account.id);
    e.dataTransfer.setData('application/x-account-id', account.id);
  }
}

function resolveDraggedAddress(e?: DragEvent): Address | null {
  const fromState = draggedAddress || lastDraggedAddress;
  if (fromState) return fromState;
  const id =
    e?.dataTransfer?.getData('application/x-account-id') ||
    e?.dataTransfer?.getData('text/plain') ||
    '';
  if (!id) return null;
  return allAddresses.find((a: Address) => a.id === id) || null;
}

function handleDragEnd() {
  draggedAddress = null;
  draggedFromSection = null;
  dropTargetAddress = null;
  tabDropTarget = null;
  stripDropTarget = null;
  setTimeout(() => {
    lastDraggedAddress = null;
  }, 50);
}

function handleTabDrop(tab: 'live' | 'inactive', e?: DragEvent) {
  tabDropTarget = null;
  const account = resolveDraggedAddress(e);
  if (!account) return;
  handleDragEnd();
  const action = resolveDragLifecycleAction(account, tab);
  if (action === 'noop') return;
  if (action === 'error_no_renew') {
    showToast($t('address.cannotActivateExpiredNoRenew'));
    return;
  }
  if (action === 'archive') {
    crossTabPrompt = { direction: 'toInactive', account };
    return;
  }
  if (action === 'renew' || action === 'unarchive_and_renew') {
    crossTabPrompt = { direction: 'toLiveRenew', account };
    return;
  }
  if (action === 'unarchive') {
    crossTabPrompt = { direction: 'toLive', account };
  }
}

function applyTabDropToLiveRenew() {
  const account = crossTabPrompt?.account;
  crossTabPrompt = null;
  if (!account) return;
  if (!account.autoExtend) onToggleAutoExtend(account);
}

function handleActionStripDrop(action: 'archive' | 'delete' | 'tag' | 'autoRenew', e?: DragEvent) {
  stripDropTarget = null;
  const account = resolveDraggedAddress(e);
  if (!account) return;
  handleDragEnd();
  actionDropPrompt = { action, account };
}

function applyActionDrop() {
  const p = actionDropPrompt;
  actionDropPrompt = null;
  if (!p) return;
  if (p.action === 'archive') wrappedOnArchiveAddress(p.account);
  else if (p.action === 'delete') wrappedOnRemoveAddress(p.account.address);
  else if (p.action === 'tag') openTagDialogForAddress(p.account);
  else if (p.action === 'autoRenew') onToggleAutoExtend(p.account);
}

function applyTabDropToInactive(action: 'archive' | 'delete') {
  const account = crossTabPrompt?.account;
  crossTabPrompt = null;
  if (!account) return;
  if (action === 'archive') {
    wrappedOnArchiveAddress(account);
  } else {
    wrappedOnRemoveAddress(account.address);
  }
}

function applyTabDropToLive(action: 'unarchive' | 'restore') {
  const account = crossTabPrompt?.account;
  crossTabPrompt = null;
  if (!account) return;
  if (action === 'unarchive') {
    if (!canUnarchive(account)) return;
    wrappedOnUnarchiveAddress(account);
  } else {
    wrappedOnRestoreAddress(account.address);
  }
}

// Marquee multi-select
function onListMarqueeDown(e: PointerEvent) {
  if (!marqueeSelectionEnabled || e.button !== 0) return;
  if (isInteractiveTarget(e.target)) return;
  const root = e.currentTarget as HTMLElement | null;
  if (!root) return;
  listScrollEl = root;
  marqueeStart = { x: e.clientX, y: e.clientY };
  marqueeActive = false;
  marqueeRect = null;
  const onMove = (ev: PointerEvent) => {
    if (!marqueeStart) return;
    const dx = Math.abs(ev.clientX - marqueeStart.x);
    const dy = Math.abs(ev.clientY - marqueeStart.y);
    if (!marqueeActive && dx < MARQUEE_THRESHOLD && dy < MARQUEE_THRESHOLD) return;
    marqueeActive = true;
    marqueeRect = normalizeMarquee(marqueeStart, {
      x: ev.clientX,
      y: ev.clientY,
    });
    if (listScrollEl) {
      const ids = collectIntersectingIds(listScrollEl, '[data-marquee-id]', marqueeRect);
      selectorSelectedIds = new Set(ids);
    }
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    window.removeEventListener('blur', onUp);
    marqueeStart = null;
    marqueeActive = false;
    marqueeRect = null;
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  // If the pointer leaves the window / the window loses focus (e.g. alt-tab),
  // pointerup may never fire - release the drag state so the UI never sticks
  // in marquee mode (same contract as the mailbox marquee).
  window.addEventListener('blur', onUp);
}

function handleDragOver(e: DragEvent, targetAddress: Address) {
  e.preventDefault();
  dropTargetAddress = targetAddress;
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move';
  }
}

async function handleDrop(e: DragEvent, targetAddress: Address, section: 'live' | 'inactive') {
  e.preventDefault();
  dropTargetAddress = null;
  if (!draggedAddress || draggedAddress.id === targetAddress.id) return;
  if (draggedFromSection !== section) return;

  const sourceDragged = draggedAddress;
  handleDragEnd();

  await reorderDrawerAddress(sourceDragged, targetAddress);
}

async function reorderDrawerAddress(sourceDragged: Address, targetAddress: Address) {
  try {
    const addresses = await getAddresses();
    const sourceIndex = addresses.findIndex((i: Address) => i.id === sourceDragged.id);
    if (sourceIndex === -1) return;

    const filteredAddresses = addresses.filter((i: Address) => i.id !== sourceDragged.id);
    const targetIndex = filteredAddresses.findIndex((i: Address) => i.id === targetAddress.id);

    if (targetIndex === -1) {
      logError('Drag-drop: could not find target account ID in storage', {
        sourceId: sourceDragged.id,
        targetId: targetAddress.id,
      });
      return;
    }

    filteredAddresses.splice(targetIndex, 0, sourceDragged);

    const currentSource = localAddressOrder ?? allAddresses;
    const filteredLocal = currentSource.filter((a: Address) => a.id !== sourceDragged.id);
    const localTargetIdx = filteredLocal.findIndex((a: Address) => a.id === targetAddress.id);
    if (localTargetIdx !== -1) {
      filteredLocal.splice(localTargetIdx, 0, sourceDragged);
      localAddressOrder = filteredLocal;
    }

    await setAddresses(filteredAddresses);
    await onReloadAddresses();
    localAddressOrder = null;
  } catch (error) {
    logError('Failed to reorder accounts', error);
    localAddressOrder = null;
  }
}
</script>

{#snippet addressSection(
  items: Address[],
  section: 'live' | 'inactive',
  isInAvailable: boolean,
  isInUnavailable: boolean,
  listClass: string
)}
  <div class={listClass} role="list" onpointerdown={onListMarqueeDown}>
    {#each items as account (account.id)}
      <div
        data-marquee-id={account.id}
        class="border-b border-md-outline-variant/50"
        ondrop={(e) => handleDrop(e, account, section)}
        ondragover={(e) => handleDragOver(e, account)}
        role="listitem"
        use:keyboardReorder={{ id: account.id, ids: () => items.map(a => a.id), hint: $t('keyboardShortcuts.fixedReorderRow'), moveBefore: async (sourceId, targetId) => {
          const source = items.find(a => a.id === sourceId);
          const target = items.find(a => a.id === targetId);
          if (source && target) await reorderDrawerAddress(source, target);
        } }}
      >
        <AddressCard
          {account}
          {selectedEmail}
          {isInAvailable}
          {isInUnavailable}
          selected={selectorSelectedIds.has(account.id)}
          tagUsage={tagAddressUsage}
          tagColors={allTagColors}
          hideInstanceBadge={true}
          draggable={true}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDrop={(e) => handleDrop(e, account, section)}
          isDragging={draggedAddress?.id === account.id}
          isDropTarget={dropTargetAddress?.id === account.id}
          onSelectAddress={(address) => { onSelectAddress(address); closeOverlay(); }}
          onToggleAutoExtend={onToggleAutoExtend}
          onArchiveAddress={wrappedOnArchiveAddress}
          onUnarchiveAddress={wrappedOnUnarchiveAddress}
          onEditAddress={onEditAddress}
          onRemoveAddress={wrappedOnRemoveAddress}
          onRestoreAddress={wrappedOnRestoreAddress}
          onTagAddress={openTagDialogForAddress}
          onMarkAllRead={(acc) => void onMarkAllRead(acc)}
          onMarkAllUnread={(acc) => void onMarkAllUnread(acc)}
        />
      </div>
    {/each}
  </div>
{/snippet}

{#snippet selectorPane()}
    <!-- Preserve vertical inset; the compact horizontal gutter is shared. -->
    <div
      class="relative z-10 flex flex-col w-full min-h-0 h-full {presentation === 'bottomSheet' ? '' : 'dialog-viewport-inset'}"
      style={presentation === 'bottomSheet' ? undefined : 'padding-block: 25px;'}
      data-account-selector-pane
    >
      {#if presentation !== 'bottomSheet'}
        <button
          id="button-close-dialog"
          type="button"
          class="self-end shrink-0 mb-2 w-9 h-9 rounded-full bg-md-surface hover:bg-md-surface-variant active:bg-md-surface-variant/80 flex items-center justify-center {ELEVATION.level2} transition-colors"
          aria-label={$t('common.close')}
          title={$t('common.close')}
          onclick={closeOverlay}
        >
          <Icon name="close" class="w-4 h-4 text-md-on-surface/70" />
        </button>
      {/if}

      <!-- Dialog card fills remaining space -->
      <div id="account-selector-dialog" bind:this={dialogRef} class="dialog-inset {presentation === 'bottomSheet' ? 'h-full' : 'flex-1'} bg-md-surface {presentation === 'bottomSheet' ? '' : 'rounded-xl'} {presentation === 'bottomSheet' ? '' : ELEVATION.level3} py-3 flex flex-col gap-2 w-full min-h-0 overflow-hidden border {presentation === 'bottomSheet' ? 'border-0' : 'border-md-outline-variant/30'}">
        <!-- Sticky header: search -->
        <div class="relative shrink-0">
          <SearchBar
            scope="account-selector"
            inputId="account-selector-search"
            bind:value={dropdownSearch}
            placeholder={$t('address.searchAddressesOrTags')}
            animatedPlaceholders={[
              $t('searchPlaceholder.addresses'),
              $t('searchPlaceholder.tags'),
            ]}
            ariaLabel={$t('address.searchAddressesOrTags')}
            settingsStyle={true}
            showSlashButton={false}
            showVoiceSearch={false}
            onInputRef={(el) => (searchInputRef = el)}
            onkeydown={(e) => {
              const activeList = openSection === 'live' ? accountsByCategory.live : [...accountsByCategory.available, ...accountsByCategory.unavailable];
              if (activeList.length === 0) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                activeAddressIndex = (activeAddressIndex + 1) % activeList.length;
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                activeAddressIndex = (activeAddressIndex - 1 + activeList.length) % activeList.length;
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const target = activeList[activeAddressIndex];
                if (target) {
                  onSelectAddress(target.address);
                  closeOverlay();
                }
              }
            }}
          />
        </div>

        <div class="space-y-1 flex-1 min-h-0 flex flex-col">
          <!-- Live/Inactive tabs (drop targets for drag) - sticky under search -->
          <Tabs
            idPrefix={tabsIdPrefix}
            ariaLabel={$t('address.selectEmail')}
            variant="pill"
            fullWidth
            activeTab={openSection}
            dropTargetId={tabDropTarget}
            tabs={[
              {
                id: 'live',
                label: $t('address.live'),
                badge: accountsByCategory.live.length,
              },
              {
                id: 'inactive',
                label: $t('address.inactive'),
                badge: accountsByCategory.available.length + accountsByCategory.unavailable.length,
              },
            ]}
            onchange={(id) => toggleSection(id as 'live' | 'inactive')}
            ondragover={(id, e) => {
              e.preventDefault();
              tabDropTarget = id as 'live' | 'inactive';
            }}
            ondragleave={(id) => {
              if (tabDropTarget === id) tabDropTarget = null;
            }}
            ondrop={(id, e) => {
              e.preventDefault();
              e.stopPropagation();
              tabDropTarget = null;
              handleTabDrop(id as 'live' | 'inactive', e);
            }}
          />

          <div
            id="{tabsIdPrefix}-panel-{openSection}"
            class="flex flex-col flex-1 min-h-0 overflow-hidden"
            role="tabpanel"
            aria-labelledby="{tabsIdPrefix}-tab-{openSection}"
            tabindex="0"
          >
          <!-- Live tab content -->
          {#if openSection === 'live'}
            {@render addressSection(
              accountsByCategory.live,
              'live',
              false,
              false,
              'scroll-body relative border-t border-md-outline-variant/30 mt-1 flex-1 min-h-0 overflow-y-auto'
            )}
          {/if}

          <!-- Inactive tab content -->
          {#if openSection === 'inactive'}
            <!-- Tag filter pills -->
            <div class="flex gap-1 mt-1 px-2 flex-wrap">
              <button
                id="button-filter-all"
                class="text-xs px-2 py-0.5 rounded-full bg-md-surface-variant text-md-on-surface/60 active:brightness-95 transition-colors {controlSurface(
                  selectedTagFilter === null
                )}"
                onclick={() => (selectedTagFilter = null)}
              >
                {$t('common.all')}
              </button>
              <button
                id="button-filter-archived"
                class="text-xs px-2 py-0.5 rounded-full bg-md-surface-variant text-md-on-surface/60 active:brightness-95 transition-colors {controlSurface(
                  selectedTagFilter === 'archived'
                )}"
                onclick={() => (selectedTagFilter = selectedTagFilter === 'archived' ? null : 'archived')}
              >
                {$t('common.archived')}
              </button>
              <button
                id="button-filter-deleted"
                class="text-xs px-2 py-0.5 rounded-full bg-md-surface-variant text-md-on-surface/60 active:brightness-95 transition-colors {controlSurface(
                  selectedTagFilter === 'deleted'
                )}"
                onclick={() => (selectedTagFilter = selectedTagFilter === 'deleted' ? null : 'deleted')}
              >
                {$t('common.deleted')}
              </button>
              <button
                id="button-filter-expired"
                class="text-xs px-2 py-0.5 rounded-full bg-md-surface-variant text-md-on-surface/60 active:brightness-95 transition-colors {controlSurface(
                  selectedTagFilter === 'expired'
                )}"
                onclick={() => (selectedTagFilter = selectedTagFilter === 'expired' ? null : 'expired')}
              >
                {$t('address.expiredStatus')}
              </button>
            </div>

            <!-- Available collapsible section -->
            <div class="mt-2">
              <button
                id="button-collapse-available"
                class="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-md-surface-variant active:brightness-95 transition-colors"
                onclick={() => (availableCollapsed = !availableCollapsed)}
              >
                <span class="text-xs font-semibold text-md-on-surface">{$t('address.available')} ({accountsByCategory.available.length})</span>
                <Icon name="chevronDown" class={`w-4 h-4 text-md-on-surface/50 transition-transform ${availableCollapsed ? 'rotate-180' : ''}`} />
              </button>
              {#if !availableCollapsed && accountsByCategory.available.length > 0}
                {@render addressSection(
                  accountsByCategory.available,
                  'inactive',
                  true,
                  false,
                  'scroll-body mt-1 border-t border-md-outline-variant/30 max-h-60 overflow-y-auto'
                )}
              {/if}
            </div>

            <!-- Unavailable collapsible section -->
            <div class="mt-2">
              <button
                id="button-collapse-unavailable"
                class="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-md-surface-variant active:brightness-95 transition-colors"
                onclick={() => (unavailableCollapsed = !unavailableCollapsed)}
              >
                <span class="text-xs font-semibold text-md-on-surface">{$t('address.unavailable')} ({accountsByCategory.unavailable.length})</span>
                <Icon name="chevronDown" class={`w-4 h-4 text-md-on-surface/50 transition-transform ${unavailableCollapsed ? 'rotate-180' : ''}`} />
              </button>
              {#if !unavailableCollapsed && accountsByCategory.unavailable.length > 0}
                {@render addressSection(
                  accountsByCategory.unavailable,
                  'inactive',
                  false,
                  true,
                  'scroll-body mt-1 border-t border-md-outline-variant/30 max-h-60 overflow-y-auto'
                )}
              {/if}
            </div>
          {/if}
          </div>
        </div>

        <!-- Quick actions: drop targets (divs - buttons often swallow HTML5 drop) -->
        <!-- Four stacked XS actions share one spacing contract in both presentations. -->
        <ButtonGroup tier="XS" stacked>
          <Btn
            as="div"
            id="button-strip-archive"
            title={$t('common.archive')}
            variant="surface"
            icon="archive"
            label={$t('common.archive')}
            dropActive={stripDropTarget === 'archive'}
            dropTone="warning"
            ondragover={(e) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; stripDropTarget = 'archive'; }}
            ondragenter={(e) => { e.preventDefault(); stripDropTarget = 'archive'; }}
            ondragleave={() => { if (stripDropTarget === 'archive') stripDropTarget = null; }}
            ondrop={(e) => { e.preventDefault(); e.stopPropagation(); handleActionStripDrop('archive', e); }}
            onclick={(e) => {
              e.stopPropagation();
              const curr = findSelectedAddress();
              if (curr) wrappedOnArchiveAddress(curr);
            }}
          />
          <Btn
            as="div"
            id="button-strip-delete"
            title={$t('common.delete')}
            variant="danger"
            icon="delete"
            label={$t('common.delete')}
            dropActive={stripDropTarget === 'delete'}
            dropTone="danger"
            ondragover={(e) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; stripDropTarget = 'delete'; }}
            ondragenter={(e) => { e.preventDefault(); stripDropTarget = 'delete'; }}
            ondragleave={() => { if (stripDropTarget === 'delete') stripDropTarget = null; }}
            ondrop={(e) => { e.preventDefault(); e.stopPropagation(); handleActionStripDrop('delete', e); }}
            onclick={(e) => {
              e.stopPropagation();
              const curr = findSelectedAddress();
              if (curr) wrappedOnRemoveAddress(curr.address);
            }}
          />
          <Btn
            as="div"
            id="button-strip-tag"
            title={$t('common.addTag')}
            variant="surface"
            icon="add"
            label={$t('common.addTag')}
            dropActive={stripDropTarget === 'tag'}
            dropTone="primary"
            ondragover={(e) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; stripDropTarget = 'tag'; }}
            ondragenter={(e) => { e.preventDefault(); stripDropTarget = 'tag'; }}
            ondragleave={() => { if (stripDropTarget === 'tag') stripDropTarget = null; }}
            ondrop={(e) => { e.preventDefault(); e.stopPropagation(); handleActionStripDrop('tag', e); }}
            onclick={(e) => {
              e.stopPropagation();
              const curr = findSelectedAddress();
              if (curr) openTagDialogForAddress(curr);
            }}
          />
          <Btn
            as="div"
            id="button-strip-autorenew"
            title={$t('address.autoRenew')}
            variant="surface"
            icon="autoRenew"
            label={$t('address.autoRenew')}
            dropActive={stripDropTarget === 'autoRenew'}
            dropTone="tertiary"
            ondragover={(e) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; stripDropTarget = 'autoRenew'; }}
            ondragenter={(e) => { e.preventDefault(); stripDropTarget = 'autoRenew'; }}
            ondragleave={() => { if (stripDropTarget === 'autoRenew') stripDropTarget = null; }}
            ondrop={(e) => { e.preventDefault(); e.stopPropagation(); handleActionStripDrop('autoRenew', e); }}
            onclick={(e) => {
              e.stopPropagation();
              const curr = findSelectedAddress();
              if (curr) onToggleAutoExtend(curr);
            }}
          />
        </ButtonGroup>

        <!-- Sticky footer: Create + Manage always visible while list scrolls -->
        <ButtonGroup
          class="account-selector-sticky-actions shrink-0 pt-2 mt-auto border-t border-md-outline-variant/25 bg-md-surface"
        >
          <Btn
            id="button-create-new-mail"
            variant="primary"
            icon="add"
            label={$t('address.newMailAddress')}
            onclick={() => { closeOverlay(); onCreateAddress(); }}
          />
          <Btn
            id="button-manage-addresses"
            variant="surface"
            icon="layers"
            label={$t('address.manageAddresses')}
            onclick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              closeOverlay();
              queueMicrotask(() => {
                removePortalOverlay();
                onNavigateToManage();
              });
            }}
          />
        </ButtonGroup>
      </div>
      <!-- /dialog card -->

      {#if marqueeActive && marqueeRect}
        <div
          class="fixed pointer-events-none {PORTAL_Z_CLASS.marqueeBorder} border border-md-primary/70 bg-md-primary/15 rounded-sm"
          style="left:{marqueeRect.left}px;top:{marqueeRect.top}px;width:{marqueeRect.right - marqueeRect.left}px;height:{marqueeRect.bottom - marqueeRect.top}px;"
          aria-hidden="true"
        ></div>
      {/if}

      <!-- Tag dialog inside overlay pane -->
      {#if tagDialogOpen && tagTargetAddress}
        <TagDialog
          open={tagDialogOpen}
          currentTag={tagTargetAddress.tag || ''}
          currentTagColor={tagTargetAddress.tagColor || null}
          currentTags={addressTagsList(tagTargetAddress)}
          onClose={closeTagDialog}
          onManageTags={() => {
            onClose();
            onManageTags();
          }}
          onSaveTags={saveTags}
          existingTags={existingTagNames(allAddresses)}
          tagColors={allTagColors}
          tagAddresses={tagAddressUsage}
          portal={false}
        />
      {/if}
    </div>
{/snippet}

{#if open}
  {#if presentation === 'bottomSheet'}
    <BottomSheet
      open={true}
      title={$t('address.selectEmail')}
      maxWidth="md"
      contentClass="!p-0 !overflow-hidden !flex-1 !min-h-0"
      surfaceClass="h-[78vh] max-h-[520px]"
      onClose={closeOverlay}
    >
      {@render selectorPane()}
    </BottomSheet>
  {:else}
    <!-- Low z so portaled Tag/Confirm dialogs (z-10000) always paint above -->
    <div
      bind:this={overlayHost}
      use:portalDialogAction
      class="account-selector-overlay fixed inset-0 {PORTAL_Z_CLASS.accountSelector} flex items-stretch justify-stretch"
      data-portal-layer="accountSelector"
      role="dialog"
      aria-modal="true"
      aria-label={$t('address.selectEmail')}
    >
      <!-- Scrim blocks all chrome interaction -->
      <button
        id="button-close-dropdown-backdrop"
        type="button"
        class="absolute inset-0 z-0 cursor-default border-0 bg-md-scrim-modal backdrop-blur-sm"
        aria-label={$t('common.close')}
        onclick={closeOverlay}
        onkeydown={handleKeyDown}
      ></button>
      {@render selectorPane()}
    </div>
  {/if}
{/if}

<!-- Cross-tab drop confirmation: portaled to document.body via the shared
     ModalDialog so it stacks above the account-selector layer (z-40) at
     PORTAL_Z.dialog and traps focus - never nested inside the selector's
     stacking context (AGENTS.md §4). -->
{#if crossTabPrompt}
  {@const prompt = crossTabPrompt}
  <ModalDialog
    open={true}
    title={prompt.direction === 'toInactive'
      ? $t('address.dragToInactiveTitle')
      : prompt.direction === 'toLiveRenew'
        ? $t('address.dragToLiveRenewTitle')
        : $t('address.dragToLiveTitle')}
    maxWidth="sm"
    showCloseButton={false}
    onClose={() => (crossTabPrompt = null)}
  >
    <p class="text-xs text-md-on-surface/60 break-all" style="direction:ltr;unicode-bidi:isolate;">{prompt.account.address}</p>
    <p class="text-sm text-md-on-surface-variant">
      {prompt.direction === 'toInactive'
        ? $t('address.dragToInactiveBody')
        : prompt.direction === 'toLiveRenew'
          ? $t('address.dragToLiveRenewBody')
          : $t('address.dragToLiveBody')}
    </p>
    {#snippet footer()}
      <div class="flex flex-col gap-1.5 w-full">
        {#if prompt.direction === 'toInactive'}
          <Btn variant="primary" size="md" class="w-full" onclick={() => applyTabDropToInactive('archive')}>
            {$t('common.archive')}
          </Btn>
          <Btn variant="danger" size="md" class="w-full" onclick={() => applyTabDropToInactive('delete')}>
            {$t('common.delete')}
          </Btn>
        {:else if prompt.direction === 'toLiveRenew'}
          <Btn variant="primary" size="md" class="w-full" onclick={() => applyTabDropToLiveRenew()}>
            {$t('address.enableAutoRenew')}
          </Btn>
        {:else}
          <Btn
            variant="primary"
            size="md"
            class="w-full"
            disabled={!canUnarchive(prompt.account)}
            title={!canUnarchive(prompt.account) ? $t('address.unarchiveNotAvailable') : undefined}
            onclick={() => applyTabDropToLive('unarchive')}
          >
            {$t('common.unarchive')}
          </Btn>
          <Btn variant="tertiary" size="md" class="w-full" onclick={() => applyTabDropToLive('restore')}>
            {$t('common.restore')}
          </Btn>
        {/if}
        <Btn variant="ghost" size="md" class="w-full" onclick={() => (crossTabPrompt = null)}>
          {$t('common.cancel')}
        </Btn>
      </div>
    {/snippet}
  </ModalDialog>
{/if}

<!-- Action-strip drop confirmation: same portaled dialog treatment. -->
{#if actionDropPrompt}
  {@const prompt = actionDropPrompt}
  <ModalDialog
    open={true}
    title={$t('address.confirmActionTitle')}
    maxWidth="sm"
    showCloseButton={false}
    onClose={() => (actionDropPrompt = null)}
  >
    <p class="text-xs text-md-on-surface/60 break-all" style="direction:ltr;unicode-bidi:isolate;">{prompt.account.address}</p>
    <p class="text-sm text-md-on-surface-variant">
      {#if prompt.action === 'archive'}{$t('common.archive')}
      {:else if prompt.action === 'delete'}{$t('common.delete')}
      {:else if prompt.action === 'tag'}{$t('common.addTag')}
      {:else}{$t('address.autoRenew')}
      {/if}
    </p>
    {#snippet footer()}
      <div class="flex flex-col gap-1.5 w-full">
        <Btn variant="primary" size="md" class="w-full" onclick={() => applyActionDrop()}>
          {$t('common.confirm')}
        </Btn>
        <Btn variant="ghost" size="md" class="w-full" onclick={() => (actionDropPrompt = null)}>
          {$t('common.cancel')}
        </Btn>
      </div>
    {/snippet}
  </ModalDialog>
{/if}
