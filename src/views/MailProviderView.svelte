<script lang="ts">
import { onMount } from 'svelte';
import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import ToastContainer from '@/components/feedback/ToastContainer.svelte';
import Icon from '@/components/icons/Icon.svelte';
import {
  getAllProviderConfigs,
  loadProviderConfig,
  type ProviderConfig,
} from '@/utils/email-service.js';
import * as PingService from '@/utils/ping-service.js';
import { toastStore } from '@/utils/toastStore.js';
import type { Account, ProviderInstance } from '@/utils/types.js';

let {
  onBack = () => {},
  selectedProvider = '',
  autoRenew = false,
  notificationsEnabled = false,
  soundEnabled = false,
  expiryWarningThreshold = 60 * 60 * 1000,
  autoRefreshInterval = 30000,
  emailPreviewEnabled = true,
  providerInstances = [] as ProviderInstance[],
  selectedProviderInstance = null as string | null,
  defaultDomain = '',
  allInboxes = [] as Account[],
  onProviderChange = (_p: string) => {},
  onSetAutoRenew = undefined as ((v: boolean) => void) | undefined,
  onSetNotificationsEnabled = undefined as ((v: boolean) => void) | undefined,
  onSetSoundEnabled = undefined as ((v: boolean) => void) | undefined,
  onSetExpiryWarningThreshold = undefined as ((v: number) => void) | undefined,
  onSetAutoRefreshInterval = undefined as ((v: number) => void) | undefined,
  onSetEmailPreviewEnabled = undefined as ((v: boolean) => void) | undefined,
  onSetProviderInstance = (_id: string) => {},
  onAddCustomInstance = (_name: string, _url: string) => {},
  onLoadProviderInstances = async () => {},
  onSetDefaultDomain = undefined as ((v: string) => void) | undefined,
  onSaveSettings = () => {},
} = $props<{
  onBack?: () => void;
  selectedProvider?: string;
  autoRenew?: boolean;
  notificationsEnabled?: boolean;
  soundEnabled?: boolean;
  expiryWarningThreshold?: number;
  autoRefreshInterval?: number;
  emailPreviewEnabled?: boolean;
  providerInstances?: ProviderInstance[];
  selectedProviderInstance?: string | null;
  defaultDomain?: string;
  allInboxes?: Account[];
  onProviderChange?: (p: string) => void;
  onSetAutoRenew?: (v: boolean) => void;
  onSetNotificationsEnabled?: (v: boolean) => void;
  onSetSoundEnabled?: (v: boolean) => void;
  onSetExpiryWarningThreshold?: (v: number) => void;
  onSetAutoRefreshInterval?: (v: number) => void;
  onSetEmailPreviewEnabled?: (v: boolean) => void;
  onSetProviderInstance?: (id: string) => void;
  onAddCustomInstance?: (name: string, url: string) => void;
  onLoadProviderInstances?: () => Promise<void>;
  onSetDefaultDomain?: (v: string) => void;
  onSaveSettings?: () => void;
}>();

let allProviders = $derived.by((): ProviderConfig[] => getAllProviderConfigs());
let providerDropdownOpen = $state(false);
let instanceDropdownOpen = $state(false);
let showCustomInstanceForm = $state(false);
let customInstanceName = $state('');
let customInstanceUrl = $state('');
let pinging = $state(false);
let providerPingResults = $state(new Map<string, Map<string, number | 'timeout'>>());

async function pingAllProviders() {
  if (pinging) return;
  pinging = true;
  const results = new Map<string, Map<string, number | 'timeout'>>();
  for (const provider of allProviders) {
    const config = loadProviderConfig(provider.id);
    const pingResults = await PingService.pingProviderInstances(
      config,
      config.multiInstance?.enabled && providerInstances.length > 0 ? providerInstances : []
    );
    results.set(provider.id, pingResults);
  }
  providerPingResults = results;
  pinging = false;
}

function getPingDot(ping: number | 'timeout'): string {
  if (ping === 'timeout') return '🔴';
  if (ping < 100) return '🟢';
  if (ping < 300) return '🟡';
  return '🔴';
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
  if (!name || !url) return;
  onAddCustomInstance(name, url);
  hideCustomInstanceForm();
}

// Domain override state — username -> effective domain string
let domainOverrides = $state<Record<string, string>>({});

async function loadDomainOverrides() {
  const config = loadProviderConfig(selectedProvider);
  const domains = config.multiDomain?.domains || [];
  if (domains.length === 0) return;
  const multiDomainAccounts = allInboxes.filter((a: Account) => a.provider === selectedProvider);
  if (multiDomainAccounts.length === 0) return;
  const keys = multiDomainAccounts.map(
    (a: Account) => `domainIndex_${selectedProvider}_${a.address.split('@')[0]}`
  );
  const result = (await browser.storage.local.get(keys)) as Record<string, number>;
  const overrides: Record<string, string> = {};
  for (const acc of multiDomainAccounts) {
    const username = acc.address.split('@')[0];
    const key = `domainIndex_${selectedProvider}_${username}`;
    const idx = result[key];
    overrides[username] = idx !== undefined ? domains[idx] || domains[0] : domains[0];
  }
  domainOverrides = overrides;
}

function getEffectiveDomain(account: Account): string {
  if (!loadProviderConfig(account.provider).multiDomain?.enabled)
    return account.address.split('@')[1] || '';
  const username = account.address.split('@')[0];
  return domainOverrides[username] || account.address.split('@')[1] || '';
}

onMount(() => {
  loadDomainOverrides();
});

$effect(() => {
  setTimeout(() => pingAllProviders(), 100);
});

$effect(() => {
  const config = loadProviderConfig(selectedProvider);
  if (config.multiInstance?.enabled) onLoadProviderInstances();
  if (config.multiDomain?.enabled) loadDomainOverrides();
});

// Reload overrides when inboxes change
$effect(() => {
  if (allInboxes.length >= 0 && loadProviderConfig(selectedProvider).multiDomain?.enabled)
    loadDomainOverrides();
});

// Domain switch dialog state
let domainSwitchDialog = $state<{
  pendingDomain: string;
  domains: string[];
  domainCounts: Record<string, number>;
} | null>(null);
let domainSwitchScope = $state<'new' | 'existing'>('new');
let domainSwitchAll = $state(true);
let domainSwitchFromDomain = $state<string>('');

function openDomainSwitchDialog(newDomain: string) {
  const config = loadProviderConfig(selectedProvider);
  const domains = config.multiDomain?.domains || [];
  const multiDomainAccounts = allInboxes.filter(
    (a: Account) => a.provider === selectedProvider && a.status === 'active'
  );
  const domainCounts: Record<string, number> = {};
  for (const d of domains) domainCounts[d] = 0;
  for (const acc of multiDomainAccounts) {
    const d = getEffectiveDomain(acc);
    if (d && d in domainCounts) domainCounts[d]++;
  }
  domainSwitchDialog = { pendingDomain: newDomain, domains, domainCounts };
  domainSwitchScope = 'new';
  domainSwitchAll = true;
  domainSwitchFromDomain = '';
}

async function applyDomainSwitch() {
  if (!domainSwitchDialog) return;
  const { pendingDomain, domains } = domainSwitchDialog;

  onSetDefaultDomain?.(pendingDomain);
  onSaveSettings();

  if (domainSwitchScope === 'existing') {
    const { inboxes = [] } = (await browser.storage.local.get(['inboxes'])) as {
      inboxes?: Account[];
    };
    const toUpdate = domainSwitchAll
      ? inboxes.filter((a) => a.provider === selectedProvider && a.status === 'active')
      : inboxes.filter((a) => {
          const d = getEffectiveDomain(a);
          return (
            a.provider === selectedProvider && a.status === 'active' && d === domainSwitchFromDomain
          );
        });

    const pendingIndex = domains.indexOf(pendingDomain);
    const storageUpdates: Record<string, number> = {};
    for (const acc of toUpdate) {
      const key = `domainIndex_${selectedProvider}_${acc.address.split('@')[0]}`;
      storageUpdates[key] = pendingIndex >= 0 ? pendingIndex : 0;
    }
    if (Object.keys(storageUpdates).length > 0) {
      await browser.storage.local.set(storageUpdates);
    }
    if (toUpdate.length > 0) {
      toastStore.success(
        get(t)('mailProvider.updatedAddresses', {
          default: 'mailProvider.updatedAddressesPlural',
          values: { n: toUpdate.length, domain: pendingDomain },
        })
      );
      await loadDomainOverrides();
    }
  }

  domainSwitchDialog = null;
}
</script>

<div class="flex flex-col h-full">
  <!-- Header -->
  <div class="flex items-center gap-3 px-4 py-4 border-b border-md-secondary-container">
    <button
      class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-md-secondary-container transition-colors"
      onclick={onBack}
      aria-label={$t('common.back')}
    >
      <Icon name="chevronLeft" class="w-5 h-5" />
    </button>
    <div class="flex-1">
      <h1 class="text-base font-bold text-md-on-surface">{$t('mailProvider.title')}</h1>
      <p class="text-xs text-md-on-surface/50">{$t('mailProvider.subtitle')}</p>
    </div>
    <button
      class="w-8 h-8 flex items-center justify-center rounded-full hover:bg-md-secondary-container transition-colors"
      onclick={() => { providerPingResults = new Map(); pingAllProviders(); }}
      aria-label={$t('mailProvider.rep')}
    >
      <Icon name="refresh" class="w-4 h-4" />
    </button>
  </div>

  <div class="flex-1 overflow-y-auto px-4 py-4 space-y-4">

    <!-- Provider Selection -->
    <section class="space-y-2">
      <div class="text-xs font-semibold text-md-on-surface/50 uppercase tracking-wider px-1">{$t('mailProvider.provider')}</div>
      <div class="bg-md-primary-container rounded-xl px-4 py-3">
        <div class="text-xs font-semibold text-md-secondary uppercase tracking-wider mb-1.5">{$t('mailProvider.mailProvider')}</div>
        <div class="relative">
          <button
            class="w-full bg-transparent text-sm outline-none text-md-on-surface appearance-none cursor-pointer font-medium flex items-center justify-between"
            onclick={() => providerDropdownOpen = !providerDropdownOpen}
            aria-label={$t('mailProvider.selectMailProvider')}
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
            <Icon name="chevronDown" class="w-4 h-4 ml-2" />
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

      <!-- Instance Selection -->
      {#if loadProviderConfig(selectedProvider).multiInstance?.enabled}
        <div class="bg-md-primary-container rounded-xl px-4 py-3">
          <div class="text-[10px] font-semibold text-md-on-surface/40 uppercase tracking-wider mb-1.5">{$t('mailProvider.instance')}</div>
          <div class="relative">
            <button
              class="w-full bg-transparent text-sm outline-none text-md-on-surface appearance-none cursor-pointer font-medium flex items-center justify-between"
              onclick={() => instanceDropdownOpen = !instanceDropdownOpen}
              aria-label={$t('mailProvider.selectProviderInstance')}
            >
              <span>
                {#if selectedProviderInstance === 'random' || !selectedProviderInstance}
                  {$t('mailProvider.randomInstance')}
                {:else}
                  {#each providerInstances as instance}
                    {#if instance.id === selectedProviderInstance}
                      {@const pingResults = providerPingResults.get(selectedProvider)}
                      {@const instancePing = pingResults?.get(instance.id)}
                      {instance.displayName}{instance.isCustom ? $t('mailProvider.instanceCustom') : ''}
                      {#if instancePing !== undefined && instancePing !== null}
                        <span class="text-xs text-md-on-surface/50 ml-2">{getPingDot(instancePing)} {PingService.formatPing(instancePing)}</span>
                      {:else}
                        <span class="text-xs text-md-on-surface/50 ml-2">⏳</span>
                      {/if}
                    {/if}
                  {/each}
                {/if}
              </span>
              <Icon name="chevronDown" class="w-4 h-4 ml-2" />
            </button>
            {#if instanceDropdownOpen}
              <div class="absolute top-full left-0 right-0 mt-1 bg-md-primary-container rounded-xl shadow-lg border border-md-secondary-container z-50 max-h-60 overflow-y-auto">
                <button
                  class="w-full px-4 py-2 text-sm text-left hover:bg-md-secondary-container"
                  onclick={() => { onSetProviderInstance('random'); instanceDropdownOpen = false; }}
                >{$t('mailProvider.randomInstance')}</button>
                {#each providerInstances as instance}
                  {@const pingResults = providerPingResults.get(selectedProvider)}
                  {@const instancePing = pingResults?.get(instance.id)}
                  <button
                    class="w-full px-4 py-2 text-sm text-left hover:bg-md-secondary-container flex items-center justify-between"
                    onclick={() => { onSetProviderInstance(instance.id); instanceDropdownOpen = false; }}
                  >
                    <span>{instance.displayName}{instance.isCustom ? $t('mailProvider.instanceCustom') : ''}</span>
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
          <button class="btn-primary w-full rounded-xl py-2.5 flex items-center justify-center gap-2 text-sm" onclick={showAddCustomInstance}>
            <Icon name="plus" class="w-4 h-4" />{$t('mailProvider.addInstance')}
          </button>
        {:else}
          <div class="bg-md-primary-container rounded-xl px-4 py-3 space-y-3">
            <div>
              <div class="text-xs font-semibold text-md-tertiary uppercase tracking-wider mb-1.5">{$t('mailProvider.instanceName')}</div>
              <input type="text" class="w-full bg-transparent text-sm outline-none text-md-on-surface placeholder:text-md-on-surface/30" placeholder={$t('mailProvider.instanceNamePlaceholder')} bind:value={customInstanceName} />
            </div>
            <div class="border-t border-md-secondary-container"></div>
            <div>
              <div class="text-[10px] font-semibold text-md-on-surface/40 uppercase tracking-wider mb-1.5">{$t('mailProvider.apiUrl')}</div>
              <input type="url" class="w-full bg-transparent text-sm outline-none text-md-on-surface placeholder:text-md-on-surface/30" placeholder={$t('mailProvider.apiUrlPlaceholder')} bind:value={customInstanceUrl} />
            </div>
            <div class="flex gap-2">
              <button class="flex-1 px-3 py-1.5 text-sm rounded-xl bg-md-primary text-md-on-primary hover:bg-md-primary/90 transition-colors" onclick={saveCustomInstance}>{$t('mailProvider.save')}</button>
              <button class="flex-1 px-3 py-1.5 text-sm rounded-xl bg-md-secondary text-md-on-secondary hover:bg-md-secondary/90 transition-colors" onclick={hideCustomInstanceForm}>{$t('mailProvider.cancel')}</button>
            </div>
          </div>
        {/if}
      {/if}

      <!-- Default Domain -->
      {#if loadProviderConfig(selectedProvider).multiDomain?.enabled}
        {@const md = loadProviderConfig(selectedProvider).multiDomain}
        {@const multiDomainActive = allInboxes.filter((a: Account) => a.provider === selectedProvider && a.status === 'active')}
        {@const _overrides = domainOverrides}
        <div class="bg-md-tertiary-container rounded-xl px-4 py-3">
          <div class="text-[10px] font-semibold text-md-on-surface/40 uppercase tracking-wider mb-1.5">{$t('mailProvider.defaultDomain')}</div>

          <!-- Domain address count stats -->
          {#if multiDomainActive.length > 0}
            <div class="flex flex-wrap gap-x-3 gap-y-1 mb-2.5">
              {#each md?.domains || [] as d}
                {@const count = multiDomainActive.filter((a: Account) => getEffectiveDomain(a) === d).length}
                <div class="flex items-center gap-1.5">
                  <span class="text-[11px] font-medium text-md-on-surface">@{d}</span>
                  <span class="text-[10px] px-1.5 py-0.5 rounded-full font-semibold {count > 0 ? 'bg-md-primary/15 text-md-primary' : 'bg-md-secondary-container text-md-on-surface/40'}">{count}</span>
                </div>
              {/each}
            </div>
          {/if}

          <div class="relative">
            <select
              class="w-full bg-transparent text-sm outline-none text-md-on-surface appearance-none cursor-pointer font-medium"
              value={defaultDomain || ''}
              onchange={(e) => openDomainSwitchDialog(e.currentTarget.value)}
            >
              <option value="">{$t('mailProvider.cycleNoDefault')}</option>
              {#each md?.domains || [] as domain}
                <option value={domain}>@{domain}</option>
              {/each}
            </select>
          </div>
          <div class="text-[10px] text-md-on-surface/50 mt-1">{$t('mailProvider.defaultDomainDescription')}</div>
        </div>
      {/if}
    </section>

    <!-- Inbox Behaviour -->
    <section class="space-y-2">
      <div class="text-xs font-semibold text-md-on-surface/50 uppercase tracking-wider px-1">{$t('mailProvider.inboxBehaviour')}</div>

      <!-- Auto-Renew -->
      <div class="bg-md-primary-container rounded-xl px-4 py-3 flex items-center justify-between">
        <div>
          <div class="text-sm font-medium text-md-on-surface">{$t('mailProvider.autoRenew')}</div>
          <div class="text-xs text-md-on-surface/50">{$t('mailProvider.autoRenewDescription')}</div>
        </div>
        <button
          class="w-8 h-8 flex items-center justify-center rounded-xl border-0 {autoRenew ? 'bg-md-primary/10 hover:bg-md-primary/20 text-md-primary' : 'bg-md-secondary-container hover:bg-md-outline-variant text-md-on-surface/60'} transition-colors"
          onclick={() => { onSetAutoRenew?.(!autoRenew); onSaveSettings(); }}
          aria-label={$t('mailProvider.toggleAutoRenew')}
        >
          <Icon name="refresh" class="w-5 h-5" />
        </button>
      </div>

      <!-- Auto-Refresh Interval -->
      <div class="bg-md-primary-container rounded-xl px-4 py-3">
        <div class="text-sm font-medium text-md-on-surface mb-3">{$t('mailProvider.autoRefreshInterval')}</div>
        <div class="flex items-center justify-between gap-3">
          <p class="text-xs text-md-on-surface/60 flex-1">{$t('mailProvider.autoRefreshDescription')}</p>
          <select
            class="text-xs bg-md-surface border border-md-outline-variant rounded-lg px-2 py-1.5 text-md-on-surface focus:outline-none focus:ring-2 focus:ring-md-primary flex-shrink-0"
            value={autoRefreshInterval}
            onchange={(e) => { onSetAutoRefreshInterval?.(Number((e.target as HTMLSelectElement).value)); onSaveSettings?.(); }}
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
      </div>

      <!-- Email Preview -->
      <div class="bg-md-primary-container rounded-xl px-4 py-3">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-sm text-md-on-surface">{$t('mailProvider.emailPreviewTooltip')}</div>
            <div class="text-xs text-md-on-surface/50">{$t('mailProvider.emailPreviewTooltipDescription')}</div>
          </div>
          <button
            class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors {emailPreviewEnabled ? 'bg-md-primary' : 'bg-md-surface-variant'}"
            onclick={() => { onSetEmailPreviewEnabled?.(!emailPreviewEnabled); onSaveSettings?.(); }}
            aria-label={$t('mailProvider.toggleEmailPreview')}
          >
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform {emailPreviewEnabled ? 'translate-x-6' : 'translate-x-1'}"></span>
          </button>
        </div>
      </div>
    </section>

    <!-- Notifications -->
    <section class="space-y-2">
      <div class="text-xs font-semibold text-md-on-surface/50 uppercase tracking-wider px-1">{$t('mailProvider.notifications')}</div>
      <div class="bg-md-primary-container rounded-xl px-4 py-3 space-y-3">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-sm text-md-on-surface">{$t('mailProvider.enableNotifications')}</div>
            <div class="text-xs text-md-on-surface/50">{$t('mailProvider.enableNotificationsDescription')}</div>
          </div>
          <label class="cursor-pointer">
            <input type="checkbox" class="sr-only peer" checked={notificationsEnabled}
              onchange={(e) => { onSetNotificationsEnabled?.((e.target as HTMLInputElement).checked); onSaveSettings(); }} />
            <div class="relative w-9 h-5 bg-md-outline-variant peer-checked:bg-md-primary rounded-full peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
          </label>
        </div>
        <div class="h-px bg-md-secondary-container"></div>
        <div class="flex items-center justify-between">
          <div>
            <div class="text-sm text-md-on-surface">{$t('mailProvider.notificationSound')}</div>
            <div class="text-xs text-md-on-surface/50">{$t('mailProvider.notificationSoundDescription')}</div>
          </div>
          <label class="cursor-pointer">
            <input type="checkbox" class="sr-only peer" checked={soundEnabled}
              onchange={(e) => { onSetSoundEnabled?.((e.target as HTMLInputElement).checked); onSaveSettings(); }} />
            <div class="relative w-9 h-5 bg-md-outline-variant peer-checked:bg-md-primary rounded-full peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
          </label>
        </div>
        <div class="h-px bg-md-secondary-container"></div>
        <div class="flex items-center justify-between">
          <div>
            <div class="text-sm text-md-on-surface">{$t('mailProvider.expiryWarning')}</div>
            <div class="text-xs text-md-on-surface/50">{$t('mailProvider.expiryWarningDescription')}</div>
          </div>
          <select
            class="bg-md-secondary-container text-sm text-md-on-surface px-3 py-1.5 rounded-lg outline-none border-0 cursor-pointer font-medium"
            value={expiryWarningThreshold}
            onchange={(e) => { onSetExpiryWarningThreshold?.(Number((e.target as HTMLSelectElement).value)); onSaveSettings(); }}
          >
            <option value={15 * 60 * 1000}>{$t('mailProvider.fifteenMinutes')}</option>
            <option value={5 * 60 * 1000}>{$t('mailProvider.fiveMinutesShort')}</option>
            <option value={60 * 1000}>{$t('mailProvider.oneMinuteShort')}</option>
            <option value={60 * 60 * 1000}>{$t('mailProvider.oneHour')}</option>
          </select>
        </div>
      </div>
    </section>

  </div>
</div>

<!-- Domain Switch Dialog -->
{#if domainSwitchDialog}
  {@const { pendingDomain, domains, domainCounts } = domainSwitchDialog}
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="domain-switch-title">
    <div class="bg-md-surface rounded-2xl p-5 w-full max-w-sm shadow-2xl">
      <div id="domain-switch-title" class="text-sm font-semibold text-md-on-surface mb-1">{$t('mailProvider.switchDefaultDomain')}</div>
      <div class="text-xs text-md-on-surface/60 mb-4">
        {#if pendingDomain}
          {$t('mailProvider.switchingTo')} <span class="font-medium text-md-primary">@{pendingDomain}</span>
        {:else}
          {$t('mailProvider.removingDefaultDomain')}
        {/if}
      </div>

      <!-- Domain usage stats -->
      <div class="bg-md-secondary-container/50 rounded-xl px-3 py-2 mb-4 space-y-1">
        {#each domains as d}
          {@const count = domainCounts[d] ?? 0}
          <div class="flex justify-between items-center text-xs">
            <span class="text-md-on-surface/70">@{d}</span>
            <span class="font-medium text-md-on-surface">{$t('mailProvider.addressCount', { default: 'mailProvider.addressCountPlural', values: { n: count } })}</span>
          </div>
        {/each}
      </div>

      <!-- Scope selector -->
      <div class="space-y-2 mb-4">
        <button
          class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 transition-colors text-left {domainSwitchScope === 'new' ? 'border-md-primary bg-md-primary/10' : 'border-md-secondary-container bg-transparent'}"
          onclick={() => { domainSwitchScope = 'new'; }}
        >
          <div class="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 {domainSwitchScope === 'new' ? 'border-md-primary' : 'border-md-outline-variant'}">
            {#if domainSwitchScope === 'new'}<div class="w-2 h-2 rounded-full bg-md-primary"></div>{/if}
          </div>
          <div>
            <div class="text-sm font-medium text-md-on-surface">{$t('mailProvider.newAddressesOnly')}</div>
            <div class="text-xs text-md-on-surface/50">{$t('mailProvider.newAddressesOnlyDescription')}</div>
          </div>
        </button>
        {#if pendingDomain}
          <button
            class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 transition-colors text-left {domainSwitchScope === 'existing' ? 'border-md-primary bg-md-primary/10' : 'border-md-secondary-container bg-transparent'}"
            onclick={() => { domainSwitchScope = 'existing'; }}
          >
            <div class="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 {domainSwitchScope === 'existing' ? 'border-md-primary' : 'border-md-outline-variant'}">
              {#if domainSwitchScope === 'existing'}<div class="w-2 h-2 rounded-full bg-md-primary"></div>{/if}
            </div>
            <div>
              <div class="text-sm font-medium text-md-on-surface">{$t('mailProvider.alsoChangeExisting')}</div>
              <div class="text-xs text-md-on-surface/50">{$t('mailProvider.alsoChangeExistingDescription')}</div>
            </div>
          </button>
        {/if}
      </div>

      <!-- Sub-options when changing existing -->
      {#if domainSwitchScope === 'existing'}
        <div class="bg-md-secondary-container/50 rounded-xl px-3 py-3 mb-4 space-y-2">
          <button class="w-full flex items-center gap-2 text-left" onclick={() => { domainSwitchAll = true; }}>
            <div class="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 {domainSwitchAll ? 'border-md-primary' : 'border-md-outline-variant'}">
              {#if domainSwitchAll}<div class="w-2 h-2 rounded-full bg-md-primary"></div>{/if}
            </div>
            <span class="text-xs text-md-on-surface">{$t('mailProvider.changeAllAddresses')}</span>
          </button>
          <button class="w-full flex items-center gap-2 text-left" onclick={() => { domainSwitchAll = false; }}>
            <div class="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 {!domainSwitchAll ? 'border-md-primary' : 'border-md-outline-variant'}">
              {#if !domainSwitchAll}<div class="w-2 h-2 rounded-full bg-md-primary"></div>{/if}
            </div>
            <span class="text-xs text-md-on-surface">{$t('mailProvider.onlyAddressesUsingDomain')}</span>
          </button>
          {#if !domainSwitchAll}
            <select
              class="w-full mt-1 bg-md-primary-container text-sm text-md-on-surface rounded-lg px-3 py-2 outline-none border border-md-secondary-container"
              bind:value={domainSwitchFromDomain}
            >
              <option value="">{$t('mailProvider.selectDomainFrom')}</option>
              {#each domains.filter(d => (domainCounts[d] ?? 0) > 0) as d}
                <option value={d}>@{d} ({$t('mailProvider.addressCount', { default: 'mailProvider.addressCountPlural', values: { n: domainCounts[d] } })})</option>
              {/each}
            </select>
          {/if}
        </div>
      {/if}

      <!-- Action buttons -->
      <div class="flex gap-2">
        <button
          class="flex-1 px-4 py-2 text-sm rounded-xl bg-md-secondary-container text-md-on-surface hover:bg-md-secondary-container/80 transition-colors"
          onclick={() => { domainSwitchDialog = null; }}
        >{$t('mailProvider.cancel')}</button>
        <button
          class="flex-1 px-4 py-2 text-sm rounded-xl bg-md-primary text-md-on-primary hover:bg-md-primary/90 transition-colors disabled:opacity-50"
          disabled={domainSwitchScope === 'existing' && !domainSwitchAll && !domainSwitchFromDomain}
          onclick={applyDomainSwitch}
        >{$t('mailProvider.apply')}</button>
      </div>
    </div>
  </div>
{/if}

<ToastContainer />
