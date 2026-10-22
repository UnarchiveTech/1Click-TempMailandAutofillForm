<script lang="ts">
import { type ComponentProps, tick } from 'svelte';
import { cubicOut } from 'svelte/easing';
import { fly } from 'svelte/transition';
import { locale, t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import {
  flushQueuedEmailReadState,
  queueEmailReadStates,
} from '@/features/address/address-actions.js';
import {
  type MarkReadUnreadDeps,
  markAddressesReadUnread,
} from '@/features/address/mailbox-read-state.js';
import type { OpenedMessageTab } from '@/features/address/message-tabs.js';
import type { FailoverState } from '@/features/address/provider-failover.js';
import type { SaveFilterInput } from '@/features/address/use-saved-search-filters.js';
import { PRODUCT_TOUR_STEPS } from '@/features/product-tour/tour-steps.js';
import type { PageZoomDirection, PageZoomSettings } from '@/features/settings/page-zoom.js';
import type {
  SettingsDomain,
  SettingsSetters,
  SettingsState,
} from '@/features/settings/settings-state.svelte.js';
import type { ContrastLevel, ThemeMode } from '@/features/theme/theme-actions.js';
import { isView, type View } from '@/features/types/view-types.js';
// --- Overlays / dialogs / feedback ---
import ConfirmDialog from '@/ui/blocks/dialogs/ConfirmDialog.svelte';
import CreateAddressDialog from '@/ui/blocks/dialogs/CreateAddressDialog.svelte';
import TagDialog from '@/ui/blocks/dialogs/TagDialog.svelte';
import ClipboardCountdown from '@/ui/blocks/feedback/ClipboardCountdown.svelte';
import OfflineBanner from '@/ui/blocks/feedback/OfflineBanner.svelte';
import ToastContainer from '@/ui/blocks/feedback/ToastContainer.svelte';
import type { ToastType } from '@/ui/blocks/feedback/toast-types.js';
// --- Shell child components (view router) ---
import AddressDetailPane from '@/ui/blocks/layout/AddressDetailPane.svelte';
import AddressesSplitView from '@/ui/blocks/layout/AddressesSplitView.svelte';
import AutofillSplitView from '@/ui/blocks/layout/AutofillSplitView.svelte';
import FloatingFooter from '@/ui/blocks/layout/FloatingFooter.svelte';
import Header from '@/ui/blocks/layout/Header.svelte';
import MailboxSplitView from '@/ui/blocks/layout/MailboxSplitView.svelte';
import SecondaryViews from '@/ui/blocks/layout/SecondaryViews.svelte';
import SettingsView from '@/ui/blocks/layout/SettingsView.svelte';
import SidebarNav from '@/ui/blocks/layout/SidebarNav.svelte';
import type {
  OverlaySetters,
  OverlayState,
} from '@/ui/blocks/layout/use-layout-overlays.svelte.js';
import { useSelectionKeyboard } from '@/ui/blocks/layout/use-selection-keyboard.svelte.js';
import { type ToastFn } from '@/ui/blocks/layout/use-toast.js';
import ListSelectionBar from '@/ui/blocks/mail/ListSelectionBar.svelte';
import CommandPalette from '@/ui/blocks/overlays/CommandPalette.svelte';
import KeyboardShortcutsCheatSheet from '@/ui/blocks/overlays/KeyboardShortcutsCheatSheet.svelte';
import Onboarding from '@/ui/blocks/overlays/Onboarding.svelte';
import ProductTour from '@/ui/blocks/overlays/ProductTour.svelte';
import type { PaletteCommand } from '@/ui/blocks/overlays/palette-command-types.js';
import AppLoadingSkeleton from '@/ui/components/composites/AppLoadingSkeleton.svelte';
import EmptyState from '@/ui/components/composites/EmptyState.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import type { KnownIconName } from '@/ui/components/icons/icon-names.js';
import { addressTagsList } from '@/utils/address/address-tags.js';
// --- Utilities used by inline handlers in the shell template ---
import { copyToClipboardAndSchedulePurge } from '@/utils/clipboard/clipboard.js';
import { CONSTANTS } from '@/utils/constants.js';
import type { ProviderConfig } from '@/utils/email/email-service.js';
import { AddressCreationError } from '@/utils/errors.js';
import { isRTL } from '@/utils/i18n/i18n.js';
import { createTranslator } from '@/utils/i18n/i18n-utils.js';
import { logError } from '@/utils/logger.js';
import {
  getAddresses,
  getArchivedEmailsForAddress,
  getStoredEmailsForAddress,
  type SidebarPosition,
  type UiDensity,
} from '@/utils/storage/storage-keys.js';
import { restoreImportUndo } from '@/utils/storage/storage-snapshot.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import { formatBytes, getStorageUsage } from '@/utils/storage/storageMonitor.js';
import { isUndoCurrent } from '@/utils/storage/undo-generation.js';
import { localDateStamp } from '@/utils/time/time-format.js';
import type {
  ActivityEvent,
  Address,
  CredentialsHistoryItem,
  Email,
  Identity,
  Keybindings,
  ProviderInstance,
  SavedSearchFilter,
} from '@/utils/types.js';
import { DEFAULT_KEYBINDINGS } from '@/utils/types.js';
import { ELEVATION } from '@/utils/ui/elevation.js';
import { PORTAL_Z_CLASS, portalDialogAction } from '@/utils/ui/portal-layers.js';
import { useReducedMotion } from '@/utils/ui/reduced-motion.svelte.js';
import { responsiveButtonLayout } from '@/utils/ui/responsive-button-layout.js';
import { activeSelectionStore, selectionFor } from '@/utils/ui/selection-registry.js';
import type { ConfirmDialogState } from '@/utils/ui/shared-ui.js';
import { hostMatchesDomainScope, normalizeDomain } from '@/utils/validation.js';

// --- Child prop types (single source of truth per component) ---
type AddrProps = ComponentProps<typeof AddressesSplitView>;
type AddrDetailProps = ComponentProps<typeof AddressDetailPane>;
type SettingsProps = ComponentProps<typeof SettingsView>;
type SecondaryProps = ComponentProps<typeof SecondaryViews>;
const motionPreference = useReducedMotion();
type AutofillProps = ComponentProps<typeof AutofillSplitView>;
type MailProps = ComponentProps<typeof MailboxSplitView>;
type SidebarProps = ComponentProps<typeof SidebarNav>;
type HeaderProps = ComponentProps<typeof Header>;
type FooterProps = ComponentProps<typeof FloatingFooter>;
type OnboardingProps = ComponentProps<typeof Onboarding>;
type TourProps = ComponentProps<typeof ProductTour>;
type SettingsActions = {
  updateAutoRefreshInterval: (intervalMs: number) => Promise<void>;

  save: () => Promise<void>;
  toggleDeveloperSettings: () => Promise<void>;
  toggleEnableLogging: () => Promise<void>;
  handleProviderChange: (provider: string) => Promise<void>;
  saveAutoCopy: () => Promise<void>;
  saveAutoRenew: () => Promise<void>;
  saveAutoRenewScope: () => Promise<void>;
  saveAutoRenewWindowMinutes: () => Promise<void>;
  handleColorChange: (color: string) => Promise<void>;
  loadProviderInstances: () => Promise<void>;
  addCustomInstance: (name: string, url: string) => Promise<void>;
  hardReset: () => Promise<void>;
};

type OverlayActions = {
  openQrDialog: (email?: string) => void;
  closeQrDialog: () => void;
  downloadQrCode: () => void;
  copyQrImage: () => Promise<void>;
  showConfirm: AppShellProps['showConfirm'];
  closeConfirm: () => void;
  startProductTour: () => void | Promise<void>;
  finishProductTour: () => void | Promise<void>;
  skipProductTour: () => void | Promise<void>;
};

const MIN_VIEWPORT_SIZE = 360;

/** The selection strip's measured height, used to reserve space above it. */
let selectionBarHeightPx = $state(0);

// The strip's keys live here with the strip: one window listener, routed through
// the registry to whichever list is on screen (`use-selection-keyboard`).
useSelectionKeyboard();

type AnalyticsState = {
  createdAt: string | number | undefined;
  accountsCreated: number;
  emailsReceived: number;
  otpsDetected: number;
  notificationsSent: number;
  extensionOpens?: number;
  emailsRead?: number;
  pageVisits?: Record<string, number>;
};

type QrDialogComponentType = typeof import('@/ui/blocks/dialogs/QrDialog.svelte')['default'] | null;

type AppShellProps = {
  // --- Shell chrome (read-only) ---
  context: 'popup' | 'sidepanel' | 'app';
  contentReloadRequiredTabId?: number | null;
  onReloadRequiredTab?: () => void | Promise<void>;
  layoutWide: boolean;
  isOffline: boolean;
  offlineDismissed: boolean;
  isOnboardingShell: boolean;
  contentBottomSafeAreaPx: number;
  themeMode: ThemeMode;
  contrastLevel: ContrastLevel;
  totalUnreadCount: number;
  showHeaderBack: boolean;
  isMoreOnlyPage: boolean;
  headerPageTitle: string;
  headerPageIcon?: KnownIconName;
  uiDensity: UiDensity;
  hideFloatingFooterForDetail: boolean;
  addressBootstrapReady: boolean;
  loading: boolean;
  loadingEmails: boolean;
  version: string;
  activeViewForExpand: View;
  layoutRootEl?: HTMLElement | null;

  // --- View routing state (bindable - mutated by shell closures) ---
  currentView?: View;
  accountSelectorDropdownOpen?: boolean;
  organizeTabValue?: 'tags' | 'labels' | 'filters';
  organizeTabSignal?: number;
  autofillTabValue?: 'profiles' | 'credentials' | 'sites';
  autofillTabSignal?: number;
  paletteWebsiteFilter?: string;
  paletteWebsiteFilterSignal?: number;
  tagCreateSignal?: number;
  labelCreateSignal?: number;
  identityCreateSignal?: number;
  vaultLockSignal?: number;
  savedLoginsFocusSignal?: number;
  settingsSubpage?: string | null;
  previousViewBeforeSubpage?: View | null;
  selectedThread?: Email[];
  openMessageTabs: OpenedMessageTab[];
  activeMessageTabKey: string;
  selectMessageTab: (key: string) => void;
  closeMessageTab: (key: string) => void;
  onMessageScroll: (key: string, scrollTop: number) => void;
  splitSecondaryView?: View | null;
  splitListWidthPx?: number;
  mailProviderSplitOpen?: boolean;
  currentEmailDetail?: Address | null;
  selectedAddresses?: Set<string>;
  mgmtTab?: string;
  mgmtSearch?: string;
  automationInitialSender?: string;
  displayedEmail?: string;
  mailboxListTab?: 'inbox' | 'archived' | 'deleted' | 'storedLocally' | 'all';
  activeMailboxLabel?: string | null;

  // --- Mailbox filter state (bindable - mutated by search callbacks) ---
  sortBy?: string;
  otpOnly?: boolean;
  unreadOnly?: boolean;
  hasAttachment?: boolean;
  senderDomain?: string;
  senderEmail?: string;
  recipient?: string;
  subject?: string;
  notSenderDomain?: string;
  notSenderEmail?: string;
  notRecipient?: string;
  notSubject?: string;
  selectedSenders?: string[];
  dateFrom?: string;
  dateTo?: string;
  loginInfoEmailFilter?: string;
  identitiesEmailFilter?: string;

  // --- Grouped settings and overlays ---
  settingsState: SettingsState;
  settingsSetters: SettingsSetters;
  settingsActions: SettingsActions;
  pageZoomSettings: PageZoomSettings;
  globalZoomScale: number;
  onTogglePageZoom: (view: View, enabled: boolean) => void;
  onChangePageZoom: (view: View, direction: PageZoomDirection) => void;
  onApplyAutoRenewToAll: (value: boolean) => Promise<number>;
  overlayState: OverlayState;
  overlaySetters: OverlaySetters;
  overlayActions: OverlayActions;

  // --- Remaining bind targets ---
  bottomFloatingLayerEl?: HTMLElement | null;
  qrCanvas?: HTMLCanvasElement | null;
  qrDialogEmail?: string | null;
  tooltipRef?: HTMLElement | null;
  splitHostRef?: HTMLElement | null;

  // --- Read-only data ---
  accounts: Address[];
  allAddresses: Address[];
  unreadByAddress: Record<string, number>;
  selectedProvider: string;
  selectedEmail: string;
  emails: Email[];
  savedLogins: CredentialsHistoryItem[];
  allStoredEmails: Record<string, Email[]>;
  exportWizardAddress: Address | null;
  exportWizardMessages: Email[];
  sidebarMailboxLabels: string[];
  mailboxLabelCounts: Record<string, number>;
  mailboxFolderCounts: Record<string, number>;
  sidebarLiveCount: number;
  sidebarInactiveCount: number;
  sidebarTagCount: number;
  sidebarLabelCount: number;
  sidebarFilterCount: number;
  sidebarProfileCount: number;
  sidebarCredentialCount: number;
  mgmtAddresses: Address[];
  allSelected: boolean;
  loadingAddresses: boolean;
  addressViewTagDialogOpen: boolean;
  addressViewTagTarget: Address | null;
  addressViewTagTargets: Address[];
  allExistingTags: string[];
  allTagColors: Record<string, string>;
  allTagAddresses: Record<string, string[]>;
  highlightAddress: string | null;
  layoutSplit: boolean;
  layoutVerticalSplit: boolean;
  splitModeFlash: boolean;
  showSplitPane: boolean;
  splitPaneCollapsed: boolean;
  /** Icon-only sidebar rail (persisted in AppLayout). */
  sidebarCollapsed: boolean;
  sidebarPosition: SidebarPosition;
  /** Expand/collapse the sidebar rail (AppLayout owns + persists the state). */
  onToggleSidebarCollapse: () => void;
  /** Density switch requested by the sidebar rail (AppLayout owns + persists). */
  onDensityChange?: (value: UiDensity) => void;
  hasPrevMessage: boolean;
  hasNextMessage: boolean;
  analytics: AnalyticsState;
  analyticsLoading: boolean;
  savedSearchFilters: SavedSearchFilter[];
  identities: Identity[];
  selectedIdentityId: string | null;
  identityEditIdSignal: string;
  autofillBlocklist: string[];
  scrollChromeHidden: boolean;
  searchQuery: string;
  filteredEmails: Email[];
  latestOtp: string;
  latestOtpSender: string;
  latestOtpSenderName: string;
  otpContext: string;
  formDetected: boolean;
  humanVerificationRequired: boolean;
  archivedSectionOpen: 'active' | 'archived' | 'expired' | null;
  providerFailoverHint: FailoverState | null;
  archivedSearch: string;
  confirmDialog: ConfirmDialogState | null;
  paletteCommands: PaletteCommand[];
  retentionCleanupDismissed: boolean;
  oldEmailCount: number;
  showQuotaBanner: boolean;

  // --- Callbacks (delegated to AppLayout) ---
  setThemeMode: (mode: ThemeMode) => void;
  setContrastLevel: (level: ContrastLevel) => void;
  handleHeaderBack: () => void;
  handleSettingsSubpageBack: () => void;
  handleScrollDirection: (direction: 'up' | 'down', atTop?: boolean) => void;
  handleLongPressNavbar: () => void;
  expandCurrentView: () => void | Promise<void>;
  toggleSplitPane: () => void;
  expandSplitPane: () => void;
  openCreateAddressDialog: (provider?: string, instanceId?: string) => void;
  handleCreateAddressWithProvider: (provider?: string, instanceId?: string) => Promise<void>;
  handleCreateAddress: (
    type: 'random' | 'custom',
    username?: string,
    domain?: string
  ) => Promise<unknown>;
  createAddress: (provider?: string, instanceId?: string) => Promise<unknown>;
  selectAddress: (address: string) => Promise<void>;
  refreshMailbox: (addressId?: string) => Promise<void>;
  toggleNotifications: () => Promise<void>;
  openAddressView: (address: Address) => void;
  refreshCurrentAddressMessages: () => Promise<void>;
  handleAddressDomainChanged: (address: string) => Promise<void>;
  navigateFromAddressToMailbox: () => void;
  handleAddressUnarchive: (account: Address) => Promise<void>;
  handleAddressAutoExtend: (account: Address) => Promise<void>;
  handleAddressExtend: (account: Address) => Promise<void>;
  toggleSelectAll: () => void;
  toggleSelect: (id: string) => void;
  archiveSelected: () => void;
  unarchiveSelected: () => void;
  deleteSelected: () => void;
  exportSelected: () => Promise<void>;
  deleteAddressesDirect: (addresses: Address[]) => Promise<void>;
  archiveAddress: (account: Address) => Promise<void>;
  unarchiveAddress: (account: Address) => Promise<void>;
  archiveAddressesBulk: (accounts: Address[]) => Promise<void>;
  unarchiveAddressesBulk: (accounts: Address[]) => Promise<void>;
  renewAddressesBulk: (accounts: Address[]) => Promise<void>;
  removeAddress: (address: string) => Promise<void>;
  restoreAddress: (address: string) => Promise<void>;
  toggleAutoExtend: (account: Address) => Promise<void>;
  extendAddress: (account: Address) => Promise<void>;
  reorderAddressesById: (sourceId: string, targetId: string) => void;
  openMessageDetail: (thread: Email[]) => void;
  markSelectedThreadUnreadAndClose: (mode: 'split' | 'page') => void;
  archiveSelectedThread: (mode: 'split' | 'page') => void;
  deleteSelectedThread: (mode: 'split' | 'page') => void;
  createRuleFromMessage: (from?: string) => void;
  searchFromMessage: (query: string) => void;
  navigateToPrevMessage: () => void;
  navigateToNextMessage: () => void;
  autofillForm: () => Promise<void>;
  copyOtpFromMessage: (otp: string) => Promise<void>;
  applySearchQuery: (v: string) => void;
  clearFilters: () => void;
  archiveSelectedEmails: (items: Email[]) => Promise<void>;
  deleteSelectedEmails: (items: Email[]) => Promise<void>;
  restoreSelectedEmails: (items: Email[]) => Promise<void>;
  saveFilter: (input: SaveFilterInput) => Promise<void>;
  loadFilter: (filter: SavedSearchFilter) => Promise<void>;
  renameFilter: (id: string, name: string) => Promise<void>;
  deleteFilter: (id: string) => Promise<void>;
  loadSavedSearchFilters: () => Promise<void>;
  saveSettings: () => Promise<void>;
  toggleDeveloperSettings: () => Promise<void>;
  toggleEnableLogging: () => Promise<void>;
  handleProviderChange: (provider: string) => Promise<void>;
  saveAutoCopy: () => Promise<void>;
  saveAutoRenew: () => Promise<void>;
  saveAutoRenewWindowMinutes: () => Promise<void>;
  handleColorChange: (color: string) => Promise<void>;
  loadProviderInstances: () => Promise<void>;
  addCustomInstance: (name: string, url: string) => Promise<void>;
  hardReset: () => Promise<void>;
  updateAutoRefreshInterval: (intervalMs: number) => Promise<void>;
  openMailProviderSettings: () => void;
  exportData: () => void;
  importData: () => void;
  loadAnalytics: () => Promise<void>;
  handleResetAnalytics: () => Promise<void>;
  loadSettings: () => Promise<void>;
  loadLoginInfo: () => Promise<void>;
  loadAddresses: (skipEmailSelection?: boolean) => Promise<void>;
  stableLoadAddresses: (skipEmailSelection?: boolean) => Promise<void>;
  checkMessages: (addressId: string) => Promise<void>;
  openQrDialog: (email?: string) => void;
  closeQrDialog: () => void;
  downloadQrCode: () => void;
  copyQrImage: () => Promise<void>;
  handleExecuteExport: (format: string) => Promise<void>;
  exportAddressEmails: (target: Address | Address[]) => Promise<void>;
  // Receives the raw `showToast` implementation (ToastType) - cannot be ToastFn
  // (string), whose wider `type` param would reject the concrete implementation.
  showToast: (
    message: string | { message: string; type?: ToastType; icon?: ToastType },
    type?: ToastType,
    undoAction?: (() => void) | null,
    actionLabel?: string | null
  ) => void;
  showConfirm: (
    message: string,
    onConfirm: () => void,
    options?: Omit<ConfirmDialogState, 'message' | 'onConfirm'> | undefined
  ) => void;
  closeConfirm: () => void;
  startProductTour: () => void | Promise<void>;
  finishProductTour: () => void | Promise<void>;
  skipProductTour: () => void | Promise<void>;
  setSelectedIdentity: (id: string | null) => Promise<void>;
  handleRequestQuotaUnlimitedStorage: () => Promise<void>;
  dismissQuotaBanner: () => void;
  dismissRetentionCleanup: () => void;
  cleanupOldEmailsNow: () => Promise<void>;
  openAddressViewTagDialog: (address: Address) => void;
  openAddressViewTagDialogForSelected: () => void;
  closeAddressViewTagDialog: () => void;
  saveAddressViewTags: (tags: Array<{ name: string; color: string }>) => unknown;
  addressDetailToast: ToastFn;
  removeFromAutofillBlocklist: (domain: string) => void;
  addToAutofillBlocklistSetting: (domain: string) => void;
  toggleAutofillBlocklistSetting: (domain: string) => void;
  onDeleteLogin: (id: string) => Promise<void>;
  onReorderLogin: (sourceId: string, targetId: string) => Promise<void>;
};

let viewportWidth = $state(typeof window !== 'undefined' ? window.innerWidth : MIN_VIEWPORT_SIZE);
let viewportHeight = $state(typeof window !== 'undefined' ? window.innerHeight : MIN_VIEWPORT_SIZE);
const viewportTooSmall = $derived(
  viewportWidth < MIN_VIEWPORT_SIZE || viewportHeight < MIN_VIEWPORT_SIZE
);
let viewportRestrictionOverlay = $state<HTMLElement | null>(null);

function handleViewportRestrictionKeydown(e: KeyboardEvent): void {
  if (!viewportTooSmall) return;
  e.preventDefault();
  e.stopPropagation();
  viewportRestrictionOverlay?.focus();
}

function handleViewportRestrictionFocus(e: FocusEvent): void {
  if (!viewportTooSmall || !viewportRestrictionOverlay) return;
  const target = e.target;
  if (target instanceof Node && !viewportRestrictionOverlay.contains(target)) {
    viewportRestrictionOverlay.focus();
  }
}

$effect(() => {
  if (!viewportTooSmall || !viewportRestrictionOverlay) return;
  void tick().then(() => {
    if (viewportTooSmall) viewportRestrictionOverlay?.focus();
  });
});

let {
  context,
  contentReloadRequiredTabId = null,
  onReloadRequiredTab,
  layoutWide,
  isOffline,
  offlineDismissed,
  isOnboardingShell,
  contentBottomSafeAreaPx,
  themeMode,
  contrastLevel,
  totalUnreadCount,
  showHeaderBack,
  isMoreOnlyPage,
  headerPageTitle,
  headerPageIcon,
  uiDensity,
  hideFloatingFooterForDetail,
  addressBootstrapReady,
  loading,
  loadingEmails,
  version,
  activeViewForExpand,
  layoutRootEl = $bindable<HTMLElement | null>(null),
  currentView = $bindable<View>('mailbox'),
  accountSelectorDropdownOpen = $bindable(false),
  organizeTabValue = $bindable<'tags' | 'labels' | 'filters'>('tags'),
  organizeTabSignal = $bindable(0),
  autofillTabValue = $bindable<'profiles' | 'credentials' | 'sites'>('profiles'),
  autofillTabSignal = $bindable(0),
  paletteWebsiteFilter = $bindable(''),
  paletteWebsiteFilterSignal = $bindable(0),
  tagCreateSignal = $bindable(0),
  labelCreateSignal = $bindable(0),
  identityCreateSignal = $bindable(0),
  /** Incremented on background vault lock so vault-dependent views re-read state. */
  vaultLockSignal = 0,
  savedLoginsFocusSignal = $bindable(0),
  settingsSubpage = $bindable<string | null>(null),
  previousViewBeforeSubpage = $bindable<View | null>(null),
  selectedThread = $bindable<Email[]>([]),
  openMessageTabs,
  activeMessageTabKey,
  selectMessageTab,
  closeMessageTab,
  onMessageScroll,
  splitSecondaryView = $bindable<View | null>(null),
  splitListWidthPx = $bindable(420),
  mailProviderSplitOpen = $bindable(false),
  currentEmailDetail = $bindable<Address | null>(null),
  selectedAddresses = $bindable<Set<string>>(new Set()),
  mgmtTab = $bindable('active'),
  mgmtSearch = $bindable(''),
  automationInitialSender = $bindable(''),
  displayedEmail = $bindable(''),
  mailboxListTab = $bindable<'inbox' | 'archived' | 'deleted' | 'storedLocally' | 'all'>('inbox'),
  activeMailboxLabel = $bindable<string | null>(null),
  sortBy = $bindable('newest'),
  otpOnly = $bindable(false),
  unreadOnly = $bindable(false),
  hasAttachment = $bindable(false),
  senderDomain = $bindable(''),
  senderEmail = $bindable(''),
  recipient = $bindable(''),
  subject = $bindable(''),
  notSenderDomain = $bindable(''),
  notSenderEmail = $bindable(''),
  notRecipient = $bindable(''),
  notSubject = $bindable(''),
  selectedSenders = $bindable<string[]>([]),
  dateFrom = $bindable(''),
  dateTo = $bindable(''),
  loginInfoEmailFilter = $bindable(''),
  identitiesEmailFilter = $bindable(''),
  settingsState,
  settingsSetters,
  settingsActions,
  pageZoomSettings,
  globalZoomScale,
  onTogglePageZoom,
  onChangePageZoom,
  onApplyAutoRenewToAll,
  overlayState,
  overlaySetters,
  overlayActions,
  qrCanvas = $bindable<HTMLCanvasElement | null>(null),
  qrDialogEmail = null,
  tooltipRef = $bindable<HTMLElement | null>(null),
  bottomFloatingLayerEl = $bindable<HTMLElement | null>(null),
  splitHostRef = $bindable<HTMLElement | null>(null),
  accounts,
  allAddresses,
  unreadByAddress,
  selectedEmail,
  emails,
  savedLogins,
  allStoredEmails,

  exportWizardAddress,
  exportWizardMessages,
  sidebarMailboxLabels,
  mailboxLabelCounts,
  mailboxFolderCounts,
  sidebarLiveCount,
  sidebarInactiveCount,
  sidebarTagCount,
  sidebarLabelCount,
  sidebarFilterCount,
  sidebarProfileCount,
  sidebarCredentialCount,
  mgmtAddresses,
  allSelected,
  loadingAddresses,
  addressViewTagDialogOpen,
  addressViewTagTarget,
  addressViewTagTargets,
  allExistingTags,
  allTagColors,
  allTagAddresses,
  highlightAddress,
  layoutSplit,
  layoutVerticalSplit,
  splitModeFlash,
  showSplitPane,
  splitPaneCollapsed,
  hasPrevMessage,
  hasNextMessage,
  analytics,
  analyticsLoading,
  savedSearchFilters,
  identities,
  selectedIdentityId,
  identityEditIdSignal,
  autofillBlocklist,
  scrollChromeHidden,
  searchQuery,
  filteredEmails,
  latestOtp,
  latestOtpSender,
  latestOtpSenderName,
  otpContext,
  formDetected,
  humanVerificationRequired,
  archivedSectionOpen,
  providerFailoverHint,
  archivedSearch,
  confirmDialog,
  paletteCommands,
  retentionCleanupDismissed,
  oldEmailCount,
  showQuotaBanner,
  setThemeMode,
  setContrastLevel,
  handleHeaderBack,
  handleSettingsSubpageBack,
  handleScrollDirection,
  handleLongPressNavbar,
  expandCurrentView,
  toggleSplitPane,
  sidebarCollapsed,
  sidebarPosition,
  onToggleSidebarCollapse,
  onDensityChange,
  expandSplitPane,
  openCreateAddressDialog,
  handleCreateAddressWithProvider,
  handleCreateAddress,
  createAddress,
  selectAddress,
  refreshMailbox,
  toggleNotifications,
  openAddressView,
  refreshCurrentAddressMessages,
  handleAddressDomainChanged,
  navigateFromAddressToMailbox,
  handleAddressUnarchive,
  handleAddressAutoExtend,
  handleAddressExtend,
  toggleSelectAll,
  toggleSelect,
  archiveSelected,
  unarchiveSelected,
  deleteSelected,
  exportSelected,
  deleteAddressesDirect,
  archiveAddress,
  unarchiveAddress,
  archiveAddressesBulk,
  unarchiveAddressesBulk,
  renewAddressesBulk,
  removeAddress,
  restoreAddress,
  toggleAutoExtend,
  extendAddress,
  reorderAddressesById,
  openMessageDetail,
  markSelectedThreadUnreadAndClose,
  archiveSelectedThread,
  deleteSelectedThread,
  createRuleFromMessage,
  searchFromMessage,
  navigateToPrevMessage,
  navigateToNextMessage,
  autofillForm,
  copyOtpFromMessage,
  applySearchQuery,
  clearFilters,
  archiveSelectedEmails,
  deleteSelectedEmails,
  restoreSelectedEmails,
  saveFilter,
  loadFilter,
  renameFilter,
  deleteFilter,
  loadSavedSearchFilters,
  saveSettings,
  toggleDeveloperSettings,
  toggleEnableLogging,
  handleProviderChange,
  saveAutoCopy,
  saveAutoRenew,
  saveAutoRenewWindowMinutes,
  handleColorChange,
  loadProviderInstances,
  addCustomInstance,
  hardReset,
  updateAutoRefreshInterval,
  openMailProviderSettings,
  exportData,
  importData,
  loadAnalytics,
  handleResetAnalytics,
  loadSettings,
  loadLoginInfo,
  loadAddresses,
  stableLoadAddresses,
  checkMessages,
  openQrDialog,
  closeQrDialog,
  downloadQrCode,
  copyQrImage,
  handleExecuteExport,
  exportAddressEmails,
  showToast,
  showConfirm,
  closeConfirm,
  startProductTour,
  finishProductTour,
  skipProductTour,
  setSelectedIdentity,
  handleRequestQuotaUnlimitedStorage,
  dismissQuotaBanner,
  dismissRetentionCleanup,
  cleanupOldEmailsNow,
  openAddressViewTagDialog,
  openAddressViewTagDialogForSelected,
  closeAddressViewTagDialog,
  saveAddressViewTags,
  addressDetailToast,
  removeFromAutofillBlocklist,
  addToAutofillBlocklistSetting,
  toggleAutofillBlocklistSetting,
  onDeleteLogin,
  onReorderLogin,
}: AppShellProps = $props();

const selectionReplacesFooter = $derived(
  $activeSelectionStore !== null && !layoutWide && !hideFloatingFooterForDetail
);

// --- Quota banner numbers: measured when the banner shows, so the {used} /
// {limit} slots render real values through formatBytes (the single byte
// formatter) instead of hardcoded '4.8 MB' / '5.0 MB' literals.
let quotaUsedBytes = $state(0);
$effect(() => {
  if (!showQuotaBanner) return;
  let cancelled = false;
  void getStorageUsage().then((bytes) => {
    if (!cancelled) quotaUsedBytes = bytes;
  });
  return () => {
    cancelled = true;
  };
});

// --- About back FAB: remember the view shown before About so its contextual
// back button returns exactly where the user came from (logo, More menu, tour).
let viewBeforeAbout = $state<View>('mailbox');
$effect(() => {
  const view = currentView;
  if (view !== 'about' && view !== viewBeforeAbout) viewBeforeAbout = view;
});

function handleAboutBack() {
  const target = viewBeforeAbout && viewBeforeAbout !== 'about' ? viewBeforeAbout : 'mailbox';
  currentView = target;
}

function openOrganizeTab(tab: 'tags' | 'labels') {
  accountSelectorDropdownOpen = false;
  organizeTabValue = tab;
  organizeTabSignal += 1;
  currentView = 'organize';
}

let initialSiteDomain = $state('');
function openSiteOverview(domain: string) {
  initialSiteDomain = domain;
  autofillTabValue = 'sites';
  autofillTabSignal += 1;
  currentView = 'autofill';
}

async function applyOrganizeFilter(filter: SavedSearchFilter) {
  await loadFilter(filter);
  activeMailboxLabel = null;
  mailboxListTab = 'all';
  currentView = 'mailbox';
}

async function openActivityEvent(
  event: ActivityEvent,
  target: 'inbox' | 'message' | 'login' | 'settings'
) {
  try {
    if (target === 'settings') {
      currentView = 'diagnostics';
      return;
    }
    if (target === 'login') {
      const domain = normalizeDomain(event.data.website || '');
      if (!domain) throw new Error('Activity event has no website');
      loginInfoEmailFilter = event.data.address || '';
      paletteWebsiteFilter = domain;
      paletteWebsiteFilterSignal += 1;
      autofillTabValue = 'credentials';
      autofillTabSignal += 1;
      currentView = 'autofill';
      return;
    }
    const addresses = await getAddresses();
    const address = addresses.find(
      (item) =>
        item.address.toLowerCase() === event.data.address?.toLowerCase() &&
        item.accountStatus !== 'deleted'
    );
    if (!address) {
      showToast($t('errors.addressNotFound'), 'error');
      return;
    }
    if (target === 'message') {
      // IDs are provider-local: resolve only inside the event's recorded inbox.
      const [stored, archived] = await Promise.all([
        getStoredEmailsForAddress(address.id),
        getArchivedEmailsForAddress(address.id),
      ]);
      const email = [...stored, ...archived].find((item) => item.id === event.data.emailId);
      if (!email) {
        showToast($t('emailList.noEmailsFound'), 'warning');
        return;
      }
      await selectAddress(address.address);
      openMessageDetail([email]);
    } else {
      await selectAddress(address.address);
      currentView = 'mailbox';
    }
  } catch (error) {
    logError('Failed to open activity record:', error);
    showToast($t('toasts.operationFailed'), 'error');
  }
}

// Prefetch the default (mailbox) view chunk as soon as the shell mounts so the
// popup never shows a loading state for it - the chunk downloads in parallel
// with the rest of the shell while storage bootstrapping is still in flight.
// (Fire-and-forget: the bundler dedupes this with MailboxSplitView's import.)
void import('@/ui/views/mailbox/MailboxView.svelte');

// --- Bulk mark read/unread (shared helper; the 4 template handlers delegate here) ---
const markReadDeps: MarkReadUnreadDeps = {
  ext: browser,
  getStoredEmails: () => allStoredEmails,
  showToast: (message, type) => showToast(message, type as ToastType | undefined),
  getTranslation: createTranslator(),
  queueReadStates: (ops) => queueEmailReadStates(ops),
  flushReadStates: () => flushQueuedEmailReadState(),
};

/** Provider state and actions shared by every routed provider-aware view. */
const providerProps = $derived.by(() => ({
  selectedProvider: settingsState.selectedProvider,
  selectedProviderInstance: settingsState.selectedProviderInstance,
  providerInstances: settingsState.providerInstances,
  autoRenew: settingsState.autoRenew,
  autoRenewScope: settingsState.autoRenewScope,
  notificationsEnabled: settingsState.notificationsEnabled,
  soundEnabled: settingsState.soundEnabled,
  expiryWarningThreshold: settingsState.expiryWarningThreshold,
  autoRefreshInterval: settingsState.autoRefreshInterval,
  emailPreviewMode: settingsState.emailPreviewMode,
  defaultDomain: settingsState.defaultDomain,
  onProviderChange: handleProviderChange,
  onSetAutoRenew: settingsSetters.setAutoRenew,
  onSetAutoRenewScope: settingsSetters.setAutoRenewScope,
  onSaveAutoRenewScope: settingsActions.saveAutoRenewScope,
  onApplyAutoRenewToAll,
  onSetNotificationsEnabled: settingsSetters.setNotificationsEnabled,
  onSetSoundEnabled: settingsSetters.setSoundEnabled,
  onSetExpiryWarningThreshold: settingsSetters.setExpiryWarningThreshold,
  onSetAutoRefreshInterval: settingsActions.updateAutoRefreshInterval,
  onSetEmailPreviewMode: settingsSetters.setEmailPreviewMode,
  onSetProviderInstance: settingsSetters.setSelectedProviderInstance,
  onAddCustomInstance: addCustomInstance,
  onLoadProviderInstances: loadProviderInstances,
  onSetDefaultDomain: settingsSetters.setDefaultDomain,
  onSaveSettings: saveSettings,
}));
</script>

<svelte:window
  bind:innerWidth={viewportWidth}
  bind:innerHeight={viewportHeight}
  onkeydown={handleViewportRestrictionKeydown}
  onfocusin={handleViewportRestrictionFocus}
/>

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
    Popup: exactly 360×600, no outer padding (padding was clipping ~8-15px).
    Sidepanel/app: fill host; no fixed phone frame.
  -->
  <div
    bind:this={layoutRootEl}
    class="relative bg-md-surface flex transition-all duration-300 ease-in-out overflow-x-hidden box-border
      {layoutWide
        ? (sidebarPosition === 'left') !== isRTL($locale || 'en')
          ? 'flex-row'
          : 'flex-row-reverse'
        : 'flex-col'}
      {context === 'popup'
        ? 'w-[360px] max-w-[360px] min-w-[360px] h-[600px] min-h-[600px] max-h-[600px] page-inset py-2 rounded-none shadow-none overflow-x-auto'
        : layoutWide
          ? 'w-full max-w-none h-full min-h-0 max-h-none flex-1 p-0 rounded-none shadow-none'
          : 'w-full max-w-none h-full min-h-0 max-h-none flex-1 page-inset py-2 rounded-none shadow-none'}"
    style="--footer-safe: {layoutWide ? '12px' : `${contentBottomSafeAreaPx}px`}; --bottom-safe-area: {layoutWide ? '12px' : selectionReplacesFooter ? '0px' : `${contentBottomSafeAreaPx}px`}; --selection-bar-offset: {selectionBarHeightPx}px;"
  >
    {#if layoutWide && !(isOffline && !offlineDismissed) && !isOnboardingShell}
      <SidebarNav
        {currentView}
        context={context}
        collapsed={sidebarCollapsed}
        position={sidebarPosition}
        onToggleCollapse={onToggleSidebarCollapse}
        onDensityChange={onDensityChange}
        themeMode={themeMode === 'system' ? 'auto' : themeMode}
        onThemeChange={(mode) => setThemeMode(mode === 'auto' ? 'system' : mode)}
        {contrastLevel}
        onContrastChange={(level) => void setContrastLevel(level)}
        onNavigate={(view) => {
          accountSelectorDropdownOpen = false;
          currentView = view;
        }}
        onLogoClick={() => {
          if (isOnboardingShell) return;
          accountSelectorDropdownOpen = false;
          currentView = 'about';
        }}
        onExpandApp={expandCurrentView}
        organizeTab={organizeTabValue}
        autofillTab={autofillTabValue}
        {mgmtTab}
        mailboxListTab={mailboxListTab}
        onMailboxListTab={(tab) => {
          mailboxListTab = tab as typeof mailboxListTab;
        }}
        mailboxLabels={sidebarMailboxLabels}
        mailboxLabelCounts={mailboxLabelCounts}
        activeMailboxLabel={activeMailboxLabel}
        onMailboxLabel={(lab) => {
          activeMailboxLabel = lab;
        }}
        onMailboxFolderDrop={(tab) => {
          if (tab === 'archived') {
            void selectionFor('mailbox')?.api.run('archive');
            mailboxListTab = 'archived';
            activeMailboxLabel = null;
          } else if (tab === 'deleted') {
            void selectionFor('mailbox')?.api.run('delete');
            mailboxListTab = 'deleted';
            activeMailboxLabel = null;
          } else if (tab === 'inbox') {
            if (mailboxListTab === 'archived' || mailboxListTab === 'deleted') {
              void selectionFor('mailbox')?.api.run('restore');
            }
            mailboxListTab = 'inbox';
            activeMailboxLabel = null;
          } else if (tab === 'all') {
            mailboxListTab = 'all';
            activeMailboxLabel = null;
          } else if (tab === 'storedLocally') {
            mailboxListTab = 'storedLocally';
            activeMailboxLabel = null;
          }
        }}
        onMailboxLabelDrop={(lab) => {
          void selectionFor('mailbox')?.api.applyTag?.(lab);
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
        {unreadByAddress}
        showBack={showHeaderBack}
        onBack={handleHeaderBack}
        density={uiDensity}
        loading={loading || loadingEmails}
        providerInstances={settingsState.providerInstances}
        onCreateAddressWithProvider={handleCreateAddressWithProvider}
        onOpenProviderSettings={openMailProviderSettings}
        selectedEmail={selectedEmail}
        allAddresses={allAddresses}
        onSelectAddress={(addr) => void selectAddress(addr)}
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
              allAddresses.find((a) => a.address === selectedEmail)?.id ||
              accounts.find((a) => a.address === selectedEmail)?.id;
            if (id) void refreshMailbox(id);
            else void refreshMailbox();
          } else if (kind === 'createAddress') {
            openCreateAddressDialog();
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
            // FAB "expand" on message detail → open the full app window with
            // the current view (same as the header expand button).
            void expandCurrentView();
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
    <!-- Shell content column (right of sidebar). -->
    <div
      class="flex flex-col flex-1 min-h-0 relative min-w-0
        {layoutWide ? 'page-inset-wide py-2' : ''}"
      data-density={uiDensity}
      data-content-shell
    >
    {#if isOffline && !offlineDismissed}
      <OfflineBanner onDismiss={() => { offlineDismissed = true; }} />
    {:else if !layoutWide && addressBootstrapReady}
      <!-- Header title + More chrome are driven by the shared nav layout
           (computeNavLayout), so they always mirror the real More menu. -->
      <Header
        contrastLevel={contrastLevel}
        onContrastChange={(level) => void setContrastLevel(level)}
        themeMode={themeMode === 'system' ? 'auto' : themeMode}
        onThemeChange={(mode) => setThemeMode(mode === 'auto' ? 'system' : mode)}
        onExpand={expandCurrentView}
        showBack={showHeaderBack}
        morePageChrome={isMoreOnlyPage && !showHeaderBack}
        pageTitle={isMoreOnlyPage && !showHeaderBack ? headerPageTitle : ''}
        pageIcon={isMoreOnlyPage && !showHeaderBack ? headerPageIcon : undefined}
        onBack={handleHeaderBack}
        onLogoClick={() => {
          if (isOnboardingShell) return;
          accountSelectorDropdownOpen = false;
          currentView = 'about';
        }}
      />
    {/if}

    <!-- Main content - floats under the floating nav; each view has its own end-of-list spacer -->
    <ClipboardCountdown />
    <div class="flex-1 min-h-0 overflow-hidden overflow-x-hidden relative grid grid-cols-1 [grid-template-rows:minmax(0,1fr)]">
  {#if !addressBootstrapReady}
    <AppLoadingSkeleton
      className="flex-1 min-h-0 flex flex-col gap-3 p-3 bg-md-surface"
      ariaLabel={$t('common.loading')}
    />
  {:else}
  {#key currentView}
  <div
    class="view-crossfade col-start-1 row-start-1 min-h-0 min-w-0 flex flex-col overflow-hidden"
    transition:fly={{ y: 4, duration: motionPreference.enabled ? 0 : 180, easing: cubicOut }}
  >

  {#if currentView === 'addresses'}
    <AddressesSplitView
      {layoutSplit}
      {layoutVerticalSplit}
      {splitModeFlash}
      {showSplitPane}
      {splitPaneCollapsed}
      hideDetailWhileSelecting={layoutVerticalSplit && currentView === 'addresses' && $activeSelectionStore?.surface === 'addresses'}
      {splitListWidthPx}
      {currentEmailDetail}
      {emails}
      {savedLogins}
      {loading}
      {mgmtTab}
      {mgmtSearch}
      {selectedAddresses}
      {mgmtAddresses}
      {allAddresses}
      {allSelected}
      {loadingAddresses}
      allStoredEmails={allStoredEmails}
      autoRenewWindowMinutes={settingsState.autoRenewWindowMinutes}
      {addressViewTagDialogOpen}
      {addressViewTagTarget}
      {addressViewTagTargets}
      {allExistingTags}
      {allTagColors}
      {allTagAddresses}
      {highlightAddress}
      onBack={() => {
        currentView = 'mailbox';
        selectedAddresses = new Set();
        mgmtSearch = '';
        currentEmailDetail = null;
      }}
      onDetailBack={() => { currentEmailDetail = null; }}
      onTabChange={(tab) => { mgmtTab = tab; selectedAddresses = new Set(); }}
      onSearchChange={(value) => mgmtSearch = value}
      onScrollDirection={handleScrollDirection}
      onToggleSelectAll={toggleSelectAll}
      onToggleSelect={toggleSelect}
      onArchiveSelected={archiveSelected}
      onUnarchiveSelected={unarchiveSelected}
      onDeleteSelected={deleteSelected}
      onExportSelected={exportSelected}
      onMarkSelectedRead={async () => {
        await markAddressesReadUnread(
          markReadDeps,
          Array.from(selectedAddresses)
            .map((id) => allAddresses.find((a) => a.id === id))
            .filter((a): a is Address => Boolean(a)),
          true
        );
      }}
      onMarkSelectedUnread={async () => {
        await markAddressesReadUnread(
          markReadDeps,
          Array.from(selectedAddresses)
            .map((id) => allAddresses.find((a) => a.id === id))
            .filter((a): a is Address => Boolean(a)),
          false
        );
      }}
      onTagSelected={openAddressViewTagDialogForSelected}
      onOpenAddressView={openAddressView}
      onArchiveAddress={archiveAddress}
      onUnarchiveAddress={unarchiveAddress}
      onDeleteAddresses={deleteAddressesDirect}
      onArchiveAddresses={archiveAddressesBulk}
      onUnarchiveAddresses={unarchiveAddressesBulk}
      onRenewAddresses={renewAddressesBulk}
      onExportAddressEmails={exportAddressEmails}
      onGenerateNewAddress={() => openCreateAddressDialog()}
      onEditAddress={openAddressView}
      onExtendAddress={extendAddress}
      onToggleAutoExtend={toggleAutoExtend}
      onTagAddress={openAddressViewTagDialog}
      onMarkAddressAllRead={async (account) => {
        await markAddressesReadUnread(markReadDeps, [account], true);
      }}
      onMarkAddressAllUnread={async (account) => {
        await markAddressesReadUnread(markReadDeps, [account], false);
      }}
      onReorderAddresses={reorderAddressesById}
      onOpenMessageDetail={openMessageDetail}
      onRefreshMessages={refreshCurrentAddressMessages}
      onExportEmail={() => { if (currentEmailDetail) exportAddressEmails(currentEmailDetail); }}
      onAddressDomainChanged={handleAddressDomainChanged}
      onNavigateToMailbox={navigateFromAddressToMailbox}
      onRemoveAddress={async (address) => { await removeAddress(address); currentEmailDetail = null; }}
      onToggleDetailAutoExtend={handleAddressAutoExtend}
      onExtendDetailAddress={handleAddressExtend}
      onOpenDetailTagDialog={() => { if (currentEmailDetail) openAddressViewTagDialog(currentEmailDetail); }}
      onOpenSite={openSiteOverview}
      onOpenQrDialog={openQrDialog}
      onOpenSavedLogins={(email, domain) => {
        loginInfoEmailFilter = email;
        paletteWebsiteFilter = domain || '';
        paletteWebsiteFilterSignal += 1;
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
      showToast={addressDetailToast}
      onCloseTagDialog={closeAddressViewTagDialog}
      onManageTags={() => openOrganizeTab('tags')}
      onSaveTags={saveAddressViewTags}
      onToggleSplitPane={toggleSplitPane}
      onWidthChange={(value) => (splitListWidthPx = value)}
      onExpandSplitPane={expandSplitPane}
    />

  {:else if currentView === 'addressView'}
    <AddressDetailPane
      mode="page"
      onOpenSite={openSiteOverview}
      currentEmailDetail={currentEmailDetail}
      emails={emails}
      savedLogins={savedLogins}
      loading={loading}
      onBack={() => { currentView = 'addresses'; currentEmailDetail = null; }}
      onNavigateToMailbox={navigateFromAddressToMailbox}
      onOpenMessageDetail={openMessageDetail}
      onRefreshMessages={refreshCurrentAddressMessages}
      onExportEmail={() => {
        if (currentEmailDetail) exportAddressEmails(currentEmailDetail);
      }}
      onAddressDomainChanged={handleAddressDomainChanged}
      onArchiveAddress={archiveAddress}
      onUnarchiveAddress={handleAddressUnarchive}
      onRemoveAddress={removeAddress}
      onToggleAutoExtend={handleAddressAutoExtend}
      onExtendAddress={handleAddressExtend}
      onOpenTagDialog={() => {
        if (currentEmailDetail) openAddressViewTagDialog(currentEmailDetail);
      }}
      onOpenQrDialog={openQrDialog}
      onOpenSavedLogins={(email, domain) => {
        loginInfoEmailFilter = email;
        paletteWebsiteFilter = domain || '';
        paletteWebsiteFilterSignal += 1;
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
      tagUsage={allTagAddresses}
      tagColors={allTagColors}
      showToast={addressDetailToast}
    />

  {:else if currentView === 'settings'}
    <SettingsView
      {context}
      {...providerProps}
      initialSubpage={settingsSubpage}
      onSubpageBack={handleSettingsSubpageBack}
      onBack={() => {
        settingsSubpage = null;
        if (previousViewBeforeSubpage && previousViewBeforeSubpage !== 'settings') {
          currentView = previousViewBeforeSubpage;
          previousViewBeforeSubpage = null;
        } else {
          currentView = 'mailbox';
        }
      }}
      autoCopy={settingsState.autoCopy}
      autoRenewWindowMinutes={settingsState.autoRenewWindowMinutes}
      savingSettings={settingsState.savingSettings}
      loading={settingsState.settingsLoading}
      onSetAutoCopy={settingsSetters.setAutoCopy}
      onSetAutoRenewWindowMinutes={settingsSetters.setAutoRenewWindowMinutes}
      onHardReset={hardReset}
      onExportData={exportData}
      onImportData={importData}
      loadAddresses={stableLoadAddresses}
      customColor={settingsState.customColor}
      globalZoomEnabled={settingsState.globalZoomEnabled}
      {globalZoomScale}
      {pageZoomSettings}
      {onTogglePageZoom}
      {onChangePageZoom}
      onToggleGlobalZoom={async (enabled) => {
        settingsSetters.setGlobalZoomEnabled(enabled);
        await writeWithRetry({ globalZoomEnabled: enabled });
      }}
      onColorChange={handleColorChange}
addressColorThemeEnabled=  {settingsState.addressColorThemeEnabled}
      onToggleAddressColorTheme={async () => {
        settingsSetters.setAddressColorThemeEnabled(!settingsState.addressColorThemeEnabled);
        await writeWithRetry({ addressColorThemeEnabled: settingsState.addressColorThemeEnabled });
      }}
      {contrastLevel}
      onContrastLevelChange={setContrastLevel}
      showDeveloperSettings={settingsState.showDeveloperSettings}
      enableLogging={settingsState.enableLogging}
      onToggleDeveloperSettings={toggleDeveloperSettings}
      onOpenPlayground={() => { currentView = 'playground'; }}
      onToggleEnableLogging={toggleEnableLogging}
      emailRetentionDays={settingsState.emailRetentionDays}
      onSetEmailRetentionDays={settingsSetters.setEmailRetentionDays}
      onClearOldEmails={cleanupOldEmailsNow}
      faviconCaching={settingsState.faviconCaching}
      onSetFaviconCaching={settingsSetters.setFaviconCaching}
      {identities}
      {selectedIdentityId}
      onSetSelectedIdentityId={setSelectedIdentity}
      onNavigateToIdentities={() => currentView = 'identities'}
      onCreateIdentity={() => {
        identityCreateSignal += 1;
        autofillTabValue = 'profiles';
        autofillTabSignal += 1;
        if (currentView !== 'autofill') currentView = 'autofill';
      }}
      soundEnabled=  {settingsState.soundEnabled}
      keybindings={settingsState.keybindings}
      onSetKeybindings={settingsSetters.setKeybindings}
      onNavigateToKeybindings={() => {
        if (layoutSplit || layoutVerticalSplit) { splitSecondaryView = 'keybindings'; }
        else { currentView = 'keybindings'; }
      }}
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
      onNavigateToMailProvider={() => {
        if (layoutSplit || layoutVerticalSplit) { splitSecondaryView = 'mailProvider'; }
        else { openMailProviderSettings(); }
      }}
      onNavigateToStoragePerformance={() => {
        if (layoutSplit || layoutVerticalSplit) { splitSecondaryView = 'storagePerformance'; }
        else { currentView = 'storagePerformance'; }
      }}
      onNavigateToAddressAccentColors={() => {
        if (layoutSplit || layoutVerticalSplit) { splitSecondaryView = 'addressAccentColors'; }
        else { currentView = 'addressAccentColors'; }
      }}
      onNavigateToLabelManagement={() => {
        organizeTabValue = 'labels';
        organizeTabSignal += 1;
        currentView = 'organize';
      }}
      onNavigateToAddresses={() => { currentView = 'addresses'; }}
      onNavigateToAutomation={() => { currentView = 'automation'; }}
      onNavigateToConstantsSettings={() => {
        if (layoutSplit || layoutVerticalSplit) { splitSecondaryView = 'constantsSettings'; }
        else { currentView = 'constantsSettings'; }
      }}
      onNavigateToDiagnostics={() => {
        if (layoutSplit || layoutVerticalSplit) { splitSecondaryView = 'diagnostics'; }
        else { currentView = 'diagnostics'; }
      }}
      {allAddresses}
      {autofillBlocklist}
      onRemoveFromBlocklist={removeFromAutofillBlocklist}
      onAddToBlocklist={addToAutofillBlocklistSetting}
      onToggleBlocklist={toggleAutofillBlocklistSetting}
      {layoutSplit}
      {layoutVerticalSplit}
      {splitModeFlash}
      {showSplitPane}
      {splitPaneCollapsed}
      {splitListWidthPx}
      {splitSecondaryView}
      onToggleSplitPane={toggleSplitPane}
      onWidthChange={(value) => (splitListWidthPx = value)}
      onExpandSplitPane={expandSplitPane}
      onCloseSecondary={() => (splitSecondaryView = null)}
    />
  {:else if currentView === 'analytics'}
    <SecondaryViews
      currentView="analytics"
      onOpenActivityEvent={openActivityEvent}
      onOpenOrganizeAddress={async (address) => { await openAddressView(address); }}
      onOpenOrganizeMessage={(email) => openMessageDetail([email])}
      onApplyOrganizeFilter={applyOrganizeFilter}
      {context}
      {...providerProps}
      {version}
      {selectedThread}
      {hasPrevMessage}
      {hasNextMessage}
      {selectedEmail}
      {analytics}
      {analyticsLoading}
      keybindings={settingsState.keybindings}
      {allAddresses}
      {savedSearchFilters}
      {organizeTabValue}
      {organizeTabSignal}
      {tagCreateSignal}
      {labelCreateSignal}
      faviconCaching={settingsState.faviconCaching}
      emailRetentionDays={settingsState.emailRetentionDays}
      onBackToMailbox={() => (currentView = 'mailbox')}
      onBackToSettings={() => (currentView = 'settings')}
      onLoadAnalytics={loadAnalytics}
      onResetAnalytics={handleResetAnalytics}
      onSetKeybindings={settingsSetters.setKeybindings}
      onReloadAddresses={async () => { await loadAddresses(true); }}
      onFiltersChange={async () => { await loadSavedSearchFilters(); }}
      {showConfirm}
      onTabChange={(tab) => (organizeTabValue = tab)}
      onSetFaviconCaching={settingsSetters.setFaviconCaching}
      onSetEmailRetentionDays={settingsSetters.setEmailRetentionDays}
      onClearOldEmails={cleanupOldEmailsNow}
      onMailBack={() => { currentView = 'mailbox'; selectedThread = []; }}
      onPrevMessage={navigateToPrevMessage}
      onNextMessage={navigateToNextMessage}
      onCreateRuleFromMessage={createRuleFromMessage}
      onMarkUnread={() => markSelectedThreadUnreadAndClose('page')}
      onArchiveMessage={() => archiveSelectedThread('page')}
      onDeleteMessage={() => deleteSelectedThread('page')}
      onSearchText={searchFromMessage}
      onManageLabels={() => openOrganizeTab('labels')}
      {showToast}
      onStartProductTour={startProductTour}
      onOpenKeyboardShortcuts={() => overlaySetters.setCheatSheetOpen(true)}
      onOpenDiagnostics={() => (currentView = 'diagnostics')}
      onAboutBack={handleAboutBack}
      {automationInitialSender}
    />

  {:else if currentView === 'autofill' || currentView === 'loginInfo' || currentView === 'identities'}
    <AutofillSplitView
      {context}
      {layoutSplit}
      {layoutVerticalSplit}
      {splitModeFlash}
      {showSplitPane}
      {splitPaneCollapsed}
      {splitListWidthPx}
      bind:splitHostRef
      initialTab={currentView === 'loginInfo'
        ? 'credentials'
        : currentView === 'identities'
          ? 'profiles'
          : autofillTabValue}
      tabSignal={autofillTabSignal}
      tabSignalValue={autofillTabValue}
      onTabChange={(tab) => { autofillTabValue = tab; }}
      {paletteWebsiteFilter}
      {paletteWebsiteFilterSignal}
      {initialSiteDomain}
      {savedLogins}
      {identities}
      allAddresses={allAddresses}
      mailboxAddresses={allAddresses.map((a) => a.address).filter(Boolean)}
      activeMailboxAddress={selectedEmail || accounts[0]?.address || ''}
      {loginInfoEmailFilter}
      {identitiesEmailFilter}
      focusSearchSignal={savedLoginsFocusSignal}
      identityCreateSignal={identityCreateSignal}
      identityEditIdSignal={identityEditIdSignal}
      vaultLockSignal={vaultLockSignal}
      onDeleteLogin={onDeleteLogin}
      onReorderLogin={onReorderLogin}
      onOpenInbox={async (address) => {
        await selectAddress(address);
        currentView = 'mailbox';
      }}
      onShowToast={(message) => showToast(message)}
      onShowConfirm={(message, onConfirm, options) => showConfirm(message, onConfirm, options)}
      onToggleSplitPane={toggleSplitPane}
      onWidthChange={(value) => (splitListWidthPx = value)}
      onExpandSplitPane={expandSplitPane}
    />

  {:else if currentView === 'keybindings' || currentView === 'organize' || currentView === 'tagManagement' || currentView === 'labelManagement' || currentView === 'filtersManagement' || currentView === 'mailProvider' || currentView === 'storagePerformance' || currentView === 'addressAccentColors' || currentView === 'constantsSettings' || currentView === 'diagnostics' || currentView === 'mailView' || currentView === 'automation' || currentView === 'playground' || currentView === 'about'}
    <SecondaryViews
      {currentView}
      onOpenActivityEvent={openActivityEvent}
      onOpenOrganizeAddress={async (address) => { await openAddressView(address); }}
      onOpenOrganizeMessage={(email) => openMessageDetail([email])}
      onApplyOrganizeFilter={applyOrganizeFilter}
      {context}
      {...providerProps}
      {version}
      {selectedThread}
      {hasPrevMessage}
      {hasNextMessage}
      {selectedEmail}
      {analytics}
      {analyticsLoading}
      keybindings={settingsState.keybindings}
      {allAddresses}
      {savedSearchFilters}
      {organizeTabValue}
      {organizeTabSignal}
      {tagCreateSignal}
      {labelCreateSignal}
      faviconCaching={settingsState.faviconCaching}
      emailRetentionDays={settingsState.emailRetentionDays}
      onBackToMailbox={() => (currentView = 'mailbox')}
      onBackToSettings={() => (currentView = 'settings')}
      onLoadAnalytics={loadAnalytics}
      onResetAnalytics={handleResetAnalytics}
      onSetKeybindings={settingsSetters.setKeybindings}
      onReloadAddresses={async () => { await loadAddresses(true); }}
      onFiltersChange={async () => { await loadSavedSearchFilters(); }}
      {showConfirm}
      onTabChange={(tab) => (organizeTabValue = tab)}
      onSetFaviconCaching={settingsSetters.setFaviconCaching}
      onSetEmailRetentionDays={settingsSetters.setEmailRetentionDays}
      onClearOldEmails={cleanupOldEmailsNow}
      onMailBack={() => { currentView = 'mailbox'; selectedThread = []; }}
      onPrevMessage={navigateToPrevMessage}
      onNextMessage={navigateToNextMessage}
      onCreateRuleFromMessage={createRuleFromMessage}
      onMarkUnread={() => markSelectedThreadUnreadAndClose('page')}
      onArchiveMessage={() => archiveSelectedThread('page')}
      onDeleteMessage={() => deleteSelectedThread('page')}
      onSearchText={searchFromMessage}
      {showToast}
      onStartProductTour={startProductTour}
      onOpenKeyboardShortcuts={() => overlaySetters.setCheatSheetOpen(true)}
      onOpenDiagnostics={() => (currentView = 'diagnostics')}
      onAboutBack={handleAboutBack}
      {automationInitialSender}
    />

  {:else if addressBootstrapReady && accounts.length === 0 && !loadingAddresses && allAddresses.length === 0}
    <Onboarding
      introBoundsEl={layoutRootEl}
      onCreateAddress={async (provider, preparationId) => {
        if (preparationId) {
          const prepared = await browser.runtime.sendMessage({ type: 'adoptOnboardingAddress', sessionId: preparationId, provider }) as { success?: boolean; unavailable?: boolean; address?: string; error?: string };
          if (prepared.success && prepared.address) {
            await loadAddresses();
            await loadSettings();
            return;
          }
          // Only an unavailable draft permits a fresh create. Storage/commit
          // errors must not silently create a second inbox after a partial write.
          if (!prepared.unavailable) throw new AddressCreationError(provider);
        }
        const addr = await createAddress(provider);
        await loadSettings();
        if (!addr) {
          // Keyed error: Onboarding renders it through the error-code map, so
          // the failure copy stays localized (never a hardcoded English string).
          throw new AddressCreationError(provider);
        }
      }}
      onStartProductTour={() => {
        setTimeout(() => {
          void startProductTour();
        }, 450);
      }}
      onImportBackup={() => {
        overlayState.showImportBackupDialog = true;
      }}
    />

  {:else}
    <!-- Floor for an unrenderable view id: the handoff layer validates ids,
         so this state means a writer bypassed validation or shipped a view
         the switch does not know. Render an explicit state, never mailbox
         content under an unknown id. -->
    {#if !isView(currentView)}
      <div class="flex-1 min-h-0 flex flex-col items-center justify-center p-6">
        <EmptyState
          icon="warning"
          title={$t('common.unknownViewTitle')}
          description={$t('common.unknownViewDescription')}
          actionLabel={$t('nav.mailbox')}
          onAction={() => (currentView = 'mailbox')}
        />
      </div>
    {:else}
    {#if currentView === 'mailbox' && contentReloadRequiredTabId !== null}
      <section
        role="status"
        aria-live="polite"
        class="shrink-0 mx-1 mb-1 px-3 py-2 bg-md-error/10 border border-md-error/20 rounded-xl flex items-center gap-2 text-xs"
      >
        <Icon name="warning" class="w-4 h-4 text-md-error flex-shrink-0" />
        <div class="min-w-0 flex-1 text-md-on-surface">
          <p class="font-semibold">{$t('inbox.staleContentTitle')}</p>
          <p class="text-md-on-surface/75">{$t('inbox.staleContentMessage')}</p>
        </div>
        <button
          class="shrink-0 px-2 py-1 rounded-lg bg-md-error text-md-on-error text-label-sm font-semibold hover:bg-md-error/90 active:brightness-95 transition-colors"
          onclick={() => void onReloadRequiredTab?.()}
        >
          {$t('inbox.staleContentReload')}
        </button>
      </section>
    {/if}
    {#if currentView === 'mailbox' && humanVerificationRequired}
      <section role="status" aria-live="polite" class="shrink-0 mx-1 mb-2 p-3 rounded-xl bg-md-tertiary-container text-md-on-tertiary-container flex items-start gap-2">
        <Icon name="warning" class="w-5 h-5 shrink-0" />
        <p class="text-body-md">{$t('contentAutofill.humanVerificationRequired')}</p>
      </section>
    {/if}
    {#if !retentionCleanupDismissed && oldEmailCount > 0}
      <div class="shrink-0 mx-1 mb-1 px-3 py-2 bg-md-primary/10 border border-md-primary/20 rounded-xl flex items-center gap-2 text-xs">
        <Icon name="schedule" class="w-4 h-4 text-md-primary flex-shrink-0" />
        <span class="flex-1 text-md-on-surface">
          {$t('inbox.retentionCleanupPrompt', { values: { count: oldEmailCount } })}
        </span>
        <div class="flex flex-nowrap items-center gap-2 shrink-0" use:responsiveButtonLayout data-action-tier="XS">
          <button
            class="h-8 rounded-lg bg-md-primary text-md-on-primary font-semibold hover:bg-md-primary/90 active:brightness-95 transition-colors"
            onclick={(e) => { e.stopPropagation(); void cleanupOldEmailsNow(); }}
          >
            {$t('common.delete')}
          </button>
          <button
            class="h-8 flex items-center justify-center rounded-full hover:bg-md-secondary-container active:bg-md-secondary-container-pressed transition-colors"
            onclick={(e) => { e.stopPropagation(); void dismissRetentionCleanup(); }}
            aria-label={$t('common.close')}
          >
            <Icon name="close" class="w-4 h-4 text-md-on-surface/60" />
          </button>
        </div>
      </div>
    {/if}
    {#if showQuotaBanner}
      <div class="shrink-0 mx-1 mb-1 px-3 py-2 bg-md-error/10 border border-md-error/20 rounded-xl flex items-center gap-2 text-xs">
        <Icon name="warning" class="w-4 h-4 text-md-error flex-shrink-0" />
        <span class="flex-1 text-md-on-surface">
          {$t('settings.storageNearLimit', { values: { used: formatBytes(quotaUsedBytes), limit: formatBytes(CONSTANTS.STORAGE_LIMIT) } })}
        </span>
        <div class="flex flex-nowrap items-center gap-2 shrink-0" use:responsiveButtonLayout data-action-tier="XS">
          <button
            class="h-8 rounded-lg bg-md-error text-md-on-error font-semibold hover:bg-md-error/90 active:brightness-95 transition-colors"
            onclick={(e) => { e.stopPropagation(); void handleRequestQuotaUnlimitedStorage(); }}
          >
            {$t('common.confirm')}
          </button>
          <button
            class="h-8 flex items-center justify-center rounded-full hover:bg-md-secondary-container active:bg-md-secondary-container-pressed transition-colors"
            onclick={(e) => { e.stopPropagation(); void dismissQuotaBanner(); }}
            aria-label={$t('common.close')}
          >
            <Icon name="close" class="w-4 h-4 text-md-on-surface/60" />
          </button>
        </div>
      </div>
    {/if}
    <MailboxSplitView
      {context}
      {...providerProps}
      {layoutWide}
      {layoutSplit}
      {layoutVerticalSplit}
      {splitModeFlash}
      {showSplitPane}
      {splitPaneCollapsed}
      hideDetailWhileSelecting={layoutVerticalSplit && currentView === 'mailbox' && $activeSelectionStore?.surface === 'mailbox'}
      {splitListWidthPx}
      {selectedThread}
      {openMessageTabs}
      {activeMessageTabKey}
      onSelectMessageTab={selectMessageTab}
      onCloseMessageTab={closeMessageTab}
      {onMessageScroll}
      {providerFailoverHint}
      {allAddresses}
      {mailProviderSplitOpen}
      {hasPrevMessage}
      {hasNextMessage}
      onToggleSplitPane={toggleSplitPane}
      onWidthChange={(value) => (splitListWidthPx = value)}
      onExpandSplitPane={expandSplitPane}
      onSetMailProviderSplitOpen={(open) => (mailProviderSplitOpen = open)}
      onCloseMessageDetail={() => closeMessageTab(activeMessageTabKey)}
      onMarkUnread={markSelectedThreadUnreadAndClose}
      onArchiveThread={archiveSelectedThread}
      onDeleteThread={deleteSelectedThread}
      onPrevMessage={navigateToPrevMessage}
      onNextMessage={navigateToNextMessage}
      onSearchText={searchFromMessage}
      selectedEmail={selectedEmail}
      bind:displayedEmail
      bind:emailListTab={mailboxListTab}
      bind:activeLabelFilter={activeMailboxLabel}
      dropdownOpen={accountSelectorDropdownOpen}
      accounts={accounts}
      loading={loading || loadingEmails}
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
      dateFrom={dateFrom}
      dateTo={dateTo}
      activeThreadMessageId={selectedThread[0]?.id || ''}
      activeThreadInbox={selectedThread[0]?.original_inbox || selectedEmail}
      filteredEmails={filteredEmails}
      emails={emails}
      allStoredEmails={allStoredEmails}
      latestOtp={latestOtp}
      latestOtpSender={latestOtpSender}
      latestOtpSenderName={latestOtpSenderName}
      otpContext={otpContext}
      formDetected={formDetected}
      savedSearchFilters={savedSearchFilters}
      savedLogins={savedLogins}
      openSection={archivedSectionOpen}
      onOpenMagicLink={(url, address) => {
        void (async () => {
          try {
            const inbox = address || selectedEmail;
            const addressId = allAddresses.find(a => a.address === inbox)?.id ||
              accounts.find(a => a.address === inbox)?.id;
            const response = await browser.runtime.sendMessage({ type: 'openSignupVerificationLink', url, addressId });
            if (!response?.success) throw new Error('operation-failed');
          } catch (error) {
            logError('Could not open verification link', error);
            showToast($t('toasts.operationFailed'), 'error');
          }
        })();
      }}
      onRefillSavedLogin={(login) => {
        void (async () => {
          try {
            const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
            if (tab?.id) {
              let tabHost = '';
              try {
                tabHost = tab.url ? new URL(tab.url).hostname : '';
              } catch {
                // Browser-internal and malformed URLs cannot receive saved credentials.
              }
              if (!hostMatchesDomainScope(tabHost, login.domain)) {
                showToast($t('toasts.autofillFailed'), 'error');
                return;
              }
              const response = (await browser.tabs.sendMessage(tab.id, {
                type: 'refillSavedLogin',
                credential: {
                  domain: login.domain,
                  email: login.email,
                  password: login.password,
                  username: login.username,
                  name: login.name,
                  phone: login.phone,
                },
              })) as { success?: boolean } | undefined;
              if (response?.success === true) {
                showToast($t('toasts.autofillStarted'), 'success');
              } else {
                showToast($t('toasts.autofillFailed'), 'error');
              }
            }
          } catch (e) {
            logError('refillSavedLogin failed', e);
            showToast($t('toasts.autofillFailed'), 'error');
          }
        })();
      }}
      onSaveFilterQuick={() => {
        // Localized default name; a raw `Filter <date>` leaked English into every locale.
        const name = $t('filtersManagement.quickSaveDefaultName', { values: { date: localDateStamp() } });
        void saveFilter({
          name,
          searchQuery,
          hasOTP: otpOnly,
          hasAttachment,
          unreadOnly,
          senderDomain,
          senderEmail,
          dateFrom,
          dateTo,
          selectedSenders,
          sortBy,
          recipient: selectedEmail,
          subject,
          notSenderDomain,
          notSenderEmail,
          notRecipient,
          notSubject,
        });
        showToast($t('inbox.filterSavedToast'), 'success');
      }}
      onDropdownOpenChange={(open) => accountSelectorDropdownOpen = open}
      onSelectAddress={selectAddress}
      onCopyEmail={async () => {
        try {
          const success = await copyToClipboardAndSchedulePurge(displayedEmail || selectedEmail, 60000);
          if (success) showToast($t('toasts.emailCopiedToClipboard'));
        } catch (e) {
          logError('Failed to copy email', e);
        }
      }}
      onOpenQrDialog={openQrDialog}
      onCreateAddress={openCreateAddressDialog}
      showToast={(message, type, undo) =>
        showToast(
          message,
          (type as ToastType) || 'success',
          undo ?? null,
          undo ? $t('common.undo') : null
        )}
      showConfirm={(message, onConfirm, options) => showConfirm(message, onConfirm, options)}
      onRefreshMailbox={refreshMailbox}
      onToggleNotifications={toggleNotifications}
      onArchiveAddress={archiveAddress}
      onUnarchiveAddress={unarchiveAddress}
      onRemoveAddress={removeAddress}
      onRestoreAddress={restoreAddress}
      onReloadAddresses={loadAddresses}
      onToggleAutoExtend={toggleAutoExtend}
      onExtendAddress={extendAddress}
      onAutofillForm={() => void autofillForm()}
      onCreateIdentity={() => {
        identityCreateSignal += 1;
        autofillTabValue = 'profiles';
        autofillTabSignal += 1;
        currentView = 'autofill';
      }}
      scrollChromeHidden={scrollChromeHidden}
      onScrollDirection={handleScrollDirection}
      onOpenMessageDetail={openMessageDetail}
      onSearchChange={(v) => {
        applySearchQuery(v);
      }}
      onSortChange={(v) => sortBy = v}
      onOtpOnlyChange={(v) => otpOnly = v}
      onUnreadOnlyChange={(v) => unreadOnly = v}
      onHasAttachmentChange={(v) => hasAttachment = v}
      onSenderDomainChange={(v) => senderDomain = v}
      onSelectedSendersChange={(v) => selectedSenders = v}
      onDateFromChange={(v) => dateFrom = v}
      onDateToChange={(v) => dateTo = v}
      onClearFilters={clearFilters}
      onArchiveEmails={archiveSelectedEmails}
      onDeleteEmails={deleteSelectedEmails}
      onRestoreEmails={restoreSelectedEmails}
      onSaveFilter={(name, sq, otp, att, sd, df, dt, senders, sort, rec, subj, unread) => {
        void saveFilter({
          name,
          searchQuery: sq,
          hasOTP: otp,
          hasAttachment: att,
          unreadOnly: unread,
          senderDomain: sd,
          senderEmail,
          dateFrom: df,
          dateTo: dt,
          selectedSenders: senders,
          sortBy: sort,
          recipient: rec || '',
          subject: subj || '',
          notSenderDomain,
          notSenderEmail,
          notRecipient,
          notSubject,
        });
      }}
      onLoadFilter={loadFilter}
      onRenameFilter={renameFilter}
      onDeleteFilter={deleteFilter}
      onNavigateToManage={() => {
        accountSelectorDropdownOpen = false;
        // Safety: remove any portaled account-selector overlay left on document.body
        try {
          document.querySelectorAll('.account-selector-overlay').forEach((n) => n.remove());
        } catch {
          /* ignore */
        }
        currentView = 'addresses';
      }}
      onToggleAutoRenew={async () => {
        settingsState.autoRenew = !settingsState.autoRenew;
        await saveAutoRenew();
      }}
      onCopyOtpFromMessage={copyOtpFromMessage}
      onCreateRuleFromEmail={(from) => {
        automationInitialSender = from || '';
        selectedThread = [];
        currentView = 'automation';
      }}
      onManageTags={() => openOrganizeTab('tags')}
      onManageLabels={() => openOrganizeTab('labels')}
    />
  {/if}
    {/if}

  </div>
  {/key}
  {/if}

        <!-- Toasts are position:fixed; offline strip replaces header (above) -->
        <ToastContainer />

      <!-- Footer - hidden in wide sidebar layout -->
      {#if addressBootstrapReady && !layoutWide && !hideFloatingFooterForDetail && !selectionReplacesFooter && (accounts.length > 0 || allAddresses.length > 0) && !isOnboardingShell}
        <FloatingFooter
          bind:rootElement={bottomFloatingLayerEl}
          {currentView}
          {scrollChromeHidden}
          organizeTab={organizeTabValue}
          {accounts}
          {unreadByAddress}
          loading={loading || loadingEmails}
          providerInstances={settingsState.providerInstances}
          onNavigate={(view) => {
            accountSelectorDropdownOpen = false;
            mailProviderSplitOpen = false;
            settingsSubpage = null;
            currentView = view;
          }}
          onLongPressNavbar={handleLongPressNavbar}
          onCreateAddressWithProvider={handleCreateAddressWithProvider}
          onOpenProviderSettings={openMailProviderSettings}
          onRefresh={() => {
            const id =
              allAddresses.find((a) => a.address === selectedEmail)?.id ||
              accounts.find((a) => a.address === selectedEmail)?.id;
            return id ? refreshMailbox(id) : refreshMailbox();
          }}
          onCreateAddress={openCreateAddressDialog}
          onCreateIdentity={() => {
            identityCreateSignal += 1;
            autofillTabValue = 'profiles';
            autofillTabSignal += 1;
            if (currentView !== 'autofill') currentView = 'autofill';
          }}
          onCreateTag={() => {
            tagCreateSignal += 1;
            organizeTabValue = 'tags';
            organizeTabSignal += 1;
            if (currentView !== 'organize') currentView = 'organize';
          }}
          onCreateLabel={() => {
            labelCreateSignal += 1;
            organizeTabValue = 'labels';
            organizeTabSignal += 1;
            if (currentView !== 'organize') currentView = 'organize';
          }}
          onCreateFilter={() => {
            organizeTabValue = 'filters';
            organizeTabSignal += 1;
            if (currentView !== 'organize') currentView = 'organize';
          }}
          onOpenSavedLogins={() => {
            autofillTabValue = 'credentials';
            autofillTabSignal += 1;
            if (currentView !== 'autofill') currentView = 'autofill';
            savedLoginsFocusSignal += 1;
          }}
          onExpandCurrentView={expandCurrentView}
          onScrollToTop={() => {
            try {
              document
                .querySelector('.view-crossfade, .flex-1.min-h-0.overflow-y-auto, main')
                ?.scrollTo?.({ top: 0, behavior: 'smooth' });
              window.scrollTo({ top: 0, behavior: 'smooth' });
            } catch {
              /* ignore */
            }
          }}
          demoModeActive={overlayState.demoModeActive}
          onExitDemoMode={async () => {
            const { exitDemoMode } = await import('@/features/demo/demo-mode.js');
            await exitDemoMode(browser);
            overlayState.demoModeActive = false;
            await loadAddresses();
            showToast($t('preferences.demoModeDisabled'), 'info');
          }}
        />
      {/if}
      <!-- THE selection strip, for every list that publishes one. It renders
           whichever surface is live (mailbox, addresses, identities, saved
           logins), so it needs no view gate: a published surface only exists
           while its list is mounted, and addresses/identities are ALSO rendered
           inside settings subpages that a `currentView === 'mailbox'` test would
           have hidden it from. Its measured height rides out as
           `--selection-bar-offset` so a list's own bottom chrome lifts above it. -->
      <ListSelectionBar onMeasure={(heightPx: number) => (selectionBarHeightPx = heightPx)} />
      </div><!-- content area -->
      </div><!-- main column (header/content/footer) -->
    </div><!-- shell -->
  </div><!-- outer -->

  {#if overlayState.QrDialogComponent}
    {@const QrDialogComponent = overlayState.QrDialogComponent}
    <QrDialogComponent
      open={overlayState.qrDialogOpen}
      selectedEmail={qrDialogEmail || displayedEmail || selectedEmail}
      bind:qrCanvas
      onClose={closeQrDialog}
      onDownload={downloadQrCode}
      onCopyImage={copyQrImage}
    />
  {/if}

  <CreateAddressDialog
    open={overlayState.createAddressDialogOpen}
    onClose={() => {
      overlayState.createAddressDialogOpen = false;
      overlayState.pendingCreateProviderConfig = undefined;
    }}
    onCreate={handleCreateAddress}
    providerConfig={overlayState.pendingCreateProviderConfig}
  />

  <ConfirmDialog {confirmDialog} onClose={closeConfirm} />
  <!-- Tag dialog for non-split EmailDetail (full mainview) -->
  {#if addressViewTagDialogOpen && !(layoutSplit || layoutVerticalSplit)}
    <TagDialog
      open={addressViewTagDialogOpen}
      currentTag={addressViewTagTargets.length > 1 ? null : (addressViewTagTarget?.tag ?? null)}
      currentTagColor={addressViewTagTargets.length > 1 ? null : (addressViewTagTarget?.tagColor ?? null)}
      currentTags={addressViewTagTargets.length > 1 ? [] : addressTagsList(addressViewTagTarget)}
      existingTags={allExistingTags}
      tagColors={allTagColors}
      tagAddresses={allTagAddresses}
      onClose={closeAddressViewTagDialog}
      onManageTags={() => openOrganizeTab('tags')}
      onSaveTags={saveAddressViewTags}
      portal={true}
    />
  {/if}

  <CommandPalette bind:open={overlayState.commandPaletteOpen} commands={paletteCommands} />

  <!-- Keyboard Shortcuts Cheat Sheet Overlay -->
  <KeyboardShortcutsCheatSheet
    open={overlayState.cheatSheetOpen}
    keybindings={settingsState.keybindings}
    onClose={() => (overlayState.cheatSheetOpen = false)}
    onOpenSettings={() => {
      overlayState.cheatSheetOpen = false;
      if (layoutSplit || layoutVerticalSplit) {
        // The Keyboard Shortcuts editor docks into the Settings split host, so
        // make sure we are on a surface that renders it (mirrors openMailProviderSettings).
        splitSecondaryView = 'keybindings';
        if (currentView !== 'settings') currentView = 'settings';
      } else {
        currentView = 'keybindings';
      }
    }}
  />

  <!-- Interactive Export & Backup Wizard (email formats) -->
  {#if overlayState.ExportWizardDialogComponent && overlayState.exportWizardOpen}
    {@const ExportWizardDialog = overlayState.ExportWizardDialogComponent}
    <ExportWizardDialog
    open={overlayState.exportWizardOpen}
    account={exportWizardAddress}
    messages={exportWizardMessages}
    onClose={() => (overlayState.exportWizardOpen = false)}
    onExecuteExport={handleExecuteExport}
  />
  {/if}

  <!-- Interactive product tour (spotlight) -->
  <ProductTour
    open={overlayState.productTourOpen}
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

  <!-- Full extension backup export/import (lazy-loaded; see AppLayout) -->
  {#if overlayState.ExportBackupDialogComponent && overlayState.showExportBackupDialog}
    {@const ExportBackupDialog = overlayState.ExportBackupDialogComponent}
    <ExportBackupDialog
    open={overlayState.showExportBackupDialog}
    onClose={() => (overlayState.showExportBackupDialog = false)}
    onSuccess={(msg) => showToast(msg || $t('toasts.dataExportedSuccessfully'))}
    onError={(msg) => showToast(msg || $t('toasts.exportFailed'), 'error')}
  />
  {/if}
  {#if overlayState.ImportBackupDialogComponent && overlayState.showImportBackupDialog}
    {@const ImportBackupDialog = overlayState.ImportBackupDialogComponent}
    <ImportBackupDialog
    open={overlayState.showImportBackupDialog}
    onClose={() => (overlayState.showImportBackupDialog = false)}
    loadAddresses={async () => {
      await loadAddresses();
      // loadAddresses only refreshes the account selector - the visible email
      // list stays "Inbox is empty" until something fetches it. Kick off a
      // fetch for the now-active inbox so a backup import / re-authentication
      // actually paints the imported mail instead of waiting for the next poll.
      try {
        const active =
          allAddresses.find((a) => a.address === selectedEmail) ||
          accounts.find((a) => a.address === selectedEmail);
        if (active?.id) void checkMessages(active.id);
      } catch {
        /* ignore */
      }
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
    onSuccess={(summary?: string, result?: import('@/features/settings/backup-actions.js').ImportSummary) => {
      // A replace-mode address import snapshotted the pre-import surface
      // (addresses / index / overflow / ID-keyed bags) - offer a true undo.
      // showToast extends the duration to 10s when an action is attached.
      const undoRevision = result?.undoRevision;
      if (result?.undoAvailable && undoRevision === undefined) {
        logError('Import undo snapshot has no revision; refusing to restore it');
      }
      const undoImport = result?.undoAvailable && undoRevision !== undefined
        ? async () => {
            // A delete/archive/domain-switch/import that landed while this
            // toast was on screen made this undo's pre-import snapshot stale:
            // running it would walk that newer work back. The callback is only
            // offered when the import supplied a revision stamp.
            if (!(await isUndoCurrent(undoRevision))) {
              showToast($t('toasts.undoSuperseded'), 'warning');
              return;
            }
            void restoreImportUndo(browser).finally(() => {
              void loadAddresses();
            });
          }
        : null;
      showToast(
        summary || $t('toasts.dataImportedSuccessfully'),
        'success',
        undoImport,
        undoImport ? $t('common.undo') : null
      );
      void loadAddresses();
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
    onError={(msg?: string) => showToast(msg || $t('toasts.importFailed'), 'error')}
  />
  {/if}
  {#if overlayState.activeTooltip}
    <!-- INVARIANT: this tooltip is `position: fixed` against the VIEWPORT - it
         must never gain a transformed / filtered / will-change ancestor, because
         such an ancestor would make fixed position relative to IT, re-introducing
         the stacking trap it was designed to avoid. layoutRootEl's transition-all
         is fine (no transform value is ever applied to it today) - keep it that
         way; if a transform is ever needed above this point, portal this element
         to document.body first. -->
    {@const _tipAlign = overlayState.activeTooltip.align ?? 'center'}
    <div
      bind:this={tooltipRef}
      class="fixed {PORTAL_Z_CLASS.tooltip} py-1.5 rounded-lg text-xs font-medium bg-md-inverse-surface text-md-inverse-on-surface {ELEVATION.level2} pointer-events-none transition-opacity duration-150 opacity-0 w-max max-w-[min(360px,92vw)] break-words leading-snug {_tipAlign === 'start' ? 'px-[5px] text-start whitespace-pre-line' : 'px-2.5 text-center whitespace-normal'}"
    >
      {overlayState.activeTooltip.text}
    </div>
  {/if}

  {#if viewportTooSmall}
    <!-- This is intentionally non-dismissible: the extension is unusable below
         360px in either dimension, so every pointer and keyboard interaction
         must remain blocked until the host viewport is enlarged. -->
    <div
      bind:this={viewportRestrictionOverlay}
      use:portalDialogAction
      class="fixed inset-0 {PORTAL_Z_CLASS.viewportRestriction} flex items-center justify-center bg-md-scrim/95 p-4 text-md-on-surface overflow-y-auto"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="viewport-restriction-title"
      tabindex="0"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        viewportRestrictionOverlay?.focus();
      }}
    >
      <div class="w-full max-w-sm min-w-0 rounded-2xl bg-md-surface-container {ELEVATION.level3} border border-md-outline-variant/30 p-5 text-center">
        <Icon name="expand" class="mx-auto mb-3 h-10 w-10 text-md-primary" />
        <h2 id="viewport-restriction-title" class="text-base font-bold">{$t('common.viewportTooSmallTitle')}</h2>
        <p class="mt-2 text-sm text-md-on-surface/70">{$t('common.viewportTooSmallDescription', { values: { min: MIN_VIEWPORT_SIZE } })}</p>
        <p class="mt-3 text-xs text-md-on-surface/50 tabular-nums">
          {$t('common.viewportTooSmallCurrent', { values: { width: viewportWidth, height: viewportHeight } })}
        </p>
      </div>
    </div>
  {/if}
