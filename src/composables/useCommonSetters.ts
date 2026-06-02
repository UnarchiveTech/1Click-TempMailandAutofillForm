/**
 * Composable that creates common setter objects shared across entrypoint components
 * This eliminates duplication for truly identical setter patterns
 */

import type { ToastType } from '@/components/feedback/Toast.svelte';
import type { InboxSetters } from '@/features/inbox/inbox-actions';
import type { ExportSetters } from '@/features/inbox/inbox-export';
import type { LoginSetters } from '@/features/login-info/login-actions';
import type { QRSetters } from '@/features/qr/qr-actions';
import type { SettingsSetters } from '@/features/settings/settings-actions';
import type { ContrastLevel, ThemeMode, ThemeSetters } from '@/features/theme/theme-actions';
import type {
  Account,
  CredentialsHistoryItem,
  Email,
  Keybindings,
  ProviderInstance,
} from '@/utils/types.js';

interface CommonSettersConfig {
  // Inbox state setters
  setAccounts: (value: Account[]) => void;
  setAllInboxes: (value: Account[]) => void;
  setEmails: (value: Email[]) => void;
  setLatestOtp: (value: string) => void;
  setLatestOtpSender: (value: string) => void;
  setLatestOtpSenderName: (value: string) => void;
  setOtpContext: (value: string) => void;
  setSelectedEmail: (value: string) => void;
  setLoading: (value: boolean) => void;
  setLoadingInboxes: (value: boolean) => void;
  setLoadingEmails: (value: boolean) => void;
  setNotificationsEnabled: (value: boolean) => void;
  setSoundEnabled: (value: boolean) => void;
  setExpiryWarningThreshold: (value: number) => void;
  setKeybindings: (value: Keybindings) => void;
  setAutoRefreshInterval: (value: number) => void;
  setEmailPreviewEnabled: (value: boolean) => void;
  setDefaultDomain: (value: string) => void;

  // Settings state setters
  setAutoCopy: (value: boolean) => void;
  setAutoRenew: (value: boolean) => void;
  setSelectedProvider: (value: string) => void;
  setProviderInstances: (value: ProviderInstance[]) => void;
  setSelectedProviderInstance: (value: string | null) => void;
  setCustomColor: (value: string) => void;
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
  setQrDialogElement: (value: HTMLElement | null) => void;
  setPreviousFocusElement: (value: HTMLElement | null) => void;

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
  loadInboxes: () => Promise<void>;
}

/**
 * Creates common setter objects for entrypoint components
 * @param config - Configuration object containing state setters
 * @returns Object containing inboxSetters, settingsSetters, themeSetters, qrSetters, exportSetters, and loginSetters
 */
export function useCommonSetters(config: CommonSettersConfig) {
  const {
    // Inbox
    setAccounts,
    setAllInboxes,
    setEmails,
    setLatestOtp,
    setLatestOtpSender,
    setLatestOtpSenderName,
    setOtpContext,
    setSelectedEmail,
    setLoading,
    setLoadingInboxes,
    setLoadingEmails,
    setNotificationsEnabled,
    setSoundEnabled,
    setExpiryWarningThreshold,
    setKeybindings,
    setAutoRefreshInterval,
    setEmailPreviewEnabled,
    setDefaultDomain,
    // Settings
    setAutoCopy,
    setAutoRenew,
    setSelectedProvider,
    setProviderInstances,
    setSelectedProviderInstance,
    setCustomColor,
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
    setQrDialogElement,
    setPreviousFocusElement,
    // Login
    setSavedLogins,
    // Common
    setShowToast,
    // Functions
    loadInboxes,
  } = config;

  // Inbox setters
  const inboxSetters: InboxSetters = {
    setAccounts,
    setAllInboxes,
    setEmails,
    setLatestOtp,
    setLatestOtpSender,
    setLatestOtpSenderName,
    setOtpContext,
    setSelectedEmail,
    setLoading,
    setLoadingInboxes,
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
    setSelectedProvider,
    setProviderInstances,
    setSelectedProviderInstance,
    setCustomColor,
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
    setEmailPreviewEnabled,
    setDefaultDomain,
    setShowToast,
    loadInboxes,
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
    setQrDialogElement,
    setPreviousFocusElement,
    setShowToast,
  };

  // Export setters
  const exportSetters: ExportSetters = {
    setShowToast,
    loadInboxes,
  };

  // Login setters
  const loginSetters: LoginSetters = {
    setSavedLogins,
  };

  return {
    inboxSetters,
    settingsSetters,
    themeSetters,
    qrSetters,
    exportSetters,
    loginSetters,
  };
}
