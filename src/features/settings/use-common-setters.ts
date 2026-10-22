/**
 * Composable that creates common setter objects shared across entrypoint components
 * This eliminates duplication for truly identical setter patterns
 */

import type { AddressSetters } from '@/features/address/address-actions';
import type { ExportSetters } from '@/features/address/inbox-export';
import type { LoginSetters } from '@/features/login-info/login-actions';
import type { QRSetters } from '@/features/qr/qr-actions';
import type { SettingsSetters } from '@/features/settings/settings-actions';
import type { ContrastLevel, ThemeMode, ThemeSetters } from '@/features/theme/theme-actions';
import type { ToastType } from '@/ui/blocks/feedback/toast-types.js';
import type {
  Address,
  AutoRenewScope,
  CredentialsHistoryItem,
  Email,
  EmailPreviewMode,
  Keybindings,
  ProviderInstance,
} from '@/utils/types.js';

interface CommonSettersConfig {
  // Inbox state setters
  setAddresses: (value: Address[] | ((prev: Address[]) => Address[])) => void;
  setAllAddresses: (value: Address[] | ((prev: Address[]) => Address[])) => void;
  setEmails: (value: Email[] | ((prev: Email[]) => Email[])) => void;
  setLatestOtp: (value: string) => void;
  setLatestOtpSender: (value: string) => void;
  setLatestOtpSenderName: (value: string) => void;
  setOtpContext: (value: string) => void;
  setSelectedEmail: (value: string) => void;
  setLoading: (value: boolean) => void;
  setLoadingAddresses: (value: boolean) => void;
  setLoadingEmails: (value: boolean) => void;
  setNotificationsEnabled: (value: boolean) => void;
  setSoundEnabled: (value: boolean) => void;
  setExpiryWarningThreshold: (value: number) => void;
  setKeybindings: (value: Keybindings) => void;
  setAutoRefreshInterval: (value: number) => void;
  setEmailPreviewMode: (value: EmailPreviewMode) => void;
  setDefaultDomain: (value: string) => void;

  // Settings state setters
  setAutoCopy: (value: boolean) => void;
  setAutoRenew: (value: boolean) => void;
  setAutoRenewScope: (value: AutoRenewScope) => void;
  setAutoRenewWindowMinutes: (value: number) => void;
  setSelectedProvider: (value: string) => void;
  setProviderInstances: (value: ProviderInstance[]) => void;
  setSelectedProviderInstance: (value: string | null) => void;
  setCustomColor: (value: string) => void;
  setGlobalZoomEnabled: (value: boolean) => void;
  setShowDeveloperSettings: (value: boolean) => void;
  setEnableLogging: (value: boolean) => void;
  setSavingSettings: (value: boolean) => void;
  setSettingsLoading: (value: boolean) => void;
  setEmailRetentionDays: (value: number) => void;
  setFaviconCaching: (value: 'direct' | 'local') => void;

  // Theme state setters
  setThemeMode: (value: ThemeMode) => void;
  setContrastLevel: (value: ContrastLevel) => void;

  // QR state setters
  setQrDialogOpen: (value: boolean) => void;
  setQrCanvas: (value: HTMLCanvasElement | null) => void;

  // Login state setters
  setSavedLogins: (
    value: CredentialsHistoryItem[] | ((prev: CredentialsHistoryItem[]) => CredentialsHistoryItem[])
  ) => void;

  // Common toast setter
  setShowToast: (
    toast:
      | {
          message: string;
          type?: ToastType;
          icon?: ToastType;
        }
      | string,
    type?: ToastType
  ) => void;

  // Functions
  loadAddresses: () => Promise<void>;
  confirmAsync?: (message: string) => Promise<boolean>;
}

/**
 * Creates common setter objects for entrypoint components
 * @param config - Configuration object containing state setters
 * @returns Object containing addressSetters, settingsSetters, themeSetters, qrSetters, exportSetters, and loginSetters
 */
export function useCommonSetters(config: CommonSettersConfig) {
  const {
    // Inbox
    setAddresses,
    setAllAddresses,
    setEmails,
    setLatestOtp,
    setLatestOtpSender,
    setLatestOtpSenderName,
    setOtpContext,
    setSelectedEmail,
    setLoading,
    setLoadingAddresses,
    setLoadingEmails,
    setNotificationsEnabled,
    setSoundEnabled,
    setExpiryWarningThreshold,
    setKeybindings,
    setAutoRefreshInterval,
    setEmailPreviewMode,
    setDefaultDomain,
    // Settings
    setAutoCopy,
    setAutoRenew,
    setAutoRenewScope,
    setAutoRenewWindowMinutes,
    setSelectedProvider,
    setProviderInstances,
    setSelectedProviderInstance,
    setCustomColor,
    setGlobalZoomEnabled,
    setShowDeveloperSettings,
    setEnableLogging,
    setSavingSettings,
    setSettingsLoading,
    setEmailRetentionDays,
    setFaviconCaching,
    // Theme
    setThemeMode,
    setContrastLevel,
    // QR
    setQrDialogOpen,
    setQrCanvas,
    // Login
    setSavedLogins,
    // Common
    setShowToast,
    // Functions
    loadAddresses,
    confirmAsync,
  } = config;

  // Inbox setters
  const addressSetters: AddressSetters = {
    setAddresses,
    setAllAddresses,
    setEmails,
    setLatestOtp,
    setLatestOtpSender,
    setLatestOtpSenderName,
    setOtpContext,
    setSelectedEmail,
    setLoading,
    setLoadingAddresses,
    setLoadingEmails,
    setNotificationsEnabled,
    setSoundEnabled,
    setExpiryWarningThreshold,
    setShowToast,
  };

  // Settings setters
  const settingsSetters: SettingsSetters = {
    setAutoCopy,
    setAutoRenew,
    setAutoRenewScope,
    setAutoRenewWindowMinutes,
    setSelectedProvider,
    setProviderInstances,
    setSelectedProviderInstance,
    setCustomColor,
    setGlobalZoomEnabled,
    setShowDeveloperSettings,
    setEnableLogging,
    setSavingSettings,
    setSettingsLoading,
    setEmailRetentionDays,
    setFaviconCaching,
    setNotificationsEnabled,
    setSoundEnabled,
    setExpiryWarningThreshold,
    setKeybindings,
    setAutoRefreshInterval,
    setEmailPreviewMode,
    setDefaultDomain,
    setShowToast,
    loadAddresses,
    confirmAsync,
  };

  // Theme setters
  const themeSetters: ThemeSetters = {
    setThemeMode,
    setCustomColor,
    setContrastLevel,
  };

  // QR setters
  const qrSetters: QRSetters = {
    setQrDialogOpen,
    setQrCanvas,
    setShowToast,
  };

  // Export setters
  const exportSetters: ExportSetters = {
    setShowToast,
    loadAddresses,
  };

  // Login setters
  const loginSetters: LoginSetters = {
    setSavedLogins,
  };

  return {
    addressSetters,
    settingsSetters,
    themeSetters,
    qrSetters,
    exportSetters,
    loginSetters,
  };
}
