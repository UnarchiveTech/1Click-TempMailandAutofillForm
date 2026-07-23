<script lang="ts">
import { onMount } from 'svelte';
import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import ToastContainer from '@/components/feedback/ToastContainer.svelte';
import Icon from '@/components/icons/Icon.svelte';
import ConfirmDialog from '@/components/overlays/ConfirmDialog.svelte';
import MasterPasswordModal from '@/components/overlays/MasterPasswordModal.svelte';
import ColorPicker from '@/components/ui/composites/ColorPicker.svelte';
import ScrollSpy from '@/components/ui/composites/ScrollSpy.svelte';
import ErrorBoundary from '@/components/ui/ErrorBoundary.svelte';
import LanguageSwitcher from '@/components/ui/LanguageSwitcher.svelte';
import { SelectField, Toggle } from '@/components/ui/primitives';
import { getLastBackupExportAt } from '@/features/settings/backup-actions.js';
import { loadClipboardPrivacy, saveClipboardPrivacy } from '@/utils/clipboard-settings.js';
import { setupFocusTrap } from '@/utils/focusTrap.js';
import { logError } from '@/utils/logger.js';
import { setMarqueeSelectionEnabled } from '@/utils/marquee-settings.js';
import {
  getSearchHistory,
  getSearchHistoryLimit,
  pushSearchHistory,
  removeSearchHistoryItem,
  setSearchHistoryLimit,
} from '@/utils/search-history.js';
import { toastStore } from '@/utils/toastStore.js';
import type { Account, Identity, Keybindings, ProviderInstance } from '@/utils/types.js';
import { DEFAULT_KEYBINDINGS } from '@/utils/types.js';
import {
  disableVaultLock,
  getVaultConfig,
  isBiometricSupported,
  setupBiometricVault,
  setupMasterPassword,
  type VaultSecurityMode,
} from '@/utils/vault-lock.js';
import AddressesView from './AddressesView.svelte';
import ConstantsSettingsView from './ConstantsSettingsView.svelte';
import FiltersManagementView from './FiltersManagementView.svelte';
import IdentitiesView from './IdentitiesView.svelte';
import KeyboardShortcutsView from './KeyboardShortcutsView.svelte';
import LabelManagementView from './LabelManagementView.svelte';
import MailProviderView from './MailProviderView.svelte';
import StoragePerformanceView from './StoragePerformanceView.svelte';
import TagManagementView from './TagManagementView.svelte';

let vaultMode = $state<VaultSecurityMode>('standard');
let biometricSupported = $state(false);
let isPasswordModalOpen = $state(false);
let lastBackupAt = $state<number | null>(null);
let autofillLoginPreference = $state<'recent' | 'listOrder'>('recent');
let demoMode = $state(false);
let voiceSearchEnabled = $state(true);
/** After address expires (and not auto-renewed): archive (default) or permanent delete */
let expiryAction = $state<'archive' | 'delete'>('archive');
let densityLocal = $state<'comfortable' | 'compact'>('comfortable');
let otpDetectionMode = $state<'numeric' | 'alphanumeric' | 'balanced'>('balanced');
let gesturesEnabled = $state(true);
let marqueeSelectionEnabled = $state(true);
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

/** Site rules: domain → identity / provider / auto-archive */
type SiteRuleRow = {
  id: string;
  name: string;
  enabled: boolean;
  domainPattern: string;
  identityId?: string | null;
  providerId?: string | null;
  autoArchiveDays?: number | null;
};
let siteRules = $state<SiteRuleRow[]>([]);
let newRuleDomain = $state('');
let newRuleIdentityId = $state('');
let newRuleProviderId = $state('');
let newRuleArchiveDays = $state(0);
let ruleIdentities = $state<Identity[]>([]);
let ruleProviders = $state<{ id: string; label: string }[]>([]);

/** Scrollspy section tabs (mirrors Activity view navigation) */
type SettingsSpySection =
  | 'general'
  | 'identity'
  | 'mail'
  | 'autofill'
  | 'appearance'
  | 'developer'
  | 'search'
  | 'diagnostics'
  | 'data'
  | 'danger';

const SETTINGS_SPY_SECTIONS: { id: SettingsSpySection; labelKey: string }[] = [
  { id: 'general', labelKey: 'preferences.sectionGeneral' },
  { id: 'identity', labelKey: 'preferences.sectionIdentity' },
  { id: 'mail', labelKey: 'preferences.sectionMail' },
  { id: 'autofill', labelKey: 'preferences.sectionAutofill' },
  { id: 'appearance', labelKey: 'preferences.sectionAppearance' },
  { id: 'developer', labelKey: 'preferences.sectionDeveloper' },
  { id: 'search', labelKey: 'preferences.sectionSearch' },
  { id: 'diagnostics', labelKey: 'preferences.sectionDiagnostics' },
  { id: 'data', labelKey: 'preferences.sectionData' },
  { id: 'danger', labelKey: 'preferences.sectionDanger' },
];

let settingsSpyActive = $state<string>('general');

function formatBackupDate(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return new Date(ts).toISOString();
  }
}

onMount(() => {
  (async () => {
    const config = await getVaultConfig();
    vaultMode = config.mode;
    biometricSupported = await isBiometricSupported();
    lastBackupAt = await getLastBackupExportAt(browser);
    const stored = (await browser.storage.local.get([
      'autofillLoginPreference',
      'demoMode',
      'otpDetectionMode',
      'gesturesEnabled',
      'marqueeSelectionEnabled',
      'voiceSearchEnabled',
      'uiDensity',
      'expiryAction',
    ])) as {
      autofillLoginPreference?: 'recent' | 'listOrder';
      demoMode?: boolean;
      otpDetectionMode?: 'numeric' | 'alphanumeric' | 'balanced';
      gesturesEnabled?: boolean;
      marqueeSelectionEnabled?: boolean;
      voiceSearchEnabled?: boolean;
      uiDensity?: 'comfortable' | 'compact';
      expiryAction?: 'archive' | 'delete';
    };
    if (
      stored.autofillLoginPreference === 'listOrder' ||
      stored.autofillLoginPreference === 'recent'
    )
      autofillLoginPreference = stored.autofillLoginPreference;
    demoMode = !!stored.demoMode;
    if (stored.gesturesEnabled === false) gesturesEnabled = false;
    if (stored.marqueeSelectionEnabled === false) marqueeSelectionEnabled = false;
    voiceSearchEnabled = stored.voiceSearchEnabled !== false;
    if (stored.expiryAction === 'delete' || stored.expiryAction === 'archive') {
      expiryAction = stored.expiryAction;
    }
    if (stored.uiDensity === 'compact' || stored.uiDensity === 'comfortable') {
      densityLocal = stored.uiDensity;
    }
    if (
      stored.otpDetectionMode === 'numeric' ||
      stored.otpDetectionMode === 'alphanumeric' ||
      stored.otpDetectionMode === 'balanced'
    ) {
      otpDetectionMode = stored.otpDetectionMode;
    }
    try {
      const { loadNotificationIntelligence } = await import('@/features/intelligence/storage.js');
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
      const { loadSiteRules } = await import('@/features/intelligence/site-rules.js');
      siteRules = await loadSiteRules();
      const idRes = (await browser.storage.local.get(['identities'])) as {
        identities?: Identity[];
      };
      ruleIdentities = idRes.identities || [];
      const { getAllProviderConfigs } = await import('@/utils/email-service.js');
      ruleProviders = getAllProviderConfigs().map((p) => ({
        id: p.id,
        label: p.displayName || p.name || p.id,
      }));
    } catch {
      /* optional */
    }
  })().catch((err) => {
    logError('Failed to initialize extension settings in onMount', undefined, err);
  });

  const onStorage = (changes: Record<string, { newValue?: unknown }>, area: string) => {
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
  };
  browser.storage.onChanged.addListener(onStorage);
  return () => browser.storage.onChanged.removeListener(onStorage);
});

async function persistNotifIntel() {
  try {
    const { saveNotificationIntelligence } = await import('@/features/intelligence/storage.js');
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

async function persistClipboardPrivacy() {
  try {
    await saveClipboardPrivacy(clipboardPrivacy);
  } catch (e) {
    logError(
      'Failed to save clipboard privacy',
      undefined,
      e instanceof Error ? e : new Error(String(e))
    );
  }
}

async function reloadSiteRules() {
  try {
    const { loadSiteRules } = await import('@/features/intelligence/site-rules.js');
    siteRules = await loadSiteRules();
  } catch {
    /* ignore */
  }
}

async function addSiteRule() {
  const domain = newRuleDomain.trim();
  if (!domain) return;
  try {
    const { upsertSiteRule } = await import('@/features/intelligence/site-rules.js');
    await upsertSiteRule({
      domainPattern: domain,
      name: domain,
      enabled: true,
      identityId: newRuleIdentityId || null,
      providerId: newRuleProviderId || null,
      autoArchiveDays: newRuleArchiveDays > 0 ? newRuleArchiveDays : null,
    });
    newRuleDomain = '';
    newRuleIdentityId = '';
    newRuleProviderId = '';
    newRuleArchiveDays = 0;
    await reloadSiteRules();
    toastStore.success($t('intelligence.ruleSaved'));
  } catch (e) {
    logError('Failed to save site rule', undefined, e instanceof Error ? e : new Error(String(e)));
    toastStore.error($t('intelligence.ruleSaveFailed'));
  }
}

async function toggleSiteRule(id: string, enabled: boolean) {
  const row = siteRules.find((r) => r.id === id);
  if (!row) return;
  try {
    const { upsertSiteRule } = await import('@/features/intelligence/site-rules.js');
    await upsertSiteRule({ ...row, enabled, domainPattern: row.domainPattern });
    await reloadSiteRules();
  } catch {
    /* ignore */
  }
}

async function removeSiteRule(id: string) {
  try {
    const { deleteSiteRule } = await import('@/features/intelligence/site-rules.js');
    await deleteSiteRule(id);
    await reloadSiteRules();
  } catch {
    /* ignore */
  }
}

async function handleSetVaultMode(targetMode: VaultSecurityMode) {
  if (targetMode === 'standard') {
    const ok = await disableVaultLock();
    if (ok) {
      vaultMode = 'standard';
      toastStore.success('Vault set to Standard Access');
    }
  } else if (targetMode === 'password') {
    isPasswordModalOpen = true;
  } else if (targetMode === 'biometrics') {
    const ok = await setupBiometricVault();
    if (ok) {
      vaultMode = 'biometrics';
      toastStore.success('Biometric Vault Lock Enabled');
    } else {
      toastStore.error('Biometric setup failed or cancelled');
    }
  }
}

async function handleSaveMasterPassword(password: string) {
  const ok = await setupMasterPassword(password);
  if (ok) {
    vaultMode = 'password';
    toastStore.success('Master Password Vault Lock Enabled');
  } else {
    toastStore.error('Failed to set Master Password');
  }
}

let {
  context = 'popup',
  onBack = () => {},

  autoCopy = false,
  autoRenew = false,
  selectedProvider = '',
  savingSettings = false,
  loading = false,
  onSaveSettings = () => {},

  onSetAutoCopy = undefined,
  onSetAutoRenew = undefined,
  onHardReset = () => {},
  providerInstances = [],
  selectedProviderInstance = null,
  onSetProviderInstance = () => {},
  onExportData = () => {},
  onExportCategory = undefined,
  onImportData = () => {},
  onStartProductTour = () => {},
  onProviderChange = () => {},
  onAddCustomInstance = () => {},
  onLoadProviderInstances = () => {},
  customColor = '',
  onColorChange = () => {},
  inboxColorThemeEnabled = false,
  onToggleInboxColorTheme = () => {},
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
  onNavigateToLabelManagement = () => {},
  onNavigateToMailboxManagement = () => {},
  onNavigateToDiagnostics = () => {},
  autoRefreshInterval = 30000,
  onSetAutoRefreshInterval = undefined,
  emailPreviewEnabled = true,
  onSetEmailPreviewEnabled = undefined,
  defaultDomain = '',
  onSetDefaultDomain = undefined,
  allInboxes = [] as Account[],
  autofillBlocklist = [] as string[],
  onRemoveFromBlocklist = undefined,
  onAddToBlocklist = undefined,
}: {
  context?: 'popup' | 'sidepanel' | 'app';
  onBack?: () => void;

  autoCopy?: boolean;
  autoRenew?: boolean;
  selectedProvider?: string;
  savingSettings?: boolean;
  loading?: boolean;
  onSaveSettings?: () => void;

  onSetAutoCopy?: (value: boolean) => void;
  onSetAutoRenew?: (value: boolean) => void;
  onHardReset?: () => void;
  providerInstances?: ProviderInstance[];
  selectedProviderInstance?: string | null;
  onSetProviderInstance?: (instanceId: string) => void;
  onExportData?: () => void;
  onExportCategory?: (
    category: 'settings' | 'identities' | 'savedLogins' | 'inboxes' | 'all'
  ) => void;
  onImportData?: () => void;
  onStartProductTour?: () => void;
  onProviderChange?: (provider: string) => void;
  onAddCustomInstance?: (name: string, url: string) => void;
  onLoadProviderInstances?: () => void | Promise<void>;
  customColor?: string;
  onColorChange?: (color: string) => void;
  inboxColorThemeEnabled?: boolean;
  onToggleInboxColorTheme?: () => void;
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
  onNavigateToLabelManagement?: () => void;
  onNavigateToMailboxManagement?: () => void;
  onNavigateToDiagnostics?: () => void;
  autoRefreshInterval?: number;
  onSetAutoRefreshInterval?: (value: number) => void;
  emailPreviewEnabled?: boolean;
  onSetEmailPreviewEnabled?: (value: boolean) => void;
  defaultDomain?: string;
  onSetDefaultDomain?: (value: string) => void;
  allInboxes?: Account[];
  autofillBlocklist?: string[];
  onRemoveFromBlocklist?: (domain: string) => void;
  onAddToBlocklist?: (domain: string) => void | Promise<void>;
} = $props();

let confirmDialog = $state<{ message: string; onConfirm: () => void } | null>(null);
let confirmDialogRef = $state<HTMLElement | null>(null);

export interface SearchResultItem {
  id: string;
  section: string;
  title: string;
  desc: string;
  element: HTMLElement;
}

let settingsSearchQuery = $state('');
let selectedSearchIndex = $state(-1);
let settingsContainer = $state<HTMLElement | null>(null);
let newBlocklistDomain = $state('');
/** Hostname of the active browser tab (when available) for blocklist quick-add */
let currentTabDomain = $state('');
let searchHistoryLimit = $state(5);
let settingsRecentSearches = $state<string[]>([]);
let settingsSearchFocused = $state(false);

async function loadSearchHistorySettings() {
  searchHistoryLimit = await getSearchHistoryLimit();
  settingsRecentSearches = await getSearchHistory('settings');
}

$effect(() => {
  void loadSearchHistorySettings();
});

async function loadCurrentTabDomain() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url;
    if (!url || !/^https?:\/\//i.test(url)) {
      currentTabDomain = '';
      return;
    }
    currentTabDomain = new URL(url).hostname.toLowerCase();
  } catch {
    currentTabDomain = '';
  }
}

$effect(() => {
  void loadCurrentTabDomain();
});

// Reset highlight index when query updates
$effect(() => {
  void settingsSearchQuery;
  selectedSearchIndex = -1;
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
    let categoryName = 'Settings';
    const firstTextChild = section.querySelector('span, h1, h2, h3, div');
    if (firstTextChild) {
      categoryName = firstTextChild.textContent?.trim() || 'Settings';
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

      const searchableText = `${categoryName} ${titleText} ${descText}`.toLowerCase();
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

function handleSearchKeydown(event: KeyboardEvent) {
  if (filteredSettings.length === 0) return;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    selectedSearchIndex = (selectedSearchIndex + 1) % filteredSettings.length;
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    selectedSearchIndex =
      (selectedSearchIndex - 1 + filteredSettings.length) % filteredSettings.length;
  } else if (event.key === 'Enter') {
    event.preventDefault();
    if (selectedSearchIndex >= 0 && selectedSearchIndex < filteredSettings.length) {
      handleNavigateToElement(filteredSettings[selectedSearchIndex]);
    } else if (filteredSettings.length > 0) {
      handleNavigateToElement(filteredSettings[0]);
    }
  } else if (event.key === 'Escape') {
    event.preventDefault();
    settingsSearchQuery = '';
  }
}

function handleNavigateToElement(item: SearchResultItem) {
  settingsSearchQuery = '';

  const subpageWrapper = item.element.closest('[data-settings-subpage]');
  if (subpageWrapper) {
    const subpage = subpageWrapper.getAttribute('data-settings-subpage');

    // Switch routing view
    if (subpage === 'keybindings' && onNavigateToKeybindings) {
      onNavigateToKeybindings();
    } else if (subpage === 'tagManagement' && onNavigateToTagManagement) {
      onNavigateToTagManagement();
    } else if (subpage === 'filtersManagement' && onNavigateToFiltersManagement) {
      onNavigateToFiltersManagement();
    } else if (subpage === 'mailProvider' && onNavigateToMailProvider) {
      onNavigateToMailProvider();
    } else if (subpage === 'storagePerformance' && onNavigateToStoragePerformance) {
      onNavigateToStoragePerformance();
    } else if (subpage === 'labelManagement' && onNavigateToLabelManagement) {
      onNavigateToLabelManagement();
    } else if (subpage === 'mailboxManagement' && onNavigateToMailboxManagement) {
      onNavigateToMailboxManagement();
    } else if (subpage === 'constantsSettings' && onNavigateToConstantsSettings) {
      onNavigateToConstantsSettings();
    } else if (subpage === 'identities' && onNavigateToIdentities) {
      onNavigateToIdentities();
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
              '.bg-md-primary-container, .bg-md-secondary-container, button, label, tr, li'
            ) || el;

          highlightTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

// Keybinding editing state
let editingKeybinding = $state<string | null>(null);
let recordingKeybinding = $state(false);
let recordedKeys = $state<string>('');

// Helper function to format keybinding for display
function formatKeybinding(binding: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}): string {
  const tr = get(t);
  const parts: string[] = [];
  if (binding.ctrlKey || binding.metaKey) parts.push(tr('keyboardShortcuts.ctrlCmd'));
  if (binding.shiftKey) parts.push(tr('keyboardShortcuts.shift'));
  if (binding.altKey) parts.push(tr('keyboardShortcuts.alt'));
  parts.push(binding.key.toUpperCase());
  return parts.join(' + ');
}

// Start recording a new keybinding
function startRecording(action: string) {
  editingKeybinding = action;
  recordingKeybinding = true;
  recordedKeys = '';
}

// Handle keydown during recording
function handleRecordingKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    cancelRecording();
    return;
  }

  if (event.key === 'Tab') {
    cancelRecording();
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const tr = get(t);
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push(tr('keyboardShortcuts.ctrlCmd'));
  if (event.shiftKey) parts.push(tr('keyboardShortcuts.shift'));
  if (event.altKey) parts.push(tr('keyboardShortcuts.alt'));
  parts.push(event.key.toUpperCase());

  recordedKeys = parts.join(' + ');

  // Save the new keybinding
  if (editingKeybinding && onSetKeybindings) {
    const newKeybindings = { ...keybindings };
    newKeybindings[editingKeybinding as keyof Keybindings] = {
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    };
    onSetKeybindings(newKeybindings);
    onSaveSettings();
  }

  recordingKeybinding = false;
  editingKeybinding = null;
  recordedKeys = '';
}

// Cancel recording
function cancelRecording() {
  recordingKeybinding = false;
  editingKeybinding = null;
  recordedKeys = '';
}

// Reset keybinding to default
function resetKeybinding(action: string) {
  if (onSetKeybindings) {
    const newKeybindings = { ...keybindings };
    newKeybindings[action as keyof Keybindings] = DEFAULT_KEYBINDINGS[action as keyof Keybindings];
    onSetKeybindings(newKeybindings);
    onSaveSettings();
  }
}

// Count customized keybindings
let customKeybindingCount = $derived(
  (['refreshInbox', 'createInbox', 'copyEmail', 'copyOtp', 'closeDialogs'] as const).filter(
    (k) => formatKeybinding(keybindings[k]) !== formatKeybinding(DEFAULT_KEYBINDINGS[k])
  ).length
);

function showConfirmDialog(message: string, onConfirm: () => void) {
  confirmDialog = { message, onConfirm };
  if (confirmDialogRef) {
    confirmDialogRef.focus();
  }
}

function closeConfirmDialog() {
  confirmDialog = null;
}

// Dropdown state (identity only - others moved to sub-pages)
let identityDropdownOpen = $state(false);
</script>

{#if loading}
  <div class="flex-1 overflow-y-auto px-2 py-2 space-y-3">
    {#each [1,2,3,4,5] as _}
      <div class="rounded-xl bg-md-primary-container p-4 space-y-2 animate-pulse">
        <div class="h-3 w-24 bg-md-outline-variant rounded"></div>
        <div class="h-8 w-full bg-md-outline-variant rounded"></div>
      </div>
    {/each}
  </div>
{:else}
<ErrorBoundary fallback={$t('preferences.failedToLoadSettings')}>
  {#snippet children()}
    <div class="flex flex-col h-full min-h-0">
  <!-- Sticky header: title + search -->
  <div class="shrink-0 px-2 pt-2 pb-1.5 space-y-2 bg-md-surface/95 backdrop-blur-sm border-b border-md-outline-variant/15 z-30">

    <!-- Sticky Search Bar - matches Inbox FilterList chrome -->
    <div class="relative" data-tour="settings-search">
      <div class="w-full flex items-center gap-1 ps-8 pe-9 py-1.5 text-xs rounded-xl bg-md-surface-container-high border border-md-outline-variant/40 focus-within:border-md-primary transition-colors min-h-[32px]">
        <Icon
          name="search"
          class="w-4 h-4 text-md-on-surface-variant absolute start-2.5 top-1/2 -translate-y-1/2 pointer-events-none z-[1]"
        />
        <input
          type="text"
          bind:value={settingsSearchQuery}
          onkeydown={handleSearchKeydown}
          onfocus={() => { settingsSearchFocused = true; void loadSearchHistorySettings(); }}
          onblur={() => { setTimeout(() => { settingsSearchFocused = false; }, 150); }}
          placeholder={$t('preferences.searchSettings') || 'Search settings...'}
          class="w-full bg-transparent border-0 outline-none text-xs text-md-on-surface placeholder:text-md-on-surface-variant/60 min-w-0 flex-1 py-0.5"
          aria-label={$t('preferences.searchSettings') || 'Search settings...'}
        />
        {#if settingsSearchQuery}
          <button
            type="button"
            class="absolute end-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-md-surface-variant transition-colors border-0 text-md-on-surface/40 z-[1]"
            onclick={() => settingsSearchQuery = ''}
            aria-label={$t('common.close')}
          >
            <Icon name="x" class="w-3.5 h-3.5" />
          </button>
        {/if}
      </div>

      {#if settingsSearchFocused && !settingsSearchQuery.trim() && settingsRecentSearches.length > 0}
        <div class="absolute z-40 inset-x-0 mt-1 max-h-48 overflow-y-auto bg-md-surface-container-high rounded-xl border border-md-outline-variant/40 shadow-lg p-1.5 space-y-0.5">
          <div class="px-2 py-1 text-xs font-bold text-md-on-surface/40 uppercase">{$t('searchHistory.recent')}</div>
          {#each settingsRecentSearches as item (item)}
            <div class="flex items-center gap-0.5">
              <button
                type="button"
                class="flex-1 min-w-0 text-start px-2 py-1.5 text-xs rounded-lg hover:bg-md-surface-variant truncate"
                onclick={() => { settingsSearchQuery = item; void pushSearchHistory('settings', item); }}
              >{item}</button>
              <button
                type="button"
                class="w-7 h-7 flex items-center justify-center text-md-on-surface/40 hover:text-md-error"
                aria-label={$t('searchHistory.remove')}
                onclick={async () => { settingsRecentSearches = await removeSearchHistoryItem('settings', item); }}
              >
                <Icon name="x" class="w-3.5 h-3.5" />
              </button>
            </div>
          {/each}
        </div>
      {/if}

      {#if settingsSearchQuery.trim()}
        <div class="absolute z-40 inset-x-0 mt-1 max-h-64 overflow-y-auto bg-md-surface-container-high rounded-xl border border-md-outline-variant/40 shadow-lg p-1.5 space-y-1">
          {#each filteredSettings as item, idx}
            <button
              type="button"
              class="w-full text-start px-3 py-2 rounded-lg transition-colors border-0 {selectedSearchIndex === idx ? 'bg-md-surface-variant' : 'hover:bg-md-surface-variant/50'}"
              onclick={() => {
                void pushSearchHistory('settings', settingsSearchQuery.trim());
                handleNavigateToElement(item);
              }}
            >
              <div class="flex items-center gap-1.5">
                <span class="text-xs font-semibold text-md-primary bg-md-primary/10 px-1.5 py-0.5 rounded">
                  {item.section}
                </span>
                <span class="text-xs font-semibold text-md-on-surface truncate">{item.title}</span>
              </div>
              {#if item.desc && item.desc !== item.title}
                <div class="text-xs text-md-on-surface/60 truncate ps-0.5 mt-0.5">{item.desc}</div>
              {/if}
            </button>
          {/each}
          {#if filteredSettings.length === 0}
            <div class="text-label-sm text-md-on-surface/50 py-3 text-center">
              <div>No matching settings found</div>
            </div>
          {/if}
        </div>
      {/if}
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
    class="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-3 pb-3 settings-scroll settings-wide-cols"
  >

  <!-- ── General ── -->
  <section id="settings-section-general" data-settings-section="general" class="space-y-2 scroll-mt-2">
    <div class="flex items-center gap-2 mb-1">
      <Icon name="settings" class="w-4 h-4 text-md-primary" />
      <span class="text-sm font-semibold text-md-on-surface">{$t('preferences.general')}</span>
    </div>
    <!-- Language Switcher -->
    <div id="setting-language" class="bg-md-primary-container rounded-xl px-2.5 py-2.5 flex items-center justify-between">
      <div>
        <div class="text-sm font-medium text-md-on-surface">{$t('preferences.language')}</div>
        <div class="text-xs text-md-on-surface/50">{$t('preferences.languageDescription')}</div>
      </div>
      <LanguageSwitcher />
    </div>

    <!-- Auto-Copy row -->
    <div id="setting-autocopy" class="bg-md-primary-container rounded-xl px-2.5 py-2.5 flex items-center justify-between">
      <div>
        <div class="text-sm font-medium text-md-on-surface">{$t('settings.autoCopy')}</div>
        <div class="text-xs text-md-on-surface/50">{$t('settings.autoCopyDescription')}</div>
      </div>
      <Toggle
        checked={autoCopy}
        ariaLabel={$t('preferences.toggleAutoCopy')}
        onChange={(next) => {
          onSetAutoCopy?.(next);
          onSaveSettings();
        }}
      />
    </div>

    <!-- Gestures (hold-to-select, swipes) -->
    <div class="bg-md-primary-container rounded-xl px-2.5 py-2.5 space-y-2">
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-sm font-medium text-md-on-surface">{$t('preferences.gesturesEnabled')}</div>
          <p class="text-label-sm text-md-on-surface/50">{$t('preferences.gesturesEnabledHint')}</p>
        </div>
        <Toggle
          checked={gesturesEnabled}
          ariaLabel={$t('preferences.gesturesEnabled')}
          onChange={async (next) => {
            gesturesEnabled = next;
            await browser.storage.local.set({ gesturesEnabled });
          }}
        />
      </div>
    </div>

    <!-- Marquee (rubber-band) multi-select -->
    <div class="bg-md-primary-container rounded-xl px-2.5 py-2.5 space-y-2">
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-sm font-medium text-md-on-surface">{$t('preferences.marqueeSelection')}</div>
          <p class="text-label-sm text-md-on-surface/50">{$t('preferences.marqueeSelectionHint')}</p>
        </div>
        <Toggle
          checked={marqueeSelectionEnabled}
          ariaLabel={$t('preferences.marqueeSelection')}
          onChange={async (next) => {
            marqueeSelectionEnabled = next;
            await setMarqueeSelectionEnabled(marqueeSelectionEnabled);
          }}
        />
      </div>
    </div>

    <!-- Site rules engine -->
    <div class="bg-md-tertiary-container/40 rounded-xl px-2.5 py-2.5 space-y-2">
      <div class="text-sm font-medium text-md-on-surface">{$t('intelligence.rulesTitle')}</div>
      <p class="text-label-sm text-md-on-surface/50">{$t('intelligence.rulesHint')}</p>

      <div class="space-y-1.5">
        <input
          type="text"
          class="w-full px-2 py-1.5 text-xs rounded-lg bg-md-surface border border-md-outline-variant/40"
          placeholder={$t('intelligence.ruleDomainPlaceholder')}
          bind:value={newRuleDomain}
        />
        <div class="flex flex-wrap gap-1.5">
          <select
            class="flex-1 min-w-[100px] px-2 py-1.5 text-xs rounded-lg bg-md-surface border border-md-outline-variant/40"
            bind:value={newRuleIdentityId}
          >
            <option value="">{$t('intelligence.ruleAnyIdentity')}</option>
            {#each ruleIdentities as id (id.id)}
              <option value={id.id}>{id.name}</option>
            {/each}
          </select>
          <select
            class="flex-1 min-w-[100px] px-2 py-1.5 text-xs rounded-lg bg-md-surface border border-md-outline-variant/40"
            bind:value={newRuleProviderId}
          >
            <option value="">{$t('intelligence.ruleAnyProvider')}</option>
            {#each ruleProviders as p (p.id)}
              <option value={p.id}>{p.label}</option>
            {/each}
          </select>
          <input
            type="number"
            min="0"
            max="365"
            class="w-20 px-2 py-1.5 text-xs rounded-lg bg-md-surface border border-md-outline-variant/40"
            title={$t('intelligence.ruleArchiveDays')}
            placeholder="0"
            bind:value={newRuleArchiveDays}
          />
        </div>
        <button
          type="button"
          class="w-full py-1.5 text-xs font-semibold rounded-lg bg-md-primary text-md-on-primary"
          onclick={() => void addSiteRule()}
        >
          {$t('intelligence.ruleAdd')}
        </button>
      </div>

      {#if siteRules.length === 0}
        <p class="text-label-sm text-md-on-surface/40">{$t('intelligence.rulesEmpty')}</p>
      {:else}
        <ul class="space-y-1.5 max-h-48 overflow-y-auto">
          {#each siteRules as rule (rule.id)}
            <li
              class="flex items-start gap-2 rounded-lg bg-md-surface/70 px-2 py-1.5 border border-md-outline-variant/20"
            >
              <label class="flex items-center pt-0.5 cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  class="rounded"
                  checked={rule.enabled}
                  onchange={(e) =>
                    void toggleSiteRule(rule.id, (e.target as HTMLInputElement).checked)}
                />
              </label>
              <div class="min-w-0 flex-1">
                <div class="text-xs font-semibold text-md-on-surface truncate">{rule.domainPattern}</div>
                <div class="text-xs text-md-on-surface/50 truncate">
                  {#if rule.identityId}
                    {$t('intelligence.ruleIdentityLabel')}:
                    {ruleIdentities.find((i) => i.id === rule.identityId)?.name || rule.identityId}
                  {/if}
                  {#if rule.providerId}
                    · {$t('intelligence.ruleProviderLabel')}:
                    {ruleProviders.find((p) => p.id === rule.providerId)?.label || rule.providerId}
                  {/if}
                  {#if rule.autoArchiveDays}
                    · {$t('intelligence.ruleArchiveLabel', {
                      values: { n: rule.autoArchiveDays },
                    })}
                  {/if}
                </div>
              </div>
              <button
                type="button"
                class="text-xs font-semibold text-md-error shrink-0 px-1"
                onclick={() => void removeSiteRule(rule.id)}
              >
                {$t('common.delete')}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <!-- Notification intelligence -->
    <div class="bg-md-primary-container rounded-xl px-2.5 py-2.5 space-y-2">
      <div class="text-sm font-medium text-md-on-surface">{$t('intelligence.notificationsTitle')}</div>
      <p class="text-label-sm text-md-on-surface/50">{$t('intelligence.notificationsHint')}</p>
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
        <label class="text-label-sm text-md-on-surface/60" for="muted-sender-domains">
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
    </div>

    <!-- Storage & Performance nav card -->
    <button
      id="setting-storage"
      class="bg-md-primary-container rounded-xl px-2.5 py-2.5 w-full text-start hover:bg-md-primary-container/80 transition-colors border-0"
      onclick={onNavigateToStoragePerformance}
    >
      <div class="flex items-center justify-between">
        <div>
          <div class="text-sm font-medium text-md-on-surface">{$t('preferences.storageAndPerformance')}</div>
          <div class="text-xs text-md-on-surface/50 mt-0.5">{$t('preferences.storageAndPerformanceDescription')}</div>
        </div>
        <Icon name="chevronRight" class="w-4 h-4 text-md-primary/70 rtl-flip" />
      </div>
    </button>
  </section>


  <!-- ── Identity ── -->
  <section id="settings-section-identity" data-settings-section="identity" class="space-y-2 scroll-mt-2">
    <div class="flex items-center gap-2 mb-1">
      <Icon name="user" class="w-4 h-4 text-md-primary" />
      <span class="text-sm font-semibold text-md-on-surface">{$t('identities.title')}</span>
    </div>

    <!-- Default Identity for Autofill -->
    <div id="setting-identities" class="bg-md-primary-container rounded-xl px-2.5 py-2.5">
      <div class="text-sm font-medium text-md-on-surface mb-2">{$t('preferences.defaultForAutofill')}</div>
      <div class="relative">
        <button
          class="w-full bg-transparent text-sm outline-none text-md-on-surface appearance-none cursor-pointer font-medium flex items-center justify-between border-0 p-0"
          onclick={() => identityDropdownOpen = !identityDropdownOpen}
          aria-label={$t('preferences.selectDefaultIdentity')}
          disabled={identities.length === 0}
        >
          <span class={identities.length === 0 ? 'text-md-on-surface/40' : ''}>
            {#if identities.length === 0}
              {$t('preferences.noIdentities')}
            {:else}
              {identities.find(i => i.id === selectedIdentityId)?.name ?? $t('preferences.none')}
            {/if}
          </span>
          {#if identities.length > 0}
            <Icon name="chevronDown" class="w-4 h-4 ms-2" />
          {/if}
        </button>
        {#if identityDropdownOpen && identities.length > 0}
          <button class="fixed inset-0 z-40 bg-transparent cursor-default" aria-label={$t('preferences.closeDropdown')} onclick={() => identityDropdownOpen = false}></button>
          <div class="absolute top-full inset-x-0 mt-1 bg-md-primary-container rounded-xl shadow-lg border border-md-secondary-container z-50 max-h-60 overflow-y-auto">
            <button
              class="w-full px-4 py-2 text-sm text-start hover:bg-md-secondary-container {!selectedIdentityId ? 'font-semibold text-md-primary' : 'text-md-on-surface'}"
              onclick={() => { if (onSetSelectedIdentityId) onSetSelectedIdentityId(null); identityDropdownOpen = false; }}
            >
              {$t('preferences.none')}
            </button>
            {#each identities as identity}
              <button
                class="w-full px-4 py-2 text-sm text-start hover:bg-md-secondary-container {identity.id === selectedIdentityId ? 'font-semibold text-md-primary' : 'text-md-on-surface'}"
                onclick={() => { if (onSetSelectedIdentityId) onSetSelectedIdentityId(identity.id); identityDropdownOpen = false; }}
              >
                {identity.name}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <!-- View All Identities Button -->
    <button
      class="w-full bg-md-secondary-container hover:bg-md-secondary-container/80 text-sm font-medium text-md-on-surface rounded-xl px-2.5 py-2.5 transition-colors"
      onclick={onNavigateToIdentities}
    >
      {$t('preferences.viewAllIdentities')}
    </button>
  </section>

  <!-- ── Mail Provider ── -->
  <section id="settings-section-mail" data-settings-section="mail" class="space-y-2 scroll-mt-2">
    <div class="flex items-center gap-2 mb-1">
      <Icon name="mail" class="w-4 h-4 text-md-primary" />
      <span class="text-sm font-semibold text-md-on-surface">{$t('inbox.title')}</span>
    </div>

    <!-- Mail Provider nav card -->
    <button
      id="setting-providers"
      class="bg-md-primary-container rounded-xl px-2.5 py-2.5 w-full text-start hover:bg-md-primary-container/80 transition-colors border-0"
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

    <!-- Inbox behaviour (moved from Mail Provider page) -->
    <div class="bg-md-primary-container rounded-xl px-2.5 py-2.5 space-y-3">
      <div class="text-xs font-semibold text-md-on-surface/50 uppercase tracking-wider">{$t('mailProvider.inboxBehaviour')}</div>
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-sm font-medium text-md-on-surface">{$t('mailProvider.autoRenew')}</div>
          <div class="text-xs text-md-on-surface/50">{$t('mailProvider.autoRenewDescription')}</div>
        </div>
        <Toggle
          checked={autoRenew}
          ariaLabel={$t('mailProvider.autoRenew')}
          onChange={(next) => {
            onSetAutoRenew?.(next);
            onSaveSettings();
          }}
        />
      </div>
      <div class="h-px bg-md-secondary-container"></div>
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-sm font-medium text-md-on-surface">{$t('preferences.expiryAction')}</div>
          <div class="text-xs text-md-on-surface/50">{$t('preferences.expiryActionDescription')}</div>
        </div>
        <select
          class="text-xs bg-md-surface border border-md-outline-variant rounded-lg px-2 py-1.5 shrink-0 max-w-[48%]"
          value={expiryAction}
          onchange={(e) => {
            const v = (e.target as HTMLSelectElement).value as 'archive' | 'delete';
            expiryAction = v === 'delete' ? 'delete' : 'archive';
            void browser.storage.local.set({ expiryAction });
          }}
        >
          <option value="archive">{$t('preferences.expiryActionArchive')}</option>
          <option value="delete">{$t('preferences.expiryActionDelete')}</option>
        </select>
      </div>
      <div class="h-px bg-md-secondary-container"></div>
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-sm font-medium text-md-on-surface">{$t('mailProvider.autoRefreshInterval')}</div>
          <div class="text-xs text-md-on-surface/50">{$t('mailProvider.autoRefreshDescription')}</div>
        </div>
        <select
          class="text-xs bg-md-surface border border-md-outline-variant rounded-lg px-2 py-1.5 shrink-0"
          value={autoRefreshInterval}
          onchange={(e) => {
            onSetAutoRefreshInterval?.(Number((e.target as HTMLSelectElement).value));
            onSaveSettings();
          }}
        >
          <option value={0}>{$t('mailProvider.manualOnly')}</option>
          <option value={10000}>{$t('mailProvider.tenSeconds')}</option>
          <option value={30000}>{$t('mailProvider.thirtySeconds')}</option>
          <option value={60000}>{$t('mailProvider.oneMinute')}</option>
          <option value={120000}>{$t('mailProvider.twoMinutes')}</option>
          <option value={300000}>{$t('mailProvider.fiveMinutes')}</option>
          <option value={600000}>{$t('mailProvider.tenMinutes')}</option>
        </select>
      </div>
      <div class="h-px bg-md-secondary-container"></div>
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-sm font-medium text-md-on-surface">{$t('mailProvider.emailPreviewTooltip')}</div>
          <div class="text-xs text-md-on-surface/50">{$t('mailProvider.emailPreviewTooltipDescription')}</div>
        </div>
        <Toggle
          checked={emailPreviewEnabled}
          ariaLabel={$t('mailProvider.emailPreviewTooltip')}
          onChange={(next) => {
            onSetEmailPreviewEnabled?.(next);
            onSaveSettings();
          }}
        />
      </div>
    </div>

    <!-- Notifications (moved from Mail Provider page) -->
    <div class="bg-md-primary-container rounded-xl px-2.5 py-2.5 space-y-3">
      <div class="text-xs font-semibold text-md-on-surface/50 uppercase tracking-wider">{$t('mailProvider.notifications')}</div>
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
      <div class="h-px bg-md-secondary-container"></div>
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
      <div class="h-px bg-md-secondary-container"></div>
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-sm text-md-on-surface">{$t('mailProvider.expiryWarning')}</div>
          <div class="text-xs text-md-on-surface/50">{$t('mailProvider.expiryWarningDescription')}</div>
        </div>
        <select
          class="bg-md-secondary-container text-xs text-md-on-surface px-2 py-1.5 rounded-lg outline-none border-0 cursor-pointer font-medium shrink-0"
          value={expiryWarningThreshold}
          onchange={(e) => {
            onSetExpiryWarningThreshold?.(Number((e.target as HTMLSelectElement).value));
            onSaveSettings();
          }}
        >
          <option value={15 * 60 * 1000}>{$t('mailProvider.fifteenMinutes')}</option>
          <option value={5 * 60 * 1000}>{$t('mailProvider.fiveMinutesShort')}</option>
          <option value={60 * 1000}>{$t('mailProvider.oneMinuteShort')}</option>
          <option value={60 * 60 * 1000}>{$t('mailProvider.oneHour')}</option>
        </select>
      </div>
    </div>

    <!-- Keyboard Shortcuts nav card -->
    <button
      id="setting-keybindings"
      class="bg-md-primary-container rounded-xl px-2.5 py-2.5 w-full text-start hover:bg-md-primary-container/80 transition-colors border-0"
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
        {#each [{ k: 'refreshInbox', label: $t('keyboardShortcuts.refreshInbox') }, { k: 'createInbox', label: $t('keyboardShortcuts.createInbox') }, { k: 'copyEmail', label: $t('keyboardShortcuts.copyEmail') }] as row}
          <div class="flex items-center justify-between text-xs text-md-on-surface/60">
            <span>{row.label}</span>
            <span class="font-mono bg-md-secondary-container px-1.5 py-0.5 rounded text-md-on-surface">{formatKeybinding(keybindings[row.k as keyof typeof keybindings])}</span>
          </div>
        {/each}
      </div>
    </button>

    <!-- Tag / Labels / Filters / Mailbox management live under More nav (not Settings) -->
  </section>

  <!-- ── Autofill ── -->
  <section id="settings-section-autofill" data-settings-section="autofill" class="space-y-2 scroll-mt-2">
    <div class="flex items-center gap-2 mb-1">
      <Icon name="lock" class="w-4 h-4 text-md-primary" />
      <span class="text-sm font-semibold text-md-on-surface">{$t('preferences.sectionAutofill')}</span>
    </div>

    <!-- Product boundary: temp-mail autofill, not a password manager -->
    <div class="rounded-xl px-2.5 py-2.5 bg-md-secondary-container/40 border border-md-outline-variant/20">
      <div class="text-xs font-semibold text-md-on-surface">{$t('privacy.notPasswordManagerTitle')}</div>
      <p class="text-label-sm text-md-on-surface/60 mt-0.5">{$t('privacy.notPasswordManagerBody')}</p>
    </div>

    <!-- Clipboard auto-purge (visible privacy control) -->
    <div class="bg-md-primary-container rounded-xl px-2.5 py-2.5 space-y-2">
      <div class="text-sm font-medium text-md-on-surface">{$t('privacy.clipboardTitle')}</div>
      <p class="text-label-sm text-md-on-surface/50">{$t('privacy.clipboardHint')}</p>
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
              const n = Math.max(5, Math.min(300, Number((e.target as HTMLInputElement).value) || 30));
              clipboardPrivacy = { ...clipboardPrivacy, purgeAfterSeconds: n };
              void persistClipboardPrivacy();
            }}
          />
          <span class="text-md-on-surface/50">{$t('privacy.clipboardSeconds')}</span>
        </label>
      {/if}
    </div>

    <!-- Saved-login pick preference for autofill (per domain) -->
    <div class="bg-md-primary-container rounded-xl px-2.5 py-2.5 space-y-2">
      <div class="text-sm font-medium text-md-on-surface">{$t('preferences.autofillLoginPreference')}</div>
      <p class="text-label-sm text-md-on-surface/50">{$t('preferences.autofillLoginPreferenceHint')}</p>
      <div class="flex items-stretch rounded-xl border border-md-outline-variant/40 overflow-hidden">
        <button
          type="button"
          class="flex-1 px-2 py-2 text-label-sm font-semibold transition-colors {autofillLoginPreference === 'recent' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface text-md-on-surface hover:bg-md-surface-variant'}"
          onclick={() => {
            autofillLoginPreference = 'recent';
            void browser.storage.local.set({ autofillLoginPreference: 'recent' });
          }}
        >{$t('preferences.autofillLoginRecent')}</button>
        <span class="w-px bg-md-outline-variant/50 shrink-0" aria-hidden="true"></span>
        <button
          type="button"
          class="flex-1 px-2 py-2 text-label-sm font-semibold transition-colors {autofillLoginPreference === 'listOrder' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface text-md-on-surface hover:bg-md-surface-variant'}"
          onclick={() => {
            autofillLoginPreference = 'listOrder';
            void browser.storage.local.set({ autofillLoginPreference: 'listOrder' });
          }}
        >{$t('preferences.autofillLoginListOrder')}</button>
      </div>
    </div>

    <!-- OTP detection mode -->
    <div class="bg-md-primary-container rounded-xl px-2.5 py-2.5 space-y-2">
      <div class="text-sm font-medium text-md-on-surface">{$t('preferences.otpDetectionMode')}</div>
      <p class="text-label-sm text-md-on-surface/50">{$t('preferences.otpDetectionModeHint')}</p>
      <div class="flex flex-col gap-1">
        {#each [
          ['numeric', 'preferences.otpModeNumeric', 'preferences.otpModeNumericHint'],
          ['balanced', 'preferences.otpModeBalanced', 'preferences.otpModeBalancedHint'],
          ['alphanumeric', 'preferences.otpModeAlphanumeric', 'preferences.otpModeAlphanumericHint'],
        ] as [mode, labelKey, hintKey] (mode)}
          <button
            type="button"
            class="w-full text-start px-3 py-2 rounded-xl border transition-colors {otpDetectionMode === mode ? 'border-md-primary bg-md-primary/10' : 'border-md-outline-variant/40 bg-md-surface hover:bg-md-surface-variant'}"
            onclick={() => {
              otpDetectionMode = mode as typeof otpDetectionMode;
              void browser.storage.local.set({ otpDetectionMode: mode });
            }}
          >
            <div class="text-xs font-semibold text-md-on-surface">{$t(labelKey)}</div>
            <div class="text-xs text-md-on-surface/50">{$t(hintKey)}</div>
          </button>
        {/each}
      </div>
    </div>

    <div class="bg-md-primary-container rounded-xl px-2.5 py-2.5">
      <div class="text-sm font-medium text-md-on-surface mb-1">{$t('settings.autofillBlocklist')}</div>
      <div class="text-xs text-md-on-surface/50 mb-2">{$t('settings.autofillBlocklistDescription')}</div>
      {#if onAddToBlocklist}
        <form
          class="flex gap-2 mb-2"
          onsubmit={(e) => {
            e.preventDefault();
            const domain = newBlocklistDomain.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
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
          <button
            type="submit"
            class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-md-primary text-md-on-primary hover:bg-md-primary/90 shrink-0"
          >
            {$t('settings.addToBlocklist')}
          </button>
        </form>
        {#if currentTabDomain && !autofillBlocklist.includes(currentTabDomain)}
          <button
            type="button"
            class="mb-3 w-full text-start px-2.5 py-1.5 rounded-lg bg-md-secondary-container/60 hover:bg-md-secondary-container text-label-sm text-md-on-surface flex items-center justify-between gap-2 transition-colors"
            onclick={() => {
              void onAddToBlocklist(currentTabDomain);
              newBlocklistDomain = '';
            }}
          >
            <span class="truncate">
              {$t('settings.blocklistSuggestCurrent', { values: { domain: currentTabDomain } })}
            </span>
            <span class="text-md-primary font-semibold shrink-0">{$t('settings.addToBlocklist')}</span>
          </button>
        {:else if currentTabDomain && autofillBlocklist.includes(currentTabDomain)}
          <div class="mb-3 text-xs text-md-on-surface/45 px-1">
            {$t('settings.blocklistCurrentAlreadyAdded', { values: { domain: currentTabDomain } })}
          </div>
        {/if}
      {/if}
      {#if autofillBlocklist.length === 0}
        <div class="text-sm text-md-on-surface/40 py-2">{$t('settings.autofillBlocklistEmpty')}</div>
        <div class="text-xs text-md-on-surface/30">{$t('settings.autofillBlocklistEmptyDescription')}</div>
      {:else}
        <div class="space-y-1">
          {#each autofillBlocklist as domain (domain)}
            <div class="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-md-secondary-container/50 transition-colors">
              <span class="text-sm text-md-on-surface font-mono">{domain}</span>
              {#if onRemoveFromBlocklist}
                <button
                  class="text-xs text-md-error hover:text-md-error/80 px-2 py-0.5 rounded hover:bg-md-error-container/30 transition-colors"
                  onclick={() => onRemoveFromBlocklist(domain)}
                >
                  {$t('settings.removeFromBlocklist')}
                </button>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </section>

  <!-- ── Appearance ── -->
  <section id="settings-section-appearance" data-settings-section="appearance" class="space-y-2 scroll-mt-2">
    <div class="flex items-center gap-2 mb-1">
      <Icon name="sun" class="w-4 h-4 text-md-primary" />
      <span class="text-sm font-semibold text-md-on-surface">{$t('settings.appearance')}</span>
    </div>

    <div id="setting-theme" class="bg-md-primary-container rounded-xl px-2.5 py-2.5 flex items-center justify-between">
      <div>
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

    <!-- Per-Inbox Accent Theme Toggle -->
    <div id="setting-per-inbox-theme" class="bg-md-primary-container rounded-xl px-2.5 py-2.5 flex items-center justify-between">
      <div>
        <div class="text-sm font-medium text-md-on-surface">{$t('preferences.perInboxAccent')}</div>
        <div class="text-xs text-md-on-surface/50">{$t('preferences.perInboxAccentDescription')}</div>
      </div>
      <Toggle
        checked={inboxColorThemeEnabled}
        ariaLabel={$t('preferences.perInboxAccent')}
        onChange={() => onToggleInboxColorTheme()}
      />
    </div>

    <!-- Vault Protection & Security Card -->
    <div id="setting-vault-lock" class="bg-md-primary-container rounded-xl px-2.5 py-2.5 space-y-2">
      <div>
        <div class="text-sm font-medium text-md-on-surface">{$t('preferences.vaultProtection')}</div>
        <div class="text-xs text-md-on-surface/50">{$t('preferences.vaultProtectionDescription')}</div>
      </div>
      <div class="flex items-center gap-1.5 pt-1">
        <button
          class="px-3 py-1.5 text-xs rounded-lg transition-colors {vaultMode === 'standard' ? 'bg-md-primary text-md-on-primary font-semibold' : 'bg-md-secondary-container text-md-on-surface hover:bg-md-secondary-container/80'}"
          onclick={() => handleSetVaultMode('standard')}
        >
          {$t('preferences.vaultStandard')}
        </button>
        <button
          class="px-3 py-1.5 text-xs rounded-lg transition-colors {vaultMode === 'password' ? 'bg-md-primary text-md-on-primary font-semibold' : 'bg-md-secondary-container text-md-on-surface hover:bg-md-secondary-container/80'}"
          onclick={() => handleSetVaultMode('password')}
        >
          {$t('preferences.vaultMasterPassword')}
        </button>
        {#if biometricSupported}
          <button
            class="px-3 py-1.5 text-xs rounded-lg transition-colors {vaultMode === 'biometrics' ? 'bg-md-primary text-md-on-primary font-semibold' : 'bg-md-secondary-container text-md-on-surface hover:bg-md-secondary-container/80'}"
            onclick={() => handleSetVaultMode('biometrics')}
          >
            {$t('preferences.vaultBiometrics')}
          </button>
        {/if}
      </div>
    </div>

    <div id="setting-contrast" class="bg-md-primary-container rounded-xl px-2.5 py-2.5 flex items-center justify-between">
      <div>
        <div class="text-sm font-medium text-md-on-surface">{$t('preferences.contrastLevel')}</div>
        <div class="text-xs text-md-on-surface/50">{$t('preferences.contrastLevelDescription')}</div>
      </div>
      <div class="flex items-center gap-1">
        <button
          class="px-3 py-1.5 text-xs rounded-lg transition-colors {contrastLevel === 'standard' ? 'bg-md-primary text-md-on-primary' : 'bg-md-secondary-container text-md-on-surface hover:bg-md-secondary-container/80'}"
          onclick={() => onContrastLevelChange('standard')}
          aria-label={$t('preferences.standardContrast')}
        >
          {$t('preferences.contrastStandard')}
        </button>
        <button
          class="px-3 py-1.5 text-xs rounded-lg transition-colors {contrastLevel === 'medium' ? 'bg-md-primary text-md-on-primary' : 'bg-md-secondary-container text-md-on-surface hover:bg-md-secondary-container/80'}"
          onclick={() => onContrastLevelChange('medium')}
          aria-label={$t('preferences.mediumContrast')}
        >
          {$t('preferences.contrastMedium')}
        </button>
        <button
          class="px-3 py-1.5 text-xs rounded-lg transition-colors {contrastLevel === 'high' ? 'bg-md-primary text-md-on-primary' : 'bg-md-secondary-container text-md-on-surface hover:bg-md-secondary-container/80'}"
          onclick={() => onContrastLevelChange('high')}
          aria-label={$t('preferences.highContrast')}
        >
          {$t('preferences.contrastHigh')}
        </button>
      </div>
    </div>
  </section>

  <!-- ── Developer Settings ── -->
  <section id="settings-section-developer" data-settings-section="developer" class="space-y-2 scroll-mt-2">
    <div class="flex items-center gap-2 mb-1">
      <Icon name="settings" class="w-4 h-4 text-md-primary" />
      <span class="text-sm font-semibold text-md-on-surface">{$t('settings.developer')}</span>
    </div>

    <div id="setting-developer" class="bg-md-primary-container rounded-xl px-2.5 py-2.5 flex items-center justify-between">
      <div>
        <div class="text-sm font-medium text-md-on-surface">{$t('preferences.showDeveloperOptions')}</div>
        <div class="text-xs text-md-on-surface/50">{$t('preferences.showDeveloperOptionsDescription')}</div>
      </div>
      <Toggle
        checked={showDeveloperSettings}
        ariaLabel={$t('preferences.toggleDeveloperSettings')}
        onChange={() => onToggleDeveloperSettings()}
      />
    </div>

    {#if showDeveloperSettings}
      <div id="setting-logging" class="bg-md-primary-container rounded-xl px-2.5 py-2.5 flex items-center justify-between">
        <div>
          <div class="text-sm font-medium text-md-on-surface">{$t('preferences.enableLogging')}</div>
          <div class="text-xs text-md-on-surface/50">{$t('preferences.enableLoggingDescription')}</div>
        </div>
        <Toggle
          checked={enableLogging}
          ariaLabel={$t('preferences.toggleLogging')}
          onChange={() => onToggleEnableLogging()}
        />
      </div>

      <button
        id="setting-constants"
        type="button"
        class="w-full flex items-center justify-between px-2.5 py-2.5 bg-md-surface-container rounded-xl hover:bg-md-surface-variant/40 transition-colors border border-md-outline-variant/30"
        onclick={onNavigateToConstantsSettings}
      >
        <div class="text-start">
          <div class="text-sm font-medium text-md-on-surface">Manage Constant Overrides</div>
          <div class="text-xs text-md-on-surface/50">View & modify magic numbers, intervals, & timeouts</div>
        </div>
        <Icon name="chevronRight" class="w-4 h-4 text-md-on-surface/60 rtl-flip" />
      </button>

      <button
        id="setting-playground"
        type="button"
        class="w-full flex items-center justify-between px-2.5 py-2.5 bg-md-surface-container rounded-xl hover:bg-md-surface-variant/40 transition-colors border border-md-outline-variant/30"
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
    <div class="bg-md-primary-container rounded-xl px-2.5 py-2.5 space-y-2">
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-sm font-medium text-md-on-surface">{$t('preferences.demoMode')}</div>
          <p class="text-label-sm text-md-on-surface/50">{$t('preferences.demoModeHint')}</p>
        </div>
        <Toggle
          checked={demoMode}
          ariaLabel={$t('preferences.demoMode')}
          onChange={async (on) => {
            demoMode = on;
            const { setDemoMode } = await import('@/features/demo/demo-mode.js');
            await setDemoMode(browser, on);
            try {
              await browser.storage.local.set({ demoMode: on });
            } catch {
              /* ignore */
            }
            if (on) {
              toastStore.success($t('preferences.demoModeEnabled'));
              // Product tour after demo loads (AppLayout listens for pendingProductTour)
              try {
                await browser.storage.local.set({
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
      </div>
      {#if demoMode}
        <p class="text-label-sm text-md-on-surface/55">{$t('preferences.demoTourHint')}</p>
        <button
          type="button"
          class="w-full py-2 rounded-xl text-xs font-semibold bg-md-secondary-container text-md-on-surface"
          onclick={async () => {
            try {
              await browser.storage.local.set({
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
            await simulateDemoReceive(browser);
            toastStore.success($t('preferences.demoSimulatedReceive'));
          }}
        >{$t('preferences.demoSimulateReceive')}</button>
      {/if}
    </div>
  </section>

  <!-- ── Search history ── -->
  <section id="settings-section-search" data-settings-section="search" class="space-y-2 scroll-mt-2">
    <div class="flex items-center gap-2 mb-1">
      <Icon name="clock" class="w-4 h-4 text-md-primary" />
      <span class="text-sm font-semibold text-md-on-surface">{$t('searchHistory.settingsTitle')}</span>
    </div>
    <div class="bg-md-primary-container rounded-xl px-2.5 py-2.5 flex items-center justify-between gap-3">
      <div class="min-w-0">
        <div class="text-sm font-medium text-md-on-surface">{$t('searchHistory.limitLabel')}</div>
        <div class="text-xs text-md-on-surface/50">{$t('searchHistory.limitHint')}</div>
      </div>
      <select
        class="text-xs rounded-lg border border-md-outline-variant/40 bg-md-surface text-md-on-surface px-2 py-1.5 shrink-0"
        value={String(searchHistoryLimit)}
        onchange={async (e) => {
          const n = Number((e.currentTarget as HTMLSelectElement).value);
          searchHistoryLimit = await setSearchHistoryLimit(n);
        }}
      >
        {#each [3, 5, 8, 10, 15, 20] as n (n)}
          <option value={String(n)}>{n}</option>
        {/each}
      </select>
    </div>
    <div class="bg-md-primary-container rounded-xl px-2.5 py-2.5 flex items-center justify-between gap-3">
      <div class="min-w-0">
        <div class="text-sm font-medium text-md-on-surface">{$t('preferences.voiceSearch')}</div>
        <div class="text-xs text-md-on-surface/50">{$t('preferences.voiceSearchDescription')}</div>
      </div>
      <Toggle
        checked={voiceSearchEnabled}
        ariaLabel={$t('preferences.voiceSearch')}
        onChange={async (next) => {
          voiceSearchEnabled = next;
          await browser.storage.local.set({ voiceSearchEnabled: next });
        }}
      />
    </div>
    <div class="bg-md-primary-container rounded-xl px-2.5 py-2.5 flex items-center justify-between gap-3">
      <div class="min-w-0">
        <div class="text-sm font-medium text-md-on-surface">{$t('preferences.density')}</div>
        <div class="text-xs text-md-on-surface/50">{$t('preferences.densityDescription')}</div>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        <button
          type="button"
          class="px-2.5 py-1.5 text-xs rounded-lg font-semibold transition-colors {(typeof window !== 'undefined' ? true : true) && true
            ? ''
            : ''} {densityLocal === 'comfortable'
            ? 'bg-md-primary text-md-on-primary'
            : 'bg-md-secondary-container text-md-on-surface'}"
          onclick={async () => {
            densityLocal = 'comfortable';
            await browser.storage.local.set({ uiDensity: 'comfortable' });
          }}
        >{$t('preferences.densityComfortable')}</button>
        <button
          type="button"
          class="px-2.5 py-1.5 text-xs rounded-lg font-semibold transition-colors {densityLocal === 'compact'
            ? 'bg-md-primary text-md-on-primary'
            : 'bg-md-secondary-container text-md-on-surface'}"
          onclick={async () => {
            densityLocal = 'compact';
            await browser.storage.local.set({ uiDensity: 'compact' });
          }}
        >{$t('preferences.densityCompact')}</button>
      </div>
    </div>
  </section>

  <!-- ── Diagnostics ── -->
  <section id="settings-section-diagnostics" data-settings-section="diagnostics" class="space-y-2 scroll-mt-2">
    <div class="flex items-center gap-2 mb-1">
      <Icon name="info" class="w-4 h-4 text-md-primary" />
      <span class="text-sm font-semibold text-md-on-surface">{$t('diagnostics.title')}</span>
    </div>
    <button
      type="button"
      class="w-full flex items-center justify-between px-2.5 py-2.5 bg-md-surface-container rounded-xl hover:bg-md-surface-variant/40 transition-colors border border-md-outline-variant/30"
      onclick={() => onNavigateToDiagnostics()}
    >
      <div class="text-start">
        <div class="text-sm font-medium text-md-on-surface">{$t('diagnostics.menuTitle')}</div>
        <div class="text-xs text-md-on-surface/50 mt-0.5">{$t('diagnostics.menuDescription')}</div>
      </div>
      <Icon name="chevronRight" class="w-4 h-4 text-md-on-surface/60 rtl-flip" />
    </button>
  </section>

  <!-- ── Data ── -->
  <section id="settings-section-data" data-settings-section="data" class="space-y-2 scroll-mt-2">
    <div class="flex items-center gap-2 mb-1">
      <Icon name="database" class="w-4 h-4 text-md-primary" />
      <span class="text-sm font-semibold text-md-on-surface">{$t('preferences.exportData') || 'Data Management'}</span>
    </div>
    <div
      class="w-full px-2.5 py-1.5 rounded-lg bg-md-surface-variant/50 border border-md-outline-variant/30 text-label-sm text-md-on-surface/70 flex items-center gap-1.5"
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
    <div class="flex gap-2">
      <button class="flex-1 px-3 py-1.5 text-sm rounded-xl border border-md-primary text-md-primary hover:bg-md-primary/10 transition-colors" aria-label={$t('preferences.exportDataAria')} onclick={onExportData}>{$t('preferences.exportData')}</button>
      <button class="flex-1 px-3 py-1.5 text-sm rounded-xl border border-md-primary text-md-primary hover:bg-md-primary/10 transition-colors" aria-label={$t('preferences.importDataAria')} onclick={onImportData}>{$t('preferences.importData')}</button>
    </div>
    {#if onStartProductTour}
      <button
        type="button"
        class="w-full mt-2 px-3 py-1.5 text-sm rounded-xl border border-md-outline-variant text-md-on-surface hover:bg-md-surface-variant/50 transition-colors flex items-center justify-center gap-2"
        onclick={() => onStartProductTour()}
      >
        <Icon name="info" class="w-4 h-4 text-md-primary" />
        {$t('productTour.replay')}
      </button>
    {/if}
    {#if onExportCategory}
      <div class="flex flex-wrap gap-1.5">
        <span class="text-xs text-md-on-surface/50 w-full">Export category:</span>
        <button class="px-2 py-1 text-label-sm rounded-lg border border-md-outline-variant text-md-on-surface/70 hover:bg-md-surface-variant/50 transition-colors" onclick={() => onExportCategory('settings')}>Settings</button>
        <button class="px-2 py-1 text-label-sm rounded-lg border border-md-outline-variant text-md-on-surface/70 hover:bg-md-surface-variant/50 transition-colors" onclick={() => onExportCategory('identities')}>Identities</button>
        <button class="px-2 py-1 text-label-sm rounded-lg border border-md-outline-variant text-md-on-surface/70 hover:bg-md-surface-variant/50 transition-colors" onclick={() => onExportCategory('savedLogins')}>Saved Logins</button>
        <button class="px-2 py-1 text-label-sm rounded-lg border border-md-outline-variant text-md-on-surface/70 hover:bg-md-surface-variant/50 transition-colors" onclick={() => onExportCategory('inboxes')}>Inboxes</button>
      </div>
    {/if}
  </section>

  <!-- ── Danger Zone ── -->
  <section id="settings-section-danger" data-settings-section="danger" class="rounded-xl border border-md-error/30 bg-md-error/5 px-2.5 py-3 space-y-2 scroll-mt-2">
    <div class="text-sm font-bold text-md-error">{$t('preferences.dangerZone')}</div>
    <div class="text-xs text-md-on-surface/50">{$t('preferences.dangerZoneDescription')}</div>
    <button class="w-full px-3 py-1.5 text-sm rounded-xl border border-md-error text-md-error hover:bg-md-error/10 mt-1 font-semibold transition-colors" aria-label={$t('preferences.performHardReset')} onclick={() => showConfirmDialog($t('preferences.hardResetConfirm'), onHardReset)}>{$t('preferences.hardReset')}</button>
  </section>

  </div>

  </div>

  {#if settingsSearchQuery}
    <div style="display: none;" class="hidden-search-sandbox hidden">
      <div data-settings-subpage="keybindings">
        <KeyboardShortcutsView keybindings={keybindings || DEFAULT_KEYBINDINGS} />
      </div>
      <div data-settings-subpage="tagManagement">
        <TagManagementView allInboxes={allInboxes || []} />
      </div>
      <div data-settings-subpage="filtersManagement">
        <FiltersManagementView savedSearchFilters={[]} />
      </div>
      <div data-settings-subpage="mailProvider">
        <MailProviderView
          selectedProvider={selectedProvider}
          autoRenew={autoRenew}
          notificationsEnabled={notificationsEnabled}
          soundEnabled={soundEnabled}
          expiryWarningThreshold={expiryWarningThreshold}
          autoRefreshInterval={autoRefreshInterval}
          emailPreviewEnabled={emailPreviewEnabled}
          providerInstances={providerInstances || []}
          selectedProviderInstance={selectedProviderInstance}
          defaultDomain={defaultDomain}
          allInboxes={allInboxes || []}
          onProviderChange={onProviderChange}
          onSetAutoRenew={onSetAutoRenew}
          onSetNotificationsEnabled={onSetNotificationsEnabled}
          onSetSoundEnabled={onSetSoundEnabled}
          onSetExpiryWarningThreshold={onSetExpiryWarningThreshold}
          onSetAutoRefreshInterval={onSetAutoRefreshInterval}
          onSetEmailPreviewEnabled={onSetEmailPreviewEnabled}
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
      <div data-settings-subpage="labelManagement">
        <LabelManagementView />
      </div>
      <div data-settings-subpage="mailboxManagement">
        <AddressesView />
      </div>
      <div data-settings-subpage="constantsSettings">
        <ConstantsSettingsView />
      </div>
      <div data-settings-subpage="identities">
        <IdentitiesView
          {context}
          savedLogins={[]}
          mailboxAddresses={allInboxes.map((a) => a.address).filter(Boolean)}
          activeMailboxAddress={allInboxes.find((a) => a.accountStatus === 'active' || !a.accountStatus)?.address || allInboxes[0]?.address || ''}
        />
      </div>
    </div>
  {/if}

  {/snippet}
</ErrorBoundary>
{/if}

<ConfirmDialog {confirmDialog} confirmDialogRef={confirmDialogRef} onClose={closeConfirmDialog} />

<MasterPasswordModal
  isOpen={isPasswordModalOpen}
  onClose={() => isPasswordModalOpen = false}
  onSave={handleSaveMasterPassword}
/>

<ToastContainer />

<style>
  :global(.animate-pulse-highlight) {
    animation: pulse-highlight 1.8s cubic-bezier(0.4, 0, 0.2, 1) 1;
  }

  @keyframes pulse-highlight {
    0%, 100% {
      box-shadow: 0 0 0 2px var(--md-sys-color-primary, #6750A4), 0 0 0 4px rgba(103, 80, 164, 0.4);
    }
    50% {
      box-shadow: 0 0 0 4px var(--md-sys-color-primary, #6750A4), 0 0 0 8px rgba(103, 80, 164, 0.1);
    }
  }

  /* Multi-column setting cards when the settings pane is wide enough */
  .settings-wide-cols :global(section[data-settings-section]) {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.5rem;
  }
  .settings-wide-cols :global(section[data-settings-section] > .flex.items-center.gap-2.mb-1),
  .settings-wide-cols :global(section[data-settings-section] > .flex.items-center.gap-2) {
    grid-column: 1 / -1;
  }
  @media (min-width: 720px) {
    .settings-wide-cols :global(section[data-settings-section]:not([data-settings-section='danger'])) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (min-width: 1100px) {
    .settings-wide-cols :global(section[data-settings-section]:not([data-settings-section='danger'])) {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
</style>
