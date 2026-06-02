<script lang="ts">
import { t } from 'svelte-i18n';
import Icon from '@/components/icons/Icon.svelte';

let {
  searchQuery = '',
  sortBy = 'newest',
  otpOnly = false,
  senderDomain = '',
  senderEmail = '',
  selectedSenders = [] as string[],
  dateFrom = '',
  dateTo = '',
  emails = [] as import('@/utils/types.js').Email[],
  savedSearchFilters = [] as import('@/utils/types.js').SavedSearchFilter[],
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
  onLoadFilter = () => {},
  onRenameFilter = () => {},
  onDeleteFilter = () => {},
  onRefreshInbox = () => {},
  onToggleNotifications = () => {},
  notificationsEnabled = true,
  onSearchFocus = () => {},
  onSearchBlur = () => {},
  onFilterClick = () => {},
} = $props();

let saveFilterName = $state('');
let showSaveFilter = $state(false);
let searchFocused = $state(false);
let sortDropdownOpen = $state(false);
let dateDropdownOpen = $state(false);
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

// Get display label for current sort option
let sortLabel = $derived.by(() => {
  switch (sortBy) {
    case 'newest':
      return 'Newest (Date)';
    case 'oldest':
      return 'Oldest (Date)';
    case 'senderNameAsc':
      return 'Sender Name (Ascending)';
    case 'senderNameDesc':
      return 'Sender Name (Descending)';
    case 'senderEmailAsc':
      return 'Sender Email (Ascending)';
    case 'senderEmailDesc':
      return 'Sender Email (Descending)';
    case 'subjectAsc':
      return 'Subject (Ascending)';
    case 'subjectDesc':
      return 'Subject (Descending)';
    default:
      return 'Newest (Date)';
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
        .filter((e) => e.from)
        .map((e) => [e.from!.toLowerCase(), { email: e.from!, name: e.from_name || '' }])
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

const AVATAR_COLORS = [
  'bg-teal-600',
  'bg-emerald-700',
  'bg-pink-600',
  'bg-indigo-600',
  'bg-violet-600',
  'bg-orange-600',
  'bg-cyan-700',
  'bg-rose-600',
];

function avatarColor(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
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

<div class="flex items-center gap-1.5 px-1 pb-1 relative">
  <!-- Search input with search icon left + filter button inside right -->
  <div class="relative flex-1">
    <Icon name="search" class="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-md-on-surface/40 pointer-events-none" />
    <input
      type="text"
      placeholder="Search emails..."
      class="w-full pl-8 pr-8 text-sm rounded-xl border border-md-outline-variant bg-md-surface-container-low focus:bg-md-surface-container outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary transition-colors"
      aria-label="Search emails"
      value={searchQuery}
      oninput={(e) => onSearchChange((e.target as HTMLInputElement).value)}
      onfocus={() => { searchFocused = true; onSearchFocus(); }}
      onblur={(e) => {
        const relatedTarget = e.relatedTarget as HTMLElement;
        const isClickingFilterRow = relatedTarget && filterRowRef?.contains(relatedTarget);
        if (!isClickingFilterRow) {
          setTimeout(() => { searchFocused = false; onSearchBlur(); }, 200);
        }
      }}
    />
    <!-- Filter button inside search input, right side -->
    <div class="absolute right-1.5 top-1/2 -translate-y-1/2">
      <button
        id="button-filter"
        class="w-6 h-6 flex items-center justify-center rounded-lg transition-colors {searchFocused ? 'text-md-primary' : 'text-md-on-surface/40 hover:text-md-on-surface/70'}"
        aria-label="Filters"
        onclick={() => { searchFocused = true; onFilterClick(); }}
      >
        <Icon name="filter" class="w-4 h-4 {sortBy !== 'newest' || otpOnly || dateFrom || dateTo || selectedSenders.length > 0 || searchQuery ? 'text-md-primary' : 'text-md-on-surface/40'}" />
      </button>
    </div>
  </div>

  <!-- Refresh button (hidden when search is focused so the search bar can expand) -->
  {#if !searchFocused}
    <button
      id="button-refresh"
      class="w-8 h-8 flex items-center justify-center rounded-xl bg-md-surface hover:bg-md-surface-variant transition-colors shrink-0 mt-0"
      data-tip="Refresh"
      aria-label="Refresh inbox"
      onclick={() => onRefreshInbox()}
    >
      <Icon name="refresh" class="w-4 h-4 text-md-on-surface/70" />
    </button>
    <!-- Notifications button (hidden when search is focused so the search bar can expand) -->
    <button
      id="button-notifications"
      class="w-8 h-8 flex items-center justify-center rounded-xl transition-colors shrink-0 mt-0 {notificationsEnabled ? 'bg-md-warning/20 hover:bg-md-warning/30' : 'bg-md-surface hover:bg-md-surface-variant'}"
      data-tip="{notificationsEnabled ? 'Disable Notifications' : 'Enable Notifications'}"
      aria-label="Notifications"
      onclick={() => onToggleNotifications()}
    >
      <Icon name="bell" class="w-4 h-4 {notificationsEnabled ? 'text-md-warning' : 'text-md-on-surface/40'}" />
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
          From
        {:else if selectedSenders.length === 1}
          From {selectedSenders[0].split('@')[0]}@…
        {:else if selectedSenders.length > 1}
          From {selectedSenders[0].split('@')[0]}@… +{selectedSenders.length - 1}
        {:else if senderDomain}
          From {senderDomain}
        {:else if senderEmail}
          From {senderEmail.split('@')[0]}@…
        {/if}
        <Icon name="chevronDown" class="w-3 h-3" />
      </button>
      {#if fromDropdownOpen}
        <div class="absolute top-full left-0 mt-1 bg-md-surface-container border border-md-outline-variant rounded-2xl shadow-xl z-[200] overflow-hidden min-w-[260px]">
          <!-- Header -->
          <div class="flex items-center justify-between px-4 py-3 border-b border-md-outline-variant/30">
            <span class="text-sm font-semibold text-md-on-surface">From</span>
            <button id="button-close-from-filter" class="w-5 h-5 flex items-center justify-center text-md-on-surface/60 hover:text-md-on-surface transition-colors" aria-label="Close from filter" onclick={() => fromDropdownOpen = false}>
              <Icon name="x" class="w-3.5 h-3.5" />
            </button>
          </div>
          <!-- Selected chips -->
          {#if selectedSenders.length > 0}
            <div class="flex flex-wrap gap-1.5 px-4 pt-3 pb-1">
              {#each selectedSenders as sender}
                <div class="flex items-center gap-1 px-2 py-1 rounded-full border border-md-outline-variant text-xs bg-md-surface-variant">
                  <span class="w-4 h-4 rounded-full flex items-center justify-center text-[9px] text-white font-bold {avatarColor(sender)}">
                    {getInitial(sender, '')}
                  </span>
                  <span class="max-w-[120px] truncate">{sender}</span>
                  <button id="button-remove-sender-{sender}" onclick={() => toggleSender(sender)} aria-label="Remove sender" class="ml-0.5 text-md-on-surface/50 hover:text-md-on-surface">
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
            {#each senderSuggestions as suggestion}
              {@const isSelected = selectedSenders.some((s) => s.toLowerCase() === suggestion.email.toLowerCase())}
              <button
                id="button-select-sender-{suggestion.email}"
                class="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-md-surface-variant/50 transition-colors text-left"
                onclick={() => toggleSender(suggestion.email)}
              >
                <span class="w-7 h-7 rounded-full flex items-center justify-center text-xs text-white font-bold shrink-0 transition-colors {isSelected ? 'bg-md-primary' : avatarColor(suggestion.email)}">
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
              <div class="px-4 py-3 text-xs text-md-on-surface/40">No Suggestions</div>
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
        Sort: {sortLabel}
        <Icon name="chevronDown" class="w-3 h-3" />
      </button>
      {#if sortDropdownOpen}
        <div class="absolute top-full left-0 mt-1 bg-md-surface border border-md-outline-variant rounded-xl shadow-lg z-[200] overflow-hidden min-w-[200px]">
          <!-- Date -->
          {#each [['newest', 'Newest (Date)'], ['oldest', 'Oldest (Date)']] as [val, label]}
            <button
              id="button-sort-{val}"
              class="w-full px-3 py-2 text-left text-xs hover:bg-md-surface-variant transition-colors {sortBy === val ? 'text-md-primary font-medium' : 'text-md-on-surface'} flex items-center gap-2"
              onclick={() => { onSortChange(val); sortDropdownOpen = false; }}
            >
              <Icon name="clock" class="w-3.5 h-3.5 shrink-0" />
              {label}
            </button>
          {/each}
          <!-- Sender Name -->
          {#each [['senderNameAsc', 'Sender Name (Ascending)'], ['senderNameDesc', 'Sender Name (Descending)']] as [val, label]}
            <button
              id="button-sort-{val}"
              class="w-full px-3 py-2 text-left text-xs hover:bg-md-surface-variant transition-colors {sortBy === val ? 'text-md-primary font-medium' : 'text-md-on-surface'} flex items-center gap-2"
              onclick={() => { onSortChange(val); sortDropdownOpen = false; }}
            >
              <Icon name="user" class="w-3.5 h-3.5 shrink-0" />
              {label}
            </button>
          {/each}
          <!-- Sender Email -->
          {#each [['senderEmailAsc', 'Sender Email (Ascending)'], ['senderEmailDesc', 'Sender Email (Descending)']] as [val, label]}
            <button
              id="button-sort-{val}"
              class="w-full px-3 py-2 text-left text-xs hover:bg-md-surface-variant transition-colors {sortBy === val ? 'text-md-primary font-medium' : 'text-md-on-surface'} flex items-center gap-2"
              onclick={() => { onSortChange(val); sortDropdownOpen = false; }}
            >
              <Icon name="envelope" class="w-3.5 h-3.5 shrink-0" />
              {label}
            </button>
          {/each}
          <!-- Subject -->
          {#each [['subjectAsc', 'Subject (Ascending)'], ['subjectDesc', 'Subject (Descending)']] as [val, label]}
            <button
              id="button-sort-{val}"
              class="w-full px-3 py-2 text-left text-xs hover:bg-md-surface-variant transition-colors {sortBy === val ? 'text-md-primary font-medium' : 'text-md-on-surface'} flex items-center gap-2"
              onclick={() => { onSortChange(val); sortDropdownOpen = false; }}
            >
              <Icon name="mail" class="w-3.5 h-3.5 shrink-0" />
              {label}
            </button>
          {/each}
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
      has OTP
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
        <div class="absolute top-full left-0 mt-1 bg-md-surface-container border border-md-outline-variant rounded-2xl shadow-xl z-[200] overflow-hidden min-w-[220px]">
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
              {#each DATE_PRESETS as preset}
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
                <span class="text-xs text-md-on-surface/50">From</span>
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
                <span class="text-xs text-md-on-surface/50">To</span>
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
                Apply
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
          Saved Filters
          <Icon name="chevronDown" class="w-3 h-3" />
        </button>
        {#if savedFiltersDropdownOpen}
          <div class="absolute top-full left-0 mt-1 bg-md-surface border border-md-outline-variant rounded-xl shadow-lg z-[200] overflow-hidden min-w-[150px]">
            {#each savedSearchFilters as filter}
              <button
                id="button-load-filter-{filter.id}"
                class="w-full px-3 py-2 text-left text-xs hover:bg-md-surface-variant transition-colors text-md-on-surface"
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
        Manage Filters
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
        {#each savedSearchFilters as filter}
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
