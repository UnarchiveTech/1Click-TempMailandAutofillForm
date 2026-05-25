<script lang="ts">
import DOMPurify from 'dompurify';
import { onDestroy, onMount, tick } from 'svelte';
import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';

// --- Context prop: 'popup' | 'sidepanel' | 'app' ---
let { context = 'popup' }: { context?: 'popup' | 'sidepanel' | 'app' } = $props();

import OfflineBanner from '@/components/feedback/OfflineBanner.svelte';
import type { ToastType } from '@/components/feedback/Toast.svelte';
import ToastContainer from '@/components/feedback/ToastContainer.svelte';
import IconArchive from '@/components/icons/IconArchive.svelte';
import IconAutoRenew from '@/components/icons/IconAutoRenew.svelte';
import IconClock from '@/components/icons/IconClock.svelte';
import IconCopy from '@/components/icons/IconCopy.svelte';
import IconEnvelope from '@/components/icons/IconEnvelope.svelte';
import IconFlame from '@/components/icons/IconFlame.svelte';
import IconMail from '@/components/icons/IconMail.svelte';
import IconPlus from '@/components/icons/IconPlus.svelte';
import IconQr from '@/components/icons/IconQr.svelte';
import IconRefresh from '@/components/icons/IconRefresh.svelte';
import IconSearch from '@/components/icons/IconSearch.svelte';
import IconTag from '@/components/icons/IconTag.svelte';
import IconTrash from '@/components/icons/IconTrash.svelte';
import ErrorBoundary from '@/components/layout/ErrorBoundary.svelte';
import Footer from '@/components/layout/Footer.svelte';
import Header from '@/components/layout/Header.svelte';
import ConfirmDialog from '@/components/overlays/ConfirmDialog.svelte';
import CreateInboxDialog from '@/components/overlays/CreateInboxDialog.svelte';
import QrDialog from '@/components/overlays/QrDialog.svelte';
import TagDialog from '@/components/overlays/TagDialog.svelte';
import ArchivedEmails from '@/components/ui/ArchivedEmails.svelte';
import AccountCard from '@/components/ui/account/AccountCard.svelte';
import AccountSelector from '@/components/ui/account/AccountSelector.svelte';
import EmailDetail from '@/components/ui/mail/EmailDetail.svelte';
import EmailList from '@/components/ui/mail/EmailList.svelte';
import FilterList from '@/components/ui/mail/FilterList.svelte';
import MessageDetail from '@/components/ui/mail/MessageDetail.svelte';
import Onboarding from '@/components/ui/Onboarding.svelte';
import { useAnalyticsActions } from '@/composables/useAnalyticsActions.js';
import { useCommonSetters } from '@/composables/useCommonSetters.js';
import { applyFilters, applySearchShortcuts } from '@/composables/useEmailFilters.js';
import {
  ANALYTICS_SYNC_KEYS,
  FILTER_SYNC_KEYS,
  IDENTITY_SYNC_KEYS,
  INBOX_SYNC_KEYS,
  LOGIN_INFO_SYNC_KEYS,
  READ_EMAILS_SYNC_KEYS,
  SETTINGS_SYNC_KEYS,
  THEME_SYNC_KEYS,
  useExtensionStorageSync,
} from '@/composables/useExtensionStorageSync.js';
import { useInboxActions } from '@/composables/useInboxActions.js';
import { useSavedSearchFilters } from '@/composables/useSavedSearchFilters.js';
import {
  type ArchivedSetters,
  deleteArchivedEmail as deleteArchivedEmailAction,
  loadArchivedEmails as loadArchivedEmailsAction,
  restoreArchivedInbox as restoreArchivedInboxAction,
} from '@/features/archived-mail/archived-actions.js';
import {
  autofillForm as autofillFormAction,
  copyOtp as copyOtpAction,
  createInbox as createInboxAction,
  type InboxSetters,
} from '@/features/inbox/inbox-actions.js';
import {
  archiveSelected as archiveSelectedAction,
  type BulkActionsSetters,
  deleteSelected as deleteSelectedAction,
  exportSelected as exportSelectedAction,
  toggleSelect as toggleSelectAction,
  toggleSelectAll as toggleSelectAllAction,
  unarchiveSelected as unarchiveSelectedAction,
} from '@/features/inbox/inbox-bulk-actions.js';
import {
  type ExportSetters,
  exportAccountEmails as exportAccountEmailsAction,
  exportEmailsWithFormat as exportEmailsWithFormatAction,
  exportMultipleEMLAsZip as exportMultipleEMLAsZipAction,
  generateMBOXContent as generateMBOXContentAction,
  generateSingleEMLContent as generateSingleEMLContentAction,
  showExportFormatDialog as showExportFormatDialogAction,
} from '@/features/inbox/inbox-export.js';
import {
  archiveAccount as archiveAccountAction,
  editAccount as editAccountAction,
  extendAccount as extendAccountAction,
  type ManagementSetters,
  openEditEmailDialog as openEditEmailDialogAction,
  removeAccount as removeAccountAction,
  restoreAccount as restoreAccountAction,
  toggleAutoExtend as toggleAutoExtendAction,
  unarchiveAccount as unarchiveAccountAction,
} from '@/features/inbox/inbox-management.js';
import {
  handleKeydown as handleKeydownAction,
  type ShortcutsCallbacks,
} from '@/features/keyboard-shortcuts/shortcuts.js';
import {
  type LoginSetters,
  loadLoginInfo as loadLoginInfoAction,
} from '@/features/login-info/login-actions.js';
import { openMessageWindow } from '@/features/message-window/message-window-actions.js';
import {
  closeQrDialog as closeQrDialogAction,
  copyQrImage as copyQrImageAction,
  downloadQrCode as downloadQrCodeAction,
  generateQRCode as generateQRCodeAction,
  openQrDialog as openQrDialogAction,
  type QRSetters,
} from '@/features/qr/qr-actions.js';
import {
  addCustomInstance as addCustomInstanceAction,
  changeProvider as changeProviderAction,
  exportData as exportDataAction,
  handleColorChange as handleColorChangeAction,
  handleProviderChange as handleProviderChangeAction,
  hardReset as hardResetAction,
  importData as importDataAction,
  loadProviderInstances as loadProviderInstancesAction,
  loadSettings as loadSettingsAction,
  type SettingsSetters,
  saveAutoCopy as saveAutoCopyAction,
  saveAutoRenew as saveAutoRenewAction,
  saveSettings as saveSettingsAction,
  setProviderInstance as setProviderInstanceAction,
  toggleDeveloperSettings as toggleDeveloperSettingsAction,
  toggleEnableLogging as toggleEnableLoggingAction,
} from '@/features/settings/settings-actions.js';
import {
  applyCustomColor,
  applyTheme as applyThemeAction,
  listenForSystemThemeChanges,
  setThemeMode as setThemeModeAction,
  type ThemeSetters,
  toggleTheme as toggleThemeAction,
} from '@/features/theme/theme-actions.js';
import type { View } from '@/features/types/view-types.js';
import { addToastNotification } from '@/utils/activity-tracker.js';
import { decrypt, encrypt } from '@/utils/crypto.js';
import { loadProviderConfig } from '@/utils/email-service.js';
import { ApiError, ValidationError } from '@/utils/errors.js';
import { setupFocusTrap } from '@/utils/focusTrap.js';
import { detectIconFromMessage } from '@/utils/iconMapping.js';
import { logDebug, logError } from '@/utils/logger.js';
import { getToastTypeFromMessage } from '@/utils/shared-ui.js';
import { formatDate, formatTimeLeft, getEmailStatus, timeAgo } from '@/utils/time.js';
import { toastStore } from '@/utils/toastStore.js';
import type {
  Account,
  CredentialsHistoryItem,
  Email,
  Identity,
  Keybindings,
  ProviderInstance,
  SavedSearchFilter,
} from '@/utils/types.js';
import { DEFAULT_KEYBINDINGS } from '@/utils/types.js';
import { validateCustomInstanceName, validateCustomInstanceUrl } from '@/utils/validation.js';
import ActivityView from '@/views/ActivityView.svelte';
import FiltersManagementView from '@/views/FiltersManagementView.svelte';
import IdentitiesView from '@/views/IdentitiesView.svelte';
import InboxView from '@/views/InboxView.svelte';
import KeyboardShortcutsView from '@/views/KeyboardShortcutsView.svelte';
import LabelManagementView from '@/views/LabelManagementView.svelte';
import MailManagementView from '@/views/MailManagementView.svelte';
import MailProviderView from '@/views/MailProviderView.svelte';
import SavedLoginInfoView from '@/views/SavedLoginInfoView.svelte';
import StoragePerformanceView from '@/views/StoragePerformanceView.svelte';
import TagManagementView from '@/views/TagManagementView.svelte';
import packageJson from '../../package.json';

// Lazy-loaded non-critical views
// biome-ignore lint/suspicious/noExplicitAny: Svelte dynamic component imports require any type
let AboutViewComponent = $state<null | any>(null);
// biome-ignore lint/suspicious/noExplicitAny: Svelte dynamic component imports require any type
let ExtensionSettingsViewComponent = $state<null | any>(null);

function loadAboutView() {
  if (!AboutViewComponent) {
    import('@/views/AboutView.svelte').then((mod) => {
      AboutViewComponent = mod.default;
    });
  }
}

function loadSettingsView() {
  if (!ExtensionSettingsViewComponent) {
    import('@/views/ExtensionSettingsView.svelte').then((mod) => {
      ExtensionSettingsViewComponent = mod.default;
    });
  }
}

// Cross-browser API (polyfill provides browser, chrome as fallback)
const ext = browser;
let version = $state<string>(packageJson.version);

// --- View state ---
let currentView = $state<View>('main');

// --- Main view ---
let selectedEmail = $state<string>('');
let displayedEmail = $state<string>('');
let dropdownOpen = $state<boolean>(false);
let accountSelectorDropdownOpen = $state<boolean>(false);
let archivedSectionOpen = $state<'active' | 'archived' | 'expired' | null>(null);
let searchQuery = $state<string>('');
let otpOnly = $state<boolean>(false);
let senderDomain = $state<string>('');
let senderEmail = $state<string>('');
let subject = $state<string>('');
let selectedSenders = $state<string[]>([]);
let dateFrom = $state<string>('');
let dateTo = $state<string>('');
let loading = $state<boolean>(false);
let loadingInboxes = $state<boolean>(false);
let loadingEmails = $state<boolean>(false);
let accounts = $state<Account[]>([]);
let allInboxes = $state<Account[]>([]); // Includes archived inboxes for management view
let emails = $state<Email[]>([]);
let unreadByAddress = $state<Record<string, number>>({});
let latestOtp = $state<string>('------');
let latestOtpSender = $state<string>('');
let latestOtpSenderName = $state<string>('');
let otpContext = $state<string>('');
let notificationsEnabled = $state<boolean>(true);
let soundEnabled = $state<boolean>(true);
let expiryWarningThreshold = $state<number>(60 * 60 * 1000); // Default 1 hour
let keybindings = $state<Keybindings>(DEFAULT_KEYBINDINGS);
let autoRefreshInterval = $state<number>(30000);
let emailPreviewEnabled = $state<boolean>(true);
let guerrillaDefaultDomain = $state<string>('');
let isOffline = $state(!navigator.onLine);
let offlineDismissed = $state(false);

$effect(() => {
  function handleOnline() {
    isOffline = false;
    offlineDismissed = false;
  }
  function handleOffline() {
    isOffline = true;
    offlineDismissed = false;
  }
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
});
let savedSearchFilters = $state<SavedSearchFilter[]>([]);
let formDetected = $state<boolean>(false);
let menuOpen = $state<boolean>(false);
let sortBy = $state<string>('newest');

// --- Identities ---
let identities = $state<Identity[]>([]);
let selectedIdentityId = $state<string | null>(null);

async function loadIdentities() {
  try {
    const result = (await browser.storage.local.get(['identities', 'selectedIdentityId'])) as {
      identities?: Identity[];
      selectedIdentityId?: string;
    };
    identities = result.identities || [];
    selectedIdentityId = result.selectedIdentityId || null;
  } catch (error) {
    logError(
      'Failed to load identities',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

// Load identities on mount
$effect(() => {
  loadIdentities();
});

// Load login info when navigating to loginInfo view
$effect(() => {
  if (currentView === 'loginInfo') {
    loadLoginInfo();
  }
});

// --- Toast notifications ---

function showToast(
  message:
    | string
    | {
        message: string;
        type?: ToastType;
        icon?: ToastType;
      },
  type: ToastType = 'success',
  undoAction: (() => void) | null = null
) {
  const messageText = typeof message === 'string' ? message : message.message;

  // Log to activity tab (except for mail-related messages)
  const mailRelatedKeywords = ['email', 'otp', 'message', 'received', 'detected'];
  const isMailRelated = mailRelatedKeywords.some((keyword) =>
    messageText.toLowerCase().includes(keyword)
  );

  if (!isMailRelated) {
    const toastType =
      type === 'success' || type === 'error' || type === 'warning' || type === 'info'
        ? type
        : 'info';
    addToastNotification(messageText, toastType);
  }

  if (typeof message === 'string') {
    const detectedType = getToastTypeFromMessage(message);
    toastStore.add(detectedType, message, undoAction ? 10000 : 3000, undoAction);
  } else {
    const finalType = message.icon || message.type || type;
    const detectedType = getToastTypeFromMessage(message.message);
    toastStore.add(
      finalType === 'success' ? detectedType : finalType,
      message.message,
      undoAction ? 10000 : 3000,
      undoAction
    );
  }
}

// --- Confirmation dialog ---
interface ConfirmDialogState {
  message: string;
  onConfirm: () => void;
  title?: string;
  confirmLabel?: string;
  secondaryLabel?: string;
  onSecondary?: () => void;
  note?: string;
}
let confirmDialog = $state<ConfirmDialogState | null>(null);
let confirmDialogRef = $state<HTMLElement | null>(null);
let confirmPreviousFocus = $state<HTMLElement | null>(null);
let focusTrapCleanup: (() => void) | null = null;
let confirmFocusTimeout: ReturnType<typeof setTimeout> | null = null;
function showConfirm(
  message: string,
  onConfirm: () => void,
  options?: Omit<ConfirmDialogState, 'message' | 'onConfirm'>
) {
  confirmPreviousFocus = document.activeElement as HTMLElement;
  confirmDialog = { message, onConfirm, ...options };
  confirmFocusTimeout = setTimeout(() => {
    if (confirmDialogRef) {
      confirmDialogRef.focus();
      focusTrapCleanup = setupFocusTrap(confirmDialogRef);
    }
    confirmFocusTimeout = null;
  }, 50);
}
function closeConfirm() {
  if (confirmFocusTimeout) {
    clearTimeout(confirmFocusTimeout);
    confirmFocusTimeout = null;
  }
  focusTrapCleanup?.();
  focusTrapCleanup = null;
  confirmDialog = null;
  if (confirmPreviousFocus) {
    confirmPreviousFocus.focus();
    confirmPreviousFocus = null;
  }
}

// --- Filtered emails ---
let filteredEmails = $derived.by(() =>
  applyFilters(emails, {
    searchQuery,
    otpOnly,
    senderDomain,
    senderEmail,
    subject,
    selectedSenders,
    dateFrom,
    dateTo,
    sortBy,
  })
);

// --- Stable wrapper that always delegates to the current loadInboxesFn ---
let loadInboxesFn: (skipEmailSelection?: boolean) => Promise<void> = async () => {};
const stableLoadInboxes = (skipEmailSelection?: boolean) => loadInboxesFn(skipEmailSelection);

// --- Common setters using composable ---
const { inboxSetters, settingsSetters, themeSetters, qrSetters, exportSetters, loginSetters } =
  useCommonSetters({
    // Inbox
    setAccounts: (v) => (accounts = v),
    setAllInboxes: (v) => {
      allInboxes = typeof v === 'function' ? (v as (prev: Account[]) => Account[])(allInboxes) : v;
    },
    setEmails: (v) => (emails = v),
    setLatestOtp: (v) => (latestOtp = v),
    setLatestOtpSender: (v) => (latestOtpSender = v),
    setLatestOtpSenderName: (v) => (latestOtpSenderName = v),
    setOtpContext: (v) => (otpContext = v),
    setSelectedEmail: (v) => (selectedEmail = v),
    setLoading: (v) => (loading = v),
    setLoadingInboxes: (v) => (loadingInboxes = v),
    setLoadingEmails: (v) => (loadingEmails = v),
    setNotificationsEnabled: (v) => (notificationsEnabled = v),
    setSoundEnabled: (v) => (soundEnabled = v),
    setExpiryWarningThreshold: (v) => (expiryWarningThreshold = v),
    setKeybindings: (v) => (keybindings = v),
    setAutoRefreshInterval: (v: number) => (autoRefreshInterval = v),
    setEmailPreviewEnabled: (v: boolean) => (emailPreviewEnabled = v),
    setGuerrillaDefaultDomain: (v: string) => (guerrillaDefaultDomain = v),
    // Settings
    setAutoCopy: (v) => (autoCopy = v),
    setAutoRenew: (v) => (autoRenew = v),
    setSelectedProvider: (v) => (selectedProvider = v),
    setProviderInstances: (v) => (providerInstances = v),
    setSelectedProviderInstance: (v) => (selectedProviderInstance = v),
    setCustomColor: (v) => (customColor = v),
    setShowDeveloperSettings: (v) => (showDeveloperSettings = v),
    setEnableLogging: (v) => (enableLogging = v),
    setSavingSettings: (v) => (savingSettings = v),
    setSettingsLoading: (v) => (settingsLoading = v),
    setEmailRetentionDays: (v) => (emailRetentionDays = v),
    setFaviconCaching: (v) => (faviconCaching = v),
    // Theme
    setThemeMode: (v: ThemeMode) => (themeMode = v),
    setContrastLevel: (v: ContrastLevel) => (contrastLevel = v),
    // QR
    setQrDialogOpen: (open) => (qrDialogOpen = open),
    setQrCanvas: (canvas) => (qrCanvas = canvas),
    setQrDialogElement: (element) => (qrDialogElement = element),
    setPreviousFocusElement: (element) => (previousFocusElement = element),
    // Login
    setSavedLogins: (logins) => (savedLogins = logins as CredentialsHistoryItem[]),
    // Common
    setShowToast: (message, type) => showToast(message, type),
    // Functions
    loadInboxes: stableLoadInboxes,
  });

const bulkActionsSetters: BulkActionsSetters = {
  setSelectedAddresses: (addresses) => (selectedAddresses = addresses),
  setShowToast: (message, type, undoAction) => showToast(message, type, undoAction),
  loadInboxes: stableLoadInboxes,
  showConfirm: (message, onConfirm) => showConfirm(message, onConfirm),
  closeConfirm: () => closeConfirm(),
};

const managementSetters: ManagementSetters = {
  setSelectedEmail: (email) => (selectedEmail = email),
  setEmails: (v) => (emails = v),
  setLoading: (v) => (loading = v),
  setShowToast: (message, type, undoAction) => showToast(message, type, undoAction),
  loadInboxes: stableLoadInboxes,
  setDropdownOpen: (open) => (accountSelectorDropdownOpen = open),
  setEditingAccount: () => {},
  setEditEmailDialogOpen: () => {},
  setArchivedSectionOpen: async (open) => {
    archivedSectionOpen = open ? 'archived' : null;
    accountSelectorDropdownOpen = open;
  },
  showOnboarding: () => {
    // Navigate to main view (which shows onboarding when accounts.length === 0)
    currentView = 'main';
  },
  setAllInboxes: (v) => {
    allInboxes = typeof v === 'function' ? (v as (prev: Account[]) => Account[])(allInboxes) : v;
  },
};

const archivedSetters: ArchivedSetters = {
  setArchivedEmails: (emails) => (archivedEmails = emails),
  setShowToast: (message, type) => showToast(message, type),
  loadInboxes: stableLoadInboxes,
};

const analyticsActions = useAnalyticsActions(
  ext,
  {
    get analytics() {
      return analytics;
    },
    get analyticsLoading() {
      return analyticsLoading;
    },
  },
  {
    setAnalytics: (analyticsData) => (analytics = analyticsData),
    setAnalyticsLoading: (loading) => (analyticsLoading = loading),
  }
);

// --- Mail Settings view ---
let mgmtTab = $state<string>('active');
let mgmtSearch = $state<string>('');
let selectedAddresses = $state<Set<string>>(new Set());
let currentEmailDetail = $state<Account | null>(null);

let mgmtAccounts = $derived(
  allInboxes.filter((a) => {
    const isInactive =
      a.status !== 'active' || a.accountStatus === 'archived' || a.accountStatus === 'deleted';
    const matchesTab = mgmtTab === 'active' ? !isInactive : isInactive;
    const matchesSearch =
      mgmtSearch === '' ||
      a.address.toLowerCase().includes(mgmtSearch.toLowerCase()) ||
      a.provider.toLowerCase().includes(mgmtSearch.toLowerCase()) ||
      a.tag?.toLowerCase().includes(mgmtSearch.toLowerCase());
    return matchesTab && matchesSearch;
  })
);

let allSelected = $derived(
  mgmtAccounts.length > 0 && mgmtAccounts.every((a) => selectedAddresses.has(a.id))
);

// --- Use shared inbox actions composable ---
const inboxActions = useInboxActions(
  {
    ext,
    inboxSetters,
    get searchQuery() {
      return searchQuery;
    },
    get otpOnly() {
      return otpOnly;
    },
    get notificationsEnabled() {
      return notificationsEnabled;
    },
    get selectedEmail() {
      return selectedEmail;
    },
    get latestOtp() {
      return latestOtp;
    },
    showToast,
    get selectedAddresses() {
      return selectedAddresses;
    },
    get accounts() {
      return accounts;
    },
    get allInboxes() {
      return allInboxes;
    },
    get mgmtAccounts() {
      return mgmtAccounts;
    },
  },
  {
    onSelectAccount: () => {
      dropdownOpen = false;
    },
    getActiveInboxId: (selectedEmail: string, accounts: Account[]) => {
      if (!selectedEmail) return undefined;
      const currentAccount = accounts.find((a) => a.address === selectedEmail);
      return currentAccount?.id;
    },
  }
);

// --- Load inboxes from extension storage ---
const loadInboxes = inboxActions.loadInboxes;
const checkMessages = inboxActions.checkMessages;
const selectAccount = inboxActions.selectAccount;
const copyEmail = inboxActions.copyEmail;
const refreshInbox = inboxActions.refreshInbox;
function markOtpEmailRead() {
  const otpEmail = emails.find((e) => e.otp === latestOtp && e.unread);
  if (otpEmail) {
    emails = emails.map((e) => (e.id === otpEmail.id ? { ...e, unread: false } : e));
    browser.storage.local.get(['readEmails']).then((result) => {
      const readEmails = (result.readEmails as Record<string, boolean>) || {};
      readEmails[otpEmail.id] = true;
      browser.storage.local.set({ readEmails });
    });
  }
}
const copyOtp = () => {
  inboxActions.copyOtp();
  markOtpEmailRead();
};
const toggleNotifications = inboxActions.toggleNotifications;

async function updateUnreadByAddress() {
  try {
    const { storedEmails = {}, readEmails = {} } = (await ext.storage.local.get([
      'storedEmails',
      'readEmails',
    ])) as { storedEmails?: Record<string, Email[]>; readEmails?: Record<string, boolean> };
    const counts: Record<string, number> = {};
    for (const [addr, msgs] of Object.entries(storedEmails)) {
      counts[addr] = (msgs as Email[]).filter((m) => !readEmails[m.id]).length;
    }
    unreadByAddress = counts;
  } catch (_e) {}
}

// --- Assign actual function to placeholder for setters ---
loadInboxesFn = (skipEmailSelection?: boolean) => {
  if (skipEmailSelection) inboxActions.setSkipEmailSelection(true);
  return inboxActions.loadInboxes().finally(() => {
    if (skipEmailSelection) inboxActions.setSkipEmailSelection(false);
  });
};

function toggleSelectAll() {
  selectedAddresses = toggleSelectAllAction(mgmtAccounts, selectedAddresses);
}

function toggleSelect(id: string) {
  selectedAddresses = toggleSelectAction(selectedAddresses, id);
}

async function archiveSelected() {
  await archiveSelectedAction(ext, { selectedAddresses, accounts, allInboxes }, bulkActionsSetters);
}

async function unarchiveSelected() {
  await unarchiveSelectedAction(
    ext,
    { selectedAddresses, accounts, allInboxes },
    bulkActionsSetters
  );
}

async function deleteSelected() {
  await deleteSelectedAction(ext, { selectedAddresses, accounts, allInboxes }, bulkActionsSetters);
}

async function toggleAutoExtend(account: Account) {
  await toggleAutoExtendAction(ext, account, managementSetters);
}

async function openEmailDetail(account: Account) {
  currentEmailDetail = account;
  currentView = 'emailDetail';
  loading = true;
  await checkMessages(account.id);
  loading = false;
}

async function autofillForm() {
  await autofillFormAction(ext, selectedEmail, (message, type) => showToast(message, type));
}

// --- Settings view ---
let autoCopy = $state(false);
let autoRenew = $state(false);
let selectedProvider = $state('');
let providerInstances: ProviderInstance[] = $state([]);
let selectedProviderInstance = $state<string | null>(null);
let loadingProviderInstances = $state(false);
let savingSettings = $state<boolean>(false);
let settingsLoading = $state<boolean>(false);
let _showCustomInstanceForm = $state<boolean>(false);
let _customInstanceName = $state<string>('');
let _customInstanceUrl = $state<string>('');
let customColor = $state<string>('');
let showDeveloperSettings = $state(false);
let enableLogging = $state(false);
let emailRetentionDays = $state(30);
let faviconCaching = $state<'direct' | 'local'>('local');

async function loadSettings() {
  await loadSettingsAction(
    ext,
    {
      autoCopy,
      autoRenew,
      selectedProvider,
      providerInstances,
      selectedProviderInstance,
      customColor,
      showDeveloperSettings,
      enableLogging,
      savingSettings,
      settingsLoading,
      emailRetentionDays,
      faviconCaching,
      notificationsEnabled,
      soundEnabled,
      expiryWarningThreshold,
      keybindings,
      autoRefreshInterval,
      emailPreviewEnabled,
      guerrillaDefaultDomain,
    },
    settingsSetters
  );
}

async function saveSettings() {
  await saveSettingsAction(
    ext,
    {
      autoCopy,
      autoRenew,
      selectedProvider,
      providerInstances,
      selectedProviderInstance,
      customColor,
      showDeveloperSettings,
      enableLogging,
      savingSettings,
      settingsLoading,
      emailRetentionDays,
      faviconCaching,
      notificationsEnabled,
      soundEnabled,
      expiryWarningThreshold,
      keybindings,
      autoRefreshInterval,
      emailPreviewEnabled,
      guerrillaDefaultDomain,
    },
    settingsSetters
  );
}

async function toggleDeveloperSettings() {
  await toggleDeveloperSettingsAction(
    ext,
    {
      autoCopy,
      autoRenew,
      selectedProvider,
      providerInstances,
      selectedProviderInstance,
      customColor,
      showDeveloperSettings,
      enableLogging,
      savingSettings,
      settingsLoading,
      emailRetentionDays,
      faviconCaching,
      notificationsEnabled,
      soundEnabled,
      expiryWarningThreshold,
      keybindings,
      autoRefreshInterval,
      emailPreviewEnabled,
      guerrillaDefaultDomain,
    },
    settingsSetters
  );
}

async function toggleEnableLogging() {
  await toggleEnableLoggingAction(
    ext,
    {
      autoCopy,
      autoRenew,
      selectedProvider,
      providerInstances,
      selectedProviderInstance,
      customColor,
      showDeveloperSettings,
      enableLogging,
      savingSettings,
      settingsLoading,
      emailRetentionDays,
      faviconCaching,
      notificationsEnabled,
      soundEnabled,
      expiryWarningThreshold,
      keybindings,
      autoRefreshInterval,
      emailPreviewEnabled,
      guerrillaDefaultDomain,
    },
    settingsSetters
  );
}

async function handleProviderChange(provider: string) {
  await handleProviderChangeAction(ext, provider, settingsSetters);
}

async function saveAutoCopy() {
  await saveAutoCopyAction(ext, autoCopy);
  showToast(`Auto-copy ${autoCopy ? 'enabled' : 'disabled'}`);
}

async function saveAutoRenew() {
  await saveAutoRenewAction(ext, autoRenew);
  showToast(`Auto-renew ${autoRenew ? 'enabled' : 'disabled'}`);
}

async function handleColorChange(color: string) {
  customColor = color;
  await handleColorChangeAction(ext, color);
  applyCustomColor(color);
}

async function changeProvider(provider: string) {
  await changeProviderAction(ext, provider, settingsSetters);
}

async function loadProviderInstances() {
  await loadProviderInstancesAction(ext, settingsSetters);
}

async function setProviderInstance(instanceId: string) {
  await setProviderInstanceAction(instanceId, ext, settingsSetters);
}

async function addCustomInstance(name: string, url: string) {
  await addCustomInstanceAction(ext, name, url, settingsSetters);
}

async function hardReset() {
  await hardResetAction(ext, settingsSetters);
}

async function exportData() {
  try {
    await exportDataAction(ext);
    showToast('Data exported successfully');
  } catch (_e) {
    showToast('Export failed', 'error');
  }
}

function importData() {
  importDataAction(ext, async () => {
    await loadInboxes();
    showToast('Data imported successfully');
  });
}

// --- Analytics view ---
let analytics = $state({
  createdAt: undefined as string | number | undefined,
  accountsCreated: 0,
  emailsReceived: 0,
  otpsDetected: 0,
  notificationsSent: 0,
});
let analyticsLoading = $state(false);

async function loadAnalytics() {
  await analyticsActions.loadAnalytics();
}

async function handleResetAnalytics() {
  await analyticsActions.resetAnalytics();
}

// --- Login Info view ---
let savedLogins = $state<CredentialsHistoryItem[]>([]);

async function loadLoginInfo() {
  await loadLoginInfoAction(ext, loginSetters);
}

// --- Archived Emails view ---
let archivedEmails = $state<Email[]>([]);
let archivedSearch = $state<string>('');
let filteredArchivedEmails = $derived(
  archivedEmails.filter(
    (e) =>
      archivedSearch === '' ||
      e.subject?.toLowerCase().includes(archivedSearch.toLowerCase()) ||
      e.from?.toLowerCase().includes(archivedSearch.toLowerCase())
  )
);
let _currentMessage = $state<Email | null>(null);
let _currentArchivedEmail = $state<Email | null>(null);
let _qrCanvasRef = $state<HTMLCanvasElement | null>(null);
let _qrDialogRef = $state<HTMLElement | null>(null);
let _toastDialogRef = $state<HTMLElement | null>(null);

async function _loadArchivedEmails() {
  await loadArchivedEmailsAction(ext, archivedSetters);
}

async function _restoreArchivedEmail(email: Email) {
  await restoreArchivedInboxAction(ext, email, { archivedEmails }, archivedSetters);
}

async function deleteArchivedEmail(email: Email) {
  await deleteArchivedEmailAction(email, { archivedEmails }, archivedSetters);
}

// --- QR Code dialog ---
let qrDialogOpen = $state(false);
let qrCanvas = $state<HTMLCanvasElement | null>(null);
let qrDialogElement = $state<HTMLElement | null>(null);
let previousFocusElement = $state<HTMLElement | null>(null);

// --- Create Inbox dialog ---
let createInboxDialogOpen = $state(false);
let pendingCreateProvider = $state<string | undefined>(undefined);
let pendingCreateInstanceId = $state<string | undefined>(undefined);

async function createInbox(provider?: string, instanceId?: string, emailUser?: string) {
  inboxActions.setSkipEmailSelection(true);
  await createInboxAction(ext, inboxSetters, provider, instanceId, emailUser);
  inboxActions.setSkipEmailSelection(false);
}

function openCreateInboxDialog(provider?: string, instanceId?: string) {
  // Resolve the instanceId: use the passed instanceId, or fall back to selectedProviderInstance
  const resolvedProvider = provider || selectedProvider || undefined;
  const resolvedInstanceId =
    instanceId ||
    (selectedProviderInstance && selectedProviderInstance !== 'random'
      ? selectedProviderInstance
      : undefined);

  // Use JSON config to decide if a custom username dialog is needed
  if (resolvedProvider) {
    try {
      const config = loadProviderConfig(resolvedProvider);
      if (!config.customEmail?.supported) {
        createInbox(resolvedProvider, resolvedInstanceId);
        return;
      }
    } catch {
      // Unknown provider, fall through to dialog
    }
  }
  // Store pending provider/instance so handleCreateInbox can use them
  pendingCreateProvider = resolvedProvider;
  pendingCreateInstanceId = resolvedInstanceId;
  createInboxDialogOpen = true;
}

async function handleCreateInboxWithProvider(provider?: string, instanceId?: string) {
  // Use JSON config to decide if a custom username dialog is needed
  if (provider) {
    try {
      const config = loadProviderConfig(provider);
      if (!config.customEmail?.supported) {
        await createInboxAction(ext, inboxSetters, provider, instanceId);
        return;
      }
    } catch {
      // Unknown provider, fall through to dialog
    }
  }
  // For providers with customEmail.supported (e.g., guerrilla), show dialog
  openCreateInboxDialog(provider, instanceId);
}

async function handleCreateInbox(type: 'random' | 'custom', username?: string) {
  createInboxDialogOpen = false;
  const provider = pendingCreateProvider;
  const instanceId = pendingCreateInstanceId;
  pendingCreateProvider = undefined;
  pendingCreateInstanceId = undefined;
  if (type === 'random') {
    await createInbox(provider, instanceId);
  } else {
    await createInbox(provider, instanceId, username);
  }
}

async function openQrDialog() {
  await openQrDialogAction(
    displayedEmail || selectedEmail,
    { qrDialogOpen, qrCanvas, qrDialogElement, previousFocusElement, customColor },
    qrSetters,
    setupFocusTrap
  );
}

function closeQrDialog() {
  closeQrDialogAction(
    focusTrapCleanup,
    { qrDialogOpen, qrCanvas, qrDialogElement, previousFocusElement, customColor },
    qrSetters
  );
}

function downloadQrCode() {
  downloadQrCodeAction(qrCanvas, displayedEmail || selectedEmail, (message) => showToast(message));
}

async function copyQrImage() {
  await copyQrImageAction(qrCanvas, (message, type) => showToast(message, type));
}

// --- Message detail ---
let selectedMessage = $state<Email | null>(null);

function openMessageDetail(message: Email) {
  selectedMessage = message;
  currentView = 'messageDetail';

  // Mark email as read
  if (message.unread) {
    message.unread = false;
    // Save read state to storage
    browser.storage.local.get(['readEmails']).then((result) => {
      const readEmails = (result.readEmails as Record<string, boolean>) || {};
      readEmails[message.id] = true;
      browser.storage.local.set({ readEmails });
    });
    // Update emails array to reflect read state (trigger reactivity)
    const emailIndex = emails.findIndex((e) => e.id === message.id);
    if (emailIndex !== -1) {
      emails = emails.map((e, i) => (i === emailIndex ? { ...e, unread: false } : e));
    }
    // Immediately decrement footer badge — don't wait for next storage poll
    if (selectedEmail && unreadByAddress[selectedEmail] > 0) {
      unreadByAddress = { ...unreadByAddress, [selectedEmail]: unreadByAddress[selectedEmail] - 1 };
    }
  }
}

// --- Remove account (delete inbox) ---
async function removeAccount(address: string) {
  const account = allInboxes.find((a) => a.address === address);
  if (!account) return;
  const doDelete = async () => {
    closeConfirm();
    await removeAccountAction(ext, account, { selectedEmail, emails, loading }, managementSetters);
  };
  const doArchive = async () => {
    closeConfirm();
    await archiveAccountAction(
      ext,
      account,
      accounts,
      { selectedEmail, emails, loading },
      managementSetters
    );
  };
  showConfirm(
    `"${account.address}" and its saved emails will be permanently deleted from this extension. The inbox may still be accessible on the provider's website.`,
    doDelete,
    {
      title: 'Delete Inbox',
      confirmLabel: 'Delete Permanently',
      secondaryLabel: 'Archive instead (keep record)',
      onSecondary: account.accountStatus !== 'archived' ? doArchive : undefined,
      note: `Archive keeps the local record and saved emails. Delete permanently removes them from this extension.`,
    }
  );
}

// --- Restore deleted account ---
async function restoreAccount(address: string) {
  const account = allInboxes.find((a) => a.address === address);
  if (!account) return;
  await restoreAccountAction(ext, account, managementSetters);
}

// --- Archive single account from row ---
async function archiveAccount(account: Account) {
  if (account.accountStatus === 'deleted') {
    showConfirm(`"${account.address}" is deleted. Archive it anyway?`, async () => {
      closeConfirm();
      await restoreAccountAction(ext, account, managementSetters);
      await archiveAccountAction(
        ext,
        account,
        accounts,
        { selectedEmail, emails, loading },
        managementSetters
      );
    });
    return;
  }
  await archiveAccountAction(
    ext,
    account,
    accounts,
    { selectedEmail, emails, loading },
    managementSetters
  );
}

async function unarchiveAccount(account: Account) {
  await unarchiveAccountAction(ext, account, managementSetters);
}

// --- Export single inbox emails ---
async function exportAccountEmails(account: Account) {
  await exportAccountEmailsAction(ext, account, exportSetters);
}

// --- Show export format dialog ---
function showExportFormatDialog() {
  return showExportFormatDialogAction();
}

/**
 * Exports emails from an account in the specified format.
 *
 * Supported formats:
 * - json: Exports as a JSON file containing address, provider, and message data
 * - eml: Exports as EML format (single email) or ZIP (multiple emails)
 * - mbox: Exports as MBOX format for email clients
 *
 * @param account - The account containing the email address and provider info
 * @param msgs - Array of email messages to export
 * @param format - The export format ('json', 'eml', or 'mbox')
 * @throws Error if export fails
 */
async function exportEmailsWithFormat(account: Account, msgs: Email[], format: string) {
  await exportEmailsWithFormatAction(account, msgs, format);
  showToast(`Emails exported as ${format.toUpperCase()}`);
}

// --- Generate single EML content ---
function generateSingleEMLContent(account: Account, message: Email): string {
  return generateSingleEMLContentAction(account, message);
}

/**
 * Generates MBOX format content from an array of email messages.
 * MBOX is a standard format for storing email messages that can be imported by most email clients.
 * Each message is separated by a "From " line followed by the message content.
 *
 * @param account - The account containing the email address
 * @param messages - Array of email messages to convert to MBOX format
 * @returns A string containing the MBOX formatted email data
 */
function generateMBOXContent(account: Account, messages: Email[]): string {
  return generateMBOXContentAction(account, messages);
}

// --- Export multiple EML as ZIP ---
async function exportMultipleEMLAsZip(account: Account, messages: Email[], baseFilename: string) {
  await exportMultipleEMLAsZipAction(account, messages, baseFilename);
}

// --- Export selected bulk ---
async function exportSelected() {
  await exportSelectedAction(accounts, selectedAddresses, exportAccountEmails);
}

// --- Extend single account (Guerrilla only) ---
async function extendAccount(account: Account) {
  await extendAccountAction(ext, account, managementSetters);
}

// --- Theme management ---
import type { ContrastLevel, ThemeMode } from '@/features/theme/theme-actions.js';

let themeMode = $state<ThemeMode>('system');
let contrastLevel = $state<ContrastLevel>('standard');

function _toggleTheme() {
  toggleThemeAction({ themeMode, customColor, contrastLevel }, themeSetters, ext);
}

function setThemeMode(mode: ThemeMode) {
  setThemeModeAction(mode, customColor, contrastLevel, themeSetters, ext);
}

function applyTheme() {
  applyThemeAction(themeMode, contrastLevel);
}

async function syncThemeSettings() {
  const themeData = (await ext.storage.local.get(['themeMode', 'contrastLevel'])) as {
    themeMode?: string;
    contrastLevel?: string;
  };
  if (
    themeData.themeMode === 'light' ||
    themeData.themeMode === 'system' ||
    themeData.themeMode === 'dark'
  ) {
    themeMode = themeData.themeMode;
  }
  if (
    themeData.contrastLevel === 'standard' ||
    themeData.contrastLevel === 'medium' ||
    themeData.contrastLevel === 'high'
  ) {
    contrastLevel = themeData.contrastLevel;
  }
  applyTheme();
  if (customColor) {
    applyCustomColor(customColor);
  }
}

function setContrastLevel(level: ContrastLevel) {
  contrastLevel = level;
  applyThemeAction(themeMode, contrastLevel);
  if (customColor) {
    applyCustomColor(customColor);
  }
  ext.storage.local.set({ contrastLevel: level });
}

// Listen for system theme changes
const cleanupSystemThemeListener = listenForSystemThemeChanges(
  () => themeMode,
  () => contrastLevel,
  applyTheme
);

// --- Restore archived email ---
async function restoreArchivedInbox(email: Email) {
  try {
    const result = (await ext.storage.local.get(['inboxes'])) as { inboxes?: Account[] };
    const inboxes = result.inboxes || [];
    const updated = inboxes.map((i: Account) =>
      i.id === email.id ? { ...i, accountStatus: 'active' as const } : i
    );
    await ext.storage.local.set({ inboxes: updated });
    archivedEmails = archivedEmails.filter((e) => e.id !== email.id);
    showToast('Email restored');
  } catch (_e) {
    showToast('Failed to restore', 'error');
  }
}

function _openMessageWindow(message: Email) {
  if (!openMessageWindow(message)) {
    openMessageDetail(message);
  }
}

// --- Saved search filters ---
const { loadSavedSearchFilters, saveFilter, renameFilter, loadFilter, clearFilters, deleteFilter } =
  useSavedSearchFilters(
    ext,
    {
      get savedSearchFilters() {
        return savedSearchFilters;
      },
    },
    {
      setSavedSearchFilters: (filters) => (savedSearchFilters = filters),
      setSearchQuery: (value) => (searchQuery = value),
      setOtpOnly: (value) => (otpOnly = value),
      setSenderDomain: (value) => (senderDomain = value),
      setSenderEmail: (value) => (senderEmail = value),
      setSubject: (value) => (subject = value),
      setSelectedSenders: (value) => (selectedSenders = value),
      setDateFrom: (value) => (dateFrom = value),
      setDateTo: (value) => (dateTo = value),
      setSortBy: (value) => (sortBy = value),
      showToast: (message, type) => showToast(message, type),
    }
  );

useExtensionStorageSync([
  {
    keys: SETTINGS_SYNC_KEYS,
    onChange: async () => {
      await loadSettings();
      await loadProviderInstances();
    },
  },
  { keys: THEME_SYNC_KEYS, onChange: syncThemeSettings },
  { keys: INBOX_SYNC_KEYS, onChange: () => loadInboxes(true) },
  { keys: IDENTITY_SYNC_KEYS, onChange: loadIdentities },
  { keys: FILTER_SYNC_KEYS, onChange: loadSavedSearchFilters },
  { keys: ANALYTICS_SYNC_KEYS, onChange: loadAnalytics },
  { keys: LOGIN_INFO_SYNC_KEYS, onChange: () => loadLoginInfo() },
  { keys: READ_EMAILS_SYNC_KEYS, onChange: updateUnreadByAddress },
]);

let _lastAppliedColor = $state<string>('');

$effect(() => {
  if (customColor && customColor !== _lastAppliedColor) {
    applyCustomColor(customColor);
    _lastAppliedColor = customColor;
  }
});

// --- Initialize on mount ---
onMount(async () => {
  window.addEventListener('keydown', handleKeydown);
  updateUnreadByAddress();

  // Listen for storedEmails storage changes (set by background periodic check)
  const handleStorageChange = async (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>
  ) => {
    if (changes.storedEmails && selectedEmail) {
      // Read emails directly from storage instead of calling checkMessages
      try {
        const { storedEmails = {}, readEmails = {} } = (await ext.storage.local.get([
          'storedEmails',
          'readEmails',
        ])) as {
          storedEmails?: Record<string, Email[]>;
          readEmails?: Record<string, boolean>;
        };
        const inboxEmails = storedEmails[selectedEmail] || [];
        const mappedEmails = inboxEmails.map((m: Email & { from_address?: string }) => ({
          id: m.id,
          from: m.from_address || m.from || m.from_name || 'Unknown',
          from_name: m.from_name || m.from_address || m.from || '',
          subject: m.subject || 'No Subject',
          time: timeAgo(m.received_at),
          isOtp: !!m.otp,
          otp: m.otp || null,
          body: m.body_plain || (m.body_html || '').replace(/<[^>]*>/g, ''),
          body_html: m.body_html,
          unread: !readEmails[m.id],
          received_at: m.received_at,
          local_only: m.local_only,
        }));
        inboxSetters.setEmails([...mappedEmails]);
        // Update cross-inbox unread counts
        const unreadCounts: Record<string, number> = {};
        for (const [addr, msgs] of Object.entries(storedEmails)) {
          unreadCounts[addr] = (msgs as Email[]).filter((m) => !readEmails[m.id]).length;
        }
        unreadByAddress = unreadCounts;
        // Find latest OTP from ALL inboxes (global OTP)
        const allOtps: Email[] = [];
        Object.values(storedEmails).forEach((inboxEmails: Email[]) => {
          inboxEmails.forEach((m: Email) => {
            if (m.otp) allOtps.push(m);
          });
        });
        const latestOtpMsg = allOtps.sort((a: Email, b: Email) => b.received_at - a.received_at)[0];
        logDebug(`[${context}] latestOtpMsg: ${JSON.stringify(latestOtpMsg)}`);
        if (latestOtpMsg?.otp) {
          inboxSetters.setLatestOtp(latestOtpMsg.otp);
          inboxSetters.setLatestOtpSender(latestOtpMsg.from || '');
          inboxSetters.setLatestOtpSenderName(latestOtpMsg.from_name || '');
          logDebug(
            `[${context}] Set OTP sender - from: ${latestOtpMsg.from}, from_name: ${latestOtpMsg.from_name}`
          );
          inboxSetters.setOtpContext(
            [
              latestOtpMsg.from_name ? `From: ${latestOtpMsg.from_name}` : '',
              timeAgo(latestOtpMsg.received_at),
            ]
              .filter(Boolean)
              .join(' | ')
          );
        }
      } catch (e) {
        logError('Error reading emails from storage', e);
      }
    }
  };

  browser.storage.onChanged.addListener(handleStorageChange);

  // Debounced storage poll function
  let pollTimeout: ReturnType<typeof setTimeout> | null = null;
  const debouncedPoll = async () => {
    if (pollTimeout) clearTimeout(pollTimeout);
    pollTimeout = setTimeout(async () => {
      if (selectedEmail && !document.hidden) {
        try {
          const { storedEmails = {}, readEmails = {} } = (await ext.storage.local.get([
            'storedEmails',
            'readEmails',
          ])) as {
            storedEmails?: Record<string, Email[]>;
            readEmails?: Record<string, boolean>;
          };
          const inboxEmails = storedEmails[selectedEmail] || [];
          const mappedEmails = inboxEmails.map((m: Email & { from_address?: string }) => ({
            id: m.id,
            from: m.from_address || m.from || m.from_name || 'Unknown',
            from_name: m.from_name || m.from_address || m.from || '',
            subject: m.subject || 'No Subject',
            time: timeAgo(m.received_at),
            isOtp: !!m.otp,
            otp: m.otp || null,
            body: m.body_plain || (m.body_html || '').replace(/<[^>]*>/g, ''),
            body_html: m.body_html,
            unread: !readEmails[m.id],
            received_at: m.received_at,
            local_only: m.local_only,
          }));
          inboxSetters.setEmails([...mappedEmails]);
          // Update cross-inbox unread counts
          const unreadCounts2: Record<string, number> = {};
          for (const [addr, msgs] of Object.entries(storedEmails)) {
            unreadCounts2[addr] = (msgs as Email[]).filter((m) => !readEmails[m.id]).length;
          }
          unreadByAddress = unreadCounts2;
          // Find latest OTP from ALL inboxes (global OTP)
          const allOtps: Email[] = [];
          Object.values(storedEmails).forEach((inboxEmails: Email[]) => {
            inboxEmails.forEach((m: Email) => {
              if (m.otp) allOtps.push(m);
            });
          });
          const latestOtpMsg = allOtps.sort(
            (a: Email, b: Email) => b.received_at - a.received_at
          )[0];
          logDebug(`[${context}] latestOtpMsg (create): ${JSON.stringify(latestOtpMsg)}`);
          if (latestOtpMsg?.otp) {
            inboxSetters.setLatestOtp(latestOtpMsg.otp);
            inboxSetters.setLatestOtpSender(latestOtpMsg.from || '');
            inboxSetters.setLatestOtpSenderName(latestOtpMsg.from_name || '');
            logDebug(
              `[${context}] Set OTP sender (create) - from: ${latestOtpMsg.from}, from_name: ${latestOtpMsg.from_name}`
            );
            inboxSetters.setOtpContext(
              [
                latestOtpMsg.from_name ? `From: ${latestOtpMsg.from_name}` : '',
                timeAgo(latestOtpMsg.received_at),
              ]
                .filter(Boolean)
                .join(' | ')
            );
          }
        } catch (e) {
          logError('Error polling emails from storage', e);
        }
      }
    }, 500); // Debounce for 500ms
  };

  // Poll storage every 10 seconds as backup (more reliable than storage.onChanged)
  // Only poll when page is visible to save resources
  const pollInterval = setInterval(debouncedPoll, 10000);

  // Cleanup on destroy
  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown);
    browser.storage.onChanged.removeListener(handleStorageChange);
    clearInterval(pollInterval);
    if (pollTimeout) clearTimeout(pollTimeout);
    cleanupSystemThemeListener();
  });

  // Restore theme settings
  const themeData = (await ext.storage.local.get(['themeMode', 'contrastLevel'])) as {
    themeMode?: string;
    contrastLevel?: string;
  };
  if (
    themeData.themeMode === 'light' ||
    themeData.themeMode === 'system' ||
    themeData.themeMode === 'dark'
  ) {
    themeMode = themeData.themeMode;
  }
  if (
    themeData.contrastLevel === 'standard' ||
    themeData.contrastLevel === 'medium' ||
    themeData.contrastLevel === 'high'
  ) {
    contrastLevel = themeData.contrastLevel;
  }
  applyTheme();
  await loadInboxes();
  await loadSettings();
  await loadSavedSearchFilters();
  await loadAnalytics();

  // App context: restore state that was saved when expanding popup to app window
  if (context === 'app') {
    const expandedAppStateData = (await ext.storage.local.get(['expandedAppState'])) as {
      expandedAppState?: {
        currentView?: View;
        mgmtTab?: string;
        mgmtSearch?: string;
        selectedEmail?: string;
        selectedMessage?: Email | null;
        currentEmailDetail?: Account | null;
        archivedSearch?: string;
      };
    };
    const expandedAppState = expandedAppStateData.expandedAppState;
    if (expandedAppState) {
      await ext.storage.local.remove(['expandedAppState']);

      if (expandedAppState.mgmtTab) mgmtTab = expandedAppState.mgmtTab;
      if (expandedAppState.mgmtSearch !== undefined) mgmtSearch = expandedAppState.mgmtSearch;
      if (expandedAppState.archivedSearch !== undefined) {
        archivedSearch = expandedAppState.archivedSearch;
      }

      if (
        expandedAppState.selectedEmail &&
        allInboxes.some((inbox: Account) => inbox.address === expandedAppState.selectedEmail)
      ) {
        await selectAccount(expandedAppState.selectedEmail);
      }

      if (expandedAppState.currentView === 'messageDetail' && expandedAppState.selectedMessage) {
        selectedMessage = expandedAppState.selectedMessage;
        currentView = 'messageDetail';
      } else if (
        expandedAppState.currentView === 'emailDetail' &&
        expandedAppState.currentEmailDetail
      ) {
        currentEmailDetail = expandedAppState.currentEmailDetail;
        currentView = 'emailDetail';
      } else if (expandedAppState.currentView) {
        currentView = expandedAppState.currentView;
      }
    }

    // Check for expanded email from the message detail expand button
    const expandedEmailData = (await ext.storage.local.get([
      'expandedEmailId',
      'expandedInboxAddress',
      'expandedInboxId',
      'expandedMessage',
    ])) as {
      expandedEmailId?: string;
      expandedInboxAddress?: string;
      expandedInboxId?: string;
      expandedMessage?: Email;
    };
    if (expandedEmailData.expandedMessage || expandedEmailData.expandedEmailId) {
      const { expandedEmailId, expandedInboxAddress, expandedInboxId, expandedMessage } =
        expandedEmailData;
      await ext.storage.local.remove([
        'expandedEmailId',
        'expandedInboxAddress',
        'expandedInboxId',
        'expandedMessage',
      ]);

      const inbox = allInboxes.find(
        (i: Account) => i.id === expandedInboxId || i.address === expandedInboxAddress
      );
      if (inbox) {
        await selectAccount(inbox.address);
      }

      const email = expandedMessage || emails.find((e: Email) => e.id === expandedEmailId);
      if (email) {
        selectedMessage = email;
        currentView = 'messageDetail';
      }
    }
  }

  // Check for pending email open from notification click
  const pendingEmailOpen = (await ext.storage.local.get(['pendingEmailOpen'])) as {
    pendingEmailOpen?: { emailId: string; inboxId: string };
  };
  if (pendingEmailOpen.pendingEmailOpen) {
    const { emailId, inboxId } = pendingEmailOpen.pendingEmailOpen;
    // Clear the pending email open
    await ext.storage.local.remove(['pendingEmailOpen']);

    // Find the inbox address from allInboxes list
    const inbox = allInboxes.find((i: Account) => i.id === inboxId);
    if (inbox) {
      // Select this inbox
      await selectAccount(inbox.address);

      // Load emails for this inbox
      loading = true;
      await checkMessages(inbox.id);
      loading = false;

      // Auto-open the email detail for the specific email
      const targetEmail = emails.find((e: Email) => e.id === emailId);
      if (targetEmail) {
        openMessageDetail(targetEmail);
      }
    }
  } else {
    const result = (await ext.storage.local.get(['activeInboxId'])) as { activeInboxId?: string };
    if (result.activeInboxId) {
      loading = true;
      await checkMessages(result.activeInboxId);
      loading = false;
    }
  }
  // Check form detection from active tab via messaging
  try {
    const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      const response = await ext.tabs.sendMessage(tab.id, { type: 'checkFormDetected' });
      formDetected = response?.formDetected || false;
    }
  } catch {
    formDetected = false;
  }
  // Listen for tab activation to check form detection on new tab
  ext.tabs.onActivated.addListener(async (activeInfo) => {
    try {
      const response = await ext.tabs.sendMessage(activeInfo.tabId, { type: 'checkFormDetected' });
      formDetected = response?.formDetected || false;
    } catch {
      formDetected = false;
    }
  });
});

// --- Keyboard shortcuts ---
function handleKeydown(event: KeyboardEvent) {
  handleKeydownAction(
    event,
    {
      currentView,
      mgmtTab,
      selectedAddresses,
      mgmtSearch,
      qrDialogOpen,
      confirmDialog,
      selectedMessage,
      currentEmailDetail,
    },
    {
      refreshInbox,
      createInbox,
      copyEmail,
      copyOtp,
      closeConfirm,
      closeQrDialog,
      setCurrentView: (view) => (currentView = view as View),
      setSelectedAddresses: (addresses) => (selectedAddresses = addresses),
      setMgmtSearch: (search) => (mgmtSearch = search),
      setSelectedMessage: (message: Email | null) => (selectedMessage = message),
      setCurrentEmailDetail: (detail: Account | null) => (currentEmailDetail = detail),
    },
    keybindings
  );
}
</script>

<ErrorBoundary>
  <div class="flex justify-center items-start min-h-screen bg-md-background">
    <div class="w-[375px] bg-md-surface shadow-xl flex flex-col transition-all duration-300 ease-in-out rounded-2xl" style="height: 600px; min-height: 600px; padding: 7.5px;">
      <!-- Header -->
      <Header
        themeMode={themeMode === 'system' ? 'auto' : themeMode}
        onThemeChange={(mode) => setThemeMode(mode === 'auto' ? 'system' : mode)}
        expandState={{
          currentView,
          mgmtTab,
          mgmtSearch,
          selectedEmail,
          selectedMessage,
          currentEmailDetail,
          archivedSearch,
        }}
      />

    <!-- Main content area -->
    <div class="flex-1 overflow-hidden relative">
      <div class="h-full overflow-x-hidden pb-16 flex flex-col">

  {#if currentView === 'mailSettings'}
    <MailManagementView {context}
    onBack={() => { currentView = 'main'; selectedAddresses = new Set(); mgmtSearch = ''; }}
    mgmtTab={mgmtTab}
    mgmtSearch={mgmtSearch}
    selectedAddresses={selectedAddresses}
    mgmtAccounts={mgmtAccounts}
    allSelected={allSelected}
    loadingInboxes={loadingInboxes}
    onTabChange={(tab) => { mgmtTab = tab; selectedAddresses = new Set(); }}
    onSearchChange={(value) => mgmtSearch = value}
    onToggleSelectAll={toggleSelectAll}
    onToggleSelect={(id) => toggleSelect(id)}
    onArchiveSelected={archiveSelected}
    onUnarchiveSelected={unarchiveSelected}
    onDeleteSelected={deleteSelected}
    onExportSelected={exportSelected}
    onOpenEmailDetail={openEmailDetail}
    onArchiveAccount={archiveAccount}
    onUnarchiveAccount={unarchiveAccount}
    onExportAccountEmails={exportAccountEmails}
    onGenerateNewAddress={() => currentView = 'main'}
    onExtendAccount={extendAccount}
    />

  {:else if currentView === 'emailDetail'}
    <EmailDetail
      onBack={() => { currentView = 'mailSettings'; currentEmailDetail = null; }}
      currentEmailDetail={currentEmailDetail}
      emails={emails}
      loading={loading}
      onOpenMessageDetail={openMessageDetail}
      onRefreshMessages={async () => {
        if (currentEmailDetail) {
          loading = true;
          await checkMessages(currentEmailDetail.id);
          loading = false;
        }
      }}
      onExportEmail={() => {
        if (currentEmailDetail) {
          exportAccountEmails(currentEmailDetail);
        }
      }}
    />

  {:else if currentView === 'settings'}
    {loadSettingsView()}
    {#if ExtensionSettingsViewComponent}
      {@const Settings = ExtensionSettingsViewComponent}
      <Settings {context}
        onBack={() => currentView = 'main'}
        autoCopy={autoCopy}
        autoRenew={autoRenew}
        selectedProvider={selectedProvider}
        savingSettings={savingSettings}
        loading={loading}
        settingsLoading={settingsLoading}
        onSaveSettings={saveSettings}
        onSetAutoCopy={(v: boolean) => { autoCopy = v; }}
        onSetAutoRenew={(v: boolean) => { autoRenew = v; }}
        onHardReset={hardReset}
        providerInstances={providerInstances}
        selectedProviderInstance={selectedProviderInstance}
        onSetProviderInstance={(v: string) => { selectedProviderInstance = v; }}
        onExportData={exportData}
        onImportData={importData}
        onProviderChange={handleProviderChange}
        onAddCustomInstance={addCustomInstance}
        onLoadProviderInstances={loadProviderInstances}
        customColor={customColor}
        onColorChange={(v: string) => { customColor = v; }}
        contrastLevel={contrastLevel}
        onContrastLevelChange={setContrastLevel}
        showDeveloperSettings={showDeveloperSettings}
        enableLogging={enableLogging}
        onToggleDeveloperSettings={toggleDeveloperSettings}
        onToggleEnableLogging={toggleEnableLogging}
        emailRetentionDays={emailRetentionDays}
        onSetEmailRetentionDays={(v: number) => { emailRetentionDays = v; }}
        faviconCaching={faviconCaching}
        onSetFaviconCaching={(v: 'direct' | 'local') => { faviconCaching = v; }}
        identities={identities}
        selectedIdentityId={selectedIdentityId}
        onSetSelectedIdentityId={(id: string | null) => {
          selectedIdentityId = id;
          browser.storage.local.set({ selectedIdentityId: id });
        }}
        onNavigateToIdentities={() => currentView = 'identities'}
        notificationsEnabled={notificationsEnabled}
        soundEnabled={soundEnabled}
        expiryWarningThreshold={expiryWarningThreshold}
        onSetNotificationsEnabled={(v: boolean) => { notificationsEnabled = v; }}
        onSetSoundEnabled={(v: boolean) => { soundEnabled = v; }}
        onSetExpiryWarningThreshold={(v: number) => { expiryWarningThreshold = v; }}
        keybindings={keybindings}
        onSetKeybindings={(v: Keybindings) => { keybindings = v; }}
        onNavigateToKeybindings={() => { currentView = 'keybindings'; }}
        onNavigateToTagManagement={() => { currentView = 'tagManagement'; }}
        onNavigateToFiltersManagement={() => { currentView = 'filtersManagement'; }}
        onNavigateToMailProvider={() => { currentView = 'mailProvider'; }}
        onNavigateToStoragePerformance={() => { currentView = 'storagePerformance'; }}
        onNavigateToLabelManagement={() => { currentView = 'labelManagement'; }}
        onNavigateToMailboxManagement={() => { currentView = 'mailboxManagement'; }}
        autoRefreshInterval={autoRefreshInterval}
        onSetAutoRefreshInterval={(v: number) => {
          autoRefreshInterval = v;
          browser.storage.local.set({ autoRefreshInterval: v });
          browser.runtime.sendMessage({ type: 'updateRefreshInterval', intervalMs: v });
        }}
        emailPreviewEnabled={emailPreviewEnabled}
        onSetEmailPreviewEnabled={(v: boolean) => { emailPreviewEnabled = v; }}
        guerrillaDefaultDomain={guerrillaDefaultDomain}
        onSetGuerrillaDefaultDomain={(v: string) => { guerrillaDefaultDomain = v; }}
        allInboxes={allInboxes}
      />
    {:else}
      <div class="flex items-center justify-center h-full">
        <div class="text-sm text-md-on-surface/50">Loading...</div>
      </div>
    {/if}

  {:else if currentView === 'analytics'}
    <ActivityView {context}
      onBack={() => currentView = 'main'}
      analytics={analytics}
      loading={analyticsLoading}
      onLoadAnalytics={loadAnalytics}
      onResetAnalytics={handleResetAnalytics}
    />

  {:else if currentView === 'loginInfo'}
    <SavedLoginInfoView {context}
      onBack={() => currentView = 'main'}
      savedLogins={savedLogins}
      onDelete={(id) => savedLogins = savedLogins.filter(l => l.id !== id)}
      showToast={(message) => showToast(message)}
      identities={identities}
    />

  {:else if currentView === 'keybindings'}
    <KeyboardShortcutsView
      onBack={() => currentView = 'settings'}
      {keybindings}
      onSetKeybindings={(v: Keybindings) => { keybindings = v; }}
      onSaveSettings={saveSettings}
    />

  {:else if currentView === 'tagManagement'}
    <TagManagementView
      onBack={() => currentView = 'settings'}
      allInboxes={allInboxes}
      onReloadAccounts={async () => { await loadInboxes(true); }}
    />

  {:else if currentView === 'filtersManagement'}
    <FiltersManagementView
      onBack={() => currentView = 'settings'}
      savedSearchFilters={savedSearchFilters}
      onFiltersChange={async () => { await loadSavedSearchFilters(); }}
    />

  {:else if currentView === 'mailProvider'}
    <MailProviderView
      onBack={() => currentView = 'settings'}
      selectedProvider={selectedProvider}
      autoRenew={autoRenew}
      notificationsEnabled={notificationsEnabled}
      soundEnabled={soundEnabled}
      expiryWarningThreshold={expiryWarningThreshold}
      autoRefreshInterval={autoRefreshInterval}
      emailPreviewEnabled={emailPreviewEnabled}
      providerInstances={providerInstances}
      selectedProviderInstance={selectedProviderInstance}
      guerrillaDefaultDomain={guerrillaDefaultDomain}
      allInboxes={allInboxes}
      onProviderChange={handleProviderChange}
      onSetAutoRenew={(v: boolean) => { autoRenew = v; }}
      onSetNotificationsEnabled={(v: boolean) => { notificationsEnabled = v; }}
      onSetSoundEnabled={(v: boolean) => { soundEnabled = v; }}
      onSetExpiryWarningThreshold={(v: number) => { expiryWarningThreshold = v; }}
      onSetAutoRefreshInterval={(v: number) => {
        autoRefreshInterval = v;
        browser.storage.local.set({ autoRefreshInterval: v });
        browser.runtime.sendMessage({ type: 'updateRefreshInterval', intervalMs: v });
      }}
      onSetEmailPreviewEnabled={(v: boolean) => { emailPreviewEnabled = v; }}
      onSetProviderInstance={(v: string) => { selectedProviderInstance = v; }}
      onAddCustomInstance={addCustomInstance}
      onLoadProviderInstances={loadProviderInstances}
      onSetGuerrillaDefaultDomain={(v: string) => { guerrillaDefaultDomain = v; }}
      onSaveSettings={saveSettings}
    />

  {:else if currentView === 'storagePerformance'}
    <StoragePerformanceView
      onBack={() => currentView = 'settings'}
      faviconCaching={faviconCaching}
      emailRetentionDays={emailRetentionDays}
      onSetFaviconCaching={(v: 'direct' | 'local') => { faviconCaching = v; }}
      onSetEmailRetentionDays={(v: number) => { emailRetentionDays = v; }}
      onSaveSettings={saveSettings}
      onClearOldEmails={async () => { /* clearOldEmails handled inside StoragePerformanceView */ }}
    />

  {:else if currentView === 'labelManagement'}
    <LabelManagementView
      onBack={() => currentView = 'settings'}
    />

  {:else if currentView === 'mailboxManagement'}
    <MailManagementView {context}
      onBack={() => { currentView = 'settings'; selectedAddresses = new Set(); mgmtSearch = ''; }}
      mgmtTab={mgmtTab}
      mgmtSearch={mgmtSearch}
      selectedAddresses={selectedAddresses}
      mgmtAccounts={mgmtAccounts}
      allSelected={allSelected}
      loadingInboxes={loadingInboxes}
      onTabChange={(tab) => mgmtTab = tab}
      onSearchChange={(v) => mgmtSearch = v}
      onToggleSelectAll={toggleSelectAll}
      onToggleSelect={(id) => toggleSelect(id)}
      onArchiveSelected={archiveSelected}
      onUnarchiveSelected={unarchiveSelected}
      onDeleteSelected={deleteSelected}
      onExportSelected={exportSelected}
      onOpenEmailDetail={(acc) => { currentEmailDetail = acc; currentView = 'emailDetail'; }}
      onArchiveAccount={archiveAccount}
      onUnarchiveAccount={unarchiveAccount}
      onExtendAccount={extendAccount}
    />

  {:else if currentView === 'archivedEmails'}
    <ArchivedEmails
      onBack={() => currentView = 'main'}
      archivedSearch={archivedSearch}
      filteredArchivedEmails={filteredArchivedEmails}
      onSearchChange={(value) => archivedSearch = value}
      onRestore={restoreArchivedInbox}
      onDelete={deleteArchivedEmail}
      onClearSearch={() => archivedSearch = ''}
    />

  {:else if currentView === 'messageDetail'}
    <MessageDetail
      onBack={() => { currentView = 'main'; selectedMessage = null; }}
      selectedMessage={selectedMessage}
    />

  {:else if currentView === 'about'}
    {loadAboutView()}
    {#if AboutViewComponent}
      {@const About = AboutViewComponent}
      <About {context} {version} />
    {:else}
      <div class="flex items-center justify-center h-full">
        <div class="text-sm text-md-on-surface/50">Loading...</div>
      </div>
    {/if}

  {:else if currentView === 'identities'}
    <IdentitiesView {context} savedLogins={savedLogins} />

  {:else if accounts.length === 0 && !loadingInboxes && allInboxes.length === 0}
    <Onboarding onCreateInbox={async (provider) => { await createInbox(provider); await loadSettings(); }} />

  {:else}
    <InboxView {context}
      selectedEmail={selectedEmail}
      bind:displayedEmail
      dropdownOpen={accountSelectorDropdownOpen}
      guerrillaDefaultDomain={guerrillaDefaultDomain}
      accounts={accounts}
      allAccounts={allInboxes}
      loading={loading}
      searchQuery={searchQuery}
      sortBy={sortBy}
      otpOnly={otpOnly}
      senderDomain={senderDomain}
      senderEmail={senderEmail}
      selectedSenders={selectedSenders}
      dateFrom={dateFrom}
      dateTo={dateTo}
      notificationsEnabled={notificationsEnabled}
      filteredEmails={filteredEmails}
      emails={emails}
      latestOtp={latestOtp}
      latestOtpSender={latestOtpSender}
      latestOtpSenderName={latestOtpSenderName}
      otpContext={otpContext}
      formDetected={formDetected}
      savedSearchFilters={savedSearchFilters}
      openSection={archivedSectionOpen}
      onDropdownOpenChange={(open) => accountSelectorDropdownOpen = open}
      onSelectAccount={selectAccount}
      onCopyEmail={() => { navigator.clipboard.writeText(displayedEmail || selectedEmail); showToast('Email copied to clipboard'); }}
      onOpenQrDialog={openQrDialog}
      onCreateInbox={openCreateInboxDialog}
      onCreateInboxWithProvider={handleCreateInboxWithProvider}
      selectedProviderInstance={selectedProviderInstance}
      emailPreviewEnabled={emailPreviewEnabled}
      showToast={(message) => showToast(message)}
      onRefreshInbox={refreshInbox}
      onToggleNotifications={toggleNotifications}
      onArchiveAccount={archiveAccount}
      onUnarchiveAccount={unarchiveAccount}
      onRemoveAccount={removeAccount}
      onRestoreAccount={restoreAccount}
      onReloadAccounts={loadInboxes}
      onToggleAutoExtend={toggleAutoExtend}
      onOpenMessageDetail={openMessageDetail}
      onSearchChange={(v) => {
        const currentCriteria = {
          searchQuery,
          otpOnly,
          senderDomain,
          senderEmail: '',
          subject: '',
          selectedSenders,
          dateFrom,
          dateTo,
          sortBy,
        };
        const updated = applySearchShortcuts(v, currentCriteria);
        searchQuery = updated.searchQuery;
        otpOnly = updated.otpOnly;
        senderDomain = updated.senderDomain;
        senderEmail = updated.senderEmail;
        subject = updated.subject;
      }}
      onSortChange={(v) => sortBy = v}
      onOtpOnlyChange={(v) => otpOnly = v}
      onSenderDomainChange={(v) => senderDomain = v}
      onSelectedSendersChange={(v) => selectedSenders = v}
      onDateFromChange={(v) => dateFrom = v}
      onDateToChange={(v) => dateTo = v}
      onClearFilters={clearFilters}
      onSaveFilter={(name, sq, otp, sd, df, dt, senders, sort) =>
        saveFilter({
          name,
          searchQuery: sq,
          hasOTP: otp,
          senderDomain: sd,
          dateFrom: df,
          dateTo: dt,
          selectedSenders: senders,
          sortBy: sort,
        })}
      onLoadFilter={loadFilter}
      onRenameFilter={renameFilter}
      onDeleteFilter={deleteFilter}
      onNavigateToSettings={() => { currentView = 'settings'; }}
      onNavigateToManage={() => { currentView = 'mailSettings'; }}
      autoRenew={autoRenew}
      onToggleAutoRenew={async () => { autoRenew = !autoRenew; await saveAutoRenew(); }}
      onCopyOtp={copyOtp}
      onCopyOtpFromMessage={(otp) => { if (otp) { navigator.clipboard.writeText(otp); showToast('OTP copied to clipboard'); const otpEmail = emails.find((e) => e.otp === otp && e.unread); if (otpEmail) { emails = emails.map((e) => e.id === otpEmail.id ? { ...e, unread: false } : e); if (selectedEmail && unreadByAddress[selectedEmail] > 0) { unreadByAddress = { ...unreadByAddress, [selectedEmail]: unreadByAddress[selectedEmail] - 1 }; } browser.storage.local.get(['readEmails']).then((r) => { const re = (r.readEmails as Record<string, boolean>) || {}; re[otpEmail.id] = true; browser.storage.local.set({ readEmails: re }); }); } } }}
    />
  {/if}

        </div>
        <!-- Toast Container positioned just above footer -->
        <ToastContainer />
        {#if isOffline && !offlineDismissed}
          <OfflineBanner onDismiss={() => { offlineDismissed = true; }} />
        {/if}
        <!-- Floating Island Nav: absolutely stuck to bottom of content area -->
        {#if accounts.length > 0 || allInboxes.length > 0 || loadingInboxes}
        <div class="absolute bottom-0 left-0 right-0 z-20 pointer-events-none">
          <div class="pointer-events-auto">
            <Footer currentView={currentView} onNavigate={(view) => currentView = view} {accounts} {unreadByAddress} />
          </div>
        </div>
        {/if}
    </div>
  </div>
  </div>

  <QrDialog
    open={qrDialogOpen}
    selectedEmail={displayedEmail || selectedEmail}
    bind:qrDialogElement
    bind:qrCanvas
    onClose={closeQrDialog}
    onDownload={downloadQrCode}
    onCopyImage={copyQrImage}
  />

  <CreateInboxDialog
    open={createInboxDialogOpen}
    onClose={() => createInboxDialogOpen = false}
    onCreate={handleCreateInbox}
  />

  <ConfirmDialog
    {confirmDialog}
    bind:confirmDialogRef
    onClose={closeConfirm}
  />
</ErrorBoundary>
