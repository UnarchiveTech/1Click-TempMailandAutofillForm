<script lang="ts">
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
import TagPill from '@/components/ui/TagPill.svelte';
import {
  getSelectedIdentity,
  loadIdentities,
  selectIdentity,
} from '@/features/identities/identity-actions.js';
import {
  DEFAULT_PROVIDER,
  loadAllProviderConfigs,
  loadProviderConfig,
} from '@/utils/email-service.js';
import type { EmailThread } from '@/utils/email-threads.js';
import { groupEmailsByThread } from '@/utils/email-threads.js';
import { getDomainFaviconUrl, getRootDomainFaviconUrl } from '@/utils/favicon.js';
import { logError } from '@/utils/logger.js';
import { timeAgo } from '@/utils/time.js';
import { useCurrentTime } from '@/utils/time-store.js';
import type { Account, Email, Identity, SavedSearchFilter } from '@/utils/types.js';

let otpCollapsed = $state(false);
let otpDropupOpen = $state(false);

// Renewal strip state — session-only dismissal. Re-appears on reload.
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
let currentDomain = $state<string>('');
let showIdentityDropdown = $state(false);

// Track which bottom strip should be in front: 'autofill' or 'otp'
let frontStrip = $state<'autofill' | 'otp'>('autofill');

// Track previous values to detect actual changes — plain let, NOT $state,
// so mutations inside $effect don't re-trigger the effect.
let _prevFormDetected = false;
let _prevLatestOtp = '------';

// React to prop changes: formDetected change → autofill front; new OTP → otp front.
// "Last changed wins" — visiting a site always overrides a prior OTP.
$effect(() => {
  // Read reactive props (tracked by Svelte)
  const fd = formDetected;
  const otp = latestOtp;

  // Read prev-values (NOT tracked — plain let)
  const formJustDetected = fd && !_prevFormDetected;
  const newOtpArrived = otp !== '------' && otp !== _prevLatestOtp;

  if (formJustDetected) {
    // Visiting a site always brings autofill to front, regardless of OTP
    frontStrip = 'autofill';
  } else if (newOtpArrived) {
    // New OTP arrived (and no simultaneous form detection)
    frontStrip = 'otp';
  }

  // Update prev values (not $state — no reactivity triggered)
  _prevFormDetected = fd;
  _prevLatestOtp = otp;
});

// Load all providers dynamically from config
let allProviders = $derived.by(() => loadAllProviderConfigs());

async function loadOtpHistory() {
  try {
    const { storedEmails = {} } = (await browser.storage.local.get(['storedEmails'])) as {
      storedEmails?: Record<string, Email[]>;
    };
    const current: OtpHistoryItem[] = [];
    const other: OtpHistoryItem[] = [];
    for (const [addr, msgs] of Object.entries(storedEmails)) {
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
        if (addr === selectedEmail) {
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
  try {
    const { storedEmails = {} } = (await browser.storage.local.get(['storedEmails'])) as {
      storedEmails?: Record<string, Email[]>;
    };
    for (const msgs of Object.values(storedEmails)) {
      for (const m of msgs) {
        m.otp = undefined;
      }
    }
    await browser.storage.local.set({ storedEmails });
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

function getRootDomain(domain: string): string {
  const parts = domain.split('.');
  return parts.length > 2 ? parts.slice(-2).join('.') : domain;
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

function formatOtp(otp: string): string {
  const clean = otp.replace(/\s/g, '');
  if (clean.length === 6) return `${clean.slice(0, 3)} ${clean.slice(3)}`;
  if (clean.length === 8) return `${clean.slice(0, 4)} ${clean.slice(4)}`;
  return otp;
}

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
  latestOtp = '------',
  latestOtpSender = '',
  latestOtpSenderName = '',
  otpContext = '',
  formDetected = false,
  savedSearchFilters = [],
  onSelectAccount = () => {},
  onCopyEmail = () => {},
  onOpenQrDialog = () => {},
  onCreateInbox = () => {},
  onAutofillForm = () => {},
  onRefreshInbox = async () => {},
  onToggleNotifications = () => {},
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
  showToast = (_message: string) => {},
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
  latestOtp?: string;
  latestOtpSender?: string;
  latestOtpSenderName?: string;
  otpContext?: string;
  formDetected?: boolean;
  savedSearchFilters?: SavedSearchFilter[];
  onSelectAccount?: (email: string) => void;
  onCopyEmail?: () => void;
  onOpenQrDialog?: () => void;
  onCreateInbox?: (provider?: string, instanceId?: string) => void;
  onAutofillForm?: () => void;
  onRefreshInbox?: () => Promise<void>;
  onToggleNotifications?: () => void;
  onArchiveAccount?: (account: Account) => void;
  onUnarchiveAccount?: (account: Account) => void;
  onRemoveAccount?: (address: string) => void;
  onRestoreAccount?: (address: string) => void;
  onReloadAccounts?: () => Promise<void>;
  onEditAccount?: (account: Account) => void;
  onToggleAutoExtend?: (account: Account) => void;
  onExtendAccount?: (account: Account) => void;
  onOpenMessageDetail?: (message: Email) => void;
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
  showToast?: (message: string) => void;
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

let otpSenderEmail = $derived(
  emails
    .filter((e: Email) => e.otp && e.from)
    .sort((a: Email, b: Email) => b.received_at - a.received_at)[0]?.from ?? latestOtpSender
);

let latestOtpEmail = $derived(
  emails
    .filter((e: Email) => e.otp && e.from)
    .sort((a: Email, b: Email) => b.received_at - a.received_at)[0] ?? null
);

// Tag editing state
let tagDialogOpen = $state(false);
let actionRowCollapsed = $state(false);
let actionRowCollapsedInitialized = $state(false);
let accountSelectorHovered = $state(false);
let actionRowHovered = $state(false);
let searchBarFocused = $state(false);
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

// Watch for changes and save to storage
$effect(() => {
  if (actionRowCollapsedInitialized) {
    saveActionRowCollapsedState();
  }
});

// Lazy loading state
let displayedEmailCount = $state(20);
const BATCH_SIZE = 20;

// Thread grouping state
let threadGrouping = $state(false);
let expandedThreadIds = $state<Set<string>>(new Set());

// Email list filter tab (Inbox / Archived / Deleted / All mails)
type EmailListTab = 'inbox' | 'archived' | 'deleted' | 'all';
let emailListTab = $state<EmailListTab>('inbox');

let tabCounts = $derived.by(
  (): Record<EmailListTab, number> => ({
    inbox: filteredEmails.filter((e: Email) => !e.local_archived && !e.local_deleted).length,
    archived: filteredEmails.filter((e: Email) => e.local_archived && !e.local_deleted).length,
    deleted: filteredEmails.filter((e: Email) => !!e.local_deleted).length,
    all: filteredEmails.length,
  })
);

let tabFilteredEmails = $derived.by((): Email[] => {
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

// Load more emails when scrolling near bottom
function loadMoreEmails() {
  if (displayedEmailCount < tabFilteredEmails.length) {
    displayedEmailCount = Math.min(displayedEmailCount + BATCH_SIZE, tabFilteredEmails.length);
  }
}

// Reactive derived value for current account
let currentAccount = $derived.by(() => {
  if (!selectedEmail) return null;
  return allAccounts.find((a: Account) => a.address === selectedEmail) || null;
});

// Container background class based on account status
let containerBgClass = $derived.by(() => {
  if (!currentAccount) return 'bg-md-primary-container';
  if (currentAccount.accountStatus === 'deleted') return 'bg-md-error-container';
  if (currentAccount.accountStatus === 'archived') return 'bg-md-tertiary-container';
  return 'bg-md-primary-container';
});

// Button text based on collapse state and temporary expansion
let buttonText = $derived.by(() => {
  const isTemporarilyExpanded = actionRowCollapsed && (accountSelectorHovered || actionRowHovered);
  const isTemporarilyHidden = !actionRowCollapsed && searchBarFocused;
  if (isTemporarilyExpanded) return 'Temporary Expanded';
  if (isTemporarilyHidden) return 'Temporary Hidden';
  return actionRowCollapsed ? 'Show' : 'Hide';
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
// account is currently expired AND auto-renew is NOT enabled.
// (If auto-renew were enabled, the address would not have expired.)
const renewalStripEligible = $derived(
  supportsAutoRenew && isCurrentAccountExpired && !(currentAccount?.autoExtend ?? false)
);

// Reset dismissal when the account changes (so a different expired inbox shows the strip again)
let _lastRenewalAddress = $state<string | null>(null);
$effect(() => {
  const addr = currentAccount?.address ?? null;
  if (addr !== _lastRenewalAddress) {
    _lastRenewalAddress = addr;
    renewalStripDismissed = false;
  }
});

// Final show flag = eligible AND not dismissed
const showRenewalStrip = $derived(renewalStripEligible && !renewalStripDismissed);

// Auto-renew is now enabled → strip should disappear (the address will renew itself)
$effect(() => {
  if (currentAccount?.autoExtend && renewalStripEligible === false) {
    renewalStripDismissed = true;
  }
});

// Tag functions
async function updateTag(accountId: string, tag: string, color?: string) {
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

<div class="relative flex flex-col h-full overflow-visible">
<div
  class="relative {containerBgClass} rounded-2xl p-2 mt-[7.5px] mb-[7.5px] overflow-visible"
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
  {showToast}
  {selectedProviderInstance}
/>
</div>

<!-- Action row: Copy Email, QR, New Address, Refresh, Notifications -->
{#if !searchBarFocused && (!actionRowCollapsed || accountSelectorHovered || actionRowHovered)}
<div
  class="flex items-center gap-1.5 pt-2 pb-2 mx-auto transition-all duration-300 ease-in-out"
  style="opacity: {actionRowCollapsed && !accountSelectorHovered && !actionRowHovered ? '0' : '1'}; transform: {actionRowCollapsed && !accountSelectorHovered && !actionRowHovered ? 'translateY(-10px)' : 'translateY(0)'};"
  onmouseenter={() => { actionRowHovered = true; }}
  onmouseleave={() => { actionRowHovered = false; }}
  role="none"
>
  <!-- Copy Email -->
  <button
    id="button-copy-email"
    class="btn-primary flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded-xl font-bold text-[11px] tracking-wide transition-colors shadow-sm"
    aria-label="Copy email address"
    onclick={onCopyEmail}
  >
    <span class="btn-icon flex items-center justify-center w-5 h-5 rounded-full shrink-0">
      <Icon name="copy" class="w-3.5 h-3.5" />
    </span>
    <span class="leading-tight self-center">{$t('common.copy')}</span>
  </button>

  <!-- QR Code -->
  <button
    id="button-qr-code"
    class="btn-secondary flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded-xl font-bold text-[11px] tracking-wide transition-colors shadow-sm"
    aria-label="Show QR code"
    onclick={onOpenQrDialog}
  >
    <span class="btn-icon flex items-center justify-center w-5 h-5 rounded-full shrink-0">
      <Icon name="qr" class="w-3.5 h-3.5" />
    </span>
    <span class="leading-tight self-center">QR</span>
  </button>

  <!-- Archive/Unarchive -->
  {#if currentAccount}
    {#if currentAccount.accountStatus === 'archived'}
      <button
        id="button-unarchive"
        class="btn-tertiary flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded-xl font-bold text-[11px] tracking-wide transition-colors shadow-sm"
        aria-label="Unarchive email"
        onclick={() => onUnarchiveAccount(currentAccount)}
      >
        <span class="btn-icon flex items-center justify-center w-5 h-5 rounded-full shrink-0">
          <Icon name="archive" class="w-3.5 h-3.5" />
        </span>
        <span class="leading-tight self-center">{$t('common.unarchive')}</span>
      </button>
    {:else}
      <button
        id="button-archive"
        class="btn-tertiary flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded-xl font-bold text-[11px] tracking-wide transition-colors shadow-sm"
        aria-label="Archive email"
        onclick={() => onArchiveAccount(currentAccount)}
      >
        <span class="btn-icon flex items-center justify-center w-5 h-5 rounded-full shrink-0">
          <Icon name="archive" class="w-3.5 h-3.5" />
        </span>
        <span class="leading-tight self-center">{$t('common.archive')}</span>
      </button>
    {/if}

    <!-- Forget Me / Restore -->
    {#if currentAccount.accountStatus === 'deleted'}
      <button
        id="button-restore"
        class="btn-error flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded-xl font-bold text-[11px] tracking-wide transition-colors shadow-sm"
        aria-label="Restore email address"
        onclick={() => onRestoreAccount(currentAccount.address)}
      >
        <span class="btn-icon flex items-center justify-center w-5 h-5 rounded-full shrink-0">
          <Icon name="back" class="w-3.5 h-3.5" />
        </span>
        <span class="leading-tight self-center">{$t('common.restore')}</span>
      </button>
    {:else}
      <button
        id="button-delete"
        class="btn-error flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded-xl font-bold text-[11px] tracking-wide transition-colors shadow-sm"
        aria-label="Delete email address"
        onclick={() => onRemoveAccount(currentAccount.address)}
      >
        <span class="btn-icon flex items-center justify-center w-5 h-5 rounded-full shrink-0">
          <Icon name="trash" class="w-3.5 h-3.5" />
        </span>
        <span class="leading-tight self-center">{$t('common.delete')}</span>
      </button>
    {/if}
  {/if}

</div>
{/if}

    <!-- Collapsible action row (auto-renew toggle + tag pill) -->
    {#if currentAccount && !searchBarFocused && (!actionRowCollapsed || accountSelectorHovered || actionRowHovered)}
      <div
        class="transition-all duration-300 ease-in-out"
        style="opacity: {actionRowCollapsed && !accountSelectorHovered && !actionRowHovered ? '0' : '1'}; transform: {actionRowCollapsed && !accountSelectorHovered && !actionRowHovered ? 'translateY(-10px)' : 'translateY(0)'};"
        onmouseenter={() => { actionRowHovered = true; }}
        onmouseleave={() => { actionRowHovered = false; }}
        role="none"
      >
        <div class="flex items-center gap-2">
          <!-- Auto-renew pill toggle -->
          {#if supportsAutoRenew && currentAccount.expiresAt}
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

    <!-- Hide/Show toggle button at bottom-right corner -->
    <button
      id="button-collapse-toggle"
      class="absolute bottom-0 right-0 z-10 flex items-center gap-1 px-1 py-0.5 rounded-full shadow-sm hover:shadow-md hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer bg-md-primary border border-md-primary"
      onclick={() => { actionRowCollapsed = !actionRowCollapsed; }}
      onmouseenter={() => { accountSelectorHovered = false; actionRowHovered = false; }}
      onmouseleave={() => {}}
      aria-label={actionRowCollapsed ? 'Expand action row' : 'Collapse action row'}
    >
      <Icon name="chevronUp" class="w-3 h-3 transition-transform duration-200 text-md-on-primary {actionRowCollapsed || searchBarFocused ? 'rotate-180' : ''}" />
      <span class="text-[9px] font-bold tracking-wide leading-tight text-md-on-primary">
        {#if buttonText === 'Temporary Expanded'}
          Quick View
        {:else if buttonText === 'Temporary Hidden'}
          Temporary Hidden
        {:else}
          {buttonText}
        {/if}
      </span>
    </button>

    <!-- Zigzag divider inside container (only zigzag pattern) -->
    <div
      class="relative w-full flex items-center justify-end pr-[20px] mb-[2.5px] {actionRowCollapsed || searchBarFocused ? 'mt-[12.5px]' : 'mt-0'}"
      onmouseenter={() => { accountSelectorHovered = false; actionRowHovered = false; }}
      onmouseleave={() => {}}
      role="none"
    >
      <div class="absolute px-2 inset-0 flex items-center pointer-events-none">
        <svg width="100%" height="8" viewBox="0 0 100 8" preserveAspectRatio="none" class="fill-none stroke-md-primary">
          <!-- Zigzag pattern only -->
          <path
            d="M0 4 L2 1 L4 7 L6 1 L8 7 L10 1 L12 7 L14 1 L16 7 L18 1 L20 7 L22 1 L24 7 L26 1 L28 7 L30 1 L32 7 L34 1 L36 7 L38 1 L40 7 L42 1 L44 7 L46 1 L48 7 L50 1 L52 7 L54 1 L56 7 L58 1 L60 7 L62 1 L64 7 L66 1 L68 7 L70 1 L72 7 L74 1 L76 7 L78 1 L80 7 L82 1 L84 7 L86 1 L88 7 L90 1 L92 7 L94 1 L96 7 L98 1 L100 4"
            stroke-width="1"
            class="transition-opacity duration-300 ease-in-out"
            style="opacity: {actionRowCollapsed || searchBarFocused ? '1' : '0'};"
          />
        </svg>
      </div>
    </div>
</div>


<!-- Search + Filter row -->
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
  onSortChange={(value: string) => { onSortChange(value); }}
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
  onRefreshInbox={onRefreshInbox}
  onToggleNotifications={onToggleNotifications}
  notificationsEnabled={notificationsEnabled}
  onSearchFocus={() => { searchBarFocused = true; }}
  onSearchBlur={() => { searchBarFocused = false; }}
  onFilterClick={() => { actionRowCollapsed = true; }}
/>

<!-- Thread grouping toggle -->
<div class="flex items-center justify-end px-2 py-1">
  <button
    class="flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-full border transition-colors {threadGrouping ? 'border-md-primary bg-md-primary/10 text-md-primary font-semibold' : 'border-md-outline-variant text-md-on-surface/60 hover:text-md-on-surface hover:border-md-outline-variant/80'}"
    onclick={() => { threadGrouping = !threadGrouping; expandedThreadIds = new Set(); }}
    aria-label="Toggle thread grouping"
    title="Group emails by conversation"
  >
    <Icon name="threads" class="w-3 h-3" />
    Threads
  </button>
</div>

<!-- Email list filter tabs (Inbox / Archived / Deleted / All mails) — AccountSelector pill style -->
<div class="flex gap-1 px-2 py-1" role="tablist" aria-label={$t('inbox.listTabs.tabAria')}>
  <button
    id="button-tab-inbox"
    role="tab"
    aria-selected={emailListTab === 'inbox'}
    title={$t('inbox.listTabs.inbox', { values: { count: tabCounts.inbox } })}
    aria-label={$t('inbox.listTabs.inbox', { values: { count: tabCounts.inbox } })}
    class="text-[10px] px-2.5 py-1 rounded-full {emailListTab === 'inbox' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface-variant text-md-on-surface/60'} hover:bg-md-primary hover:text-md-on-primary transition-colors"
    onclick={() => { emailListTab = 'inbox'; }}
  >
    {$t('inbox.listTabs.inbox', { values: { count: tabCounts.inbox } })}
  </button>
  <button
    id="button-tab-archived"
    role="tab"
    aria-selected={emailListTab === 'archived'}
    title={$t('inbox.listTabs.archived', { values: { count: tabCounts.archived } })}
    aria-label={$t('inbox.listTabs.archived', { values: { count: tabCounts.archived } })}
    class="text-[10px] px-2.5 py-1 rounded-full {emailListTab === 'archived' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface-variant text-md-on-surface/60'} hover:bg-md-primary hover:text-md-on-primary transition-colors"
    onclick={() => { emailListTab = 'archived'; }}
  >
    {$t('inbox.listTabs.archived', { values: { count: tabCounts.archived } })}
  </button>
  <button
    id="button-tab-deleted"
    role="tab"
    aria-selected={emailListTab === 'deleted'}
    title={$t('inbox.listTabs.deleted', { values: { count: tabCounts.deleted } })}
    aria-label={$t('inbox.listTabs.deleted', { values: { count: tabCounts.deleted } })}
    class="text-[10px] px-2.5 py-1 rounded-full {emailListTab === 'deleted' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface-variant text-md-on-surface/60'} hover:bg-md-primary hover:text-md-on-primary transition-colors"
    onclick={() => { emailListTab = 'deleted'; }}
  >
    {$t('inbox.listTabs.deleted', { values: { count: tabCounts.deleted } })}
  </button>
  <button
    id="button-tab-all"
    role="tab"
    aria-selected={emailListTab === 'all'}
    title={$t('inbox.listTabs.allMails', { values: { count: tabCounts.all } })}
    aria-label={$t('inbox.listTabs.allMails', { values: { count: tabCounts.all } })}
    class="text-[10px] px-2.5 py-1 rounded-full {emailListTab === 'all' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface-variant text-md-on-surface/60'} hover:bg-md-primary hover:text-md-on-primary transition-colors"
    onclick={() => { emailListTab = 'all'; }}
  >
    {$t('inbox.listTabs.allMails', { values: { count: tabCounts.all } })}
  </button>
</div>

<!-- Email list -->
<EmailList
  displayedEmails={displayedEmails}
  filteredEmails={tabFilteredEmails}
  displayedEmailCount={displayedEmailCount}
  {loading}
  {searchQuery}
  {otpOnly}
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
  emailListTab={emailListTab}
  onArchiveEmails={onArchiveEmails}
  onDeleteEmails={onDeleteEmails}
  onRestoreEmails={onRestoreEmails}
/>

<!-- Bottom strips stacked wrapper -->
<!-- autofill is always first in DOM, OTP always second, renewal always third. -->
<!-- CSS `order` swaps them visually: front strip gets order:2 (goes to bottom = screen bottom), -->
<!-- back strip gets order:1 (goes to top = peeks above). Matches example's stacking exactly. -->
<!-- When `has-renewal` is set, the renewal strip is locked to order:3 (always front). -->
<div class="bottom-strips-wrapper z-20 front-{frontStrip}{showRenewalStrip ? ' has-renewal' : ''}" role="none">
{#if formDetected && showAutofillStrip}
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
        <div class="text-xs font-bold text-md-secondary leading-tight truncate max-w-[80px]">{currentDomain || 'Unknown'}</div>
        <div class="text-[9px] font-semibold uppercase tracking-wider text-md-tertiary leading-tight">Detected Form</div>
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
        <div class="flex-1 min-w-0 text-[11px] font-medium text-md-on-surface pr-2 truncate">
          {identities.find(i => i.id === selectedIdentityId)?.name || $t('identities.select')}
        </div>
        <Icon name="chevronDown" class="w-2.5 h-2.5 text-md-on-surface/40 flex-shrink-0 transition-transform {showIdentityDropdown ? 'rotate-180' : ''}" />
        
        <!-- Dropup Menu -->
        {#if showIdentityDropdown}
          <div class="absolute bottom-full left-0 right-0 mb-1 bg-md-primary-container border border-md-secondary-container rounded-xl shadow-lg z-50 max-h-48 overflow-y-auto">
            {#each identities as identity}
              <button
                id="button-identity-{identity.id}"
                class="w-full text-left px-3 py-2 text-[11px] font-medium text-md-on-surface hover:bg-md-secondary-container transition-colors first:rounded-t-xl last:rounded-b-xl"
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
    <button id="button-autofill" class="px-3 py-1 rounded-full text-[11px] font-semibold rounded-lg bg-md-primary text-md-on-primary hover:bg-md-primary/90 flex-shrink-0 transition-colors" onclick={onAutofillForm}>
      Autofill
    </button>

    <!-- Close Button -->
    <button id="button-close-autofill" class="w-5 h-5 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-secondary-container flex-shrink-0 ml-0.5 transition-colors" onclick={() => showAutofillStrip = false} aria-label="Close">
      <Icon name="x" class="w-3 h-3" />
    </button>
  </div>
</div>
{/if}
{#if latestOtp !== '------'}
<div
  id="button-otp-strip"
  class="bottom-strip-item bottom-strip-otp rounded-xl cursor-pointer"
  style="--i: 2; overflow: hidden;"
  role="button"
  tabindex="0"
  aria-label="Open OTP message"
  onclick={() => { if (latestOtpEmail) onOpenMessageDetail(latestOtpEmail); }}
  onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { if (latestOtpEmail) onOpenMessageDetail(latestOtpEmail); } }}
>  
  {#if !otpCollapsed}
  {#if otpDropupOpen}
  <div class="border-b border-md-primary bg-md-secondary-container">

    <!-- Clear all OTPs button -->
    <div class="px-5 pt-2 pb-1 flex items-center justify-end">
      <button
        class="text-[10px] font-semibold text-md-error/70 hover:text-md-error transition-colors flex items-center gap-1"
        onclick={(e) => { e.stopPropagation(); clearAllOtps(); }}
        aria-label={$t('inbox.clearAllOtps')}
      >
        <Icon name="trashBox" class="w-3 h-3" />
        {$t('inbox.clearAllOtps')}
      </button>
    </div>

    <!-- Section: Current email address -->
    <div class="px-5 pt-2.5 pb-1 flex items-center justify-between">
      <span class="text-xs font-bold tracking-widest uppercase text-md-primary">{$t('inbox.currentEmail')}</span>
      <Icon name="chevronDown" class="w-3.5 h-3.5 text-md-on-surface/40" />
    </div>
    <div class="overflow-y-auto max-h-[180px]">
      {#if otpHistoryCurrent.length === 0}
        <p class="text-xs text-md-on-surface/40 px-5 pb-2">{$t('inbox.noOtps')}</p>
      {:else}
        {#each otpHistoryCurrent as item}
          <div class="flex items-center gap-3 px-5 py-2 bg-md-surface-container rounded-xl mx-2 mb-2 shadow-sm">
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
              <span class="font-bold text-md-primary text-[15px] tracking-[0.08em]">{item.otp}</span>
            </div>
            <button
              id="button-copy-otp-current-{item.otp}"
              class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-md-secondary-container"
              aria-label="Copy"
              onclick={async () => {
                try {
                  await navigator.clipboard.writeText(item.otp);
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
    <div class="px-5 pt-1 pb-1 flex items-center justify-between border-t border-md-secondary-container">
      <span class="text-xs font-bold tracking-widest uppercase text-md-primary">{$t('inbox.otherEmails')}</span>
      <Icon name="chevronDown" class="w-3.5 h-3.5 text-md-on-surface/40" />
    </div>
    <div class="overflow-y-auto max-h-[180px]">
      {#each otpHistoryOther as item}
        <div class="flex items-center gap-3 px-5 py-2 bg-md-surface-container rounded-xl mx-2 mb-2 shadow-sm">
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
            <span class="font-bold text-md-primary text-[15px] tracking-[0.08em]">{item.otp}</span>
          </div>
          <button
            id="button-copy-otp-other-{item.otp}"
            class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-md-secondary-container"
            aria-label="Copy"
            onclick={async () => {
              try {
                await navigator.clipboard.writeText(item.otp);
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

  <div class="flex items-center gap-2 px-3 bg-md-secondary-container rounded-xl h-[40px]">

    <!-- Favicon + Domain + Detected OTP -->
    <div class="flex items-center gap-2 min-w-0">
      <div class="flex-shrink-0 w-7 h-7 rounded-lg bg-white flex items-center justify-center overflow-hidden">
        {#if otpSenderEmail}
          <FaviconImage email={otpSenderEmail} size={24} class="w-4 h-4" fallbackLetter={(otpSenderEmail[0] || '?').toUpperCase()} fallbackColor="bg-md-primary" />
        {/if}
      </div>
      <div class="min-w-0">
        <div class="text-xs font-bold text-md-on-surface leading-tight truncate max-w-[80px]">{latestOtpSenderName || otpSenderEmail?.split('@')[0] || 'OTP'}</div>
        <div class="text-[9px] font-semibold uppercase tracking-wider text-md-on-surface/40 leading-tight">Detected OTP ({otpContext.split(' | ').pop() || 'just now'})</div>
      </div>
    </div>

    <!-- Divider -->
    <div class="w-px h-6 bg-md-secondary-container flex-shrink-0 mx-1"></div>

    <!-- Current OTP with Copy -->
    <div class="flex-1 flex items-center justify-center">
      <button
        id="button-copy-current-otp"
        class="px-3 py-1 rounded-full text-[11px] font-semibold rounded-lg bg-md-primary text-md-on-primary hover:bg-md-primary/90 flex-shrink-0 flex items-center gap-1.5 transition-colors"
        aria-label="Copy OTP"
        onclick={(e) => { e.stopPropagation(); onCopyOtp(); }}
      >
        <span class="font-bold text-[13px] tracking-[0.05em]">{latestOtp.replace(/\s/g, '')}</span>
        <Icon name="copy" class="w-3 h-3 text-white/80 flex-shrink-0" />
      </button>
    </div>

    <!-- Up/Down Buttons -->
    <div class="flex items-center gap-1 flex-shrink-0 ml-0.5">
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
        aria-label="Collapse OTP"
        onclick={(e) => { e.stopPropagation(); otpCollapsed = true; }}
      >
        <Icon name="chevronUp" class="w-3 h-3" />
      </button>
    </div>

  </div>
  {:else}
  <button
    class="w-full flex items-center justify-between px-5 py-1.5 text-xs font-medium text-md-primary/70 hover:text-md-primary transition-colors bg-md-secondary-container"
    onclick={(e) => { e.stopPropagation(); otpCollapsed = false; }}
    aria-label="Show OTP bar"
  >
    <span>OTP ready · {latestOtp}</span>
    <Icon name="chevronDown" class="w-3.5 h-3.5" />
  </button>
  {/if}
</div>
{/if}
{#if showRenewalStrip}
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
        <Icon name="refresh" class="w-4 h-4 text-md-warning" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-xs font-bold text-md-on-surface leading-tight">{$t('inbox.renewalStrip.title')}</div>
        <div class="text-[10px] text-md-on-surface/60 leading-tight truncate">{$t('inbox.renewalStrip.prompt')}</div>
      </div>
      <button
        id="button-renewal-dismiss"
        class="w-5 h-5 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-secondary-container flex-shrink-0 transition-colors"
        aria-label={$t('inbox.renewalStrip.dismissAria')}
        onclick={(e) => { e.stopPropagation(); renewalStripDismissed = true; }}
      >
        <Icon name="x" class="w-3 h-3" />
      </button>
    </div>
    <!-- Action row: 3 buttons -->
    <div class="flex items-center gap-1.5">
      <button
        id="button-renewal-always"
        class="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold bg-md-primary text-md-on-primary hover:bg-md-primary/90 transition-colors"
        title={$t('inbox.renewalStrip.alwaysDescription')}
        onclick={(e) => {
          e.stopPropagation();
          if (currentAccount) onToggleAutoExtend(currentAccount);
        }}
      >
        <Icon name="refresh" class="w-3 h-3" />
        {$t('inbox.renewalStrip.always')}
      </button>
      <button
        id="button-renewal-once"
        class="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold bg-md-secondary-container text-md-on-surface hover:bg-md-secondary-container/80 transition-colors"
        title={$t('inbox.renewalStrip.onceDescription')}
        onclick={(e) => {
          e.stopPropagation();
          if (currentAccount) onExtendAccount(currentAccount);
        }}
      >
        {$t('inbox.renewalStrip.once')}
      </button>
      <button
        id="button-renewal-no"
        class="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-transparent text-md-on-surface/60 hover:bg-md-secondary-container hover:text-md-on-surface transition-colors"
        onclick={(e) => { e.stopPropagation(); renewalStripDismissed = true; }}
      >
        {$t('inbox.renewalStrip.dismiss')}
      </button>
    </div>
  </div>
  {:else}
  <button
    class="w-full flex items-center justify-between px-5 py-1.5 text-xs font-medium text-md-warning/70 hover:text-md-warning transition-colors bg-md-primary-container"
    onclick={(e) => { e.stopPropagation(); renewalStripCollapsed = false; }}
    aria-label="Show renewal bar"
  >
    <span>{$t('inbox.renewalStrip.title')} · {$t('inbox.renewalStrip.prompt')}</span>
    <Icon name="chevronDown" class="w-3.5 h-3.5" />
  </button>
  {/if}
</div>
{/if}
</div>
<!-- end bottom-strips-wrapper -->

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

  :global(.bottom-strips-wrapper) {
    position: absolute;
    bottom: 0;
    left: calc(50% - 175px);
    width: 350px;
    display: flex;
    flex-direction: column;
    gap: 0;
    perspective: 500px;
    transform-style: preserve-3d;
    transition: gap 500ms;
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
</style>
