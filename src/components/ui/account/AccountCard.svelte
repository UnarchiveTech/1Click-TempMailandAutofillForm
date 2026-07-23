<script lang="ts">
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import Icon from '@/components/icons/Icon.svelte';
import TagPill from '@/components/ui/TagPill.svelte';
import { accountTagsList } from '@/utils/account-tags.js';
import { loadProviderConfig } from '@/utils/email-service.js';
import { getMailboxReadState } from '@/utils/mailbox-read-state.js';
import { useCurrentTime } from '@/utils/time-store.js';
import type { Account, Email } from '@/utils/types.js';

let {
  account,
  selectedEmail = '',
  isArchived = false,
  onSelectAccount = () => {},
  onToggleAutoExtend = () => {},
  onArchiveAccount = () => {},
  onUnarchiveAccount = () => {},
  onRemoveAccount = () => {},
  onRestoreAccount = () => {},
  onTagAccount = () => {},
  onMarkAllRead = (_account: Account) => {},
  onMarkAllUnread = (_account: Account) => {},
  /** Optional precomputed flags; when omitted, menu loads from storage on open */
  canMarkAllRead = undefined as boolean | undefined,
  canMarkAllUnread = undefined as boolean | undefined,
  /** Optional emails for this account (preferred over storage lookup) */
  accountEmails = undefined as Email[] | undefined,
  draggable = false,
  onDragStart = () => {},
  onDragEnd = () => {},
  onDrop = () => {},
  isDragging = false,
  isDropTarget = false,
  // Optional parent-compat props (not used in this layout)
  onEditAccount: _onEditAccount = () => {},
  isInAvailable: _isInAvailable = false,
  isInUnavailable: _isInUnavailable = false,
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
  onMarkAllRead?: (account: Account) => void;
  onMarkAllUnread?: (account: Account) => void;
  canMarkAllRead?: boolean;
  canMarkAllUnread?: boolean;
  accountEmails?: Email[];
  isInAvailable?: boolean;
  isInUnavailable?: boolean;
  draggable?: boolean;
  onDragStart?: (e: DragEvent, account: Account) => void;
  onDragEnd?: () => void;
  onDrop?: (e: DragEvent) => void;
  isDragging?: boolean;
  isDropTarget?: boolean;
}>();
// Keep named bindings referenced so props stay accepted without unused-local noise
$effect(() => {
  void _onEditAccount;
  void _isInAvailable;
  void _isInUnavailable;
});

// Use shared time store
const timeStore = useCurrentTime();
let currentTime = $state(timeStore.currentTime);

$effect(() => {
  const unsubscribe = timeStore.subscribe(() => {
    currentTime = timeStore.currentTime;
  });
  return unsubscribe;
});

function formatTimeRemaining(minutes: number): string {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

const remainingMinutes = $derived.by(() => {
  const expires = account.expiresAt || currentTime + 1000;
  const remainingMs = expires - currentTime;
  return Math.max(0, Math.ceil(remainingMs / (60 * 1000)));
});

const expiredAgoMinutes = $derived.by(() => {
  if (!account.expiresAt) return 0;
  const elapsedMs = currentTime - account.expiresAt;
  return Math.max(0, Math.floor(elapsedMs / (60 * 1000)));
});

const isExpired = $derived(!!account.expiresAt && currentTime >= account.expiresAt);

const supportsAutoRenew = $derived.by(() => {
  try {
    const config = loadProviderConfig(account.provider);
    return config.capabilities?.supportsRenew ?? config.expiry?.renewable ?? false;
  } catch {
    return false;
  }
});

const isArchivedAccount = $derived(
  isArchived || account.accountStatus === 'archived' || account.status === 'archived'
);
const isDeletedAccount = $derived(
  account.accountStatus === 'deleted' || account.status === 'deleted'
);

/**
 * Row 2 status line:
 * - Live + auto-renew: renew in Xm
 * - Live + expiry: expires in Xm
 * - Expired + renewable: Expired Xm ago
 * - Expired no renew: Expired (Not renewal) Xm ago
 * - Archived + expired combos
 */
const statusLine = $derived.by(() => {
  const timeLive = formatTimeRemaining(remainingMinutes);
  const timeAgo = formatTimeRemaining(Math.max(expiredAgoMinutes, 1));
  const archived = isArchivedAccount;
  const expired = isExpired || account.status === 'expired';

  if (archived && expired) {
    if (!supportsAutoRenew) {
      return $t('account.archivedExpiredNoRenewAgo', { values: { time: timeAgo } });
    }
    return $t('account.archivedExpiredAgo', { values: { time: timeAgo } });
  }
  if (archived && !expired) {
    return $t('account.archivedExpiresIn', { values: { time: timeLive } });
  }
  if (expired) {
    if (!supportsAutoRenew) {
      return $t('account.expiredNoRenewAgo', { values: { time: timeAgo } });
    }
    return $t('account.expiredAgo', { values: { time: timeAgo } });
  }
  if (account.autoExtend && supportsAutoRenew) {
    return $t('account.renewsIn', { values: { time: timeLive } });
  }
  return $t('account.expiresIn', { values: { time: timeLive } });
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
    const res = (await browser.storage.local.get(['storedEmails'])) as {
      storedEmails?: Record<string, Email[]>;
    };
    const bag = res.storedEmails?.[account.address] || [];
    const s = getMailboxReadState(bag);
    liveCanMarkAllRead = s.canMarkAllRead;
    liveCanMarkAllUnread = s.canMarkAllUnread;
  } catch {
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
  class="flex gap-2 items-center min-w-0 px-2 py-1.5 bg-md-surface-container-highest rounded-xl group/item overflow-hidden {draggable
    ? 'cursor-move'
    : ''} {isDragging ? 'opacity-50' : ''} {isDropTarget
    ? 'border-2 border-md-primary drop-target-pulse'
    : ''}"
  role="listitem"
  draggable={draggable}
  ondragstart={(e) => onDragStart(e, account)}
  ondragend={onDragEnd}
  ondragover={(e) => e.preventDefault()}
  ondrop={onDrop}
>
    <!-- 1st column: mail icon -->
    <div
      class="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center {selectedEmail ===
      account.address
        ? 'bg-md-primary/15 text-md-primary'
        : 'bg-md-surface-variant/60 text-md-on-surface/55'}"
      aria-hidden="true"
    >
      <Icon name="mail" class="w-4 h-4" />
    </div>

    <!-- 2nd column: address (row1) + expiry/status (row2) -->
    <div class="flex flex-col gap-0.5 flex-1 min-w-0">
      <div class="flex items-center gap-1 min-w-0">
        <button
          id="button-select-inbox-{account.id}"
          type="button"
          class="min-w-0 max-w-full text-start cursor-pointer bg-transparent border-0 p-0 overflow-hidden focus:outline-none focus:ring-2 focus:ring-md-primary/20 rounded font-semibold text-sm truncate {selectedEmail ===
          account.address
            ? 'text-md-primary'
            : 'text-md-on-surface'}"
          style="direction:ltr;unicode-bidi:isolate;"
          aria-label={$t('account.selectEmail')}
          onclick={() => onSelectAccount(account.address)}
        >
          {account.address}
        </button>
        {#if isDeletedAccount}
          <span class="text-xs px-1.5 py-0.5 rounded-full bg-md-error/20 text-md-error shrink-0"
            >{$t('common.deleted')}</span
          >
        {/if}
      </div>
      <div class="flex items-center gap-1.5 min-w-0">
        <span
          class="text-xs font-medium truncate {isExpired
            ? 'text-md-error/80'
            : account.autoExtend && supportsAutoRenew
              ? 'text-md-primary/80'
              : 'text-md-on-surface/55'}"
        >
          {statusLine}
        </span>
        {#each accountTagsList(account) as tagEntry (tagEntry.name)}
          <TagPill
            tag={tagEntry.name}
            tagColor={tagEntry.color}
            onClick={() => onTagAccount(account)}
            showIcon={false}
          />
        {/each}
      </div>
    </div>

    <!-- 3rd column: vertical ⋮ menu (fixed menu so overflow:hidden parents don't clip) -->
    <div class="relative shrink-0 self-center" style="z-index: {menuOpen ? 120 : 1};">
      <button
        id="button-account-menu-{account.id}"
        type="button"
        bind:this={menuBtnEl}
        class="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-md-surface-variant/70 transition-colors text-md-on-surface/60"
        aria-label={$t('account.moreActions')}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onclick={toggleMenu}
      >
        <Icon name="moreVertical" class="w-4 h-4" />
      </button>
      {#if menuOpen}
        <button
          type="button"
          class="fixed inset-0 z-[110] cursor-default bg-transparent border-0"
          aria-label={$t('common.close')}
          onclick={(e) => {
            e.stopPropagation();
            closeMenu();
          }}
        ></button>
        <div
          class="fixed z-[120] min-w-[148px] rounded-xl border border-md-outline-variant bg-md-surface-container shadow-2xl overflow-hidden py-1"
          role="menu"
          style="top: {menuPos.top}px; left: {menuPos.left}px;"
        >
          {#if isArchivedAccount}
            <button
              type="button"
              id="button-unarchive-{account.id}"
              role="menuitem"
              class="w-full flex items-center gap-2 px-3 py-2 text-start text-xs hover:bg-md-surface-variant text-md-on-surface"
              onclick={(e) => {
                e.stopPropagation();
                closeMenu();
                onUnarchiveAccount(account);
              }}
            >
              <Icon name="archive" class="w-3.5 h-3.5" />
              {$t('common.unarchive')}
            </button>
          {:else if !isDeletedAccount}
            <button
              type="button"
              id="button-archive-{account.id}"
              role="menuitem"
              class="w-full flex items-center gap-2 px-3 py-2 text-start text-xs hover:bg-md-surface-variant text-md-on-surface"
              onclick={(e) => {
                e.stopPropagation();
                closeMenu();
                onArchiveAccount(account);
              }}
            >
              <Icon name="archive" class="w-3.5 h-3.5" />
              {$t('common.archive')}
            </button>
          {/if}
          {#if isDeletedAccount}
            <button
              type="button"
              id="button-restore-{account.id}"
              role="menuitem"
              class="w-full flex items-center gap-2 px-3 py-2 text-start text-xs hover:bg-md-surface-variant text-md-on-surface"
              onclick={(e) => {
                e.stopPropagation();
                closeMenu();
                onRestoreAccount(account.address);
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
              class="w-full flex items-center gap-2 px-3 py-2 text-start text-xs hover:bg-md-error/10 text-md-error"
              onclick={(e) => {
                e.stopPropagation();
                closeMenu();
                onRemoveAccount(account.address);
              }}
            >
              <Icon name="trash" class="w-3.5 h-3.5" />
              {$t('common.delete')}
            </button>
          {/if}
          <button
            type="button"
            role="menuitem"
            class="w-full flex items-center gap-2 px-3 py-2 text-start text-xs hover:bg-md-surface-variant text-md-on-surface"
            onclick={(e) => {
              e.stopPropagation();
              closeMenu();
              onTagAccount(account);
            }}
          >
            <Icon name="tag" class="w-3.5 h-3.5" />
            {$t('common.addTag')}
          </button>
          {#if supportsAutoRenew && !isDeletedAccount}
            <button
              type="button"
              role="menuitem"
              class="w-full flex items-center gap-2 px-3 py-2 text-start text-xs hover:bg-md-surface-variant text-md-on-surface"
              onclick={(e) => {
                e.stopPropagation();
                closeMenu();
                onToggleAutoExtend(account);
              }}
            >
              <Icon name="autoRenew" class="w-3.5 h-3.5" />
              {$t('account.toggleAutoRenew')}
            </button>
          {/if}
          <button
            type="button"
            role="menuitem"
            class="w-full flex items-center gap-2 px-3 py-2 text-start text-xs
              {liveCanMarkAllRead
                ? 'hover:bg-md-surface-variant text-md-on-surface'
                : 'text-md-on-surface/35 cursor-not-allowed'}"
            disabled={!liveCanMarkAllRead}
            aria-disabled={!liveCanMarkAllRead}
            onclick={(e) => {
              e.stopPropagation();
              if (!liveCanMarkAllRead) return;
              closeMenu();
              onMarkAllRead(account);
            }}
          >
            <Icon name="checkCircle" class="w-3.5 h-3.5" />
            {$t('emailDetail.markAllRead')}
          </button>
          <button
            type="button"
            role="menuitem"
            class="w-full flex items-center gap-2 px-3 py-2 text-start text-xs
              {liveCanMarkAllUnread
                ? 'hover:bg-md-surface-variant text-md-on-surface'
                : 'text-md-on-surface/35 cursor-not-allowed'}"
            disabled={!liveCanMarkAllUnread}
            aria-disabled={!liveCanMarkAllUnread}
            onclick={(e) => {
              e.stopPropagation();
              if (!liveCanMarkAllUnread) return;
              closeMenu();
              onMarkAllUnread(account);
            }}
          >
            <Icon name="mail" class="w-3.5 h-3.5" />
            {$t('emailDetail.markAllUnread')}
          </button>
        </div>
      {/if}
    </div>
</div>
