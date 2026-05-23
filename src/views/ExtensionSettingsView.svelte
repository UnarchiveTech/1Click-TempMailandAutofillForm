<script lang="ts">
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import ToastContainer from '@/components/feedback/ToastContainer.svelte';
import IconArchive from '@/components/icons/IconArchive.svelte';
import IconChevronDown from '@/components/icons/IconChevronDown.svelte';
import IconMail from '@/components/icons/IconMail.svelte';
import IconPlus from '@/components/icons/IconPlus.svelte';
import IconRefresh from '@/components/icons/IconRefresh.svelte';
import IconSettings from '@/components/icons/IconSettings.svelte';
import IconSun from '@/components/icons/IconSun.svelte';
import IconUser from '@/components/icons/IconUser.svelte';
import IconX from '@/components/icons/IconX.svelte';
import ConfirmDialog from '@/components/overlays/ConfirmDialog.svelte';
import ErrorBoundary from '@/components/ui/ErrorBoundary.svelte';
import LanguageSwitcher from '@/components/ui/LanguageSwitcher.svelte';
import {
  getAllProviderConfigs,
  loadProviderConfig,
  type ProviderConfig,
} from '@/utils/email-service.js';
import { setupFocusTrap } from '@/utils/focusTrap.js';
import { logError } from '@/utils/logger.js';
import * as PingService from '@/utils/ping-service.js';
import { toastStore } from '@/utils/toastStore.js';
import type { Identity, ProviderInstance } from '@/utils/types.js';

let {
  context = 'popup',
  onBack = () => {},
  useCustomPassword = false,
  customPassword = '',
  useCustomName = false,
  customFirstName = '',
  customLastName = '',
  autoCopy = false,
  autoRenew = false,
  selectedProvider = '',
  savingSettings = false,
  loading = false,
  onSaveSettings = () => {},
  onSetUseCustomPassword = undefined,
  onSetCustomPassword = undefined,
  onSetUseCustomName = undefined,
  onSetCustomFirstName = undefined,
  onSetCustomLastName = undefined,
  onSetAutoCopy = undefined,
  onSetAutoRenew = undefined,
  onHardReset = () => {},
  providerInstances = [],
  selectedProviderInstance = null,
  onSetProviderInstance = () => {},
  onExportData = () => {},
  onImportData = () => {},
  onProviderChange = () => {},
  onAddCustomInstance = () => {},
  onLoadProviderInstances = () => {},
  customColor = '',
  onColorChange = () => {},
  showDeveloperSettings = false,
  enableLogging = false,
  onToggleDeveloperSettings = () => {},
  onToggleEnableLogging = () => {},
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
}: {
  context?: 'popup' | 'sidepanel' | 'app';
  onBack?: () => void;
  useCustomPassword?: boolean;
  customPassword?: string;
  useCustomName?: boolean;
  customFirstName?: string;
  customLastName?: string;
  autoCopy?: boolean;
  autoRenew?: boolean;
  selectedProvider?: string;
  savingSettings?: boolean;
  loading?: boolean;
  onSaveSettings?: () => void;
  onSetUseCustomPassword?: (value: boolean) => void;
  onSetCustomPassword?: (value: string) => void;
  onSetUseCustomName?: (value: boolean) => void;
  onSetCustomFirstName?: (value: string) => void;
  onSetCustomLastName?: (value: string) => void;
  onSetAutoCopy?: (value: boolean) => void;
  onSetAutoRenew?: (value: boolean) => void;
  onHardReset?: () => void;
  providerInstances?: ProviderInstance[];
  selectedProviderInstance?: string | null;
  onSetProviderInstance?: (instanceId: string) => void;
  onExportData?: () => void;
  onImportData?: () => void;
  onProviderChange?: (provider: string) => void;
  onAddCustomInstance?: (name: string, url: string) => void;
  onLoadProviderInstances?: () => void;
  customColor?: string;
  onColorChange?: (color: string) => void;
  showDeveloperSettings?: boolean;
  enableLogging?: boolean;
  onToggleDeveloperSettings?: () => void;
  onToggleEnableLogging?: () => void;
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
} = $props();

let showCustomInstanceForm = $state(false);
let customInstanceName = $state('');
let customInstanceUrl = $state('');
let confirmDialog = $state<{ message: string; onConfirm: () => void } | null>(null);
let confirmDialogRef = $state<HTMLElement | null>(null);
let allProviders = $derived.by((): ProviderConfig[] => getAllProviderConfigs());

// Ping state
let providerPingResults = $state(new Map<string, Map<string, number | 'timeout'>>());
let pinging = $state(false);

// Storage usage state
let storageUsage = $state<{
  totalMB: number;
  breakdown: Record<string, number>;
  categories: { emails: number; settings: number; cached: number; other: number };
} | null>(null);
let loadingStorage = $state(false);
let emailsToBeDeleted = $state<{
  activeEmails: number;
  archivedEmails: number;
  totalEmails: number;
} | null>(null);
let loadingEmailsCount = $state(false);
let clearingEmails = $state(false);

async function loadStorageUsage() {
  loadingStorage = true;
  try {
    const response = await browser.runtime.sendMessage({ action: 'getStorageUsage' });
    if (response?.success) {
      storageUsage = response.usage;
    }
  } catch (e) {
    logError('Failed to load storage usage', e);
  } finally {
    loadingStorage = false;
  }
}

async function loadEmailsToBeDeleted() {
  loadingEmailsCount = true;
  try {
    const response = await browser.runtime.sendMessage({
      action: 'getEmailsToBeDeleted',
      retentionDays: emailRetentionDays,
    });
    if (response?.success) {
      emailsToBeDeleted = response.count;
    }
  } catch (e) {
    logError('Failed to load emails to be deleted', e);
  } finally {
    loadingEmailsCount = false;
  }
}

async function clearOldEmails() {
  clearingEmails = true;
  try {
    const response = await browser.runtime.sendMessage({
      action: 'cleanupOldStoredEmails',
      activeRetentionDays: emailRetentionDays,
      archivedRetentionDays: emailRetentionDays,
    });
    if (response?.success) {
      toastStore.success('Old emails cleared successfully');
      await loadStorageUsage();
      await loadEmailsToBeDeleted();
    } else {
      toastStore.error('Failed to clear old emails');
    }
  } catch (e) {
    logError('Failed to clear old emails', e);
    toastStore.error('Failed to clear old emails');
  } finally {
    clearingEmails = false;
  }
}

$effect(() => {
  loadStorageUsage();
  loadEmailsToBeDeleted();
});

// Reload email count when retention changes
$effect(() => {
  loadEmailsToBeDeleted();
});

function showConfirmDialog(message: string, onConfirm: () => void) {
  confirmDialog = { message, onConfirm };
  if (confirmDialogRef) {
    confirmDialogRef.focus();
  }
}

function closeConfirmDialog() {
  confirmDialog = null;
}

async function handleProviderChange(provider: string) {
  await browser.storage.local.set({ selectedProvider: provider });
  await browser.runtime.sendMessage({ action: 'setProvider', provider });
  onProviderChange(provider);
  const config = loadProviderConfig(provider);
  if (config.multiInstance?.enabled) {
    await onLoadProviderInstances();
  }
}

$effect(() => {
  const config = loadProviderConfig(selectedProvider);
  if (config.multiInstance?.enabled) {
    onLoadProviderInstances();
  }
});

function showAddCustomInstance() {
  showCustomInstanceForm = true;
  customInstanceName = '';
  customInstanceUrl = '';
}

function hideCustomInstanceForm() {
  showCustomInstanceForm = false;
  customInstanceName = '';
  customInstanceUrl = '';
}

function saveCustomInstance() {
  const name = customInstanceName.trim();
  const url = customInstanceUrl.trim();
  if (!name || !url) {
    return;
  }
  onAddCustomInstance(name, url);
  hideCustomInstanceForm();
}

// Dropdown state
let providerDropdownOpen = $state(false);
let instanceDropdownOpen = $state(false);
let retentionDropdownOpen = $state(false);
let faviconCachingDropdownOpen = $state(false);
let identityDropdownOpen = $state(false);
let faviconCacheCount = $state(0);
let totalCacheSize = $state(0);

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Math.round((bytes / k ** i) * 100) / 100} ${sizes[i]}`;
}

function updateFaviconCacheCount() {
  try {
    const cache = localStorage.getItem('favicon_success_cache');
    if (cache) {
      const parsed = JSON.parse(cache);
      // Count all cached entries (both with webpDataUrl and url)
      const cachedCount = Object.keys(parsed).length;
      faviconCacheCount = cachedCount;

      // Calculate total cache size based on localStorage item size
      totalCacheSize = cache.length;
    } else {
      faviconCacheCount = 0;
      totalCacheSize = 0;
    }
  } catch {
    faviconCacheCount = 0;
    totalCacheSize = 0;
  }
}

// Update cache count when component mounts and when favicon caching mode changes
$effect(() => {
  updateFaviconCacheCount();
});

// Listen for storage changes to update cache count
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === 'favicon_success_cache') {
      updateFaviconCacheCount();
    }
  });
}

const retentionOptions = [
  { value: 0, label: 'Never delete' },
  { value: 7, label: '7 days' },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' },
  { value: 60, label: '60 days' },
  { value: 90, label: '90 days' },
  { value: 180, label: '6 months' },
  { value: 365, label: '1 year' },
];

// Ping all providers and instances
async function pingAllProviders() {
  if (pinging) return;
  pinging = true;

  const results = new Map<string, Map<string, number | 'timeout'>>();

  for (const provider of allProviders) {
    const providerId = provider.id;

    const config = loadProviderConfig(providerId);

    if (config.multiInstance?.enabled && providerInstances.length > 0) {
      // Ping instances for multi-instance providers
      const pingResults = await PingService.pingProviderInstances(config, providerInstances);
      results.set(providerId, pingResults);
    } else {
      // Ping single-instance providers
      const pingResults = await PingService.pingProviderInstances(config, []);
      results.set(providerId, pingResults);
    }
  }

  providerPingResults = results;
  pinging = false;
}

/**
 * Get ping dot emoji based on latency
 */
function getPingDot(ping: number | 'timeout'): string {
  if (ping === 'timeout') return '🔴';
  if (ping < 100) return '🟢';
  if (ping < 300) return '🟡';
  return '🔴';
}
$effect(() => {
  // Small delay to ensure props are loaded
  setTimeout(() => {
    pingAllProviders();
  }, 100);
});
</script>

{#if loading}
  <div class="flex-1 overflow-y-auto px-4 py-4 space-y-4" style="scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--md-outline, #75777f) 0.2, transparent) transparent;">
    {#each [1,2,3,4,5] as _}
      <div class="rounded-xl bg-md-primary-container p-4 space-y-2 animate-pulse">
        <div class="h-3 w-24 bg-md-outline-variant rounded"></div>
        <div class="h-8 w-full bg-md-outline-variant rounded"></div>
      </div>
    {/each}
  </div>
{:else}
<ErrorBoundary fallback="Failed to load settings">
  {#snippet children()}
    <div class="flex-1 overflow-y-auto px-4 py-4 space-y-5 pb-20" style="scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--md-outline, #75777f) 0.2, transparent) transparent;">

  <!-- Page heading -->
  <div class="pt-1">
    <h1 class="text-lg font-bold text-md-on-surface">Preferences</h1>
    <p class="text-xs text-md-on-surface/50 mt-0.5">Configure your extension identity.</p>
  </div>

  <!-- ── General ── -->
  <section class="space-y-2">
    <div class="flex items-center gap-2 mb-1">
      <IconSettings class="w-4 h-4 text-md-primary" />
      <span class="text-sm font-semibold text-md-on-surface">General</span>
    </div>

    <!-- Language Switcher -->
    <div class="bg-md-primary-container rounded-xl px-4 py-3 flex items-center justify-between">
      <div>
        <div class="text-sm font-medium text-md-on-surface">Language</div>
        <div class="text-xs text-md-on-surface/50">Select your preferred language</div>
      </div>
      <LanguageSwitcher />
    </div>

    <!-- Auto-Copy row -->
    <div class="bg-md-primary-container rounded-xl px-4 py-3 flex items-center justify-between">
      <div>
        <div class="text-sm font-medium text-md-on-surface">{$t('settings.autoCopy')}</div>
        <div class="text-xs text-md-on-surface/50">{$t('settings.autoCopyDescription')}</div>
      </div>
      <label class="cursor-pointer">
        <input type="checkbox" class="sr-only peer" aria-label="Toggle auto-copy" checked={autoCopy} onchange={(e) => { if (onSetAutoCopy) onSetAutoCopy((e.target as HTMLInputElement).checked); onSaveSettings(); }} />
        <div class="relative w-9 h-5 bg-md-outline-variant peer-checked:bg-md-primary rounded-full peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
      </label>
    </div>

    <!-- Favicon Caching row -->
    <div class="bg-md-primary-container rounded-xl px-4 py-3">
      <div class="text-sm font-medium text-md-on-surface mb-1">Favicon Caching</div>
      <div class="text-xs text-md-on-surface/50 mb-2">Store favicons locally as WebP images (32x32) to reduce network requests</div>
      <div class="text-xs text-md-on-surface/60 mb-2">
        {faviconCacheCount} favicon{faviconCacheCount === 1 ? '' : 's'} cached locally ({formatBytes(totalCacheSize)})
      </div>
      <div class="flex items-center justify-between">
        <div class="text-xs text-md-on-surface/60">
          {#if faviconCaching === 'local'}
            Local storage (24h expiry)
          {:else}
            Direct from source
          {/if}
        </div>
        <div class="relative">
          <button
            class="bg-md-secondary-container text-sm text-md-on-surface px-3 py-1.5 rounded-lg outline-none border-0 cursor-pointer font-medium flex items-center gap-2"
            onclick={() => faviconCachingDropdownOpen = !faviconCachingDropdownOpen}
            aria-label="Select favicon caching mode"
          >
            <span>{faviconCaching === 'local' ? 'Local' : 'Direct'}</span>
            <IconChevronDown class="w-3.5 h-3.5" />
          </button>
          {#if faviconCachingDropdownOpen}
            <button class="fixed inset-0 z-40 bg-transparent cursor-default" aria-label="Close dropdown" onclick={() => faviconCachingDropdownOpen = false}></button>
            <div class="absolute top-full right-0 mt-1 bg-md-primary-container rounded-xl shadow-lg border border-md-secondary-container z-50 min-w-[130px] overflow-hidden">
              <button
                class="w-full px-4 py-2 text-sm text-left hover:bg-md-secondary-container {faviconCaching === 'direct' ? 'font-semibold text-md-primary' : 'text-md-on-surface'}"
                onclick={() => {
                  if (onSetFaviconCaching) {
                    onSetFaviconCaching('direct');
                    onSaveSettings();
                  }
                  faviconCachingDropdownOpen = false;
                }}
              >
                Direct
              </button>
              <button
                class="w-full px-4 py-2 text-sm text-left hover:bg-md-secondary-container {faviconCaching === 'local' ? 'font-semibold text-md-primary' : 'text-md-on-surface'}"
                onclick={() => {
                  if (onSetFaviconCaching) {
                    onSetFaviconCaching('local');
                    onSaveSettings();
                  }
                  faviconCachingDropdownOpen = false;
                }}
              >
                Local
              </button>
            </div>
          {/if}
        </div>
      </div>
    </div>
  </section>

  <!-- ── Identity ── -->
  <section class="space-y-2">
    <div class="flex items-center gap-2 mb-1">
      <IconUser class="w-4 h-4 text-md-primary" />
      <span class="text-sm font-semibold text-md-on-surface">{$t('identities.title')}</span>
    </div>

    <!-- Default Identity for Autofill -->
    <div class="bg-md-primary-container rounded-xl px-4 py-3">
      <div class="text-sm font-medium text-md-on-surface mb-2">Default for Autofill</div>
      <div class="relative">
        <button
          class="w-full bg-transparent text-sm outline-none text-md-on-surface appearance-none cursor-pointer font-medium flex items-center justify-between"
          onclick={() => identityDropdownOpen = !identityDropdownOpen}
          aria-label="Select default identity for autofill"
          disabled={identities.length === 0}
        >
          <span class={identities.length === 0 ? 'text-md-on-surface/40' : ''}>
            {#if identities.length === 0}
              No identities created yet
            {:else}
              {identities.find(i => i.id === selectedIdentityId)?.name ?? 'None'}
            {/if}
          </span>
          {#if identities.length > 0}
            <IconChevronDown class="w-4 h-4 ml-2" />
          {/if}
        </button>
        {#if identityDropdownOpen && identities.length > 0}
          <button class="fixed inset-0 z-40 bg-transparent cursor-default" aria-label="Close dropdown" onclick={() => identityDropdownOpen = false}></button>
          <div class="absolute top-full left-0 right-0 mt-1 bg-md-primary-container rounded-xl shadow-lg border border-md-secondary-container z-50 max-h-60 overflow-y-auto">
            <button
              class="w-full px-4 py-2 text-sm text-left hover:bg-md-secondary-container {!selectedIdentityId ? 'font-semibold text-md-primary' : 'text-md-on-surface'}"
              onclick={() => { if (onSetSelectedIdentityId) onSetSelectedIdentityId(null); identityDropdownOpen = false; }}
            >
              None
            </button>
            {#each identities as identity}
              <button
                class="w-full px-4 py-2 text-sm text-left hover:bg-md-secondary-container {identity.id === selectedIdentityId ? 'font-semibold text-md-primary' : 'text-md-on-surface'}"
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
      class="w-full bg-md-secondary-container hover:bg-md-secondary-container/80 text-sm font-medium text-md-on-surface rounded-xl px-4 py-3 transition-colors"
      onclick={onNavigateToIdentities}
    >
      View All Identities
    </button>
  </section>

  <!-- ── Mail ── -->
  <section class="space-y-2">
    <div class="flex items-center justify-between mb-1">
      <div class="flex items-center gap-2">
        <IconMail class="w-4 h-4 text-md-primary" />
        <span class="text-sm font-semibold text-md-on-surface">{$t('inbox.title')}</span>
      </div>
      <button
        class="w-6 h-6 flex items-center justify-center rounded-full bg-transparent hover:bg-md-secondary-container transition-colors"
        aria-label="Refresh ping"
        onclick={() => {
          providerPingResults.clear();
          pingAllProviders();
        }}
      >
        <IconRefresh class="w-4 h-4" />
      </button>
    </div>

    <div class="bg-md-primary-container rounded-xl px-4 py-3">
      <div class="text-xs font-semibold text-md-secondary uppercase tracking-wider mb-1.5">{$t('settings.provider')}</div>
      <div class="relative">
        <button
          class="w-full bg-transparent text-sm outline-none text-md-on-surface appearance-none cursor-pointer font-medium flex items-center justify-between"
          onclick={() => providerDropdownOpen = !providerDropdownOpen}
          aria-label="Select mail provider"
        >
          <span>
            {#each allProviders as provider}
              {#if provider.id === selectedProvider}
                {@const pingResults = providerPingResults.get(selectedProvider)}
                {@const fastestPing = pingResults ? PingService.getFastestPing(pingResults) : null}
                {provider.displayName}
                {#if fastestPing !== null && fastestPing !== undefined}
                  <span class="text-xs text-md-on-surface/50 ml-2">{getPingDot(fastestPing)} {PingService.formatPing(fastestPing)}</span>
                {:else}
                  <span class="text-xs text-md-on-surface/50 ml-2">⏳</span>
                {/if}
              {/if}
            {/each}
          </span>
          <IconChevronDown class="w-4 h-4 ml-2" />
        </button>
        {#if providerDropdownOpen}
          <div class="absolute top-full left-0 right-0 mt-1 bg-md-primary-container rounded-xl shadow-lg border border-md-secondary-container z-50 max-h-60 overflow-y-auto">
            {#each allProviders as provider}
              {@const providerId = provider.id}
              {@const pingResults = providerPingResults.get(providerId)}
              {@const fastestPing = pingResults ? PingService.getFastestPing(pingResults) : null}
              <button
                class="w-full px-4 py-2 text-sm text-left hover:bg-md-secondary-container flex items-center justify-between"
                onclick={() => {
                  selectedProvider = providerId;
                  handleProviderChange(providerId);
                  providerDropdownOpen = false;
                }}
              >
                <span>{provider.displayName}</span>
                {#if fastestPing !== null && fastestPing !== undefined}
                  <span class="text-xs text-md-on-surface/50">{getPingDot(fastestPing)} {PingService.formatPing(fastestPing)}</span>
                {:else}
                  <span class="text-xs text-md-on-surface/50">⏳</span>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <!-- Auto-Renew row -->
    <div class="bg-md-primary-container rounded-xl px-4 py-3 flex items-center justify-between">
      <div>
        <div class="text-sm font-medium text-md-on-surface">{$t('settings.autoRenew')}</div>
        <div class="text-xs text-md-on-surface/50">{$t('settings.autoRenewDescription')}</div>
      </div>
      <button
        class="w-8 h-8 flex items-center justify-center rounded-xl border-0 {autoRenew ? 'bg-md-primary/10 hover:bg-md-primary/20 text-md-primary' : 'bg-md-secondary-container hover:bg-md-outline-variant text-md-on-surface/60'} transition-colors"
        aria-label="Toggle auto-renew"
        onclick={() => { if (onSetAutoRenew) onSetAutoRenew(!autoRenew); onSaveSettings(); }}
      >
        <IconRefresh class="w-5 h-5" />
      </button>
    </div>

    <!-- Email Retention row -->
    <div class="bg-md-primary-container rounded-xl px-4 py-3">
      <div class="flex items-center justify-between mb-2">
        <div>
          <div class="text-sm font-medium text-md-on-surface">{$t('settings.emailRetention')}</div>
          <div class="text-xs text-md-on-surface/50">{$t('settings.emailRetentionDescription')}</div>
        </div>
        <div class="relative">
          <button
            class="bg-md-secondary-container text-sm text-md-on-surface px-3 py-1.5 rounded-lg outline-none border-0 cursor-pointer font-medium flex items-center gap-2"
            onclick={() => retentionDropdownOpen = !retentionDropdownOpen}
            aria-label="Select email retention period"
          >
            <span>{retentionOptions.find(o => o.value === emailRetentionDays)?.label ?? '30 days'}</span>
            <IconChevronDown class="w-3.5 h-3.5" />
          </button>
          {#if retentionDropdownOpen}
            <button class="fixed inset-0 z-40 bg-transparent cursor-default" aria-label="Close dropdown" onclick={() => retentionDropdownOpen = false}></button>
            <div class="absolute top-full right-0 mt-1 bg-md-primary-container rounded-xl shadow-lg border border-md-secondary-container z-50 min-w-[130px] overflow-hidden">
              {#each retentionOptions as option}
                <button
                  class="w-full px-4 py-2 text-sm text-left hover:bg-md-secondary-container flex items-center justify-between {option.value === emailRetentionDays ? 'font-semibold text-md-primary' : 'text-md-on-surface'}"
                  onclick={() => {
                    if (onSetEmailRetentionDays) {
                      onSetEmailRetentionDays(option.value);
                      onSaveSettings();
                    }
                    retentionDropdownOpen = false;
                  }}
                >
                  {option.label}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </div>
      {#if loadingEmailsCount}
        <div class="text-[10px] text-md-on-surface/40">Calculating emails to be deleted...</div>
      {:else if emailsToBeDeleted && emailRetentionDays !== 0}
        <div class="text-[10px] text-md-on-surface/40">
          {emailsToBeDeleted.totalEmails} email{emailsToBeDeleted.totalEmails !== 1 ? 's' : ''} will be deleted ({emailsToBeDeleted.activeEmails} active, {emailsToBeDeleted.archivedEmails} archived)
        </div>
      {:else if emailRetentionDays === 0}
        <div class="text-[10px] text-md-on-surface/40">Emails will never be deleted</div>
      {/if}
    </div>

    <!-- Storage Usage row -->
    <div class="bg-md-primary-container rounded-xl px-4 py-3">
      <div class="text-sm font-medium text-md-on-surface mb-1">{$t('settings.storageUsage')}</div>
      <div class="text-xs text-md-on-surface/50 mb-2">
        {#if loadingStorage}
          Loading...
        {:else if storageUsage}
          {storageUsage.totalMB.toFixed(2)} MB used
        {:else}
          Unable to load
        {/if}
      </div>
      {#if storageUsage && !loadingStorage}
        <div class="w-full bg-md-secondary-container rounded-full h-2 overflow-hidden mb-3">
          <div
            class="bg-md-primary h-full transition-all duration-300"
            style="width: {Math.min((storageUsage.totalMB / 10) * 100, 100)}%"
          ></div>
        </div>
        <div class="text-[10px] text-md-on-surface/40 mb-3">
          Chrome storage limit: ~10 MB
        </div>
        <!-- Storage breakdown -->
        <div class="space-y-2 mb-3">
          <div class="flex items-center justify-between text-[10px]">
            <span class="text-md-on-surface/60">Emails</span>
            <span class="text-md-on-surface">{storageUsage.categories.emails.toFixed(2)} MB</span>
          </div>
          <div class="flex items-center justify-between text-[10px]">
            <span class="text-md-on-surface/60">Settings</span>
            <span class="text-md-on-surface">{storageUsage.categories.settings.toFixed(2)} MB</span>
          </div>
          <div class="flex items-center justify-between text-[10px]">
            <span class="text-md-on-surface/60">Cached Data</span>
            <span class="text-md-on-surface">{storageUsage.categories.cached.toFixed(2)} MB</span>
          </div>
          <div class="flex items-center justify-between text-[10px]">
            <span class="text-md-on-surface/60">Other</span>
            <span class="text-md-on-surface">{storageUsage.categories.other.toFixed(2)} MB</span>
          </div>
        </div>
        <!-- Clear old emails button -->
        {#if emailRetentionDays !== 0}
          <button
            class="w-full px-3 py-2 text-xs rounded-xl bg-md-secondary text-md-on-secondary hover:bg-md-secondary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onclick={() => {
              if (emailsToBeDeleted?.totalEmails && emailsToBeDeleted.totalEmails > 0) {
                showConfirmDialog(
                  `Delete ${emailsToBeDeleted.totalEmails} email(s) older than ${emailRetentionDays} day(s)?`,
                  clearOldEmails
                );
              } else {
                clearOldEmails();
              }
            }}
            disabled={clearingEmails}
          >
            {clearingEmails ? 'Clearing...' : 'Clear Old Emails Now'}
          </button>
        {/if}
      {/if}
    </div>

    {#if loadProviderConfig(selectedProvider).multiInstance?.enabled}
      <div class="bg-md-tertiary-container rounded-xl px-4 py-3">
        <div class="text-[10px] font-semibold text-md-on-surface/40 uppercase tracking-wider mb-1.5">Instance Selection</div>
        <div class="relative">
          <button
            class="w-full bg-transparent text-sm outline-none text-md-on-surface appearance-none cursor-pointer font-medium flex items-center justify-between"
            onclick={() => instanceDropdownOpen = !instanceDropdownOpen}
            aria-label="Select provider instance"
          >
            <span>
              {#if selectedProviderInstance === 'random'}
                Random Instance (Default)
              {:else}
                {#each providerInstances as instance}
                  {#if instance.id === selectedProviderInstance}
                    {@const pingResults = providerPingResults.get(selectedProvider)}
                    {@const instancePing = pingResults?.get(instance.id)}
                    {instance.displayName}{instance.isCustom ? ' (Custom)' : ''}
                    {#if instancePing !== undefined && instancePing !== null}
                      <span class="text-xs text-md-on-surface/50 ml-2">{getPingDot(instancePing)} {PingService.formatPing(instancePing)}</span>
                    {:else}
                      <span class="text-xs text-md-on-surface/50 ml-2">⏳</span>
                    {/if}
                  {/if}
                {/each}
              {/if}
            </span>
            <IconChevronDown class="w-4 h-4 ml-2" />
          </button>
          {#if instanceDropdownOpen}
            <div class="absolute top-full left-0 right-0 mt-1 bg-md-primary-container rounded-xl shadow-lg border border-md-secondary-container z-50 max-h-60 overflow-y-auto">
              <button
                class="w-full px-4 py-2 text-sm text-left hover:bg-md-secondary-container flex items-center justify-between"
                onclick={() => {
                  selectedProviderInstance = 'random';
                  onSetProviderInstance('random');
                  instanceDropdownOpen = false;
                }}
              >
                <span>Random Instance (Default)</span>
              </button>
              {#each providerInstances as instance}
                {@const pingResults = providerPingResults.get(selectedProvider)}
                {@const instancePing = pingResults?.get(instance.id)}
                <button
                  class="w-full px-4 py-2 text-sm text-left hover:bg-md-secondary-container flex items-center justify-between"
                  onclick={() => {
                    selectedProviderInstance = instance.id;
                    onSetProviderInstance(instance.id);
                    instanceDropdownOpen = false;
                  }}
                >
                  <span>{instance.displayName}{instance.isCustom ? ' (Custom)' : ''}</span>
                  {#if instancePing !== undefined && instancePing !== null}
                    <span class="text-xs text-md-on-surface/50">{getPingDot(instancePing)} {PingService.formatPing(instancePing)}</span>
                  {:else}
                    <span class="text-xs text-md-on-surface/50">⏳</span>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </div>

      {#if !showCustomInstanceForm}
        <button class="btn-primary w-full rounded-xl py-2.5 flex items-center justify-center gap-2 text-sm" aria-label="Add custom instance" onclick={showAddCustomInstance}>
          <IconPlus class="w-4 h-4" />
          Add instance
        </button>
      {:else}
        <div class="bg-md-tertiary-container rounded-xl px-4 py-3 space-y-3">
          <div>
            <div class="text-xs font-semibold text-md-tertiary uppercase tracking-wider mb-1.5">Instance Name</div>
            <input type="text" class="w-full bg-transparent text-sm outline-none text-md-on-surface placeholder:text-md-on-surface/30" placeholder="My Instance" aria-label="Custom instance name" bind:value={customInstanceName} />
          </div>
          <div class="border-t border-md-secondary-container"></div>
          <div>
            <div class="text-[10px] font-semibold text-md-on-surface/40 uppercase tracking-wider mb-1.5">API URL</div>
            <input type="url" class="w-full bg-transparent text-sm outline-none text-md-on-surface placeholder:text-md-on-surface/30" placeholder="https://example.com/api" aria-label="Custom instance URL" bind:value={customInstanceUrl} />
          </div>
          <div class="flex gap-2 pt-1">
            <button class="flex-1 px-3 py-1.5 text-sm rounded-xl bg-md-primary text-md-on-primary hover:bg-md-primary/90 transition-colors" aria-label="Save custom instance" onclick={saveCustomInstance}>{$t('common.save')}</button>
            <button class="flex-1 px-3 py-1.5 text-sm rounded-xl bg-md-secondary text-md-on-secondary hover:bg-md-secondary/90 transition-colors" aria-label="Cancel custom instance" onclick={hideCustomInstanceForm}>{$t('common.cancel')}</button>
          </div>
        </div>
      {/if}
    {/if}
  </section>

  <!-- ── Appearance ── -->
  <section class="space-y-2">
    <div class="flex items-center gap-2 mb-1">
      <IconSun class="w-4 h-4 text-md-primary" />
      <span class="text-sm font-semibold text-md-on-surface">{$t('settings.appearance')}</span>
    </div>

    <div class="bg-md-primary-container rounded-xl px-4 py-3 flex items-center justify-between">
      <div>
        <div class="text-sm font-medium text-md-on-surface">Theme accent</div>
        <div class="text-xs text-md-on-surface/50">Browser color picker</div>
      </div>
      <div class="flex items-center gap-2">
        {#if customColor}
          <button class="w-5 h-5 flex items-center justify-center rounded-full bg-transparent hover:bg-md-secondary-container transition-colors" aria-label="Reset color" onclick={() => onColorChange('')}>
            <IconX class="w-3 h-3" />
          </button>
        {/if}
        <label class="cursor-pointer relative">
          <div class="w-8 h-8 rounded-full border-4 border-md-secondary-container shadow-md" style="background:{customColor || 'var(--md-primary)'}"></div>
          <input type="color" class="absolute inset-0 opacity-0 w-full h-full cursor-pointer" aria-label="Choose theme color" value={customColor || '#4c662b'} oninput={(e) => onColorChange((e.target as HTMLInputElement).value)} />
        </label>
      </div>
    </div>

    <div class="bg-md-primary-container rounded-xl px-4 py-3 flex items-center justify-between">
      <div>
        <div class="text-sm font-medium text-md-on-surface">Contrast level</div>
        <div class="text-xs text-md-on-surface/50">Adjust contrast for accessibility</div>
      </div>
      <div class="flex items-center gap-1">
        <button
          class="px-3 py-1.5 text-xs rounded-lg transition-colors {contrastLevel === 'standard' ? 'bg-md-primary text-md-on-primary' : 'bg-md-secondary-container text-md-on-surface hover:bg-md-secondary-container/80'}"
          onclick={() => onContrastLevelChange('standard')}
          aria-label="Standard contrast"
        >
          Standard
        </button>
        <button
          class="px-3 py-1.5 text-xs rounded-lg transition-colors {contrastLevel === 'medium' ? 'bg-md-primary text-md-on-primary' : 'bg-md-secondary-container text-md-on-surface hover:bg-md-secondary-container/80'}"
          onclick={() => onContrastLevelChange('medium')}
          aria-label="Medium contrast"
        >
          Medium
        </button>
        <button
          class="px-3 py-1.5 text-xs rounded-lg transition-colors {contrastLevel === 'high' ? 'bg-md-primary text-md-on-primary' : 'bg-md-secondary-container text-md-on-surface hover:bg-md-secondary-container/80'}"
          onclick={() => onContrastLevelChange('high')}
          aria-label="High contrast"
        >
          High
        </button>
      </div>
    </div>
  </section>

  <!-- ── Developer Settings ── -->
  <section class="space-y-2">
    <div class="flex items-center gap-2 mb-1">
      <IconSettings class="w-4 h-4 text-md-primary" />
      <span class="text-sm font-semibold text-md-on-surface">{$t('settings.developer')}</span>
    </div>

    <div class="bg-md-primary-container rounded-xl px-4 py-3 flex items-center justify-between">
      <div>
        <div class="text-sm font-medium text-md-on-surface">Show Developer Options</div>
        <div class="text-xs text-md-on-surface/50">Enable developer tools</div>
      </div>
      <label class="cursor-pointer">
        <input type="checkbox" class="sr-only peer" aria-label="Toggle developer settings" bind:checked={showDeveloperSettings} onchange={onToggleDeveloperSettings} />
        <div class="relative w-9 h-5 bg-md-outline-variant peer-checked:bg-md-primary rounded-full peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
      </label>
    </div>

    {#if showDeveloperSettings}
      <div class="bg-md-primary-container rounded-xl px-4 py-3 flex items-center justify-between">
        <div>
          <div class="text-sm font-medium text-md-on-surface">Enable Logging</div>
          <div class="text-xs text-md-on-surface/50">Show console logs for debugging</div>
        </div>
        <label class="cursor-pointer">
          <input type="checkbox" class="sr-only peer" aria-label="Toggle logging" bind:checked={enableLogging} onchange={onToggleEnableLogging} />
          <div class="relative w-9 h-5 bg-md-outline-variant peer-checked:bg-md-primary rounded-full peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
        </label>
      </div>
    {/if}
  </section>

  <!-- ── Data ── -->
  <div class="flex gap-2">
    <button class="flex-1 px-3 py-1.5 text-sm rounded-xl border border-md-primary text-md-primary hover:bg-md-primary/10 transition-colors" aria-label="Export data" onclick={onExportData}>Export Data</button>
    <button class="flex-1 px-3 py-1.5 text-sm rounded-xl border border-md-primary text-md-primary hover:bg-md-primary/10 transition-colors" aria-label="Import data" onclick={onImportData}>Import Data</button>
  </div>

  <!-- ── Danger Zone ── -->
  <section class="rounded-xl border border-md-error/30 bg-md-error/5 px-4 py-4 space-y-2">
    <div class="text-sm font-bold text-md-error">Danger Zone</div>
    <div class="text-xs text-md-on-surface/50">Irreversibly reset all configuration to factory defaults.</div>
    <button class="w-full px-3 py-1.5 text-sm rounded-xl border border-md-error text-md-error hover:bg-md-error/10 mt-1 font-semibold transition-colors" aria-label="Perform hard reset" onclick={() => showConfirmDialog('Are you sure you want to perform a hard reset? This action cannot be undone.', onHardReset)}>Hard Reset</button>
  </section>

    </div>
  {/snippet}
</ErrorBoundary>
{/if}

<ConfirmDialog {confirmDialog} confirmDialogRef={confirmDialogRef} onClose={closeConfirmDialog} />

<ToastContainer />
