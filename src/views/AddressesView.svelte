<script lang="ts">
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import Icon from '@/components/icons/Icon.svelte';
import SearchBar from '@/components/ui/composites/SearchBar.svelte';
import DragHint from '@/components/ui/DragHint.svelte';
import FaviconImage from '@/components/ui/FaviconImage.svelte';
import { canUnarchive } from '@/features/inbox/inbox-management.js';
import { loadProviderConfig } from '@/utils/email-service.js';
import { getMailboxReadState } from '@/utils/mailbox-read-state.js';
import {
  collectIntersectingIds,
  isInteractiveTarget,
  MARQUEE_THRESHOLD,
  normalizeMarquee,
} from '@/utils/marquee-selection.js';
import { isMarqueeSelectionEnabled } from '@/utils/marquee-settings.js';
import { getDomainAvatarStack } from '@/utils/sender-avatars.js';
import { formatTimeLeft } from '@/utils/time.js';
import type { Account, Email } from '@/utils/types.js';

const MAX_AVATARS = 4;

type StatusPill = 'live' | 'expired' | 'archived' | 'deleted';

function getStatusPill(account: Account): StatusPill {
  if (account.accountStatus === 'deleted' || account.status === 'deleted') return 'deleted';
  if (account.accountStatus === 'archived' || account.status === 'archived') return 'archived';
  if (account.status === 'expired' || (account.expiresAt > 0 && account.expiresAt <= Date.now())) {
    return 'expired';
  }
  return 'live';
}

function statusPillClass(pill: StatusPill): string {
  switch (pill) {
    case 'live':
      return 'bg-md-success/15 text-md-success';
    case 'expired':
      return 'bg-md-warning/15 text-md-warning';
    case 'archived':
      return 'bg-md-primary/15 text-md-primary';
    case 'deleted':
      return 'bg-md-error/15 text-md-error';
  }
}

function statusPillLabel(pill: StatusPill): string {
  switch (pill) {
    case 'live':
      return 'mailManagement.live';
    case 'expired':
      return 'mailManagement.expiredStatus';
    case 'archived':
      return 'common.archived';
    case 'deleted':
      return 'common.deleted';
  }
}

function expiryLabel(account: Account, now: number): string | null {
  if (!account.expiresAt || account.expiresAt <= 0) return null;
  const left = account.expiresAt - now;
  if (left <= 0) return null; // status pill already shows expired
  return formatTimeLeft(left);
}

/** Expiry line: auto-renew vs plain expiry (renewable providers only). */
function expiryCaption(
  account: Account,
  now: number
): { key: string; values: Record<string, string | number> } | null {
  if (!account.expiresAt || account.expiresAt <= 0) return null;
  const left = account.expiresAt - now;
  if (left <= 0) return null;
  const time = formatTimeLeft(left);
  let renewable = false;
  try {
    const cfg = loadProviderConfig(account.provider);
    renewable = !!(cfg.expiry?.renewable || cfg.capabilities?.supportsRenew);
  } catch {
    renewable = false;
  }
  if (renewable && account.autoExtend) {
    const n = (account as Account & { renewalCount?: number }).renewalCount ?? 0;
    if (n <= 0) {
      // Enabled but has not renewed yet — renewal only after full expiry
      return { key: 'mailManagement.autoRenewAfterExpiry', values: { time } };
    }
    return {
      key: 'mailManagement.autoRenewInNth',
      values: { time, n },
    };
  }
  if (renewable && !account.autoExtend) {
    return { key: 'mailManagement.expiresInAutoRenewDisabled', values: { time } };
  }
  return { key: 'mailManagement.expiresIn', values: { time } };
}

function asEmailList(v: unknown): Email[] {
  return Array.isArray(v) ? (v as Email[]) : [];
}

function unreadCount(emails: unknown): number {
  return asEmailList(emails).filter((e) => e.unread).length;
}

/** Domain-ranked avatar stack (1-day volume, fall back to full history). */
function getSenderAvatars(emails: unknown): {
  senders: { email: string; letter: string; domain?: string }[];
  remainder: number;
} {
  return getDomainAvatarStack(asEmailList(emails), MAX_AVATARS);
}

let {
  context = 'popup',
  onBack = () => {},
  mgmtTab = 'active',
  mgmtSearch = '',
  selectedAddresses = new Set(),
  mgmtAccounts = [],
  allAccounts = [] as Account[],
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
  onMarkSelectedRead = () => {},
  onMarkSelectedUnread = () => {},
  onTagSelected = () => {},
  onOpenEmailDetail = () => {},
  onArchiveAccount = () => {},
  onUnarchiveAccount = () => {},
  onDeleteAccounts = (_accounts: Account[]) => {},
  onExportAccountEmails = () => {},
  onGenerateNewAddress = () => {},
  onEditAccount = () => {},
  onExtendAccount = () => {},
  onToggleAutoExtend = (_account: Account) => {},
  onTagAccount = (_account: Account) => {},
  onMarkAccountAllRead = (_account: Account) => {},
  onMarkAccountAllUnread = (_account: Account) => {},
  onReorderAccounts = (_sourceId: string, _targetId: string) => {},
  highlightAddress = null as string | null,
} = $props<{
  context?: 'popup' | 'sidepanel' | 'app';
  onBack?: () => void;
  mgmtTab?: string;
  mgmtSearch?: string;
  selectedAddresses?: Set<string>;
  mgmtAccounts?: Account[];
  /** Full inbox list (unfiltered) for Live / Inactive tab counts */
  allAccounts?: Account[];
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
  onMarkSelectedRead?: () => void;
  onMarkSelectedUnread?: () => void;
  onTagSelected?: () => void;
  onOpenEmailDetail?: (account: Account) => void;
  onArchiveAccount?: (account: Account) => void;
  onUnarchiveAccount?: (account: Account) => void;
  /** Delete specific accounts (avoids selection Set race on drag-drop) */
  onDeleteAccounts?: (accounts: Account[]) => void;
  onExportAccountEmails?: (account: Account) => void;
  onGenerateNewAddress?: () => void;
  onEditAccount?: (account: Account) => void;
  onExtendAccount?: (account: Account) => void;
  onToggleAutoExtend?: (account: Account) => void;
  onTagAccount?: (account: Account) => void;
  onMarkAccountAllRead?: (account: Account) => void;
  onMarkAccountAllUnread?: (account: Account) => void;
  /** Reorder by stable account id (not filtered list index) */
  onReorderAccounts?: (sourceId: string, targetId: string) => void;
  /** Newly created address to highlight */
  highlightAddress?: string | null;
}>();

let draggedAccountId = $state<string | null>(null);
let dropTargetAccountId = $state<string | null>(null);
let dragHintDismissed = $state(false);
let listRootEl = $state<HTMLElement | null>(null);
let rowMenuOpenId = $state<string | null>(null);
let rowMenuPos = $state({ top: 0, left: 0 });
let marqueeActive = $state(false);
let marqueeStart = $state<{ x: number; y: number } | null>(null);
let marqueeRect = $state<{ left: number; top: number; right: number; bottom: number } | null>(null);
let marqueePrefEnabled = $state(true);
let addressListCount = $state(0);

/** Local filter panel (Addresses page) */
let filterMenuOpen = $state(false);
type DateRangeFilter = 'any' | '7' | '30' | '90';
let filterDateRange = $state<DateRangeFilter>('any');
let filterAutoRenew = $state(false);
let filterHasTags = $state(false);

let hasActiveExtraFilters = $derived(filterDateRange !== 'any' || filterAutoRenew || filterHasTags);

function accountCreatedAt(account: Account): number {
  const a = account as Account & { createdAt?: number; created?: number };
  if (typeof a.createdAt === 'number' && a.createdAt > 0) return a.createdAt;
  if (typeof a.created === 'number' && a.created > 0) return a.created;
  // Fallback: treat as old if no timestamp (still show unless date filter is tight)
  return 0;
}

let displayedAccounts = $derived.by((): Account[] => {
  let list = mgmtAccounts as Account[];
  if (filterAutoRenew) {
    list = list.filter((a) => !!a.autoExtend);
  }
  if (filterHasTags) {
    list = list.filter(
      (a) =>
        !!(a.tag && String(a.tag).trim()) ||
        (Array.isArray(a.tags) && a.tags.some((t) => t?.name?.trim()))
    );
  }
  if (filterDateRange !== 'any') {
    const days = Number(filterDateRange);
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    list = list.filter((a) => {
      const t = accountCreatedAt(a);
      // Unknown creation time: keep when filter is on (don't hide everything)
      if (!t) return true;
      return t >= cutoff;
    });
  }
  return list;
});

function clearAddressFilters() {
  filterDateRange = 'any';
  filterAutoRenew = false;
  filterHasTags = false;
}

$effect(() => {
  // Parent filtered list length is reflected by data-marquee-id nodes after paint
  void mgmtTab;
  queueMicrotask(() => {
    addressListCount = listRootEl?.querySelectorAll('[data-marquee-id]').length || 0;
  });
});

$effect(() => {
  void isMarqueeSelectionEnabled().then((v) => {
    marqueePrefEnabled = v;
  });
  const onStorage = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local' || !changes.marqueeSelectionEnabled) return;
    marqueePrefEnabled = changes.marqueeSelectionEnabled.newValue !== false;
  };
  try {
    browser.storage.onChanged.addListener(onStorage);
    return () => browser.storage.onChanged.removeListener(onStorage);
  } catch {
    return;
  }
});

function onAddressesMarqueeDown(e: PointerEvent) {
  if (!marqueePrefEnabled || e.button !== 0) return;
  if (addressListCount === 0) return;
  if (isInteractiveTarget(e.target)) return;
  marqueeStart = { x: e.clientX, y: e.clientY };
  marqueeActive = false;
  marqueeRect = null;
  const onMove = (ev: PointerEvent) => {
    if (!marqueeStart) return;
    const dx = Math.abs(ev.clientX - marqueeStart.x);
    const dy = Math.abs(ev.clientY - marqueeStart.y);
    if (!marqueeActive && dx < MARQUEE_THRESHOLD && dy < MARQUEE_THRESHOLD) return;
    marqueeActive = true;
    marqueeRect = normalizeMarquee(marqueeStart, { x: ev.clientX, y: ev.clientY });
    if (listRootEl) {
      const ids = collectIntersectingIds(listRootEl, '[data-marquee-id]', marqueeRect);
      selectionMode = ids.length > 0;
      // Sync parent selection set: toggle to match marquee
      const want = new Set(ids);
      for (const id of [...selectedAddresses]) {
        if (!want.has(id)) onToggleSelect(id);
      }
      for (const id of want) {
        if (!selectedAddresses.has(id)) onToggleSelect(id);
      }
    }
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    marqueeStart = null;
    marqueeActive = false;
    marqueeRect = null;
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function openRowMenu(e: MouseEvent, accountId: string) {
  e.stopPropagation();
  e.preventDefault();
  if (rowMenuOpenId === accountId) {
    rowMenuOpenId = null;
    return;
  }
  const btn = e.currentTarget as HTMLElement;
  const r = btn.getBoundingClientRect();
  const menuW = 200;
  const menuH = 320;
  // Leave room for floating footer nav (~72px) so menu never sits under it
  const bottomSafe = 80;
  let left = r.right - menuW;
  let top = r.bottom + 4;
  if (left < 8) left = 8;
  if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
  if (top + menuH > window.innerHeight - bottomSafe) {
    top = Math.max(8, r.top - menuH - 4);
  }
  if (top + menuH > window.innerHeight - bottomSafe) {
    top = Math.max(8, window.innerHeight - menuH - bottomSafe);
  }
  rowMenuPos = { top, left };
  rowMenuOpenId = accountId;
}

function closeRowMenu() {
  rowMenuOpenId = null;
}

function supportsRenew(account: Account): boolean {
  try {
    const cfg = loadProviderConfig(account.provider);
    return !!(cfg.expiry?.renewable || cfg.capabilities?.supportsRenew);
  } catch {
    return !!(account as Account & { providerConfig?: { expiry?: { renewable?: boolean } } })
      .providerConfig?.expiry?.renewable;
  }
}

let unarchiveForRenewPrompt = $state<Account | null>(null);

function handleAutoRenewClick(account: Account) {
  closeRowMenu();
  const archived = account.accountStatus === 'archived' || account.status === 'archived';
  if (archived) {
    unarchiveForRenewPrompt = account;
    return;
  }
  onToggleAutoExtend(account);
}

function confirmUnarchiveThenRenew() {
  const acc = unarchiveForRenewPrompt;
  unarchiveForRenewPrompt = null;
  if (!acc) return;
  onUnarchiveAccount(acc);
  // Enable auto-renew after unarchive (next tick so storage settles)
  setTimeout(() => {
    if (!acc.autoExtend) onToggleAutoExtend(acc);
  }, 120);
}

// Scroll newly created address into view when highlighted
$effect(() => {
  if (!highlightAddress || !listRootEl) return;
  const safe = highlightAddress.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const el = listRootEl.querySelector<HTMLElement>(`[data-address="${safe}"]`);
  el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

/** Hold-to-select (same pattern as Inbox / Identities) */
let selectionMode = $state(false);
let holdTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** After a successful long-press, ignore the following click (would toggle off). */
let suppressClickUntil = 0;

function startHold(id: string) {
  if (selectionMode || mgmtSearch) return;
  holdTimers.set(
    id,
    setTimeout(() => {
      selectionMode = true;
      if (!selectedAddresses.has(id)) onToggleSelect(id);
      // Block click/pointerup-driven toggles for a short window
      suppressClickUntil = Date.now() + 400;
      holdTimers.delete(id);
    }, 500)
  );
}

function cancelHold(id: string) {
  const t = holdTimers.get(id);
  if (t !== undefined) {
    clearTimeout(t);
    holdTimers.delete(id);
  }
}

function shouldSuppressClick(): boolean {
  return Date.now() < suppressClickUntil;
}

function exitSelectionMode() {
  selectionMode = false;
  // Clear all selections via parent toggles
  for (const id of [...selectedAddresses]) {
    onToggleSelect(id);
  }
}

function handleAccountDragHintDismiss(): void {
  dragHintDismissed = true;
}

function handleAccountDragStart(e: DragEvent, accountId: string) {
  // Allow drag while multi-selecting so selection-strip drop targets work
  if (mgmtSearch && !selectionMode) {
    e.preventDefault();
    return;
  }
  draggedAccountId = accountId;
  dragHintDismissed = true;
  // Ensure dragged row is part of selection when multi-select is active
  if (selectionMode && !selectedAddresses.has(accountId)) {
    onToggleSelect(accountId);
  }
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'copyMove';
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
  // Resolve by id in parent against full storage list (not filtered mgmtAccounts indices)
  onReorderAccounts(sourceId, targetId);
}

function handleAccountDragEnd() {
  draggedAccountId = null;
  dropTargetAccountId = null;
}

function isInactiveAccount(a: Account): boolean {
  return a.status !== 'active' || a.accountStatus === 'archived' || a.accountStatus === 'deleted';
}

let liveCount = $derived(
  (Array.isArray(allAccounts) ? allAccounts : []).filter((a: Account) => !isInactiveAccount(a))
    .length
);
let inactiveCount = $derived(
  (Array.isArray(allAccounts) ? allAccounts : []).filter((a: Account) => isInactiveAccount(a))
    .length
);
let tabDropTarget = $state<'live' | 'inactive' | null>(null);
let crossTabPrompt = $state<{
  direction: 'toInactive' | 'toLive';
  accounts: Account[];
} | null>(null);

// Auto-exit selection when empty
$effect(() => {
  if (selectionMode && selectedAddresses.size === 0) {
    selectionMode = false;
  }
});

function accountsForDrag(sourceId: string): Account[] {
  // If multi-selected and source is in selection, move all selected; else just source
  if (selectionMode && selectedAddresses.size > 0 && selectedAddresses.has(sourceId)) {
    return mgmtAccounts.filter((a: Account) => selectedAddresses.has(a.id));
  }
  const one =
    mgmtAccounts.find((a: Account) => a.id === sourceId) ||
    allAccounts.find((a: Account) => a.id === sourceId);
  return one ? [one] : [];
}

function handleTabDragOver(e: DragEvent, tab: 'live' | 'inactive') {
  if (!draggedAccountId) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  tabDropTarget = tab;
}

function handleTabDragLeave(tab: 'live' | 'inactive') {
  if (tabDropTarget === tab) tabDropTarget = null;
}

function handleTabDrop(e: DragEvent, tab: 'live' | 'inactive') {
  e.preventDefault();
  tabDropTarget = null;
  const sourceId = draggedAccountId || e.dataTransfer?.getData('text/plain');
  draggedAccountId = null;
  dropTargetAccountId = null;
  if (!sourceId) return;
  const accounts = accountsForDrag(sourceId);
  if (accounts.length === 0) return;

  const fromLive = mgmtTab === 'active';
  if (tab === 'inactive' && fromLive) {
    crossTabPrompt = { direction: 'toInactive', accounts };
  } else if (tab === 'live' && !fromLive) {
    crossTabPrompt = { direction: 'toLive', accounts };
  }
}

function applyToInactive(action: 'archive' | 'delete') {
  const accounts = crossTabPrompt?.accounts || [];
  crossTabPrompt = null;
  if (accounts.length === 0) return;
  // Per-account / explicit-id handlers avoid racing parent selection Set updates
  if (action === 'archive') {
    for (const a of accounts) onArchiveAccount(a);
  } else {
    onDeleteAccounts(accounts);
  }
  exitSelectionMode();
}

function applyToLive(action: 'unarchive' | 'renew') {
  const accounts = crossTabPrompt?.accounts || [];
  crossTabPrompt = null;
  if (accounts.length === 0) return;
  if (action === 'unarchive') {
    for (const a of accounts) {
      if (
        a.accountStatus === 'archived' ||
        a.status === 'archived' ||
        a.accountStatus === 'deleted'
      ) {
        onUnarchiveAccount(a);
      }
    }
  } else {
    for (const a of accounts) {
      onExtendAccount(a);
    }
  }
  exitSelectionMode();
}

function anyArchived(accounts: Account[]): boolean {
  return accounts.some(
    (a) =>
      a.accountStatus === 'archived' ||
      a.accountStatus === 'deleted' ||
      a.status === 'archived' ||
      a.status === 'deleted'
  );
}
function anyRenewable(accounts: Account[]): boolean {
  return accounts.some(
    (a) => a.status === 'expired' || (a.expiresAt != null && a.expiresAt <= Date.now())
  );
}
</script>

<div class="flex flex-col h-full relative min-h-0">
<!-- Tabs - match AccountSelector Live / Inactive design (also drop targets for cross-tab drag) -->
<div class="flex gap-1 px-0 pt-3 pb-2 shrink-0" data-tour="manage-tabs">
  <div class="flex gap-1 p-1 rounded-full bg-md-surface-variant flex-1">
    <button
      type="button"
      class="flex-none min-w-[100px] flex items-center justify-center gap-2 px-3 py-1 rounded-full transition-all duration-200 {mgmtTab === 'active' ? 'bg-md-surface shadow-sm' : ''} {tabDropTarget === 'live' ? 'ring-2 ring-md-primary' : ''}"
      onclick={() => onTabChange('active')}
      ondragover={(e) => handleTabDragOver(e, 'live')}
      ondragleave={() => handleTabDragLeave('live')}
      ondrop={(e) => handleTabDrop(e, 'live')}
    >
      <span class="flex flex-col items-start leading-tight min-w-0">
        <span class="text-xs font-bold {mgmtTab === 'active' ? 'text-md-on-surface' : 'text-md-on-surface/40'}">{$t('mailManagement.live')}</span>
        <span class="text-xs font-medium {mgmtTab === 'active' ? 'text-md-on-surface/50' : 'text-md-on-surface/30'}">{$t('mailManagement.activeSubtitle')}</span>
      </span>
      <span class="text-label-sm font-bold px-1.5 py-0.5 rounded-full {mgmtTab === 'active' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface-variant/40 text-md-on-surface/60'}">{liveCount}</span>
    </button>
    <button
      type="button"
      class="flex-1 flex items-center justify-center gap-2 px-3 py-1 rounded-full transition-all duration-200 {mgmtTab === 'expired' || mgmtTab === 'archived' ? 'bg-md-surface shadow-sm' : ''} {tabDropTarget === 'inactive' ? 'ring-2 ring-md-warning' : ''}"
      onclick={() => onTabChange('expired')}
      ondragover={(e) => handleTabDragOver(e, 'inactive')}
      ondragleave={() => handleTabDragLeave('inactive')}
      ondrop={(e) => handleTabDrop(e, 'inactive')}
    >
      <span class="flex flex-col items-start leading-tight min-w-0">
        <span class="text-xs font-bold {mgmtTab === 'expired' || mgmtTab === 'archived' ? 'text-md-on-surface' : 'text-md-on-surface/40'}">{$t('mailManagement.inactive')}</span>
        <span class="text-xs font-medium {mgmtTab === 'expired' || mgmtTab === 'archived' ? 'text-md-on-surface/50' : 'text-md-on-surface/30'}">{$t('mailManagement.inactiveSubtitle')}</span>
      </span>
      <span class="text-label-sm font-bold px-1.5 py-0.5 rounded-full {mgmtTab === 'expired' || mgmtTab === 'archived' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface-variant/40 text-md-on-surface/60'}">{inactiveCount}</span>
    </button>
  </div>
</div>

<!-- Search + Filters -->
<div class="pb-2 shrink-0 relative z-30">
  <SearchBar
    scope="mailManagement"
    value={mgmtSearch}
    placeholder={$t('mailManagement.searchAddressesOrTags')}
    ariaLabel={$t('mailManagement.searchAddresses')}
    settingsStyle={true}
    showSlashButton={true}
    animatedPlaceholders={[
      $t('mailManagement.searchAddressesOrTags'),
      $t('inbox.searchPlaceholderTags'),
    ]}
    shortcuts={[
      {
        prefix: 'tag:',
        label: 'tag:',
        description: $t('mailManagement.searchAddressesOrTags'),
      },
    ]}
    onChange={(v) => onSearchChange(v)}
  >
    {#snippet filterControl()}
      <button
        type="button"
        class="w-8 h-8 flex items-center justify-center rounded-xl border transition-colors relative
          {filterMenuOpen || hasActiveExtraFilters
            ? 'border-md-primary bg-md-primary/10 text-md-primary'
            : 'border-md-outline-variant text-md-on-surface/60 hover:bg-md-surface-variant'}"
        aria-label={$t('common.filter')}
        title={$t('common.filter')}
        aria-expanded={filterMenuOpen}
        onclick={(e) => {
          e.stopPropagation();
          filterMenuOpen = !filterMenuOpen;
        }}
      >
        <Icon name="filter" class="w-4 h-4" />
        {#if hasActiveExtraFilters}
          <span class="absolute top-1 end-1 w-1.5 h-1.5 rounded-full bg-md-primary"></span>
        {/if}
      </button>
    {/snippet}
  </SearchBar>

  {#if filterMenuOpen}
    <button
      type="button"
      class="fixed inset-0 z-[200] bg-transparent cursor-default"
      aria-label={$t('common.close')}
      onclick={() => (filterMenuOpen = false)}
    ></button>
    <div
      class="absolute top-full end-0 mt-2 z-[210] min-w-[220px] max-w-[min(280px,92vw)] rounded-2xl border border-md-outline-variant bg-md-surface shadow-2xl overflow-hidden"
      role="menu"
      aria-label={$t('mailManagement.filtersTitle')}
    >
      <div class="flex items-center justify-between px-3 py-2.5 border-b border-md-outline-variant/30">
        <span class="text-sm font-semibold text-md-on-surface">{$t('mailManagement.filtersTitle')}</span>
        <button
          type="button"
          class="text-xs font-semibold text-md-primary disabled:opacity-40"
          disabled={!hasActiveExtraFilters}
          onclick={() => clearAddressFilters()}
        >{$t('mailManagement.clearFilters')}</button>
      </div>

      <div class="px-3 py-2 space-y-1">
        <div class="text-label-sm font-bold uppercase tracking-wide text-md-on-surface/45">
          {$t('mailManagement.filterDateRange')}
        </div>
        {#each [
          { id: 'any' as const, key: 'mailManagement.filterAnyTime' },
          { id: '7' as const, key: 'mailManagement.filterLast7' },
          { id: '30' as const, key: 'mailManagement.filterLast30' },
          { id: '90' as const, key: 'mailManagement.filterLast90' },
        ] as opt (opt.id)}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={filterDateRange === opt.id}
            class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-start hover:bg-md-surface-variant/50
              {filterDateRange === opt.id ? 'text-md-primary font-medium' : 'text-md-on-surface'}"
            onclick={() => (filterDateRange = opt.id)}
          >
            <span
              class="w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0
                {filterDateRange === opt.id ? 'border-md-primary' : 'border-md-outline-variant'}"
            >
              {#if filterDateRange === opt.id}
                <span class="w-1.5 h-1.5 rounded-full bg-md-primary"></span>
              {/if}
            </span>
            {$t(opt.key)}
          </button>
        {/each}
      </div>

      <div class="h-px bg-md-outline-variant/30 mx-2"></div>

      <div class="px-3 py-2 space-y-1">
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={filterAutoRenew}
          class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-start hover:bg-md-surface-variant/50 text-md-on-surface"
          onclick={() => (filterAutoRenew = !filterAutoRenew)}
        >
          <span
            class="w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0
              {filterAutoRenew ? 'bg-md-primary border-md-primary text-md-on-primary' : 'border-md-outline-variant'}"
          >
            {#if filterAutoRenew}<Icon name="check" class="w-2.5 h-2.5" />{/if}
          </span>
          {$t('mailManagement.filterAutoRenew')}
        </button>
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={filterHasTags}
          class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-start hover:bg-md-surface-variant/50 text-md-on-surface"
          onclick={() => (filterHasTags = !filterHasTags)}
        >
          <span
            class="w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0
              {filterHasTags ? 'bg-md-primary border-md-primary text-md-on-primary' : 'border-md-outline-variant'}"
          >
            {#if filterHasTags}<Icon name="check" class="w-2.5 h-2.5" />{/if}
          </span>
          {$t('mailManagement.filterHasTags')}
        </button>
      </div>
    </div>
  {/if}
</div>

<!-- Account cards list (hold row / marquee to multi-select) -->
<div
  class="flex-1 overflow-y-auto divide-y divide-md-secondary-container pb-16 relative"
  role="list"
  bind:this={listRootEl}
  onpointerdown={onAddressesMarqueeDown}
>
  {#if loadingInboxes}
    <!-- Skeleton loader -->
    {#each Array(3) as _, i (i)}
      <div class="flex items-start gap-3 px-2 py-2">
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
    {#each displayedAccounts as account (account.id)}
      {@const isDragging = draggedAccountId === account.id}
      {@const isDropTarget = dropTargetAccountId === account.id}
      {@const accountEmails = asEmailList(storedEmails?.[account.address])}
      {@const { senders, remainder } = getSenderAvatars(accountEmails)}
      {@const isChecked = selectedAddresses.has(account.id)}
      {@const pill = getStatusPill(account)}
      {@const unread = unreadCount(accountEmails)}
      {@const expiryText = expiryLabel(account, Date.now())}
      {@const expiryCap = expiryCaption(account, Date.now())}
      {@const isHighlighted =
        !!highlightAddress &&
        (account.address === highlightAddress ||
          account.address.toLowerCase() === highlightAddress.toLowerCase())}
      <div
        class="relative flex items-center gap-2 px-1 py-2 hover:bg-md-secondary-container/50 transition-all rounded-xl {isDragging ? 'opacity-50' : ''} {isDropTarget ? 'ring-2 ring-md-primary drop-target-pulse' : ''} {selectionMode && isChecked ? 'ring-2 ring-md-secondary bg-md-secondary-container/40' : ''} {isHighlighted ? 'ring-2 ring-md-primary bg-md-primary/10 address-highlight' : ''}"
        draggable={!mgmtSearch || selectionMode}
        role="listitem"
        data-address={account.address}
        data-marquee-id={account.id}
        ondragstart={(e) => handleAccountDragStart(e, account.id)}
        ondragover={(e) => handleAccountDragOver(e, account.id)}
        ondragleave={() => handleAccountDragLeave(account.id)}
        ondrop={(e) => handleAccountDrop(e, account.id)}
        ondragend={handleAccountDragEnd}
        onpointerdown={() => { if (!selectionMode) startHold(account.id); }}
        onpointerup={() => cancelHold(account.id)}
        onpointerleave={() => cancelHold(account.id)}
        oncontextmenu={(e) => {
          e.preventDefault();
          selectionMode = true;
          if (!selectedAddresses.has(account.id)) onToggleSelect(account.id);
        }}
        aria-label={$t('mailManagement.dragToReorder', { values: { address: account.address } })}
      >
        {#if account === mgmtAccounts[0] && !dragHintDismissed && !selectionMode}
          <DragHint
            hintKey="dragHintSeen_mailManagement"
            text={$t('mailManagement.holdToSelectHint')}
            visible={true}
            onDismiss={handleAccountDragHintDismiss}
          />
        {/if}

        <!-- Leading icon: mail normally; tick when selected in multi-select -->
        {#if selectionMode}
          <button
            type="button"
            class="w-9 h-9 self-center shrink-0 rounded-full flex items-center justify-center transition-colors {isChecked
              ? 'bg-md-secondary text-md-on-secondary'
              : 'bg-md-primary-container border-2 border-md-outline-variant'}"
            aria-label={$t('mailManagement.selectAddress', { values: { address: account.address } })}
            aria-pressed={isChecked}
            onclick={(e) => {
              e.stopPropagation();
              if (shouldSuppressClick()) return;
              onToggleSelect(account.id);
            }}
          >
            {#if isChecked}
              <Icon name="check" class="w-5 h-5 text-md-on-secondary" />
            {:else}
              <Icon name="mail" class="w-4 h-4 text-md-on-primary-container" />
            {/if}
          </button>
        {:else}
          <div class="w-9 h-9 self-center shrink-0 rounded-full bg-md-primary-container flex items-center justify-center">
            <Icon name="mail" class="w-4 h-4 text-md-on-primary-container" />
          </div>
        {/if}

        <!-- Info + avatar | expiry on same row under address -->
        <button
          class="flex-1 min-w-0 text-start bg-transparent border-0 p-0"
          onclick={() => {
            if (shouldSuppressClick()) return;
            if (selectionMode) {
              onToggleSelect(account.id);
            } else {
              onOpenEmailDetail(account);
            }
          }}
        >
          <div class="flex items-center gap-1.5 min-w-0">
            <div class="font-bold text-sm truncate flex-1 min-w-0" style="direction:ltr;unicode-bidi:isolate;">{account.address}</div>
            {#if unread > 0}
              <span
                class="shrink-0 min-w-[1.25rem] h-5 px-1.5 rounded-full bg-md-primary text-md-on-primary text-xs font-bold flex items-center justify-center tabular-nums"
                title={$t('mailManagement.unreadCount', { values: { n: unread } })}
              >{unread > 99 ? '99+' : unread}</span>
            {/if}
            {#each (Array.isArray(account.tags) && account.tags.length
              ? account.tags
              : account.tag
                ? [{ name: account.tag, color: account.tagColor || '' }]
                : []) as tagEntry (tagEntry.name)}
              <span
                class="text-xs px-1.5 py-0.5 rounded-md truncate max-w-[5rem]
                  {tagEntry.color
                    ? 'text-md-on-primary'
                    : 'bg-md-surface-variant text-md-on-surface/60'}"
                style={tagEntry.color
                  ? `background-color: ${tagEntry.color}; color: #fff;`
                  : undefined}
                title={tagEntry.name}
              >{tagEntry.name}</span>
            {/each}
            {#if pill !== 'live'}
              <span class="text-xs font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md shrink-0 {statusPillClass(pill)}">
                {$t(statusPillLabel(pill))}
              </span>
            {/if}
          </div>

          <!-- Avatar stack | divider | expiry/auto-renew -->
          <div class="flex items-center gap-2 mt-1 min-w-0">
            {#if senders.length === 0}
              <p class="text-xs text-md-on-surface/35 italic leading-tight shrink-0">{$t('mailManagement.noMailYet')}</p>
            {:else}
              <div class="flex items-center shrink-0">
                {#each senders as sender, i (sender.email + (sender.domain || ''))}
                  <div
                    class="relative w-[22px] h-[22px] rounded-full ring-2 ring-md-surface overflow-hidden flex items-center justify-center bg-md-surface-container-low flex-shrink-0"
                    style="z-index: {MAX_AVATARS - i}; margin-inline-start: {i === 0 ? '0' : '-6px'};"
                    title={sender.domain || sender.email}
                  >
                    <FaviconImage
                      email={sender.email}
                      domain={sender.domain}
                      size={22}
                      class="absolute inset-0 w-full h-full object-cover"
                      fallbackLetter={sender.letter}
                      fallbackColor="bg-md-secondary text-md-on-secondary"
                    />
                  </div>
                {/each}
                {#if remainder > 0}
                  <div
                    class="relative flex-shrink-0 w-[22px] h-[22px] rounded-full ring-2 ring-md-surface bg-md-surface-variant flex items-center justify-center"
                    style="z-index: 0; margin-inline-start: -6px;"
                    title={$t('mailManagement.moreSenders', { values: { n: remainder } })}
                  >
                    <span class="text-label-sm font-bold text-md-on-surface/60 leading-none">{$t('common.plusN', { values: { n: remainder } })}</span>
                  </div>
                {/if}
              </div>
            {/if}
            {#if expiryCap || pill === 'expired'}
              <span class="w-px h-4 bg-md-outline-variant/50 shrink-0" aria-hidden="true"></span>
              {#if expiryCap}
                <span class="text-xs text-md-on-surface/50 tabular-nums flex items-center gap-0.5 min-w-0 truncate">
                  <Icon name="clock" class="w-3 h-3 opacity-60 shrink-0" />
                  <span class="truncate">{$t(expiryCap.key, { values: expiryCap.values })}</span>
                </span>
              {:else if pill === 'expired'}
                <span class="text-xs text-md-warning/80 truncate">{$t('mailManagement.expiredHint')}</span>
              {/if}
            {/if}
          </div>
        </button>

        <!-- ⋮ menu -->
        <div class="flex items-center shrink-0 self-center {selectionMode ? 'opacity-40 pointer-events-none' : ''}" data-no-marquee>
          <button
            type="button"
            class="w-8 h-8 flex items-center justify-center rounded-lg border-0 bg-md-surface-variant/60 hover:bg-md-surface-variant transition-colors"
            aria-label={$t('account.moreActions')}
            aria-haspopup="menu"
            aria-expanded={rowMenuOpenId === account.id}
            onclick={(e) => openRowMenu(e, account.id)}
          >
            <Icon name="moreVertical" class="w-4 h-4 text-md-on-surface/70" />
          </button>
          {#if rowMenuOpenId === account.id}
            <button
              type="button"
              class="fixed inset-0 z-[9500] cursor-default bg-transparent border-0"
              aria-label={$t('common.close')}
              onclick={(e) => { e.stopPropagation(); closeRowMenu(); }}
            ></button>
            <div
              class="fixed z-[9600] min-w-[190px] rounded-xl border border-md-outline-variant bg-md-surface-container shadow-2xl overflow-hidden py-1"
              role="menu"
              style="top: {rowMenuPos.top}px; left: {rowMenuPos.left}px;"
            >
              {#if pill === 'archived' && canUnarchive(account)}
                <button type="button" role="menuitem" class="w-full flex items-center gap-2 px-3 py-2 text-start text-xs hover:bg-md-surface-variant" onclick={() => { closeRowMenu(); onUnarchiveAccount(account); }}>
                  <Icon name="archive" class="w-3.5 h-3.5" />{$t('common.unarchive')}
                </button>
              {:else if pill !== 'deleted'}
                <button type="button" role="menuitem" class="w-full flex items-center gap-2 px-3 py-2 text-start text-xs hover:bg-md-surface-variant" onclick={() => { closeRowMenu(); onArchiveAccount(account); }}>
                  <Icon name="archive" class="w-3.5 h-3.5" />{$t('common.archive')}
                </button>
              {/if}
              <button type="button" role="menuitem" class="w-full flex items-center gap-2 px-3 py-2 text-start text-xs hover:bg-md-error/10 text-md-error" onclick={() => { closeRowMenu(); onDeleteAccounts([account]); }}>
                <Icon name="trash" class="w-3.5 h-3.5" />{$t('common.delete')}
              </button>
              <button type="button" role="menuitem" class="w-full flex items-center gap-2 px-3 py-2 text-start text-xs hover:bg-md-surface-variant" onclick={() => { closeRowMenu(); onTagAccount(account); }}>
                <Icon name="tag" class="w-3.5 h-3.5" />{$t('common.addTag')}
              </button>
              {#if supportsRenew(account)}
                <button type="button" role="menuitem" class="w-full flex items-center gap-2 px-3 py-2 text-start text-xs hover:bg-md-surface-variant" onclick={() => handleAutoRenewClick(account)}>
                  <Icon name="refresh" class="w-3.5 h-3.5" />
                  {account.autoExtend ? $t('account.autoRenewOff') : $t('account.autoRenewOn')}
                </button>
              {/if}
              <button type="button" role="menuitem" class="w-full flex items-center gap-2 px-3 py-2 text-start text-xs hover:bg-md-surface-variant" onclick={() => { closeRowMenu(); onExportAccountEmails(account); }}>
                <Icon name="download" class="w-3.5 h-3.5" />{$t('emailDetail.downloadEmails')}
              </button>
              <button
                type="button"
                role="menuitem"
                class="w-full flex items-center gap-2 px-3 py-2 text-start text-xs
                  {getMailboxReadState(accountEmails).canMarkAllUnread
                    ? 'hover:bg-md-surface-variant text-md-on-surface'
                    : 'text-md-on-surface/35 cursor-not-allowed'}"
                disabled={!getMailboxReadState(accountEmails).canMarkAllUnread}
                aria-disabled={!getMailboxReadState(accountEmails).canMarkAllUnread}
                onclick={() => {
                  if (!getMailboxReadState(accountEmails).canMarkAllUnread) return;
                  closeRowMenu();
                  onMarkAccountAllUnread(account);
                }}
              >
                <Icon name="mail" class="w-3.5 h-3.5" />{$t('emailDetail.markAllUnread')}
              </button>
              <button
                type="button"
                role="menuitem"
                class="w-full flex items-center gap-2 px-3 py-2 text-start text-xs
                  {getMailboxReadState(accountEmails).canMarkAllRead
                    ? 'hover:bg-md-surface-variant text-md-on-surface'
                    : 'text-md-on-surface/35 cursor-not-allowed'}"
                disabled={!getMailboxReadState(accountEmails).canMarkAllRead}
                aria-disabled={!getMailboxReadState(accountEmails).canMarkAllRead}
                onclick={() => {
                  if (!getMailboxReadState(accountEmails).canMarkAllRead) return;
                  closeRowMenu();
                  onMarkAccountAllRead(account);
                }}
              >
                <Icon name="checkCircle" class="w-3.5 h-3.5" />{$t('emailDetail.markAllRead')}
              </button>
            </div>
          {/if}
        </div>
      </div>
    {:else}
      <div class="px-4 py-8 text-center">
        <Icon name="inbox" class="w-12 h-12 text-md-on-surface/30 mx-auto mb-3" />
        <p class="text-sm text-md-on-surface/50 mb-3">{$t('mailManagement.noAddressesFound', { values: { tab: mgmtTab } })}</p>
        {#if mgmtTab === 'active'}
          <button class="px-2 py-1.5 text-sm rounded-lg bg-md-primary text-md-on-primary hover:bg-md-primary/90 transition-colors" onclick={onGenerateNewAddress}>
            {$t('mailManagement.generateNewAddress')}
          </button>
        {/if}
      </div>
    {/each}
  {/if}
</div>

{#if marqueeActive && marqueeRect}
  <div
    class="fixed pointer-events-none z-[500] border border-md-primary/70 bg-md-primary/15 rounded-sm"
    style="left:{marqueeRect.left}px;top:{marqueeRect.top}px;width:{marqueeRect.right - marqueeRect.left}px;height:{marqueeRect.bottom - marqueeRect.top}px;"
    aria-hidden="true"
  ></div>
{/if}

{#if unarchiveForRenewPrompt}
  <div class="fixed inset-0 z-[10000] flex items-center justify-center p-4" role="dialog" aria-modal="true">
    <button type="button" class="absolute inset-0 bg-md-scrim/50 border-0" aria-label={$t('common.close')} onclick={() => (unarchiveForRenewPrompt = null)}></button>
    <div class="relative z-10 w-full max-w-[300px] rounded-2xl bg-md-surface border border-md-outline-variant/40 shadow-2xl p-4 space-y-3">
      <h3 class="text-sm font-bold text-md-on-surface">{$t('account.unarchiveBeforeRenewTitle')}</h3>
      <p class="text-xs text-md-on-surface/60" style="direction:ltr;unicode-bidi:isolate;">{unarchiveForRenewPrompt.address}</p>
      <p class="text-label-sm text-md-on-surface/50">{$t('account.unarchiveBeforeRenewBody')}</p>
      <div class="flex flex-col gap-1.5">
        <button type="button" class="w-full py-2 rounded-xl bg-md-primary text-md-on-primary text-xs font-semibold" onclick={() => confirmUnarchiveThenRenew()}>
          {$t('common.unarchive')}
        </button>
        <button type="button" class="w-full py-2 rounded-xl bg-md-surface-variant text-xs font-medium" onclick={() => (unarchiveForRenewPrompt = null)}>
          {$t('common.cancel')}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Bottom selection strip — mirror mailbox color styling (btn-*) · no X (deselect only) -->
{#if selectionMode && selectedAddresses.size > 0}
  <div class="absolute bottom-0 inset-x-0 z-20 flex justify-center pb-1 pointer-events-none selection-slide-up">
    <div
      class="pointer-events-auto min-h-[88px] w-[min(350px,100%)] grid grid-cols-[auto_1fr] gap-1.5 box-border px-2 py-1.5 bg-md-secondary-container rounded-xl shadow-lg border border-md-outline-variant/30 items-stretch"
      role="toolbar"
      aria-label={$t('mailManagement.selectedCount', { values: { n: selectedAddresses.size } })}
    >
      <div class="flex flex-col gap-1 justify-center min-w-0">
        <button
          type="button"
          class="h-7 px-2 rounded-lg text-xs font-bold bg-md-surface/80 hover:bg-md-surface whitespace-nowrap"
          onclick={(e) => { e.stopPropagation(); onToggleSelectAll(); }}
        >{$t('mailManagement.selectAll')}</button>
        <button
          type="button"
          class="h-7 px-2 rounded-lg text-xs font-bold bg-transparent hover:bg-md-surface-variant/60 tabular-nums whitespace-nowrap"
          onclick={(e) => { e.stopPropagation(); exitSelectionMode(); }}
        >{$t('inbox.emailActions.deselectAll')} ({selectedAddresses.size})</button>
      </div>
      <div class="flex flex-col gap-1 min-w-0">
        <div class="flex items-center gap-1.5 w-full">
          {#if mgmtTab === 'archived' || mgmtTab === 'expired'}
            <button
              type="button"
              class="btn-tertiary flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-xl font-bold text-label-sm tracking-wide transition-colors shadow-sm"
              data-drop-action="unarchive"
              ondragover={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; }}
              ondrop={(e) => { e.preventDefault(); e.stopPropagation(); onUnarchiveSelected(); }}
              onclick={(e) => { e.stopPropagation(); onUnarchiveSelected(); }}
            >
              <span class="btn-icon flex items-center justify-center w-5 h-5 rounded-full shrink-0">
                <Icon name="archive" class="w-3.5 h-3.5" />
              </span>
              <span class="leading-tight truncate">{$t('common.unarchive')}</span>
            </button>
          {:else}
            <button
              type="button"
              class="btn-tertiary flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-xl font-bold text-label-sm tracking-wide transition-colors shadow-sm"
              data-drop-action="archive"
              ondragover={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; }}
              ondrop={(e) => { e.preventDefault(); e.stopPropagation(); onArchiveSelected(); }}
              onclick={(e) => { e.stopPropagation(); onArchiveSelected(); }}
            >
              <span class="btn-icon flex items-center justify-center w-5 h-5 rounded-full shrink-0">
                <Icon name="archive" class="w-3.5 h-3.5" />
              </span>
              <span class="leading-tight truncate">{$t('common.archive')}</span>
            </button>
          {/if}
          <button
            type="button"
            class="btn-error flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-xl font-bold text-label-sm tracking-wide transition-colors shadow-sm"
            data-drop-action="delete"
            ondragover={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; }}
            ondrop={(e) => { e.preventDefault(); e.stopPropagation(); onDeleteSelected(); }}
            onclick={(e) => { e.stopPropagation(); onDeleteSelected(); }}
          >
            <span class="btn-icon flex items-center justify-center w-5 h-5 rounded-full shrink-0">
              <Icon name="trash" class="w-3.5 h-3.5" />
            </span>
            <span class="leading-tight truncate">{$t('common.delete')}</span>
          </button>
        </div>
        <div class="flex items-center gap-1.5 w-full">
          <button
            type="button"
            class="btn-primary flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-xl font-bold text-label-sm tracking-wide transition-colors shadow-sm"
            data-drop-action="tag"
            ondragover={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; }}
            ondrop={(e) => { e.preventDefault(); e.stopPropagation(); onTagSelected(); }}
            onclick={(e) => { e.stopPropagation(); onTagSelected(); }}
          >
            <span class="btn-icon flex items-center justify-center w-5 h-5 rounded-full shrink-0">
              <Icon name="tag" class="w-3.5 h-3.5" />
            </span>
            <span class="leading-tight truncate">{$t('mailManagement.addTagSelected')}</span>
          </button>
          <button
            type="button"
            class="btn-secondary flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-xl font-bold text-label-sm tracking-wide transition-colors shadow-sm"
            data-drop-action="export"
            ondragover={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; }}
            ondrop={(e) => { e.preventDefault(); e.stopPropagation(); onExportSelected(); }}
            onclick={(e) => { e.stopPropagation(); onExportSelected(); }}
          >
            <span class="btn-icon flex items-center justify-center w-5 h-5 rounded-full shrink-0">
              <Icon name="download" class="w-3.5 h-3.5" />
            </span>
            <span class="leading-tight truncate">{$t('mailManagement.exportSelected')}</span>
          </button>
        </div>
        <div class="flex items-center gap-1 w-full">
          <button
            type="button"
            class="flex-1 h-6 px-1 rounded-lg text-xs font-semibold hover:bg-md-surface/60"
            data-drop-action="mark-read"
            ondragover={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; }}
            ondrop={(e) => { e.preventDefault(); e.stopPropagation(); onMarkSelectedRead(); }}
            onclick={(e) => { e.stopPropagation(); onMarkSelectedRead(); }}
          >{$t('mailManagement.markAllRead')}</button>
          <button
            type="button"
            class="flex-1 h-6 px-1 rounded-lg text-xs font-semibold hover:bg-md-surface/60"
            data-drop-action="mark-unread"
            ondragover={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; }}
            ondrop={(e) => { e.preventDefault(); e.stopPropagation(); onMarkSelectedUnread(); }}
            onclick={(e) => { e.stopPropagation(); onMarkSelectedUnread(); }}
          >{$t('mailManagement.markAllUnread')}</button>
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Cross-tab drag confirm -->
{#if crossTabPrompt}
  <div class="fixed inset-0 z-[10000] flex items-center justify-center p-4" role="dialog" aria-modal="true">
    <div
      class="absolute inset-0 bg-black/40"
      role="button"
      tabindex="-1"
      onclick={() => (crossTabPrompt = null)}
      onkeydown={(e) => e.key === 'Escape' && (crossTabPrompt = null)}
    ></div>
    <div class="relative bg-md-surface rounded-2xl shadow-2xl border border-md-outline-variant p-4 w-full max-w-xs z-10 space-y-3">
      {#if crossTabPrompt.direction === 'toInactive'}
        <h3 class="text-sm font-bold text-md-on-surface">{$t('mailManagement.dragToInactiveTitle')}</h3>
        <p class="text-xs text-md-on-surface/60">
          {$t('mailManagement.dragToInactiveBody', { values: { n: crossTabPrompt.accounts.length } })}
        </p>
        <div class="flex flex-col gap-2">
          <button type="button" class="w-full py-2 rounded-xl bg-md-warning/15 text-md-warning text-xs font-semibold hover:bg-md-warning/25" onclick={() => applyToInactive('archive')}>
            {$t('common.archive')} ({crossTabPrompt.accounts.length})
          </button>
          <button type="button" class="w-full py-2 rounded-xl bg-md-error/15 text-md-error text-xs font-semibold hover:bg-md-error/25" onclick={() => applyToInactive('delete')}>
            {$t('common.delete')} ({crossTabPrompt.accounts.length})
          </button>
          <button type="button" class="w-full py-2 rounded-xl bg-md-surface-variant text-xs font-medium" onclick={() => (crossTabPrompt = null)}>
            {$t('common.cancel')}
          </button>
        </div>
      {:else}
        <h3 class="text-sm font-bold text-md-on-surface">{$t('mailManagement.dragToLiveTitle')}</h3>
        <p class="text-xs text-md-on-surface/60">
          {$t('mailManagement.dragToLiveBody', { values: { n: crossTabPrompt.accounts.length } })}
        </p>
        <div class="flex flex-col gap-2">
          {#if anyArchived(crossTabPrompt.accounts)}
            <button type="button" class="w-full py-2 rounded-xl bg-md-success/15 text-md-success text-xs font-semibold hover:bg-md-success/25" onclick={() => applyToLive('unarchive')}>
              {$t('common.unarchive')} ({crossTabPrompt.accounts.length})
            </button>
          {/if}
          {#if anyRenewable(crossTabPrompt.accounts)}
            <button type="button" class="w-full py-2 rounded-xl bg-md-primary/15 text-md-primary text-xs font-semibold hover:bg-md-primary/25" onclick={() => applyToLive('renew')}>
              {$t('mailManagement.renewAddresses')} ({crossTabPrompt.accounts.length})
            </button>
          {/if}
          {#if !anyArchived(crossTabPrompt.accounts) && !anyRenewable(crossTabPrompt.accounts)}
            <p class="text-label-sm text-md-on-surface/50">{$t('mailManagement.dragToLiveNoAction')}</p>
          {/if}
          <button type="button" class="w-full py-2 rounded-xl bg-md-surface-variant text-xs font-medium" onclick={() => (crossTabPrompt = null)}>
            {$t('common.cancel')}
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}
</div>

<style>
  .address-highlight {
    animation: address-highlight-pulse 1.6s ease-in-out 2;
  }
  @keyframes address-highlight-pulse {
    0%,
    100% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--md-primary, #445e91) 0%, transparent);
    }
    50% {
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--md-primary, #445e91) 25%, transparent);
    }
  }
</style>
