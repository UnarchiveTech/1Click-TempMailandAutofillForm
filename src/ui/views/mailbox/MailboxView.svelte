<script lang="ts">
import { onDestroy, onMount, tick, untrack } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import { storage } from 'wxt/utils/storage';
import {
  flushQueuedEmailReadState,
  queueEmailReadStates,
} from '@/features/address/address-actions.js';
import { canUnarchive } from '@/features/address/address-management.js';
import { filterEmails } from '@/features/address/email-filters.js';
import { useVerificationPreferences } from '@/features/address/use-verification-preferences.svelte.js';
import {
  collectVerificationItems,
  type VerificationItem,
} from '@/features/address/verification-items.js';
import {
  getSelectedIdentity,
  loadIdentities,
  selectIdentity,
} from '@/features/identities/identity-actions.js';
import { registerEscapeTier } from '@/features/keyboard-shortcuts/escape-stack.js';
import { domainMatchesHost } from '@/features/login-info/saved-login-credentials.js';
import AddressCard from '@/ui/blocks/addresses/AddressCard.svelte';
import AddressSelector from '@/ui/blocks/addresses/AddressSelectorBar.svelte';
import AttachmentLibraryDialog from '@/ui/blocks/dialogs/AttachmentLibraryDialog.svelte';
import TagDialog from '@/ui/blocks/dialogs/TagDialog.svelte';
import { type ToastFn } from '@/ui/blocks/layout/use-toast.js';
import FilterList from '@/ui/blocks/mail/FilterList.svelte';
import type { FilterQueryProps } from '@/ui/blocks/mail/filter-list-props.js';
import MailboxStripDock, {
  type MailboxStripId,
  type MailboxStripTab,
} from '@/ui/blocks/mail/MailboxStripDock.svelte';
import MessageCodeBadges from '@/ui/blocks/mail/MessageCodeBadges.svelte';
import ResponsiveMailboxTags from '@/ui/blocks/mail/ResponsiveMailboxTags.svelte';
import VerificationHistory from '@/ui/blocks/mail/VerificationHistory.svelte';
import ButtonGroup from '@/ui/components/composites/ButtonGroup.svelte';
import EmptyState from '@/ui/components/composites/EmptyState.svelte';
import ModalDialog from '@/ui/components/composites/ModalDialog.svelte';
import { sidebarTabsVisible } from '@/ui/components/composites/tabs-sidebar-store.js';
import Icon from '@/ui/components/icons/Icon.svelte';
import { Btn, Checkbox, IconButton, Toggle } from '@/ui/components/primitives';
import AutoRenewToggle from '@/ui/components/primitives/AutoRenewToggle.svelte';
import Avatar from '@/ui/components/primitives/Avatar.svelte';
import Dropdown from '@/ui/components/primitives/Dropdown.svelte';
import FaviconImage from '@/ui/components/primitives/FaviconImage.svelte';
import Skeleton from '@/ui/components/primitives/Skeleton.svelte';
import { isTimeExpired } from '@/utils/address/address-status.js';
import {
  addressTagsList,
  buildTagAddressUsage,
  buildTagColors,
  existingTagNames,
} from '@/utils/address/address-tags.js';
import {
  getWebmcpAccessChoice,
  setWebmcpAccessChoice,
  type WebmcpAccessChoice,
} from '@/utils/browser/webmcp-access.js';
import { copyToClipboardAndSchedulePurge } from '@/utils/clipboard/clipboard.js';
import { emailBodyPreview, emailHoverPreview } from '@/utils/email/body-preview.js';
import type { EmailLabelDef } from '@/utils/email/email-label-catalog.js';
import {
  getEmailLabelCatalog,
  hashLabelColor,
  labelColorFor,
  mergeLabelsIntoCatalog,
  setEmailLabelCatalog,
} from '@/utils/email/email-label-catalog.js';
import { emailLabelKey, emailLabelKeyForEmail } from '@/utils/email/email-label-key.js';
import {
  DEFAULT_PROVIDER,
  loadAllProviderConfigs,
  loadProviderConfig,
} from '@/utils/email/email-service.js';
import { isEmailStarred, starKeyForEmail, toggleStarInSet } from '@/utils/email/email-star-key.js';
import type { EmailThread } from '@/utils/email/email-threads.js';
import { groupEmailsByThread } from '@/utils/email/email-threads.js';
import { htmlToPlainText } from '@/utils/email/sanitize-html.js';
import { logError, logWarn } from '@/utils/logger.js';
import { formatRemaining } from '@/utils/otp/otp-magic-expiry.js';
import {
  type ConnectivityEvent,
  getConnectivityLog,
  isRangeFullyOffline,
} from '@/utils/provider/connectivity-log.js';
import {
  highlightMatches,
  parseSearchShortcuts,
  SHORTCUT_REGEX,
} from '@/utils/search/search-shortcuts.js';
import { getRootDomain } from '@/utils/security/root-domain.js';
import { emailLabelsStore } from '@/utils/storage/email-labels-store.js';
import { parseStringList, toggleDomainListItem, updateStoredObject } from '@/utils/storage/rmw.js';
import {
  EMAIL_STORAGE_ADDRESS_INDEX_KEY,
  getEmailMaps,
  getStoredEmailsForAddress,
  isEmailStorageBagKey,
  resolveBagKey,
} from '@/utils/storage/storage-keys.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import { peekStoredBooleansSync } from '@/utils/storage/stored-prefs-sync.js';
import { AVATAR_MUTED, avatarColor } from '@/utils/theme/avatar-color.js';
import { avatarInitial } from '@/utils/theme/avatar-initials.js';
import { hexToRgba } from '@/utils/theme/color-utils.js';
import { toMs } from '@/utils/time/time.js';
import { formatFullDateTime, timeAgo } from '@/utils/time/time-format.js';
import { useCurrentTime } from '@/utils/time/time-store.js';
import type {
  Address,
  Email,
  EmailPreviewMode,
  Identity,
  SavedSearchFilter,
} from '@/utils/types.js';
import { anchoredFlyout, hasInlineFlyoutSpace } from '@/utils/ui/anchored-flyout.js';
import { AVATAR_BOX, AVATAR_INK } from '@/utils/ui/avatar-size.js';
import { ELEVATION } from '@/utils/ui/elevation.js';
import { createHoldController, onStripDragOver } from '@/utils/ui/gesture-selection.js';
import {
  mailRowStarClass,
  mailRowSurfaceClass,
  SELECTED_ROW_INK,
} from '@/utils/ui/mail-row-state.js';
import {
  collectIntersectingIds,
  isInteractiveTarget,
  isMarqueeSelectionEnabled,
  MARQUEE_THRESHOLD,
  normalizeMarquee,
} from '@/utils/ui/marquee-selection.js';
import { NAV_FLOAT_CONTENT_WIDTH_CSS } from '@/utils/ui/nav-layout.js';
import { PORTAL_Z_CLASS } from '@/utils/ui/portal-layers.js';
import { pullToRefresh } from '@/utils/ui/pull-to-refresh.js';
import { createResizeObserverOnFrame, observeResizeOnFrame } from '@/utils/ui/resize-observer.js';
import { responsiveButtonLayout } from '@/utils/ui/responsive-button-layout.js';
import { controlSurface, rowSurface } from '@/utils/ui/row-surface.js';
import {
  type ListSelectionState,
  type SelectionActionId,
  type SelectionApi,
} from '@/utils/ui/selection-api.js';
import { publishSelectionSurface } from '@/utils/ui/selection-registry.js';
import { focusedRowId } from '@/utils/ui/selection-row-cursor.js';
import {
  createVirtualListMeasurementCache,
  getVirtualListWindow,
  invalidateVirtualListMeasurements,
} from '@/utils/ui/virtual-list.js';
import { hostMatchesDomainScope } from '@/utils/validation.js';

let attachmentLibraryOpen = $state(false);
let verificationExpanded = $state(false);

// Renewal strip state - session-only dismissal. Re-appears on reload.
let renewalStripDismissed = $state(false);
let renewalStripCollapsed = $state(false);

const verificationPreferences = useVerificationPreferences(() =>
  showToast($t('toasts.operationFailed'), 'error')
);
let verificationInboxes = $state<Array<{ address: string; emails: Email[] }>>([]);
let verificationHistoryLoading = $state(false);
let verificationHistoryError = $state(false);
let verificationHistoryRevision = $state(0);
let verificationRequestId = 0;

// Identity state
let identities = $state<Identity[]>([]);
const autofillIdentity = $derived(
  identities.find((identity) => identity.id === selectedIdentityId)
);
let selectedIdentityId = $state<string | null>(null);
const autofillActionLabel = $derived(
  autofillIdentity
    ? `${$t('inbox.autofillAction')} (${autofillIdentity.name})`
    : $t('inbox.autofillAction')
);
let identitySelectionSaving = $state(false);
let showAutofillStrip = $state(true);
let showSavedLoginStrip = $state(true);
let showFilterAppliedStrip = $state(true);
/** Hide "Save as filter" after a successful quick-save */
let filterQuickSaved = $state(false);
/** Inbox lifecycle intelligence suggestions for current / all accounts */
let lifecycleHints = $state<
  Array<{ kind: string; addressId: string; address: string; reasonKey: string; score: number }>
>([]);
let lifecycleHintDismissed = $state(false);
/** Layout prefs: allow user to hide bottom strips permanently until re-enabled */
let preferHideVerificationStrip = $state(false);
let preferHideAutofillStrip = $state(false);
let currentDomain = $state<string>('');
let siteAccessTab = $state<{ id: number; url: string } | null>(null);
let siteAccessChoice = $state<WebmcpAccessChoice | null>(null);
let siteAccessBusy = $state(false);

// Keep the user's category and message stable while other strips receive updates.
let frontStrip = $state<MailboxStripId>('verification');

// Load all providers dynamically from config
let allProviders = $derived.by(() => loadAllProviderConfigs());

// Global bags are read only while expanded. Requests are invalidated on close,
// selection changes, disposal and storage updates so older reads cannot restore data.
$effect(() => {
  void verificationHistoryRevision;
  void selectedEmail;
  void emails;
  const requestId = ++verificationRequestId;
  if (!verificationExpanded || frontStrip !== 'verification' || stripsEdgeCollapsed) return;
  verificationHistoryLoading = true;
  verificationHistoryError = false;
  void getEmailMaps()
    .then((maps) => {
      if (requestId !== verificationRequestId) return;
      const addresses = new Set([
        ...Object.keys(maps.storedEmails),
        ...Object.keys(maps.archivedEmails),
      ]);
      verificationInboxes = [...addresses].map((address) => ({
        address,
        emails: [...(maps.storedEmails[address] || []), ...(maps.archivedEmails[address] || [])],
      }));
    })
    .catch((error) => {
      if (requestId !== verificationRequestId) return;
      verificationHistoryError = true;
      logError('Failed to load verification history', error);
      showToast($t('toasts.operationFailed'), 'error');
    })
    .finally(() => {
      if (requestId === verificationRequestId) verificationHistoryLoading = false;
    });
  return () => {
    verificationRequestId++;
  };
});
onMount(() => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onChange = (changes: Record<string, unknown>, area: string) => {
    if (
      area !== 'local' ||
      !Object.keys(changes).some(
        (key) => key === EMAIL_STORAGE_ADDRESS_INDEX_KEY || isEmailStorageBagKey(key)
      )
    )
      return;
    // Invalidate immediately; debounce reads during mail ingestion.
    verificationRequestId++;
    clearTimeout(timer);
    timer = setTimeout(() => {
      verificationHistoryRevision++;
    }, 100);
  };
  browser.storage.onChanged.addListener(onChange);
  return () => {
    verificationRequestId++;
    clearTimeout(timer);
    browser.storage.onChanged.removeListener(onChange);
  };
});

function toggleVerificationExpansion() {
  verificationExpanded = !verificationExpanded;
}

async function clearAllOtps() {
  if (!showConfirm) {
    await doClearAllOtps();
    return;
  }
  showConfirm($t('inbox.confirmClearAllOtps'), doClearAllOtps, { destructive: true });
}

async function doClearAllOtps() {
  try {
    const response = await browser.runtime.sendMessage({ type: 'clearAllOtps' });
    if (response && !response.success) {
      throw new Error(response.error || 'Failed to clear OTPs');
    }
    // Prevent a read that started before the clear from restoring old OTPs.
    verificationRequestId += 1;
    verificationInboxes = [];
    verificationHistoryRevision++;
    showToast($t('inbox.otpsCleared'));
  } catch (error: unknown) {
    showToast($t('toasts.operationFailed'), 'error');
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
    await writeWithRetry({ selectedIdentityId });
  }
}

// Load identities on mount
loadIdentitiesData();

// Get current tab domain
async function getCurrentTabDomain() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url ? new URL(tab.url) : null;
    siteAccessTab =
      typeof tab?.id === 'number' && tab.url && url && ['http:', 'https:'].includes(url.protocol)
        ? { id: tab.id, url: tab.url }
        : null;
    await loadWebmcpAccessList();
    // Website controls do not apply to browser-internal or extension pages.
    currentDomain =
      url &&
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.href.startsWith(new URL('./', window.location.href).href)
        ? url.hostname
        : '';
  } catch (error: unknown) {
    currentDomain = '';
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
    ? otpOptInList.some((domain) => hostMatchesDomainScope(currentDomain, domain))
    : false
);

let otpAutoCopyList = $state<string[]>([]);
let isOtpAutoCopy = $derived(
  currentDomain
    ? otpAutoCopyList.some(
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
  } catch (error) {
    logError('Failed to load OTP opt-in list', error);
  }
}

async function loadWebmcpAccessList() {
  try {
    const tab = siteAccessTab;
    const choice = tab ? await getWebmcpAccessChoice(tab.id, tab.url) : null;
    if (tab === siteAccessTab) siteAccessChoice = choice;
  } catch (error) {
    logError('Failed to load WebMCP access list', error);
  }
}

async function loadOtpAutoCopyList() {
  try {
    const res = await browser.storage.local.get(['otpAutoCopyList']);
    otpAutoCopyList = Array.isArray(res.otpAutoCopyList) ? res.otpAutoCopyList : [];
  } catch (error) {
    logError('Failed to load OTP auto-copy list', error);
  }
}

async function toggleOtpAutoCopy() {
  if (!currentDomain) return;
  const domainKey = currentDomain.replace(/^www\./, '').toLowerCase();
  const add = !isOtpAutoCopy;
  try {
    // Serialized RMW: a toggle in another surface lands between our read and
    // write instead of being clobbered by the whole-list write.
    otpAutoCopyList = await updateStoredObject(
      'otpAutoCopyList',
      (current) => toggleDomainListItem(current, domainKey, add),
      parseStringList
    );
  } catch (error) {
    logError('Failed to persist OTP auto-copy list', error);
    showToast($t('toasts.operationFailed'), 'error');
    return;
  }
  showToast($t(add ? 'toasts.otpAutoCopyEnabled' : 'toasts.otpAutoCopyDisabled'), 'success');
}

async function toggleOtpOptIn() {
  if (!currentDomain) return;
  const domainKey = currentDomain.replace(/^www\./, '').toLowerCase();
  const add = !isOtpOptedIn;
  try {
    otpOptInList = await updateStoredObject(
      'otpOptInList',
      (current) => toggleDomainListItem(current, domainKey, add),
      parseStringList
    );
  } catch (error) {
    logError('Failed to persist OTP opt-in list', error);
    showToast($t('toasts.operationFailed'), 'error');
    return;
  }
  showToast($t(add ? 'toasts.otpAutofillEnabled' : 'toasts.otpAutofillDisabled'), 'success');
}

async function chooseWebmcpAccess(choice: WebmcpAccessChoice) {
  const tab = siteAccessTab;
  if (!tab || siteAccessBusy) return;
  siteAccessBusy = true;
  try {
    await setWebmcpAccessChoice(tab.id, tab.url, choice);
    await loadWebmcpAccessList();
  } catch (error) {
    logError('Failed to persist WebMCP access list', error);
    showToast($t('toasts.operationFailed'), 'error');
  } finally {
    siteAccessBusy = false;
  }
}

onMount(() => {
  loadOtpOptInList();
  loadWebmcpAccessList();
  loadOtpAutoCopyList();
  void loadLabelCatalog();

  const handleStorageChange = (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>
  ) => {
    if (changes.otpOptInList) {
      const newValue = changes.otpOptInList.newValue;
      otpOptInList = Array.isArray(newValue) ? (newValue as string[]) : [];
    }
    if (
      changes.webmcpAccessList ||
      changes.webmcpSiteDecisions ||
      Object.keys(changes).some((key) => key.startsWith('webmcpOnce_'))
    )
      void loadWebmcpAccessList();
    if (changes.otpAutoCopyList) {
      const newValue = changes.otpAutoCopyList.newValue;
      otpAutoCopyList = Array.isArray(newValue) ? (newValue as string[]) : [];
    }
    if (changes.emailLabelCatalog) void loadLabelCatalog();
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
  const match = identities.find((i) => {
    const hints = i.domainHints || [];
    const overrideDomains = i.domainFieldOverrides ? Object.keys(i.domainFieldOverrides) : [];
    const allDomains = [...hints, ...overrideDomains];
    return allDomains.some((h) => {
      const norm = h
        .toLowerCase()
        .trim()
        .replace(/^www\./, '');
      return norm === rootDomain || norm === currentDomain || currentDomain.endsWith(`.${norm}`);
    });
  });
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

/** Email list filter tab (Inbox / Archived / Deleted / Saved Offline / All mails) */
type EmailListTab = 'inbox' | 'archived' | 'deleted' | 'storedLocally' | 'all';

let {
  context = 'popup',
  selectedEmail = '',
  displayedEmail = $bindable(''),
  accounts = [],
  allAddresses = [],
  loading = false,
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
  notificationsEnabled = false,
  activeThreadMessageId = '',
  activeThreadInbox = '',
  filteredEmails = [],
  emails = [],
  /** Folder tabs + label filter (bindable for sidebar control) */
  emailListTab = $bindable('inbox' as EmailListTab),
  activeLabelFilter = $bindable(null as string | null),
  /** All mailbox bags for cross-address search */
  allStoredEmails = {} as Record<string, Email[]>,
  latestOtp = '------',
  latestOtpSender = '',
  latestOtpSenderName = '',
  otpContext = '',
  formDetected = false,
  providerFailoverHint = null as null | {
    addressId: string;
    show: boolean;
    otherProvidersOk: boolean;
    nextRetryAt: number;
    failCount: number;
  },
  savedSearchFilters = [],
  savedLogins = [] as import('@/utils/types.js').CredentialsHistoryItem[],
  onSelectAddress = () => {},
  onCopyEmail = () => {},
  onOpenQrDialog = () => {},
  onCreateAddress = () => {},
  onAutofillForm = () => {},
  onCreateIdentity = () => {},
  onRefreshMailbox = async () => {},
  onToggleNotifications = () => {},
  onRefillSavedLogin = (_login: import('@/utils/types.js').CredentialsHistoryItem) => {},
  onSaveFilterQuick = () => {},
  onOpenMagicLink = (_url: string) => {},
  onArchiveAddress = () => {},
  onUnarchiveAddress = () => {},
  onRemoveAddress = () => {},
  onRestoreAddress = () => {},
  onReloadAddresses = async () => {},
  onEditAddress = () => {},
  onToggleAutoExtend = () => {},
  onExtendAddress = () => {},
  onOpenMessageDetail = () => {},
  onClearFilters = () => {},
  onCopyOtpFromMessage = () => {},
  onOpenArchivedEmails = () => {},
  onOpenExpiredEmails = () => {},
  onSearchChange = (_v: string) => {},
  onSortChange = (_v: string) => {},
  onOtpOnlyChange = () => {},
  onUnreadOnlyChange = () => {},
  onHasAttachmentChange = () => {},
  onSenderDomainChange = () => {},
  onSelectedSendersChange = (_v: string[]) => {},
  onDateFromChange = () => {},
  onDateToChange = () => {},
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
  onNavigateToManage = () => {},
  onManageTags = () => {},
  onManageLabels = () => {},
  onArchiveEmails = (_emails: Email[]) => {},
  onDeleteEmails = (_emails: Email[]) => {},
  onRestoreEmails = (_emails: Email[]) => {},
  autoRenew = false,
  onToggleAutoRenew = () => {},
  defaultDomain = '',
  dropdownOpen = undefined,
  openSection = undefined,
  onDropdownOpenChange = (_open: boolean) => {},
  showToast = (
    _message: string | { message: string },
    _type?: string,
    _undo?: (() => void | Promise<void>) | null
  ) => {},
  showConfirm = (
    _message: string,
    _onConfirm: () => void,
    _options?: import('@/utils/ui/shared-ui.js').ConfirmDialogOptions
  ) => {},
  emailPreviewMode = 'tooltip' as EmailPreviewMode,
  highlightedEmailId = '',
  gesturesEnabled = true,
  scrollChromeHidden = false,
  onScrollDirection = (_dir: 'up' | 'down', _atTop = false) => {},
  loadMoreEmails: externalLoadMoreEmails = () => {},
  onCreateRuleFromEmail = (_from = '') => {},
}: FilterQueryProps & {
  context?: 'popup' | 'sidepanel' | 'app';
  selectedEmail?: string;
  displayedEmail?: string;
  dropdownOpen?: boolean;
  accounts?: Address[];
  allAddresses?: Address[];
  loading?: boolean;
  activeThreadMessageId?: string;
  activeThreadInbox?: string;
  filteredEmails?: Email[];
  emailListTab?: EmailListTab;
  activeLabelFilter?: string | null;
  allStoredEmails?: Record<string, Email[]>;
  latestOtp?: string;
  latestOtpSender?: string;
  latestOtpSenderName?: string;
  otpContext?: string;
  formDetected?: boolean;
  providerFailoverHint?: null | {
    addressId: string;
    show: boolean;
    otherProvidersOk: boolean;
    nextRetryAt: number;
    failCount: number;
  };
  savedLogins?: import('@/utils/types.js').CredentialsHistoryItem[];
  onSelectAddress?: (email: string) => void | Promise<void>;
  onCopyEmail?: () => void;
  onOpenQrDialog?: () => void;
  onCreateAddress?: (provider?: string, instanceId?: string) => void;
  onAutofillForm?: () => void;
  onCreateIdentity?: () => void;
  onRefreshMailbox?: (addressId?: string) => Promise<void>;
  onRefillSavedLogin?: (login: import('@/utils/types.js').CredentialsHistoryItem) => void;
  onSaveFilterQuick?: () => void;
  onOpenMagicLink?: (url: string, address?: string) => void;
  onArchiveAddress?: (account: Address) => void;
  onUnarchiveAddress?: (account: Address) => void;
  onRemoveAddress?: (address: string) => void;
  onRestoreAddress?: (address: string) => void;
  onReloadAddresses?: (skipEmailSelection?: boolean) => Promise<void>;
  onEditAddress?: (account: Address) => void;
  onToggleAutoExtend?: (account: Address) => void | Promise<void>;
  onExtendAddress?: (account: Address) => void | Promise<void>;
  onOpenMessageDetail?: (thread: Email[]) => void;
  onSearchText?: (query: string) => void;
  onCopyOtpFromMessage?: (otp: string) => void;
  onOpenArchivedEmails?: () => void;
  onOpenExpiredEmails?: () => void;
  showToast?: ToastFn;
  showConfirm?: (
    message: string,
    onConfirm: () => void,
    options?: import('@/utils/ui/shared-ui.js').ConfirmDialogOptions
  ) => void;
  onNavigateToManage?: () => void | Promise<void>;
  onManageTags?: () => void;
  onManageLabels?: () => void;
  onArchiveEmails?: (emails: Email[]) => void | Promise<void>;
  onDeleteEmails?: (emails: Email[]) => void | Promise<void>;
  onRestoreEmails?: (emails: Email[]) => void | Promise<void>;
  autoRenew?: boolean;
  onToggleAutoRenew?: () => void;
  defaultDomain?: string;
  openSection?: 'active' | 'archived' | 'expired' | null;
  onDropdownOpenChange?: (open: boolean) => void;
  emailPreviewMode?: EmailPreviewMode;
  highlightedEmailId?: string;
  gesturesEnabled?: boolean;
  /** Shared bottom chrome state; strips hide while the list is actively scrolling. */
  scrollChromeHidden?: boolean;
  onScrollDirection?: (dir: 'up' | 'down', atTop?: boolean) => void;
  loadMoreEmails?: () => void;
  /** Right-click “Create rule from this email” - receives the email's sender. */
  onCreateRuleFromEmail?: (from?: string) => void;
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

/** Live (non-archived, non-deleted) emails only - strips must not use archived/deleted messages */
// Reserve each website/inbox/type lane before filtering expiry: an expired
// newer message must not promote an older code with a longer detected expiry.
let currentVerificationItems = $derived.by(() =>
  collectVerificationItems(
    [{ address: currentAddress?.address || selectedEmail, emails }],
    verificationPreferences.value.maxAgeMinutes,
    Date.now()
  )
);
let historyVerificationItems = $derived.by(() =>
  collectVerificationItems(
    verificationInboxes,
    verificationPreferences.value.maxAgeMinutes,
    Date.now()
  )
);
let hasVerificationContent = $derived(
  currentVerificationItems.length > 0 ||
    (verificationExpanded && historyVerificationItems.length > 0)
);

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

$effect(() => {
  if (hasActiveListFilters) {
    const showing = untrack(() => showFilterAppliedStrip);
    if (!showing) {
      untrack(() => {
        showFilterAppliedStrip = true;
        filterQuickSaved = false;
      });
    }
  }
});

// Lifecycle intelligence: recompute when accounts change. Older passes may
// finish after a mailbox switch; only the newest pass may publish suggestions.
let lifecycleHintsGeneration = 0;
$effect(() => {
  const list = (allAddresses?.length ? allAddresses : accounts) || [];
  void list.length;
  const generation = ++lifecycleHintsGeneration;
  let active = true;
  void (async () => {
    try {
      const { suggestLifecycleActions, recomputeLifecycleFromStorage } = await import(
        '@/features/intelligence/inbox-lifecycle.js'
      );
      await recomputeLifecycleFromStorage(list as import('@/utils/types.js').Address[]);
      if (!active || generation !== lifecycleHintsGeneration) return;
      const suggestions = await suggestLifecycleActions(
        list as import('@/utils/types.js').Address[]
      );
      if (!active || generation !== lifecycleHintsGeneration) return;
      lifecycleHints = suggestions;
    } catch {
      /* ignore */
      if (active && generation === lifecycleHintsGeneration) lifecycleHints = [];
    }
  })();
  return () => {
    active = false;
  };
});

let stripClockTick = $state(Date.now());
$effect(() => {
  const id = setInterval(() => {
    stripClockTick = Date.now();
  }, 1_000);
  return () => clearInterval(id);
});

let selectedVerificationId = $state<string | null>(null);
let verificationInbox = '';
let copiedVerificationId = $state<string | null>(null);
let copyFeedbackTimer: ReturnType<typeof setTimeout> | undefined;
let selectedVerification = $derived(
  currentVerificationItems.find((item) => item.id === selectedVerificationId) ?? null
);
let verificationIndex = $derived(
  currentVerificationItems.findIndex((item) => item.id === selectedVerificationId)
);
$effect(() => {
  const address = selectedEmail;
  const items = currentVerificationItems;
  untrack(() => {
    if (verificationInbox !== address) {
      verificationInbox = address;
      selectedVerificationId = null;
    }
    if (selectedVerificationId && items.some((item) => item.id === selectedVerificationId)) return;
    selectedVerificationId = items.find((item) => item.status === 'current')?.id ?? null;
  });
});
function moveVerification(delta: number) {
  const next = currentVerificationItems[verificationIndex < 0 ? 0 : verificationIndex + delta];
  if (next) selectedVerificationId = next.id;
}
async function chooseVerification(item: VerificationItem) {
  if (item.address.toLowerCase() !== selectedEmail.toLowerCase()) {
    await onSelectAddress(item.address);
    await tick();
    if (item.address.toLowerCase() !== selectedEmail.toLowerCase()) return;
  }
  if (!currentVerificationItems.some((entry) => entry.id === item.id)) return;
  selectedVerificationId = item.id;
  verificationExpanded = false;
}
async function copySelectedVerification() {
  const item = selectedVerification;
  if (item?.kind !== 'otp') return;
  try {
    const ok = await copyToClipboardAndSchedulePurge(item.value);
    if (ok) {
      copiedVerificationId = item.id;
      clearTimeout(copyFeedbackTimer);
      copyFeedbackTimer = setTimeout(() => {
        copiedVerificationId = null;
      }, 1500);
    }
    showToast($t(ok ? 'inbox.otpCopied' : 'inbox.copyFailed'), ok ? 'success' : 'error');
  } catch (error) {
    logError('Failed to copy current verification', error);
    showToast($t('inbox.copyFailed'), 'error');
  }
}
onDestroy(() => clearTimeout(copyFeedbackTimer));

async function openVerificationMessage(email: Email) {
  const address = (email.original_inbox || '').toLowerCase();
  const target = (allAddresses.length ? allAddresses : accounts).find(
    (entry) => entry.address.toLowerCase() === address
  );
  if (!target) {
    showToast($t('toasts.operationFailed'), 'error');
    return;
  }
  try {
    if ((currentAddress?.address || selectedEmail).toLowerCase() !== address) {
      await onSelectAddress(target.address);
      await tick();
      // A newer mailbox selection may have superseded the asynchronous switch.
      if ((currentAddress?.address || selectedEmail).toLowerCase() !== address) return;
    }
    onOpenMessageDetail([email]);
  } catch (error) {
    logError('Failed to open verification source inbox', error);
    showToast($t('toasts.operationFailed'), 'error');
  }
}

// Tag editing state
let tagDialogOpen = $state(false);
let actionRowCollapsed = $state(false);
let actionRowCollapsedInitialized = $state(false);
let accountSelectorHovered = $state(false);
let actionRowHovered = $state(false);
/** Scroll-driven compact mode for the mailbox address/action header. */
let addressBarCollapsed = $state(false);
let searchBarFocused = $state(false);
/** Email count when search focus began - only count arrivals while focused */
let searchFocusEmailBaseline = $state(0);
let searchFocusNewMailCount = $state(0);
let tagTargetAddress = $state<Address | null>(null);

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
    await writeWithRetry({ actionRowCollapsed });
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
let viewDropdownOpen = $state(false);
let viewSortSubOpen = $state(false);
let viewShowSubOpen = $state(false);
let viewMenuBtnEl = $state<HTMLButtonElement | null>(null);
let viewMenuPos = $state({ top: 0, left: 0 });
let showFaviconsInitialized = $state(false);

function resetLayoutSettings() {
  showFavicons = true;
  hideLabels = false;
  hideOtpLabels = false;
  hideAttachmentBadges = false;
  threadGrouping = false;
  showStarredOnly = false;
  preferHideVerificationStrip = false;
  preferHideAutofillStrip = false;
  expandedThreadIds = new Set();
  void writeWithRetry({
    showFavicons: true,
    hideLabels: false,
    hideOtpLabels: false,
    hideAttachmentBadges: false,
    threadGrouping: false,
    showStarredOnly: false,
    preferHideVerificationStrip: false,
    preferHideAutofillStrip: false,
    preferHideOtpStrip: false,
    preferHideMagicStrip: false,
  });
  void handleSortChange('newest');
  void setPageSize(20);
  viewDropdownOpen = false;
  viewSortSubOpen = false;
  viewShowSubOpen = false;
}

// View mode: whether to hide per-email labels (Local, custom tags) and OTP badges
let hideLabels = $state(false);
let hideLabelsInitialized = $state(false);
let hideOtpLabels = $state(false);
let hideOtpLabelsInitialized = $state(false);
let hideAttachmentBadges = $state(false);
let hideAttachmentBadgesInitialized = $state(false);

// Anti-flash: sync-first preludes via the shared prefs mirror
// (stored-prefs-sync). When the mirror is warm (import-time hydration), the
// row pill/badge gates and strip prefs hold their STORED value at first
// paint instead of popping from defaults after the async reads resolve.
// The async loads below still run to backfill `gesturesEnabled` (not
// mirrored) and to confirm mirror values from storage.
(function primeMailboxLayoutPrefsSync() {
  const warm = peekStoredBooleansSync([
    'showFavicons',
    'hideLabels',
    'hideOtpLabels',
    'hideAttachmentBadges',
    'preferHideVerificationStrip',
    'preferHideAutofillStrip',
  ]);
  if (!warm) return; // mirror cold - async loaders keep the old behavior
  showFavicons = warm.showFavicons;
  hideLabels = warm.hideLabels;
  hideOtpLabels = warm.hideOtpLabels;
  hideAttachmentBadges = warm.hideAttachmentBadges;
  preferHideVerificationStrip = warm.preferHideVerificationStrip;
  preferHideAutofillStrip = warm.preferHideAutofillStrip;
  showFaviconsInitialized = true;
  hideLabelsInitialized = true;
  hideOtpLabelsInitialized = true;
  hideAttachmentBadgesInitialized = true;
})();

async function loadShowFaviconsState() {
  try {
    const result = (await browser.storage.local.get([
      'showFavicons',
      'gesturesEnabled',
      'preferHideVerificationStrip',
      'preferHideOtpStrip',
      'preferHideAutofillStrip',
      'preferHideMagicStrip',
    ])) as {
      showFavicons?: boolean;
      gesturesEnabled?: boolean;
      preferHideVerificationStrip?: boolean;
      preferHideOtpStrip?: boolean;
      preferHideAutofillStrip?: boolean;
      preferHideMagicStrip?: boolean;
    };
    // Default ON when unset
    if (result.showFavicons !== undefined) {
      showFavicons = result.showFavicons;
    } else {
      showFavicons = true;
      void writeWithRetry({ showFavicons: true });
    }
    if (result.gesturesEnabled === false) gesturesEnabled = false;
    preferHideVerificationStrip =
      result.preferHideVerificationStrip ??
      (result.preferHideOtpStrip === true && result.preferHideMagicStrip === true);
    if (result.preferHideVerificationStrip === undefined) {
      void writeWithRetry({ preferHideVerificationStrip });
    }
    preferHideAutofillStrip = !!result.preferHideAutofillStrip;
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
    await writeWithRetry({ showFavicons });
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
    await writeWithRetry({ hideLabels });
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
    await writeWithRetry({ hideOtpLabels });
  } catch (error) {
    logError(
      'Failed to save hideOtpLabels state:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

async function loadHideAttachmentBadgesState() {
  try {
    const result = (await browser.storage.local.get(['hideAttachmentBadges'])) as {
      hideAttachmentBadges?: boolean;
    };
    if (result.hideAttachmentBadges !== undefined) {
      hideAttachmentBadges = result.hideAttachmentBadges;
    }
  } catch (error) {
    logError(
      'Failed to load hideAttachmentBadges state:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
  } finally {
    hideAttachmentBadgesInitialized = true;
  }
}

async function saveHideAttachmentBadgesState() {
  try {
    await writeWithRetry({ hideAttachmentBadges });
  } catch (error) {
    logError(
      'Failed to save hideAttachmentBadges state:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

/** Map a filename to a friendly file-type emoji for the list badge. */
function attachmentTypeMeta(filename: string): { emoji: string } {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (['mp4', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'flv', 'm4v'].includes(ext)) {
    return { emoji: '🎬' };
  }
  if (['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus'].includes(ext)) {
    return { emoji: '🎵' };
  }
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'heic', 'bmp', 'ico'].includes(ext)) {
    return { emoji: '🖼️' };
  }
  if (ext === 'pdf') return { emoji: '📄' };
  if (['doc', 'docx', 'rtf', 'odt', 'txt', 'md'].includes(ext)) {
    return { emoji: '📝' };
  }
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return { emoji: '📊' };
  if (['ppt', 'pptx', 'odp'].includes(ext)) return { emoji: '📽️' };
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext)) return { emoji: '📦' };
  if (['eml', 'msg'].includes(ext)) return { emoji: '📧' };
  return { emoji: '📎' };
}

loadShowFaviconsState();
loadHideLabelsState();
loadHideOtpLabelsState();
loadHideAttachmentBadgesState();

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
let hideAttachmentBadgesPersistReady = false;
$effect(() => {
  void hideAttachmentBadges;
  if (!hideAttachmentBadgesInitialized) return;
  if (!hideAttachmentBadgesPersistReady) {
    hideAttachmentBadgesPersistReady = true;
    return;
  }
  void saveHideAttachmentBadgesState();
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
  const previousPageSize = pageSize;
  const previousDisplayedCount = displayedEmailCount;
  pageSize = n;
  displayedEmailCount = n;
  try {
    await writeWithRetry({ emailListPageSize: n });
  } catch (error) {
    pageSize = previousPageSize;
    displayedEmailCount = previousDisplayedCount;
    logError('Failed to persist email list page size', error);
    showToast($t('toasts.operationFailed'), 'error');
  }
}

// Label filter chips (alongside Inbox/Archived/…)
let emailLabelsMap = $state<Record<string, string[]>>({});
let labelOverflowOpen = $state(false);
let labelCatalog = $state<EmailLabelDef[]>([]);

const labelColor = (name: string) => labelColorFor(labelCatalog, name);

async function loadLabelCatalog() {
  try {
    labelCatalog = await getEmailLabelCatalog();
  } catch {
    labelCatalog = [];
  }
}

$effect(() => {
  return emailLabelsStore.subscribe((map) => {
    emailLabelsMap = map;
  });
});

// Reset visible window when sort / filters change so order is obvious.
// Do not read displayedEmailCount here (would reset "load more" on its own write).
$effect(() => {
  void sortBy;
  void searchQuery;
  void otpOnly;
  void unreadOnly;
  void emailListTab;
  void activeLabelFilter;
  void senderDomain;
  void selectedSenders;
  void dateFrom;
  void dateTo;

  const next = pageSize;
  untrack(() => {
    if (displayedEmailCount !== next) displayedEmailCount = next;
  });
});

// When switching mailbox (prev/next), drop label/star/tab filters that would hide all mails
// Plain let - must NOT be $state (read+write in same effect → infinite loop)
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
    expandedThreadIds = new Set();
    deselectAll();
    untrack(() => {
      onSearchChange?.('');
      onOtpOnlyChange?.(false);
      onHasAttachmentChange?.(false);
      onSenderDomainChange?.('');
      onSelectedSendersChange?.([]);
      onDateFromChange?.('');
      onDateToChange?.('');
    });
  }
  lastFilterMailbox = addr;
});

let lastFilterTab = '';
$effect(() => {
  // Selection only makes sense against one filtered view: switching the tab OR
  // narrowing the list with a label filter / starred-only toggle must clear it,
  // otherwise bulk ops (archive/delete/tag) would silently apply to just the
  // visible subset and drop the rest of the selection (AGENTS.md §5).
  const filterKey = [
    emailListTab,
    activeLabelFilter || '',
    showStarredOnly ? 'starred' : '',
    searchQuery || '',
    otpOnly ? 'otp' : '',
    unreadOnly ? 'unread' : '',
    hasAttachment ? 'attachment' : '',
    senderDomain || '',
    senderEmail || '',
    recipient || '',
    subject || '',
    notSenderDomain || '',
    notSenderEmail || '',
    notRecipient || '',
    notSubject || '',
    selectedSenders.join(','),
    dateFrom || '',
    dateTo || '',
  ].join('|');
  if (lastFilterTab && lastFilterTab !== filterKey) {
    untrack(() => {
      expandedThreadIds = new Set();
      deselectAll();
    });
  }
  lastFilterTab = filterKey;
});

let tabCounts = $derived.by((): Record<EmailListTab, number> => {
  // Single pass: the previous version ran four full filter passes over the
  // same list (inbox / archived / deleted / storedLocally). Counts share the
  // same deleted/archived predicates, so one walk computes all of them.
  let inbox = 0;
  let archived = 0;
  let deleted = 0;
  let storedLocally = 0;
  for (const e of filteredEmails as Email[]) {
    if (e.local_deleted) {
      deleted += 1;
      continue;
    }
    if (e.local_archived) {
      archived += 1;
      storedLocally += 1;
    } else {
      inbox += 1;
      if (e.local_only) storedLocally += 1;
    }
  }
  return { inbox, archived, deleted, storedLocally, all: (filteredEmails as Email[]).length };
});

/** Base list for current status tab (before label / starred filters) */
let statusTabEmails = $derived.by((): Email[] => {
  switch (emailListTab) {
    case 'archived':
      return filteredEmails.filter((e: Email) => e.local_archived && !e.local_deleted);
    case 'deleted':
      return filteredEmails.filter((e: Email) => !!e.local_deleted);
    case 'storedLocally':
      return filteredEmails.filter(
        (e: Email) => (!!e.local_only || !!e.local_archived) && !e.local_deleted
      );
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
let crossMailboxVisibleCounts = $state<Record<string, number>>({});
const CROSS_MAILBOX_INITIAL_ROWS = 50;
let lastCrossMailboxSearch = '';
$effect(() => {
  const currentSearch = searchQuery.trim().toLowerCase();
  if (currentSearch !== lastCrossMailboxSearch) {
    lastCrossMailboxSearch = currentSearch;
    crossMailboxVisibleCounts = {};
  }
});
function emailSelectionKey(email: Email): string {
  if (!crossMailboxSearchActive) return email.id;
  const address = email.original_inbox || (email as Email & { address?: string }).address || '';
  return `${address.toLowerCase()}\u0000${email.id}`;
}
/** Free-text portion of searchQuery (shortcut tokens stripped) for cross-mailbox filtering */
let searchQueryFreeText = $derived(parseSearchShortcuts(searchQuery || '').searchQuery);
let crossMailboxGroups = $derived.by((): CrossMailboxGroup[] => {
  if (!crossMailboxSearchActive) return [];
  const current = (selectedEmail || '').toLowerCase();
  const criteria = {
    searchQuery: searchQueryFreeText,
    otpOnly,
    unreadOnly,
    hasAttachment,
    senderDomain,
    senderEmail,
    recipient,
    subject,
    notSenderDomain,
    notSenderEmail,
    notRecipient,
    notSubject,
    selectedSenders,
    dateFrom,
    dateTo,
    sortBy,
    emailLabelsById: emailLabelsMap,
  };
  const addrs = new Set<string>([
    ...Object.keys(allStoredEmails || {}),
    ...(allAddresses || []).map((a: Address) => a.address).filter(Boolean),
  ]);
  const groups: CrossMailboxGroup[] = [];
  for (const address of addrs) {
    const rawBag = allStoredEmails[address];
    const bag = Array.isArray(rawBag) ? rawBag : [];
    let list = filterEmails(bag, { ...criteria, defaultRecipient: address });
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
    // Preserve the cross-mailbox provenance expected by row actions while
    // cloning only matches rather than every email on every query keystroke.
    list = list.map((email) =>
      email.original_inbox ? email : { ...email, original_inbox: address }
    );
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

function loadMoreCrossMailbox(address: string): void {
  const key = address.toLowerCase();
  crossMailboxVisibleCounts = {
    ...crossMailboxVisibleCounts,
    [key]:
      (crossMailboxVisibleCounts[key] || CROSS_MAILBOX_INITIAL_ROWS) + CROSS_MAILBOX_INITIAL_ROWS,
  };
}

/** Unique labels present on emails in the current status tab */
let statusTabLabels = $derived.by(() => {
  const labels = new Set<string>();
  const counts = new Map<string, number>();
  for (const email of statusTabEmails) {
    // Match the previous `.includes()` behavior: one email contributes at
    // most once to a label even if corrupt storage repeats that label.
    for (const label of new Set(
      emailLabelsMap[emailLabelKeyForEmail(email, selectedEmail)] || []
    )) {
      labels.add(label);
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  }
  return {
    available: Array.from(labels).sort((a, b) => a.localeCompare(b)),
    counts,
  };
});
let availableLabels = $derived(statusTabLabels.available);

function labelCountInStatusTab(lab: string): number {
  return statusTabLabels.counts.get(lab) || 0;
}

let tabFilteredEmails = $derived.by((): Email[] => {
  let list = statusTabEmails;
  const labelFilter = activeLabelFilter;
  if (labelFilter) {
    list = list.filter((e: Email) =>
      (emailLabelsMap[emailLabelKeyForEmail(e, selectedEmail)] || []).includes(labelFilter)
    );
  }
  if (showStarredOnly) {
    return list.filter((e: Email) => {
      const addr = (e.original_inbox || selectedEmail || '').toLowerCase();
      const key = addr ? `${addr}_${e.id}` : e.id;
      return starredEmailIds.has(key) || starredEmailIds.has(e.id);
    });
  }
  return list;
});

// While search is focused, toast only for emails that arrived after focus.
// Use plain counters for "already toasted" so we never read+write $state in one effect.
let searchFocusToastedCount = 0;
let searchFocusToastPending = false;
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
  if (searchFocusToastPending) return;
  searchFocusToastPending = true;
  queueMicrotask(() => {
    searchFocusToastPending = false;
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

let emailThreadIndexes = $derived.by(() => {
  const byLatestEmailId = new Map<string, EmailThread>();
  const byEmailId = new Map<string, EmailThread>();
  const byNestedEmailId = new Map<string, EmailThread>();
  for (const thread of emailThreads) {
    if (!byLatestEmailId.has(thread.latestEmail.id)) {
      byLatestEmailId.set(thread.latestEmail.id, thread);
    }
    for (const email of thread.emails) {
      if (!byEmailId.has(email.id)) byEmailId.set(email.id, thread);
      if (email.id !== thread.latestEmail.id && !byNestedEmailId.has(email.id)) {
        byNestedEmailId.set(email.id, thread);
      }
    }
  }
  return { byLatestEmailId, byEmailId, byNestedEmailId };
});

function toggleThread(threadId: string) {
  const next = new Set(expandedThreadIds);
  if (next.has(threadId)) next.delete(threadId);
  else next.add(threadId);
  expandedThreadIds = next;
}

// Full logical list for the current filters. Small lists retain the existing
// progressive rendering behavior; larger lists use a bounded virtual window
// so scrolling never grows the DOM without limit.
let allDisplayedEmails = $derived.by(() => {
  if (threadGrouping) {
    return emailThreads.flatMap((t) => (expandedThreadIds.has(t.id) ? t.emails : [t.latestEmail]));
  }
  return tabFilteredEmails;
});

const MAILBOX_VIRTUALIZATION_THRESHOLD = 50;
const MAILBOX_DEFAULT_ROW_HEIGHT = 72;
const MAILBOX_OFFLINE_GAP_HEIGHT = 34;
const MAILBOX_THREAD_HEADER_HEIGHT = 34;
const MAILBOX_VIRTUAL_OVERSCAN = 8;
let isVirtualized = $derived(allDisplayedEmails.length > MAILBOX_VIRTUALIZATION_THRESHOLD);
let displayedEmails = $derived(
  isVirtualized ? allDisplayedEmails : allDisplayedEmails.slice(0, displayedEmailCount)
);

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

let currentAddress = $derived.by(() => {
  if (!selectedEmail) return null;
  const exact =
    allAddresses.find((a: Address) => a.address === selectedEmail) ||
    accounts.find((a: Address) => a.address === selectedEmail);
  if (exact) return exact;
  // Case-insensitive fallback (provider domain rewrites can change casing)
  const lower = selectedEmail.toLowerCase();
  return (
    allAddresses.find((a: Address) => (a.address || '').toLowerCase() === lower) ||
    accounts.find((a: Address) => (a.address || '').toLowerCase() === lower) ||
    null
  );
});

// Container background class based on account status
let containerBgClass = $derived.by(() => {
  if (!currentAddress) return 'bg-md-surface-container-highest';
  if (currentAddress.accountStatus === 'deleted') return 'bg-md-error-container';
  if (currentAddress.accountStatus === 'archived') return 'bg-md-tertiary-container';
  return 'bg-md-surface-container-highest';
});

// (The old `buttonText` derived - 'Always Show' / 'Temporary Hidden' / 'Show' /
// 'Hide' - was never referenced by the markup: a dead English label no gate can
// see because nothing renders it. Removed rather than keyed: a locale key for a
// string no surface shows would be just as dead, only harder to notice.)

/** Dialog after user chooses Hide - explains hover + Always Show */
let hideHintDialogOpen = $state(false);
let hideHintDontShow = $state(false);

function handleAddressBarScroll(direction: 'up' | 'down', top: number) {
  // Keep the header visible at the list origin. While browsing, collapse it on
  // upward list movement and restore it on downward movement, matching the
  // requested compact mailbox browsing behavior.
  if (top <= 24) {
    addressBarCollapsed = false;
    return;
  }
  if (direction === 'up') {
    addressBarCollapsed = true;
    dropdownOpen = false;
    onDropdownOpenChange(false);
  } else {
    addressBarCollapsed = false;
  }
}

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
    await writeWithRetry({ hideActionRowHintDismissed: true });
  }
}

// Use shared ticking time store
const timeStore = useCurrentTime();
const currentTime = $derived($timeStore);

// Calculate expiry progress percentage
let expiryProgress = $derived.by(() => {
  if (!currentAddress?.expiresAt || !currentAddress.createdAt) return 0;
  const now = currentTime;
  const totalDuration = currentAddress.expiresAt - currentAddress.createdAt;
  const remaining = currentAddress.expiresAt - now;
  if (totalDuration <= 0) return 0;
  const percentage = Math.max(0, Math.min(100, (remaining / totalDuration) * 100));
  return percentage;
});

// Check if current account's provider supports auto-renew
const supportsAutoRenew = $derived.by(() => {
  if (!currentAddress?.provider) return false;
  try {
    const config = loadProviderConfig(currentAddress.provider);
    return (
      (config.expiry?.renewable === true || config.capabilities?.supportsRenew === true) &&
      typeof config.expiry?.renewalMethod === 'string' &&
      config.expiry.renewalMethod.length > 0
    );
  } catch {
    /* ignore */
    return false;
  }
});

// Check if current account is expired
const isCurrentAddressExpired = $derived.by(() => {
  void stripClockTick;
  return isTimeExpired(currentAddress, Date.now());
});
const showExpiredMailboxHealth = $derived(
  isCurrentAddressExpired &&
    currentAddress?.accountStatus !== 'archived' &&
    currentAddress?.accountStatus !== 'deleted'
);
let mailboxHealthRetrying = $state(false);

async function retryMailboxRefresh() {
  if (!currentAddress?.id || mailboxHealthRetrying) return;
  mailboxHealthRetrying = true;
  try {
    await onRefreshMailbox(currentAddress.id);
  } finally {
    mailboxHealthRetrying = false;
  }
}

// Renewal strip is eligible when: provider supports auto-renew AND
// account is currently expired AND auto-renew is NOT enabled AND not archived.
// (If auto-renew were enabled, the address would not have expired.)
const isCurrentAddressArchived = $derived(
  currentAddress?.accountStatus === 'archived' || currentAddress?.status === 'archived'
);
const canUnarchiveCurrent = $derived(!!currentAddress && canUnarchive(currentAddress as Address));
const renewalStripEligible = $derived(
  supportsAutoRenew &&
    isCurrentAddressExpired &&
    !(currentAddress?.autoExtend ?? false) &&
    !isCurrentAddressArchived
);

// Reset dismissal when the account changes (so a different expired inbox shows the strip again).
// Plain let - NOT $state (read+write in same effect → effect_update_depth_exceeded).
let _lastRenewalAddress: string | null = null;
$effect(() => {
  const addr = currentAddress?.address ?? null;
  if (addr !== _lastRenewalAddress) {
    _lastRenewalAddress = addr;
    untrack(() => {
      renewalStripDismissed = false;
    });
  }
});

// Final show flag = eligible AND not dismissed (still show while renew request in flight)
const showRenewalStrip = $derived((renewalStripEligible && !renewalStripDismissed) || isRenewing);

/** Collapse only the dock's content; its category row remains reachable. */
let stripsEdgeCollapsed = $state(false);

async function setStripsEdgeCollapsed(next: boolean) {
  if (stripsEdgeCollapsed === next) return;
  stripsEdgeCollapsed = next;
  try {
    await writeWithRetry({ stripsEdgeCollapsed: next });
  } catch (error) {
    logError('Failed to save strip dock presentation', error);
    showToast($t('toasts.operationFailed'), 'error');
  }
}

let verificationSeenId = $state('');
let renewalDockVisible = $derived(
  showRenewalStrip ||
    !!(providerFailoverHint?.show && currentAddress?.autoExtend && isCurrentAddressExpired)
);
let lifecycleDockVisible = $derived(
  !lifecycleHintDismissed &&
    lifecycleHints.length > 0 &&
    !(
      lifecycleHints[0].kind === 'renew_high_value' &&
      currentAddress?.id === lifecycleHints[0].addressId &&
      showRenewalStrip
    )
);
let stripTabs = $derived.by(() => {
  const tabs: MailboxStripTab[] = [];
  if (showExpiredMailboxHealth || currentAddress?.mailboxRefreshFailure)
    tabs.push({
      id: 'health',
      label: $t(
        showExpiredMailboxHealth ? 'inbox.refreshHealth.expiredTitle' : 'inbox.refreshHealth.title'
      ),
      attention: true,
    });
  if (hasVerificationContent && !preferHideVerificationStrip)
    tabs.push({
      id: 'verification',
      label: $t('inbox.verificationTitle'),
      count: currentVerificationItems.length,
      attention:
        !!currentVerificationItems[0] && currentVerificationItems[0].id !== verificationSeenId,
    });
  if (formDetected && showAutofillStrip && !preferHideAutofillStrip)
    tabs.push({ id: 'autofill', label: $t('inbox.autofillAction') });
  if (matchingSavedLogin && showSavedLoginStrip && currentDomain)
    tabs.push({ id: 'savedLogin', label: $t('inbox.savedLoginRefill') });
  if (hasActiveListFilters && showFilterAppliedStrip)
    tabs.push({ id: 'filter', label: $t('inbox.filtersApplied') });
  if (renewalDockVisible)
    tabs.push({ id: 'renewal', label: $t('stripDock.renewal'), attention: !isRenewing });
  if (lifecycleDockVisible) tabs.push({ id: 'suggestion', label: $t('filters.suggestions') });
  if (currentDomain) tabs.push({ id: 'siteAccess', label: $t('stripDock.siteAccess') });
  return tabs;
});
function selectStrip(id: MailboxStripId) {
  frontStrip = id;
  if (id === 'verification') verificationSeenId = currentVerificationItems[0]?.id || '';
}
$effect(() => {
  const tabs = stripTabs;
  if (tabs.length && !tabs.some((tab) => tab.id === frontStrip)) selectStrip(tabs[0].id);
});

let hasCollapsibleStrips = $derived.by(() => {
  // In a short popup the absolute strip stack can cover inline filter actions.
  // Give the focused search/filter controls the space without changing strip preferences.
  if (selectionActive || searchBarFocused) return false;
  return stripTabs.length > 0;
});

/** Reserve space under email list for absolute strip stack so rows aren't covered */
let stripReservePx = $derived.by(() => {
  if (selectionActive) return 88;
  if (searchBarFocused) return 0;
  return hasCollapsibleStrips ? bottomStripsHeightPx + 8 : 8;
});

let bottomStripsWrapperEl = $state<HTMLElement | null>(null);
let bottomStripsHeightPx = $state(0);

$effect(() => {
  const el = bottomStripsWrapperEl;
  if (!el || typeof ResizeObserver === 'undefined') {
    bottomStripsHeightPx = 0;
    return;
  }
  return observeResizeOnFrame(el, (entries) => {
    for (const entry of entries) {
      bottomStripsHeightPx = Math.ceil(entry.target.getBoundingClientRect().height);
    }
  });
});

/** Pure dynamic measurement of strip stack - zero hardcoded numbers or fallbacks */
let totalBottomSpacerHeightPx = $derived(bottomStripsHeightPx);

// Auto-renew is now enabled → strip should disappear (the address will renew itself)
$effect(() => {
  if (currentAddress?.autoExtend && renewalStripEligible === false && !isRenewing) {
    untrack(() => {
      if (!renewalStripDismissed) renewalStripDismissed = true;
    });
  }
});

/** Renew once or always-renew: show loading feedback so UI is not stuck on “expired”. */
async function handleRenewOnce() {
  if (!currentAddress || isRenewing) return;
  isRenewing = true;
  try {
    await onExtendAddress(currentAddress);
  } catch (e) {
    logError('handleRenewOnce failed', undefined, e as Error);
  } finally {
    isRenewing = false;
  }
}

async function handleRenewAlways() {
  if (!currentAddress || isRenewing) return;
  isRenewing = true;
  try {
    // Enable auto-extend first, then immediately renew so status leaves “expired”
    if (!currentAddress.autoExtend) {
      // Enabling auto-renew on an expired/near-expiry inbox already performs
      // the immediate renewal in the shared toggle action. Do not issue a
      // second request with the stale pre-toggle account object; the duplicate
      // call races the first one and can invalidate the provider session.
      await onToggleAutoExtend(currentAddress);
      return;
    }
    await onExtendAddress(currentAddress);
  } catch (e) {
    logError('handleRenewAlways failed', undefined, e as Error);
  } finally {
    isRenewing = false;
  }
}

// Tag functions
async function updateAddressTagsOnServer(
  accountId: string,
  tags: Array<{ name: string; color: string }>
): Promise<boolean> {
  try {
    const response = await browser.runtime.sendMessage({
      type: 'updateAddressesTag',
      addressIds: [accountId],
      tag: tags[0]?.name || '',
      color: tags[0]?.color,
      tags,
    });
    if (response && (response as { success?: boolean }).success) {
      await onReloadAddresses();
      return true;
    }
    // success:false (e.g. stale addressId deleted in another window) - the
    // tags were NOT applied; don't pretend by reloading optimistically.
    logWarn('updateAddressesTag rejected by background:', {
      accountId,
      error: (response as { error?: unknown } | undefined)?.error,
    });
    return false;
  } catch (e) {
    logError('Failed to update tags:', e);
    return false;
  }
}

function openTagDialog() {
  if (!currentAddress) return;
  tagTargetAddress = currentAddress;
  tagDialogOpen = true;
}

function closeTagDialog() {
  tagDialogOpen = false;
  tagTargetAddress = null;
}

async function saveTags(tags: Array<{ name: string; color: string }>): Promise<boolean> {
  if (!tagTargetAddress) return true;
  const ok = await updateAddressTagsOnServer(tagTargetAddress.id, tags);
  if (!ok) {
    // success:false (e.g. stale addressId deleted elsewhere) - keep the dialog
    // open (TagDialog gates its close on this) and surface the rejection.
    showToast($t('toasts.tagSaveFailed'), 'error');
    return false;
  }
  closeTagDialog();
  return true;
}

// Existing tags across all accounts, one spelling per tag (case-insensitive) so
// the dialog can never list `Banking` and `banking` as two separate tags.
let existingTags = $derived(existingTagNames(allAddresses));

// Which addresses carry each tag: the hover info on every existing tag in the
// tag dialog.
let tagAddressUsage = $derived(buildTagAddressUsage(allAddresses));

// One color per tag, keyed case-insensitively like the usage map: a tag written
// `banking` on one address and `Banking` on another is ONE tag, so it gets one
// color instead of a different chip per row.
let tagColors = $derived(buildTagColors(allAddresses));
// --- Merged Email List State & Logic ---
// Pull-to-refresh gesture state (the drag itself lives in the pullToRefresh action).
let pullDistance = $state(0);
let pullRefreshing = $state(false);
let refreshRotation = $derived(Math.min(pullDistance * 4.5, 360));

let listRootEl = $state<HTMLElement | null>(null);
const MAIL_SKELETON_ROW_HEIGHT = 60;
let mailSkeletonCount = $state(3);
$effect(() => {
  const list = listRootEl;
  if (!loading || displayedEmails.length > 0 || !list) return;

  const updateSkeletonCount = () => {
    mailSkeletonCount = Math.max(1, Math.ceil(list.clientHeight / MAIL_SKELETON_ROW_HEIGHT));
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
let marqueeActive = $state(false);
let marqueeStart = $state<{ x: number; y: number } | null>(null);
let marqueeRect = $state<{ left: number; top: number; right: number; bottom: number } | null>(null);
let marqueePrefEnabled = $state(true);

let rowLabelMenuId = $state<string | null>(null);
let exitingEmailIds = $state<Set<string>>(new Set());
let starPopId = $state<string | null>(null);
let prefersReducedMotion = $state(false);

let renderLimit = $state(50);
// Mirror of displayedEmails.length so deferred callbacks (IntersectionObserver)
// read a $state snapshot instead of the $derived after teardown - reading a
// destroyed component's $derived triggers Svelte's `derived_inert` warning.
let displayedEmailTotal = $state(0);
$effect(() => {
  displayedEmailTotal = displayedEmails.length;
});
let renderedEmails = $derived(
  isVirtualized ? displayedEmails : displayedEmails.slice(0, renderLimit)
);

// ── Offline-gap labels ──────────────────────────────────────────────────────
// Connectivity log (online/offline transitions, UTC) used to label time ranges
// between emails where the user was offline and no mail could have arrived.
let connectivityEvents = $state<ConnectivityEvent[]>([]);

async function loadConnectivityLog() {
  try {
    connectivityEvents = await getConnectivityLog();
  } catch {
    /* ignore */
  }
}

type RenderedRow =
  | { kind: 'email'; email: Email }
  | { kind: 'offlineGap'; fromTs: number; toTs: number };

/** Format a UTC timestamp for the offline-gap label: e.g. "14:30 UTC". */
function formatGapTime(ts: number): string {
  try {
    const d = new Date(ts);
    return `${d.getUTCHours().toString().padStart(2, '0')}:${d
      .getUTCMinutes()
      .toString()
      .padStart(2, '0')} UTC`;
  } catch {
    return '';
  }
}

const emailsWithGaps = $derived.by((): RenderedRow[] => {
  const rows: RenderedRow[] = [];
  if (connectivityEvents.length === 0) {
    return renderedEmails.map((e) => ({ kind: 'email' as const, email: e }));
  }
  let prevTs: number | null = null;
  for (const mail of renderedEmails) {
    const ts = toMs(mail.received_at) || Date.now();
    if (
      prevTs !== null &&
      ts - prevTs > 5 * 60 * 1000 && // only label meaningful gaps (≥5 min)
      isRangeFullyOffline(connectivityEvents, prevTs, ts)
    ) {
      rows.push({ kind: 'offlineGap', fromTs: prevTs, toTs: ts });
    }
    rows.push({ kind: 'email', email: mail });
    prevTs = ts;
  }
  return rows;
});

/**
 * Cache the expanded-thread height lookup used by virtualization. The old
 * estimator searched every thread for every row during scroll calculations,
 * turning a bounded virtual-list pass into an avoidable nested scan.
 */
let threadHeightByLatestId = $derived.by(() => {
  const heights = new Map<string, number>();
  if (!threadGrouping) return heights;
  for (const thread of emailThreads) {
    if (thread.emails.length > 1) {
      heights.set(
        String(thread.latestEmail.id),
        MAILBOX_DEFAULT_ROW_HEIGHT + MAILBOX_THREAD_HEADER_HEIGHT
      );
    }
  }
  return heights;
});

let hoveredEmail = $state<Email | null>(null);
let previewPosition = $state({ x: 0, y: 0, above: false });
let hoverTimer: ReturnType<typeof setTimeout> | null = null;
let windowWidth = $state(0);
let windowHeight = $state(0);

function isStarredMail(email: Email): boolean {
  return isEmailStarred(starredEmailIds, email.id, email.original_inbox || selectedEmail);
}

async function loadStarredEmails() {
  try {
    const result = (await browser.storage.local.get(['starredEmails'])) as {
      starredEmails?: string[];
    };
    starredEmailIds = new Set(result.starredEmails || []);
  } catch {
    /* ignore */
  }
}

let starToggleBusy = $state(false);
async function toggleStar(email: Email | string) {
  const mail = typeof email === 'string' ? ({ id: email } as Email) : email;
  if (!mail?.id || starToggleBusy) return;
  starToggleBusy = true;
  try {
    const addr = mail.original_inbox || selectedEmail;
    // Serialized RMW: the toggle is computed from the last landed write for the
    // key, so a concurrent star change survives instead of being clobbered.
    // The updater returns the ARRAY stored shape (parse is array-shaped).
    const updated = new Set(
      await updateStoredObject<string[]>(
        'starredEmails',
        (current) => Array.from(toggleStarInSet(new Set(current), mail.id, addr)),
        parseStringList
      )
    );
    starredEmailIds = updated;
    if (!prefersReducedMotion) {
      starPopId = mail.id;
      setTimeout(() => {
        if (starPopId === mail.id) starPopId = null;
      }, 180);
    }
  } catch (e) {
    logError('toggleStar failed', undefined, e as Error);
    await loadStarredEmails();
  } finally {
    starToggleBusy = false;
  }
}

let highlightTerms = $derived.by(() => {
  const parsed = parseSearchShortcuts(searchQuery);
  return parsed.highlightTerms.filter((t) => !t.includes(':'));
});

function getDisplayName(email: string, name: string | undefined = undefined): string {
  if (name?.trim()) {
    if (name.includes('@')) {
      const localPart = name.split('@')[0];
      return localPart.replace(/[._]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
    }
    return name.trim();
  }
  if (!email) return 'Unknown';
  if (email.includes('@')) {
    const localPart = email.split('@')[0];
    return localPart.replace(/[._]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }
  return email;
}

function handleMouseEnter(email: Email, e: MouseEvent) {
  // In 'expanded' mode the row grows in place; the floating tooltip is off.
  if (emailPreviewMode !== 'tooltip') return;
  if (hoverTimer) clearTimeout(hoverTimer);
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  hoverTimer = setTimeout(() => {
    const rowHeight = rect.height;
    const previewHeight = rowHeight * 2; // 2x email item height, programmatic not hardcoded
    const viewportHeight = windowHeight || window.innerHeight;
    const above = rect.bottom + previewHeight > viewportHeight;
    const y = above ? rect.top - previewHeight - 4 : rect.bottom + 4;
    // Center the tooltip horizontally on the email row
    const previewWidth = 288;
    const x = Math.max(8, rect.left + rect.width / 2 - previewWidth / 2);
    previewPosition = { x, y, above };
    hoveredEmail = email;
  }, 250);
}

// Also wired to the list container's onscroll: scrolling moves rows under a
// stationary cursor, which fires spurious row mouseenter events - dismissing
// here keeps the preview from jumping to another mail mid-scroll. It re-arms
// 250ms after scrolling settles.
function handleMouseLeave() {
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
  hoveredEmail = null;
}

// --- Swipe, Marquee, Long Press & Tag Dialog Feature Logic ---
let swipeStartX = $state(0);
let swipeDistance = $state(0);
let swipeDirection = $state<'left' | 'right' | null>(null);
let swipingEmail = $state<Email | null>(null);
let swipeActionTriggered = $state(false);

// Long-press / right-click / marquee share the hold engine: the single hold
// timer plus the click-suppression window armed after a completed gesture.
const holdCtrl = createHoldController({ holdMs: 500, suppressClickMs: 500 });
let longPressEmail = $state<Email | null>(null);
// Right-click / long-press context menu - a small per-email popup with
// “Create rule from this email”.
let contextMenuOpen = $state(false);
let contextMenuPosition = $state({ x: 0, y: 0 });
let contextMenuEmail = $state<Email | null>(null);
let lastMailboxForSelection: string | null = null;
$effect(() => {
  const addr = selectedEmail || '';
  if (lastMailboxForSelection === null) {
    lastMailboxForSelection = addr;
    return;
  }
  if (lastMailboxForSelection !== addr) {
    lastMailboxForSelection = addr;
    deselectAll();
    contextMenuOpen = false;
    contextMenuEmail = null;
    longPressEmail = null;
  }
});
let marqueeDidSelect = false;
let selectedEmailIds = $state<Set<string>>(new Set());

// The selection's ONE source of truth is `selectedEmailIds`; `active` and `count`
// are the same fact, so they are derived from it rather than assigned beside it.
// They used to be written at eleven sites, and the invariant
// `active ⇔ count > 0 ⇔ size > 0` held only by hand - which it did not: an avatar
// click had to force `active = true` BEFORE toggling (so removing the last id left
// the shell's bar up over an empty selection), and the four drop-on-tab guards had
// to re-check both `!active` and `size === 0` because the two could disagree.
// Derived, they cannot: every site now writes only the set.
let selectionCount = $derived(selectedEmailIds.size);
let selectionActive = $derived(selectedEmailIds.size > 0);
let lastScrollTop = 0;

let labelDialogEmailId = $state<string | null>(null);
let labelDialogInput = $state('');
let emailLabelDialogOpen = $state(false);
let labelDialogMultiIds = $state<string[] | null>(null);
let labelDialogColor = $state('#6750a4');
/** False until the user edits the picker, so it can track the first new label. */
let labelDialogColorTouched = $state(false);

/** Labels typed in the dialog that are not yet in the catalog (drive the color picker). */
let dialogNewLabels = $derived.by(() => {
  if (!emailLabelDialogOpen) return [] as string[];
  const known = new Set(labelCatalog.map((d) => d.name.toLowerCase()));
  return Array.from(
    new Set(
      labelDialogInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    )
  ).filter((name) => !known.has(name.toLowerCase()));
});

// Default the picker to the first new label's hash color until the user
// chooses their own, so new labels are distinct without any extra clicks.
$effect(() => {
  const firstNew = dialogNewLabels[0];
  if (firstNew && !labelDialogColorTouched) {
    labelDialogColor = hashLabelColor(firstNew);
  }
});

let listSentinelEl = $state<HTMLElement | null>(null);
let virtualScrollTop = $state(0);
let virtualViewportHeight = $state(0);
let virtualRowHeights = $state<Map<number, number>>(new Map());
let keyboardFocusQueue = Promise.resolve();

function moveMailboxCursor(delta: -1 | 1): Promise<void> {
  keyboardFocusQueue = keyboardFocusQueue
    .then(async () => {
      const container = listRootEl;
      if (!container) return;
      const active = document.activeElement;
      if (!container.contains(active) && !active?.closest('[data-selection-strip]')) return;
      const current = focusedRowId(container);
      const previousFocus = document.activeElement;
      const index = displayedEmails.findIndex((email) => email.id === current);
      const nextIndex = Math.max(
        0,
        Math.min(
          displayedEmails.length - 1,
          index < 0 ? (delta === 1 ? 0 : displayedEmails.length - 1) : index + delta
        )
      );
      const nextId = displayedEmails[nextIndex]?.id;
      if (!nextId) return;
      if (!isVirtualized && nextIndex >= renderLimit) renderLimit = nextIndex + 1;
      await tick();
      if (!container.isConnected || listRootEl !== container) return;
      const selector = `[data-selectable-row="${CSS.escape(nextId)}"]`;
      if (!container.querySelector(selector) && isVirtualized) {
        const virtualIndex = emailsWithGaps.findIndex(
          (row) => row.kind === 'email' && row.email.id === nextId
        );
        if (virtualIndex < 0) return;
        let offset = 0;
        for (let i = 0; i < virtualIndex; i++) offset += estimateVirtualRowHeight(i);
        container.scrollTop = offset;
        virtualScrollTop = offset;
        await tick();
      }
      // Do not take focus back from a dialog opened while rendering the window.
      if (
        !container.contains(document.activeElement) &&
        (previousFocus?.isConnected || document.activeElement !== document.body)
      )
        return;
      const nextRow = container.querySelector<HTMLElement>(selector);
      (nextRow?.querySelector<HTMLElement>('[data-row-primary]') ?? nextRow)?.focus();
    })
    .catch((error) => {
      logError('Failed to move mailbox keyboard cursor', error);
    });
  return keyboardFocusQueue;
}

function expandRenderWindow() {
  if (renderLimit >= displayedEmailTotal) return;
  renderLimit = Math.min(displayedEmailTotal, renderLimit + 50);
}

$effect(() => {
  const el = listSentinelEl;
  if (!el || typeof IntersectionObserver === 'undefined') return;
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) expandRenderWindow();
    },
    { root: null, rootMargin: '200px', threshold: 0 }
  );
  io.observe(el);
  return () => io.disconnect();
});

// Keep the virtual window aligned with the actual scroll container, including
// side-panel resizing and the popup's initial layout pass.
$effect(() => {
  const el = listRootEl;
  if (!el) return;
  const updateViewport = () => {
    virtualScrollTop = el.scrollTop;
    virtualViewportHeight = el.clientHeight;
  };
  updateViewport();
  if (typeof ResizeObserver === 'undefined') return;
  return observeResizeOnFrame(el, () => updateViewport());
});

// Observe complete virtual rows. The wrapper includes a thread header when one
// is present, so measured heights cover all variable-height content rather than
// measuring only the email body row.
$effect(() => {
  const el = listRootEl;
  if (!el || !isVirtualized || typeof ResizeObserver === 'undefined') return;
  void virtualWindow.start;
  void virtualWindow.end;
  const ro = createResizeObserverOnFrame((entries) => {
    let next: Map<number, number> | null = null;
    for (const entry of entries) {
      const index = Number((entry.target as HTMLElement).dataset.virtualRowIndex);
      const height = Math.ceil(entry.contentRect.height);
      if (!Number.isInteger(index) || height < 1) continue;
      if ((next || virtualRowHeights).get(index) === height) continue;
      if (!next) next = new Map(virtualRowHeights);
      next.set(index, height);
    }
    if (next) virtualRowHeights = next;
  });
  if (!ro) return;
  for (const row of el.querySelectorAll<HTMLElement>('[data-virtual-row-index]')) {
    ro.observe(row);
  }
  return () => ro.disconnect();
});

// Return to the top when the logical mailbox list changes, rather than leaving
// the user at a stale virtual offset after a filter, tab, or mailbox switch.
let lastVirtualListKey = '';
$effect(() => {
  const key = `${selectedEmail}|${emailListTab}|${activeLabelFilter || ''}|${searchQuery || ''}|${sortBy || ''}|${showStarredOnly ? 'starred' : ''}|${threadGrouping ? 'threads' : ''}`;
  if (lastVirtualListKey && lastVirtualListKey !== key) {
    virtualScrollTop = 0;
    virtualRowHeights = new Map();
    if (listRootEl) listRootEl.scrollTop = 0;
  }
  lastVirtualListKey = key;
});

// A new message or an expanded thread can shift row indexes without changing
// the user's filter. Clear only the measurements in that case; preserve the
// user's scroll position while the visible rows are measured again.
let lastVirtualMeasurementKey = '';
$effect(() => {
  const firstId = allDisplayedEmails[0]?.id || '';
  const lastId = allDisplayedEmails[allDisplayedEmails.length - 1]?.id || '';
  const expandedKey = threadGrouping ? Array.from(expandedThreadIds).sort().join(',') : '';
  const key = `${allDisplayedEmails.length}|${firstId}|${lastId}|${expandedKey}|${connectivityEvents.length}`;
  if (lastVirtualMeasurementKey && lastVirtualMeasurementKey !== key) {
    virtualRowHeights = new Map();
  }
  lastVirtualMeasurementKey = key;
});

// The prefix-sum cache keys measurements by the height source's identity.
// Snapshot the inputs into a new source whenever measurements or rows change;
// a permanently stable function reading live maps leaves cached offsets stale.
const estimateVirtualRowHeight = $derived.by(() => {
  const heights = virtualRowHeights;
  const rows = emailsWithGaps;
  const threadHeights = threadHeightByLatestId;
  return (index: number): number => {
    const measured = heights.get(index);
    if (measured) return measured;
    const row = rows[index];
    if (!row) return MAILBOX_DEFAULT_ROW_HEIGHT;
    if (row.kind === 'offlineGap') return MAILBOX_OFFLINE_GAP_HEIGHT;
    return threadHeights.get(String(row.email.id)) || MAILBOX_DEFAULT_ROW_HEIGHT;
  };
});

const virtualMeasurementCache = createVirtualListMeasurementCache();
let previousVirtualRowCount = 0;

// Measurement-cache invalidation is a committed-state side effect, so keep it
// out of the lazy virtual-window derivation.
$effect(() => {
  const rowCount = emailsWithGaps.length;
  if (rowCount < previousVirtualRowCount) {
    invalidateVirtualListMeasurements(virtualMeasurementCache, rowCount);
  }
  previousVirtualRowCount = rowCount;
});

let virtualWindow = $derived.by(() => {
  const rowCount = emailsWithGaps.length;
  const window = getVirtualListWindow(
    rowCount,
    virtualScrollTop,
    virtualViewportHeight || 480,
    estimateVirtualRowHeight,
    MAILBOX_VIRTUAL_OVERSCAN,
    virtualMeasurementCache
  );
  return {
    ...window,
    rows: emailsWithGaps.slice(window.start, window.end),
  };
});

// Reset window when underlying list shrinks or filter changes
$effect(() => {
  void displayedEmails.length;
  if (renderLimit > displayedEmails.length + 50) {
    renderLimit = Math.max(50, displayedEmails.length);
  }
});

function onMarqueePointerDown(e: PointerEvent) {
  if (!gesturesEnabled || !marqueePrefEnabled || e.button !== 0) return;
  if ((displayedEmails?.length || 0) === 0) return;
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
      selectedEmailIds = new Set(ids);
    }
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    window.removeEventListener('blur', onUp);
    if (marqueeActive) {
      marqueeDidSelect = true;
      holdCtrl.armSuppression();
    }
    marqueeStart = null;
    marqueeActive = false;
    marqueeRect = null;
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  // If the pointer leaves the window / the window loses focus (e.g. alt-tab),
  // pointerup may never fire - release the drag state so the UI never sticks.
  window.addEventListener('blur', onUp);
}

function handleSwipeStart(email: Email, e: TouchEvent | MouseEvent) {
  if (!gesturesEnabled) return;
  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
  swipeStartX = clientX;
  swipingEmail = email;
  swipeDistance = 0;
  swipeDirection = null;
  swipeActionTriggered = false;
}

function handleSwipeMove(e: TouchEvent | MouseEvent) {
  if (!swipingEmail) return;
  const currentX = 'touches' in e ? e.touches[0].clientX : e.clientX;
  const diff = currentX - swipeStartX;
  if (Math.abs(diff) > 10) {
    swipeDistance = Math.max(Math.min(diff, 120), -120);
    swipeDirection = diff > 0 ? 'right' : 'left';
  }
}

function handleSwipeEnd() {
  if (!swipingEmail) return;
  if (Math.abs(swipeDistance) > 80) {
    const direction = swipeDistance < 0 ? 'left' : 'right';
    const target = swipingEmail;
    performSwipeAction(direction, target);
  } else {
    swipeDistance = 0;
    swipeDirection = null;
    swipingEmail = null;
  }
}

function isDocumentRtl(): boolean {
  if (typeof document === 'undefined') return false;
  return (
    document.documentElement.dir === 'rtl' ||
    getComputedStyle(document.documentElement).direction === 'rtl'
  );
}

function performSwipeAction(direction: 'left' | 'right', email: Email) {
  const run = () => {
    if (emailListTab === 'archived' || emailListTab === 'deleted') {
      void onRestoreEmails([email]);
      return;
    }
    const rtl = isDocumentRtl();
    const isDelete = (!rtl && direction === 'left') || (rtl && direction === 'right');
    if (isDelete) {
      void onDeleteEmails([email]);
    } else {
      void onArchiveEmails([email]);
    }
  };

  swipeActionTriggered = true;
  const delay = prefersReducedMotion ? 0 : 240;
  if (!prefersReducedMotion) {
    const next = new Set(exitingEmailIds);
    next.add(email.id);
    exitingEmailIds = next;
  }
  setTimeout(() => {
    run();
    swipeDistance = 0;
    swipeDirection = null;
    swipingEmail = null;
    swipeActionTriggered = false;
    if (exitingEmailIds.has(email.id)) {
      const cleared = new Set(exitingEmailIds);
      cleared.delete(email.id);
      exitingEmailIds = cleared;
    }
  }, delay);
}

function handleLongPressStart(email: Email, e: TouchEvent | MouseEvent) {
  if (!gesturesEnabled) return;
  holdCtrl.start('row', () => {
    longPressEmail = email;
    const next = new Set(selectedEmailIds);
    next.add(email.id);
    selectedEmailIds = next;
    const touch = 'touches' in e ? e.touches[0] : e;
    contextMenuPosition = clampContextMenuPosition(touch.clientX, touch.clientY);
    contextMenuOpen = true;
    contextMenuEmail = email;
  });
}

function handleLongPressEnd() {
  holdCtrl.cancel('row');
}

function toggleEmailSelection(id: string) {
  const next = new Set(selectedEmailIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedEmailIds = next;
  // Nothing to publish: emptying the set closes the shell's bar on its own, so
  // only the row context menu (which has no derived state) is dismissed here.
  if (next.size === 0) {
    contextMenuOpen = false;
    contextMenuEmail = null;
  }
}

function filterByLabel(label: string) {
  activeLabelFilter = label;
}

let allEmailLabels = $derived.by(() => {
  const set = new Set<string>();
  for (const labels of Object.values(emailLabelsMap)) {
    if (!Array.isArray(labels)) continue;
    for (const t of labels) set.add(t);
  }
  return Array.from(set).sort();
});

function openEmailLabelDialog(emailId: string) {
  const email =
    resolveSelectedEmails().find((item) => item.id === emailId) ||
    (emails || []).find((item) => item.id === emailId);
  labelDialogEmailId = email
    ? emailLabelKeyForEmail(email, selectedEmail)
    : emailLabelKey(emailId, selectedEmail);
  labelDialogMultiIds = null;
  const labels = emailLabelsMap[labelDialogEmailId];
  labelDialogInput = (Array.isArray(labels) ? labels : []).join(', ');
  labelDialogColor = '#6750a4';
  labelDialogColorTouched = false;
  emailLabelDialogOpen = true;
}

function closeEmailLabelDialog() {
  emailLabelDialogOpen = false;
  labelDialogEmailId = null;
  labelDialogMultiIds = null;
  labelDialogInput = '';
  labelDialogColor = '#6750a4';
  labelDialogColorTouched = false;
}

function selectAllVisible() {
  // Only the set is written. An empty universe is now a no-op rather than a
  // selection bar over zero rows, which is how it could disagree before.
  const emailsToSelect = crossMailboxSearchActive
    ? crossMailboxGroups.flatMap((group) => group.emails)
    : tabFilteredEmails || [];
  selectedEmailIds = new Set<string>(emailsToSelect.map(emailSelectionKey));
}

/** How many emails match the current tab + filters (the selection universe). */
let selectionMatchingTotal = $derived(
  crossMailboxSearchActive
    ? crossMailboxGroups.reduce((total, group) => total + group.emails.length, 0)
    : (tabFilteredEmails || []).length
);
let selectionUniverseCounted = $derived(true);
let selectionAllMatched = $derived.by(() => {
  if (!selectionUniverseCounted || selectionMatchingTotal === 0) return false;
  const universe = crossMailboxSearchActive
    ? crossMailboxGroups.flatMap((group) => group.emails)
    : tabFilteredEmails;
  return universe.every((email) => selectedEmailIds.has(emailSelectionKey(email)));
});

// The facts the shell's strip renders from, and which actions the strip may
// offer. This view shows archive but not restore in the inbox (and the reverse
// in Archived), and the select-all button names the matching universe - all of
// which only this view knows. Published (rather than bound down as props) so it
// works through ANY rendering of this view, and unregisters on unmount.
const selectionState = $derived.by<ListSelectionState>(() => ({
  active: selectionActive,
  count: selectionCount,
  actions: mailboxSelectionActions(emailListTab),
  allMatched: selectionAllMatched,
  matchingTotal: selectionMatchingTotal,
  universeCounted: selectionUniverseCounted,
}));

/** The bulk actions a folder offers: the inbox archives, Archived restores. */
function mailboxSelectionActions(tab: EmailListTab): SelectionActionId[] {
  const actions: SelectionActionId[] = [];
  if (tab === 'archived' || tab === 'deleted') actions.push('restore');
  else actions.push('archive');
  actions.push('star', 'tag');
  if (tab !== 'deleted') actions.push('delete');
  return actions;
}

$effect(() =>
  publishSelectionSurface({ surface: 'mailbox', state: selectionState, api: selectionApi })
);

// ── No-results recovery ─────────────────────────────────────────────────────
// When a query with pills (is:otp / has:attachment / !from:… / from:…) matches
// nothing, offer "did you mean" - drop the last pill and show the resulting
// count. Pills are first-class tokens, so this is pure derived computation.
let queryPills = $derived(
  (searchQuery || '')
    .trim()
    .split(/\s+/)
    .filter((t: string) => SHORTCUT_REGEX.test(t))
);

let noResultsRecovery = $derived.by(() => {
  if ((filteredEmails || []).length > 0 || queryPills.length === 0) return null;
  const lastPill = queryPills[queryPills.length - 1];
  const withoutLast = (searchQuery || '')
    .trim()
    .split(/\s+/)
    .filter((t) => t !== lastPill)
    .join(' ')
    .trim();
  if (!withoutLast) return null;
  // The 'after removing the pill' criteria: every query-driven field comes from
  // the REMAINING query (the current props still carry the dropped pill's
  // value - passing them would re-apply the filter we're suggesting to drop).
  // Booleans reset to false once their pill is gone (mirrors FilterList's
  // removePill chip-flip). Non-query filters (multi-sender picker, date range,
  // sort, tags) keep their current values.
  const p = parseSearchShortcuts(withoutLast);
  const count = filterEmails(emails || [], {
    searchQuery: p.searchQuery,
    otpOnly: p.otpOnlySet ? p.otpOnly : false,
    unreadOnly: p.unreadOnlySet ? p.unreadOnly : false,
    hasAttachment: p.hasAttachmentSet ? p.hasAttachment : false,
    senderDomain: p.senderDomain,
    senderEmail: p.senderEmail,
    recipient: p.recipient,
    subject: p.subject,
    notSenderDomain: p.notSenderDomain,
    notSenderEmail: p.notSenderEmail,
    notRecipient: p.notRecipient,
    notSubject: p.notSubject,
    selectedSenders,
    dateFrom,
    dateTo,
    sortBy,
    emailLabelsById: emailLabelsMap,
  }).length;
  // A genuinely empty account (or a query whose remaining terms still match
  // nothing) isn't a recovery opportunity - hide the hint.
  if (count === 0) return null;
  return { lastPill, withoutLast, count };
});

function deselectAll() {
  selectedEmailIds = new Set();
  contextMenuOpen = false;
  contextMenuEmail = null;
  longPressEmail = null;
}

// Escape tier: an active multi-select is a transient surface - Escape drops it
// rather than navigating the mailbox away from rows the user just ticked.
$effect(() => {
  if (!selectionActive) return;
  return registerEscapeTier('mailbox.selection', deselectAll);
});

// Escape tier: the per-email context menu is a transient surface too, and it
// registers while OPEN - i.e. after the selection tier above - so Escape closes
// the menu first and the selection second. It has to live here rather than on
// the click-away: under the backdrop contract that element is aria-hidden and
// never focusable, which is exactly why the old `onkeydown` on it could not fire.
$effect(() => {
  if (!contextMenuOpen) return;
  return registerEscapeTier('mailbox.contextMenu', closeContextMenu);
});

function resolveSelectedEmails(): Email[] {
  if (crossMailboxSearchActive) {
    return crossMailboxGroups
      .flatMap((group) => group.emails)
      .filter((email) => selectedEmailIds.has(emailSelectionKey(email)));
  }
  const fromTab = (tabFilteredEmails || []).filter((e: Email) => selectedEmailIds.has(e.id));
  if (fromTab.length > 0) return fromTab;
  return (emails || []).filter((e: Email) => selectedEmailIds.has(e.id));
}

function performArchive() {
  const targets = resolveSelectedEmails();
  if (targets.length === 0) return;
  void onArchiveEmails(targets);
  deselectAll();
}

/** Snapshot the labels of the given ids, apply `next`, and offer an undo toast. */
async function commitLabelsWithUndo(next: Record<string, string[]>, affectedIds: Iterable<string>) {
  const snapshot: Record<string, string[]> = {};
  for (const id of affectedIds) {
    snapshot[id] = Array.isArray(emailLabelsMap[id]) ? [...emailLabelsMap[id]] : [];
  }
  const previous = emailLabelsMap;
  emailLabelsMap = next;
  try {
    await emailLabelsStore.replaceMap(next);
    showToast($t('toasts.labelsUpdated'), 'tag', () => {
      void undoLabelChange(snapshot);
    });
  } catch (e) {
    // Persist failed - roll the optimistic UI back so it matches storage, and
    // tell the user instead of silently swallowing the failure.
    emailLabelsMap = previous;
    logError('commitLabelsWithUndo failed to persist labels', undefined, e as Error);
    showToast($t('toasts.labelsUpdateFailed'), 'error');
  }
}

/** Restore a label snapshot (undo), merging into whatever labels changed meanwhile. */
async function undoLabelChange(snapshot: Record<string, string[]>) {
  const next: Record<string, string[]> = { ...emailLabelsStore.getSnapshot() };
  for (const [id, labels] of Object.entries(snapshot)) {
    if (labels.length === 0) delete next[id];
    else next[id] = labels;
  }
  const previous = emailLabelsMap;
  emailLabelsMap = next;
  try {
    await emailLabelsStore.replaceMap(next);
    showToast($t('toasts.labelsUndone'), 'tag');
  } catch (e) {
    emailLabelsMap = previous;
    logError('undoLabelChange failed to persist labels', undefined, e as Error);
    showToast($t('toasts.labelsUpdateFailed'), 'error');
  }
}

async function applyLabelToSelected(lab: string) {
  const targets = resolveSelectedEmails();
  if (targets.length === 0 || !lab) return;
  const next: Record<string, string[]> = { ...emailLabelsMap };
  for (const mail of targets) {
    const key = emailLabelKeyForEmail(mail, selectedEmail);
    const existing = Array.isArray(next[key]) ? next[key] : [];
    next[key] = [...new Set([...existing, lab])];
  }
  await commitLabelsWithUndo(
    next,
    targets.map((mail) => emailLabelKeyForEmail(mail, selectedEmail))
  );
}

function performDelete() {
  const targets = resolveSelectedEmails();
  if (targets.length === 0) return;
  void onDeleteEmails(targets);
  deselectAll();
}

function performRestore() {
  const targets = resolveSelectedEmails();
  if (targets.length === 0) return;
  void onRestoreEmails(targets);
  deselectAll();
}

async function performStarSelected() {
  const targets = resolveSelectedEmails();
  if (targets.length === 0) return;
  const anyUnstarred = targets.some((e: Email) => !isStarredMail(e));
  try {
    // Serialized RMW: base the batch on the last landed write, not on the
    // component's snapshot - a concurrent star change survives the bulk edit.
    // The updater returns the ARRAY stored shape (parse is array-shaped).
    const updated = new Set(
      await updateStoredObject<string[]>(
        'starredEmails',
        (current) => {
          const next = new Set(current);
          for (const e of targets) {
            const addr = e.original_inbox || selectedEmail;
            const key = starKeyForEmail(e, addr);
            next.delete(e.id);
            if (anyUnstarred) next.add(key);
            else next.delete(key);
          }
          return Array.from(next);
        },
        parseStringList
      )
    );
    starredEmailIds = updated;
  } catch (e) {
    // Persist failed (e.g. quota) - keep the previous stars and tell the user
    // (same treatment as toggleStar; UI state was never optimistically moved).
    logError('performStarSelected failed to persist starredEmails', undefined, e as Error);
    showToast($t('toasts.starUpdateFailed'), 'error');
  }
}

function closeContextMenuOnly() {
  contextMenuOpen = false;
  contextMenuEmail = null;
  longPressEmail = null;
}

/** Open the per-email context menu at the pointer position (also selects the email). */
function clampContextMenuPosition(x: number, y: number): { x: number; y: number } {
  const menuW = 220;
  const menuH = 120;
  return {
    x: Math.min(x, Math.max(8, window.innerWidth - menuW)),
    y: Math.min(y, Math.max(8, window.innerHeight - menuH)),
  };
}

function openContextMenu(email: Email, x: number, y: number) {
  const next = new Set(selectedEmailIds);
  next.add(emailSelectionKey(email));
  selectedEmailIds = next;
  holdCtrl.armSuppression();
  // Clamp so the menu never renders off-screen.
  contextMenuPosition = clampContextMenuPosition(x, y);
  contextMenuEmail = email;
  contextMenuOpen = true;
}

function closeContextMenu() {
  contextMenuOpen = false;
  contextMenuEmail = null;
}

function createRuleFromContextMenu() {
  const sender = contextMenuEmail?.from || '';
  closeContextMenu();
  // Keep the email selected in the background; navigation happens in AppLayout.
  onCreateRuleFromEmail(sender);
}

/**
 * What the shell's selection strip and the sidebar's drops can do to this list.
 * A literal object, closured over the functions below - no in-place wiring, so
 * there is nothing to keep in sync at mount time.
 */
const selectionApi: SelectionApi = {
  cancel: () => deselectAll(),
  selectAll: () => selectAllVisible(),
  deselectAll: () => deselectAll(),
  run: (action) => {
    switch (action) {
      case 'archive':
        return performArchive();
      case 'delete':
        return performDelete();
      case 'restore':
        return performRestore();
      case 'star':
        return performStarSelected();
      case 'tag':
        return openLabelDialogForSelected();
      default:
        // The mailbox advertises only the actions handled above (see the publish
        // effect); an unknown one is inert rather than an exception.
        return;
    }
  },
  applyTag: (tag: string) => applyLabelToSelected(tag),
  // Keyboard: the cursor is DOM focus on the row (`data-selectable-row`), so the
  // mailbox owns no second copy of "which message am I on" beside the focus.
  moveFocus: moveMailboxCursor,
  hasFocusedRow: () => focusedRowId(listRootEl) !== null,
  focusedIsSelected: () => {
    const id = focusedRowId(listRootEl);
    return id !== null && selectedEmailIds.has(id);
  },
  setFocusedSelected: (selected) => {
    const id = focusedRowId(listRootEl);
    if (id === null || selected === selectedEmailIds.has(id)) return;
    toggleEmailSelection(id);
  },
};

function openLabelDialogForSelected() {
  const ids = [
    ...new Set(resolveSelectedEmails().map((email) => emailLabelKeyForEmail(email, selectedEmail))),
  ];
  if (ids.length === 0) return;
  labelDialogEmailId = ids[0] ?? null;
  labelDialogMultiIds = [...ids];
  labelDialogInput = '';
  labelDialogColor = '#6750a4';
  labelDialogColorTouched = false;
  emailLabelDialogOpen = true;
}

async function saveEmailLabels() {
  const labels = Array.from(
    new Set(
      labelDialogInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    )
  );
  const ids = labelDialogMultiIds?.length
    ? [...labelDialogMultiIds]
    : labelDialogEmailId
      ? [labelDialogEmailId]
      : [];
  if (ids.length === 0) return;
  const next: Record<string, string[]> = { ...emailLabelsMap };
  for (const id of ids) {
    if (labels.length === 0) {
      delete next[id];
    } else if (labelDialogMultiIds?.length) {
      const existing = Array.isArray(next[id]) ? next[id] : [];
      next[id] = [...new Set([...existing, ...labels])];
    } else {
      next[id] = labels;
    }
  }
  // Register any brand-new labels, using the color picked in the dialog.
  if (labels.length > 0) {
    const defs = mergeLabelsIntoCatalog(labelCatalog, labels);
    if (defs.length !== labelCatalog.length) {
      const known = new Set(labelCatalog.map((d) => d.name.toLowerCase()));
      const withColor = defs.map((d) =>
        known.has(d.name.toLowerCase()) ? d : { ...d, color: labelDialogColor }
      );
      labelCatalog = withColor;
      try {
        await setEmailLabelCatalog(withColor);
      } catch {
        /* storage write failure is non-fatal for the label itself */
      }
    }
  }
  await commitLabelsWithUndo(next, ids);
  closeEmailLabelDialog();
  if (selectionActive) closeContextMenuOnly();
}

let motionMqCleanup: (() => void) | null = null;
let scrollRaf = 0;

onMount(() => {
  loadStarredEmails();
  void loadConnectivityLog();
  void isMarqueeSelectionEnabled().then((v) => {
    marqueePrefEnabled = v;
  });
  const handleStorageChange = (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
    areaName: string
  ) => {
    if (areaName !== 'local') return;
    if (changes.starredEmails) loadStarredEmails();
    if (changes.connectivityLog) void loadConnectivityLog();
    if (changes.marqueeSelectionEnabled) {
      marqueePrefEnabled = changes.marqueeSelectionEnabled.newValue !== false;
    }
  };
  try {
    browser.storage.onChanged.addListener(handleStorageChange);
  } catch {
    /* ignore */
  }

  if (typeof window !== 'undefined' && window.matchMedia) {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReducedMotion = mq.matches;
    const onMq = () => {
      prefersReducedMotion = mq.matches;
    };
    mq.addEventListener?.('change', onMq);
    motionMqCleanup = () => mq.removeEventListener?.('change', onMq);
  }
  return () => {
    try {
      browser.storage.onChanged.removeListener(handleStorageChange);
    } catch {
      /* ignore */
    }
    motionMqCleanup?.();
  };
});

onDestroy(() => {
  verificationRequestId += 1;
  if (hoverTimer) clearTimeout(hoverTimer);
  holdCtrl.cancelAll();
  if (scrollRaf) cancelAnimationFrame(scrollRaf);
  // The selection bar is rendered by the shell, so a selection that outlives the
  // view would leave it on screen over the next page. Reset both published
  // objects to inert on the way out.
});
</script>

<svelte:window bind:innerWidth={windowWidth} bind:innerHeight={windowHeight} />

<div class="scroll-frame relative flex flex-col flex-1 min-h-0 h-full w-full" style="--strips-reserve: {stripReservePx}px;">
<div
  class="account-selector-container relative shrink-0 {containerBgClass} rounded-2xl p-2 mt-[7.5px] mb-[7.5px] transition-[max-height,opacity,margin,padding] duration-200 ease-out {addressBarCollapsed ? 'max-h-0 overflow-hidden opacity-0 pointer-events-none p-0 mt-0 mb-0' : 'max-h-screen overflow-visible opacity-100'}"
  role="none"
>
<div
  role="none"
  onmouseenter={() => { accountSelectorHovered = true; }}
  onmouseleave={() => { accountSelectorHovered = false; }}
>
<AddressSelector
  {selectedEmail}
  bind:displayedEmail
  {accounts}
  {defaultDomain}
  {allAddresses}
  {dropdownOpen}
  {onDropdownOpenChange}
  onSelectAddress={onSelectAddress}
  onEditAddress={onEditAddress}
  onManageTags={onManageTags}
  onToggleAutoExtend={onToggleAutoExtend}
  onArchiveAddress={onArchiveAddress}
  onUnarchiveAddress={onUnarchiveAddress}
  onRemoveAddress={onRemoveAddress}
  onRestoreAddress={onRestoreAddress}
  onCreateAddress={onCreateAddress}
  onNavigateToManage={onNavigateToManage}
  onReloadAddresses={onReloadAddresses}
  onMarkAllRead={async (account) => {
    try {
      const bag = await getStoredEmailsForAddress(account.id, account.address);
      // Queue + flush (not a bare get→set): a queued single-read flush for an
      // overlapping open would otherwise clobber this write, or vice versa.
      queueEmailReadStates(
        bag.map((e) => ({
          emailId: e.id,
          casings: [account.address, e.original_inbox],
          read: true,
        }))
      );
      await flushQueuedEmailReadState();
      showToast($t('addressView.markAllRead'));
      await onReloadAddresses();
    } catch {
      showToast($t('toasts.operationFailed'), 'error');
    }
  }}
  onMarkAllUnread={async (account) => {
    try {
      const bag = await getStoredEmailsForAddress(account.id, account.address);
      queueEmailReadStates(
        bag.map((e) => ({
          emailId: e.id,
          casings: [account.address, e.original_inbox],
          read: false,
        }))
      );
      await flushQueuedEmailReadState();
      showToast($t('addressView.markAllUnread'));
      await onReloadAddresses();
    } catch {
      showToast($t('toasts.operationFailed'), 'error');
    }
  }}
  {showToast}
  notificationsEnabled={notificationsEnabled}
  onToggleNotifications={onToggleNotifications}
  gesturesEnabled={gesturesEnabled}
/>
</div>

<!-- Primary address actions use S; keep their 40px targets and 12px baseline gap. -->
{#if !searchBarFocused && !selectionActive && (!actionRowCollapsed || accountSelectorHovered || actionRowHovered)}
<ButtonGroup
  class="mailbox-action-row pt-2 pb-2 transition-all duration-300 ease-in-out"
  style="opacity: {actionRowCollapsed && !accountSelectorHovered && !actionRowHovered ? '0' : '1'}; transform: {actionRowCollapsed && !accountSelectorHovered && !actionRowHovered ? 'translateY(-10px)' : 'translateY(0)'};"
  onmouseenter={() => { actionRowHovered = true; }}
  onmouseleave={() => { actionRowHovered = false; }}
  role="none"
>
  <!-- Copy Email -->
  <Btn
    id="button-copy-email"
    variant="primary"
    icon="contentCopy"
    label={$t('common.copy')}
    aria-label={$t('inbox.copyEmailAria')}
    title={$t('inbox.copyEmailAria')}
    onclick={(e) => { e.stopPropagation(); onCopyEmail(); }}
  />

  <!-- QR Code -->
  <Btn
    id="button-qr-code"
    variant="secondary"
    icon="qrCode2"
    label="QR"
    aria-label={$t('inbox.showQrAria')}
    title={$t('inbox.showQrAria')}
    onclick={(e) => { e.stopPropagation(); onOpenQrDialog(); }}
  />

  <!-- Archive/Unarchive -->
  {#if currentAddress}
    {#if currentAddress.accountStatus === 'archived'}
      <Btn
        id="button-unarchive"
        variant="tertiary"
        icon="unarchive"
        label={$t('common.unarchive')}
        aria-label={$t('inbox.unarchiveEmailAria')}
        title={canUnarchiveCurrent
          ? $t('inbox.unarchiveEmailAria')
          : $t('address.unarchiveNotAvailable')}
        disabled={!canUnarchiveCurrent}
        aria-disabled={!canUnarchiveCurrent}
        onclick={(e) => {
          e.stopPropagation();
          if (!canUnarchiveCurrent || !currentAddress) return;
          onUnarchiveAddress(currentAddress);
        }}
      />
    {:else}
      <Btn
        id="button-archive"
        variant="tertiary"
        icon="archive"
        label={$t('common.archive')}
        aria-label={$t('inbox.archiveEmailAria')}
        title={$t('inbox.archiveEmailAria')}
        onclick={(e) => { e.stopPropagation(); onArchiveAddress(currentAddress); }}
      />
    {/if}

    <!-- Forget Me / Restore -->
    {#if currentAddress.accountStatus === 'deleted'}
      <Btn
        id="button-restore"
        variant="danger"
        icon="back"
        label={$t('common.restore')}
        aria-label={$t('inbox.restoreEmailAria')}
        title={$t('inbox.restoreEmailAria')}
        onclick={(e) => { e.stopPropagation(); onRestoreAddress(currentAddress.address); }}
      />
    {:else}
      <Btn
        id="button-delete"
        variant="danger"
        icon="delete"
        label={$t('common.delete')}
        aria-label={$t('inbox.deleteEmailAria')}
        title={$t('inbox.deleteEmailAria')}
        onclick={(e) => { e.stopPropagation(); onRemoveAddress(currentAddress.address); }}
      />
    {/if}
  {/if}

</ButtonGroup>
{/if}

    <!-- Collapsible action row (auto-renew toggle + tag pill) -->
    {#if currentAddress && !searchBarFocused && !selectionActive && (!actionRowCollapsed || accountSelectorHovered || actionRowHovered)}
      <div
        class="transition-all duration-300 ease-in-out"
        style="opacity: {actionRowCollapsed && !accountSelectorHovered && !actionRowHovered ? '0' : '1'}; transform: {actionRowCollapsed && !accountSelectorHovered && !actionRowHovered ? 'translateY(-10px)' : 'translateY(0)'};"
        onmouseenter={() => { actionRowHovered = true; }}
        onmouseleave={() => { actionRowHovered = false; }}
        role="none"
      >
        <div class="flex w-full min-w-0 items-center gap-2 pe-8">
          <!-- Archived inboxes can explicitly resume supported renewal through the shared prompt. -->
          {#if supportsAutoRenew && currentAddress.accountStatus !== 'deleted'}
            <div class="shrink-0">
              <AutoRenewToggle
                autoRenew={currentAddress.autoExtend || false}
                showStateText={false}
                label={loadProviderConfig(currentAddress.provider).expiry?.renewalLabel === 'autoExtend' ? $t('activity.autoExtend') : $t('address.autoRenew')}
                onToggle={() => onToggleAutoExtend(currentAddress)}
              />
            </div>
          {/if}

          <ResponsiveMailboxTags
            account={currentAddress}
            {tagColors}
            tagAddresses={tagAddressUsage}
            onClick={openTagDialog}
          />
        </div>
      </div>
    {/if}

    <!-- Pin / Unpin: icon-only, inset bottom-end of account container - respects rounded-2xl -->
    {#if !searchBarFocused && !selectionActive && (!actionRowCollapsed || accountSelectorHovered || actionRowHovered)}
    <button
      id="button-collapse-toggle"
      type="button"
      class="reveal-toggle absolute end-0 bottom-0 z-10 m-0 w-7 h-7 flex items-center justify-center cursor-pointer rounded-full border border-md-outline-variant/60 {ELEVATION.level1} transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2 focus-visible:ring-offset-md-surface {actionRowCollapsed ? 'bg-md-primary text-md-on-primary hover:bg-md-primary/90 active:bg-md-primary/80' : 'bg-md-surface-container-high text-md-on-surface hover:bg-md-surface-container-highest active:bg-md-surface-variant'}"
      style="margin: 0; inset-inline-end: 6px; bottom: 6px;"
      onclick={(e) => { e.stopPropagation(); handleActionRowToggle(); }}
      onmouseenter={() => { actionRowHovered = true; }}
      onmouseleave={() => { actionRowHovered = false; }}
      aria-label={!actionRowCollapsed ? $t('inbox.hideActionRow') : $t('inbox.alwaysShowActionRow')}
      data-tooltip={!actionRowCollapsed ? $t('inbox.hideActionRow') : $t('inbox.alwaysShowActionRow')}
      aria-pressed={!actionRowCollapsed}
    >
      <Icon name={actionRowCollapsed ? 'keep' : 'keepOff'} class="w-4 h-4" />
    </button>
    {/if}
</div>

{#if hideHintDialogOpen}
  <ModalDialog
    open={true}
    title={$t('inbox.hideActionRowTitle')}
    maxWidth="xs"
    onClose={() => void dismissHideHint(false)}
  >
    <div class="space-y-3">
      <p class="text-sm text-md-on-surface-variant leading-relaxed">{$t('inbox.hideActionRowBody')}</p>
      <label class="flex items-center gap-2 text-sm text-md-on-surface-variant cursor-pointer select-none">
        <Checkbox bind:checked={hideHintDontShow} />
        {$t('inbox.dontShowAgain')}
      </label>
      <button
        type="button"
        class="w-full h-10 rounded-xl text-sm font-semibold bg-md-primary text-md-on-primary"
        onclick={() => void dismissHideHint(hideHintDontShow)}
      >{$t('common.confirm')}</button>
    </div>
  </ModalDialog>
{/if}


<!-- Search + Filter row -->
<div class="scroll-edge shrink-0" data-tour="search-filter">
<FilterList
  searchQuery={searchQuery}
  sortBy={sortBy}
  otpOnly={otpOnly}
  unreadOnly={unreadOnly}
  hasAttachment={hasAttachment}
  senderDomain={senderDomain}
  senderEmail={senderEmail}
  recipient={recipient}
  subject={subject}
  notSenderDomain={notSenderDomain}
  notSenderEmail={notSenderEmail}
  notRecipient={notRecipient}
  notSubject={notSubject}
  selectedSenders={selectedSenders}
  emails={emails}
  dateFrom={dateFrom}
  dateTo={dateTo}
  savedSearchFilters={savedSearchFilters}
  onSearchChange={(value: string) => onSearchChange(value)}
  onSortChange={(value: string) => { handleSortChange(value); }}
  onOtpOnlyChange={(value: boolean) => { onOtpOnlyChange(value); }}
  onUnreadOnlyChange={(value: boolean) => { onUnreadOnlyChange(value); }}
  onHasAttachmentChange={(value: boolean) => { onHasAttachmentChange(value); }}
  onSenderDomainChange={(value: string) => { onSenderDomainChange(value); }}
  onSelectedSendersChange={(value: string[]) => { onSelectedSendersChange(value); }}
  onDateFromChange={(value: string) => { onDateFromChange(value); }}
  onDateToChange={(value: string) => { onDateToChange(value); }}
  onClearFilters={onClearFilters}
  onSaveFilter={async (name: string, sq: string, otp: boolean, att: boolean, sd: string, df: string, dt: string, senders: string[], sort: string, rec: string, subj: string, unread: boolean) => {
    await onSaveFilter(name, sq, otp, att, sd, df, dt, senders, sort, rec, subj, unread);
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
  onFilterClick={() => { /* filter menu only - do not focus search */ }}
  onRefreshMailbox={onRefreshMailbox}
  emailsLoading={loading}
  onToggleNotifications={onToggleNotifications}
  notificationsEnabled={notificationsEnabled}
  currentAddress={currentAddress?.address || selectedEmail || ''}
>
{#snippet layoutMenu()}
    <IconButton
      icon="description"
      size="sm"
      ariaLabel={$t('attachmentLibrary.title')}
      title={$t('attachmentLibrary.title')}
      aria-haspopup="dialog"
      onclick={() => { attachmentLibraryOpen = true; }}
    />
    <div class="relative shrink-0">
      <button
        type="button"
        bind:this={viewMenuBtnEl}
        id="button-tab-view"
        aria-haspopup="menu"
        aria-expanded={viewDropdownOpen}
        aria-label={$t('inbox.layoutMenu')}
        title={$t('inbox.layoutMenu')}
        class="w-8 h-8 flex items-center justify-center rounded-full bg-md-surface text-md-on-surface/50 active:brightness-95 transition-colors mt-0 {controlSurface(
          viewDropdownOpen || threadGrouping || showStarredOnly
        )}"
        onclick={(e) => {
          e.stopPropagation();
          if (!viewDropdownOpen && viewMenuBtnEl) {
            const rect = viewMenuBtnEl.getBoundingClientRect();
            const menuW = 220;
            let left = rect.right - menuW;
            let top = rect.bottom + 4;
            if (left < 8) left = 8;
            if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
            if (top + 420 > window.innerHeight - 16) top = Math.max(8, rect.top - 420 - 4);
            viewMenuPos = { top, left };
          }
          viewDropdownOpen = !viewDropdownOpen;
          labelOverflowOpen = false;
        }}
      >
        <Icon name="gridView" class="w-4 h-4" />
      </button>
      {#if viewDropdownOpen}
        <button
          type="button"
          class="fixed inset-0 {PORTAL_Z_CLASS.navMenu} cursor-default bg-transparent"
          aria-label={$t('common.close')}
          onclick={() => {
            viewDropdownOpen = false;
            viewSortSubOpen = false;
            viewShowSubOpen = false;
          }}
        ></button>
        <div
          use:anchoredFlyout={{ anchor: () => viewMenuBtnEl, placement: 'bottom-end', onClose: () => { viewDropdownOpen = false; viewSortSubOpen = false; viewShowSubOpen = false; } }}
          class="menu-list fixed bg-md-surface-container-low border border-md-outline-variant/50 rounded-xl {ELEVATION.level2} {PORTAL_Z_CLASS.dialog} overflow-visible min-w-[210px] max-h-[70vh] overflow-y-auto"
          style="top: {viewMenuPos.top}px; left: {viewMenuPos.left}px;"
          role="menu"
          tabindex="-1"
        >
          <div
            class="w-full flex items-center gap-3 px-3 min-h-12 text-sm text-md-on-surface"
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
          <div class="w-full flex items-center gap-3 px-3 min-h-12 text-sm text-md-on-surface" data-menu-item>
            <Icon name="tag" class="w-3.5 h-3.5 shrink-0 text-md-on-surface-variant" />
            <span class="flex-1">{$t('inbox.viewOptions.showLabels')}</span>
            <Toggle
              size="sm"
              checked={!hideLabels}
              ariaLabel={$t('inbox.viewOptions.showLabels')}
              onChange={(v) => (hideLabels = !v)}
            />
          </div>
          <div class="w-full flex items-center gap-3 px-3 min-h-12 text-sm text-md-on-surface" data-menu-item>
            <Icon name="lock" class="w-3.5 h-3.5 shrink-0 text-md-on-surface-variant" />
            <span class="flex-1">{$t('inbox.viewOptions.showOtpLabels')}</span>
            <Toggle
              size="sm"
              checked={!hideOtpLabels}
              ariaLabel={$t('inbox.viewOptions.showOtpLabels')}
              onChange={(v) => (hideOtpLabels = !v)}
            />
          </div>
          <div class="w-full flex items-center gap-3 px-3 min-h-12 text-sm text-md-on-surface" data-menu-item>
            <Icon name="download" class="w-3.5 h-3.5 shrink-0 text-md-on-surface-variant" />
            <span class="flex-1">{$t('inbox.viewOptions.showAttachmentBadges')}</span>
            <Toggle
              size="sm"
              checked={!hideAttachmentBadges}
              ariaLabel={$t('inbox.viewOptions.showAttachmentBadges')}
              onChange={(v) => (hideAttachmentBadges = !v)}
            />
          </div>
          <div class="w-full flex items-center gap-3 px-3 min-h-12 text-sm text-md-on-surface" data-menu-item>
            <Icon name="threads" class="w-3.5 h-3.5 shrink-0 text-md-on-surface-variant" />
            <span class="flex-1">{$t('inbox.viewOptions.groupThreads')}</span>
            <Toggle
              size="sm"
              checked={threadGrouping}
              ariaLabel={$t('inbox.viewOptions.groupThreads')}
              onChange={(v) => {
                threadGrouping = v;
                expandedThreadIds = new Set();
                void writeWithRetry({ threadGrouping });
              }}
            />
          </div>
          <div class="w-full flex items-center gap-3 px-3 min-h-12 text-sm text-md-on-surface" data-menu-item>
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
          <div class="px-3 py-1 text-xs font-bold text-md-on-surface/40">{$t('inbox.viewOptions.stripsSection')}</div>
          <div class="w-full flex items-center gap-3 px-3 min-h-12 text-sm text-md-on-surface" data-menu-item>
            <Icon name="shield" class="w-3.5 h-3.5 shrink-0 text-md-on-surface-variant" />
            <span class="flex-1">{$t('inbox.viewOptions.showVerificationStrip')}</span>
            <Toggle
              size="sm"
              checked={!preferHideVerificationStrip}
              ariaLabel={$t('inbox.viewOptions.showVerificationStrip')}
              onChange={(v) => {
                preferHideVerificationStrip = !v;
                void writeWithRetry({ preferHideVerificationStrip });
              }}
            />
          </div>
          <div class="w-full flex items-center gap-3 px-3 min-h-12 text-sm text-md-on-surface" data-menu-item>
            <Icon name="edit" class="w-3.5 h-3.5 shrink-0 text-md-on-surface-variant" />
            <span class="flex-1">{$t('inbox.viewOptions.showAutofillStrip')}</span>
            <Toggle
              size="sm"
              checked={!preferHideAutofillStrip}
              ariaLabel={$t('inbox.viewOptions.showAutofillStrip')}
              onChange={(v) => {
                preferHideAutofillStrip = !v;
                void writeWithRetry({ preferHideAutofillStrip });
              }}
            />
          </div>
          <div class="border-t border-md-outline-variant/40 my-1"></div>

          <div
            class="relative"
            role="none"
            onmouseenter={(e) => { if (hasInlineFlyoutSpace(e.currentTarget, 140)) { viewShowSubOpen = true; viewSortSubOpen = false; } }}
          >
            <button
              type="button"
              class="w-full flex items-center gap-2 px-3 min-h-12 text-sm text-start hover:bg-md-surface-variant active:brightness-95 transition-colors text-md-on-surface"
              onclick={() => { viewShowSubOpen = !viewShowSubOpen; viewSortSubOpen = false; }}
            >
              <Icon name="chevronLeft" class="w-3.5 h-3.5 shrink-0 opacity-50 rtl-flip" />
              <Icon name="inbox" class="w-3.5 h-3.5 shrink-0" />
              <span class="flex-1">{$t('inbox.pageSize')}</span>
              <span class="text-xs text-md-on-surface/50 tabular-nums">{pageSize}</span>
            </button>
            {#if viewShowSubOpen}
              <div
                use:anchoredFlyout={{ placement: 'inline-start', onClose: () => { viewShowSubOpen = false; } }}
                class="absolute top-0 end-full me-1 bg-md-surface-container border border-md-outline-variant rounded-xl {ELEVATION.level2} {PORTAL_Z_CLASS.accountMenu} min-w-[140px] overflow-hidden"
                role="menu"
              >
                <button type="button" class="md-action w-full text-start p-2 text-sm text-md-primary" onclick={() => { viewShowSubOpen = false; }}><Icon name="back" class="inline w-4 h-4 rtl-flip" /> {$t('common.back')}</button>
                {#each PAGE_SIZE_OPTIONS as n (n)}
                  <button
                    type="button"
                    class="w-full flex items-center gap-2 px-3 min-h-12 text-sm text-start hover:bg-md-surface-variant active:brightness-95 {pageSize === n ? 'text-md-primary font-medium' : 'text-md-on-surface'}"
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
            onmouseenter={(e) => { if (hasInlineFlyoutSpace(e.currentTarget, 240)) { viewSortSubOpen = true; viewShowSubOpen = false; } }}
          >
            <button
              type="button"
              class="w-full flex items-center gap-2 px-3 min-h-12 text-sm text-start hover:bg-md-surface-variant active:brightness-95 transition-colors text-md-on-surface"
              onclick={() => { viewSortSubOpen = !viewSortSubOpen; viewShowSubOpen = false; }}
            >
              <Icon name="chevronLeft" class="w-3.5 h-3.5 shrink-0 opacity-50 rtl-flip" />
              <Icon name="schedule" class="w-3.5 h-3.5 shrink-0" />
              <span class="flex-1">{$t('inbox.viewOptions.sortSection')}</span>
            </button>
            {#if viewSortSubOpen}
              <div
                use:anchoredFlyout={{ placement: 'inline-start', onClose: () => { viewSortSubOpen = false; } }}
                class="absolute top-0 end-full me-1 bg-md-surface-container border border-md-outline-variant rounded-xl {ELEVATION.level2} {PORTAL_Z_CLASS.accountMenu} min-w-[240px] overflow-hidden p-1.5 space-y-1"
                role="menu"
              >
                <button type="button" class="md-action w-full text-start p-2 text-sm text-md-primary" onclick={() => { viewSortSubOpen = false; }}><Icon name="back" class="inline w-4 h-4 rtl-flip" /> {$t('common.back')}</button>
                <div class="flex items-center gap-2 px-1.5 py-1 rounded-lg">
                  <Icon name="schedule" class="w-3.5 h-3.5 shrink-0 text-md-on-surface/50" />
                  <span class="flex-1 min-w-0 text-xs font-semibold text-md-on-surface truncate">{$t('inbox.viewOptions.sortByDate')}</span>
                  <div class="flex items-stretch rounded-md border border-md-outline-variant/50 overflow-hidden shrink-0">
                    <button
                      type="button"
                      class="px-2 py-1 text-xs font-bold transition-colors {sortBy === 'newest' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface text-md-on-surface hover:bg-md-surface-variant active:brightness-95'}"
                      onclick={() => { handleSortChange('newest'); viewDropdownOpen = false; viewSortSubOpen = false; }}
                    >{$t('inbox.viewOptions.sortNewestShort')}</button>
                    <span class="w-px bg-md-outline-variant/60 shrink-0" aria-hidden="true"></span>
                    <button
                      type="button"
                      class="px-2 py-1 text-xs font-bold transition-colors {sortBy === 'oldest' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface text-md-on-surface hover:bg-md-surface-variant active:brightness-95'}"
                      onclick={() => { handleSortChange('oldest'); viewDropdownOpen = false; viewSortSubOpen = false; }}
                    >{$t('inbox.viewOptions.sortOldestShort')}</button>
                  </div>
                </div>
                <div class="flex items-center gap-2 px-1.5 py-1 rounded-lg">
                  <Icon name="person" class="w-3.5 h-3.5 shrink-0 text-md-on-surface/50" />
                  <span class="flex-1 min-w-0 text-xs font-semibold text-md-on-surface truncate">{$t('inbox.viewOptions.sortBySenderName')}</span>
                  <div class="flex items-stretch rounded-md border border-md-outline-variant/50 overflow-hidden shrink-0">
                    <button
                      type="button"
                      class="px-2 py-1 text-xs font-bold transition-colors {sortBy === 'senderNameAsc' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface text-md-on-surface hover:bg-md-surface-variant active:brightness-95'}"
                      onclick={() => { handleSortChange('senderNameAsc'); viewDropdownOpen = false; viewSortSubOpen = false; }}
                    >{$t('inbox.viewOptions.sortAscShort')}</button>
                    <span class="w-px bg-md-outline-variant/60 shrink-0" aria-hidden="true"></span>
                    <button
                      type="button"
                      class="px-2 py-1 text-xs font-bold transition-colors {sortBy === 'senderNameDesc' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface text-md-on-surface hover:bg-md-surface-variant active:brightness-95'}"
                      onclick={() => { handleSortChange('senderNameDesc'); viewDropdownOpen = false; viewSortSubOpen = false; }}
                    >{$t('inbox.viewOptions.sortDescShort')}</button>
                  </div>
                </div>
                <div class="flex items-center gap-2 px-1.5 py-1 rounded-lg">
                  <Icon name="mail" class="w-3.5 h-3.5 shrink-0 text-md-on-surface/50" />
                  <span class="flex-1 min-w-0 text-xs font-semibold text-md-on-surface truncate">{$t('inbox.viewOptions.sortBySenderEmail')}</span>
                  <div class="flex items-stretch rounded-md border border-md-outline-variant/50 overflow-hidden shrink-0">
                    <button
                      type="button"
                      class="px-2 py-1 text-xs font-bold transition-colors {sortBy === 'senderEmailAsc' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface text-md-on-surface hover:bg-md-surface-variant active:brightness-95'}"
                      onclick={() => { handleSortChange('senderEmailAsc'); viewDropdownOpen = false; viewSortSubOpen = false; }}
                    >{$t('inbox.viewOptions.sortAscShort')}</button>
                    <span class="w-px bg-md-outline-variant/60 shrink-0" aria-hidden="true"></span>
                    <button
                      type="button"
                      class="px-2 py-1 text-xs font-bold transition-colors {sortBy === 'senderEmailDesc' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface text-md-on-surface hover:bg-md-surface-variant active:brightness-95'}"
                      onclick={() => { handleSortChange('senderEmailDesc'); viewDropdownOpen = false; viewSortSubOpen = false; }}
                    >{$t('inbox.viewOptions.sortDescShort')}</button>
                  </div>
                </div>
                <div class="flex items-center gap-2 px-1.5 py-1 rounded-lg">
                  <Icon name="mail" class="w-3.5 h-3.5 shrink-0 text-md-on-surface/50" />
                  <span class="flex-1 min-w-0 text-xs font-semibold text-md-on-surface truncate">{$t('inbox.viewOptions.sortBySubject')}</span>
                  <div class="flex items-stretch rounded-md border border-md-outline-variant/50 overflow-hidden shrink-0">
                    <button
                      type="button"
                      class="px-2 py-1 text-xs font-bold transition-colors {sortBy === 'subjectAsc' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface text-md-on-surface hover:bg-md-surface-variant active:brightness-95'}"
                      onclick={() => { handleSortChange('subjectAsc'); viewDropdownOpen = false; viewSortSubOpen = false; }}
                    >{$t('inbox.viewOptions.sortAscShort')}</button>
                    <span class="w-px bg-md-outline-variant/60 shrink-0" aria-hidden="true"></span>
                    <button
                      type="button"
                      class="px-2 py-1 text-xs font-bold transition-colors {sortBy === 'subjectDesc' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface text-md-on-surface hover:bg-md-surface-variant active:brightness-95'}"
                      onclick={() => { handleSortChange('subjectDesc'); viewDropdownOpen = false; viewSortSubOpen = false; }}
                    >{$t('inbox.viewOptions.sortDescShort')}</button>
                  </div>
                </div>
              </div>
            {/if}
          </div>
          <div class="border-t border-md-outline-variant/40 my-1"></div>
          <button
            type="button"
            class="w-full flex items-center gap-2 px-3 min-h-12 text-sm text-start text-md-error hover:bg-md-error/10 active:bg-md-error/30 rounded-b-xl"
            onclick={() => resetLayoutSettings()}
          >
            <Icon name="refresh" class="w-3.5 h-3.5" />
            {$t('common.reset')}
          </button>
        </div>
      {/if}
    </div>
{/snippet}
</FilterList>
</div>

<!-- Status tabs + labels: hidden when sidebar owns them (except during search) -->
{#if !$sidebarTabsVisible}
<div class="scroll-edge shrink-0 px-0 py-1" data-tour="email-list-tabs">
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
        ondragover={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; }}
        ondrop={(e) => {
          e.preventDefault();
          if (!selectionActive) return;
          emailListTab = 'all';
          activeLabelFilter = null;
        }}
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
        ondragover={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; }}
        ondrop={(e) => {
          e.preventDefault();
          if (!selectionActive) return;
          if (emailListTab === 'archived' || emailListTab === 'deleted') performRestore();
          emailListTab = 'inbox';
          activeLabelFilter = null;
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
        ondragover={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; }}
        ondrop={(e) => {
          e.preventDefault();
          if (!selectionActive) return;
          if (emailListTab !== 'archived') performArchive();
          emailListTab = 'archived';
          activeLabelFilter = null;
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
        ondragover={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; }}
        ondrop={(e) => {
          e.preventDefault();
          if (!selectionActive) return;
          if (emailListTab !== 'deleted') performDelete();
          emailListTab = 'deleted';
          activeLabelFilter = null;
        }}
      >
        {$t('inbox.listTabs.deleted', { values: { count: tabCounts.deleted } })}
      </button>

      {#if tabCounts.storedLocally > 0}
        <button
          id="button-tab-stored-locally"
          role="tab"
          aria-selected={emailListTab === 'storedLocally'}
          aria-label={$t('inbox.listTabs.storedLocally', { values: { count: tabCounts.storedLocally } })}
          class="{chip} {emailListTab === 'storedLocally' ? tabOn : tabOff}"
          onclick={() => { emailListTab = 'storedLocally'; activeLabelFilter = null; }}
        >
          {$t('inbox.listTabs.storedLocally', { values: { count: tabCounts.storedLocally } })}
        </button>
      {/if}

      {#each inlineLabels as lab (lab)}
        {@const labCount = labelCountInStatusTab(lab)}
        <button
          type="button"
          class="text-xs px-2 py-1 rounded-full max-w-[120px] truncate whitespace-nowrap shrink-0 {activeLabelFilter === lab ? 'bg-md-tertiary text-md-on-tertiary' : 'bg-md-tertiary-container text-md-on-tertiary-container'} hover:opacity-90 transition-colors"
          title={`${lab} (${labCount})`}
          onclick={() => { activeLabelFilter = activeLabelFilter === lab ? null : lab; }}
          ondragover={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; }}
          ondrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void applyLabelToSelected(lab);
            activeLabelFilter = lab;
          }}
        ><span class="inline-block w-2 h-2 rounded-full me-1 align-middle shrink-0" style="background-color: {labelColor(lab)};"></span>{lab} ({labCount})</button>
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
              class="fixed inset-0 {PORTAL_Z_CLASS.navMenu} bg-transparent cursor-default"
              aria-label={$t('common.close')}
              onclick={() => (labelOverflowOpen = false)}
            ></button>
            <div use:anchoredFlyout={{ onClose: () => { labelOverflowOpen = false; } }} class="absolute start-0 top-full mt-1 {PORTAL_Z_CLASS.accountMenu} min-w-[120px] max-h-48 overflow-y-auto rounded-xl border border-md-outline-variant bg-md-surface {ELEVATION.level2} p-1">
              {#each overflowLabels as lab (lab)}
                {@const labCount = labelCountInStatusTab(lab)}
                <button
                  type="button"
                  class="w-full text-start px-2.5 py-1.5 text-sm rounded-lg truncate {rowSurface({ active: activeLabelFilter === lab })}
                    {activeLabelFilter === lab ? 'text-md-tertiary font-semibold' : 'text-md-on-surface'}"
                  title={`${lab} (${labCount})`}
                  onclick={() => {
                    activeLabelFilter = activeLabelFilter === lab ? null : lab;
                    labelOverflowOpen = false;
                  }}
                  ondragover={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; }}
                  ondrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void applyLabelToSelected(lab);
                    activeLabelFilter = lab;
                    labelOverflowOpen = false;
                  }}
                >{lab} ({labCount})</button>
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

<!-- Email list: flex-1, full height - strips and nav float over it. End-of-list spacer inside EmailList handles clearance. -->
<div class="flex-1 min-h-0 h-full w-full flex flex-col relative">
{#if crossMailboxSearchActive}
  <div class="scroll-body scroll-body-framed flex-1 min-h-0 overflow-y-auto space-y-2 pb-2">
    {#each crossMailboxGroups as group (group.address)}
      {@const visibleKey = group.address.toLowerCase()}
      {@const visibleCount = crossMailboxVisibleCounts[visibleKey] || CROSS_MAILBOX_INITIAL_ROWS}
      <div class="rounded-xl border border-md-outline-variant/40 overflow-hidden bg-md-surface-container-low">
        <button
          type="button"
          class="w-full flex items-center gap-2 px-3 py-2 text-start hover:bg-md-surface-variant/50 active:bg-md-surface-variant/70 transition-colors"
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
            <div class="scroll-body max-h-[40vh] overflow-y-auto border-t border-md-outline-variant/30">
              <div class="space-y-1 p-1">
                {#each group.emails.slice(0, visibleCount) as mail, i (mail.id)}
                  {@const selectionKey = emailSelectionKey(mail)}
                  {@const isSelected = selectedEmailIds.has(selectionKey)}
                  <div
                    data-marquee-id={selectionKey}
                    data-selected={isSelected ? 'true' : 'false'}
                    class="mailbox-row-enter flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer {mailRowSurfaceClass({ selected: isSelected, active: false, highlighted: false, unread: false })}"
                    style="animation-delay: {Math.min(i * 15, 300)}ms"
                    role="button"
                    tabindex="0"
                    onclick={(e) => {
                      // Star presses must not open the message - same guard as the main row.
                      if ((e.target as HTMLElement)?.closest?.('[data-star-btn]')) return;
                      if (selectionActive) {
                        e.stopPropagation();
                        toggleEmailSelection(selectionKey);
                      } else {
                        onOpenMessageDetail([mail]);
                      }
                    }}
                    oncontextmenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      openContextMenu(mail, e.clientX, e.clientY);
                    }}
                    onkeydown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (selectionActive) toggleEmailSelection(selectionKey);
                        else onOpenMessageDetail([mail]);
                      }
                    }}
                  >                      <button
                        type="button"
                        class="{AVATAR_BOX.row} rounded-full [perspective:600px] bg-transparent border-0 p-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-md-primary/30 shrink-0"
                      aria-label={$t('inbox.emailActions.selectAll')}
                      aria-pressed={selectedEmailIds.has(selectionKey)}
                      onclick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        toggleEmailSelection(selectionKey);
                      }}
                    >
                      <div
                        class="flip-card w-full h-full relative transition-transform duration-300 [transform-style:preserve-3d] {selectedEmailIds.has(selectionKey)
                          ? '[transform:rotateY(180deg)]'
                          : ''}"
                      >
                        <!-- Front Face: letter avatar - single Avatar source -->
                        <div
                          class="absolute inset-0 [backface-visibility:hidden] rounded-full overflow-hidden"
                        >
                          <Avatar size="row" letter={avatarInitial(mail.from_name || mail.from, '?')} email={mail.from || mail.from_name || ''} />
                        </div>
                        <!-- Back Face: tick checkmark -->
                        <div
                          class="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)] rounded-full bg-md-secondary text-md-on-secondary flex items-center justify-center"
                        >
                          <Icon name="check" class="{AVATAR_INK.row} text-md-on-secondary" />
                        </div>
                      </div>
                    </button>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center justify-between gap-2">
                        <span class="text-xs font-bold {isSelected ? SELECTED_ROW_INK.subject : 'text-md-on-surface'} truncate">{@html highlightMatches(mail.subject || $t('addressView.noSubject'), highlightTerms)}</span>
                        <span class="text-xs {isSelected ? SELECTED_ROW_INK.meta : 'text-md-on-surface/50'} shrink-0">{mail.time}</span>
                      </div>
                      <p class="text-xs {isSelected ? SELECTED_ROW_INK.sender : 'text-md-on-surface/60'} truncate leading-tight mt-0.5">{@html highlightMatches(getDisplayName(mail.from || '', mail.from_name), highlightTerms)}</p>
                    </div>
                    <!-- Star button: identical geometry to the main row star -
                         20px glyph + p-0.5 = 24px box; spacing comes from the row gap. -->
                    <button
                      type="button"
                      data-star-btn
                      class="flex flex-shrink-0 self-center items-center justify-center p-0.5 rounded-full transition-colors hover:bg-md-surface-variant/40 active:bg-md-surface-variant/60 cursor-pointer border-0 bg-transparent {mailRowStarClass({ selected: isSelected, starred: isStarredMail(mail) })} {starPopId === mail.id ? 'star-pop' : ''}"
                      onclick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        void toggleStar(mail);
                      }}
                      aria-pressed={isStarredMail(mail)}
                      aria-label={$t('inbox.emailActions.star')}
                      title={$t('inbox.emailActions.star')}
                    >
                      <Icon name="star" class="w-5 h-5 transition-colors duration-150 pointer-events-none" filled={isStarredMail(mail)} />
                    </button>
                  </div>
                {/each}
                {#if group.emails.length > visibleCount}
                  <button
                    type="button"
                    class="w-full min-h-9 rounded-lg text-xs font-semibold text-md-primary hover:bg-md-surface-variant/50 active:bg-md-surface-variant/70"
                    onclick={() => loadMoreCrossMailbox(group.address)}
                  >
                    {$t('emailList.loadMore')} ({group.emails.length - visibleCount})
                  </button>
                {/if}
              </div>
            </div>
          {/if}
        {/if}
      </div>
    {:else}
      <p class="text-center text-sm text-md-on-surface/50 py-8">{$t('inbox.noMatchingResults')}</p>
    {/each}
    <div
      class="w-full shrink-0 transition-[height] duration-200 ease-in-out pointer-events-none"
      style="height: calc(var(--bottom-safe-area, 0px) + var(--selection-bar-offset, 0px) + {totalBottomSpacerHeightPx}px + 12px);"
      aria-hidden="true"
    ></div>
  </div>
{:else}
  <div class="relative flex flex-col flex-1 min-h-0">
    {#if pullDistance > 0 || pullRefreshing}
      {@const ready = pullDistance > 60 || pullRefreshing}
      <div
        class="pull-refresh-band absolute top-0 inset-x-0 flex items-center justify-center py-2 z-10 pointer-events-none"
        style="opacity: {pullRefreshing ? 1 : Math.min(pullDistance / 60, 1)}; transform: translateY({pullRefreshing ? 28 : Math.min(pullDistance * 0.55, 48)}px);"
      >
        <span
          class="pull-refresh-icon {ready && !pullRefreshing ? 'is-ready' : ''} {pullRefreshing ? 'animate-spin' : ''}"
          style={pullRefreshing ? '' : `transform: rotate(${refreshRotation}deg);`}
        >
          {#if ready && !pullRefreshing}
            <Icon name="checkCircle" class="w-5 h-5 text-md-success" />
          {:else}
            <Icon name="refresh" class="w-5 h-5 text-md-primary" />
          {/if}
        </span>
        <span class="text-xs font-semibold ms-2 {ready ? 'text-md-success' : 'text-md-primary'}">
          {pullRefreshing
            ? ($t('common.loading'))
            : ready
              ? ($t('emailList.releaseToRefresh'))
              : ($t('emailList.pullToRefresh'))}
        </span>
      </div>
    {/if}

    <div
      bind:this={listRootEl}
      class="scroll-body scroll-body-framed flex-1 min-h-0 h-full w-full px-0 border-t border-md-outline-variant/30 relative flex flex-col {displayedEmails.length === 0 && !loading ? 'overflow-hidden' : 'overflow-y-auto'}"
      onpointerdown={onMarqueePointerDown}
      role="region"
      aria-label={$t('common.emailList')}
      use:pullToRefresh={{
        isRefreshing: () => pullRefreshing,
        onProgress: (distance) => {
          pullDistance = distance;
        },
        onRefresh: async () => {
          pullRefreshing = true;
          try {
            await onRefreshMailbox();
          } finally {
            pullRefreshing = false;
          }
        },
        onReset: () => {
          pullDistance = 0;
        },
      }}
      onscroll={(e) => {
        handleMouseLeave();
        const container = e.currentTarget as HTMLElement | null;
        if (!container) return;
        const scrollBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        if (isVirtualized) {
          virtualScrollTop = container.scrollTop;
          virtualViewportHeight = container.clientHeight;
        } else if (scrollBottom < 100 && displayedEmailCount < tabFilteredEmails.length) {
          loadMoreEmails();
        }
        if (scrollRaf) cancelAnimationFrame(scrollRaf);
        scrollRaf = requestAnimationFrame(() => {
          const top = container.scrollTop;
          const delta = top - lastScrollTop;
          if (Math.abs(delta) > 8) {
            const dir = delta > 0 && top > 24 ? 'down' : 'up';
            handleAddressBarScroll(dir, top);
            onScrollDirection(dir, top <= 24);
            lastScrollTop = top;
          }
        });
      }}
    >
      {#if loading && displayedEmails.length === 0}
        <div class="py-2 space-y-2">
          {#each Array(mailSkeletonCount) as _, i (i)}
            <div class="py-2 border-b border-md-outline-variant/30 px-3">
              <div class="flex justify-between mb-1">
                <Skeleton width="6rem" height="0.75rem" />
                <Skeleton width="3rem" height="0.75rem" />
              </div>
              <Skeleton width="75%" height="1rem" />
            </div>
          {/each}
        </div>
      {:else if displayedEmails.length === 0}
        {#if noResultsRecovery}
          <div class="flex items-center justify-center gap-2 px-3 py-2.5 text-xs" role="note">
            <span class="text-md-on-surface/60">
              {$t('inbox.noResultsTryWithout', {
                values: { n: noResultsRecovery.count, pill: noResultsRecovery.lastPill },
              })}
            </span>
            <button
              type="button"
              class="inline-flex items-center gap-1 px-2 py-1 rounded-lg font-semibold bg-md-error/15 text-md-error hover:bg-md-error/25 active:bg-md-error/45 transition-colors shrink-0"
              onclick={() => {
                // Keep chips in lockstep with the pill we're dropping (same
                // rule as FilterList.removePill) so the filter actually clears.
                const pill = noResultsRecovery.lastPill.toLowerCase();
                if (pill === 'is:otp' || pill === '!is:otp') onOtpOnlyChange(false);
                else if (pill === 'has:attachment' || pill === '!has:attachment')
                  onHasAttachmentChange(false);
                onSearchChange(noResultsRecovery.withoutLast);
              }}
            >
              <Icon name="close" class="w-3 h-3" />
              {$t('inbox.noResultsRemovePill', { values: { pill: noResultsRecovery.lastPill } })}
            </button>
          </div>
        {/if}
        <EmptyState
          fillParent
          icon={emailListTab === 'archived' ? 'archive' : emailListTab === 'deleted' ? 'delete' : 'mail'}
          title={emailListTab === 'archived' ? $t('emailList.noArchived') : emailListTab === 'deleted' ? $t('emailList.noDeleted') : emailListTab === 'inbox' ? $t('emailList.inboxEmpty') : $t('emailList.noEmailsFound')}
          description={emailListTab === 'archived' ? $t('emailList.swipeArchiveHint') : emailListTab === 'deleted' ? $t('emailList.swipeDeleteHint') : searchQuery || otpOnly || hasAttachment ? $t('emailList.adjustFiltersHint') : emailListTab === 'inbox' ? $t('emailList.emptyInboxHint') : $t('emailList.emptyInboxAllHint')}
          actionLabel={(emailListTab === 'inbox' || emailListTab === 'all') && (searchQuery || otpOnly || hasAttachment) ? $t('emailList.clearFilters') : undefined}
          onAction={(emailListTab === 'inbox' || emailListTab === 'all') && (searchQuery || otpOnly || hasAttachment) ? onClearFilters : undefined}
        />
      {:else}
        {#if isVirtualized && virtualWindow.paddingBefore > 0}
          <div
            class="shrink-0"
            style="height: {virtualWindow.paddingBefore}px;"
            aria-hidden="true"
          ></div>
        {/if}
        {#each (isVirtualized ? virtualWindow.rows : emailsWithGaps) as row, index (row.kind === 'email' ? row.email.id : `gap-${isVirtualized ? virtualWindow.start + index : index}`)}
          <div
            data-virtual-row-index={isVirtualized ? virtualWindow.start + index : index}
            class="shrink-0"
          >
          {#if row.kind === 'offlineGap'}
            <div
              class="shrink-0 flex items-center justify-center gap-2 px-2 py-1.5 text-label-sm text-md-on-surface-variant/70 bg-md-surface-variant/30 border-b border-md-outline-variant/30"
              role="note"
              aria-label={$t('inbox.offlineGapLabel', { values: { from: formatGapTime(row.fromTs), to: formatGapTime(row.toTs) } })}
            >
              <Icon name="wifiOff" class="w-3.5 h-3.5 shrink-0" />
              <span class="truncate">
                {$t('inbox.offlineGapLabel', {
                  values: { from: formatGapTime(row.fromTs), to: formatGapTime(row.toTs) },
                })}
              </span>
            </div>
          {:else}
          {@const mail = row.email}
          {@const isSelected = selectedEmailIds.has(mail.id)}
          {@const rowInk = {
            subject: isSelected ? SELECTED_ROW_INK.subject : mail.unread ? 'text-md-on-surface' : 'text-md-on-surface/70',
            sender: isSelected ? SELECTED_ROW_INK.sender : mail.unread ? 'text-md-on-surface' : 'text-md-on-surface/50',
            preview: isSelected ? SELECTED_ROW_INK.preview : 'text-md-on-surface/60',
            meta: isSelected ? SELECTED_ROW_INK.meta : mail.unread ? 'text-md-on-surface/60' : 'text-md-on-surface/40',
          }}
          {#if threadGrouping}
            {@const thread = emailThreadIndexes.byLatestEmailId.get(mail.id)}
            {#if thread && thread.emails.length > 1}
              <div class="flex items-center justify-between px-2 py-1 bg-md-secondary-container/40 border-b border-md-outline-variant/30">
                <span class="text-xs font-semibold text-md-primary/80 truncate max-w-[65%]">
                  {thread.normalizedSubject || $t('addressView.noSubject')}
                </span>
                <button
                  class="flex items-center gap-1 text-xs text-md-on-surface/60 hover:text-md-primary transition-colors flex-shrink-0"
                  onclick={(e) => { e.stopPropagation(); toggleThread(thread.id); }}
                  aria-label={$t('common.toggleThread')}
                >
                  <span class="bg-md-primary/15 text-md-primary font-semibold px-1.5 py-0.5 rounded-full">{thread.emails.length}</span>
                  {#if expandedThreadIds.has(thread.id)}
                    <Icon name="chevronUp" class="w-3 h-3" />
                  {:else}
                    <Icon name="chevronDown" class="w-3 h-3" />
                  {/if}
                </button>
              </div>
            {/if}
          {/if}
          <div
            class="relative shrink-0 min-h-[60px] overflow-hidden border-b border-md-outline-variant/50 density-row {exitingEmailIds.has(row.email.id) ? 'email-row-exit' : ''} {threadGrouping && emailThreadIndexes.byNestedEmailId.has(row.email.id) ? 'ps-3 bg-md-surface-variant/20' : ''} {emailPreviewMode === 'expanded' ? 'email-row-expandable' : ''}"
            id="email-item-{row.email.id}"
            data-selectable-row={row.email.id}
            tabindex="-1"
          >
            {#if swipingEmail === mail && swipeDirection}
              {@const isRestoreTab = emailListTab === 'archived' || emailListTab === 'deleted'}
              {@const rtl = isDocumentRtl()}
              {@const isDeleteSwipe = !isRestoreTab && ((!rtl && swipeDirection === 'left') || (rtl && swipeDirection === 'right'))}
              {@const isArchiveSwipe = !isRestoreTab && !isDeleteSwipe}
              <div
                class="absolute inset-0 flex items-center gap-2 px-4 transition-colors duration-200 {isDeleteSwipe ? 'justify-end bg-md-error' : ''} {isArchiveSwipe ? 'justify-start bg-md-tertiary' : ''} {isRestoreTab ? (swipeDirection === 'left' ? 'justify-end' : 'justify-start') + ' bg-md-primary' : ''}"
                style="opacity: {Math.abs(swipeDistance) / 120};"
              >
                {#if isRestoreTab}
                  <Icon name="refresh" class="w-6 h-6 text-white" />
                  <span class="text-white font-medium text-sm">{$t('common.restore')}</span>
                {:else if isDeleteSwipe}
                  <Icon name="delete" class="w-6 h-6 text-white" />
                  <span class="text-white font-medium text-sm">{$t('common.delete')}</span>
                {:else}
                  <Icon name="archive" class="w-6 h-6 text-white" />
                  <span class="text-white font-medium text-sm">{$t('common.archive')}</span>
                {/if}
              </div>
            {/if}

            <div
              id="email-button-{mail.id}"
              data-row-primary
              data-marquee-id={mail.id}
              role="button"
              tabindex="0"
              aria-label={$t('common.emailFromSubject', { values: { from: mail.from, subject: mail.subject } })}
              class="w-full shrink-0 min-h-[60px] text-start border-0 focus:outline-none duration-150 {mailRowSurfaceClass({ selected: isSelected, active: mail.id === activeThreadMessageId && (mail.original_inbox || selectedEmail).toLowerCase() === (activeThreadInbox || selectedEmail).toLowerCase(), highlighted: mail.id === highlightedEmailId, unread: !!mail.unread })} {isSelected ? 'rounded-lg' : 'rounded-none'} py-2 px-2.5 flex items-center gap-2"
              data-selected={isSelected ? 'true' : 'false'}
              style="transform: translateX({swipingEmail === mail ? swipeDistance : 0}px); transition: {swipeActionTriggered ? 'transform 0.3s' : 'none'}; user-select: none;"
              onmouseenter={(e) => handleMouseEnter(mail, e)}
              onmouseleave={() => {
                handleMouseLeave();
                handleLongPressEnd();
                handleSwipeEnd();
              }}
              onclick={(e) => {
                if ((e.target as HTMLElement)?.closest?.('[data-star-btn]')) return;
                if (marqueeActive || marqueeDidSelect) {
                  marqueeDidSelect = false;
                  return;
                }
                if (holdCtrl.isSuppressingClick()) return;
                e.stopPropagation();
                if (Math.abs(swipeDistance) > 5) return;
                if (selectionActive) {
                  toggleEmailSelection(mail.id);
                } else {
                  const thread = threadGrouping ? emailThreadIndexes.byEmailId.get(mail.id) : null;
                  onOpenMessageDetail(thread ? thread.emails : [mail]);
                }
              }}
              ontouchstart={(e) => {
                handleLongPressStart(mail, e);
                handleSwipeStart(mail, e);
              }}
              ontouchend={() => {
                handleLongPressEnd();
                handleSwipeEnd();
              }}
              ontouchmove={(e) => {
                handleLongPressEnd();
                handleSwipeMove(e);
              }}
              onmousedown={(e) => {
                if ((e.target as HTMLElement)?.closest?.('[data-star-btn]')) return;
                handleLongPressStart(mail, e);
                handleSwipeStart(mail, e);
              }}
              onmouseup={() => {
                handleLongPressEnd();
                handleSwipeEnd();
              }}
              onmousemove={(e) => {
                if (e.buttons === 1) handleSwipeMove(e);
              }}
              draggable={true}
              ondragstart={(e) => {
                if (!selectedEmailIds.has(mail.id)) {
                  // A drag from outside the current selection adds that row to
                  // the live selection; folder/label drops then apply to the
                  // selected group plus the row the user actually dragged.
                  const next = new Set(selectedEmailIds);
                  next.add(mail.id);
                  selectedEmailIds = next;
                }
                if (e.dataTransfer) {
                  e.dataTransfer.effectAllowed = 'copyMove';
                  const selectedIds = Array.from(selectedEmailIds);
                  e.dataTransfer.setData('text/plain', selectedIds.join(','));
                  e.dataTransfer.setData('application/x-1click-mail-ids', JSON.stringify(selectedIds));
                  try {
                    const firstSubject = mail.subject || $t('emailList.noSubject');
                    const extra = Math.max(0, selectedIds.length - 1);
                    const label = extra > 0 ? `${firstSubject} +${extra}` : firstSubject;
                    const preview = document.createElement('div');
                    preview.className = 'drag-mail-preview';
                    // No z-index: this node is only ever the drag IMAGE - it is
                    // appended to document.body (outside the app shell), parked
                    // off-screen and removed on the next tick, so it competes with
                    // nothing. An invented number here is invisible to the z scale
                    // (see scripts/audit-z-layers.ts) and can only ever be wrong.
                    preview.style.cssText = 'position:fixed;top:-9999px;left:-9999px;max-width:220px;padding:6px 10px;border-radius:10px;background:var(--md-surface-container-high,#2b2930);color:var(--md-on-surface,#e6e1e5);font:12px/1.3 system-ui,sans-serif;font-weight:600;box-shadow:var(--md-elevation-2);pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
                    preview.textContent = label;
                    document.body.appendChild(preview);
                    e.dataTransfer.setDragImage(preview, 16, 12);
                    setTimeout(() => preview.remove(), 0);
                  } catch { /* ignore */ }
                }
              }}
              oncontextmenu={(e) => {
                e.preventDefault();
                const next = new Set(selectedEmailIds);
                next.add(mail.id);
                selectedEmailIds = next;
              }}
              onkeydown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (selectionActive) toggleEmailSelection(mail.id);
                  else {
                    const thread = threadGrouping
                      ? emailThreadIndexes.byEmailId.get(mail.id)
                      : null;
                    onOpenMessageDetail(thread ? thread.emails : [mail]);
                  }
                }
              }}
            >
              <div class="flex items-center gap-2 px-0 py-0.5 flex-1 min-w-0">
                {#if mail.from}
                  {@const letter = avatarInitial(mail.from_name || mail.from, '?')}
                  {@const letterBg = mail.unread ? avatarColor(mail.from) : AVATAR_MUTED}
                  <button
                    type="button"
                    class="flex-shrink-0 {AVATAR_BOX.row} rounded-full [perspective:600px] bg-transparent border-0 p-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-md-primary/30 shrink-0"
                    aria-label={$t('inbox.emailActions.selectAll')}
                    aria-pressed={isSelected}
                    onclick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      toggleEmailSelection(mail.id);
                    }}
                  >
                    <div
                      class="flip-card w-full h-full relative transition-transform duration-300 [transform-style:preserve-3d] {isSelected
                        ? '[transform:rotateY(180deg)]'
                        : ''}"
                    >
                      <!-- Front Face: sender letter / favicon avatar -->
                      <div
                        class="absolute inset-0 [backface-visibility:hidden] rounded-full overflow-hidden {showFavicons ? '' : letterBg}"
                      >
                        {#if showFavicons}
                          <!-- FaviconImage owns the fallback letter/bg - outer bg removed to avoid double paint.
                               Both the row and this favicon take AVATAR_BOX.row, so the box
                               and the painted size cannot disagree. -->
                          <FaviconImage
                            email={mail.from}
                            size="row"
                            enabled={showFavicons}
                            class="pointer-events-none"
                            fallbackLetter={letter}
                            fallbackColor={letterBg}
                          />
                        {:else}
                          <Avatar size="row" letter={letter} email={mail.from} color={letterBg} class="pointer-events-none" />
                        {/if}
                      </div>
                      <!-- Back Face: tick checkmark -->
                      <div
                        class="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)] rounded-full bg-md-secondary text-md-on-secondary flex items-center justify-center"
                      >
                        <Icon name="check" class="{AVATAR_INK.row} text-md-on-secondary" />
                      </div>
                    </div>
                  </button>
                {/if}

                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between gap-1 mb-0.5">
                    <span class="text-sm font-bold {rowInk.subject} truncate leading-tight">
                      {@html highlightMatches(mail.subject || $t('addressView.noSubject'), highlightTerms)}
                    </span>
                    <span
                      class="text-xs font-medium cursor-help {rowInk.meta} flex-shrink-0"
                      title={formatFullDateTime(mail.received_at)}
                    >
                      {mail.time || timeAgo(mail.received_at ? toMs(mail.received_at) : Date.now())}
                    </span>
                  </div>
                  <p class="text-xs {mail.unread ? 'font-semibold ' : ''}{rowInk.sender} truncate leading-tight">
                    {@html highlightMatches(getDisplayName(mail.from || '', mail.from_name), highlightTerms)}
                  </p>
                  {#if true}
                    {@const bodyPreview = emailBodyPreview(mail)}
                    {@const showOtpPill = !hideOtpLabels && !!(mail.otp || mail.otpCandidate)}
                    {@const showAttachmentPill =
                      !hideAttachmentBadges &&
                      ((Array.isArray(mail.attachments) && mail.attachments.length > 0) ||
                        mail.hasAttachment)}
                    {@const showMagicPill = !!(mail.hasMagicLink || (mail.magicLinks && mail.magicLinks.length > 0))}
                    {@const showLocalPill = !!mail.local_only}
                    {@const labelList = !hideLabels ? (emailLabelsMap[emailLabelKeyForEmail(mail, selectedEmail)] || []) : []}
                    {@const maxRowTags = 1}
                    {@const visibleLabels = labelList.slice(0, maxRowTags)}
                    {@const overflowLabels = labelList.slice(maxRowTags)}
                    {@const hasBadgeRow =
                      showOtpPill || mail.couponCode || mail.isReminder || mail.isDeal || showMagicPill || showAttachmentPill || labelList.length > 0}
                    {#if bodyPreview || showLocalPill}
                      <div class="flex items-center gap-1 mt-0.5 min-w-0 w-full">
                        {#if bodyPreview}
                          <p class="email-body-preview text-xs {rowInk.preview} truncate leading-tight min-w-0 flex-1">{bodyPreview}</p>
                        {/if}
                        {#if showLocalPill}
                          {@const deletedWhen = (() => {
                            const ts =
                              (mail as Email & { local_only_since?: number }).local_only_since ||
                              mail.local_deleted_at ||
                              mail.stored_at ||
                              toMs(mail.received_at);
                            return ts ? timeAgo(ts) : '';
                          })()}
                          <span
                            id="local-badge-{mail.id}"
                            class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-md-tertiary-container text-md-on-tertiary-container shrink-0 cursor-help"
                            data-tooltip={deletedWhen
                              ? $t('inbox.deletedFromServerAgo', { values: { when: deletedWhen } })
                              : $t('inbox.localOnlyTooltip')}
                            aria-label={$t('inbox.localOnlyBadge')}
                          ><Icon name="cloudOff" class="w-3 h-3" /></span>
                        {/if}
                      </div>
                    {/if}
                    {#if hasBadgeRow}
                      <div class="flex flex-wrap items-center gap-1 mt-1 min-w-0 w-full">
                            <MessageCodeBadges id="otp-badge-{mail.id}" email={mail} hideOtp={hideOtpLabels} onCopyOtp={onCopyOtpFromMessage} />
                            {#if showAttachmentPill}
                              {@const attList = mail.attachments || []}
                              {@const attFirst = attList[0]}
                              {@const attMeta = attachmentTypeMeta(attFirst?.filename || '')}              <span
                id="attachment-badge-{mail.id}"
                data-tour="attachment-badge"
                class="px-1.5 py-0 text-xs rounded-full bg-md-tertiary-container text-md-on-tertiary-container shrink-0 cursor-help max-w-[6.5rem] truncate"
                                title={attFirst?.filename
                                  ? attList.length > 1
                                    ? `${attFirst.filename} · ${$t('inbox.attachmentMore', { values: { n: attList.length - 1 } })}`
                                    : `${attFirst.filename}${attFirst.mimeType ? ` · ${attFirst.mimeType}` : ''}`
                                  : $t('inbox.attachments')}
                                aria-label={$t('inbox.attachments')}
                              >{attMeta.emoji} {attFirst?.filename || $t('inbox.attachments')}{attList.length > 1 ? ` +${attList.length - 1}` : ''}</span>
                            {/if}
                            {#if showMagicPill}
                              <span
                                id="magic-link-badge-{mail.id}"
                                class="px-1.5 py-0 text-xs rounded-full bg-md-tertiary/20 text-md-tertiary shrink-0 max-w-[4rem] truncate"
                                title={mail.magicLinks?.[0]?.host || mail.magicLinks?.[0]?.url || $t('inbox.magicLinkDetected')}
                              >{$t('inbox.magicLinkPill')}</span>
                            {/if}
                            {#each visibleLabels as label (label)}
                              <span
                                role="button"
                                tabindex="0"
                                class="px-1.5 py-0 text-xs rounded-full cursor-pointer transition-opacity hover:opacity-80 shrink-0 max-w-[4rem] truncate"
                                style="background-color: {hexToRgba(labelColor(label), 0.16)}; color: {labelColor(label)};"
                                onmousedown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                                onclick={(e) => { e.stopPropagation(); filterByLabel(label); }}
                                title={$t('inbox.filterByLabel', { values: { label } })}
                                onkeydown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); filterByLabel(label); } }}
                                aria-label={$t('inbox.filterByLabel', { values: { label } })}
                              >{label}</span>
                            {/each}
                            {#if overflowLabels.length > 0}
                              <div class="relative shrink-0">
                                <button
                                  type="button"
                                  class="px-1.5 py-0 text-xs rounded-full bg-md-surface-variant text-md-on-surface/70 font-semibold hover:bg-md-primary/15 active:bg-md-primary/35 hover:text-md-primary transition-colors"
                                  aria-label={$t('inbox.moreLabels', { values: { n: overflowLabels.length } })}
                                  title={overflowLabels.join(', ')}
                                  onmousedown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                                  onclick={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    rowLabelMenuId = rowLabelMenuId === mail.id ? null : mail.id;
                                  }}
                                >+{overflowLabels.length}</button>
                                {#if rowLabelMenuId === mail.id}
                                  <button
                                    type="button"
                                    class="fixed inset-0 {PORTAL_Z_CLASS.navMenu} bg-transparent cursor-default"
                                    aria-label={$t('common.close')}
                                    onmousedown={(e) => e.stopPropagation()}
                                    onclick={(e) => { e.stopPropagation(); rowLabelMenuId = null; }}
                                  ></button>
                                  <div
                                    use:anchoredFlyout={{ placement: 'bottom-end', onClose: () => { rowLabelMenuId = null; } }}
                                    class="absolute end-0 top-full mt-1 {PORTAL_Z_CLASS.accountMenu} min-w-[100px] max-w-[160px] max-h-36 overflow-y-auto rounded-lg border border-md-outline-variant bg-md-surface {ELEVATION.level2} p-1"
                                    role="menu"
                                  >
                                    {#each overflowLabels as label (label)}
                                      <button
                                        type="button"
                                        role="menuitem"
                                        class="w-full text-start px-2 py-1 text-xs rounded-md truncate text-md-on-surface hover:bg-md-primary/10 active:bg-md-primary/30 hover:text-md-primary"
                                        onmousedown={(e) => e.stopPropagation()}
                                        onclick={(e) => {
                                          e.stopPropagation();
                                          filterByLabel(label);
                                          rowLabelMenuId = null;
                                        }}
                                      ><span class="inline-block w-2 h-2 rounded-full me-1.5 align-middle shrink-0" style="background-color: {labelColor(label)};"></span>{label}</button>
                                    {/each}
                                  </div>
                                {/if}
                              </div>
                            {/if}
                      </div>
                    {/if}
                  {/if}
                </div>
              </div>

              <button
                type="button"
                data-star-btn
                id="star-button-{mail.id}"
                class="flex flex-shrink-0 self-center items-center justify-center p-0.5 rounded-full transition-colors hover:bg-md-surface-variant/40 active:bg-md-surface-variant/60 cursor-pointer border-0 bg-transparent {mailRowStarClass({ selected: isSelected, starred: isStarredMail(mail) })} {starPopId === mail.id ? 'star-pop' : ''}"
                onclick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  void toggleStar(mail);
                }}
                onpointerdown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
                onmousedown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
                onmouseup={(e) => e.stopPropagation()}
                aria-pressed={isStarredMail(mail)}
                aria-label={$t('inbox.emailActions.star')}
                title={$t('inbox.emailActions.star')}
              >
                <Icon name="star" class="w-5 h-5 transition-colors duration-150 pointer-events-none" filled={isStarredMail(mail)} />
              </button>
            </div>
          </div>
          {/if}
          </div>
        {/each}
        {#if isVirtualized && virtualWindow.paddingAfter > 0}
          <div
            class="shrink-0"
            style="height: {virtualWindow.paddingAfter}px;"
            aria-hidden="true"
          ></div>
        {/if}
        {#if !isVirtualized && renderLimit < displayedEmails.length}
          <div bind:this={listSentinelEl} class="h-8" aria-hidden="true"></div>
          <div class="py-3 text-center">
            <button
              type="button"
              class="px-4 py-1.5 bg-md-surface-variant text-md-on-surface-variant text-xs font-medium rounded-full hover:bg-md-primary active:brightness-95 hover:text-md-on-primary transition-colors {ELEVATION.level1}"
              onclick={() => expandRenderWindow()}
            >
              {$t('emailList.loadMore')} ({displayedEmails.length - renderLimit})
            </button>
          </div>
        {:else if !isVirtualized && displayedEmailCount < tabFilteredEmails.length}
          <div class="py-3 text-center">
            <button
              type="button"
              class="px-4 py-1.5 bg-md-surface-variant text-md-on-surface-variant text-xs font-medium rounded-full hover:bg-md-primary active:brightness-95 hover:text-md-on-primary transition-colors {ELEVATION.level1}"
              onclick={() => loadMoreEmails()}
            >
              {$t('emailList.loadMore')} ({tabFilteredEmails.length - displayedEmailCount})
            </button>
          </div>
        {/if}
        <!-- Dynamic End-of-List Spacer: allows content to flow behind floating nav & strips while ensuring the final item can scroll cleanly above controls -->
        <div
          class="w-full shrink-0 transition-[height] duration-200 ease-in-out pointer-events-none"
          style="height: calc(var(--bottom-safe-area, 0px) + var(--selection-bar-offset, 0px) + {totalBottomSpacerHeightPx}px + 12px);"
          aria-hidden="true"
        ></div>
      {/if}
    </div>
  </div>
{/if}

{#if marqueeActive && marqueeRect}
  <div
    class="fixed pointer-events-none {PORTAL_Z_CLASS.marquee} border border-md-primary/70 bg-md-primary/15 rounded-sm"
    style="left:{marqueeRect.left}px;top:{marqueeRect.top}px;width:{marqueeRect.right - marqueeRect.left}px;height:{marqueeRect.bottom - marqueeRect.top}px;"
    aria-hidden="true"
  ></div>
{/if}

</div>

<!-- Bottom strips stacked wrapper -->
<!-- Selection strip replaces other strips while multi-select is active. -->
{#if hasCollapsibleStrips}
<div bind:this={bottomStripsWrapperEl} class="bottom-strips-wrapper absolute z-20{scrollChromeHidden ? ' scroll-chrome-hidden' : ''}" style:width={NAV_FLOAT_CONTENT_WIDTH_CSS} role="none">
<MailboxStripDock items={stripTabs} active={frontStrip} collapsed={stripsEdgeCollapsed} onSelect={selectStrip} onCollapse={(collapsed) => void setStripsEdgeCollapsed(collapsed)}>
{#if frontStrip === 'health' && (showExpiredMailboxHealth || currentAddress?.mailboxRefreshFailure)}
  {@const refreshFailure = currentAddress?.mailboxRefreshFailure}
  <div class="flex items-center gap-2.5 p-3" role="status" aria-live="polite">
    <Icon name={showExpiredMailboxHealth ? 'schedule' : 'warning'} class="size-4 shrink-0 text-md-warning" />
    <p class="min-w-0 flex-1 text-sm text-md-on-surface-variant">
      {#if showExpiredMailboxHealth}{$t('inbox.refreshHealth.expired')}
      {:else if refreshFailure?.kind === 'network'}{$t('inbox.refreshHealth.network')}
      {:else if refreshFailure?.kind === 'provider'}{$t('inbox.refreshHealth.provider')}
      {:else}{$t('inbox.refreshHealth.unknown')}{/if}
    </p>
    {#if !showExpiredMailboxHealth}
      <button type="button" class="md-action shrink-0 rounded-full px-3 py-2 text-sm font-medium bg-md-warning text-md-on-warning disabled:opacity-60" disabled={mailboxHealthRetrying || loading} onclick={(event) => { event.stopPropagation(); void retryMailboxRefresh(); }}>
        {mailboxHealthRetrying ? $t('common.loading') : $t('inbox.refreshHealth.retry')}
      </button>
    {/if}
  </div>
{/if}
<!-- Lifecycle intelligence hint.
     When high-value renew applies to the *current* expired inbox and the renewal strip is
     already showing, merge into renewal (no duplicate strip). Standalone high-value only
     for a *different* address. -->
{#if frontStrip === 'suggestion' && lifecycleDockVisible}
  {@const hint = lifecycleHints[0]}
  {@const mergeHighValueIntoRenewal =
    hint.kind === 'renew_high_value' &&
    !!currentAddress &&
    currentAddress.id === hint.addressId &&
    showRenewalStrip}
  {#if !mergeHighValueIntoRenewal}
    <div class="h-[40px] flex items-center box-border px-3 bg-md-tertiary-container bottom-strip-item rounded-xl mb-1 motion-strip-up" style="--i: 0;">
      <div class="flex items-center gap-2 w-full min-w-0">
        <Icon name="info" class="w-4 h-4 text-md-primary shrink-0" />
        <div class="min-w-0 flex-1">
          <div class="text-label-sm font-semibold text-md-on-surface truncate">
            {$t(hint.reasonKey, { values: { address: hint.address } })}
          </div>
        </div>
        <div class="flex flex-nowrap items-center gap-2 min-w-0 max-w-[60%]" use:responsiveButtonLayout data-action-tier="XS">
        {#if hint.kind === 'renew_high_value'}
          <button
            type="button"
            class="h-8 rounded-lg font-bold bg-md-primary text-md-on-primary"
            onclick={(e) => {
              e.stopPropagation();
              const acc = (allAddresses || accounts).find((a) => a.id === hint.addressId);
              if (acc) {
                onSelectAddress?.(acc.address);
                void onExtendAddress(acc);
              }
            }}
          >{$t('intelligence.renewAction')}</button>
        {:else if hint.kind === 'archive_idle'}
          <button
            type="button"
            class="h-8 rounded-lg font-bold bg-md-secondary-container text-md-on-secondary-container"
            onclick={(e) => {
              e.stopPropagation();
              const acc = (allAddresses || accounts).find((a) => a.id === hint.addressId);
              if (acc) onArchiveAddress(acc);
            }}
          >{$t('common.archive')}</button>
        {:else if hint.kind === 'create_fresh_for_risk'}
          <button
            type="button"
            class="h-8 rounded-lg font-bold bg-md-primary text-md-on-primary"
            onclick={(e) => {
              e.stopPropagation();
              onCreateAddress();
            }}
          >{$t('address.newMailAddress')}</button>
        {/if}
        <IconButton
          icon="close"
          size="sm"
          ariaLabel={$t('common.close')}
          onclick={() => (lifecycleHintDismissed = true)}
        />
        </div>
      </div>
    </div>
  {/if}
{/if}

<!-- Filters applied strip -->
{#if frontStrip === 'filter' && hasActiveListFilters && showFilterAppliedStrip}
<div class="flex flex-col gap-2 p-3 bottom-strip-item bottom-strip-filter">
  <div class="flex items-center gap-2 w-full min-w-0">
    <Icon name="filter" class="w-4 h-4 text-md-primary shrink-0" />
    <div class="min-w-0 flex-1">
      <div class="text-xs font-bold text-md-on-surface truncate">{$t('inbox.filtersApplied')}</div>
      <div class="text-xs text-md-on-surface/50 truncate">{$t('inbox.filtersAppliedHint')}</div>
    </div>
  </div>
    <div class="flex flex-nowrap items-center gap-2 min-w-0 w-full" use:responsiveButtonLayout data-action-tier="XS">
    {#if !filterQuickSaved}
      <button type="button" class="h-8 rounded-lg font-bold bg-md-primary text-md-on-primary" onclick={(e) => {
        e.stopPropagation();
        onSaveFilterQuick();
        filterQuickSaved = true;
      }}>{$t('inbox.saveAsFilterLabel')}</button>
    {/if}
    <button type="button" class="h-8 rounded-lg font-bold bg-md-surface-variant text-md-on-surface" onclick={(e) => { e.stopPropagation(); void onClearFilters(); }}>{$t('inbox.removeFilters')}</button>
    <IconButton
      icon="close"
      size="sm"
      ariaLabel={$t('common.close')}
      onclick={() => (showFilterAppliedStrip = false)}
    />
    </div>
</div>
{/if}

<!-- Saved login refill strip -->
{#if frontStrip === 'savedLogin' && matchingSavedLogin && showSavedLoginStrip && currentDomain}
<div class="h-[40px] flex items-center box-border px-3 bg-md-surface-container-low border border-md-outline-variant/20 bottom-strip-item bottom-strip-savedlogin rounded-xl shadow-xs" style="--i: 0.75;">
  <div class="flex items-center gap-2 w-full min-w-0">
    <FaviconImage domain={currentDomain} size="xs" class="shrink-0" fallbackLetter={avatarInitial(currentDomain, '?')} />
    <div class="min-w-0 flex-1">
      <div class="text-xs font-bold text-md-on-surface truncate">{$t('inbox.savedLoginRefill')}</div>
      <div class="text-xs text-md-on-surface/50 truncate" style="direction:ltr;unicode-bidi:isolate;">{matchingSavedLogin.email || matchingSavedLogin.username || currentDomain}</div>
    </div>
    <div class="flex flex-nowrap items-center gap-2 min-w-0 max-w-[60%]" use:responsiveButtonLayout data-action-tier="XS">
    <button type="button" class="h-8 rounded-lg font-bold bg-md-primary text-md-on-primary" onclick={(e) => { e.stopPropagation(); onRefillSavedLogin(matchingSavedLogin!); }}>{$t('inbox.refillAction')}</button>
    <IconButton
      icon="close"
      size="sm"
      ariaLabel={$t('common.close')}
      onclick={() => (showSavedLoginStrip = false)}
    />
    </div>
  </div>
</div>
{/if}

{#if frontStrip === 'autofill' && formDetected && showAutofillStrip && !preferHideAutofillStrip}
<div class="flex items-center box-border px-2 py-1 bg-md-surface-container-low border border-md-outline-variant/20 bottom-strip-item bottom-strip-autofill rounded-xl shadow-xs" style="--i: 1;">
  <div class="flex items-center gap-2 w-full">
    <!-- Favicon + Domain -->
    <div class="flex items-center gap-1.5 min-w-0 shrink-0" title={`${currentDomain || $t('common.unknown')} · ${$t('inbox.detectedForm')}`}>
      <div class="flex-shrink-0 {AVATAR_BOX.lg} rounded-full bg-md-surface-variant flex items-center justify-center overflow-hidden">
        {#if currentDomain}
          <FaviconImage domain={currentDomain} size="lg" fallbackLetter={avatarInitial(currentDomain)} />
        {:else}
          <Icon name="globe" class="w-4 h-4 opacity-40" />
        {/if}
      </div>
      <div class="text-xs font-medium text-md-on-surface-variant leading-tight truncate max-w-12">{currentDomain || $t('common.unknown')}</div>
    </div>

    <!-- Connected primary action and identity chooser, with separate keyboard targets. -->
    <div class="flex flex-1 min-w-0 items-stretch rounded-full bg-md-primary text-md-on-primary" role="group" aria-label={$t('inbox.autofillAction')} data-autofill-split>
      <button type="button" id="button-autofill" class="md-action min-w-0 flex-1 rounded-s-full px-3 text-xs font-semibold text-start disabled:opacity-50" title={autofillActionLabel} disabled={identitySelectionSaving} onclick={onAutofillForm}>
        <span class="block truncate">{autofillActionLabel}</span>
      </button>
      <div class="shrink-0 border-s border-md-on-primary/30">
        <Dropdown
          id="button-identity-selector"
          size="button"
          triggerLabel=""
          ariaLabel={$t('identities.select')}
          class="autofill-identity-menu"
          value={selectedIdentityId ?? ''}
          disabled={identitySelectionSaving}
          options={[...identities.map((identity) => ({ value: identity.id, label: identity.name })), { value: '__create_identity__', label: $t('contentAutofill.createIdentity') }]}
          onchange={(value) => {
            if (value === '__create_identity__') { onCreateIdentity(); return; }
            const previous = selectedIdentityId;
            identitySelectionSaving = true;
            selectedIdentityId = String(value);
            void handleIdentityChange().catch((error) => {
              selectedIdentityId = previous;
              logError('Failed to select autofill identity', error);
              showToast($t('toasts.operationFailed'), 'error');
            }).finally(() => { identitySelectionSaving = false; });
          }}
        />
      </div>
    </div>
    <button type="button" id="button-close-autofill" class="md-action h-10 w-8 shrink-0 flex items-center justify-center rounded-full" onclick={() => showAutofillStrip = false} aria-label={$t('inbox.closeAutofillStrip')}>
      <Icon name="close" class="w-4 h-4" />
    </button>
  </div>
</div>
{/if}
{#if frontStrip === 'siteAccess' && currentDomain}
<div class="bottom-strip-item bottom-strip-webmcp rounded-xl bg-md-surface-container border border-md-outline-variant/20 px-3 py-2" style="--i: 3;">
  <div class="space-y-2">
    <span class="min-w-0">
      <span class="block text-xs font-semibold text-md-on-surface">{$t('inbox.allowWebmcpAccess')}</span>
      <span class="block text-xs text-md-on-surface-variant">{$t('inbox.allowWebmcpAccessHelp')}</span>
    </span>
    <ButtonGroup tier="S">
      <Btn size="sm" variant="tonal" class={controlSurface(siteAccessChoice === 'always')} aria-pressed={siteAccessChoice === 'always'} disabled={siteAccessBusy} onclick={() => void chooseWebmcpAccess('always')}>{$t('inbox.siteAllowAll')}</Btn>
      <Btn size="sm" variant="tonal" class={controlSurface(siteAccessChoice === 'once')} aria-pressed={siteAccessChoice === 'once'} disabled={siteAccessBusy} onclick={() => void chooseWebmcpAccess('once')}>{$t('inbox.siteAllowOnce')}</Btn>
      <Btn size="sm" variant="tonal" class={controlSurface(siteAccessChoice === 'never')} aria-pressed={siteAccessChoice === 'never'} disabled={siteAccessBusy} onclick={() => void chooseWebmcpAccess('never')}>{$t('inbox.siteNever')}</Btn>
    </ButtonGroup>
  </div>
</div>
{/if}
{#if frontStrip === 'verification' && hasVerificationContent && !preferHideVerificationStrip}
<div id="verification-strip" class="bottom-strip-item bottom-strip-verification bg-md-surface-container overflow-hidden" role="region" aria-label={$t('inbox.verificationTitle')}>
  <div class="flex items-center gap-2 px-3 pt-2">
    {#if selectedVerification}
      <FaviconImage domain={selectedVerification.website || undefined} email={selectedVerification.email.from} size="sm" fallbackLetter={avatarInitial(selectedVerification.email.from_name || selectedVerification.website)} />
      <div class="min-w-0 flex-1">
        <button type="button" class="block max-w-full truncate text-start ui-label text-md-on-surface rounded {controlSurface(false)}" aria-label={$t('inbox.openOtpMessage')} onclick={() => { if (selectedVerification) void openVerificationMessage(selectedVerification.email); }}>{selectedVerification.website || selectedVerification.email.from_name || selectedVerification.email.from}</button>
        <div class="truncate ui-support text-md-on-surface-variant" dir="auto" title={selectedVerification.address}>{selectedVerification.address}</div>
      </div>
    {:else}<span class="min-w-0 flex-1 ui-support text-md-on-surface-variant">{$t('verification.noCurrentItems')}</span>{/if}
    <IconButton icon={verificationExpanded ? 'chevronUp' : 'chevronDown'} size="sm" ariaLabel={verificationExpanded ? $t('inbox.collapseVerificationAria') : $t('inbox.expandVerificationAria')} onclick={toggleVerificationExpansion} />
  </div>
  <div class="flex items-center justify-between gap-1 px-2 py-1">
    <IconButton icon="chevronLeft" class="rtl-flip" size="md" ariaLabel={$t('stripDock.previous')} disabled={verificationIndex <= 0} onclick={() => moveVerification(-1)} />
    {#if selectedVerification}
      {#if selectedVerification.kind === 'otp'}
        <Btn id={selectedVerification.status === 'current' && selectedVerification.expiresAt > stripClockTick ? 'button-copy-current-otp' : 'button-copy-verification'} size="sm" variant="primary" class="tabular-nums" icon={copiedVerificationId === selectedVerification.id ? 'check' : 'contentCopy'} aria-label={copiedVerificationId === selectedVerification.id ? $t('common.copied') : $t('inbox.copyOtpAria')} onclick={() => void copySelectedVerification()}>{selectedVerification.value.replace(/\s/g, '')}</Btn>
      {:else}
        <Btn size="sm" variant="tonal" icon="openInNew" onclick={() => { if (selectedVerification) onOpenMagicLink(selectedVerification.value, selectedVerification.address); }}>{$t('inbox.openMagicLink')}</Btn>
      {/if}
    {/if}
    <IconButton icon="chevronRight" class="rtl-flip" size="md" ariaLabel={$t('stripDock.next')} disabled={currentVerificationItems.length === 0 || verificationIndex >= currentVerificationItems.length - 1} onclick={() => moveVerification(1)} />
    <button type="button" class="min-h-10 shrink-0 px-2 ui-support tabular-nums rounded-full text-md-on-surface {controlSurface(false)}" aria-label={$t('verification.history')} aria-expanded={verificationExpanded} onclick={toggleVerificationExpansion}>{verificationIndex >= 0 ? `${verificationIndex + 1}/${currentVerificationItems.length}` : $t('verification.history')}</button>
  </div>
  {#if selectedVerification}
    <div class="px-3 pb-2 ui-support {selectedVerification.expiresAt <= stripClockTick ? 'text-md-error' : 'text-md-on-surface-variant'}" data-verification-status={selectedVerification.expiresAt <= stripClockTick ? 'expired' : selectedVerification.status}>
      {#if selectedVerification.expiresAt <= stripClockTick}{$t('verification.timeLimitReached')}
      {:else if selectedVerification.status === 'earlier'}{$t('verification.earlier')}
      {:else}{$t(selectedVerification.kind === 'otp' ? 'inbox.otpExpiresIn' : 'inbox.expiresIn', { values: { t: formatRemaining(selectedVerification.expiresAt, stripClockTick) } })}{/if}
    </div>
  {/if}
    {#if verificationExpanded}
      <div class="max-h-[min(22rem,55vh)] overflow-y-auto border-b border-md-outline-variant/40 bg-md-surface-container-low scroll-body" data-verification-history>
        <div class="px-3 py-2 flex items-center gap-2 border-b border-md-outline-variant/40">
          <div class="flex flex-col gap-2">
            <label class="flex items-center gap-2 cursor-pointer"><Checkbox size="sm" checked={isOtpOptedIn} onchange={toggleOtpOptIn} /><span class="ui-label">{$t('inbox.allowOtpAutofill')}</span></label>
            <label class="flex items-center gap-2 cursor-pointer"><Checkbox size="sm" checked={isOtpAutoCopy} onchange={toggleOtpAutoCopy} /><span class="ui-label">{$t('inbox.allowOtpAutoCopy')}</span></label>
          </div>
          <IconButton icon="delete" size="sm" variant="danger" class="ms-auto" ariaLabel={$t('inbox.clearAllOtps')} onclick={() => void clearAllOtps()} />
        </div>
        <VerificationHistory items={historyVerificationItems} mode={verificationPreferences.value.grouping} currentAddress={currentAddress?.address || selectedEmail} now={stripClockTick} loading={verificationHistoryLoading} error={verificationHistoryError} saving={verificationPreferences.saving}
          onMode={(grouping) => void verificationPreferences.save({ grouping })}
          onChoose={(item) => { void chooseVerification(item).catch((error) => { logError('Failed to select verification item', error); showToast($t('toasts.operationFailed'), 'error'); }); }}
          onOpenLink={onOpenMagicLink} onOpenMessage={(email) => void openVerificationMessage(email)} onToast={showToast} />
      </div>
    {/if}
</div>
{/if}
{#if frontStrip === 'renewal' && renewalDockVisible}
<div
  id="button-renewal-strip"
  class="bottom-strip-item bottom-strip-renewal rounded-xl"
  style="--i: 3; overflow: hidden;"
>
  {#if !renewalStripCollapsed}
  <div class="flex flex-col gap-2 px-3 py-2.5 bg-md-surface-container-low border border-md-warning/40 rounded-xl {ELEVATION.level1}">
    <!-- Header: icon + title + dismiss -->
    <div class="flex items-center gap-2">
      <div class="flex-shrink-0 w-7 h-7 rounded-lg bg-md-warning/20 flex items-center justify-center">
        <Icon name="refresh" class="w-4 h-4 text-md-warning {isRenewing ? 'animate-spin' : ''}" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-xs font-bold text-md-on-surface leading-tight">
          {#if providerFailoverHint?.show && currentAddress?.autoExtend}
            {$t('inbox.renewalStrip.retryTitle')}
          {:else if lifecycleHints[0]?.kind === 'renew_high_value' && lifecycleHints[0]?.addressId === currentAddress?.id}
            {$t(lifecycleHints[0].reasonKey, { values: { address: lifecycleHints[0].address } })}
          {:else}
            {$t('inbox.renewalStrip.title')}
          {/if}
        </div>
        <div class="text-xs text-md-on-surface/60 leading-tight truncate">
          {#if isRenewing}
            {$t('inbox.renewalStrip.renewing')}
          {:else if providerFailoverHint?.show && currentAddress?.autoExtend}
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
        class="w-5 h-5 flex items-center justify-center rounded-full bg-transparent hover:bg-md-secondary-container active:bg-md-secondary-container-pressed flex-shrink-0 transition-colors disabled:opacity-40"
        aria-label={$t('inbox.renewalStrip.dismissAria')}
        aria-expanded={!renewalStripCollapsed}
        aria-controls="button-renewal-strip"
        disabled={isRenewing}
        onclick={(e) => { e.stopPropagation(); renewalStripDismissed = true; }}
      >
        <Icon name="close" class="w-3 h-3" />
      </button>
    </div>
    <!-- Action row: renew options -->
    <div class="flex flex-nowrap gap-3 w-full" use:responsiveButtonLayout data-action-tier="S">
      <button
        id="button-renewal-always"
        class="flex-1 min-w-0 h-10 px-4 rounded-lg text-sm font-semibold bg-md-primary text-md-on-primary hover:bg-md-primary/90 active:brightness-95 transition-colors disabled:opacity-60 flex items-center justify-center"
        title={$t('inbox.renewalStrip.alwaysDescription')}
        disabled={isRenewing}
        onclick={(e) => {
          e.stopPropagation();
          void handleRenewAlways();
        }}
      >
        <Icon name="refresh" class="w-5 h-5 shrink-0 {isRenewing ? 'animate-spin' : ''}" />
        <span class="btn-label">{isRenewing ? $t('inbox.renewalStrip.renewing') : $t('inbox.renewalStrip.always')}</span>
      </button>
      <button
        id="button-renewal-once"
        class="flex-1 min-w-0 h-10 px-4 rounded-lg text-sm font-semibold bg-md-secondary-container text-md-on-secondary-container hover:bg-md-secondary-container/80 active:bg-md-secondary-container/100 transition-colors disabled:opacity-60 flex items-center justify-center"
        title={$t('inbox.renewalStrip.onceDescription')}
        disabled={isRenewing}
        onclick={(e) => {
          e.stopPropagation();
          void handleRenewOnce();
        }}
      >
        <span class="btn-label">{isRenewing ? $t('inbox.renewalStrip.renewing') : $t('inbox.renewalStrip.once')}</span>
      </button>
      <button
        id="button-renewal-no"
        class="h-10 px-4 rounded-lg text-sm font-semibold bg-transparent text-md-on-surface/60 hover:bg-md-secondary-container active:bg-md-secondary-container-pressed hover:text-md-on-secondary-container transition-colors disabled:opacity-40"
        disabled={isRenewing}
        onclick={(e) => { e.stopPropagation(); renewalStripDismissed = true; }}
      >
        <span class="btn-label">{$t('inbox.renewalStrip.dismiss')}</span>
      </button>
    </div>
    {#if providerFailoverHint?.show && providerFailoverHint.otherProvidersOk}
      <button
        type="button"
        class="w-full py-1.5 rounded-lg text-label-sm font-semibold bg-md-tertiary-container text-md-on-tertiary-container hover:opacity-90 transition-opacity"
        onclick={(e) => {
          e.stopPropagation();
          onCreateAddress();
        }}
      >
        {$t('toasts.createWithOtherProvider')}
      </button>
    {/if}
  </div>
  {:else}
  <button
    class="w-full flex items-center justify-between px-3 py-1.5 text-xs font-medium text-md-warning/70 hover:text-md-warning transition-colors bg-md-surface-container-low"
    onclick={(e) => { e.stopPropagation(); renewalStripCollapsed = false; }}
    aria-label={$t('inbox.showRenewalBar')}
    title={$t('inbox.showRenewalBar')}
    aria-expanded={!renewalStripCollapsed}
    aria-controls="button-renewal-strip"
  >
    <span>{$t('inbox.renewalStrip.title')} · {$t('inbox.renewalStrip.prompt')}</span>
    <Icon name="chevronDown" class="w-3.5 h-3.5" />
  </button>
  {/if}
</div>
{/if}
</MailboxStripDock>
</div>
<!-- end bottom-strips-wrapper -->
{/if}

<!-- Tag Dialog -->
<TagDialog
  open={tagDialogOpen}
  currentTag={tagTargetAddress?.tag || null}
  currentTagColor={tagTargetAddress?.tagColor || null}
  currentTags={addressTagsList(tagTargetAddress)}
  existingTags={existingTags}
  tagColors={tagColors}
  tagAddresses={tagAddressUsage}
  onClose={closeTagDialog}
  onManageTags={onManageTags}
  onSaveTags={saveTags}
/>

<!-- Hover Preview Tooltip -->
{#if hoveredEmail && emailPreviewMode === 'tooltip'}
  {@const hoverPreview = emailHoverPreview(hoveredEmail)}
  <div
    class="fixed {PORTAL_Z_CLASS.tooltip} w-72 bg-md-surface-container-high text-md-on-surface p-3 rounded-xl {ELEVATION.level2} border border-md-outline-variant/60 pointer-events-none transition-opacity duration-150"
    style="top: {previewPosition.y}px; left: {previewPosition.x}px;"
  >
    <div class="flex items-center justify-between gap-2 mb-1 border-b border-md-outline-variant/30 pb-1.5">
      <span class="text-xs font-bold text-md-primary truncate">
        {hoveredEmail.subject || $t('emailList.noSubject')}
      </span>
      <span class="text-xs text-md-on-surface/50 flex-shrink-0">{hoveredEmail.time}</span>
    </div>
    {#if hoveredEmail.isOtp}
      <div class="mb-1 text-xs font-semibold text-md-tertiary">
        {$t('loginInfo.otp')}: {hoveredEmail.otp}
      </div>
    {/if}
    <div class="text-xs text-md-on-surface/80 line-clamp-6 leading-relaxed">
      {#if hoverPreview !== null}
        {hoverPreview}
      {:else}
        <span class="italic text-md-on-surface/40">{$t('emailList.noPreview')}</span>
      {/if}
    </div>
  </div>
{/if}

<!-- Email Label Modal Dialog -->
{#if emailLabelDialogOpen}
  <ModalDialog
    open={emailLabelDialogOpen}
    onClose={closeEmailLabelDialog}
    maxWidth="xs"
    title={labelDialogMultiIds?.length
      ? $t('inbox.emailActions.labelSelected')
      : $t('inbox.emailActions.label')}
    subtitle={labelDialogMultiIds?.length ? `(${labelDialogMultiIds.length})` : undefined}
  >
    {#snippet headerActions()}
      <IconButton
        icon="settings"
        size="sm"
        ariaLabel={$t('nav.labelManagement')}
        title={$t('nav.labelManagement')}
        onclick={() => {
          closeEmailLabelDialog();
          onManageLabels();
        }}
      />
    {/snippet}
    <p class="text-xs text-md-on-surface/60 mb-2">{$t('inbox.labelDialogHint')}</p>
    <input
      type="text"
      class="w-full px-3 py-2 text-sm rounded-lg border border-md-outline-variant bg-md-surface-container-low focus:outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary"
      placeholder={$t('inbox.labelDialogPlaceholder')}
      bind:value={labelDialogInput}
      onkeydown={(e) => {
        if (e.key === 'Enter') void saveEmailLabels();
      }}
    />
    {#if allEmailLabels.length > 0}
      <div class="flex flex-wrap gap-1.5 mt-2">
        {#each allEmailLabels as existingLabel (existingLabel)}
          <button
            type="button"
            class="px-2 py-0.5 text-xs rounded-full transition-colors hover:opacity-80"
            style="background-color: {hexToRgba(labelColor(existingLabel), 0.12)}; color: {labelColor(existingLabel)};"
            onclick={(e) => {
              e.stopPropagation();
              const parts = labelDialogInput.split(',').map((s) => s.trim()).filter(Boolean);
              if (!parts.includes(existingLabel)) {
                labelDialogInput = parts.length ? `${parts.join(', ')}, ${existingLabel}` : existingLabel;
              }
            }}
          >{existingLabel}</button>
        {/each}
      </div>
    {/if}      {#if dialogNewLabels.length > 0}
      <div class="flex items-center gap-2 mt-2">
        <input
          type="color"
          class="w-7 h-7 rounded-lg cursor-pointer border-0 p-0.5 bg-transparent shrink-0"
          bind:value={labelDialogColor}
          oninput={() => {
            labelDialogColorTouched = true;
          }}
          aria-label={$t('inbox.labelDialogNewColor')}
          title={$t('inbox.labelDialogNewColor')}
        />
        <span class="text-sm text-md-on-surface-variant">{$t('inbox.labelDialogNewColor')}</span>
      </div>
    {/if}
    {#snippet footer()}
      <button
        type="button"
        class="flex-1 py-1.5 text-sm rounded-xl bg-md-secondary-container text-md-on-secondary-container hover:bg-md-secondary-container/80 active:bg-md-secondary-container/100 transition-colors"
        onclick={closeEmailLabelDialog}
      >{$t('common.cancel')}</button>
      <button
        type="button"
        class="flex-1 py-1.5 text-sm rounded-xl bg-md-primary text-md-on-primary hover:bg-md-primary/90 active:brightness-95 transition-colors"
        onclick={() => void saveEmailLabels()}
      >{$t('common.save')}</button>
    {/snippet}
  </ModalDialog>
{/if}

{#if contextMenuOpen && contextMenuEmail}
  <!-- Click-away backdrop (mouse-only dismiss; also closes on right-click).
       It keeps its OWN layer class instead of the dialog shells' `-z-10`: it is
       a SIBLING of the menu rather than a child of a z-indexed overlay, so a
       negative z-index would drop it behind the app chrome and it would stop
       catching the clicks it exists for. -->
  <div
    class="fixed inset-0 {PORTAL_Z_CLASS.dialog} cursor-default"
    aria-hidden="true"
    onclick={() => closeContextMenu()}
    oncontextmenu={(e) => {
      e.preventDefault();
      closeContextMenu();
    }}
  ></div>
  <div
    use:anchoredFlyout={{ point: contextMenuPosition, onClose: closeContextMenu }}
    class="fixed {PORTAL_Z_CLASS.dialog} w-56 rounded-xl bg-md-surface {ELEVATION.level2} border border-md-outline-variant/30 overflow-hidden text-md-on-surface"
    style="left: {contextMenuPosition.x}px; top: {contextMenuPosition.y}px;"
    role="menu"
    tabindex="-1"
    aria-label={$t('inbox.emailActions.createRuleFromEmail')}
    oncontextmenu={(e) => e.preventDefault()}
  >
    <div class="px-3 py-2 border-b border-md-outline-variant/20">
      <div class="text-xs font-bold truncate">
        {getDisplayName(contextMenuEmail.from || '', contextMenuEmail.from_name)}
      </div>
      <div class="text-xs text-md-on-surface-variant truncate">
        {contextMenuEmail.subject || $t('addressView.noSubject')}
      </div>
    </div>
    <button
      type="button"
      role="menuitem"
      class="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-semibold text-start hover:bg-md-surface-variant/60 active:bg-md-surface-variant/80 transition-colors"
      onclick={(e) => {
        e.stopPropagation();
        createRuleFromContextMenu();
      }}
    >
      <Icon name="automation" class="w-4 h-4 text-md-primary shrink-0" />
      {$t('inbox.emailActions.createRuleFromEmail')}
    </button>
  </div>
{/if}
</div>

{#if attachmentLibraryOpen}
  <AttachmentLibraryDialog onClose={() => { attachmentLibraryOpen = false; }} />
{/if}

<style>
  :global(.autofill-identity-menu > button) {
    border-radius: 0 9999px 9999px 0;
    background: transparent;
    color: inherit;
    border: 0;
  }

  :global([dir='rtl'] .autofill-identity-menu > button) {
    border-radius: 9999px 0 0 9999px;
  }

  /*
   * The row's SELECTED/ACTIVE/HIGHLIGHTED surfaces live in the shared row
   * contract (`src/styles/row-surfaces.css`) - one home for every list row in
   * the app, so no view (this one included) picks its own fill, edge or hover
   * wash. `mailRowSurfaceClass` supplies the classes; the values are not here.
   */

  /*
   * 'Expanded' hover preview (preferences.emailPreviewStyle): when the user
   * picks 'expanded' in Settings, the row's OWN one-line truncated body
   * preview (p.email-body-preview) grows to four wrapped lines while the row
   * is hovered - same element, same text, no separate preview block - and
   * collapses back to one line when the cursor leaves. The class is applied
   * only in 'expanded' mode, so 'tooltip' mode keeps the plain truncate.
   */
  .email-row-expandable {
    transition: background-color 150ms ease;
  }
  .email-row-expandable:hover {
    background-color: color-mix(in srgb, var(--md-surface-variant) 40%, transparent);
  }
  .email-row-expandable .email-body-preview {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;
    line-clamp: 1;
    overflow: hidden;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .email-row-expandable:hover .email-body-preview {
    -webkit-line-clamp: 4;
    line-clamp: 4;
  }

  :global(.bottom-strips-wrapper) {
    position: absolute;
    /* Float ABOVE the floating nav - bottom equals the nav height so strips stack on top of it,
       plus the shell selection bar's height while one is showing. */
    bottom: calc(var(--bottom-safe-area, 44px) + var(--selection-bar-offset, 0px));
    left: 50%;
    transform: translateX(-50%);
    min-width: 0;
    max-width: 100%;
    display: flex;
    flex-direction: column;
    transition: opacity 180ms ease, transform 180ms ease, visibility 180ms ease;
    margin-bottom: 4px;
    /* Transparent gaps must NOT block clicks on content below */
    pointer-events: none;
  }

  :global(.bottom-strips-wrapper.scroll-chrome-hidden) {
    opacity: 0;
    visibility: hidden;
    transform: translateX(-50%) translateY(calc(100% + 8px));
    pointer-events: none;
  }

  :global(.bottom-strips-wrapper.scroll-chrome-hidden *) {
    pointer-events: none;
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.bottom-strips-wrapper) {
      transition: none;
    }
  }

  :global(.bottom-strip-item) {
    position: relative;
    list-style: none;
    /* Wrapper is pointer-events:none - restore auto on each strip so they are clickable */
    pointer-events: auto;
  }

</style>
