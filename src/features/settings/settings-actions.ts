import { DEFAULT_PROVIDER, loadProviderConfig } from '@/utils/email-service.js';
import { ApiError, getErrorMessage, ValidationError } from '@/utils/errors.js';
import { setProviderInstance as setProviderInstanceStorage } from '@/utils/instance-manager.js';
import { logError } from '@/utils/logger.js';
import type { ProviderInstance } from '@/utils/types.js';
import { validateCustomInstanceName, validateCustomInstanceUrl } from '@/utils/validation.js';

export interface SettingsState {
  useCustomPassword: boolean;
  customPassword: string;
  useCustomName: boolean;
  customFirstName: string;
  customLastName: string;
  autoCopy: boolean;
  autoRenew: boolean;
  selectedProvider: string;
  providerInstances: ProviderInstance[];
  selectedProviderInstance: string | null;
  customColor: string;
  showDeveloperSettings: boolean;
  enableLogging: boolean;
  savingSettings: boolean;
  settingsLoading: boolean;
  emailRetentionDays: number;
  faviconCaching: 'direct' | 'local';
}

export interface SettingsSetters {
  setUseCustomPassword: (value: boolean) => void;
  setCustomPassword: (value: string) => void;
  setUseCustomName: (value: boolean) => void;
  setCustomFirstName: (value: string) => void;
  setCustomLastName: (value: string) => void;
  setAutoCopy: (value: boolean) => void;
  setAutoRenew: (value: boolean) => void;
  setSelectedProvider: (value: string) => void;
  setProviderInstances: (instances: ProviderInstance[]) => void;
  setSelectedProviderInstance: (instanceId: string | null) => void;
  setCustomColor: (value: string) => void;
  setShowDeveloperSettings: (value: boolean) => void;
  setEnableLogging: (value: boolean) => void;
  setSavingSettings: (value: boolean) => void;
  setSettingsLoading: (value: boolean) => void;
  setEmailRetentionDays: (value: number) => void;
  setFaviconCaching: (value: 'direct' | 'local') => void;
  setShowToast: (message: string, type: 'success' | 'error' | 'warning') => void;
  loadInboxes: () => Promise<void>;
}

/**
 * Load settings from browser storage
 * @param ext - Browser extension API
 * @param _state - Current settings state (unused)
 * @param setters - Settings setter functions
 */
export async function loadSettings(
  ext: typeof browser,
  _state: SettingsState,
  setters: SettingsSetters
) {
  try {
    setters.setSettingsLoading(true);
    const result = (await ext.storage.local.get([
      'passwordSettings',
      'nameSettings',
      'autoCopy',
      'autoRenew',
      'selectedProvider',
      'customColor',
      'developerSettings',
      'emailRetentionDays',
      'faviconCaching',
    ])) as {
      passwordSettings?: { useCustom: boolean; customPassword: string };
      nameSettings?: { useCustom: boolean; firstName: string; lastName: string };
      autoCopy?: boolean;
      autoRenew?: boolean;
      selectedProvider?: string;
      customColor?: string;
      developerSettings?: { showDeveloperSettings: boolean; enableLogging: boolean };
      emailRetentionDays?: number;
      faviconCaching?: 'direct' | 'local';
    };
    if (result.passwordSettings) {
      setters.setUseCustomPassword(result.passwordSettings.useCustom || false);
      setters.setCustomPassword(result.passwordSettings.customPassword || '');
    }
    if (result.nameSettings) {
      setters.setUseCustomName(result.nameSettings.useCustom || false);
      setters.setCustomFirstName(result.nameSettings.firstName || '');
      setters.setCustomLastName(result.nameSettings.lastName || '');
    }
    if (result.autoCopy !== undefined) setters.setAutoCopy(result.autoCopy);
    if (result.autoRenew !== undefined) setters.setAutoRenew(result.autoRenew);
    if (result.selectedProvider) setters.setSelectedProvider(result.selectedProvider);
    if (result.customColor) setters.setCustomColor(result.customColor);
    if (result.developerSettings) {
      setters.setShowDeveloperSettings(result.developerSettings.showDeveloperSettings || false);
      setters.setEnableLogging(result.developerSettings.enableLogging || false);
    }
    if (result.emailRetentionDays !== undefined) {
      setters.setEmailRetentionDays(result.emailRetentionDays);
    } else {
      setters.setEmailRetentionDays(30); // Default to 30 days
    }
    if (result.faviconCaching) {
      setters.setFaviconCaching(result.faviconCaching);
    } else {
      setters.setFaviconCaching('local'); // Default to local
    }
  } catch (e: unknown) {
    logError('loadSettings error:', undefined, e instanceof Error ? e : new Error(String(e)));
  } finally {
    setters.setSettingsLoading(false);
  }
}

/**
 * Save settings to browser storage
 * @param ext - Browser extension API
 * @param state - Current settings state
 * @param setters - Settings setter functions
 */
export async function saveSettings(
  ext: typeof browser,
  state: SettingsState,
  setters: SettingsSetters
) {
  setters.setSavingSettings(true);
  try {
    await ext.storage.local.set({
      passwordSettings: {
        useCustom: state.useCustomPassword,
        customPassword: state.customPassword,
      },
      nameSettings: {
        useCustom: state.useCustomName,
        firstName: state.customFirstName,
        lastName: state.customLastName,
      },
      autoCopy: state.autoCopy,
      autoRenew: state.autoRenew,
      selectedProvider: state.selectedProvider,
      customColor: state.customColor,
      developerSettings: {
        showDeveloperSettings: state.showDeveloperSettings,
        enableLogging: state.enableLogging,
      },
      emailRetentionDays: state.emailRetentionDays,
      faviconCaching: state.faviconCaching,
    });
    setters.setShowToast('Settings saved', 'success');
  } catch (e: unknown) {
    logError('saveSettings error:', undefined, e instanceof Error ? e : new Error(String(e)));
    setters.setShowToast('Failed to save settings', 'error');
  } finally {
    setters.setSavingSettings(false);
  }
}

/**
 * Toggle developer settings visibility
 * @param ext - Browser extension API
 * @param state - Current settings state
 * @param setters - Settings setter functions
 */
export async function toggleDeveloperSettings(
  ext: typeof browser,
  state: SettingsState,
  setters: SettingsSetters
) {
  const newValue = !state.showDeveloperSettings;
  setters.setShowDeveloperSettings(newValue);
  await ext.storage.local.set({
    developerSettings: { showDeveloperSettings: newValue, enableLogging: state.enableLogging },
  });
}

/**
 * Toggle logging enable/disable
 * @param ext - Browser extension API
 * @param state - Current settings state
 * @param setters - Settings setter functions
 */
export async function toggleEnableLogging(
  ext: typeof browser,
  state: SettingsState,
  setters: SettingsSetters
) {
  const newValue = !state.enableLogging;
  setters.setEnableLogging(newValue);
  await ext.storage.local.set({
    developerSettings: {
      showDeveloperSettings: state.showDeveloperSettings,
      enableLogging: newValue,
    },
  });
  setters.setShowToast(`Logging ${newValue ? 'enabled' : 'disabled'}`, 'success');
}

/**
 * Handle provider change and reload inboxes
 * @param _ext - Browser extension API (unused)
 * @param provider - New provider to select
 * @param setters - Settings setter functions
 */
export async function handleProviderChange(
  _ext: typeof browser,
  provider: string,
  setters: SettingsSetters
) {
  setters.setSelectedProvider(provider);
  await setters.loadInboxes();
}

/**
 * Save password settings to browser storage
 * @param ext - Browser extension API
 * @param state - Current settings state
 */
export async function savePasswordSettings(ext: typeof browser, state: SettingsState) {
  await ext.storage.local.set({
    passwordSettings: { useCustom: state.useCustomPassword, customPassword: state.customPassword },
  });
}

/**
 * Save name settings to browser storage
 * @param ext - Browser extension API
 * @param state - Current settings state
 */
export async function saveNameSettings(ext: typeof browser, state: SettingsState) {
  await ext.storage.local.set({
    nameSettings: {
      useCustom: state.useCustomName,
      firstName: state.customFirstName,
      lastName: state.customLastName,
    },
  });
}

/**
 * Save auto-copy setting to browser storage
 * @param ext - Browser extension API
 * @param value - Auto-copy enabled/disabled
 */
export async function saveAutoCopy(ext: typeof browser, value: boolean) {
  await ext.storage.local.set({ autoCopy: value });
}

/**
 * Save auto-renew setting to browser storage
 * @param ext - Browser extension API
 * @param value - Auto-renew enabled/disabled
 */
export async function saveAutoRenew(ext: typeof browser, value: boolean) {
  await ext.storage.local.set({ autoRenew: value });
}

/**
 * Save email retention days setting to browser storage
 * @param ext - Browser extension API
 * @param value - Number of days to retain emails
 */
export async function saveEmailRetentionDays(ext: typeof browser, value: number) {
  await ext.storage.local.set({ emailRetentionDays: value });
}

/**
 * Save favicon caching setting to browser storage
 * @param ext - Browser extension API
 * @param value - Favicon caching mode ('direct' or 'local')
 */
export async function saveFaviconCaching(ext: typeof browser, value: 'direct' | 'local') {
  await ext.storage.local.set({ faviconCaching: value });
}

/**
 * Handle custom color change
 * @param ext - Browser extension API
 * @param color - Hex color code
 */
export async function handleColorChange(ext: typeof browser, color: string) {
  await ext.storage.local.set({ customColor: color });
}

/**
 * Switch to a different email provider
 * @param ext - Browser extension API
 * @param provider - Provider to switch to
 * @param setters - Settings setter functions
 */
export async function switchProvider(
  ext: typeof browser,
  provider: string,
  setters: SettingsSetters
) {
  setters.setSelectedProvider(provider);
  await ext.storage.local.set({ selectedProvider: provider });
  const config = loadProviderConfig(provider);
  if (config.ui?.multiInstance) {
    await loadProviderInstances(ext, setters);
  }
  await setters.loadInboxes();
  setters.setShowToast(`Switched to ${config.displayName}`, 'success');
}

export const changeProvider = switchProvider;

/**
 * Load provider instances from storage
 * @param ext - Browser extension API
 * @param setters - Settings setter functions
 */
export async function loadProviderInstances(ext: typeof browser, setters: SettingsSetters) {
  try {
    const { selectedProvider } = await ext.storage.local.get(['selectedProvider']);
    const provider = selectedProvider || DEFAULT_PROVIDER;
    const response = await ext.runtime.sendMessage({ action: 'getProviderInstances', provider });
    if (response?.success) setters.setProviderInstances(response.instances || []);
    const storageKey = `selectedInstance_${provider}`;
    const storageResult = (await ext.storage.local.get([storageKey])) as {
      [key: string]: string | undefined;
    };
    const selectedInstance = storageResult[storageKey];
    if (selectedInstance === 'random') {
      setters.setSelectedProviderInstance('random');
    } else if (selectedInstance) {
      setters.setSelectedProviderInstance(selectedInstance);
    } else {
      setters.setSelectedProviderInstance('random');
      await ext.storage.local.set({ [storageKey]: 'random' });
    }
  } catch (error: unknown) {
    logError(
      'loadProviderInstances error:',
      undefined,
      error instanceof Error ? error : new Error(getErrorMessage(error))
    );
  }
}

/**
 * Set the selected provider instance
 * @param instanceId - Instance ID to select
 * @param ext - Browser extension API
 * @param setters - Settings setter functions
 */
export async function setProviderInstance(
  instanceId: string,
  ext: typeof browser,
  setters: SettingsSetters
) {
  const { selectedProvider } = await ext.storage.local.get(['selectedProvider']);
  const provider = selectedProvider || DEFAULT_PROVIDER;
  await setProviderInstanceStorage(provider, instanceId);
  if (instanceId === 'random') {
    setters.setShowToast('Random instance mode enabled', 'success');
  } else {
    setters.setShowToast('Instance updated', 'success');
  }
  await setters.loadInboxes();
}

export async function addCustomInstance(
  ext: typeof browser,
  name: string,
  url: string,
  setters: SettingsSetters
) {
  try {
    validateCustomInstanceName(name);
    validateCustomInstanceUrl(url);
  } catch (e) {
    if (e instanceof ValidationError) {
      setters.setShowToast(e.message, 'error');
      return;
    }
    setters.setShowToast('Validation failed', 'error');
    return;
  }

  const parsedUrl = new URL(url);
  const domain = parsedUrl.hostname.toLowerCase();

  const blacklistedPatterns = [
    '.tk',
    '.ml',
    '.ga',
    '.cf',
    '.gq',
    '.xyz',
    '.top',
    '.zip',
    '.mov',
    '.exe',
    '.bat',
    '.sh',
  ];
  const isBlacklisted = blacklistedPatterns.some((pattern) => domain.includes(pattern));

  const whitelistedDomains = ['temp-mail.org', 'sharklasers.com', 'airmail.cc'];
  const isWhitelisted = whitelistedDomains.some(
    (allowed) => domain === allowed || domain.endsWith(`.${allowed}`)
  );

  if (isBlacklisted) {
    setters.setShowToast('Domain not allowed', 'error');
    return;
  }

  if (!isWhitelisted) {
    const confirmed = confirm(`Warning: ${domain} is not in the trusted domains list. Add anyway?`);
    if (!confirmed) return;
  }

  const response = await ext.runtime.sendMessage({
    action: 'addCustomProviderInstance',
    instance: { name: name.toLowerCase().replace(/\s+/g, '-'), displayName: name, apiUrl: url },
  });
  if (response?.success) {
    setters.setShowToast('Custom instance added', 'success');
    await loadProviderInstances(ext, setters);
  } else setters.setShowToast('Failed to add instance', 'error');
}

export async function hardReset(ext: typeof browser, setters: SettingsSetters) {
  if (
    !confirm(
      '⚠ HARD RESET WARNING\n\nThis will permanently delete ALL extension data. This cannot be undone. Are you sure?'
    )
  )
    return;
  try {
    await ext.storage.local.clear();
    if ('sync' in ext.storage && ext.storage.sync) {
      await ext.storage.sync.clear();
    }
    const response = await ext.runtime.sendMessage({ action: 'hardReset' });
    if (response?.success) {
      setters.setShowToast('Hard reset completed', 'success');
      setTimeout(() => window.location.reload(), 1000);
    } else throw new ApiError(response?.error || 'Hard reset failed', { response });
  } catch (_e) {
    setters.setShowToast('Hard reset failed', 'error');
  }
}

export async function exportData(ext: typeof browser) {
  try {
    const result = await ext.storage.local.get([
      'emailHistory',
      'loginInfo',
      'storedEmails',
      'inboxes',
      'activeInboxId',
      'identities',
      'selectedIdentityId',
      'savedSearchFilters',
      'themeMode',
      'darkMode',
      'contrastLevel',
      'customColor',
      'autoCopy',
      'autoRenew',
      'selectedProvider',
      'useCustomPassword',
      'customPassword',
      'useCustomName',
      'customFirstName',
      'customLastName',
      'emailRetentionDays',
      'showDeveloperSettings',
      'enableLogging',
    ]);
    const data = { version: '3.0', exportDate: new Date().toISOString(), data: { ...result } };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `1click-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (_e) {
    throw new Error('Export failed');
  }
}

export function importData(ext: typeof browser, loadInboxes: () => Promise<void>) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed.version || !parsed.data) throw new Error('Invalid format');
      const importedData = parsed.data;

      // Merge arrays (inboxes, emailHistory, loginInfo, identities) to avoid overwriting
      const existing = await ext.storage.local.get([
        'inboxes',
        'emailHistory',
        'loginInfo',
        'storedEmails',
        'identities',
        'savedSearchFilters',
      ]);

      const mergeById = <T extends { id: string }>(existing: T[], incoming: T[]): T[] => {
        const merged = [...existing];
        for (const item of incoming) {
          if (!merged.some((e) => e.id === item.id)) merged.push(item);
        }
        return merged;
      };

      const mergeByKey = <T>(existing: T[], incoming: T[], key: keyof T): T[] => {
        const merged = [...existing];
        for (const item of incoming) {
          if (!merged.some((e) => e[key] === item[key])) merged.push(item);
        }
        return merged;
      };

      const toSet: Record<string, unknown> = { ...importedData };

      if (Array.isArray(importedData.inboxes)) {
        toSet.inboxes = mergeById(existing.inboxes || [], importedData.inboxes);
      }
      if (Array.isArray(importedData.emailHistory)) {
        toSet.emailHistory = mergeByKey(
          existing.emailHistory || [],
          importedData.emailHistory,
          'email' as keyof unknown
        );
      }
      if (Array.isArray(importedData.loginInfo)) {
        toSet.loginInfo = mergeByKey(
          existing.loginInfo || [],
          importedData.loginInfo,
          'domain' as keyof unknown
        );
      }
      if (Array.isArray(importedData.identities)) {
        toSet.identities = mergeById(existing.identities || [], importedData.identities);
      }
      if (Array.isArray(importedData.savedSearchFilters)) {
        toSet.savedSearchFilters = mergeById(
          existing.savedSearchFilters || [],
          importedData.savedSearchFilters
        );
      }

      await ext.storage.local.set(toSet);
      await loadInboxes();
    } catch (_err) {
      throw new Error('Import failed');
    }
  };
  input.click();
}
