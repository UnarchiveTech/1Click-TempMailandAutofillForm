import type { browser } from 'wxt/browser';

import disallowedDomains from '@/config/domain-policy.jsonc';
import { normalizeKeybindings } from '@/features/keyboard-shortcuts/shortcuts.js';
import { DEFAULT_PROVIDER, loadProviderConfig } from '@/utils/email/email-service.js';
import { ApiError, getErrorMessage, ValidationError } from '@/utils/errors.js';
import { t, tSync } from '@/utils/i18n/i18n-utils.js';
import { logError } from '@/utils/logger.js';
import {
  getEnabledInstances,
  setProviderInstance as setProviderInstanceStorage,
} from '@/utils/provider/instance-manager.js';
import {
  validateCustomInstanceName,
  validateCustomInstanceUrl,
} from '@/utils/provider/instance-validation.js';
import { DEFAULT_PRE_EXPIRY_WINDOW_MINUTES } from '@/utils/provider/provider-expiry.js';
import { defaultDomainKey } from '@/utils/storage/storage-keys.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import { debounce } from '@/utils/time/time.js';
import type {
  AutoRenewScope,
  EmailPreviewMode,
  Keybindings,
  ProviderInstance,
} from '@/utils/types.js';

export interface SettingsState {
  autoCopy: boolean;
  autoRenew: boolean;
  autoRenewScope: AutoRenewScope;
  /** Auto-renew lead time in minutes before expiry (1-30). */
  autoRenewWindowMinutes: number;
  selectedProvider: string;
  providerInstances: ProviderInstance[];
  selectedProviderInstance: string | null;
  customColor: string;
  globalZoomEnabled: boolean;
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
  emailPreviewMode: EmailPreviewMode;
  defaultDomain: string;
}

export interface SettingsSetters {
  setAutoCopy: (value: boolean) => void;
  setAutoRenew: (value: boolean) => void;
  setAutoRenewScope: (value: AutoRenewScope) => void;
  setAutoRenewWindowMinutes: (value: number) => void;
  setSelectedProvider: (value: string) => void;
  setProviderInstances: (instances: ProviderInstance[]) => void;
  setSelectedProviderInstance: (instanceId: string | null) => void;
  setCustomColor: (value: string) => void;
  setGlobalZoomEnabled: (value: boolean) => void;
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
  setEmailPreviewMode: (value: EmailPreviewMode) => void;
  setDefaultDomain: (value: string) => void;
  setShowToast: (message: string, type: 'success' | 'error' | 'warning') => void;
  loadAddresses: () => Promise<void>;
  /** Optional confirm dialog before sensitive actions (e.g. host permission). */
  confirmAsync?: (message: string) => Promise<boolean>;
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
      'autoRenewScope',
      'selectedProvider',
      'customColor',
      'globalZoomEnabled',
      'developerSettings',
      'emailRetentionDays',
      'faviconCaching',
      'notificationSettings',
      'keybindings',
      'autoRefreshInterval',
      'emailPreviewMode',
      'preExpiryWindowMinutes',
    ])) as {
      autoCopy?: boolean;
      autoRenew?: boolean;
      autoRenewScope?: AutoRenewScope;
      /** User-configurable auto-renew lead time in minutes (1-30). */
      preExpiryWindowMinutes?: number;
      selectedProvider?: string;
      customColor?: string;
      globalZoomEnabled?: boolean;
      developerSettings?: {
        showDeveloperSettings: boolean;
        enableLogging: boolean;
      };
      emailRetentionDays?: number;
      faviconCaching?: 'direct' | 'local';
      notificationSettings?: {
        enabled: boolean;
        soundEnabled: boolean;
        expiryWarningThreshold: number;
      };
      keybindings?: Keybindings;
      autoRefreshInterval?: number;
      emailPreviewMode?: EmailPreviewMode;
    };
    if (result.autoCopy !== undefined) setters.setAutoCopy(result.autoCopy);
    if (result.autoRenew !== undefined) setters.setAutoRenew(result.autoRenew);
    if (result.autoRenewScope !== undefined) setters.setAutoRenewScope(result.autoRenewScope);
    if (result.preExpiryWindowMinutes !== undefined) {
      setters.setAutoRenewWindowMinutes(result.preExpiryWindowMinutes);
    } else {
      setters.setAutoRenewWindowMinutes(DEFAULT_PRE_EXPIRY_WINDOW_MINUTES);
    }
    if (result.selectedProvider) setters.setSelectedProvider(result.selectedProvider);
    if (result.customColor) setters.setCustomColor(result.customColor);
    setters.setGlobalZoomEnabled(result.globalZoomEnabled === true);
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
    // Merge new defaults and repair collisions/bare printable shortcuts left
    // by older recorder versions before the dispatcher reads user settings.
    setters.setKeybindings(normalizeKeybindings(result.keybindings));
    if (result.autoRefreshInterval !== undefined) {
      setters.setAutoRefreshInterval(normalizeAutoRefreshInterval(result.autoRefreshInterval));
    } else {
      setters.setAutoRefreshInterval(30000);
    }
    // Clamp at the storage boundary: only the two known modes are accepted,
    // anything stale/corrupt falls back to the floating-tooltip default.
    if (result.emailPreviewMode === 'tooltip' || result.emailPreviewMode === 'expanded') {
      setters.setEmailPreviewMode(result.emailPreviewMode);
    } else {
      setters.setEmailPreviewMode('tooltip');
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
  _ext: typeof browser,
  state: SettingsState,
  setters: SettingsSetters
) {
  setters.setSavingSettings(true);
  try {
    await writeWithRetry({
      autoCopy: state.autoCopy,
      autoRenew: state.autoRenew,
      autoRenewScope: state.autoRenewScope,
      preExpiryWindowMinutes: state.autoRenewWindowMinutes,
      selectedProvider: state.selectedProvider,
      customColor: state.customColor,
      globalZoomEnabled: state.globalZoomEnabled,
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
      // NOTE: state.keybindings must already be detached from Svelte 5 deep
      // proxies before it reaches here (see settingsState() in AppLayout) -
      // Firefox's structured-clone rejects Proxy objects (DataCloneError).
      keybindings: state.keybindings,
      autoRefreshInterval: normalizeAutoRefreshInterval(state.autoRefreshInterval),
      emailPreviewMode: state.emailPreviewMode,
    });
    // Save default domain to per-provider scoped key
    await writeWithRetry({
      [defaultDomainKey(state.selectedProvider)]: state.defaultDomain,
    });
    setters.setShowToast(await t('toasts.settingsSaved'), 'success');
  } catch (e: unknown) {
    logError('saveSettings error:', undefined, e instanceof Error ? e : new Error(String(e)));
    setters.setShowToast(await t('toasts.settingsSaveFailed'), 'error');
  } finally {
    setters.setSavingSettings(false);
  }
}

// Centralized write queue cache to prevent storage write thrashing
let pendingSettings: Record<string, unknown> = {};

const flushSettingsWrite = debounce(async (_ext: typeof browser) => {
  if (Object.keys(pendingSettings).length === 0) return;
  const toWrite = { ...pendingSettings };
  pendingSettings = {};
  try {
    await writeWithRetry(toWrite);
  } catch (e) {
    // The snapshot was already cleared - re-queue it UNDER any writes that
    // arrived while the flush was in flight, so a failed flush retries its
    // keys instead of dropping them (newer values still win per key).
    pendingSettings = { ...toWrite, ...pendingSettings };
    logError(
      'Failed flushing debounced settings write:',
      undefined,
      e instanceof Error ? e : new Error(String(e))
    );
  }
}, 400);

function queueSettingsWrite(ext: typeof browser, key: string, value: unknown) {
  pendingSettings[key] = value;
  flushSettingsWrite(ext);
}

/**
 * Synchronously dispatch any pending debounced settings write (e.g. on page
 * hide / teardown) so queued keys are not stranded by an unload that arrives
 * before the debounce window elapses. The underlying write stays
 * fire-and-forget; on failure it re-queues itself via the flush catch above
 * and is picked up by the next toggle or flush call (no auto-retry timer, so
 * a persistent storage failure cannot spin a 400ms retry loop).
 */
export function flushPendingSettingsWrites(ext: typeof browser): void {
  if (Object.keys(pendingSettings).length > 0) {
    flushSettingsWrite(ext);
  }
  flushSettingsWrite.flush();
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
  queueSettingsWrite(ext, 'developerSettings', {
    showDeveloperSettings: newValue,
    enableLogging: state.enableLogging,
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
  queueSettingsWrite(ext, 'developerSettings', {
    showDeveloperSettings: state.showDeveloperSettings,
    enableLogging: newValue,
  });
  setters.setShowToast(
    await t(newValue ? 'toasts.loggingEnabled' : 'toasts.loggingDisabled'),
    'success'
  );
}

/**
 * Handle provider change and reload addresses
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
  await setters.loadAddresses();
}

/**
 * Save auto-copy setting to browser storage
 * @param ext - Browser extension API
 * @param value - Auto-copy enabled/disabled
 */
export async function saveAutoCopy(ext: typeof browser, value: boolean) {
  queueSettingsWrite(ext, 'autoCopy', value);
}

/**
 * Save auto-renew setting to browser storage
 * @param ext - Browser extension API
 * @param value - Auto-renew enabled/disabled
 */
export async function saveAutoRenew(ext: typeof browser, value: boolean) {
  queueSettingsWrite(ext, 'autoRenew', value);
}

/**
 * Save auto-renew scope setting to browser storage
 * @param ext - Browser extension API
 * @param value - Scope: backfill all addresses, default for new only, or ask
 */
export async function saveAutoRenewScope(ext: typeof browser, value: AutoRenewScope) {
  queueSettingsWrite(ext, 'autoRenewScope', value);
}

/**
 * Save auto-renew lead time (minutes before expiry) to browser storage
 * @param ext - Browser extension API
 * @param value - Minutes before expiry (1-30)
 */
export async function saveAutoRenewWindowMinutes(ext: typeof browser, value: number) {
  queueSettingsWrite(ext, 'preExpiryWindowMinutes', value);
}

function normalizeAutoRefreshInterval(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 30_000;
  if (value === 0) return 0;
  return Math.max(10_000, Math.min(3_600_000, value));
}

/**
 * Handle custom color change
 * @param ext - Browser extension API
 * @param color - Hex color code
 */
export async function handleColorChange(ext: typeof browser, color: string) {
  queueSettingsWrite(ext, 'customColor', color);
}

/**
 * Switch to a different email provider
 * @param ext - Browser extension API
 * @param provider - Provider to switch to
 * @param setters - Settings setter functions
 */
async function switchProvider(ext: typeof browser, provider: string, setters: SettingsSetters) {
  setters.setSelectedProvider(provider);
  await writeWithRetry({ selectedProvider: provider });
  const config = loadProviderConfig(provider);
  if (config.ui?.multiInstance) {
    await loadProviderInstances(ext, setters);
  }
  await setters.loadAddresses();
  setters.setShowToast(
    // `t` here is the flat-vars translator (`Record<string, string|number>`),
    // not svelte-i18n's `$t` - passing `{ values: … }` left `{name}` unfilled.
    await t('toasts.switchedProvider', { name: config.displayName }),
    'success'
  );
}

/**
 * Load provider instances from storage
 * @param ext - Browser extension API
 * @param setters - Settings setter functions
 */
export const changeProvider = switchProvider;

export async function loadProviderInstances(ext: typeof browser, setters: SettingsSetters) {
  try {
    const { selectedProvider } = (await ext.storage.local.get(['selectedProvider'])) as {
      selectedProvider?: string;
    };
    const provider = selectedProvider || DEFAULT_PROVIDER;
    const response = await ext.runtime.sendMessage({
      type: 'getProviderInstances',
      provider,
    });
    if (response?.success) setters.setProviderInstances(response.instances || []);
    // Selection is derived from the enabled/disabled instance pool.
    // Exactly one enabled instance ≈ a pin; several ≈ random pool selection.
    const enabled = await getEnabledInstances(provider);
    if (enabled.length === 1) {
      setters.setSelectedProviderInstance(enabled[0].id);
    } else {
      setters.setSelectedProviderInstance('random');
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
  const { selectedProvider } = (await ext.storage.local.get(['selectedProvider'])) as {
    selectedProvider?: string;
  };
  const provider = selectedProvider || DEFAULT_PROVIDER;
  await setProviderInstanceStorage(provider, instanceId);
  if (instanceId === 'random') {
    setters.setShowToast(await t('toasts.randomInstanceEnabled'), 'success');
  } else {
    setters.setShowToast(await t('toasts.instanceUpdated'), 'success');
  }
  await setters.loadAddresses();
}

export async function addCustomInstance(
  ext: typeof browser,
  name: string,
  url: string,
  setters: SettingsSetters
) {
  try {
    validateCustomInstanceName(name);
    await validateCustomInstanceUrl(url);
  } catch (e) {
    if (e instanceof ValidationError) {
      // `e.message` is either a descriptive English log string or the leaf of a
      // translation key - never render it. The mapped key is what the user sees.
      setters.setShowToast(
        e.translationKey.startsWith('errors.')
          ? tSync(e.translationKey)
          : await t('toasts.validationFailed'),
        'error'
      );
      return;
    }
    setters.setShowToast(await t('toasts.validationFailed'), 'error');
    return;
  }

  const parsedUrl = new URL(url);
  const domain = parsedUrl.hostname.toLowerCase();

  // JSON-driven disallowed-suffix policy (src/config/domain-policy.jsonc).
  const blacklistedPatterns: string[] = disallowedDomains;
  const isBlacklisted = blacklistedPatterns.some((pattern) => {
    const suffix = pattern.trim().toLowerCase().replace(/^\.+/, '');
    return !!suffix && (domain === suffix || domain.endsWith(`.${suffix}`));
  });

  if (isBlacklisted) {
    setters.setShowToast(await t('toasts.domainNotAllowed'), 'error');
    return;
  }

  const originPattern = `${parsedUrl.protocol}//${parsedUrl.host}/*`;
  try {
    const [hasOrigin, hasDnsOrigin] = await Promise.all([
      ext.permissions.contains({ origins: [originPattern] }),
      ext.permissions.contains({ origins: ['https://dns.google/*'] }),
    ]);
    const missingOrigins = [
      ...(!hasOrigin ? [originPattern] : []),
      ...(!hasDnsOrigin ? ['https://dns.google/*'] : []),
    ];
    if (missingOrigins.length > 0) {
      const origin = `${parsedUrl.protocol}//${parsedUrl.host}`;
      if (setters.confirmAsync) {
        const confirmed = await setters.confirmAsync(
          await t('toasts.customInstanceHostPermission', { origin })
        );
        if (!confirmed) return;
      }
      const granted = await ext.permissions.request({
        origins: missingOrigins,
      });
      if (!granted) {
        setters.setShowToast(await t('errors.permissionDenied'), 'error');
        return;
      }
    }
  } catch (error) {
    logError('Failed to request host permission for custom instance', error);
    setters.setShowToast(await t('errors.permissionDenied'), 'error');
    return;
  }

  // Note: We removed the synchronous confirm() here because it is disallowed in background scripts/MV3.
  // The user explicitly adds this domain through the UI, so we proceed directly.

  const response = await ext.runtime.sendMessage({
    type: 'addCustomInstance',
    instance: {
      name: name.toLowerCase().replace(/\s+/g, '-'),
      displayName: name,
      apiUrl: url,
    },
  });
  if (response?.success) {
    setters.setShowToast(await t('toasts.customInstanceAdded'), 'success');
    await loadProviderInstances(ext, setters);
  } else setters.setShowToast(await t('toasts.customInstanceAddFailed'), 'error');
}

export async function hardReset(ext: typeof browser, setters: SettingsSetters) {
  try {
    // Send message to background script FIRST so it can reset alarms and caches before storage is cleared
    const response = await ext.runtime.sendMessage({ type: 'hardReset' });

    if (!response?.success) {
      throw new ApiError(response?.error || (await t('toasts.hardResetFailed')), { response });
    }

    // Clear UI storage only after the background reset succeeds, then restore
    // the invalidation marker returned by the background handler. Without this
    // step local.clear() erases forceNewSessions before providers can observe it.
    await ext.storage.local.clear();
    if ('sync' in ext.storage && ext.storage.sync) {
      await ext.storage.sync.clear();
    }
    await writeWithRetry({
      lastHardReset:
        typeof response.lastHardReset === 'number' ? response.lastHardReset : Date.now(),
      forceNewSessions: true,
    });

    setters.setShowToast(await t('toasts.hardResetCompleted'), 'success');
    setTimeout(() => window.location.reload(), 1000);
  } catch (error) {
    logError(
      'hardReset error:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
    setters.setShowToast(await t('toasts.hardResetFailed'), 'error');
  }
}
