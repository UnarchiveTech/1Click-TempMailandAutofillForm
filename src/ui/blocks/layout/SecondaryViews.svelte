<script lang="ts">
import type { OrganizeTab, View } from '@/features/types/view-types.js';
import type {
  ActivityEvent,
  Address,
  Analytics,
  Email,
  EmailPreviewMode,
  Keybindings,
  ProviderInstance,
  SavedSearchFilter,
} from '@/utils/types.js';
import LoadingState from './LoadingState.svelte';
import { loadLazyComponent } from './lazy-view.svelte.js';
import MessageDetailPane from './MessageDetailPane.svelte';
import ViewFallback from './ViewFallback.svelte';

type Context = 'popup' | 'sidepanel' | 'app';
type FaviconCaching = 'direct' | 'local';

type SecondaryViewsProps = {
  currentView: View;
  context: Context;
  version: string;
  selectedThread: Email[];
  hasPrevMessage: boolean;
  hasNextMessage: boolean;
  selectedEmail: string;
  analytics: Analytics;
  analyticsLoading: boolean;
  keybindings: Keybindings;
  allAddresses: Address[];
  savedSearchFilters: SavedSearchFilter[];
  organizeTabValue: OrganizeTab;
  organizeTabSignal: number;
  tagCreateSignal: number;
  labelCreateSignal: number;
  selectedProvider: string;
  autoRenew: boolean;
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  expiryWarningThreshold: number;
  autoRefreshInterval: number;
  emailPreviewMode: EmailPreviewMode;
  providerInstances: ProviderInstance[];
  selectedProviderInstance: string | null;
  defaultDomain: string;
  faviconCaching: FaviconCaching;
  emailRetentionDays: number;
  onBackToMailbox: () => void;
  onBackToSettings: () => void;
  /** About's contextual FAB back → return to the view shown before About. */
  onAboutBack?: () => void;
  onLoadAnalytics: () => void | Promise<void>;
  onResetAnalytics: () => void | Promise<void>;
  onSetKeybindings: (value: Keybindings) => void;
  onSaveSettings: () => void | Promise<void>;
  onReloadAddresses: () => Promise<void>;
  onFiltersChange: () => Promise<void>;
  onOpenOrganizeAddress?: (address: Address) => Promise<void>;
  onOpenOrganizeMessage?: (email: Email) => void;
  onOpenActivityEvent?: (
    event: ActivityEvent,
    target: 'inbox' | 'message' | 'login' | 'settings'
  ) => Promise<void>;
  onApplyOrganizeFilter?: (filter: SavedSearchFilter) => Promise<void>;
  showConfirm: (
    message: string,
    onConfirm: () => void,
    options?: import('@/utils/ui/shared-ui.js').ConfirmDialogOptions
  ) => void;
  onTabChange: (tab: OrganizeTab) => void;
  onProviderChange: (provider: string) => void | Promise<void>;
  onSetAutoRenew: (value: boolean) => void;
  onSetNotificationsEnabled: (value: boolean) => void;
  onSetSoundEnabled: (value: boolean) => void;
  onSetExpiryWarningThreshold: (value: number) => void;
  onSetAutoRefreshInterval: (value: number) => void;
  onSetEmailPreviewMode: (value: EmailPreviewMode) => void;
  onSetProviderInstance: (value: string) => void;
  onAddCustomInstance: (name: string, url: string) => void;
  onLoadProviderInstances: () => void | Promise<void>;
  onSetDefaultDomain: (value: string) => void;
  onSetFaviconCaching: (value: FaviconCaching) => void;
  onSetEmailRetentionDays: (value: number) => void;
  onClearOldEmails: () => Promise<void>;
  onMailBack: () => void;
  onPrevMessage: () => void;
  onNextMessage: () => void;
  onCreateRuleFromMessage: (from?: string) => void;
  onMarkUnread: () => void;
  onArchiveMessage: () => void;
  onDeleteMessage: () => void;
  onSearchText: (query: string) => void;
  onManageLabels?: () => void;
  showToast: (message: string) => void;
  onStartProductTour: () => void | Promise<void>;
  onOpenKeyboardShortcuts: () => void;
  onOpenDiagnostics: () => void;
  automationInitialSender: string;
};

let {
  currentView,
  context,
  version,
  selectedThread,
  hasPrevMessage,
  hasNextMessage,
  selectedEmail,
  analytics,
  analyticsLoading,
  keybindings,
  allAddresses,
  savedSearchFilters,
  organizeTabValue,
  organizeTabSignal,
  tagCreateSignal,
  labelCreateSignal,
  selectedProvider,
  autoRenew,
  notificationsEnabled,
  soundEnabled,
  expiryWarningThreshold,
  autoRefreshInterval,
  emailPreviewMode,
  providerInstances,
  selectedProviderInstance,
  defaultDomain,
  faviconCaching,
  emailRetentionDays,
  onBackToMailbox,
  onBackToSettings,
  onAboutBack = () => {},
  onLoadAnalytics,
  onResetAnalytics,
  onSetKeybindings,
  onSaveSettings,
  onReloadAddresses,
  onFiltersChange,
  onOpenOrganizeAddress,
  onOpenOrganizeMessage,
  onOpenActivityEvent,
  onApplyOrganizeFilter,
  showConfirm,
  onTabChange,
  onProviderChange,
  onSetAutoRenew,
  onSetNotificationsEnabled,
  onSetSoundEnabled,
  onSetExpiryWarningThreshold,
  onSetAutoRefreshInterval,
  onSetEmailPreviewMode,
  onSetProviderInstance,
  onAddCustomInstance,
  onLoadProviderInstances,
  onSetDefaultDomain,
  onSetFaviconCaching,
  onSetEmailRetentionDays,
  onClearOldEmails,
  onMailBack,
  onPrevMessage,
  onNextMessage,
  onCreateRuleFromMessage,
  onMarkUnread,
  onArchiveMessage,
  onDeleteMessage,
  onSearchText,
  onManageLabels = () => {},
  showToast,
  onStartProductTour,
  onOpenKeyboardShortcuts,
  onOpenDiagnostics,
  automationInitialSender,
}: SecondaryViewsProps = $props();

// Each view loads its own chunk on first visit - these are the "more menu"
// pages (analytics, organize, automation, …) and settings subpages, none of
// which are needed at popup open. MailView is loaded via MessageDetailPane.
const aboutView = loadLazyComponent(() => import('@/ui/views/AboutView.svelte'));
const activityView = loadLazyComponent(() => import('@/ui/views/ActivityView.svelte'));
const automationView = loadLazyComponent(() => import('@/ui/views/AutomationView.svelte'));
const organizeView = loadLazyComponent(() => import('@/ui/views/OrganizeView.svelte'));
const playgroundView = loadLazyComponent(() => import('@/ui/views/PlaygroundView.svelte'));
const constantsSettingsView = loadLazyComponent(
  () => import('@/ui/views/settings/ConstantsSettingsView.svelte')
);
const diagnosticsView = loadLazyComponent(
  () => import('@/ui/views/settings/DiagnosticsView.svelte')
);
const keyboardShortcutsView = loadLazyComponent(
  () => import('@/ui/views/settings/KeyboardShortcutsView.svelte')
);
const mailProviderView = loadLazyComponent(
  () => import('@/ui/views/settings/MailProviderView.svelte')
);
const storagePerformanceView = loadLazyComponent(
  () => import('@/ui/views/settings/StoragePerformanceView.svelte')
);
const addressAccentColorsView = loadLazyComponent(
  () => import('@/ui/views/settings/AddressAccentColorsView.svelte')
);
</script>

{#if currentView === 'analytics'}
  {#if activityView.component}
    {@const ActivityViewCmp = activityView.component}
    <ActivityViewCmp
      {context}
      onBack={onBackToMailbox}
      {analytics}
      loading={analyticsLoading}
      onLoadAnalytics={() => void onLoadAnalytics()}
      onResetAnalytics={onResetAnalytics}
      {onOpenActivityEvent}
    />
  {:else}
    <ViewFallback failed={activityView.failed} />
  {/if}
{:else if currentView === 'keybindings'}
  {#if keyboardShortcutsView.component}
    {@const KeyboardShortcutsViewCmp = keyboardShortcutsView.component}
    <KeyboardShortcutsViewCmp
      onBack={onBackToSettings}
      {keybindings}
      onSetKeybindings={onSetKeybindings}
      onSaveSettings={() => void onSaveSettings()}
    />
  {:else}
    <ViewFallback failed={keyboardShortcutsView.failed} />
  {/if}
{:else if currentView === 'organize' || currentView === 'tagManagement' || currentView === 'labelManagement' || currentView === 'filtersManagement'}
  {#if organizeView.component}
    {@const OrganizeViewCmp = organizeView.component}
    <OrganizeViewCmp
      initialTab={currentView === 'labelManagement'
        ? 'labels'
        : currentView === 'filtersManagement'
          ? 'filters'
          : organizeTabValue}
      {allAddresses}
      {savedSearchFilters}
      onReloadAddresses={onReloadAddresses}
      onFiltersChange={onFiltersChange}
      onOpenAddress={onOpenOrganizeAddress}
      onOpenMessage={onOpenOrganizeMessage}
      onApplyFilter={onApplyOrganizeFilter}
      {showConfirm}
      {tagCreateSignal}
      {labelCreateSignal}
      tabSignal={organizeTabSignal}
      tabSignalValue={organizeTabValue}
      {onTabChange}
    />
  {:else}
    <ViewFallback failed={organizeView.failed} />
  {/if}
{:else if currentView === 'mailProvider'}
  {#if mailProviderView.component}
    {@const MailProviderViewCmp = mailProviderView.component}
    <MailProviderViewCmp
      onBack={onBackToSettings}
      {selectedProvider}
      {autoRenew}
      {notificationsEnabled}
      {soundEnabled}
      {expiryWarningThreshold}
      {autoRefreshInterval}
      {emailPreviewMode}
      {providerInstances}
      {selectedProviderInstance}
      {defaultDomain}
      {allAddresses}
      {onProviderChange}
      {onSetAutoRenew}
      {onSetNotificationsEnabled}
      {onSetSoundEnabled}
      {onSetExpiryWarningThreshold}
      {onSetAutoRefreshInterval}
      {onSetEmailPreviewMode}
      {onSetProviderInstance}
      {onAddCustomInstance}
      {onLoadProviderInstances}
      {onSetDefaultDomain}
      {onSaveSettings}
    />
  {:else}
    <ViewFallback failed={mailProviderView.failed} />
  {/if}
{:else if currentView === 'storagePerformance'}
  {#if storagePerformanceView.component}
    {@const StoragePerformanceViewCmp = storagePerformanceView.component}
    <StoragePerformanceViewCmp
      onBack={onBackToSettings}
      {faviconCaching}
      {emailRetentionDays}
      {onSetFaviconCaching}
      {onSetEmailRetentionDays}
      {onSaveSettings}
      {onClearOldEmails}
    />
  {:else}
    <ViewFallback failed={storagePerformanceView.failed} />
  {/if}
{:else if currentView === 'addressAccentColors'}
  {#if addressAccentColorsView.component}
    {@const AddressAccentColorsViewCmp = addressAccentColorsView.component}
    <AddressAccentColorsViewCmp {allAddresses} />
  {:else}
    <ViewFallback failed={addressAccentColorsView.failed} />
  {/if}
{:else if currentView === 'constantsSettings'}
  {#if constantsSettingsView.component}
    {@const ConstantsSettingsViewCmp = constantsSettingsView.component}
    <ConstantsSettingsViewCmp onBack={onBackToSettings} />
  {:else}
    <ViewFallback failed={constantsSettingsView.failed} />
  {/if}
{:else if currentView === 'diagnostics'}
  {#if diagnosticsView.component}
    {@const DiagnosticsViewCmp = diagnosticsView.component}
    <DiagnosticsViewCmp />
  {:else}
    <ViewFallback failed={diagnosticsView.failed} />
  {/if}
{:else if currentView === 'mailView'}
  <MessageDetailPane
    mode="page"
    {context}
    {selectedThread}
    hasPrev={hasPrevMessage}
    hasNext={hasNextMessage}
    mailboxAddress={selectedEmail}
    onBack={onMailBack}
    onPrev={onPrevMessage}
    onNext={onNextMessage}
    onCreateRule={onCreateRuleFromMessage}
    onMarkUnread={onMarkUnread}
    onArchive={onArchiveMessage}
    onDelete={onDeleteMessage}
    onSearchText={onSearchText}
    onManageLabels={onManageLabels}
    {showToast}
  />
{:else if currentView === 'automation'}
  {#if automationView.component}
    {@const AutomationViewCmp = automationView.component}
    <AutomationViewCmp
      initialRecipient={selectedEmail}
      initialSender={automationInitialSender}
    />
  {:else}
    <ViewFallback failed={automationView.failed} />
  {/if}
{:else if currentView === 'playground'}
  {#if playgroundView.component}
    {@const PlaygroundViewCmp = playgroundView.component}
    <PlaygroundViewCmp onBack={onBackToSettings} />
  {:else}
    <ViewFallback failed={playgroundView.failed} />
  {/if}
{:else if currentView === 'about'}
  {#if aboutView.component}
    {@const AboutViewCmp = aboutView.component}
    <AboutViewCmp
      {version}
      onBack={onAboutBack}
      onStartProductTour={onStartProductTour}
      onOpenKeyboardShortcuts={onOpenKeyboardShortcuts}
      {onOpenDiagnostics}
    />
  {:else}
    <ViewFallback failed={aboutView.failed} />
  {/if}
{:else}
  <LoadingState />
{/if}
