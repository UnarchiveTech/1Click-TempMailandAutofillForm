<script lang="ts">
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import { canUnarchive } from '@/features/address/address-management.js';
import MenuList from '@/ui/components/composites/MenuList.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import Avatar from '@/ui/components/primitives/Avatar.svelte';
import Badge from '@/ui/components/primitives/Badge.svelte';
import ProviderPill from '@/ui/components/primitives/ProviderPill.svelte';
import TagPill from '@/ui/components/primitives/TagPill.svelte';
import {
  isArchived as isAddressArchived,
  isDeleted as isAddressDeleted,
  isTimeExpired,
} from '@/utils/address/address-status.js';
import { addressTagsList, tagColorFor, tagUsageInfo } from '@/utils/address/address-tags.js';
import { loadProviderConfig } from '@/utils/email/email-service.js';
import { getMailboxReadState } from '@/utils/storage/mailbox-read-state.js';
import { getStoredEmailsForAddress } from '@/utils/storage/storage-keys.js';
import { avatarInitial } from '@/utils/theme/avatar-initials.js';
import { formatDurationRemaining } from '@/utils/time/time-format.js';
import { useCurrentTime } from '@/utils/time/time-store.js';
import type { Address, Email } from '@/utils/types.js';
import { AVATAR_BOX, AVATAR_INK } from '@/utils/ui/avatar-size.js';
import { PORTAL_Z, PORTAL_Z_CLASS } from '@/utils/ui/portal-layers.js';
import { type RowInkRole, rowInk, rowSurface, rowSurfaceState } from '@/utils/ui/row-surface.js';

let {
  account,
  selectedEmail = '',
  isArchived = false,
  onSelectAddress = () => {},
  onToggleAutoExtend = () => {},
  onArchiveAddress = () => {},
  onUnarchiveAddress = () => {},
  onRemoveAddress = () => {},
  onRestoreAddress = () => {},
  onTagAddress = () => {},
  onMarkAllRead = (_account: Address) => {},
  onMarkAllUnread = (_account: Address) => {},
  /** Optional precomputed flags; when omitted, menu loads from storage on open */
  canMarkAllRead = undefined as boolean | undefined,
  canMarkAllUnread = undefined as boolean | undefined,
  /** Optional emails for this account (preferred over storage lookup) */
  accountEmails = undefined as Email[] | undefined,
  /**
   * The row's surface state - ticked in a multi-select list. The card owns no
   * fill, edge or hover wash of its own: `rowSurface` (the shared row contract)
   * decides all three, so a ticked card looks like every other ticked row.
   */
  selected = false,
  draggable = false,
  onDragStart = () => {},
  onDragEnd = () => {},
  onDrop = () => {},
  isDragging = false,
  isDropTarget = false,
  hideInstanceBadge = false,
  /**
   * `buildTagAddressUsage(...)` for the addresses this list shows - the count on
   * each tag chip and the addresses its hover names. Omitted outside the
   * address lists, where a chip then simply shows no count.
   */
  tagUsage = undefined as Record<string, string[]> | undefined,
  /**
   * `buildTagColors(...)` for the addresses this list shows. A tag is one tag
   * regardless of casing, so it is one color: read through `tagColorFor` rather
   * than this address's own `tagColor`, or `banking` and `Banking` paint two
   * different chips. Omitted outside the address lists, where a chip falls back
   * to the color stored on this address.
   */
  tagColors = undefined as Record<string, string> | undefined,
}: {
  account: Address;
  selectedEmail?: string;
  isArchived?: boolean;
  /** Ticked in a multi-select list (the row surface contract). */
  selected?: boolean;
  onSelectAddress?: (address: string) => void;
  onToggleAutoExtend?: (account: Address) => void;
  onArchiveAddress?: (account: Address) => void;
  onUnarchiveAddress?: (account: Address) => void;
  onRemoveAddress?: (address: string) => void;
  onRestoreAddress?: (address: string) => void;
  onTagAddress?: (account: Address) => void;
  onMarkAllRead?: (account: Address) => void;
  onMarkAllUnread?: (account: Address) => void;
  canMarkAllRead?: boolean;
  canMarkAllUnread?: boolean;
  accountEmails?: Email[];
  draggable?: boolean;
  onDragStart?: (e: DragEvent, account: Address) => void;
  onDragEnd?: () => void;
  onDrop?: (e: DragEvent) => void;
  isDragging?: boolean;
  isDropTarget?: boolean;
  hideInstanceBadge?: boolean;
  onEditAddress?: (account: Address) => void;
  isInAvailable?: boolean;
  isInUnavailable?: boolean;
  tagUsage?: Record<string, string[]>;
  tagColors?: Record<string, string>;
} = $props();

// Use shared ticking time store
const timeStore = useCurrentTime();
const currentTime = $derived($timeStore);

const allowUnarchive = $derived(canUnarchive(account));

const isSelected = $derived(
  account.address.trim().toLowerCase() === selectedEmail.trim().toLowerCase()
);

/** This row's surface state, and the ink it carries because of it. */
const surfaceState = $derived(rowSurfaceState({ selected, active: isSelected }));
const ink = (role: RowInkRole) => rowInk(role, surfaceState);

const hasExpiry = $derived(typeof account.expiresAt === 'number' && account.expiresAt > 0);

const remainingMinutes = $derived.by(() => {
  if (!hasExpiry) return 0;
  const expires = account.expiresAt as number;
  const remainingMs = expires - currentTime;
  return Math.max(0, Math.ceil(remainingMs / (60 * 1000)));
});

const expiredAgoMinutes = $derived.by(() => {
  if (!account.expiresAt) return 0;
  const elapsedMs = currentTime - account.expiresAt;
  return Math.max(0, Math.floor(elapsedMs / (60 * 1000)));
});

const isExpired = $derived(isTimeExpired(account, currentTime));

const supportsAutoRenew = $derived.by(() => {
  try {
    const config = loadProviderConfig(account.provider);
    return (
      (config.capabilities?.supportsRenew === true || config.expiry?.renewable === true) &&
      typeof config.expiry?.renewalMethod === 'string' &&
      config.expiry.renewalMethod.length > 0
    );
  } catch {
    /* ignore */
    return false;
  }
});

const isArchivedAddress = $derived(isArchived || isAddressArchived(account));
const isDeletedAddress = $derived(isAddressDeleted(account));

/**
 * Row 2 status line:
 * - Live + auto-renew: renew in Xm
 * - Live + expiry: expires in Xm
 * - Expired + renewable: Expired Xm ago
 * - Expired no renew: Expired (Not renewal) Xm ago
 * - Archived + expired combos
 */
const statusLine = $derived.by(() => {
  const timeLive = formatDurationRemaining(remainingMinutes);
  const timeAgo = formatDurationRemaining(Math.max(expiredAgoMinutes, 1));
  const archived = isArchivedAddress;
  const expired = isExpired;

  if (!hasExpiry) {
    if (isDeletedAddress) return $t('address.statusDeleted');
    if (archived) return $t('address.statusArchived');
    return $t('address.statusLive');
  }
  if (archived && expired) {
    if (!supportsAutoRenew) {
      return $t('address.archivedExpiredNoRenewAgo', { values: { time: timeAgo } });
    }
    return $t('address.archivedExpiredAgo', { values: { time: timeAgo } });
  }
  if (archived && !expired) {
    return $t('address.archivedExpiresIn', { values: { time: timeLive } });
  }
  if (expired) {
    if (!supportsAutoRenew) {
      return $t('address.expiredNoRenewAgo', { values: { time: timeAgo } });
    }
    return $t('address.expiredAgo', { values: { time: timeAgo } });
  }
  if (account.autoExtend && supportsAutoRenew) {
    return $t('address.renewsIn', { values: { time: timeLive } });
  }
  return $t('address.expiresIn', { values: { time: timeLive } });
});

let menuOpen = $state(false);
let liveCanMarkAllRead = $state(false);
let liveCanMarkAllUnread = $state(false);

async function refreshMarkAllState() {
  if (typeof canMarkAllRead === 'boolean' && typeof canMarkAllUnread === 'boolean') {
    liveCanMarkAllRead = canMarkAllRead;
    liveCanMarkAllUnread = canMarkAllUnread;
    return;
  }
  if (accountEmails) {
    const s = getMailboxReadState(accountEmails);
    liveCanMarkAllRead = s.canMarkAllRead;
    liveCanMarkAllUnread = s.canMarkAllUnread;
    return;
  }
  try {
    const bag = await getStoredEmailsForAddress(account.id, account.address);
    const s = getMailboxReadState(bag);
    liveCanMarkAllRead = s.canMarkAllRead;
    liveCanMarkAllUnread = s.canMarkAllUnread;
  } catch {
    /* ignore */
    liveCanMarkAllRead = false;
    liveCanMarkAllUnread = false;
  }
}

$effect(() => {
  void account.address;
  void accountEmails;
  void canMarkAllRead;
  void canMarkAllUnread;
  if (menuOpen) void refreshMarkAllState();
});
let menuPos = $state({ top: 0, left: 0 });
let menuBtnEl = $state<HTMLButtonElement | null>(null);

function closeMenu() {
  menuOpen = false;
}

function toggleMenu(e: MouseEvent) {
  e.stopPropagation();
  e.preventDefault();
  if (menuOpen) {
    menuOpen = false;
    return;
  }
  void refreshMarkAllState();
  const btn = (e.currentTarget as HTMLElement) || menuBtnEl;
  if (btn) {
    const r = btn.getBoundingClientRect();
    const menuW = 168;
    const menuH = 220;
    let left = r.right - menuW;
    let top = r.bottom + 4;
    if (left < 8) left = 8;
    if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
    if (top + menuH > window.innerHeight - 8) top = Math.max(8, r.top - menuH - 4);
    menuPos = { top, left };
  }
  menuOpen = true;
}
</script>

<!-- Col1 mail icon · Col2 address + expiry · Col3 ⋮ menu -->
<div
  class="flex gap-2 items-center min-w-0 min-h-[60px] px-2.5 py-2 density-row transition-colors duration-150 {selected ? 'rounded-lg' : 'rounded-none'} group/item {rowSurface({ selected, active: isSelected })}
  {draggable
    ? 'cursor-move'
    : ''} {isDragging ? 'opacity-50' : ''} {isDropTarget
    ? 'ring-2 ring-inset ring-md-primary drop-target-pulse'
    : ''}"
  role="listitem"
  draggable={draggable}
  ondragstart={(e) => onDragStart(e, account)}
  ondragend={onDragEnd}
  ondragover={(e) => e.preventDefault()}
  ondrop={onDrop}
>
    <!-- 1st column: letter avatar - clickable to select (like AddressesView flip avatar) -->
    <button
      type="button"
      class="relative shrink-0 {AVATAR_BOX.row} rounded-full [perspective:600px] bg-transparent cursor-pointer border-0 p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-md-primary/30"
      aria-label={$t('address.selectEmail')}
      aria-pressed={selected || isSelected}
      onclick={(e) => {
        e.stopPropagation();
        onSelectAddress(account.address);
      }}
    >
      <span class="flip-card block w-full h-full relative transition-transform duration-300 [transform-style:preserve-3d] {selected ? '[transform:rotateY(180deg)]' : ''}">
        <span class="absolute inset-0 [backface-visibility:hidden] rounded-full overflow-hidden">
          <Avatar size="row" letter={avatarInitial(account.address, '?')} email={account.address} />
        </span>
        <span class="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)] rounded-full bg-md-secondary text-md-on-secondary flex items-center justify-center">
          <Icon name="check" class="{AVATAR_INK.row} text-md-on-secondary" />
        </span>
      </span>
      {#if isSelected && !selected}
        <span class="absolute -bottom-0.5 -right-0.5 flex pointer-events-none" aria-hidden="true">
          <Badge
            variant="success"
            size="sm"
            class="{AVATAR_BOX.xs} p-0! justify-center border-0! bg-md-success! text-md-on-success!"
          >
            <Icon name="check" class={AVATAR_INK.sm} />
          </Badge>
        </span>
      {/if}
    </button>

    <!-- 2nd column: address (row1) + expiry/status (row2) -->
    <div class="flex-1 min-w-0 py-0.5">
      <div class="flex items-center gap-1 mb-0.5 min-w-0">
        <button
          id="button-select-inbox-{account.id}"
          type="button"
          class="min-w-0 flex-1 max-w-full text-start cursor-pointer bg-transparent border-0 p-0 overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-md-primary/30 font-bold text-sm leading-tight truncate {ink('primary')}"
          style="direction:ltr;unicode-bidi:isolate;"
          aria-label={$t('address.selectEmail')}
          title={account.address}
          onclick={(e) => { e.stopPropagation(); onSelectAddress(account.address); }}
        >
          {account.address}
        </button>
        {#if isDeletedAddress}
          <span class="text-xs px-1.5 py-0.5 rounded-full bg-md-error/20 text-md-error shrink-0"
            >{$t('common.deleted')}</span
          >
        {/if}
      </div>
      <div class="text-xs {ink('primary')} leading-tight min-w-0">
        <ProviderPill provider={account.provider} instanceUrl={hideInstanceBadge ? undefined : account.instanceUrl} variant="inline" />
      </div>
        <span
          class="block mt-0.5 min-w-0 text-xs leading-tight truncate {selected ? ink('meta') : isExpired ? 'text-md-error' : ink('meta')}"
          title={statusLine}
        >
          {statusLine}
        </span>
      {#if addressTagsList(account).length}
      <div class="flex flex-wrap items-center gap-1 mt-1 min-w-0">
        {#each addressTagsList(account) as tagEntry (tagEntry.name)}
          <TagPill
            tag={tagEntry.name}
            tagColor={tagColorFor(tagColors ?? {}, tagEntry.name) ?? tagEntry.color}
            usage={tagUsageInfo($t, tagUsage ?? {}, tagEntry.name)}
            onClick={() => onTagAddress(account)}
            showIcon={true}
          />
        {/each}
      </div>
      {/if}
    </div>

    <!-- 3rd column: vertical ⋮ menu (fixed menu so overflow:hidden parents don't clip) -->
    <!-- The column raises itself to the card-menu layer while its menu is open,
         so the menu surface (fixed, also PORTAL_Z.accountMenu) is above every
         sibling card instead of behind the next row. -->
    <div
      class="relative shrink-0 self-center"
      style="z-index: {menuOpen ? PORTAL_Z.accountMenu : 1};"
    >
      <button
        id="button-account-menu-{account.id}"
        type="button"
        bind:this={menuBtnEl}
        class="flex items-center justify-center p-0.5 rounded-full border-0 bg-transparent hover:bg-md-surface-variant/40 active:bg-md-surface-variant/60 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-md-primary/30 {ink('icon')}"
        aria-label={$t('address.moreActions')}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onclick={toggleMenu}
      >
        <Icon name="moreVert" class="w-5 h-5" />
      </button>
      {#if menuOpen}
        <button
          type="button"
          class="fixed inset-0 {PORTAL_Z_CLASS.navMenu} cursor-default bg-transparent border-0"
          aria-label={$t('common.close')}
          onclick={(e) => {
            e.stopPropagation();
            closeMenu();
          }}
        ></button>
        <MenuList
          floating={{ anchor: () => menuBtnEl, placement: 'bottom-end', onClose: closeMenu }}
          class="fixed {PORTAL_Z_CLASS.accountMenu} min-w-[148px]"
          role="menu"
          ariaLabel={$t('address.moreActions')}
          style="top: {menuPos.top}px; left: {menuPos.left}px;"
        >
          {#if isArchivedAddress}
            <button
              type="button"
              id="button-unarchive-{account.id}"
              role="menuitem"
              class="menu-list-item w-full flex items-center gap-3 px-3 min-h-12 text-sm text-start {allowUnarchive ? '' : 'is-disabled'}"
              disabled={!allowUnarchive}
              aria-disabled={!allowUnarchive}
              title={allowUnarchive
                ? $t('common.unarchive')
                : $t('address.unarchiveNotAvailable')}
              onclick={(e) => {
                e.stopPropagation();
                if (!allowUnarchive) return;
                closeMenu();
                onUnarchiveAddress(account);
              }}
            >
              <Icon name="archive" class="w-3.5 h-3.5" />
              {$t('common.unarchive')}
            </button>
          {:else if !isDeletedAddress}
            <button
              type="button"
              id="button-archive-{account.id}"
              role="menuitem"
              class="menu-list-item w-full flex items-center gap-3 px-3 min-h-12 text-sm text-start"
              onclick={(e) => {
                e.stopPropagation();
                closeMenu();
                onArchiveAddress(account);
              }}
            >
              <Icon name="archive" class="w-3.5 h-3.5" />
              {$t('common.archive')}
            </button>
          {/if}
          {#if isDeletedAddress}
            <button
              type="button"
              id="button-restore-{account.id}"
              role="menuitem"
              class="menu-list-item w-full flex items-center gap-3 px-3 min-h-12 text-sm text-start"
              onclick={(e) => {
                e.stopPropagation();
                closeMenu();
                onRestoreAddress(account.address);
              }}
            >
              <Icon name="refresh" class="w-3.5 h-3.5" />
              {$t('common.restore')}
            </button>
          {:else}
            <button
              type="button"
              id="button-delete-{account.id}"
              role="menuitem"
              class="menu-list-item w-full flex items-center gap-3 px-3 min-h-12 text-sm text-start is-danger"
              onclick={(e) => {
                e.stopPropagation();
                closeMenu();
                onRemoveAddress(account.address);
              }}
            >
              <Icon name="delete" class="w-3.5 h-3.5" />
              {$t('common.delete')}
            </button>
          {/if}
          <button
            type="button"
            role="menuitem"
            class="menu-list-item w-full flex items-center gap-3 px-3 min-h-12 text-sm text-start"
            onclick={(e) => {
              e.stopPropagation();
              closeMenu();
              onTagAddress(account);
            }}
          >
            <Icon name="add" class="w-3.5 h-3.5" />
            {$t('common.addTag')}
          </button>
          {#if supportsAutoRenew && !isDeletedAddress}
            <button
              type="button"
              role="menuitem"
              class="menu-list-item w-full flex items-center gap-3 px-3 min-h-12 text-sm text-start"
              onclick={(e) => {
                e.stopPropagation();
                closeMenu();
                onToggleAutoExtend(account);
              }}
            >
              <Icon name="autoRenew" class="w-3.5 h-3.5" />
              {$t('address.toggleAutoRenew')}
            </button>
          {/if}
          <button
            type="button"
            role="menuitem"
            class="menu-list-item w-full flex items-center gap-3 px-3 min-h-12 text-sm text-start {liveCanMarkAllRead ? '' : 'is-disabled'}"
            disabled={!liveCanMarkAllRead}
            aria-disabled={!liveCanMarkAllRead}
            onclick={(e) => {
              e.stopPropagation();
              if (!liveCanMarkAllRead) return;
              closeMenu();
              onMarkAllRead(account);
            }}
          >
            <Icon name="mark_email_read" class="w-3.5 h-3.5" />
            {$t('addressView.markAllRead')}
          </button>
          <button
            type="button"
            role="menuitem"
            class="menu-list-item w-full flex items-center gap-3 px-3 min-h-12 text-sm text-start {liveCanMarkAllUnread ? '' : 'is-disabled'}"
            disabled={!liveCanMarkAllUnread}
            aria-disabled={!liveCanMarkAllUnread}
            onclick={(e) => {
              e.stopPropagation();
              if (!liveCanMarkAllUnread) return;
              closeMenu();
              onMarkAllUnread(account);
            }}
          >
            <Icon name="mark_email_unread" class="w-3.5 h-3.5" />
            {$t('addressView.markAllUnread')}
          </button>
        </MenuList>
      {/if}
    </div>
</div>
