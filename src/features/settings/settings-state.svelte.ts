import { DEFAULT_PRE_EXPIRY_WINDOW_MINUTES } from '@/utils/provider/provider-expiry.js';
import type {
  AutoRenewScope,
  EmailPreviewMode,
  Keybindings,
  ProviderInstance,
} from '@/utils/types.js';
import { DEFAULT_KEYBINDINGS } from '@/utils/types.js';

export interface SettingsUiState {
  autoCopy: boolean;
  autoRenew: boolean;
  autoRenewScope: AutoRenewScope;
  autoRenewWindowMinutes: number;
  selectedProvider: string;
  providerInstances: ProviderInstance[];
  selectedProviderInstance: string | null;
  savingSettings: boolean;
  settingsLoading: boolean;
  customColor: string;
  addressColorThemeEnabled: boolean;
  globalZoomEnabled: boolean;
  showDeveloperSettings: boolean;
  enableLogging: boolean;
  emailRetentionDays: number;
  faviconCaching: 'direct' | 'local';
  keybindings: Keybindings;
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  expiryWarningThreshold: number;
  emailPreviewMode: EmailPreviewMode;
  defaultDomain: string;
  autoRefreshInterval: number;
}

export type SettingsUiSetters = {
  [K in keyof SettingsUiState as `set${Capitalize<K>}`]: (value: SettingsUiState[K]) => void;
};

export interface SettingsDomain {
  state: SettingsUiState;
  setters: SettingsUiSetters;
}

export type SettingsState = SettingsUiState;
export type SettingsSetters = SettingsUiSetters;

export function createSettingsState(): SettingsDomain {
  const state: SettingsUiState = $state({
    autoCopy: false,
    autoRenew: true,
    autoRenewScope: 'ask',
    autoRenewWindowMinutes: DEFAULT_PRE_EXPIRY_WINDOW_MINUTES,
    selectedProvider: '',
    providerInstances: [],
    selectedProviderInstance: null,
    savingSettings: false,
    settingsLoading: false,
    customColor: '',
    addressColorThemeEnabled: false,
    globalZoomEnabled: false,
    showDeveloperSettings: false,
    enableLogging: false,
    emailRetentionDays: 30,
    faviconCaching: 'local',
    keybindings: DEFAULT_KEYBINDINGS,
    notificationsEnabled: true,
    soundEnabled: true,
    expiryWarningThreshold: 60 * 60 * 1000,
    emailPreviewMode: 'tooltip' as EmailPreviewMode,
    defaultDomain: '',
    autoRefreshInterval: 30000,
  });

  const setters: SettingsUiSetters = {
    setAutoCopy: (value) => (state.autoCopy = value),
    setAutoRenew: (value) => (state.autoRenew = value),
    setAutoRenewScope: (value) => (state.autoRenewScope = value),
    setAutoRenewWindowMinutes: (value) => (state.autoRenewWindowMinutes = value),
    setSelectedProvider: (value) => (state.selectedProvider = value),
    setProviderInstances: (value) => (state.providerInstances = value),
    setSelectedProviderInstance: (value) => (state.selectedProviderInstance = value),
    setSavingSettings: (value) => (state.savingSettings = value),
    setSettingsLoading: (value) => (state.settingsLoading = value),
    setCustomColor: (value) => (state.customColor = value),
    setAddressColorThemeEnabled: (value) => (state.addressColorThemeEnabled = value),
    setGlobalZoomEnabled: (value) => (state.globalZoomEnabled = value),
    setShowDeveloperSettings: (value) => (state.showDeveloperSettings = value),
    setEnableLogging: (value) => (state.enableLogging = value),
    setEmailRetentionDays: (value) => (state.emailRetentionDays = value),
    setFaviconCaching: (value) => (state.faviconCaching = value),
    setKeybindings: (value) => (state.keybindings = value),
    setNotificationsEnabled: (value) => (state.notificationsEnabled = value),
    setSoundEnabled: (value) => (state.soundEnabled = value),
    setExpiryWarningThreshold: (value) => (state.expiryWarningThreshold = value),
    setEmailPreviewMode: (value) => (state.emailPreviewMode = value),
    setDefaultDomain: (value) => (state.defaultDomain = value),
    setAutoRefreshInterval: (value) => (state.autoRefreshInterval = value),
  };

  return { state, setters };
}
