<script lang="ts">
import { onDestroy, onMount, tick, untrack } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import Icon from '@/components/icons/Icon.svelte';
import TagDialog from '@/components/overlays/TagDialog.svelte';
import AutoRenewToggle from '@/components/ui/AutoRenewToggle.svelte';
import AccountCard from '@/components/ui/account/AccountCard.svelte';
import AccountSelector from '@/components/ui/account/AccountSelector.svelte';
import FaviconImage from '@/components/ui/FaviconImage.svelte';
import EmailList from '@/components/ui/mail/EmailList.svelte';
import FilterList from '@/components/ui/mail/FilterList.svelte';
import { Toggle } from '@/components/ui/primitives';
import TagPill from '@/components/ui/TagPill.svelte';
import {
  getSelectedIdentity,
  loadIdentities,
  selectIdentity,
} from '@/features/identities/identity-actions.js';
import { filterEmails } from '@/features/inbox/email-filters.js';
import { copyToClipboardAndSchedulePurge } from '@/utils/clipboard.js';
import {
  DEFAULT_PROVIDER,
  loadAllProviderConfigs,
  loadProviderConfig,
} from '@/utils/email-service.js';
import type { EmailThread } from '@/utils/email-threads.js';
import { groupEmailsByThread } from '@/utils/email-threads.js';
import { getDomainFaviconUrl, getRootDomain, getRootDomainFaviconUrl } from '@/utils/favicon.js';
import { fitButtonsLabelFont } from '@/utils/fit-label-font.js';
import { logError } from '@/utils/logger.js';
import { formatRemaining } from '@/utils/otp-magic-expiry.js';
import { timeAgo } from '@/utils/time.js';
import { useCurrentTime } from '@/utils/time-store.js';
import type { Account, Email, Identity, SavedSearchFilter } from '@/utils/types.js';

let otpCollapsed = $state(false);
let otpDropupOpen = $state(false);
/** Dynamic font size for mailbox action row labels (single-line, no truncate) */
let actionBtnFontPx = $state(11);
let actionRowEl = $state<HTMLElement | null>(null);

// Renewal strip state - session-only dismissal. Re-appears on reload.
let renewalStripDismissed = $state(false);
let renewalStripCollapsed = $state(false);

type OtpHistoryItem = {
  otp: string;
  from: string;
  from_name: string;
  received_at: number;
  inboxAddress: string;
};

let otpHistoryCurrent = $state<OtpHistoryItem[]>([]);
let otpHistoryOther = $state<OtpHistoryItem[]>([]);

// Identity state
let identities = $state<Identity[]>([]);
let selectedIdentityId = $state<string | null>(null);
let showAutofillStrip = $state(true);
let showSavedLoginStrip = $state(true);
let showMagicLinkStrip = $state(true);
let showFilterAppliedStrip = $state(true);
/** Hide "Save as filter" after a successful quick-save */
let filterQuickSaved = $state(false);
/** Inbox lifecycle intelligence suggestions for current / all accounts */
let lifecycleHints = $state<
  Array<{ kind: string; inboxId: string; address: string; reasonKey: string; score: number }>
>([]);
let lifecycleHintDismissed = $state(false);
/** Layout prefs: allow user to hide bottom strips permanently until re-enabled */
let preferHideOtpStrip = $state(false);
let preferHideAutofillStrip = $state(false);
let preferHideMagicStrip = $state(false);
let currentDomain = $state<string>('');
let showIdentityDropdown = $state(false);

// Track which bottom strip should be in front
let frontStrip = $state<'autofill' | 'otp' | 'savedLogin' | 'magic' | 'filter'>('autofill');

// Track previous values to detect actual changes - plain let, NOT $state,
// so mutations inside $effect don't re-trigger the effect.
let _prevFormDetected = false;
let _prevLatestOtp = '------';

// React to prop changes: formDetected change → autofill front; new OTP → otp front.
// "Last changed wins" - visiting a site always overrides a prior OTP.
$effect(() => {
  // Read reactive props (tracked by Svelte)
  const fd = formDetected;
  const otp = latestOtp;

  // Read prev-values (NOT tracked - plain let)
  const formJustDetected = fd && !_prevFormDetected;
  const newOtpArrived = otp !== '------' && otp !== _prevLatestOtp;

  if (formJustDetected) {
    // Visiting a site always brings autofill to front, regardless of OTP
    frontStrip = 'autofill';
  } else if (newOtpArrived) {
    // New OTP arrived (and no simultaneous form detection)
    frontStrip = 'otp';
  }

  // Update prev values (not $state - no reactivity triggered)
  _prevFormDetected = fd;
  _prevLatestOtp = otp;
});

// Load all providers dynamically from config
let allProviders = $derived.by(() => loadAllProviderConfigs());

async function loadOtpHistory() {
  try {
    const { storedEmails = {}, inboxes = [] } = (await browser.storage.local.get([
      'storedEmails',
      'inboxes',
    ])) as {
      storedEmails?: Record<string, Email[]>;
      inboxes?: Account[];
    };
    const current: OtpHistoryItem[] = [];
    const other: OtpHistoryItem[] = [];
    // Normalize selection (domain display alias + case) so OTPs never land in wrong section
    const selectedNorm = (selectedEmail || '').toLowerCase();
    const displayedNorm = (displayedEmail || '').toLowerCase();
    const currentLocal = selectedNorm.split('@')[0] || '';
    // Restrict multi-domain alias match to same provider (avoid cross-provider local-part bleed)
    const currentProvider =
      currentAccount?.provider ||
      inboxes.find((i) => (i.address || '').toLowerCase() === selectedNorm)?.provider ||
      '';
    const providerByAddress = new Map(
      inboxes.map((i) => [(i.address || '').toLowerCase(), i.provider || ''] as const)
    );
    for (const [addr, msgs] of Object.entries(storedEmails)) {
      const addrNorm = (addr || '').toLowerCase();
      const addrProvider = providerByAddress.get(addrNorm) || '';
      for (const m of msgs) {
        if (!m.otp) continue;
        const item: OtpHistoryItem = {
          otp: m.otp,
          from:
            (m as Email & { from_address?: string }).from_address || m.from || m.from_name || '',
          from_name: m.from_name || '',
          received_at: m.received_at,
          inboxAddress: addr,
        };
        const orig = (
          (m as Email & { original_inbox?: string }).original_inbox || ''
        ).toLowerCase();
        const sameExact =
          addrNorm === selectedNorm ||
          addrNorm === displayedNorm ||
          (!!orig && (orig === selectedNorm || orig === displayedNorm));
        // Multi-domain alias only when same provider (abc@x.com vs abc@y.com on one provider)
        const sameProviderAlias =
          !!currentLocal &&
          addrNorm.startsWith(`${currentLocal}@`) &&
          !!currentProvider &&
          addrProvider === currentProvider;
        const isCurrent = sameExact || sameProviderAlias;
        if (isCurrent) {
          current.push(item);
        } else {
          other.push(item);
        }
      }
    }
    current.sort((a, b) => b.received_at - a.received_at);
    other.sort((a, b) => b.received_at - a.received_at);
    otpHistoryCurrent = current.slice(0, 50);
    otpHistoryOther = other.slice(0, 50);
  } catch (error: unknown) {
    logError(
      'Failed to load OTP history:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

function toggleOtpDropup() {
  otpDropupOpen = !otpDropupOpen;
  if (otpDropupOpen) loadOtpHistory();
}

async function clearAllOtps() {
  if (!showConfirm) {
    await doClearAllOtps();
    return;
  }
  showConfirm($t('inbox.confirmClearAllOtps'), doClearAllOtps);
}

async function doClearAllOtps() {
  try {
    const response = await browser.runtime.sendMessage({ type: 'clearAllOtps' });
    if (response && !response.success) {
      throw new Error(response.error || 'Failed to clear OTPs');
    }
    otpHistoryCurrent = [];
    otpHistoryOther = [];
    showToast($t('inbox.otpsCleared'));
  } catch (error: unknown) {
    logError(
      'Failed to clear OTPs:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

async function loadIdentitiesData() {
  try {
    const { identities: storedIdentities = [], selectedIdentityId: storedSelectedId } =
      (await browser.storage.local.get(['identities', 'selectedIdentityId'])) as {
        identities?: Identity[];
        selectedIdentityId?: string;
      };

    identities = storedIdentities;
    selectedIdentityId = storedSelectedId || storedIdentities[0]?.id || null;
  } catch (error: unknown) {
    logError(
      'Failed to load identities:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
    // Set defaults to prevent UI crashes
    identities = [];
    selectedIdentityId = null;
  }
}

async function handleIdentityChange() {
  if (selectedIdentityId) {
    await browser.storage.local.set({ selectedIdentityId });
  }
}

// Load identities on mount
loadIdentitiesData();

// Get current tab domain
async function getCurrentTabDomain() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      const url = new URL(tab.url);
      currentDomain = url.hostname;
    }
  } catch (error: unknown) {
    logError(
      'Failed to get current tab domain:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

let otpOptInList = $state<string[]>([]);
let isOtpOptedIn = $derived(
  currentDomain
    ? otpOptInList.some(
        (d) =>
          typeof d === 'string' &&
          d.toLowerCase() === currentDomain.replace(/^www\./, '').toLowerCase()
      )
    : false
);

async function loadOtpOptInList() {
  try {
    const res = await browser.storage.local.get(['otpOptInList']);
    otpOptInList = Array.isArray(res.otpOptInList) ? res.otpOptInList : [];
  } catch {}
}

async function toggleOtpOptIn() {
  if (!currentDomain) return;
  const domainKey = currentDomain.replace(/^www\./, '').toLowerCase();
  let updated: string[];
  if (isOtpOptedIn) {
    updated = otpOptInList.filter((d) => typeof d === 'string' && d.toLowerCase() !== domainKey);
  } else {
    updated = [...otpOptInList, domainKey];
  }
  otpOptInList = updated;
  await browser.storage.local.set({ otpOptInList: updated });
  showToast(
    $t(isOtpOptedIn ? 'toasts.otpAutofillEnabled' : 'toasts.otpAutofillDisabled'),
    'success'
  );
}

onMount(() => {
  loadOtpOptInList();

  const handleStorageChange = (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>
  ) => {
    if (changes.otpOptInList) {
      const newValue = changes.otpOptInList.newValue;
      otpOptInList = Array.isArray(newValue) ? (newValue as string[]) : [];
    }
  };
  browser.storage.onChanged.addListener(handleStorageChange);

  return () => {
    browser.storage.onChanged.removeListener(handleStorageChange);
  };
});

getCurrentTabDomain();

// Auto-suggest identity based on domain hints
let domainHintApplied = false;

$effect(() => {
  if (domainHintApplied || !currentDomain || identities.length === 0) return;
  const rootDomain = getRootDomain(currentDomain);
  const match = identities.find((i) =>
    i.domainHints?.some((h) => h === rootDomain || h === currentDomain)
  );
  if (match && match.id !== selectedIdentityId) {
    selectedIdentityId = match.id;
    handleIdentityChange();
  }
  domainHintApplied = true;
});

function domainMatchesHost(loginDomain: string, host: string): boolean {
  const a = (loginDomain || '').toLowerCase().replace(/^www\./, '');
  const b = (host || '').toLowerCase().replace(/^www\./, '');
  if (!a || !b) return false;
  return a === b || b.endsWith(`.${a}`) || a.endsWith(`.${b}`);
}

function formatOtp(otp: string): string {
  const clean = otp.replace(/\s/g, '');
  if (clean.length === 6) return `${clean.slice(0, 3)} ${clean.slice(3)}`;
  if (clean.length === 8) return `${clean.slice(0, 4)} ${clean.slice(4)}`;
  return otp;
}

/** Email list filter tab (Inbox / Archived / Deleted / All mails) */
type EmailListTab = 'inbox' | 'archived' | 'deleted' | 'all';

let {
  context = 'popup',
  selectedEmail = '',
  displayedEmail = $bindable(''),
  accounts = [],
  allAccounts = [],
  loading = false,
  searchQuery = '',
  sortBy = 'newest',
  otpOnly = false,
  senderDomain = '',
  senderEmail = '',
  selectedSenders = [] as string[],
  dateFrom = '',
  dateTo = '',
  notificationsEnabled = false,
  filteredEmails = [],
  emails = [],
  /** Folder tabs + label filter (bindable for sidebar control) */
  emailListTab = $bindable('inbox' as EmailListTab),
  activeLabelFilter = $bindable(null as string | null),
  /** When true, status chips only show while searching (sidebar owns them when wide) */
  hideListTabsUnlessSearch = false,
  /** All mailbox bags for cross-address search */
  allStoredEmails = {} as Record<string, Email[]>,
  latestOtp = '------',
  latestOtpSender = '',
  latestOtpSenderName = '',
  otpContext = '',
  formDetected = false,
  providerFailoverHint = null as null | {
    show: boolean;
    otherProvidersOk: boolean;
    nextRetryAt: number;
    failCount: number;
  },
  savedSearchFilters = [],
  savedLogins = [] as import('@/utils/types.js').CredentialsHistoryItem[],
  onSelectAccount = () => {},
  onCopyEmail = () => {},
  onOpenQrDialog = () => {},
  onCreateInbox = () => {},
  onAutofillForm = () => {},
  onRefreshInbox = async () => {},
  onToggleNotifications = () => {},
  onRefillSavedLogin = (_login: import('@/utils/types.js').CredentialsHistoryItem) => {},
  onSaveFilterQuick = () => {},
  onOpenMagicLink = (_url: string) => {},
  onArchiveAccount = () => {},
  onUnarchiveAccount = () => {},
  onRemoveAccount = () => {},
  onRestoreAccount = () => {},
  onReloadAccounts = async () => {},
  onEditAccount = () => {},
  onToggleAutoExtend = () => {},
  onExtendAccount = () => {},
  onOpenMessageDetail = () => {},
  onClearFilters = () => {},
  onCopyOtp = () => {},
  onCopyOtpFromMessage = () => {},
  onOpenArchivedEmails = () => {},
  onOpenExpiredEmails = () => {},
  onSearchChange = (_v: string) => {},
  onSortChange = (_v: string) => {},
  onOtpOnlyChange = () => {},
  onSenderDomainChange = () => {},
  onSelectedSendersChange = (_v: string[]) => {},
  onDateFromChange = () => {},
  onDateToChange = () => {},
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
  onNavigateToSettings = () => {},
  onNavigateToManage = () => {},
  onArchiveEmails = (_emails: Email[]) => {},
  onDeleteEmails = (_emails: Email[]) => {},
  onRestoreEmails = (_emails: Email[]) => {},
  autoRenew = false,
  onToggleAutoRenew = () => {},
  defaultDomain = '',
  dropdownOpen = undefined,
  openSection = undefined,
  onDropdownOpenChange = (_open: boolean) => {},
  onCreateInboxWithProvider = () => {},
  showToast = (_message: string, _type?: string, _undo?: (() => void | Promise<void>) | null) => {},
  showConfirm = (_message: string, _onConfirm: () => void) => {},
  selectedProviderInstance = null as string | null,
  emailPreviewEnabled = true,
}: {
  context?: 'popup' | 'sidepanel' | 'app';
  selectedEmail?: string;
  displayedEmail?: string;
  dropdownOpen?: boolean;
  accounts?: Account[];
  allAccounts?: Account[];
  loading?: boolean;
  searchQuery?: string;
  sortBy?: string;
  otpOnly?: boolean;
  senderDomain?: string;
  senderEmail?: string;
  selectedSenders?: string[];
  dateFrom?: string;
  dateTo?: string;
  notificationsEnabled?: boolean;
  filteredEmails?: Email[];
  emails?: Email[];
  emailListTab?: EmailListTab;
  activeLabelFilter?: string | null;
  hideListTabsUnlessSearch?: boolean;
  allStoredEmails?: Record<string, Email[]>;
  latestOtp?: string;
  latestOtpSender?: string;
  latestOtpSenderName?: string;
  otpContext?: string;
  formDetected?: boolean;
  providerFailoverHint?: null | {
    show: boolean;
    otherProvidersOk: boolean;
    nextRetryAt: number;
    failCount: number;
  };
  savedSearchFilters?: SavedSearchFilter[];
  savedLogins?: import('@/utils/types.js').CredentialsHistoryItem[];
  onSelectAccount?: (email: string) => void;
  onCopyEmail?: () => void;
  onOpenQrDialog?: () => void;
  onCreateInbox?: (provider?: string, instanceId?: string) => void;
  onAutofillForm?: () => void;
  onRefreshInbox?: () => Promise<void>;
  onToggleNotifications?: () => void;
  onRefillSavedLogin?: (login: import('@/utils/types.js').CredentialsHistoryItem) => void;
  onSaveFilterQuick?: () => void;
  onOpenMagicLink?: (url: string) => void;
  onArchiveAccount?: (account: Account) => void;
  onUnarchiveAccount?: (account: Account) => void;
  onRemoveAccount?: (address: string) => void;
  onRestoreAccount?: (address: string) => void;
  onReloadAccounts?: () => Promise<void>;
  onEditAccount?: (account: Account) => void;
  onToggleAutoExtend?: (account: Account) => void | Promise<void>;
  onExtendAccount?: (account: Account) => void | Promise<void>;
  onOpenMessageDetail?: (thread: Email[]) => void;
  onClearFilters?: () => void | Promise<void>;
  onCopyOtp?: () => void;
  onCopyOtpFromMessage?: (otp: string) => void;
  onOpenArchivedEmails?: () => void;
  onOpenExpiredEmails?: () => void;
  onSearchChange?: (v: string) => void;
  onSortChange?: (v: string) => void;
  onOtpOnlyChange?: (v: boolean) => void;
  onSenderDomainChange?: (v: string) => void;
  onSelectedSendersChange?: (v: string[]) => void;
  onDateFromChange?: (v: string) => void;
  showToast?: (message: string, type?: string, undo?: (() => void | Promise<void>) | null) => void;
  showConfirm?: (message: string, onConfirm: () => void) => void;
  onDateToChange?: (v: string) => void;
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
  onNavigateToSettings?: () => void | Promise<void>;
  onNavigateToManage?: () => void | Promise<void>;
  onArchiveEmails?: (emails: Email[]) => void | Promise<void>;
  onDeleteEmails?: (emails: Email[]) => void | Promise<void>;
  onRestoreEmails?: (emails: Email[]) => void | Promise<void>;
  autoRenew?: boolean;
  onToggleAutoRenew?: () => void;
  defaultDomain?: string;
  openSection?: 'active' | 'archived' | 'expired' | null;
  onDropdownOpenChange?: (open: boolean) => void;
  onCreateInboxWithProvider?: (providerId: string, instanceId?: string) => void;
  selectedProviderInstance?: string | null;
  emailPreviewEnabled?: boolean;
} = $props();

/** Best matching saved login for the active tab domain */
let matchingSavedLogin = $derived.by(() => {
  if (!currentDomain || !Array.isArray(savedLogins) || savedLogins.length === 0) return null;
  const matches = savedLogins.filter((l) =>
    domainMatchesHost(String(l.domain || l.website || ''), currentDomain)
  );
  if (matches.length === 0) return null;
  return [...matches].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0];
});

/** Live (non-archived, non-deleted) emails only — strips must not use archived/deleted messages */
let liveEmails = $derived.by(() =>
  (Array.isArray(emails) ? emails : []).filter((e) => !e.local_archived && !e.local_deleted)
);

/** Latest magic link across live mailbox emails */
let latestMagicLink = $derived.by(() => {
  for (const e of liveEmails) {
    const links = e.magicLinks;
    if (Array.isArray(links) && links.length) {
      const link = links[0];
      return {
        url: link.url,
        host: link.host || '',
        email: e,
        expiresAt: (link as { expiresAt?: number }).expiresAt || e.otpExpiresAt || null,
      };
    }
  }
  return null;
});

/** Latest live OTP from current mailbox emails (ignores archived/deleted) */
let latestLiveOtp = $derived.by(() => {
  const withOtp = liveEmails
    .filter((e) => e.otp && String(e.otp).trim() && e.otp !== '------')
    .sort((a, b) => (b.received_at || 0) - (a.received_at || 0));
  if (withOtp.length === 0) return null;
  const e = withOtp[0];
  return {
    otp: String(e.otp),
    sender: e.from || '',
    senderName: e.from_name || '',
    email: e,
    expiresAt: e.otpExpiresAt || null,
  };
});

let hasActiveListFilters = $derived(
  sortBy !== 'newest' ||
    otpOnly ||
    !!dateFrom ||
    !!dateTo ||
    (selectedSenders && selectedSenders.length > 0) ||
    !!senderDomain ||
    !!senderEmail ||
    !!searchQuery?.trim()
);

// Promote front strip only when the "winner" changes (avoid thrashing writes).
// Compare frontStrip via untrack so the write does not re-subscribe this effect.
$effect(() => {
  let next: typeof frontStrip | null = null;
  if (hasActiveListFilters) next = 'filter';
  else if (matchingSavedLogin) next = 'savedLogin';
  else if (latestMagicLink) next = 'magic';
  if (next) {
    const current = untrack(() => frontStrip);
    if (current !== next) frontStrip = next;
  }
  if (next === 'filter') {
    const showing = untrack(() => showFilterAppliedStrip);
    if (!showing) {
      showFilterAppliedStrip = true;
      filterQuickSaved = false;
    }
  }
});

// Lifecycle intelligence: recompute when accounts change
$effect(() => {
  const list = (allAccounts?.length ? allAccounts : accounts) || [];
  void list.length;
  void (async () => {
    try {
      const { suggestLifecycleActions, recomputeLifecycleFromStorage } = await import(
        '@/features/intelligence/inbox-lifecycle.js'
      );
      await recomputeLifecycleFromStorage(list as import('@/utils/types.js').Account[]);
      lifecycleHints = await suggestLifecycleActions(list as import('@/utils/types.js').Account[]);
    } catch {
      lifecycleHints = [];
    }
  })();
});

let otpSenderEmail = $derived(latestLiveOtp?.sender || latestOtpSender);

let latestOtpEmail = $derived(latestLiveOtp?.email ?? null);

/** OTP code shown in strip — never from archived/deleted messages */
let stripOtpCode = $derived(latestLiveOtp?.otp || '------');

let stripClockTick = $state(Date.now());
$effect(() => {
  const id = setInterval(() => {
    stripClockTick = Date.now();
  }, 30_000);
  return () => clearInterval(id);
});

let stripOtpRemaining = $derived.by(() => {
  void stripClockTick;
  const exp = latestLiveOtp?.expiresAt;
  if (!exp) return '';
  return formatRemaining(exp, stripClockTick);
});

let stripMagicRemaining = $derived.by(() => {
  void stripClockTick;
  const exp = latestMagicLink?.expiresAt;
  if (!exp) return '';
  return formatRemaining(exp, stripClockTick);
});

// Tag editing state
let tagDialogOpen = $state(false);
let actionRowCollapsed = $state(false);
let actionRowCollapsedInitialized = $state(false);
let accountSelectorHovered = $state(false);
let actionRowHovered = $state(false);
let searchBarFocused = $state(false);
/** Email count when search focus began — only count arrivals while focused */
let searchFocusEmailBaseline = $state(0);
let searchFocusNewMailCount = $state(0);
let tagTargetAccount = $state<Account | null>(null);

// Load actionRowCollapsed state from storage
async function loadActionRowCollapsedState() {
  try {
    const result = (await browser.storage.local.get(['actionRowCollapsed'])) as {
      actionRowCollapsed?: boolean;
    };
    if (result.actionRowCollapsed !== undefined) {
      actionRowCollapsed = result.actionRowCollapsed;
    }
  } catch (error) {
    logError(
      'Failed to load actionRowCollapsed state:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
  } finally {
    actionRowCollapsedInitialized = true;
  }
}

// Save actionRowCollapsed state to storage
async function saveActionRowCollapsedState() {
  try {
    await browser.storage.local.set({ actionRowCollapsed });
  } catch (error) {
    logError(
      'Failed to save actionRowCollapsed state:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

// Load state on mount
loadActionRowCollapsedState();

// Persist collapse preference after init. Track only the boolean we care about;
// skip first run after load so load→save cannot thrash with storage listeners.
let actionRowPersistReady = false;
$effect(() => {
  void actionRowCollapsed;
  if (!actionRowCollapsedInitialized) return;
  if (!actionRowPersistReady) {
    actionRowPersistReady = true;
    return;
  }
  void saveActionRowCollapsedState();
});

// View mode: whether to show favicons in the email list rows
let showFavicons = $state(true);
let gesturesEnabled = $state(true);
let viewDropdownOpen = $state(false);
let viewSortSubOpen = $state(false);
let viewShowSubOpen = $state(false);
let showFaviconsInitialized = $state(false);

// View mode: whether to hide per-email labels (Local, custom tags) and OTP badges
let hideLabels = $state(false);
let hideLabelsInitialized = $state(false);
let hideOtpLabels = $state(false);
let hideOtpLabelsInitialized = $state(false);

async function loadShowFaviconsState() {
  try {
    const result = (await browser.storage.local.get([
      'showFavicons',
      'gesturesEnabled',
      'preferHideOtpStrip',
      'preferHideAutofillStrip',
      'preferHideMagicStrip',
    ])) as {
      showFavicons?: boolean;
      gesturesEnabled?: boolean;
      preferHideOtpStrip?: boolean;
      preferHideAutofillStrip?: boolean;
      preferHideMagicStrip?: boolean;
    };
    // Default ON when unset
    if (result.showFavicons !== undefined) {
      showFavicons = result.showFavicons;
    } else {
      showFavicons = true;
      void browser.storage.local.set({ showFavicons: true });
    }
    if (result.gesturesEnabled === false) gesturesEnabled = false;
    preferHideOtpStrip = !!result.preferHideOtpStrip;
    preferHideAutofillStrip = !!result.preferHideAutofillStrip;
    preferHideMagicStrip = !!result.preferHideMagicStrip;
  } catch (error) {
    logError(
      'Failed to load showFavicons state:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
  } finally {
    showFaviconsInitialized = true;
  }
}

async function saveShowFaviconsState() {
  try {
    await browser.storage.local.set({ showFavicons });
  } catch (error) {
    logError(
      'Failed to save showFavicons state:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

async function loadHideLabelsState() {
  try {
    const result = (await browser.storage.local.get(['hideLabels'])) as {
      hideLabels?: boolean;
    };
    if (result.hideLabels !== undefined) {
      hideLabels = result.hideLabels;
    }
  } catch (error) {
    logError(
      'Failed to load hideLabels state:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
  } finally {
    hideLabelsInitialized = true;
  }
}

async function saveHideLabelsState() {
  try {
    await browser.storage.local.set({ hideLabels });
  } catch (error) {
    logError(
      'Failed to save hideLabels state:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

async function loadHideOtpLabelsState() {
  try {
    const result = (await browser.storage.local.get(['hideOtpLabels'])) as {
      hideOtpLabels?: boolean;
    };
    if (result.hideOtpLabels !== undefined) {
      hideOtpLabels = result.hideOtpLabels;
    }
  } catch (error) {
    logError(
      'Failed to load hideOtpLabels state:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
  } finally {
    hideOtpLabelsInitialized = true;
  }
}

async function saveHideOtpLabelsState() {
  try {
    await browser.storage.local.set({ hideOtpLabels });
  } catch (error) {
    logError(
      'Failed to save hideOtpLabels state:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

loadShowFaviconsState();
loadHideLabelsState();
loadHideOtpLabelsState();

// Persist view toggles when they change (after initial load). Skip the first
// run after init so load→save cannot form a loop with storage listeners.
let faviconsPersistReady = false;
let hideLabelsPersistReady = false;
let hideOtpLabelsPersistReady = false;
$effect(() => {
  void showFavicons;
  if (!showFaviconsInitialized) return;
  if (!faviconsPersistReady) {
    faviconsPersistReady = true;
    return;
  }
  void saveShowFaviconsState();
});
$effect(() => {
  void hideLabels;
  if (!hideLabelsInitialized) return;
  if (!hideLabelsPersistReady) {
    hideLabelsPersistReady = true;
    return;
  }
  void saveHideLabelsState();
});
$effect(() => {
  void hideOtpLabels;
  if (!hideOtpLabelsInitialized) return;
  if (!hideOtpLabelsPersistReady) {
    hideOtpLabelsPersistReady = true;
    return;
  }
  void saveHideOtpLabelsState();
});

// Lazy loading state - page size is user-configurable (persisted)
const PAGE_SIZE_OPTIONS = [10, 20, 30, 50, 100] as const;
let pageSize = $state(20);
let displayedEmailCount = $state(20);

// Thread grouping & view option states - persisted to storage
let threadGrouping = $state(false);
let expandedThreadIds = $state<Set<string>>(new Set());
let starredEmailIds = $state<Set<string>>(new Set());
let showStarredOnly = $state(false);
/** True while a renew-once / always-renew action is in progress (renewal strip). */
let isRenewing = $state(false);

// Load persisted prefs once on mount
onMount(() => {
  void (async () => {
    try {
      const result = (await browser.storage.local.get([
        'threadGrouping',
        'starredEmails',
        'emailListPageSize',
        'stripsEdgeCollapsed',
      ])) as {
        threadGrouping?: boolean;
        starredEmails?: string[];
        emailListPageSize?: number;
        stripsEdgeCollapsed?: boolean;
      };
      if (result.threadGrouping !== undefined) threadGrouping = result.threadGrouping;
      if (result.starredEmails) starredEmailIds = new Set(result.starredEmails);
      if (result.stripsEdgeCollapsed !== undefined) {
        stripsEdgeCollapsed = !!result.stripsEdgeCollapsed;
      }
      if (
        typeof result.emailListPageSize === 'number' &&
        (PAGE_SIZE_OPTIONS as readonly number[]).includes(result.emailListPageSize)
      ) {
        pageSize = result.emailListPageSize;
        displayedEmailCount = result.emailListPageSize;
      }
    } catch {
      // Storage read failed - keep defaults
    }
  })();
});

async function setPageSize(n: number) {
  pageSize = n;
  displayedEmailCount = n;
  try {
    await browser.storage.local.set({ emailListPageSize: n });
  } catch {
    /* ignore */
  }
}

// Multi-select strip (hosted here so it matches OTP strip size/placement)
let emailSelection = $state({
  mode: false,
  count: 0,
  canArchive: false,
  canDelete: false,
  canRestore: false,
});
let emailSelectionApi = $state({
  cancel: () => {},
  archive: () => {},
  delete: () => {},
  restore: () => {},
  star: () => {},
  label: () => {},
  selectAll: () => {},
  deselectAll: () => {},
});
/** Hide Search FAB while scrolling down the list */
let fabHidden = $state(false);

// Label filter chips (alongside Inbox/Archived/…)
let emailTagsMap = $state<Record<string, string[]>>({});
let labelOverflowOpen = $state(false);

async function loadEmailTagsMap() {
  try {
    const result = (await browser.storage.local.get(['emailTags'])) as {
      emailTags?: Record<string, string[]>;
    };
    const raw = result.emailTags || {};
    const sanitized: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(raw)) {
      sanitized[k] = Array.isArray(v) ? v : [];
    }
    emailTagsMap = sanitized;
  } catch {
    emailTagsMap = {};
  }
}

// Reset visible window when sort / filters change so order is obvious.
// Do not read displayedEmailCount here (would reset "load more" on its own write).
$effect(() => {
  void sortBy;
  void searchQuery;
  void otpOnly;
  void emailListTab;
  void activeLabelFilter;
  const next = pageSize;
  untrack(() => {
    if (displayedEmailCount !== next) displayedEmailCount = next;
  });
});

// When switching mailbox (prev/next), drop label/star/tab filters that would hide all mails
// Plain let — must NOT be $state (read+write in same effect → infinite loop)
let lastFilterMailbox = '';
$effect(() => {
  const addr = selectedEmail || '';
  if (!addr) return;
  if (lastFilterMailbox && lastFilterMailbox !== addr) {
    activeLabelFilter = null;
    labelOverflowOpen = false;
    showStarredOnly = false;
    emailListTab = 'inbox';
    displayedEmailCount = pageSize;
  }
  lastFilterMailbox = addr;
});

$effect(() => {
  void loadEmailTagsMap();
  const onStorage = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && changes.emailTags) void loadEmailTagsMap();
  };
  browser.storage.onChanged.addListener(onStorage);
  return () => browser.storage.onChanged.removeListener(onStorage);
});

let tabCounts = $derived.by(
  (): Record<EmailListTab, number> => ({
    inbox: filteredEmails.filter((e: Email) => !e.local_archived && !e.local_deleted).length,
    archived: filteredEmails.filter((e: Email) => e.local_archived && !e.local_deleted).length,
    deleted: filteredEmails.filter((e: Email) => !!e.local_deleted).length,
    all: filteredEmails.length,
  })
);

/** Base list for current status tab (before label / starred filters) */
let statusTabEmails = $derived.by((): Email[] => {
  switch (emailListTab) {
    case 'archived':
      return filteredEmails.filter((e: Email) => e.local_archived && !e.local_deleted);
    case 'deleted':
      return filteredEmails.filter((e: Email) => !!e.local_deleted);
    case 'all':
      return filteredEmails;
    default:
      return filteredEmails.filter((e: Email) => !e.local_archived && !e.local_deleted);
  }
});

/** Cross-mailbox search groups when query is active */
type CrossMailboxGroup = {
  address: string;
  isCurrent: boolean;
  emails: Email[];
  collapsed: boolean;
};
let crossMailboxSearchActive = $derived(!!searchQuery?.trim());
let collapsedCrossMailboxes = $state<Set<string>>(new Set());
let crossMailboxGroups = $derived.by((): CrossMailboxGroup[] => {
  if (!crossMailboxSearchActive) return [];
  const current = (selectedEmail || '').toLowerCase();
  const criteria = {
    searchQuery,
    otpOnly,
    senderDomain,
    senderEmail,
    recipient: '',
    subject: '',
    selectedSenders,
    dateFrom,
    dateTo,
    sortBy,
    emailTagsById: emailTagsMap,
  };
  const addrs = new Set<string>([
    ...Object.keys(allStoredEmails || {}),
    ...(allAccounts || []).map((a: Account) => a.address).filter(Boolean),
  ]);
  const groups: CrossMailboxGroup[] = [];
  for (const address of addrs) {
    const rawBag = allStoredEmails[address];
    const bag = (Array.isArray(rawBag) ? rawBag : []).map((e) => ({
      ...e,
      original_inbox: e.original_inbox || address,
    }));
    let list = filterEmails(bag, criteria);
    switch (emailListTab) {
      case 'archived':
        list = list.filter((e) => e.local_archived && !e.local_deleted);
        break;
      case 'deleted':
        list = list.filter((e) => !!e.local_deleted);
        break;
      case 'all':
        break;
      default:
        list = list.filter((e) => !e.local_archived && !e.local_deleted);
    }
    const isCurrent = address.toLowerCase() === current;
    // Always include current mailbox; others only if they have matches
    if (!isCurrent && list.length === 0) continue;
    groups.push({
      address,
      isCurrent,
      emails: list,
      collapsed: collapsedCrossMailboxes.has(address.toLowerCase()),
    });
  }
  // Current first, then by match count
  groups.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    return b.emails.length - a.emails.length;
  });
  return groups;
});

/** Unique labels present on emails in the current status tab */
let availableLabels = $derived.by((): string[] => {
  const set = new Set<string>();
  for (const e of statusTabEmails) {
    const tags = emailTagsMap[e.id];
    if (!tags) continue;
    for (const t of tags) set.add(t);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
});

let tabFilteredEmails = $derived.by((): Email[] => {
  let list = statusTabEmails;
  const labelFilter = activeLabelFilter;
  if (labelFilter) {
    list = list.filter((e: Email) => (emailTagsMap[e.id] || []).includes(labelFilter));
  }
  if (showStarredOnly) {
    return list.filter((e: Email) => {
      const addr = (e.original_inbox || selectedEmail || '').toLowerCase();
      const key = addr ? `${addr}_${e.id}` : e.id;
      return starredEmailIds.has(key);
    });
  }
  return list;
});

// While search is focused, toast only for emails that arrived after focus.
// Use plain counters for "already toasted" so we never read+write $state in one effect.
let searchFocusToastedCount = 0;
$effect(() => {
  if (!searchBarFocused) {
    searchFocusToastedCount = 0;
    return;
  }
  const n = emails.length;
  const baseline = searchFocusEmailBaseline;
  const delta = n - baseline - searchFocusToastedCount;
  if (delta <= 0) return;
  searchFocusToastedCount += delta;
  const total = searchFocusToastedCount;
  queueMicrotask(() => {
    showToast(
      total === 1
        ? $t('inbox.searchFocusNewMailOne')
        : $t('inbox.searchFocusNewMailMany', { values: { n: total } }),
      'info'
    );
  });
});

let emailThreads = $derived.by((): EmailThread[] => {
  if (!threadGrouping) return [];
  return groupEmailsByThread(tabFilteredEmails);
});

function toggleThread(threadId: string) {
  const next = new Set(expandedThreadIds);
  if (next.has(threadId)) next.delete(threadId);
  else next.add(threadId);
  expandedThreadIds = next;
}

// Displayed emails for lazy loading (flattened from threads when grouping is on)
let displayedEmails = $derived.by(() => {
  if (threadGrouping) {
    // When thread grouping is on, show only thread header emails (latest per thread)
    // The full thread is expanded inline
    return emailThreads
      .flatMap(
        (t) =>
          expandedThreadIds.has(t.id)
            ? t.emails // expanded: show all emails in thread
            : [t.latestEmail] // collapsed: show only the latest
      )
      .slice(0, displayedEmailCount);
  }
  return tabFilteredEmails.slice(0, displayedEmailCount);
});

// Load more emails when scrolling near bottom / button
function loadMoreEmails() {
  if (displayedEmailCount < tabFilteredEmails.length) {
    displayedEmailCount = Math.min(displayedEmailCount + pageSize, tabFilteredEmails.length);
  }
}

function handleSortChange(value: string) {
  onSortChange(value);
  displayedEmailCount = pageSize;
}

// Reactive derived value for current account
function fitActionButtonFonts() {
  const row = actionRowEl;
  if (!row) return;
  const buttons = Array.from(row.querySelectorAll<HTMLElement>('button'));
  if (!buttons.length) return;
  actionBtnFontPx = fitButtonsLabelFont(buttons, 'span.leading-tight, span.whitespace-nowrap', {
    basePx: 12,
    minPx: 8.5,
    weight: 700,
    reservedPx: 48,
  });
}

let currentAccount = $derived.by(() => {
  if (!selectedEmail) return null;
  const exact =
    allAccounts.find((a: Account) => a.address === selectedEmail) ||
    accounts.find((a: Account) => a.address === selectedEmail);
  if (exact) return exact;
  // Case-insensitive fallback (provider domain rewrites can change casing)
  const lower = selectedEmail.toLowerCase();
  return (
    allAccounts.find((a: Account) => (a.address || '').toLowerCase() === lower) ||
    accounts.find((a: Account) => (a.address || '').toLowerCase() === lower) ||
    null
  );
});

// Container background class based on account status
let containerBgClass = $derived.by(() => {
  if (!currentAccount) return 'bg-md-surface-container-highest';
  if (currentAccount.accountStatus === 'deleted') return 'bg-md-error-container';
  if (currentAccount.accountStatus === 'archived') return 'bg-md-tertiary-container';
  return 'bg-md-surface-container-highest';
});

$effect(() => {
  void $t;
  void currentAccount;
  void actionRowCollapsed;
  void tick().then(() => {
    fitActionButtonFonts();
    requestAnimationFrame(fitActionButtonFonts);
  });
});

// Button text based on collapse state and temporary expansion
let buttonText = $derived.by(() => {
  const isTemporarilyExpanded = actionRowCollapsed && (accountSelectorHovered || actionRowHovered);
  const isTemporarilyHidden = !actionRowCollapsed && (searchBarFocused || emailSelection.mode);
  if (isTemporarilyExpanded) return 'Always Show';
  if (isTemporarilyHidden) return 'Temporary Hidden';
  return actionRowCollapsed ? 'Show' : 'Hide';
});

/** Dialog after user chooses Hide — explains hover + Always Show */
let hideHintDialogOpen = $state(false);
let hideHintDontShow = $state(false);

function handleActionRowToggle() {
  if (!actionRowCollapsed) {
    actionRowCollapsed = true;
    void browser.storage.local.get(['hideActionRowHintDismissed']).then((r) => {
      if (!(r as { hideActionRowHintDismissed?: boolean }).hideActionRowHintDismissed) {
        hideHintDialogOpen = true;
      }
    });
  } else {
    actionRowCollapsed = false;
    hideHintDialogOpen = false;
  }
}

async function dismissHideHint(forever: boolean) {
  hideHintDialogOpen = false;
  if (forever || hideHintDontShow) {
    await browser.storage.local.set({ hideActionRowHintDismissed: true });
  }
}

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

// Calculate expiry progress percentage
let expiryProgress = $derived.by(() => {
  if (!currentAccount?.expiresAt || !currentAccount.createdAt) return 0;
  const now = currentTime;
  const totalDuration = currentAccount.expiresAt - currentAccount.createdAt;
  const remaining = currentAccount.expiresAt - now;
  if (totalDuration <= 0) return 0;
  const percentage = Math.max(0, Math.min(100, (remaining / totalDuration) * 100));
  return percentage;
});

// Check if current account's provider supports auto-renew
const supportsAutoRenew = $derived.by(() => {
  if (!currentAccount?.provider) return false;
  try {
    const config = loadProviderConfig(currentAccount.provider);
    return config.expiry?.renewable || false;
  } catch {
    return false;
  }
});

// Check if current account is expired
const isCurrentAccountExpired = $derived.by(() => {
  if (!currentAccount?.expiresAt) return false;
  return Date.now() > currentAccount.expiresAt;
});

// Renewal strip is eligible when: provider supports auto-renew AND
// account is currently expired AND auto-renew is NOT enabled AND not archived.
// (If auto-renew were enabled, the address would not have expired.)
const isCurrentAccountArchived = $derived(
  currentAccount?.accountStatus === 'archived' || currentAccount?.status === 'archived'
);
const renewalStripEligible = $derived(
  supportsAutoRenew &&
    isCurrentAccountExpired &&
    !(currentAccount?.autoExtend ?? false) &&
    !isCurrentAccountArchived
);

// Reset dismissal when the account changes (so a different expired inbox shows the strip again).
// Plain let — NOT $state (read+write in same effect → effect_update_depth_exceeded).
let _lastRenewalAddress: string | null = null;
$effect(() => {
  const addr = currentAccount?.address ?? null;
  if (addr !== _lastRenewalAddress) {
    _lastRenewalAddress = addr;
    renewalStripDismissed = false;
  }
});

// Final show flag = eligible AND not dismissed (still show while renew request in flight)
const showRenewalStrip = $derived((renewalStripEligible && !renewalStripDismissed) || isRenewing);

/** Edge handle: collapse OTP / Magic / Autofill (and related) strips to a thin tab */
let stripsEdgeCollapsed = $state(false);

async function setStripsEdgeCollapsed(next: boolean) {
  if (stripsEdgeCollapsed === next) return;
  stripsEdgeCollapsed = next;
  try {
    await browser.storage.local.set({ stripsEdgeCollapsed: next });
  } catch {
    /* ignore */
  }
}

// New OTP / magic mail auto-expands the strip stack (only when collapsed → expand once)
let _prevHadStripAlert = false;
$effect(() => {
  const hasAlert = !!(latestLiveOtp || latestMagicLink);
  // Read collapsed flag without re-subscribing on every expand/collapse write
  const collapsed = untrack(() => stripsEdgeCollapsed);
  if (hasAlert && !_prevHadStripAlert && collapsed) {
    void setStripsEdgeCollapsed(false);
  }
  _prevHadStripAlert = hasAlert;
});

let hasCollapsibleStrips = $derived.by(() => {
  if (emailSelection.mode) return false;
  return !!(
    (latestMagicLink && showMagicLinkStrip && !preferHideMagicStrip) ||
    (matchingSavedLogin && showSavedLoginStrip) ||
    (formDetected && showAutofillStrip && !preferHideAutofillStrip) ||
    (latestLiveOtp && !preferHideOtpStrip) ||
    showRenewalStrip ||
    (hasActiveListFilters && showFilterAppliedStrip)
  );
});

/** Reserve space under email list for absolute strip stack so rows aren't covered */
let stripReservePx = $derived.by(() => {
  if (emailSelection.mode) return 88;
  if (stripsEdgeCollapsed && hasCollapsibleStrips) return 36;
  let n = 0;
  if (hasActiveListFilters && showFilterAppliedStrip) n += 1;
  if (latestMagicLink && showMagicLinkStrip && !preferHideMagicStrip) n += 1;
  if (matchingSavedLogin && showSavedLoginStrip) n += 1;
  if (formDetected && showAutofillStrip && !preferHideAutofillStrip) n += 1;
  // Only live (non-archived/deleted) OTPs keep the strip visible
  if (latestLiveOtp && !preferHideOtpStrip) n += 1;
  if (showRenewalStrip) n += 1;
  return Math.max(8, n * 36 + (n > 0 ? 12 : 0));
});

// Auto-renew is now enabled → strip should disappear (the address will renew itself)
$effect(() => {
  if (currentAccount?.autoExtend && renewalStripEligible === false && !isRenewing) {
    untrack(() => {
      if (!renewalStripDismissed) renewalStripDismissed = true;
    });
  }
});

/** Renew once or always-renew: show loading feedback so UI is not stuck on “expired”. */
async function handleRenewOnce() {
  if (!currentAccount || isRenewing) return;
  isRenewing = true;
  try {
    await onExtendAccount(currentAccount);
  } finally {
    isRenewing = false;
  }
}

async function handleRenewAlways() {
  if (!currentAccount || isRenewing) return;
  isRenewing = true;
  try {
    // Enable auto-extend first, then immediately renew so status leaves “expired”
    if (!currentAccount.autoExtend) {
      await onToggleAutoExtend(currentAccount);
    }
    await onExtendAccount(currentAccount);
  } finally {
    isRenewing = false;
  }
}

// Tag functions
async function updateTag(accountId: string, tag: string, color: string | undefined = undefined) {
  try {
    await browser.runtime.sendMessage({ type: 'updateInboxTag', inboxId: accountId, tag, color });
    await onReloadAccounts();
  } catch (e) {
    logError('Failed to update tag:', e);
  }
}

function openTagDialog() {
  if (!currentAccount) return;
  tagTargetAccount = currentAccount;
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

// Extract existing tags from all accounts
let existingTags = $derived.by(() => {
  const tags = new Set<string>();
  allAccounts.forEach((a: Account) => {
    if (a.tag) tags.add(a.tag);
  });
  return Array.from(tags);
});

// Extract tag colors from all accounts
let tagColors = $derived.by(() => {
  const colors: Record<string, string> = {};
  allAccounts.forEach((a: Account) => {
    if (a.tag && a.tagColor) {
      colors[a.tag] = a.tagColor;
    }
  });
  return colors;
});
</script>

<div class="relative flex flex-col h-full min-h-0 overflow-hidden">
<div
  class="account-selector-container relative shrink-0 {containerBgClass} rounded-2xl {buttonText === 'Show' || buttonText === 'Always Show' ? 'rounded-ee-none' : ''} p-2 mt-[7.5px] mb-[7.5px] overflow-visible"
  role="none"
>
<div
  role="none"
  onmouseenter={() => { accountSelectorHovered = true; }}
  onmouseleave={() => { accountSelectorHovered = false; }}
>
<AccountSelector
  {selectedEmail}
  bind:displayedEmail
  {accounts}
  {defaultDomain}
  {allAccounts}
  {dropdownOpen}
  {onDropdownOpenChange}
  onSelectAccount={onSelectAccount}
  onEditAccount={onEditAccount}
  onToggleAutoExtend={onToggleAutoExtend}
  onArchiveAccount={onArchiveAccount}
  onUnarchiveAccount={onUnarchiveAccount}
  onRemoveAccount={onRemoveAccount}
  onRestoreAccount={onRestoreAccount}
  onCreateInbox={onCreateInbox}
  onNavigateToManage={onNavigateToManage}
  onReloadAccounts={onReloadAccounts}
  onNavigateToSettings={onNavigateToSettings}
  onCreateInboxWithProvider={onCreateInboxWithProvider}
  onMarkAllRead={async (account) => {
    try {
      const { readEmails = {}, storedEmails = {} } = (await browser.storage.local.get([
        'readEmails',
        'storedEmails',
      ])) as { readEmails?: Record<string, boolean>; storedEmails?: Record<string, Email[]> };
      const bag = storedEmails[account.address] || [];
      for (const e of bag) {
        readEmails[`${account.address}_${e.id}`] = true;
        readEmails[e.id] = true;
      }
      await browser.storage.local.set({ readEmails });
      showToast($t('emailDetail.markAllRead'));
      await onReloadAccounts();
    } catch {
      /* ignore */
    }
  }}
  onMarkAllUnread={async (account) => {
    try {
      const { readEmails = {}, storedEmails = {} } = (await browser.storage.local.get([
        'readEmails',
        'storedEmails',
      ])) as { readEmails?: Record<string, boolean>; storedEmails?: Record<string, Email[]> };
      const bag = storedEmails[account.address] || [];
      for (const e of bag) {
        delete readEmails[`${account.address}_${e.id}`];
        delete readEmails[e.id];
      }
      await browser.storage.local.set({ readEmails });
      showToast($t('emailDetail.markAllUnread'));
      await onReloadAccounts();
    } catch {
      /* ignore */
    }
  }}
  {showToast}
  {selectedProviderInstance}
  notificationsEnabled={notificationsEnabled}
  onToggleNotifications={onToggleNotifications}
  gesturesEnabled={gesturesEnabled}
/>
</div>

<!-- Action row: Copy Email, QR, New Address, Refresh, Notifications -->
{#if !searchBarFocused && !emailSelection.mode && (!actionRowCollapsed || accountSelectorHovered || actionRowHovered)}
<div
  class="mailbox-action-row flex items-center gap-1.5 pt-2 pb-2 mx-auto transition-all duration-300 ease-in-out"
  style="opacity: {actionRowCollapsed && !accountSelectorHovered && !actionRowHovered ? '0' : '1'}; transform: {actionRowCollapsed && !accountSelectorHovered && !actionRowHovered ? 'translateY(-10px)' : 'translateY(0)'}; --action-btn-font: {actionBtnFontPx}px;"
  bind:this={actionRowEl}
  onmouseenter={() => { actionRowHovered = true; }}
  onmouseleave={() => { actionRowHovered = false; }}
  role="none"
>
  <!-- Copy Email -->
  <button
    id="button-copy-email"
    class="btn-primary flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded-xl font-bold tracking-wide transition-colors shadow-sm min-w-0"
    style="font-size: var(--action-btn-font, 0.6875rem);"
    aria-label={$t('inbox.copyEmailAria')}
    title={$t('inbox.copyEmailAria')}
    onclick={(e) => { e.stopPropagation(); onCopyEmail(); }}
  >
    <span class="btn-icon flex items-center justify-center w-5 h-5 rounded-full shrink-0">
      <Icon name="copy" class="w-3.5 h-3.5" />
    </span>
    <span class="leading-tight self-center whitespace-nowrap">{$t('common.copy')}</span>
  </button>

  <!-- QR Code -->
  <button
    id="button-qr-code"
    class="btn-secondary flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded-xl font-bold tracking-wide transition-colors shadow-sm min-w-0"
    style="font-size: var(--action-btn-font, 0.6875rem);"
    aria-label={$t('inbox.showQrAria')}
    title={$t('inbox.showQrAria')}
    onclick={(e) => { e.stopPropagation(); onOpenQrDialog(); }}
  >
    <span class="btn-icon flex items-center justify-center w-5 h-5 rounded-full shrink-0">
      <Icon name="qr" class="w-3.5 h-3.5" />
    </span>
    <span class="leading-tight self-center whitespace-nowrap">QR</span>
  </button>

  <!-- Archive/Unarchive -->
  {#if currentAccount}
    {#if currentAccount.accountStatus === 'archived'}
      <button
        id="button-unarchive"
        class="btn-tertiary flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded-xl font-bold tracking-wide transition-colors shadow-sm min-w-0"
        style="font-size: var(--action-btn-font, 0.6875rem);"
        aria-label={$t('inbox.unarchiveEmailAria')}
        title={$t('inbox.unarchiveEmailAria')}
        onclick={(e) => { e.stopPropagation(); onUnarchiveAccount(currentAccount); }}
      >
        <span class="btn-icon flex items-center justify-center w-5 h-5 rounded-full shrink-0">
          <Icon name="archive" class="w-3.5 h-3.5" />
        </span>
        <span class="leading-tight self-center whitespace-nowrap">{$t('common.unarchive')}</span>
      </button>
    {:else}
      <button
        id="button-archive"
        class="btn-tertiary flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded-xl font-bold tracking-wide transition-colors shadow-sm min-w-0"
        style="font-size: var(--action-btn-font, 0.6875rem);"
        aria-label={$t('inbox.archiveEmailAria')}
        title={$t('inbox.archiveEmailAria')}
        onclick={(e) => { e.stopPropagation(); onArchiveAccount(currentAccount); }}
      >
        <span class="btn-icon flex items-center justify-center w-5 h-5 rounded-full shrink-0">
          <Icon name="archive" class="w-3.5 h-3.5" />
        </span>
        <span class="leading-tight self-center whitespace-nowrap">{$t('common.archive')}</span>
      </button>
    {/if}

    <!-- Forget Me / Restore -->
    {#if currentAccount.accountStatus === 'deleted'}
      <button
        id="button-restore"
        class="btn-error flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded-xl font-bold tracking-wide transition-colors shadow-sm min-w-0"
        style="font-size: var(--action-btn-font, 0.6875rem);"
        aria-label={$t('inbox.restoreEmailAria')}
        title={$t('inbox.restoreEmailAria')}
        onclick={(e) => { e.stopPropagation(); onRestoreAccount(currentAccount.address); }}
      >
        <span class="btn-icon flex items-center justify-center w-5 h-5 rounded-full shrink-0">
          <Icon name="back" class="w-3.5 h-3.5" />
        </span>
        <span class="leading-tight self-center whitespace-nowrap">{$t('common.restore')}</span>
      </button>
    {:else}
      <button
        id="button-delete"
        class="btn-error flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded-xl font-bold tracking-wide transition-colors shadow-sm min-w-0"
        style="font-size: var(--action-btn-font, 0.6875rem);"
        aria-label={$t('inbox.deleteEmailAria')}
        title={$t('inbox.deleteEmailAria')}
        onclick={(e) => { e.stopPropagation(); onRemoveAccount(currentAccount.address); }}
      >
        <span class="btn-icon flex items-center justify-center w-5 h-5 rounded-full shrink-0">
          <Icon name="trash" class="w-3.5 h-3.5" />
        </span>
        <span class="leading-tight self-center whitespace-nowrap">{$t('common.delete')}</span>
      </button>
    {/if}
  {/if}

</div>
{/if}

    <!-- Collapsible action row (auto-renew toggle + tag pill) -->
    {#if currentAccount && !searchBarFocused && !emailSelection.mode && (!actionRowCollapsed || accountSelectorHovered || actionRowHovered)}
      <div
        class="transition-all duration-300 ease-in-out"
        style="opacity: {actionRowCollapsed && !accountSelectorHovered && !actionRowHovered ? '0' : '1'}; transform: {actionRowCollapsed && !accountSelectorHovered && !actionRowHovered ? 'translateY(-10px)' : 'translateY(0)'};"
        onmouseenter={() => { actionRowHovered = true; }}
        onmouseleave={() => { actionRowHovered = false; }}
        role="none"
      >
        <div class="flex items-center gap-2">
          <!-- Auto-renew pill toggle (hidden for archived mailboxes) -->
          {#if supportsAutoRenew && currentAccount.expiresAt && !isCurrentAccountArchived}
            <AutoRenewToggle
              autoRenew={currentAccount.autoExtend || false}
              onToggle={() => onToggleAutoExtend(currentAccount)}
            />
          {/if}

          <!-- Tag pill -->
          <TagPill
            tag={currentAccount.tag}
            tagColor={currentAccount.tagColor}
            onClick={openTagDialog}
            showIcon={true}
          />
        </div>
      </div>
    {/if}

    <!-- Hide / Always Show: pill, flush bottom-end of account container (no chevron) -->
    {#if !actionRowCollapsed || accountSelectorHovered || actionRowHovered}
    <button
      id="button-collapse-toggle"
      type="button"
      class="reveal-toggle absolute end-0 bottom-0 z-10 m-0 px-3 py-0.5 cursor-pointer rounded-ss-full rounded-ee-none rounded-se-none rounded-es-none text-xs font-bold tracking-wide leading-none h-5 min-w-[3.5rem] border border-md-outline-variant/50 shadow-sm transition-colors
        {actionRowCollapsed
          ? 'bg-md-primary text-md-on-primary hover:bg-md-primary/90'
          : 'bg-md-secondary-container text-md-on-secondary-container hover:brightness-95'}"
      style="margin: 0; inset-inline-end: 0; bottom: 0;"
      onclick={(e) => { e.stopPropagation(); handleActionRowToggle(); }}
      onmouseenter={() => { actionRowHovered = true; }}
      onmouseleave={() => { actionRowHovered = false; }}
      aria-label={!actionRowCollapsed ? $t('inbox.hideActionRow') : $t('inbox.alwaysShowActionRow')}
      title={!actionRowCollapsed ? $t('inbox.hideActionRow') : $t('inbox.alwaysShowActionRow')}
    >
      {#if !actionRowCollapsed}
        {$t('inbox.hideActionRow')}
      {:else}
        {$t('inbox.alwaysShowActionRow')}
      {/if}
    </button>
    {/if}
</div>

{#if hideHintDialogOpen}
  <div class="fixed inset-0 z-[220] flex items-center justify-center p-4" role="dialog" aria-modal="true">
    <button type="button" class="absolute inset-0 bg-md-scrim/40" aria-label={$t('common.close')} onclick={() => void dismissHideHint(false)}></button>
    <div class="relative z-10 w-full max-w-[300px] rounded-2xl bg-md-surface border border-md-outline-variant/40 shadow-2xl p-4 space-y-3 animate-in">
      <h3 class="text-sm font-bold text-md-on-surface">{$t('inbox.hideActionRowTitle')}</h3>
      <p class="text-xs text-md-on-surface/70 leading-relaxed">{$t('inbox.hideActionRowBody')}</p>
      <label class="flex items-center gap-2 text-label-sm text-md-on-surface/70 cursor-pointer select-none">
        <input type="checkbox" class="accent-md-primary" bind:checked={hideHintDontShow} />
        {$t('inbox.dontShowAgain')}
      </label>
      <button
        type="button"
        class="w-full py-2 rounded-xl text-xs font-semibold bg-md-primary text-md-on-primary"
        onclick={() => void dismissHideHint(hideHintDontShow)}
      >{$t('common.confirm')}</button>
    </div>
  </div>
{/if}


<!-- Search + Filter row -->
<div class="shrink-0" data-tour="search-filter">
{#snippet layoutMenu()}
    <div class="relative shrink-0">
      <button
        type="button"
        id="button-tab-view"
        aria-haspopup="menu"
        aria-expanded={viewDropdownOpen}
        aria-label={$t('inbox.layoutMenu')}
        title={$t('inbox.layoutMenu')}
        class="w-8 h-8 flex items-center justify-center rounded-xl transition-colors mt-0 {viewDropdownOpen || threadGrouping || showStarredOnly ? 'bg-md-primary/15 text-md-primary' : 'bg-md-surface hover:bg-md-surface-variant text-md-on-surface/50'}"
        onclick={(e) => {
          e.stopPropagation();
          viewDropdownOpen = !viewDropdownOpen;
          labelOverflowOpen = false;
        }}
      >
        <Icon name="grid" class="w-4 h-4" />
      </button>
      {#if viewDropdownOpen}
        <button
          type="button"
          class="fixed inset-0 z-[190] cursor-default bg-transparent"
          aria-label={$t('common.close')}
          onclick={() => {
            viewDropdownOpen = false;
            viewSortSubOpen = false;
            viewShowSubOpen = false;
          }}
        ></button>
        <div
          class="menu-list absolute top-full end-0 mt-1 bg-md-surface-container-low border border-md-outline-variant/50 rounded-xl shadow-xl z-[200] overflow-visible min-w-[210px]"
          role="menu"
          tabindex="-1"
          onmouseleave={() => { viewSortSubOpen = false; viewShowSubOpen = false; }}
        >
          <div
            class="w-full flex items-center gap-2 px-3 py-2 text-xs text-md-on-surface"
            data-menu-item
          >
            <Icon name="globe" class="w-3.5 h-3.5 shrink-0 text-md-on-surface-variant" />
            <span class="flex-1">{$t('inbox.viewOptions.showFavicons')}</span>
            <Toggle
              size="sm"
              checked={showFavicons}
              ariaLabel={$t('inbox.viewOptions.showFavicons')}
              onChange={(v) => (showFavicons = v)}
            />
          </div>
          <div class="w-full flex items-center gap-2 px-3 py-2 text-xs text-md-on-surface" data-menu-item>
            <Icon name="tag" class="w-3.5 h-3.5 shrink-0 text-md-on-surface-variant" />
            <span class="flex-1">{$t('inbox.viewOptions.showLabels')}</span>
            <Toggle
              size="sm"
              checked={!hideLabels}
              ariaLabel={$t('inbox.viewOptions.showLabels')}
              onChange={(v) => (hideLabels = !v)}
            />
          </div>
          <div class="w-full flex items-center gap-2 px-3 py-2 text-xs text-md-on-surface" data-menu-item>
            <Icon name="lock" class="w-3.5 h-3.5 shrink-0 text-md-on-surface-variant" />
            <span class="flex-1">{$t('inbox.viewOptions.showOtpLabels')}</span>
            <Toggle
              size="sm"
              checked={!hideOtpLabels}
              ariaLabel={$t('inbox.viewOptions.showOtpLabels')}
              onChange={(v) => (hideOtpLabels = !v)}
            />
          </div>
          <div class="w-full flex items-center gap-2 px-3 py-2 text-xs text-md-on-surface" data-menu-item>
            <Icon name="threads" class="w-3.5 h-3.5 shrink-0 text-md-on-surface-variant" />
            <span class="flex-1">{$t('inbox.viewOptions.groupThreads')}</span>
            <Toggle
              size="sm"
              checked={threadGrouping}
              ariaLabel={$t('inbox.viewOptions.groupThreads')}
              onChange={(v) => {
                threadGrouping = v;
                expandedThreadIds = new Set();
                void browser.storage.local.set({ threadGrouping });
              }}
            />
          </div>
          <div class="w-full flex items-center gap-2 px-3 py-2 text-xs text-md-on-surface" data-menu-item>
            <Icon name="star" class="w-3.5 h-3.5 shrink-0 text-md-tertiary" />
            <span class="flex-1">{$t('inbox.viewOptions.starredOnly')}</span>
            <Toggle
              size="sm"
              checked={showStarredOnly}
              ariaLabel={$t('inbox.viewOptions.starredOnly')}
              onChange={(v) => (showStarredOnly = v)}
            />
          </div>

          <div class="border-t border-md-outline-variant/40 my-1"></div>
          <div class="px-3 py-1 text-xs font-bold uppercase tracking-wide text-md-on-surface/40">{$t('inbox.viewOptions.stripsSection')}</div>
          <div class="w-full flex items-center gap-2 px-3 py-2 text-xs text-md-on-surface" data-menu-item>
            <Icon name="lock" class="w-3.5 h-3.5 shrink-0 text-md-on-surface-variant" />
            <span class="flex-1">{$t('inbox.viewOptions.showOtpStrip')}</span>
            <Toggle
              size="sm"
              checked={!preferHideOtpStrip}
              ariaLabel={$t('inbox.viewOptions.showOtpStrip')}
              onChange={(v) => {
                preferHideOtpStrip = !v;
                void browser.storage.local.set({ preferHideOtpStrip });
              }}
            />
          </div>
          <div class="w-full flex items-center gap-2 px-3 py-2 text-xs text-md-on-surface" data-menu-item>
            <Icon name="edit" class="w-3.5 h-3.5 shrink-0 text-md-on-surface-variant" />
            <span class="flex-1">{$t('inbox.viewOptions.showAutofillStrip')}</span>
            <Toggle
              size="sm"
              checked={!preferHideAutofillStrip}
              ariaLabel={$t('inbox.viewOptions.showAutofillStrip')}
              onChange={(v) => {
                preferHideAutofillStrip = !v;
                void browser.storage.local.set({ preferHideAutofillStrip });
              }}
            />
          </div>
          <div class="w-full flex items-center gap-2 px-3 py-2 text-xs text-md-on-surface" data-menu-item>
            <Icon name="globe" class="w-3.5 h-3.5 shrink-0 text-md-on-surface-variant" />
            <span class="flex-1">{$t('inbox.viewOptions.showMagicLinkStrip')}</span>
            <Toggle
              size="sm"
              checked={!preferHideMagicStrip}
              ariaLabel={$t('inbox.viewOptions.showMagicLinkStrip')}
              onChange={(v) => {
                preferHideMagicStrip = !v;
                void browser.storage.local.set({ preferHideMagicStrip });
              }}
            />
          </div>

          <div class="border-t border-md-outline-variant/40 my-1"></div>

          <div
            class="relative"
            role="none"
            onmouseenter={() => { viewShowSubOpen = true; viewSortSubOpen = false; }}
            onmouseleave={() => { viewShowSubOpen = false; }}
          >
            <button
              type="button"
              class="w-full flex items-center gap-2 px-3 py-2 text-start text-xs hover:bg-md-surface-variant transition-colors text-md-on-surface"
              onclick={() => { viewShowSubOpen = !viewShowSubOpen; viewSortSubOpen = false; }}
            >
              <Icon name="chevronLeft" class="w-3.5 h-3.5 shrink-0 opacity-50 rtl-flip" />
              <Icon name="inbox" class="w-3.5 h-3.5 shrink-0" />
              <span class="flex-1">{$t('inbox.pageSize')}</span>
              <span class="text-xs text-md-on-surface/50 tabular-nums">{pageSize}</span>
            </button>
            {#if viewShowSubOpen}
              <div
                class="absolute top-0 end-full me-1 bg-md-surface-container border border-md-outline-variant rounded-xl shadow-lg z-[210] min-w-[140px] overflow-hidden"
                role="menu"
              >
                {#each PAGE_SIZE_OPTIONS as n (n)}
                  <button
                    type="button"
                    class="w-full flex items-center gap-2 px-3 py-2 text-start text-xs hover:bg-md-surface-variant {pageSize === n ? 'text-md-primary font-medium' : 'text-md-on-surface'}"
                    onclick={() => { void setPageSize(n); viewDropdownOpen = false; viewShowSubOpen = false; }}
                  >
                    <span class="flex-1">{$t('inbox.pageSizeOption', { values: { n } })}</span>
                    {#if pageSize === n}<Icon name="check" class="w-3.5 h-3.5 shrink-0" />{/if}
                  </button>
                {/each}
              </div>
            {/if}
          </div>

          <div
            class="relative"
            role="none"
            onmouseenter={() => { viewSortSubOpen = true; viewShowSubOpen = false; }}
            onmouseleave={() => { viewSortSubOpen = false; }}
          >
            <button
              type="button"
              class="w-full flex items-center gap-2 px-3 py-2 text-start text-xs hover:bg-md-surface-variant transition-colors text-md-on-surface"
              onclick={() => { viewSortSubOpen = !viewSortSubOpen; viewShowSubOpen = false; }}
            >
              <Icon name="chevronLeft" class="w-3.5 h-3.5 shrink-0 opacity-50 rtl-flip" />
              <Icon name="clock" class="w-3.5 h-3.5 shrink-0" />
              <span class="flex-1">{$t('inbox.viewOptions.sortSection')}</span>
            </button>
            {#if viewSortSubOpen}
              <div
                class="absolute top-0 end-full me-1 bg-md-surface-container border border-md-outline-variant rounded-xl shadow-lg z-[210] min-w-[180px] max-h-[50vh] overflow-y-auto"
                role="menu"
              >
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
                    class="w-full flex items-center gap-2 px-3 py-2 text-start text-xs hover:bg-md-surface-variant {sortBy === val ? 'text-md-primary font-medium' : 'text-md-on-surface'}"
                    onclick={() => { handleSortChange(val); viewDropdownOpen = false; viewSortSubOpen = false; }}
                  >
                    <span class="flex-1">{$t(labelKey)}</span>
                    {#if sortBy === val}<Icon name="check" class="w-3.5 h-3.5 shrink-0" />{/if}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </div>
{/snippet}
<FilterList
  searchQuery={searchQuery}
  sortBy={sortBy}
  otpOnly={otpOnly}
  senderDomain={senderDomain}
  senderEmail={senderEmail}
  selectedSenders={selectedSenders}
  emails={emails}
  dateFrom={dateFrom}
  dateTo={dateTo}
  savedSearchFilters={savedSearchFilters}
  onSearchChange={(value: string) => onSearchChange(value)}
  onSortChange={(value: string) => { handleSortChange(value); }}
  onOtpOnlyChange={(value: boolean) => { onOtpOnlyChange(value); }}
  onSenderDomainChange={(value: string) => { onSenderDomainChange(value); }}
  onSelectedSendersChange={(value: string[]) => { onSelectedSendersChange(value); }}
  onDateFromChange={(value: string) => { onDateFromChange(value); }}
  onDateToChange={(value: string) => { onDateToChange(value); }}
  onClearFilters={onClearFilters}
  onSaveFilter={async (name: string, sq: string, otp: boolean, sd: string, df: string, dt: string, senders: string[], sort: string) => {
    await onSaveFilter(name, sq, otp, sd, df, dt, senders, sort);
  }}
  onLoadFilter={onLoadFilter}
  onRenameFilter={onRenameFilter}
  onDeleteFilter={onDeleteFilter}
  onSearchFocus={() => {
    searchBarFocused = true;
    searchFocusEmailBaseline = emails.length;
    searchFocusNewMailCount = 0;
  }}
  onSearchBlur={() => {
    searchBarFocused = false;
    searchFocusNewMailCount = 0;
  }}
  onFilterClick={() => { /* filter menu only — do not focus search */ }}
  onRefreshInbox={onRefreshInbox}
  emailsLoading={loading}
  onToggleNotifications={onToggleNotifications}
  notificationsEnabled={notificationsEnabled}
  currentAddress={currentAccount?.address || selectedEmail || ''}
  {layoutMenu}
/>
</div>

<!-- Status tabs + labels: hidden when sidebar owns them (except during search) -->
{#if !hideListTabsUnlessSearch || !!(searchQuery && searchQuery.trim())}
<div class="shrink-0 px-0 py-1" data-tour="email-list-tabs">
  {#if true}
    {@const chip =
      'text-xs px-2.5 py-1 rounded-full whitespace-nowrap shrink-0 transition-colors'}
    {@const tabOn = 'bg-md-secondary-container text-md-on-secondary-container'}
    {@const tabOff =
      'border border-md-outline-variant text-md-on-surface-variant bg-md-surface-container-low hover:bg-md-secondary-container hover:text-md-on-secondary-container'}
    {@const maxInlineLabels = 6}
    {@const inlineLabels = availableLabels.slice(0, maxInlineLabels)}
    {@const overflowLabels = availableLabels.slice(maxInlineLabels)}
    <div class="relative flex flex-wrap gap-1 items-center content-start" role="tablist" aria-label={$t('inbox.listTabs.tabAria')}>
      <button
        id="button-tab-all"
        role="tab"
        aria-selected={emailListTab === 'all'}
        aria-label={$t('inbox.listTabs.allMails', { values: { count: tabCounts.all } })}
        class="{chip} {emailListTab === 'all' ? tabOn : tabOff}"
        onclick={() => { emailListTab = 'all'; activeLabelFilter = null; }}
        ondragover={(e) => { if (emailSelection.mode) e.preventDefault(); }}
        ondrop={(e) => { e.preventDefault(); if (emailSelection.mode) emailListTab = 'all'; }}
      >
        {$t('inbox.listTabs.allMails', { values: { count: tabCounts.all } })}
      </button>
      <button
        id="button-tab-inbox"
        role="tab"
        aria-selected={emailListTab === 'inbox'}
        aria-label={$t('inbox.listTabs.inbox', { values: { count: tabCounts.inbox } })}
        class="{chip} {emailListTab === 'inbox' ? tabOn : tabOff}"
        onclick={() => { emailListTab = 'inbox'; activeLabelFilter = null; }}
        ondragover={(e) => { if (emailSelection.mode) { e.preventDefault(); } }}
        ondrop={(e) => {
          e.preventDefault();
          if (!emailSelection.mode) return;
          if (emailListTab === 'archived' || emailListTab === 'deleted') emailSelectionApi.restore?.();
          emailListTab = 'inbox';
        }}
      >
        {$t('inbox.listTabs.inbox', { values: { count: tabCounts.inbox } })}
      </button>
      <button
        id="button-tab-archived"
        role="tab"
        aria-selected={emailListTab === 'archived'}
        aria-label={$t('inbox.listTabs.archived', { values: { count: tabCounts.archived } })}
        class="{chip} {emailListTab === 'archived' ? tabOn : tabOff}"
        onclick={() => { emailListTab = 'archived'; activeLabelFilter = null; }}
        ondragover={(e) => { if (emailSelection.mode) e.preventDefault(); }}
        ondrop={(e) => {
          e.preventDefault();
          if (!emailSelection.mode) return;
          if (emailSelection.canArchive) emailSelectionApi.archive?.();
          emailListTab = 'archived';
        }}
      >
        {$t('inbox.listTabs.archived', { values: { count: tabCounts.archived } })}
      </button>
      <button
        id="button-tab-deleted"
        role="tab"
        aria-selected={emailListTab === 'deleted'}
        aria-label={$t('inbox.listTabs.deleted', { values: { count: tabCounts.deleted } })}
        class="{chip} {emailListTab === 'deleted' ? tabOn : tabOff}"
        onclick={() => { emailListTab = 'deleted'; activeLabelFilter = null; }}
        ondragover={(e) => { if (emailSelection.mode) e.preventDefault(); }}
        ondrop={(e) => {
          e.preventDefault();
          if (!emailSelection.mode) return;
          if (emailSelection.canDelete) emailSelectionApi.delete?.();
          emailListTab = 'deleted';
        }}
      >
        {$t('inbox.listTabs.deleted', { values: { count: tabCounts.deleted } })}
      </button>

      {#each inlineLabels as lab (lab)}
        <button
          type="button"
          class="text-xs px-2 py-1 rounded-full max-w-[88px] truncate whitespace-nowrap shrink-0 {activeLabelFilter === lab ? 'bg-md-tertiary text-md-on-tertiary' : 'bg-md-tertiary-container text-md-on-tertiary-container'} hover:opacity-90 transition-colors"
          title={lab}
          onclick={() => { activeLabelFilter = activeLabelFilter === lab ? null : lab; }}
        >{lab}</button>
      {/each}

      {#if overflowLabels.length > 0}
        <div class="relative shrink-0">
          <button
            type="button"
            class="text-xs px-2 py-1 rounded-full whitespace-nowrap font-semibold {overflowLabels.includes(activeLabelFilter || '') ? 'bg-md-tertiary text-md-on-tertiary' : 'bg-md-tertiary-container text-md-on-tertiary-container'} hover:opacity-90"
            aria-expanded={labelOverflowOpen}
            aria-label={$t('inbox.moreLabels', { values: { n: overflowLabels.length } })}
            onclick={(e) => {
              e.stopPropagation();
              labelOverflowOpen = !labelOverflowOpen;
            }}
          >{$t('common.plusN', { values: { n: overflowLabels.length } })}</button>
          {#if labelOverflowOpen}
            <button
              type="button"
              class="fixed inset-0 z-[200] bg-transparent cursor-default"
              aria-label={$t('common.close')}
              onclick={() => (labelOverflowOpen = false)}
            ></button>
            <div class="absolute start-0 top-full mt-1 z-[210] min-w-[120px] max-h-48 overflow-y-auto rounded-xl border border-md-outline-variant bg-md-surface shadow-xl p-1">
              {#each overflowLabels as lab (lab)}
                <button
                  type="button"
                  class="w-full text-start px-2.5 py-1.5 text-label-sm rounded-lg truncate {activeLabelFilter === lab ? 'bg-md-tertiary/15 text-md-tertiary font-semibold' : 'text-md-on-surface hover:bg-md-surface-variant'}"
                  onclick={() => {
                    activeLabelFilter = activeLabelFilter === lab ? null : lab;
                    labelOverflowOpen = false;
                  }}
                >{lab}</button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      {#if activeLabelFilter}
        <button
          type="button"
          class="text-xs text-md-on-surface/50 hover:text-md-primary px-0.5 shrink-0"
          aria-label={$t('inbox.clearLabelFilter')}
          title={$t('inbox.clearLabelFilter')}
          onclick={() => { activeLabelFilter = null; }}
        >×</button>
      {/if}
    </div>
  {/if}
</div>
{/if}

<!-- Refresh is provided by footer contextual FAB -->

<!-- Email list: flex-1; bottom padding tracks strip stack so list height shrinks dynamically -->
<div class="flex-1 min-h-0 flex flex-col relative" style="padding-bottom: {stripReservePx}px;">
{#if crossMailboxSearchActive}
  <div class="flex-1 min-h-0 overflow-y-auto px-0.5 space-y-2 pb-2">
    {#each crossMailboxGroups as group (group.address)}
      <div class="rounded-xl border border-md-outline-variant/40 overflow-hidden bg-md-surface-container-low">
        <button
          type="button"
          class="w-full flex items-center gap-2 px-3 py-2 text-start hover:bg-md-surface-variant/50 transition-colors"
          onclick={() => {
            const key = group.address.toLowerCase();
            const next = new Set(collapsedCrossMailboxes);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            collapsedCrossMailboxes = next;
          }}
        >
          <Icon
            name="chevronDown"
            class="w-4 h-4 shrink-0 transition-transform {group.collapsed ? '-rotate-90' : ''}"
          />
          <span class="text-sm font-semibold text-md-on-surface truncate flex-1">
            {group.address}
            {#if group.isCurrent}
              <span class="text-xs font-medium text-md-primary ms-1">({$t('inbox.currentMailbox')})</span>
            {/if}
          </span>
          <span class="text-xs text-md-on-surface/50 tabular-nums">{group.emails.length}</span>
        </button>
        {#if !group.collapsed}
          {#if group.emails.length === 0}
            <p class="px-3 pb-2.5 text-xs text-md-on-surface/50">{$t('inbox.noMatchingResultsMailbox')}</p>
          {:else}
            <div class="max-h-[40vh] overflow-y-auto border-t border-md-outline-variant/30">
              <EmailList
                displayedEmails={group.emails.slice(0, 50)}
                filteredEmails={group.emails}
                displayedEmailCount={Math.min(50, group.emails.length)}
                loading={false}
                {searchQuery}
                {otpOnly}
                mailboxAddress={group.address}
                onOpenMessageDetail={onOpenMessageDetail}
                onClearFilters={onClearFilters}
                onRefreshInbox={onRefreshInbox}
                onCopyOtpFromMessage={onCopyOtpFromMessage}
                loadMoreEmails={() => {}}
                threadGrouping={false}
                emailThreads={[]}
                expandedThreadIds={new Set()}
                onToggleThread={() => {}}
                {emailPreviewEnabled}
                {showFavicons}
                {hideLabels}
                {hideOtpLabels}
                gesturesEnabled={false}
                emailListTab={emailListTab}
                onArchiveEmails={onArchiveEmails}
                onDeleteEmails={onDeleteEmails}
                onRestoreEmails={onRestoreEmails}
                externalSelectionBar={true}
                onSelectionChange={() => {}}
                onFilterByLabel={(label) => {
                  activeLabelFilter = label;
                }}
              />
            </div>
          {/if}
        {/if}
      </div>
    {:else}
      <p class="text-center text-sm text-md-on-surface/50 py-8">{$t('inbox.noMatchingResults')}</p>
    {/each}
  </div>
{:else}
<EmailList
  displayedEmails={displayedEmails}
  filteredEmails={tabFilteredEmails}
  displayedEmailCount={displayedEmailCount}
  {loading}
  {searchQuery}
  {otpOnly}
  mailboxAddress={selectedEmail}
  onOpenMessageDetail={onOpenMessageDetail}
  onClearFilters={onClearFilters}
  onRefreshInbox={onRefreshInbox}
  onCopyOtpFromMessage={onCopyOtpFromMessage}
  loadMoreEmails={loadMoreEmails}
  threadGrouping={threadGrouping}
  emailThreads={emailThreads}
  expandedThreadIds={expandedThreadIds}
  onToggleThread={toggleThread}
  {emailPreviewEnabled}
  {showFavicons}
  {hideLabels}
  {hideOtpLabels}
  {gesturesEnabled}
  emailListTab={emailListTab}
  onArchiveEmails={onArchiveEmails}
  onDeleteEmails={onDeleteEmails}
  onRestoreEmails={onRestoreEmails}
  externalSelectionBar={true}
  onSelectionChange={(s) => { emailSelection = s; }}
  onFilterByLabel={(label) => {
    activeLabelFilter = label;
    labelOverflowOpen = false;
  }}
  bind:selectionApi={emailSelectionApi}
  onScrollDirection={(dir) => {
    fabHidden = dir === 'down';
  }}
/>
{/if}
</div>

<!-- Bottom strips stacked wrapper -->
<!-- autofill is always first in DOM, OTP always second, renewal always third. -->
<!-- CSS `order` swaps them visually: front strip gets order:2 (goes to bottom = screen bottom), -->
<!-- back strip gets order:1 (goes to top = peeks above). Matches example's stacking exactly. -->
<!-- When `has-renewal` is set, the renewal strip is locked to order:3 (always front). -->
<!-- Selection strip replaces other strips while multi-select is active. -->
{#if hasCollapsibleStrips && !emailSelection.mode}
  <!--
    Android-style edge handle on the LEFT of the strip stack.
    Height matches visible strip stack. Drag right → collapse; drag left → expand.
  -->
  {@const handleH = stripsEdgeCollapsed
    ? 40
    : Math.max(36, Math.min(stripReservePx - 8, 160))}
  <button
    type="button"
    class="strips-edge-handle absolute z-30 touch-none"
    style="
      left: max(0px, calc(50% - min(175px, 50%) - 2px));
      bottom: {stripsEdgeCollapsed
        ? 'calc(var(--footer-safe, 72px) + 8px)'
        : '0'};
      height: {handleH}px;
    "
    aria-label={stripsEdgeCollapsed ? $t('inbox.expandStrips') : $t('inbox.collapseStrips')}
    aria-expanded={!stripsEdgeCollapsed}
    onpointerdown={(e) => {
      e.stopPropagation();
      e.preventDefault();
      const startX = e.clientX;
      const startCollapsed = stripsEdgeCollapsed;
      const pointerId = e.pointerId;
      const target = e.currentTarget as HTMLButtonElement;
      try {
        target.setPointerCapture(pointerId);
      } catch {
        /* ignore */
      }
      let dragged = false;
      const onMove = (ev: PointerEvent) => {
        // +dx = drag right (collapse); -dx = drag left (expand)
        const dx = ev.clientX - startX;
        if (Math.abs(dx) > 6) dragged = true;
        target.style.transform = `translateX(${Math.max(-12, Math.min(40, dx * 0.35))}px)`;
        if (dx > 24 && !startCollapsed) void setStripsEdgeCollapsed(true);
        if (dx < -24 && startCollapsed) void setStripsEdgeCollapsed(false);
      };
      const onUp = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        target.style.transform = '';
        try {
          target.releasePointerCapture(pointerId);
        } catch {
          /* ignore */
        }
        if (!dragged && Math.abs(startX - ev.clientX) < 8) {
          void setStripsEdgeCollapsed(!startCollapsed);
        }
      };
      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    }}
  >
    <span
      class="strips-edge-handle-pill"
      style="height: {Math.max(24, handleH - 8)}px;"
      aria-hidden="true"
    ></span>
  </button>
{/if}

{#if !stripsEdgeCollapsed || emailSelection.mode}
<div class="bottom-strips-wrapper z-20 shrink-0 front-{frontStrip}{showRenewalStrip ? ' has-renewal' : ''}{emailSelection.mode ? ' has-selection' : ''}" role="none">
{#if emailSelection.mode}
<div
  id="button-selection-strip"
  class="bottom-strip-item bottom-strip-selection rounded-xl selection-slide-up"
  style="--i: 1; overflow: hidden;"
  role="toolbar"
  aria-label={$t('mailManagement.selectedCount', { values: { n: emailSelection.count } })}
>
  <!-- Col1 select/deselect · Col2 actions (no X — deselect is enough) -->
  <div
    class="min-h-[80px] grid grid-cols-[auto_1fr] gap-1.5 box-border px-2 py-1.5 bg-md-secondary-container rounded-xl w-full items-stretch"
  >
    <div class="flex flex-col gap-1 justify-center min-w-0">
      <button
        type="button"
        class="h-7 px-2 rounded-lg text-xs font-bold bg-md-surface/80 hover:bg-md-surface shrink-0 whitespace-nowrap"
        onclick={(e) => { e.stopPropagation(); emailSelectionApi.selectAll?.(); }}
      >{$t('inbox.emailActions.selectAll')}</button>
      <button
        type="button"
        class="h-7 px-2 rounded-lg text-xs font-bold bg-transparent hover:bg-md-surface-variant/60 shrink-0 tabular-nums whitespace-nowrap"
        aria-label={$t('inbox.emailActions.deselectAll')}
        onclick={(e) => { e.stopPropagation(); emailSelectionApi.deselectAll?.(); }}
      >{$t('inbox.emailActions.deselectAll')} ({emailSelection.count})</button>
    </div>
    <div class="flex flex-col gap-1 min-w-0">
      <div class="flex items-center gap-1.5 w-full">
        <button
          type="button"
          class="btn-secondary flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-xl font-bold text-label-sm tracking-wide transition-colors shadow-sm"
          title={$t('inbox.emailActions.starSelected')}
          data-drop-action="star"
          ondragover={(e) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; }}
          ondragenter={(e) => { e.preventDefault(); }}
          ondrop={(e) => { e.preventDefault(); e.stopPropagation(); emailSelectionApi.star(); }}
          onclick={(e) => { e.stopPropagation(); e.preventDefault(); emailSelectionApi.star(); }}
        >
          <span class="btn-icon flex items-center justify-center w-5 h-5 rounded-full shrink-0">
            <Icon name="star" class="w-3.5 h-3.5" />
          </span>
          <span class="leading-tight">{$t('inbox.emailActions.star')}</span>
        </button>
        {#if emailSelection.canRestore}
          <button
            type="button"
            class="btn-tertiary flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-xl font-bold text-label-sm tracking-wide transition-colors shadow-sm"
            data-drop-action="restore"
            ondragover={(e) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; }}
            ondragenter={(e) => { e.preventDefault(); }}
            ondrop={(e) => { e.preventDefault(); e.stopPropagation(); emailSelectionApi.restore(); }}
            onclick={(e) => { e.stopPropagation(); emailSelectionApi.restore(); }}
          >
            <span class="btn-icon flex items-center justify-center w-5 h-5 rounded-full shrink-0">
              <Icon name="archive" class="w-3.5 h-3.5" />
            </span>
            <span class="leading-tight">{$t('inbox.emailActions.unarchive')}</span>
          </button>
        {:else if emailSelection.canArchive}
          <button
            type="button"
            class="btn-tertiary flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-xl font-bold text-label-sm tracking-wide transition-colors shadow-sm"
            data-drop-action="archive"
            ondragover={(e) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; }}
            ondragenter={(e) => { e.preventDefault(); }}
            ondrop={(e) => { e.preventDefault(); e.stopPropagation(); emailSelectionApi.archive(); }}
            onclick={(e) => { e.stopPropagation(); emailSelectionApi.archive(); }}
          >
            <span class="btn-icon flex items-center justify-center w-5 h-5 rounded-full shrink-0">
              <Icon name="archive" class="w-3.5 h-3.5" />
            </span>
            <span class="leading-tight">{$t('inbox.emailActions.archive')}</span>
          </button>
        {/if}
      </div>
      <div class="flex items-center gap-1.5 w-full">
        <button
          type="button"
          class="btn-primary flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-xl font-bold text-label-sm tracking-wide transition-colors shadow-sm"
          title={$t('inbox.emailActions.labelSelected')}
          data-drop-action="label"
          ondragover={(e) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; }}
          ondragenter={(e) => { e.preventDefault(); }}
          ondrop={(e) => { e.preventDefault(); e.stopPropagation(); emailSelectionApi.label(); }}
          onclick={(e) => { e.stopPropagation(); e.preventDefault(); emailSelectionApi.label(); }}
        >
          <span class="btn-icon flex items-center justify-center w-5 h-5 rounded-full shrink-0">
            <Icon name="tag" class="w-3.5 h-3.5" />
          </span>
          <span class="leading-tight">{$t('inbox.emailActions.label')}</span>
        </button>
        {#if emailSelection.canDelete}
          <button
            type="button"
            class="btn-error flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-xl font-bold text-label-sm tracking-wide transition-colors shadow-sm"
            data-drop-action="delete"
            ondragover={(e) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; }}
            ondragenter={(e) => { e.preventDefault(); }}
            ondrop={(e) => { e.preventDefault(); e.stopPropagation(); emailSelectionApi.delete(); }}
            onclick={(e) => { e.stopPropagation(); emailSelectionApi.delete(); }}
          >
            <span class="btn-icon flex items-center justify-center w-5 h-5 rounded-full shrink-0">
              <Icon name="trash" class="w-3.5 h-3.5" />
            </span>
            <span class="leading-tight">{$t('inbox.emailActions.delete')}</span>
          </button>
        {/if}
      </div>
    </div>
  </div>
</div>
{:else}
<!-- Lifecycle intelligence hint.
     When high-value renew applies to the *current* expired inbox and the renewal strip is
     already showing, merge into renewal (no duplicate strip). Standalone high-value only
     for a *different* address. -->
{#if !lifecycleHintDismissed && lifecycleHints.length > 0 && !emailSelection.mode}
  {@const hint = lifecycleHints[0]}
  {@const mergeHighValueIntoRenewal =
    hint.kind === 'renew_high_value' &&
    !!currentAccount &&
    currentAccount.id === hint.inboxId &&
    showRenewalStrip}
  {#if !mergeHighValueIntoRenewal}
    <div class="h-[40px] flex items-center box-border px-3 bg-md-tertiary-container bottom-strip-item rounded-xl mb-1 motion-strip-up" style="--i: 0;">
      <div class="flex items-center gap-2 w-full min-w-0">
        <Icon name="infoCircle" class="w-4 h-4 text-md-primary shrink-0" />
        <div class="min-w-0 flex-1">
          <div class="text-label-sm font-semibold text-md-on-surface truncate">
            {$t(hint.reasonKey, { values: { address: hint.address } })}
          </div>
        </div>
        {#if hint.kind === 'renew_high_value'}
          <button
            type="button"
            class="px-2 py-1 rounded-lg text-xs font-bold bg-md-primary text-md-on-primary shrink-0"
            onclick={(e) => {
              e.stopPropagation();
              const acc = (allAccounts || accounts).find((a) => a.id === hint.inboxId);
              if (acc) {
                onSelectAccount?.(acc.address);
                void onExtendAccount(acc);
              }
            }}
          >{$t('intelligence.renewAction')}</button>
        {:else if hint.kind === 'archive_idle'}
          <button
            type="button"
            class="px-2 py-1 rounded-lg text-xs font-bold bg-md-secondary-container text-md-on-surface shrink-0"
            onclick={(e) => {
              e.stopPropagation();
              const acc = (allAccounts || accounts).find((a) => a.id === hint.inboxId);
              if (acc) onArchiveAccount(acc);
            }}
          >{$t('common.archive')}</button>
        {:else if hint.kind === 'create_fresh_for_risk'}
          <button
            type="button"
            class="px-2 py-1 rounded-lg text-xs font-bold bg-md-primary text-md-on-primary shrink-0"
            onclick={(e) => {
              e.stopPropagation();
              onCreateInbox();
            }}
          >{$t('account.createNewMail')}</button>
        {/if}
        <button
          type="button"
          class="w-5 h-5 flex items-center justify-center rounded-lg shrink-0"
          aria-label={$t('common.close')}
          onclick={() => (lifecycleHintDismissed = true)}
        ><Icon name="x" class="w-3 h-3" /></button>
      </div>
    </div>
  {/if}
{/if}

<!-- Filters applied strip -->
{#if hasActiveListFilters && showFilterAppliedStrip}
<div class="h-[40px] flex items-center box-border px-3 bg-md-tertiary-container bottom-strip-item bottom-strip-filter rounded-xl" style="--i: 0;">
  <div class="flex items-center gap-2 w-full min-w-0">
    <Icon name="filter" class="w-4 h-4 text-md-primary shrink-0" />
    <div class="min-w-0 flex-1">
      <div class="text-xs font-bold text-md-on-surface truncate">{$t('inbox.filtersApplied')}</div>
      <div class="text-xs text-md-on-surface/50 truncate">{$t('inbox.filtersAppliedHint')}</div>
    </div>
    {#if !filterQuickSaved}
      <button type="button" class="px-2 py-1 rounded-lg text-xs font-bold bg-md-primary text-md-on-primary shrink-0" onclick={(e) => {
        e.stopPropagation();
        onSaveFilterQuick();
        filterQuickSaved = true;
      }}>{$t('inbox.saveAsFilter')}</button>
    {/if}
    <button type="button" class="px-2 py-1 rounded-lg text-xs font-bold bg-md-surface-variant text-md-on-surface shrink-0" onclick={(e) => { e.stopPropagation(); void onClearFilters(); }}>{$t('inbox.removeFilters')}</button>
    <button type="button" class="w-5 h-5 flex items-center justify-center rounded-lg shrink-0" aria-label={$t('common.close')} onclick={() => (showFilterAppliedStrip = false)}><Icon name="x" class="w-3 h-3" /></button>
  </div>
</div>
{/if}

<!-- Magic link strip -->
{#if latestMagicLink && showMagicLinkStrip && !preferHideMagicStrip}
<div class="h-[40px] flex items-center box-border px-3 bg-md-secondary-container bottom-strip-item bottom-strip-magic rounded-xl" style="--i: 0.5;">
  <div class="flex items-center gap-2 w-full min-w-0">
    <Icon name="globe" class="w-4 h-4 text-md-primary shrink-0" />
    <div class="min-w-0 flex-1">
      <div class="text-xs font-bold text-md-on-surface truncate">{$t('inbox.magicLinkDetected')}</div>
      <div class="text-xs text-md-on-surface/50 truncate">
        {latestMagicLink.host || latestMagicLink.url}
        {#if stripMagicRemaining && stripMagicRemaining !== 'expired'}
          · {$t('inbox.expiresIn', { values: { t: stripMagicRemaining } })}
        {:else if stripMagicRemaining === 'expired'}
          · {$t('inbox.expiredLabel')}
        {/if}
      </div>
    </div>
    <button type="button" class="px-2.5 py-1 rounded-lg text-xs font-bold bg-md-primary text-md-on-primary shrink-0" onclick={(e) => { e.stopPropagation(); onOpenMagicLink(latestMagicLink!.url); }}>{$t('inbox.openMagicLink')}</button>
    <button type="button" class="w-5 h-5 flex items-center justify-center rounded-lg shrink-0" aria-label={$t('common.close')} onclick={() => (showMagicLinkStrip = false)}><Icon name="x" class="w-3 h-3" /></button>
  </div>
</div>
{/if}

<!-- Saved login refill strip -->
{#if matchingSavedLogin && showSavedLoginStrip && currentDomain}
<div class="h-[40px] flex items-center box-border px-3 bg-md-primary-container bottom-strip-item bottom-strip-savedlogin rounded-xl" style="--i: 0.75;">
  <div class="flex items-center gap-2 w-full min-w-0">
    <FaviconImage domain={currentDomain} size={24} class="w-4 h-4 shrink-0" fallbackLetter={currentDomain[0]?.toUpperCase() || '?'} fallbackColor="bg-md-secondary" />
    <div class="min-w-0 flex-1">
      <div class="text-xs font-bold text-md-on-surface truncate">{$t('inbox.savedLoginRefill')}</div>
      <div class="text-xs text-md-on-surface/50 truncate" style="direction:ltr;unicode-bidi:isolate;">{matchingSavedLogin.email || matchingSavedLogin.username || currentDomain}</div>
    </div>
    <button type="button" class="px-2.5 py-1 rounded-lg text-xs font-bold bg-md-primary text-md-on-primary shrink-0" onclick={(e) => { e.stopPropagation(); onRefillSavedLogin(matchingSavedLogin!); }}>{$t('inbox.refillAction')}</button>
    <button type="button" class="w-5 h-5 flex items-center justify-center rounded-lg shrink-0" aria-label={$t('common.close')} onclick={() => (showSavedLoginStrip = false)}><Icon name="x" class="w-3 h-3" /></button>
  </div>
</div>
{/if}

{#if formDetected && showAutofillStrip && !preferHideAutofillStrip}
<div class="h-[40px] flex items-center box-border px-3 bg-md-primary-container bottom-strip-item bottom-strip-autofill rounded-xl" style="--i: 1;">  
  <div class="flex items-center gap-2 w-full">
    <!-- Favicon + Domain -->
    <div class="flex items-center gap-2 min-w-0">
      <div class="flex-shrink-0 w-7 h-7 rounded-lg bg-md-secondary-container flex items-center justify-center overflow-hidden">
        {#if currentDomain}
          <FaviconImage domain={currentDomain} size={24} class="w-4 h-4" fallbackLetter={currentDomain[0].toUpperCase()} fallbackColor="bg-md-secondary" />
        {:else}
          <Icon name="globe" class="w-4 h-4 opacity-40" />
        {/if}
      </div>
      <div class="min-w-0">
        <div class="text-xs font-bold text-md-secondary leading-tight truncate max-w-[80px]">{currentDomain || $t('common.unknown')}</div>
        <div class="text-xs font-semibold uppercase tracking-wider text-md-tertiary leading-tight">{$t('inbox.detectedForm')}</div>
      </div>
    </div>

    <!-- Divider -->
    <div class="w-px h-6 bg-md-secondary-container flex-shrink-0 mx-1"></div>

    <!-- Identity Selector -->
    <div class="relative flex-1 min-w-0">
      <div 
        id="button-identity-selector"
        class="flex items-center gap-1 bg-md-secondary-container/70 rounded-full px-2.5 py-1 cursor-pointer relative" 
        role="button"
        tabindex="0"
        onclick={() => showIdentityDropdown = !showIdentityDropdown}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            showIdentityDropdown = !showIdentityDropdown;
          }
        }}
      >
        <Icon name="shield" class="w-3 h-3 text-md-secondary flex-shrink-0" />
        <div class="flex-1 min-w-0 text-label-sm font-medium text-md-on-surface pe-2 truncate">
          {identities.find(i => i.id === selectedIdentityId)?.name || $t('identities.select')}
        </div>
        <Icon name="chevronDown" class="w-2.5 h-2.5 text-md-on-surface/40 flex-shrink-0 transition-transform {showIdentityDropdown ? 'rotate-180' : ''}" />
        
        <!-- Dropup Menu -->
        {#if showIdentityDropdown}
          <div class="absolute bottom-full inset-x-0 mb-1 bg-md-primary-container border border-md-secondary-container rounded-xl shadow-lg z-50 max-h-48 overflow-y-auto">
            {#each identities as identity}
              <button
                id="button-identity-{identity.id}"
                class="w-full text-start px-3 py-2 text-label-sm font-medium text-md-on-surface hover:bg-md-secondary-container transition-colors first:rounded-t-xl last:rounded-b-xl"
                onclick={(e) => { e.stopPropagation(); selectedIdentityId = identity.id; handleIdentityChange(); showIdentityDropdown = false; }}
              >
                {identity.name}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <!-- Autofill Button -->
    <button id="button-autofill" class="px-3 py-1 rounded-full text-label-sm font-semibold rounded-lg bg-md-primary text-md-on-primary hover:bg-md-primary/90 flex-shrink-0 transition-colors" onclick={onAutofillForm}>
      {$t('inbox.autofillAction')}
    </button>

    <!-- Close Button -->
    <button id="button-close-autofill" class="w-5 h-5 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-secondary-container flex-shrink-0 ms-0.5 transition-colors" onclick={() => showAutofillStrip = false} aria-label={$t('inbox.closeAutofillStrip')}>
      <Icon name="x" class="w-3 h-3" />
    </button>
  </div>
</div>
{/if}
{#if stripOtpCode !== '------' && latestLiveOtp && !preferHideOtpStrip}
<div
  id="button-otp-strip"
  class="bottom-strip-item bottom-strip-otp rounded-xl cursor-pointer"
  style="--i: 2; overflow: hidden;"
  role="button"
  tabindex="0"
  aria-label={$t('inbox.openOtpMessage')}
  onclick={() => { if (latestOtpEmail) { const thread = threadGrouping ? emailThreads.find((t: EmailThread) => t.emails.some((e: Email) => e.id === latestOtpEmail.id)) : null; onOpenMessageDetail(thread ? thread.emails : [latestOtpEmail]); } }}
  onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { if (latestOtpEmail) { const thread = threadGrouping ? emailThreads.find((t: EmailThread) => t.emails.some((e: Email) => e.id === latestOtpEmail.id)) : null; onOpenMessageDetail(thread ? thread.emails : [latestOtpEmail]); } } }}
>  
  {#if !otpCollapsed}
  {#if otpDropupOpen}
  <div class="border-b border-md-primary bg-md-secondary-container">

    <!-- Clear all OTPs and Opt-in toggle -->
    <div class="px-3 pt-3 pb-1.5 flex items-center justify-between border-b border-md-primary/10">
      <div onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="presentation">
        <label class="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={isOtpOptedIn}
            onchange={toggleOtpOptIn}
            class="accent-md-primary w-3.5 h-3.5"
          />
          <span class="text-xs font-semibold text-md-on-surface">{$t('inbox.allowOtpAutofill')}</span>
        </label>
      </div>

      <button
        class="text-xs font-semibold text-md-error/70 hover:text-md-error transition-colors flex items-center gap-1"
        onclick={(e) => { e.stopPropagation(); clearAllOtps(); }}
        aria-label={$t('inbox.clearAllOtps')}
      >
        <Icon name="trashBox" class="w-3 h-3" />
        {$t('inbox.clearAllOtps')}
      </button>
    </div>

    <!-- Section: Current email address -->
    <div class="px-3 pt-2.5 pb-1 flex items-center justify-between">
      <span class="text-xs font-bold tracking-widest uppercase text-md-primary">{$t('inbox.currentEmail')}</span>
      <Icon name="chevronDown" class="w-3.5 h-3.5 text-md-on-surface/40" />
    </div>
    <div class="overflow-y-auto max-h-[180px]">
      {#if otpHistoryCurrent.length === 0}
        <p class="text-xs text-md-on-surface/40 px-3 pb-2">{$t('inbox.noOtps')}</p>
      {:else}
        {#each otpHistoryCurrent as item}
          <div class="flex items-center gap-3 px-3 py-2 bg-md-surface-container rounded-xl mx-2 mb-2 shadow-sm">
            <div class="w-9 h-9 rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0 bg-md-secondary-container">
              {#if item.from}
                <img
                  src={getDomainFaviconUrl(item.from)}
                  alt=""
                  class="w-6 h-6 object-contain"
                  loading="lazy"
                  onerror={(e) => {
                    const img = e.target as HTMLImageElement;
                    const fb = getRootDomainFaviconUrl(item.from);
                    if (img.src !== fb) { img.src = fb; } else { img.style.display = 'none'; }
                  }}
                />
              {/if}
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5">
                <span class="text-sm font-semibold text-md-on-surface truncate">{item.from_name || item.from}</span>
                <span class="text-xs text-md-on-surface/40">·</span>
                <span class="text-xs text-md-on-surface/40 flex-shrink-0">{timeAgo(item.received_at)}</span>
              </div>
              <span class="font-bold text-md-primary text-sm tracking-[0.08em]">{item.otp}</span>
            </div>
            <button
              id="button-copy-otp-current-{item.otp}"
              class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-md-secondary-container"
              aria-label={$t('common.copy')}
              title={$t('common.copy')}
              onclick={async (e) => {
                e.stopPropagation();
                try {
                  await copyToClipboardAndSchedulePurge(item.otp, 30000);
                } catch (e) {
                  logError('Failed to copy OTP from current list', undefined, e instanceof Error ? e : new Error(String(e)));
                }
              }}
            >
              <Icon name="copy" class="w-3.5 h-3.5 text-md-primary" />
            </button>
          </div>
        {/each}
      {/if}
    </div>

    <!-- Section: Other email addresses -->
    {#if otpHistoryOther.length > 0}
    <div class="px-3 pt-1 pb-1 flex items-center justify-between border-t border-md-secondary-container">
      <span class="text-xs font-bold tracking-widest uppercase text-md-primary">{$t('inbox.otherEmails')}</span>
      <Icon name="chevronDown" class="w-3.5 h-3.5 text-md-on-surface/40" />
    </div>
    <div class="overflow-y-auto max-h-[180px]">
      {#each otpHistoryOther as item}
        <div class="flex items-center gap-3 px-3 py-2 bg-md-surface-container rounded-xl mx-2 mb-2 shadow-sm">
          <div class="w-9 h-9 rounded-xl overflow-hidden flex items-center justify-center flex-shrink-0 bg-md-secondary-container">
            {#if item.from}
              <img
                src={getDomainFaviconUrl(item.from)}
                alt=""
                class="w-6 h-6 object-contain"
                loading="lazy"
                onerror={(e) => {
                  const img = e.target as HTMLImageElement;
                  const fb = getRootDomainFaviconUrl(item.from);
                  if (img.src !== fb) { img.src = fb; } else { img.style.display = 'none'; }
                }}
              />
            {/if}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="text-sm font-semibold text-md-on-surface truncate">{item.from_name || item.from}</span>
              <span class="text-xs text-md-on-surface/40">·</span>
              <span class="text-xs text-md-on-surface/40 flex-shrink-0">{timeAgo(item.received_at)}</span>
            </div>
            <span class="font-bold text-md-primary text-sm tracking-[0.08em]">{item.otp}</span>
          </div>
          <button
            id="button-copy-otp-other-{item.otp}"
            class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-md-secondary-container"
            aria-label={$t('common.copy')}
            title={$t('common.copy')}
            onclick={async (e) => {
              e.stopPropagation();
              try {
                await copyToClipboardAndSchedulePurge(item.otp, 30000);
              } catch (e) {
                logError('Failed to copy OTP from other list', undefined, e instanceof Error ? e : new Error(String(e)));
              }
            }}
          >
            <Icon name="copy" class="w-3.5 h-3.5 text-md-primary" />
          </button>
        </div>
      {/each}
    </div>
    {/if}

  </div>
  {/if}

  <div
    class="flex items-center gap-2 px-3 py-1.5 bg-md-secondary-container rounded-xl min-h-[48px]"
    role="status"
    aria-live="polite"
    aria-atomic="true"
  >

    <!-- Favicon + Domain + Received OTP + expiry -->
    <div class="flex items-center gap-2 min-w-0">
      <div class="flex-shrink-0 w-7 h-7 rounded-lg bg-white flex items-center justify-center overflow-hidden">
        {#if otpSenderEmail}
          <FaviconImage email={otpSenderEmail} size={24} class="w-4 h-4" fallbackLetter={(otpSenderEmail[0] || '?').toUpperCase()} fallbackColor="bg-md-primary" />
        {/if}
      </div>
      <div class="min-w-0">
        <div class="text-xs font-bold text-md-on-surface leading-tight truncate max-w-[120px]">{latestOtpSenderName || otpSenderEmail?.split('@')[0] || $t('inbox.otpLabel')}</div>
        <div class="text-xs font-semibold text-md-on-surface/50 leading-tight">
          {$t('inbox.receivedOtp', { values: { when: otpContext.split(' | ').pop() || $t('activity.timeJustNow') } })}
        </div>
        <div
          class="text-xs font-semibold leading-tight
            {stripOtpRemaining && stripOtpRemaining !== 'expired'
              ? 'text-md-primary'
              : stripOtpRemaining === 'expired'
                ? 'text-md-error'
                : 'text-md-on-surface/40'}"
        >
          {#if stripOtpRemaining && stripOtpRemaining !== 'expired'}
            {$t('inbox.otpExpiresIn', { values: { t: stripOtpRemaining } })}
          {:else if stripOtpRemaining === 'expired'}
            {$t('inbox.expiredLabel')}
          {:else}
            {$t('inbox.otpExpiryUnknown')}
          {/if}
        </div>
      </div>
    </div>

    <!-- Divider -->
    <div class="w-px h-6 bg-md-secondary-container flex-shrink-0 mx-1"></div>

    <!-- Current OTP with Copy -->
    <div class="flex-1 flex items-center justify-center">
      <button
        id="button-copy-current-otp"
        class="px-3 py-1 rounded-full text-label-sm font-semibold rounded-lg bg-md-primary text-md-on-primary hover:bg-md-primary/90 flex-shrink-0 flex items-center gap-1.5 transition-colors"
        aria-label={$t('inbox.copyOtpAria')}
        title={$t('inbox.copyOtpAria')}
        onclick={(e) => { e.stopPropagation(); onCopyOtp(); }}
      >
        <span class="font-bold text-sm tracking-[0.05em]">{stripOtpCode.replace(/\s/g, '')}</span>
        <Icon name="copy" class="w-3 h-3 text-white/80 flex-shrink-0" />
      </button>
    </div>

    <!-- Up/Down Buttons -->
    <div class="flex items-center gap-1 flex-shrink-0 ms-0.5">
      <button
        class="w-5 h-5 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-secondary-container transition-colors"
        aria-label={otpDropupOpen ? "Collapse OTP history" : "Expand OTP history"}
        onclick={(e) => { e.stopPropagation(); toggleOtpDropup(); }}
      >
        {#if otpDropupOpen}
          <Icon name="chevronUp" class="w-3 h-3" />
        {:else}
          <Icon name="chevronDown" class="w-3 h-3" />
        {/if}
      </button>
      <button
        class="w-5 h-5 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-secondary-container transition-colors"
        aria-label={$t('inbox.collapseOtpAria')}
        title={$t('inbox.collapseOtpAria')}
        onclick={(e) => { e.stopPropagation(); otpCollapsed = true; }}
      >
        <Icon name="chevronUp" class="w-3 h-3" />
      </button>
    </div>

  </div>
  {:else}
  <button
    class="w-full flex items-center justify-between px-3 py-1.5 text-xs font-medium text-md-primary/70 hover:text-md-primary transition-colors bg-md-secondary-container"
    onclick={(e) => { e.stopPropagation(); otpCollapsed = false; }}
    aria-label={$t('inbox.showOtpBar')}
    title={$t('inbox.showOtpBar')}
  >
    <span>{$t('inbox.otpReady', { values: { code: stripOtpCode } })}</span>
    <Icon name="chevronDown" class="w-3.5 h-3.5" />
  </button>
  {/if}
</div>
{/if}
{#if showRenewalStrip || (providerFailoverHint?.show && currentAccount?.autoExtend && isCurrentAccountExpired)}
<div
  id="button-renewal-strip"
  class="bottom-strip-item bottom-strip-renewal rounded-xl"
  style="--i: 3; overflow: hidden;"
>
  {#if !renewalStripCollapsed}
  <div class="flex flex-col gap-2 px-3 py-2.5 bg-md-primary-container border border-md-warning/40 rounded-xl">
    <!-- Header: icon + title + dismiss -->
    <div class="flex items-center gap-2">
      <div class="flex-shrink-0 w-7 h-7 rounded-lg bg-md-warning/20 flex items-center justify-center">
        <Icon name="refresh" class="w-4 h-4 text-md-warning {isRenewing ? 'animate-spin' : ''}" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-xs font-bold text-md-on-surface leading-tight">
          {#if providerFailoverHint?.show && currentAccount?.autoExtend}
            {$t('inbox.renewalStrip.retryTitle')}
          {:else if lifecycleHints[0]?.kind === 'renew_high_value' && lifecycleHints[0]?.inboxId === currentAccount?.id}
            {$t(lifecycleHints[0].reasonKey, { values: { address: lifecycleHints[0].address } })}
          {:else}
            {$t('inbox.renewalStrip.title')}
          {/if}
        </div>
        <div class="text-xs text-md-on-surface/60 leading-tight truncate">
          {#if isRenewing}
            {$t('inbox.renewalStrip.renewing')}
          {:else if providerFailoverHint?.show && currentAccount?.autoExtend}
            {$t('inbox.renewalStrip.retryIn', {
              values: {
                min: Math.max(1, Math.ceil((providerFailoverHint.nextRetryAt - Date.now()) / 60000)),
              },
            })}
          {:else}
            {$t('inbox.renewalStrip.prompt')}
          {/if}
        </div>
      </div>
      <button
        id="button-renewal-dismiss"
        class="w-5 h-5 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-secondary-container flex-shrink-0 transition-colors disabled:opacity-40"
        aria-label={$t('inbox.renewalStrip.dismissAria')}
        disabled={isRenewing}
        onclick={(e) => { e.stopPropagation(); renewalStripDismissed = true; }}
      >
        <Icon name="x" class="w-3 h-3" />
      </button>
    </div>
    <!-- Action row: renew options -->
    <div class="flex items-center gap-1.5">
      <button
        id="button-renewal-always"
        class="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-label-sm font-semibold bg-md-primary text-md-on-primary hover:bg-md-primary/90 transition-colors disabled:opacity-60"
        title={$t('inbox.renewalStrip.alwaysDescription')}
        disabled={isRenewing}
        onclick={(e) => {
          e.stopPropagation();
          void handleRenewAlways();
        }}
      >
        <Icon name="refresh" class="w-3 h-3 {isRenewing ? 'animate-spin' : ''}" />
        {isRenewing ? $t('inbox.renewalStrip.renewing') : $t('inbox.renewalStrip.always')}
      </button>
      <button
        id="button-renewal-once"
        class="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-label-sm font-semibold bg-md-secondary-container text-md-on-surface hover:bg-md-secondary-container/80 transition-colors disabled:opacity-60"
        title={$t('inbox.renewalStrip.onceDescription')}
        disabled={isRenewing}
        onclick={(e) => {
          e.stopPropagation();
          void handleRenewOnce();
        }}
      >
        {isRenewing ? $t('inbox.renewalStrip.renewing') : $t('inbox.renewalStrip.once')}
      </button>
      <button
        id="button-renewal-no"
        class="px-2.5 py-1.5 rounded-lg text-label-sm font-semibold bg-transparent text-md-on-surface/60 hover:bg-md-secondary-container hover:text-md-on-surface transition-colors disabled:opacity-40"
        disabled={isRenewing}
        onclick={(e) => { e.stopPropagation(); renewalStripDismissed = true; }}
      >
        {$t('inbox.renewalStrip.dismiss')}
      </button>
    </div>
    {#if providerFailoverHint?.show && providerFailoverHint.otherProvidersOk}
      <button
        type="button"
        class="w-full py-1.5 rounded-lg text-label-sm font-semibold bg-md-tertiary-container text-md-on-tertiary-container hover:opacity-90 transition-opacity"
        onclick={(e) => {
          e.stopPropagation();
          onCreateInbox();
        }}
      >
        {$t('toasts.createWithOtherProvider')}
      </button>
    {/if}
  </div>
  {:else}
  <button
    class="w-full flex items-center justify-between px-3 py-1.5 text-xs font-medium text-md-warning/70 hover:text-md-warning transition-colors bg-md-primary-container"
    onclick={(e) => { e.stopPropagation(); renewalStripCollapsed = false; }}
    aria-label={$t('inbox.showRenewalBar')}
    title={$t('inbox.showRenewalBar')}
  >
    <span>{$t('inbox.renewalStrip.title')} · {$t('inbox.renewalStrip.prompt')}</span>
    <Icon name="chevronDown" class="w-3.5 h-3.5" />
  </button>
  {/if}
</div>
{/if}
{/if}
</div>
<!-- end bottom-strips-wrapper -->
{/if}

<!-- Tag Dialog -->
<TagDialog
  open={tagDialogOpen}
  currentTag={tagTargetAccount?.tag || null}
  currentTagColor={tagTargetAccount?.tagColor || null}
  existingTags={existingTags}
  tagColors={tagColors}
  onClose={closeTagDialog}
  onSave={saveTag}
/>
</div>

<style>
  /*
   * Matches example exactly (ul/li pattern).
   * DOM: autofill=1st child (top), otp=2nd child (middle), renewal=3rd child (bottom).
   * CSS `order` swaps visually: front strip → highest order (bottom=screen bottom, in front).
   *                              back strip  → lower order (peeks above front).
   *
    * When `has-renewal` is set on the wrapper, the renewal strip is LOCKED to order:3
    * (always front) regardless of frontStrip. autofill and otp shift down one slot.
    */

  /* Android-style vertical edge handle (LEFT of strip stack) — horizontal drag only */
  .strips-edge-handle {
    width: 18px;
    min-height: 32px;
    padding: 0;
    border: none;
    background: transparent;
    cursor: ew-resize;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    touch-action: pan-x;
    transition: transform 120ms cubic-bezier(0.2, 0, 0, 1);
  }
  .strips-edge-handle:active {
    cursor: grabbing;
  }
  .strips-edge-handle-pill {
    width: 5px;
    min-height: 24px;
    border-radius: 0 999px 999px 0;
    background: color-mix(in srgb, var(--md-on-surface) 35%, transparent);
    border: 1px solid color-mix(in srgb, var(--md-outline-variant) 60%, transparent);
    border-inline-start: none;
    box-shadow: 2px 0 8px color-mix(in srgb, var(--md-shadow, #000) 18%, transparent);
    transition: background 0.15s ease, width 0.15s ease;
  }
  .strips-edge-handle:hover .strips-edge-handle-pill,
  .strips-edge-handle:focus-visible .strips-edge-handle-pill {
    background: var(--md-primary);
    width: 6px;
  }
  .strips-edge-handle:focus-visible {
    outline: none;
  }

  :global(.bottom-strips-wrapper) {
    position: absolute;
    /* Sit flush above floating footer (footer-safe already reserved on parent) */
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    width: min(350px, 100%);
    display: flex;
    flex-direction: column;
    gap: 0;
    perspective: 500px;
    transform-style: preserve-3d;
    transition: gap 500ms;
    /* Seamless with floating nav — no extra visual gap */
    margin-bottom: 0;
  }

  :global(.bottom-strips-wrapper:hover) {
    gap: 5px;
  }

  :global(.bottom-strip-item) {
    position: relative;
    list-style: none;
    transition: transform 500ms, opacity 500ms, width 500ms;
    transition-delay: calc(var(--i, 1) * 50ms);
  }

  /* ── No renewal: existing 2-strip swap rules ── */
  /* autofill front: autofill→order:2, otp→order:1 */
  :global(.bottom-strips-wrapper.front-autofill:not(.has-renewal) .bottom-strip-autofill) {
    order: 2;
    transform: translateZ(0) translateY(0);
    opacity: 1;
    width: 350px;
  }
  :global(.bottom-strips-wrapper.front-autofill:not(.has-renewal) .bottom-strip-otp) {
    order: 1;
    transform: translateZ(0) translateY(5px);
    opacity: 0.95;
    width: 340px;
    margin: 0 auto;
  }

  /* otp front: otp→order:2, autofill→order:1 */
  :global(.bottom-strips-wrapper.front-otp:not(.has-renewal) .bottom-strip-otp) {
    order: 2;
    transform: translateZ(0) translateY(0);
    opacity: 1;
    width: 350px;
  }
  :global(.bottom-strips-wrapper.front-otp:not(.has-renewal) .bottom-strip-autofill) {
    order: 1;
    transform: translateZ(0) translateY(5px);
    opacity: 0.95;
    width: 340px;
    margin: 0 auto;
  }

  /* ── Renewal present: renewal LOCKED to order:3 (always front) ── */
  :global(.bottom-strips-wrapper.has-renewal .bottom-strip-renewal) {
    order: 3;
    transform: translateZ(0) translateY(0);
    opacity: 1;
    width: 350px;
  }
  :global(.bottom-strips-wrapper.has-renewal .bottom-strip-autofill) {
    order: 2;
    transform: translateZ(0) translateY(5px);
    opacity: 0.95;
    width: 340px;
    margin: 0 auto;
  }
  :global(.bottom-strips-wrapper.has-renewal .bottom-strip-otp) {
    order: 1;
    transform: translateZ(0) translateY(5px);
    opacity: 0.95;
    width: 340px;
    margin: 0 auto;
  }

  /* ── hover: fan out all strips flat, full opacity, natural positions ── */
  :global(.bottom-strips-wrapper:hover .bottom-strip-item) {
    opacity: 1;
    transform: translateZ(0) translateY(0);
    width: 350px;
    margin: 0 auto;
  }

  /* Selection strip: 2× height, front strip */
  :global(.bottom-strips-wrapper.has-selection .bottom-strip-selection) {
    order: 2;
    transform: translateZ(0) translateY(0);
    opacity: 1;
    width: 350px;
  }
  :global(.bottom-strips-wrapper.has-selection) {
    /* Lift slightly so the taller strip doesn’t sit under the footer */
    bottom: 0;
  }
</style>
