<script lang="ts">
import { onMount, type Snippet, untrack } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import Icon from '@/components/icons/Icon.svelte';
import SearchBar from '@/components/ui/composites/SearchBar.svelte';
import { avatarColor } from '@/utils/avatar-color.js';
import {
  getSearchHistory,
  pushSearchHistory,
  removeSearchHistoryItem,
} from '@/utils/search-history.js';
import type { Email, SavedSearchFilter } from '@/utils/types.js';

let {
  searchQuery = '',
  sortBy = 'newest',
  otpOnly = false,
  senderDomain = '',
  senderEmail = '',
  selectedSenders = [] as string[],
  dateFrom = '',
  dateTo = '',
  emails = [] as Email[],
  savedSearchFilters = [] as SavedSearchFilter[],
  onSearchChange = () => {},
  onSortChange = () => {},
  onOtpOnlyChange = () => {},
  onSenderDomainChange = () => {},
  onSelectedSendersChange = (_v: string[]) => {},
  onDateFromChange = () => {},
  onDateToChange = () => {},
  onClearFilters = () => {},
  onSaveFilter = (
    _name: string,
    _searchQuery: string,
    _hasOTP: boolean,
    _senderDomain: string,
    _dateFrom: string,
    _dateTo: string,
    _selectedSenders: string[],
    _sortBy: string
  ) => {},
  onLoadFilter = (_filter: SavedSearchFilter) => {},
  onRenameFilter = (_id: string, _name: string) => {},
  onDeleteFilter = (_id: string) => {},
  onRefreshInbox = async () => {},
  /** Parent sets true while checkEmails / refresh is in flight */
  emailsLoading = false,
  onToggleNotifications = () => {},
  notificationsEnabled = true,
  /** Current mailbox address - used for per-address notification snooze */
  currentAddress = '' as string,
  onSearchFocus = () => {},
  onSearchBlur = () => {},
  onFilterClick = () => {},
  /** Optional layout control rendered just before the refresh control */
  layoutMenu = undefined as Snippet | undefined,
  /** When true, parent shows “filters applied” strip; chips stay available */
  showFilterMenuExternal = false,
}: {
  searchQuery?: string;
  sortBy?: string;
  otpOnly?: boolean;
  senderDomain?: string;
  senderEmail?: string;
  selectedSenders?: string[];
  dateFrom?: string;
  dateTo?: string;
  emails?: Email[];
  savedSearchFilters?: SavedSearchFilter[];
  onSearchChange?: (v: string) => void;
  onSortChange?: (v: string) => void;
  onOtpOnlyChange?: (v: boolean) => void;
  onSenderDomainChange?: (v: string) => void;
  onSelectedSendersChange?: (v: string[]) => void;
  onDateFromChange?: (v: string) => void;
  onDateToChange?: (v: string) => void;
  onClearFilters?: () => void;
  onSaveFilter?: (
    name: string,
    searchQuery: string,
    hasOTP: boolean,
    senderDomain: string,
    dateFrom: string,
    dateTo: string,
    selectedSenders: string[],
    sortBy: string
  ) => void;
  onLoadFilter?: (filter: SavedSearchFilter) => void;
  onRenameFilter?: (id: string, name: string) => void;
  onDeleteFilter?: (id: string) => void;
  onRefreshInbox?: () => void | Promise<void>;
  emailsLoading?: boolean;
  onToggleNotifications?: () => void;
  notificationsEnabled?: boolean;
  currentAddress?: string;
  onSearchFocus?: () => void;
  onSearchBlur?: () => void;
  onFilterClick?: () => void;
  layoutMenu?: Snippet;
  showFilterMenuExternal?: boolean;
} = $props();

let saveFilterName = $state('');
let showSaveFilter = $state(false);
let refreshLoading = $state(false);
let searchFocused = $state(false);
/** Filter submenu (does not focus the search bar) */
let filterMenuOpen = $state(false);
/** Side flyout for nested filter panels (sort / date / from / saved) */
let filterFlyout = $state<'from' | 'sort' | 'date' | 'saved' | null>(null);
let notifMenuOpen = $state(false);
let snoozeUntil = $state(0);
/** / shortcuts panel (button or typing /) */
let shortcutsPanelOpen = $state(false);
/** Animated empty placeholder text (written only from timers, not effect deps) */
let placeholderTyped = $state('');

let hasActiveFilters = $derived(
  sortBy !== 'newest' ||
    otpOnly ||
    !!dateFrom ||
    !!dateTo ||
    selectedSenders.length > 0 ||
    !!senderDomain ||
    !!senderEmail ||
    !!searchQuery?.trim()
);

async function loadSnoozeForAddress() {
  if (!currentAddress) {
    snoozeUntil = 0;
    return;
  }
  try {
    const res = (await browser.storage.local.get(['notificationSnoozeByAddress'])) as {
      notificationSnoozeByAddress?: Record<string, number>;
    };
    const map = res.notificationSnoozeByAddress || {};
    const until = map[currentAddress] || map[currentAddress.toLowerCase()] || 0;
    snoozeUntil = until > Date.now() ? until : 0;
  } catch {
    snoozeUntil = 0;
  }
}

async function applySnooze(durationMs: number) {
  if (!currentAddress) return;
  const until = Date.now() + durationMs;
  try {
    const res = (await browser.storage.local.get(['notificationSnoozeByAddress'])) as {
      notificationSnoozeByAddress?: Record<string, number>;
    };
    const map = { ...(res.notificationSnoozeByAddress || {}) };
    map[currentAddress] = until;
    await browser.storage.local.set({ notificationSnoozeByAddress: map });
    snoozeUntil = until;
  } catch {
    /* ignore */
  }
  notifMenuOpen = false;
}

async function clearSnooze() {
  if (!currentAddress) return;
  try {
    const res = (await browser.storage.local.get(['notificationSnoozeByAddress'])) as {
      notificationSnoozeByAddress?: Record<string, number>;
    };
    const map = { ...(res.notificationSnoozeByAddress || {}) };
    delete map[currentAddress];
    delete map[currentAddress.toLowerCase()];
    await browser.storage.local.set({ notificationSnoozeByAddress: map });
    snoozeUntil = 0;
  } catch {
    /* ignore */
  }
  notifMenuOpen = false;
}

function customSnooze() {
  const raw = window.prompt($t('inbox.snoozeCustomPrompt') || 'Minutes?', '60');
  if (raw == null) return;
  const mins = Number.parseInt(raw, 10);
  if (!Number.isFinite(mins) || mins <= 0) return;
  void applySnooze(mins * 60 * 1000);
}

/** Compact remaining snooze label for bell badge (e.g. 5m, 2h, 1d). */
function formatSnoozeRemaining(until: number, now = Date.now()): string {
  const ms = until - now;
  if (ms <= 0) return '';
  const mins = Math.max(1, Math.ceil(ms / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.max(1, Math.ceil(ms / 3_600_000));
  if (hours < 24) return `${hours}h`;
  const days = Math.max(1, Math.ceil(ms / 86_400_000));
  return `${days}d`;
}

/** Bumps so remaining snooze badge text stays current without self-assign */
let snoozeTick = $state(0);
let snoozeLabel = $derived.by(() => {
  void snoozeTick;
  return snoozeUntil > Date.now() ? formatSnoozeRemaining(snoozeUntil) : '';
});

// Keep remaining badge fresh while snooze is active
$effect(() => {
  if (snoozeUntil <= Date.now()) return;
  const id = setInterval(() => {
    if (snoozeUntil <= Date.now()) {
      snoozeUntil = 0;
    } else {
      snoozeTick += 1;
    }
  }, 30_000);
  return () => clearInterval(id);
});

$effect(() => {
  void currentAddress;
  void loadSnoozeForAddress();
});
let sortDropdownOpen = $state(false);
let dateDropdownOpen = $state(false);
let recentSearches = $state<string[]>([]);

async function refreshRecentSearches() {
  recentSearches = await getSearchHistory('inbox');
}

async function commitSearchHistory() {
  const q = (searchQuery || '').trim();
  if (q) {
    recentSearches = await pushSearchHistory('inbox', q);
  }
}

onMount(() => {
  void refreshRecentSearches();
});
let fromDropdownOpen = $state(false);
let savedFiltersDropdownOpen = $state(false);
let manageFiltersOpen = $state(false);
let renamingFilterId = $state<string | null>(null);
let renameFilterName = $state('');
let renameInputRef = $state<HTMLInputElement | null>(null);
let fromSearch = $state('');
let filterRowRef = $state<HTMLElement | null>(null);
let showCustomRange = $state(false);
let datePreset = $state<string>('any');

// Visual Search Pills & Autocomplete state
let currentInputText = $state('');
let showAutocomplete = $state(false);

const SHORTCUT_REGEX = /^(is:otp|from:\S+|subject:\S+|to:\S+)$/i;

let parsedPills = $derived.by(() => {
  if (!searchQuery) return [];
  const parts = searchQuery.split(/\s+/);
  return parts.filter((part) => SHORTCUT_REGEX.test(part));
});

let freeTextQuery = $derived.by(() => {
  if (!searchQuery) return '';
  const parts = searchQuery.split(/\s+/);
  return parts.filter((part) => !SHORTCUT_REGEX.test(part)).join(' ');
});

// Sync free-text from searchQuery only when unfocused. Compare+write via untrack
// so reading currentInputText does not re-subscribe this effect to itself.
$effect(() => {
  if (searchFocused) return;
  const next = freeTextQuery;
  untrack(() => {
    if (currentInputText !== next) currentInputText = next;
  });
});

function updateFullQuery(newPills: string[], text: string) {
  const full = [...newPills, text.trim()].filter(Boolean).join(' ');
  onSearchChange(full);
}

function addPill(pillText: string) {
  if (parsedPills.includes(pillText)) return;
  updateFullQuery([...parsedPills, pillText], '');
  currentInputText = '';
  showAutocomplete = false;
}

function removePill(pillText: string) {
  const nextPills = parsedPills.filter((p) => p !== pillText);
  updateFullQuery(nextPills, currentInputText);
}

function handleInputKeydown(e: KeyboardEvent) {
  if (e.key === 'Backspace' && !currentInputText && parsedPills.length > 0) {
    const lastPill = parsedPills[parsedPills.length - 1];
    removePill(lastPill);
  } else if ((e.key === 'Enter' || e.key === ' ') && currentInputText.trim()) {
    if (SHORTCUT_REGEX.test(currentInputText.trim())) {
      e.preventDefault();
      addPill(currentInputText.trim());
    }
  }
}

let autocompleteSuggestions = $derived([
  {
    prefix: 'is:otp',
    label: $t('inbox.searchShortcut.isOtpLabel'),
    description: $t('inbox.searchShortcut.isOtpDesc'),
  },
  {
    prefix: 'from:',
    label: $t('inbox.searchShortcut.fromLabel'),
    description: $t('inbox.searchShortcut.fromDesc'),
  },
  {
    prefix: 'subject:',
    label: $t('inbox.searchShortcut.subjectLabel'),
    description: $t('inbox.searchShortcut.subjectDesc'),
  },
]);

let filteredSuggestions = $derived.by(() => {
  const query = currentInputText.toLowerCase().trim();
  // Show full list when panel opened via / button or query starts with /
  if (!query || query === '/') return autocompleteSuggestions;
  const q = query.startsWith('/') ? query.slice(1) : query;
  return autocompleteSuggestions.filter(
    (s) => s.prefix.toLowerCase().includes(q) || s.label.toLowerCase().includes(q)
  );
});

let showSlashShortcuts = $derived(
  shortcutsPanelOpen ||
    (searchFocused && (currentInputText.trim() === '/' || currentInputText.trim().startsWith('/')))
);

const PLACEHOLDER_KEYS = [
  'inbox.searchPlaceholderTags',
  'inbox.searchPlaceholderEmails',
  'inbox.searchPlaceholderShortcuts',
] as const;

// Animated rotating placeholder when search is empty.
// Snapshot labels outside tick; never read placeholderTyped as an effect dependency.
$effect(() => {
  const busy = !!(searchQuery?.trim() || parsedPills.length > 0 || currentInputText.trim());
  // Stabilize $t outputs into one dependency string
  const labelsKey = PLACEHOLDER_KEYS.map((k) => $t(k)).join('\0');
  if (busy) {
    // untrack: do not subscribe this effect to placeholderTyped
    untrack(() => {
      if (placeholderTyped !== '') placeholderTyped = '';
    });
    return;
  }

  const labels = labelsKey.split('\0');
  let cancelled = false;
  let idx = 0;
  let typed = '';
  let phase: 'type' | 'hold' | 'delete' = 'type';
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = () => {
    if (cancelled) return;
    const full = labels[idx % labels.length] || '';
    if (phase === 'type') {
      if (typed.length < full.length) {
        typed = full.slice(0, typed.length + 1);
        placeholderTyped = typed;
        timer = setTimeout(tick, 45);
      } else {
        phase = 'hold';
        timer = setTimeout(tick, 1400);
      }
    } else if (phase === 'hold') {
      phase = 'delete';
      timer = setTimeout(tick, 30);
    } else if (typed.length > 0) {
      typed = typed.slice(0, -1);
      placeholderTyped = typed;
      timer = setTimeout(tick, 28);
    } else {
      idx = (idx + 1) % labels.length;
      phase = 'type';
      timer = setTimeout(tick, 200);
    }
  };

  typed = '';
  untrack(() => {
    if (placeholderTyped !== '') placeholderTyped = '';
  });
  timer = setTimeout(tick, 400);
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
});

// Get display label for current sort option
let sortLabel = $derived.by(() => {
  switch (sortBy) {
    case 'newest':
      return `${$t('inbox.viewOptions.sortByDate')} · ${$t('inbox.viewOptions.sortNewestShort')}`;
    case 'oldest':
      return `${$t('inbox.viewOptions.sortByDate')} · ${$t('inbox.viewOptions.sortOldestShort')}`;
    case 'senderNameAsc':
      return `${$t('inbox.viewOptions.sortBySenderName')} · ${$t('inbox.viewOptions.sortAscShort')}`;
    case 'senderNameDesc':
      return `${$t('inbox.viewOptions.sortBySenderName')} · ${$t('inbox.viewOptions.sortDescShort')}`;
    case 'senderEmailAsc':
      return `${$t('inbox.viewOptions.sortBySenderEmail')} · ${$t('inbox.viewOptions.sortAscShort')}`;
    case 'senderEmailDesc':
      return `${$t('inbox.viewOptions.sortBySenderEmail')} · ${$t('inbox.viewOptions.sortDescShort')}`;
    case 'subjectAsc':
      return `${$t('inbox.viewOptions.sortBySubject')} · ${$t('inbox.viewOptions.sortAscShort')}`;
    case 'subjectDesc':
      return `${$t('inbox.viewOptions.sortBySubject')} · ${$t('inbox.viewOptions.sortDescShort')}`;
    default:
      return `${$t('inbox.viewOptions.sortByDate')} · ${$t('inbox.viewOptions.sortNewestShort')}`;
  }
});

// Focus action for rename input
function focusOnMount(node: HTMLInputElement) {
  node.focus();
  node.select();
}

// Check if current filter matches any saved filter
let currentFilterSaved = $derived(
  (Array.isArray(savedSearchFilters) ? savedSearchFilters : []).some(
    (f) =>
      f.searchQuery === searchQuery &&
      f.hasOTP === otpOnly &&
      f.senderDomain === senderDomain &&
      JSON.stringify(f.selectedSenders || []) === JSON.stringify(selectedSenders) &&
      f.dateFrom === dateFrom &&
      f.dateTo === dateTo &&
      (f.sortBy || 'newest') === sortBy
  )
);

let senderSuggestions = $derived(
  Array.from(
    new Map(
      emails
        .filter((e): e is typeof e & { from: string } => Boolean(e.from))
        .map((e) => [e.from.toLowerCase(), { email: e.from, name: e.from_name || '' }])
    ).values()
  )
    .filter(
      (s) =>
        fromSearch === '' ||
        s.email.toLowerCase().includes(fromSearch.toLowerCase()) ||
        s.name.toLowerCase().includes(fromSearch.toLowerCase())
    )
    .slice(0, 20)
);

function toggleSender(email: string) {
  const lower = email.toLowerCase();
  const exists = selectedSenders.some((s) => s.toLowerCase() === lower);
  const updated = exists
    ? selectedSenders.filter((s) => s.toLowerCase() !== lower)
    : [...selectedSenders, email];
  onSelectedSendersChange(updated);
}

function getInitial(email: string, name: string): string {
  return (name || email).trim().charAt(0).toUpperCase();
}

const DATE_PRESETS = [
  { value: 'any', label: 'Any time' },
  { value: 'week', label: 'Older than a week' },
  { value: 'month', label: 'Older than a month' },
  { value: '6months', label: 'Older than six months' },
  { value: 'year', label: 'Older than a year' },
];

function applyDatePreset(preset: string) {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (preset === 'any') {
    onDateFromChange('');
    onDateToChange('');
  } else if (preset === 'week') {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    onDateFromChange('');
    onDateToChange(fmt(d));
  } else if (preset === 'month') {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 1);
    onDateFromChange('');
    onDateToChange(fmt(d));
  } else if (preset === '6months') {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 6);
    onDateFromChange('');
    onDateToChange(fmt(d));
  } else if (preset === 'year') {
    const d = new Date(now);
    d.setFullYear(d.getFullYear() - 1);
    onDateFromChange('');
    onDateToChange(fmt(d));
  }
  datePreset = preset;
}

function formatDateChip(from: string, to: string): string {
  const fmtShort = (s: string) => {
    if (!s) return '';
    const [y, m, d] = s.split('-');
    return `${m}/${d}/${y.slice(2)}`;
  };
  if (from && to) return `${fmtShort(from)}–${fmtShort(to)}`;
  if (to) return `Until ${fmtShort(to)}`;
  if (from) return `From ${fmtShort(from)}`;
  return 'Date';
}
</script>

<div class="flex items-center gap-1 px-0 pb-1 relative" bind:this={filterRowRef}>
  <!-- Canonical SearchBar (shared shell, voice, history, / shortcuts) + mailbox pills -->
  <div class="relative flex-1 min-w-0">
    <SearchBar
      scope="inbox"
      inputId="inbox-search-input"
      bind:value={currentInputText}
      placeholder={parsedPills.length === 0
        ? placeholderTyped || $t('inbox.searchEmailsPlaceholder')
        : ''}
      ariaLabel={$t('inbox.focusSearch')}
      settingsStyle={true}
      showSlashButton={true}
      showVoiceSearch={true}
      shortcuts={filteredSuggestions.map((s) => ({
        prefix: s.prefix,
        label: s.label,
        description: s.description,
      }))}
      onChange={(val) => {
        currentInputText = val;
        updateFullQuery(parsedPills, val);
        showAutocomplete = true;
        searchFocused = true;
        if (val.trim().startsWith('/')) shortcutsPanelOpen = true;
        else if (!val.trim()) shortcutsPanelOpen = false;
      }}
      onFocus={() => {
        searchFocused = true;
        showAutocomplete = true;
        onSearchFocus();
        void refreshRecentSearches();
      }}
      onBlur={() => {
        setTimeout(() => {
          searchFocused = false;
          showAutocomplete = false;
          shortcutsPanelOpen = false;
          void commitSearchHistory();
          onSearchBlur();
        }, 200);
      }}
      onSubmit={(q) => {
        void pushSearchHistory('inbox', q).then(refreshRecentSearches);
      }}
    >
      {#snippet prefixContent()}
        {#each parsedPills as pill (pill)}
          <span
            class="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-md bg-md-primary/15 text-md-primary border border-md-primary/20 shrink-0"
          >
            <span>{pill}</span>
            <button
              type="button"
              class="hover:text-md-error focus:outline-none"
              onclick={(e) => {
                e.stopPropagation();
                removePill(pill);
              }}
              aria-label={$t('inbox.removeFilterPill', { values: { pill } })}
              title={$t('inbox.removeFilterPill', { values: { pill } })}
            >
              <Icon name="x" class="w-3 h-3" />
            </button>
          </span>
        {/each}
      {/snippet}
      {#snippet filterControl()}
        {#if !searchFocused}
          <button
            id="button-filter"
            type="button"
            class="w-8 h-8 flex items-center justify-center rounded-xl transition-colors {filterMenuOpen ||
            hasActiveFilters
              ? 'bg-md-primary/15 text-md-primary'
              : 'bg-md-surface hover:bg-md-surface-variant text-md-on-surface/50'}"
            aria-label={$t('inbox.filtersAria')}
            title={$t('inbox.filtersAria')}
            aria-expanded={filterMenuOpen}
            onclick={(e) => {
              e.stopPropagation();
              filterMenuOpen = !filterMenuOpen;
              filterFlyout = null;
              onFilterClick();
            }}
          >
            <Icon name="filter" class="w-4 h-4" />
          </button>
        {/if}
      {/snippet}
    </SearchBar>
  </div>

  <!-- Filter menu anchored to the search row (button lives in SearchBar filterControl) -->
  {#if filterMenuOpen && !searchFocused}
        <button
          type="button"
          class="fixed inset-0 z-[90] cursor-default bg-transparent"
          aria-label={$t('common.close')}
          onclick={() => {
            filterMenuOpen = false;
            filterFlyout = null;
          }}
        ></button>
        <!-- Compact root menu + side flyouts (MenuList MD3 tokens) -->
        <div
          class="menu-list absolute top-full end-0 mt-1 z-[100] w-[200px] rounded-xl border border-md-outline-variant/50 bg-md-surface-container-low shadow-xl motion-overlay-in overflow-visible"
          role="menu"
          tabindex="-1"
          aria-label={$t('inbox.filtersAria')}
          onmouseleave={() => { filterFlyout = null; }}
        >
          <button
            type="button"
            data-menu-item
            class="menu-list-item w-full flex items-center gap-2 px-2.5 py-2 text-sm text-start rounded-t-xl {filterFlyout === 'from' ? 'is-active' : ''}"
            role="menuitem"
            onmouseenter={() => (filterFlyout = 'from')}
            onclick={() => (filterFlyout = filterFlyout === 'from' ? null : 'from')}
          >
            <Icon name="user" class="menu-list-icon w-4 h-4 shrink-0" />
            <span class="flex-1 truncate font-medium">{$t('inbox.filterFrom')}</span>
            <Icon name="chevronRight" class="w-3.5 h-3.5 opacity-50 rtl-flip shrink-0" />
          </button>
          <button
            type="button"
            data-menu-item
            class="menu-list-item w-full flex items-center gap-2 px-2.5 py-2 text-sm text-start {filterFlyout === 'sort' ? 'is-active' : ''}"
            role="menuitem"
            onmouseenter={() => (filterFlyout = 'sort')}
            onclick={() => (filterFlyout = filterFlyout === 'sort' ? null : 'sort')}
          >
            <Icon name="clock" class="menu-list-icon w-4 h-4 shrink-0" />
            <span class="flex-1 truncate font-medium">{$t('inbox.filterSort')}</span>
            <Icon name="chevronRight" class="w-3.5 h-3.5 opacity-50 rtl-flip shrink-0" />
          </button>
          <button
            type="button"
            data-menu-item
            class="menu-list-item w-full flex items-center gap-2 px-2.5 py-2 text-sm text-start {otpOnly ? 'is-active' : ''}"
            role="menuitem"
            onclick={() => onOtpOnlyChange(!otpOnly)}
          >
            <Icon name="shield" class="menu-list-icon w-4 h-4 shrink-0" />
            <span class="flex-1 truncate font-medium">{$t('inbox.filterHasOtp')}</span>
            <span class="menu-list-trailing text-xs font-bold">{otpOnly ? $t('common.on') : $t('common.off')}</span>
          </button>
          <button
            type="button"
            data-menu-item
            class="menu-list-item is-disabled w-full flex items-center gap-2 px-2.5 py-2 text-sm text-start"
            role="menuitem"
            disabled
            aria-disabled="true"
            title={$t('inbox.filterHasAttachmentSoon')}
          >
            <Icon name="download" class="menu-list-icon w-4 h-4 shrink-0" />
            <span class="flex-1 truncate font-medium">{$t('inbox.filterHasAttachment')}</span>
          </button>
          <button
            type="button"
            data-menu-item
            class="menu-list-item w-full flex items-center gap-2 px-2.5 py-2 text-sm text-start {filterFlyout === 'date' ? 'is-active' : ''}"
            role="menuitem"
            onmouseenter={() => (filterFlyout = 'date')}
            onclick={() => (filterFlyout = filterFlyout === 'date' ? null : 'date')}
          >
            <Icon name="clock" class="menu-list-icon w-4 h-4 shrink-0" />
            <span class="flex-1 truncate font-medium">{$t('inbox.filterDateRange')}</span>
            <Icon name="chevronRight" class="w-3.5 h-3.5 opacity-50 rtl-flip shrink-0" />
          </button>
          {#if savedSearchFilters.length > 0}
            <button
              type="button"
              data-menu-item
              class="menu-list-item w-full flex items-center gap-2 px-2.5 py-2 text-sm text-start rounded-b-xl {filterFlyout === 'saved' ? 'is-active' : ''}"
              role="menuitem"
              onmouseenter={() => (filterFlyout = 'saved')}
              onclick={() => (filterFlyout = filterFlyout === 'saved' ? null : 'saved')}
            >
              <Icon name="filter" class="menu-list-icon w-4 h-4 shrink-0" />
              <span class="flex-1 truncate font-medium">{$t('inbox.filterSavedFilters')}</span>
              <Icon name="chevronRight" class="w-3.5 h-3.5 opacity-50 rtl-flip shrink-0" />
            </button>
          {/if}

          <!-- Side flyouts -->
          {#if filterFlyout === 'from'}
            <div class="absolute top-0 end-full me-1 w-[220px] max-h-56 overflow-y-auto rounded-xl border border-md-outline-variant/50 bg-md-surface-container-low shadow-xl z-[110] p-1" role="menu">
              {#each senderSuggestions as suggestion (suggestion.email)}
                {@const isSelected = selectedSenders.some((s) => s.toLowerCase() === suggestion.email.toLowerCase())}
                <button
                  type="button"
                  class="w-full flex items-center gap-2 px-2 py-2 text-start text-sm rounded-lg hover:bg-md-surface-variant {isSelected ? 'text-md-primary font-semibold' : ''}"
                  onclick={() => toggleSender(suggestion.email)}
                >
                  <span class="truncate flex-1">{suggestion.email}</span>
                  {#if isSelected}<Icon name="check" class="w-3.5 h-3.5 shrink-0" />{/if}
                </button>
              {:else}
                <p class="px-3 py-2 text-xs text-md-on-surface/40">{$t('inbox.filterNoSuggestions')}</p>
              {/each}
            </div>
          {:else if filterFlyout === 'sort'}
            <div class="absolute top-0 end-full me-1 w-[200px] max-h-64 overflow-y-auto rounded-xl border border-md-outline-variant bg-md-surface-container-low shadow-xl z-[110] py-1" role="menu">
              {#each [
                ['newest', 'inbox.viewOptions.sortNewest'],
                ['oldest', 'inbox.viewOptions.sortOldest'],
                ['senderNameAsc', 'inbox.viewOptions.sortSenderAsc'],
                ['senderNameDesc', 'inbox.viewOptions.sortSenderDesc'],
                ['senderEmailAsc', 'inbox.viewOptions.sortSenderEmailAsc'],
                ['senderEmailDesc', 'inbox.viewOptions.sortSenderEmailDesc'],
                ['subjectAsc', 'inbox.viewOptions.sortSubjectAsc'],
                ['subjectDesc', 'inbox.viewOptions.sortSubjectDesc'],
              ] as [val, labelKey] (val)}
                <button
                  type="button"
                  class="w-full flex items-center gap-2 px-2.5 py-2 text-start text-sm hover:bg-md-surface-variant {sortBy === val ? 'text-md-primary font-medium' : 'text-md-on-surface'}"
                  onclick={() => { onSortChange(val); filterMenuOpen = false; filterFlyout = null; }}
                >
                  <span class="flex-1">{$t(labelKey)}</span>
                  {#if sortBy === val}<Icon name="check" class="w-3.5 h-3.5 shrink-0" />{/if}
                </button>
              {/each}
            </div>
          {:else if filterFlyout === 'date'}
            <div class="absolute top-0 end-full me-1 w-[220px] rounded-xl border border-md-outline-variant bg-md-surface-container-low shadow-xl z-[110] p-3 space-y-2" role="menu">
              <label class="block text-xs text-md-on-surface/50">{$t('inbox.filterDateFrom')}
                <input type="date" class="mt-0.5 w-full px-2 py-1.5 text-sm rounded-lg border border-md-outline-variant bg-md-surface" value={dateFrom} onchange={(e) => onDateFromChange((e.target as HTMLInputElement).value)} />
              </label>
              <label class="block text-xs text-md-on-surface/50">{$t('inbox.filterDateTo')}
                <input type="date" class="mt-0.5 w-full px-2 py-1.5 text-sm rounded-lg border border-md-outline-variant bg-md-surface" value={dateTo} onchange={(e) => onDateToChange((e.target as HTMLInputElement).value)} />
              </label>
            </div>
          {:else if filterFlyout === 'saved'}
            <div class="absolute top-0 end-full me-1 w-[200px] max-h-48 overflow-y-auto rounded-xl border border-md-outline-variant bg-md-surface-container-low shadow-xl z-[110] py-1" role="menu">
              {#each savedSearchFilters as filter (filter.id)}
                <button
                  type="button"
                  class="w-full px-2.5 py-2 text-start text-sm hover:bg-md-surface-variant"
                  onclick={() => {
                    onSearchChange(filter.searchQuery);
                    onSortChange(filter.sortBy || 'newest');
                    onOtpOnlyChange(filter.hasOTP);
                    onSenderDomainChange(filter.senderDomain);
                    onSelectedSendersChange(filter.selectedSenders || []);
                    onDateFromChange(filter.dateFrom);
                    onDateToChange(filter.dateTo);
                    onLoadFilter(filter);
                    filterMenuOpen = false;
                    filterFlyout = null;
                  }}
                >{filter.name}</button>
              {/each}
            </div>
          {/if}
        </div>
  {/if}

  <!-- Layout menu immediately after Filter -->
  {#if !searchFocused && layoutMenu}
    {@render layoutMenu()}
  {/if}

  <!-- Refresh -->
  {#if !searchFocused}
    <button
      id="button-refresh-inbox"
      type="button"
      class="relative w-8 h-8 flex items-center justify-center rounded-xl transition-colors mt-0 bg-md-surface hover:bg-md-surface-variant shrink-0"
      aria-label={$t('nav.fabRefresh')}
      title={$t('nav.fabRefresh')}
      disabled={refreshLoading}
      onclick={async () => {
        refreshLoading = true;
        try {
          await onRefreshInbox();
        } finally {
          refreshLoading = false;
        }
      }}
    >
      <Icon name="refresh" class="w-4 h-4 text-md-primary {refreshLoading || emailsLoading ? 'animate-spin' : ''}" />
    </button>
  {/if}
</div>



<!-- Inline filter row (appears when search is focused) -->
{#if searchFocused}
  <div bind:this={filterRowRef} class="flex flex-col gap-2 px-1 pb-2 pt-0.5 relative">
    <!-- First row: filter chips -->
    <div class="flex items-center gap-1 flex-wrap">

    <!-- From chip -->
    <div class="relative shrink-0">
      <button
        id="button-from-filter"
        class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border transition-colors {selectedSenders.length > 0 || senderDomain || senderEmail ? 'border-md-primary bg-md-primary/10 text-md-primary' : 'border-md-outline-variant bg-transparent text-md-on-surface/80 hover:bg-md-surface-variant'}"
        aria-label="Filter by sender"
        onclick={() => { fromDropdownOpen = !fromDropdownOpen; sortDropdownOpen = false; dateDropdownOpen = false; savedFiltersDropdownOpen = false; }}
      >
        {#if selectedSenders.length === 0 && !senderDomain && !senderEmail}
          {$t('inbox.filterFrom')}
        {:else if selectedSenders.length === 1}
          {$t('inbox.filterFrom')} {selectedSenders[0].split('@')[0]}@…
        {:else if selectedSenders.length > 1}
          {$t('inbox.filterFrom')} {selectedSenders[0].split('@')[0]}@… {$t('common.plusN', { values: { n: selectedSenders.length - 1 } })}
        {:else if senderDomain}
          {$t('inbox.filterFrom')} {senderDomain}
        {:else if senderEmail}
          {$t('inbox.filterFrom')} {senderEmail.split('@')[0]}@…
        {/if}
        <Icon name="chevronDown" class="w-3 h-3" />
      </button>
      {#if fromDropdownOpen}
        <div class="absolute top-full start-0 mt-1 bg-md-surface-container border border-md-outline-variant rounded-2xl shadow-xl z-[200] overflow-hidden min-w-[260px]">
          <!-- Header -->
          <div class="flex items-center justify-between px-4 py-3 border-b border-md-outline-variant/30">
            <span class="text-sm font-semibold text-md-on-surface">{$t('inbox.filterFrom')}</span>
            <button id="button-close-from-filter" class="w-5 h-5 flex items-center justify-center text-md-on-surface/60 hover:text-md-on-surface transition-colors" aria-label="Close from filter" onclick={() => fromDropdownOpen = false}>
              <Icon name="x" class="w-3.5 h-3.5" />
            </button>
          </div>
          <!-- Selected chips -->
          {#if selectedSenders.length > 0}
            <div class="flex flex-wrap gap-1.5 px-4 pt-3 pb-1">
              {#each selectedSenders as sender (sender)}
                <div class="flex items-center gap-1 px-2 py-1 rounded-full border border-md-outline-variant text-xs bg-md-surface-variant">
                  <span class="w-4 h-4 rounded-full flex items-center justify-center text-xs font-bold {avatarColor(sender)}">
                    {getInitial(sender, '')}
                  </span>
                  <span class="max-w-[120px] truncate">{sender}</span>
                  <button id="button-remove-sender-{sender}" onclick={() => toggleSender(sender)} aria-label="Remove sender" class="ms-0.5 text-md-on-surface/50 hover:text-md-on-surface">
                    <Icon name="x" class="w-2.5 h-2.5" />
                  </button>
                </div>
              {/each}
            </div>
            <hr class="border-md-outline-variant/30 mt-2" />
          {/if}
          <!-- Search input -->
          <div class="px-4 pt-3 pb-2">
            <input
              id="input-from-search"
              type="text"
              placeholder="Type a name or email address"
              class="w-full bg-transparent border-b border-md-outline-variant/50 pb-1 text-sm text-md-on-surface placeholder:text-md-on-surface/40 outline-none focus:border-md-primary transition-colors"
              bind:value={fromSearch}
              aria-label="Search sender"
            />
          </div>
          <!-- Suggestions -->
          {#if senderSuggestions.length > 0}
            <div class="px-4 pb-1">
              <span class="text-xs font-medium text-md-on-surface/50">Suggestions</span>
            </div>
          {/if}
          <div class="max-h-48 overflow-y-auto pb-2">
            {#each senderSuggestions as suggestion (suggestion.email)}
              {@const isSelected = selectedSenders.some((s) => s.toLowerCase() === suggestion.email.toLowerCase())}
              <button
                id="button-select-sender-{suggestion.email}"
                class="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-md-surface-variant/50 transition-colors text-start"
                onclick={() => toggleSender(suggestion.email)}
              >
                <span class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors {isSelected ? 'bg-md-primary text-md-on-primary' : avatarColor(suggestion.email)}">
                  {#if isSelected}
                    ✓
                  {:else}
                    {getInitial(suggestion.email, suggestion.name)}
                  {/if}
                </span>
                <div class="min-w-0">
                  <div class="text-sm text-md-on-surface truncate">{suggestion.email}</div>
                  <div class="text-xs text-md-on-surface/50 truncate">{suggestion.email}</div>
                </div>
              </button>
            {:else}
              <div class="px-4 py-3 text-xs text-md-on-surface/40">{$t('inbox.filterNoSuggestions')}</div>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <!-- Sort chip -->
    <div class="relative shrink-0">
      <button
        id="button-sort"
        class="flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-full border transition-colors {sortBy !== 'newest' ? 'border-md-primary bg-md-primary/10 text-md-primary' : 'border-md-outline-variant bg-transparent text-md-on-surface/80 hover:bg-md-surface-variant'}"
        aria-label="Sort by"
        onclick={() => { sortDropdownOpen = !sortDropdownOpen; dateDropdownOpen = false; savedFiltersDropdownOpen = false; fromDropdownOpen = false; }}
      >
        {$t('inbox.filterSort')}: {sortLabel}
        <Icon name="chevronDown" class="w-3 h-3" />
      </button>
      {#if sortDropdownOpen}
        <div class="absolute top-full start-0 mt-1 bg-md-surface border border-md-outline-variant rounded-xl shadow-lg z-[200] overflow-hidden min-w-[220px] p-1.5 space-y-1.5">
          <!-- Date: segmented Newest | Oldest -->
          <div class="px-1.5 pt-1 pb-0.5 text-xs font-bold uppercase tracking-wide text-md-on-surface/45 flex items-center gap-1.5">
            <Icon name="clock" class="w-3 h-3" />
            {$t('inbox.viewOptions.sortByDate')}
          </div>
          <div class="flex items-stretch rounded-lg border border-md-outline-variant/50 overflow-hidden mx-0.5">
            <button
              id="button-sort-newest"
              type="button"
              class="flex-1 px-2 py-1.5 text-label-sm font-semibold transition-colors {sortBy === 'newest' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface text-md-on-surface hover:bg-md-surface-variant'}"
              onclick={() => { onSortChange('newest'); sortDropdownOpen = false; }}
            >{$t('inbox.viewOptions.sortNewestShort')}</button>
            <span class="w-px bg-md-outline-variant/60 shrink-0" aria-hidden="true"></span>
            <button
              id="button-sort-oldest"
              type="button"
              class="flex-1 px-2 py-1.5 text-label-sm font-semibold transition-colors {sortBy === 'oldest' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface text-md-on-surface hover:bg-md-surface-variant'}"
              onclick={() => { onSortChange('oldest'); sortDropdownOpen = false; }}
            >{$t('inbox.viewOptions.sortOldestShort')}</button>
          </div>

          <!-- Sender name: A–Z | Z–A -->
          <div class="px-1.5 pt-1 pb-0.5 text-xs font-bold uppercase tracking-wide text-md-on-surface/45 flex items-center gap-1.5">
            <Icon name="user" class="w-3 h-3" />
            {$t('inbox.viewOptions.sortBySenderName')}
          </div>
          <div class="flex items-stretch rounded-lg border border-md-outline-variant/50 overflow-hidden mx-0.5">
            <button
              id="button-sort-senderNameAsc"
              type="button"
              class="flex-1 px-2 py-1.5 text-label-sm font-semibold transition-colors {sortBy === 'senderNameAsc' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface text-md-on-surface hover:bg-md-surface-variant'}"
              onclick={() => { onSortChange('senderNameAsc'); sortDropdownOpen = false; }}
            >{$t('inbox.viewOptions.sortAscShort')}</button>
            <span class="w-px bg-md-outline-variant/60 shrink-0" aria-hidden="true"></span>
            <button
              id="button-sort-senderNameDesc"
              type="button"
              class="flex-1 px-2 py-1.5 text-label-sm font-semibold transition-colors {sortBy === 'senderNameDesc' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface text-md-on-surface hover:bg-md-surface-variant'}"
              onclick={() => { onSortChange('senderNameDesc'); sortDropdownOpen = false; }}
            >{$t('inbox.viewOptions.sortDescShort')}</button>
          </div>

          <!-- Sender email -->
          <div class="px-1.5 pt-1 pb-0.5 text-xs font-bold uppercase tracking-wide text-md-on-surface/45 flex items-center gap-1.5">
            <Icon name="envelope" class="w-3 h-3" />
            {$t('inbox.viewOptions.sortBySenderEmail')}
          </div>
          <div class="flex items-stretch rounded-lg border border-md-outline-variant/50 overflow-hidden mx-0.5">
            <button
              id="button-sort-senderEmailAsc"
              type="button"
              class="flex-1 px-2 py-1.5 text-label-sm font-semibold transition-colors {sortBy === 'senderEmailAsc' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface text-md-on-surface hover:bg-md-surface-variant'}"
              onclick={() => { onSortChange('senderEmailAsc'); sortDropdownOpen = false; }}
            >{$t('inbox.viewOptions.sortAscShort')}</button>
            <span class="w-px bg-md-outline-variant/60 shrink-0" aria-hidden="true"></span>
            <button
              id="button-sort-senderEmailDesc"
              type="button"
              class="flex-1 px-2 py-1.5 text-label-sm font-semibold transition-colors {sortBy === 'senderEmailDesc' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface text-md-on-surface hover:bg-md-surface-variant'}"
              onclick={() => { onSortChange('senderEmailDesc'); sortDropdownOpen = false; }}
            >{$t('inbox.viewOptions.sortDescShort')}</button>
          </div>

          <!-- Subject -->
          <div class="px-1.5 pt-1 pb-0.5 text-xs font-bold uppercase tracking-wide text-md-on-surface/45 flex items-center gap-1.5">
            <Icon name="mail" class="w-3 h-3" />
            {$t('inbox.viewOptions.sortBySubject')}
          </div>
          <div class="flex items-stretch rounded-lg border border-md-outline-variant/50 overflow-hidden mx-0.5 mb-0.5">
            <button
              id="button-sort-subjectAsc"
              type="button"
              class="flex-1 px-2 py-1.5 text-label-sm font-semibold transition-colors {sortBy === 'subjectAsc' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface text-md-on-surface hover:bg-md-surface-variant'}"
              onclick={() => { onSortChange('subjectAsc'); sortDropdownOpen = false; }}
            >{$t('inbox.viewOptions.sortAscShort')}</button>
            <span class="w-px bg-md-outline-variant/60 shrink-0" aria-hidden="true"></span>
            <button
              id="button-sort-subjectDesc"
              type="button"
              class="flex-1 px-2 py-1.5 text-label-sm font-semibold transition-colors {sortBy === 'subjectDesc' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface text-md-on-surface hover:bg-md-surface-variant'}"
              onclick={() => { onSortChange('subjectDesc'); sortDropdownOpen = false; }}
            >{$t('inbox.viewOptions.sortDescShort')}</button>
          </div>
        </div>
      {/if}
    </div>

    <!-- OTP chip -->
    <button
      id="button-otp-only"
      class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border transition-colors shrink-0 {otpOnly ? 'border-md-primary bg-md-primary/10 text-md-primary' : 'border-md-outline-variant bg-transparent text-md-on-surface/80 hover:bg-md-surface-variant'}"
      aria-label="Show only OTP emails"
      onclick={() => { onOtpOnlyChange(!otpOnly); }}
    >
      {$t('inbox.filterHasOtp')}
    </button>

    <!-- Date chip -->
    <div class="relative shrink-0">
      <button
        id="button-date-filter"
        class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border transition-colors {(dateFrom || dateTo) ? 'border-md-primary bg-md-primary/10 text-md-primary' : 'border-md-outline-variant bg-transparent text-md-on-surface/80 hover:bg-md-surface-variant'}"
        aria-label="Filter by date"
        onclick={() => { dateDropdownOpen = !dateDropdownOpen; sortDropdownOpen = false; showCustomRange = false; savedFiltersDropdownOpen = false; fromDropdownOpen = false; }}
      >
        {formatDateChip(dateFrom, dateTo)}
        <Icon name="chevronDown" class="w-3 h-3" />
      </button>
      {#if dateDropdownOpen}
        <div class="absolute top-full start-0 mt-1 bg-md-surface-container border border-md-outline-variant rounded-2xl shadow-xl z-[200] overflow-hidden min-w-[220px]">
          <!-- Header -->
          <div class="flex items-center justify-between px-4 py-3 border-b border-md-outline-variant/30">
            <span class="text-sm font-semibold text-md-on-surface">Date</span>
            <button id="button-close-date-filter" class="w-5 h-5 flex items-center justify-center text-md-on-surface/60 hover:text-md-on-surface transition-colors" aria-label="Close date filter" onclick={() => { dateDropdownOpen = false; showCustomRange = false; }}>
              <Icon name="x" class="w-3.5 h-3.5" />
            </button>
          </div>
          {#if !showCustomRange}
            <!-- Preset options -->
            <div class="py-2">
              {#each DATE_PRESETS as preset (preset.value)}
                <label class="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-md-surface-variant/50 transition-colors">
                  <span class="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors {datePreset === preset.value ? 'border-md-primary' : 'border-md-outline-variant'}">
                    {#if datePreset === preset.value}
                      <span class="w-2 h-2 rounded-full bg-md-primary"></span>
                    {/if}
                  </span>
                  <input id="radio-date-preset-{preset.value}" type="radio" class="sr-only" name="date-preset" value={preset.value} checked={datePreset === preset.value} onchange={() => { applyDatePreset(preset.value); if (preset.value !== 'custom') dateDropdownOpen = false; }} />
                  <span class="text-sm text-md-on-surface">{preset.label}</span>
                </label>
              {/each}
            </div>
            <!-- Custom range link -->
            <div class="px-4 py-2 border-t border-md-outline-variant/30">
              <button id="button-custom-date-range" class="text-sm text-md-primary hover:underline" aria-label="Select custom date range" onclick={() => showCustomRange = true}>Custom range</button>
            </div>
          {:else}
            <!-- Custom range picker -->
            <div class="p-4 space-y-3">
              <button id="button-back-custom-date" class="text-xs text-md-on-surface/50 hover:text-md-on-surface flex items-center gap-1" onclick={() => showCustomRange = false}>
                ← Back
              </button>
              <div class="flex flex-col gap-1">
                <span class="text-xs text-md-on-surface/50">{$t('inbox.filterDateFrom')}</span>
                <input
                  id="input-date-from"
                  type="date"
                  class="w-full px-2 py-1 rounded border border-md-outline-variant text-xs bg-md-surface-container-low outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary"
                  aria-label="Filter emails from this date"
                  value={dateFrom}
                  onchange={(e) => { onDateFromChange((e.target as HTMLInputElement).value); datePreset = 'custom'; }}
                />
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-xs text-md-on-surface/50">{$t('inbox.filterDateTo')}</span>
                <input
                  id="input-date-to"
                  type="date"
                  class="w-full px-2 py-1 rounded border border-md-outline-variant text-xs bg-md-surface-container-low outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary"
                  aria-label="Filter emails until this date"
                  value={dateTo}
                  onchange={(e) => { onDateToChange((e.target as HTMLInputElement).value); datePreset = 'custom'; }}
                />
              </div>
              <button
                id="button-apply-date-range"
                class="w-full px-3 py-1.5 text-xs rounded-xl bg-md-primary text-md-on-primary hover:bg-md-primary/90 transition-colors"
                onclick={() => dateDropdownOpen = false}
              >
                {$t('inbox.filterApply')}
              </button>
            </div>
          {/if}
        </div>
      {/if}
    </div>

        <!-- Saved Filters chip -->
    {#if savedSearchFilters.length > 0}
      <div class="relative shrink-0">
        <button
          id="button-saved-filters"
          class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border transition-colors border-md-outline-variant bg-transparent text-md-on-surface/80 hover:bg-md-surface-variant"
          aria-label="Saved filters"
          onclick={() => { savedFiltersDropdownOpen = !savedFiltersDropdownOpen; sortDropdownOpen = false; dateDropdownOpen = false; fromDropdownOpen = false; manageFiltersOpen = false; }}
        >
          {$t('inbox.filterSavedFilters')}
          <Icon name="chevronDown" class="w-3 h-3" />
        </button>
        {#if savedFiltersDropdownOpen}
          <div class="absolute top-full start-0 mt-1 bg-md-surface border border-md-outline-variant rounded-xl shadow-lg z-[200] overflow-hidden min-w-[150px]">
            {#each savedSearchFilters as filter (filter.id)}
              <button
                id="button-load-filter-{filter.id}"
                class="w-full px-3 py-2 text-start text-xs hover:bg-md-surface-variant transition-colors text-md-on-surface"
                onclick={() => {
                  onSearchChange(filter.searchQuery);
                  onSortChange(filter.sortBy || 'newest');
                  onOtpOnlyChange(filter.hasOTP);
                  onSenderDomainChange(filter.senderDomain);
                  onSelectedSendersChange(filter.selectedSenders || []);
                  onDateFromChange(filter.dateFrom);
                  onDateToChange(filter.dateTo);
                  datePreset = 'any';
                  onLoadFilter(filter);
                  savedFiltersDropdownOpen = false;
                }}
              >
                {filter.name}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Manage Filters chip -->
    {#if savedSearchFilters.length > 0}
      <button
        id="button-manage-filters"
        class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border transition-colors border-md-outline-variant bg-transparent text-md-on-surface/80 hover:bg-md-surface-variant shrink-0"
        aria-label="Manage filters"
        onclick={() => { manageFiltersOpen = true; savedFiltersDropdownOpen = false; sortDropdownOpen = false; dateDropdownOpen = false; fromDropdownOpen = false; }}
      >
        {$t('inbox.filterManageFilters')}
      </button>
    {/if}

    <!-- Clear all chip (only shown if any filter is active) -->
    {#if sortBy !== 'newest' || otpOnly || dateFrom || dateTo || selectedSenders.length > 0 || searchQuery}
      <button
        id="button-clear-filters"
        class="flex items-center gap-1 px-3 py-1.5 text-xs rounded-full border border-md-error/50 bg-transparent text-md-error hover:bg-md-error/10 transition-colors shrink-0"
        aria-label="Clear all filters"
        onclick={() => { onClearFilters(); onSearchChange(''); onSortChange('newest'); onOtpOnlyChange(false); onSenderDomainChange(''); onDateFromChange(''); onDateToChange(''); onSelectedSendersChange([]); }}
      >
        <Icon name="x" class="w-3 h-3" />
        Clear
      </button>
    {/if}

    <!-- Save as filter button (only shown if current filter is not saved and has active filters) -->
    {#if !currentFilterSaved && (sortBy !== 'newest' || otpOnly || dateFrom || dateTo || selectedSenders.length > 0 || searchQuery !== '')}
      <button
        id="button-save-as-filter"
        class="flex items-center gap-1 px-3 py-1.5 text-xs rounded-full border border-md-primary bg-transparent text-md-primary hover:bg-md-primary/10 transition-colors shrink-0"
        aria-label="Save as filter"
        onclick={() => { showSaveFilter = true; }}
      >
        <Icon name="edit" class="w-3 h-3" />
        Save as filter
      </button>
    {/if}
    </div>
  </div>
{/if}

<!-- Save Filter Dialog -->
{#if showSaveFilter}
  <div class="fixed inset-0 z-[300] flex items-center justify-center p-4">
    <button id="button-close-save-filter-dialog" class="absolute inset-0 bg-black/50 cursor-default" aria-label="Close" onclick={() => showSaveFilter = false}></button>
    <div class="relative bg-md-surface rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden flex flex-col">
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-md-outline-variant">
        <h3 class="text-lg font-semibold text-md-on-surface">Save Filter</h3>
        <button class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-md-surface-variant transition-colors" aria-label="Close" onclick={() => showSaveFilter = false}>
          <Icon name="x" class="w-5 h-5 text-md-on-surface/60" />
        </button>
      </div>
      
      <!-- Content -->
      <div class="p-4 space-y-3">
        <input
          id="input-save-filter-name"
          type="text"
          placeholder="Filter name"
          class="w-full px-3 py-2 rounded-lg border border-md-outline-variant bg-md-surface-container-low text-sm outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary"
          aria-label="Enter filter name"
          bind:value={saveFilterName}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              if (saveFilterName.trim()) {
                onSaveFilter(saveFilterName.trim(), searchQuery, otpOnly, senderDomain, dateFrom, dateTo, selectedSenders, sortBy);
                saveFilterName = '';
                showSaveFilter = false;
              }
            }
          }}
          use:focusOnMount
        />
        <div class="flex gap-2">
          <button
            id="button-save-filter-confirm"
            class="flex-1 px-3 py-2 rounded-lg bg-md-primary text-md-on-primary text-sm font-medium hover:bg-md-primary/90 transition-colors"
            aria-label="Save filter"
            onclick={() => {
              if (saveFilterName.trim()) {
                onSaveFilter(saveFilterName.trim(), searchQuery, otpOnly, senderDomain, dateFrom, dateTo, selectedSenders, sortBy);
                saveFilterName = '';
                showSaveFilter = false;
              }
            }}
          >
            Save
          </button>
          <button
            id="button-cancel-save-filter"
            class="flex-1 px-3 py-2 rounded-lg bg-transparent hover:bg-md-surface-variant text-sm transition-colors"
            aria-label="Cancel saving filter"
            onclick={() => { saveFilterName = ''; showSaveFilter = false; }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Manage Filters Dialog -->
{#if manageFiltersOpen}
  <div class="fixed inset-0 z-[300] flex items-center justify-center p-4">
    <button id="button-close-manage-filters-dialog" class="absolute inset-0 bg-black/50 cursor-default" aria-label="Close" onclick={() => manageFiltersOpen = false}></button>
    <div class="relative bg-md-surface rounded-2xl shadow-2xl max-w-md w-full max-h-[80vh] overflow-hidden flex flex-col">
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-md-outline-variant">
        <h3 class="text-lg font-semibold text-md-on-surface">Manage Filters</h3>
        <button id="button-close-manage-filters-header" class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-md-surface-variant transition-colors" aria-label="Close" onclick={() => manageFiltersOpen = false}>
          <Icon name="x" class="w-5 h-5 text-md-on-surface/60" />
        </button>
      </div>
      
      <!-- Filter List -->
      <div class="flex-1 overflow-y-auto p-4 space-y-2">
        {#each savedSearchFilters as filter (filter.id)}
          <div class="flex items-center gap-2 p-3 rounded-xl bg-md-surface-container-low border border-md-outline-variant/30">
            {#if renamingFilterId === filter.id}
              <!-- Rename mode -->
              <input
                id="input-rename-filter-{filter.id}"
                type="text"
                class="flex-1 px-3 py-2 rounded-lg border border-md-primary bg-md-surface text-sm outline-none focus:ring-1 focus:ring-md-primary"
                bind:value={renameFilterName}
                onkeydown={(e) => {
                  if (e.key === 'Enter') {
                    if (renameFilterName.trim()) {
                      onRenameFilter(filter.id, renameFilterName.trim());
                      renamingFilterId = null;
                      renameFilterName = '';
                    }
                  } else if (e.key === 'Escape') {
                    renamingFilterId = null;
                    renameFilterName = '';
                  }
                }}
                use:focusOnMount
              />
              <button
                id="button-confirm-rename-{filter.id}"
                class="px-3 py-2 rounded-lg bg-md-primary text-md-on-primary text-sm font-medium hover:bg-md-primary/90 transition-colors"
                onclick={() => {
                  if (renameFilterName.trim()) {
                    onRenameFilter(filter.id, renameFilterName.trim());
                    renamingFilterId = null;
                    renameFilterName = '';
                  }
                }}
              >
                Save
              </button>
              <button
                id="button-cancel-rename-{filter.id}"
                class="px-3 py-2 rounded-lg bg-transparent hover:bg-md-surface-variant text-sm transition-colors"
                onclick={() => { renamingFilterId = null; renameFilterName = ''; }}
              >
                Cancel
              </button>
            {:else}
              <!-- View mode -->
              <span class="flex-1 text-sm font-medium text-md-on-surface truncate">{filter.name}</span>
              <button
                id="button-rename-{filter.id}"
                class="p-2 rounded-lg hover:bg-md-surface-variant transition-colors"
                aria-label="Rename filter"
                onclick={() => { renamingFilterId = filter.id; renameFilterName = filter.name; }}
              >
                <Icon name="edit" class="w-4 h-4 text-md-on-surface/60" />
              </button>
              <button
                id="button-delete-filter-{filter.id}"
                class="p-2 rounded-lg hover:bg-md-error/10 transition-colors"
                aria-label="Delete filter"
                onclick={() => onDeleteFilter(filter.id)}
              >
                <Icon name="trash" class="w-4 h-4 text-md-error" />
              </button>
            {/if}
          </div>
        {/each}
        {#if savedSearchFilters.length === 0}
          <p class="text-center text-sm text-md-on-surface/40 py-8">No saved filters</p>
        {/if}
      </div>
    </div>
  </div>
{/if}
