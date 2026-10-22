import type { PageZoomDirection, PageZoomSettings } from '@/features/settings/page-zoom.js';
import type { ContrastLevel } from '@/features/theme/theme-actions.js';
import type { View } from '@/features/types/view-types.js';
import type {
  Address,
  AutoRenewScope,
  EmailPreviewMode,
  Identity,
  Keybindings,
  ProviderInstance,
} from '@/utils/types.js';

/**
 * Single source of truth for the props shared between the settings shell
 * (`blocks/layout/SettingsView.svelte`) and its split variant
 * (`blocks/layout/SettingsSplitView.svelte`). Both components destructure from
 * this type, so renaming or retyping a prop breaks BOTH files at compile time
 * instead of silently drifting (the two files previously maintained two
 * hand-synced inline prop blocks).
 *
 * Add or change settings props here first, then wire the callers in
 * `AppShell.svelte` (the shell consumer) and both settings components.
 */
export interface SettingsViewProps {
  context: SettingsViewContext;
  initialSubpage: string | null;
  autoCopy: boolean;
  autoRenew: boolean;
  autoRenewScope: AutoRenewScope;
  autoRenewWindowMinutes: number;
  selectedProvider: string;
  savingSettings: boolean;
  loading: boolean;
  providerInstances: ProviderInstance[];
  selectedProviderInstance: string | null;
  customColor: string;
  globalZoomEnabled: boolean;
  globalZoomScale: number;
  pageZoomSettings: PageZoomSettings;
  addressColorThemeEnabled: boolean;
  contrastLevel: ContrastLevel;
  showDeveloperSettings: boolean;
  enableLogging: boolean;
  emailRetentionDays: number;
  faviconCaching: 'direct' | 'local';
  identities: Identity[];
  selectedIdentityId: string | null;
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  expiryWarningThreshold: number;
  keybindings: Keybindings;
  autoRefreshInterval: number;
  emailPreviewMode: EmailPreviewMode;
  defaultDomain: string;
  allAddresses: Address[];
  autofillBlocklist: string[];
  splitSecondaryView: View | null;
  layoutSplit: boolean;
  layoutVerticalSplit: boolean;
  splitModeFlash: boolean;
  showSplitPane: boolean;
  splitPaneCollapsed: boolean;
  splitListWidthPx: number;
  onSubpageBack: () => void;
  onBack: () => void;
  onSaveSettings: () => void;
  onHardReset: () => void;
  onExportData: () => void;
  onImportData: () => void;
  loadAddresses: () => Promise<void>;
  onProviderChange: (provider: string) => void;
  onAddCustomInstance: (name: string, url: string) => void;
  onLoadProviderInstances: () => void;
  onColorChange: (color: string) => void;
  onToggleGlobalZoom: (enabled: boolean) => void;
  onTogglePageZoom: (view: View, enabled: boolean) => void;
  onChangePageZoom: (view: View, direction: PageZoomDirection) => void;
  onToggleAddressColorTheme: () => Promise<void>;
  onContrastLevelChange: (level: ContrastLevel) => void;
  onToggleDeveloperSettings: () => void;
  onToggleEnableLogging: () => void;
  onSetAutoCopy: (value: boolean) => void;
  onSetAutoRenew: (value: boolean) => void;
  onSetAutoRenewScope: (value: AutoRenewScope) => void;
  onSaveAutoRenewScope: () => void;
  onApplyAutoRenewToAll: (value: boolean) => Promise<number>;
  onSetAutoRenewWindowMinutes: (value: number) => void;
  onSetProviderInstance: (value: string) => void;
  onSetNotificationsEnabled: (value: boolean) => void;
  onSetSoundEnabled: (value: boolean) => void;
  onSetExpiryWarningThreshold: (value: number) => void;
  onSetKeybindings: (value: Keybindings) => void;
  onSetEmailRetentionDays: (value: number) => void;
  onClearOldEmails: () => Promise<void>;
  onSetFaviconCaching: (value: 'direct' | 'local') => void;
  onSetAutoRefreshInterval: (value: number) => void;
  onSetEmailPreviewMode: (value: EmailPreviewMode) => void;
  onSetDefaultDomain: (value: string) => void;
  onSetSelectedIdentityId: (id: string | null) => void;
  onRemoveFromBlocklist: (domain: string) => void;
  onAddToBlocklist: (domain: string) => void;
  onToggleBlocklist: (domain: string) => void;
  onNavigateToIdentities: () => void;
  onNavigateToKeybindings: () => void;
  onNavigateToTagManagement: () => void;
  onNavigateToFiltersManagement: () => void;
  onNavigateToMailProvider: () => void;
  onNavigateToStoragePerformance: () => void;
  onNavigateToAddressAccentColors: () => void;
  onNavigateToLabelManagement: () => void;
  onNavigateToAddresses: () => void;
  onNavigateToAutomation: () => void;
  onNavigateToConstantsSettings: () => void;
  onNavigateToDiagnostics: () => void;
  onOpenPlayground: () => void;
  onCreateIdentity: () => void;
  onToggleSplitPane: () => void;
  onWidthChange: (width: number) => void;
  onExpandSplitPane: () => void;
  onCloseSecondary: () => void;
}

/** Extension surface the settings views can render in. */
export type SettingsViewContext = 'popup' | 'sidepanel' | 'app';
