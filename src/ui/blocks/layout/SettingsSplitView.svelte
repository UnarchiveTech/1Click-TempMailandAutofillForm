<script lang="ts">
import { t } from 'svelte-i18n';
import Icon from '@/ui/components/icons/Icon.svelte';
import { loadLazyComponent } from './lazy-view.svelte.js';
import SplitViewShell from './SplitViewShell.svelte';
import type { SettingsViewProps } from './settings-view-props.js';
import ViewFallback from './ViewFallback.svelte';

let {
  context,
  initialSubpage,
  autoCopy,
  autoRenew,
  autoRenewScope,
  autoRenewWindowMinutes,
  selectedProvider,
  savingSettings,
  loading,
  providerInstances,
  selectedProviderInstance,
  customColor,
  globalZoomEnabled,
  globalZoomScale,
  pageZoomSettings,
  addressColorThemeEnabled,
  contrastLevel,
  showDeveloperSettings,
  enableLogging,
  emailRetentionDays,
  faviconCaching,
  identities,
  selectedIdentityId,
  notificationsEnabled,
  soundEnabled,
  expiryWarningThreshold,
  keybindings,
  autoRefreshInterval,
  emailPreviewMode,
  defaultDomain,
  allAddresses,
  autofillBlocklist,
  splitSecondaryView,
  layoutSplit,
  layoutVerticalSplit,
  splitModeFlash,
  showSplitPane,
  splitPaneCollapsed,
  splitListWidthPx,
  onSubpageBack,
  onBack,
  onSaveSettings,
  onHardReset,
  onExportData,
  onImportData,
  loadAddresses,
  onProviderChange,
  onAddCustomInstance,
  onLoadProviderInstances,
  onColorChange,
  onToggleGlobalZoom,
  onTogglePageZoom,
  onChangePageZoom,
  onToggleAddressColorTheme,
  onContrastLevelChange,
  onToggleDeveloperSettings,
  onToggleEnableLogging,
  onSetAutoCopy,
  onSetAutoRenew,
  onSetAutoRenewScope,
  onSaveAutoRenewScope,
  onApplyAutoRenewToAll,
  onSetAutoRenewWindowMinutes,
  onSetProviderInstance,
  onSetNotificationsEnabled,
  onSetSoundEnabled,
  onSetExpiryWarningThreshold,
  onSetKeybindings,
  onSetEmailRetentionDays,
  onClearOldEmails,
  onSetFaviconCaching,
  onSetAutoRefreshInterval,
  onSetEmailPreviewMode,
  onSetDefaultDomain,
  onSetSelectedIdentityId,
  onRemoveFromBlocklist,
  onAddToBlocklist,
  onToggleBlocklist,
  onNavigateToIdentities,
  onNavigateToKeybindings,
  onNavigateToTagManagement,
  onNavigateToFiltersManagement,
  onNavigateToMailProvider,
  onNavigateToStoragePerformance,
  onNavigateToAddressAccentColors,
  onNavigateToLabelManagement,
  onNavigateToAddresses,
  onNavigateToAutomation,
  onNavigateToConstantsSettings,
  onNavigateToDiagnostics,
  onOpenPlayground,
  onCreateIdentity,
  onToggleSplitPane,
  onWidthChange,
  onExpandSplitPane,
  onCloseSecondary,
}: SettingsViewProps = $props();

// Split-dock settings: the settings page + subpages load on demand (shared
// chunks with SecondaryViews / the full-page settings route).
const settingsPage = loadLazyComponent(() => import('@/ui/views/SettingsView.svelte'));
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

{#snippet mainPane()}
  {#if settingsPage.component}
    {@const SettingsPageCmp = settingsPage.component}
    <SettingsPageCmp
      {context}
      {initialSubpage}
      {onSubpageBack}
      {onBack}
      {autoCopy}
      {autoRenew}
      {autoRenewScope}
      {autoRenewWindowMinutes}
      {selectedProvider}
      {savingSettings}
      {loading}
      {onSaveSettings}
      {onSetAutoCopy}
      {onSetAutoRenew}
      {onSetAutoRenewScope}
      {onSaveAutoRenewScope}
      {onApplyAutoRenewToAll}
      {onSetAutoRenewWindowMinutes}
      {onHardReset}
      {providerInstances}
      {selectedProviderInstance}
      {onSetProviderInstance}
      {onExportData}
      {onImportData}
      {loadAddresses}
      {onProviderChange}
      {onAddCustomInstance}
      {onLoadProviderInstances}
      {customColor}
      {globalZoomEnabled}
      {globalZoomScale}
      {pageZoomSettings}
      {onColorChange}
      {onToggleGlobalZoom}
      {onTogglePageZoom}
      {onChangePageZoom}
      {addressColorThemeEnabled}
      {onToggleAddressColorTheme}
      {contrastLevel}
      {onContrastLevelChange}
      {showDeveloperSettings}
      {enableLogging}
      {onToggleDeveloperSettings}
      {onOpenPlayground}
      {onToggleEnableLogging}
      {emailRetentionDays}
      {onSetEmailRetentionDays}
      {faviconCaching}
      {onSetFaviconCaching}
      {identities}
      {selectedIdentityId}
      {onSetSelectedIdentityId}
      {onNavigateToIdentities}
      {onCreateIdentity}
      {notificationsEnabled}
      {soundEnabled}
      {expiryWarningThreshold}
      {onSetNotificationsEnabled}
      {onSetSoundEnabled}
      {onSetExpiryWarningThreshold}
      {keybindings}
      {onSetKeybindings}
      {onNavigateToKeybindings}
      {onNavigateToTagManagement}
      {onNavigateToFiltersManagement}
      {onNavigateToMailProvider}
      {onNavigateToStoragePerformance}
      {onNavigateToAddressAccentColors}
      {onNavigateToLabelManagement}
      {onNavigateToAddresses}
      {onNavigateToAutomation}
      {onNavigateToConstantsSettings}
      {onNavigateToDiagnostics}
      {autoRefreshInterval}
      {onSetAutoRefreshInterval}
      {emailPreviewMode}
      {onSetEmailPreviewMode}
      {defaultDomain}
      {onSetDefaultDomain}
      {allAddresses}
      {autofillBlocklist}
      {onRemoveFromBlocklist}
      {onAddToBlocklist}
      {onToggleBlocklist}
    />
  {:else}
    <ViewFallback failed={settingsPage.failed} />
  {/if}
{/snippet}

{#snippet detailPane()}
  {#if splitSecondaryView === 'keybindings'}
    {#if keyboardShortcutsView.component}
      {@const KeyboardShortcutsViewCmp = keyboardShortcutsView.component}
      <KeyboardShortcutsViewCmp
        onBack={onCloseSecondary}
        {keybindings}
        onSetKeybindings={onSetKeybindings}
        onSaveSettings={onSaveSettings}
      />
    {:else}
      <ViewFallback failed={keyboardShortcutsView.failed} />
    {/if}
  {:else if splitSecondaryView === 'mailProvider'}
    {#if mailProviderView.component}
      {@const MailProviderViewCmp = mailProviderView.component}
      <MailProviderViewCmp
        onBack={onCloseSecondary}
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
        onProviderChange={onProviderChange}
        onSetAutoRenew={onSetAutoRenew}
        onSetNotificationsEnabled={onSetNotificationsEnabled}
        onSetSoundEnabled={onSetSoundEnabled}
        onSetExpiryWarningThreshold={onSetExpiryWarningThreshold}
        onSetAutoRefreshInterval={onSetAutoRefreshInterval}
        onSetEmailPreviewMode={onSetEmailPreviewMode}
        onSetProviderInstance={onSetProviderInstance}
        onAddCustomInstance={onAddCustomInstance}
        onLoadProviderInstances={onLoadProviderInstances}
        onSetDefaultDomain={onSetDefaultDomain}
        onSaveSettings={onSaveSettings}
      />
    {:else}
      <ViewFallback failed={mailProviderView.failed} />
    {/if}
  {:else if splitSecondaryView === 'storagePerformance'}
    {#if storagePerformanceView.component}
      {@const StoragePerformanceViewCmp = storagePerformanceView.component}
      <StoragePerformanceViewCmp
        onBack={onCloseSecondary}
        {faviconCaching}
        {emailRetentionDays}
        onSetFaviconCaching={onSetFaviconCaching}
        onSetEmailRetentionDays={onSetEmailRetentionDays}
        onSaveSettings={onSaveSettings}
        onClearOldEmails={onClearOldEmails}
      />
    {:else}
      <ViewFallback failed={storagePerformanceView.failed} />
    {/if}
  {:else if splitSecondaryView === 'addressAccentColors'}
    {#if addressAccentColorsView.component}
      {@const AddressAccentColorsViewCmp = addressAccentColorsView.component}
      <AddressAccentColorsViewCmp {allAddresses} onBack={onCloseSecondary} />
    {:else}
      <ViewFallback failed={addressAccentColorsView.failed} />
    {/if}
  {:else if splitSecondaryView === 'constantsSettings'}
    {#if constantsSettingsView.component}
      {@const ConstantsSettingsViewCmp = constantsSettingsView.component}
      <ConstantsSettingsViewCmp onBack={onCloseSecondary} />
    {:else}
      <ViewFallback failed={constantsSettingsView.failed} />
    {/if}
  {:else if splitSecondaryView === 'diagnostics'}
    {#if diagnosticsView.component}
      {@const DiagnosticsViewCmp = diagnosticsView.component}
      <DiagnosticsViewCmp />
    {:else}
      <ViewFallback failed={diagnosticsView.failed} />
    {/if}
  {:else}
    <div class="flex-1 flex flex-col items-center justify-center px-6 text-center gap-3 bg-md-surface-container-low/40">
      <Icon name="settings" class="w-12 h-12 text-md-on-surface/20" />
      <div class="text-sm font-semibold text-md-on-surface/70">{$t('settings.selectSetting')}</div>
    </div>
  {/if}
{/snippet}

<!-- Settings always renders its detail pane (pre-existing behavior: it ignores showSplitPane). -->
<SplitViewShell
  {layoutSplit}
  {layoutVerticalSplit}
  {splitModeFlash}
  showSplitPane={true}
  {splitPaneCollapsed}
  {splitListWidthPx}
  listMinWidth={320}
  listMaxWidth={520}
  listMaxWidthPct={45}
  main={mainPane}
  detail={detailPane}
  onToggleSplitPane={onToggleSplitPane}
  onWidthChange={onWidthChange}
  onExpandSplitPane={onExpandSplitPane}
/>
