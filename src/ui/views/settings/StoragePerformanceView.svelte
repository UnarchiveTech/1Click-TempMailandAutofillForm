<script lang="ts">
import { onMount } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import type { View } from '@/features/types/view-types.js';
import Icon from '@/ui/components/icons/Icon.svelte';
import { Btn, Dropdown } from '@/ui/components/primitives';
import { CONSTANTS } from '@/utils/constants.js';
import { logError } from '@/utils/logger.js';
import {
  DEFAULT_MAX_ARCHIVED_INBOXES,
  getArchivedAddressOverflow,
  getEmailMaps,
  getMaxArchivedAddresses,
} from '@/utils/storage/storage-keys.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import {
  formatBytes,
  getStorageUsage,
  hasUnlimitedStoragePermission,
  isFirefox,
  requestUnlimitedStorage,
} from '@/utils/storage/storageMonitor.js';
import type { Address } from '@/utils/types.js';
import { clearAllFaviconCache, getFaviconCacheStats } from '@/utils/ui/favicon.js';
import { toastStore } from '@/utils/ui/toastStore.js';

let {
  onBack = () => {},
  faviconCaching = 'direct' as 'direct' | 'local',
  emailRetentionDays = 30,
  onSetFaviconCaching = undefined as ((v: 'direct' | 'local') => void) | undefined,
  onSetEmailRetentionDays = undefined as ((v: number) => void) | undefined,
  onSaveSettings = () => {},
  onClearOldEmails = async () => {},
  onNavigateTo = undefined,
}: {
  onBack?: () => void;
  faviconCaching?: 'direct' | 'local';
  emailRetentionDays?: number;
  onSetFaviconCaching?: (v: 'direct' | 'local') => void;
  onSetEmailRetentionDays?: (v: number) => void;
  onSaveSettings?: () => void;
  onClearOldEmails?: () => Promise<void>;
  onNavigateTo?: (view: View) => void;
} = $props();

let faviconCacheCount = $state(0);
let totalCacheSize = $state(0);
let storageUsageBytes = $state(0);
let quotaPercent = $derived(
  Math.min(Math.round((storageUsageBytes / CONSTANTS.STORAGE_LIMIT) * 100), 100)
);
let hasUnlimitedStorage = $state(false);
let requestingPermission = $state(false);
let clearingFaviconCache = $state(false);
let _isFirefox = $state(false);

// Storage stats
let loadingStorage = $state(false);
let storageUsage = $state<{
  totalMB: number;
  categories: { emails: number; settings: number; cached: number; other: number };
} | null>(null);
// Per-inbox email counts (active + archived) so users see where mail lives.
let perAddress = $state<{ address: string; active: number; archived: number }[] | null>(null);
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
// Archived-inbox cap + recoverable (overflow) records - see archived-overflow.ts.
let maxArchivedAddresses = $state(DEFAULT_MAX_ARCHIVED_INBOXES);
let overflowAddresses = $state<Address[]>([]);
let restoringId = $state('');

const retentionOptions = [
  { value: 0, labelKey: 'storagePerformance.neverDelete' },
  { value: 7, labelKey: 'storagePerformance.days7' },
  { value: 14, labelKey: 'storagePerformance.days14' },
  { value: 30, labelKey: 'storagePerformance.days30' },
  { value: 60, labelKey: 'storagePerformance.days60' },
  { value: 90, labelKey: 'storagePerformance.days90' },
  { value: 180, labelKey: 'storagePerformance.months6' },
  { value: 365, labelKey: 'storagePerformance.year1' },
];

onMount(() => {
  const init = async () => {
    storageUsageBytes = await getStorageUsage();
    hasUnlimitedStorage = await hasUnlimitedStoragePermission();
    _isFirefox = isFirefox();
    await updateFaviconCacheCount();
    await loadStorageUsage();
    await loadArchivedAddressSettings();
  };
  init().catch((err) => {
    logError('Failed to initialize storage view', undefined, err);
  });

  // Live refresh: mail keeps arriving / being cleaned while this view is open,
  // so re-read the usage + per-inbox counts on any local storage change
  // (debounced - storage.local.get(null) is not free).
  const onChanged = (_changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local') return;
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      void (async () => {
        storageUsageBytes = await getStorageUsage();
        await updateFaviconCacheCount();
        await loadStorageUsage();
      })();
    }, 250);
  };
  browser.storage.onChanged.addListener(onChanged);
  return () => {
    browser.storage.onChanged.removeListener(onChanged);
    if (refreshTimer) clearTimeout(refreshTimer);
  };
});

async function updateFaviconCacheCount() {
  const stats = await getFaviconCacheStats();
  faviconCacheCount = stats.count;
  totalCacheSize = stats.sizeBytes;
}

async function handleClearFaviconCache() {
  clearingFaviconCache = true;
  try {
    await clearAllFaviconCache();
    await updateFaviconCacheCount();
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

async function loadArchivedAddressSettings() {
  maxArchivedAddresses = await getMaxArchivedAddresses();
  overflowAddresses = await getArchivedAddressOverflow();
}

async function handleSaveMaxArchivedAddresses(value: number) {
  const v = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  maxArchivedAddresses = v;
  await writeWithRetry({ maxArchivedAddresses: v });
  toastStore.success($t('settings.maxArchivedAddressesUpdated'));
}

async function handleRestoreOverflowAddress(id: string) {
  restoringId = id;
  try {
    const res = (await browser.runtime.sendMessage({
      type: 'restoreArchivedOverflowAddress',
      addressId: id,
    })) as { success?: boolean; error?: string };
    if (res?.success) {
      overflowAddresses = overflowAddresses.filter((o) => o.id !== id);
      toastStore.success($t('settings.restoreAddressSuccess'));
    } else {
      toastStore.error($t('settings.restoreAddressFailed'));
    }
  } catch (err) {
    logError(
      'restore overflow inbox error',
      undefined,
      err instanceof Error ? err : new Error(String(err))
    );
    toastStore.error($t('settings.restoreAddressFailed'));
  } finally {
    restoringId = '';
  }
}

async function loadStorageUsage() {
  loadingStorage = true;
  try {
    const allData = (await browser.storage.local.get(null)) as Record<string, unknown>;
    const jsonStr = JSON.stringify(allData);
    const totalBytes = new TextEncoder().encode(jsonStr).length;
    const totalMB = totalBytes / (1024 * 1024);

    // Per-address counts from the current ID-keyed logical maps.
    const { storedEmails, archivedEmails } = await getEmailMaps();
    const storedMap = storedEmails as Record<string, unknown[]>;
    const archivedMap = archivedEmails as Record<string, unknown[]>;
    const addresses = new Set([...Object.keys(storedMap), ...Object.keys(archivedMap)]);
    perAddress = [...addresses]
      .map((address) => ({
        address,
        // Guard against malformed storage shapes - only real arrays count.
        active: Array.isArray(storedMap[address]) ? storedMap[address].length : 0,
        archived: Array.isArray(archivedMap[address]) ? archivedMap[address].length : 0,
      }))
      .sort((a, b) => b.active + b.archived - (a.active + a.archived));

    const emailsStr = JSON.stringify({
      emails: allData.emails,
      storedEmails,
      archivedEmails,
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

<div class="scroll-frame flex flex-col h-full">
  <!-- Header -->
  <div class="scroll-edge flex items-center gap-3 py-3 border-b border-md-outline-variant/30">
    <button
      class="w-8 h-8 flex items-center justify-center rounded-full hover:bg-md-secondary-container active:bg-md-secondary-container-pressed transition-colors"
      onclick={onBack}
      aria-label={$t('common.back')}
    >
      <Icon name="chevronLeft" class="w-5 h-5" />
    </button>
    <div>
      <h1 class="text-sm font-semibold text-md-on-surface">{$t('storagePerformance.title')}</h1>
      <p class="text-xs text-md-on-surface/50">{$t('storagePerformance.subtitle')}</p>
    </div>
  </div>

  <div class="scroll-body scroll-body-framed flex-1 overflow-y-auto py-3 space-y-4">

    <!-- Favicon Caching Mode -->
    <section class="space-y-2">
      <div class="flex items-center gap-2 mb-1">
        <Icon name="globe" class="w-4 h-4 text-md-primary" />
        <span role="heading" aria-level="2" class="text-sm font-medium text-md-on-surface">{$t('storagePerformance.faviconCaching')}</span>
      </div>
      <div class="bg-md-surface-container-low rounded-xl px-3 py-3 border border-md-outline-variant/20">
        <div class="text-sm font-medium text-md-on-surface mb-1">{$t('storagePerformance.cachingMode')}</div>
        <div class="text-xs text-md-on-surface/50 mb-2">{$t('storagePerformance.cachingModeDescription')}</div>
        <div class="flex items-center justify-between gap-3">
          <div class="text-xs text-md-on-surface/60">
            {faviconCaching === 'local' ? $t('storagePerformance.localStorageMode') : $t('storagePerformance.directFromSource')}
          </div>
          <Dropdown
            class="shrink-0"
            variant="secondary"
            size="sm"
            ariaLabel={$t('storagePerformance.selectCachingMode')}
            value={faviconCaching}
            onchange={(v) => {
              onSetFaviconCaching?.(v === 'local' ? 'local' : 'direct');
              onSaveSettings();
            }}
            options={[
              { value: 'direct', label: $t('storagePerformance.direct') },
              { value: 'local', label: $t('storagePerformance.local') },
            ]}
          />
        </div>
      </div>

      <!-- Favicon Cache Stats -->
      <div class="bg-md-surface-container-low rounded-xl px-3 py-3 border border-md-outline-variant/20 space-y-3">
        <div class="text-xs text-md-on-surface/60">{$t('storagePerformance.sharedAcrossContexts')}</div>

        <!-- Storage usage bar -->
        <div>
          <div class="flex justify-between text-xs text-md-on-surface/60 mb-1">
            <span>{formatBytes(storageUsageBytes)} / {formatBytes(CONSTANTS.STORAGE_LIMIT)}</span>
            <span
              class="font-medium {storageUsageBytes >= CONSTANTS.STORAGE_CRITICAL_THRESHOLD ? 'text-md-error' : storageUsageBytes >= CONSTANTS.STORAGE_WARNING_THRESHOLD ? 'text-md-warning' : ''}"
            >
              {$t('storagePerformance.percentUsed', { values: { pct: quotaPercent } })}
            </span>
          </div>
          <div class="w-full bg-md-secondary-container rounded-full h-1.5 overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-300 w-[var(--progress)] {storageUsageBytes >= CONSTANTS.STORAGE_CRITICAL_THRESHOLD ? 'bg-md-error' : storageUsageBytes >= CONSTANTS.STORAGE_WARNING_THRESHOLD ? 'bg-md-warning' : 'bg-md-primary'}"
              style="--progress: {Math.min((storageUsageBytes / CONSTANTS.STORAGE_LIMIT) * 100, 100)}%"
            ></div>
          </div>
          {#if storageUsageBytes >= CONSTANTS.STORAGE_CRITICAL_THRESHOLD}
            <div class="text-xs text-md-error mt-1.5">{$t('storagePerformance.quotaCritical')}</div>
          {/if}
        </div>

        {#if !hasUnlimitedStorage && !_isFirefox && storageUsageBytes >= CONSTANTS.STORAGE_WARNING_THRESHOLD}
          <Btn
            variant="warning"
            size="sm"
            class="w-full"
            onclick={handleRequestUnlimitedStorage}
            disabled={requestingPermission}
          >
            {requestingPermission ? $t('common.loading') : $t('settings.requestUnlimitedStorage')}
          </Btn>
        {/if}
        {#if hasUnlimitedStorage}
          <div class="text-xs text-md-success">✓ {$t('settings.unlimitedStorageGranted')}</div>
        {/if}
        {#if _isFirefox && storageUsageBytes >= CONSTANTS.STORAGE_WARNING_THRESHOLD}
          <div class="text-xs text-md-warning">{$t('storagePerformance.firefoxLimit')}</div>
        {/if}

        <div class="flex items-center justify-between">
          <span class="text-xs text-md-on-surface/50">
            {$t('storagePerformance.faviconsCached', { values: { n: faviconCacheCount, size: formatBytes(totalCacheSize) } })}
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
      <div class="flex items-center gap-2 mb-1">
        <Icon name="mail" class="w-4 h-4 text-md-primary" />
        <span role="heading" aria-level="2" class="text-sm font-medium text-md-on-surface">{$t('storagePerformance.emailData')}</span>
      </div>
      <div class="bg-md-surface-container-low rounded-xl px-3 py-3 border border-md-outline-variant/20 flex items-center justify-between gap-3">
          <div>
            <div class="text-sm font-medium text-md-on-surface">{$t('settings.emailRetention')}</div>
            <div class="text-xs text-md-on-surface/50">{$t('settings.emailRetentionDescription')}</div>
          </div>
          <Dropdown
            class="shrink-0"
            variant="secondary"
            size="sm"
            ariaLabel={$t('storagePerformance.selectRetention')}
            value={emailRetentionDays}
            placeholder={$t('storagePerformance.days30')}
            onchange={(v) => {
              onSetEmailRetentionDays?.(Number(v));
              onSaveSettings();
            }}
            options={retentionOptions.map((o) => ({ value: o.value, label: $t(o.labelKey) }))}
          />
      </div>
    </section>

    <!-- Archived mailboxes: cap + recoverable overflow records -->
    <section class="space-y-2">
      <div class="flex items-center gap-2 mb-1">
        <Icon name="archive" class="w-4 h-4 text-md-primary" />
        <span role="heading" aria-level="2" class="text-sm font-medium text-md-on-surface">
          {$t('settings.archivedMailboxes')}
        </span>
      </div>
      <div class="bg-md-surface-container-low rounded-xl px-3 py-3 border border-md-outline-variant/20 space-y-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-sm font-medium text-md-on-surface">
              {$t('settings.maxArchivedAddresses')}
            </div>
            <div class="text-xs text-md-on-surface/50">
              {$t('settings.maxArchivedAddressesDescription')}
            </div>
          </div>
          <input
            type="number"
            min="0"
            max="1000"
            step="1"
            class="w-20 shrink-0 rounded-lg bg-md-surface px-2 py-1.5 text-sm text-right text-md-on-surface border border-md-outline-variant focus:outline-none focus:ring-2 focus:ring-md-primary"
            value={maxArchivedAddresses}
            aria-label={$t('settings.maxArchivedAddresses')}
            onchange={(e) => {
              handleSaveMaxArchivedAddresses(Number((e.currentTarget as HTMLInputElement).value));
            }}
          />
        </div>
        <div class="border-t border-md-outline-variant/50 pt-3">
          <div class="text-sm font-medium text-md-on-surface mb-1">
            {$t('settings.recoverableMailboxes')}
            {#if overflowAddresses.length > 0}
              <span class="text-xs text-md-on-surface/50 font-normal">({overflowAddresses.length})</span>
            {/if}
          </div>
          <div class="text-xs text-md-on-surface/50 mb-2">
            {$t('settings.recoverableMailboxesDescription')}
          </div>
          {#if overflowAddresses.length === 0}
            <div class="text-xs text-md-on-surface/40 py-1">
              {$t('settings.recoverableMailboxesEmpty')}
            </div>
          {:else}
            <ul class="flex flex-col gap-1">
              {#each overflowAddresses as record}
                <li class="flex items-center justify-between gap-2 rounded-lg bg-md-surface px-2.5 py-1.5">
                  <span class="text-sm text-md-on-surface truncate">{record.address}</span>
                  <button
                    type="button"
                    class="btn-tertiary shrink-0 flex items-center gap-1 px-2.5 h-7 rounded-lg text-xs font-bold"
                    disabled={restoringId === record.id}
                    onclick={() => handleRestoreOverflowAddress(record.id)}
                  >
                    <Icon name="unarchive" class="w-3.5 h-3.5" />
                    {restoringId === record.id
                      ? $t('common.loading')
                      : $t('common.restore')}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </div>
    </section>

    <!-- Storage Breakdown -->
    <section class="space-y-2">
      <div class="flex items-center gap-2 mb-1">
        <Icon name="database" class="w-4 h-4 text-md-primary" />
        <span role="heading" aria-level="2" class="text-sm font-medium text-md-on-surface">{$t('storagePerformance.storageUsage')}</span>
      </div>
      <div class="bg-md-surface-container-low rounded-xl px-3 py-3 border border-md-outline-variant/20">
        <div class="text-sm font-medium text-md-on-surface mb-1">{$t('settings.storageUsage')}</div>
        <div class="text-xs text-md-on-surface/50 mb-2">
          {#if loadingStorage}
            {$t('storagePerformance.loading')}
          {:else if storageUsage}
            {$t('storagePerformance.mbUsed', { values: { mb: storageUsage.totalMB.toFixed(2) } })}
          {:else}
            {$t('storagePerformance.unableToLoad')}
          {/if}
        </div>
        {#if storageUsage && !loadingStorage}
          <div class="w-full bg-md-secondary-container rounded-full h-2 overflow-hidden mb-3">
            <div
              class="bg-md-primary h-full transition-all duration-300 w-[var(--progress)]"
              style="--progress: {Math.min((storageUsage.totalMB / 10) * 100, 100)}%"
            ></div>
          </div>
          <div class="text-xs text-md-on-surface/40 mb-3">{$t('storagePerformance.chromeLimit')}</div>
          <div class="space-y-2 mb-3">
            <div class="flex items-center justify-between text-xs">
              <span class="text-md-on-surface/60">{$t('storagePerformance.emails')}</span>
              <span class="text-md-on-surface">{formatBytes(storageUsage.categories.emails * 1024 * 1024)}</span>
            </div>
            <div class="flex items-center justify-between text-xs">
              <span class="text-md-on-surface/60">{$t('common.settings')}</span>
              <span class="text-md-on-surface">{formatBytes(storageUsage.categories.settings * 1024 * 1024)}</span>
            </div>
            <div class="flex items-center justify-between text-xs">
              <span class="text-md-on-surface/60">{$t('storagePerformance.cachedData')}</span>
              <span class="text-md-on-surface">{formatBytes(storageUsage.categories.cached * 1024 * 1024)}</span>
            </div>
            <div class="flex items-center justify-between text-xs">
              <span class="text-md-on-surface/60">{$t('storagePerformance.other')}</span>
              <span class="text-md-on-surface">{formatBytes(storageUsage.categories.other * 1024 * 1024)}</span>
            </div>
          </div>
          <!-- Per-record message counts -->
          <div class="mb-3 border-t border-md-outline-variant/30 pt-2">
            <div class="text-xs font-medium text-md-on-surface/60 mb-1.5">{$t('storagePerformance.perAddressTitle')}</div>
            {#if !perAddress || perAddress.length === 0}
              <div class="text-xs text-md-on-surface/40">{$t('storagePerformance.noEmails')}</div>
            {:else}
              <div class="scroll-body space-y-1 max-h-36 overflow-y-auto px-1 scrollbar-thin">
                {#each perAddress as row (row.address)}
                  <div class="flex items-center justify-between text-xs gap-2">
                    <span class="text-md-on-surface/60 truncate min-w-0" title={row.address}>{row.address}</span>
                    <span class="text-md-on-surface shrink-0 whitespace-nowrap">
                      <span class="count-tick inline-block">{#key row.active}{$t('storagePerformance.messages', { values: { n: row.active } })}{/key}</span>
                      {#if row.archived > 0}
                        <span class="text-md-on-surface/40"> · <span class="count-tick inline-block">{#key row.archived}{$t('storagePerformance.archivedCount', { values: { n: row.archived } })}{/key}</span></span>
                      {/if}
                    </span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
          {#if emailRetentionDays > 0}
            <button
              class="w-full px-3 py-2 text-xs rounded-xl bg-md-secondary text-md-on-secondary hover:bg-md-secondary/90 active:brightness-95 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onclick={onClearOldEmails}
            >
              {$t('storagePerformance.clearOldEmails')}
            </button>
          {/if}
        {/if}
      </div>
    </section>
    <!-- Dynamic End-of-Page Spacer: allows content to flow behind floating nav while ensuring the final section can scroll cleanly above controls -->
    <div
      class="w-full shrink-0 transition-[height] duration-200 ease-in-out pointer-events-none"
      style="height: calc(var(--bottom-safe-area, 0px) + 16px);"
      aria-hidden="true"
    ></div>
  </div>

</div>
