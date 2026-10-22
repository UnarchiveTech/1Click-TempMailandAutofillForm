<script lang="ts">
import { onMount } from 'svelte';
import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';

/** Sentinel value for the "Create new" option in the default-identity selector. */
const CREATE_NEW_IDENTITY = '__create_new_identity__';

import { testAiConnection as runAiConnectionTest } from '@/entrypoints/background/parsing/ai-detection.js';
import { getLastBackupExportAt } from '@/features/backup/backup-export-status.js';
import {
  acceptBlockSuggestion,
  dismissBlockSuggestion,
  getBlockSuggestions,
} from '@/features/intelligence/blocklist-learn.js';
import {
  DEFAULT_SMART_AUTOFILL,
  loadSmartAutofillSettings,
  type SmartAutofillSettings,
  saveSmartAutofillSettings,
} from '@/features/intelligence/smart-settings.js';
import {
  loadNotificationIntelligence,
  saveNotificationIntelligence,
} from '@/features/intelligence/storage.js';
import {
  countCustomizedKeybindings,
  formatKeybinding,
} from '@/features/settings/keybinding-recorder.svelte.js';
import type { PageZoomDirection, PageZoomSettings } from '@/features/settings/page-zoom.js';
import type { View } from '@/features/types/view-types.js';
import ConfirmDialog from '@/ui/blocks/dialogs/ConfirmDialog.svelte';
import MasterPasswordModal from '@/ui/blocks/dialogs/MasterPasswordModal.svelte';
import ToastContainer from '@/ui/blocks/feedback/ToastContainer.svelte';
import ErrorBoundary from '@/ui/blocks/layout/ErrorBoundary.svelte';
import VerificationSettings from '@/ui/blocks/mail/VerificationSettings.svelte';
import LanguageSwitcher from '@/ui/blocks/widgets/LanguageSwitcher.svelte';
import ColorPicker from '@/ui/components/composites/ColorPicker.svelte';
import FloatingAction from '@/ui/components/composites/FloatingAction.svelte';
import ScrollSpy from '@/ui/components/composites/ScrollSpy.svelte';
import SearchBar, { type SearchBarResult } from '@/ui/components/composites/SearchBar.svelte';
import SettingCard from '@/ui/components/composites/SettingCard.svelte';
import WebDAVSettingsCard from '@/ui/components/composites/WebDAVSettingsCard.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import type { KnownIconName } from '@/ui/components/icons/icon-names.js';
import { Btn, Checkbox, Dropdown, Toggle } from '@/ui/components/primitives';
import ProgressBar from '@/ui/components/primitives/ProgressBar.svelte';
import Skeleton from '@/ui/components/primitives/Skeleton.svelte';
import { isArchived, isDeleted } from '@/utils/address/address-status.js';
import {
  type ClearClipboardOutcome,
  clearClipboardNow,
} from '@/utils/clipboard/clear-clipboard.js';
import { getClipboardPurgeStatus } from '@/utils/clipboard/clipboard-purge-status.js';
import {
  loadClipboardPrivacy,
  normalizeClipboardPrivacy,
  saveClipboardPrivacy,
} from '@/utils/clipboard/clipboard-settings.js';
import { isBlockedByList } from '@/utils/content/autofill-blocklist.js';
import { localizedErrorMessageOrFallback } from '@/utils/errors.js';
import { setLanguage } from '@/utils/i18n/i18n.js';
import { logError } from '@/utils/logger.js';
import {
  getNotificationPermissionStatus,
  openNotificationSettingsPage,
} from '@/utils/notifications/notification-permission.js';
import { DEFAULT_PRE_EXPIRY_WINDOW_MINUTES } from '@/utils/provider/provider-expiry.js';
import { getSearchHistoryLimit, setSearchHistoryLimit } from '@/utils/search/search-history.js';
import { decryptSecret, encryptSecret } from '@/utils/security/crypto.js';
import { mergePrefUpdate, updateStoredObject } from '@/utils/storage/rmw.js';
import {
  DEFAULT_SIDEBAR_POSITION,
  getEmailMaps,
  normalizeSidebarPosition,
  normalizeUiDensity,
  type SidebarPosition,
  type UiDensity,
} from '@/utils/storage/storage-keys.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import { formatBytes, getStorageUsage } from '@/utils/storage/storageMonitor.js';
import {
  cancelVaultRekey,
  disableVaultLock,
  getVaultConfig,
  isBiometricSupported,
  preflightVaultReKey,
  rekeyVault,
  rotateVaultKey,
  saveVaultConfig,
  setupBiometricVault,
  setupMasterPassword,
  type VaultAutoLockTimeout,
  type VaultSecurityMode,
  verifyVaultRekey,
} from '@/utils/storage/vault-lock.js';
import { formatLocalDateTime } from '@/utils/time/time.js';
import type {
  Address,
  AutoRenewScope,
  EmailPreviewMode,
  Identity,
  Keybinding,
  Keybindings,
  ProviderInstance,
} from '@/utils/types.js';
import { DEFAULT_KEYBINDINGS } from '@/utils/types.js';
import { setMarqueeSelectionEnabled } from '@/utils/ui/marquee-selection.js';
import { PORTAL_Z_CLASS } from '@/utils/ui/portal-layers.js';
import { responsiveButtonLayout } from '@/utils/ui/responsive-button-layout.js';
import { CONTROL_INK_SELECTED, controlSurface } from '@/utils/ui/row-surface.js';
import { toastStore } from '@/utils/ui/toastStore.js';
import AddressesView from './addresses/AddressesView.svelte';
import IdentitiesView from './autofill/IdentitiesView.svelte';
import ConstantsSettingsView from './settings/ConstantsSettingsView.svelte';
import HtmlRenderingSettingsView from './settings/HtmlRenderingSettingsView.svelte';
import KeyboardShortcutsView from './settings/KeyboardShortcutsView.svelte';
import MailProviderView from './settings/MailProviderView.svelte';
import NavbarOrderSettingsView from './settings/NavbarOrderSettingsView.svelte';
import PageZoomSettingsView from './settings/PageZoomSettingsView.svelte';
import StoragePerformanceView from './settings/StoragePerformanceView.svelte';
import ToolbarSettingsView from './settings/ToolbarSettingsView.svelte';

let vaultMode = $state<VaultSecurityMode>('standard');
let vaultAutoLockTimeout = $state<VaultAutoLockTimeout>('15m');
let selectedDesignTheme = $state<'material'>('material');
let biometricSupported = $state(false);
let isPasswordModalOpen = $state(false);
let passwordModalMode = $state<'setup' | 'change' | 'switch' | 'rotate'>('setup');
// True once the fresh-lock verification proved the new password survives a
// restart - only then is a re-key final and its rollback stash swept.
let rekeyVerified = $state(false);
// Pre-flight count for the manual key rotation (shown in the rotate modal).
let rotatePreflight = $state<{
  migratable: number;
  undecryptable: number;
  checked: boolean;
} | null>(null);
let lastRotateCount = $state(0);
let smartSettings = $state<SmartAutofillSettings>({
  ...DEFAULT_SMART_AUTOFILL,
});
let blockSuggestions = $state<string[]>([]);
let activeSettingsSubpage = $state<string | null>(null);

interface AutomationRules {
  autoArchiveOnCopyOtp: boolean;
  autoArchiveOnRead: boolean;
  autoDeletePromo24h: boolean;
}

const DEFAULT_AUTOMATION_RULES: AutomationRules = {
  autoArchiveOnCopyOtp: true,
  autoArchiveOnRead: false,
  autoDeletePromo24h: false,
};

let automationRules = $state<AutomationRules>({ ...DEFAULT_AUTOMATION_RULES });

async function loadAutomationRules() {
  try {
    const res = (await browser.storage.local.get(['automationRules'])) as {
      automationRules?: Partial<AutomationRules>;
    };
    if (res.automationRules) {
      automationRules = { ...DEFAULT_AUTOMATION_RULES, ...res.automationRules };
    }
  } catch (error) {
    logError('Failed to load automation rules in settings', error);
  }
}

async function saveAutomationRule(key: keyof AutomationRules, val: boolean) {
  try {
    // Serialized RMW (defaults-merge): the write patches ONLY this rule on top
    // of what storage last held, so a toggle made in another surface between
    // our mount-time load and now survives instead of being reverted by a
    // stale whole-object write.
    automationRules = await updateStoredObject(
      'automationRules',
      mergePrefUpdate(DEFAULT_AUTOMATION_RULES, { [key]: val }),
      (raw) => ({ ...DEFAULT_AUTOMATION_RULES, ...(raw as Partial<AutomationRules>) })
    );
  } catch (error) {
    logError('Failed to save automation rule in settings', error);
  }
}

$effect(() => {
  if (initialSubpage) {
    activeSettingsSubpage = initialSubpage;
  }
});

async function updateSmartSetting(partial: Partial<SmartAutofillSettings>) {
  try {
    smartSettings = await saveSmartAutofillSettings(partial);
  } catch (error) {
    logError('Failed to save smart autofill settings', error);
    toastStore.error($t('toasts.settingsSaveFailed'));
  }
}

let processingDomain = $state('');

async function acceptBlockSug(domain: string) {
  processingDomain = domain;
  try {
    await acceptBlockSuggestion(domain);
    blockSuggestions = await getBlockSuggestions();
    toastStore.success(
      get(t)('settings.blockSuggestionsAccepted', {
        values: { domain },
      }) as string
    );
  } finally {
    processingDomain = '';
  }
}

async function dismissBlockSug(domain: string) {
  processingDomain = domain;
  try {
    await dismissBlockSuggestion(domain);
    blockSuggestions = await getBlockSuggestions();
  } finally {
    processingDomain = '';
  }
}

async function saveSidebarPosition(position: SidebarPosition) {
  const previous = sidebarPositionLocal;
  sidebarPositionLocal = position;
  try {
    await writeWithRetry({ sidebarPosition: position });
  } catch (error) {
    sidebarPositionLocal = previous;
    logError('Failed to save sidebar position preference', error);
    toastStore.error($t('toasts.settingsSaveFailed'));
  }
}
let lastBackupAt = $state<number | null>(null);
let autofillLoginPreference = $state<'recent' | 'listOrder'>('recent');
let demoMode = $state(false);
let voiceSearchEnabled = $state(true);
/** After address expires (and not auto-renewed): archive (default) or permanent delete */
let expiryAction = $state<'archive' | 'delete'>('archive');
/** Auto-archive point for failed renewals; retry timing remains adaptive in either mode. */
let renewalFailurePolicy = $state<'retry' | 'archive'>('retry');
let densityLocal = $state<UiDensity>('expanded');
let sidebarPositionLocal = $state<SidebarPosition>(DEFAULT_SIDEBAR_POSITION);
let dialogPresentationBottomSheet = $state(false);
let otpDetectionMode = $state<'numeric' | 'alphanumeric' | 'balanced'>('balanced');
/** OTP detection engine: local algorithm (default) or AI via OpenAI-compatible API */
let otpDetectionProvider = $state<'algorithm' | 'ai'>('algorithm');
let aiBaseUrl = $state('');
let aiApiKey = $state('');
// A locked or unavailable vault makes decryptSecret return ''. Preserve the
// stored ciphertext in that case when another AI setting is edited.
let aiApiKeyUnavailable = $state(false);
let aiModel = $state('');
let aiTestState = $state<'idle' | 'testing' | 'ok' | 'fail'>('idle');
let aiTestError = $state('');
let aiRescanState = $state<'idle' | 'running'>('idle');
let aiRescanProgressTimerId: ReturnType<typeof setInterval> | null = null;
/** Live re-scan progress ({done}/{total} emails) published by the background. */
let aiRescanProgress = $state<{ done: number; total: number } | null>(null);
let aiClearCacheState = $state<'idle' | 'running'>('idle');
let gesturesEnabled = $state(true);
let marqueeSelectionEnabled = $state(true);
/** Master switch for content-script autofill (default ON) */
let autofillFeatureEnabled = $state(true);
/** Show “/” operators button on search bars (default ON); /commands always work */
let showSearchSlashIcon = $state(true);
/** Show images in email body (default ON) */
let showImages = $state(true);
/** Notification intelligence (quiet hours, OTP-only, digest) */
let notifIntel = $state({
  otpAndMagicOnly: false,
  quietHoursEnabled: false,
  quietHoursStart: 22,
  quietHoursEnd: 8,
  mutedSenderDomains: [] as string[],
  groupDigest: true,
});
let mutedDomainsText = $state('');

/** Clipboard privacy (auto-purge after copy) */
let clipboardPrivacy = $state({
  autoPurgeEnabled: true,
  purgeAfterSeconds: 30,
});

/** Clipboard purge records whose wipe keeps failing past the alerting threshold (review-2-glm §10.3). */
let clipboardPurgeStuck = $state(0);

/** Manual "Clear clipboard now" action: in flight while the wipe is running. */
let clipboardClearState = $state<'idle' | 'clearing'>('idle');
/** Outcome of the last manual clear - a code the view renders through $t. */
let clipboardClearOutcome = $state<ClearClipboardOutcome | null>(null);

/** Master switch for in-app toast notifications (default ON). */
let toastsEnabled = $state(true);

/** Scrollspy section tabs (mirrors Activity view navigation) */
type SettingsSpySection =
  | 'general'
  | 'identity'
  | 'mail'
  | 'notifications'
  | 'autofill'
  | 'inputNav'
  | 'appearance'
  | 'developer'
  | 'search'
  | 'diagnostics'
  | 'data';

const SETTINGS_SPY_SECTIONS: {
  id: SettingsSpySection;
  labelKey: string;
  icon: KnownIconName;
}[] = [
  { id: 'general', labelKey: 'preferences.sectionGeneral', icon: 'settings' },
  { id: 'appearance', labelKey: 'preferences.sectionAppearance', icon: 'lightMode' },
  { id: 'mail', labelKey: 'preferences.sectionMail', icon: 'mail' },
  {
    id: 'notifications',
    labelKey: 'preferences.sectionNotifications',
    icon: 'notifications',
  },
  { id: 'autofill', labelKey: 'preferences.sectionAutofill', icon: 'lock' },
  { id: 'inputNav', labelKey: 'preferences.inputAndNavigation', icon: 'dragHandle' },
  { id: 'search', labelKey: 'preferences.sectionSearch', icon: 'search' },
  {
    id: 'developer',
    labelKey: 'preferences.sectionDeveloper',
    icon: 'monitor',
  },
  {
    id: 'diagnostics',
    labelKey: 'preferences.sectionDiagnostics',
    icon: 'barChart',
  },
  { id: 'data', labelKey: 'preferences.sectionData', icon: 'database' },
];

let settingsSpyActive = $state<string>('general');

function formatBackupDate(ts: number): string {
  const ms = ts < 1e11 ? ts * 1000 : ts;
  return formatLocalDateTime(
    ms,
    { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
    ts
  );
}

/** Ask the browser for host permission to reach the AI API origin (best-effort). */
async function requestAiHostPermission(baseUrl: string): Promise<void> {
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return;
  }
  if (!origin || origin === 'null') return;
  try {
    const requested = { origins: [`${origin}/*`] };
    if (await browser.permissions.contains(requested)) return;
    const granted = await browser.permissions.request(requested);
    if (!granted) toastStore.warning($t('preferences.aiHostPermissionDenied'));
  } catch {
    /* ignore - the background fetch will surface any CORS/permission error */
  }
}

/** Persist AI config and (re)grant host permission for the API origin. */
async function persistAiConfig() {
  aiBaseUrl = aiBaseUrl.trim();
  aiApiKey = aiApiKey.trim();
  aiModel = aiModel.trim();
  // Store the API key vault-encrypted like every other secret (the background
  // decrypts it on load). Plaintext only lives in memory while editing/testing.
  const update: Record<string, string> = { aiBaseUrl, aiModel };
  if (!(aiApiKeyUnavailable && !aiApiKey)) {
    update.aiApiKey = aiApiKey ? await encryptSecret(aiApiKey) : '';
  }
  await writeWithRetry(update);
  if (aiBaseUrl) await requestAiHostPermission(aiBaseUrl);
}

/** Re-run the batched detector over already-stored emails (current engine). */
async function runStoredRescan() {
  if (aiRescanState === 'running') return;
  aiRescanState = 'running';
  aiRescanProgress = null;
  const progressTimer = setInterval(async () => {
    try {
      const r = (await browser.storage.local.get('aiRescanProgress')) as {
        aiRescanProgress?: { done: number; total: number; at: number };
      };
      if (r.aiRescanProgress && Date.now() - r.aiRescanProgress.at < 30_000) {
        aiRescanProgress = {
          done: r.aiRescanProgress.done,
          total: r.aiRescanProgress.total,
        };
      }
    } catch {
      /* ignore polling errors */
    }
  }, 1000);
  aiRescanProgressTimerId = progressTimer;
  try {
    const res = (await browser.runtime.sendMessage({
      type: 'rescanEmailsForDetection',
      includeArchived: true,
    })) as {
      success: boolean;
      scanned?: number;
      otpsDetected?: number;
      magicLinksDetected?: number;
      error?: string;
    };
    if (!res?.success) {
      // The background payload is opaque English prose - log it, never render it.
      logError('AI rescan failed', res?.error);
      toastStore.error($t('preferences.aiRescanFailed') as string);
      return;
    }
    toastStore.success(
      $t('preferences.aiRescanDone', {
        values: {
          scanned: String(res.scanned ?? 0),
          otps: String(res.otpsDetected ?? 0),
          magic: String(res.magicLinksDetected ?? 0),
        },
      }) as string
    );
  } catch (e) {
    logError('AI rescan request failed', e);
    toastStore.error($t('preferences.aiRescanFailed') as string);
  } finally {
    clearInterval(progressTimer);
    aiRescanProgressTimerId = null;
    aiRescanState = 'idle';
    aiRescanProgress = null;
  }
}

/** Remove the persisted AI detection result cache. */
async function runAiClearCache() {
  if (aiClearCacheState === 'running') return;
  aiClearCacheState = 'running';
  try {
    const res = (await browser.runtime.sendMessage({
      type: 'clearAiDetectionCache',
    })) as {
      success: boolean;
      cleared?: boolean;
      error?: string;
    };
    if (!res?.success) {
      logError('AI cache clear failed', res?.error);
      toastStore.error($t('preferences.aiClearCacheFailed') as string);
      return;
    }
    toastStore.success(
      (res.cleared
        ? $t('preferences.aiClearCacheDone')
        : $t('preferences.aiClearCacheEmpty')) as string
    );
  } catch (e) {
    logError('AI cache clear request failed', e);
    toastStore.error($t('preferences.aiClearCacheFailed') as string);
  } finally {
    aiClearCacheState = 'idle';
  }
}

/** Round-trip to the configured endpoint from the Settings page. */
async function runAiTest() {
  if (!aiBaseUrl.trim() || !aiApiKey.trim() || !aiModel.trim()) {
    toastStore.warning($t('preferences.aiNotConfigured'));
    return;
  }
  aiTestState = 'testing';
  aiTestError = '';
  try {
    await runAiConnectionTest({
      baseUrl: aiBaseUrl.trim(),
      apiKey: aiApiKey.trim(),
      model: aiModel.trim(),
    });
    aiTestState = 'ok';
    toastStore.success($t('preferences.aiTestSuccess'));
  } catch (e) {
    aiTestState = 'fail';
    logError('AI connection test failed', e);
    // Typed failures render their keyed reason; anything else shows the
    // localized unknown-error copy - never the raw thrown message.
    aiTestError = localizedErrorMessageOrFallback(e, $t, 'errors.unknownError');
    toastStore.error(
      $t('preferences.aiTestFailed', {
        values: { error: aiTestError },
      }) as string
    );
  }
}

onMount(() => {
  let destroyed = false;
  (async () => {
    const config = await getVaultConfig();
    if (destroyed) return;
    vaultMode = config.mode;
    vaultAutoLockTimeout = config.autoLockTimeout || '15m';
    biometricSupported = await isBiometricSupported();
    lastBackupAt = await getLastBackupExportAt(browser);
    const stored = (await browser.storage.local.get([
      'autofillLoginPreference',
      'demoMode',
      'otpDetectionMode',
      'otpDetectionProvider',
      'aiBaseUrl',
      'aiApiKey',
      'aiModel',
      'gesturesEnabled',
      'marqueeSelectionEnabled',
      'voiceSearchEnabled',
      'uiDensity',
      'sidebarPosition',
      'dialogPresentationBottomSheet',
      'expiryAction',
      'renewalFailurePolicy',
      'autofillFeatureEnabled',
      'showSearchSlashIcon',
      'showImages',
      'toastsEnabled',
    ])) as {
      autofillLoginPreference?: 'recent' | 'listOrder';
      demoMode?: boolean;
      otpDetectionMode?: 'numeric' | 'alphanumeric' | 'balanced';
      otpDetectionProvider?: 'algorithm' | 'ai';
      aiBaseUrl?: string;
      aiApiKey?: string;
      aiModel?: string;
      gesturesEnabled?: boolean;
      marqueeSelectionEnabled?: boolean;
      voiceSearchEnabled?: boolean;
      uiDensity?: UiDensity;
      sidebarPosition?: unknown;
      dialogPresentationBottomSheet?: boolean;
      expiryAction?: 'archive' | 'delete';
      renewalFailurePolicy?: 'retry' | 'archive';
      autofillFeatureEnabled?: boolean;
      showSearchSlashIcon?: boolean;
      showImages?: boolean;
      toastsEnabled?: boolean;
    };
    if (
      stored.autofillLoginPreference === 'listOrder' ||
      stored.autofillLoginPreference === 'recent'
    )
      autofillLoginPreference = stored.autofillLoginPreference;
    demoMode = !!stored.demoMode;
    if (stored.gesturesEnabled === false) gesturesEnabled = false;
    if (stored.marqueeSelectionEnabled === false) marqueeSelectionEnabled = false;
    autofillFeatureEnabled = stored.autofillFeatureEnabled !== false;
    showSearchSlashIcon = stored.showSearchSlashIcon !== false;
    showImages = stored.showImages !== false;
    toastsEnabled = stored.toastsEnabled !== false;
    toastStore.setEnabled(toastsEnabled);
    voiceSearchEnabled = stored.voiceSearchEnabled !== false;
    if (stored.expiryAction === 'delete' || stored.expiryAction === 'archive') {
      expiryAction = stored.expiryAction;
    }
    if (stored.renewalFailurePolicy === 'archive' || stored.renewalFailurePolicy === 'retry') {
      renewalFailurePolicy = stored.renewalFailurePolicy;
    }
    densityLocal = normalizeUiDensity(stored.uiDensity);
    sidebarPositionLocal = normalizeSidebarPosition(stored.sidebarPosition);
    dialogPresentationBottomSheet = stored.dialogPresentationBottomSheet === true;
    if (
      stored.otpDetectionMode === 'numeric' ||
      stored.otpDetectionMode === 'alphanumeric' ||
      stored.otpDetectionMode === 'balanced'
    ) {
      otpDetectionMode = stored.otpDetectionMode;
    }
    if (stored.otpDetectionProvider === 'algorithm' || stored.otpDetectionProvider === 'ai') {
      otpDetectionProvider = stored.otpDetectionProvider;
    }
    if (typeof stored.aiBaseUrl === 'string') aiBaseUrl = stored.aiBaseUrl;
    if (typeof stored.aiApiKey === 'string') {
      aiApiKey = stored.aiApiKey ? await decryptSecret(stored.aiApiKey) : '';
      aiApiKeyUnavailable = stored.aiApiKey.startsWith('_enc_:') && aiApiKey.length === 0;
    }
    if (typeof stored.aiModel === 'string') aiModel = stored.aiModel;
    try {
      const ni = await loadNotificationIntelligence();
      notifIntel = { ...ni };
      mutedDomainsText = (ni.mutedSenderDomains || []).join(', ');
    } catch {
      /* optional */
    }
    try {
      clipboardPrivacy = await loadClipboardPrivacy();
    } catch {
      /* optional */
    }
    try {
      clipboardPurgeStuck = (await getClipboardPurgeStatus()).alerting;
    } catch {
      /* optional */
    }
    try {
      smartSettings = await loadSmartAutofillSettings();
      blockSuggestions = await getBlockSuggestions();
    } catch {
      /* optional */
    }
    try {
      await loadAutomationRules();
    } catch {
      /* optional */
    }
  })().catch((err) => {
    logError('Failed to initialize extension settings in onMount', undefined, err);
  });

  void loadStorageSnapshot();

  const onStorage = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && changes.clipboardPrivacy) {
      clipboardPrivacy = normalizeClipboardPrivacy(changes.clipboardPrivacy.newValue);
    }
    if (area === 'local' && changes.clipboardPurgeQueue) {
      void getClipboardPurgeStatus().then((status) => {
        clipboardPurgeStuck = status.alerting;
      });
    }
    if (area === 'local' && changes.automationRules) {
      const next = changes.automationRules.newValue as Partial<AutomationRules> | undefined;
      if (next) {
        automationRules = { ...DEFAULT_AUTOMATION_RULES, ...next };
      }
    }
    if (area === 'local' && changes.lastBackupExportAt) {
      const v = changes.lastBackupExportAt.newValue;
      lastBackupAt = typeof v === 'number' ? v : null;
    }
    if (area === 'local' && changes.autofillLoginPreference) {
      const v = changes.autofillLoginPreference.newValue;
      if (v === 'listOrder' || v === 'recent') autofillLoginPreference = v;
    }
    if (area === 'local' && changes.demoMode) {
      demoMode = !!changes.demoMode.newValue;
    }
    if (area === 'local' && changes.voiceSearchEnabled) {
      voiceSearchEnabled = changes.voiceSearchEnabled.newValue !== false;
    }
    if (area === 'local' && changes.otpDetectionMode) {
      const v = changes.otpDetectionMode.newValue;
      if (v === 'numeric' || v === 'alphanumeric' || v === 'balanced') otpDetectionMode = v;
    }
    if (area === 'local' && changes.otpDetectionProvider) {
      const v = changes.otpDetectionProvider.newValue;
      if (v === 'algorithm' || v === 'ai') otpDetectionProvider = v;
    }
    if (area === 'local' && changes.aiBaseUrl) {
      const v = changes.aiBaseUrl.newValue;
      if (typeof v === 'string') aiBaseUrl = v;
    }
    if (area === 'local' && changes.aiApiKey) {
      const v = changes.aiApiKey.newValue;
      if (typeof v === 'string') {
        // Stored value is `_enc_:` ciphertext - decrypt for the edit field.
        void decryptSecret(v).then((plain) => {
          aiApiKey = plain;
          aiApiKeyUnavailable = v.startsWith('_enc_:') && plain.length === 0;
        });
      }
    }
    if (area === 'local' && changes.aiModel) {
      const v = changes.aiModel.newValue;
      if (typeof v === 'string') aiModel = v;
    }
    if (area === 'local' && changes.toastsEnabled) {
      const next = changes.toastsEnabled.newValue !== false;
      toastsEnabled = next;
      toastStore.setEnabled(next);
    }
    // Keep the Data-section storage snapshot fresh when mail arrives/cleans up.
    if (
      area === 'local' &&
      Object.keys(changes).some(
        (key) =>
          key.startsWith('storedEmailsByAddress_') || key.startsWith('archivedEmailsByAddress_')
      )
    ) {
      void loadStorageSnapshot();
    }
  };
  browser.storage.onChanged.addListener(onStorage);
  return () => {
    destroyed = true;
    if (aiRescanProgressTimerId) {
      clearInterval(aiRescanProgressTimerId);
      aiRescanProgressTimerId = null;
    }
    for (const tid of testNotifyTimerIds) {
      clearTimeout(tid);
    }
    testNotifyTimerIds.clear();
    browser.storage.onChanged.removeListener(onStorage);
  };
});

async function persistNotifIntel() {
  try {
    const muted = mutedDomainsText
      .split(/[,;\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    notifIntel = { ...notifIntel, mutedSenderDomains: muted };
    await saveNotificationIntelligence(notifIntel);
  } catch (e) {
    logError(
      'Failed to save notification intelligence',
      undefined,
      e instanceof Error ? e : new Error(String(e))
    );
  }
}

/**
 * Wipe the clipboard on explicit request, then re-read the purge status so a
 * stuck-warning card the wipe resolved disappears immediately.
 */
async function clearClipboardManually() {
  if (clipboardClearState === 'clearing') return;
  clipboardClearState = 'clearing';
  clipboardClearOutcome = null;
  try {
    clipboardClearOutcome = await clearClipboardNow();
  } finally {
    clipboardClearState = 'idle';
    clipboardPurgeStuck = (await getClipboardPurgeStatus()).alerting;
  }
}

async function persistClipboardPrivacy() {
  try {
    await saveClipboardPrivacy(clipboardPrivacy);
  } catch (e) {
    logError(
      'Failed to save clipboard privacy',
      undefined,
      e instanceof Error ? e : new Error(String(e))
    );
    toastStore.error($t('toasts.settingsSaveFailed'));
    clipboardPrivacy = await loadClipboardPrivacy();
  }
}

async function handleSetVaultMode(targetMode: VaultSecurityMode) {
  if (targetMode === 'standard') {
    const ok = await disableVaultLock();
    if (ok) {
      vaultMode = 'standard';
      toastStore.success($t('preferences.vaultSetStandard'));
    }
  } else if (targetMode === 'password') {
    // Password-protected → change / re-key flow; biometrics-protected → switch
    // (biometrics unlock inside rekeyVault, no typed current password).
    passwordModalMode =
      vaultMode === 'password' ? 'change' : vaultMode === 'biometrics' ? 'switch' : 'setup';
    rekeyVerified = false;
    isPasswordModalOpen = true;
  } else if (targetMode === 'biometrics') {
    const ok = await setupBiometricVault();
    if (ok) {
      vaultMode = 'biometrics';
      toastStore.success($t('preferences.biometricVaultEnabled'));
    } else {
      toastStore.error($t('preferences.biometricSetupFailed'));
    }
  }
}

async function handleRotateVaultKey() {
  passwordModalMode = 'rotate';
  rekeyVerified = false;
  rotatePreflight = null;
  isPasswordModalOpen = true;
  // Pre-flight count: decrypt-verified when unlocked, structural when locked
  // (the rotation itself re-checks decryptability and aborts if anything fails).
  rotatePreflight = await preflightVaultReKey();
}

async function handleSaveMasterPassword(payload: {
  currentPassword?: string;
  newPassword: string;
}): Promise<boolean> {
  if (
    passwordModalMode === 'change' ||
    passwordModalMode === 'switch' ||
    passwordModalMode === 'rotate'
  ) {
    const result: { success: boolean; error?: string; migratable?: number } =
      passwordModalMode === 'rotate'
        ? await rotateVaultKey({
            // Biometrics vaults authenticate inside rotateVaultKey - no typed
            // current password (the modal sends none for those).
            currentPassword: payload.currentPassword,
            // The rotation is NOT final until fresh-lock verification passes;
            // keep the old key + config so it can be rolled back.
            prepareRollback: true,
          })
        : await rekeyVault({
            // 'switch' (biometrics → password) has no typed current password -
            // the biometric unlock happens inside rekeyVault.
            currentPassword: passwordModalMode === 'change' ? payload.currentPassword : undefined,
            newPassword: payload.newPassword,
            prepareRollback: true,
          });
    if (result.success) {
      // No success toast yet - the modal moves to its verify phase.
      if (passwordModalMode === 'rotate') {
        lastRotateCount = result.migratable ?? 0;
      }
      return true;
    }
    const key =
      result.error === 'invalid-current-password'
        ? 'preferences.masterPasswordWrongCurrent'
        : result.error === 'biometric-unlock-failed'
          ? 'preferences.masterPasswordBiometricUnlockFailed'
          : result.error === 'migration-failed'
            ? 'preferences.masterPasswordMigrationFailed'
            : result.error === 'password-too-short'
              ? 'settings.masterPasswordTooShort'
              : 'preferences.masterPasswordFailed';
    toastStore.error($t(key));
    return false;
  }
  const ok = await setupMasterPassword(payload.newPassword);
  if (ok) {
    vaultMode = 'password';
    toastStore.success($t('preferences.masterPasswordVaultEnabled'));
  } else {
    toastStore.error($t('preferences.masterPasswordFailed'));
  }
  return ok;
}

async function handleVerifyMasterPassword(
  newPassword: string
): Promise<'ok' | 'wrong' | 'locked-out'> {
  const result = await verifyVaultRekey(newPassword);
  if (result.success) {
    // Fresh lock + re-entry succeeded - the change is proven and final.
    rekeyVerified = true;
    vaultMode = (await getVaultConfig()).mode;
    if (passwordModalMode === 'rotate') {
      toastStore.success(
        $t('preferences.masterPasswordRotated', {
          values: { count: lastRotateCount },
        })
      );
    } else if (passwordModalMode === 'switch') {
      toastStore.success($t('preferences.masterPasswordSwitched'));
    } else {
      toastStore.success($t('preferences.masterPasswordVerified'));
    }
    return 'ok';
  }
  if (result.error === 'locked-out') {
    return 'locked-out';
  }
  if (result.error === 'not-found' || result.error === 'unknown') {
    toastStore.error($t('preferences.masterPasswordFailed'));
  }
  return 'wrong';
}

async function handleClosePasswordModal() {
  // Closing mid-change without the verification proof undoes the change - the
  // vault goes back to the previous password with all data intact.
  if (passwordModalMode !== 'setup' && !rekeyVerified) {
    const { rolledBack } = await cancelVaultRekey();
    if (rolledBack) {
      vaultMode = (await getVaultConfig()).mode;
      toastStore.error($t('preferences.masterPasswordChangeCanceled'));
    }
  }
  rekeyVerified = false;
  isPasswordModalOpen = false;
}

let {
  context = 'popup',
  onBack = () => {},

  autoCopy = false,
  autoRenew = true,
  autoRenewScope = 'ask' as AutoRenewScope,
  autoRenewWindowMinutes = DEFAULT_PRE_EXPIRY_WINDOW_MINUTES,
  selectedProvider = '',
  savingSettings = false,
  loading = false,
  onSaveSettings = () => {},

  onSetAutoCopy = undefined,
  onSetAutoRenew = undefined,
  onSetAutoRenewScope = undefined,
  onSaveAutoRenewScope = undefined,
  onApplyAutoRenewToAll = undefined,
  onSetAutoRenewWindowMinutes = undefined,
  onHardReset = () => {},
  providerInstances = [],
  selectedProviderInstance = null,
  onSetProviderInstance = () => {},
  onExportData = () => {},
  onExportCategory = undefined,
  onImportData = () => {},
  loadAddresses = async () => {},
  onProviderChange = () => {},
  onAddCustomInstance = () => {},
  onLoadProviderInstances = () => {},
  customColor = '',
  globalZoomEnabled = false,
  globalZoomScale = 1,
  pageZoomSettings = {},
  onTogglePageZoom = () => {},
  onChangePageZoom = () => {},
  onToggleGlobalZoom = () => {},
  onColorChange = () => {},
  addressColorThemeEnabled = false,
  onToggleAddressColorTheme = () => {},
  showDeveloperSettings = false,
  enableLogging = false,
  onToggleDeveloperSettings = () => {},
  onOpenPlayground = () => {},
  onToggleEnableLogging = () => {},
  onNavigateToConstantsSettings = () => {},
  contrastLevel = 'standard',
  onContrastLevelChange = () => {},
  emailRetentionDays = 30,
  onSetEmailRetentionDays = undefined,
  faviconCaching = 'direct',
  onSetFaviconCaching = undefined,
  identities = [],
  selectedIdentityId = null,
  onSetSelectedIdentityId = undefined,
  onNavigateToIdentities = () => {},
  onCreateIdentity = () => {},
  notificationsEnabled = false,
  soundEnabled = false,
  expiryWarningThreshold = 60 * 60 * 1000, // Default 1 hour
  onSetNotificationsEnabled = undefined,
  onSetSoundEnabled = undefined,
  onSetExpiryWarningThreshold = undefined,
  keybindings = DEFAULT_KEYBINDINGS,
  onSetKeybindings = undefined,
  onNavigateToKeybindings = () => {},
  onNavigateToTagManagement = () => {},
  onNavigateToFiltersManagement = () => {},
  onNavigateToMailProvider = () => {},
  onNavigateToStoragePerformance = () => {},
  onNavigateToAddressAccentColors = () => {},
  onNavigateToLabelManagement = () => {},
  onNavigateToAddresses = () => {},
  onNavigateToAutomation = () => {},
  onNavigateToDiagnostics = () => {},
  autoRefreshInterval = 30000,
  onSetAutoRefreshInterval = undefined,
  emailPreviewMode = 'tooltip' as EmailPreviewMode,
  onSetEmailPreviewMode = undefined as ((value: EmailPreviewMode) => void) | undefined,
  defaultDomain = '',
  onSetDefaultDomain = undefined,
  allAddresses = [] as Address[],
  autofillBlocklist = [] as string[],
  onRemoveFromBlocklist = undefined,
  onAddToBlocklist = undefined,
  onToggleBlocklist = undefined,
  initialSubpage = null as string | null,
  onSubpageBack = undefined as (() => void) | undefined,
}: {
  context?: 'popup' | 'sidepanel' | 'app';
  onBack?: () => void;

  autoCopy?: boolean;
  autoRenew?: boolean;
  autoRenewScope?: AutoRenewScope;
  autoRenewWindowMinutes?: number;
  selectedProvider?: string;
  savingSettings?: boolean;
  loading?: boolean;
  onSaveSettings?: () => void;

  onSetAutoCopy?: (value: boolean) => void;
  onSetAutoRenew?: (value: boolean) => void;
  onSetAutoRenewScope?: (value: AutoRenewScope) => void;
  onSaveAutoRenewScope?: () => void;
  onApplyAutoRenewToAll?: (value: boolean) => Promise<number>;
  onSetAutoRenewWindowMinutes?: (value: number) => void;
  onHardReset?: () => void;
  providerInstances?: ProviderInstance[];
  selectedProviderInstance?: string | null;
  onSetProviderInstance?: (instanceId: string) => void;
  onExportData?: () => void;
  onExportCategory?: (
    category: 'settings' | 'identities' | 'savedLogins' | 'addresses' | 'all'
  ) => void;
  onImportData?: () => void;
  /** Refresh the inbox list after a WebDAV download-and-restore. */
  loadAddresses?: () => Promise<void>;
  onProviderChange?: (provider: string) => void;
  onAddCustomInstance?: (name: string, url: string) => void;
  onLoadProviderInstances?: () => void | Promise<void>;
  customColor?: string;
  globalZoomEnabled?: boolean;
  globalZoomScale?: number;
  pageZoomSettings?: PageZoomSettings;
  onTogglePageZoom?: (view: View, enabled: boolean) => void;
  onChangePageZoom?: (view: View, direction: PageZoomDirection) => void;
  onToggleGlobalZoom?: (enabled: boolean) => void;
  onColorChange?: (color: string) => void;
  addressColorThemeEnabled?: boolean;
  onToggleAddressColorTheme?: () => void;
  showDeveloperSettings?: boolean;
  enableLogging?: boolean;
  onToggleDeveloperSettings?: () => void;
  onToggleEnableLogging?: () => void;
  onNavigateToConstantsSettings?: () => void;
  onOpenPlayground?: () => void;
  contrastLevel?: 'standard' | 'medium' | 'high';
  onContrastLevelChange?: (level: 'standard' | 'medium' | 'high') => void;
  emailRetentionDays?: number;
  onSetEmailRetentionDays?: (value: number) => void;
  faviconCaching?: 'direct' | 'local';
  onSetFaviconCaching?: (value: 'direct' | 'local') => void;
  identities?: Identity[];
  selectedIdentityId?: string | null;
  onSetSelectedIdentityId?: (id: string | null) => void;
  onNavigateToIdentities?: () => void;
  /** "Create new" picked in the default-identity selector → open identity create UI. */
  onCreateIdentity?: () => void;
  notificationsEnabled?: boolean;
  soundEnabled?: boolean;
  expiryWarningThreshold?: number;
  onSetNotificationsEnabled?: (value: boolean) => void;
  onSetSoundEnabled?: (value: boolean) => void;
  onSetExpiryWarningThreshold?: (value: number) => void;
  keybindings?: Keybindings;
  onSetKeybindings?: (value: Keybindings) => void;
  onNavigateToKeybindings?: () => void;
  onNavigateToTagManagement?: () => void;
  onNavigateToFiltersManagement?: () => void;
  onNavigateToMailProvider?: () => void;
  onNavigateToStoragePerformance?: () => void;
  onNavigateToAddressAccentColors?: () => void;
  onNavigateToLabelManagement?: () => void;
  onNavigateToAddresses?: () => void;
  onNavigateToAutomation?: () => void;
  onNavigateToDiagnostics?: () => void;
  autoRefreshInterval?: number;
  onSetAutoRefreshInterval?: (value: number) => void;
  emailPreviewMode?: EmailPreviewMode;
  onSetEmailPreviewMode?: (value: EmailPreviewMode) => void;
  defaultDomain?: string;
  onSetDefaultDomain?: (value: string) => void;
  allAddresses?: Address[];
  initialSubpage?: string | null;
  onSubpageBack?: () => void;
  autofillBlocklist?: string[];
  onRemoveFromBlocklist?: (domain: string) => void;
  onAddToBlocklist?: (domain: string) => void | Promise<void>;
  onToggleBlocklist?: (domain: string) => void | Promise<void>;
} = $props();

// Storage snapshot for the Data section summary (counts stay live via $derived).
let storageBytes = $state(0);
let storedEmailCount = $state(0);
let storageSnapshot = $derived({
  addresses: allAddresses.length,
  emails: storedEmailCount,
  identities: identities.length,
  bytes: storageBytes,
});

async function loadStorageSnapshot() {
  try {
    const { storedEmails, archivedEmails } = await getEmailMaps();
    let emailCount = 0;
    for (const list of Object.values(storedEmails)) emailCount += list.length;
    for (const list of Object.values(archivedEmails)) emailCount += list.length;
    storedEmailCount = emailCount;
    storageBytes = await getStorageUsage();
  } catch {
    /* ignore */
  }
}

/** Send a real OS notification so users can verify sound + permission instantly. */
let testNotifyBusy = $state(false);
let testNotifyResult = $state('');
const testNotifyTimerIds = new Set<ReturnType<typeof setTimeout>>();
/** True when the browser blocked notifications - result renders as a clickable warning. */
let notificationsBlocked = $state(false);

async function sendTestNotification() {
  testNotifyBusy = true;
  testNotifyResult = '';
  notificationsBlocked = false;
  try {
    // Check the browser/OS permission level first - when the user blocked
    // notifications for this extension, creating one would silently no-op.
    const permission = await getNotificationPermissionStatus();
    if (permission === 'denied') {
      notificationsBlocked = true;
      testNotifyResult = $t('diagnostics.testNotificationBlocked');
      return;
    }
    const id = `settings_test_notif_${Date.now()}`;
    const runtime = browser.runtime as { getURL?: (path: string) => string };
    await browser.notifications.create(id, {
      type: 'basic',
      iconUrl:
        typeof runtime.getURL === 'function'
          ? runtime.getURL('/icons/icon128.png')
          : 'icons/icon128.png',
      title: $t('diagnostics.testNotificationTitle'),
      message: $t('diagnostics.testNotificationBody'),
      // Mirror real behavior: mute the OS chime when sound is disabled.
      silent: !soundEnabled,
    });
    testNotifyResult = $t('diagnostics.testNotificationOk');
    const timerId = setTimeout(() => {
      void browser.notifications.clear(id).catch(() => {});
      testNotifyTimerIds.delete(timerId);
    }, 8000);
    testNotifyTimerIds.add(timerId);
  } catch (e) {
    logError('Test notification failed', e);
    testNotifyResult = $t('diagnostics.testNotificationFail');
  } finally {
    testNotifyBusy = false;
  }
}

async function handleOpenNotificationSettings() {
  const opened = await openNotificationSettingsPage();
  if (!opened) {
    // Browser blocked the chrome:// / about: navigation - give manual steps.
    testNotifyResult = $t('diagnostics.testNotificationSettingsManual');
  }
}

let confirmDialog = $state<{
  message: string;
  onConfirm: () => void;
  title?: string;
  confirmLabel?: string;
  secondaryLabel?: string;
  secondaryIcon?: KnownIconName;
  onSecondary?: () => void;
  note?: string;
  destructive?: boolean;
} | null>(null);

export interface SearchResultItem {
  id: string;
  section: string;
  title: string;
  desc: string;
  element: HTMLElement;
  /** Inline control affordance for the result row (toggle state or select). */
  control?: { kind: 'toggle'; checked: boolean } | null;
}

const LANGUAGE_SEARCH_ALIASES: Record<string, { code: string; name: string }> = {
  en: { code: 'en', name: 'English' },
  english: { code: 'en', name: 'English' },
  es: { code: 'es', name: 'Español' },
  spanish: { code: 'es', name: 'Español' },
  español: { code: 'es', name: 'Español' },
  fr: { code: 'fr', name: 'Français' },
  french: { code: 'fr', name: 'Français' },
  français: { code: 'fr', name: 'Français' },
  de: { code: 'de', name: 'Deutsch' },
  german: { code: 'de', name: 'Deutsch' },
  deutsch: { code: 'de', name: 'Deutsch' },
  ja: { code: 'ja', name: '日本語' },
  japanese: { code: 'ja', name: '日本語' },
  日本語: { code: 'ja', name: '日本語' },
  zh: { code: 'zh', name: '中文' },
  chinese: { code: 'zh', name: '中文' },
  中文: { code: 'zh', name: '中文' },
  ar: { code: 'ar', name: 'العربية' },
  arabic: { code: 'ar', name: 'العربية' },
  العربية: { code: 'ar', name: 'العربية' },
  th: { code: 'th', name: 'ไทย' },
  thai: { code: 'th', name: 'ไทย' },
  ไทย: { code: 'th', name: 'ไทย' },
};

function getLanguageCommand(query: string) {
  const match = /^language\s*:\s*(.+)$/i.exec(query.trim());
  if (!match) return null;
  return LANGUAGE_SEARCH_ALIASES[match[1].trim().toLowerCase()] ?? null;
}

let settingsSearchQuery = $state('');
const languageCommand = $derived(getLanguageCommand(settingsSearchQuery));
let searchToggleOverrides = $state<Record<string, boolean>>({});
let searchToggleOverrideQuery = $state('');
let settingsContainer = $state<HTMLElement | null>(null);
let settingsLoadingList = $state<HTMLElement | null>(null);
let settingsLoadingSkeletonCount = $state(5);
$effect(() => {
  const list = settingsLoadingList;
  if (!loading || !list) return;

  const updateSkeletonCount = () => {
    // Each settings placeholder is about 82px tall plus the 12px list gap.
    settingsLoadingSkeletonCount = Math.max(1, Math.ceil(list.clientHeight / 94));
  };
  updateSkeletonCount();
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(updateSkeletonCount);
    observer.observe(list);
    return () => observer.disconnect();
  }
  window.addEventListener('resize', updateSkeletonCount);
  return () => window.removeEventListener('resize', updateSkeletonCount);
});
let newBlocklistDomain = $state('');
/** Hostname of the active browser tab (when available) for blocklist quick-add */
let currentTabDomain = $state('');
let searchHistoryLimit = $state(5);

$effect(() => {
  void getSearchHistoryLimit().then((n) => {
    searchHistoryLimit = n;
  });
});

async function loadCurrentTabDomain() {
  try {
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    const url = tab?.url;
    if (!url || !/^https?:\/\//i.test(url)) {
      currentTabDomain = '';
      return;
    }
    currentTabDomain = new URL(url).hostname.toLowerCase();
  } catch {
    /* ignore */
    currentTabDomain = '';
  }
}

$effect(() => {
  void loadCurrentTabDomain();
});

const filteredSettings = $derived.by(() => {
  if (!settingsSearchQuery.trim() || !settingsContainer) return [];
  if (typeof document === 'undefined') return [];

  const query = settingsSearchQuery.trim().toLowerCase();
  const results: SearchResultItem[] = [];
  const processedElements = new Set<HTMLElement>();
  let autoIdCounter = 0;

  // Query all sections in settings view
  const sections = settingsContainer.querySelectorAll('section');

  for (const section of sections) {
    // Find the category header (first child element containing text)
    let categoryName = $t('common.settings');
    const firstTextChild = section.querySelector('span, h1, h2, h3, div');
    if (firstTextChild) {
      categoryName = firstTextChild.textContent?.trim() || $t('common.settings');
    }

    // All other children of the section are individual settings items
    const children = Array.from(section.children);

    // Skip the first child (which is the header container)
    for (let i = 1; i < children.length; i++) {
      const el = children[i] as HTMLElement;
      if (processedElements.has(el)) continue;

      // Extract title and description dynamically using leaf text nodes
      const leafTexts: string[] = [];
      function walk(node: Node) {
        // Skip hidden elements, search inputs, and dropdown selectors
        if (node instanceof Element) {
          const tagName = node.tagName.toLowerCase();
          if (
            tagName === 'select' ||
            tagName === 'option' ||
            node.classList.contains('sr-only') ||
            node.classList.contains('fixed') ||
            node.getAttribute('type') === 'checkbox'
          ) {
            return;
          }
        }
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent?.trim();
          if (text) {
            leafTexts.push(text);
          }
        } else {
          for (const child of node.childNodes) {
            walk(child);
          }
        }
      }

      walk(el);

      const titleText = leafTexts[0] || '';
      const descText = leafTexts.slice(1).join(' ') || '';

      if (!titleText || titleText.length < 2) continue;

      const aliasText = el.getAttribute('data-search-alias')?.toLowerCase() || '';
      const searchableText = `${categoryName} ${titleText} ${descText} ${aliasText}`.toLowerCase();
      if (searchableText.includes(query)) {
        if (!el.id) {
          autoIdCounter++;
          el.id = `dynamic-setting-item-${autoIdCounter}`;
        }

        results.push({
          id: el.id,
          section: categoryName,
          title: titleText,
          desc: descText,
          element: el,
          control: detectSettingControl(el),
        });
        processedElements.add(el);
      }
    }
  }

  // Deduplicate results
  const uniqueResults: SearchResultItem[] = [];
  const seenKeys = new Set<string>();
  for (const item of results) {
    const key = `${item.section}:::${item.title}`.toLowerCase();
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueResults.push(item);
    }
  }

  return uniqueResults;
});

/** Detect a quick-action control inside a setting card for the search dropdown. */
function detectSettingControl(el: HTMLElement): SearchResultItem['control'] {
  // Svelte <Toggle> renders as <button role="switch"> - expose its on/off state.
  const toggle = el.querySelector('button[role="switch"]');
  if (toggle) {
    const checked =
      toggle.getAttribute('aria-checked') === 'true' || toggle.hasAttribute('data-checked');
    return { kind: 'toggle', checked };
  }
  return null;
}

function updateSearchToggleOverride(id: string, checked: boolean) {
  if (searchToggleOverrideQuery !== settingsSearchQuery) {
    searchToggleOverrideQuery = settingsSearchQuery;
    searchToggleOverrides = {};
  }
  searchToggleOverrides[id] = checked;
}

/** SearchBar-compatible view of the DOM-walk results. */
const searchResults = $derived<SearchBarResult[]>([
  ...(languageCommand
    ? [
        {
          id: `setting-command-language-${languageCommand.code}`,
          title: $t('common.switchToLanguage', { values: { lang: languageCommand.name } }),
          badge: $t('preferences.language'),
        },
      ]
    : []),
  ...filteredSettings.map((item) => ({
    id: item.id,
    title: item.title,
    description: item.desc && item.desc !== item.title ? item.desc : undefined,
    badge: item.section,
  })),
]);

function findResultItem(id: string): SearchResultItem | null {
  return filteredSettings.find((item) => item.id === id) ?? null;
}

function handleResultPick(result: SearchBarResult) {
  if (result.id.startsWith('setting-command-language-')) {
    const code = result.id.slice('setting-command-language-'.length);
    settingsSearchQuery = '';
    void setLanguage(code).catch((error) => {
      logError('Language change from settings search failed', error);
      toastStore.error($t('toasts.operationFailed'));
    });
    return;
  }
  const item = findResultItem(result.id);
  if (item) handleNavigateToElement(item);
}

function handleNavigateToElement(item: SearchResultItem) {
  settingsSearchQuery = '';

  const subpageWrapper = item.element.closest('[data-settings-subpage]');
  if (subpageWrapper) {
    const subpage = subpageWrapper.getAttribute('data-settings-subpage');

    // Switch routing view
    if (subpage === 'keybindings' && onNavigateToKeybindings) {
      onNavigateToKeybindings();
    } else if (
      (subpage === 'tagManagement' ||
        subpage === 'filtersManagement' ||
        subpage === 'labelManagement' ||
        subpage === 'organize') &&
      (onNavigateToTagManagement || onNavigateToFiltersManagement || onNavigateToLabelManagement)
    ) {
      // All organize sections live on the unified Organize page
      if (subpage === 'filtersManagement' && onNavigateToFiltersManagement) {
        onNavigateToFiltersManagement();
      } else if (subpage === 'labelManagement' && onNavigateToLabelManagement) {
        onNavigateToLabelManagement();
      } else if (onNavigateToTagManagement) {
        onNavigateToTagManagement();
      }
    } else if (subpage === 'mailProvider' && onNavigateToMailProvider) {
      onNavigateToMailProvider();
    } else if (subpage === 'storagePerformance' && onNavigateToStoragePerformance) {
      onNavigateToStoragePerformance();
    } else if (subpage === 'addresses' && onNavigateToAddresses) {
      onNavigateToAddresses();
    } else if (subpage === 'constantsSettings' && onNavigateToConstantsSettings) {
      onNavigateToConstantsSettings();
    } else if (subpage === 'identities' && onNavigateToIdentities) {
      onNavigateToIdentities();
    } else if (subpage === 'toolbarButtons') {
      activeSettingsSubpage = 'toolbarButtons';
    } else if (subpage === 'htmlRendering') {
      activeSettingsSubpage = 'htmlRendering';
    } else if (subpage === 'navbarOrder') {
      activeSettingsSubpage = 'navbarOrder';
    } else if (subpage === 'pageZoom') {
      activeSettingsSubpage = 'pageZoom';
    }

    // Wait for view transition and highlight specific leaf target
    setTimeout(() => {
      const activeContainer = document.querySelector('.flex-1.overflow-y-auto');
      if (activeContainer) {
        const allElements = Array.from(activeContainer.querySelectorAll('*'));
        const matches = allElements.filter((el) => el.textContent?.trim().includes(item.title));
        if (matches.length > 0) {
          matches.sort((a, b) => (a.textContent?.length || 0) - (b.textContent?.length || 0));
          const el = matches[0] as HTMLElement;
          const highlightTarget =
            el.closest(
              '.bg-md-surface-container-low, .bg-md-surface-container, .bg-md-primary-container, .bg-md-secondary-container, button, label, tr, li'
            ) || el;

          highlightTarget.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
          highlightTarget.classList.add('animate-pulse-highlight', 'rounded-xl');

          const focusable = el.matches('button, input, select')
            ? el
            : (el.querySelector('button, input, select') as HTMLElement | null);
          focusable?.focus();

          setTimeout(() => {
            highlightTarget.classList.remove('animate-pulse-highlight', 'rounded-xl');
          }, 1800);
        }
      }
    }, 300);
  } else {
    // Normal scroll highlight in main container
    const element = item.element || document.getElementById(item.id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.classList.add('animate-pulse-highlight', 'rounded-xl');

      const focusable = element.matches('button, input, select')
        ? element
        : (element.querySelector('button, input, select') as HTMLElement | null);
      focusable?.focus();

      setTimeout(() => {
        element.classList.remove('animate-pulse-highlight', 'rounded-xl');
      }, 1800);
    }
  }
}

// Display formatting for keybinding previews (localized via svelte-i18n).
function formatBinding(binding: Keybinding): string {
  return formatKeybinding(binding, get(t));
}

// Count customized keybindings (all actions - mirrors the shortcuts editor).
let customKeybindingCount = $derived(countCustomizedKeybindings(keybindings));

function showConfirmDialog(
  message: string,
  onConfirm: () => void,
  options?: { destructive?: boolean }
) {
  confirmDialog = { message, onConfirm, ...options };
}

function closeConfirmDialog() {
  confirmDialog = null;
}

/** Addresses the global auto-renew backfill applies to (mirrors applyAutoRenewToAll scope). */
const eligibleAddressCount = $derived(allAddresses.filter((a) => !isDeleted(a)).length);

function handleAutoRenewToggle(next: boolean) {
  // Ask-mode defers the flip until the user picks a target - Cancel leaves the
  // toggle (and every address) untouched, so there is nothing to revert.
  if (autoRenewScope === 'ask' && eligibleAddressCount > 0) {
    confirmDialog = {
      title: $t('mailProvider.autoRenewAskTitle'),
      message: $t('mailProvider.autoRenewAskBody', {
        values: {
          state: next ? 'enabled' : 'disabled',
          count: eligibleAddressCount,
        },
      }),
      confirmLabel: $t('mailProvider.autoRenewAskApply'),
      secondaryLabel: $t('mailProvider.autoRenewAskNewOnly'),
      secondaryIcon: 'mail',
      onConfirm: () => {
        void applyAutoRenewChoice(next, true);
      },
      onSecondary: () => {
        // The secondary handler must close the dialog itself (ConfirmDialog
        // only auto-closes the primary path).
        closeConfirmDialog();
        void applyAutoRenewChoice(next, false);
      },
    };
    return;
  }
  void applyAutoRenewChoice(next, autoRenewScope === 'all');
}

async function applyAutoRenewChoice(next: boolean, backfill: boolean) {
  onSetAutoRenew?.(next);
  onSaveSettings();
  if (backfill) await onApplyAutoRenewToAll?.(next);
}

/** Contextual FAB action: focus the settings search bar (hub only). */
function focusSettingsSearch() {
  const input = document.querySelector<HTMLInputElement>('[data-tour="settings-search"] input');
  if (input) {
    input.focus();
    input.select();
  }
}

// Identity select moved to the shared <Dropdown> primitive.
</script>

{#if loading}
  <div bind:this={settingsLoadingList} class="scroll-body flex-1 overflow-y-auto py-2 space-y-3">
    {#each Array(settingsLoadingSkeletonCount) as _, i (i)}
      <div class="rounded-xl bg-md-surface-container-low p-4 space-y-2">
        <Skeleton width="6rem" height="0.75rem" />
        <Skeleton width="100%" height="2rem" />
      </div>
    {/each}
  </div>
{:else}
<ErrorBoundary fallback={$t('preferences.failedToLoadSettings')}>
  {#snippet children()}
    <div class="scroll-frame flex flex-col h-full min-h-0">
      {#if activeSettingsSubpage === 'toolbarButtons'}
        <ToolbarSettingsView
          onBack={() => {
            activeSettingsSubpage = null;
            if (onSubpageBack) onSubpageBack();
          }}
          showToast={(msg) => toastStore.info(msg)}
        />
      {:else if activeSettingsSubpage === 'htmlRendering'}
        <HtmlRenderingSettingsView
          onBack={() => {
            activeSettingsSubpage = null;
            if (onSubpageBack) onSubpageBack();
          }}
          showToast={(msg) => toastStore.info(msg)}
        />
      {:else if activeSettingsSubpage === 'navbarOrder'}
        <NavbarOrderSettingsView
          onBack={() => {
            activeSettingsSubpage = null;
            if (onSubpageBack) onSubpageBack();
          }}
          showToast={(msg) => toastStore.info(msg)}
        />
      {:else if activeSettingsSubpage === 'pageZoom'}
        <PageZoomSettingsView
          globalZoomEnabled={globalZoomEnabled}
          {globalZoomScale}
          {pageZoomSettings}
          {onTogglePageZoom}
          {onChangePageZoom}
          onBack={() => {
            activeSettingsSubpage = null;
            if (onSubpageBack) onSubpageBack();
          }}
        />
      {:else}
        <!-- Sticky header: title + search -->
  <div class="scroll-edge shrink-0 pt-2 pb-1.5 space-y-2 bg-md-surface/95 backdrop-blur-sm border-b border-md-outline-variant/15 {PORTAL_Z_CLASS.chrome}">

    <!-- Sticky Search Bar - shared SearchBar (voice + history + live results) -->
    <div class="relative" data-tour="settings-search">
      <SearchBar
        scope="settings"
        bind:value={settingsSearchQuery}
        placeholder={$t('preferences.searchSettings')}
        animatedPlaceholders={[
          $t('searchPlaceholder.settings'),
          $t('searchPlaceholder.languageSettings'),
          $t('searchPlaceholder.notificationSettings'),
        ]}
        ariaLabel={$t('preferences.searchSettings')}
        settingsStyle={true}
        showVoiceSearch={true}
        results={searchResults}
        emptyResultsLabel={$t('preferences.noMatchingSettings')}
        onResultSelect={handleResultPick}
      >
        {#snippet resultTrailing(item)}
          {@const orig = findResultItem(item.id)}
          {#if orig && orig.control && orig.control.kind === 'toggle'}
            <div class="shrink-0" role="presentation" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
              <Toggle
                checked={
                  searchToggleOverrideQuery === settingsSearchQuery
                    ? (searchToggleOverrides[item.id] ?? orig.control.checked)
                    : orig.control.checked
                }
                ariaLabel={item.title}
                onChange={(next) => {
                  updateSearchToggleOverride(item.id, next);
                  // Drive the underlying setting card's own toggle by
                  // dispatching a click on its switch control.
                  const sw = orig.element.querySelector('button[role="switch"]') as HTMLElement | null;
                  if (sw) {
                    try {
                      sw.click();
                    } catch {
                      /* ignore */
                    }
                  }
                }}
              />
            </div>
          {/if}
        {/snippet}
      </SearchBar>
    </div>
  </div>

  <ScrollSpy
    sections={SETTINGS_SPY_SECTIONS}
    bind:activeId={settingsSpyActive}
    scrollRoot={settingsContainer}
    sectionAttr="data-settings-section"
    sectionIdPrefix="settings-section-"
    ariaLabel={$t('preferences.navAria')}
  />

  <!-- Scrollable settings; section cards go multi-column when host is wide -->
  <div
    bind:this={settingsContainer}
    class="scroll-body scroll-body-framed flex-1 min-h-0 overflow-y-auto py-2 space-y-3 settings-scroll settings-wide-cols"
  >

  <!-- ── General ── -->
  <section id="settings-section-general" data-settings-section="general" class="space-y-2 scroll-mt-2">
    <div class="flex items-center gap-2 mb-1">
      <Icon name="settings" class="w-4 h-4 text-md-primary" />
      <span class="text-sm font-medium text-md-on-surface">{$t('preferences.general')}</span>
    </div>
    <!-- Language Switcher -->
    <SettingCard
      variant="row"
      id="setting-language"
      title={$t('preferences.language')}
      description={$t('preferences.languageDescription')}
    >
      {#snippet action()}
        <LanguageSwitcher />
      {/snippet}
    </SettingCard>

    <!-- Clipboard auto-purge (visible privacy control) -->
    <SettingCard
      variant="row"
      title={$t('privacy.clipboardTitle')}
      description={$t('privacy.clipboardHint')}
      descriptionClass="ui-support text-md-on-surface-variant mt-2"
      class="space-y-2"
    >
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs text-md-on-surface">{$t('privacy.clipboardAutoPurge')}</span>
        <Toggle
          checked={clipboardPrivacy.autoPurgeEnabled}
          ariaLabel={$t('privacy.clipboardAutoPurge')}
          onChange={(next) => {
            clipboardPrivacy = { ...clipboardPrivacy, autoPurgeEnabled: next };
            void persistClipboardPrivacy();
          }}
        />
      </div>
      {#if clipboardPrivacy.autoPurgeEnabled}
        <label class="flex items-center gap-2 text-xs text-md-on-surface">
          {$t('privacy.clipboardPurgeAfter')}
          <input
            type="number"
            min="5"
            max="300"
            class="w-16 px-1.5 py-1 rounded-lg bg-md-surface border border-md-outline-variant/40"
            value={clipboardPrivacy.purgeAfterSeconds}
            onchange={(e) => {
              const n = Math.max(5, Math.min(300, Math.round(Number((e.target as HTMLInputElement).value) || 30)));
              clipboardPrivacy = { ...clipboardPrivacy, purgeAfterSeconds: n };
              void persistClipboardPrivacy();
            }}
          />
          <span class="text-md-on-surface/50">{$t('privacy.clipboardSeconds')}</span>
        </label>
      {/if}
      {#if clipboardPurgeStuck > 0}
        <div
          class="flex items-start gap-2 rounded-xl bg-md-error-container/30 border border-md-error/30 px-3 py-2"
          role="status"
        >
          <Icon name="warning" class="w-4 h-4 text-md-error shrink-0 mt-0.5" />
          <span class="text-xs text-md-error leading-snug">
            {$t('privacy.clipboardPurgeStuckWarning', { values: { n: clipboardPurgeStuck } })}
          </span>
        </div>
      {/if}
      <!-- Explicit escape hatch: works with auto-clear disabled and resolves a
           stuck-warning card. The outcome is reported, never assumed. -->
      <div class="flex flex-wrap items-center gap-2 pt-1">
        <Btn
          variant="outline"
          size="sm"
          type="button"
          busy={clipboardClearState === 'clearing'}
          onclick={() => void clearClipboardManually()}
        >{$t('privacy.clearClipboardNow')}</Btn>
        {#if clipboardClearOutcome === 'cleared'}
          <span class="text-xs text-md-on-surface-variant" role="status" aria-live="polite">
            {$t('privacy.clearClipboardCleared')}
          </span>
        {:else if clipboardClearOutcome === 'unverified'}
          <span class="text-xs text-md-error" role="status" aria-live="polite">
            {$t('privacy.clearClipboardUnverified')}
          </span>
        {:else if clipboardClearOutcome === 'unavailable'}
          <span class="text-xs text-md-error" role="status" aria-live="polite">
            {$t('privacy.clearClipboardUnavailable')}
          </span>
        {/if}
      </div>
    </SettingCard>

  </section>




  <!-- ── Appearance ── -->
  <section id="settings-section-appearance" data-settings-section="appearance" class="space-y-2 scroll-mt-2">
    <div class="flex items-center gap-2 mb-1">
      <Icon name="lightMode" class="w-4 h-4 text-md-primary" />
      <span class="text-sm font-medium text-md-on-surface">{$t('settings.appearance')}</span>
    </div>

    <SettingCard
      variant="row"
      id="setting-select-theme"
      title={$t('preferences.selectTheme')}
      description={$t('preferences.selectThemeDescription')}
      class="space-y-3"
    >
      <Dropdown
        class="w-full"
        variant="outlined"
        ariaLabel={$t('preferences.selectTheme')}
        value={selectedDesignTheme}
        onchange={(value) => {
          if (value === 'material') selectedDesignTheme = value;
        }}
        options={[
          { value: 'material', label: $t('preferences.themeMaterial') },
          { value: 'coming-soon', label: $t('preferences.themeComingSoon'), disabled: true },
        ]}
      />
      {#if selectedDesignTheme === 'material'}
        <div class="flex items-center justify-between gap-2 border-t border-md-outline-variant/20 pt-3">
          <div class="min-w-0">
            <div class="text-sm font-medium text-md-on-surface">{$t('preferences.themeAccent')}</div>
            <div class="text-xs text-md-on-surface/50">{$t('preferences.themeAccentDescription')}</div>
          </div>
          <ColorPicker
            value={customColor || ''}
            ariaLabel={$t('preferences.chooseThemeColor')}
            allowClear={true}
            onChange={(hex) => onColorChange(hex)}
          />
        </div>
      {/if}
    </SettingCard>

    <SettingCard
      variant="row"
      id="setting-global-zoom"
      title={$t('preferences.globalZoom')}
      description={$t('preferences.globalZoomDescription')}
    >
      {#snippet action()}
        <div class="flex items-center gap-1.5">
          <Toggle
            checked={globalZoomEnabled}
            ariaLabel={$t('preferences.globalZoom')}
            onChange={(next) => onToggleGlobalZoom(next)}
          />
          <span aria-hidden="true" class="mx-1 h-5 w-px shrink-0 bg-md-outline-variant/60"></span>
          <button
            type="button"
            class="md-action w-10 h-10 flex items-center justify-center rounded-full text-md-on-surface-variant transition-colors"
            aria-label={$t('preferences.configurePageZoom')}
            title={$t('preferences.configurePageZoom')}
            onclick={(event) => {
              event.stopPropagation();
              activeSettingsSubpage = 'pageZoom';
            }}
          >
            <Icon name="chevronRight" class="w-4 h-4 rtl-flip" />
          </button>
        </div>
      {/snippet}
    </SettingCard>

    <!-- Per-Inbox Accent Theme Toggle -->
    <SettingCard
      variant="row"
      id="setting-per-inbox-theme"
      title={$t('preferences.perAddressAccent')}
      description={$t('preferences.perAddressAccentDescription')}
    >
      {#snippet action()}
        <div class="flex items-center gap-2">
          <Toggle
            checked={addressColorThemeEnabled}
            ariaLabel={$t('preferences.perAddressAccent')}
            onChange={() => onToggleAddressColorTheme()}
          />
          <span class="h-7 w-px shrink-0 bg-md-outline-variant/60" aria-hidden="true"></span>
          <button
            id="button-manage-address-accent-colors"
            type="button"
            class="md-action flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-md-primary transition-colors"
            aria-label={$t('preferences.perAddressAccent')}
            title={$t('preferences.perAddressAccent')}
            onclick={(event) => {
              event.stopPropagation();
              onNavigateToAddressAccentColors();
            }}
          >
            <Icon name="chevronRight" class="h-4 w-4 rtl-flip" />
          </button>
        </div>
      {/snippet}
    </SettingCard>

    <SettingCard
      variant="row"
      id="setting-contrast"
      title={$t('preferences.contrastLevel')}
      description={$t('preferences.contrastLevelDescription')}
    >
      {#snippet action()}
      <div class="flex items-center gap-1">
        <button
          class="px-3 py-1.5 text-xs rounded-lg bg-md-secondary-container text-md-on-secondary-container transition-colors {controlSurface(contrastLevel === 'standard')}"
          aria-pressed={contrastLevel === 'standard'}
          onclick={() => onContrastLevelChange('standard')}
          aria-label={$t('preferences.standardContrast')}
        >
          {$t('preferences.contrastStandard')}
        </button>
        <button
          class="px-3 py-1.5 text-xs rounded-lg bg-md-secondary-container text-md-on-secondary-container transition-colors {controlSurface(contrastLevel === 'medium')}"
          aria-pressed={contrastLevel === 'medium'}
          onclick={() => onContrastLevelChange('medium')}
          aria-label={$t('preferences.mediumContrast')}
        >
          {$t('preferences.contrastMedium')}
        </button>
        <button
          class="px-3 py-1.5 text-xs rounded-lg bg-md-secondary-container text-md-on-secondary-container transition-colors {controlSurface(contrastLevel === 'high')}"
          aria-pressed={contrastLevel === 'high'}
          onclick={() => onContrastLevelChange('high')}
          aria-label={$t('preferences.highContrast')}
        >
          {$t('preferences.contrastHigh')}
        </button>
      </div>
      {/snippet}
    </SettingCard>

    <SettingCard
      variant="row"
      id="setting-account-selector-presentation"
      title={$t('preferences.dialogPresentationBottomSheet')}
      description={$t('preferences.dialogPresentationBottomSheetDescription')}
    >
      {#snippet action()}
        <Toggle
          checked={dialogPresentationBottomSheet}
          ariaLabel={$t('preferences.dialogPresentationBottomSheet')}
          onChange={async (next) => {
            const previous = dialogPresentationBottomSheet;
            dialogPresentationBottomSheet = next;
            try {
              await writeWithRetry({ dialogPresentationBottomSheet: next });
            } catch (error) {
              dialogPresentationBottomSheet = previous;
              logError('Failed to save account selector presentation preference', error);
              toastStore.error($t('preferences.dialogPresentationBottomSheetSaveFailed'));
            }
          }}
        />
      {/snippet}
    </SettingCard>

    <SettingCard
      variant="row"
      id="setting-density"
      title={$t('preferences.density')}
      description={$t('preferences.densityDescription')}
    >
      {#snippet action()}
      <div class="flex items-center gap-1 shrink-0">
        <button
          type="button"
          class="px-3 py-2 text-xs rounded-lg font-semibold transition-colors {densityLocal === 'expanded'
            ? 'bg-md-primary text-md-on-primary'
            : 'bg-md-secondary-container text-md-on-secondary-container'}"
          onclick={async () => {
            const previous = densityLocal;
            densityLocal = 'expanded';
            try {
              await writeWithRetry({ uiDensity: 'expanded' });
            } catch (error) {
              densityLocal = previous;
              logError('Failed to save density preference', error);
              toastStore.error($t('toasts.settingsSaveFailed'));
            }
          }}
        >{$t('preferences.densityExpanded')}</button>
        <button
          type="button"
          class="px-3 py-2 text-xs rounded-lg font-semibold transition-colors {densityLocal === 'minimised'
            ? 'bg-md-primary text-md-on-primary'
            : 'bg-md-secondary-container text-md-on-secondary-container'}"
          onclick={async () => {
            const previous = densityLocal;
            densityLocal = 'minimised';
            try {
              await writeWithRetry({ uiDensity: 'minimised' });
            } catch (error) {
              densityLocal = previous;
              logError('Failed to save density preference', error);
              toastStore.error($t('toasts.settingsSaveFailed'));
            }
          }}
        >{$t('preferences.densityMinimised')}</button>
      </div>
      {/snippet}
    </SettingCard>
    <SettingCard
      variant="row"
      id="setting-sidebar-position"
      title={$t('preferences.sidebarPosition')}
      description={$t('preferences.sidebarPositionDescription')}
    >
      {#snippet action()}
        <div class="flex items-center gap-1 shrink-0">
          <button
            type="button"
            class="px-3 py-2 text-xs rounded-lg font-semibold transition-colors {sidebarPositionLocal === 'left'
              ? 'bg-md-primary text-md-on-primary'
              : 'bg-md-secondary-container text-md-on-secondary-container'}"
            aria-pressed={sidebarPositionLocal === 'left'}
            onclick={() => void saveSidebarPosition('left')}
          >{$t('preferences.sidebarPositionLeft')}</button>
          <button
            type="button"
            class="px-3 py-2 text-xs rounded-lg font-semibold transition-colors {sidebarPositionLocal === 'right'
              ? 'bg-md-primary text-md-on-primary'
              : 'bg-md-secondary-container text-md-on-secondary-container'}"
            aria-pressed={sidebarPositionLocal === 'right'}
            onclick={() => void saveSidebarPosition('right')}
          >{$t('preferences.sidebarPositionRight')}</button>
        </div>
      {/snippet}
    </SettingCard>
  </section>

  <!-- ── Mail Provider ── -->
  <section id="settings-section-mail" data-settings-section="mail" class="space-y-2 scroll-mt-2">
    <div class="flex items-center gap-2 mb-1">
      <Icon name="mail" class="w-4 h-4 text-md-primary" />
      <span class="text-sm font-medium text-md-on-surface">{$t('preferences.sectionMailbox')}</span>
    </div>

    <!-- Mail Provider nav card -->
    <button
      id="setting-providers"
      class="md-action bg-md-surface-container-low rounded-xl px-3 py-3 w-full text-start transition-colors border border-md-outline-variant/20"
      onclick={onNavigateToMailProvider}
    >
      <div class="flex items-center justify-between">
        <div>
          <div class="text-sm font-medium text-md-on-surface">{$t('preferences.mailProviderSettings')}</div>
          <div class="text-xs text-md-on-surface/50 mt-0.5">{$t('preferences.mailProviderDescription')}</div>
        </div>
        <Icon name="chevronRight" class="w-4 h-4 text-md-primary/70 rtl-flip" />
      </div>
    </button>

    <!-- Auto-Copy (moved from General) -->
    <SettingCard
      variant="row"
      id="setting-autocopy"
      title={$t('settings.autoCopy')}
      description={$t('settings.autoCopyDescription')}
    >
      {#snippet action()}
        <Toggle
          checked={autoCopy}
          ariaLabel={$t('preferences.toggleAutoCopy')}
          onChange={(next) => {
            onSetAutoCopy?.(next);
            onSaveSettings();
          }}
        />
      {/snippet}
    </SettingCard>

    <!-- Inbox behaviour (moved from Mail Provider page) -->
    <SettingCard
      variant="row"
      title={$t('mailProvider.addressBehaviour')}
      titleClass="text-xs font-medium text-md-on-surface/60"
      class="space-y-3"
    >
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-sm font-medium text-md-on-surface">{$t('mailProvider.autoRenew')}</div>
          <div class="text-xs text-md-on-surface/50">{$t('mailProvider.autoRenewDescription')}</div>
        </div>
        <Toggle
          checked={autoRenew}
          ariaLabel={$t('mailProvider.autoRenew')}
          onChange={(next) => {
            handleAutoRenewToggle(next);
          }}
        />
      </div>
      <div class="h-px bg-md-outline-variant/20"></div>
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-sm font-medium text-md-on-surface">{$t('preferences.renewalFailurePolicy')}</div>
          <div class="text-xs text-md-on-surface/50">{$t('preferences.renewalFailurePolicyDescription')}</div>
        </div>
        <Dropdown
          class="shrink-0 max-w-[48%]"
          variant="outlined"
          size="xs"
          ariaLabel={$t('preferences.renewalFailurePolicy')}
          value={renewalFailurePolicy}
          onchange={(v) => {
            const next = v === 'archive' ? 'archive' : 'retry';
            const previous = renewalFailurePolicy;
            renewalFailurePolicy = next;
            void writeWithRetry({ renewalFailurePolicy: next }).catch((error) => {
              renewalFailurePolicy = previous;
              logError('Failed to save renewal failure policy', error);
              toastStore.error($t('toasts.settingsSaveFailed'));
            });
          }}
          options={[
            { value: 'retry', label: $t('preferences.renewalFailurePolicyRetry') },
            { value: 'archive', label: $t('preferences.renewalFailurePolicyArchive') },
          ]}
        />
      </div>
      <div class="h-px bg-md-outline-variant/20"></div>
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-sm font-medium text-md-on-surface">{$t('mailProvider.autoRenewScope')}</div>
          <div class="text-xs text-md-on-surface/50">
            {autoRenewScope === 'all'
              ? $t('mailProvider.autoRenewScopeAllHint')
              : $t('mailProvider.autoRenewScopeNewHint')}
          </div>
        </div>
        <Dropdown
          class="shrink-0 max-w-[48%]"
          variant="outlined"
          size="xs"
          ariaLabel={$t('mailProvider.autoRenewScope')}
          value={autoRenewScope}
          onchange={(v) => {
            const next = v === 'all' ? 'all' : v === 'new' ? 'new' : 'ask';
            onSetAutoRenewScope?.(next);
            onSaveAutoRenewScope?.();
          }}
          options={[
            { value: 'all', label: $t('mailProvider.autoRenewScopeAll') },
            { value: 'new', label: $t('mailProvider.autoRenewScopeNew') },
            { value: 'ask', label: $t('mailProvider.autoRenewScopeAsk') },
          ]}
        />
      </div>
      {#if autoRenewScope !== 'all'}
        <div class="h-px bg-md-outline-variant/20"></div>
        <Btn
          variant="outline"
          size="sm"
          class="w-full"
          aria-label={$t('mailProvider.autoRenewApplyNow')}
          onclick={() => onApplyAutoRenewToAll?.(autoRenew)}
        >{$t('mailProvider.autoRenewApplyNow')}</Btn>
      {/if}
      <div class="h-px bg-md-outline-variant/20"></div>
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-sm font-medium text-md-on-surface">{$t('mailProvider.autoRenewWindow')}</div>
          <div class="text-xs text-md-on-surface/50">{$t('mailProvider.autoRenewWindowDescription')}</div>
        </div>
        <div class="flex items-center gap-3 shrink-0">
          <span class="text-xs font-semibold text-md-on-surface-variant tabular-nums w-14 text-right">
            {$t('mailProvider.minutesShort', { values: { n: autoRenewWindowMinutes } })}
          </span>
          <input
            type="range"
            min="1"
            max="30"
            step="1"
            value={autoRenewWindowMinutes}
            aria-label={$t('mailProvider.autoRenewWindow')}
            class="w-28 accent-md-primary"
            oninput={(e) => {
              const v = Number((e.currentTarget as HTMLInputElement).value);
              onSetAutoRenewWindowMinutes?.(v);
              onSaveSettings();
            }}
          />
        </div>
      </div>
      <div class="h-px bg-md-outline-variant/20"></div>
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-sm font-medium text-md-on-surface">{$t('preferences.expiryAction')}</div>
          <div class="text-xs text-md-on-surface/50">{$t('preferences.expiryActionDescription')}</div>
        </div>
        <Dropdown
          class="shrink-0 max-w-[48%]"
          variant="outlined"
          size="xs"
          ariaLabel={$t('preferences.expiryAction')}
          value={expiryAction}
          onchange={(v) => {
            const next = v === 'delete' ? 'delete' : 'archive';
            const previous = expiryAction;
            expiryAction = next;
            void writeWithRetry({ expiryAction: next }).catch((error) => {
              expiryAction = previous;
              logError('Failed to save expiry action preference', error);
              toastStore.error($t('toasts.settingsSaveFailed'));
            });
          }}
          options={[
            { value: 'archive', label: $t('preferences.expiryActionArchive') },
            { value: 'delete', label: $t('preferences.expiryActionDelete') },
          ]}
        />
      </div>
      <div class="h-px bg-md-outline-variant/20"></div>
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-sm font-medium text-md-on-surface">{$t('mailProvider.autoRefreshInterval')}</div>
          <div class="text-xs text-md-on-surface/50">{$t('mailProvider.autoRefreshDescription')}</div>
        </div>
        <Dropdown
          class="shrink-0"
          variant="outlined"
          size="xs"
          ariaLabel={$t('mailProvider.autoRefreshInterval')}
          value={autoRefreshInterval}
          onchange={(v) => {
            onSetAutoRefreshInterval?.(Number(v));
            onSaveSettings();
          }}
          options={[
            { value: 0, label: $t('mailProvider.manualOnly') },
            { value: 10000, label: $t('mailProvider.tenSeconds') },
            { value: 30000, label: $t('mailProvider.thirtySeconds') },
            { value: 60000, label: $t('mailProvider.oneMinute') },
            { value: 120000, label: $t('mailProvider.twoMinutes') },
            { value: 300000, label: $t('mailProvider.fiveMinutes') },
            { value: 600000, label: $t('mailProvider.tenMinutes') },
          ]}
        />
      </div>
      <div class="h-px bg-md-outline-variant/20"></div>
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-sm font-medium text-md-on-surface">{$t('mailProvider.emailPreviewStyle')}</div>
          <div class="text-xs text-md-on-surface/50">{$t('mailProvider.emailPreviewStyleDescription')}</div>
        </div>
        <Dropdown
          class="shrink-0 max-w-[48%]"
          variant="outlined"
          size="xs"
          ariaLabel={$t('mailProvider.emailPreviewStyle')}
          value={emailPreviewMode}
          onchange={(v) => {
            const next: EmailPreviewMode = v === 'expanded' ? 'expanded' : 'tooltip';
            emailPreviewMode = next;
            onSetEmailPreviewMode?.(next);
            onSaveSettings();
          }}
          options={[
            { value: 'tooltip', label: $t('mailProvider.emailPreviewModeTooltip') },
            { value: 'expanded', label: $t('mailProvider.emailPreviewModeExpanded') },
          ]}
        />
      </div>
    </SettingCard>

    <!-- Mailbox Automations (Behaviors) -->
    <SettingCard
      variant="row"
      id="setting-mailbox-automations"
      data-search-alias="automations behaviour auto-archive otp read marketing promo delete 24h rules"
      title={$t('automation.behaviourTitle')}
      titleClass="text-xs font-medium text-md-on-surface/60"
      class="space-y-3"
    >
      {#snippet action()}
        <button
          type="button"
          class="text-xs font-semibold text-md-primary hover:underline flex items-center gap-1 cursor-pointer bg-transparent border-0 p-0"
          onclick={onNavigateToAutomation}
        >
          <span>{$t('nav.automation')}</span>
          <Icon name="chevronRight" class="w-3 h-3 rtl-flip" />
        </button>
      {/snippet}

      <!-- Auto-Archive on OTP copy -->
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-sm font-medium text-md-on-surface">{$t('automation.autoArchiveOnCopyOtp')}</div>
          <div class="text-xs text-md-on-surface/50">{$t('automation.autoArchiveOnCopyOtpHint')}</div>
        </div>
        <Toggle
          checked={automationRules.autoArchiveOnCopyOtp}
          ariaLabel={$t('automation.autoArchiveOnCopyOtp')}
          onChange={(next) => void saveAutomationRule('autoArchiveOnCopyOtp', next)}
        />
      </div>

      <div class="h-px bg-md-outline-variant/20"></div>

      <!-- Auto-Archive on Read -->
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-sm font-medium text-md-on-surface">{$t('automation.autoArchiveOnRead')}</div>
          <div class="text-xs text-md-on-surface/50">{$t('automation.autoArchiveOnReadHint')}</div>
        </div>
        <Toggle
          checked={automationRules.autoArchiveOnRead}
          ariaLabel={$t('automation.autoArchiveOnRead')}
          onChange={(next) => void saveAutomationRule('autoArchiveOnRead', next)}
        />
      </div>

      <div class="h-px bg-md-outline-variant/20"></div>

      <!-- Auto-Delete Marketing/Promo (24h) -->
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-sm font-medium text-md-on-surface">{$t('automation.autoDeletePromo24h')}</div>
          <div class="text-xs text-md-on-surface/50">{$t('automation.autoDeletePromo24hHint')}</div>
        </div>
        <Toggle
          checked={automationRules.autoDeletePromo24h}
          ariaLabel={$t('automation.autoDeletePromo24h')}
          onChange={(next) => void saveAutomationRule('autoDeletePromo24h', next)}
        />
      </div>
    </SettingCard>

    <VerificationSettings />

    <!-- OTP detection engine (local algorithm vs AI); strictness options live under the local algorithm -->
    <SettingCard
      variant="row"
      title={$t('preferences.otpDetectionProvider')}
      description={$t('preferences.otpDetectionProviderHint')}
      descriptionClass="ui-support text-md-on-surface-variant mt-2"
      class="space-y-2"
    >
      <div class="flex items-stretch rounded-xl border border-md-outline-variant/40 overflow-hidden">
        <button
          type="button"
          class="flex-1 px-2 py-2 ui-label bg-md-surface text-md-on-surface transition-colors {controlSurface(otpDetectionProvider === 'algorithm')}"
          aria-pressed={otpDetectionProvider === 'algorithm'}
          onclick={() => {
            const previous = otpDetectionProvider;
            otpDetectionProvider = 'algorithm';
            void writeWithRetry({ otpDetectionProvider: 'algorithm' }).catch((error) => {
              otpDetectionProvider = previous;
              logError('Failed to save OTP detection provider preference', error);
              toastStore.error($t('toasts.settingsSaveFailed'));
            });
          }}
        >{$t('preferences.otpProviderAlgorithm')}</button>
        <span class="w-px bg-md-outline-variant/50 shrink-0" aria-hidden="true"></span>
        <button
          type="button"
          class="flex-1 px-2 py-2 ui-label bg-md-surface text-md-on-surface transition-colors {controlSurface(otpDetectionProvider === 'ai')}"
          aria-pressed={otpDetectionProvider === 'ai'}
          onclick={() => {
            const previous = otpDetectionProvider;
            otpDetectionProvider = 'ai';
            void writeWithRetry({ otpDetectionProvider: 'ai' }).catch((error) => {
              otpDetectionProvider = previous;
              logError('Failed to save OTP detection provider preference', error);
              toastStore.error($t('toasts.settingsSaveFailed'));
            });
            if (!aiApiKey.trim()) toastStore.warning($t('preferences.aiNotConfigured'));
          }}
        >{$t('preferences.otpProviderAi')}</button>
      </div>
      {#if otpDetectionProvider === 'algorithm'}
        <div class="pt-1">
          <div class="text-xs font-medium text-md-on-surface/80 mb-1">{$t('preferences.otpDetectionMode')}</div>
          <p class="ui-support text-md-on-surface-variant mb-2">{$t('preferences.otpDetectionModeHint')}</p>
          <div class="flex flex-col gap-1">
            {#each [
              ['numeric', 'preferences.otpModeNumeric', 'preferences.otpModeNumericHint'],
              ['balanced', 'preferences.otpModeBalanced', 'preferences.otpModeBalancedHint'],
              ['alphanumeric', 'preferences.otpModeAlphanumeric', 'preferences.otpModeAlphanumericHint'],
            ] as [mode, labelKey, hintKey] (mode)}
              {@const chosen = otpDetectionMode === mode}
              <button
                type="button"
                class="w-full text-start px-3 py-2 rounded-xl border border-md-outline-variant/40 bg-md-surface transition-colors {controlSurface(
                  otpDetectionMode === mode
                )}"
                onclick={() => {
                  const previous = otpDetectionMode;
                  otpDetectionMode = mode as typeof otpDetectionMode;
                  void writeWithRetry({ otpDetectionMode: mode }).catch((error) => {
                    otpDetectionMode = previous;
                    logError('Failed to save OTP detection mode preference', error);
                    toastStore.error($t('toasts.settingsSaveFailed'));
                  });
                }}
              >
                <div class="text-xs font-medium {chosen ? CONTROL_INK_SELECTED : 'text-md-on-surface'}">
                  {$t(labelKey)}
                </div>
                <div class="text-xs {chosen ? CONTROL_INK_SELECTED : 'text-md-on-surface/50'}">
                  {$t(hintKey)}
                </div>
              </button>
            {/each}
          </div>
        </div>
      {:else if otpDetectionProvider === 'ai'}
        <div class="space-y-2 pt-1">
          <p class="text-sm text-md-on-surface-variant">{$t('preferences.aiPrivacyWarning')}</p>
          <label class="block">
            <span class="text-xs font-medium text-md-on-surface/80 block mb-1">{$t('preferences.aiBaseUrl')}</span>
            <input
              type="url"
              class="w-full px-3 py-1.5 text-xs rounded-lg border border-md-outline-variant/40 bg-md-surface text-md-on-surface placeholder:text-md-on-surface/30 focus:border-md-primary focus:outline-none"
              value={aiBaseUrl}
              placeholder={$t('preferences.aiBaseUrlPlaceholder')}
              oninput={(e) => (aiBaseUrl = e.currentTarget.value)}
              onchange={() => void persistAiConfig()}
            />
          </label>
          <label class="block">
            <span class="text-xs font-medium text-md-on-surface/80 block mb-1">{$t('preferences.aiApiKey')}</span>
            <input
              type="password"
              class="w-full px-3 py-1.5 text-xs rounded-lg border border-md-outline-variant/40 bg-md-surface text-md-on-surface placeholder:text-md-on-surface/30 focus:border-md-primary focus:outline-none"
              value={aiApiKey}
              placeholder={$t('preferences.aiApiKeyPlaceholder')}
              oninput={(e) => {
                aiApiKey = e.currentTarget.value;
                aiApiKeyUnavailable = false;
              }}
              onchange={() => void persistAiConfig()}
            />
          </label>
          <label class="block">
            <span class="text-xs font-medium text-md-on-surface/80 block mb-1">{$t('preferences.aiModel')}</span>
            <input
              type="text"
              class="w-full px-3 py-1.5 text-xs rounded-lg border border-md-outline-variant/40 bg-md-surface text-md-on-surface placeholder:text-md-on-surface/30 focus:border-md-primary focus:outline-none"
              value={aiModel}
              placeholder={$t('preferences.aiModelPlaceholder')}
              oninput={(e) => (aiModel = e.currentTarget.value)}
              onchange={() => void persistAiConfig()}
            />
          </label>
          <div class="space-y-1.5 pt-1">
            <div class="flex flex-nowrap gap-3 w-full" use:responsiveButtonLayout data-action-tier="S">
              <Btn variant="outline" size="md" disabled={aiTestState === 'testing'} onclick={() => void runAiTest()}>
                <span class="btn-label">{aiTestState === 'testing' ? $t('preferences.aiTesting') : $t('preferences.aiTestConnection')}</span>
              </Btn>
              <Btn variant="outline" size="md" disabled={aiRescanState === 'running'} onclick={() => void runStoredRescan()}>
                <span class="btn-label">{aiRescanState === 'running'
                  ? aiRescanProgress
                    ? $t('preferences.aiRescanProgress', {
                        values: {
                          done: String(aiRescanProgress.done),
                          total: String(aiRescanProgress.total),
                        },
                      })
                    : $t('preferences.aiRescanRunning')
                  : $t('preferences.aiRescanStored')}</span>
              </Btn>
              <Btn variant="outline" size="md" disabled={aiClearCacheState === 'running'} onclick={() => void runAiClearCache()}>
                <span class="btn-label">{aiClearCacheState === 'running' ? $t('preferences.aiClearCacheRunning') : $t('preferences.aiClearCache')}</span>
              </Btn>
            </div>
            {#if aiTestState === 'ok'}
              <span class="block text-xs font-medium text-md-primary">{$t('preferences.aiTestSuccess')}</span>
            {:else if aiTestState === 'fail'}
              <span class="block text-xs text-md-error truncate" title={aiTestError}>
                {$t('preferences.aiTestFailed', { values: { error: aiTestError } })}
              </span>
            {/if}
          </div>
          {#if aiRescanState === 'running'}
            <div class="pt-2">
              <ProgressBar
                size="sm"
                value={aiRescanProgress && aiRescanProgress.total > 0 ? (aiRescanProgress.done / aiRescanProgress.total) * 100 : undefined}
                indeterminate={!aiRescanProgress || aiRescanProgress.total === 0}
                showValue
              />
            </div>
          {/if}
        </div>
      {/if}
    </SettingCard>

    <!-- HTML Element Rendering (moved from General) -->
    <SettingCard
      variant="row"
      id="setting-subpage-html"
      data-search-alias="html element rendering tags img style table svg audio video iframe object form sanitize"
    >
      <button
        type="button"
        class="w-full flex items-center justify-between text-start"
        onclick={() => { activeSettingsSubpage = 'htmlRendering'; }}
      >
        <div>
          <div class="text-sm font-medium text-md-on-surface">{$t('settings.htmlRenderingTitle')}</div>
          <p class="ui-support text-md-on-surface-variant">{$t('settings.htmlRenderingSubtitle')}</p>
        </div>
        <Icon name="chevronRight" class="w-4 h-4 text-md-on-surface/50 shrink-0" />
      </button>
    </SettingCard>

    <!-- Show Images in Email Body (moved from General) -->
    <SettingCard
      variant="row"
      id="setting-show-images"
      title={$t('preferences.showImages')}
      description={$t('preferences.showImagesDescription')}
    >
      {#snippet action()}
        <Toggle
          checked={showImages}
          ariaLabel={$t('preferences.showImages')}
          onChange={async (next) => {
            const previous = showImages;
            showImages = next;
            try {
              await writeWithRetry({ showImages: next });
            } catch (error) {
              showImages = previous;
              logError('Failed to save show images preference', error);
              toastStore.error($t('toasts.settingsSaveFailed'));
            }
            onSaveSettings();
          }}
        />
      {/snippet}
    </SettingCard>

    <!-- Tag / Labels / Filters / Mailbox management live under More nav (not Settings) -->
  </section>

  <!-- ── Notification & Feedback ── -->
  <section id="settings-section-notifications" data-settings-section="notifications" class="space-y-2 scroll-mt-2">
    <div class="flex items-center gap-2 mb-1">
      <Icon name="notifications" class="w-4 h-4 text-md-primary" />
      <span class="text-sm font-medium text-md-on-surface">{$t('preferences.sectionNotifications')}</span>
    </div>

    <!-- Toast notifications master switch -->
    <SettingCard
      variant="row"
      title={$t('preferences.toastsEnabled')}
      description={$t('preferences.toastsEnabledDescription')}
    >
      {#snippet action()}
        <Toggle
          checked={toastsEnabled}
          ariaLabel={$t('preferences.toastsEnabled')}
          onChange={async (next) => {
            const previous = toastsEnabled;
            toastsEnabled = next;
            toastStore.setEnabled(next);
            try {
              await writeWithRetry({ toastsEnabled: next });
            } catch (error) {
              toastsEnabled = previous;
              toastStore.setEnabled(previous);
              logError('Failed to save toast preference', error);
              toastStore.error($t('toasts.settingsSaveFailed'));
            }
          }}
        />
      {/snippet}
    </SettingCard>

    <!-- OS notifications (moved from Mailbox) -->
    <SettingCard
      variant="row"
      title={$t('mailProvider.notifications')}
      titleClass="text-xs font-medium text-md-on-surface/60"
      class="space-y-3"
    >
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-sm text-md-on-surface">{$t('mailProvider.enableNotifications')}</div>
          <div class="text-xs text-md-on-surface/50">{$t('mailProvider.enableNotificationsDescription')}</div>
        </div>
        <Toggle
          checked={notificationsEnabled}
          ariaLabel={$t('mailProvider.enableNotifications')}
          onChange={(next) => {
            onSetNotificationsEnabled?.(next);
            onSaveSettings();
          }}
        />
      </div>
      <div class="h-px bg-md-outline-variant/20"></div>
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-sm text-md-on-surface">{$t('mailProvider.notificationSound')}</div>
          <div class="text-xs text-md-on-surface/50">{$t('mailProvider.notificationSoundDescription')}</div>
        </div>
        <Toggle
          checked={soundEnabled}
          ariaLabel={$t('mailProvider.notificationSound')}
          onChange={(next) => {
            onSetSoundEnabled?.(next);
            onSaveSettings();
          }}
        />
      </div>
      <div class="h-px bg-md-outline-variant/20"></div>
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-sm text-md-on-surface">{$t('mailProvider.expiryWarning')}</div>
          <div class="text-xs text-md-on-surface/50">{$t('mailProvider.expiryWarningDescription')}</div>
        </div>
        <Dropdown
          class="shrink-0"
          variant="secondary"
          size="xs"
          ariaLabel={$t('mailProvider.expiryWarning')}
          value={expiryWarningThreshold}
          onchange={(v) => {
            onSetExpiryWarningThreshold?.(Number(v));
            onSaveSettings();
          }}
          options={[
            { value: 15 * 60 * 1000, label: $t('mailProvider.fifteenMinutes') },
            { value: 5 * 60 * 1000, label: $t('mailProvider.fiveMinutesShort') },
            { value: 60 * 1000, label: $t('mailProvider.oneMinuteShort') },
            { value: 60 * 60 * 1000, label: $t('mailProvider.oneHour') },
          ]}
        />
      </div>
      <div class="h-px bg-md-outline-variant/20"></div>
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-sm text-md-on-surface">{$t('preferences.testNotificationTitle')}</div>
          {#if notificationsBlocked && testNotifyResult}
            <button
              type="button"
              aria-live="polite"
              class="text-xs font-semibold text-md-error underline underline-offset-2 hover:text-md-error/80 transition-colors"
              onclick={() => void handleOpenNotificationSettings()}
            >
              {testNotifyResult}
            </button>
          {:else}
            <div class="text-xs text-md-on-surface/50" aria-live="polite">
              {testNotifyResult || $t('preferences.testNotificationHint')}
            </div>
          {/if}
        </div>
        <button
          type="button"
          class="md-action shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg bg-md-secondary-container text-md-on-secondary-container transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          onclick={() => void sendTestNotification()}
          disabled={testNotifyBusy}
        >
          {testNotifyBusy ? $t('common.loading') : $t('preferences.sendTestNotification')}
        </button>
      </div>
    </SettingCard>

    <!-- Smart notifications (moved from General) -->
    <SettingCard
      variant="row"
      title={$t('intelligence.notificationsTitle')}
      description={$t('intelligence.notificationsHint')}
      descriptionClass="ui-support text-md-on-surface-variant mt-2"
      class="space-y-2"
    >
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs text-md-on-surface">{$t('intelligence.otpAndMagicOnly')}</span>
        <Toggle
          checked={notifIntel.otpAndMagicOnly}
          ariaLabel={$t('intelligence.otpAndMagicOnly')}
          onChange={(next) => {
            notifIntel = { ...notifIntel, otpAndMagicOnly: next };
            void persistNotifIntel();
          }}
        />
      </div>
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs text-md-on-surface">{$t('intelligence.groupDigest')}</span>
        <Toggle
          checked={notifIntel.groupDigest}
          ariaLabel={$t('intelligence.groupDigest')}
          onChange={(next) => {
            notifIntel = { ...notifIntel, groupDigest: next };
            void persistNotifIntel();
          }}
        />
      </div>
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs text-md-on-surface">{$t('intelligence.quietHours')}</span>
        <Toggle
          checked={notifIntel.quietHoursEnabled}
          ariaLabel={$t('intelligence.quietHours')}
          onChange={(next) => {
            notifIntel = { ...notifIntel, quietHoursEnabled: next };
            void persistNotifIntel();
          }}
        />
      </div>
      {#if notifIntel.quietHoursEnabled}
        <div class="flex items-center gap-2 text-xs">
          <label class="flex items-center gap-1">
            {$t('intelligence.quietFrom')}
            <input
              type="number"
              min="0"
              max="23"
              class="w-12 px-1 py-0.5 rounded-lg bg-md-surface border border-md-outline-variant/40"
              value={notifIntel.quietHoursStart}
              onchange={(e) => {
                notifIntel = {
                  ...notifIntel,
                  quietHoursStart: Math.max(
                    0,
                    Math.min(23, Number((e.target as HTMLInputElement).value) || 0)
                  ),
                };
                void persistNotifIntel();
              }}
            />
          </label>
          <label class="flex items-center gap-1">
            {$t('intelligence.quietTo')}
            <input
              type="number"
              min="0"
              max="23"
              class="w-12 px-1 py-0.5 rounded-lg bg-md-surface border border-md-outline-variant/40"
              value={notifIntel.quietHoursEnd}
              onchange={(e) => {
                notifIntel = {
                  ...notifIntel,
                  quietHoursEnd: Math.max(
                    0,
                    Math.min(23, Number((e.target as HTMLInputElement).value) || 0)
                  ),
                };
                void persistNotifIntel();
              }}
            />
          </label>
        </div>
      {/if}
      <div>
        <label class="dialog-field-label" for="muted-sender-domains">
          {$t('intelligence.mutedSenders')}
        </label>
        <input
          id="muted-sender-domains"
          type="text"
          class="w-full mt-0.5 px-2 py-1.5 text-xs rounded-lg bg-md-surface border border-md-outline-variant/40"
          placeholder="newsletter.com, marketing.io"
          bind:value={mutedDomainsText}
          onchange={() => void persistNotifIntel()}
        />
      </div>
    </SettingCard>
  </section>

  <!-- ── Autofill ── -->
  <section id="settings-section-autofill" data-settings-section="autofill" class="space-y-2 scroll-mt-2">
    <div class="flex items-center gap-2 mb-1">
      <Icon name="lock" class="w-4 h-4 text-md-primary" />
      <span class="text-sm font-medium text-md-on-surface">{$t('preferences.sectionAutofill')}</span>
    </div>

    <!-- Default Identity for Autofill -->
    <SettingCard
      variant="row"
      id="setting-identities"
      title={$t('preferences.defaultForAutofill')}
      class="space-y-2"
    >
      <Dropdown
        variant="outlined"
        value={selectedIdentityId ?? ''}
        placeholder={$t('preferences.noIdentities')}
        ariaLabel={$t('preferences.selectDefaultIdentity')}
        disabled={identities.length === 0}
        options={[
          { value: '', label: $t('preferences.none') },
          ...identities.map((i) => ({ value: i.id, label: i.name })),
          { value: CREATE_NEW_IDENTITY, label: $t('preferences.createNewIdentity') },
        ]}
        onchange={(v) => {
          if (v === CREATE_NEW_IDENTITY) {
            // Reset selection so the dropdown stays on the current default.
            onSetSelectedIdentityId?.(selectedIdentityId ?? null);
            onCreateIdentity?.();
            return;
          }
          onSetSelectedIdentityId?.(v === '' ? null : (v as string));
        }}
      />
      <Btn
        variant="secondary"
        size="sm"
        class="w-full"
        onclick={onNavigateToIdentities}
      >
        {$t('preferences.viewAllIdentities')}
      </Btn>
    </SettingCard>

    <!-- Saved-login pick preference for autofill (per domain) -->
    <SettingCard
      variant="row"
      title={$t('preferences.autofillLoginPreference')}
      description={$t('preferences.autofillLoginPreferenceHint')}
      descriptionClass="ui-support text-md-on-surface-variant mt-2"
      class="space-y-2"
    >
      <div class="flex items-stretch rounded-xl border border-md-outline-variant/40 overflow-hidden">
        <button
          type="button"
          class="flex-1 px-2 py-2 ui-label bg-md-surface text-md-on-surface transition-colors {controlSurface(autofillLoginPreference === 'recent')}"
          aria-pressed={autofillLoginPreference === 'recent'}
          onclick={() => {
            const previous = autofillLoginPreference;
            autofillLoginPreference = 'recent';
            void writeWithRetry({ autofillLoginPreference: 'recent' }).catch((error) => {
              autofillLoginPreference = previous;
              logError('Failed to save autofill login preference', error);
              toastStore.error($t('toasts.settingsSaveFailed'));
            });
          }}
        >{$t('preferences.autofillLoginRecent')}</button>
        <span class="w-px bg-md-outline-variant/50 shrink-0" aria-hidden="true"></span>
        <button
          type="button"
          class="flex-1 px-2 py-2 ui-label bg-md-surface text-md-on-surface transition-colors {controlSurface(autofillLoginPreference === 'listOrder')}"
          aria-pressed={autofillLoginPreference === 'listOrder'}
          onclick={() => {
            const previous = autofillLoginPreference;
            autofillLoginPreference = 'listOrder';
            void writeWithRetry({ autofillLoginPreference: 'listOrder' }).catch((error) => {
              autofillLoginPreference = previous;
              logError('Failed to save autofill login preference', error);
              toastStore.error($t('toasts.settingsSaveFailed'));
            });
          }}
        >{$t('preferences.autofillLoginListOrder')}</button>
      </div>
    </SettingCard>

    <!-- Master autofill on/off -->
    <SettingCard
      variant="row"
      title={$t('preferences.autofillFeature')}
      description={$t('preferences.autofillFeatureHint')}
      descriptionClass="ui-support text-md-on-surface-variant"
    >
      {#snippet action()}
        <Toggle
          checked={autofillFeatureEnabled}
          ariaLabel={$t('preferences.autofillFeature')}
          onChange={async (next) => {
            const previous = autofillFeatureEnabled;
            autofillFeatureEnabled = next;
            try {
              await writeWithRetry({ autofillFeatureEnabled: next });
            } catch (error) {
              autofillFeatureEnabled = previous;
              logError('Failed to save autofill feature preference', error);
              toastStore.error($t('toasts.settingsSaveFailed'));
              return;
            }
            toastStore.info(
              next
                ? $t('preferences.autofillFeatureEnabled')
                : $t('preferences.autofillFeatureDisabled')
            );
          }}
        />
      {/snippet}
    </SettingCard>

    <!-- Autofill options (disabled when master feature is off) -->
    <div class="space-y-2 {autofillFeatureEnabled ? '' : 'opacity-50 select-none'}" inert={!autofillFeatureEnabled}>

    <!-- Smart autofill: filling behavior -->
    <SettingCard
      variant="row"
      title={$t('settings.smartFillingTitle')}
      titleClass="text-xs font-medium text-md-on-surface/60"
      class="space-y-3"
    >
      <label class="flex items-center justify-between gap-3">
        <div>
          <span class="text-xs font-medium text-md-on-surface/80 block">{$t('settings.humanLikeFilling')}</span>
          <span class="text-xs text-md-on-surface-variant block">{$t('settings.humanLikeFillingDescription')}</span>
        </div>
        <Toggle
          checked={smartSettings.humanLikeFilling}
          ariaLabel={$t('settings.humanLikeFilling')}
          onChange={(v) => void updateSmartSetting({ humanLikeFilling: v, humanLikeTiming: v })}
        />
      </label>
      <div class="h-px bg-md-outline-variant/20"></div>
      <label class="flex items-center justify-between gap-3">
        <span class="text-xs text-md-on-surface/80">{$t('settings.humanLikeTiming')}</span>
        <Toggle
          checked={smartSettings.humanLikeTiming}
          ariaLabel={$t('settings.humanLikeTiming')}
          onChange={(v) => void updateSmartSetting({ humanLikeTiming: v })}
        />
      </label>
    </SettingCard>

    <!-- Smart autofill: submission -->
    <SettingCard
      variant="row"
      title={$t('settings.smartSubmitTitle')}
      titleClass="text-xs font-medium text-md-on-surface/60"
      class="space-y-3"
    >
      <label class="flex items-center justify-between gap-3">
        <div>
          <span class="text-xs font-medium text-md-on-surface/80 block">{$t('settings.autoClickSubmit')}</span>
          <span class="text-xs text-md-on-surface-variant block">{$t('settings.autoClickSubmitDesc')}</span>
        </div>
        <Toggle
          checked={smartSettings.autoClickSubmitButtons}
          ariaLabel={$t('settings.autoClickSubmit')}
          onChange={(v) => void updateSmartSetting({ autoClickSubmitButtons: v })}
        />
      </label>
    </SettingCard>

    <!-- Smart autofill: preview -->
    <SettingCard
      variant="row"
      title={$t('settings.smartPreviewTitle')}
      titleClass="text-xs font-medium text-md-on-surface/60"
      class="space-y-3"
    >
      <label class="flex items-center justify-between gap-3">
        <span class="text-xs text-md-on-surface/80">{$t('settings.dryRunPreview')}</span>
        <Toggle
          checked={smartSettings.dryRunPreview}
          ariaLabel={$t('settings.dryRunPreview')}
          onChange={(v) => void updateSmartSetting({ dryRunPreview: v })}
        />
      </label>
    </SettingCard>

    <!-- Smart autofill: data & OTP handling -->
    <SettingCard
      variant="row"
      title={$t('settings.smartDataTitle')}
      titleClass="text-xs font-medium text-md-on-surface/60"
      class="space-y-3"
    >
      <label class="flex items-center justify-between gap-3">
        <span class="text-xs text-md-on-surface/80">{$t('settings.smartOtpAttach')}</span>
        <Toggle
          checked={smartSettings.smartOtpAttach}
          ariaLabel={$t('settings.smartOtpAttach')}
          onChange={(v) => void updateSmartSetting({ smartOtpAttach: v })}
        />
      </label>
      <div class="h-px bg-md-outline-variant/20"></div>
      <label class="flex items-center justify-between gap-3">
        <span class="text-xs text-md-on-surface/80">{$t('settings.localeAwareData')}</span>
        <Toggle
          checked={smartSettings.localeAwareData}
          ariaLabel={$t('settings.localeAwareData')}
          onChange={(v) => void updateSmartSetting({ localeAwareData: v })}
        />
      </label>
    </SettingCard>

    <!-- Smart autofill: sites suggested for blocking from failed fills -->
    {#if blockSuggestions.length > 0}
      <SettingCard
        variant="row"
        title={$t('settings.smartBlockSuggestionsTitle')}
        titleClass="text-xs font-medium text-md-on-surface/60"
        description={$t('settings.blockSuggestionsTitle')}
        descriptionClass="text-xs text-md-on-surface/50 mb-1"
        class="space-y-1.5"
      >
        {#each blockSuggestions as domain (domain)}
          <div class="flex items-center gap-2 text-xs">
            <span class="flex-1 truncate font-medium">{domain}</span>
            <div class="flex flex-nowrap items-center gap-2 shrink-0" use:responsiveButtonLayout data-action-tier="XS">
              <button
                type="button"
                class="md-action h-8 rounded-md bg-md-secondary-container text-md-on-secondary-container font-bold disabled:opacity-50"
                disabled={processingDomain === domain}
                onclick={() => { processingDomain = domain; void acceptBlockSug(domain); }}
              ><span class="btn-label">{$t('settings.blockSuggestionsAccept')}</span></button>
              <button
                type="button"
                class="md-action h-8 rounded-md bg-md-surface-container-high text-md-on-surface font-bold disabled:opacity-50"
                disabled={processingDomain === domain}
                onclick={() => { processingDomain = domain; void dismissBlockSug(domain); }}
              ><span class="btn-label">{$t('settings.blockSuggestionsDismiss')}</span></button>
            </div>
          </div>
        {/each}
      </SettingCard>
    {/if}

    <SettingCard
      variant="row"
      title={$t('settings.autofillBlocklist')}
      titleClass="text-sm font-medium text-md-on-surface mb-1"
      description={$t('settings.autofillBlocklistDescription')}
      descriptionClass="text-xs text-md-on-surface/50 mb-2"
    >
      {#if onAddToBlocklist}
        <form
          class="flex gap-2 mb-2"
          onsubmit={(e) => {
            e.preventDefault();
            const domain = newBlocklistDomain
              .trim()
              .toLowerCase()
              .replace(/^https?:\/\//, '')
              .replace(/^www\./, '')
              .split('/')[0];
            if (!domain) return;
            void onAddToBlocklist(domain);
            newBlocklistDomain = '';
          }}
        >
          <input
            type="text"
            class="flex-1 min-w-0 px-3 py-1.5 text-xs rounded-lg border border-md-outline-variant/40 bg-md-surface text-md-on-surface"
            placeholder={$t('settings.blocklistDomainPlaceholder')}
            bind:value={newBlocklistDomain}
            aria-label={$t('settings.blocklistDomainPlaceholder')}
            list="blocklist-domain-suggestions"
          />
          <datalist id="blocklist-domain-suggestions">
            {#if currentTabDomain}
              <option value={currentTabDomain}></option>
            {/if}
          </datalist>
          <Btn
            type="submit"
            variant="primary"
            size="sm"
            class="shrink-0"
          >
            {$t('settings.addToBlocklist')}
          </Btn>
        </form>
        {#if currentTabDomain && !isBlockedByList(currentTabDomain, autofillBlocklist)}
          <button
            type="button"
            class="md-action mb-3 w-full text-start px-3 py-2 rounded-lg bg-md-secondary-container ui-label text-md-on-secondary-container flex items-center justify-between gap-2 transition-colors"
            onclick={() => {
              void (onToggleBlocklist ?? onAddToBlocklist)?.(currentTabDomain);
              newBlocklistDomain = '';
            }}
          >
            <span class="truncate">
              {$t('settings.blocklistSuggestCurrent', { values: { domain: currentTabDomain } })}
            </span>
            <span class="text-md-primary font-semibold shrink-0">{$t('settings.addToBlocklist')}</span>
          </button>
        {:else if currentTabDomain && isBlockedByList(currentTabDomain, autofillBlocklist)}
          <button
            type="button"
            class="md-action mb-3 w-full text-start px-3 py-2 rounded-lg bg-md-secondary-container ui-label text-md-on-secondary-container flex items-center justify-between gap-2 transition-colors"
            onclick={() => void (onToggleBlocklist ?? onRemoveFromBlocklist)?.(currentTabDomain)}
          >
            <span class="truncate">
              {$t('settings.blocklistSuggestCurrent', { values: { domain: currentTabDomain } })}
            </span>
            <span class="text-md-error font-semibold shrink-0">{$t('settings.removeFromBlocklist')}</span>
          </button>
        {/if}
      {/if}
      {#if autofillBlocklist.length === 0}
        <div class="text-sm text-md-on-surface/40 py-2">{$t('settings.autofillBlocklistEmpty')}</div>
        <div class="text-xs text-md-on-surface/30">{$t('settings.autofillBlocklistEmptyDescription')}</div>
      {:else}
        <div class="space-y-1">
          {#each autofillBlocklist as domain (domain)}
            <div class="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-md-secondary-container/50 active:bg-md-secondary-container/70 transition-colors">
              <span class="text-sm text-md-on-surface font-mono">{domain}</span>
              {#if onRemoveFromBlocklist}
                <button
                  class="md-action text-xs text-md-error px-2 py-0.5 rounded transition-colors"
                  onclick={() => onRemoveFromBlocklist(domain)}
                >
                  {$t('settings.removeFromBlocklist')}
                </button>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </SettingCard>

    <!-- Vault Protection & Security (autofill-related) -->
    <SettingCard
      variant="row"
      id="setting-vault-lock"
      title={$t('preferences.vaultProtection')}
      description={$t('preferences.vaultProtectionDescription')}
      class="space-y-2"
    >
      <div class="flex items-center gap-1.5 pt-1 flex-wrap">
        <button
          class="px-3 py-1.5 text-xs rounded-lg bg-md-secondary-container text-md-on-secondary-container transition-colors {controlSurface(vaultMode === 'standard')}"
          aria-pressed={vaultMode === 'standard'}
          onclick={() => handleSetVaultMode('standard')}
        >
          {$t('preferences.vaultStandard')}
        </button>
        <button
          class="px-3 py-1.5 text-xs rounded-lg bg-md-secondary-container text-md-on-secondary-container transition-colors {controlSurface(vaultMode === 'password')}"
          aria-pressed={vaultMode === 'password'}
          onclick={() => handleSetVaultMode('password')}
        >
          {$t('preferences.vaultMasterPassword')}
        </button>
        {#if biometricSupported}
          <button
            class="px-3 py-1.5 text-xs rounded-lg bg-md-secondary-container text-md-on-secondary-container transition-colors {controlSurface(vaultMode === 'biometrics')}"
            aria-pressed={vaultMode === 'biometrics'}
            onclick={() => handleSetVaultMode('biometrics')}
          >
            {$t('preferences.vaultBiometrics')}
          </button>
        {/if}
      </div>
      {#if vaultMode !== 'standard'}
        <div class="h-px bg-md-outline-variant/20 my-1"></div>
        <div class="flex items-center justify-between gap-2 pt-1">
          <div class="min-w-0">
            <div class="text-sm font-medium text-md-on-surface">{$t('preferences.vaultAutoLockTimeout')}</div>
            <div class="text-xs text-md-on-surface/50">{$t('preferences.vaultAutoLockTimeoutDescription')}</div>
          </div>
          <Dropdown
            class="shrink-0"
            variant="outlined"
            size="xs"
            ariaLabel={$t('preferences.vaultAutoLockTimeout')}
            value={vaultAutoLockTimeout}
            onchange={async (v) => {
              vaultAutoLockTimeout = v as VaultAutoLockTimeout;
              const config = await getVaultConfig();
              await saveVaultConfig({ ...config, autoLockTimeout: vaultAutoLockTimeout });
              toastStore.success($t('toasts.settingsSaved'));
            }}
            options={[
              { value: '5m', label: $t('preferences.vaultTimeout5m') },
              { value: '15m', label: $t('preferences.vaultTimeout15m') },
              { value: '30m', label: $t('preferences.vaultTimeout30m') },
              { value: '1h', label: $t('preferences.vaultTimeout1h') },
              { value: 'session', label: $t('preferences.vaultTimeoutSession') },
              { value: 'never', label: $t('preferences.vaultTimeoutNever') },
            ]}
          />
        </div>
        <div class="flex items-center gap-2 pt-1">
          <button
            class="md-action px-3 py-1.5 text-xs rounded-lg bg-md-secondary-container text-md-on-secondary-container transition-colors"
            onclick={handleRotateVaultKey}
          >
            {$t('preferences.vaultRotateKey')}
          </button>
          <span class="text-xs text-md-on-surface/50">{$t('preferences.vaultRotateKeyHint')}</span>
        </div>
      {/if}
    </SettingCard>
    </div><!-- /autofill options wrapper -->
  </section>

  <!-- ── Input & Navigation ── -->
  <section id="settings-section-inputNav" data-settings-section="inputNav" class="space-y-2 scroll-mt-2">
    <div class="flex items-center gap-2 mb-1">
      <Icon name="forward" class="w-4 h-4 text-md-primary rtl-flip" />
      <span class="text-sm font-medium text-md-on-surface">{$t('preferences.inputAndNavigation')}</span>
    </div>

    <!-- Gestures (hold-to-select, swipes) -->
    <SettingCard
      variant="row"
      title={$t('preferences.gesturesEnabled')}
      description={$t('preferences.gesturesEnabledHint')}
      descriptionClass="ui-support text-md-on-surface-variant"
    >
      {#snippet action()}
        <Toggle
          checked={gesturesEnabled}
          ariaLabel={$t('preferences.gesturesEnabled')}
          onChange={async (next) => {
            const previous = gesturesEnabled;
            gesturesEnabled = next;
            try {
              await writeWithRetry({ gesturesEnabled });
            } catch (error) {
              gesturesEnabled = previous;
              logError('Failed to save gestures preference', error);
              toastStore.error($t('toasts.settingsSaveFailed'));
            }
          }}
        />
      {/snippet}
    </SettingCard>

    <!-- Marquee (rubber-band) multi-select -->
    <SettingCard
      variant="row"
      title={$t('preferences.marqueeSelection')}
      description={$t('preferences.marqueeSelectionHint')}
      descriptionClass="ui-support text-md-on-surface-variant"
    >
      {#snippet action()}
        <Toggle
          checked={marqueeSelectionEnabled}
          ariaLabel={$t('preferences.marqueeSelection')}
          onChange={async (next) => {
            const previous = marqueeSelectionEnabled;
            marqueeSelectionEnabled = next;
            try {
              await setMarqueeSelectionEnabled(next);
            } catch (error) {
              marqueeSelectionEnabled = previous;
              logError('Failed to save marquee selection preference', error);
              toastStore.error($t('toasts.settingsSaveFailed'));
            }
          }}
        />
      {/snippet}
    </SettingCard>

    <!-- Keyboard Shortcuts nav card -->
    <button
      id="setting-keybindings"
      class="md-action bg-md-surface-container-low rounded-xl px-3 py-3 w-full text-start transition-colors border border-md-outline-variant/20"
      onclick={onNavigateToKeybindings}
    >
      <div class="flex items-center justify-between mb-2">
        <div class="text-sm font-medium text-md-on-surface">{$t('preferences.keyboardShortcuts')}</div>
        <div class="flex items-center gap-1 text-md-primary/70">
          {#if customKeybindingCount > 0}
            <span class="text-xs font-semibold text-md-primary bg-md-primary/15 px-1.5 py-0.5 rounded-full me-1">{$t('keyboardShortcuts.customCount', { values: { n: customKeybindingCount } })}</span>
          {/if}
          <Icon name="chevronRight" class="w-4 h-4 rtl-flip" />
        </div>
      </div>
      <div class="space-y-1 mb-1">
        {#each [{ k: 'refreshMailbox', label: $t('keyboardShortcuts.refreshMailbox') }, { k: 'createAddress', label: $t('keyboardShortcuts.createAddress') }, { k: 'copyEmail', label: $t('keyboardShortcuts.copyEmail') }] as row}
          <div class="flex items-center justify-between text-xs text-md-on-surface/60">
            <span>{row.label}</span>
            <span class="font-mono bg-md-secondary-container px-1.5 py-0.5 rounded text-md-on-secondary-container">{formatBinding(keybindings[row.k as keyof typeof keybindings])}</span>
          </div>
        {/each}
      </div>
    </button>

    <!-- Navigational Reorder Keyboard Shortcuts button -->
    <button
      id="setting-subpage-navbar"
      data-search-alias="navbar order navigation reorder items re-order shortcuts primary navigation"
      type="button"
      class="md-action w-full bg-md-surface-container-low rounded-xl px-3 py-3 text-start transition-colors border border-md-outline-variant/20 space-y-1.5"
      onclick={() => { activeSettingsSubpage = 'navbarOrder'; }}
    >
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          <Icon name="dragHandle" class="w-4 h-4 text-md-primary shrink-0" />
          <span class="text-sm font-medium text-md-on-surface truncate">{$t('navbarOrder.title')}</span>
        </div>
        <Icon name="chevronRight" class="w-4 h-4 rtl-flip" />
      </div>
      <p class="text-xs text-md-on-surface/50">{$t('navbarOrder.hint')}</p>
    </button>
  </section>

  <!-- ── Search ── -->
  <section id="settings-section-search" data-settings-section="search" class="space-y-2 scroll-mt-2">
    <div class="flex items-center gap-2 mb-1">
      <Icon name="search" class="w-4 h-4 text-md-primary" />
      <span class="text-sm font-medium text-md-on-surface">{$t('searchHistory.settingsTitle')}</span>
    </div>
    <SettingCard
      variant="row"
      title={$t('searchHistory.limitLabel')}
      description={$t('searchHistory.limitHint')}
    >
      {#snippet action()}
        <Dropdown
          class="shrink-0"
          variant="outlined"
          size="xs"
          ariaLabel={$t('searchHistory.limitLabel')}
          value={searchHistoryLimit}
          onchange={async (v) => {
            searchHistoryLimit = await setSearchHistoryLimit(Number(v));
          }}
          options={[3, 5, 8, 10, 15, 20].map((n) => ({ value: n, label: String(n) }))}
        />
      {/snippet}
    </SettingCard>
    <!-- Search slash icon visibility -->
    <SettingCard
      variant="row"
      id="setting-search-slash-icon"
      data-search-alias="slash operators shortcut search syntax button"
      title={$t('preferences.showSearchSlashIcon')}
      description={$t('preferences.showSearchSlashIconHint')}
      descriptionClass="ui-support text-md-on-surface-variant"
    >
      {#snippet action()}
        <Toggle
          checked={showSearchSlashIcon}
          ariaLabel={$t('preferences.showSearchSlashIcon')}
          onChange={async (next) => {
            const previous = showSearchSlashIcon;
            showSearchSlashIcon = next;
            try {
              await writeWithRetry({ showSearchSlashIcon: next });
            } catch (error) {
              showSearchSlashIcon = previous;
              logError('Failed to save search slash icon preference', error);
              toastStore.error($t('toasts.settingsSaveFailed'));
            }
          }}
        />
      {/snippet}
    </SettingCard>

    <!-- Voice search button visibility -->
    <SettingCard
      variant="row"
      id="setting-search-voice"
      data-search-alias="voice search microphone speech button"
      title={$t('preferences.voiceSearch')}
      description={$t('preferences.voiceSearchDescription')}
      descriptionClass="ui-support text-md-on-surface-variant"
    >
      {#snippet action()}
        <Toggle
          checked={voiceSearchEnabled}
          ariaLabel={$t('preferences.voiceSearch')}
          onChange={async (next) => {
            const previous = voiceSearchEnabled;
            voiceSearchEnabled = next;
            try {
              await writeWithRetry({ voiceSearchEnabled: next });
            } catch (error) {
              voiceSearchEnabled = previous;
              logError('Failed to save voice search preference', error);
              toastStore.error($t('toasts.settingsSaveFailed'));
            }
          }}
        />
      {/snippet}
    </SettingCard>

    <button
      id="setting-subpage-toolbar"
      data-search-alias="toolbar buttons action star archive delete download forward tag print mark unread show hide"
      type="button"
      class="md-action w-full bg-md-surface-container-low rounded-xl px-3 py-3 text-start transition-colors border border-md-outline-variant/20 space-y-1"
      onclick={() => { activeSettingsSubpage = 'toolbarButtons'; }}
    >
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          <Icon name="gridView" class="w-4 h-4 text-md-primary shrink-0" />
          <span class="text-sm font-medium text-md-on-surface truncate">{$t('settings.toolbarButtonsTitle')}</span>
        </div>
        <Icon name="chevronRight" class="w-4 h-4 rtl-flip" />
      </div>
      <p class="text-xs text-md-on-surface/50">{$t('settings.toolbarButtonsHint')}</p>
    </button>
  </section>

  <!-- ── Developer Settings ── -->
  <section id="settings-section-developer" data-settings-section="developer" class="space-y-2 scroll-mt-2">
    <div class="flex items-center gap-2 mb-1">
      <Icon name="monitor" class="w-4 h-4 text-md-primary" />
      <span class="text-sm font-medium text-md-on-surface">{$t('settings.developer')}</span>
    </div>

    <SettingCard
      variant="row"
      id="setting-developer"
      title={$t('preferences.showDeveloperOptions')}
      description={$t('preferences.showDeveloperOptionsDescription')}
    >
      {#snippet action()}
        <Toggle
          checked={showDeveloperSettings}
          ariaLabel={$t('preferences.toggleDeveloperSettings')}
          onChange={() => onToggleDeveloperSettings()}
        />
      {/snippet}
    </SettingCard>

    {#if showDeveloperSettings}
      <SettingCard
        variant="row"
        id="setting-logging"
        title={$t('preferences.enableLogging')}
        description={$t('preferences.enableLoggingDescription')}
      >
        {#snippet action()}
          <Toggle
            checked={enableLogging}
            ariaLabel={$t('preferences.toggleLogging')}
            onChange={() => onToggleEnableLogging()}
          />
        {/snippet}
      </SettingCard>

      <button
        id="setting-constants"
        type="button"
        class="md-action w-full flex items-center justify-between px-3 py-3 bg-md-surface-container rounded-xl transition-colors border border-md-outline-variant/30"
        onclick={onNavigateToConstantsSettings}
      >
        <div class="text-start">
          <div class="text-sm font-medium text-md-on-surface">{$t('settings.manageConstantOverrides')}</div>
          <div class="text-xs text-md-on-surface/50">{$t('settings.manageConstantOverridesDescription')}</div>
        </div>
        <Icon name="chevronRight" class="w-4 h-4 text-md-on-surface/60 rtl-flip" />
      </button>

      <button
        id="setting-playground"
        type="button"
        class="md-action w-full flex items-center justify-between px-3 py-3 bg-md-surface-container rounded-xl transition-colors border border-md-outline-variant/30"
        onclick={onOpenPlayground}
      >
        <div class="text-start">
          <div class="text-sm font-medium text-md-on-surface">{$t('playground.title')}</div>
          <div class="text-xs text-md-on-surface/50">{$t('playground.subtitle')}</div>
        </div>
        <Icon name="chevronRight" class="w-4 h-4 text-md-on-surface/60 rtl-flip" />
      </button>
    {/if}

    <!-- Demo mode -->
    <SettingCard
      variant="row"
      title={$t('preferences.demoMode')}
      description={$t('preferences.demoModeHint')}
      descriptionClass="ui-support text-md-on-surface-variant"
      class="space-y-2"
    >
      {#snippet action()}
        <Toggle
          checked={demoMode}
          ariaLabel={$t('preferences.demoMode')}
          onChange={async (on) => {
            demoMode = on;
            const { setDemoMode } = await import('@/features/demo/demo-mode.js');
            await setDemoMode(browser, on);
            try {
              await writeWithRetry({ demoMode: on });
            } catch {
              /* ignore */
            }
            if (on) {
              toastStore.success($t('preferences.demoModeEnabled'));
              // Product tour after demo loads (AppLayout listens for pendingProductTour)
              try {
                await writeWithRetry({
                  pendingProductTour: true,
                  pendingProductTourAt: Date.now(),
                });
              } catch {
                /* ignore */
              }
            } else {
              toastStore.info($t('preferences.demoModeDisabled'));
            }
          }}
        />
      {/snippet}
      {#if demoMode}
        <p class="ui-support text-md-on-surface-variant">{$t('preferences.demoTourHint')}</p>
        <button
          type="button"
          class="w-full py-2 rounded-xl text-xs font-semibold bg-md-secondary-container text-md-on-secondary-container"
          onclick={async () => {
            try {
              await writeWithRetry({
                pendingProductTour: true,
                pendingProductTourAt: Date.now(),
              });
              toastStore.info($t('preferences.demoTourStarting'));
            } catch {
              /* ignore */
            }
          }}
        >{$t('preferences.demoStartTour')}</button>
        <button
          type="button"
          class="w-full py-2 rounded-xl text-xs font-semibold bg-md-primary text-md-on-primary"
          onclick={async () => {
            const { simulateDemoReceive } = await import('@/features/demo/demo-mode.js');
            const result = await simulateDemoReceive(browser);
            toastStore.success($t('preferences.demoSimulatedReceive'));
            // Per-site auto-copy confirmation - value-free; the code itself is
            // never shown (shoulder-surfing).
            if (result?.autoCopied) {
              toastStore.success($t('toasts.otpAutoCopied'));
            }
          }}
        >{$t('preferences.demoSimulateReceive')}</button>
      {/if}
    </SettingCard>
  </section>

  <!-- ── Diagnostics ── -->
  <section id="settings-section-diagnostics" data-settings-section="diagnostics" class="space-y-2 scroll-mt-2">
    <div class="flex items-center gap-2 mb-1">
      <Icon name="info" class="w-4 h-4 text-md-primary" />
      <span class="text-sm font-medium text-md-on-surface">{$t('diagnostics.title')}</span>
    </div>
    <button
      type="button"
      class="md-action w-full flex items-center justify-between px-3 py-3 bg-md-surface-container rounded-xl transition-colors border border-md-outline-variant/30"
      onclick={() => onNavigateToDiagnostics()}
    >
      <div class="text-start">
        <div class="text-sm font-medium text-md-on-surface">{$t('diagnostics.menuTitle')}</div>
        <div class="text-xs text-md-on-surface/50 mt-0.5">{$t('diagnostics.menuDescription')}</div>
      </div>
      <Icon name="chevronRight" class="w-4 h-4 text-md-on-surface/60 rtl-flip" />
    </button>
  </section>

  <!-- ── Data, Storage & Performance ── -->
  <section id="settings-section-data" data-settings-section="data" class="space-y-2 scroll-mt-2">
    <div class="flex items-center gap-2 mb-1">
      <Icon name="database" class="w-4 h-4 text-md-primary" />
      <span class="text-sm font-medium text-md-on-surface">{$t('preferences.sectionData')}</span>
    </div>
    <SettingCard variant="row" id="setting-backup" class="space-y-2">
      {#snippet header()}
        <div class="flex items-center gap-1.5 mb-2">
          <Icon name="download" class="w-3.5 h-3.5 text-md-primary shrink-0" />
          <span class="text-xs font-medium text-md-on-surface/60">{$t('preferences.backupSectionTitle')}</span>
        </div>
      {/snippet}
      <div
        class="w-full px-3 py-2 rounded-lg bg-md-surface-variant/50 border border-md-outline-variant/30 text-label-sm text-md-on-surface/70 flex items-center gap-1.5"
        role="status"
      >
        <Icon name="download" class="w-3.5 h-3.5 text-md-primary shrink-0" />
        <span class="truncate">
          {#if lastBackupAt}
            {$t('preferences.lastBackupAt', { values: { date: formatBackupDate(lastBackupAt) } })}
          {:else}
            {$t('preferences.lastBackupNever')}
          {/if}
        </span>
      </div>
      <div class="flex flex-nowrap gap-3" use:responsiveButtonLayout data-action-tier="S">
        <Btn
          variant="primaryOutline"
          size="md"
          class="flex-1"
          aria-label={$t('preferences.exportDataAria')}
          onclick={onExportData}
        >{$t('preferences.exportData')}</Btn>
        <Btn
          variant="primaryOutline"
          size="md"
          class="flex-1"
          aria-label={$t('preferences.importDataAria')}
          onclick={onImportData}
        >{$t('preferences.importData')}</Btn>
      </div>
    </SettingCard>

    <!-- WebDAV cloud backup sync (master toggle opens the config dialog) -->
    <WebDAVSettingsCard {loadAddresses} />
    {#if onExportCategory}
      <div class="space-y-1.5">
        <span class="text-xs text-md-on-surface/50">{$t('settings.exportCategory')}</span>
        <div class="flex flex-nowrap gap-2" use:responsiveButtonLayout data-action-tier="XS">
          <Btn variant="outline" size="sm" class="flex-1" onclick={() => onExportCategory('settings')}><span class="btn-label">{$t('common.settings')}</span></Btn>
          <Btn variant="outline" size="sm" class="flex-1" onclick={() => onExportCategory('identities')}><span class="btn-label">{$t('settings.exportCategoryIdentities')}</span></Btn>
          <Btn variant="outline" size="sm" class="flex-1" onclick={() => onExportCategory('savedLogins')}><span class="btn-label">{$t('settings.exportCategorySavedLogins')}</span></Btn>
          <Btn variant="outline" size="sm" class="flex-1" onclick={() => onExportCategory('addresses')}><span class="btn-label">{$t('settings.exportCategoryAddresses')}</span></Btn>
        </div>
      </div>
    {/if}

    <!-- Storage snapshot summary -->
    <SettingCard variant="row">
      {#snippet header()}
        <div class="flex items-center gap-1.5 mb-2">
          <Icon name="database" class="w-3.5 h-3.5 text-md-primary shrink-0" />
          <span class="text-xs font-medium text-md-on-surface/60">{$t('preferences.storageSnapshotTitle')}</span>
        </div>
      {/snippet}
      <div class="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <div class="flex items-center justify-between gap-2 text-xs">
          <span class="text-md-on-surface/60 min-w-0 truncate">{$t('preferences.storageAddresses')}</span>
          <span class="font-medium text-md-on-surface tabular-nums shrink-0">{storageSnapshot.addresses}</span>
        </div>
        <div class="flex items-center justify-between gap-2 text-xs">
          <span class="text-md-on-surface/60 min-w-0 truncate">{$t('preferences.storageEmails')}</span>
          <span class="font-medium text-md-on-surface tabular-nums shrink-0">{storageSnapshot.emails}</span>
        </div>
        <div class="flex items-center justify-between gap-2 text-xs">
          <span class="text-md-on-surface/60 min-w-0 truncate">{$t('preferences.storageIdentities')}</span>
          <span class="font-medium text-md-on-surface tabular-nums shrink-0">{storageSnapshot.identities}</span>
        </div>
        <div class="flex items-center justify-between gap-2 text-xs">
          <span class="text-md-on-surface/60 min-w-0 truncate">{$t('preferences.storageUsed')}</span>
          <span class="font-medium text-md-on-surface tabular-nums shrink-0">{formatBytes(storageSnapshot.bytes)}</span>
        </div>
      </div>
    </SettingCard>

    <!-- Storage & Performance sub-page nav card -->
    <button
      id="setting-storage"
      class="md-action bg-md-surface-container-low rounded-xl px-3 py-3 w-full text-start transition-colors border border-md-outline-variant/20"
      onclick={onNavigateToStoragePerformance}
    >
      <div class="flex items-center justify-between">
        <div class="min-w-0">
          <div class="text-sm font-medium text-md-on-surface">{$t('preferences.storageAndPerformance')}</div>
          <div class="text-xs text-md-on-surface/50 mt-0.5">{$t('preferences.storageAndPerformanceDescription')}</div>
        </div>
        <Icon name="chevronRight" class="w-4 h-4 text-md-primary/70 rtl-flip shrink-0" />
      </div>
    </button>

    <!-- Hard reset (moved from the removed Danger Zone section) -->
    <div class="rounded-xl border border-md-error/40 bg-md-error-container/60 px-3 py-3 space-y-2">
      <div class="text-sm font-semibold text-md-on-error-container">{$t('preferences.dangerZone')}</div>
      <div class="text-xs text-md-on-error-container/70">{$t('preferences.dangerZoneDescription')}</div>
      <Btn
        variant="dangerOutline"
        size="md"
        class="w-full mt-1"
        aria-label={$t('preferences.performHardReset')}
        onclick={() =>
          showConfirmDialog($t('preferences.hardResetConfirm'), onHardReset, {
            destructive: true,
          })
        }
      >{$t('preferences.hardReset')}</Btn>
    </div>
  </section>

  <!-- Dynamic End-of-List Spacer: allows content to flow behind floating nav & strips while ensuring the final card can scroll cleanly above controls -->
  <div
    class="w-full shrink-0 transition-[height] duration-200 ease-in-out pointer-events-none"
    style="height: calc(var(--bottom-safe-area, 0px) + 16px);"
    aria-hidden="true"
  ></div>

  </div>
  {/if}

  {#if settingsSearchQuery || activeSettingsSubpage}
    <div style="display: none;" class="hidden-search-sandbox hidden">
      <div data-settings-subpage="keybindings">
        <KeyboardShortcutsView keybindings={keybindings || DEFAULT_KEYBINDINGS} />
      </div>
      <div data-settings-subpage="organize">
        <div class="text-sm font-medium">{$t('nav.organize')}</div>
        <div class="text-xs">{$t('organize.subtitle')}</div>
        <div>{$t('nav.tagManagement')} · {$t('preferences.tagManagement')}</div>
        <div>{$t('nav.labelManagement')} · {$t('preferences.emailLabelManagement')}</div>
        <div>{$t('nav.filtersManagement')} · {$t('preferences.filtersManagement')}</div>
      </div>
      <div data-settings-subpage="tagManagement">
        <div>{$t('preferences.tagManagement')}</div>
        <div>{$t('preferences.tagManagementDescription')}</div>
      </div>
      <div data-settings-subpage="filtersManagement">
        <div>{$t('preferences.filtersManagement')}</div>
        <div>{$t('preferences.filtersManagementDescription')}</div>
      </div>
      <div data-settings-subpage="labelManagement">
        <div>{$t('preferences.emailLabelManagement')}</div>
        <div>{$t('preferences.emailLabelManagementDescription')}</div>
      </div>
      <div data-settings-subpage="mailProvider">
        <MailProviderView
          selectedProvider={selectedProvider}
          autoRenew={autoRenew}
          notificationsEnabled={notificationsEnabled}
          soundEnabled={soundEnabled}
          expiryWarningThreshold={expiryWarningThreshold}
          autoRefreshInterval={autoRefreshInterval}
          emailPreviewMode={emailPreviewMode}
          providerInstances={providerInstances || []}
          selectedProviderInstance={selectedProviderInstance}
          defaultDomain={defaultDomain}
          allAddresses={allAddresses || []}
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
      </div>
      <div data-settings-subpage="storagePerformance">
        <StoragePerformanceView
          faviconCaching={faviconCaching}
          emailRetentionDays={emailRetentionDays}
        />
      </div>
      <div data-settings-subpage="addresses">
        <AddressesView />
      </div>
      <div data-settings-subpage="constantsSettings">
        <ConstantsSettingsView />
      </div>
      <div data-settings-subpage="identities">
        <IdentitiesView
          {context}
          savedLogins={[]}
          mailboxAddresses={allAddresses.map((a) => a.address).filter(Boolean)}
          activeMailboxAddress={allAddresses.find((a) => a.accountStatus === 'active' || !a.accountStatus)?.address || allAddresses[0]?.address || ''}
        />
      </div>
      <div data-settings-subpage="toolbarButtons">
        <ToolbarSettingsView onBack={() => { activeSettingsSubpage = null; }} showToast={(msg) => toastStore.info(msg)} />
      </div>
      <div data-settings-subpage="htmlRendering">
        <HtmlRenderingSettingsView onBack={() => { activeSettingsSubpage = null; }} showToast={(msg) => toastStore.info(msg)} />
      </div>
      <div data-settings-subpage="navbarOrder">
        <NavbarOrderSettingsView onBack={() => { activeSettingsSubpage = null; }} showToast={(msg) => toastStore.info(msg)} />
      </div>
      <div data-settings-subpage="pageZoom">
        <div>{$t('preferences.pageZoomTitle')}</div>
        <div>{$t('preferences.pageZoomDescription')}</div>
      </div>
    </div>
  {/if}
  </div>

  {#if !activeSettingsSubpage}
    <!-- Contextual FAB: magnifier → focuses the settings search bar -->
    <FloatingAction
      kind="ghost"
      icon="search"
      labelKey="preferences.searchSettings"
      onclick={focusSettingsSearch}
    />
  {/if}

  {/snippet}
</ErrorBoundary>
{/if}

<ConfirmDialog {confirmDialog} onClose={closeConfirmDialog} />

<MasterPasswordModal
  isOpen={isPasswordModalOpen}
  mode={passwordModalMode}
  vaultMode={vaultMode}
  preflight={rotatePreflight}
  onClose={handleClosePasswordModal}
  onSave={handleSaveMasterPassword}
  onVerify={handleVerifyMasterPassword}
/>

<ToastContainer />

<style>
  :global(.animate-pulse-highlight) {
    animation: pulse-highlight 1.8s cubic-bezier(0.4, 0, 0.2, 1) 1;
  }

  @keyframes pulse-highlight {
    0%, 100% {
      box-shadow: 0 0 0 2px var(--md-primary), 0 0 0 4px color-mix(in srgb, var(--md-primary) 40%, transparent);
    }
    50% {
      box-shadow: 0 0 0 4px var(--md-primary), 0 0 0 8px color-mix(in srgb, var(--md-primary) 10%, transparent);
    }
  }

  /* Multi-column setting cards when the settings PANE is wide enough.
     Keyed off the pane (container query), not the viewport: the popup pane is
     ~335px and must stay single-column even when the browser window is wide,
     otherwise narrow cards overflow horizontally. */
  .settings-scroll {
    container-type: inline-size;
  }
  .settings-wide-cols :global(section[data-settings-section]) {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.5rem;
  }
  .settings-wide-cols :global(section[data-settings-section] > .flex.items-center.gap-2.mb-1),
  .settings-wide-cols :global(section[data-settings-section] > .flex.items-center.gap-2) {
    grid-column: 1 / -1;
  }
  /* Let each section choose as many columns as its real width can support.
     The 320px floor prevents long localized labels and controls from being
     squeezed into an arbitrary third column; narrow popup panes naturally stay
     single-column, while wider app panes gain columns progressively. */
  .settings-wide-cols :global(section[data-settings-section]:not([data-settings-section='danger'])) {
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  }
</style>
