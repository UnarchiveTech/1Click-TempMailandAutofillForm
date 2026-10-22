<script lang="ts">
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import { type AddressListOrder, orderAddressList } from '@/features/address/address-list-order.js';
import { canUnarchive } from '@/features/address/address-management.js';
import { registerEscapeTier } from '@/features/keyboard-shortcuts/escape-stack.js';
import ActiveFilterChips from '@/ui/components/composites/ActiveFilterChips.svelte';
import DragHint from '@/ui/components/composites/DragHint.svelte';
import EmptyState from '@/ui/components/composites/EmptyState.svelte';
import MenuList from '@/ui/components/composites/MenuList.svelte';
import ModalDialog from '@/ui/components/composites/ModalDialog.svelte';
import SearchBar from '@/ui/components/composites/SearchBar.svelte';
import SearchFilterHeader from '@/ui/components/composites/SearchFilterHeader.svelte';
import Tabs from '@/ui/components/composites/Tabs.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import { Btn } from '@/ui/components/primitives';
import Avatar from '@/ui/components/primitives/Avatar.svelte';
import Badge from '@/ui/components/primitives/Badge.svelte';
import Dropdown from '@/ui/components/primitives/Dropdown.svelte';
import FaviconImage from '@/ui/components/primitives/FaviconImage.svelte';
import ProviderPill from '@/ui/components/primitives/ProviderPill.svelte';
import Skeleton from '@/ui/components/primitives/Skeleton.svelte';
import {
  buildTagAddressUsage,
  buildTagColors,
  tagColorFor,
  tagUsageInfo,
} from '@/utils/address/address-tags.js';
import { loadProviderConfig } from '@/utils/email/email-service.js';
import { getDomainAvatarStack } from '@/utils/email/sender-avatars.js';
import { effectivePreExpiryWindowMs } from '@/utils/provider/provider-expiry.js';
import { getMailboxReadState } from '@/utils/storage/mailbox-read-state.js';
import { getTagInkColor as tagInkColor } from '@/utils/theme/color-utils.js';
import { formatDurationLeft } from '@/utils/time/time-format.js';
import type { Address, Email } from '@/utils/types.js';
import { AVATAR_BOX, AVATAR_INK } from '@/utils/ui/avatar-size.js';
import { ELEVATION } from '@/utils/ui/elevation.js';
import { createHoldController } from '@/utils/ui/gesture-selection.js';
import { keyboardReorder } from '@/utils/ui/keyboard-reorder.js';
import {
  collectIntersectingIds,
  isInteractiveTarget,
  isMarqueeSelectionEnabled,
  MARQUEE_THRESHOLD,
  normalizeMarquee,
} from '@/utils/ui/marquee-selection.js';
import {
  PORTAL_Z_CLASS,
  portalDialogAction,
  portalFlyoutAction,
} from '@/utils/ui/portal-layers.js';
import {
  controlSurface,
  type RowInkRole,
  rowInk,
  rowSurface,
  rowSurfaceState,
} from '@/utils/ui/row-surface.js';
import type {
  ListSelectionState,
  SelectionActionId,
  SelectionApi,
} from '@/utils/ui/selection-api.js';
import { publishSelectionSurface } from '@/utils/ui/selection-registry.js';
import { focusedRowId, moveRowCursor } from '@/utils/ui/selection-row-cursor.js';

const tabsIdPrefix = $props.id();

const MAX_AVATARS = 4;

type StatusPill = 'live' | 'expired' | 'archived' | 'deleted';

function getStatusPill(account: Address): StatusPill {
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
      return 'address.live';
    case 'expired':
      return 'address.expiredStatus';
    case 'archived':
      return 'common.archived';
    case 'deleted':
      return 'common.deleted';
  }
}

function expiryLabel(account: Address, now: number): string | null {
  if (!account.expiresAt || account.expiresAt <= 0) return null;
  const left = account.expiresAt - now;
  if (left <= 0) return null; // status pill already shows expired
  return formatDurationLeft(left);
}

/** Expiry line: auto-renew vs plain expiry (renewable providers only). */
function expiryCaption(
  account: Address,
  now: number
): { key: string; values: Record<string, string | number> } | null {
  if (!account.expiresAt || account.expiresAt <= 0) return null;
  const left = account.expiresAt - now;
  if (left <= 0) return null;
  const time = formatDurationLeft(left);
  let renewable = false;
  try {
    const cfg = loadProviderConfig(account.provider);
    renewable = !!(cfg.expiry?.renewable || cfg.capabilities?.supportsRenew);
  } catch {
    /* ignore */
    renewable = false;
  }
  if (renewable && account.autoExtend) {
    const n = (account as Address & { renewalCount?: number }).renewalCount ?? 0;
    if (n <= 0) {
      // Enabled but has not renewed yet - renewal only after full expiry
      return { key: 'address.autoRenewAfterExpiry', values: { time } };
    }
    return {
      key: 'address.autoRenewInNth',
      values: { time, n },
    };
  }
  if (renewable && !account.autoExtend) {
    return { key: 'address.expiresInAutoRenewDisabled', values: { time } };
  }
  return { key: 'address.expiresIn', values: { time } };
}

/** Auto-renew is on but the last renewal failed: show when the next attempt
 * happens (exponential backoff) and how many attempts have failed so far. */
function renewalRetryCaption(
  account: Address,
  now: number
): { key: string; values: Record<string, string | number> } | null {
  if (!account.autoExtend) return null;
  const acc = account as Address & { renewalFailCount?: number; nextRetryAt?: number };
  const failCount = acc.renewalFailCount ?? 0;
  if (failCount <= 0) return null;
  if (acc.nextRetryAt && acc.nextRetryAt > now) {
    return {
      key: 'address.autoRenewRetryIn',
      values: { n: failCount, time: formatDurationLeft(acc.nextRetryAt - now) },
    };
  }
  return { key: 'address.autoRenewRetrySoon', values: { n: failCount } };
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
  onBack = () => {},
  mgmtTab = 'active',
  mgmtSearch = '',
  selectedAddresses = new Set(),
  mgmtAddresses = [],
  allAddresses = [] as Address[],
  allSelected = false,
  loadingAddresses = false,
  storedEmails = {} as Record<string, Email[]>,
  /** User-configured auto-renew lead time in minutes (1-30); undefined = default. */
  preExpiryWindowMinutes = undefined as number | undefined,
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
  onOpenAddressView = () => {},
  onArchiveAddress = () => {},
  onUnarchiveAddress = () => {},
  onDeleteAddresses = (_accounts: Address[]) => {},
  onArchiveAddresses = (_accounts: Address[]) => {},
  onUnarchiveAddresses = (_accounts: Address[]) => {},
  onRenewAddresses = (_accounts: Address[]) => {},
  onExportAddressEmails = () => {},
  onGenerateNewAddress = () => {},
  onEditAddress = () => {},
  onExtendAddress = () => {},
  onToggleAutoExtend = (_account: Address) => {},
  onTagAddress = (_account: Address) => {},
  onMarkAddressAllRead = (_account: Address) => {},
  onMarkAddressAllUnread = (_account: Address) => {},
  onReorderAddresses = (_sourceId: string, _targetId: string) => {},
  onScrollDirection = (_dir: 'up' | 'down', _atTop = false) => {},
  highlightAddress = null as string | null,
}: {
  onBack?: () => void;
  mgmtTab?: string;
  mgmtSearch?: string;
  selectedAddresses?: Set<string>;
  mgmtAddresses?: Address[];
  /** Full inbox list (unfiltered) for Live / Inactive tab counts */
  allAddresses?: Address[];
  allSelected?: boolean;
  loadingAddresses?: boolean;
  storedEmails?: Record<string, Email[]>;
  /** User-configured auto-renew lead time in minutes (1-30). */
  preExpiryWindowMinutes?: number;
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
  onOpenAddressView?: (account: Address) => void;
  onArchiveAddress?: (account: Address) => void;
  onUnarchiveAddress?: (account: Address) => void;
  /** Delete specific accounts (avoids selection Set race on drag-drop) */
  onDeleteAddresses?: (accounts: Address[]) => void;
  /** Batch lifecycle variants for the cross-tab drag prompts (one message per batch). */
  onArchiveAddresses?: (accounts: Address[]) => void;
  onUnarchiveAddresses?: (accounts: Address[]) => void;
  onRenewAddresses?: (accounts: Address[]) => void;
  onExportAddressEmails?: (account: Address) => void;
  onGenerateNewAddress?: () => void;
  onEditAddress?: (account: Address) => void;
  onExtendAddress?: (account: Address) => void;
  onToggleAutoExtend?: (account: Address) => void;
  onTagAddress?: (account: Address) => void;
  onMarkAddressAllRead?: (account: Address) => void;
  onMarkAddressAllUnread?: (account: Address) => void;
  /** Reorder by stable account id (not filtered list index) */
  onReorderAddresses?: (sourceId: string, targetId: string) => void;
  /** Notify shared bottom chrome about list scrolling. */
  onScrollDirection?: (dir: 'up' | 'down', atTop?: boolean) => void;
  /** Newly created address to highlight */
  highlightAddress?: string | null;
} = $props();

let draggedAddressId = $state<string | null>(null);
let dropTargetAddressId = $state<string | null>(null);
let dragHintDismissed = $state(false);
let listRootEl = $state<HTMLElement | null>(null);
const ADDRESS_SKELETON_ROW_HEIGHT = 60;
let addressSkeletonCount = $state(3);

$effect(() => {
  const list = listRootEl;
  if (!loadingAddresses || !list) return;

  const updateSkeletonCount = () => {
    // Keep one partially visible row at the bottom so the loading surface fills
    // the viewport even when its height is not an exact multiple of a row.
    addressSkeletonCount = Math.max(1, Math.ceil(list.clientHeight / ADDRESS_SKELETON_ROW_HEIGHT));
  };

  updateSkeletonCount();
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(updateSkeletonCount);
    observer.observe(list);
    return () => observer.disconnect();
  }

  window.addEventListener('resize', updateSkeletonCount);
  return () => window.removeEventListener('resize', updateSkeletonCount);
});
let rowMenuOpenId = $state<string | null>(null);
let rowMenuPos = $state({ top: 0, left: 0 });
let marqueeActive = $state(false);
let marqueeStart = $state<{ x: number; y: number } | null>(null);
let marqueeRect = $state<{ left: number; top: number; right: number; bottom: number } | null>(null);
let marqueePrefEnabled = $state(true);
let addressListCount = $state(0);
let lastAddressScrollTop = 0;

function handleAddressListScroll(event: Event) {
  const el = event.currentTarget as HTMLElement | null;
  if (!el) return;
  const top = el.scrollTop;
  const delta = top - lastAddressScrollTop;
  if (Math.abs(delta) <= 4) return;
  onScrollDirection(delta > 0 ? 'down' : 'up', top <= 24);
  lastAddressScrollTop = top;
}

/** Local filter panel (Addresses page) */
let filterMenuOpen = $state(false);
let filterTriggerEl: HTMLButtonElement | null = null;
function addressFilterFlyout(node: HTMLDivElement) {
  const portal = portalFlyoutAction(node);
  const place = () => {
    if (!filterTriggerEl) return;
    const rect = filterTriggerEl.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 16);
    const below = window.innerHeight - rect.bottom - 16;
    const above = rect.top - 16;
    const up = below < 160 && above > below;
    const height = Math.max(0, Math.min(480, up ? above : below));
    const rtl = getComputedStyle(filterTriggerEl).direction === 'rtl';
    const left = Math.max(
      8,
      Math.min(rtl ? rect.left : rect.right - width, window.innerWidth - width - 8)
    );
    node.style.width = `${width}px`;
    node.style.maxHeight = `${height}px`;
    node.style.left = `${left}px`;
    node.style.top = `${up ? Math.max(8, rect.top - Math.min(height, node.scrollHeight) - 8) : rect.bottom + 8}px`;
  };
  place();
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, true);
  const unregister = registerEscapeTier('addresses.filters', () => {
    filterMenuOpen = false;
    filterTriggerEl?.focus();
  });
  return {
    destroy() {
      unregister();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      portal.destroy();
    },
  };
}
type DateRangeFilter = 'any' | '7' | '30' | '90';
let filterDateRange = $state<DateRangeFilter>('any');
let filterAutoRenew = $state(false);
let filterHasTags = $state(false);
let filterProvider = $state<string>('all');
let filterInstance = $state<string>('all');
let listOrder = $state<AddressListOrder>('custom');
let addressSearchInput: HTMLInputElement | null = null;
const activeAddressFilters = $derived.by(() => {
  const filters: Array<{ id: string; label: string }> = [];
  if (mgmtSearch.trim()) filters.push({ id: 'search', label: mgmtSearch.trim() });
  if (filterProvider !== 'all')
    filters.push({
      id: 'provider',
      label: `${$t('address.filterProvider')}: ${loadProviderConfig(filterProvider).name || filterProvider}`,
    });
  if (filterInstance !== 'all') filters.push({ id: 'instance', label: filterInstance });
  if (filterAutoRenew) filters.push({ id: 'renew', label: $t('address.filterAutoRenew') });
  if (filterHasTags) filters.push({ id: 'tags', label: $t('address.filterHasTags') });
  if (filterDateRange !== 'any') {
    const label =
      filterDateRange === '7'
        ? $t('address.filterLast7')
        : filterDateRange === '30'
          ? $t('address.filterLast30')
          : $t('address.filterLast90');
    filters.push({ id: 'date', label });
  }
  return filters;
});

function removeAddressFilter(id: string) {
  if (id === 'search') {
    mgmtSearch = '';
    onSearchChange('');
  }
  if (id === 'provider') {
    filterProvider = 'all';
    filterInstance = 'all';
  }
  if (id === 'instance') filterInstance = 'all';
  if (id === 'renew') filterAutoRenew = false;
  if (id === 'tags') filterHasTags = false;
  if (id === 'date') filterDateRange = 'any';
}

let hasActiveExtraFilters = $derived(
  filterDateRange !== 'any' ||
    filterAutoRenew ||
    filterHasTags ||
    filterProvider !== 'all' ||
    filterInstance !== 'all'
);

function accountCreatedAt(account: Address): number {
  const a = account as Address & { createdAt?: number; created?: number };
  if (typeof a.createdAt === 'number' && a.createdAt > 0) return a.createdAt;
  if (typeof a.created === 'number' && a.created > 0) return a.created;
  // Fallback: treat as old if no timestamp (still show unless date filter is tight)
  return 0;
}

/** Effective auto-renew lead time in whole minutes, or null when auto-renew
 * won't fire for this address (disabled, not renewable, or not live). Uses the
 * same computation as the background expiry check, so the shown lead time is
 * exactly when renewal will fire. */
function effectiveRenewalMinutes(account: Address): number | null {
  if (!account.autoExtend) return null;
  if (account.accountStatus === 'archived' || account.accountStatus === 'deleted') {
    return null;
  }
  const config = loadProviderConfig(account.provider);
  if (!config.expiry?.renewable) return null;
  const ms = effectivePreExpiryWindowMs(
    account,
    allAddresses as Address[],
    config,
    preExpiryWindowMinutes
  );
  return Math.max(1, Math.round(ms / 60000));
}

// Derive unique provider list and instance list for filter dropdowns
let availableProviders = $derived.by(() => {
  const set = new Set<string>();
  for (const a of mgmtAddresses as Address[]) {
    if (a.provider) set.add(a.provider);
  }
  return Array.from(set).sort();
});
let availableInstances = $derived.by(() => {
  const set = new Set<string>();
  (mgmtAddresses as Address[]).forEach((a) => {
    if (filterProvider !== 'all' && a.provider !== filterProvider) return;
    if (a.instanceUrl) set.add(a.instanceUrl);
  });
  return Array.from(set).sort();
});

let displayedAddresses = $derived.by((): Address[] => {
  let list = mgmtAddresses as Address[];
  if (filterProvider !== 'all') {
    list = list.filter((a) => a.provider === filterProvider);
  }
  if (filterInstance !== 'all') {
    list = list.filter((a) => a.instanceUrl === filterInstance);
  }
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
  return orderAddressList(list, listOrder, storedEmails, unreadCount);
});

function clearAddressFilters() {
  filterDateRange = 'any';
  filterAutoRenew = false;
  filterHasTags = false;
  filterProvider = 'all';
  filterInstance = 'all';
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
    /* ignore */
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

function supportsRenew(account: Address): boolean {
  try {
    const cfg = loadProviderConfig(account.provider);
    return !!(
      (cfg.expiry?.renewable === true || cfg.capabilities?.supportsRenew === true) &&
      typeof cfg.expiry?.renewalMethod === 'string' &&
      cfg.expiry.renewalMethod.length > 0
    );
  } catch {
    /* ignore */
    return !!(account as Address & { providerConfig?: { expiry?: { renewable?: boolean } } })
      .providerConfig?.expiry?.renewable;
  }
}

function handleAutoRenewClick(account: Address) {
  closeRowMenu();
  onToggleAutoExtend(account);
}

// Scroll newly created address into view when highlighted
$effect(() => {
  if (!highlightAddress || !listRootEl) return;
  const safe = highlightAddress.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const el = listRootEl.querySelector<HTMLElement>(`[data-address="${safe}"]`);
  el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

/** Hold-to-select (same pattern as Inbox / Identities). */
let selectionMode = $state(false);
// Long-press rows to multi-select: the shared controller owns the per-row
// hold timers and the click-suppression window after a completed hold.
const holdCtrl = createHoldController({ holdMs: 500, suppressClickMs: 400 });

function startHold(id: string) {
  if (selectionMode || mgmtSearch) return;
  holdCtrl.start(id, () => {
    selectionMode = true;
    if (!selectedAddresses.has(id)) onToggleSelect(id);
  });
}

function cancelHold(id: string) {
  holdCtrl.cancel(id);
}

function shouldSuppressClick(): boolean {
  return holdCtrl.isSuppressingClick();
}

function exitSelectionMode() {
  selectionMode = false;
  // Clear all selections via parent toggles
  for (const id of [...selectedAddresses]) {
    onToggleSelect(id);
  }
}

// Escape tier: an active multi-select is a transient surface - Escape drops it
// rather than navigating away from the cards the user just ticked.
$effect(() => {
  if (!selectionMode || selectedAddresses.size === 0) return;
  return registerEscapeTier('addresses.selection', exitSelectionMode);
});

// The addresses list publishes its selection to the SHELL's strip (`ListSelectionBar`),
// which is why this view no longer renders one: in split view its own strip was
// clipped to the list pane, and a published surface works through any rendering
// of this view (it is also mounted alone inside a settings subpage).
const selectionState = $derived.by<ListSelectionState>(() => ({
  active: selectionMode && selectedAddresses.size > 0,
  count: selectedAddresses.size,
  actions: addressSelectionActions(mgmtTab),
  allMatched: mgmtAddresses.length > 0 && selectedAddresses.size >= mgmtAddresses.length,
  matchingTotal: mgmtAddresses.length,
  universeCounted: true,
}));

/** Which bulk actions this tab offers: Archived/Expired unarchive, the rest archive. */
function addressSelectionActions(tab: string): SelectionActionId[] {
  const actions: SelectionActionId[] = [
    tab === 'archived' || tab === 'expired' ? 'unarchive' : 'archive',
    'delete',
    'tag',
    'export',
    'markRead',
    'markUnread',
  ];
  return actions;
}

/** Every action routes to the callback the list already received from the shell. */
const selectionApi: SelectionApi = {
  cancel: () => exitSelectionMode(),
  selectAll: () => onToggleSelectAll(),
  deselectAll: () => exitSelectionMode(),
  run: (action) => {
    switch (action) {
      case 'archive':
        return onArchiveSelected();
      case 'unarchive':
        return onUnarchiveSelected();
      case 'delete':
        return onDeleteSelected();
      case 'tag':
        return onTagSelected();
      case 'export':
        return onExportSelected();
      case 'markRead':
        return onMarkSelectedRead();
      case 'markUnread':
        return onMarkSelectedUnread();
      default:
        return;
    }
  },
  // Keyboard: the cursor is DOM focus on the row (`data-selectable-row`), so the
  // list owns no second copy of "which row am I on".
  moveFocus: (delta) => void moveRowCursor(listRootEl, delta),
  hasFocusedRow: () => focusedRowId(listRootEl) !== null,
  focusedIsSelected: () => {
    const id = focusedRowId(listRootEl);
    return id !== null && selectedAddresses.has(id);
  },
  setFocusedSelected: (selected) => {
    const id = focusedRowId(listRootEl);
    if (id === null || selected === selectedAddresses.has(id)) return;
    if (selected) selectionMode = true;
    onToggleSelect(id);
  },
};

$effect(() =>
  publishSelectionSurface({ surface: 'addresses', state: selectionState, api: selectionApi })
);

function handleAddressDragHintDismiss(): void {
  dragHintDismissed = true;
}

function handleAddressDragStart(e: DragEvent, accountId: string) {
  // Allow drag while multi-selecting so selection-strip drop targets work
  if (mgmtSearch && !selectionMode) {
    e.preventDefault();
    return;
  }
  draggedAddressId = accountId;
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

function handleAddressDragOver(e: DragEvent, accountId: string) {
  if (!draggedAddressId || draggedAddressId === accountId) return;
  e.preventDefault();
  dropTargetAddressId = accountId;
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move';
  }
}

function handleAddressDragLeave(accountId: string) {
  if (dropTargetAddressId === accountId) {
    dropTargetAddressId = null;
  }
}

function handleAddressDrop(e: DragEvent, targetId: string) {
  e.preventDefault();
  const sourceId = draggedAddressId;
  draggedAddressId = null;
  dropTargetAddressId = null;
  if (!sourceId || sourceId === targetId) return;
  if (listOrder !== 'custom' || mgmtSearch) return;
  // Resolve by id in parent against full storage list (not filtered mgmtAddresses indices)
  onReorderAddresses(sourceId, targetId);
}

function handleAddressDragEnd() {
  draggedAddressId = null;
  dropTargetAddressId = null;
}

function isInactiveAddress(a: Address): boolean {
  return a.status !== 'active' || a.accountStatus === 'archived' || a.accountStatus === 'deleted';
}

// Which addresses carry each tag - the count shown inside every tag chip and the
// addresses its hover names. Same derivation (and same hover text) as the tag
// dialog, so a chip here and a chip there cannot disagree about a tag.
let tagAddressUsage = $derived(buildTagAddressUsage(allAddresses));

// One color per tag, keyed case-insensitively like the usage map: this row's chip
// cannot paint `banking` a different color than the row below paints `Banking`.
let tagColors = $derived(buildTagColors(allAddresses));

/** Read through `$t` at the chip's own render, so the count cannot go stale. */
function tagUsageFor(tag: string) {
  return tagUsageInfo($t, tagAddressUsage, tag);
}

let liveCount = $derived(
  (Array.isArray(allAddresses) ? allAddresses : []).filter((a: Address) => !isInactiveAddress(a))
    .length
);
let inactiveCount = $derived(
  (Array.isArray(allAddresses) ? allAddresses : []).filter((a: Address) => isInactiveAddress(a))
    .length
);
let tabDropTarget = $state<'live' | 'inactive' | null>(null);
let crossTabPrompt = $state<{
  direction: 'toInactive' | 'toLive';
  accounts: Address[];
} | null>(null);

// Auto-exit selection when empty
$effect(() => {
  if (selectionMode && selectedAddresses.size === 0) {
    selectionMode = false;
  }
});

function accountsForDrag(sourceId: string): Address[] {
  // If multi-selected and source is in selection, move all selected; else just source
  if (selectionMode && selectedAddresses.size > 0 && selectedAddresses.has(sourceId)) {
    return mgmtAddresses.filter((a: Address) => selectedAddresses.has(a.id));
  }
  const one =
    mgmtAddresses.find((a: Address) => a.id === sourceId) ||
    allAddresses.find((a: Address) => a.id === sourceId);
  return one ? [one] : [];
}

function handleTabDragOver(e: DragEvent, tab: 'live' | 'inactive') {
  if (!draggedAddressId) return;
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
  const sourceId = draggedAddressId || e.dataTransfer?.getData('text/plain');
  draggedAddressId = null;
  dropTargetAddressId = null;
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
  // Batched handlers avoid N serial per-account RPCs (and the parent selection
  // Set race) - the background performs one locked pass for the whole list.
  if (action === 'archive') {
    onArchiveAddresses(accounts);
  } else {
    onDeleteAddresses(accounts);
  }
  exitSelectionMode();
}

function applyToLive(action: 'unarchive' | 'renew') {
  const accounts = crossTabPrompt?.accounts || [];
  crossTabPrompt = null;
  if (accounts.length === 0) return;
  if (action === 'unarchive') {
    onUnarchiveAddresses(
      accounts.filter(
        (a) =>
          a.accountStatus === 'archived' || a.status === 'archived' || a.accountStatus === 'deleted'
      )
    );
  } else {
    onRenewAddresses(accounts);
  }
  exitSelectionMode();
}

function anyArchived(accounts: Address[]): boolean {
  return accounts.some(
    (a) =>
      a.accountStatus === 'archived' ||
      a.accountStatus === 'deleted' ||
      a.status === 'archived' ||
      a.status === 'deleted'
  );
}
function anyRenewable(accounts: Address[]): boolean {
  return accounts.some(
    (a) => a.status === 'expired' || (a.expiresAt != null && a.expiresAt <= Date.now())
  );
}
</script>

<div class="scroll-frame flex flex-col h-full relative min-h-0">
<!-- Tabs - pill style with drag-and-drop support -->
<div class="scroll-edge pt-3 pb-2 shrink-0" data-tour="manage-tabs">
  <Tabs
    idPrefix={tabsIdPrefix}
    ariaLabel={$t('address.manageAddresses')}
    variant="pill"
    fullWidth
    showInSidebar={true}
    activeTab={mgmtTab === 'active' ? 'live' : 'inactive'}
    dropTargetId={tabDropTarget}
    tabs={[
      {
        id: 'live',
        label: $t('address.live'),
        subheading: $t('address.activeSubtitle'),
        badge: liveCount,
      },
      {
        id: 'inactive',
        label: $t('address.inactive'),
        subheading: $t('address.inactiveSubtitle'),
        badge: inactiveCount,
      },
    ]}
    onchange={(id) => onTabChange(id === 'live' ? 'active' : 'expired')}
    ondragover={(id, e) => handleTabDragOver(e, id as 'live' | 'inactive')}
    ondragleave={(id) => handleTabDragLeave(id as 'live' | 'inactive')}
    ondrop={(id, e) => handleTabDrop(e, id as 'live' | 'inactive')}
  />
</div>

<!-- Search + Filters -->
<div class="scroll-edge pb-2 shrink-0 relative {PORTAL_Z_CLASS.chrome}">
  <SearchFilterHeader
    scope="mailManagement"
    bind:value={mgmtSearch}
    placeholder={$t('address.searchAddressesOrTags')}
    ariaLabel={$t('address.searchAddresses')}
    settingsStyle={true}
    showSlashButton={true}
    borderBottom={false}
    paddingClass="p-0"
    animatedPlaceholders={[
      $t('searchPlaceholder.addresses'),
      $t('searchPlaceholder.tags'),
      $t('searchPlaceholder.providers'),
    ]}
    shortcuts={[
      {
        prefix: 'tag:',
        label: 'tag:',
        description: $t('address.searchAddressesOrTags'),
      },
    ]}
    onChange={(v: string) => onSearchChange(v)}
    onInputRef={(input) => { addressSearchInput = input; }}
  >
    {#snippet filterControl()}
      <button
        type="button"
        id="button-addresses-filter"
        bind:this={filterTriggerEl}
        class="w-8 h-8 flex items-center justify-center rounded-full border border-md-outline-variant text-md-on-surface/60 transition-colors relative active:brightness-95 {controlSurface(
          filterMenuOpen || hasActiveExtraFilters
        )}"
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
  </SearchFilterHeader>

  <ActiveFilterChips filters={activeAddressFilters} onRemove={removeAddressFilter} onClear={() => { clearAddressFilters(); removeAddressFilter('search'); }} onEmpty={() => addressSearchInput?.focus()} />
  <div class="mt-2">
    <Dropdown id="addresses-sort" value={listOrder} ariaLabel={$t('address.sortBy')} size="xs" options={[
      { value: 'custom', label: $t('address.sortCustom') },
      { value: 'expiry', label: $t('address.sortExpiry') },
      { value: 'unread', label: $t('address.sortUnread') },
      { value: 'recent', label: $t('address.sortRecent') },
    ]} onchange={(value) => { listOrder = value as AddressListOrder; }} />
  </div>

  {#if filterMenuOpen}
    <button
      type="button"
      use:portalFlyoutAction
      class="fixed inset-0 {PORTAL_Z_CLASS.navMenu} bg-transparent cursor-default"
      aria-label={$t('common.close')}
      onclick={() => (filterMenuOpen = false)}
    ></button>
    <div
      use:addressFilterFlyout
      class="fixed {PORTAL_Z_CLASS.accountMenu} rounded-2xl border border-md-outline-variant bg-md-surface {ELEVATION.level2} overflow-y-auto"
      role="menu"
      aria-label={$t('address.filtersTitle')}
    >
      <div class="flex items-center justify-between px-3 py-2.5 border-b border-md-outline-variant/30">
        <span class="text-sm font-semibold text-md-on-surface">{$t('address.filtersTitle')}</span>
        <button
          type="button"
          class="text-xs font-semibold text-md-primary disabled:opacity-40"
          disabled={!hasActiveExtraFilters}
          onclick={() => clearAddressFilters()}
        >{$t('address.clearFilters')}</button>
      </div>

      <div class="px-3 py-2 space-y-1">
        <div class="text-xs font-bold text-md-on-surface-variant">
          {$t('address.filterDateRange')}
        </div>
        {#each [
          { id: 'any' as const, key: 'address.filterAnyTime' },
          { id: '7' as const, key: 'address.filterLast7' },
          { id: '30' as const, key: 'address.filterLast30' },
          { id: '90' as const, key: 'address.filterLast90' },
        ] as opt (opt.id)}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={filterDateRange === opt.id}
            class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-start hover:bg-md-surface-variant/50 active:bg-md-surface-variant/70
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
        <div class="text-xs font-bold text-md-on-surface-variant">
          {$t('address.filterProvider')}
        </div>
        {#each [{ id: 'all' as const, label: $t('address.filterAllProviders') }, ...availableProviders.map((p: string) => ({ id: p, label: p }))] as opt (opt.id)}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={filterProvider === opt.id}
            class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-start hover:bg-md-surface-variant/50 active:bg-md-surface-variant/70
              {filterProvider === opt.id ? 'text-md-primary font-medium' : 'text-md-on-surface'}"
            onclick={() => { filterProvider = opt.id; filterInstance = 'all'; }}
          >
            <span
              class="w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0
                {filterProvider === opt.id ? 'border-md-primary' : 'border-md-outline-variant'}"
            >
              {#if filterProvider === opt.id}
                <span class="w-1.5 h-1.5 rounded-full bg-md-primary"></span>
              {/if}
            </span>
            {opt.label}
          </button>
        {/each}

        <div class="text-xs font-bold text-md-on-surface-variant mt-2">
          {$t('address.filterInstance')}
        </div>
        {#if availableInstances.length > 0}
          {#each [{ id: 'all' as const, label: $t('address.filterAllInstances') }, ...availableInstances.map((i: string) => ({ id: i, label: i }))] as opt (opt.id)}
            <button
              type="button"
              role="menuitemradio"
              aria-checked={filterInstance === opt.id}
              class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-start hover:bg-md-surface-variant/50 active:bg-md-surface-variant/70
                {filterInstance === opt.id ? 'text-md-primary font-medium' : 'text-md-on-surface'}"
              onclick={() => (filterInstance = opt.id)}
            >
              <span
                class="w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0
                  {filterInstance === opt.id ? 'border-md-primary' : 'border-md-outline-variant'}"
              >
                {#if filterInstance === opt.id}
                  <span class="w-1.5 h-1.5 rounded-full bg-md-primary"></span>
                {/if}
              </span>
              {opt.label}
            </button>
          {/each}
        {/if}
      </div>

      <div class="h-px bg-md-outline-variant/30 mx-2"></div>

      <div class="px-3 py-2 space-y-1">
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={filterAutoRenew}
          class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-start hover:bg-md-surface-variant/50 active:bg-md-surface-variant/70 text-md-on-surface"
          onclick={() => (filterAutoRenew = !filterAutoRenew)}
        >
          <span
            class="w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0
              {filterAutoRenew ? 'bg-md-primary border-md-primary text-md-on-primary' : 'border-md-outline-variant'}"
          >
            {#if filterAutoRenew}<Icon name="check" class="w-2.5 h-2.5" />{/if}
          </span>
          {$t('address.filterAutoRenew')}
        </button>
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={filterHasTags}
          class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-start hover:bg-md-surface-variant/50 active:bg-md-surface-variant/70 text-md-on-surface"
          onclick={() => (filterHasTags = !filterHasTags)}
        >
          <span
            class="w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0
              {filterHasTags ? 'bg-md-primary border-md-primary text-md-on-primary' : 'border-md-outline-variant'}"
          >
            {#if filterHasTags}<Icon name="check" class="w-2.5 h-2.5" />{/if}
          </span>
          {$t('address.filterHasTags')}
        </button>
      </div>
    </div>
  {/if}
</div>

<!-- Selection is entered on the rows themselves (hold, marquee, checkbox,
     context menu) and acted on by the shell's one strip - this view used to
     render its own always-visible Select row and its own actions strip. -->

<!-- Address list (hold row / marquee to multi-select) -->
<div
  id="{tabsIdPrefix}-panel-{mgmtTab === 'active' ? 'live' : 'inactive'}"
  class="flex flex-col flex-1 min-h-0 overflow-hidden"
  role="tabpanel"
  aria-labelledby="{tabsIdPrefix}-tab-{mgmtTab === 'active' ? 'live' : 'inactive'}"
  tabindex="0"
>
<div
  class="scroll-body scroll-body-framed flex-1 {loadingAddresses || displayedAddresses.length > 0 ? 'overflow-y-auto' : 'overflow-hidden'} border-t border-md-outline-variant/30 divide-y divide-md-outline-variant/50 relative"
  role="list"
  bind:this={listRootEl}
  onscroll={handleAddressListScroll}
  onpointerdown={onAddressesMarqueeDown}
>
  {#if loadingAddresses && displayedAddresses.length === 0}
    <!-- Skeleton loader -->
    {#each Array(addressSkeletonCount) as _, i (i)}
      <div class="flex items-center gap-3 px-3 py-2 min-h-[60px]">
        <Skeleton width="1.25rem" height="1.25rem" radius="0.5rem" class="shrink-0" />
        <div class="flex-1 space-y-2">
          <Skeleton width="75%" height="1rem" />
          <Skeleton width="50%" height="0.75rem" />
          <Skeleton width="66%" height="0.75rem" />
        </div>
        <div class="flex gap-1">
          <Skeleton width="2rem" height="2rem" radius="0.5rem" />
          <Skeleton width="2rem" height="2rem" radius="0.5rem" />
        </div>
      </div>
    {/each}
  {:else}
    {#each displayedAddresses as account (account.id)}
      {@const isDragging = draggedAddressId === account.id}
      {@const isDropTarget = dropTargetAddressId === account.id}
      {@const accountEmails = asEmailList(storedEmails?.[account.address])}
      {@const { senders, remainder } = getSenderAvatars(accountEmails)}
      {@const isChecked = selectedAddresses.has(account.id)}
      {@const pill = getStatusPill(account)}
      {@const unread = unreadCount(accountEmails)}
      {@const expiryText = expiryLabel(account, Date.now())}
      {@const expiryCap = expiryCaption(account, Date.now())}
      {@const retryCap = renewalRetryCaption(account, Date.now())}
      {@const effectiveMinutes = effectiveRenewalMinutes(account)}
      {@const isHighlighted =
        !!highlightAddress &&
        (account.address === highlightAddress ||
          account.address.toLowerCase() === highlightAddress.toLowerCase())}
      <!-- The row's surface and its ink come from the shared row contract: a
           view does not pick a fill alpha, a ring or a hover wash of its own. -->
      {@const surfaceState = rowSurfaceState({
        selected: selectionMode && isChecked,
        highlighted: isHighlighted,
        unread: unread > 0,
      })}
      {@const ink = (role: RowInkRole) => rowInk(role, surfaceState)}
      <div
        class="relative flex min-h-[60px] items-center gap-2 px-2.5 py-2 density-row transition-colors duration-150 {selectionMode && isChecked ? 'rounded-lg' : 'rounded-none'} {rowSurface({ selected: selectionMode && isChecked, highlighted: isHighlighted, unread: unread > 0 })} {isDragging ? 'opacity-50' : ''} {isDropTarget ? 'ring-2 ring-inset ring-md-primary drop-target-pulse' : ''} {isHighlighted ? 'address-highlight' : ''}"
        draggable={selectionMode || (listOrder === 'custom' && !mgmtSearch)}
        role="listitem"
        data-address={account.address}
        data-marquee-id={account.id}
        data-selectable-row={account.id}
        use:keyboardReorder={{ id: account.id, ids: () => displayedAddresses.map((a: Address) => a.id), disabled: listOrder !== 'custom' || !!mgmtSearch || selectionMode, hint: $t('keyboardShortcuts.fixedReorderRow'), moveBefore: onReorderAddresses }}
        tabindex="-1"
        ondragstart={(e) => handleAddressDragStart(e, account.id)}
        ondragover={(e) => handleAddressDragOver(e, account.id)}
        ondragleave={() => handleAddressDragLeave(account.id)}
        ondrop={(e) => handleAddressDrop(e, account.id)}
        ondragend={handleAddressDragEnd}
        onpointerdown={() => { if (!selectionMode) startHold(account.id); }}
        onpointerup={() => cancelHold(account.id)}
        onpointerleave={() => cancelHold(account.id)}
        oncontextmenu={(e) => {
          e.preventDefault();
          selectionMode = true;
          if (!selectedAddresses.has(account.id)) onToggleSelect(account.id);
        }}
        aria-label={$t('address.dragToReorder', { values: { address: account.address } })}
      >
        {#if account === displayedAddresses[0] && !dragHintDismissed && !selectionMode && listOrder === 'custom'}
          <DragHint
            hintKey="dragHintSeen_mailManagement"
            text={$t('address.holdToSelectHint')}
            visible={true}
            onDismiss={handleAddressDragHintDismiss}
          />
        {/if}

        <!-- Leading icon: 3D flip to tick checkmark when selected -->
        <button
          type="button"
          class="{AVATAR_BOX.row} self-center shrink-0 rounded-full flex items-center justify-center [perspective:600px] bg-transparent p-0 border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-md-primary/30"
          aria-label={$t('address.selectAddress', { values: { address: account.address } })}
          aria-pressed={isChecked}
          onclick={(e) => {
            e.stopPropagation();
            if (shouldSuppressClick()) return;
            // Ticking a row IS entering selection mode, exactly as the identity
            // row's own tick does: the flip shows a check the moment it is
            // tapped, and the row contract states the tick as `selected`, so a
            // tick that left `selectionMode` false painted a check on a row that
            // showed no state at all.
            if (!selectionMode) selectionMode = true;
            onToggleSelect(account.id);
          }}
        >
          <div class="flip-card w-full h-full relative transition-transform duration-300 [transform-style:preserve-3d] {isChecked ? '[transform:rotateY(180deg)]' : ''}">
            <!-- Front Face: Letter Avatar - single Avatar source -->
            <div class="absolute inset-0 [backface-visibility:hidden] rounded-full overflow-hidden">
              <Avatar size="row" letter={account.address[0] || '?'} email={account.address} />
            </div>
            <!-- Back Face: Tick checkmark -->
            <div class="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)] rounded-full bg-md-secondary text-md-on-secondary flex items-center justify-center">
              <Icon name="check" class="{AVATAR_INK.row} text-md-on-secondary" />
            </div>
          </div>
        </button>

        <!-- Match the mailbox hierarchy: heading, supporting text, then badges. -->
        <button
          data-row-primary
          type="button"
          class="flex-1 min-w-0 text-start bg-transparent border-0 px-0 py-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-md-primary/30"
          onclick={(e) => {
            e.stopPropagation();
            if (shouldSuppressClick()) return;
            if (selectionMode) {
              onToggleSelect(account.id);
            } else {
              onOpenAddressView(account);
            }
          }}
        >
          <div class="flex items-center justify-between gap-1 mb-0.5 min-w-0">
            <span class="font-bold text-sm truncate leading-tight flex-1 min-w-0 {ink('primary')}" style="direction:ltr;unicode-bidi:isolate;" title={account.address}>{account.address}</span>
            {#if expiryText && expiryCap}
              <span class="text-xs font-medium cursor-help {ink('meta')} shrink-0 tabular-nums" title={$t(expiryCap.key, { values: expiryCap.values })}>{expiryText}</span>
            {/if}
          </div>

          <div class="flex items-center justify-between gap-2 min-w-0 {ink('primary')}">
            <ProviderPill provider={account.provider} instanceUrl={account.instanceUrl} variant="inline" />
            {#if senders.length === 0}
              <span class="text-xs {ink('meta')} truncate leading-tight">{$t('address.noMailYet')}</span>
            {:else}
              <span class="flex items-center gap-1 shrink-0">
              {#if unread > 0}
                <span class="min-w-[1.25rem] h-5 px-1.5 rounded-full bg-md-primary text-md-on-primary text-xs font-bold flex items-center justify-center tabular-nums" title={$t('address.unreadCount', { values: { n: unread } })}>{unread > 99 ? '99+' : unread}</span>
              {/if}
              <span
                role="button"
                tabindex="0"
                class="flex items-center shrink-0 cursor-pointer {controlSurface(false)} focus:outline-none focus:ring-2 focus:ring-md-primary/30 rounded-full"
                aria-label={$t('selection.select')}
                onclick={(e) => {
                  e.stopPropagation();
                  if (shouldSuppressClick()) return;
                  if (!selectionMode) selectionMode = true;
                  onToggleSelect(account.id);
                }}
                onkeydown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (shouldSuppressClick()) return;
                    if (!selectionMode) selectionMode = true;
                    onToggleSelect(account.id);
                  }
                }}
              >
                {#each senders as sender, i (sender.email + (sender.domain || ''))}
                  <span
                    class="relative {AVATAR_BOX.sm} rounded-full ring-2 ring-md-surface overflow-hidden flex items-center justify-center bg-md-surface-container-low flex-shrink-0 pointer-events-none"
                    style="z-index: {MAX_AVATARS - i}; margin-inline-start: {i === 0 ? '0' : '-6px'};"
                    title={sender.domain || sender.email}
                  >
                    <FaviconImage email={sender.email} domain={sender.domain} size="sm" class="object-cover pointer-events-none" fallbackLetter={sender.letter} />
                  </span>
                {/each}
                {#if remainder > 0}
                  <span
                    class="relative flex-shrink-0 {AVATAR_BOX.sm} rounded-full ring-2 ring-md-surface bg-md-surface-variant flex items-center justify-center pointer-events-none"
                    style="z-index: 0; margin-inline-start: -6px;"
                    title={$t('address.moreSenders', { values: { n: remainder } })}
                  >
                    <span class="text-label-sm font-bold text-md-on-surface/60 leading-none">{$t('common.plusN', { values: { n: remainder } })}</span>
                  </span>
                {/if}
              </span>
              </span>
            {/if}
          </div>

          {#if (expiryCap && !retryCap && effectiveMinutes == null) || pill === 'expired'}
            <div class="flex items-center gap-1 mt-0.5 min-w-0 text-xs {ink('meta')} leading-tight">
              {#if expiryCap}
                <Icon name="schedule" class="w-3 h-3 shrink-0" />
                <span class="truncate tabular-nums" title={$t(expiryCap.key, { values: expiryCap.values })}>{account.autoExtend && supportsRenew(account) ? $t('address.autoRenewIn', { values: { time: expiryText ?? '' } }) : $t('address.expiresIn', { values: { time: expiryText ?? '' } })}</span>
              {:else}
                <span class="truncate">{$t('address.expiredHint')}</span>
              {/if}
            </div>
          {/if}
          {#if retryCap || effectiveMinutes != null}
            <div class="flex items-center gap-1 mt-0.5 min-w-0 text-xs {ink('meta')} leading-tight">
              <Icon name="autoRenew" class="w-3 h-3 shrink-0" />
              {#if retryCap}
                <span class="truncate tabular-nums" title={$t('address.autoRenewRetryTooltip')}>{$t(retryCap.key, { values: retryCap.values })}</span>
              {:else if effectiveMinutes != null}
                <span class="truncate tabular-nums" title={$t('address.autoRenewWindowTooltip')}>{$t('address.autoRenewWindowHint', { values: { n: effectiveMinutes } })}</span>
              {/if}
            </div>
          {/if}

          {#if account.tags?.length || account.tag || pill !== 'live'}
          <div class="flex flex-wrap items-center gap-1 mt-1 min-w-0 w-full">
            {#each (Array.isArray(account.tags) && account.tags.length
              ? account.tags
              : account.tag
                ? [{ name: account.tag, color: account.tagColor || '' }]
                : []) as tagEntry (tagEntry.name)}
              {@const usage = tagUsageFor(tagEntry.name)}
              {@const chipColor = tagColorFor(tagColors, tagEntry.name) ?? tagEntry.color}
              <span
                role="button"
                tabindex="0"
                data-tag-chip
                class="text-xs px-1.5 py-0.5 rounded-full truncate max-w-full cursor-pointer {controlSurface(false)} transition-colors
                  {chipColor
                    ? 'text-md-on-primary'
                    : 'bg-md-surface-variant text-md-on-surface/60'}"
                style={chipColor
                  ? `background-color: ${chipColor}; color: ${tagInkColor(chipColor)};`
                  : undefined}
                title={usage?.label ??
                  $t('address.filterByTag', { values: { tag: tagEntry.name } })}
                onclick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onSearchChange(`tag:${tagEntry.name}`);
                }}
                onkeydown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                    e.preventDefault();
                    onSearchChange(`tag:${tagEntry.name}`);
                  }
                }}                >{tagEntry.name}{#if usage}<span
                  class="ms-1 opacity-75 tabular-nums font-semibold"
                  aria-hidden="true">{usage.count}</span
                >{/if}</span
              >
            {/each}
            {#if pill !== 'live'}
              <Badge
                variant={pill === 'deleted' ? 'error' : pill === 'expired' ? 'warning' : 'neutral'}
                size="sm"
                label={$t(statusPillLabel(pill))}
                class="font-bold shrink-0"
              />
            {/if}
          </div>
          {/if}
        </button>

        <!-- ⋮ menu -->
        <div class="flex items-center shrink-0 self-center {selectionMode ? 'opacity-40 pointer-events-none' : ''}" data-no-marquee>
          <button
            type="button"
            class="flex items-center justify-center p-0.5 rounded-full border-0 bg-transparent hover:bg-md-surface-variant/40 active:bg-md-surface-variant/60 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-md-primary/30"
            aria-label={$t('address.moreActions')}
            aria-haspopup="menu"
            aria-expanded={rowMenuOpenId === account.id}
            onclick={(e) => openRowMenu(e, account.id)}
          >
            <Icon name="moreVert" class="w-5 h-5 {ink('icon')}" />
          </button>
          {#if rowMenuOpenId === account.id}
            <button
              type="button"
              class="fixed inset-0 {PORTAL_Z_CLASS.navMenu} cursor-default bg-transparent border-0"
              aria-label={$t('common.close')}
              onclick={(e) => { e.stopPropagation(); closeRowMenu(); }}
            ></button>
            <MenuList
              floating={{ placement: 'bottom-end', onClose: closeRowMenu }}
              class="fixed {PORTAL_Z_CLASS.accountMenu} min-w-[190px]"
              role="menu"
              ariaLabel={$t('address.moreActions')}
              style="top: {rowMenuPos.top}px; left: {rowMenuPos.left}px;"
            >
              {#if pill === 'archived' && canUnarchive(account)}
                <button type="button" role="menuitem" class="menu-list-item w-full flex items-center gap-3 px-3 min-h-12 text-sm text-start" onclick={() => { closeRowMenu(); onUnarchiveAddress(account); }}>
                  <Icon name="unarchive" class="w-3.5 h-3.5" />{$t('common.unarchive')}
                </button>
              {:else if pill !== 'deleted'}
                <button type="button" role="menuitem" class="menu-list-item w-full flex items-center gap-3 px-3 min-h-12 text-sm text-start" onclick={() => { closeRowMenu(); onArchiveAddress(account); }}>
                  <Icon name="archive" class="w-3.5 h-3.5" />{$t('common.archive')}
                </button>
              {/if}
              <button type="button" role="menuitem" class="menu-list-item w-full flex items-center gap-3 px-3 min-h-12 text-sm text-start is-danger" onclick={() => { closeRowMenu(); onDeleteAddresses([account]); }}>
                <Icon name="delete" class="w-3.5 h-3.5" />{$t('common.delete')}
              </button>
              <button type="button" role="menuitem" class="menu-list-item w-full flex items-center gap-3 px-3 min-h-12 text-sm text-start" onclick={() => { closeRowMenu(); onTagAddress(account); }}>
                <Icon name="add" class="w-3.5 h-3.5" />{$t('common.addTag')}
              </button>
              {#if supportsRenew(account)}
                <button type="button" role="menuitem" class="menu-list-item w-full flex items-center gap-3 px-3 min-h-12 text-sm text-start" onclick={() => handleAutoRenewClick(account)}>
                  <Icon name="refresh" class="w-3.5 h-3.5" />
                  {account.autoExtend ? $t('address.autoRenewOff') : $t('address.autoRenewOn')}
                </button>
              {/if}
              <button type="button" role="menuitem" class="menu-list-item w-full flex items-center gap-3 px-3 min-h-12 text-sm text-start" onclick={() => { closeRowMenu(); onExportAddressEmails(account); }}>
                <Icon name="download" class="w-3.5 h-3.5" />{$t('addressView.downloadEmails')}
              </button>
              <button
                type="button"
                role="menuitem"
                class="menu-list-item w-full flex items-center gap-3 px-3 min-h-12 text-sm text-start {getMailboxReadState(accountEmails).canMarkAllUnread ? '' : 'is-disabled'}"
                disabled={!getMailboxReadState(accountEmails).canMarkAllUnread}
                aria-disabled={!getMailboxReadState(accountEmails).canMarkAllUnread}
                onclick={() => {
                  if (!getMailboxReadState(accountEmails).canMarkAllUnread) return;
                  closeRowMenu();
                  onMarkAddressAllUnread(account);
                }}
              >
                <Icon name="mark_email_unread" class="w-3.5 h-3.5" />{$t('addressView.markAllUnread')}
              </button>
              <button
                type="button"
                role="menuitem"
                class="menu-list-item w-full flex items-center gap-3 px-3 min-h-12 text-sm text-start {getMailboxReadState(accountEmails).canMarkAllRead ? '' : 'is-disabled'}"
                disabled={!getMailboxReadState(accountEmails).canMarkAllRead}
                aria-disabled={!getMailboxReadState(accountEmails).canMarkAllRead}
                onclick={() => {
                  if (!getMailboxReadState(accountEmails).canMarkAllRead) return;
                  closeRowMenu();
                  onMarkAddressAllRead(account);
                }}
              >
                <Icon name="mark_email_read" class="w-3.5 h-3.5" />{$t('addressView.markAllRead')}
              </button>
            </MenuList>
          {/if}
        </div>
      </div>
    {:else}
      <EmptyState
        icon="inbox"
        title={$t('address.noAddressesFound', { values: { tab: mgmtTab } })}
        actionLabel={mgmtTab === 'active' ? $t('address.generateNewAddress') : undefined}
        onAction={mgmtTab === 'active' ? onGenerateNewAddress : undefined}
        fillParent
      />
    {/each}
  {/if}
  <!-- Dynamic End-of-List Spacer: allows content to flow behind floating nav & strips while ensuring the final item can scroll cleanly above controls -->
  <div
    class="w-full shrink-0 transition-[height] duration-200 ease-in-out pointer-events-none"
    style="height: calc(var(--bottom-safe-area, 0px) + var(--selection-bar-offset, 0px) + 12px);"
    aria-hidden="true"
  ></div>
</div>
</div>

{#if marqueeActive && marqueeRect}
  <div
    class="fixed pointer-events-none {PORTAL_Z_CLASS.marquee} border border-md-primary/70 bg-md-primary/15 rounded-sm"
    style="left:{marqueeRect.left}px;top:{marqueeRect.top}px;width:{marqueeRect.right - marqueeRect.left}px;height:{marqueeRect.bottom - marqueeRect.top}px;"
    aria-hidden="true"
  ></div>
{/if}

<!-- Cross-tab drag confirm -->
{#if crossTabPrompt}
  <ModalDialog
    open={!!crossTabPrompt}
    title={crossTabPrompt.direction === 'toInactive'
      ? $t('address.dragToInactiveTitleMany')
      : $t('address.dragToLiveTitleMany')}
    onClose={() => (crossTabPrompt = null)}
    maxWidth="xs"
  >
    {#if crossTabPrompt.direction === 'toInactive'}
      <p class="text-sm text-md-on-surface-variant">
        {$t('address.dragToInactiveBodyMany', { values: { n: crossTabPrompt.accounts.length } })}
      </p>
    {:else}
      <p class="text-sm text-md-on-surface-variant">
        {$t('address.dragToLiveBodyMany', { values: { n: crossTabPrompt.accounts.length } })}
      </p>
    {/if}
    {#snippet footer()}
      {#if crossTabPrompt}
        {@const prompt = crossTabPrompt}
        <div class="flex flex-col gap-2 w-full">
          {#if prompt.direction === 'toInactive'}
            <Btn
              variant="warningOutline"
              class="w-full"
              onClick={() => applyToInactive('archive')}
            >
              {$t('common.archive')} ({prompt.accounts.length})
            </Btn>
            <Btn
              variant="danger"
              class="w-full"
              onClick={() => applyToInactive('delete')}
            >
              {$t('common.delete')} ({prompt.accounts.length})
            </Btn>
          {:else}
            {#if anyArchived(prompt.accounts)}
              <Btn
                variant="outline"
                class="w-full text-md-success border-md-success/30 hover:bg-md-success/10 active:bg-md-success/30"
                onClick={() => applyToLive('unarchive')}
              >
                {$t('common.unarchive')} ({prompt.accounts.length})
              </Btn>
            {/if}
            {#if anyRenewable(prompt.accounts)}
              <Btn
                variant="primary"
                class="w-full"
                onClick={() => applyToLive('renew')}
              >
                {$t('address.renewAddresses')} ({prompt.accounts.length})
              </Btn>
            {/if}
            {#if !anyArchived(prompt.accounts) && !anyRenewable(prompt.accounts)}
              <p class="text-sm text-md-on-surface-variant">{$t('address.dragToLiveNoAction')}</p>
            {/if}
          {/if}
          <Btn
            variant="ghost"
            class="w-full"
            onClick={() => (crossTabPrompt = null)}
          >
            {$t('common.cancel')}
          </Btn>
        </div>
      {/if}
    {/snippet}
  </ModalDialog>
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
