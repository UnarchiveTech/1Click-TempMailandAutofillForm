<script lang="ts">
import { onDestroy, onMount, tick, untrack } from 'svelte';
import { get } from 'svelte/store';
import { locale, t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import ShortcutDiscovery from '@/ui/blocks/overlays/ShortcutDiscovery.svelte';
import ModalDialog from '@/ui/components/composites/ModalDialog.svelte';
import Btn from '@/ui/components/primitives/Btn.svelte';
// Bootstrap svelte-i18n (register locales + preferred language)
import '@/utils/i18n/i18n.js';

// --- Context prop: 'popup' | 'sidepanel' | 'app' ---
let { context = 'popup' }: { context?: 'popup' | 'sidepanel' | 'app' } = $props();

import {
  autofillForm as autofillFormAction,
  flushQueuedEmailReadState,
  queueEmailReadState,
} from '@/features/address/address-actions.js';
import {
  archiveSelected as archiveSelectedAction,
  type BulkActionsSetters,
  deleteSelected as deleteSelectedAction,
  exportSelected as exportSelectedAction,
  toggleSelect as toggleSelectAction,
  toggleSelectAll as toggleSelectAllAction,
  unarchiveSelected as unarchiveSelectedAction,
} from '@/features/address/address-bulk-actions.js';
import {
  archiveSelected as archiveSelectedAddresses,
  deleteAddressesDirect as deleteAddressesDirectBulk,
  reorderAddressesById as reorderAddressesByIdBulk,
  toggleAutoExtend as toggleAutoExtendBulk,
  toggleSelect as toggleSelectAddressBulk,
  toggleSelectAll as toggleSelectAllAddresses,
  unarchiveSelected as unarchiveSelectedAddresses,
} from '@/features/address/address-bulk-ui.js';
import {
  createAddress as createAddressModule,
  handleCreateAddressResult,
  handleCreateAddressWithProvider as handleCreateWithProvider,
  openCreateAddressDialog as openCreateDialog,
} from '@/features/address/address-creator.js';
import { createAddressDetailOperations } from '@/features/address/address-detail-operations.js';
import {
  archiveSingleAddress,
  extendSingleAddress,
  removeSingleAddress,
  restoreSingleAddress,
  unarchiveSingleAddress,
} from '@/features/address/address-lifecycle.js';
import {
  applyAutoRenewToAll as applyAutoRenewToAllAction,
  type ManagementSetters,
  toggleAutoExtend as toggleAutoExtendAction,
} from '@/features/address/address-management.js';
import {
  archiveSelectedEmails as archiveSelectedEmailsAction,
  deleteSelectedEmails as deleteSelectedEmailsAction,
  restoreSelectedEmails as restoreSelectedEmailsAction,
} from '@/features/address/email-bulk-ui.js';
import { createEmailSyncController } from '@/features/address/email-sync.js';
import { exportEmailsWithFormat as exportEmailsWithFormatAction } from '@/features/address/inbox-export.js';
import { createMailboxFilterState } from '@/features/address/mailbox-filter-state.svelte.js';
import {
  markOtpEmailRead as markOtpEmailReadAction,
  persistEmailRead as persistEmailReadAction,
  persistEmailUnread as persistEmailUnreadAction,
  projectStoredEmailMetadata,
  refreshUnreadCounts as refreshUnreadCountsAction,
  resolveUnreadBadgeKey,
} from '@/features/address/mailbox-read-state.js';
import {
  type MessageTabsState,
  messageTabKey,
  openMessageTab,
  rememberMessageScroll,
  removeMessageTabs,
} from '@/features/address/message-tabs.js';
import { evaluateProviderFailoverAfterRefresh as evaluateProviderFailoverAction } from '@/features/address/provider-failover.js';
import { createSearchFilterController } from '@/features/address/search-filter-controller.js';
import { useAddressActions } from '@/features/address/use-address-actions.js';
import { observeDialogVisits } from '@/features/analytics/dialog-visit-observer.js';
import type { useAnalyticsActions } from '@/features/analytics/use-analytics-actions.js';
import { trackVisit as trackVisitAction } from '@/features/analytics/visit-tracker.js';
import {
  type ArchivedSetters,
  deleteArchivedEmail as deleteArchivedEmailAction,
  restoreArchivedAddress as restoreArchivedAddressAction,
} from '@/features/archived-mail/archived-actions.js';
import {
  cancelTopEscapeTier,
  registerEscapeTier,
} from '@/features/keyboard-shortcuts/escape-stack.js';
import {
  deleteLoginById as deleteLoginByIdAction,
  loadLoginInfo as loadLoginInfoAction,
  reorderLoginInfoById as reorderLoginInfoByIdAction,
} from '@/features/login-info/login-actions.js';
import { createAppStateRestoreController } from '@/features/navigation/app-state-restore.js';
import { createFormDetectionController } from '@/features/navigation/form-detection-controller.js';
import { createNavbarPreferencesController } from '@/features/navigation/navbar-preferences.js';
import { handlePrintIntent as handlePrintIntentFn } from '@/features/navigation/print-intent.js';
import {
  isReloadablePageUrl,
  normalizeReloadRequiredTabIds,
  RELOAD_REQUIRED_TAB_IDS_KEY,
} from '@/features/navigation/reload-required-tabs.js';
import { applyOpenViewHandoff as applyOpenViewHandoffFn } from '@/features/navigation/view-handoff.js';
import {
  clearPendingProductTour,
  isPendingProductTour,
  isProductTourCompleted,
} from '@/features/product-tour/tour-storage.js';
import {
  closeQrDialog as closeQrDialogAction,
  copyQrImage as copyQrImageAction,
  downloadQrCode as downloadQrCodeAction,
  openQrDialog as openQrDialogAction,
} from '@/features/qr/qr-actions.js';
import {
  getAddressColor as getAddressColorAction,
  updateAddressColors,
} from '@/features/settings/address-color.js';
import {
  addToAutofillBlocklistSetting as addToAutofillBlocklistSettingAction,
  removeFromAutofillBlocklistSetting,
  toggleAutofillBlocklistSetting as toggleAutofillBlocklistSettingAction,
} from '@/features/settings/blocklist-settings.js';
import {
  changePageZoom as changeStoredPageZoom,
  getPageZoomSetting,
  normalizePageZoomScale,
  normalizePageZoomSettings,
  type PageZoomDirection,
  type PageZoomSettings,
  updatePageZoomSetting,
} from '@/features/settings/page-zoom.js';
import {
  finishProductTour as finishProductTourAction,
  skipProductTour as skipProductTourAction,
  startProductTour as startProductTourAction,
} from '@/features/settings/product-tour.js';
import { flushPendingSettingsWrites } from '@/features/settings/settings-actions.js';
import {
  createSettingsController,
  type SettingsState,
} from '@/features/settings/settings-controller.js';
import { createSettingsState } from '@/features/settings/settings-state.svelte.js';
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
  TOAST_SYNC_KEYS,
  useExtensionStorageSync,
} from '@/features/settings/use-extension-storage-sync.js';
import { applyCustomColor } from '@/features/theme/theme-actions.js';
import { type ActivityViewId, isView, type View } from '@/features/types/view-types.js';
import type { ToastType } from '@/ui/blocks/feedback/toast-types.js';
import AppShell from '@/ui/blocks/layout/AppShell.svelte';
import ErrorBoundary from '@/ui/blocks/layout/ErrorBoundary.svelte';
import { layoutStore } from '@/ui/blocks/layout/layout-store.svelte.js';
import { headerBackTarget } from '@/ui/blocks/layout/navigation-helpers.js';
import { createAddressTagsController } from '@/ui/blocks/layout/use-address-tags.svelte.js';
import { useConfirmDialog } from '@/ui/blocks/layout/use-confirm-dialog.svelte.js';
import { createKeyboardTooltipController } from '@/ui/blocks/layout/use-keyboard-tooltip.svelte.js';
import { createLayoutMeasurementController } from '@/ui/blocks/layout/use-layout-measurement.svelte.js';
import {
  createLayoutOverlays,
  type OverlayState,
} from '@/ui/blocks/layout/use-layout-overlays.svelte.js';
import { createRetentionCleanup } from '@/ui/blocks/layout/use-retention-cleanup.js';
import {
  createThemeController,
  restoreThemeFromStorage,
} from '@/ui/blocks/layout/use-theme.svelte.js';
import { showToast as showToastAction } from '@/ui/blocks/layout/use-toast.js';
import type { PaletteCommand } from '@/ui/blocks/overlays/palette-command-types.js';
import type { KnownIconName } from '@/ui/components/icons/icon-names.js';
import { buildTagAddressUsage, existingTagNames } from '@/utils/address/address-tags.js';
import { copyToClipboardAndSchedulePurge } from '@/utils/clipboard/clipboard.js';
import {
  findEmailBodyHost,
  resetEmailBodyZoom,
  stepEmailBodyZoom,
} from '@/utils/email/email-body-zoom.js';
import {
  loadProviderOverridesFromStorage,
  type ProviderConfig,
} from '@/utils/email/email-service.js';
import { groupEmailsByThread } from '@/utils/email/email-threads.js';
import { pluralMessage } from '@/utils/i18n/i18n-plural.js';
import { createTranslator, preloadTranslations, setCachedLocale } from '@/utils/i18n/i18n-utils.js';
import { logDebug, logError } from '@/utils/logger.js';
import { recordConnectivityEvent } from '@/utils/provider/connectivity-log.js';
import { DEFAULT_PRE_EXPIRY_WINDOW_MINUTES } from '@/utils/provider/provider-expiry.js';
import { emailLabelsStore } from '@/utils/storage/email-labels-store.js';
import {
  DEFAULT_SIDEBAR_POSITION,
  getAutofillBlocklist,
  getAutoRefreshInterval,
  normalizeSidebarPosition,
  resolveBagKey,
  type SidebarPosition,
  setAddresses,
  type UiDensity,
} from '@/utils/storage/storage-keys.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import type {
  Address,
  CredentialsHistoryItem,
  Email,
  EmailPreviewMode,
  Identity,
  Keybindings,
  ProviderInstance,
  SavedSearchFilter,
} from '@/utils/types.js';
import { DEFAULT_KEYBINDINGS } from '@/utils/types.js';
import { parentNavKey } from '@/utils/ui/nav-layout.js';
import { observeResizeOnFrame } from '@/utils/ui/resize-observer.js';
import { observeScrollGutters } from '@/utils/ui/scroll-gutters.js';
import { activeSelectionStore } from '@/utils/ui/selection-registry.js';
import { toastStore } from '@/utils/ui/toastStore.js';

// Cross-browser API (polyfill provides browser, chrome as fallback)
const ext = browser;
/** Shared translator (flat interpolation vars → svelte-i18n values). */
const translate = createTranslator();
// Version comes from the manifest - identical to package.json (wxt.config.ts
// derives the manifest from it) without inlining the whole package.json
// (keywords, devDependencies, …) into every entrypoint's shell chunk.
let version = $state<string>(browser.runtime.getManifest().version);

// --- View state ---
let currentView = $state<View>('mailbox');
let reloadRequiredTabId = $state<number | null>(null);

/**
 * Re-measure the translated nav labels (nav stage state lives in
 * layout-store.svelte.ts). Triggered here on mount + locale change because
 * svelte-i18n initializes asynchronously.
 */
$effect(() => {
  void $locale;
  void $t;
  void tick().then(() => {
    layoutStore.refreshNavLabelWidths();
  });
});

/**
 * Keep the window / tab title localized. The static `<title>` in each
 * entrypoint's index.html is only the pre-hydration fallback: Chrome
 * substitutes `__MSG_*__` in the manifest and CSS but never in HTML, so the
 * title has to be assigned at runtime. It uses the same
 * `actionTitle.tempMailAndAutofill` key as the toolbar tooltip, which is also
 * what `__MSG_extName__` carries, so the tab, the toolbar and
 * chrome://extensions can't disagree. One effect covers popup, sidepanel and
 * app because all three mount this shared shell.
 */
$effect(() => {
  if (typeof document !== 'undefined') {
    document.title = $t('actionTitle.tempMailAndAutofill') as string;
  }
});
/** Pre-applied filters when navigating from EmailDetail (mailbox detail) */
let loginInfoEmailFilter = $state('');
let identitiesEmailFilter = $state('');
/** Footer FAB → open create UI on target views (increment to trigger) */
let identityCreateSignal = $state(0);
let identityEditIdSignal = $state('');
let vaultLockSignal = $state(0);
let tagCreateSignal = $state(0);
let labelCreateSignal = $state(0);
let splitHostRef = $state<HTMLElement | null>(null);
const formDetectionController = createFormDetectionController({
  ext,
  setDetected: (detected) => (formDetected = detected),
  setVerificationRequired: (required) => (humanVerificationRequired = required),
});

const layoutMeasurementController = createLayoutMeasurementController({
  getContext: () => context,
  getRootElement: () => layoutRootEl,
  getLayoutWide: () => layoutWide,
  getLayoutSplit: () => layoutSplit,
  getCurrentView: () => currentView,
  getSelectedThreadLength: () => selectedThread.length,
  getCurrentEmailDetail: () => currentEmailDetail,
  getSplitSecondaryView: () => splitSecondaryView,
  setLayoutWide: (value) => (layoutWide = value),
  setNavShellWidth: (value) => layoutStore.setNavShellWidth(value),
  setLayoutSplit: (value) => (layoutSplit = value),
  setSplitModeFlash: (value) => (splitModeFlash = value),
  setCurrentView: (value) => (currentView = value),
  setSplitSecondaryView: (value) => (splitSecondaryView = value),
  setSplitPaneCollapsed: (value) => (splitPaneCollapsed = value),
  setSplitListWidthPx: (value) => (splitListWidthPx = value),
  setUiDensity: (value: UiDensity) => (uiDensity = value),
  getSplitPaneCollapsed: () => splitPaneCollapsed,
});
/** Organize hub tab deep-link */
let organizeTabSignal = $state(0);
let organizeTabValue = $state<'tags' | 'labels' | 'filters'>('tags');
let autofillTabSignal = $state(0);
let autofillTabValue = $state<'profiles' | 'credentials' | 'sites'>('profiles');
let paletteWebsiteFilter = $state('');
let paletteWebsiteFilterSignal = $state(0);
let settingsSubpage = $state<string | null>(null);
let previousViewBeforeSubpage = $state<View | null>(null);

function handleLongPressNavbar() {
  if (currentView === 'settings' && settingsSubpage === 'navbarOrder') return;
  previousViewBeforeSubpage = currentView;
  currentView = 'settings';
  settingsSubpage = 'navbarOrder';
}

function handleSettingsSubpageBack() {
  settingsSubpage = null;
  if (previousViewBeforeSubpage && previousViewBeforeSubpage !== 'settings') {
    currentView = previousViewBeforeSubpage;
    previousViewBeforeSubpage = null;
  }
}

let bottomFloatingLayerEl = $state<HTMLElement | null>(null);
let bottomSafeAreaPx = $state(40);
/** Temporarily hides bottom strips and the floating Footer/FAB while a list scrolls. */
let scrollChromeHidden = $state(false);
let scrollChromeTimer: ReturnType<typeof setTimeout> | null = null;

function handleScrollDirection(_direction: 'up' | 'down', atTop = false) {
  if (scrollChromeTimer) {
    clearTimeout(scrollChromeTimer);
    scrollChromeTimer = null;
  }
  if (atTop) {
    scrollChromeHidden = false;
    return;
  }
  scrollChromeHidden = true;
  // Reveal shortly after scrolling stops; do not leave controls inaccessible.
  scrollChromeTimer = setTimeout(() => {
    scrollChromeHidden = false;
    scrollChromeTimer = null;
  }, 180);
}

$effect(() => {
  void currentView;
  if (scrollChromeTimer) {
    clearTimeout(scrollChromeTimer);
    scrollChromeTimer = null;
  }
  scrollChromeHidden = false;
});

/**
 * Header back ONLY on these deep sub-pages (not mailbox, not settings hub,
 * not manage/identities/activity/logins/analytics - those use footer nav).
 */
const HEADER_BACK_VIEWS = new Set<View>([
  'mailView',
  'addressView',
  'tagManagement',
  'labelManagement',
  'mailProvider',
  'keybindings',
  'filtersManagement',
  'constantsSettings',
  'diagnostics',
  'storagePerformance',
  'addressAccentColors',
  // organize is a primary More destination - no back
]);

const showHeaderBack = $derived(HEADER_BACK_VIEWS.has(currentView));
/** Full-page detail views already provide their own toolbar and Header back action. */
const hideFloatingFooterForDetail = $derived(
  currentView === 'mailView' || currentView === 'addressView'
);
const contentBottomSafeAreaPx = $derived(hideFloatingFooterForDetail ? 0 : bottomSafeAreaPx);

/** Shared adaptive nav layout - single source of truth (layout-store). */
const navLayout = $derived(layoutStore.navLayout);

/** Canonical primary key for the current view (deep links → parent page). */
const currentNavKey = $derived(parentNavKey(currentView));
/** True when the current page lives inside the More menu (header shows its title). */
const isMoreOnlyPage = $derived(navLayout.moreViewSet.has(currentNavKey));
/** Header title of the More-only page - derived from the live nav layout, never hardcoded. */
const headerPageTitle = $derived.by(() => {
  if (!isMoreOnlyPage) return '';
  const item = navLayout.moreItems.find((m) => m.view === currentNavKey);
  return item ? ($t(item.labelKey) as string) : '';
});
const headerPageIcon = $derived.by((): KnownIconName | undefined => {
  if (!isMoreOnlyPage) return undefined;
  return navLayout.moreItems.find((m) => m.view === currentNavKey)?.iconName;
});

function handleHeaderBack() {
  const viewBeforeBack = currentView;
  currentView = headerBackTarget(viewBeforeBack);
  if (viewBeforeBack === 'mailView') {
    selectedThread = [];
  } else if (viewBeforeBack === 'addressView') {
    currentEmailDetail = null;
  }
}

// --- Main view ---
let selectedEmail = $state<string>('');
let qrDialogEmail = $state<string | null>(null);
/** Sender of the email whose “Create rule” action launched Automation this time. */
let automationInitialSender = $state('');
let displayedEmail = $state<string>('');
let dropdownOpen = $state<boolean>(false);
let accountSelectorDropdownOpen = $state<boolean>(false);
let archivedSectionOpen = $state<'active' | 'archived' | 'expired' | null>(null);
const mailboxFilters = createMailboxFilterState({
  emailLabelsById: () => emailLabelsById,
});
const {
  searchQuery,
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
} = $derived(mailboxFilters);
let loading = $state<boolean>(false);
let loadingAddresses = $state<boolean>(false);
let loadingEmails = $state<boolean>(false);
let accounts = $state<Address[]>([]);
let allAddresses = $state<Address[]>([]); // Includes archived addresses for management view
let emails = $state<Email[]>([]);
let threadGroupingSetting = $state<boolean>(false);
let showQuotaBanner = $state<boolean>(false);

let unreadByAddress = $state<Record<string, number>>({});
let allStoredEmails = $state<Record<string, Email[]>>({});
let latestOtp = $state<string>('------');
let latestOtpSender = $state<string>('');
let latestOtpSenderName = $state<string>('');
let otpContext = $state<string>('');
const settingsDomain = createSettingsState();
const settings = settingsDomain.state;
const settingsDomainSetters = settingsDomain.setters;
const overlaysDomain = createLayoutOverlays();
const overlays = overlaysDomain.state;
const cleanupOverlayTimers = overlaysDomain.cleanup;
const overlaySetters = overlaysDomain.setters;
let autofillBlocklist = $state<string[]>([]);
let isOffline = $state(!navigator.onLine);
let offlineDismissed = $state(false);
let connectivityHeartbeat: ReturnType<typeof setInterval> | null = null;

let savedSearchFilters = $state<SavedSearchFilter[]>([]);
/** True after the first address load has resolved, so an empty list is known to be real. */
let addressBootstrapReady = $state(false);

/** True while the empty shell shows onboarding (no sidebar / footer / logo nav). */
const isOnboardingShell = $derived(
  !addressBootstrapReady ||
    (accounts.length === 0 && !loadingAddresses && allAddresses.length === 0)
);

onMount(() => {
  function updateOnlineStatus() {
    const offline = typeof navigator !== 'undefined' ? !navigator.onLine : false;
    isOffline = offline;
    offlineDismissed = false;
    // Record the transition so MailboxView can label offline gaps (UTC).
    void recordConnectivityEvent(offline ? 'offline' : 'online');
  }
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  // Heartbeat while online so the "last active internet" timestamp stays fresh
  // even if no offline/online transition fires (e.g. browser open for hours).
  connectivityHeartbeat = setInterval(() => {
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      void recordConnectivityEvent('online');
    }
  }, 60000);
  return () => {
    window.removeEventListener('online', updateOnlineStatus);
    window.removeEventListener('offline', updateOnlineStatus);
    if (connectivityHeartbeat) clearInterval(connectivityHeartbeat);
    cleanupOverlayTimers();
  };
});
let formDetected = $state<boolean>(false);
let humanVerificationRequired = $state(false);

// --- Retention cleanup prompt ---
let retentionCleanupDismissed = $state(false);
let oldEmailCount = $state(0);

const retentionCleanup = createRetentionCleanup(
  ext,
  (patch) => {
    if (patch.oldEmailCount !== undefined) oldEmailCount = patch.oldEmailCount;
    if (patch.retentionCleanupDismissed !== undefined) {
      retentionCleanupDismissed = patch.retentionCleanupDismissed;
    }
  },
  translate,
  () => stableLoadAddresses(true)
);
const checkRetentionCleanup = retentionCleanup.checkRetentionCleanup;
const dismissRetentionCleanup = retentionCleanup.dismissRetentionCleanup;
const cleanupOldEmailsNow = retentionCleanup.cleanupOldEmailsNow;
const handleRequestQuotaUnlimitedStorage = async () => {
  showQuotaBanner = false;
  await retentionCleanup.handleRequestQuotaUnlimitedStorage();
};
const dismissQuotaBanner = () => {
  showQuotaBanner = false;
  retentionCleanup.dismissQuotaBanner();
};

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

// Load identities once on mount (not a reactive $effect - avoids re-entry loops)
onMount(() => {
  void loadIdentities();
});

// Keep navbar preferences synchronized with the shared layout store.
const navbarPreferencesController = createNavbarPreferencesController({
  ext: browser,
  setCustomNavOrder: (value) => layoutStore.setCustomNavOrder(value),
  setMinPrimaryItems: (value) => layoutStore.setMinPrimaryItems(value),
  setAutoArrangeMore: (value) => layoutStore.setAutoArrangeMore(value),
  setNavIndicatorModes: (value) => {
    layoutStore.setNavIndicatorModes(value);
    layoutStore.refreshNavLabelWidths();
  },
});

onMount(() => {
  let cleanup: (() => void) | undefined;
  void navbarPreferencesController.start().then((stop) => {
    cleanup = stop;
  });
  return () => cleanup?.();
});

// Load login info when opening Autofill hub / credentials
$effect(() => {
  if (currentView === 'loginInfo' || currentView === 'autofill' || currentView === 'identities') {
    loadLoginInfo();
  }
});

// Track page visits for Activity stats (plain let - never $state read+write in one effect)
let lastTrackedView: ActivityViewId | null = null;
const trackVisit = (key: ActivityViewId) => trackVisitAction(key);
$effect(() => {
  const view = currentView;
  if (!view || view === lastTrackedView) return;
  lastTrackedView = view;
  void trackVisit(view);
});
// Observe dialog roots across the whole document, including view-owned and
// body-portaled surfaces. Dialog components provide a stable category when
// they have one; the observer counts unclassified dialogs as `dialog:other`.
onMount(() => observeDialogVisits());
onMount(() => observeScrollGutters(document.body));

onMount(() => {
  let disposed = false;
  let refreshGeneration = 0;

  const refreshReloadRequiredTab = async () => {
    const generation = ++refreshGeneration;
    try {
      const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id === undefined || !isReloadablePageUrl(activeTab.url)) {
        if (!disposed && generation === refreshGeneration) reloadRequiredTabId = null;
        return;
      }

      const stored = (await browser.storage.session.get(RELOAD_REQUIRED_TAB_IDS_KEY)) as Record<
        string,
        unknown
      >;
      if (!disposed && generation === refreshGeneration) {
        reloadRequiredTabId = normalizeReloadRequiredTabIds(
          stored[RELOAD_REQUIRED_TAB_IDS_KEY]
        ).includes(activeTab.id)
          ? activeTab.id
          : null;
      }
    } catch (error) {
      if (!disposed && generation === refreshGeneration) reloadRequiredTabId = null;
      logError('Failed to read the active tab reload requirement', error);
    }
  };

  const onTabActivated = () => void refreshReloadRequiredTab();
  const onTabUpdated = (_tabId: number, changeInfo: { status?: string; url?: string }) => {
    if (changeInfo.status === 'complete' || changeInfo.url) {
      void refreshReloadRequiredTab();
    }
  };
  const onStorageChanged = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
    if (areaName === 'session' && changes[RELOAD_REQUIRED_TAB_IDS_KEY]) {
      void refreshReloadRequiredTab();
    }
  };

  browser.tabs.onActivated.addListener(onTabActivated);
  browser.tabs.onUpdated.addListener(onTabUpdated);
  browser.storage.onChanged.addListener(onStorageChanged);
  void refreshReloadRequiredTab();

  return () => {
    disposed = true;
    browser.tabs.onActivated.removeListener(onTabActivated);
    browser.tabs.onUpdated.removeListener(onTabUpdated);
    browser.storage.onChanged.removeListener(onStorageChanged);
  };
});

// --- Toast notifications ---
const showToast = showToastAction;

async function reloadContentTab(): Promise<void> {
  const tabId = reloadRequiredTabId;
  if (tabId === null) return;
  try {
    await browser.tabs.reload(tabId);
  } catch (error) {
    logError('Failed to reload the active tab after an extension update', error);
    showToast(translate('inbox.staleContentReloadFailed'), 'error');
  }
}

// --- Confirmation dialog ---
const confirmController = useConfirmDialog();
const showConfirm = confirmController.showConfirm;
const closeConfirm = confirmController.closeConfirm;
const confirmDialog = $derived(confirmController.confirmDialog);

// --- Filtered emails ---
/** Labels for mailbox search (synced from storage) */
let emailLabelsById = $state<Record<string, string[]>>({});
$effect(() => {
  return emailLabelsStore.subscribe((map) => {
    emailLabelsById = map;
  });
});

const applySearchQuery = mailboxFilters.applySearchQuery;
let filteredEmails = $derived.by(() => mailboxFilters.filteredEmails(emails));

let activeNavigationList = $derived.by(() => {
  if (threadGroupingSetting) {
    return groupEmailsByThread(filteredEmails);
  }
  return filteredEmails.map((e) => ({ id: e.id, emails: [e] }));
});

let currentNavigationIndex = $derived.by(() => {
  if (selectedThread.length === 0) return -1;
  const currentKey = messageTabKey(selectedThread, selectedEmail);
  return activeNavigationList.findIndex((item) =>
    item.emails.some((email) => messageTabKey([email], selectedEmail) === currentKey)
  );
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

// --- Stable wrapper that always delegates to the current loadAddressesFn ---
let loadAddressesFn: (skipEmailSelection: boolean | undefined) => Promise<void> = async () => {};
const stableLoadAddresses = (skipEmailSelection: boolean | undefined = undefined) =>
  loadAddressesFn(skipEmailSelection);

// --- Common setters using composable ---
const { addressSetters, themeSetters, qrSetters, exportSetters, loginSetters } = useCommonSetters({
  // Inbox
  setAddresses: (v) => {
    accounts = typeof v === 'function' ? (v as (prev: Address[]) => Address[])(accounts) : v;
  },
  setAllAddresses: (v) => {
    allAddresses =
      typeof v === 'function' ? (v as (prev: Address[]) => Address[])(allAddresses) : v;
  },
  setEmails: (v) => {
    emails = typeof v === 'function' ? (v as (prev: Email[]) => Email[])(emails) : v;
  },
  setLatestOtp: (v) => (latestOtp = v),
  setLatestOtpSender: (v) => (latestOtpSender = v),
  setLatestOtpSenderName: (v) => (latestOtpSenderName = v),
  setOtpContext: (v) => (otpContext = v),
  setSelectedEmail: (v) => (selectedEmail = v),
  setLoading: (v) => (loading = v),
  setLoadingAddresses: (v) => (loadingAddresses = v),
  setLoadingEmails: (v) => (loadingEmails = v),
  setNotificationsEnabled: (v) => settingsDomainSetters.setNotificationsEnabled(v),
  setSoundEnabled: (v) => settingsDomainSetters.setSoundEnabled(v),
  setExpiryWarningThreshold: (v) => settingsDomainSetters.setExpiryWarningThreshold(v),
  setKeybindings: (v) => settingsDomainSetters.setKeybindings(v),
  setAutoRefreshInterval: (v: number) => settingsDomainSetters.setAutoRefreshInterval(v),
  setEmailPreviewMode: (v: EmailPreviewMode) => settingsDomainSetters.setEmailPreviewMode(v),
  setDefaultDomain: (v: string) => settingsDomainSetters.setDefaultDomain(v),
  // Settings
  setAutoCopy: (v) => settingsDomainSetters.setAutoCopy(v),
  setAutoRenew: (v) => settingsDomainSetters.setAutoRenew(v),
  setAutoRenewScope: (v) => settingsDomainSetters.setAutoRenewScope(v),
  setAutoRenewWindowMinutes: (v) => settingsDomainSetters.setAutoRenewWindowMinutes(v),
  setSelectedProvider: (v) => settingsDomainSetters.setSelectedProvider(v),
  setProviderInstances: (v) => settingsDomainSetters.setProviderInstances(v),
  setSelectedProviderInstance: (v) => settingsDomainSetters.setSelectedProviderInstance(v),
  setCustomColor: (v) => settingsDomainSetters.setCustomColor(v),
  setGlobalZoomEnabled: (v) => settingsDomainSetters.setGlobalZoomEnabled(v),
  setShowDeveloperSettings: (v) => settingsDomainSetters.setShowDeveloperSettings(v),
  setEnableLogging: (v) => settingsDomainSetters.setEnableLogging(v),
  setSavingSettings: (v) => settingsDomainSetters.setSavingSettings(v),
  setSettingsLoading: (v) => settingsDomainSetters.setSettingsLoading(v),
  setEmailRetentionDays: (v) => settingsDomainSetters.setEmailRetentionDays(v),
  setFaviconCaching: (v) => settingsDomainSetters.setFaviconCaching(v),
  // Theme
  setThemeMode: (v: ThemeMode) => (themeMode = v),
  setContrastLevel: (v: ContrastLevel) => (contrastLevel = v),
  // QR
  setQrDialogOpen: (open) => overlaySetters.setQrDialogOpen(open),
  setQrCanvas: (canvas) => overlaySetters.setQrCanvas(canvas),
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
  loadAddresses: stableLoadAddresses,
  confirmAsync: (message: string) =>
    new Promise<boolean>((resolve) => {
      showConfirm(
        message,
        () => {
          closeConfirm();
          resolve(true);
        },
        {
          secondaryLabel: get(t)('common.cancel'),
          onSecondary: () => {
            closeConfirm();
            resolve(false);
          },
        }
      );
    }),
});

const settingsController = createSettingsController(ext, {
  ...settingsDomainSetters,
  setShowToast: (message, type) => showToast(message, type),
  loadAddresses: stableLoadAddresses,
});

const settingsState = (): SettingsState => ({
  autoCopy: settings.autoCopy,
  autoRenew: settings.autoRenew,
  autoRenewScope: settings.autoRenewScope,
  autoRenewWindowMinutes: settings.autoRenewWindowMinutes,
  selectedProvider: settings.selectedProvider,
  providerInstances: settings.providerInstances,
  selectedProviderInstance: settings.selectedProviderInstance,
  customColor: settings.customColor,
  globalZoomEnabled: settings.globalZoomEnabled,
  showDeveloperSettings: settings.showDeveloperSettings,
  enableLogging: settings.enableLogging,
  savingSettings: settings.savingSettings,
  settingsLoading: settings.settingsLoading,
  emailRetentionDays: settings.emailRetentionDays,
  faviconCaching: settings.faviconCaching,
  notificationsEnabled: settings.notificationsEnabled,
  soundEnabled: settings.soundEnabled,
  expiryWarningThreshold: settings.expiryWarningThreshold,
  keybindings: settings.keybindings,
  autoRefreshInterval: settings.autoRefreshInterval,
  emailPreviewMode: settings.emailPreviewMode,
  defaultDomain: settings.defaultDomain,
});

const bulkActionsSetters: BulkActionsSetters = {
  setSelectedAddresses: (addresses) => (selectedAddresses = addresses),
  setShowToast: (message, type, undoAction) => showToast(message, type, undoAction),
  loadAddresses: stableLoadAddresses,
  showConfirm: (message, onConfirm, options) => showConfirm(message, onConfirm, options),
  closeConfirm: () => closeConfirm(),
};

const managementSetters: ManagementSetters = {
  setSelectedEmail: (email) => (selectedEmail = email),
  setEmails: (v) => (emails = v),
  setLoading: (v) => (loading = v),
  setShowToast: (message, type, undoAction) => showToast(message, type, undoAction),
  loadAddresses: stableLoadAddresses,
  selectAddress: async (address) => {
    await selectAddress(address);
  },
  setDropdownOpen: (open) => (accountSelectorDropdownOpen = open),
  setArchivedSectionOpen: async (open) => {
    archivedSectionOpen = open ? 'archived' : null;
    accountSelectorDropdownOpen = open;
  },
  showOnboarding: () => {
    // Navigate to mailbox view (which shows onboarding when accounts.length === 0)
    currentView = 'mailbox';
  },
  setAllAddresses: (v) => {
    allAddresses =
      typeof v === 'function' ? (v as (prev: Address[]) => Address[])(allAddresses) : v;
  },
};

const archivedSetters: ArchivedSetters = {
  setArchivedEmails: (emails) => (archivedEmails = emails),
  setShowToast: (message, type) => showToast(message, type),
  loadAddresses: stableLoadAddresses,
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
let currentEmailDetail = $state<Address | null>(null);

// --- AddressView tag dialog (AppLayout-level, works from any view) ---
let addressViewTagDialogOpen = $state(false);
let addressViewTagTarget = $state<Address | null>(null);

let allExistingTags = $derived(existingTagNames(allAddresses));
// Which addresses carry each tag: the hover info on every existing tag in the
// tag dialog.
let allTagAddresses = $derived(buildTagAddressUsage(allAddresses));
let allTagColors = $derived.by(() => {
  const c: Record<string, string> = {};
  for (const a of allAddresses) {
    if (Array.isArray(a.tags) && a.tags.length) {
      for (const t of a.tags) if (t?.name && t.color) c[t.name] = t.color;
    } else if (a.tag && a.tagColor) c[a.tag] = a.tagColor;
  }
  return c;
});

/** Single account or multi-select batch from Addresses strip / ⋮ menu */
let addressViewTagTargets = $state<Address[]>([]);

const addressTagsController = createAddressTagsController({
  ext,
  get: {
    allAddresses: () => allAddresses,
    selectedAddresses: () => selectedAddresses,
    currentEmailDetail: () => currentEmailDetail,
    tagTarget: () => addressViewTagTarget,
    tagTargets: () => addressViewTagTargets,
  },
  set: {
    tagDialogOpen: (value) => (addressViewTagDialogOpen = value),
    tagTarget: (value) => (addressViewTagTarget = value),
    tagTargets: (value) => (addressViewTagTargets = value),
    currentEmailDetail: (value) => (currentEmailDetail = value),
  },
  loadAddresses: (skipEmailSelection) => loadAddressesFn(skipEmailSelection),
  logDebug,
  showToast,
});
const openAddressViewTagDialog = addressTagsController.openAddressViewTagDialog;
const openAddressViewTagDialogForSelected =
  addressTagsController.openAddressViewTagDialogForSelected;
const closeAddressViewTagDialog = addressTagsController.closeAddressViewTagDialog;
const saveAddressViewTags = addressTagsController.saveAddressViewTags;

let mgmtAddresses = $derived(
  (Array.isArray(allAddresses) ? allAddresses : []).filter((a) => {
    if (!a || typeof a !== 'object') return false;
    const isInactive =
      a.status !== 'active' || a.accountStatus === 'archived' || a.accountStatus === 'deleted';
    const matchesTab = mgmtTab === 'active' ? !isInactive : isInactive;
    const addr = (a.address || '').toLowerCase();
    const prov = (a.provider || '').toLowerCase();
    const tag = (a.tag || '').toLowerCase();
    const tags = Array.isArray(a.tags)
      ? a.tags.map((t) => (t?.name || '').toLowerCase()).filter(Boolean)
      : [];
    const qRaw = (mgmtSearch || '').trim().toLowerCase();
    const q = qRaw.startsWith('tag:') ? qRaw.slice(4).trim() : qRaw;
    const matchesSearch =
      q === '' ||
      addr.includes(q) ||
      prov.includes(q) ||
      tag.includes(q) ||
      tags.some((t) => t.includes(q));
    return matchesTab && matchesSearch;
  })
);

let allSelected = $derived(
  mgmtAddresses.length > 0 && mgmtAddresses.every((a) => selectedAddresses.has(a.id))
);

// --- Use shared inbox actions composable ---
const addressActions = useAddressActions(
  {
    ext,
    addressSetters,
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
    get allAddresses() {
      return allAddresses;
    },
    get mgmtAddresses() {
      return mgmtAddresses;
    },
  },
  {
    onSelectAddress: () => {
      dropdownOpen = false;
      // Clear inbox list filters that would hide every message on the new mailbox
      mailboxFilters.clear();
    },
    getActiveAddressId: (selectedEmail: string, accounts: Address[]) => {
      if (!selectedEmail) return undefined;
      const selectedLower = selectedEmail.toLowerCase();
      const currentAddress = accounts.find(
        (a) => (a.address || '').toLowerCase() === selectedLower
      );
      return currentAddress?.id;
    },
  }
);

// --- Load addresses from extension storage ---
const loadAddresses = addressActions.loadAddresses;
const checkMessages = addressActions.checkMessages;
const selectAddress = addressActions.selectAddress;
const copyEmail = addressActions.copyEmail;
const refreshMailbox = addressActions.refreshMailbox;
const mailboxReadStateDeps = {
  ext,
  getSelectedEmail: () => selectedEmail,
  getAccounts: () => accounts,
  getAllAddresses: () => allAddresses,
  getEmails: () => emails,
  setEmails: (value: Email[]) => (emails = value),
  getUnreadByAddress: () => unreadByAddress,
  setUnreadByAddress: (value: Record<string, number>) => (unreadByAddress = value),
  persistQueuedReadState: (emailId: string, addresses: string[], read: boolean) =>
    queueEmailReadState(emailId, addresses, read),
  archiveOnRead: (email: Email) => archiveSelectedEmails([email]),
};
const persistEmailRead = (email: Email) => persistEmailReadAction(mailboxReadStateDeps, email);
const persistEmailUnread = (email: Email) => persistEmailUnreadAction(mailboxReadStateDeps, email);
const markOtpEmailRead = (otp: string = latestOtp) =>
  markOtpEmailReadAction(mailboxReadStateDeps, otp);

const copyOtp = () => {
  addressActions.copyOtp();
  void markOtpEmailRead();
};
const toggleNotifications = addressActions.toggleNotifications;

let shortcutDiscoveryOpen = $state(false);
const keyboardTooltipController = createKeyboardTooltipController({
  get: {
    currentView: () => currentView,
    mgmtTab: () => mgmtTab,
    selectedAddresses: () => selectedAddresses,
    mgmtSearch: () => mgmtSearch,
    selectedThread: () => selectedThread,
    currentEmailDetail: () => currentEmailDetail,
    confirmDialog: () => confirmDialog,
    qrDialogOpen: () => overlayState.qrDialogOpen,
    createAddressDialogOpen: () => overlayState.createAddressDialogOpen,
    commandPaletteOpen: () => overlayState.commandPaletteOpen,
    cheatSheetOpen: () => overlayState.cheatSheetOpen,
    exportWizardOpen: () => overlayState.exportWizardOpen,
    showExportBackupDialog: () => overlayState.showExportBackupDialog,
    showImportBackupDialog: () => overlayState.showImportBackupDialog,
    addressViewTagDialogOpen: () => addressViewTagDialogOpen,
    keybindings: () => keybindings,
    activeNavigationList: () => activeNavigationList,
    currentNavigationIndex: () => currentNavigationIndex,
    headerBackAvailable: () => HEADER_BACK_VIEWS.has(currentView),
  },
  set: {
    setCurrentView: (view) => (currentView = view as View),
    setCheatSheetOpen: (open) => overlaySetters.setCheatSheetOpen(open),
    setShortcutDiscoveryOpen: (open) => {
      shortcutDiscoveryOpen = open;
    },
    setCommandPaletteOpen: (open) => overlaySetters.setCommandPaletteOpen(open),
    setActiveTooltip: (tip) => overlaySetters.setActiveTooltip(tip),
  },
  toggleSplitPane: () => toggleSplitPane(),
  shortcuts: {
    refreshMailbox,
    createAddress,
    copyEmail,
    copyOtp,
    closeConfirm,
    closeQrDialog,
    setSelectedAddresses: (addresses) => (selectedAddresses = addresses),
    setMgmtSearch: (search) => (mgmtSearch = search),
    setSelectedMessage: (message: Email[] | null) => (selectedThread = message ?? []),
    setCurrentEmailDetail: (detail) => (currentEmailDetail = detail),
    toggleAccountSelector: () => {
      if (currentView !== 'mailbox') currentView = 'mailbox';
      accountSelectorDropdownOpen = !accountSelectorDropdownOpen;
    },
    // Escape tier - dismiss the most recently opened transient surface.
    cancelEscapeTier: () => cancelTopEscapeTier(),
    headerBack: () => handleHeaderBack(),
  },
  openMessageDetail,
  showToast,
  getTranslation: translate,
});

// Layout chrome claims Escape tiers too, so the stack - not this file's code
// order - decides whether an open drawer or a view's own multi-select goes
// first: whichever the user opened last is the one Escape dismisses.
$effect(() => {
  if (!accountSelectorDropdownOpen) return;
  return registerEscapeTier('layout.accountSelector', () => {
    accountSelectorDropdownOpen = false;
  });
});

$effect(() => {
  if (!settingsSubpage) return;
  return registerEscapeTier('layout.settingsSubpage', handleSettingsSubpageBack);
});

$effect(() => {
  if (!mailProviderSplitOpen) return;
  return registerEscapeTier('layout.providerSplit', () => {
    mailProviderSplitOpen = false;
  });
});

function applyStoredEmailMetadata(
  storedEmails: Record<string, Email[]>,
  readEmails: Record<string, boolean>
) {
  const projection = projectStoredEmailMetadata(storedEmails, readEmails, allAddresses, accounts);
  allStoredEmails = projection.storedEmails;
  unreadByAddress = projection.unreadByAddress;
  allAddresses = projection.allAddresses;
  accounts = projection.accounts;
}

const updateUnreadByAddress = () =>
  refreshUnreadCountsAction(mailboxReadStateDeps, applyStoredEmailMetadata);

// --- Assign actual function to placeholder for setters ---
loadAddressesFn = (skipEmailSelection: boolean | undefined = undefined) =>
  addressActions.loadAddresses(skipEmailSelection);

/**
 * Resolve the unread-badge key for an address, case-insensitively. Badge keys
 * follow the stored bag casing (computeUnreadCounts iterates storage keys), so
 * a casing drift must not make badge lookups/decrements miss silently.
 */
function unreadBadgeKey(address: string): string {
  return resolveUnreadBadgeKey(unreadByAddress, address);
}

const addressCreatorDeps = {
  ext,
  addressSetters,
  get selectedProvider() {
    return selectedProvider;
  },
  get selectedProviderInstance() {
    return selectedProviderInstance ?? 'random';
  },
  showToast,
  getTranslation: translate,
  setHighlightAddress,
  reloadAddresses: (skipEmailSelection?: boolean) => loadAddresses(skipEmailSelection),
  navigateToMailbox: () => (currentView = 'mailbox'),
  navigateToAddresses: () => (currentView = 'addresses'),
  isOnAddressesPage,
  setSelectedEmail: (email: string) => (selectedEmail = email),
  setDisplayedEmail: (email: string) => (displayedEmail = email),
};

async function createAddress(
  provider?: string,
  instanceId?: string,
  emailUser?: string,
  preferredDomain?: string
) {
  return createAddressModule(addressCreatorDeps, provider, instanceId, emailUser, preferredDomain);
}

function openCreateAddressDialog(provider?: string, instanceId?: string) {
  const result = openCreateDialog(addressCreatorDeps, provider, instanceId);
  pendingCreateProvider = result.pendingProvider;
  pendingCreateInstanceId = result.pendingInstanceId;
  overlaySetters.setPendingCreateProviderConfig(result.pendingConfig);
  overlaySetters.setCreateAddressDialogOpen(result.openDialog);
}

async function handleCreateAddressWithProvider(provider?: string, instanceId?: string) {
  const result = await handleCreateWithProvider(addressCreatorDeps, provider, instanceId);
  pendingCreateProvider = result.pendingProvider;
  pendingCreateInstanceId = result.pendingInstanceId;
  overlaySetters.setPendingCreateProviderConfig(result.pendingConfig);
  overlaySetters.setCreateAddressDialogOpen(result.openDialog);
}

async function handleCreateAddress(type: 'random' | 'custom', username?: string, domain?: string) {
  overlaySetters.setCreateAddressDialogOpen(false);
  const created = await handleCreateAddressResult(
    addressCreatorDeps,
    pendingCreateProvider,
    pendingCreateInstanceId,
    type,
    username,
    domain
  );
  pendingCreateProvider = undefined;
  pendingCreateInstanceId = undefined;
  overlaySetters.setPendingCreateProviderConfig(undefined);
  return created;
}

const addressBulkDeps = {
  ext,
  bulkActionsSetters,
  managementSetters,
  getSelectedAddresses: () => selectedAddresses,
  setSelectedAddresses: (value: Set<string>) => (selectedAddresses = value),
  getMgmtAddresses: () => mgmtAddresses,
  getAccounts: () => accounts,
  getAllAddresses: () => allAddresses,
  getSavedLogins: () => savedLogins,
  getIdentities: () => identities,
  showConfirm,
  closeConfirm,
  getTranslation: translate,
  reloadAddresses: (skip?: boolean) => loadAddresses(skip),
  removeSingleAddress: (address: string) => removeAddress(address),
  actions: {
    toggleSelectAll: toggleSelectAllAction,
    toggleSelect: toggleSelectAction,
    archiveSelected: archiveSelectedAction,
    unarchiveSelected: unarchiveSelectedAction,
    deleteSelected: deleteSelectedAction,
    toggleAutoExtend: toggleAutoExtendAction,
  },
};

function toggleSelectAll() {
  toggleSelectAllAddresses(addressBulkDeps);
}

function toggleSelect(id: string) {
  toggleSelectAddressBulk(addressBulkDeps, id);
}

function archiveSelected() {
  return archiveSelectedAddresses(addressBulkDeps);
}

function unarchiveSelected() {
  return unarchiveSelectedAddresses(addressBulkDeps);
}

function deleteSelected() {
  return deleteAddressesDirectBulk(
    addressBulkDeps,
    Array.from(selectedAddresses)
      .map((id) => allAddresses.find((address) => address.id === id))
      .filter((address): address is Address => Boolean(address))
  );
}

/** Delete specific accounts by id (drag Live→Inactive) without selection Set race */
/** If the open thread/detail references a just-deleted inbox, clear it so the
 * split pane / expand routing doesn't show a phantom message view. */
function clearDetailIfAddressDeleted(deletedAddresses: Set<string>) {
  removeOpenedMessageTabs(
    new Set(
      messageTabs.tabs
        .filter((tab) => deletedAddresses.has(tab.mailboxAddress.toLowerCase()))
        .map((tab) => tab.key)
    )
  );
  const t0 = selectedThread[0];
  if (t0 && deletedAddresses.has((t0.original_inbox || '').toLowerCase())) {
    selectedThread = [];
  }
  if (
    currentEmailDetail &&
    deletedAddresses.has((currentEmailDetail.address || '').toLowerCase())
  ) {
    currentEmailDetail = null;
  }
}

const deleteAddressesDirect = (toDelete: Address[]) =>
  deleteAddressesDirectBulk(
    {
      ...addressBulkDeps,
      removeSingleAddress: (address: string) => removeAddress(address),
    },
    toDelete
  );

type ArchivedRenewalDisposition = 'unarchive' | 'keep-archived';
let manualArchivedRenewalPrompt = $state<{
  account: Address;
  resolve: (choice: ArchivedRenewalDisposition | null) => void;
} | null>(null);

function resolveManualArchivedRenewal(choice: ArchivedRenewalDisposition | null) {
  const pending = manualArchivedRenewalPrompt;
  manualArchivedRenewalPrompt = null;
  pending?.resolve(choice);
}

async function toggleAutoExtend(account: Address) {
  const archived = account.accountStatus === 'archived' || account.status === 'archived';
  const hasManualRenewChoice = archived && !account.autoExtend;
  if (!hasManualRenewChoice) return toggleAutoExtendBulk(addressBulkDeps, account);

  const choice = await new Promise<ArchivedRenewalDisposition | null>((resolve) => {
    manualArchivedRenewalPrompt = { account, resolve };
  });
  if (!choice) return;
  return toggleAutoExtendBulk(addressBulkDeps, account, choice);
}

const handleApplyAutoRenewToAll = (value: boolean) =>
  applyAutoRenewToAllAction(value, managementSetters);

const reorderAddressesById = (sourceId: string, targetId: string) =>
  reorderAddressesByIdBulk(addressBulkDeps, sourceId, targetId);

function clearDetailIfEmailsRemoved(removed: Email[]) {
  const removedKeys = new Set(removed.map((email) => messageTabKey([email], selectedEmail)));
  const tabKeys = new Set(
    messageTabs.tabs
      .filter((tab) =>
        tab.thread.some((email) => removedKeys.has(messageTabKey([email], tab.mailboxAddress)))
      )
      .map((tab) => tab.key)
  );
  const selectedRemoved = selectedThread.some((email) =>
    removedKeys.has(messageTabKey([email], selectedEmail))
  );
  removeOpenedMessageTabs(tabKeys);
  if (selectedRemoved && !(layoutSplit || layoutVerticalSplit)) selectedThread = [];
}

const emailBulkDeps = {
  ext,
  getEmails: () => emails,
  setEmails: (value: Email[]) => (emails = value),
  onEmailsRemoved: clearDetailIfEmailsRemoved,
  showToast,
  getTranslation: translate,
  reloadAddresses: (skip?: boolean) => loadAddresses(skip),
  refreshUnreadCounts: () => updateUnreadByAddress(),
};
const archiveSelectedEmails = (items: Email[]) => archiveSelectedEmailsAction(emailBulkDeps, items);
const deleteSelectedEmails = (items: Email[]) => deleteSelectedEmailsAction(emailBulkDeps, items);
const restoreSelectedEmails = (items: Email[]) => restoreSelectedEmailsAction(emailBulkDeps, items);

const addressDetailOperations = createAddressDetailOperations({
  ext,
  getCurrentEmailDetail: () => currentEmailDetail,
  getSelectedEmail: () => selectedEmail,
  getAllAddresses: () => allAddresses,
  getEmails: () => emails,
  getLayoutSplit: () => layoutSplit,
  getLayoutVerticalSplit: () => layoutVerticalSplit,
  getCurrentView: () => currentView,
  setCurrentEmailDetail: (value) => (currentEmailDetail = value),
  setSelectedEmail: (value) => (selectedEmail = value),
  setDisplayedEmail: (value) => (displayedEmail = value),
  setCurrentView: (value) => (currentView = value as View),
  setLoading: (value) => (loading = value),
  selectAddress,
  checkMessages,
  loadAddresses: (skipEmailSelection) => loadAddresses(skipEmailSelection),
  expandSplitPane,
  unarchiveAddress,
  toggleAutoExtend,
  extendAddress,
});
const openAddressView = addressDetailOperations.openAddressView;
const refreshCurrentAddressMessages = addressDetailOperations.refreshCurrentAddressMessages;
const handleAddressDomainChanged = addressDetailOperations.handleAddressDomainChanged;
const navigateFromAddressToMailbox = addressDetailOperations.navigateFromAddressToMailbox;
const handleAddressUnarchive = addressDetailOperations.handleAddressUnarchive;
const handleAddressAutoExtend = addressDetailOperations.handleAddressAutoExtend;
const handleAddressExtend = addressDetailOperations.handleAddressExtend;

function addressDetailToast(
  message: string | { message: string; type?: ToastType; icon?: ToastType },
  type?: string,
  undo?: (() => void | Promise<void>) | null
) {
  showToast(message, (type as ToastType) || 'success', undo ?? null);
}

function createRuleFromMessage(from?: string) {
  automationInitialSender = from || '';
  selectedThread = [];
  currentView = 'automation';
}

function markSelectedThreadUnreadAndClose(mode: 'split' | 'page') {
  const closingKey = messageTabKey(selectedThread, selectedEmail);
  const threadAddress = selectedThread[0]?.original_inbox || selectedEmail;
  let newlyUnread = 0;
  let failedMarks = 0;
  const revertFailedMark = () => {
    failedMarks += 1;
    if (failedMarks === 1) {
      showToast($t('toasts.operationFailed'), 'error');
    }
    if (threadAddress) {
      const badgeKey = unreadBadgeKey(threadAddress);
      unreadByAddress = {
        ...unreadByAddress,
        [badgeKey]: Math.max(0, (unreadByAddress[badgeKey] ?? 0) - 1),
      };
    }
  };
  for (const msg of selectedThread) {
    if (!msg.unread) newlyUnread += 1;
    const key = messageTabKey([msg], threadAddress);
    const idx = emails.findIndex((email) => messageTabKey([email], selectedEmail) === key);
    const wasUnreadInList = idx !== -1 ? emails[idx].unread : false;
    if (idx !== -1) {
      emails = emails.map((e, i) => (i === idx ? { ...e, unread: true } : e));
    }
    void persistEmailUnread(msg).then((ok) => {
      if (ok) return;
      // Storage write failed - revert the optimistic update; the badge
      // increment below is undone per failure while the toast fires once.
      if (idx !== -1) {
        emails = emails.map((email) =>
          messageTabKey([email], selectedEmail) === key
            ? { ...email, unread: wasUnreadInList }
            : email
        );
      }
      revertFailedMark();
    });
  }
  if (threadAddress && newlyUnread > 0) {
    const badgeKey = unreadBadgeKey(threadAddress);
    unreadByAddress = {
      ...unreadByAddress,
      [badgeKey]: (unreadByAddress[badgeKey] ?? 0) + newlyUnread,
    };
  }
  if (mode === 'split') closeMessageTab(closingKey);
  else selectedThread = [];
  if (mode === 'page') currentView = 'mailbox';
}

function archiveSelectedThread(mode: 'split' | 'page') {
  if (selectedThread.length === 0) return;
  const thread = selectedThread;
  void archiveSelectedEmails(thread).then(() => {
    if (mode === 'page' && selectedThread.length === 0) currentView = 'mailbox';
  });
}

function deleteSelectedThread(mode: 'split' | 'page') {
  if (selectedThread.length === 0) return;
  const thread = selectedThread;
  void deleteSelectedEmails(thread).then(() => {
    if (mode === 'page' && selectedThread.length === 0) currentView = 'mailbox';
  });
}

function searchFromMessage(query: string) {
  applySearchQuery(query);
  currentView = 'mailbox';
}

async function autofillForm() {
  await autofillFormAction(ext, selectedEmail, (message, type) => showToast(message, type));
}

/** After refresh: if current provider is down but another is up → toast + strip hint */
let providerFailoverHint = $state<
  import('@/features/address/provider-failover.js').FailoverState | null
>(null);

$effect(() => {
  void selectedEmail;
  const address = allAddresses.find((item) => item.address === selectedEmail);
  if (
    !address?.mailboxRefreshFailure ||
    (providerFailoverHint && providerFailoverHint.addressId !== address.id)
  )
    providerFailoverHint = null;
});

async function evaluateProviderFailoverAfterRefresh(addressId: string) {
  await evaluateProviderFailoverAction(
    {
      getAllAddresses: () => allAddresses,
      getAccounts: () => accounts,
      getCurrentAddressId: () =>
        allAddresses.find((address) => address.address === selectedEmail)?.id,
      getFailoverHint: () => providerFailoverHint,
      setFailoverHint: (hint) => (providerFailoverHint = hint),
      openCreateAddressDialog: () => openCreateAddressDialog(),
      showWarningToast: (msg, actionLabel, onAction) =>
        toastStore.add('warning', msg, 8000, onAction, actionLabel),
      getTranslation: translate,
    },
    addressId
  );
}

// --- Settings view ---
const autoCopy = $derived(settings.autoCopy);
const autoRenew = $derived(settings.autoRenew);
const autoRenewWindowMinutes = $derived(settings.autoRenewWindowMinutes);
const selectedProvider = $derived(settings.selectedProvider);
const providerInstances = $derived(settings.providerInstances);
const selectedProviderInstance = $derived(settings.selectedProviderInstance);
const savingSettings = $derived(settings.savingSettings);
const settingsLoading = $derived(settings.settingsLoading);
const customColor = $derived(settings.customColor);
const globalZoomEnabled = $derived(settings.globalZoomEnabled);
const addressColorThemeEnabled = $derived(settings.addressColorThemeEnabled);
const showDeveloperSettings = $derived(settings.showDeveloperSettings);
const enableLogging = $derived(settings.enableLogging);
const emailRetentionDays = $derived(settings.emailRetentionDays);
const faviconCaching = $derived(settings.faviconCaching);
const notificationsEnabled = $derived(settings.notificationsEnabled);
const soundEnabled = $derived(settings.soundEnabled);
const expiryWarningThreshold = $derived(settings.expiryWarningThreshold);
const keybindings = $derived(settings.keybindings);
const emailPreviewMode = $derived(settings.emailPreviewMode);
const defaultDomain = $derived(settings.defaultDomain);

let addressColors = $state<Record<string, string>>({});

async function loadSettings() {
  await settingsController.load(settingsState());
  try {
    const res = (await browser.storage.local.get([
      'addressColorThemeEnabled',
      'addressColors',
    ])) as {
      addressColorThemeEnabled?: boolean;
      addressColors?: Record<string, string>;
    };
    if (res.addressColorThemeEnabled !== undefined) {
      settingsDomainSetters.setAddressColorThemeEnabled(res.addressColorThemeEnabled);
    }
    if (res.addressColors) {
      addressColors = res.addressColors;
    }
  } catch (error) {
    logError('Failed to load inbox color theme settings', error);
  }
  // Sync the toast master switch so toasts are suppressed across entrypoints
  // before the user ever opens Settings.
  try {
    const res = (await browser.storage.local.get(['toastsEnabled'])) as {
      toastsEnabled?: boolean;
    };
    toastStore.setEnabled(res.toastsEnabled !== false);
  } catch (error) {
    logError('Failed to load toast notification setting', error);
  }
}

const blocklistSettingsDeps = {
  showToast,
  getTranslation: translate,
  onBlocklistChanged: (list: string[]) => (autofillBlocklist = list),
};
const removeFromAutofillBlocklist = (domain: string) =>
  removeFromAutofillBlocklistSetting(blocklistSettingsDeps, domain);
const addToAutofillBlocklistSetting = (domain: string) =>
  addToAutofillBlocklistSettingAction(blocklistSettingsDeps, domain);
const toggleAutofillBlocklistSetting = (domain: string) =>
  toggleAutofillBlocklistSettingAction(blocklistSettingsDeps, domain);

async function setSelectedIdentity(id: string | null) {
  selectedIdentityId = id;
  try {
    await writeWithRetry({ selectedIdentityId: id });
  } catch (error) {
    logError('Failed to save selected identity', error);
  }
}

async function updateAutoRefreshInterval(intervalMs: number) {
  settingsDomainSetters.setAutoRefreshInterval(intervalMs);
  try {
    await writeWithRetry({ autoRefreshInterval: intervalMs });
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
    const marked = await markOtpEmailRead(otp);
    if (!marked) {
      showToast($t('toasts.operationFailed'), 'error');
    }

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
    } catch (_ruleErr) {
      /* ignore non-critical automation rule check failure */
    }
  } catch (error) {
    logError('Failed to copy OTP from message', error);
    showToast($t('toasts.otpCopyFailed'), 'error');
  }
}

async function saveSettings() {
  await settingsController.save(settingsState());
}

async function toggleDeveloperSettings() {
  await settingsController.toggleDeveloperSettings(settingsState());
}

async function toggleEnableLogging() {
  await settingsController.toggleEnableLogging(settingsState());
}

async function handleProviderChange(provider: string) {
  await settingsController.handleProviderChange(provider);
  // Switching providers reloads addresses with a different provider's accounts.
  // Clear any thread/detail referencing the old provider's email IDs so MailView
  // doesn't render stale content and activeViewForExpand doesn't report a
  // message view that no longer belongs to a visible inbox.
  selectedThread = [];
  currentEmailDetail = null;
  splitSecondaryView = null;
  mailProviderSplitOpen = false;
  currentView = 'mailbox';
}

async function saveAutoCopy() {
  await settingsController.saveAutoCopy(autoCopy);
  showToast($t('toasts.autoCopyToggled', { values: { state: autoCopy ? 'enabled' : 'disabled' } }));
}

async function saveAutoRenew() {
  await settingsController.saveAutoRenew(autoRenew);
  showToast(
    $t('toasts.autoRenewToggled', { values: { state: autoRenew ? 'enabled' : 'disabled' } })
  );
}

async function saveAutoRenewWindowMinutes() {
  await settingsController.saveAutoRenewWindowMinutes(autoRenewWindowMinutes);
}

async function saveAutoRenewScope() {
  await settingsController.saveAutoRenewScope(settings.autoRenewScope);
}

async function handleColorChange(color: string) {
  settingsDomainSetters.setCustomColor(color);
  await settingsController.handleColorChange(color);
  applyCustomColor(color);
}

async function changeProvider(provider: string) {
  await settingsController.changeProvider(provider);
}

async function loadProviderInstances() {
  await settingsController.loadProviderInstances();
}

async function setProviderInstance(instanceId: string) {
  await settingsController.setProviderInstance(instanceId);
}

async function addCustomInstance(name: string, url: string) {
  await settingsController.addCustomInstance(name, url);
}

async function hardReset() {
  await settingsController.hardReset();
}

const overlayState = overlays as OverlayState;

const productTourDeps = {
  showToast,
  getTranslation: translate,
  // The product tour navigates to a catalog View, so the compiler checks what it
  // asks for - no cast is needed once the callback says what it accepts.
  setCurrentView: (view: View) => {
    currentView = view;
  },
  setProductTourOpen: (open: boolean) => overlaySetters.setProductTourOpen(open),
  getAllAddresses: () => allAddresses,
  getAccounts: () => accounts,
};
const startProductTour = () => startProductTourAction(productTourDeps);
const finishProductTour = () => finishProductTourAction(productTourDeps);
const skipProductTour = () => skipProductTourAction(productTourDeps);

/** Open mail provider settings - prefer split pane when wide layout is active */
function openMailProviderSettings() {
  if (layoutSplit || layoutVerticalSplit) {
    // Keep current list/settings in mainview; open provider form in split
    mailProviderSplitOpen = true;
    // Ensure we are on a surface that has a split host (settings / addresses / mailbox)
    if (
      currentView !== 'settings' &&
      currentView !== 'addresses' &&
      currentView !== 'mailbox' &&
      currentView !== 'mailProvider'
    ) {
      currentView = 'settings';
    }
    if (currentView === 'mailProvider') currentView = 'settings';
  } else {
    mailProviderSplitOpen = false;
    currentView = 'mailProvider';
  }
}

function exportData() {
  overlaySetters.setShowExportBackupDialog(true);
}

function importData() {
  overlaySetters.setShowImportBackupDialog(true);
}

/** Demo mode banner (isolated from real data) */
$effect(() => {
  void browser.storage.local.get(['demoMode']).then((r) => {
    overlaySetters.setDemoModeActive(!!(r as { demoMode?: boolean }).demoMode);
  });
  const onCh = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local') return;
    if (changes.demoMode) {
      overlaySetters.setDemoModeActive(!!changes.demoMode.newValue);
      // Force UI bag reload when entering/exiting demo so real vs demo never mix on screen
      void loadAddresses(false);
    }
  };
  browser.storage.onChanged.addListener(onCh);
  return () => browser.storage.onChanged.removeListener(onCh);
});

// Close account selector when leaving mailbox (prevents sticky open popup on return)
$effect(() => {
  if (currentView === 'mailbox') return;
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
async function deleteArchivedEmail(email: Email) {
  await deleteArchivedEmailAction(ext, email, { archivedEmails }, archivedSetters);
}

// --- QR Code dialog ---
// Lazy-load QrDialog component (saves ~200 KB of qrcode + component code from
// the main bundle - only loaded when the user opens the QR dialog)
let _qrDialogLoadStarted = false;
$effect(() => {
  if (overlayState.qrDialogOpen && !overlayState.QrDialogComponent && !_qrDialogLoadStarted) {
    _qrDialogLoadStarted = true;
    void import('@/ui/blocks/dialogs/QrDialog.svelte').then((m) => {
      overlaySetters.setQrDialogComponent(m.default);
    });
  }
});

// --- Backup / export dialogs ---
// Lazy-load the three backup dialogs (same pattern as QrDialog). Their
// dependency cluster (backup-actions, webdav-sync, the export MIME builder)
// is heavy and only needed once a dialog is actually opened. Triggering on
// the open flags covers every opener path: settings menus, onboarding's
// import shortcut, and the popup→app import handoff flags.
let _backupDialogsLoadStarted = false;
$effect(() => {
  const needed =
    overlayState.exportWizardOpen ||
    overlayState.showExportBackupDialog ||
    overlayState.showImportBackupDialog;
  if (needed && !_backupDialogsLoadStarted) {
    _backupDialogsLoadStarted = true;
    void Promise.all([
      import('@/ui/blocks/dialogs/ExportWizardDialog.svelte'),
      import('@/ui/blocks/dialogs/ExportBackupDialog.svelte'),
      import('@/ui/blocks/dialogs/ImportBackupDialog.svelte'),
    ]).then(([wizard, exportBackup, importBackup]) => {
      overlaySetters.setExportWizardDialogComponent(wizard.default);
      overlaySetters.setExportBackupDialogComponent(exportBackup.default);
      overlaySetters.setImportBackupDialogComponent(importBackup.default);
    });
  }
});

// --- Create Inbox dialog ---
let pendingCreateProvider = $state<string | undefined>(undefined);
let pendingCreateInstanceId = $state<string | undefined>(undefined);
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
  return currentView === 'addresses';
}

function openQrDialog(email?: string) {
  qrDialogEmail = email || null;
  openQrDialogAction(qrSetters);
}

function closeQrDialog() {
  closeQrDialogAction(qrSetters, overlayState.qrOpenTimerId);
  overlaySetters.setQrOpenTimerId(null);
  qrDialogEmail = null;
}

function downloadQrCode() {
  downloadQrCodeAction(
    overlayState.qrCanvas,
    qrDialogEmail || displayedEmail || selectedEmail,
    (message) => showToast(message)
  );
}

async function copyQrImage() {
  await copyQrImageAction(overlayState.qrCanvas, (message, type) => showToast(message, type));
}

// --- Message detail ---
let selectedThread = $state<Email[]>([]);
// Per-app session state; closing tabs releases their message/scroll snapshots.
let messageTabs = $state<MessageTabsState>({ tabs: [], activeKey: '' });
const activeMessageTabKey = $derived(messageTabKey(selectedThread, selectedEmail));

// Handoffs and the existing keyboard controller can select a thread directly.
$effect(() => {
  const thread = selectedThread;
  const owner = thread[0]?.original_inbox || selectedEmail;
  if (!(layoutSplit || layoutVerticalSplit) || !thread.length) return;
  untrack(() => {
    const key = messageTabKey(thread, owner);
    if (!messageTabs.tabs.some((tab) => tab.key === key))
      messageTabs = openMessageTab(messageTabs, thread, owner);
  });
});

// Inbox deletion (including from another extension surface) releases its tabs.
$effect(() => {
  const owners = new Set(
    allAddresses
      .filter((address) => address.accountStatus !== 'deleted')
      .map((address) => address.address.toLowerCase())
  );
  untrack(() => {
    const removed = new Set(
      messageTabs.tabs
        .filter((tab) => !owners.has(tab.mailboxAddress.toLowerCase()))
        .map((tab) => tab.key)
    );
    if (removed.size) removeOpenedMessageTabs(removed);
  });
});

// Storage refreshes can remove messages from another popup/app context.
$effect(() => {
  const bags = allStoredEmails;
  untrack(() => {
    const removed = new Set<string>();
    for (const tab of messageTabs.tabs) {
      const bag = bags[resolveBagKey(bags, tab.mailboxAddress)];
      if (!bag) continue;
      const current = bag.find((email) => messageTabKey([email], tab.mailboxAddress) === tab.key);
      const opened = tab.thread[0];
      if (
        current?.local_deleted ||
        (!opened?.local_archived && (!current || current.local_archived))
      )
        removed.add(tab.key);
    }
    if (removed.size) removeOpenedMessageTabs(removed);
  });
});

function selectMessageTab(key: string) {
  const tab = messageTabs.tabs.find((item) => item.key === key);
  if (tab) openMessageDetail(tab.thread);
}

function removeOpenedMessageTabs(keys: Set<string>) {
  const wasActive = keys.has(activeMessageTabKey);
  messageTabs = removeMessageTabs({ ...messageTabs, activeKey: activeMessageTabKey }, keys);
  if (wasActive) {
    const next = messageTabs.tabs.find((tab) => tab.key === messageTabs.activeKey);
    if (next) openMessageDetail(next.thread);
    else selectedThread = [];
  }
}

function closeMessageTab(key: string) {
  removeOpenedMessageTabs(new Set([key]));
}

function onMessageScroll(key: string, scrollTop: number) {
  messageTabs = rememberMessageScroll(messageTabs, key, scrollTop);
}

function openMessageDetail(thread: Email[]) {
  if (!thread.length) return;
  const outgoing = document.querySelector<HTMLElement>(
    '[data-message-tab-panel] [data-message-scroll]'
  );
  if (outgoing?.dataset.messageScrollKey)
    onMessageScroll(outgoing.dataset.messageScrollKey, outgoing.scrollTop);
  const threadAddress = thread[0].original_inbox || selectedEmail;
  if (layoutSplit || layoutVerticalSplit) {
    messageTabs = openMessageTab(messageTabs, thread, threadAddress);
    thread = messageTabs.tabs.find((tab) => tab.key === messageTabs.activeKey)?.thread || thread;
  }
  const unreadInThread = thread.filter((m) => m.unread).length;
  selectedThread = thread;
  mailProviderSplitOpen = false;
  splitSecondaryView = null;
  // Leaving the address detail view (email-detail of an account) - clear the
  // stale account so activeViewForExpand / split routing don't see a dangling
  // currentEmailDetail while the message thread is shown.
  currentEmailDetail = null;
  expandSplitPane();
  // Split view (horizontal or vertical): keep mailbox list open and show detail beside/below it
  currentView = layoutSplit || layoutVerticalSplit ? 'mailbox' : 'mailView';

  // Mark every email in the thread as read
  let failedMarks = 0;
  const revertFailedMark = () => {
    failedMarks += 1;
    if (failedMarks === 1) {
      showToast($t('toasts.operationFailed'), 'error');
    }
    if (threadAddress) {
      const badgeKey = unreadBadgeKey(threadAddress);
      unreadByAddress = {
        ...unreadByAddress,
        [badgeKey]: (unreadByAddress[badgeKey] ?? 0) + 1,
      };
    }
  };
  for (const message of thread) {
    if (!message.unread) continue;
    message.unread = false;
    // Update emails array to reflect read state (trigger reactivity)
    const messageKey = messageTabKey([message], threadAddress);
    const emailIndex = emails.findIndex(
      (email) => messageTabKey([email], selectedEmail) === messageKey
    );
    const wasUnreadInList = emailIndex !== -1 ? emails[emailIndex].unread : true;
    if (emailIndex !== -1) {
      emails = emails.map((e, i) => (i === emailIndex ? { ...e, unread: false } : e));
    }
    void persistEmailRead(message).then((ok) => {
      if (ok) return;
      // Storage write failed - revert the optimistic update so the row does
      // not lie about being read; the badge increment above is undone per
      // failure while the toast fires only once per thread.
      message.unread = true;
      if (emailIndex !== -1) {
        emails = emails.map((email) =>
          messageTabKey([email], selectedEmail) === messageKey
            ? { ...email, unread: wasUnreadInList }
            : email
        );
      }
      revertFailedMark();
    });
  }
  // Immediately decrement footer badge - don't wait for next storage poll
  const badgeKey = unreadBadgeKey(threadAddress);
  if (threadAddress && (unreadByAddress[badgeKey] ?? 0) > 0) {
    unreadByAddress = {
      ...unreadByAddress,
      [badgeKey]: Math.max(0, unreadByAddress[badgeKey] - unreadInThread),
    };
  }
}

// --- Remove account (delete inbox) ---
async function removeAddress(address: string) {
  const account = allAddresses.find(
    (item) => (item.address || '').toLowerCase() === address.toLowerCase()
  );
  if (!account) return;
  await removeSingleAddress(
    {
      ext,
      allAddresses,
      accounts,
      savedLogins,
      identities,
      managementSetters,
      selectedEmail,
      emails,
      loading,
      showConfirm,
      closeConfirm,
      getTranslation: translate,
      clearDetailIfAddressDeleted,
      getCurrentView: () => currentView,
      setCurrentView: (view) => (currentView = view as View),
      setCurrentEmailDetail: (detail) => (currentEmailDetail = detail),
      setMgmtTab: (tab) => (mgmtTab = tab),
    },
    account.address
  );
}

// --- Restore deleted account ---
async function restoreAddress(address: string) {
  const account = allAddresses.find(
    (a) => (a.address || '').toLowerCase() === address.toLowerCase()
  );
  if (!account) return;
  await restoreSingleAddress(ext, allAddresses, account.address, managementSetters);
}

// --- Archive, restore, and unarchive single account actions ---
async function archiveAddress(account: Address) {
  await archiveSingleAddress(ext, account, {
    accounts,
    selectedEmail,
    emails,
    loading,
    managementSetters,
    showConfirm,
    closeConfirm,
    getTranslation: translate,
    allAddresses,
  });
}

async function unarchiveAddress(account: Address) {
  await unarchiveSingleAddress(ext, account, managementSetters);
}

let exportWizardAddress = $state<Address | null>(null);
let exportWizardMessages = $state<Email[]>([]);

// --- Export single or multi-inbox emails ---
async function exportAddressEmails(target: Address | Address[]) {
  try {
    const list = Array.isArray(target) ? target : [target];
    if (list.length === 0) return;
    // ONE batched round-trip instead of N serial checkEmails messages; the
    // background fans out the per-inbox checks with bounded concurrency and
    // returns per-address outcomes in request order.
    const response = (await ext.runtime.sendMessage({
      type: 'checkEmailsBulk',
      addressIds: list.map((a) => a.id),
      filters: {},
    })) as { results?: Array<{ success?: boolean; messages?: Email[] }> } | undefined;
    const results = Array.isArray(response?.results) ? response.results : [];
    const allMessages: Email[] = [];
    for (const r of results) {
      if (r?.success && r.messages) allMessages.push(...r.messages);
    }
    if (results.length > 0 && allMessages.length === 0 && !results.some((r) => r.success)) {
      // Every inbox failed the check - nothing to export.
      showToast($t('toasts.exportFailed'), 'error');
      return;
    }
    exportWizardAddress = list[0];
    exportWizardMessages = allMessages;
    overlaySetters.setExportWizardOpen(true);
  } catch {
    showToast($t('toasts.exportFailed'), 'error');
  }
}

async function handleExecuteExport(format: string) {
  if (exportWizardAddress) {
    await exportEmailsWithFormatAction(exportWizardAddress, exportWizardMessages, format);
  }
}

async function exportEmailsWithFormat(account: Address, msgs: Email[], format: string) {
  await exportEmailsWithFormatAction(account, msgs, format);
  showToast($t('toasts.emailsExportedAsFormat', { values: { format: format.toUpperCase() } }));
}

// --- Export selected bulk ---
// Pass allAddresses (not active-only `accounts`) so archived/deleted accounts
// selected in the Inactive tab of the Addresses view can be exported too.
async function exportSelected() {
  await exportSelectedAction(allAddresses, selectedAddresses, exportAddressEmails);
}

// --- Extend single account (Guerrilla only) ---
async function extendAddress(account: Address) {
  await extendSingleAddress(ext, account, managementSetters);
}

// --- Bulk lifecycle (cross-tab drag prompts): ONE message per batch ---
// The drag-across-tabs confirm (AddressesView applyToLive/applyToInactive)
// used to loop the per-account single RPCs; each single re-read and re-wrote
// the whole address list under its own lock. These batch variants send N ids
// in one round-trip and the background performs one locked pass, mirroring
// deleteAddresses. Per-address outcomes drive the same count-based toasts the
// bulk selector strips use.
async function archiveAddressesBulk(accounts: Address[]) {
  const ids = accounts.map((a) => a.id);
  if (ids.length === 0) return;
  try {
    const res = (await ext.runtime.sendMessage({
      type: 'archiveAddresses',
      addressIds: ids,
    })) as { results?: Array<{ success?: boolean }> } | undefined;
    await loadAddresses(true);
    const results = Array.isArray(res?.results) ? res.results : [];
    const ok = results.filter((r) => r?.success).length;
    const failed = results.length - ok;
    if (ok === 0) {
      showToast(await translate('toasts.archiveFailed'), 'error');
      return;
    }
    showToast(
      pluralMessage(
        get(t),
        {
          oneKey: 'toasts.emailsArchivedCount',
          otherKey: 'toasts.emailsArchivedCountPlural',
        },
        ok
      ),
      'success'
    );
    if (failed > 0) {
      showToast(
        await translate('toasts.someActionsFailed', { failed, total: results.length }),
        'warning'
      );
    }
  } catch (e) {
    logError('Bulk archive error:', undefined, e instanceof Error ? e : new Error(String(e)));
    showToast(await translate('toasts.archiveFailed'), 'error');
  }
}

async function unarchiveAddressesBulk(accounts: Address[]) {
  const ids = accounts.map((a) => a.id);
  if (ids.length === 0) return;
  try {
    const res = (await ext.runtime.sendMessage({
      type: 'unarchiveAddresses',
      addressIds: ids,
    })) as { results?: Array<{ success?: boolean }> } | undefined;
    await loadAddresses(true);
    const results = Array.isArray(res?.results) ? res.results : [];
    const ok = results.filter((r) => r?.success).length;
    const failed = results.length - ok;
    if (ok === 0) {
      showToast(await translate('toasts.unarchiveFailed'), 'error');
      return;
    }
    showToast(
      pluralMessage(
        get(t),
        {
          oneKey: 'toasts.emailsUnarchivedCount',
          otherKey: 'toasts.emailsUnarchivedCountPlural',
        },
        ok
      ),
      'success'
    );
    if (failed > 0) {
      showToast(
        await translate('toasts.someActionsFailed', { failed, total: results.length }),
        'warning'
      );
    }
  } catch (e) {
    logError('Bulk unarchive error:', undefined, e instanceof Error ? e : new Error(String(e)));
    showToast(await translate('toasts.unarchiveFailed'), 'error');
  }
}

async function renewAddressesBulk(accounts: Address[]) {
  const ids = accounts.map((a) => a.id);
  if (ids.length === 0) return;
  try {
    showToast(await translate('toasts.extendingExpiry'));
    const res = (await ext.runtime.sendMessage({
      type: 'renewAddresses',
      addressIds: ids,
    })) as { results?: Array<{ success?: boolean }> } | undefined;
    await loadAddresses(true);
    const results = Array.isArray(res?.results) ? res.results : [];
    const ok = results.filter((r) => r?.success).length;
    const failed = results.length - ok;
    if (ok === 0) {
      showToast(await translate('toasts.expiryExtendFailed'), 'error');
      return;
    }
    showToast(await translate('toasts.expiryExtended'), 'success');
    if (failed > 0) {
      showToast(
        await translate('toasts.someActionsFailed', { failed, total: results.length }),
        'warning'
      );
    }
  } catch (e) {
    logError('Bulk renew error:', undefined, e instanceof Error ? e : new Error(String(e)));
    showToast(await translate('toasts.expiryExtendFailed'), 'error');
  }
}

// --- Theme management ---
import type { ContrastLevel, ThemeMode } from '@/features/theme/theme-actions.js';

let themeMode = $state<ThemeMode>('system');
/** Responsive sidebar when host width ≥ 800px (sidepanel/app; not compact popup) */
let layoutWide = $state(false);
/** Split list+detail when width ≥ 1280px */
let layoutSplit = $state(false);
/** Vertical split list+detail below mainview when 800px ≤ width < 1280px */
let layoutVerticalSplit = $derived(layoutWide && !layoutSplit && context !== 'popup');
/** Whether split pane is collapsed by user (persisted) */
let splitPaneCollapsed = $state(false);
/** Icon-only sidebar rail when wide (persisted; expansion state owned here) */
let sidebarCollapsed = $state(false);
let sidebarPosition = $state<SidebarPosition>(DEFAULT_SIDEBAR_POSITION);
/** Combined: split pane visible when layout warrants it AND user hasn't collapsed it */
let showSplitPane = $derived((layoutSplit || layoutVerticalSplit) && !splitPaneCollapsed);
/** Mail provider settings docked in splitview when layoutSplit (from FAB gear or settings) */
let mailProviderSplitOpen = $state(false);

/**
 * When layoutSplit is active and the user navigates to a secondary settings
 * view, this holds that view so the settings hub (left) + detail (right)
 * split container renders correctly.  Null in narrow / non-split layouts.
 * The set of settings subpages is driven by `isSettingsSplitView()` from the
 * view-registry (single source of truth) - no hardcoded view list here.
 */
let splitSecondaryView = $state<View | null>(null);

/**
 * The view representing "what the user is currently looking at in detail".
 * Used for the "Open in App" handoff. Follows the layout rules:
 *   - If a split pane is visible and showing secondary content, capture that.
 *   - Otherwise capture the mainview's current page.
 * Layout-agnostic: in the popup (mainview only) it resolves to the mainview;
 * in sidepanel/app it prefers the split-pane content when it is visible.
 * Driven by live state (selectedThread / currentEmailDetail / splitSecondaryView)
 * rather than a hardcoded list of secondary views.
 */
let activeViewForExpand = $derived.by((): View => {
  // Settings subpage docked in the split pane
  if (splitSecondaryView) return splitSecondaryView;
  // Message detail (split pane when currentView='mailbox', or full-page 'mailView')
  if (selectedThread.length > 0 && (currentView === 'mailbox' || currentView === 'mailView')) {
    return 'mailView';
  }
  // Email detail (split pane when currentView='addresses', or full-page 'addressView')
  if (currentEmailDetail && (currentView === 'addresses' || currentView === 'addressView')) {
    return 'addressView';
  }
  // Mail provider docked in the split pane
  if (mailProviderSplitOpen) return 'mailProvider';
  // Default: the mainview's current page
  return currentView;
});

async function expandCurrentView() {
  try {
    const expandPayload = {
      currentView: activeViewForExpand,
      settingsSubpage: settingsSubpage ?? undefined,
      previousViewBeforeSubpage,
      mgmtTab,
      autofillTab: autofillTabValue,
      organizeTab: organizeTabValue,
      mgmtSearch,
      selectedEmail,
      // $state proxies cannot be structured-cloned into storage.local - snapshot
      // the arrays/objects so browser.storage.local.set does not throw DataCloneError.
      selectedThread: $state.snapshot(selectedThread),
      currentEmailDetail: currentEmailDetail ? $state.snapshot(currentEmailDetail) : null,
      archivedSearch,
      // Reliable split-restore trigger: when a message thread is open, always
      // signal the app tab to route it into the mailbox split pane when wide.
      openMessageInSplit: selectedThread.length > 0 || undefined,
      mailProviderSplitOpen: mailProviderSplitOpen || undefined,
      createdAt: Date.now(),
    };
    await writeWithRetry({ expandedAppState: expandPayload });
    const runtime = ext.runtime as { getURL?: (path: string) => string };
    const appUrl = typeof runtime.getURL === 'function' ? runtime.getURL('/app.html') : '/app.html';
    await ext.tabs.create({ url: appUrl });
  } catch (error) {
    logError('Failed to expand current view', error);
    showToast($t('toasts.operationFailed'), 'error');
  }
}

/** Toggle the user's split pane collapsed/expanded preference and persist it */
function toggleSplitPane() {
  splitPaneCollapsed = !splitPaneCollapsed;
  void writeWithRetry({ splitPaneCollapsed });
}

/** Toggle the sidebar between full labels and the icon-only rail; persisted. */
function toggleSidebarCollapse() {
  sidebarCollapsed = !sidebarCollapsed;
  void writeWithRetry({ sidebarCollapsed });
}

/** Density switch from the sidebar rail (minimised → expanded) or settings. */
function changeDensity(value: UiDensity) {
  uiDensity = value;
  void writeWithRetry({ uiDensity: value });
}

void browser.storage.local
  .get(['sidebarCollapsed'])
  .then((result) => {
    const stored = (result as { sidebarCollapsed?: boolean }).sidebarCollapsed;
    if (typeof stored === 'boolean') sidebarCollapsed = stored;
  })
  .catch(() => {
    /* ignore unavailable layout preferences */
  });

$effect(() => {
  const applyPosition = (raw: unknown) => {
    sidebarPosition = normalizeSidebarPosition(raw);
  };
  void browser.storage.local
    .get(['sidebarPosition'])
    .then((result) => applyPosition((result as { sidebarPosition?: unknown }).sidebarPosition))
    .catch(() => {
      /* Keep the default position if layout preferences are unavailable. */
    });
  const onPositionChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && changes.sidebarPosition) {
      applyPosition(changes.sidebarPosition.newValue);
    }
  };
  browser.storage.onChanged.addListener(onPositionChanged);
  return () => browser.storage.onChanged.removeListener(onPositionChanged);
});

/** Ensure split pane is visible (call when content navigates into it) */
function expandSplitPane() {
  if (splitPaneCollapsed) {
    splitPaneCollapsed = false;
    void writeWithRetry({ splitPaneCollapsed });
  }
}

// UX item #5: auto-expand the split pane when entering a split-capable layout
// (landscape/vertical split). A previously-collapsed preference would otherwise
// keep the pane hidden below the Main View, so users "can't see" it. Only act on
// the false→true transition so a deliberate in-session collapse is respected.
let _prevSplitCapable = false;
$effect(() => {
  const capable = layoutSplit || layoutVerticalSplit;
  if (capable && !_prevSplitCapable && splitPaneCollapsed) {
    expandSplitPane();
  }
  _prevSplitCapable = capable;
});

// Race-proof "Open in App" restore: the restore block may resolve before the
// ResizeObserver measures the container wide, leaving currentView='mailView'
// (full-page) even though a split pane is available. Reactively migrate a
// selected detail into the split host the moment split capability exists.
$effect(() => {
  if (!(layoutSplit || layoutVerticalSplit)) return;
  if (currentView === 'mailView' && selectedThread.length > 0) {
    currentView = 'mailbox';
    splitPaneCollapsed = false;
  } else if (currentView === 'addressView' && currentEmailDetail) {
    currentView = 'addresses';
    splitPaneCollapsed = false;
  }
});
/** Brief fade when crossing split breakpoint */
let splitModeFlash = $state(false);

/** Root layout container element - used for container-based breakpoints */
let layoutRootEl = $state<HTMLElement | null>(null);
/** Resizable list column width (px) for split view */
let splitListWidthPx = $state(420);
/** Ctrl/Cmd+K command palette (owned by layout overlays) */
/** UI density for sidepanel / wide layouts */
let uiDensity = $state<UiDensity>('expanded');
/** Mailbox folder + label (sidebar / list sync) */
let mailboxListTab = $state<'inbox' | 'archived' | 'deleted' | 'storedLocally' | 'all'>('inbox');
let activeMailboxLabel = $state<string | null>(null);

let sidebarLabelSummary = $derived.by(() => {
  const counts: Record<string, number> = Object.create(null);
  for (const list of Object.values(emailLabelsById || {})) {
    if (!Array.isArray(list)) continue;
    for (const t of list) {
      if (!t) continue;
      counts[t] = (counts[t] || 0) + 1;
    }
  }
  return { labels: Object.keys(counts).sort((a, b) => a.localeCompare(b)), counts };
});
let sidebarMailboxLabels = $derived(sidebarLabelSummary.labels);
let mailboxLabelCounts = $derived(sidebarLabelSummary.counts);

let mailboxFolderCounts = $derived.by(() => {
  const list = filteredEmails || [];
  const counts = { all: list.length, inbox: 0, archived: 0, deleted: 0, storedLocally: 0 };
  for (const email of list) {
    const isArchived = !!email.local_archived;
    const isDeleted = !!email.local_deleted;
    if (isDeleted) {
      counts.deleted += 1;
      continue;
    }
    if (isArchived) counts.archived += 1;
    else counts.inbox += 1;
    if (email.local_only || isArchived) counts.storedLocally += 1;
  }
  return counts;
});
let sidebarLiveCount = $derived(
  allAddresses.filter(
    (a) =>
      a.status === 'active' &&
      a.accountStatus !== 'archived' &&
      a.accountStatus !== 'deleted' &&
      !((a.expiresAt ?? 0) > 0 && a.expiresAt <= Date.now())
  ).length
);
let sidebarInactiveCount = $derived(Math.max(0, allAddresses.length - sidebarLiveCount));
let sidebarTagCount = $derived(
  new Set(
    allAddresses.flatMap((a) => {
      if (Array.isArray(a.tags) && a.tags.length) return a.tags.map((t) => t.name).filter(Boolean);
      return a.tag ? [a.tag] : [];
    })
  ).size
);
let sidebarLabelCount = $derived(sidebarMailboxLabels.length);
let sidebarFilterCount = $derived(savedSearchFilters?.length ?? 0);
let sidebarProfileCount = $derived(identities?.length ?? 0);
let sidebarCredentialCount = $derived(savedLogins?.length ?? 0);
let activeAddressKeys = $derived.by(() => {
  const keys = new Set<string>();
  for (const address of allAddresses) {
    if (address.status === 'active') keys.add((address.address || '').toLowerCase());
  }
  return keys;
});
let totalUnreadCount = $derived.by(() => {
  let total = 0;
  for (const [address, count] of Object.entries(unreadByAddress)) {
    if (activeAddressKeys.has(address.toLowerCase())) total += count;
  }
  return total;
});
let contrastLevel = $state<ContrastLevel>('standard');

const themeController = createThemeController(
  ext,
  {
    getThemeMode: () => themeMode,
    getCustomColor: () => customColor,
    getContrastLevel: () => contrastLevel,
  },
  themeSetters
);
const setThemeMode = (mode: ThemeMode) => {
  void themeController.setThemeMode(mode).then((ok) => {
    if (!ok) {
      logError('Failed to persist theme mode', mode);
      showToast($t('toasts.operationFailed'), 'error');
    }
  });
};
const syncThemeSettings = () => themeController.syncThemeSettings();
const setContrastLevel = (level: ContrastLevel) => {
  void themeController.setContrastLevel(level).then((ok) => {
    if (!ok) {
      logError('Failed to persist contrast level', level);
      showToast($t('toasts.operationFailed'), 'error');
    }
  });
};

// Listen for system theme changes
const cleanupSystemThemeListener = themeController.startSystemThemeListener();

const restoreArchivedAddress = (email: Email) => {
  restoreArchivedAddressAction(ext, email, { archivedEmails }, archivedSetters);
};

// --- Saved search filters ---
const searchFilterController = createSearchFilterController(ext, {
  state: {
    get savedSearchFilters() {
      return savedSearchFilters;
    },
  },
  setters: {
    setSavedSearchFilters: (filters) => (savedSearchFilters = filters),
    setSearchQuery: (value) => (mailboxFilters.searchQuery = value),
    setOtpOnly: (value) => (mailboxFilters.otpOnly = value),
    setUnreadOnly: (value) => (mailboxFilters.unreadOnly = value),
    setHasAttachment: (value) => (mailboxFilters.hasAttachment = value),
    setSenderDomain: (value) => (mailboxFilters.senderDomain = value),
    setSenderEmail: (value) => (mailboxFilters.senderEmail = value),
    setRecipient: (value) => (mailboxFilters.recipient = value),
    setSubject: (value) => (mailboxFilters.subject = value),
    setNotSenderDomain: (value) => (mailboxFilters.notSenderDomain = value),
    setNotSenderEmail: (value) => (mailboxFilters.notSenderEmail = value),
    setNotRecipient: (value) => (mailboxFilters.notRecipient = value),
    setNotSubject: (value) => (mailboxFilters.notSubject = value),
    setSelectedSenders: (value) => (mailboxFilters.selectedSenders = value),
    setDateFrom: (value) => (mailboxFilters.dateFrom = value),
    setDateTo: (value) => (mailboxFilters.dateTo = value),
    setSortBy: (value) => (mailboxFilters.sortBy = value),
    showToast: (message, type) => showToast(message, type),
  },
});
const { loadSavedSearchFilters, saveFilter, renameFilter, loadFilter, clearFilters, deleteFilter } =
  searchFilterController;

const stopExtensionStorageSync = useExtensionStorageSync([
  {
    keys: SETTINGS_SYNC_KEYS,
    onChange: async (changes) => {
      // Fast-path the accent-color echo: the picking context already holds
      // canonical state, so apply the event's newValue directly. A full
      // loadSettings() round-trip here can resolve with a STALE value when
      // picks arrive faster than the 400ms settings-write debounce (the
      // native color input fires oninput per mousemove while dragging),
      // visibly snapping the accent color backwards on its own.
      if (changes.customColor && Object.keys(changes).length === 1) {
        const v = changes.customColor.newValue;
        if (typeof v === 'string') {
          settingsDomainSetters.setCustomColor(v);
          await applyCustomColor(v);
        }
        return;
      }
      await loadSettings();
      await loadProviderInstances();
    },
  },
  { keys: THEME_SYNC_KEYS, onChange: syncThemeSettings },
  {
    keys: ['addressColors'],
    onChange: (changes) => {
      const value = changes.addressColors?.newValue;
      addressColors =
        typeof value === 'object' && value !== null && !Array.isArray(value)
          ? Object.fromEntries(
              Object.entries(value).filter(
                ([, color]) => typeof color === 'string' && /^#[\da-f]{6}$/i.test(color)
              )
            )
          : {};
    },
  },
  {
    keys: TOAST_SYNC_KEYS,
    onChange: (changes) => {
      const v = changes.toastsEnabled?.newValue;
      toastStore.setEnabled(v !== false);
    },
  },
  { keys: INBOX_SYNC_KEYS, onChange: () => loadAddresses(true) },
  { keys: IDENTITY_SYNC_KEYS, onChange: loadIdentities },
  { keys: FILTER_SYNC_KEYS, onChange: loadSavedSearchFilters },
  { keys: ANALYTICS_SYNC_KEYS, onChange: loadAnalytics },
  { keys: LOGIN_INFO_SYNC_KEYS, onChange: () => loadLoginInfo() },
  { keys: READ_EMAILS_SYNC_KEYS, onChange: updateUnreadByAddress },
]);

// Plain let - must NOT be $state (read+write in same effect → infinite loop)
let _lastAppliedColor = '';
let cleanupMountedResources = () => {};
/** Print intent handed off from popup/sidepanel: prepared HTML + subject for the app tab's print bar. */

$effect(() => {
  const enabled = addressColorThemeEnabled;
  const address = displayedEmail || selectedEmail;
  const account =
    allAddresses.find((a) => a.address === selectedEmail || a.address === address) ||
    accounts.find((a) => a.address === selectedEmail || a.address === address);
  const addressId = account?.id;
  const fallback = customColor;
  // Key by inbox id so domain swaps never recolor the theme
  let activeColor = '';
  if (enabled) {
    activeColor =
      (addressId && addressColors[addressId]) ||
      (address ? addressColors[address] || '' : '') ||
      '';
    if (!activeColor && (address || addressId)) {
      activeColor = untrack(() =>
        getAddressColorAction(address || '', addressId, addressColors, customColor, (updater) => {
          // Serialized: the same map is written by the domain-rewrite
          // migration, so this persist must edit what storage holds NOW.
          void updateAddressColors((current) => {
            const next = updater(current);
            addressColors = next;
            return next;
          });
        })
      );
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
/** Browser zoom is intentionally disabled for the extension UI - it is
 * viewport-wide and would scale headers, toolbars and sidebars along with the
 * content. The ONLY exception is the mail body itself: when a zoom gesture
 * (Ctrl+wheel / Ctrl+=/-/0) lands over an `.email-body` host, the browser zoom
 * is still blocked and the same step is re-applied as a scoped CSS `zoom` on
 * that host only (see @/utils/email/email-body-zoom.js). composedPath() includes
 * nodes inside EmailBody's open shadow root, which keeps this exception
 * working across browsers. */
let globalZoomScale = $state(1);
let pageZoomSettings = $state<PageZoomSettings>({});

function applyGlobalZoom(): void {
  if (!layoutRootEl) return;
  const pageSettings = getPageZoomSetting(pageZoomSettings, activeViewForExpand, globalZoomScale);
  if (globalZoomEnabled && pageSettings.enabled && pageSettings.scale !== 1) {
    layoutRootEl.style.zoom = String(pageSettings.scale);
  } else {
    layoutRootEl.style.removeProperty('zoom');
  }
}

function persistPageZoomSettings(nextSettings: PageZoomSettings): void {
  pageZoomSettings = nextSettings;
  void writeWithRetry({ pageZoomSettings });
  applyGlobalZoom();
}

function togglePageZoom(view: View, enabled: boolean): void {
  persistPageZoomSettings(
    updatePageZoomSetting(pageZoomSettings, view, { enabled }, globalZoomScale)
  );
}

function adjustPageZoom(view: View, direction: PageZoomDirection): void {
  persistPageZoomSettings(changeStoredPageZoom(pageZoomSettings, view, direction, globalZoomScale));
}

function changeCurrentPageZoom(direction: PageZoomDirection): void {
  adjustPageZoom(activeViewForExpand, direction);
}

$effect(() => {
  void globalZoomEnabled;
  void globalZoomScale;
  void pageZoomSettings;
  void activeViewForExpand;
  applyGlobalZoom();
});

onMount(() => {
  const syncZoomSettings = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
    if (areaName !== 'local') return;
    if (changes.globalZoomScale) {
      globalZoomScale = normalizePageZoomScale(changes.globalZoomScale.newValue);
    }
    if (changes.pageZoomSettings) {
      pageZoomSettings = normalizePageZoomSettings(changes.pageZoomSettings.newValue);
    }
  };

  browser.storage.onChanged.addListener(syncZoomSettings);
  return () => browser.storage.onChanged.removeListener(syncZoomSettings);
});

function preventUiZoom(event: KeyboardEvent): void {
  if (!(event.ctrlKey || event.metaKey)) return;
  const isZoomIn = event.key === '+' || event.key === '=' || event.code === 'NumpadAdd';
  const isZoomOut = event.key === '-' || event.key === '_' || event.code === 'NumpadSubtract';
  const isZoomReset = event.key === '0' || event.code === 'Numpad0';
  if (!isZoomIn && !isZoomOut && !isZoomReset) return;
  event.preventDefault();
  if (globalZoomEnabled) {
    const pageSettings = getPageZoomSetting(pageZoomSettings, activeViewForExpand, globalZoomScale);
    if (pageSettings.enabled) {
      changeCurrentPageZoom(isZoomReset ? 0 : isZoomIn ? 1 : -1);
    }
    return;
  }
  const host = findEmailBodyHost(event);
  if (!host) return;
  if (isZoomReset) resetEmailBodyZoom(host);
  else stepEmailBodyZoom(host, isZoomIn ? 1 : -1);
}

function preventUiWheelZoom(event: WheelEvent): void {
  if (!event.ctrlKey) return;
  event.preventDefault();
  if (globalZoomEnabled) {
    const pageSettings = getPageZoomSetting(pageZoomSettings, activeViewForExpand, globalZoomScale);
    if (pageSettings.enabled) {
      changeCurrentPageZoom(event.deltaY < 0 ? 1 : -1);
    }
    return;
  }
  const host = findEmailBodyHost(event);
  if (!host) return;
  stepEmailBodyZoom(host, event.deltaY < 0 ? 1 : -1);
}

onMount(async () => {
  window.addEventListener('keydown', keyboardTooltipController.handleKeydown);
  window.addEventListener('keyup', keyboardTooltipController.handleKeyup);
  window.addEventListener('blur', keyboardTooltipController.clearDiscovery);
  window.addEventListener('keydown', preventUiZoom, { capture: true });
  window.addEventListener('wheel', preventUiWheelZoom, { capture: true, passive: false });
  try {
    const stored = (await browser.storage.local.get(['globalZoomScale', 'pageZoomSettings'])) as {
      globalZoomScale?: unknown;
      pageZoomSettings?: unknown;
    };
    if (typeof stored.globalZoomScale === 'number' && Number.isFinite(stored.globalZoomScale)) {
      globalZoomScale = normalizePageZoomScale(stored.globalZoomScale);
    }
    pageZoomSettings = normalizePageZoomSettings(stored.pageZoomSettings);
  } catch {
    /* ignore non-critical zoom preference */
  }
  const cleanups: (() => void)[] = [];

  // Start the address bootstrap early; the UI stays behind the explicit gate
  // (addressBootstrapReady below) until the address state is known.
  const initialAddressLoad = setupAddressBootstrap();
  await recordExtensionOpens();

  // Popup/content-script handoffs: open view, print intent, live navigation
  cleanups.push(await setupViewHandoff());

  // Content-script prompts (setup/renew reason, return-to-form) + import backup
  cleanups.push(...(await handleContentScriptPrompts()));

  // Locale preload, product-tour flags, misc settings restore
  cleanups.push(...(await preloadLocaleAndMisc()));

  // Email sync controller + storage/runtime listeners + backup poll
  const emailSync = setupEmailSync();
  cleanups.push(emailSync.cleanup);

  // Restore theme settings from storage
  await restoreThemeFromStorage(
    ext,
    (v) => (themeMode = v),
    (v) => (contrastLevel = v),
    () => themeController.applyTheme(),
    () => customColor
  );

  await initialAddressLoad;
  addressBootstrapReady = true;

  // Hydrate emails/address metadata behind the bootstrap gate, then run the
  // post-bootstrap loads (settings, saved filters, analytics, retention).
  const hydration = startEmailHydration(emailSync.syncEmailsFromStorage);
  await loadPostBootstrapData(hydration.initialMetadataHydration);

  const appStateRestore = createAppStateRestoreController({
    ext,
    context,
    getLayoutSplit: () => layoutSplit,
    getLayoutVerticalSplit: () => layoutVerticalSplit,
    getAllAddresses: () => allAddresses,
    getEmails: () => emails,
    getCurrentView: () => currentView,
    setCurrentView: (value) => (currentView = value),
    setSettingsSubpage: (value) => (settingsSubpage = value),
    setPreviousViewBeforeSubpage: (value) => (previousViewBeforeSubpage = value),
    setMgmtTab: (value) => (mgmtTab = value),
    setAutofillTab: (value) => {
      autofillTabValue = value;
      autofillTabSignal += 1;
    },
    setOrganizeTab: (value) => {
      organizeTabValue = value;
      organizeTabSignal += 1;
    },
    setMgmtSearch: (value) => (mgmtSearch = value),
    setArchivedSearch: (value) => (archivedSearch = value),
    setSelectedThread: (value) => (selectedThread = value),
    setCurrentEmailDetail: (value) => (currentEmailDetail = value),
    setSplitSecondaryView: (value) => (splitSecondaryView = value),
    setMailProviderSplitOpen: (value) => (mailProviderSplitOpen = value),
    setSplitPaneCollapsed: (value) => (splitPaneCollapsed = value),
    setLoading: (value) => (loading = value),
    selectAddress,
    checkMessages,
    openMessageDetail,
    evaluateProviderFailoverAfterRefresh,
    tick,
  });
  cleanups.push(appStateRestore.stop);
  const restoredThread = await appStateRestore.restore(hydration.initialEmailHydration);

  // Form presence badge + OTP runtime toasts
  cleanups.push(await setupFormDetectionAndOtp());

  cleanupMountedResources = () => {
    window.removeEventListener('keydown', keyboardTooltipController.handleKeydown);
    window.removeEventListener('keyup', keyboardTooltipController.handleKeyup);
    window.removeEventListener('blur', keyboardTooltipController.clearDiscovery);
    keyboardTooltipController.clearDiscovery();
    window.removeEventListener('keydown', preventUiZoom, { capture: true });
    window.removeEventListener('wheel', preventUiWheelZoom, { capture: true });
    cleanupSystemThemeListener();
    for (const cleanup of cleanups.reverse()) {
      cleanup();
    }
  };
});

/** Provider overrides + non-blocking address bootstrap (UI waits on the gate). */
async function setupAddressBootstrap() {
  // Apply user provider JSON overrides (if any) before loading addresses
  try {
    await loadProviderOverridesFromStorage(browser);
  } catch {
    /* keep bundled providers */
  }

  // Start the address bootstrap as soon as provider overrides are available.
  // Other startup work can continue while this resolves, but the UI remains
  // behind the explicit bootstrap gate until the address state is known.
  return addressActions.loadAddresses(undefined, {
    deferEmailCounts: true,
  });
}

/**
 * Usage stats: count this UI open in the background (`recordExtensionOpen`).
 *
 * The background OWNS the `analytics` record - it increments the same key
 * under `analytics_lock` for page visits, read mail, fetch timings and storage
 * trends (`background/address/analytics.ts`) - so the count is made there. The
 * local whole-key write this replaces read the record, added one, and wrote it
 * back: every count the background made in that window (from any surface, or
 * from another open popup) was overwritten by the stale copy. `getAnalytics`
 * already reads the key back through the same background module, so the two
 * halves of the counter now agree on who writes it.
 *
 * Fire-and-forget: a usage counter must never hold the shell's boot on a cold
 * service worker, and a rejected send is not worth an error to the user.
 */
function recordExtensionOpens(): void {
  browser.runtime.sendMessage({ type: 'recordExtensionOpen' }).catch(/* ignore */);
}

/** Popup/content-script handoffs: open view, print intent, live navigation. */
async function setupViewHandoff(): Promise<() => void> {
  // Print intent from popup/sidepanel - delegated to print-intent module
  const handlePrintIntent = () =>
    handlePrintIntentFn(
      context,
      (m, t) => showToast(m, t as ToastType | undefined),
      (key) => $t(key) as string
    );

  // Content-script / context-menu handoff - delegated to view-handoff module
  const _viewHandoffDeps = {
    ext,
    context,
    setCurrentView: (v: string) => {
      // view-handoff validates, but this is the last line of defense: an
      // unknown id here would blank the main pane (AppShell renders the
      // `{:else}` fallback content only for `mailbox`).
      currentView = isView(v) ? v : 'mailbox';
    },
    setAutofillTabValue: (v: 'profiles' | 'credentials' | 'sites') => {
      autofillTabValue = v;
    },
    incrementAutofillTabSignal: () => {
      autofillTabSignal += 1;
    },
    incrementIdentityCreateSignal: () => {
      identityCreateSignal += 1;
    },
    setIdentityEditIdSignal: (v: string) => {
      identityEditIdSignal = v;
    },
    setSelectedEmail: (v: string) => {
      selectedEmail = v;
    },
    setDisplayedEmail: (v: string) => {
      displayedEmail = v;
    },
    tick: async () => {
      await tick();
    },
  };
  const applyOpenViewHandoff = (forced?: Parameters<typeof applyOpenViewHandoffFn>[1]) =>
    applyOpenViewHandoffFn(_viewHandoffDeps, forced);

  try {
    await applyOpenViewHandoff();
  } catch {
    /* ignore */
  }

  void handlePrintIntent();

  // Live navigation from context menu / content identity handoff while UI is already open
  try {
    const onNavigateViewMessage = (message: unknown, sender: { url?: string }) => {
      if (!sender.url?.startsWith(location.origin)) return;
      if (!message || typeof message !== 'object') return;
      const m = message as {
        type?: string;
        view?: string;
        openView?: string;
        openIdentityCreate?: boolean;
        openIdentityEditId?: string;
        autofillTab?: string;
      };
      if (
        m.type === 'navigateView' &&
        (m.view || m.openView || m.openIdentityCreate || m.openIdentityEditId)
      ) {
        void (async () => {
          try {
            // Apply extras directly - do not only set openView (that dropped create/edit)
            await applyOpenViewHandoff({
              openView:
                m.view ||
                m.openView ||
                (m.openIdentityCreate || m.openIdentityEditId ? 'autofill' : ''),
              openIdentityCreate: !!m.openIdentityCreate,
              openIdentityEditId: m.openIdentityEditId || '',
              autofillTab:
                m.autofillTab || (m.openIdentityCreate || m.openIdentityEditId ? 'profiles' : ''),
            });
          } catch {
            /* ignore */
          }
        })();
      }
    };
    browser.runtime.onMessage.addListener(onNavigateViewMessage);
    const onOpenViewChanges = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area !== 'local' && area !== 'session') return;
      if (
        changes.openView ||
        changes.openViewAt ||
        changes.activeAddressId ||
        changes.openIdentityCreate ||
        changes.openIdentityEditId ||
        changes.autofillTab
      ) {
        // A popup-targeted identity handoff belongs exclusively to the popup.
        if (context !== 'popup' && changes.openExtensionTarget?.newValue === 'popup') return;
        void applyOpenViewHandoff();
      }
    };
    browser.storage.onChanged.addListener(onOpenViewChanges);
    return () => {
      browser.runtime.onMessage.removeListener(onNavigateViewMessage);
      browser.storage.onChanged.removeListener(onOpenViewChanges);
    };
  } catch {
    /* ignore */
  }

  return () => {};
}

/** Content-script prompts (setup/renew reason, return-to-form) + import-backup flag. */
async function handleContentScriptPrompts(): Promise<(() => void)[]> {
  const cleanups: (() => void)[] = [];
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
      if (reason) {
        await browser.storage.session.remove([
          'openExtensionReason',
          'openExtensionHint',
          'openExtensionAt',
        ]);
        // Mirror cleanup: openExtensionUiInternal writes these keys (plus the
        // openExtensionAt timestamp marker) to session - and to local ONLY when
        // session storage is unavailable (session-less browsers). Purge local
        // with the consume so a session-less fallback copy can never replay a
        // stale handoff on a later open (write-once, read-once).
        await browser.storage.local.remove([
          'openExtensionReason',
          'openExtensionHint',
          'openExtensionAt',
        ]);
      }
    } catch {
      /* ignore */
      const s = (await browser.storage.local.get(['openExtensionReason', 'openExtensionHint'])) as {
        openExtensionReason?: string;
        openExtensionHint?: string;
      };
      reason = s.openExtensionReason || '';
      hint = s.openExtensionHint || '';
      if (reason)
        await browser.storage.local.remove([
          'openExtensionReason',
          'openExtensionHint',
          'openExtensionAt',
        ]);
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
    const onAddressReady = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area !== 'local' || !changes.addresses) return;
      void (async () => {
        try {
          const flags = (await browser.storage.session.get(['pendingAutofillReturn'])) as {
            pendingAutofillReturn?: boolean;
          };
          if (!flags.pendingAutofillReturn) return;
          const list = changes.addresses.newValue as unknown[];
          if (Array.isArray(list) && list.length > 0) {
            showToast($t('contentAutofill.returnToForm'), 'success');
            await browser.storage.session.remove([
              'pendingAutofillReturn',
              'pendingAutofillUrl',
              'pendingAutofillAt',
            ]);
            // Purge legacy persistent copies: older builds wrote these keys to
            // storage.local via setStorageViaBg before the session-handoff fix.
            await browser.storage.local.remove([
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
    browser.storage.onChanged.addListener(onAddressReady);
    cleanups.push(() => browser.storage.onChanged.removeListener(onAddressReady));
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
        // openImportAt is the write-once timestamp marker: purge it with the
        // flag so no stale copy lingers in session (local already handles it).
        if (flag) await browser.storage.session.remove(['openImportBackup', 'openImportAt']);
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
        overlaySetters.setShowImportBackupDialog(true);
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
    cleanups.push(() => browser.storage.onChanged.removeListener(onImportFlag));
  } catch {
    /* ignore */
  }

  return cleanups;
}

/** Locale preload, product-tour flags, thread grouping, quota banner, blocklist. */
async function preloadLocaleAndMisc(): Promise<(() => void)[]> {
  const cleanups: (() => void)[] = [];
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
          await loadAddresses(true);
          await startProductTour();
        })();
      }
    };
    browser.storage.onChanged.addListener(onTourFlag);
    cleanups.push(() => browser.storage.onChanged.removeListener(onTourFlag));
  } catch {
    /* ignore */
  }

  // Resume interactive product tour only after at least one real/demo inbox exists
  try {
    const pending = await isPendingProductTour();
    const done = await isProductTourCompleted();
    const { addresses: tourAddresses = [] } = (await browser.storage.local.get(['addresses'])) as {
      addresses?: Address[];
    };
    const hasAddress = Array.isArray(tourAddresses) && tourAddresses.length > 0;
    if (pending && !done && hasAddress) {
      setTimeout(() => {
        void startProductTour();
      }, 400);
    } else if (pending && !hasAddress) {
      // Wait until first address is created (onboarding) - do not show tour on empty shell
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
    autofillBlocklist = await getAutofillBlocklist();
  } catch (error) {
    logDebug(`Could not load autofill blocklist: ${String(error)}`);
  }

  return cleanups;
}

/** Email sync controller + storage/runtime listeners + backup storage poll. */
function setupEmailSync(): {
  syncEmailsFromStorage: (reason: 'change' | 'poll' | 'initial') => Promise<void>;
  cleanup: () => void;
} {
  /**
   * Apply storedEmails → UI - delegated to email-sync module.
   * The controller adds staleness guards so a slow read never overwrites
   * a newer result after the user already switched mailboxes.
   */
  const _emailSyncCtrl = createEmailSyncController({
    ext,
    getSelectedEmail: () => selectedEmail,
    getDisplayedEmail: () => displayedEmail,
    getAllAddresses: () => allAddresses,
    getEmails: () => emails,
    context,
    setAllStoredEmails: (v) => {
      allStoredEmails = v;
    },
    setEmails: (v) => {
      addressSetters.setEmails(v);
    },
    setLatestOtp: (v) => {
      addressSetters.setLatestOtp(v);
    },
    setLatestOtpSender: (v) => {
      addressSetters.setLatestOtpSender(v);
    },
    setLatestOtpSenderName: (v) => {
      addressSetters.setLatestOtpSenderName(v);
    },
    setOtpContext: (v) => {
      addressSetters.setOtpContext(v);
    },
    refreshUnreadCounts: () => updateUnreadByAddress(),
  });
  const syncEmailsFromStorage = (reason: 'change' | 'poll' | 'initial') =>
    _emailSyncCtrl.sync(reason);

  // Listen for storedEmails storage changes (set by background periodic check)
  const handleStorageChange = async (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>
  ) => {
    // Empty bags are omitted from broad count projections. Apply the changed
    // bag itself so retained tabs can observe deletion, including inactive
    // inboxes and a context whose visible-mailbox refresh is currently paused.
    for (const [key, change] of Object.entries(changes)) {
      if (!key.startsWith('storedEmailsByAddress_')) continue;
      let ownerKey: string;
      try {
        ownerKey = decodeURIComponent(key.slice('storedEmailsByAddress_'.length));
      } catch {
        // A malformed unrelated storage key cannot identify an open inbox.
        continue;
      }
      const owner = allAddresses.find(
        (address) => address.id === ownerKey || address.address === ownerKey
      )?.address;
      if (owner && (change.newValue === undefined || Array.isArray(change.newValue)))
        allStoredEmails = { ...allStoredEmails, [owner]: (change.newValue as Email[]) || [] };
    }
    const hasEmailStorageChange = Object.keys(changes).some(
      (key) =>
        key === 'readEmails' ||
        key === 'addresses' ||
        key.startsWith('storedEmailsByAddress_') ||
        key.startsWith('archivedEmailsByAddress_')
    );
    if (hasEmailStorageChange && selectedEmail) {
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

  // A visible app/sidepanel refreshes the selected mailbox from the background
  // on the persisted cadence. Popup remains storage-driven because it is short
  // lived; this prevents hidden surfaces from creating provider traffic.
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshGeneration = 0;
  let refreshIntervalMs = 0;

  const clearRefreshTimer = () => {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  };
  const scheduleVisibleRefresh = () => {
    clearRefreshTimer();
    if (
      context === 'popup' ||
      typeof document === 'undefined' ||
      document.visibilityState !== 'visible'
    ) {
      return;
    }
    if (refreshIntervalMs <= 0) return;
    const generation = ++refreshGeneration;
    refreshTimer = setTimeout(async () => {
      refreshTimer = null;
      if (generation !== refreshGeneration || document.visibilityState !== 'visible') return;
      try {
        const address = allAddresses.find(
          (candidate) => candidate.address.toLowerCase() === selectedEmail.toLowerCase()
        );
        if (address) await checkMessages(address.id);
      } finally {
        if (generation === refreshGeneration) {
          scheduleVisibleRefresh();
        }
      }
    }, refreshIntervalMs);
  };
  const loadRefreshInterval = async () => {
    try {
      refreshIntervalMs = await getAutoRefreshInterval();
      scheduleVisibleRefresh();
    } catch (error) {
      logError('Failed to load mailbox refresh interval', error);
    }
  };
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      void syncEmailsFromStorage('change');
      void loadRefreshInterval();
    } else {
      ++refreshGeneration;
      clearRefreshTimer();
    }
  };
  const handleRefreshSettingChange = (
    changes: Record<string, { newValue?: unknown }>,
    area: string
  ) => {
    if (area !== 'local' || !changes.autoRefreshInterval) return;
    const value = changes.autoRefreshInterval.newValue;
    refreshIntervalMs =
      typeof value === 'number' && Number.isFinite(value)
        ? value === 0
          ? 0
          : Math.max(10_000, Math.min(3_600_000, value))
        : 30_000;
    scheduleVisibleRefresh();
  };
  if (typeof document !== 'undefined')
    document.addEventListener('visibilitychange', handleVisibilityChange);
  browser.storage.onChanged.addListener(handleRefreshSettingChange);
  void loadRefreshInterval();

  return {
    syncEmailsFromStorage,
    cleanup: () => {
      browser.storage.onChanged.removeListener(handleStorageChange);
      browser.storage.onChanged.removeListener(handleBlocklistChange);
      browser.storage.onChanged.removeListener(handleRefreshSettingChange);
      browser.runtime.onMessage.removeListener(handleContentMessage);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      _emailSyncCtrl.cancel();
      ++refreshGeneration;
      clearRefreshTimer();
    },
  };
}

/** Deferred mailbox metadata hydration behind the bootstrap gate. */
function startEmailHydration(
  syncEmailsFromStorage: (reason: 'change' | 'poll' | 'initial') => Promise<void>
) {
  // Start broad legacy-map hydration only after the active shell is eligible to
  // render. This keeps inactive-mailbox counts and cached-message deserialization
  // off the critical address/bootstrap path while preserving the current storage
  // schema and its backup compatibility. Keep the mailbox list in its existing
  // skeleton state until this first cached-data pass completes, avoiding an
  // empty-mailbox flash between the two bootstrap stages.
  loadingEmails = true;
  const initialEmailHydration = syncEmailsFromStorage('initial').finally(() => {
    loadingEmails = false;
  });
  // Do not hold the active mailbox skeleton for inactive-mailbox counts. The
  // broad logical-map pass updates badges and address totals after first paint.
  const initialMetadataHydration = initialEmailHydration.then(() => updateUnreadByAddress());
  void initialMetadataHydration.catch((error) => {
    logError('Deferred mailbox metadata hydration failed', error);
  });
  return { initialEmailHydration, initialMetadataHydration };
}

/** Post-bootstrap loads (settings, saved filters, analytics, retention). */
async function loadPostBootstrapData(initialMetadataHydration: Promise<unknown>) {
  await loadSettings();
  await loadSavedSearchFilters();
  await loadAnalytics();
  // Reuse the already-hydrated global map instead of deserializing it again for
  // the retention prompt during the same startup pass. If hydration failed,
  // leave the override unset so the retention check preserves its full-read
  // fallback rather than undercounting stale mail.
  const metadataHydrated = await initialMetadataHydration.catch((error) => {
    logError('Initial mailbox metadata hydration failed before retention check', error);
    return false;
  });
  await checkRetentionCleanup(metadataHydrated ? allStoredEmails : undefined);
}

/** Form presence badge + OTP runtime toast messages. */
async function setupFormDetectionAndOtp(): Promise<() => void> {
  // Keep the form-presence badge synchronized with the active tab. OTP-related
  // runtime messages remain handled by the layout because they drive toasts.
  await formDetectionController.start();
  const handleOtpRuntimeMessage = (message: unknown) => {
    if (
      !message ||
      typeof message !== 'object' ||
      !('type' in message) ||
      ((message as { type?: string }).type !== 'otpCopied' &&
        (message as { type?: string }).type !== 'otpAutoCopied')
    ) {
      return;
    }
    const typed = message as { type: 'otpCopied' | 'otpAutoCopied'; ok?: boolean };
    const ok = !!typed.ok;
    showToast(
      typed.type === 'otpCopied'
        ? ok
          ? $t('inbox.otpCopied')
          : $t('toasts.otpCopyFailed')
        : ok
          ? $t('toasts.otpAutoCopied')
          : $t('toasts.otpCopyFailed'),
      ok ? 'success' : 'error'
    );
  };
  ext.runtime.onMessage.addListener(handleOtpRuntimeMessage);

  // Background vault auto-lock (idle timer / rotation): toast the lock and
  // bump the refresh signal so vault-dependent views (saved-logins list)
  // re-read the lock state instead of showing stale unlocked data.
  const handleVaultLockMessage = (message: unknown) => {
    if ((message as { type?: string })?.type !== 'vaultLocked') return;
    vaultLockSignal += 1;
    showToast($t('savedLoginInfo.vaultLockedTitle'));
  };
  ext.runtime.onMessage.addListener(handleVaultLockMessage);

  return () => {
    formDetectionController.stop();
    ext.runtime.onMessage.removeListener(handleOtpRuntimeMessage);
    ext.runtime.onMessage.removeListener(handleVaultLockMessage);
  };
}

onDestroy(() => {
  keyboardTooltipController.clearDiscovery();
  stopExtensionStorageSync();
  cleanupMountedResources();
  confirmController.dispose();
});

let paletteCommands = $derived.by((): PaletteCommand[] => {
  const go = (view: View) => {
    accountSelectorDropdownOpen = false;
    currentView = view;
  };
  const navigationCommands: PaletteCommand[] = [
    {
      id: 'mailbox',
      label: $t('nav.mailbox') as string,
      icon: 'mail',
      keywords: 'inbox mail messages',
      run: () => go('mailbox'),
    },
    {
      id: 'addresses',
      label: $t('nav.addresses') as string,
      icon: 'inbox',
      keywords: 'manage addresses',
      run: () => go('addresses'),
    },
    {
      id: 'autofill',
      label: $t('nav.autofill') as string,
      icon: 'editSquare',
      keywords: 'identities profiles',
      run: () => go('autofill'),
    },
    {
      id: 'sites',
      label: $t('nav.sites') as string,
      icon: 'globe',
      keywords: 'website login account domain',
      run: () => {
        autofillTabValue = 'sites';
        autofillTabSignal += 1;
        go('autofill');
      },
    },
    {
      id: 'settings',
      label: $t('common.settings') as string,
      icon: 'settings',
      keywords: 'preferences configuration options',
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
      label: $t('address.newMailAddress') as string,
      icon: 'add',
      keywords: 'new address generate',
      run: () => openCreateAddressDialog(),
    },
    {
      id: 'search',
      label: $t('inbox.focusSearch') as string,
      icon: 'search',
      keywords: 'find filter',
      hint: '/',
      run: () => {
        if (currentView !== 'mailbox') currentView = 'mailbox';
        queueMicrotask(() => void keyboardTooltipController.focusAppSearch());
      },
    },
    {
      id: 'refresh',
      label: $t('common.refresh') as string,
      icon: 'refresh',
      keywords: 'reload',
      run: () => void refreshMailbox(),
    },
    {
      id: 'shortcuts',
      label: $t('nav.keyboardShortcuts') as string,
      icon: 'key',
      keywords: 'cheat sheet help',
      hint: '?',
      run: () => {
        overlaySetters.setCheatSheetOpen(true);
      },
    },
  ];

  const credentialCommands: PaletteCommand[] = savedLogins.map((login, index) => {
    const website = login.website || login.domain || '';
    let domain = login.domain || website;
    try {
      if (website.startsWith('http')) domain = new URL(website).hostname;
    } catch {
      /* Keep the stored domain when the website value is malformed. */
    }
    const query = domain || login.email || login.username || '';
    return {
      id: `credential:${login.id ?? `${domain}:${login.timestamp}:${index}`}`,
      label: domain || login.email || login.username || $t('nav.credentials'),
      hint: $t('nav.credentials') as string,
      icon: 'lock',
      queryOnly: true,
      keywords: `${login.website || ''} ${login.email || ''} ${login.username || ''} saved login credential password`,
      run: () => {
        paletteWebsiteFilter = query;
        paletteWebsiteFilterSignal += 1;
        loginInfoEmailFilter = '';
        autofillTabValue = 'credentials';
        autofillTabSignal += 1;
        go('autofill');
      },
    };
  });

  const addressById = new Map(allAddresses.map((address) => [address.id, address]));
  const addressByEmail = new Map(
    allAddresses.map((address) => [address.address.toLowerCase(), address])
  );
  const relatedAddressDomains = new Map<string, Set<string>>();
  for (const login of savedLogins) {
    const relatedAddress =
      (login.addressId ? addressById.get(login.addressId) : undefined) ??
      (login.email ? addressByEmail.get(login.email.toLowerCase()) : undefined);
    if (!relatedAddress) continue;
    const domains = relatedAddressDomains.get(relatedAddress.id) ?? new Set<string>();
    if (login.domain) domains.add(login.domain);
    if (login.website) domains.add(login.website);
    relatedAddressDomains.set(relatedAddress.id, domains);
  }

  const inboxCommands: PaletteCommand[] = allAddresses
    .filter((address) => relatedAddressDomains.has(address.id))
    .map((address) => {
      const domains = [...(relatedAddressDomains.get(address.id) ?? [])];
      return {
        id: `related-inbox:${address.id}`,
        label: address.address,
        hint: $t('nav.mailbox') as string,
        icon: 'mail',
        queryOnly: true,
        keywords: `${domains.join(' ')} related inbox email address mailbox`,
        run: () => {
          currentEmailDetail = address;
          void navigateFromAddressToMailbox();
        },
      };
    });

  return [
    ...navigationCommands,
    ...credentialCommands,
    ...inboxCommands,
    {
      id: 'export-backup',
      label: $t('backup.exportTitle') as string,
      icon: 'download',
      keywords: 'export backup data download save archive',
      run: () => exportData(),
    },
  ];
});

// --- Keyboard shortcuts ---
// --- Global Tooltip Logic ---

$effect(() =>
  keyboardTooltipController.positionTooltip(overlayState.tooltipRef, overlayState.activeTooltip)
);

onMount(() => {
  // Global contextmenu lock: Disable native browser right-click everywhere across
  // Popup, Sidepanel, and Full App EXCEPT inside selectable message body content
  // ([data-selectable-text]), editable form controls (input, textarea, etc.), or
  // when the user already has an active text selection (right-click-to-copy).
  /** True when the target sits inside a selectable/editable region, walking
   * THROUGH shadow roots - the email body renders in a Shadow DOM (EmailBody)
   * where a plain `closest()` from a document listener can't see past the
   * boundary. Returns true if any ancestor up the composed tree matches. */
  const hitSelectableRegion = (target: EventTarget | null): boolean => {
    const SELECTABLE_SELECTOR =
      '[data-selectable-text], input, textarea, [contenteditable="true"], select';
    let node: Element | null = target instanceof Element ? target : null;
    while (node) {
      if (node.matches(SELECTABLE_SELECTOR)) return true;
      const root = node.getRootNode();
      node = root instanceof ShadowRoot ? (root.host as Element) : null;
    }
    return false;
  };
  const handleGlobalContextMenu = (e: MouseEvent) => {
    if (hitSelectableRegion(e.target)) {
      return; // Allow native context menu / text selection / input actions
    }
    // Allow the native menu when the user right-clicks an existing selection -
    // this keeps copy working on any read-only text (OTP, QR data, activity log,
    // email headers) without having to tag every element with data-selectable-text.
    if (typeof window.getSelection === 'function') {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) {
        return;
      }
    }
    e.preventDefault();
  };
  window.addEventListener('contextmenu', handleGlobalContextMenu, { capture: true });

  window.addEventListener('mouseover', keyboardTooltipController.handleMouseOver, {
    passive: true,
  });
  window.addEventListener('mouseout', keyboardTooltipController.handleMouseOut, { passive: true });
  window.addEventListener('mousedown', keyboardTooltipController.clearTooltip, { passive: true });
  window.addEventListener('scroll', keyboardTooltipController.clearTooltip, {
    capture: true,
    passive: true,
  });

  // The $effect teardown below does NOT run when the popup/sidepanel window
  // itself closes - without this, queued read-state ops die in the debounce
  // timer. flushQueuedEmailReadState runs its sync prefix (clear timer, drain
  // ops, enqueue the write) synchronously, so pagehide still dispatches it.
  // Debounced settings toggles have the same stranding window, so they flush
  // alongside (synchronous dispatch; a failed write re-queues for next time).
  const handlePagehide = () => {
    void flushQueuedEmailReadState().catch(() => {
      // The flush already logs and retains failed operations in this context.
    });
    flushPendingSettingsWrites(browser);
  };
  window.addEventListener('pagehide', handlePagehide);

  layoutMeasurementController.start();

  // Layout measurement, resize scheduling, and preference hydration are owned by
  // the dedicated controller above.
  return () => {
    void flushQueuedEmailReadState().catch(() => {
      // The flush already logs and retains failed operations in this context.
    });
    flushPendingSettingsWrites(browser);
    window.removeEventListener('pagehide', handlePagehide);
    window.removeEventListener('contextmenu', handleGlobalContextMenu, { capture: true });
    layoutMeasurementController.stop();
  };
});

// Start observing the footer's actual rendered element once bind:this resolves.
// NOTE: bottomFloatingLayerEl has height=0 because its child (footer-float) is
// position:absolute, so we must query the inner .footer-float div which has real height.
$effect(() => {
  const el = bottomFloatingLayerEl;
  if (!el || typeof ResizeObserver === 'undefined') return;
  // Prefer the inner footer-float (has real block height) over the wrapper (height=0).
  const target = el.querySelector('.footer-float') ?? el;
  const badge = overlayState.demoModeActive ? el.querySelector('[data-demo-exit]') : null;
  const measure = () => {
    const rect = target.getBoundingClientRect();
    // The demo exit control floats above the island and must not cover a dock
    // or a selected-items strip. Include its measured bounds in the safe area.
    const badgeHeight = badge
      ? el.getBoundingClientRect().bottom - badge.getBoundingClientRect().top
      : 0;
    // Scroll-hide translates the island; its translation must not change this reserve.
    const height = Math.max(36, Math.ceil(Math.max(rect.height, badgeHeight)));
    if (height !== bottomSafeAreaPx) {
      bottomSafeAreaPx = height;
    }
  };
  const releaseFooter = observeResizeOnFrame(target, measure);
  const releaseBadge = badge ? observeResizeOnFrame(badge, measure) : undefined;
  measure();
  return () => {
    releaseFooter();
    releaseBadge?.();
  };
});

onDestroy(() => {
  if (scrollChromeTimer) {
    clearTimeout(scrollChromeTimer);
    scrollChromeTimer = null;
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('mouseover', keyboardTooltipController.handleMouseOver);
    window.removeEventListener('mouseout', keyboardTooltipController.handleMouseOut);
    window.removeEventListener('mousedown', keyboardTooltipController.clearTooltip);
    window.removeEventListener('scroll', keyboardTooltipController.clearTooltip, { capture: true });
  }
});
// Register after all layout state is initialized: pre-effects run immediately.
// Snapshot the outgoing scroller before detaching it (detached scrollTop is 0).
$effect.pre(() => {
  const nextKey = activeMessageTabKey;
  const hiding =
    !(layoutSplit || layoutVerticalSplit) ||
    splitPaneCollapsed ||
    (layoutVerticalSplit && $activeSelectionStore?.surface === 'mailbox') ||
    currentView !== 'mailbox';
  untrack(() => {
    const node = document.querySelector<HTMLElement>(
      '[data-message-tab-panel] [data-message-scroll]'
    );
    const key = node?.dataset.messageScrollKey;
    if (node && key && (hiding || key !== nextKey)) onMessageScroll(key, node.scrollTop);
  });
});
</script>

<ErrorBoundary>
  {#if shortcutDiscoveryOpen}
    <ShortcutDiscovery {currentView} {keybindings} hasMessages={activeNavigationList.length > 0} hasEmail={!!selectedEmail} hasOtp={!!latestOtp && latestOtp !== '------'} hasSelectableRows={Array.from(document.querySelectorAll<HTMLElement>('[data-selectable-row]')).some((row) => row.offsetParent !== null)} />
  {/if}
  <!--
    BINDING POLICY (audit 2026-09): AppShell declares these props as
    $bindable because the shell WRITES them internally (nav clicks, split
    panes, multi-select, tab deep-links, ...) while AppLayout OWNS them and
    consumes them in layout/keyboard/logic code. Passing them one-way
    silently desyncs the two copies - the keyboard controller then acted on
    a stale view (Escape-back broken after mouse navigation). Every prop
    below where BOTH sides write is therefore bound.

    Deliberately left one-way (AppLayout is a passive initializer and never
    reads the value back):
    - organizeTabValue/organizeTabSignal, tagCreateSignal, labelCreateSignal,
      savedLoginsFocusSignal - deep-link triggers fired only inside the
      shell's own nav/fab; AppLayout merely seeds defaults.
    - loginInfoEmailFilter, identitiesEmailFilter - cross-nav filters set
      by panes rendered inside the shell.
    - mailboxListTab, activeMailboxLabel - mailbox folder/label UI state owned by
      the shell's list layer. (A list's SELECTION is not threaded as a prop: each
      list publishes it into `@/utils/ui/selection-registry.js`, which is how the
      shell's one strip reaches lists rendered through other chains.)
    - sortBy, otpOnly, hasAttachment, senderDomain…dateTo - reactive projections of
      AppLayout mailboxFilters, derived rather than destructured once. List filtering
      must route through mailboxFilters.* setters (applySearchQuery etc.)
      so filteredEmails recomputes; binding the mirror would bypass the
      store, so these stay one-way by design.
  -->
  <AppShell
    {context}
    contentReloadRequiredTabId={reloadRequiredTabId}
    onReloadRequiredTab={reloadContentTab}
    bind:currentView={currentView}
    {layoutWide}
    {layoutSplit}
    {layoutVerticalSplit}
    {splitModeFlash}
    {showSplitPane}
    {splitPaneCollapsed}
    {sidebarCollapsed}
    {sidebarPosition}
    onToggleSidebarCollapse={toggleSidebarCollapse}
    onDensityChange={changeDensity}
    bind:splitListWidthPx={splitListWidthPx}
    bind:splitSecondaryView={splitSecondaryView}
    bind:mailProviderSplitOpen={mailProviderSplitOpen}
    bind:currentEmailDetail={currentEmailDetail}
    bind:selectedThread={selectedThread}
    openMessageTabs={messageTabs.tabs}
    {activeMessageTabKey}
    {selectMessageTab}
    {closeMessageTab}
    {onMessageScroll}
    bind:selectedAddresses={selectedAddresses}
    bind:mgmtTab={mgmtTab}
    bind:mgmtSearch={mgmtSearch}
    bind:settingsSubpage={settingsSubpage}
    bind:previousViewBeforeSubpage={previousViewBeforeSubpage}
    bind:accountSelectorDropdownOpen={accountSelectorDropdownOpen}
    {organizeTabValue}
    {organizeTabSignal}
    bind:autofillTabValue={autofillTabValue}
    bind:autofillTabSignal={autofillTabSignal}
    bind:paletteWebsiteFilter={paletteWebsiteFilter}
    bind:paletteWebsiteFilterSignal={paletteWebsiteFilterSignal}
    {tagCreateSignal}
    {labelCreateSignal}
    bind:identityCreateSignal={identityCreateSignal}
    {vaultLockSignal}
    {savedLoginsFocusSignal}
    bind:automationInitialSender={automationInitialSender}
    bind:displayedEmail={displayedEmail}
    {mailboxListTab}
    {activeMailboxLabel}
    {sortBy}
    {otpOnly}
    {unreadOnly}
    {hasAttachment}
    {senderDomain}
    {senderEmail}
    {recipient}
    {subject}
    {notSenderDomain}
    {notSenderEmail}
    {notRecipient}
    {notSubject}
    {selectedSenders}
    {dateFrom}
    {dateTo}
    settingsState={settings}
    settingsSetters={settingsDomainSetters}
    onApplyAutoRenewToAll={handleApplyAutoRenewToAll}
    {pageZoomSettings}
    {globalZoomScale}
    onTogglePageZoom={togglePageZoom}
    onChangePageZoom={adjustPageZoom}
    settingsActions={{
      updateAutoRefreshInterval,
      save: saveSettings,
      toggleDeveloperSettings,
      toggleEnableLogging,
      handleProviderChange,
      saveAutoCopy,
      saveAutoRenew,
      saveAutoRenewScope,
      saveAutoRenewWindowMinutes,
      handleColorChange,
      loadProviderInstances,
      addCustomInstance,
      hardReset,
    }}
    overlayState={overlays}
    overlaySetters={overlaySetters}
    overlayActions={{
      openQrDialog,
      closeQrDialog,
      downloadQrCode,
      copyQrImage,
      showConfirm,
      closeConfirm,
      startProductTour,
      finishProductTour,
      skipProductTour,
    }}
    {loginInfoEmailFilter}
    {identitiesEmailFilter}

    {accounts}
    {allAddresses}
    {unreadByAddress}
    {selectedProvider}
    {selectedEmail}
    {emails}
    {savedLogins}
    {allStoredEmails}
    {exportWizardAddress}
    {exportWizardMessages}
    {sidebarMailboxLabels}
    {mailboxLabelCounts}
    {mailboxFolderCounts}
    {sidebarLiveCount}
    {sidebarInactiveCount}
    {sidebarTagCount}
    {sidebarLabelCount}
    {sidebarFilterCount}
    {sidebarProfileCount}
    {sidebarCredentialCount}
    {mgmtAddresses}
    {allSelected}
    {loadingAddresses}
    {addressViewTagDialogOpen}
    {addressViewTagTarget}
    {addressViewTagTargets}
    {allExistingTags}
    {allTagAddresses}
    {allTagColors}
    {highlightAddress}
    {hasPrevMessage}
    {hasNextMessage}
    {analytics}
    {analyticsLoading}
    {savedSearchFilters}
    {identities}
    {selectedIdentityId}
    {identityEditIdSignal}
    {autofillBlocklist}
    {scrollChromeHidden}
    {searchQuery}
    {filteredEmails}
    {latestOtp}
    {latestOtpSender}
    {latestOtpSenderName}
    {otpContext}
    {formDetected}
    {humanVerificationRequired}
    {archivedSectionOpen}
    {providerFailoverHint}
    {archivedSearch}

    {confirmDialog}
    {paletteCommands}

    {retentionCleanupDismissed}
    {oldEmailCount}
    {showQuotaBanner}
    {version}
    {activeViewForExpand}
    {themeMode}
    {contrastLevel}
    {isOffline}
    {offlineDismissed}
    {isOnboardingShell}
    {contentBottomSafeAreaPx}
    {totalUnreadCount}
    {showHeaderBack}
    {isMoreOnlyPage}
    {headerPageTitle}
    {headerPageIcon}
    {uiDensity}
    {hideFloatingFooterForDetail}
    {addressBootstrapReady}
    {loading}
    {loadingEmails}
    bind:layoutRootEl={layoutRootEl}
    bind:bottomFloatingLayerEl={bottomFloatingLayerEl}
    bind:qrCanvas={overlayState.qrCanvas}
    {qrDialogEmail}
    bind:tooltipRef={overlayState.tooltipRef}
    bind:splitHostRef={splitHostRef}
    onDeleteLogin={(id: string) => deleteLoginByIdAction(ext, loginSetters, id)}
    onReorderLogin={(sourceId: string, targetId: string) =>
      reorderLoginInfoByIdAction(ext, loginSetters, sourceId, targetId)}
    {setThemeMode}
    {setContrastLevel}
    {handleHeaderBack}
    {handleSettingsSubpageBack}
    {handleScrollDirection}
    {handleLongPressNavbar}
    {expandCurrentView}
    {toggleSplitPane}
    {expandSplitPane}
    {openCreateAddressDialog}
    {handleCreateAddressWithProvider}
    {handleCreateAddress}
    {createAddress}
    {selectAddress}
    {refreshMailbox}
    {toggleNotifications}
    {openAddressView}
    {refreshCurrentAddressMessages}
    {handleAddressDomainChanged}
    {navigateFromAddressToMailbox}
    {handleAddressUnarchive}
    {handleAddressAutoExtend}
    {handleAddressExtend}
    {toggleSelectAll}
    {toggleSelect}
    {archiveSelected}
    {unarchiveSelected}
    {deleteSelected}
    {exportSelected}
    {deleteAddressesDirect}
    {archiveAddress}
    {unarchiveAddress}
    {archiveAddressesBulk}
    {unarchiveAddressesBulk}
    {renewAddressesBulk}
    {removeAddress}
    {restoreAddress}
    {toggleAutoExtend}
    {extendAddress}
    {reorderAddressesById}
    {openMessageDetail}
    {markSelectedThreadUnreadAndClose}
    {archiveSelectedThread}
    {deleteSelectedThread}
    {createRuleFromMessage}
    {searchFromMessage}
    {navigateToPrevMessage}
    {navigateToNextMessage}
    {autofillForm}
    {copyOtpFromMessage}
    {applySearchQuery}
    {clearFilters}
    {archiveSelectedEmails}
    {deleteSelectedEmails}
    {restoreSelectedEmails}
    {saveFilter}
    {loadFilter}
    {renameFilter}
    {deleteFilter}
    {loadSavedSearchFilters}
    {saveSettings}
    {toggleDeveloperSettings}
    {toggleEnableLogging}
    {handleProviderChange}
    {saveAutoCopy}
    {saveAutoRenew}
    {saveAutoRenewWindowMinutes}
    {handleColorChange}
    {loadProviderInstances}
    {addCustomInstance}
    {hardReset}
    {updateAutoRefreshInterval}
    {openMailProviderSettings}
    {exportData}
    {importData}
    {loadAnalytics}
    {handleResetAnalytics}
    {loadSettings}
    {loadLoginInfo}
    {loadAddresses}
    {stableLoadAddresses}
    {checkMessages}
    {openQrDialog}
    {closeQrDialog}
    {downloadQrCode}
    {copyQrImage}
    {handleExecuteExport}
    {exportAddressEmails}
    {showToast}
    {showConfirm}
    {closeConfirm}
    {startProductTour}
    {finishProductTour}
    {skipProductTour}
    {setSelectedIdentity}
    {handleRequestQuotaUnlimitedStorage}
    {dismissQuotaBanner}
    {dismissRetentionCleanup}
    {cleanupOldEmailsNow}
    {openAddressViewTagDialog}
    {openAddressViewTagDialogForSelected}
    {closeAddressViewTagDialog}
    {saveAddressViewTags}
    {addressDetailToast}
    {removeFromAutofillBlocklist}
    {addToAutofillBlocklistSetting}
    {toggleAutofillBlocklistSetting}
  />
  {#if manualArchivedRenewalPrompt}
    <ModalDialog
      open={true}
      title={$t('address.manualArchiveRenewalTitle')}
      onClose={() => resolveManualArchivedRenewal(null)}
      maxWidth="xs"
    >
      <div class="space-y-2">
        <p class="text-xs text-md-on-surface/60 font-mono" style="direction:ltr;unicode-bidi:isolate;">
          {manualArchivedRenewalPrompt.account.address}
        </p>
        <p class="text-sm text-md-on-surface-variant">
          {$t('address.manualArchiveRenewalBody')}
        </p>
      </div>
      {#snippet footer()}
        <div class="flex flex-col gap-1.5 w-full">
          <Btn
            variant="primary"
            class="w-full"
            onClick={() => resolveManualArchivedRenewal('unarchive')}
          >
            {$t('address.unarchiveAfterRenewal')}
          </Btn>
          <Btn
            variant="secondary"
            class="w-full"
            onClick={() => resolveManualArchivedRenewal('keep-archived')}
          >
            {$t('address.keepArchivedAfterRenewal')}
          </Btn>
          <Btn
            variant="ghost"
            class="w-full"
            onClick={() => resolveManualArchivedRenewal(null)}
          >
            {$t('common.cancel')}
          </Btn>
        </div>
      {/snippet}
    </ModalDialog>
  {/if}
</ErrorBoundary>
