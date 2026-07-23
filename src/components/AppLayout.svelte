<script lang="ts">
import { onDestroy, onMount, tick, untrack } from 'svelte';
import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';

// Bootstrap svelte-i18n (register locales + preferred language)
import '@/utils/i18n.js';

// --- Context prop: 'popup' | 'sidepanel' | 'app' ---
let { context = 'popup' }: { context?: 'popup' | 'sidepanel' | 'app' } = $props();

import OfflineBanner from '@/components/feedback/OfflineBanner.svelte';
import type { ToastType } from '@/components/feedback/Toast.svelte';
import ToastContainer from '@/components/feedback/ToastContainer.svelte';
import Icon from '@/components/icons/Icon.svelte';
import ErrorBoundary from '@/components/layout/ErrorBoundary.svelte';
import Footer from '@/components/layout/Footer.svelte';
import Header from '@/components/layout/Header.svelte';
import SidebarNav from '@/components/layout/SidebarNav.svelte';
import CommandPalette, { type PaletteCommand } from '@/components/overlays/CommandPalette.svelte';
import ConfirmDialog from '@/components/overlays/ConfirmDialog.svelte';
import CreateInboxDialog from '@/components/overlays/CreateInboxDialog.svelte';
import ExportBackupDialog from '@/components/overlays/ExportBackupDialog.svelte';
import ExportWizardDialog from '@/components/overlays/ExportWizardDialog.svelte';
import ImportBackupDialog from '@/components/overlays/ImportBackupDialog.svelte';
import KeyboardShortcutsCheatSheet from '@/components/overlays/KeyboardShortcutsCheatSheet.svelte';
import ProductTour from '@/components/overlays/ProductTour.svelte';
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
import type { useAnalyticsActions } from '@/features/analytics/use-analytics-actions.js';
import {
  type ArchivedSetters,
  deleteArchivedEmail as deleteArchivedEmailAction,
  loadArchivedEmails as loadArchivedEmailsAction,
  restoreArchivedInbox as restoreArchivedInboxAction,
} from '@/features/archived-mail/archived-actions.js';
import {
  applyEmailLocalAction,
  autofillForm as autofillFormAction,
  copyOtp as copyOtpAction,
  createInbox as createInboxAction,
  type InboxSetters,
  migrateEmailBags,
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
  extendAccount as extendAccountAction,
  type ManagementSetters,
  removeAccount as removeAccountAction,
  restoreAccount as restoreAccountAction,
  toggleAutoExtend as toggleAutoExtendAction,
  unarchiveAccount as unarchiveAccountAction,
} from '@/features/inbox/inbox-management.js';
import { applyFilters, applySearchShortcuts } from '@/features/inbox/use-email-filters.js';
import { useInboxActions } from '@/features/inbox/use-inbox-actions.js';
import type {
  SaveFilterInput,
  useSavedSearchFilters,
} from '@/features/inbox/use-saved-search-filters.js';
import {
  handleKeydown as handleKeydownAction,
  type ShortcutsCallbacks,
} from '@/features/keyboard-shortcuts/shortcuts.js';
import {
  deleteLoginById as deleteLoginByIdAction,
  type LoginSetters,
  loadLoginInfo as loadLoginInfoAction,
  reorderLoginInfoById as reorderLoginInfoByIdAction,
} from '@/features/login-info/login-actions.js';
import { openMessageWindow } from '@/features/message-window/message-window-actions.js';
import { PRODUCT_TOUR_STEPS } from '@/features/product-tour/tour-steps.js';
import {
  clearPendingProductTour,
  isPendingProductTour,
  isProductTourCompleted,
  markProductTourCompleted,
} from '@/features/product-tour/tour-storage.js';
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
  handleColorChange as handleColorChangeAction,
  handleProviderChange as handleProviderChangeAction,
  hardReset as hardResetAction,
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
import { useCommonSetters } from '@/features/settings/use-common-setters.js';
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
} from '@/features/settings/use-extension-storage-sync.js';
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
import { copyToClipboardAndSchedulePurge } from '@/utils/clipboard.js';
import { decrypt, encrypt } from '@/utils/crypto.js';
import {
  computeUnreadCounts,
  extractLatestOtp,
  mapEmailsForDisplay,
} from '@/utils/email-mapper.js';
import {
  loadAllProviderConfigs,
  loadProviderConfig,
  loadProviderOverridesFromStorage,
  type ProviderConfig,
} from '@/utils/email-service.js';
import { groupEmailsByThread } from '@/utils/email-threads.js';
import { ApiError, ValidationError } from '@/utils/errors.js';
import { setupFocusTrap } from '@/utils/focusTrap.js';
import { preloadTranslations, setCachedLocale } from '@/utils/i18n-utils.js';
import { detectIconFromMessage } from '@/utils/iconMapping.js';
import { logDebug, logError } from '@/utils/logger.js';
import { pingProviderInstances } from '@/utils/ping-service.js';
import { type ConfirmDialogState, getToastTypeFromMessage } from '@/utils/shared-ui.js';
import { domainIndexKey, getInboxes, getReadEmailsMap } from '@/utils/storage-keys.js';
import { requestUnlimitedStorage } from '@/utils/storageMonitor.js';
import { formatDate, formatTimeLeft, getEmailStatus } from '@/utils/time.js';
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
import AboutView from '@/views/AboutView.svelte';
import ActivityView from '@/views/ActivityView.svelte';
import AddressesView from '@/views/AddressesView.svelte';
import AutofillView from '@/views/AutofillView.svelte';
import ConstantsSettingsView from '@/views/ConstantsSettingsView.svelte';
import DiagnosticsView from '@/views/DiagnosticsView.svelte';
import ExtensionSettingsView from '@/views/ExtensionSettingsView.svelte';
import FiltersManagementView from '@/views/FiltersManagementView.svelte';
import IdentitiesView from '@/views/IdentitiesView.svelte';
import KeyboardShortcutsView from '@/views/KeyboardShortcutsView.svelte';
import LabelManagementView from '@/views/LabelManagementView.svelte';
import MailboxView from '@/views/MailboxView.svelte';
import MailProviderView from '@/views/MailProviderView.svelte';
import OrganizeView from '@/views/OrganizeView.svelte';
import PlaygroundView from '@/views/PlaygroundView.svelte';
import SavedLoginsView from '@/views/SavedLoginsView.svelte';
import StoragePerformanceView from '@/views/StoragePerformanceView.svelte';
import TagManagementView from '@/views/TagManagementView.svelte';
import packageJson from '../../package.json';

const AboutViewComponent = AboutView;
const ExtensionSettingsViewComponent = ExtensionSettingsView;
const ActivityViewComponent = ActivityView;
const SavedLoginInfoViewComponent = SavedLoginsView;
const AutofillViewComponent = AutofillView;
const KeyboardShortcutsViewComponent = KeyboardShortcutsView;
const TagManagementViewComponent = TagManagementView;
const FiltersManagementViewComponent = FiltersManagementView;
const OrganizeViewComponent = OrganizeView;
const MailProviderViewComponent = MailProviderView;
const AddressesViewComponent = AddressesView;
const StoragePerformanceViewComponent = StoragePerformanceView;
const LabelManagementViewComponent = LabelManagementView;
const IdentitiesViewComponent = IdentitiesView;
const ConstantsSettingsViewComponent = ConstantsSettingsView;

// Cross-browser API (polyfill provides browser, chrome as fallback)
const ext = browser;
let version = $state<string>(packageJson.version);

// --- View state ---
let currentView = $state<View>('main');
/** Pre-applied filters when navigating from EmailDetail (mailbox detail) */
let loginInfoEmailFilter = $state('');
let identitiesEmailFilter = $state('');
/** Footer FAB → open create UI on target views (increment to trigger) */
let identityCreateSignal = $state(0);
let identityEditIdSignal = $state('');
let tagCreateSignal = $state(0);
let labelCreateSignal = $state(0);
/** Organize hub tab deep-link */
let organizeTabSignal = $state(0);
let organizeTabValue = $state<'tags' | 'labels' | 'filters'>('tags');
let autofillTabSignal = $state(0);
let autofillTabValue = $state<'profiles' | 'credentials'>('profiles');

/**
 * Header back ONLY on these deep sub-pages (not main, not settings hub,
 * not manage/identities/activity/logins/analytics - those use footer nav).
 */
const HEADER_BACK_VIEWS = new Set<View>([
  'messageDetail',
  'emailDetail',
  'tagManagement',
  'labelManagement',
  'mailProvider',
  'keybindings',
  'filtersManagement',
  'constantsSettings',
  'diagnostics',
  'storagePerformance',
  'mailboxManagement',
  // organize is a primary More destination — no back
]);

const showHeaderBack = $derived(HEADER_BACK_VIEWS.has(currentView));

function handleHeaderBack() {
  switch (currentView) {
    case 'messageDetail':
      currentView = 'main';
      selectedThread = [];
      break;
    case 'emailDetail':
      currentView = 'mailSettings';
      currentEmailDetail = null;
      break;
    case 'mailboxManagement':
      currentView = 'settings';
      break;
    case 'storagePerformance':
      currentView = 'settings';
      break;
    case 'tagManagement':
    case 'labelManagement':
    case 'filtersManagement':
      currentView = 'organize';
      break;
    case 'mailProvider':
    case 'keybindings':
    case 'constantsSettings':
    case 'diagnostics':
      currentView = 'settings';
      break;
    default:
      currentView = 'main';
      break;
  }
}

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
let recipient = $state<string>('');
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
let threadGroupingSetting = $state<boolean>(false);
let showQuotaBanner = $state<boolean>(false);

async function handleRequestQuotaUnlimitedStorage() {
  try {
    const granted = await requestUnlimitedStorage();
    if (granted) {
      toastStore.success($t('settings.unlimitedStorageGranted'));
      showQuotaBanner = false;
      await ext.storage.local.remove('storageQuotaWarning');
    } else {
      toastStore.error($t('settings.unlimitedStorageDenied'));
    }
  } catch {}
}

async function dismissQuotaBanner() {
  showQuotaBanner = false;
  await ext.storage.local.remove('storageQuotaWarning');
}
let unreadByAddress = $state<Record<string, number>>({});
let allStoredEmails = $state<Record<string, Email[]>>({});
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
let defaultDomain = $state<string>('');
let autofillBlocklist = $state<string[]>([]);
let isOffline = $state(!navigator.onLine);
let offlineDismissed = $state(false);

$effect(() => {
  function updateOnlineStatus() {
    isOffline = typeof navigator !== 'undefined' ? !navigator.onLine : false;
    offlineDismissed = false;
  }
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  return () => {
    window.removeEventListener('online', updateOnlineStatus);
    window.removeEventListener('offline', updateOnlineStatus);
  };
});
let savedSearchFilters = $state<SavedSearchFilter[]>([]);
let formDetected = $state<boolean>(false);
let menuOpen = $state<boolean>(false);
let sortBy = $state<string>('newest');

// --- Retention cleanup prompt ---
let retentionCleanupDismissed = $state(false);
let oldEmailCount = $state(0);

async function checkRetentionCleanup() {
  const { emailRetentionDays = 30, storedEmails = {} } = (await browser.storage.local.get([
    'emailRetentionDays',
    'storedEmails',
  ])) as {
    emailRetentionDays?: number;
    storedEmails?: Record<string, Email[]>;
  };
  if (emailRetentionDays <= 0) return;
  const threshold = Date.now() - emailRetentionDays * 24 * 60 * 60 * 1000;
  let count = 0;
  for (const msgs of Object.values(storedEmails)) {
    for (const m of msgs) {
      const ts = m.stored_at || (m.received_at > 1e12 ? m.received_at : m.received_at * 1000);
      if (ts < threshold) count++;
    }
  }
  oldEmailCount = count;
}

async function dismissRetentionCleanup() {
  retentionCleanupDismissed = true;
}

async function cleanupOldEmailsNow() {
  try {
    const { emailRetentionDays = 30 } = (await browser.storage.local.get([
      'emailRetentionDays',
    ])) as { emailRetentionDays?: number };
    await browser.runtime.sendMessage({
      type: 'cleanupOldStoredEmails',
      activeRetentionDays: emailRetentionDays,
      archivedRetentionDays: emailRetentionDays * 3,
    });
    retentionCleanupDismissed = true;
    oldEmailCount = 0;
    await stableLoadInboxes(true);
    showToast($t('inbox.retentionCleanupDone'));
  } catch (error) {
    logError('Failed to clean up old emails', error);
    showToast($t('inbox.retentionCleanupFailed'), 'error');
  }
}

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

// Load identities once on mount (not a reactive $effect — avoids re-entry loops)
onMount(() => {
  void loadIdentities();
});

// Load login info when opening Autofill hub / credentials
$effect(() => {
  if (currentView === 'loginInfo' || currentView === 'autofill' || currentView === 'identities') {
    loadLoginInfo();
  }
});

// Track page visits for Activity stats (plain let — never $state read+write in one effect)
let lastTrackedView: string | null = null;
async function trackVisit(key: string) {
  try {
    const { analytics: a = {} } = (await browser.storage.local.get(['analytics'])) as {
      analytics?: Record<string, unknown>;
    };
    const pageVisits = {
      ...((a.pageVisits as Record<string, number>) || {}),
    };
    pageVisits[key] = (pageVisits[key] || 0) + 1;
    await browser.storage.local.set({
      analytics: { ...a, pageVisits },
    });
  } catch {
    /* ignore */
  }
}
$effect(() => {
  const view = currentView;
  if (!view || view === lastTrackedView) return;
  lastTrackedView = view;
  void trackVisit(view);
});
// Dialog visit counters (create inbox, tag, confirm, etc.)
let lastDialogKeys = '';
$effect(() => {
  const keys: string[] = [];
  if (createInboxDialogOpen) keys.push('dialog:createInbox');
  if (emailDetailTagDialogOpen) keys.push('dialog:tag');
  if (confirmDialog) keys.push('dialog:confirm');
  if (qrDialogOpen) keys.push('dialog:qr');
  if (commandPaletteOpen) keys.push('dialog:commandPalette');
  if (exportWizardOpen) keys.push('dialog:export');
  const sig = keys.join('|');
  if (!sig || sig === lastDialogKeys) return;
  // Only count newly opened dialogs
  const prev = new Set(lastDialogKeys.split('|').filter(Boolean));
  lastDialogKeys = sig;
  for (const k of keys) {
    if (!prev.has(k)) void trackVisit(k);
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
  undoAction: (() => void) | null = null,
  actionLabel: string | null = null
) {
  const messageText = typeof message === 'string' ? message : message.message;
  if (!messageText?.trim()) return;

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

  // Prefer explicit type when caller passed something other than the default success,
  // or when message object carries type/icon. Fall back to keyword detection for string-only calls.
  if (typeof message === 'string') {
    const detectedType = getToastTypeFromMessage(message);
    // Always honor explicit non-success types; for success use detection if more specific
    const resolved: ToastType = type === 'success' || type === 'info' ? detectedType || type : type;
    toastStore.add(
      resolved || type || 'success',
      message,
      undoAction ? 10000 : 2500,
      undoAction,
      actionLabel
    );
  } else {
    const finalType = message.icon || message.type || type;
    const detectedType = getToastTypeFromMessage(message.message);
    toastStore.add(
      finalType === 'success' ? detectedType || finalType : finalType,
      message.message,
      undoAction ? 10000 : 2500,
      undoAction,
      actionLabel
    );
  }
}

// --- Confirmation dialog (ConfirmDialogState imported from @/utils/shared-ui.js) ---
let confirmDialog = $state<ConfirmDialogState | null>(null);
let confirmDialogRef = $state<HTMLElement | null>(null);
let confirmPreviousFocus = $state<HTMLElement | null>(null);
let focusTrapCleanup: (() => void) | null = null;
let confirmFocusTimeout: ReturnType<typeof setTimeout> | null = null;
function showConfirm(
  message: string,
  onConfirm: () => void,
  options: Omit<ConfirmDialogState, 'message' | 'onConfirm'> | undefined = undefined
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
/** Labels for mailbox search (synced from storage) */
let emailTagsById = $state<Record<string, string[]>>({});
$effect(() => {
  void (async () => {
    try {
      const { emailTags = {} } = (await browser.storage.local.get(['emailTags'])) as {
        emailTags?: Record<string, string[]>;
      };
      emailTagsById = emailTags || {};
    } catch {
      emailTagsById = {};
    }
  })();
  const onCh = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && changes.emailTags) {
      emailTagsById = (changes.emailTags.newValue as Record<string, string[]>) || {};
    }
  };
  browser.storage.onChanged.addListener(onCh);
  return () => browser.storage.onChanged.removeListener(onCh);
});

let filteredEmails = $derived.by(() =>
  applyFilters(emails, {
    searchQuery,
    otpOnly,
    senderDomain,
    senderEmail,
    recipient,
    subject,
    selectedSenders,
    dateFrom,
    dateTo,
    sortBy,
    emailTagsById,
  })
);

let activeNavigationList = $derived.by(() => {
  if (threadGroupingSetting) {
    return groupEmailsByThread(filteredEmails);
  }
  return filteredEmails.map((e) => ({ id: e.id, emails: [e] }));
});

let currentNavigationIndex = $derived.by(() => {
  if (selectedThread.length === 0) return -1;
  const currentId = selectedThread[0].id;
  return activeNavigationList.findIndex((item) => item.emails.some((e) => e.id === currentId));
});

let hasPrevMessage = $derived(currentNavigationIndex > 0);
let hasNextMessage = $derived(
  currentNavigationIndex !== -1 && currentNavigationIndex < activeNavigationList.length - 1
);

function navigateToPrevMessage() {
  if (hasPrevMessage) {
    openMessageDetail(activeNavigationList[currentNavigationIndex - 1].emails);
  }
}

function navigateToNextMessage() {
  if (hasNextMessage) {
    openMessageDetail(activeNavigationList[currentNavigationIndex + 1].emails);
  }
}

// --- Stable wrapper that always delegates to the current loadInboxesFn ---
let loadInboxesFn: (skipEmailSelection: boolean | undefined) => Promise<void> = async () => {};
const stableLoadInboxes = (skipEmailSelection: boolean | undefined = undefined) =>
  loadInboxesFn(skipEmailSelection);

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
    setDefaultDomain: (v: string) => (defaultDomain = v),
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
    setSavedLogins: (v) => {
      savedLogins =
        typeof v === 'function'
          ? (v as (prev: CredentialsHistoryItem[]) => CredentialsHistoryItem[])(savedLogins)
          : v;
    },
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

let _analyticsActions: ReturnType<typeof useAnalyticsActions> | null = null;
async function getAnalyticsActions() {
  if (!_analyticsActions) {
    const { useAnalyticsActions } = await import('@/features/analytics/use-analytics-actions.js');
    _analyticsActions = useAnalyticsActions(
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
  }
  return _analyticsActions;
}

// --- Mail Settings view ---
let mgmtTab = $state<string>('active');
let mgmtSearch = $state<string>('');
let selectedAddresses = $state<Set<string>>(new Set());
let currentEmailDetail = $state<Account | null>(null);

// --- EmailDetail tag dialog (AppLayout-level, works from any view) ---
let emailDetailTagDialogOpen = $state(false);
let emailDetailTagTarget = $state<Account | null>(null);

let allExistingTags = $derived.by(() => {
  const s = new Set<string>();
  for (const a of allInboxes) {
    if (Array.isArray(a.tags) && a.tags.length) {
      for (const t of a.tags) if (t?.name) s.add(t.name);
    } else if (a.tag) s.add(a.tag);
  }
  return Array.from(s);
});
let allTagColors = $derived.by(() => {
  const c: Record<string, string> = {};
  for (const a of allInboxes) {
    if (Array.isArray(a.tags) && a.tags.length) {
      for (const t of a.tags) if (t?.name && t.color) c[t.name] = t.color;
    } else if (a.tag && a.tagColor) c[a.tag] = a.tagColor;
  }
  return c;
});

/** Single account or multi-select batch from Addresses strip / ⋮ menu */
let emailDetailTagTargets = $state<Account[]>([]);

function openEmailDetailTagDialog(account: Account) {
  // Multi-select: if this account is among a selection of 2+, tag the whole selection
  if (selectedAddresses.size > 1 && selectedAddresses.has(account.id)) {
    emailDetailTagTargets = allInboxes.filter((a) => selectedAddresses.has(a.id));
  } else {
    emailDetailTagTargets = [account];
  }
  emailDetailTagTarget = emailDetailTagTargets[0] ?? account;
  emailDetailTagDialogOpen = true;
}

function openEmailDetailTagDialogForSelected() {
  const selected = allInboxes.filter((a) => selectedAddresses.has(a.id));
  if (selected.length === 0) return;
  emailDetailTagTargets = selected;
  emailDetailTagTarget = selected[0] ?? null;
  emailDetailTagDialogOpen = true;
}

function closeEmailDetailTagDialog() {
  emailDetailTagDialogOpen = false;
  emailDetailTagTarget = null;
  emailDetailTagTargets = [];
}
async function saveEmailDetailTag(tag: string, color: string) {
  const targets =
    emailDetailTagTargets.length > 0
      ? emailDetailTagTargets
      : emailDetailTagTarget
        ? [emailDetailTagTarget]
        : [];
  if (targets.length === 0) return;
  try {
    await Promise.all(
      targets.map((acc) =>
        ext.runtime.sendMessage({
          type: 'updateInboxTag',
          inboxId: acc.id,
          tag,
          color,
        })
      )
    );
    await loadInboxes(true);
    // Keep currentEmailDetail in sync when it was among targets
    if (currentEmailDetail && targets.some((t) => t.id === currentEmailDetail?.id)) {
      currentEmailDetail = {
        ...currentEmailDetail,
        tag: tag || undefined,
        tagColor: color || undefined,
      };
    }
  } catch {
    /* ignore */
  }
  closeEmailDetailTagDialog();
}

let mgmtAccounts = $derived(
  (Array.isArray(allInboxes) ? allInboxes : []).filter((a) => {
    if (!a || typeof a !== 'object') return false;
    const isInactive =
      a.status !== 'active' || a.accountStatus === 'archived' || a.accountStatus === 'deleted';
    const matchesTab = mgmtTab === 'active' ? !isInactive : isInactive;
    const addr = (a.address || '').toLowerCase();
    const prov = (a.provider || '').toLowerCase();
    const tag = (a.tag || '').toLowerCase();
    const q = (mgmtSearch || '').toLowerCase();
    const matchesSearch = q === '' || addr.includes(q) || prov.includes(q) || tag.includes(q);
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
      // Clear inbox list filters that would hide every message on the new mailbox
      searchQuery = '';
      otpOnly = false;
      senderDomain = '';
      senderEmail = '';
      recipient = '';
      subject = '';
      selectedSenders = [];
      dateFrom = '';
      dateTo = '';
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
async function persistEmailRead(email: Email) {
  try {
    const readEmails = await getReadEmailsMap();
    const inboxAddr = email.original_inbox || selectedEmail;
    const key = inboxAddr ? `${inboxAddr}_${email.id}` : email.id;
    const wasUnread = !readEmails[key] && !readEmails[email.id];
    readEmails[key] = true;
    await browser.storage.local.set({ readEmails });
    if (wasUnread) {
      try {
        const { analytics: a = {} } = (await browser.storage.local.get(['analytics'])) as {
          analytics?: Record<string, unknown>;
        };
        await browser.storage.local.set({
          analytics: {
            ...a,
            emailsRead: ((a.emailsRead as number) || 0) + 1,
          },
        });
      } catch {
        /* ignore */
      }
    }
  } catch (error) {
    logError('Failed to persist email read state', error);
  }
}

async function persistEmailUnread(email: Email) {
  try {
    const readEmails = await getReadEmailsMap();
    const inboxAddr = email.original_inbox || selectedEmail;
    const key = inboxAddr ? `${inboxAddr}_${email.id}` : email.id;
    delete readEmails[key];
    await browser.storage.local.set({ readEmails });
  } catch (error) {
    logError('Failed to persist email unread state', error);
  }
}

async function markOtpEmailRead(otp: string = latestOtp) {
  const otpEmail = emails.find((e) => e.otp === otp && e.unread);
  if (otpEmail) {
    emails = emails.map((e) => (e.id === otpEmail.id ? { ...e, unread: false } : e));
    if (selectedEmail && unreadByAddress[selectedEmail] > 0) {
      unreadByAddress = {
        ...unreadByAddress,
        [selectedEmail]: unreadByAddress[selectedEmail] - 1,
      };
    }
    await persistEmailRead(otpEmail);
  }
}
const copyOtp = () => {
  inboxActions.copyOtp();
  void markOtpEmailRead();
};
const toggleNotifications = inboxActions.toggleNotifications;

async function updateUnreadByAddress() {
  try {
    const { storedEmails = {}, readEmails = {} } = (await ext.storage.local.get([
      'storedEmails',
      'readEmails',
    ])) as { storedEmails?: Record<string, Email[]>; readEmails?: Record<string, boolean> };
    allStoredEmails = storedEmails as Record<string, Email[]>;
    const counts: Record<string, number> = {};
    for (const [addr, msgs] of Object.entries(storedEmails)) {
      counts[addr] = (msgs as Email[]).filter((m) => {
        const key = `${m.original_inbox || addr}_${m.id}`;
        return !readEmails[key] && !readEmails[m.id];
      }).length;
    }
    unreadByAddress = counts;
  } catch (error) {
    logError('Failed to update unread inbox counts', error);
  }
}

// --- Assign actual function to placeholder for setters ---
loadInboxesFn = (skipEmailSelection: boolean | undefined = undefined) => {
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

/** Delete specific accounts by id (drag Live→Inactive) without selection Set race */
async function deleteAccountsDirect(toDelete: Account[]) {
  if (!toDelete.length) return;
  // Single account: rich confirm (logins + identities); multi uses bulk path
  if (toDelete.length === 1 && toDelete[0]) {
    await removeAccount(toDelete[0].address);
    return;
  }
  const addrs = new Set(toDelete.map((a) => (a.address || '').toLowerCase()));
  const loginHits = (savedLogins || []).filter((l) => addrs.has((l.email || '').toLowerCase()));
  const idHits = (identities || []).filter((id) => {
    const e = (id.preferredEmail || (id as { email?: string }).email || '').toLowerCase();
    return e && addrs.has(e);
  });
  const noteParts: string[] = [];
  if (loginHits.length)
    noteParts.push($t('account.deleteLinkedLogins', { values: { n: loginHits.length } }) as string);
  if (idHits.length)
    noteParts.push(
      $t('account.deleteLinkedIdentities', {
        values: { n: idHits.length, names: idHits.map((i) => i.name).join(', ') },
      }) as string
    );
  showConfirm(
    $t('account.deleteMultiBody', { values: { n: toDelete.length } }) as string,
    async () => {
      closeConfirm();
      const ids = new Set(toDelete.map((a) => a.id));
      selectedAddresses = ids;
      await deleteSelectedAction(
        ext,
        { selectedAddresses: ids, accounts, allInboxes },
        bulkActionsSetters
      );
    },
    {
      title: $t('account.deleteConfirmTitle') as string,
      confirmLabel: $t('account.deletePermanently') as string,
      note: noteParts.length ? noteParts.join(' · ') : ($t('account.deleteConfirmNote') as string),
    }
  );
}

async function toggleAutoExtend(account: Account) {
  await toggleAutoExtendAction(ext, account, managementSetters);
}

/** Reorder full storage list by account id (safe with Live/Inactive/search filters). */
async function reorderAccountsById(sourceId: string, targetId: string) {
  if (!sourceId || !targetId || sourceId === targetId) return;
  try {
    const inboxes = await getInboxes();
    const fromIndex = inboxes.findIndex((a) => a.id === sourceId);
    const toIndex = inboxes.findIndex((a) => a.id === targetId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
    const [moved] = inboxes.splice(fromIndex, 1);
    inboxes.splice(toIndex, 0, moved);
    await browser.storage.local.set({ inboxes });
    await loadInboxes(true);
  } catch (error) {
    logError('Failed to reorder accounts', error);
  }
}

async function archiveSelectedEmails(emailsToArchive: Email[]) {
  if (emailsToArchive.length === 0) return;
  const { updated } = await applyEmailLocalAction(ext, emailsToArchive, 'archive');
  if (updated > 0) {
    showToast($t('toasts.emailsArchived', { values: { count: updated } }), 'archived', () => {
      void applyEmailLocalAction(ext, emailsToArchive, 'restore');
    });
  }
}

async function deleteSelectedEmails(emailsToDelete: Email[]) {
  if (emailsToDelete.length === 0) return;
  const { updated } = await applyEmailLocalAction(ext, emailsToDelete, 'delete');
  if (updated > 0) {
    showToast($t('toasts.emailsDeleted', { values: { count: updated } }), 'deleted', () => {
      void applyEmailLocalAction(ext, emailsToDelete, 'restore');
    });
  }
}

async function restoreSelectedEmails(emailsToRestore: Email[]) {
  if (emailsToRestore.length === 0) return;
  const { updated } = await applyEmailLocalAction(ext, emailsToRestore, 'restore');
  if (updated > 0)
    showToast($t('toasts.emailsRestored', { values: { count: updated } }), 'success');
}

async function openEmailDetail(account: Account) {
  currentEmailDetail = account;
  // Keep active selection aligned with the mailbox being inspected
  // so "View emails in mailbox" and recent previews use the right data.
  if (account.address && account.address !== selectedEmail) {
    await selectAccount(account.address);
  }
  // Split view (≥1280): keep address list open + detail panel
  currentView = layoutSplit ? 'mailSettings' : 'emailDetail';
  loading = true;
  await checkMessages(account.id);
  loading = false;
}

async function autofillForm() {
  await autofillFormAction(ext, selectedEmail, (message, type) => showToast(message, type));
}

/** After refresh: if current provider is down but another is up → toast + strip hint */
let providerFailoverHint = $state<{
  show: boolean;
  otherProvidersOk: boolean;
  nextRetryAt: number;
  failCount: number;
} | null>(null);

async function evaluateProviderFailoverAfterRefresh(inboxId: string) {
  try {
    const inbox =
      allInboxes.find((a) => a.id === inboxId) || accounts.find((a) => a.id === inboxId);
    if (!inbox?.provider) return;
    const configs = loadAllProviderConfigs();
    const currentCfg = configs[inbox.provider];
    if (!currentCfg) return;

    // Ping current provider (all instances)
    const currentInstances =
      currentCfg.multiInstance?.enabled && Array.isArray(currentCfg.multiInstance.instances)
        ? currentCfg.multiInstance.instances.map((i) => ({
            id: i.id,
            name: i.name || i.id,
            displayName: i.displayName || i.name || i.id,
            apiUrl: i.apiUrl || currentCfg.apiUrl,
          }))
        : [];
    const currentPings = await pingProviderInstances(currentCfg, currentInstances);
    let currentOk = [...currentPings.values()].some(
      (p) => p !== 'timeout' && typeof p === 'number'
    );

    // Reliability graph: also treat low historical health as unavailable
    try {
      const { getProviderHealth, providerHealthScore } = await import(
        '@/features/intelligence/provider-health.js'
      );
      const health = await getProviderHealth(inbox.provider);
      const score = providerHealthScore(health);
      if (health.fetchAttempts + health.createAttempts >= 3 && score < 30) {
        currentOk = false;
      } else if (score >= 55 && currentOk) {
        providerFailoverHint = null;
        return;
      }
    } catch {
      /* optional */
    }

    if (currentOk) {
      providerFailoverHint = null;
      return;
    }

    // Probe other providers (ping + health rank)
    let otherOk = false;
    try {
      const { rankProvidersByHealth } = await import('@/features/intelligence/provider-health.js');
      const ids = Object.keys(configs).filter((id) => id !== inbox.provider && id !== 'demo');
      const ranked = await rankProvidersByHealth(ids);
      if (
        ranked.some((r) => r.score >= 40 && r.health.fetchSuccesses + r.health.createSuccesses > 0)
      ) {
        otherOk = true;
      }
    } catch {
      /* fall through to ping */
    }
    for (const [pid, cfg] of Object.entries(configs)) {
      if (otherOk) break;
      if (pid === inbox.provider || pid === 'demo') continue;
      const inst =
        cfg.multiInstance?.enabled && Array.isArray(cfg.multiInstance.instances)
          ? cfg.multiInstance.instances.map((i) => ({
              id: i.id,
              name: i.name || i.id,
              displayName: i.displayName || i.name || i.id,
              apiUrl: i.apiUrl || cfg.apiUrl,
            }))
          : [];
      const pings = await pingProviderInstances(cfg, inst);
      if ([...pings.values()].some((p) => p !== 'timeout' && typeof p === 'number')) {
        otherOk = true;
        break;
      }
    }

    const failCount = (providerFailoverHint?.failCount || 0) + 1;
    const nextRetryAt = Date.now() + 5 * 60 * 1000;
    providerFailoverHint = {
      show: true,
      otherProvidersOk: otherOk,
      nextRetryAt,
      failCount,
    };

    if (otherOk) {
      const msg = get(t)('toasts.providerUnavailable');
      const actionLabel = get(t)('toasts.createWithOtherProvider');
      toastStore.add(
        'warning',
        msg,
        8000,
        () => {
          openCreateInboxDialog();
        },
        actionLabel
      );
    }
  } catch (e) {
    logDebug(`Provider failover eval failed: ${String(e)}`);
  }
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
let inboxColorThemeEnabled = $state(false);
let showDeveloperSettings = $state(false);
let enableLogging = $state(false);
let emailRetentionDays = $state(30);
let faviconCaching = $state<'direct' | 'local'>('local');

let inboxColors = $state<Record<string, string>>({});

function hslToHex(h: number, s: number, l: number): string {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function hexToHue(hex: string): number | null {
  if (!hex || hex.length < 7) return null;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h = 0;
  switch (max) {
    case r:
      h = (g - b) / d + (g < b ? 6 : 0);
      break;
    case g:
      h = (b - r) / d + 2;
      break;
    case b:
      h = (r - g) / d + 4;
      break;
  }
  return Math.round(h * 60);
}

/**
 * Per-inbox accent is keyed by stable inbox **id** (not address) so domain
 * changes never reassign or regenerate the color.
 */
function getInboxColor(address: string, inboxId?: string): string {
  if (!address && !inboxId) return customColor || '#4c662b';
  const idKey = inboxId || '';
  // Prefer id key; fall back to legacy address key once, then migrate to id
  if (idKey && inboxColors[idKey]) {
    return inboxColors[idKey];
  }
  if (address && inboxColors[address]) {
    const legacy = inboxColors[address];
    if (idKey) {
      const next = { ...inboxColors, [idKey]: legacy };
      delete next[address];
      inboxColors = next;
      void browser.storage.local.set({ inboxColors: next });
    }
    return legacy;
  }

  // Generate a random hue that doesn't conflict with existing active colors
  const activeHues = Object.values(inboxColors)
    .map(hexToHue)
    .filter((h) => h !== null) as number[];

  let chosenHue = Math.floor(Math.random() * 360);
  let attempts = 0;

  while (attempts < 100) {
    const isTooClose = activeHues.some((h) => {
      const diff = Math.abs(h - chosenHue) % 360;
      const shortest = diff > 180 ? 360 - diff : diff;
      return shortest < 30; // at least 30 degrees apart
    });

    if (!isTooClose) {
      break;
    }
    chosenHue = Math.floor(Math.random() * 360);
    attempts++;
  }

  const generatedColor = hslToHex(chosenHue, 60, 45);
  const key = idKey || address;
  inboxColors = { ...inboxColors, [key]: generatedColor };
  void browser.storage.local.set({ inboxColors: { ...inboxColors } });
  return generatedColor;
}

/** When an address is rewritten (domain change), keep the same accent under the id. */
function migrateInboxColorOnAddressChange(
  inboxId: string | undefined,
  prevAddress: string,
  nextAddress: string
) {
  if (!prevAddress || prevAddress === nextAddress) return;
  const color = (inboxId && inboxColors[inboxId]) || inboxColors[prevAddress] || null;
  if (!color) return;
  const next = { ...inboxColors };
  if (inboxId) next[inboxId] = color;
  // Drop legacy address key so a new domain does not pick up a wrong color later
  delete next[prevAddress];
  // Do not write nextAddress as a key — id is the stable key
  inboxColors = next;
  void browser.storage.local.set({ inboxColors: next });
}

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
      defaultDomain,
    },
    settingsSetters
  );
  try {
    const res = (await browser.storage.local.get(['inboxColorThemeEnabled', 'inboxColors'])) as {
      inboxColorThemeEnabled?: boolean;
      inboxColors?: Record<string, string>;
    };
    if (res.inboxColorThemeEnabled !== undefined) {
      inboxColorThemeEnabled = res.inboxColorThemeEnabled;
    }
    if (res.inboxColors) {
      inboxColors = res.inboxColors;
    }
  } catch {}
}

async function removeFromAutofillBlocklist(domain: string) {
  const updated = autofillBlocklist.filter((d) => d !== domain);
  autofillBlocklist = updated;
  await browser.storage.local.set({ autofillBlocklist: updated });
  showToast($t('settings.domainRemovedFromBlocklist', { values: { domain } }), 'success');
}

async function addToAutofillBlocklistSetting(domain: string) {
  const cleaned = domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0];
  if (!cleaned) return;
  if (autofillBlocklist.includes(cleaned)) {
    showToast($t('settings.blocklistAlreadyAdded'), 'info');
    return;
  }
  const updated = [...autofillBlocklist, cleaned];
  autofillBlocklist = updated;
  await browser.storage.local.set({ autofillBlocklist: updated });
  showToast($t('settings.blocklistAdded', { values: { domain: cleaned } }), 'success');
}

async function setSelectedIdentity(id: string | null) {
  selectedIdentityId = id;
  try {
    await browser.storage.local.set({ selectedIdentityId: id });
  } catch (error) {
    logError('Failed to save selected identity', error);
  }
}

async function updateAutoRefreshInterval(intervalMs: number) {
  autoRefreshInterval = intervalMs;
  try {
    await browser.storage.local.set({ autoRefreshInterval: intervalMs });
    await browser.runtime.sendMessage({ type: 'updateRefreshInterval', intervalMs });
  } catch (error) {
    logError('Failed to update auto-refresh interval', error);
  }
}

async function copyOtpFromMessage(otp: string) {
  if (!otp) return;
  try {
    await copyToClipboardAndSchedulePurge(otp);
    showToast($t('inbox.otpCopied'));
    await markOtpEmailRead(otp);

    // Automation Rule: Auto-Archive on OTP copy
    try {
      const res = (await browser.storage.local.get(['automationRules'])) as {
        automationRules?: { autoArchiveOnCopyOtp?: boolean };
      };
      if (res.automationRules?.autoArchiveOnCopyOtp && selectedEmail) {
        const targetEmail = emails.find((e) => e.otp === otp || e.id === selectedEmail);
        if (targetEmail) {
          await archiveSelectedEmails([targetEmail]);
        }
      }
    } catch (_ruleErr) {}
  } catch (error) {
    logError('Failed to copy OTP from message', error);
    showToast($t('toasts.otpCopyFailed'), 'error');
  }
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
      defaultDomain,
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
      defaultDomain,
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
      defaultDomain,
    },
    settingsSetters
  );
}

async function handleProviderChange(provider: string) {
  await handleProviderChangeAction(ext, provider, settingsSetters);
}

async function saveAutoCopy() {
  await saveAutoCopyAction(ext, autoCopy);
  showToast($t('toasts.autoCopyToggled', { values: { state: autoCopy ? 'enabled' : 'disabled' } }));
}

async function saveAutoRenew() {
  await saveAutoRenewAction(ext, autoRenew);
  showToast(
    $t('toasts.autoRenewToggled', { values: { state: autoRenew ? 'enabled' : 'disabled' } })
  );
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

let showExportBackupDialog = $state(false);
let showImportBackupDialog = $state(false);
let productTourOpen = $state(false);

async function startProductTour() {
  // Never start tour without at least one mailbox (targets live on main inbox UI)
  if (!allInboxes.length && !accounts.length) {
    try {
      await clearPendingProductTour();
    } catch {
      /* ignore */
    }
    return;
  }
  currentView = 'main';
  productTourOpen = true;
}

async function exitDemoAfterTour() {
  if (!demoModeActive) return;
  try {
    const { exitDemoMode } = await import('@/features/demo/demo-mode.js');
    await exitDemoMode(browser);
    demoModeActive = false;
    await loadInboxes();
    showToast($t('productTour.demoEndedOnboarding'), 'info');
  } catch (e) {
    logError('exitDemoAfterTour failed', e);
  }
}

async function finishProductTour() {
  productTourOpen = false;
  try {
    await markProductTourCompleted();
    await clearPendingProductTour();
  } catch {
    /* ignore */
  }
  // Demo mode: after tour, leave demo and land on real onboarding (create address)
  if (demoModeActive) {
    await exitDemoAfterTour();
    currentView = 'main';
    return;
  }
  currentView = 'main';
  showToast($t('productTour.completedToast'), 'success');
}

async function skipProductTour() {
  productTourOpen = false;
  try {
    await markProductTourCompleted();
    await clearPendingProductTour();
  } catch {
    /* ignore */
  }
  if (demoModeActive) {
    await exitDemoAfterTour();
  }
  currentView = 'main';
}

function exportData() {
  showExportBackupDialog = true;
}

function importData() {
  showImportBackupDialog = true;
}

/** Demo mode banner (isolated from real data) */
let demoModeActive = $state(false);
$effect(() => {
  void browser.storage.local.get(['demoMode']).then((r) => {
    demoModeActive = !!(r as { demoMode?: boolean }).demoMode;
  });
  const onCh = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local') return;
    if (changes.demoMode) {
      demoModeActive = !!changes.demoMode.newValue;
      // Force UI bag reload when entering/exiting demo so real vs demo never mix on screen
      void loadInboxes(false);
    }
  };
  browser.storage.onChanged.addListener(onCh);
  return () => browser.storage.onChanged.removeListener(onCh);
});

// Close account selector when leaving mailbox (prevents sticky open popup on return)
$effect(() => {
  if (currentView === 'main') return;
  untrack(() => {
    if (accountSelectorDropdownOpen) accountSelectorDropdownOpen = false;
  });
});

// --- Analytics view ---
let analytics = $state<{
  createdAt: string | number | undefined;
  accountsCreated: number;
  emailsReceived: number;
  otpsDetected: number;
  notificationsSent: number;
  extensionOpens?: number;
  emailsRead?: number;
  pageVisits?: Record<string, number>;
}>({
  createdAt: undefined,
  accountsCreated: 0,
  emailsReceived: 0,
  otpsDetected: 0,
  notificationsSent: 0,
  extensionOpens: 0,
  emailsRead: 0,
  pageVisits: {},
});
let analyticsLoading = $state(false);

async function loadAnalytics() {
  const actions = await getAnalyticsActions();
  await actions.loadAnalytics();
}

async function handleResetAnalytics() {
  const actions = await getAnalyticsActions();
  await actions.resetAnalytics();
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
  await deleteArchivedEmailAction(ext, email, { archivedEmails }, archivedSetters);
}

// --- QR Code dialog ---
let qrDialogOpen = $state(false);
let qrCanvas = $state<HTMLCanvasElement | null>(null);
let qrDialogElement = $state<HTMLElement | null>(null);
let previousFocusElement = $state<HTMLElement | null>(null);
let qrOpenTimerId = $state<ReturnType<typeof setTimeout> | null>(null);

// --- Create Inbox dialog ---
let createInboxDialogOpen = $state(false);
let pendingCreateProvider = $state<string | undefined>(undefined);
let pendingCreateInstanceId = $state<string | undefined>(undefined);
let pendingCreateProviderConfig = $state<ProviderConfig | undefined>(undefined);
/** Highlight a newly created address on the Addresses page */
let highlightAddress = $state<string | null>(null);
let highlightAddressTimer: ReturnType<typeof setTimeout> | null = null;
/** Bump to focus Saved Logins search (ghost FAB) */
let savedLoginsFocusSignal = $state(0);

function setHighlightAddress(addr: string | null) {
  if (highlightAddressTimer) {
    clearTimeout(highlightAddressTimer);
    highlightAddressTimer = null;
  }
  highlightAddress = addr;
  if (addr) {
    highlightAddressTimer = setTimeout(() => {
      highlightAddress = null;
      highlightAddressTimer = null;
    }, 6000);
  }
}

function isOnAddressesPage(): boolean {
  return currentView === 'mailSettings' || currentView === 'mailboxManagement';
}

async function createInbox(
  provider: string | undefined = undefined,
  instanceId: string | undefined = undefined,
  emailUser: string | undefined = undefined,
  preferredDomain: string | undefined = undefined
): Promise<string | null> {
  // Demo isolation: never hit real providers while demoMode is on
  try {
    const { isDemoMode, createDemoInbox } = await import('@/features/demo/demo-mode.js');
    if (await isDemoMode(ext)) {
      const addr = await createDemoInbox(ext, emailUser);
      await loadInboxes(false);
      if (addr) {
        selectedEmail = addr;
        displayedEmail = addr;
        showToast($t('toasts.newInboxCreated'), 'success');
      }
      return addr;
    }
  } catch {
    /* fall through to real create */
  }
  const fromAddresses = isOnAddressesPage();
  inboxActions.setSkipEmailSelection(true);
  let createdAddr = await createInboxAction(ext, inboxSetters, provider, instanceId, emailUser, {
    skipToast: fromAddresses,
  });
  // After create: try to inject/rescan the active tab (site may already be open)
  try {
    await browser.runtime.sendMessage({ type: 'ensureActiveTabAutofill' });
  } catch {
    /* background may be waking */
  }

  // Apply preferred multi-domain only to the NEWLY created inbox.
  // Never fall back to activeInboxId / list.length-1 — those can point at an
  // existing mailbox when create failed or another provider is unavailable.
  if (preferredDomain && createdAddr) {
    try {
      const result = (await ext.storage.local.get(['inboxes'])) as {
        inboxes?: Account[];
      };
      const list = result.inboxes || [];
      // Match by exact created address only (never rewrite unrelated inboxes)
      const idx = list.findIndex((i) => i.address === createdAddr);
      if (idx >= 0 && list[idx]?.address) {
        const prevAddr = list[idx].address;
        const user = prevAddr.split('@')[0];
        const nextAddr = `${user}@${preferredDomain}`;
        // Skip if already on preferred domain or domain not valid for this provider
        let domains: string[] = [];
        try {
          domains = loadProviderConfig(list[idx].provider).multiDomain?.domains || [];
        } catch {
          domains = [];
        }
        if (domains.includes(preferredDomain) && prevAddr !== nextAddr) {
          list[idx] = { ...list[idx], address: nextAddr, emailUser: user };
          await ext.storage.local.set({ inboxes: list, activeInboxId: list[idx].id });
          await migrateEmailBags(ext, prevAddr, nextAddr);
          selectedEmail = nextAddr;
          createdAddr = nextAddr;
          const di = domains.indexOf(preferredDomain);
          if (di >= 0) {
            await ext.storage.local.set({
              [domainIndexKey(list[idx].provider, user)]: di,
            });
          }
          await loadInboxes(true);
          selectedEmail = nextAddr;
        }
      }
    } catch (e) {
      logDebug(`Could not apply preferred domain: ${String(e)}`);
    }
  }
  inboxActions.setSkipEmailSelection(false);

  if (fromAddresses && createdAddr) {
    setHighlightAddress(createdAddr);
    showToast(
      $t('toasts.newInboxCreated'),
      'success',
      () => {
        currentView = 'main';
      },
      $t('toasts.goToMailbox')
    );
  }
  return createdAddr;
}

function openCreateInboxDialog(
  provider: string | undefined = undefined,
  instanceId: string | undefined = undefined
) {
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
      const supportsCustom =
        config.capabilities?.supportsCustomEmail ?? config.customEmail?.supported;
      if (!supportsCustom) {
        createInbox(resolvedProvider, resolvedInstanceId);
        return;
      }
    } catch (error) {
      logDebug(`Could not load provider config for ${resolvedProvider}: ${String(error)}`);
      // Unknown provider, fall through to dialog
    }
  }
  // Store pending provider/instance so handleCreateInbox can use them
  pendingCreateProvider = resolvedProvider;
  pendingCreateInstanceId = resolvedInstanceId;
  pendingCreateProviderConfig = resolvedProvider ? loadProviderConfig(resolvedProvider) : undefined;
  createInboxDialogOpen = true;
}

async function handleCreateInboxWithProvider(
  provider: string | undefined = undefined,
  instanceId: string | undefined = undefined
) {
  // Use JSON config to decide if a custom username dialog is needed
  if (provider) {
    try {
      const config = loadProviderConfig(provider);
      const supportsCustom =
        config.capabilities?.supportsCustomEmail ?? config.customEmail?.supported;
      if (!supportsCustom) {
        await createInbox(provider, instanceId);
        return;
      }
    } catch (error) {
      logDebug(`Could not load provider config for ${provider}: ${String(error)}`);
      // Unknown provider, fall through to dialog
    }
  }
  // For providers with customEmail.supported, show dialog
  openCreateInboxDialog(provider, instanceId);
}

async function handleCreateInbox(
  type: 'random' | 'custom',
  username: string | undefined = undefined,
  domain: string | undefined = undefined
) {
  createInboxDialogOpen = false;
  const provider = pendingCreateProvider;
  const instanceId = pendingCreateInstanceId;
  pendingCreateProvider = undefined;
  pendingCreateInstanceId = undefined;
  if (type === 'random') {
    await createInbox(provider, instanceId, undefined, domain);
  } else {
    await createInbox(provider, instanceId, username, domain);
  }
}

function openQrDialog() {
  qrOpenTimerId = openQrDialogAction(
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
    qrSetters,
    qrOpenTimerId
  );
  qrOpenTimerId = null;
}

function downloadQrCode() {
  downloadQrCodeAction(qrCanvas, displayedEmail || selectedEmail, (message) => showToast(message));
}

async function copyQrImage() {
  await copyQrImageAction(qrCanvas, (message, type) => showToast(message, type));
}

// --- Message detail ---
let selectedThread = $state<Email[]>([]);

function openMessageDetail(thread: Email[]) {
  const unreadInThread = thread.filter((m) => m.unread).length;
  selectedThread = thread;
  // Split view (≥1280): keep mailbox list open and show detail beside it
  currentView = layoutSplit ? 'main' : 'messageDetail';

  // Mark every email in the thread as read
  for (const message of thread) {
    if (!message.unread) continue;
    message.unread = false;
    void persistEmailRead(message);
    // Update emails array to reflect read state (trigger reactivity)
    const emailIndex = emails.findIndex((e) => e.id === message.id);
    if (emailIndex !== -1) {
      emails = emails.map((e, i) => (i === emailIndex ? { ...e, unread: false } : e));
    }
  }
  // Immediately decrement footer badge - don't wait for next storage poll
  if (selectedEmail && unreadByAddress[selectedEmail] > 0) {
    unreadByAddress = {
      ...unreadByAddress,
      [selectedEmail]: Math.max(0, unreadByAddress[selectedEmail] - unreadInThread),
    };
  }
}

// --- Remove account (delete inbox) ---
async function removeAccount(address: string) {
  const account = allInboxes.find((a) => a.address === address);
  if (!account) return;
  const addrLower = account.address.toLowerCase();
  const linkedLogins = (savedLogins || []).filter(
    (l) => (l.email || '').toLowerCase() === addrLower
  );
  const linkedIdentities = (identities || []).filter(
    (id) =>
      (id.preferredEmail || '').toLowerCase() === addrLower ||
      (id as { email?: string }).email?.toLowerCase() === addrLower
  );
  const impactParts: string[] = [];
  if (linkedLogins.length) {
    impactParts.push(
      $t('account.deleteLinkedLogins', { values: { n: linkedLogins.length } }) as string
    );
  }
  if (linkedIdentities.length) {
    impactParts.push(
      $t('account.deleteLinkedIdentities', {
        values: {
          n: linkedIdentities.length,
          names: linkedIdentities.map((i) => i.name).join(', '),
        },
      }) as string
    );
  }
  const wasInactive =
    account.accountStatus === 'archived' ||
    account.accountStatus === 'deleted' ||
    account.status === 'archived' ||
    account.status === 'deleted' ||
    (account.expiresAt > 0 && account.expiresAt <= Date.now());
  const returnToAddresses = currentView === 'emailDetail';

  const doDelete = async () => {
    closeConfirm();
    await removeAccountAction(ext, account, { selectedEmail, emails, loading }, managementSetters);
    if (returnToAddresses) {
      currentEmailDetail = null;
      mgmtTab = wasInactive ? 'inactive' : 'active';
      currentView = 'mailSettings';
    }
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
    if (returnToAddresses) {
      currentEmailDetail = null;
      mgmtTab = 'inactive';
      currentView = 'mailSettings';
    }
  };
  showConfirm(
    $t('account.deleteConfirmBody', { values: { address: account.address } }) as string,
    doDelete,
    {
      title: $t('account.deleteConfirmTitle') as string,
      confirmLabel: $t('account.deletePermanently') as string,
      secondaryLabel:
        account.accountStatus !== 'archived' ? ($t('account.archiveInstead') as string) : undefined,
      onSecondary: account.accountStatus !== 'archived' ? doArchive : undefined,
      note:
        impactParts.length > 0
          ? impactParts.join(' · ')
          : ($t('account.deleteConfirmNote') as string),
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

let exportWizardOpen = $state(false);
let exportWizardAccount = $state<Account | null>(null);
let exportWizardMessages = $state<Email[]>([]);

// --- Export single inbox emails ---
async function exportAccountEmails(account: Account) {
  try {
    const response = (await ext.runtime.sendMessage({
      type: 'checkEmails',
      inboxId: account.id,
      filters: {},
    })) as { messages?: Email[] } | undefined;
    exportWizardAccount = account;
    exportWizardMessages = response?.messages || [];
    exportWizardOpen = true;
  } catch {
    showToast($t('toasts.exportFailed'), 'error');
  }
}

async function handleExecuteExport(format: string) {
  if (exportWizardAccount) {
    await exportEmailsWithFormatAction(exportWizardAccount, exportWizardMessages, format);
  }
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
  showToast($t('toasts.emailsExportedAsFormat', { values: { format: format.toUpperCase() } }));
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
/** Responsive sidebar when host width ≥ 800px (sidepanel/app; not compact popup) */
let layoutWide = $state(false);
/** Split list+detail when width ≥ 1280px */
let layoutSplit = $state(false);
/** Brief fade when crossing split breakpoint */
let splitModeFlash = $state(false);
/** Resizable list column width (px) for split view */
let splitListWidthPx = $state(420);
/** Ctrl/Cmd+K command palette */
let commandPaletteOpen = $state(false);
/** UI density for sidepanel / wide layouts */
let uiDensity = $state<'comfortable' | 'compact'>('comfortable');
/** Mailbox folder + label (sidebar / list sync) */
let mailboxListTab = $state<'inbox' | 'archived' | 'deleted' | 'all'>('inbox');
let activeMailboxLabel = $state<string | null>(null);
let sidebarMailboxLabels = $state<string[]>([]);

let mailboxFolderCounts = $derived.by(() => {
  const list = filteredEmails || [];
  return {
    all: list.length,
    inbox: list.filter((e) => !e.local_archived && !e.local_deleted).length,
    archived: list.filter((e) => e.local_archived && !e.local_deleted).length,
    deleted: list.filter((e) => !!e.local_deleted).length,
  };
});
let sidebarLiveCount = $derived(
  allInboxes.filter(
    (a) =>
      a.status === 'active' &&
      a.accountStatus !== 'archived' &&
      a.accountStatus !== 'deleted' &&
      !((a.expiresAt ?? 0) > 0 && a.expiresAt <= Date.now())
  ).length
);
let sidebarInactiveCount = $derived(Math.max(0, allInboxes.length - sidebarLiveCount));
let sidebarTagCount = $derived(
  new Set(
    allInboxes.flatMap((a) => {
      if (Array.isArray(a.tags) && a.tags.length) return a.tags.map((t) => t.name).filter(Boolean);
      return a.tag ? [a.tag] : [];
    })
  ).size
);
let sidebarLabelCount = $derived(sidebarMailboxLabels.length);
let sidebarFilterCount = $derived(savedSearchFilters?.length ?? 0);
let sidebarProfileCount = $derived(identities?.length ?? 0);
let sidebarCredentialCount = $derived(savedLogins?.length ?? 0);
let totalUnreadCount = $derived(
  (Object.entries(unreadByAddress) as [string, number][])
    .filter(([addr]) => allInboxes.some((a) => a.address === addr && a.status === 'active'))
    .reduce((sum, [, n]) => sum + n, 0)
);
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

async function setContrastLevel(level: ContrastLevel) {
  contrastLevel = level;
  applyThemeAction(themeMode, contrastLevel);
  if (customColor) {
    applyCustomColor(customColor);
  }
  await ext.storage.local.set({ contrastLevel: level });
}

// Listen for system theme changes
const cleanupSystemThemeListener = listenForSystemThemeChanges(
  () => themeMode,
  () => contrastLevel,
  applyTheme
);

const restoreArchivedInbox = (email: Email) => {
  restoreArchivedInboxAction(ext, email, { archivedEmails }, archivedSetters);
};

function _openMessageWindow(message: Email) {
  if (!openMessageWindow(message)) {
    openMessageDetail([message]);
  }
}

// --- Saved search filters ---
let _savedSearchFiltersActions: ReturnType<typeof useSavedSearchFilters> | null = null;
async function getSavedSearchFilters() {
  if (!_savedSearchFiltersActions) {
    const { useSavedSearchFilters } = await import('@/features/inbox/use-saved-search-filters.js');
    _savedSearchFiltersActions = useSavedSearchFilters(
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
        setRecipient: (value) => (recipient = value),
        setSubject: (value) => (subject = value),
        setSelectedSenders: (value) => (selectedSenders = value),
        setDateFrom: (value) => (dateFrom = value),
        setDateTo: (value) => (dateTo = value),
        setSortBy: (value) => (sortBy = value),
        showToast: (message, type) => showToast(message, type),
      }
    );
  }
  return _savedSearchFiltersActions;
}

async function loadSavedSearchFilters() {
  const actions = await getSavedSearchFilters();
  await actions.loadSavedSearchFilters();
}

async function saveFilter(input: SaveFilterInput) {
  const actions = await getSavedSearchFilters();
  await actions.saveFilter(input);
}

async function renameFilter(id: string, name: string) {
  const actions = await getSavedSearchFilters();
  await actions.renameFilter(id, name);
}

async function loadFilter(filter: SavedSearchFilter) {
  const actions = await getSavedSearchFilters();
  await actions.loadFilter(filter);
}

async function clearFilters() {
  const actions = await getSavedSearchFilters();
  await actions.clearFilters();
}

async function deleteFilter(id: string) {
  const actions = await getSavedSearchFilters();
  await actions.deleteFilter(id);
}

const stopExtensionStorageSync = useExtensionStorageSync([
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

// Plain let — must NOT be $state (read+write in same effect → infinite loop)
let _lastAppliedColor = '';
let cleanupMountedResources = () => {};

$effect(() => {
  const enabled = inboxColorThemeEnabled;
  const address = displayedEmail || selectedEmail;
  const account =
    allInboxes.find((a) => a.address === selectedEmail || a.address === address) ||
    accounts.find((a) => a.address === selectedEmail || a.address === address);
  const inboxId = account?.id;
  const fallback = customColor;
  // Key by inbox id so domain swaps never recolor the theme
  let activeColor = '';
  if (enabled) {
    activeColor =
      (inboxId && inboxColors[inboxId]) || (address ? inboxColors[address] || '' : '') || '';
    if (!activeColor && (address || inboxId)) {
      activeColor = untrack(() => getInboxColor(address || '', inboxId));
    }
    if (!activeColor) activeColor = fallback || '#4c662b';
  } else {
    activeColor = fallback || '';
  }
  if (activeColor && activeColor !== _lastAppliedColor) {
    void applyCustomColor(activeColor);
    _lastAppliedColor = activeColor;
  } else if (!activeColor && _lastAppliedColor) {
    void applyCustomColor('');
    _lastAppliedColor = '';
  }
});

// --- Initialize on mount ---
onMount(async () => {
  window.addEventListener('keydown', handleKeydown);
  updateUnreadByAddress();

  // Apply user provider JSON overrides (if any) before loading inboxes
  try {
    await loadProviderOverridesFromStorage(browser);
  } catch {
    /* keep bundled providers */
  }

  // Usage stats: count extension UI opens (direct storage — survives SW restarts)
  try {
    const { analytics: a = {} } = (await browser.storage.local.get(['analytics'])) as {
      analytics?: Record<string, unknown>;
    };
    await browser.storage.local.set({
      analytics: {
        ...a,
        extensionOpens: ((a.extensionOpens as number) || 0) + 1,
      },
    });
  } catch {
    /* ignore */
  }

  // Content-script / context-menu handoff: open a specific view
  async function applyOpenViewHandoff() {
    let openView = '';
    let openIdentityCreate = false;
    let openIdentityEditId = '';
    try {
      const s = (await browser.storage.session.get([
        'openView',
        'openIdentityCreate',
        'openIdentityEditId',
      ])) as {
        openView?: string;
        openIdentityCreate?: boolean;
        openIdentityEditId?: string;
      };
      openView = s.openView || '';
      openIdentityCreate = !!s.openIdentityCreate;
      openIdentityEditId = s.openIdentityEditId || '';
      if (openView || openIdentityCreate || openIdentityEditId) {
        await browser.storage.session.remove([
          'openView',
          'openIdentityCreate',
          'openIdentityEditId',
        ]);
      }
    } catch {
      /* session may fail */
    }
    if (!openView && !openIdentityCreate && !openIdentityEditId) {
      const s = (await browser.storage.local.get([
        'openView',
        'openIdentityCreate',
        'openIdentityEditId',
      ])) as {
        openView?: string;
        openIdentityCreate?: boolean;
        openIdentityEditId?: string;
      };
      openView = s.openView || '';
      openIdentityCreate = !!s.openIdentityCreate;
      openIdentityEditId = s.openIdentityEditId || '';
      if (openView || openIdentityCreate || openIdentityEditId) {
        await browser.storage.local.remove([
          'openView',
          'openIdentityCreate',
          'openIdentityEditId',
        ]);
      }
    }
    if (!openView && !openIdentityCreate && !openIdentityEditId) return;

    if (openView === 'identities' || openIdentityCreate || openIdentityEditId) {
      currentView = 'autofill';
      autofillTabValue = 'profiles';
      autofillTabSignal += 1;
      if (openIdentityCreate) identityCreateSignal += 1;
      if (openIdentityEditId) identityEditIdSignal = openIdentityEditId;
    } else if (
      openView === 'autofill' ||
      openView === 'logins' ||
      openView === 'savedLogins' ||
      openView === 'loginInfo'
    ) {
      currentView = 'autofill';
      let tabPref = 'profiles';
      try {
        const t = (await browser.storage.local.get(['autofillTab'])) as {
          autofillTab?: string;
        };
        tabPref = t.autofillTab || tabPref;
        await browser.storage.local.remove(['autofillTab']);
      } catch {
        /* ignore */
      }
      if (
        openView === 'loginInfo' ||
        openView === 'savedLogins' ||
        openView === 'logins' ||
        tabPref === 'credentials'
      ) {
        autofillTabValue = 'credentials';
      } else {
        autofillTabValue = 'profiles';
      }
      autofillTabSignal += 1;
    } else if (openView === 'manage' || openView === 'addresses' || openView === 'mailSettings') {
      currentView = 'mailSettings';
    } else if (openView === 'main' || openView === 'mailbox') {
      currentView = 'main';
    } else if (openView === 'settings') {
      currentView = 'settings';
    } else if (openView === 'about') {
      currentView = 'about';
    } else if (openView === 'organize') {
      currentView = 'organize';
    } else if (openView === 'analytics' || openView === 'activity') {
      currentView = 'analytics';
    }

    // Sync selected mailbox from activeInboxId (context menu create / address pick)
    try {
      const { activeInboxId, inboxes = [] } = (await browser.storage.local.get([
        'activeInboxId',
        'inboxes',
      ])) as { activeInboxId?: string; inboxes?: Account[] };
      if (activeInboxId) {
        const acct = inboxes.find((a) => a.id === activeInboxId);
        if (acct?.address) {
          selectedEmail = acct.address;
          displayedEmail = acct.address;
        }
      }
    } catch {
      /* ignore */
    }
  }

  try {
    await applyOpenViewHandoff();
  } catch {
    /* ignore */
  }

  // Live navigation from context menu while UI is already open
  try {
    browser.runtime.onMessage.addListener((message: unknown) => {
      if (!message || typeof message !== 'object') return;
      const m = message as { type?: string; view?: string };
      if (m.type === 'navigateView' && m.view) {
        void (async () => {
          try {
            await browser.storage.local.set({ openView: m.view });
            await applyOpenViewHandoff();
          } catch {
            /* ignore */
          }
        })();
      }
    });
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' && area !== 'session') return;
      if (changes.openView || changes.openViewAt || changes.activeInboxId) {
        void applyOpenViewHandoff();
      }
    });
  } catch {
    /* ignore */
  }

  // Content-script handoff: open for setup / renew, then remind user to return to the form
  try {
    let reason = '';
    let hint = '';
    try {
      const s = (await browser.storage.session.get([
        'openExtensionReason',
        'openExtensionHint',
        'pendingAutofillReturn',
      ])) as {
        openExtensionReason?: string;
        openExtensionHint?: string;
        pendingAutofillReturn?: boolean;
      };
      reason = s.openExtensionReason || '';
      hint = s.openExtensionHint || '';
      if (s.pendingAutofillReturn) {
        // Keep flag until first live inbox exists
      }
      if (reason)
        await browser.storage.session.remove(['openExtensionReason', 'openExtensionHint']);
    } catch {
      const s = (await browser.storage.local.get(['openExtensionReason', 'openExtensionHint'])) as {
        openExtensionReason?: string;
        openExtensionHint?: string;
      };
      reason = s.openExtensionReason || '';
      hint = s.openExtensionHint || '';
      if (reason) await browser.storage.local.remove(['openExtensionReason', 'openExtensionHint']);
    }
    if (hint) {
      showToast(hint, 'info');
    } else if (reason === 'setup') {
      showToast($t('contentAutofill.setupRequired'), 'info');
    } else if (reason === 'expired' || reason === 'no_active') {
      showToast($t('contentAutofill.noActiveAddress'), 'info');
    }
  } catch {
    /* ignore */
  }

  // When first address appears after pending autofill, prompt return to form
  try {
    const onInboxReady = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area !== 'local' || !changes.inboxes) return;
      void (async () => {
        try {
          const flags = (await browser.storage.session.get(['pendingAutofillReturn'])) as {
            pendingAutofillReturn?: boolean;
          };
          if (!flags.pendingAutofillReturn) return;
          const list = changes.inboxes.newValue as unknown[];
          if (Array.isArray(list) && list.length > 0) {
            showToast($t('contentAutofill.returnToForm'), 'success');
            await browser.storage.session.remove([
              'pendingAutofillReturn',
              'pendingAutofillUrl',
              'pendingAutofillAt',
            ]);
          }
        } catch {
          /* ignore */
        }
      })();
    };
    browser.storage.onChanged.addListener(onInboxReady);
  } catch {
    /* ignore */
  }

  // Resume import after popup → full-page handoff (file picker closes popup)
  // Also honor flag on any surface so full-page import is never skipped.
  const openImportIfFlagged = async () => {
    try {
      let flag = false;
      try {
        const s = (await browser.storage.session.get(['openImportBackup'])) as {
          openImportBackup?: boolean;
        };
        flag = !!s.openImportBackup;
        if (flag) await browser.storage.session.remove('openImportBackup');
      } catch {
        /* session may be unavailable */
      }
      if (!flag) {
        const s = (await browser.storage.local.get(['openImportBackup'])) as {
          openImportBackup?: boolean;
        };
        flag = !!s.openImportBackup;
        if (flag) await browser.storage.local.remove(['openImportBackup', 'openImportAt']);
      }
      if (flag) {
        showImportBackupDialog = true;
      }
    } catch {
      /* ignore */
    }
  };
  await openImportIfFlagged();
  // Late handoff: popup may write the flag after app.html already mounted
  try {
    const onImportFlag = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area !== 'local' && area !== 'session') return;
      if (changes.openImportBackup?.newValue) {
        void openImportIfFlagged();
      }
    };
    browser.storage.onChanged.addListener(onImportFlag);
    // Store cleanup with other mount cleanups below if available
    (window as unknown as { __importFlagListener?: typeof onImportFlag }).__importFlagListener =
      onImportFlag;
  } catch {
    /* ignore */
  }

  // Preload locale JSON for tSync helpers (timeAgo etc.) so list never shows raw keys
  try {
    const stored = (await browser.storage.local.get(['locale', 'preferredLanguage'])) as {
      locale?: string;
      preferredLanguage?: string;
    };
    const loc = stored.preferredLanguage || stored.locale || 'en';
    setCachedLocale(loc);
    await preloadTranslations(loc);
  } catch (error) {
    logDebug(`Could not preload translations: ${String(error)}`);
    try {
      await preloadTranslations('en');
    } catch {
      /* ignore */
    }
  }

  // Listen for demo-mode / settings requesting a product tour mid-session
  try {
    const onTourFlag = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area !== 'local') return;
      if (changes.pendingProductTour?.newValue === true) {
        void (async () => {
          await loadInboxes(true);
          await startProductTour();
        })();
      }
    };
    browser.storage.onChanged.addListener(onTourFlag);
  } catch {
    /* ignore */
  }

  // Resume interactive product tour only after at least one real/demo inbox exists
  try {
    const pending = await isPendingProductTour();
    const done = await isProductTourCompleted();
    const { inboxes: tourInboxes = [] } = (await browser.storage.local.get(['inboxes'])) as {
      inboxes?: Account[];
    };
    const hasInbox = Array.isArray(tourInboxes) && tourInboxes.length > 0;
    if (pending && !done && hasInbox) {
      setTimeout(() => {
        void startProductTour();
      }, 400);
    } else if (pending && !hasInbox) {
      // Wait until first address is created (onboarding) — do not show tour on empty shell
      await clearPendingProductTour();
    }
  } catch {
    /* ignore */
  }

  // Load thread grouping setting
  try {
    const { threadGrouping = false } = (await browser.storage.local.get(['threadGrouping'])) as {
      threadGrouping?: boolean;
    };
    threadGroupingSetting = threadGrouping;
  } catch (error) {
    logDebug(`Could not load thread grouping setting: ${String(error)}`);
  }

  // Load storage quota warning
  try {
    const { storageQuotaWarning = false } = (await browser.storage.local.get([
      'storageQuotaWarning',
    ])) as {
      storageQuotaWarning?: boolean;
    };
    if (storageQuotaWarning) {
      const hasPermission = await browser.permissions.contains({
        permissions: ['unlimitedStorage'],
      });
      showQuotaBanner = !hasPermission;
    }
  } catch (error) {
    logDebug(`Could not load storage quota warning: ${String(error)}`);
  }

  // Load autofill blocklist
  try {
    const { autofillBlocklist: stored = [] } = (await browser.storage.local.get([
      'autofillBlocklist',
    ])) as { autofillBlocklist?: string[] };
    autofillBlocklist = stored;
  } catch (error) {
    logDebug(`Could not load autofill blocklist: ${String(error)}`);
  }

  /**
   * Resolve stored mail bag for the active address only.
   * Exact match first, then case-insensitive - never fall back to “same username
   * different domain/account” (that showed mails from the wrong inbox).
   * Optionally also try `displayedEmail` when multi-domain cycling changes the domain.
   */
  /** Only exact / case-insensitive address key - never merge another inbox's bag. */
  function resolveStoredEmailBags(
    storedEmails: Record<string, Email[]>,
    address: string,
    _aliasAddress?: string
  ): { key: string; list: Email[] } {
    if (!address) return { key: address, list: [] };
    if (storedEmails[address]) return { key: address, list: storedEmails[address] || [] };
    const lower = address.toLowerCase();
    for (const [k, list] of Object.entries(storedEmails)) {
      if (k.toLowerCase() === lower) return { key: k, list: list || [] };
    }
    return { key: address, list: [] };
  }

  /**
   * Apply storedEmails → UI without wiping a non-empty list when storage is empty
   * (common race: API-backed list is showing while storage key/domain hasn't caught up).
   */
  async function syncEmailsFromStorage(reason: 'change' | 'poll') {
    if (!selectedEmail || document.hidden) return;
    // Capture selection at start - user may switch address while we await storage
    const forAddress = selectedEmail;
    const forAlias =
      displayedEmail && displayedEmail !== selectedEmail ? displayedEmail : undefined;
    try {
      const {
        storedEmails = {},
        readEmails = {},
        latestOtp,
        activeInboxId,
      } = (await ext.storage.local.get([
        'storedEmails',
        'readEmails',
        'latestOtp',
        'activeInboxId',
      ])) as {
        storedEmails?: Record<string, Email[]>;
        readEmails?: Record<string, boolean>;
        latestOtp?: { otp: string; sender: string; senderName: string; context: string };
        activeInboxId?: string;
      };
      // Drop stale sync if user already navigated to another inbox
      if (selectedEmail !== forAddress) return;
      if (activeInboxId) {
        const acct = allInboxes.find((a) => a.id === activeInboxId);
        if (acct?.address && acct.address !== forAddress && acct.address !== forAlias) {
          // active id points elsewhere - don't overwrite UI for old address
          return;
        }
      }

      const { key, list: inboxEmails } = resolveStoredEmailBags(storedEmails, forAddress, forAlias);

      // Never blank the visible list with empty storage - but only if in-memory
      // mails actually belong to this address (don't keep prev inbox's list).
      if (inboxEmails.length === 0 && emails.length > 0 && selectedEmail === forAddress) {
        const addrLower = forAddress.toLowerCase();
        const belongs = emails.every((e) => {
          const own = (e.original_inbox || '').toLowerCase();
          return !own || own === addrLower;
        });
        if (belongs) {
          unreadByAddress = computeUnreadCounts(storedEmails, readEmails);
          return;
        }
      }

      if (selectedEmail !== forAddress) return;
      inboxSetters.setEmails([...mapEmailsForDisplay(inboxEmails, readEmails, key || forAddress)]);
      unreadByAddress = computeUnreadCounts(storedEmails, readEmails);
      const otpResult = latestOtp || extractLatestOtp(storedEmails, context);
      if (otpResult) {
        inboxSetters.setLatestOtp(otpResult.otp);
        inboxSetters.setLatestOtpSender(otpResult.sender);
        inboxSetters.setLatestOtpSenderName(otpResult.senderName);
        inboxSetters.setOtpContext(otpResult.context);
      } else if (reason === 'change') {
        // Only clear OTP strip on real storage changes when no OTP present
        inboxSetters.setLatestOtp('------');
        inboxSetters.setLatestOtpSender('');
        inboxSetters.setLatestOtpSenderName('');
        inboxSetters.setOtpContext('');
      }
    } catch (e) {
      logError(`Error syncing emails from storage (${reason})`, e);
    }
  }

  // Listen for storedEmails storage changes (set by background periodic check)
  const handleStorageChange = async (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>
  ) => {
    if ((changes.storedEmails || changes.readEmails) && selectedEmail) {
      await syncEmailsFromStorage('change');
    }
    if (changes.threadGrouping) {
      threadGroupingSetting = !!changes.threadGrouping.newValue;
    }
  };

  browser.storage.onChanged.addListener(handleStorageChange);

  // Listen for blocklist changes
  const handleBlocklistChange = async (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>
  ) => {
    if (changes.autofillBlocklist) {
      autofillBlocklist = (changes.autofillBlocklist.newValue as string[]) || [];
    }
  };
  browser.storage.onChanged.addListener(handleBlocklistChange);

  // Listen for status messages from content scripts to show them as toasts
  const handleContentMessage = (message: unknown) => {
    if (message && typeof message === 'object' && 'status' in message) {
      const msg = message as { status: string; isError?: boolean };
      showToast(msg.status, msg.isError ? 'error' : 'success');
    }
  };
  browser.runtime.onMessage.addListener(handleContentMessage);

  // Debounced storage poll function
  let pollTimeout: ReturnType<typeof setTimeout> | null = null;
  const debouncedPoll = async () => {
    if (pollTimeout) clearTimeout(pollTimeout);
    pollTimeout = setTimeout(async () => {
      await syncEmailsFromStorage('poll');
    }, 500); // Debounce for 500ms
  };

  // Poll storage every 10 seconds as backup (more reliable than storage.onChanged)
  // Only poll when page is visible to save resources
  const pollInterval = setInterval(debouncedPoll, 10000);

  cleanupMountedResources = () => {
    window.removeEventListener('keydown', handleKeydown);
    browser.storage.onChanged.removeListener(handleStorageChange);
    browser.storage.onChanged.removeListener(handleBlocklistChange);
    browser.runtime.onMessage.removeListener(handleContentMessage);
    clearInterval(pollInterval);
    if (pollTimeout) clearTimeout(pollTimeout);
    cleanupSystemThemeListener();
  };

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
  checkRetentionCleanup();

  // App context: restore state that was saved when expanding popup to app window
  if (context === 'app') {
    const expandedAppStateData = (await ext.storage.local.get(['expandedAppState'])) as {
      expandedAppState?: {
        currentView?: View;
        mgmtTab?: string;
        mgmtSearch?: string;
        selectedEmail?: string;
        selectedThread?: Email[];
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

      if (expandedAppState.currentView === 'messageDetail' && expandedAppState.selectedThread) {
        selectedThread = expandedAppState.selectedThread;
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
        selectedThread = [email];
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
        openMessageDetail([targetEmail]);
      }
    }
  } else {
    const result = (await ext.storage.local.get(['activeInboxId'])) as { activeInboxId?: string };
    if (result.activeInboxId) {
      // Paint cached emails immediately — do NOT block UI on slow APIs
      await syncEmailsFromStorage('poll');
      // Soft refresh in background (loadingEmails only inside checkMessages)
      const activeId = result.activeInboxId;
      void checkMessages(activeId).then(() => {
        void evaluateProviderFailoverAfterRefresh(activeId);
      });
    }
  }
  // Check form detection from active tab via messaging (+ poll while open)
  const pollFormDetected = async (tabId?: number) => {
    try {
      let id = tabId;
      if (id == null) {
        const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
        id = tab?.id;
      }
      if (id == null) {
        formDetected = false;
        return;
      }
      const response = await ext.tabs.sendMessage(id, { type: 'checkFormDetected' });
      formDetected = response?.formDetected || false;
    } catch {
      formDetected = false;
    }
  };
  await pollFormDetected();
  // Low-frequency safety poll only — primary signals are tab URL/status + content messages
  const formPollInterval = setInterval(() => {
    void pollFormDetected();
  }, 12000);
  const handleTabActivated = async (activeInfo: { tabId: number }) => {
    await pollFormDetected(activeInfo.tabId);
  };
  const handleTabUpdated = (
    tabId: number,
    changeInfo: { url?: string; status?: string },
    tab: { active?: boolean }
  ) => {
    if (tab.active && (changeInfo.url || changeInfo.status === 'complete')) {
      // SPA navigations: clear strip immediately then re-probe
      if (changeInfo.url) formDetected = false;
      void pollFormDetected(tabId);
    }
  };
  const handleRuntimeMessage = (message: unknown) => {
    if (
      message &&
      typeof message === 'object' &&
      (message as { type?: string }).type === 'formPresence'
    ) {
      formDetected = !!(message as { formDetected?: boolean }).formDetected;
    }
  };
  ext.tabs.onActivated.addListener(handleTabActivated);
  ext.tabs.onUpdated.addListener(handleTabUpdated);
  try {
    ext.runtime.onMessage.addListener(handleRuntimeMessage);
  } catch {
    /* ignore */
  }

  const previousCleanup = cleanupMountedResources;
  cleanupMountedResources = () => {
    previousCleanup();
    clearInterval(formPollInterval);
    ext.tabs.onActivated.removeListener(handleTabActivated);
    ext.tabs.onUpdated.removeListener(handleTabUpdated);
    try {
      ext.runtime.onMessage.removeListener(handleRuntimeMessage);
    } catch {
      /* ignore */
    }
  };
});

onDestroy(() => {
  stopExtensionStorageSync();
  cleanupMountedResources();
});

let cheatSheetOpen = $state(false);

let paletteCommands = $derived.by((): PaletteCommand[] => {
  const go = (view: View) => {
    accountSelectorDropdownOpen = false;
    currentView = view;
  };
  return [
    {
      id: 'mailbox',
      label: $t('nav.mailbox') as string,
      icon: 'mail',
      keywords: 'inbox mail messages',
      run: () => go('main'),
    },
    {
      id: 'addresses',
      label: $t('nav.addresses') as string,
      icon: 'inbox',
      keywords: 'manage addresses',
      run: () => go('mailSettings'),
    },
    {
      id: 'autofill',
      label: $t('nav.autofill') as string,
      icon: 'editSquare',
      keywords: 'identities profiles',
      run: () => go('autofill'),
    },
    {
      id: 'settings',
      label: $t('nav.settings') as string,
      icon: 'settings',
      keywords: 'preferences',
      run: () => go('settings'),
    },
    {
      id: 'about',
      label: $t('nav.about') as string,
      icon: 'info',
      keywords: 'faq help',
      run: () => go('about'),
    },
    {
      id: 'create',
      label: $t('nav.fabCreateAddress') as string,
      icon: 'plus',
      keywords: 'new address generate',
      run: () => openCreateInboxDialog(),
    },
    {
      id: 'search',
      label: $t('inbox.focusSearch') as string,
      icon: 'search',
      keywords: 'find filter',
      hint: '/',
      run: () => {
        if (currentView !== 'main') currentView = 'main';
        queueMicrotask(() => void focusAppSearch());
      },
    },
    {
      id: 'refresh',
      label: $t('common.refresh') as string,
      icon: 'refresh',
      keywords: 'reload',
      run: () => void refreshInbox(),
    },
    {
      id: 'shortcuts',
      label: 'Keyboard shortcuts',
      icon: 'key',
      keywords: 'cheat sheet help',
      hint: '?',
      run: () => {
        cheatSheetOpen = true;
      },
    },
  ];
});

// --- Keyboard shortcuts ---
function focusAppSearch() {
  // Prefer current page search; fall back to mailbox search (navigate if needed)
  const selectors = [
    '[data-mailbox-search] input',
    '#mailbox-search',
    'input[type="search"]',
    'input[placeholder*="Search" i]',
    'input[placeholder*="search" i]',
  ];
  for (const sel of selectors) {
    const el = document.querySelector<HTMLInputElement>(sel);
    if (el && !el.disabled && el.offsetParent !== null) {
      el.focus();
      el.select?.();
      return true;
    }
  }
  return false;
}

function navigateMessageList(direction: 'next' | 'prev') {
  // Only navigate when mailbox list is available (main or message detail / split)
  if (currentView !== 'main' && currentView !== 'messageDetail') {
    currentView = 'main';
  }
  const list = activeNavigationList;
  if (!list.length) {
    showToast($t('inbox.noMessagesToNavigate'), 'info');
    return;
  }
  let idx = currentNavigationIndex;
  if (idx < 0) {
    idx = direction === 'next' ? -1 : 0;
  }
  const nextIdx = direction === 'next' ? idx + 1 : idx - 1;
  if (nextIdx < 0 || nextIdx >= list.length) {
    showToast(
      direction === 'next' ? $t('inbox.endOfMessageList') : $t('inbox.startOfMessageList'),
      'info'
    );
    return;
  }
  openMessageDetail(list[nextIdx].emails);
}

function handleKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement;
  const isInput =
    target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable);
  if (!isInput && event.key === '?') {
    event.preventDefault();
    cheatSheetOpen = !cheatSheetOpen;
    return;
  }

  // "/" focuses search on any page (before other handlers steal it)
  if (!isInput && event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    if (!focusAppSearch()) {
      // Navigate to main so mailbox search exists, then focus
      if (currentView !== 'main' && currentView !== 'messageDetail') {
        currentView = 'main';
      }
      queueMicrotask(() => {
        if (!focusAppSearch()) {
          // last resort after view paint
          setTimeout(() => void focusAppSearch(), 50);
        }
      });
    }
    return;
  }

  // Ctrl/Cmd+K command palette
  if (
    !isInput &&
    (event.key === 'k' || event.key === 'K') &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey
  ) {
    event.preventDefault();
    commandPaletteOpen = !commandPaletteOpen;
    return;
  }

  handleKeydownAction(
    event,
    {
      currentView,
      mgmtTab,
      selectedAddresses,
      mgmtSearch,
      qrDialogOpen,
      confirmDialog,
      selectedMessage: selectedThread,
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
      setSelectedMessage: (message: Email[] | null) => (selectedThread = message ?? []),
      setCurrentEmailDetail: (detail: Account | null) => (currentEmailDetail = detail),
      toggleAccountSelector: () => {
        if (currentView !== 'main') currentView = 'main';
        accountSelectorDropdownOpen = !accountSelectorDropdownOpen;
      },
      focusSearch: () => {
        if (!focusAppSearch()) {
          if (currentView !== 'main') currentView = 'main';
          queueMicrotask(() => void focusAppSearch());
        }
      },
      navigateMessageList,
    },
    keybindings
  );
}

// --- Global Tooltip Logic ---
let activeTooltip = $state<{ text: string; x: number; y: number } | null>(null);
let tooltipTimeout: ReturnType<typeof setTimeout> | null = null;
let hoveredElement: HTMLElement | null = null;
let tooltipRef = $state<HTMLElement | null>(null);

function handleMouseOver(e: MouseEvent) {
  const target = (e.target as HTMLElement).closest('[title], [data-tooltip]') as HTMLElement;
  if (!target) return;
  if (hoveredElement === target) return;

  clearTooltip();
  hoveredElement = target;

  let text = target.getAttribute('data-tooltip') || '';
  if (!text && target.hasAttribute('title')) {
    text = target.getAttribute('title') || '';
    target.setAttribute('data-tooltip', text);
    target.removeAttribute('title');
  }

  if (!text) return;

  tooltipTimeout = setTimeout(() => {
    const rect = target.getBoundingClientRect();
    let x = rect.left + rect.width / 2;
    let y = rect.bottom + 6;

    activeTooltip = { text, x, y };
  }, 400);
}

function handleMouseOut(e: MouseEvent) {
  if (hoveredElement && !hoveredElement.contains(e.relatedTarget as Node)) {
    clearTooltip();
  }
}

function clearTooltip() {
  if (tooltipTimeout) {
    clearTimeout(tooltipTimeout);
    tooltipTimeout = null;
  }
  activeTooltip = null;
  hoveredElement = null;
}

$effect(() => {
  if (activeTooltip && tooltipRef) {
    const rect = tooltipRef.getBoundingClientRect();
    const padding = 8;
    let left = activeTooltip.x;
    let top = activeTooltip.y;

    if (left - rect.width / 2 < padding) {
      left = rect.width / 2 + padding;
    }
    if (left + rect.width / 2 > window.innerWidth - padding) {
      left = window.innerWidth - rect.width / 2 - padding;
    }

    if (top + rect.height > window.innerHeight - padding) {
      const targetRect = hoveredElement?.getBoundingClientRect();
      if (targetRect) {
        top = targetRect.top - rect.height - 6;
      }
    }

    tooltipRef.style.left = `${left}px`;
    tooltipRef.style.top = `${top}px`;
    tooltipRef.style.transform = 'translate(-50%, 0)';
    tooltipRef.style.opacity = '1';
  }
});

onMount(() => {
  window.addEventListener('mouseover', handleMouseOver, { passive: true });
  window.addEventListener('mouseout', handleMouseOut, { passive: true });
  window.addEventListener('mousedown', clearTooltip, { passive: true });
  window.addEventListener('scroll', clearTooltip, { capture: true, passive: true });
  const updateWide = () => {
    const wasSplit = layoutSplit;
    layoutWide = context !== 'popup' && window.innerWidth >= 800;
    layoutSplit = context !== 'popup' && window.innerWidth >= 1280;
    // Adapt navigation mode when crossing the split threshold
    if (layoutSplit !== wasSplit) {
      splitModeFlash = true;
      window.setTimeout(() => {
        splitModeFlash = false;
      }, 220);
    }
    if (layoutSplit && !wasSplit) {
      if (currentView === 'messageDetail' && selectedThread.length > 0) {
        currentView = 'main';
      } else if (currentView === 'emailDetail' && currentEmailDetail) {
        currentView = 'mailSettings';
      }
    } else if (!layoutSplit && wasSplit) {
      if (currentView === 'main' && selectedThread.length > 0) {
        currentView = 'messageDetail';
      } else if (currentView === 'mailSettings' && currentEmailDetail) {
        currentView = 'emailDetail';
      }
    }
  };
  updateWide();
  window.addEventListener('resize', updateWide, { passive: true });
  void browser.storage.local.get(['uiDensity', 'splitListWidthPx', 'emailTags']).then((r) => {
    const d = (r as { uiDensity?: string }).uiDensity;
    if (d === 'compact' || d === 'comfortable') uiDensity = d;
    const w = (r as { splitListWidthPx?: number }).splitListWidthPx;
    if (typeof w === 'number' && w >= 260) splitListWidthPx = w;
    const tags = (r as { emailTags?: Record<string, string[]> }).emailTags || {};
    const set = new Set<string>();
    for (const list of Object.values(tags)) {
      if (Array.isArray(list)) for (const t of list) if (t) set.add(t);
    }
    sidebarMailboxLabels = Array.from(set).sort((a, b) => a.localeCompare(b));
  });
  const onDensityStorage = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local' || !changes.uiDensity) return;
    const d = changes.uiDensity.newValue;
    if (d === 'compact' || d === 'comfortable') uiDensity = d;
  };
  browser.storage.onChanged.addListener(onDensityStorage);
  return () => {
    window.removeEventListener('resize', updateWide);
    browser.storage.onChanged.removeListener(onDensityStorage);
  };
});

onDestroy(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('mouseover', handleMouseOver);
    window.removeEventListener('mouseout', handleMouseOut);
    window.removeEventListener('mousedown', clearTooltip);
    window.removeEventListener('scroll', clearTooltip, { capture: true });
  }
});
</script>

<ErrorBoundary>
  <!--
    Header/footer MUST NOT use z-index stacking contexts.
    View overlays use position:fixed; if chrome is z-10 and content is z-0,
    header/footer paint ABOVE fixed dialogs inside content (stacking trap).
  -->
  <div
    class="flex justify-center items-stretch bg-md-background overflow-x-hidden
      {context === 'popup' ? 'w-[360px] h-[600px] min-h-0' : 'min-h-screen'}
      {context === 'sidepanel' || context === 'app' ? 'h-screen w-full' : ''}"
  >
    <!--
      Popup: exactly 360×600, no outer padding (padding was clipping ~8–15px).
      Sidepanel/app: fill host; no fixed phone frame.
    -->
    <div
      class="relative bg-md-surface flex transition-all duration-300 ease-in-out overflow-x-hidden box-border
        {layoutWide ? 'flex-row' : 'flex-col'}
        {context === 'popup'
          ? 'w-[360px] max-w-[360px] h-[600px] min-h-[600px] max-h-[600px] p-[7.5px] rounded-none shadow-none'
          : layoutWide
            ? 'w-full max-w-none h-full min-h-0 max-h-none flex-1 p-0 rounded-none shadow-none'
            : 'w-full max-w-none h-full min-h-0 max-h-none flex-1 p-[7.5px] rounded-none shadow-none'}"
      style="--footer-safe: {layoutWide ? '12px' : '52px'};"
    >
      {#if layoutWide && !(isOffline && !offlineDismissed)}
        <SidebarNav
          {currentView}
          themeMode={themeMode === 'system' ? 'auto' : themeMode}
          onThemeChange={(mode) => setThemeMode(mode === 'auto' ? 'system' : mode)}
          {contrastLevel}
          onContrastChange={(level) => void setContrastLevel(level)}
          onNavigate={(view) => {
            accountSelectorDropdownOpen = false;
            currentView = view;
          }}
          onLogoClick={() => {
            accountSelectorDropdownOpen = false;
            currentView = 'about';
          }}
          organizeTab={organizeTabValue}
          autofillTab={autofillTabValue}
          {mgmtTab}
          mailboxListTab={mailboxListTab}
          onMailboxListTab={(tab) => {
            mailboxListTab = tab as typeof mailboxListTab;
          }}
          mailboxLabels={sidebarMailboxLabels}
          activeMailboxLabel={activeMailboxLabel}
          onMailboxLabel={(lab) => {
            activeMailboxLabel = lab;
          }}
          onOrganizeTab={(tab) => {
            organizeTabValue = tab;
            organizeTabSignal += 1;
          }}
          onAutofillTab={(tab) => {
            autofillTabValue = tab;
            autofillTabSignal += 1;
          }}
          onMgmtTab={(tab) => {
            mgmtTab = tab;
          }}
          totalUnread={totalUnreadCount}
          showBack={showHeaderBack}
          onBack={handleHeaderBack}
          density={uiDensity}
          loading={loading || loadingEmails}
          providerInstances={providerInstances}
          onCreateInboxWithProvider={handleCreateInboxWithProvider}
          selectedEmail={selectedEmail}
          allInboxes={allInboxes}
          onSelectAccount={(addr) => void selectAccount(addr)}
          mailboxFolderCounts={mailboxFolderCounts}
          liveCount={sidebarLiveCount}
          inactiveCount={sidebarInactiveCount}
          tagCount={sidebarTagCount}
          labelCount={sidebarLabelCount}
          filterCount={sidebarFilterCount}
          profileCount={sidebarProfileCount}
          credentialCount={sidebarCredentialCount}
          onFabClick={(kind) => {
            // Same handlers as floating Footer FAB
            if (kind === 'refresh') {
              const id =
                allInboxes.find((a) => a.address === selectedEmail)?.id ||
                accounts.find((a) => a.address === selectedEmail)?.id;
              if (id) void refreshInbox(id);
              else void refreshInbox();
            } else if (kind === 'createAddress') {
              openCreateInboxDialog();
            } else if (kind === 'createIdentity') {
              identityCreateSignal += 1;
              autofillTabValue = 'profiles';
              autofillTabSignal += 1;
              if (currentView !== 'autofill') currentView = 'autofill';
            } else if (kind === 'createTag') {
              tagCreateSignal += 1;
              organizeTabValue = 'tags';
              organizeTabSignal += 1;
              if (currentView !== 'organize') currentView = 'organize';
            } else if (kind === 'createLabel') {
              labelCreateSignal += 1;
              organizeTabValue = 'labels';
              organizeTabSignal += 1;
              if (currentView !== 'organize') currentView = 'organize';
            } else if (kind === 'createFilter') {
              organizeTabValue = 'filters';
              organizeTabSignal += 1;
              if (currentView !== 'organize') currentView = 'organize';
              // Filters are created from mailbox search; open filters tab for management
            } else if (kind === 'ghostLogin') {
              autofillTabValue = 'credentials';
              autofillTabSignal += 1;
              if (currentView !== 'autofill') currentView = 'autofill';
              savedLoginsFocusSignal += 1;
            } else if (kind === 'ghostExpand') {
              void (async () => {
                try {
                  await browser.storage.local.set({
                    expandedAppState: {
                      currentView: 'messageDetail',
                      selectedEmail,
                      selectedThread,
                      createdAt: Date.now(),
                    },
                  });
                  const getURL = (
                    browser.runtime as unknown as { getURL: (p: string) => string }
                  ).getURL;
                  await browser.tabs.create({ url: getURL('/app.html') });
                } catch (e) {
                  logError('sidebar expand failed', e);
                }
              })();
            } else if (kind === 'ghost') {
              try {
                document
                  .querySelector('.view-crossfade')
                  ?.scrollTo({ top: 0, behavior: 'smooth' });
              } catch {
                /* ignore */
              }
            }
          }}
        />
      {/if}
      <!--
        Shell content column (right of sidebar). When layoutSplit is on, THIS is not
        the mainview alone — mainview is the list pane inside each page (data-mainview).
        Enforce min 360px so sidepanel/app never crush the primary content column.
      -->
      <div
        class="flex flex-col flex-1 min-h-0 relative min-w-0
          {layoutWide ? 'p-[7.5px]' : ''}"
        data-density={uiDensity}
        data-content-shell
        style={layoutWide || context === 'sidepanel' || context === 'app'
          ? 'min-width: 360px;'
          : undefined}
      >
      {#if isOffline && !offlineDismissed}
        <OfflineBanner onDismiss={() => { offlineDismissed = true; }} />
      {:else if !layoutWide}
        {@const moreDestViews = new Set([
          'about',
          'settings',
          'organize',
          'analytics',
          'tagManagement',
          'labelManagement',
          'filtersManagement',
        ])}
        {@const shellW = typeof window !== 'undefined' ? window.innerWidth : 360}
        <!-- Match Footer adaptive nav: 7-wide promotes all; 6-wide keeps Activity+About in More -->
        {@const promotedInPrimary =
          shellW >= 520
            ? new Set(['organize', 'analytics', 'settings', 'about'])
            : shellW >= 440
              ? new Set(['organize', 'settings'])
              : shellW >= 400
                ? new Set(['organize'])
                : new Set<string>()}
        {@const moreNavKey =
          currentView === 'tagManagement' ||
          currentView === 'labelManagement' ||
          currentView === 'filtersManagement'
            ? 'organize'
            : currentView}
        {@const isMoreOnlyPage =
          moreDestViews.has(currentView) && !promotedInPrimary.has(moreNavKey)}
        {@const headerPageTitle =
          currentView === 'about'
            ? $t('nav.about')
            : currentView === 'settings'
              ? $t('nav.settings')
              : currentView === 'organize' ||
                  currentView === 'tagManagement' ||
                  currentView === 'labelManagement' ||
                  currentView === 'filtersManagement'
                ? $t('nav.organize')
                : currentView === 'analytics'
                  ? $t('nav.activity')
                  : ''}
        <Header
          contrastLevel={contrastLevel}
          onContrastChange={(level) => void setContrastLevel(level)}
          themeMode={themeMode === 'system' ? 'auto' : themeMode}
          onThemeChange={(mode) => setThemeMode(mode === 'auto' ? 'system' : mode)}
          expandState={{
            currentView,
            mgmtTab,
            mgmtSearch,
            selectedEmail,
            selectedThread,
            currentEmailDetail,
            archivedSearch,
          }}
          showBack={showHeaderBack}
          compactLogo={showHeaderBack}
          morePageChrome={isMoreOnlyPage && !showHeaderBack}
          pageTitle={isMoreOnlyPage && !showHeaderBack ? headerPageTitle : ''}
          onBack={handleHeaderBack}
          onLogoClick={() => {
            accountSelectorDropdownOpen = false;
            currentView = 'about';
          }}
        />
      {:else}
        <!-- Wide layout: back lives in SidebarNav header next to logo -->
      {/if}

      <!-- Main content - bottom padding clears floating footer island -->
      <div
        class="flex-1 min-h-0 overflow-hidden overflow-x-hidden relative flex flex-col"
        style={accounts.length > 0 || allInboxes.length > 0 || loadingInboxes
          ? 'padding-bottom: var(--footer-safe, 72px)'
          : undefined}
      >
  {#key currentView}
  <div class="view-crossfade flex-1 min-h-0 flex flex-col overflow-hidden">

  {#if currentView === 'mailSettings'}
    <!-- 3-col: sidebar | mainview (list) | splitview (detail) — gap = padding between panes -->
    <div class="flex flex-1 min-h-0 overflow-hidden {layoutSplit ? 'flex-row gap-[7.5px]' : 'flex-col'} {splitModeFlash ? 'split-mode-flash' : ''}">
    <div
      data-mainview
      class="relative {layoutSplit
        ? 'shrink-0 overflow-hidden flex flex-col rounded-xl bg-md-surface'
        : 'flex-1 min-h-0 flex flex-col overflow-hidden'}"
      style={layoutSplit
        ? `width: ${splitListWidthPx}px; min-width: 360px; max-width: min(640px, 55%); flex-shrink: 0;`
        : 'min-width: 0;'}
    >
    {#if AddressesViewComponent}
      {@const Comp = AddressesViewComponent}
      <Comp {context}
    onBack={() => { currentView = 'main'; selectedAddresses = new Set(); mgmtSearch = ''; currentEmailDetail = null; }}
    mgmtTab={mgmtTab}
    mgmtSearch={mgmtSearch}
    selectedAddresses={selectedAddresses}
    mgmtAccounts={mgmtAccounts}
    allAccounts={allInboxes}
    allSelected={allSelected}
    loadingInboxes={loadingInboxes}
    storedEmails={allStoredEmails}
    onTabChange={(tab: string) => { mgmtTab = tab; selectedAddresses = new Set(); }}
    onSearchChange={(value: string) => mgmtSearch = value}
    onToggleSelectAll={toggleSelectAll}
    onToggleSelect={(id: string) => toggleSelect(id)}
    onArchiveSelected={archiveSelected}
    onUnarchiveSelected={unarchiveSelected}
    onDeleteSelected={deleteSelected}
    onExportSelected={exportSelected}
    onMarkSelectedRead={async () => {
      try {
        const { readEmails = {} } = (await ext.storage.local.get(['readEmails'])) as {
          readEmails?: Record<string, boolean>;
        };
        for (const id of selectedAddresses) {
          const acc = allInboxes.find((a) => a.id === id);
          if (!acc?.address) continue;
          const bag = allStoredEmails[acc.address] || [];
          for (const e of bag) {
            readEmails[`${acc.address}_${e.id}`] = true;
            readEmails[e.id] = true;
          }
        }
        await ext.storage.local.set({ readEmails });
        showToast($t('toasts.emailsRestored') || 'Marked as read', 'success');
      } catch {
        /* ignore */
      }
    }}
    onMarkSelectedUnread={async () => {
      try {
        const { readEmails = {} } = (await ext.storage.local.get(['readEmails'])) as {
          readEmails?: Record<string, boolean>;
        };
        for (const id of selectedAddresses) {
          const acc = allInboxes.find((a) => a.id === id);
          if (!acc?.address) continue;
          const bag = allStoredEmails[acc.address] || [];
          for (const e of bag) {
            delete readEmails[`${acc.address}_${e.id}`];
            delete readEmails[e.id];
          }
        }
        await ext.storage.local.set({ readEmails });
        showToast($t('emailDetail.markAllUnread') || 'Marked as unread', 'success');
      } catch {
        /* ignore */
      }
    }}
    onTagSelected={openEmailDetailTagDialogForSelected}
    onOpenEmailDetail={openEmailDetail}
    onArchiveAccount={archiveAccount}
    onUnarchiveAccount={unarchiveAccount}
    onDeleteAccounts={deleteAccountsDirect}
    onExportAccountEmails={exportAccountEmails}
    onGenerateNewAddress={() => openCreateInboxDialog()}
    onEditAccount={(acc: Account) => openEmailDetail(acc)}
    onExtendAccount={extendAccount}
    onToggleAutoExtend={toggleAutoExtend}
    onTagAccount={(acc: Account) => openEmailDetailTagDialog(acc)}
    onMarkAccountAllRead={async (acc: Account) => {
      try {
        const { readEmails = {} } = (await ext.storage.local.get(['readEmails'])) as {
          readEmails?: Record<string, boolean>;
        };
        const bag = allStoredEmails[acc.address] || [];
        for (const e of bag) {
          readEmails[`${acc.address}_${e.id}`] = true;
          readEmails[e.id] = true;
        }
        await ext.storage.local.set({ readEmails });
        showToast($t('emailDetail.markAllRead'), 'success');
      } catch {
        /* ignore */
      }
    }}
    onMarkAccountAllUnread={async (acc: Account) => {
      try {
        const { readEmails = {} } = (await ext.storage.local.get(['readEmails'])) as {
          readEmails?: Record<string, boolean>;
        };
        const bag = allStoredEmails[acc.address] || [];
        for (const e of bag) {
          delete readEmails[`${acc.address}_${e.id}`];
          delete readEmails[e.id];
        }
        await ext.storage.local.set({ readEmails });
        showToast($t('emailDetail.markAllUnread'), 'success');
      } catch {
        /* ignore */
      }
    }}
    onReorderAccounts={reorderAccountsById}
    highlightAddress={highlightAddress}
    />
    {:else}
      <div class="flex items-center justify-center h-full"><div class="text-sm text-md-on-surface/50">Loading...</div></div>
    {/if}
    <!-- Tag dialog in addresses mainview (list pane) when not editing via detail -->
    {#if emailDetailTagDialogOpen && layoutSplit && emailDetailTagTarget?.id !== currentEmailDetail?.id}
      <TagDialog
        open={emailDetailTagDialogOpen}
        currentTag={emailDetailTagTargets.length > 1 ? null : (emailDetailTagTarget?.tag ?? null)}
        currentTagColor={emailDetailTagTargets.length > 1 ? null : (emailDetailTagTarget?.tagColor ?? null)}
        existingTags={allExistingTags}
        tagColors={allTagColors}
        onClose={closeEmailDetailTagDialog}
        onSave={saveEmailDetailTag}
        portal={false}
      />
    {/if}
    </div>
    {#if layoutSplit}
      <!-- Resizable split divider -->
      <button
        type="button"
        class="split-resize-handle shrink-0 w-1.5 cursor-col-resize relative z-10 hover:bg-md-primary/20 active:bg-md-primary/30 border-0 p-0 bg-transparent"
        aria-label="Resize panes"
        onpointerdown={(e) => {
          const startX = e.clientX;
          const startW = splitListWidthPx;
          const parent = (e.currentTarget as HTMLElement).parentElement;
          const move = (ev: PointerEvent) => {
            const maxByDetail = Math.max(
              360,
              (parent?.clientWidth || 1280) - 360 - 16
            );
            splitListWidthPx = Math.min(
              Math.min(640, maxByDetail),
              Math.max(360, startW + (ev.clientX - startX))
            );
          };
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            void browser.storage.local.set({ splitListWidthPx });
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        }}
      ></button>
      <div
        data-splitview
        class="relative flex-1 overflow-hidden flex flex-col rounded-xl bg-md-surface"
        style="min-width: 360px;"
      >
        {#if currentEmailDetail}
        <EmailDetail
          onBack={() => { currentEmailDetail = null; }}
          currentEmailDetail={currentEmailDetail}
          emails={emails}
          savedLogins={savedLogins}
          loading={loading}
          showToolbarLabels={true}
          onOpenMessageDetail={openMessageDetail}
          onRefreshMessages={async () => {
            if (currentEmailDetail) {
              loading = true;
              await checkMessages(currentEmailDetail.id);
              loading = false;
            }
          }}
          onExportEmail={() => {
            if (currentEmailDetail) exportAccountEmails(currentEmailDetail);
          }}
          onAddressDomainChanged={async (addr) => {
            if (currentEmailDetail) {
              currentEmailDetail = { ...currentEmailDetail, address: addr };
            }
            selectedEmail = addr;
            displayedEmail = addr;
            await loadInboxes(true);
            try {
              await ext.storage.local.set({ activeInboxId: currentEmailDetail?.id });
            } catch {
              /* ignore */
            }
          }}
          showToast={(msg, type, undo) =>
            showToast(msg || '', (type as ToastType) || 'success', undo ?? null)}
          onNavigateToMailbox={async () => {
            if (currentEmailDetail?.address) await selectAccount(currentEmailDetail.address);
            currentEmailDetail = null;
            currentView = 'main';
          }}
          onArchiveAccount={(account) => {
            archiveAccount(account);
            currentEmailDetail = null;
          }}
          onUnarchiveAccount={async (account) => {
            await unarchiveAccount(account);
            await loadInboxes(true);
            const updated = allInboxes.find((a) => a.id === account.id);
            if (updated) currentEmailDetail = updated;
          }}
          onRemoveAccount={(address) => {
            void removeAccount(address);
            currentEmailDetail = null;
          }}
          onToggleAutoExtend={async (account) => {
            await toggleAutoExtend(account);
            await loadInboxes(true);
            const updated = allInboxes.find((a) => a.id === account.id);
            if (updated) currentEmailDetail = updated;
          }}
          onMarkAllRead={async () => {
            if (!currentEmailDetail) return;
            try {
              const { readEmails = {} } = (await ext.storage.local.get(['readEmails'])) as {
                readEmails?: Record<string, boolean>;
              };
              for (const e of emails) {
                readEmails[`${currentEmailDetail.address}_${e.id}`] = true;
                readEmails[e.id] = true;
              }
              await ext.storage.local.set({ readEmails });
              await checkMessages(currentEmailDetail.id);
            } catch {
              /* ignore */
            }
          }}
          onMarkAllUnread={async () => {
            if (!currentEmailDetail) return;
            try {
              const { readEmails = {} } = (await ext.storage.local.get(['readEmails'])) as {
                readEmails?: Record<string, boolean>;
              };
              for (const e of emails) {
                delete readEmails[`${currentEmailDetail.address}_${e.id}`];
                delete readEmails[e.id];
              }
              await ext.storage.local.set({ readEmails });
              await checkMessages(currentEmailDetail.id);
            } catch {
              /* ignore */
            }
          }}
          onOpenTagDialog={() => {
            if (currentEmailDetail) openEmailDetailTagDialog(currentEmailDetail);
          }}
          onOpenSavedLogins={(email) => {
            loginInfoEmailFilter = email;
            autofillTabValue = 'credentials';
            autofillTabSignal += 1;
            currentView = 'autofill';
          }}
          onOpenIdentities={(email) => {
            identitiesEmailFilter = email;
            autofillTabValue = 'profiles';
            autofillTabSignal += 1;
            currentView = 'autofill';
          }}
        />
        <!-- Tag dialog scoped to split detail pane (when tagging the open detail) -->
        {#if emailDetailTagDialogOpen && emailDetailTagTarget?.id === currentEmailDetail?.id}
          <TagDialog
            open={emailDetailTagDialogOpen}
            currentTag={emailDetailTagTargets.length > 1 ? null : (emailDetailTagTarget?.tag ?? null)}
            currentTagColor={emailDetailTagTargets.length > 1 ? null : (emailDetailTagTarget?.tagColor ?? null)}
            existingTags={allExistingTags}
            tagColors={allTagColors}
            onClose={closeEmailDetailTagDialog}
            onSave={saveEmailDetailTag}
            portal={false}
          />
        {/if}
        {:else}
          <div class="flex-1 flex flex-col items-center justify-center px-6 text-center gap-3 bg-md-surface-container-low/40">
            <Icon name="inbox" class="w-12 h-12 text-md-on-surface/20" />
            <div class="text-sm font-semibold text-md-on-surface/70">{$t('mailManagement.noAddressSelected')}</div>
            <p class="text-xs text-md-on-surface/45 max-w-xs leading-relaxed">{$t('mailManagement.splitEmptyHint')}</p>
            <ul class="text-xs text-md-on-surface/50 space-y-1.5 text-start max-w-xs mt-1">
              <li class="flex gap-2"><span class="text-md-primary font-bold">·</span>{$t('mailManagement.splitTipSelect')}</li>
              <li class="flex gap-2"><span class="text-md-primary font-bold">·</span>{$t('mailManagement.splitTipCreate')}</li>
              <li class="flex gap-2"><span class="text-md-primary font-bold">·</span>{$t('mailManagement.splitTipDomain')}</li>
            </ul>
          </div>
        {/if}
      </div>
    {/if}
    </div>

  {:else if currentView === 'emailDetail'}
    <EmailDetail
      onBack={() => { currentView = 'mailSettings'; currentEmailDetail = null; }}
      currentEmailDetail={currentEmailDetail}
      emails={emails}
      savedLogins={savedLogins}
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
      onAddressDomainChanged={async (addr) => {
        if (currentEmailDetail) {
          currentEmailDetail = { ...currentEmailDetail, address: addr };
        }
        selectedEmail = addr;
        displayedEmail = addr;
        await loadInboxes(true);
        // Keep mailbox selection in sync for when user returns to inbox
        try {
          await ext.storage.local.set({
            activeInboxId: currentEmailDetail?.id,
          });
        } catch {
          /* ignore */
        }
      }}
      showToast={(msg, type, undo) =>
        showToast(msg || '', (type as ToastType) || 'success', undo ?? null)}
      onNavigateToMailbox={async () => {
        if (currentEmailDetail?.address) {
          await selectAccount(currentEmailDetail.address);
        }
        currentView = 'main';
      }}
      onArchiveAccount={(account) => { archiveAccount(account); currentView = 'main'; currentEmailDetail = null; }}
      onUnarchiveAccount={async (account) => {
        await unarchiveAccount(account);
        await loadInboxes(true);
        const updated = allInboxes.find((a) => a.id === account.id);
        if (updated) currentEmailDetail = updated;
      }}
      onRemoveAccount={(address) => { void removeAccount(address); }}
      onToggleAutoExtend={async (account) => {
        await toggleAutoExtend(account);
        await loadInboxes(true);
        // Sync currentEmailDetail so AutoRenewToggle reflects the new state immediately
        const updated = allInboxes.find((a) => a.id === account.id);
        if (updated) currentEmailDetail = updated;
      }}
      onMarkAllRead={async () => {
        if (!currentEmailDetail) return;
        try {
          const { readEmails = {} } = (await ext.storage.local.get(['readEmails'])) as { readEmails?: Record<string, boolean> };
          for (const e of emails) {
            readEmails[`${currentEmailDetail.address}_${e.id}`] = true;
            readEmails[e.id] = true;
          }
          await ext.storage.local.set({ readEmails });
          await checkMessages(currentEmailDetail.id);
        } catch { /* ignore */ }
      }}
      onMarkAllUnread={async () => {
        if (!currentEmailDetail) return;
        try {
          const { readEmails = {} } = (await ext.storage.local.get(['readEmails'])) as { readEmails?: Record<string, boolean> };
          for (const e of emails) {
            delete readEmails[`${currentEmailDetail.address}_${e.id}`];
            delete readEmails[e.id];
          }
          await ext.storage.local.set({ readEmails });
          await checkMessages(currentEmailDetail.id);
        } catch { /* ignore */ }
      }}
      onOpenTagDialog={() => {
        if (currentEmailDetail) openEmailDetailTagDialog(currentEmailDetail);
      }}
      onOpenSavedLogins={(email) => {
        loginInfoEmailFilter = email;
        autofillTabValue = 'credentials';
        autofillTabSignal += 1;
        currentView = 'autofill';
      }}
      onOpenIdentities={(email) => {
        identitiesEmailFilter = email;
        autofillTabValue = 'profiles';
        autofillTabSignal += 1;
        currentView = 'autofill';
      }}
    />

  {:else if currentView === 'settings'}
    {#if ExtensionSettingsViewComponent}
      {@const Settings = ExtensionSettingsViewComponent}
      <Settings {context}
        onBack={() => currentView = 'main'}
        autoCopy={autoCopy}
        autoRenew={autoRenew}
        selectedProvider={selectedProvider}
        savingSettings={savingSettings}
        loading={settingsLoading}
        onSaveSettings={saveSettings}
        onSetAutoCopy={(v: boolean) => { autoCopy = v; }}
        onSetAutoRenew={(v: boolean) => { autoRenew = v; }}
        onHardReset={hardReset}
        providerInstances={providerInstances}
        selectedProviderInstance={selectedProviderInstance}
        onSetProviderInstance={(v: string) => { selectedProviderInstance = v; }}
        onExportData={exportData}
        onImportData={importData}
        onStartProductTour={startProductTour}
        onProviderChange={handleProviderChange}
        onAddCustomInstance={addCustomInstance}
        onLoadProviderInstances={loadProviderInstances}
        customColor={customColor}
        onColorChange={handleColorChange}
        inboxColorThemeEnabled={inboxColorThemeEnabled}
        onToggleInboxColorTheme={async () => {
          inboxColorThemeEnabled = !inboxColorThemeEnabled;
          await browser.storage.local.set({ inboxColorThemeEnabled });
        }}
        contrastLevel={contrastLevel}
        onContrastLevelChange={setContrastLevel}
        showDeveloperSettings={showDeveloperSettings}
        enableLogging={enableLogging}
        onToggleDeveloperSettings={toggleDeveloperSettings}
        onOpenPlayground={() => {
          currentView = 'playground';
        }}
        onToggleEnableLogging={toggleEnableLogging}
        emailRetentionDays={emailRetentionDays}
        onSetEmailRetentionDays={(v: number) => { emailRetentionDays = v; }}
        faviconCaching={faviconCaching}
        onSetFaviconCaching={(v: 'direct' | 'local') => { faviconCaching = v; }}
        identities={identities}
        selectedIdentityId={selectedIdentityId}
        onSetSelectedIdentityId={setSelectedIdentity}
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
        onNavigateToTagManagement={() => {
          organizeTabValue = 'tags';
          organizeTabSignal += 1;
          currentView = 'organize';
        }}
        onNavigateToFiltersManagement={() => {
          organizeTabValue = 'filters';
          organizeTabSignal += 1;
          currentView = 'organize';
        }}
        onNavigateToMailProvider={() => { currentView = 'mailProvider'; }}
        onNavigateToStoragePerformance={() => { currentView = 'storagePerformance'; }}
        onNavigateToLabelManagement={() => {
          organizeTabValue = 'labels';
          organizeTabSignal += 1;
          currentView = 'organize';
        }}
        onNavigateToMailboxManagement={() => { currentView = 'mailboxManagement'; }}
        onNavigateToConstantsSettings={() => { currentView = 'constantsSettings'; }}
        onNavigateToDiagnostics={() => { currentView = 'diagnostics'; }}
        autoRefreshInterval={autoRefreshInterval}
        onSetAutoRefreshInterval={updateAutoRefreshInterval}
        emailPreviewEnabled={emailPreviewEnabled}
        onSetEmailPreviewEnabled={(v: boolean) => { emailPreviewEnabled = v; }}
        defaultDomain={defaultDomain}
        onSetDefaultDomain={(v: string) => { defaultDomain = v; }}
        allInboxes={allInboxes}
        autofillBlocklist={autofillBlocklist}
        onRemoveFromBlocklist={removeFromAutofillBlocklist}
        onAddToBlocklist={addToAutofillBlocklistSetting}
      />
    {:else}
      <div class="flex items-center justify-center h-full">
        <div class="text-sm text-md-on-surface/50">Loading...</div>
      </div>
    {/if}

  {:else if currentView === 'analytics'}
    {#if ActivityViewComponent}
      {@const Comp = ActivityViewComponent}
      <Comp {context}
        onBack={() => currentView = 'main'}
        analytics={analytics}
        loading={analyticsLoading}
        onLoadAnalytics={loadAnalytics}
        onResetAnalytics={handleResetAnalytics}
      />
    {:else}
      <div class="flex items-center justify-center h-full"><div class="text-sm text-md-on-surface/50">Loading...</div></div>
    {/if}

  {:else if currentView === 'autofill' || currentView === 'loginInfo' || currentView === 'identities'}
    <!-- Same 3-col model as mailbox/addresses: sidebar | mainview | splitview -->
    <div class="flex flex-1 min-h-0 overflow-hidden {layoutSplit ? 'flex-row gap-[7.5px]' : 'flex-col'} {splitModeFlash ? 'split-mode-flash' : ''}">
      <div
        data-mainview
        class="{layoutSplit
          ? 'shrink-0 overflow-hidden flex flex-col rounded-xl bg-md-surface'
          : 'flex-1 min-h-0 flex flex-col overflow-hidden'}"
        style={layoutSplit
          ? `width: ${splitListWidthPx}px; min-width: 360px; max-width: min(640px, 55%); flex-shrink: 0;`
          : 'min-width: 0;'}
      >
        {#if AutofillViewComponent}
          {@const Comp = AutofillViewComponent}
          <Comp
            {context}
            initialTab={currentView === 'loginInfo'
              ? 'credentials'
              : currentView === 'identities'
                ? 'profiles'
                : autofillTabValue}
            tabSignal={autofillTabSignal}
            tabSignalValue={autofillTabValue}
            {savedLogins}
            {identities}
            mailboxAddresses={allInboxes.map((a) => a.address).filter(Boolean)}
            activeMailboxAddress={selectedEmail || accounts[0]?.address || ''}
            {loginInfoEmailFilter}
            {identitiesEmailFilter}
            focusSearchSignal={savedLoginsFocusSignal}
            createSignal={identityCreateSignal}
            editIdSignal={identityEditIdSignal}
            layoutSplit={layoutSplit}
            splitHostId="autofill-split-host"
            onDeleteLogin={(id: string) => deleteLoginByIdAction(ext, loginSetters, id)}
            onReorderLogin={(sourceId: string, targetId: string) =>
              reorderLoginInfoByIdAction(ext, loginSetters, sourceId, targetId)}
            showToast={(message: string) => showToast(message)}
            showConfirm={(message, onConfirm) => showConfirm(message, onConfirm)}
          />
        {:else}
          <div class="flex items-center justify-center h-full"><div class="text-sm text-md-on-surface/50">Loading...</div></div>
        {/if}
      </div>
      {#if layoutSplit}
        <button
          type="button"
          class="split-resize-handle shrink-0 w-1.5 cursor-col-resize relative z-10 hover:bg-md-primary/20 active:bg-md-primary/30 border-0 p-0 bg-transparent"
          aria-label="Resize panes"
          onpointerdown={(e) => {
            const startX = e.clientX;
            const startW = splitListWidthPx;
            const parent = (e.currentTarget as HTMLElement).parentElement;
            const move = (ev: PointerEvent) => {
              const maxByDetail = Math.max(360, (parent?.clientWidth || 1280) - 360 - 16);
              splitListWidthPx = Math.min(
                Math.min(640, maxByDetail),
                Math.max(360, startW + (ev.clientX - startX))
              );
            };
            const up = () => {
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', up);
              void browser.storage.local.set({ splitListWidthPx });
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
          }}
        ></button>
        <div
          id="autofill-split-host"
          data-splitview
          class="relative flex-1 overflow-hidden flex flex-col rounded-xl bg-md-surface min-h-0"
          style="min-width: 360px;"
        >
          <!-- Identity create/edit mounts here via IdentitiesView when layoutSplit -->
          <div
            class="autofill-split-empty flex-1 flex flex-col items-center justify-center px-6 text-center gap-2 pointer-events-none"
            data-autofill-split-placeholder
          >
            <Icon name="editSquare" class="w-10 h-10 text-md-on-surface/20" />
            <p class="text-sm font-semibold text-md-on-surface/70">{$t('identities.splitEmptyTitle')}</p>
            <p class="text-xs text-md-on-surface/45 max-w-xs">{$t('identities.splitEmptyHint')}</p>
          </div>
        </div>
      {/if}
    </div>

  {:else if currentView === 'keybindings'}
    {#if KeyboardShortcutsViewComponent}
      {@const Comp = KeyboardShortcutsViewComponent}
      <Comp
        onBack={() => currentView = 'settings'}
        {keybindings}
        onSetKeybindings={(v: Keybindings) => { keybindings = v; }}
        onSaveSettings={saveSettings}
      />
    {:else}
      <div class="flex items-center justify-center h-full"><div class="text-sm text-md-on-surface/50">Loading...</div></div>
    {/if}

  {:else if currentView === 'organize' || currentView === 'tagManagement' || currentView === 'labelManagement' || currentView === 'filtersManagement'}
    {#if OrganizeViewComponent}
      {@const Comp = OrganizeViewComponent}
      <Comp
        initialTab={currentView === 'labelManagement'
          ? 'labels'
          : currentView === 'filtersManagement'
            ? 'filters'
            : organizeTabValue}
        allInboxes={allInboxes}
        savedSearchFilters={savedSearchFilters}
        onReloadAccounts={async () => { await loadInboxes(true); }}
        onFiltersChange={async () => { await loadSavedSearchFilters(); }}
        showConfirm={(message, onConfirm) => showConfirm(message, onConfirm)}
        tagCreateSignal={tagCreateSignal}
        labelCreateSignal={labelCreateSignal}
        tabSignal={organizeTabSignal}
        tabSignalValue={organizeTabValue}
      />
    {:else}
      <div class="flex items-center justify-center h-full"><div class="text-sm text-md-on-surface/50">Loading...</div></div>
    {/if}

  {:else if currentView === 'mailProvider'}
    {#if MailProviderViewComponent}
      {@const Comp = MailProviderViewComponent}
      <Comp
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
        defaultDomain={defaultDomain}
        allInboxes={allInboxes}
        onProviderChange={handleProviderChange}
        onSetAutoRenew={(v: boolean) => { autoRenew = v; }}
        onSetNotificationsEnabled={(v: boolean) => { notificationsEnabled = v; }}
        onSetSoundEnabled={(v: boolean) => { soundEnabled = v; }}
        onSetExpiryWarningThreshold={(v: number) => { expiryWarningThreshold = v; }}
        onSetAutoRefreshInterval={updateAutoRefreshInterval}
        onSetEmailPreviewEnabled={(v: boolean) => { emailPreviewEnabled = v; }}
        onSetProviderInstance={(v: string) => { selectedProviderInstance = v; }}
        onAddCustomInstance={addCustomInstance}
        onLoadProviderInstances={loadProviderInstances}
        onSetDefaultDomain={(v: string) => { defaultDomain = v; }}
        onSaveSettings={saveSettings}
      />
    {:else}
      <div class="flex items-center justify-center h-full"><div class="text-sm text-md-on-surface/50">Loading...</div></div>
    {/if}

  {:else if currentView === 'storagePerformance'}
    {#if StoragePerformanceViewComponent}
      {@const Comp = StoragePerformanceViewComponent}
      <Comp
        onBack={() => currentView = 'settings'}
        faviconCaching={faviconCaching}
        emailRetentionDays={emailRetentionDays}
        onSetFaviconCaching={(v: 'direct' | 'local') => { faviconCaching = v; }}
        onSetEmailRetentionDays={(v: number) => { emailRetentionDays = v; }}
        onSaveSettings={saveSettings}
        onClearOldEmails={async () => { /* clearOldEmails handled inside StoragePerformanceView */ }}
      />
    {:else}
      <div class="flex items-center justify-center h-full"><div class="text-sm text-md-on-surface/50">Loading...</div></div>
    {/if}

  {:else if currentView === 'mailboxManagement'}
    {#if AddressesViewComponent}
      {@const Comp = AddressesViewComponent}
      <Comp {context}
        onBack={() => { currentView = 'settings'; selectedAddresses = new Set(); mgmtSearch = ''; }}
        mgmtTab={mgmtTab}
        mgmtSearch={mgmtSearch}
        selectedAddresses={selectedAddresses}
        mgmtAccounts={mgmtAccounts}
        allAccounts={allInboxes}
        allSelected={allSelected}
        loadingInboxes={loadingInboxes}
        storedEmails={allStoredEmails}
        onTabChange={(tab: string) => mgmtTab = tab}
        onSearchChange={(v: string) => mgmtSearch = v}
        onToggleSelectAll={toggleSelectAll}
      onToggleSelect={(id: string) => toggleSelect(id)}
      onArchiveSelected={archiveSelected}
      onUnarchiveSelected={unarchiveSelected}
      onDeleteSelected={deleteSelected}
      onExportSelected={exportSelected}
      onMarkSelectedRead={async () => {
        try {
          const { readEmails = {} } = (await ext.storage.local.get(['readEmails'])) as {
            readEmails?: Record<string, boolean>;
          };
          for (const id of selectedAddresses) {
            const acc = allInboxes.find((a) => a.id === id);
            if (!acc?.address) continue;
            const bag = allStoredEmails[acc.address] || [];
            for (const e of bag) {
              readEmails[`${acc.address}_${e.id}`] = true;
              readEmails[e.id] = true;
            }
          }
          await ext.storage.local.set({ readEmails });
        } catch {
          /* ignore */
        }
      }}
      onMarkSelectedUnread={async () => {
        try {
          const { readEmails = {} } = (await ext.storage.local.get(['readEmails'])) as {
            readEmails?: Record<string, boolean>;
          };
          for (const id of selectedAddresses) {
            const acc = allInboxes.find((a) => a.id === id);
            if (!acc?.address) continue;
            const bag = allStoredEmails[acc.address] || [];
            for (const e of bag) {
              delete readEmails[`${acc.address}_${e.id}`];
              delete readEmails[e.id];
            }
          }
          await ext.storage.local.set({ readEmails });
        } catch {
          /* ignore */
        }
      }}
      onTagSelected={openEmailDetailTagDialogForSelected}
      onOpenEmailDetail={(acc: Account) => { currentEmailDetail = acc; currentView = 'emailDetail'; }}
      onArchiveAccount={archiveAccount}
      onUnarchiveAccount={unarchiveAccount}
      onDeleteAccounts={deleteAccountsDirect}
      onExportAccountEmails={exportAccountEmails}
      onExtendAccount={extendAccount}
      onToggleAutoExtend={toggleAutoExtend}
      onTagAccount={(acc: Account) => openEmailDetailTagDialog(acc)}
      onMarkAccountAllRead={async (acc: Account) => {
        try {
          const { readEmails = {} } = (await ext.storage.local.get(['readEmails'])) as {
            readEmails?: Record<string, boolean>;
          };
          const bag = allStoredEmails[acc.address] || [];
          for (const e of bag) {
            readEmails[`${acc.address}_${e.id}`] = true;
            readEmails[e.id] = true;
          }
          await ext.storage.local.set({ readEmails });
        } catch {
          /* ignore */
        }
      }}
      onMarkAccountAllUnread={async (acc: Account) => {
        try {
          const { readEmails = {} } = (await ext.storage.local.get(['readEmails'])) as {
            readEmails?: Record<string, boolean>;
          };
          const bag = allStoredEmails[acc.address] || [];
          for (const e of bag) {
            delete readEmails[`${acc.address}_${e.id}`];
            delete readEmails[e.id];
          }
          await ext.storage.local.set({ readEmails });
        } catch {
          /* ignore */
        }
      }}
      onReorderAccounts={reorderAccountsById}
      highlightAddress={highlightAddress}
    />
    {:else}
      <div class="flex items-center justify-center h-full"><div class="text-sm text-md-on-surface/50">Loading...</div></div>
    {/if}

  {:else if currentView === 'constantsSettings'}
    {#if ConstantsSettingsViewComponent}
      {@const Comp = ConstantsSettingsViewComponent}
      <Comp onBack={() => currentView = 'settings'} />
    {:else}
      <div class="flex items-center justify-center h-full"><div class="text-sm text-md-on-surface/50">Loading...</div></div>
    {/if}

  {:else if currentView === 'diagnostics'}
    <DiagnosticsView onBack={() => (currentView = 'settings')} />

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
      onBack={() => { currentView = 'main'; selectedThread = []; }}
      selectedThread={selectedThread}
      hasPrev={hasPrevMessage}
      hasNext={hasNextMessage}
      onPrev={navigateToPrevMessage}
      onNext={navigateToNextMessage}
      mailboxAddress={selectedEmail}
      onMarkUnread={() => {
        for (const msg of selectedThread) {
          void persistEmailUnread(msg);
          const idx = emails.findIndex((e) => e.id === msg.id);
          if (idx !== -1) {
            emails = emails.map((e, i) => (i === idx ? { ...e, unread: true } : e));
          }
        }
        if (selectedEmail) {
          unreadByAddress = { ...unreadByAddress, [selectedEmail]: (unreadByAddress[selectedEmail] ?? 0) + selectedThread.length };
        }
        // Return to the mailbox that received this message
        currentView = 'main';
        selectedThread = [];
      }}
      onArchive={() => {
        if (selectedThread.length === 0) return;
        void archiveSelectedEmails(selectedThread).then(() => {
          currentView = 'main';
          selectedThread = [];
        });
      }}
      onDelete={() => {
        if (selectedThread.length === 0) return;
        void deleteSelectedEmails(selectedThread).then(() => {
          currentView = 'main';
          selectedThread = [];
        });
      }}
    />

  {:else if currentView === 'playground'}
    <PlaygroundView onBack={() => (currentView = 'settings')} />

  {:else if currentView === 'about'}
    {#if AboutViewComponent}
      {@const About = AboutViewComponent}
      <About {context} {version} onStartProductTour={startProductTour} />
    {:else}
      <div class="flex items-center justify-center h-full">
        <div class="text-sm text-md-on-surface/50">Loading...</div>
      </div>
    {/if}

  {:else if accounts.length === 0 && !loadingInboxes && allInboxes.length === 0}
    <Onboarding
      onCreateInbox={async (provider) => {
        const addr = await createInbox(provider);
        await loadSettings();
        if (!addr) {
          throw new Error('Could not create address with this provider. Try another.');
        }
      }}
      onStartProductTour={() => {
        setTimeout(() => {
          void startProductTour();
        }, 450);
      }}
      onImportBackup={() => {
        showImportBackupDialog = true;
      }}
    />

  {:else}
    {#if !retentionCleanupDismissed && oldEmailCount > 0}
      <div class="mx-1 mb-1 px-3 py-2 bg-md-primary/10 border border-md-primary/20 rounded-xl flex items-center gap-2 text-xs">
        <Icon name="clock" class="w-4 h-4 text-md-primary flex-shrink-0" />
        <span class="flex-1 text-md-on-surface">
          {$t('inbox.retentionCleanupPrompt', { values: { count: oldEmailCount } })}
        </span>
        <button
          class="px-2 py-1 rounded-lg bg-md-primary text-md-on-primary text-label-sm font-semibold hover:bg-md-primary/90 transition-colors"
          onclick={(e) => { e.stopPropagation(); void cleanupOldEmailsNow(); }}
        >
          {$t('common.delete')}
        </button>
        <button
          class="w-5 h-5 flex items-center justify-center rounded-lg hover:bg-md-secondary-container transition-colors"
          onclick={(e) => { e.stopPropagation(); void dismissRetentionCleanup(); }}
          aria-label="Dismiss"
        >
          <Icon name="x" class="w-3 h-3 text-md-on-surface/60" />
        </button>
      </div>
    {/if}
    {#if showQuotaBanner}
      <div class="mx-1 mb-1 px-3 py-2 bg-md-error/10 border border-md-error/20 rounded-xl flex items-center gap-2 text-xs">
        <Icon name="alert-triangle" class="w-4 h-4 text-md-error flex-shrink-0" />
        <span class="flex-1 text-md-on-surface">
          {$t('settings.storageNearLimit', { values: { used: '4.8 MB', limit: '5.0 MB' } })}
        </span>
        <button
          class="px-2 py-1 rounded-lg bg-md-error text-md-on-error text-label-sm font-semibold hover:bg-md-error/90 transition-colors"
          onclick={(e) => { e.stopPropagation(); void handleRequestQuotaUnlimitedStorage(); }}
        >
          {$t('common.confirm')}
        </button>
        <button
          class="w-5 h-5 flex items-center justify-center rounded-lg hover:bg-md-secondary-container transition-colors"
          onclick={(e) => { e.stopPropagation(); void dismissQuotaBanner(); }}
          aria-label="Dismiss"
        >
          <Icon name="x" class="w-3 h-3 text-md-on-surface/60" />
        </button>
      </div>
    {/if}
    <div class="flex flex-1 min-h-0 overflow-hidden {layoutSplit ? 'flex-row gap-[7.5px]' : 'flex-col'} {splitModeFlash ? 'split-mode-flash' : ''}">
    <div
      data-mainview
      class="{layoutSplit
        ? 'shrink-0 overflow-hidden flex flex-col rounded-xl bg-md-surface'
        : 'flex-1 min-h-0 flex flex-col overflow-hidden'}"
      style={layoutSplit
        ? `width: ${splitListWidthPx}px; min-width: 360px; max-width: min(640px, 55%); flex-shrink: 0;`
        : 'min-width: 0;'}
    >
    <MailboxView {context}
      selectedEmail={selectedEmail}
      bind:displayedEmail
      bind:emailListTab={mailboxListTab}
      bind:activeLabelFilter={activeMailboxLabel}
      hideListTabsUnlessSearch={layoutWide}
      dropdownOpen={accountSelectorDropdownOpen}
      defaultDomain={defaultDomain}
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
      allStoredEmails={allStoredEmails}
      latestOtp={latestOtp}
      latestOtpSender={latestOtpSender}
      latestOtpSenderName={latestOtpSenderName}
      otpContext={otpContext}
      formDetected={formDetected}
      providerFailoverHint={providerFailoverHint}
      savedSearchFilters={savedSearchFilters}
      savedLogins={savedLogins}
      openSection={archivedSectionOpen}
      onOpenMagicLink={(url) => {
        void browser.tabs.create({ url });
      }}
      onRefillSavedLogin={(login) => {
        void (async () => {
          try {
            const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
            if (tab?.id) {
              await browser.tabs.sendMessage(tab.id, {
                type: 'refillSavedLogin',
                credential: {
                  email: login.email,
                  password: login.password,
                  username: login.username,
                  name: login.name,
                  phone: login.phone,
                },
              });
              showToast($t('toasts.autofillStarted'), 'success');
            }
          } catch (e) {
            logError('refillSavedLogin failed', e);
            showToast($t('toasts.autofillFailed'), 'error');
          }
        })();
      }}
      onSaveFilterQuick={() => {
        const name = `Filter ${new Date().toLocaleString()}`;
        void saveFilter({
          name,
          searchQuery,
          hasOTP: otpOnly,
          senderDomain,
          dateFrom,
          dateTo,
          selectedSenders,
          sortBy,
          recipient: selectedEmail,
        });
        showToast($t('inbox.filterSavedToast'), 'success');
      }}
      onDropdownOpenChange={(open) => accountSelectorDropdownOpen = open}
      onSelectAccount={selectAccount}
      onCopyEmail={async () => {
        try {
          const success = await copyToClipboardAndSchedulePurge(displayedEmail || selectedEmail, 60000);
          if (success) showToast($t('toasts.emailCopiedToClipboard'));
        } catch (e) {
          logError('Failed to copy email', e);
        }
      }}
      onOpenQrDialog={openQrDialog}
      onCreateInbox={openCreateInboxDialog}
      onCreateInboxWithProvider={handleCreateInboxWithProvider}
      selectedProviderInstance={selectedProviderInstance}
      emailPreviewEnabled={emailPreviewEnabled}
      showToast={(message, type, undo) =>
        showToast(
          message,
          (type as ToastType) || 'success',
          undo ?? null,
          undo ? $t('common.undo') : null
        )}
      showConfirm={(message, onConfirm) => showConfirm(message, onConfirm)}
      onRefreshInbox={refreshInbox}
      onToggleNotifications={toggleNotifications}
      onArchiveAccount={archiveAccount}
      onUnarchiveAccount={unarchiveAccount}
      onRemoveAccount={removeAccount}
      onRestoreAccount={restoreAccount}
      onReloadAccounts={loadInboxes}
      onToggleAutoExtend={toggleAutoExtend}
      onExtendAccount={extendAccount}
      onAutofillForm={() => void autofillForm()}
      onOpenMessageDetail={openMessageDetail}
      onSearchChange={(v) => {
        const currentCriteria = {
          searchQuery,
          otpOnly,
          senderDomain,
          senderEmail: '',
          recipient,
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
        recipient = updated.recipient;
        subject = updated.subject;
      }}
      onSortChange={(v) => sortBy = v}
      onOtpOnlyChange={(v) => otpOnly = v}
      onSenderDomainChange={(v) => senderDomain = v}
      onSelectedSendersChange={(v) => selectedSenders = v}
      onDateFromChange={(v) => dateFrom = v}
      onDateToChange={(v) => dateTo = v}
      onClearFilters={clearFilters}
      onArchiveEmails={archiveSelectedEmails}
      onDeleteEmails={deleteSelectedEmails}
      onRestoreEmails={restoreSelectedEmails}
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
          recipient,
        })}
      onLoadFilter={loadFilter}
      onRenameFilter={renameFilter}
      onDeleteFilter={deleteFilter}
      onNavigateToSettings={() => { currentView = 'settings'; }}
      onNavigateToManage={() => {
        accountSelectorDropdownOpen = false;
        // Safety: remove any portaled account-selector overlay left on document.body
        try {
          document.querySelectorAll('.account-selector-overlay').forEach((n) => n.remove());
        } catch {
          /* ignore */
        }
        currentView = 'mailSettings';
      }}
      autoRenew={autoRenew}
      onToggleAutoRenew={async () => { autoRenew = !autoRenew; await saveAutoRenew(); }}
      onCopyOtp={copyOtp}
      onCopyOtpFromMessage={copyOtpFromMessage}
    />
    </div>
    {#if layoutSplit}
      <button
        type="button"
        class="split-resize-handle shrink-0 w-1.5 cursor-col-resize relative z-10 hover:bg-md-primary/20 active:bg-md-primary/30 border-0 p-0 bg-transparent"
        aria-label="Resize panes"
        onpointerdown={(e) => {
          const startX = e.clientX;
          const startW = splitListWidthPx;
          const parent = (e.currentTarget as HTMLElement).parentElement;
          const move = (ev: PointerEvent) => {
            const maxByDetail = Math.max(
              360,
              (parent?.clientWidth || 1280) - 360 - 16
            );
            splitListWidthPx = Math.min(
              Math.min(640, maxByDetail),
              Math.max(360, startW + (ev.clientX - startX))
            );
          };
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            void browser.storage.local.set({ splitListWidthPx });
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        }}
      ></button>
      <div
        data-splitview
        class="flex-1 overflow-hidden flex flex-col rounded-xl bg-md-surface"
        style="min-width: 360px;"
      >
        {#if selectedThread.length > 0}
        <MessageDetail
          onBack={() => {
            selectedThread = [];
          }}
          selectedThread={selectedThread}
          hasPrev={hasPrevMessage}
          hasNext={hasNextMessage}
          onPrev={navigateToPrevMessage}
          onNext={navigateToNextMessage}
          mailboxAddress={selectedEmail}
          showToolbarLabels={true}
          onMarkUnread={() => {
            for (const msg of selectedThread) {
              void persistEmailUnread(msg);
              const idx = emails.findIndex((e) => e.id === msg.id);
              if (idx !== -1) {
                emails = emails.map((e, i) => (i === idx ? { ...e, unread: true } : e));
              }
            }
            if (selectedEmail) {
              unreadByAddress = {
                ...unreadByAddress,
                [selectedEmail]:
                  (unreadByAddress[selectedEmail] ?? 0) + selectedThread.length,
              };
            }
            selectedThread = [];
          }}
          onArchive={() => {
            if (selectedThread.length === 0) return;
            void archiveSelectedEmails(selectedThread).then(() => {
              selectedThread = [];
            });
          }}
          onDelete={() => {
            if (selectedThread.length === 0) return;
            void deleteSelectedEmails(selectedThread).then(() => {
              selectedThread = [];
            });
          }}
        />
        {:else}
          <div class="flex-1 flex flex-col items-center justify-center px-6 text-center gap-3 bg-md-surface-container-low/40">
            <Icon name="mail" class="w-12 h-12 text-md-on-surface/20" />
            <div class="text-sm font-semibold text-md-on-surface/70">{$t('inbox.noMessageSelected')}</div>
            <p class="text-xs text-md-on-surface/45 max-w-xs leading-relaxed">{$t('inbox.splitEmptyHint')}</p>
            <ul class="text-xs text-md-on-surface/50 space-y-1.5 text-start max-w-xs mt-1">
              <li class="flex gap-2"><span class="text-md-primary font-bold">·</span>{$t('inbox.splitTipSelect')}</li>
              <li class="flex gap-2"><span class="text-md-primary font-bold">·</span>{$t('inbox.splitTipNavigate')}</li>
              <li class="flex gap-2"><span class="text-md-primary font-bold">·</span>{$t('inbox.splitTipSearch')}</li>
            </ul>
          </div>
        {/if}
      </div>
    {/if}
    </div>
  {/if}

  </div>
  {/key}

        <!-- Toasts are position:fixed; offline strip replaces header (above) -->
        <ToastContainer />

      <!-- Footer - hidden in wide sidebar layout -->
      {#if !layoutWide && (accounts.length > 0 || allInboxes.length > 0 || loadingInboxes)}
        {#if demoModeActive}
          <div class="absolute bottom-[calc(var(--footer-safe,72px)+0.5rem)] end-2 z-30 pointer-events-auto">
            <button
              type="button"
              class="px-3 py-1.5 rounded-full text-label-sm font-bold shadow-lg bg-md-error text-md-on-error hover:brightness-110 transition-all active:scale-95 flex items-center gap-1.5"
              onclick={async () => {
                const { exitDemoMode } = await import('@/features/demo/demo-mode.js');
                await exitDemoMode(browser);
                demoModeActive = false;
                await loadInboxes();
                showToast($t('preferences.demoModeDisabled'), 'info');
              }}
            >
              <Icon name="x" class="w-3.5 h-3.5" />
              {$t('preferences.exitDemoMode')}
            </button>
          </div>
        {/if}
        <Footer
          currentView={currentView}
          organizeTab={organizeTabValue}
          onNavigate={(view) => {
            accountSelectorDropdownOpen = false;
            currentView = view;
          }}
          {accounts}
          {unreadByAddress}
          loading={loading || loadingEmails}
          providerInstances={providerInstances}
          onCreateInboxWithProvider={handleCreateInboxWithProvider}
          onFabClick={(kind) => {
            if (kind === 'refresh') {
              const id =
                allInboxes.find((a) => a.address === selectedEmail)?.id ||
                accounts.find((a) => a.address === selectedEmail)?.id;
              if (id) void refreshInbox(id);
              else void refreshInbox();
            } else if (kind === 'createAddress') {
              openCreateInboxDialog();
            } else if (kind === 'createIdentity') {
              identityCreateSignal += 1;
              autofillTabValue = 'profiles';
              autofillTabSignal += 1;
              if (currentView !== 'autofill') currentView = 'autofill';
            } else if (kind === 'createTag') {
              tagCreateSignal += 1;
              organizeTabValue = 'tags';
              organizeTabSignal += 1;
              if (currentView !== 'organize') currentView = 'organize';
            } else if (kind === 'createLabel') {
              labelCreateSignal += 1;
              organizeTabValue = 'labels';
              organizeTabSignal += 1;
              if (currentView !== 'organize') currentView = 'organize';
            } else if (kind === 'createFilter') {
              organizeTabValue = 'filters';
              organizeTabSignal += 1;
              if (currentView !== 'organize') currentView = 'organize';
              // Filters are created from mailbox search; open filters tab for management
            } else if (kind === 'ghostLogin') {
              autofillTabValue = 'credentials';
              autofillTabSignal += 1;
              if (currentView !== 'autofill') currentView = 'autofill';
              savedLoginsFocusSignal += 1;
            } else if (kind === 'ghostExpand') {
              // Expand current message detail into full app tab
              void (async () => {
                try {
                  await browser.storage.local.set({
                    expandedAppState: {
                      currentView: 'messageDetail',
                      selectedEmail,
                      selectedThread,
                      createdAt: Date.now(),
                    },
                  });
                  const runtime = browser.runtime as unknown as {
                    getURL: (p: string) => string;
                  };
                  await browser.tabs.create({ url: runtime.getURL('/app.html') });
                } catch {
                  /* ignore */
                }
              })();
            } else if (kind === 'ghost') {
              try {
                document
                  .querySelector('.view-crossfade, .flex-1.min-h-0.overflow-y-auto, main')
                  ?.scrollTo?.({ top: 0, behavior: 'smooth' });
                window.scrollTo({ top: 0, behavior: 'smooth' });
              } catch {
                /* ignore */
              }
            }
          }}
        />
      {/if}
      </div><!-- content area -->
      </div><!-- main column (header/content/footer) -->
    </div><!-- shell -->
  </div><!-- outer -->

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
    onClose={() => { createInboxDialogOpen = false; pendingCreateProviderConfig = undefined; }}
    onCreate={handleCreateInbox}
    providerConfig={pendingCreateProviderConfig}
  />

  <ConfirmDialog
    {confirmDialog}
    bind:confirmDialogRef
    onClose={closeConfirm}
  />
  <!-- Tag dialog for non-split EmailDetail (full mainview) -->
  {#if emailDetailTagDialogOpen && !layoutSplit}
    <TagDialog
      open={emailDetailTagDialogOpen}
      currentTag={emailDetailTagTargets.length > 1 ? null : (emailDetailTagTarget?.tag ?? null)}
      currentTagColor={emailDetailTagTargets.length > 1 ? null : (emailDetailTagTarget?.tagColor ?? null)}
      existingTags={allExistingTags}
      tagColors={allTagColors}
      onClose={closeEmailDetailTagDialog}
      onSave={saveEmailDetailTag}
      portal={true}
    />
  {/if}

  <CommandPalette bind:open={commandPaletteOpen} commands={paletteCommands} />

  <!-- Keyboard Shortcuts Cheat Sheet Overlay -->
  <KeyboardShortcutsCheatSheet
    open={cheatSheetOpen}
    keybindings={keybindings}
    onClose={() => (cheatSheetOpen = false)}
  />

  <!-- Interactive Export & Backup Wizard (email formats) -->
  <ExportWizardDialog
    open={exportWizardOpen}
    account={exportWizardAccount}
    messages={exportWizardMessages}
    onClose={() => (exportWizardOpen = false)}
    onExecuteExport={handleExecuteExport}
  />

  <!-- Interactive product tour (spotlight) -->
  <ProductTour
    open={productTourOpen}
    steps={PRODUCT_TOUR_STEPS}
    currentView={currentView}
    onNavigate={async (view) => {
      currentView = view;
    }}
    onComplete={() => {
      void finishProductTour();
    }}
    onSkip={() => {
      void skipProductTour();
    }}
  />

  <!-- Full extension backup export/import -->
  <ExportBackupDialog
    open={showExportBackupDialog}
    onClose={() => (showExportBackupDialog = false)}
    onSuccess={(msg) => showToast(msg || $t('toasts.dataExportedSuccessfully'))}
    onError={(msg) => showToast(msg || $t('toasts.exportFailed'), 'error')}
  />
  <ImportBackupDialog
    open={showImportBackupDialog}
    onClose={() => (showImportBackupDialog = false)}
    loadInboxes={async () => {
      await loadInboxes();
      try {
        await loadSettings();
      } catch {
        /* ignore */
      }
      try {
        await loadLoginInfo();
      } catch {
        /* ignore */
      }
    }}
    onSuccess={(summary, result) => {
      showToast(summary || $t('toasts.dataImportedSuccessfully'));
      void loadInboxes();
      void loadSettings().catch(() => {});
      void loadLoginInfo().catch(() => {});
      if (result && result.renewableExpiredImported > 0) {
        setTimeout(() => {
          showToast(
            $t('backup.renewableExpiredImportedToast', {
              values: { n: result.renewableExpiredImported },
            }),
            'info'
          );
        }, 500);
      }
    }}
    onError={(msg) => showToast(msg || $t('toasts.importFailed'), 'error')}
  />
  {#if activeTooltip}
    <div
      bind:this={tooltipRef}
      class="fixed z-[100000] px-2 py-1 rounded-md text-xs font-medium bg-md-inverse-surface text-md-inverse-on-surface shadow-md pointer-events-none transition-opacity duration-150 opacity-0 max-w-[min(280px,90vw)] whitespace-normal break-all text-center leading-snug"
    >
      {activeTooltip.text}
    </div>
  {/if}
</ErrorBoundary>
