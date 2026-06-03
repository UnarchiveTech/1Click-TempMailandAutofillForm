import { DEFAULT_PROVIDER, loadProviderConfig } from '@/utils/email-service.js';
import { ApiError, getErrorMessage, ValidationError } from '@/utils/errors.js';
import { setProviderInstance as setProviderInstanceStorage } from '@/utils/instance-manager.js';
import { logError } from '@/utils/logger.js';
import { defaultDomainKey, selectedInstanceKey } from '@/utils/storage-keys.js';
import type { Keybindings, ProviderInstance } from '@/utils/types.js';
import { DEFAULT_KEYBINDINGS } from '@/utils/types.js';
import { validateCustomInstanceName, validateCustomInstanceUrl } from '@/utils/validation.js';

export interface SettingsState {
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
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  expiryWarningThreshold: number;
  keybindings: Keybindings;
  autoRefreshInterval: number;
  emailPreviewEnabled: boolean;
  defaultDomain: string;
}

export interface SettingsSetters {
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
  setNotificationsEnabled: (value: boolean) => void;
  setSoundEnabled: (value: boolean) => void;
  setExpiryWarningThreshold: (value: number) => void;
  setKeybindings: (value: Keybindings) => void;
  setAutoRefreshInterval: (value: number) => void;
  setEmailPreviewEnabled: (value: boolean) => void;
  setDefaultDomain: (value: string) => void;
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
    const result = (await ext.storage.local.get([
      'autoCopy',
      'autoRenew',
      'selectedProvider',
      'customColor',
      'developerSettings',
      'emailRetentionDays',
      'faviconCaching',
      'notificationSettings',
      'keybindings',
      'autoRefreshInterval',
      'emailPreviewEnabled',
    ])) as {
      autoCopy?: boolean;
      autoRenew?: boolean;
      selectedProvider?: string;
      customColor?: string;
      developerSettings?: { showDeveloperSettings: boolean; enableLogging: boolean };
      emailRetentionDays?: number;
      faviconCaching?: 'direct' | 'local';
      notificationSettings?: {
        enabled: boolean;
        soundEnabled: boolean;
        expiryWarningThreshold: number;
      };
      keybindings?: Keybindings;
      autoRefreshInterval?: number;
      emailPreviewEnabled?: boolean;
    };
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
    if (result.notificationSettings) {
      setters.setNotificationsEnabled(result.notificationSettings.enabled ?? true);
      setters.setSoundEnabled(result.notificationSettings.soundEnabled ?? true);
      setters.setExpiryWarningThreshold(
        result.notificationSettings.expiryWarningThreshold ?? 60 * 60 * 1000
      );
    } else {
      setters.setNotificationsEnabled(true);
      setters.setSoundEnabled(true);
      setters.setExpiryWarningThreshold(60 * 60 * 1000);
    }
    if (result.keybindings) {
      setters.setKeybindings(result.keybindings);
    } else {
      setters.setKeybindings(DEFAULT_KEYBINDINGS);
    }
    if (result.autoRefreshInterval !== undefined) {
      setters.setAutoRefreshInterval(result.autoRefreshInterval);
    } else {
      setters.setAutoRefreshInterval(30000);
    }
    if (result.emailPreviewEnabled !== undefined) {
      setters.setEmailPreviewEnabled(result.emailPreviewEnabled);
    } else {
      setters.setEmailPreviewEnabled(true);
    }
    // Load default domain from per-provider scoped key
    const provider = result.selectedProvider || DEFAULT_PROVIDER;
    const defaultKey = defaultDomainKey(provider);
    const domainResult = await ext.storage.local.get([defaultKey]);
    setters.setDefaultDomain(String(domainResult[defaultKey] ?? ''));
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
      notificationSettings: {
        enabled: state.notificationsEnabled,
        soundEnabled: state.soundEnabled,
        expiryWarningThreshold: state.expiryWarningThreshold,
      },
      keybindings: state.keybindings,
      autoRefreshInterval: state.autoRefreshInterval,
      emailPreviewEnabled: state.emailPreviewEnabled,
    });
    // Save default domain to per-provider scoped key
    if (state.defaultDomain) {
      await ext.storage.local.set({
        [defaultDomainKey(state.selectedProvider)]: state.defaultDomain,
      });
    }
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
    const storageKey = selectedInstanceKey(provider);
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
  const isBlacklisted = blacklistedPatterns.some(
    (pattern) => domain === pattern.replace(/^\./, '') || domain.endsWith(pattern)
  );

  if (isBlacklisted) {
    setters.setShowToast('Domain not allowed', 'error');
    return;
  }

  // Note: We removed the synchronous confirm() here because it is disallowed in background scripts/MV3.
  // The user explicitly adds this domain through the UI, so we proceed directly.

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
  try {
    // Send message to background script FIRST so it can reset alarms and caches before storage is cleared
    const response = await ext.runtime.sendMessage({ action: 'hardReset' });

    // Now clear UI storage
    await ext.storage.local.clear();
    if ('sync' in ext.storage && ext.storage.sync) {
      await ext.storage.sync.clear();
    }

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
      'archivedEmails',
      'inboxes',
      'activeInboxId',
      'identities',
      'selectedIdentityId',
      'savedSearchFilters',
      'themeMode',
      'contrastLevel',
      'customColor',
      'autoCopy',
      'autoRenew',
      'selectedProvider',
      'passwordSettings',
      'nameSettings',
      'developerSettings',
      'emailRetentionDays',
      'faviconCaching',
      'providerInstances',
    ]);
    if (result.passwordSettings && typeof result.passwordSettings === 'object') {
      delete (result.passwordSettings as Record<string, unknown>).customPassword;
    }
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
  input.style.display = 'none';
  document.body.appendChild(input);

  input.onchange = async (e) => {
    document.body.removeChild(input);
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      let parsed: { version?: string; data?: unknown };
      try {
        parsed = JSON.parse(text);
      } catch (_parseError) {
        throw new Error('Invalid JSON format');
      }
      if (!parsed.version || !parsed.data)
        throw new Error('Missing required format fields (version/data)');
      const importedData = parsed.data;

      // Merge arrays (inboxes, emailHistory, loginInfo, identities, storedEmails, archivedEmails) to avoid overwriting
      const existing = await ext.storage.local.get([
        'inboxes',
        'emailHistory',
        'loginInfo',
        'storedEmails',
        'archivedEmails',
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

      const mergeRecord = <T>(
        existing: Record<string, T>,
        incoming: Record<string, T>
      ): Record<string, T> => {
        const merged = { ...existing };
        for (const [key, value] of Object.entries(incoming)) {
          if (!(key in merged)) merged[key] = value;
        }
        return merged;
      };

      const allowedKeys = [
        'themeMode',
        'contrastLevel',
        'customColor',
        'autoCopy',
        'autoRenew',
        'selectedProvider',
        'nameSettings',
        'developerSettings',
        'emailRetentionDays',
        'faviconCaching',
        'providerInstances',
      ];
      const toSet: Record<string, unknown> = {};
      const importedDict = importedData as Record<string, unknown>;
      for (const key of allowedKeys) {
        if (key in importedDict) {
          toSet[key] = importedDict[key];
        }
      }

      if (Array.isArray(importedDict.inboxes)) {
        toSet.inboxes = mergeById(existing.inboxes || [], importedDict.inboxes as never[]);
      }
      if (Array.isArray(importedDict.emailHistory)) {
        toSet.emailHistory = mergeByKey(
          existing.emailHistory || [],
          importedDict.emailHistory as never[],
          'email' as keyof unknown
        );
      }
      if (Array.isArray(importedDict.loginInfo)) {
        toSet.loginInfo = mergeByKey(
          existing.loginInfo || [],
          importedDict.loginInfo as never[],
          'domain' as keyof unknown
        );
      }
      if (Array.isArray(importedDict.identities)) {
        toSet.identities = mergeById(existing.identities || [], importedDict.identities as never[]);
      }
      if (Array.isArray(importedDict.savedSearchFilters)) {
        toSet.savedSearchFilters = mergeById(
          existing.savedSearchFilters || [],
          importedDict.savedSearchFilters as never[]
        );
      }
      if (typeof importedDict.storedEmails === 'object' && importedDict.storedEmails !== null) {
        toSet.storedEmails = mergeRecord(
          existing.storedEmails || {},
          importedDict.storedEmails as Record<string, unknown>
        );
      }
      if (typeof importedDict.archivedEmails === 'object' && importedDict.archivedEmails !== null) {
        toSet.archivedEmails = mergeRecord(
          existing.archivedEmails || {},
          importedDict.archivedEmails as Record<string, unknown>
        );
      }

      await ext.storage.local.set(toSet);
      await loadInboxes();
    } catch (err: unknown) {
      throw new Error(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  input.click();
}
