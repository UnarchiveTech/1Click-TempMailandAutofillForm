<script lang="ts">
import { onDestroy, onMount, type Snippet, untrack } from 'svelte';
import { get } from 'svelte/store';
import { locale, t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import ModalDialog from '@/ui/components/composites/ModalDialog.svelte';
import SearchBar from '@/ui/components/composites/SearchBar.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import { Btn, IconButton, Radio } from '@/ui/components/primitives';
import Avatar from '@/ui/components/primitives/Avatar.svelte';
import {
  getSearchHistory,
  pushSearchHistory,
  removeSearchHistoryItem,
} from '@/utils/search/search-history.js';
import {
  parseSearchShortcuts,
  reconcileBooleanPill,
  reconcileSavedFilterQuery,
  SHORTCUT_REGEX,
} from '@/utils/search/search-shortcuts.js';
import { parseNumberRecord, updateStoredObject } from '@/utils/storage/rmw.js';
import { peekStoredJsonSync, updateStoredJsonMirror } from '@/utils/storage/stored-prefs-sync.js';
import { avatarColor } from '@/utils/theme/avatar-color.js';
import { avatarInitial } from '@/utils/theme/avatar-initials.js';
import type { Email, SavedSearchFilter } from '@/utils/types.js';
import {
  anchoredFlyout,
  flyoutContains,
  hasInlineFlyoutSpace,
} from '@/utils/ui/anchored-flyout.js';
import { AVATAR_BOX } from '@/utils/ui/avatar-size.js';
import { ELEVATION } from '@/utils/ui/elevation.js';
import { PORTAL_Z_CLASS, portalFlyoutAction } from '@/utils/ui/portal-layers.js';
import { responsiveButtonLayout } from '@/utils/ui/responsive-button-layout.js';
import { controlSurface } from '@/utils/ui/row-surface.js';
import type { FilterQueryProps } from './filter-list-props.js';

let {
  searchQuery = '',
  sortBy = 'newest',
  otpOnly = false,
  unreadOnly = false,
  hasAttachment = false,
  senderDomain = '',
  senderEmail = '',
  recipient = '',
  subject = '',
  notSenderDomain = '',
  notSenderEmail = '',
  notRecipient = '',
  notSubject = '',
  selectedSenders = [] as string[],
  dateFrom = '',
  dateTo = '',
  emails = [] as Email[],
  savedSearchFilters = [] as SavedSearchFilter[],
  onSearchChange = () => {},
  onSortChange = () => {},
  onOtpOnlyChange = () => {},
  onUnreadOnlyChange = () => {},
  onHasAttachmentChange = () => {},
  onSenderDomainChange = () => {},
  onSelectedSendersChange = (_v: string[]) => {},
  onDateFromChange = () => {},
  onDateToChange = () => {},
  onClearFilters = () => {},
  onSaveFilter = (
    _name: string,
    _searchQuery: string,
    _hasOTP: boolean,
    _hasAttachment: boolean,
    _senderDomain: string,
    _dateFrom: string,
    _dateTo: string,
    _selectedSenders: string[],
    _sortBy: string,
    _recipient: string,
    _subject: string,
    _unreadOnly: boolean
  ) => {},
  onLoadFilter = (_filter: SavedSearchFilter) => {},
  onRenameFilter = (_id: string, _name: string) => {},
  onDeleteFilter = (_id: string) => {},
  onRefreshMailbox = async () => {},
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
}: FilterQueryProps & {
  /** Parent sets true while checkEmails / refresh is in flight */
  emailsLoading?: boolean;
  /** Current mailbox address - used for per-address notification snooze */
  currentAddress?: string;
  onSearchFocus?: () => void;
  onSearchBlur?: () => void;
  onFilterClick?: () => void;
  /** Optional layout control rendered just before the refresh control */
  layoutMenu?: Snippet<[]>;
  /** When true, parent shows “filters applied” strip; chips stay available */
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
let snoozeLoadGeneration = 0;
/** / shortcuts panel (button or typing /) */
let shortcutsPanelOpen = $state(false);

let hasActiveFilters = $derived(
  sortBy !== 'newest' ||
    otpOnly ||
    unreadOnly ||
    hasAttachment ||
    !!dateFrom ||
    !!dateTo ||
    selectedSenders.length > 0 ||
    !!senderDomain ||
    !!senderEmail ||
    !!searchQuery?.trim()
);

async function loadSnoozeForAddress() {
  // Generation token (same contract as AddressSelectorBar.loadSnooze): the
  // effect below re-fires on every currentAddress change, so a slow storage
  // read for address A must not resolve after the switch to B and paint A's
  // snooze over B. The warm-mirror path is synchronous and needs no guard.
  const generation = ++snoozeLoadGeneration;
  const addr = currentAddress;
  if (!addr) {
    snoozeUntil = 0;
    return;
  }
  // Anti-flash: sync-first via the shared prefs mirror - the bell badge is
  // correct at first paint when the mirror is warm.
  const warmMap = peekStoredJsonSync<Record<string, number>>('notificationSnoozeByAddress');
  if (warmMap) {
    const until = warmMap[addr] || warmMap[addr.toLowerCase()] || 0;
    snoozeUntil = until > Date.now() ? until : 0;
    return;
  }
  try {
    const res = (await browser.storage.local.get(['notificationSnoozeByAddress'])) as {
      notificationSnoozeByAddress?: Record<string, number>;
    };
    if (generation !== snoozeLoadGeneration) return;
    const map = res.notificationSnoozeByAddress || {};
    const until = map[addr] || map[addr.toLowerCase()] || 0;
    snoozeUntil = until > Date.now() ? until : 0;
  } catch {
    /* ignore */
    if (generation === snoozeLoadGeneration) snoozeUntil = 0;
  }
}

async function applySnooze(durationMs: number) {
  const address = currentAddress;
  if (!address) return;
  const until = Date.now() + durationMs;
  try {
    // Serialized RMW: the snooze map is written from BOTH snooze surfaces (this
    // menu and the address selector bar's bell), so a whole-key write of a map
    // read before the other surface's write landed erased that address's snooze.
    const next = await updateStoredObject(
      'notificationSnoozeByAddress',
      (current) => ({ ...current, [address]: until }),
      parseNumberRecord
    );
    updateStoredJsonMirror('notificationSnoozeByAddress', next);
    snoozeUntil = until;
  } catch {
    /* ignore */
  }
  notifMenuOpen = false;
}

async function clearSnooze() {
  const address = currentAddress;
  if (!address) return;
  try {
    // Serialized RMW - same pair as applySnooze, and both casings of the
    // address are removed from the map storage last held.
    const next = await updateStoredObject(
      'notificationSnoozeByAddress',
      (current) => {
        const map = { ...current };
        delete map[address];
        delete map[address.toLowerCase()];
        return map;
      },
      parseNumberRecord
    );
    updateStoredJsonMirror('notificationSnoozeByAddress', next);
    snoozeUntil = 0;
  } catch {
    /* ignore */
  }
  notifMenuOpen = false;
}

/**
 * Compact remaining snooze label for the bell badge (e.g. 5m, 2h, 1d). Units
 * come from the shared time locale keys - never spelled at the call site.
 */
function formatSnoozeRemaining(until: number, now = Date.now()): string {
  const ms = until - now;
  if (ms <= 0) return '';
  const tr = get(t);
  const mins = Math.max(1, Math.ceil(ms / 60_000));
  if (mins < 60) return tr('time.durationM', { values: { m: mins } });
  const hours = Math.max(1, Math.ceil(ms / 3_600_000));
  if (hours < 24) return tr('time.durationH', { values: { h: hours } });
  const days = Math.max(1, Math.ceil(ms / 86_400_000));
  return tr('time.durationD', { values: { d: days } });
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
let builtInPresetsOpen = $state(false);
let manageFiltersOpen = $state(false);
let renamingFilterId = $state<string | null>(null);
let renameFilterName = $state('');
let renameInputRef = $state<HTMLInputElement | null>(null);
let fromSearch = $state('');
let searchRowRef = $state<HTMLElement | null>(null);
let filterRowRef = $state<HTMLElement | null>(null);
let showCustomRange = $state(false);
let datePreset = $state<string>('any');

// Visual Search Pills & Autocomplete state
let currentInputText = $state('');
let showAutocomplete = $state(false);
let searchBlurTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSearchBlur() {
  if (searchBlurTimer) clearTimeout(searchBlurTimer);
  searchBlurTimer = setTimeout(() => {
    searchBlurTimer = null;
    // Moving from search to an inline filter action must not unmount that action.
    if (
      flyoutContains(searchRowRef, document.activeElement) ||
      flyoutContains(filterRowRef, document.activeElement)
    )
      return;
    searchFocused = false;
    showAutocomplete = false;
    shortcutsPanelOpen = false;
    void commitSearchHistory();
    onSearchBlur();
  }, 200);
}

// A pending 200ms blur timer must not fire after unmount: it writes
// searchFocused/showAutocomplete and calls onSearchBlur/commitSearchHistory
// on a dead component (and onSearchBlur can re-trigger parent work).
onDestroy(() => {
  if (searchBlurTimer) {
    clearTimeout(searchBlurTimer);
    searchBlurTimer = null;
  }
  // Invalidate any in-flight snooze read with the same stroke.
  snoozeLoadGeneration++;
});

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

/** Opposite token for value-aware shortcuts: flips the ! prefix, keeping the
 * value (e.g. from:x ↔ !from:x). Null when no value is involved. */
function shortcutComplement(pillText: string): string | null {
  if (pillText.startsWith('!')) return pillText.slice(1);
  if (/^(from:|to:|subject:|is:otp|has:attachment)/i.test(pillText)) return `!${pillText}`;
  return null;
}

function addPill(pillText: string) {
  if (parsedPills.includes(pillText)) return;
  // A shortcut and its negated form are mutually exclusive - adding one drops
  // the other so the pill row mirrors the effective filter state
  // (last-token-wins semantics stay unambiguous in the UI).
  const complement = shortcutComplement(pillText);
  const nextPills = complement
    ? [...parsedPills.filter((p) => p !== complement), pillText]
    : [...parsedPills, pillText];
  updateFullQuery(nextPills, '');
  currentInputText = '';
  showAutocomplete = false;
}

function removePill(pillText: string) {
  const nextPills = parsedPills.filter((p) => p !== pillText);
  // Removing a positive boolean pill must flip its chip off so the filter
  // doesn't stay silently active with no visible pill (chips never contradict
  // pills). Negated forms (e.g. !is:otp) leave the chip untouched - they mean
  // "explicitly off", which matches the chip being off.
  if (pillText === 'is:otp') onOtpOnlyChange(false);
  else if (pillText === 'is:unread') onUnreadOnlyChange(false);
  else if (pillText === 'has:attachment') onHasAttachmentChange(false);
  updateFullQuery(nextPills, currentInputText);
}

/** Toggle a boolean filter (OTP / attachment) from its chip, keeping the pill
 * row in sync: ON guarantees the positive pill, OFF removes both forms. */
function toggleBooleanPill(pill: 'is:otp' | 'is:unread' | 'has:attachment', on: boolean) {
  const nextPills = reconcileBooleanPill(parsedPills, pill, on);
  // Only push a query update when the pill row actually changed; the chip state
  // itself is still reported to the parent in both cases.
  const changed = nextPills.join(' ') !== parsedPills.join(' ');
  if (changed) {
    updateFullQuery(nextPills, currentInputText);
  }
  if (pill === 'is:otp') onOtpOnlyChange(on);
  else if (pill === 'is:unread') onUnreadOnlyChange(on);
  else onHasAttachmentChange(on);
}

function handleInputKeydown(e: KeyboardEvent) {
  if (e.key === 'Backspace' && !currentInputText && parsedPills.length > 0) {
    e.preventDefault();
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
    prefix: 'is:unread',
    label: $t('inbox.searchShortcut.isUnreadLabel'),
    description: $t('inbox.searchShortcut.isUnreadDesc'),
  },
  {
    prefix: 'is:otp',
    label: $t('inbox.searchShortcut.isOtpLabel'),
    description: $t('inbox.searchShortcut.isOtpDesc'),
  },
  {
    prefix: 'has:attachment',
    label: $t('inbox.searchShortcut.hasAttachmentLabel'),
    description: $t('inbox.searchShortcut.hasAttachmentDesc'),
  },
  {
    prefix: 'from:',
    label: $t('inbox.searchShortcut.fromLabel'),
    description: $t('inbox.searchShortcut.fromDesc'),
  },
  {
    prefix: '!from:',
    group: 'exclude',
    label: $t('inbox.searchShortcut.notFromLabel'),
    description: $t('inbox.searchShortcut.notFromDesc'),
  },
  {
    prefix: 'to:',
    label: $t('inbox.searchShortcut.toLabel'),
    description: $t('inbox.searchShortcut.toDesc'),
  },
  {
    prefix: '!to:',
    group: 'exclude',
    label: $t('inbox.searchShortcut.notToLabel'),
    description: $t('inbox.searchShortcut.notToDesc'),
  },
  {
    prefix: 'subject:',
    label: $t('inbox.searchShortcut.subjectLabel'),
    description: $t('inbox.searchShortcut.subjectDesc'),
  },
  {
    prefix: '!subject:',
    group: 'exclude',
    label: $t('inbox.searchShortcut.notSubjectLabel'),
    description: $t('inbox.searchShortcut.notSubjectDesc'),
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
      !!f.hasAttachment === hasAttachment &&
      f.senderDomain === senderDomain &&
      (f.recipient || '') === (recipient || '') &&
      (f.subject || '') === (subject || '') &&
      (f.notSenderDomain || '') === (notSenderDomain || '') &&
      (f.notSenderEmail || '') === (notSenderEmail || '') &&
      (f.notRecipient || '') === (notRecipient || '') &&
      (f.notSubject || '') === (notSubject || '') &&
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

let datePresets = $derived([
  { value: 'any', label: $t('inbox.datePresetAny') },
  { value: 'week', label: $t('inbox.datePresetWeek') },
  { value: 'month', label: $t('inbox.datePresetMonth') },
  { value: '6months', label: $t('inbox.datePreset6Months') },
  { value: 'year', label: $t('inbox.datePresetYear') },
]);

function applyBuiltInPreset(preset: 'unread' | 'otp' | 'attachment' | 'last24' | 'sender') {
  if (preset === 'sender') {
    fromDropdownOpen = true;
    builtInPresetsOpen = false;
    return;
  }
  onSearchChange('');
  onSortChange('newest');
  onSenderDomainChange('');
  onSelectedSendersChange([]);
  onDateFromChange('');
  onDateToChange('');
  onUnreadOnlyChange(preset === 'unread');
  onOtpOnlyChange(preset === 'otp');
  onHasAttachmentChange(preset === 'attachment');
  if (preset === 'last24') {
    const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    onDateFromChange(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }
  builtInPresetsOpen = false;
}

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

let dateChipLabel = $derived.by(() => {
  const fmtShort = (s: string) => {
    if (!s) return '';
    const [y, m, d] = s.split('-');
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return new Intl.DateTimeFormat($locale || 'en', {
      month: 'numeric',
      day: 'numeric',
      year: '2-digit',
    }).format(date);
  };
  if (dateFrom && dateTo) return `${fmtShort(dateFrom)}-${fmtShort(dateTo)}`;
  if (dateTo) return $t('inbox.dateChipUntil', { values: { date: fmtShort(dateTo) } });
  if (dateFrom) return $t('inbox.dateChipFrom', { values: { date: fmtShort(dateFrom) } });
  return $t('filters.date');
});
</script>

<div class="flex items-center gap-1 px-0 pb-1 relative" bind:this={searchRowRef}>
  <!-- Canonical SearchBar (shared shell, voice, history, / shortcuts) + mailbox pills -->
  <div class="relative flex-1 min-w-0">
    <SearchBar
      scope="inbox"
      inputId="inbox-search-input"
      bind:value={currentInputText}
      placeholder={parsedPills.length === 0 ? $t('inbox.searchEmailsPlaceholder') : ''}
      animatedPlaceholders={parsedPills.length === 0
        ? [
            $t('searchPlaceholder.emails'),
            $t('searchPlaceholder.senders'),
            $t('searchPlaceholder.subjects'),
            $t('searchPlaceholder.messageText'),
            $t('searchPlaceholder.labels'),
          ]
        : []}
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
      onkeydown={handleInputKeydown}
      onFocus={() => {
        if (searchBlurTimer) {
          clearTimeout(searchBlurTimer);
          searchBlurTimer = null;
        }
        searchFocused = true;
        showAutocomplete = true;
        onSearchFocus();
        void refreshRecentSearches();
      }}
      onBlur={scheduleSearchBlur}
      onSubmit={(q) => {
        void pushSearchHistory('inbox', q).then(refreshRecentSearches);
      }}
    >
      {#snippet prefixContent()}
        <span data-tour="search-pills" class="inline-flex flex-wrap items-center gap-1 min-w-0 {parsedPills.length > 0 ? 'me-1' : ''}">
        {#each parsedPills as pill (pill)}
          <span
            class="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-md shrink-0 {pill.startsWith('!') ? 'bg-md-error/15 text-md-error border border-md-error/30' : 'bg-md-primary/15 text-md-primary border border-md-primary/20'}"
            title={pill.startsWith('!') ? $t('inbox.negatedPillTooltip') : undefined}
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
              <Icon name="close" class="w-3 h-3" />
            </button>
          </span>
        {/each}
        </span>
      {/snippet}
      {#snippet filterControl()}
        {#if !searchFocused}
          <button
            id="button-filter"
            type="button"
            class="w-8 h-8 flex items-center justify-center rounded-full bg-md-surface text-md-on-surface/50 active:brightness-95 transition-colors {controlSurface(
              filterMenuOpen || hasActiveFilters
            )}"
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
          use:portalFlyoutAction
          class="fixed inset-0 {PORTAL_Z_CLASS.navMenu} cursor-default bg-transparent"
          aria-label={$t('common.close')}
          onclick={() => {
            filterMenuOpen = false;
            filterFlyout = null;
          }}
        ></button>
        <!-- Compact root menu + side flyouts (MenuList MD3 tokens) -->
        <div
          use:anchoredFlyout={{ anchor: () => document.getElementById('button-filter'), placement: 'bottom-end', onClose: () => { filterMenuOpen = false; filterFlyout = null; } }}
          class="menu-list absolute top-full end-0 mt-1 {PORTAL_Z_CLASS.accountMenu} w-[200px] rounded-xl border border-md-outline-variant/50 bg-md-surface-container-low {ELEVATION.level2} motion-overlay-in overflow-visible"
          role="menu"
          tabindex="-1"
          aria-label={$t('inbox.filtersAria')}
        >
          <button
            type="button"
            data-menu-item
            class="menu-list-item w-full flex items-center gap-2 px-2.5 py-2 text-sm text-start rounded-t-xl {filterFlyout === 'from' ? 'is-active' : ''}"
            role="menuitem"
            onmouseenter={(e) => { if (hasInlineFlyoutSpace(e.currentTarget, 220)) filterFlyout = 'from'; }}
            onclick={() => (filterFlyout = filterFlyout === 'from' ? null : 'from')}
          >
            <Icon name="person" class="menu-list-icon w-4 h-4 shrink-0" />
            <span class="flex-1 truncate font-medium">{$t('inbox.filterFrom')}</span>
            <Icon name="chevronRight" class="w-3.5 h-3.5 opacity-50 rtl-flip shrink-0" />
          </button>
          <button
            type="button"
            data-menu-item
            class="menu-list-item w-full flex items-center gap-2 px-2.5 py-2 text-sm text-start {filterFlyout === 'sort' ? 'is-active' : ''}"
            role="menuitem"
            onmouseenter={(e) => { if (hasInlineFlyoutSpace(e.currentTarget, 200)) filterFlyout = 'sort'; }}
            onclick={() => (filterFlyout = filterFlyout === 'sort' ? null : 'sort')}
          >
            <Icon name="schedule" class="menu-list-icon w-4 h-4 shrink-0" />
            <span class="flex-1 truncate font-medium">{$t('inbox.filterSort')}</span>
            <Icon name="chevronRight" class="w-3.5 h-3.5 opacity-50 rtl-flip shrink-0" />
          </button>
          <button
            type="button"
            data-menu-item
            class="menu-list-item w-full flex items-center gap-2 px-2.5 py-2 text-sm text-start {unreadOnly ? 'is-active' : ''}"
            role="menuitem"
            onclick={() => toggleBooleanPill('is:unread', !unreadOnly)}
          >
            <Icon name="mail" class="menu-list-icon w-4 h-4 shrink-0" />
            <span class="flex-1 truncate font-medium">{$t('inbox.filterUnread')}</span>
            <span class="menu-list-trailing text-xs font-bold">{unreadOnly ? $t('common.on') : $t('common.off')}</span>
          </button>
          <button
            type="button"
            data-menu-item
            class="menu-list-item w-full flex items-center gap-2 px-2.5 py-2 text-sm text-start {otpOnly ? 'is-active' : ''}"
            role="menuitem"
            onclick={() => toggleBooleanPill('is:otp', !otpOnly)}
          >
            <Icon name="shield" class="menu-list-icon w-4 h-4 shrink-0" />
            <span class="flex-1 truncate font-medium">{$t('inbox.filterHasOtp')}</span>
            <span class="menu-list-trailing text-xs font-bold">{otpOnly ? $t('common.on') : $t('common.off')}</span>
          </button>
          <button
            type="button"
            data-menu-item
            class="menu-list-item w-full flex items-center gap-2 px-2.5 py-2 text-sm text-start {hasAttachment ? 'is-active' : ''}"
            role="menuitem"
            onclick={() => toggleBooleanPill('has:attachment', !hasAttachment)}
          >
            <Icon name="download" class="menu-list-icon w-4 h-4 shrink-0" />
            <span class="flex-1 truncate font-medium">{$t('inbox.filterHasAttachment')}</span>
            <span class="menu-list-trailing text-xs font-bold">{hasAttachment ? $t('common.on') : $t('common.off')}</span>
          </button>
          <button
            type="button"
            data-menu-item
            class="menu-list-item w-full flex items-center gap-2 px-2.5 py-2 text-sm text-start {filterFlyout === 'date' ? 'is-active' : ''}"
            role="menuitem"
            onmouseenter={(e) => { if (hasInlineFlyoutSpace(e.currentTarget, 220)) filterFlyout = 'date'; }}
            onclick={() => (filterFlyout = filterFlyout === 'date' ? null : 'date')}
          >
            <Icon name="schedule" class="menu-list-icon w-4 h-4 shrink-0" />
            <span class="flex-1 truncate font-medium">{$t('inbox.filterDateRange')}</span>
            <Icon name="chevronRight" class="w-3.5 h-3.5 opacity-50 rtl-flip shrink-0" />
          </button>
          {#if savedSearchFilters.length > 0}
            <button
              type="button"
              data-menu-item
              class="menu-list-item w-full flex items-center gap-2 px-2.5 py-2 text-sm text-start rounded-b-xl {filterFlyout === 'saved' ? 'is-active' : ''}"
              role="menuitem"
              onmouseenter={(e) => { if (hasInlineFlyoutSpace(e.currentTarget, 200)) filterFlyout = 'saved'; }}
              onclick={() => (filterFlyout = filterFlyout === 'saved' ? null : 'saved')}
            >
              <Icon name="filter" class="menu-list-icon w-4 h-4 shrink-0" />
              <span class="flex-1 truncate font-medium">{$t('inbox.filterSavedFilters')}</span>
              <Icon name="chevronRight" class="w-3.5 h-3.5 opacity-50 rtl-flip shrink-0" />
            </button>
          {/if}

          <!-- Side flyouts -->
          {#if filterFlyout === 'from'}
            <div use:anchoredFlyout={{ placement: 'inline-start', onClose: () => { filterFlyout = null; } }} class="absolute top-0 end-full me-1 w-[220px] max-h-56 overflow-y-auto rounded-xl border border-md-outline-variant/50 bg-md-surface-container-low {ELEVATION.level2} {PORTAL_Z_CLASS.accountMenu} p-1" role="menu">
              <button type="button" class="w-full text-start p-2 text-sm text-md-primary" onclick={() => { filterFlyout = null; }}><Icon name="back" class="inline w-4 h-4 rtl-flip" /> {$t('common.back')}</button>
              {#each senderSuggestions as suggestion (suggestion.email)}
                {@const isSelected = selectedSenders.some((s) => s.toLowerCase() === suggestion.email.toLowerCase())}
                <button
                  type="button"
                  class="w-full flex items-center gap-2 px-2 py-2 text-start text-sm rounded-lg hover:bg-md-surface-variant active:brightness-95 {isSelected ? 'text-md-primary font-semibold' : ''}"
                  onclick={() => toggleSender(suggestion.email)}
                >
                  <span class="truncate flex-1">{suggestion.email}</span>
                  {#if isSelected}<Icon name="check" class="w-3.5 h-3.5 shrink-0" />{/if}
                </button>
              {:else}
                <p class="px-3 min-h-12 text-sm text-md-on-surface/40">{$t('inbox.filterNoSuggestions')}</p>
              {/each}
            </div>
          {:else if filterFlyout === 'sort'}
            <div use:anchoredFlyout={{ placement: 'inline-start', onClose: () => { filterFlyout = null; } }} class="absolute top-0 end-full me-1 w-[200px] max-h-64 overflow-y-auto rounded-xl border border-md-outline-variant bg-md-surface-container-low {ELEVATION.level2} {PORTAL_Z_CLASS.accountMenu} py-1" role="menu">
              <button type="button" class="w-full text-start p-2 text-sm text-md-primary" onclick={() => { filterFlyout = null; }}><Icon name="back" class="inline w-4 h-4 rtl-flip" /> {$t('common.back')}</button>
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
                  class="w-full flex items-center gap-2 px-2.5 py-2 text-start text-sm hover:bg-md-surface-variant active:brightness-95 {sortBy === val ? 'text-md-primary font-medium' : 'text-md-on-surface'}"
                  onclick={() => { onSortChange(val); filterMenuOpen = false; filterFlyout = null; }}
                >
                  <span class="flex-1">{$t(labelKey)}</span>
                  {#if sortBy === val}<Icon name="check" class="w-3.5 h-3.5 shrink-0" />{/if}
                </button>
              {/each}
            </div>
          {:else if filterFlyout === 'date'}
            <div use:anchoredFlyout={{ placement: 'inline-start', onClose: () => { filterFlyout = null; } }} class="absolute top-0 end-full me-1 w-[220px] rounded-xl border border-md-outline-variant bg-md-surface-container-low {ELEVATION.level2} {PORTAL_Z_CLASS.accountMenu} p-3 space-y-2" role="menu">
              <button type="button" class="w-full text-start p-2 text-sm text-md-primary" onclick={() => { filterFlyout = null; }}><Icon name="back" class="inline w-4 h-4 rtl-flip" /> {$t('common.back')}</button>
              <label class="block text-sm text-md-on-surface-variant">{$t('inbox.filterDateFrom')}
                <input type="date" class="mt-0.5 w-full px-2 py-1.5 text-sm rounded-lg border border-md-outline-variant bg-md-surface" value={dateFrom} onchange={(e) => onDateFromChange((e.target as HTMLInputElement).value)} />
              </label>
              <label class="block text-sm text-md-on-surface-variant">{$t('inbox.filterDateTo')}
                <input type="date" class="mt-0.5 w-full px-2 py-1.5 text-sm rounded-lg border border-md-outline-variant bg-md-surface" value={dateTo} onchange={(e) => onDateToChange((e.target as HTMLInputElement).value)} />
              </label>
            </div>
          {:else if filterFlyout === 'saved'}
            <div use:anchoredFlyout={{ placement: 'inline-start', onClose: () => { filterFlyout = null; } }} class="absolute top-0 end-full me-1 w-[200px] max-h-48 overflow-y-auto rounded-xl border border-md-outline-variant bg-md-surface-container-low {ELEVATION.level2} {PORTAL_Z_CLASS.accountMenu} py-1" role="menu">
              <button type="button" class="w-full text-start p-2 text-sm text-md-primary" onclick={() => { filterFlyout = null; }}><Icon name="back" class="inline w-4 h-4 rtl-flip" /> {$t('common.back')}</button>
              {#each savedSearchFilters as filter (filter.id)}
                <button
                  type="button"
                  class="w-full px-2.5 py-2 text-start text-sm hover:bg-md-surface-variant active:brightness-95"
                  onclick={() => {
                    // Reconcile the stored query's pills with its boolean flags
                    // so chips and pills never contradict after a filter load.
                    onSearchChange(
                      reconcileSavedFilterQuery(filter.searchQuery, filter.hasOTP, !!filter.hasAttachment, filter.unreadOnly)
                    );
                    onSortChange(filter.sortBy || 'newest');
                    onOtpOnlyChange(filter.hasOTP);
                    onUnreadOnlyChange(
                      filter.unreadOnly ?? parseSearchShortcuts(filter.searchQuery).unreadOnly
                    );
                    onHasAttachmentChange(!!filter.hasAttachment);
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
      class="relative w-8 h-8 flex items-center justify-center rounded-full transition-colors mt-0 bg-md-surface hover:bg-md-surface-variant active:bg-md-surface-variant/80 shrink-0"
      aria-label={$t('nav.fabRefresh')}
      title={$t('nav.fabRefresh')}
      disabled={refreshLoading}
      onclick={async () => {
        refreshLoading = true;
        try {
          await onRefreshMailbox();
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
  <div
    bind:this={filterRowRef}
    class="flex flex-col gap-2 px-1 pb-2 pt-0.5 relative"
    onfocusin={() => {
      if (searchBlurTimer) clearTimeout(searchBlurTimer);
      searchBlurTimer = null;
    }}
    onfocusout={scheduleSearchBlur}
  >
    <!-- First row: filter chips -->
    <div class="flex items-center gap-1 flex-wrap">

    <!-- From chip -->
    <div class="relative shrink-0">
      <button
        id="button-from-filter"
        class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border border-md-outline-variant bg-transparent text-md-on-surface/80 active:brightness-95 transition-colors {controlSurface(
          selectedSenders.length > 0 || senderDomain || senderEmail
        )}"
        aria-label={$t('inbox.filterBySenderAria')}
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
        <div use:anchoredFlyout={{ onClose: () => { fromDropdownOpen = false; } }} class="absolute top-full start-0 mt-1 bg-md-surface-container border border-md-outline-variant rounded-2xl {ELEVATION.level2} {PORTAL_Z_CLASS.accountMenu} overflow-hidden min-w-[260px]">
          <!-- Header -->
          <div class="flex items-center justify-between px-4 py-3 border-b border-md-outline-variant/30">
            <span class="text-sm font-semibold text-md-on-surface">{$t('inbox.filterFrom')}</span>
            <IconButton
              id="button-close-from-filter"
              icon="close"
              size="sm"
              iconClass="w-3.5 h-3.5"
              ariaLabel={$t('inbox.closeFromFilterAria')}
              class="text-md-on-surface/60 hover:text-md-on-surface"
              onclick={() => (fromDropdownOpen = false)}
            />
          </div>
          <!-- Selected chips -->
          {#if selectedSenders.length > 0}
            <div class="flex flex-wrap gap-1.5 px-4 pt-3 pb-1">
              {#each selectedSenders as sender (sender)}
                <div class="flex items-center gap-1 px-2 py-1 rounded-full border border-md-outline-variant text-xs bg-md-surface-variant">
                  <Avatar size="xs" letter={avatarInitial(sender, '')} email={sender} class="shrink-0" />
                  <span class="max-w-[120px] truncate">{sender}</span>
                  <button id="button-remove-sender-{sender}" onclick={() => toggleSender(sender)} aria-label={$t('inbox.removeSenderAria')} class="ms-0.5 text-md-on-surface/50 hover:text-md-on-surface">
                    <Icon name="close" class="w-2.5 h-2.5" />
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
              placeholder={$t('inbox.searchSenderPlaceholder')}
              class="w-full bg-transparent border-b border-md-outline-variant/50 pb-1 text-sm text-md-on-surface placeholder:text-md-on-surface/40 outline-none focus:border-md-primary transition-colors"
              bind:value={fromSearch}
              aria-label={$t('inbox.searchSenderAria')}
            />
          </div>
          <!-- Suggestions -->
          {#if senderSuggestions.length > 0}
            <div class="px-4 pb-1">
              <span class="text-xs font-medium text-md-on-surface/50">{$t('filters.suggestions')}</span>
            </div>
          {/if}
          <div class="max-h-48 overflow-y-auto pb-2">
            {#each senderSuggestions as suggestion (suggestion.email)}
              {@const isSelected = selectedSenders.some((s) => s.toLowerCase() === suggestion.email.toLowerCase())}
              <button
                id="button-select-sender-{suggestion.email}"
                class="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-md-surface-variant/50 active:bg-md-surface-variant/70 transition-colors text-start"
                onclick={() => toggleSender(suggestion.email)}
              >
                {#if isSelected}
                  <!-- The tick IS this row's avatar - same tier as the letter beside it,
                       so the badge is not a differently-sized disc of its own. -->
                  <Avatar size="lg" letter="✓" email={suggestion.email} class="shrink-0 ring-2 ring-md-primary ring-offset-1 ring-offset-md-surface" />
                {:else}
                  <Avatar size="lg" letter={avatarInitial(suggestion.name || suggestion.email, '')} email={suggestion.email} class="shrink-0" />
                {/if}
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
        class="flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-full border border-md-outline-variant bg-transparent text-md-on-surface/80 active:brightness-95 transition-colors {controlSurface(
          sortBy !== 'newest'
        )}"
        aria-label={$t('inbox.sortByAria')}
        onclick={() => { sortDropdownOpen = !sortDropdownOpen; dateDropdownOpen = false; savedFiltersDropdownOpen = false; fromDropdownOpen = false; }}
      >
        {$t('inbox.filterSort')}: {sortLabel}
        <Icon name="chevronDown" class="w-3 h-3" />
      </button>
      {#if sortDropdownOpen}
        <div use:anchoredFlyout={{ onClose: () => { sortDropdownOpen = false; } }} class="absolute top-full start-0 mt-1 bg-md-surface border border-md-outline-variant rounded-xl {ELEVATION.level2} {PORTAL_Z_CLASS.accountMenu} overflow-hidden min-w-[240px] p-1.5 space-y-1">
          <!-- Date -->
          <div class="flex items-center gap-2 px-1.5 py-1 rounded-lg hover:bg-md-surface-variant/40 active:bg-md-surface-variant/60">
            <Icon name="schedule" class="w-3.5 h-3.5 shrink-0 text-md-on-surface/50" />
            <span class="flex-1 min-w-0 text-xs font-semibold text-md-on-surface truncate">{$t('inbox.viewOptions.sortByDate')}</span>
            <div class="flex items-stretch rounded-md border border-md-outline-variant/50 overflow-hidden shrink-0" role="group" aria-label={$t('inbox.viewOptions.sortByDate')}>
              <button
                id="button-sort-newest"
                type="button"
                class="px-2 py-1 text-xs font-bold transition-colors {sortBy === 'newest' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface text-md-on-surface hover:bg-md-surface-variant active:brightness-95'}"
                onclick={() => { onSortChange('newest'); sortDropdownOpen = false; }}
              >{$t('inbox.viewOptions.sortNewestShort')}</button>
              <span class="w-px bg-md-outline-variant/60 shrink-0" aria-hidden="true"></span>
              <button
                id="button-sort-oldest"
                type="button"
                class="px-2 py-1 text-xs font-bold transition-colors {sortBy === 'oldest' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface text-md-on-surface hover:bg-md-surface-variant active:brightness-95'}"
                onclick={() => { onSortChange('oldest'); sortDropdownOpen = false; }}
              >{$t('inbox.viewOptions.sortOldestShort')}</button>
            </div>
          </div>

          <!-- Sender name -->
          <div class="flex items-center gap-2 px-1.5 py-1 rounded-lg hover:bg-md-surface-variant/40 active:bg-md-surface-variant/60">
            <Icon name="person" class="w-3.5 h-3.5 shrink-0 text-md-on-surface/50" />
            <span class="flex-1 min-w-0 text-xs font-semibold text-md-on-surface truncate">{$t('inbox.viewOptions.sortBySenderName')}</span>
            <div class="flex items-stretch rounded-md border border-md-outline-variant/50 overflow-hidden shrink-0" role="group" aria-label={$t('inbox.viewOptions.sortBySenderName')}>
              <button
                id="button-sort-senderNameAsc"
                type="button"
                class="px-2 py-1 text-xs font-bold transition-colors {sortBy === 'senderNameAsc' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface text-md-on-surface hover:bg-md-surface-variant active:brightness-95'}"
                onclick={() => { onSortChange('senderNameAsc'); sortDropdownOpen = false; }}
              >{$t('inbox.viewOptions.sortAscShort')}</button>
              <span class="w-px bg-md-outline-variant/60 shrink-0" aria-hidden="true"></span>
              <button
                id="button-sort-senderNameDesc"
                type="button"
                class="px-2 py-1 text-xs font-bold transition-colors {sortBy === 'senderNameDesc' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface text-md-on-surface hover:bg-md-surface-variant active:brightness-95'}"
                onclick={() => { onSortChange('senderNameDesc'); sortDropdownOpen = false; }}
              >{$t('inbox.viewOptions.sortDescShort')}</button>
            </div>
          </div>

          <!-- Sender email -->
          <div class="flex items-center gap-2 px-1.5 py-1 rounded-lg hover:bg-md-surface-variant/40 active:bg-md-surface-variant/60">
            <Icon name="mail" class="w-3.5 h-3.5 shrink-0 text-md-on-surface/50" />
            <span class="flex-1 min-w-0 text-xs font-semibold text-md-on-surface truncate">{$t('inbox.viewOptions.sortBySenderEmail')}</span>
            <div class="flex items-stretch rounded-md border border-md-outline-variant/50 overflow-hidden shrink-0" role="group" aria-label={$t('inbox.viewOptions.sortBySenderEmail')}>
              <button
                id="button-sort-senderEmailAsc"
                type="button"
                class="px-2 py-1 text-xs font-bold transition-colors {sortBy === 'senderEmailAsc' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface text-md-on-surface hover:bg-md-surface-variant active:brightness-95'}"
                onclick={() => { onSortChange('senderEmailAsc'); sortDropdownOpen = false; }}
              >{$t('inbox.viewOptions.sortAscShort')}</button>
              <span class="w-px bg-md-outline-variant/60 shrink-0" aria-hidden="true"></span>
              <button
                id="button-sort-senderEmailDesc"
                type="button"
                class="px-2 py-1 text-xs font-bold transition-colors {sortBy === 'senderEmailDesc' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface text-md-on-surface hover:bg-md-surface-variant active:brightness-95'}"
                onclick={() => { onSortChange('senderEmailDesc'); sortDropdownOpen = false; }}
              >{$t('inbox.viewOptions.sortDescShort')}</button>
            </div>
          </div>

          <!-- Subject -->
          <div class="flex items-center gap-2 px-1.5 py-1 rounded-lg hover:bg-md-surface-variant/40 active:bg-md-surface-variant/60">
            <Icon name="mail" class="w-3.5 h-3.5 shrink-0 text-md-on-surface/50" />
            <span class="flex-1 min-w-0 text-xs font-semibold text-md-on-surface truncate">{$t('inbox.viewOptions.sortBySubject')}</span>
            <div class="flex items-stretch rounded-md border border-md-outline-variant/50 overflow-hidden shrink-0" role="group" aria-label={$t('inbox.viewOptions.sortBySubject')}>
              <button
                id="button-sort-subjectAsc"
                type="button"
                class="px-2 py-1 text-xs font-bold transition-colors {sortBy === 'subjectAsc' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface text-md-on-surface hover:bg-md-surface-variant active:brightness-95'}"
                onclick={() => { onSortChange('subjectAsc'); sortDropdownOpen = false; }}
              >{$t('inbox.viewOptions.sortAscShort')}</button>
              <span class="w-px bg-md-outline-variant/60 shrink-0" aria-hidden="true"></span>
              <button
                id="button-sort-subjectDesc"
                type="button"
                class="px-2 py-1 text-xs font-bold transition-colors {sortBy === 'subjectDesc' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface text-md-on-surface hover:bg-md-surface-variant active:brightness-95'}"
                onclick={() => { onSortChange('subjectDesc'); sortDropdownOpen = false; }}
              >{$t('inbox.viewOptions.sortDescShort')}</button>
            </div>
          </div>
        </div>
      {/if}
    </div>

    <!-- OTP chip -->
    <button
      id="button-otp-only"
      class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border border-md-outline-variant bg-transparent text-md-on-surface/80 active:brightness-95 transition-colors shrink-0 {controlSurface(
        otpOnly
      )}"
      aria-label={$t('inbox.otpOnlyAria')}
      onclick={() => { toggleBooleanPill('is:otp', !otpOnly); }}
    >
      {$t('inbox.filterHasOtp')}
    </button>

    <!-- Has-attachment chip -->
    <button
      id="button-has-attachment"
      class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border border-md-outline-variant bg-transparent text-md-on-surface/80 active:brightness-95 transition-colors shrink-0 {controlSurface(
        hasAttachment
      )}"
      aria-label={$t('inbox.filterHasAttachment')}
      onclick={() => { toggleBooleanPill('has:attachment', !hasAttachment); }}
    >
      {$t('inbox.filterHasAttachment')}
    </button>

    <!-- Date chip -->
    <div class="relative shrink-0">
      <button
        id="button-date-filter"
        class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border border-md-outline-variant bg-transparent text-md-on-surface/80 active:brightness-95 transition-colors {controlSurface(
          dateFrom || dateTo
        )}"
        aria-label={$t('inbox.filterByDateAria')}
        onclick={() => { dateDropdownOpen = !dateDropdownOpen; sortDropdownOpen = false; showCustomRange = false; savedFiltersDropdownOpen = false; fromDropdownOpen = false; }}
      >
        {dateChipLabel}
        <Icon name="chevronDown" class="w-3 h-3" />
      </button>
      {#if dateDropdownOpen}
        <div use:anchoredFlyout={{ onClose: () => { dateDropdownOpen = false; } }} class="absolute top-full start-0 mt-1 bg-md-surface-container border border-md-outline-variant rounded-2xl {ELEVATION.level2} {PORTAL_Z_CLASS.accountMenu} overflow-hidden min-w-[220px]">
          <!-- Header -->
          <div class="flex items-center justify-between px-4 py-3 border-b border-md-outline-variant/30">
            <span class="text-sm font-semibold text-md-on-surface">{$t('filters.date')}</span>
            <IconButton
              id="button-close-date-filter"
              icon="close"
              size="sm"
              iconClass="w-3.5 h-3.5"
              ariaLabel={$t('inbox.closeDateFilterAria')}
              class="text-md-on-surface/60 hover:text-md-on-surface"
              onclick={() => {
                dateDropdownOpen = false;
                showCustomRange = false;
              }}
            />
          </div>
          {#if !showCustomRange}
            <!-- Preset options -->
            <div class="py-2">
              {#each datePresets as preset (preset.value)}
                <label class="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-md-surface-variant/50 active:bg-md-surface-variant/70 transition-colors">
                  <span class="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors {datePreset === preset.value ? 'border-md-primary' : 'border-md-outline-variant'}">
                    {#if datePreset === preset.value}
                      <span class="w-2 h-2 rounded-full bg-md-primary"></span>
                    {/if}
                  </span>
                  <Radio
                    id="radio-date-preset-{preset.value}"
                    class="sr-only"
                    checked={datePreset === preset.value}
                    ariaLabel={preset.label}
                    onchange={() => {
                      applyDatePreset(preset.value);
                      if (preset.value !== 'custom') dateDropdownOpen = false;
                    }}
                  />
                  <span class="text-sm text-md-on-surface">{preset.label}</span>
                </label>
              {/each}
            </div>
            <!-- Custom range link -->
            <div class="px-4 py-2 border-t border-md-outline-variant/30">
              <button id="button-custom-date-range" class="text-sm text-md-primary hover:underline" aria-label={$t('inbox.customDateRangeAria')} onclick={() => showCustomRange = true}>{$t('filters.customRange')}</button>
            </div>
          {:else}
            <!-- Custom range picker -->
            <div class="p-4 space-y-3">
              <button id="button-back-custom-date" class="text-xs text-md-on-surface/50 hover:text-md-on-surface flex items-center gap-1" onclick={() => showCustomRange = false}>
                <Icon name="chevronLeft" class="w-3 h-3 rtl-flip" />
                {$t('common.back')}
              </button>
              <div class="flex flex-col gap-1">
                <span class="text-sm text-md-on-surface-variant">{$t('inbox.filterDateFrom')}</span>
                <input
                  id="input-date-from"
                  type="date"
                  class="w-full px-2 py-1 rounded border border-md-outline-variant text-sm bg-md-surface-container-low outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary"
                  aria-label={$t('inbox.dateFromAria')}
                  value={dateFrom}
                  onchange={(e) => { onDateFromChange((e.target as HTMLInputElement).value); datePreset = 'custom'; }}
                />
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-sm text-md-on-surface-variant">{$t('inbox.filterDateTo')}</span>
                <input
                  id="input-date-to"
                  type="date"
                  class="w-full px-2 py-1 rounded border border-md-outline-variant text-sm bg-md-surface-container-low outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary"
                  aria-label={$t('inbox.dateToAria')}
                  value={dateTo}
                  onchange={(e) => { onDateToChange((e.target as HTMLInputElement).value); datePreset = 'custom'; }}
                />
              </div>
              <Btn
                id="button-apply-date-range"
                variant="primary"
                size="sm"
                class="w-full"
                onclick={() => dateDropdownOpen = false}
              >
                {$t('common.apply')}
              </Btn>
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
          class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border transition-colors border-md-outline-variant bg-transparent text-md-on-surface/80 hover:bg-md-surface-variant active:brightness-95"
          aria-label={$t('inbox.savedFiltersAria')}
          onclick={() => { savedFiltersDropdownOpen = !savedFiltersDropdownOpen; sortDropdownOpen = false; dateDropdownOpen = false; fromDropdownOpen = false; manageFiltersOpen = false; }}
        >
          {$t('inbox.filterSavedFilters')}
          <Icon name="chevronDown" class="w-3 h-3" />
        </button>
        {#if savedFiltersDropdownOpen}
          <div use:anchoredFlyout={{ onClose: () => { savedFiltersDropdownOpen = false; } }} class="absolute top-full start-0 mt-1 bg-md-surface border border-md-outline-variant rounded-xl {ELEVATION.level2} {PORTAL_Z_CLASS.accountMenu} overflow-hidden min-w-[150px]">
            {#each savedSearchFilters as filter (filter.id)}
              <button
                id="button-load-filter-{filter.id}"
                class="w-full px-3 min-h-12 text-sm text-start hover:bg-md-surface-variant active:brightness-95 transition-colors text-md-on-surface"
                onclick={() => {
                  onSearchChange(
                    reconcileSavedFilterQuery(filter.searchQuery, filter.hasOTP, !!filter.hasAttachment, filter.unreadOnly)
                  );
                  onSortChange(filter.sortBy || 'newest');
                  onOtpOnlyChange(filter.hasOTP);
                  onUnreadOnlyChange(
                    filter.unreadOnly ?? parseSearchShortcuts(filter.searchQuery).unreadOnly
                  );
                  onHasAttachmentChange(!!filter.hasAttachment);
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

    <!-- Built-in filter presets -->
    <div class="relative shrink-0">
      <button
        id="button-filter-presets"
        class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border border-md-outline-variant bg-transparent text-md-on-surface/80 hover:bg-md-surface-variant active:brightness-95 transition-colors"
        aria-label={$t('inbox.filterPresetsAria')}
        onclick={() => { builtInPresetsOpen = !builtInPresetsOpen; sortDropdownOpen = false; dateDropdownOpen = false; fromDropdownOpen = false; savedFiltersDropdownOpen = false; }}
      >
        {$t('inbox.filterPresets')}
        <Icon name="chevronDown" class="w-3 h-3" />
      </button>
      {#if builtInPresetsOpen}
        <div use:anchoredFlyout={{ onClose: () => { builtInPresetsOpen = false; } }} class="absolute top-full start-0 mt-1 bg-md-surface border border-md-outline-variant rounded-xl {ELEVATION.level2} {PORTAL_Z_CLASS.accountMenu} overflow-hidden min-w-[190px]">
          <button type="button" class="w-full px-3 min-h-10 text-sm text-start hover:bg-md-surface-variant active:brightness-95" onclick={() => applyBuiltInPreset('unread')}>{$t('inbox.filterPresetUnread')}</button>
          <button type="button" class="w-full px-3 min-h-10 text-sm text-start hover:bg-md-surface-variant active:brightness-95" onclick={() => applyBuiltInPreset('otp')}>{$t('inbox.filterPresetOtp')}</button>
          <button type="button" class="w-full px-3 min-h-10 text-sm text-start hover:bg-md-surface-variant active:brightness-95" onclick={() => applyBuiltInPreset('attachment')}>{$t('inbox.filterPresetAttachment')}</button>
          <button type="button" class="w-full px-3 min-h-10 text-sm text-start hover:bg-md-surface-variant active:brightness-95" onclick={() => applyBuiltInPreset('last24')}>{$t('inbox.filterPresetLast24')}</button>
          <button type="button" class="w-full px-3 min-h-10 text-sm text-start hover:bg-md-surface-variant active:brightness-95" onclick={() => applyBuiltInPreset('sender')}>{$t('inbox.filterPresetSender')}</button>
        </div>
      {/if}
    </div>

    <!-- Manage Filters chip -->
    {#if savedSearchFilters.length > 0}
      <button
        id="button-manage-filters"
        class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border transition-colors border-md-outline-variant bg-transparent text-md-on-surface/80 hover:bg-md-surface-variant active:brightness-95 shrink-0"
        aria-label={$t('inbox.manageFiltersAria')}
        onclick={() => { manageFiltersOpen = true; savedFiltersDropdownOpen = false; sortDropdownOpen = false; dateDropdownOpen = false; fromDropdownOpen = false; }}
      >
        {$t('inbox.filterManageFilters')}
      </button>
    {/if}

    <!-- Clear all chip (only shown if any filter is active) -->
    {#if sortBy !== 'newest' || otpOnly || unreadOnly || hasAttachment || dateFrom || dateTo || selectedSenders.length > 0 || searchQuery}
      <button
        id="button-clear-filters"
        class="flex items-center gap-1 px-3 py-1.5 text-xs rounded-full border border-md-error/50 bg-transparent text-md-error hover:bg-md-error/10 active:bg-md-error/30 transition-colors shrink-0"
        aria-label={$t('inbox.clearAllFiltersAria')}
        onclick={() => { onClearFilters(); onSearchChange(''); onSortChange('newest'); onOtpOnlyChange(false); onUnreadOnlyChange(false); onHasAttachmentChange(false); onSenderDomainChange(''); onDateFromChange(''); onDateToChange(''); onSelectedSendersChange([]); }}
      >
        <Icon name="close" class="w-3 h-3" />
        {$t('common.clear')}
      </button>
    {/if}

    <!-- Save as filter button (only shown if current filter is not saved and has active filters) -->
    {#if !currentFilterSaved && (sortBy !== 'newest' || otpOnly || unreadOnly || hasAttachment || dateFrom || dateTo || selectedSenders.length > 0 || searchQuery !== '')}
      <button
        id="button-save-as-filter"
        class="flex items-center gap-1 px-3 py-1.5 text-xs rounded-full border border-md-primary bg-transparent text-md-primary hover:bg-md-primary/10 active:bg-md-primary/30 transition-colors shrink-0"
        aria-label={$t('inbox.saveAsFilterAria')}
        onclick={() => { showSaveFilter = true; }}
      >
        <Icon name="edit" class="w-3 h-3" />
        {$t('inbox.saveAsFilterLabel')}
      </button>
    {/if}
    </div>
  </div>
{/if}

<!-- Save Filter Dialog -->
{#if showSaveFilter}
  <ModalDialog
    open={true}
    activityDialogKey="dialog:filter"
    title={$t('filters.saveFilter')}
    maxWidth="sm"
    onClose={() => { saveFilterName = ''; showSaveFilter = false; }}
  >
    <input
      id="input-save-filter-name"
      type="text"
      placeholder={$t('filtersManagement.filterName')}
      class="w-full px-3 py-2 rounded-lg border border-md-outline-variant bg-md-surface-container-low text-sm outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary"
      aria-label={$t('filtersManagement.enterFilterName')}
      bind:value={saveFilterName}
      onkeydown={(e) => {
        if (e.key === 'Enter') {
          if (saveFilterName.trim()) {
            onSaveFilter(saveFilterName.trim(), searchQuery, otpOnly, hasAttachment, senderDomain, dateFrom, dateTo, selectedSenders, sortBy, recipient, subject, unreadOnly);
            saveFilterName = '';
            showSaveFilter = false;
          }
        }
      }}
      use:focusOnMount
    />
    {#snippet footer()}
      <div class="w-full flex flex-nowrap items-center justify-between gap-3" use:responsiveButtonLayout data-action-tier="S">
      <Btn
        id="button-cancel-save-filter"
        variant="ghost"
        size="md"
        class="flex-1"
        aria-label={$t('filtersManagement.cancelSaveAction')}
        onclick={() => { saveFilterName = ''; showSaveFilter = false; }}
      >
        {$t('common.cancel')}
      </Btn>
      <Btn
        id="button-save-filter-confirm"
        variant="primary"
        size="md"
        class="flex-1"
        aria-label={$t('filtersManagement.saveFilterAction')}
        onclick={() => {
          if (saveFilterName.trim()) {
            onSaveFilter(saveFilterName.trim(), searchQuery, otpOnly, hasAttachment, senderDomain, dateFrom, dateTo, selectedSenders, sortBy, recipient, subject, unreadOnly);
            saveFilterName = '';
            showSaveFilter = false;
          }
        }}
      >
        {$t('common.save')}
      </Btn>
      </div>
    {/snippet}
  </ModalDialog>
{/if}

<!-- Manage Filters Dialog -->
{#if manageFiltersOpen}
  <ModalDialog
    open={true}
    activityDialogKey="dialog:filter"
    title={$t('inbox.filterManageFilters')}
    maxWidth="md"
    onClose={() => manageFiltersOpen = false}
  >
    <!-- Filter List -->
    <div class="space-y-2">
        {#each savedSearchFilters as filter (filter.id)}
          <div class="input-row gap-2 p-3 rounded-xl bg-md-surface-container-low border border-md-outline-variant/30">
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
                class="px-3 py-2 rounded-lg bg-md-primary text-md-on-primary text-sm font-medium hover:bg-md-primary/90 active:brightness-95 transition-colors"
                onclick={() => {
                  if (renameFilterName.trim()) {
                    onRenameFilter(filter.id, renameFilterName.trim());
                    renamingFilterId = null;
                    renameFilterName = '';
                  }
                }}
              >
                {$t('common.save')}
              </button>
              <button
                id="button-cancel-rename-{filter.id}"
                class="px-3 py-2 rounded-lg bg-transparent hover:bg-md-surface-variant active:brightness-95 text-sm transition-colors"
                onclick={() => { renamingFilterId = null; renameFilterName = ''; }}
              >
                {$t('common.cancel')}
              </button>
            {:else}
              <!-- View mode -->
              <span class="flex-1 text-sm font-medium text-md-on-surface truncate">{filter.name}</span>
              <button
                id="button-rename-{filter.id}"
                class="p-2 rounded-full hover:bg-md-surface-variant active:bg-md-surface-variant/80 transition-colors"
                aria-label={$t('filtersManagement.renameFilter', { values: { name: filter.name } })}
                onclick={() => { renamingFilterId = filter.id; renameFilterName = filter.name; }}
              >
                <Icon name="edit" class="w-4 h-4 text-md-on-surface/60" />
              </button>
              <button
                id="button-delete-filter-{filter.id}"
                class="p-2 rounded-full hover:bg-md-error/10 active:bg-md-error/20 transition-colors"
                aria-label={$t('filtersManagement.deleteFilter', { values: { name: filter.name } })}
                onclick={() => onDeleteFilter(filter.id)}
              >
                <Icon name="delete" class="w-4 h-4 text-md-error" />
              </button>
            {/if}
          </div>
        {/each}
        {#if savedSearchFilters.length === 0}
          <p class="dialog-body-padding text-center text-sm text-md-on-surface/40">{$t('filtersManagement.noSavedFilters')}</p>
        {/if}
    </div>
  </ModalDialog>
{/if}
