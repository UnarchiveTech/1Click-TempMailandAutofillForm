<script lang="ts">
import { onMount } from 'svelte';
import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import ToastContainer from '@/components/feedback/ToastContainer.svelte';
import Icon from '@/components/icons/Icon.svelte';
import { InputField, SelectField } from '@/components/ui/primitives';
import {
  exportProvidersAsJson,
  getAllProviderConfigs,
  loadProviderConfig,
  type ProviderConfig,
  saveProviderOverridesToStorage,
} from '@/utils/email-service.js';
import * as PingService from '@/utils/ping-service.js';
import { domainIndexKey } from '@/utils/storage-keys.js';
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
  onNavigateTo = undefined,
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
  onLoadProviderInstances?: () => void | Promise<void>;
  onSetDefaultDomain?: (v: string) => void;
  onSaveSettings?: () => void;
  onNavigateTo?: (view: string) => void;
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

// Domain override state - username -> effective domain string
let domainOverrides = $state<Record<string, string>>({});

// Runtime provider JSON editor (overrides bundled providers.jsonc via storage)
let jsonEditorOpen = $state(false);
let providerJsonText = $state('');
let jsonEditorError = $state('');
let jsonEditorStatus = $state('');
let jsonSaving = $state(false);

async function saveProviderJson() {
  jsonEditorError = '';
  jsonEditorStatus = '';
  jsonSaving = true;
  try {
    const parsed = JSON.parse(providerJsonText) as ProviderConfig[];
    if (!Array.isArray(parsed)) throw new Error('Root must be a JSON array of providers');
    await saveProviderOverridesToStorage(browser, parsed);
    jsonEditorStatus = get(t)('mailProvider.editJsonSaved') as string;
    toastStore.success(get(t)('mailProvider.editJsonSaved') as string);
  } catch (e) {
    jsonEditorError = e instanceof Error ? e.message : String(e);
  } finally {
    jsonSaving = false;
  }
}

async function resetProviderJson() {
  jsonSaving = true;
  jsonEditorError = '';
  try {
    await saveProviderOverridesToStorage(browser, null);
    providerJsonText = exportProvidersAsJson();
    jsonEditorStatus = get(t)('mailProvider.editJsonResetDone') as string;
  } catch (e) {
    jsonEditorError = e instanceof Error ? e.message : String(e);
  } finally {
    jsonSaving = false;
  }
}

async function loadDomainOverrides() {
  const config = loadProviderConfig(selectedProvider);
  const domains = config.multiDomain?.domains || [];
  if (domains.length === 0) return;
  const multiDomainAccounts = allInboxes.filter((a: Account) => a.provider === selectedProvider);
  if (multiDomainAccounts.length === 0) return;
  const keys = multiDomainAccounts.map((a: Account) =>
    domainIndexKey(selectedProvider, a.address.split('@')[0])
  );
  const result = (await browser.storage.local.get(keys)) as Record<string, number>;
  const overrides: Record<string, string> = {};
  for (const acc of multiDomainAccounts) {
    const username = acc.address.split('@')[0];
    const key = domainIndexKey(selectedProvider, username);
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
  const timer = setTimeout(() => pingAllProviders(), 100);
  return () => clearTimeout(timer);
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

  const prevDefault = defaultDomain;
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
    /** Snapshot previous domain indices for undo */
    const undoSnapshot: Record<string, number> = {};
    for (const acc of toUpdate) {
      const key = domainIndexKey(selectedProvider, acc.address.split('@')[0]);
      const prev = (await browser.storage.local.get([key])) as Record<string, number | undefined>;
      if (typeof prev[key] === 'number') undoSnapshot[key] = prev[key] as number;
      else undoSnapshot[key] = 0;
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
        }),
        10000,
        async () => {
          await browser.storage.local.set(undoSnapshot);
          onSetDefaultDomain?.(prevDefault || '');
          onSaveSettings();
          await loadDomainOverrides();
          toastStore.info(get(t)('mailProvider.domainSwitchUndone') as string);
        }
      );
      await loadDomainOverrides();
    }
  }

  domainSwitchDialog = null;
}
</script>

<div class="flex flex-col h-full">
  <!-- Title + actions - back lives in app header on this deep page -->
  <div class="flex items-center gap-3 px-4 py-4 border-b border-md-outline-variant/30">
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

  <div class="flex-1 overflow-y-auto px-2 py-3 space-y-4">

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
                    <span class="text-xs text-md-on-surface/50 ms-2">{getPingDot(fastestPing)} {PingService.formatPing(fastestPing)}</span>
                  {:else}
                    <span class="text-xs text-md-on-surface/50 ms-2">⏳</span>
                  {/if}
                {/if}
              {/each}
            </span>
            <Icon name="chevronDown" class="w-4 h-4 ms-2" />
          </button>
          {#if providerDropdownOpen}
            <div class="absolute top-full inset-x-0 mt-1 bg-md-primary-container rounded-xl shadow-lg border border-md-secondary-container z-50 max-h-60 overflow-y-auto">
              {#each allProviders as provider}
                {@const providerId = provider.id}
                {@const pingResults = providerPingResults.get(providerId)}
                {@const fastestPing = pingResults ? PingService.getFastestPing(pingResults) : null}
                <button
                  class="w-full px-4 py-2 text-sm text-start hover:bg-md-secondary-container flex items-center justify-between"
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
          <div class="text-xs font-semibold text-md-on-surface/40 uppercase tracking-wider mb-1.5">{$t('mailProvider.instance')}</div>
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
                        <span class="text-xs text-md-on-surface/50 ms-2">{getPingDot(instancePing)} {PingService.formatPing(instancePing)}</span>
                      {:else}
                        <span class="text-xs text-md-on-surface/50 ms-2">⏳</span>
                      {/if}
                    {/if}
                  {/each}
                {/if}
              </span>
              <Icon name="chevronDown" class="w-4 h-4 ms-2" />
            </button>
            {#if instanceDropdownOpen}
              <div class="absolute top-full inset-x-0 mt-1 bg-md-primary-container rounded-xl shadow-lg border border-md-secondary-container z-50 max-h-60 overflow-y-auto">
                <button
                  class="w-full px-4 py-2 text-sm text-start hover:bg-md-secondary-container"
                  onclick={() => { onSetProviderInstance('random'); instanceDropdownOpen = false; }}
                >{$t('mailProvider.randomInstance')}</button>
                {#each providerInstances as instance}
                  {@const pingResults = providerPingResults.get(selectedProvider)}
                  {@const instancePing = pingResults?.get(instance.id)}
                  <button
                    class="w-full px-4 py-2 text-sm text-start hover:bg-md-secondary-container flex items-center justify-between"
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
              <InputField placeholder={$t('mailProvider.instanceNamePlaceholder')} bind:value={customInstanceName} />
            </div>
            <div class="border-t border-md-outline-variant/30"></div>
            <div>
              <div class="text-xs font-semibold text-md-on-surface/40 uppercase tracking-wider mb-1.5">{$t('mailProvider.apiUrl')}</div>
              <InputField type="url" placeholder={$t('mailProvider.apiUrlPlaceholder')} bind:value={customInstanceUrl} />
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
          <div class="text-xs font-semibold text-md-on-surface/40 uppercase tracking-wider mb-1.5">{$t('mailProvider.defaultDomain')}</div>

          <!-- Domain address count stats -->
          {#if multiDomainActive.length > 0}
            <div class="flex flex-wrap gap-x-3 gap-y-1 mb-2.5">
              {#each md?.domains || [] as d}
                {@const count = multiDomainActive.filter((a: Account) => getEffectiveDomain(a) === d).length}
                <div class="flex items-center gap-1.5">
                  <span class="text-label-sm font-medium text-md-on-surface">@{d}</span>
                  <span class="text-xs px-1.5 py-0.5 rounded-full font-semibold {count > 0 ? 'bg-md-primary/15 text-md-primary' : 'bg-md-secondary-container text-md-on-surface/40'}">{count}</span>
                </div>
              {/each}
            </div>
          {/if}

          <SelectField
            value={defaultDomain || ''}
            onchange={(e) => openDomainSwitchDialog(e.currentTarget.value)}
          >
            <option value="">{$t('mailProvider.cycleNoDefault')}</option>
            {#each md?.domains || [] as domain}
              <option value={domain}>@{domain}</option>
            {/each}
          </SelectField>
          <div class="text-xs text-md-on-surface/50 mt-1">{$t('mailProvider.defaultDomainDescription')}</div>
        </div>
      {/if}
    </section>

    <!-- Advanced: edit providers JSON (runtime override of providers.jsonc) -->
    <section class="space-y-2">
      <div class="text-xs font-semibold text-md-on-surface/50 uppercase tracking-wider px-1">{$t('mailProvider.editJsonTitle')}</div>
      <div class="bg-md-primary-container rounded-xl px-3 py-3 space-y-2">
        <p class="text-xs text-md-on-surface/60">{$t('mailProvider.editJsonHint')}</p>
        {#if !jsonEditorOpen}
          <button
            type="button"
            class="w-full px-3 py-2 text-sm font-semibold rounded-xl border border-md-primary text-md-primary hover:bg-md-primary/10 transition-colors"
            onclick={() => {
              providerJsonText = exportProvidersAsJson();
              jsonEditorOpen = true;
              jsonEditorError = '';
              jsonEditorStatus = '';
            }}
          >
            {$t('mailProvider.editJsonOpen')}
          </button>
        {:else}
          <textarea
            class="w-full min-h-[180px] max-h-[320px] text-xs font-mono rounded-xl border border-md-outline-variant bg-md-surface px-2 py-2 outline-none focus:ring-2 focus:ring-md-primary"
            bind:value={providerJsonText}
            spellcheck="false"
            aria-label={$t('mailProvider.editJsonTitle')}
          ></textarea>
          {#if jsonEditorError}
            <p class="text-xs text-md-error">{jsonEditorError}</p>
          {/if}
          {#if jsonEditorStatus}
            <p class="text-xs text-md-primary">{jsonEditorStatus}</p>
          {/if}
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="flex-1 min-w-[6rem] px-2 py-1.5 text-xs font-semibold rounded-lg bg-md-primary text-md-on-primary"
              disabled={jsonSaving}
              onclick={() => void saveProviderJson()}
            >{$t('common.save')}</button>
            <button
              type="button"
              class="flex-1 min-w-[6rem] px-2 py-1.5 text-xs font-semibold rounded-lg border border-md-outline-variant"
              onclick={() => {
                providerJsonText = exportProvidersAsJson();
                jsonEditorError = '';
                jsonEditorStatus = '';
              }}
            >{$t('mailProvider.editJsonReload')}</button>
            <button
              type="button"
              class="flex-1 min-w-[6rem] px-2 py-1.5 text-xs font-semibold rounded-lg border border-md-error text-md-error"
              disabled={jsonSaving}
              onclick={() => void resetProviderJson()}
            >{$t('mailProvider.editJsonReset')}</button>
            <button
              type="button"
              class="flex-1 min-w-[6rem] px-2 py-1.5 text-xs font-semibold rounded-lg bg-md-surface-variant"
              onclick={() => {
                jsonEditorOpen = false;
                jsonEditorError = '';
                jsonEditorStatus = '';
              }}
            >{$t('common.close')}</button>
          </div>
        {/if}
      </div>
      <p class="text-label-sm text-md-on-surface/45 px-1">{$t('mailProvider.inboxMovedHint')}</p>
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
          class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 transition-colors text-start {domainSwitchScope === 'new' ? 'border-md-primary bg-md-primary/10' : 'border-md-secondary-container bg-transparent'}"
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
            class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 transition-colors text-start {domainSwitchScope === 'existing' ? 'border-md-primary bg-md-primary/10' : 'border-md-secondary-container bg-transparent'}"
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
        <div class="bg-md-secondary-container/50 rounded-xl px-2 py-2 mb-4 space-y-2">
          <button class="w-full flex items-center gap-2 text-start" onclick={() => { domainSwitchAll = true; }}>
            <div class="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 {domainSwitchAll ? 'border-md-primary' : 'border-md-outline-variant'}">
              {#if domainSwitchAll}<div class="w-2 h-2 rounded-full bg-md-primary"></div>{/if}
            </div>
            <span class="text-xs text-md-on-surface">{$t('mailProvider.changeAllAddresses')}</span>
          </button>
          <button class="w-full flex items-center gap-2 text-start" onclick={() => { domainSwitchAll = false; }}>
            <div class="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 {!domainSwitchAll ? 'border-md-primary' : 'border-md-outline-variant'}">
              {#if !domainSwitchAll}<div class="w-2 h-2 rounded-full bg-md-primary"></div>{/if}
            </div>
            <span class="text-xs text-md-on-surface">{$t('mailProvider.onlyAddressesUsingDomain')}</span>
          </button>
          {#if !domainSwitchAll}
            <SelectField class="mt-1" bind:value={domainSwitchFromDomain}>
              <option value="">{$t('mailProvider.selectDomainFrom')}</option>
              {#each domains.filter(d => (domainCounts[d] ?? 0) > 0) as d}
                <option value={d}>@{d} ({$t('mailProvider.addressCount', { default: 'mailProvider.addressCountPlural', values: { n: domainCounts[d] } })})</option>
              {/each}
            </SelectField>
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
