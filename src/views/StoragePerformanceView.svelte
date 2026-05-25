<script lang="ts">
import { onMount } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import IconChevronDown from '@/components/icons/IconChevronDown.svelte';
import IconChevronLeft from '@/components/icons/IconChevronLeft.svelte';
import { STORAGE_LIMIT, STORAGE_WARNING_THRESHOLD } from '@/utils/constants.js';
import { clearAllFaviconCache, getFaviconCacheStats, initFaviconStorage } from '@/utils/favicon.js';
import { logError } from '@/utils/logger.js';
import {
  formatBytes,
  getStorageUsage,
  hasUnlimitedStoragePermission,
  isFirefox,
  requestUnlimitedStorage,
} from '@/utils/storageMonitor.js';
import { toastStore } from '@/utils/toastStore.js';

let {
  onBack = () => {},
  faviconCaching = 'direct' as 'direct' | 'local',
  emailRetentionDays = 30,
  onSetFaviconCaching = undefined as ((v: 'direct' | 'local') => void) | undefined,
  onSetEmailRetentionDays = undefined as ((v: number) => void) | undefined,
  onSaveSettings = () => {},
  onClearOldEmails = async () => {},
} = $props<{
  onBack?: () => void;
  faviconCaching?: 'direct' | 'local';
  emailRetentionDays?: number;
  onSetFaviconCaching?: (v: 'direct' | 'local') => void;
  onSetEmailRetentionDays?: (v: number) => void;
  onSaveSettings?: () => void;
  onClearOldEmails?: () => Promise<void>;
}>();

let faviconCacheCount = $state(0);
let totalCacheSize = $state(0);
let storageUsageBytes = $state(0);
let hasUnlimitedStorage = $state(false);
let requestingPermission = $state(false);
let clearingFaviconCache = $state(false);
let _isFirefox = $state(false);
let faviconCachingDropdownOpen = $state(false);
let retentionDropdownOpen = $state(false);

// Storage stats
let loadingStorage = $state(false);
let storageUsage = $state<{
  totalMB: number;
  categories: { emails: number; settings: number; cached: number; other: number };
} | null>(null);
let clearingEmails = $state(false);

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

onMount(async () => {
  await initFaviconStorage();
  storageUsageBytes = await getStorageUsage();
  hasUnlimitedStorage = await hasUnlimitedStoragePermission();
  _isFirefox = isFirefox();
  updateFaviconCacheCount();
  loadStorageUsage();
});

function updateFaviconCacheCount() {
  const stats = getFaviconCacheStats();
  faviconCacheCount = stats.count;
  totalCacheSize = stats.sizeBytes;
}

async function handleClearFaviconCache() {
  clearingFaviconCache = true;
  try {
    await clearAllFaviconCache();
    updateFaviconCacheCount();
    storageUsageBytes = await getStorageUsage();
    toastStore.success($t('settings.faviconCacheCleared'));
  } finally {
    clearingFaviconCache = false;
  }
}

async function handleRequestUnlimitedStorage() {
  requestingPermission = true;
  try {
    const granted = await requestUnlimitedStorage();
    hasUnlimitedStorage = granted;
    if (granted) {
      toastStore.success($t('settings.unlimitedStorageGranted'));
    } else {
      toastStore.error($t('settings.unlimitedStorageDenied'));
    }
  } finally {
    requestingPermission = false;
  }
}

async function loadStorageUsage() {
  loadingStorage = true;
  try {
    const allData = (await browser.storage.local.get(null)) as Record<string, unknown>;
    const jsonStr = JSON.stringify(allData);
    const totalBytes = new TextEncoder().encode(jsonStr).length;
    const totalMB = totalBytes / (1024 * 1024);

    const emailsStr = JSON.stringify({
      emails: allData.emails,
      storedEmails: allData.storedEmails,
      archivedEmails: allData.archivedEmails,
    });
    const settingsStr = JSON.stringify({
      autoCopy: allData.autoCopy,
      autoRenew: allData.autoRenew,
      selectedProvider: allData.selectedProvider,
      faviconCaching: allData.faviconCaching,
      keybindings: allData.keybindings,
    });
    const cachedStr = JSON.stringify({
      favicon_success_cache: allData.favicon_success_cache,
    });

    const emailsMB = new TextEncoder().encode(emailsStr).length / (1024 * 1024);
    const settingsMB = new TextEncoder().encode(settingsStr).length / (1024 * 1024);
    const cachedMB = new TextEncoder().encode(cachedStr).length / (1024 * 1024);

    storageUsage = {
      totalMB,
      categories: {
        emails: emailsMB,
        settings: settingsMB,
        cached: cachedMB,
        other: Math.max(0, totalMB - emailsMB - settingsMB - cachedMB),
      },
    };
  } catch (e) {
    logError('Failed to load storage usage', e);
  } finally {
    loadingStorage = false;
  }
}

$effect(() => {
  updateFaviconCacheCount();
});
</script>

<div class="flex flex-col h-full">
  <!-- Header -->
  <div class="flex items-center gap-3 px-4 py-4 border-b border-md-secondary-container">
    <button
      class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-md-secondary-container transition-colors"
      onclick={onBack}
      aria-label="Back"
    >
      <IconChevronLeft class="w-5 h-5" />
    </button>
    <div>
      <h1 class="text-base font-bold text-md-on-surface">Storage & Performance</h1>
      <p class="text-xs text-md-on-surface/50">Favicon caching, storage and data management</p>
    </div>
  </div>

  <div class="flex-1 overflow-y-auto px-4 py-4 space-y-4" style="scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--md-outline, #75777f) 0.2, transparent) transparent;">

    <!-- Favicon Caching Mode -->
    <section class="space-y-2">
      <div class="text-xs font-semibold text-md-on-surface/50 uppercase tracking-wider px-1">Favicon Caching</div>
      <div class="bg-md-primary-container rounded-xl px-4 py-3">
        <div class="text-sm font-medium text-md-on-surface mb-1">Caching Mode</div>
        <div class="text-xs text-md-on-surface/50 mb-2">Store favicons locally as WebP images (32×32) to reduce network requests</div>
        <div class="flex items-center justify-between">
          <div class="text-xs text-md-on-surface/60">
            {faviconCaching === 'local' ? 'Local storage (24h expiry)' : 'Direct from source'}
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
                  onclick={() => { onSetFaviconCaching?.('direct'); onSaveSettings(); faviconCachingDropdownOpen = false; }}
                >Direct</button>
                <button
                  class="w-full px-4 py-2 text-sm text-left hover:bg-md-secondary-container {faviconCaching === 'local' ? 'font-semibold text-md-primary' : 'text-md-on-surface'}"
                  onclick={() => { onSetFaviconCaching?.('local'); onSaveSettings(); faviconCachingDropdownOpen = false; }}
                >Local</button>
              </div>
            {/if}
          </div>
        </div>
      </div>

      <!-- Favicon Cache Stats -->
      <div class="bg-md-primary-container rounded-xl px-4 py-3 space-y-3">
        <div class="text-xs text-md-on-surface/60">Shared across all extension contexts on this device.</div>

        <!-- Storage usage bar -->
        <div>
          <div class="flex justify-between text-xs text-md-on-surface/60 mb-1">
            <span>{formatBytes(storageUsageBytes)}</span>
            <span>{formatBytes(STORAGE_LIMIT)}</span>
          </div>
          <div class="w-full bg-md-secondary-container rounded-full h-1.5 overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-300 {storageUsageBytes >= STORAGE_WARNING_THRESHOLD ? 'bg-amber-500' : 'bg-md-primary'}"
              style="width: {Math.min((storageUsageBytes / STORAGE_LIMIT) * 100, 100)}%"
            ></div>
          </div>
        </div>

        {#if !hasUnlimitedStorage && !_isFirefox && storageUsageBytes >= STORAGE_WARNING_THRESHOLD}
          <button
            class="w-full py-1.5 px-3 rounded-lg text-xs font-medium bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
            onclick={handleRequestUnlimitedStorage}
            disabled={requestingPermission}
          >
            {requestingPermission ? $t('common.loading') : $t('settings.requestUnlimitedStorage')}
          </button>
        {/if}
        {#if hasUnlimitedStorage}
          <div class="text-xs text-green-600 dark:text-green-400">✓ {$t('settings.unlimitedStorageGranted')}</div>
        {/if}
        {#if _isFirefox && storageUsageBytes >= STORAGE_WARNING_THRESHOLD}
          <div class="text-xs text-amber-600">Firefox: 5MB limit applies. Clear cache to free space.</div>
        {/if}

        <div class="flex items-center justify-between">
          <span class="text-xs text-md-on-surface/50">
            {faviconCacheCount} favicon{faviconCacheCount === 1 ? '' : 's'} cached ({formatBytes(totalCacheSize)})
          </span>
          <button
            class="text-xs text-md-error hover:underline disabled:opacity-50"
            onclick={handleClearFaviconCache}
            disabled={clearingFaviconCache || faviconCacheCount === 0}
          >
            {clearingFaviconCache ? $t('common.loading') : $t('settings.clearFaviconCache')}
          </button>
        </div>
      </div>
    </section>

    <!-- Email Retention -->
    <section class="space-y-2">
      <div class="text-xs font-semibold text-md-on-surface/50 uppercase tracking-wider px-1">Email Data</div>
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
                    class="w-full px-4 py-2 text-sm text-left hover:bg-md-secondary-container {option.value === emailRetentionDays ? 'font-semibold text-md-primary' : 'text-md-on-surface'}"
                    onclick={() => {
                      onSetEmailRetentionDays?.(option.value);
                      onSaveSettings();
                      retentionDropdownOpen = false;
                    }}
                  >{option.label}</button>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      </div>
    </section>

    <!-- Storage Breakdown -->
    <section class="space-y-2">
      <div class="text-xs font-semibold text-md-on-surface/50 uppercase tracking-wider px-1">Storage Usage</div>
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
          <div class="text-[10px] text-md-on-surface/40 mb-3">Chrome storage limit: ~10 MB</div>
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
          {#if emailRetentionDays !== 0}
            <button
              class="w-full px-3 py-2 text-xs rounded-xl bg-md-secondary text-md-on-secondary hover:bg-md-secondary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onclick={onClearOldEmails}
              disabled={clearingEmails}
            >
              {clearingEmails ? 'Clearing...' : 'Clear Old Emails Now'}
            </button>
          {/if}
        {/if}
      </div>
    </section>

  </div>
</div>
