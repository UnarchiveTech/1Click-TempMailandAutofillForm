<script lang="ts">
import { onMount } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import {
  loadSiteEmailRejections,
  SITE_EMAIL_REJECTIONS_KEY,
} from '@/features/intelligence/site-email-rejections.js';
import { loadSiteRules, type SiteRule } from '@/features/intelligence/site-rules.js';
import { loadSiteProfiles, normalizeDomain } from '@/features/intelligence/storage.js';
import type { SiteProfile } from '@/features/intelligence/types.js';
import ButtonGroup from '@/ui/components/composites/ButtonGroup.svelte';
import EmptyState from '@/ui/components/composites/EmptyState.svelte';
import SearchFilterHeader from '@/ui/components/composites/SearchFilterHeader.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import type { KnownIconName } from '@/ui/components/icons/icon-names.js';
import Btn from '@/ui/components/primitives/Btn.svelte';
import { persistentWebmcpAccess } from '@/utils/browser/webmcp-access.js';
import { copyToClipboardAndSchedulePurge } from '@/utils/clipboard/clipboard.js';
import { logError } from '@/utils/logger.js';
import type { Address, CredentialsHistoryItem, Identity } from '@/utils/types.js';
import { rowSurface } from '@/utils/ui/row-surface.js';
import { toastStore } from '@/utils/ui/toastStore.js';
import { hostMatchesDomainScope } from '@/utils/validation.js';

type SiteRow = {
  domain: string;
  logins: CredentialsHistoryItem[];
  emails: string[];
  identities: string[];
  lastUsedAt: number;
  hasMemory: boolean;
  rules: SiteRule[];
  webmcp: boolean;
};

let {
  savedLogins = [] as CredentialsHistoryItem[],
  identities = [] as Identity[],
  allAddresses = [] as Address[],
  onOpenCredentials = (_domain: string) => {},
  onOpenInbox = async (_address: string) => {},
  focusSearchSignal = 0,
  initialDomain = '',
}: {
  savedLogins?: CredentialsHistoryItem[];
  identities?: Identity[];
  allAddresses?: Address[];
  onOpenCredentials?: (domain: string) => void;
  onOpenInbox?: (address: string) => Promise<void>;
  focusSearchSignal?: number;
  initialDomain?: string;
} = $props();

let siteProfiles = $state<Record<string, SiteProfile>>({});
let siteRules = $state<SiteRule[]>([]);
let webmcpAccessList = $state<string[]>([]);
let webmcpDecisions = $state<Record<string, unknown>>({});
let searchQuery = $state('');
let selectedDomain = $state('');
let loadError = $state(false);
let emailRejections = $state<Record<string, Record<string, number>>>({});
let clearingDomain = $state('');
let openingInbox = $state('');
let searchInput = $state<HTMLInputElement | null>(null);
let lastFocusSignal = 0;
let openedInitialDomain = $state('');

$effect(() => {
  if (!initialDomain || openedInitialDomain === initialDomain) return;
  // Data loads asynchronously. Expand the requested site only once it exists.
  const site = allSiteRows.find((row) => row.domain === normalizeDomain(initialDomain));
  if (!site) return;
  searchQuery = site.domain;
  selectedDomain = site.domain;
  openedInitialDomain = initialDomain;
});

$effect(() => {
  if (focusSearchSignal > 0 && focusSearchSignal !== lastFocusSignal && searchInput) {
    lastFocusSignal = focusSearchSignal;
    searchInput.focus();
  }
});

async function copyEmail(email: string) {
  try {
    if (!(await copyToClipboardAndSchedulePurge(email))) throw new Error('Clipboard copy failed');
    toastStore.success($t('common.copied'));
  } catch (error) {
    logError('Failed to copy site email', error);
    toastStore.error($t('inbox.copyFailed'));
  }
}
async function openInbox(email: string) {
  if (openingInbox) return;
  openingInbox = email;
  try {
    await onOpenInbox(email);
  } catch (error) {
    logError('Failed to open site inbox', error);
    toastStore.error($t('toasts.operationFailed'));
  } finally {
    openingInbox = '';
  }
}

async function loadSiteData() {
  try {
    const [profiles, rules, stored, rejections] = await Promise.all([
      loadSiteProfiles(),
      loadSiteRules(),
      browser.storage.local.get(['webmcpAccessList', 'webmcpSiteDecisions']),
      loadSiteEmailRejections(),
    ]);
    siteProfiles = profiles;
    siteRules = rules;
    emailRejections = rejections;
    webmcpAccessList = Array.isArray(stored.webmcpAccessList)
      ? stored.webmcpAccessList.filter((value): value is string => typeof value === 'string')
      : [];
    webmcpDecisions =
      stored.webmcpSiteDecisions &&
      typeof stored.webmcpSiteDecisions === 'object' &&
      !Array.isArray(stored.webmcpSiteDecisions)
        ? (stored.webmcpSiteDecisions as Record<string, unknown>)
        : {};
    loadError = false;
  } catch {
    loadError = true;
  }
}

function ruleCoversDomain(rule: SiteRule, domain: string): boolean {
  if (rule.includeSubdomains === false)
    return normalizeDomain(domain) === normalizeDomain(rule.domainPattern.replace(/^\*\./, ''));
  return hostMatchesDomainScope(domain, rule.domainPattern.replace(/^\*\./, ''));
}

const allSiteRows = $derived.by(() => {
  const rows = new Map<string, SiteRow>();
  const getRow = (rawDomain: string, exactHost = false) => {
    // Rejection records preserve www. and every subdomain; credential grouping
    // can keep its established normalization without hiding a scoped policy.
    const domain = exactHost ? rawDomain : normalizeDomain(rawDomain);
    if (!domain) return null;
    let row = rows.get(domain);
    if (!row) {
      row = {
        domain,
        logins: [],
        emails: [],
        identities: [],
        lastUsedAt: 0,
        hasMemory: false,
        rules: [],
        webmcp: false,
      };
      rows.set(domain, row);
    }
    return row;
  };

  for (const login of savedLogins) {
    const row = getRow(login.domain || login.website || '');
    if (!row) continue;
    row.logins.push(login);
    row.lastUsedAt = Math.max(row.lastUsedAt, login.timestamp || 0);
    const linkedAddress = addressForLogin(login);
    if (linkedAddress && !row.emails.includes(linkedAddress.address)) {
      row.emails.push(linkedAddress.address);
    }
    const identity = identities.find((item: Identity) => item.id === login.identityId);
    if (identity && !row.identities.includes(identity.name)) row.identities.push(identity.name);
  }

  for (const profile of Object.values(siteProfiles)) {
    const row = getRow(profile.domain);
    if (!row) continue;
    row.hasMemory = true;
    row.lastUsedAt = Math.max(row.lastUsedAt, profile.lastSuccessAt || profile.updatedAt || 0);
    const linkedAddress = allAddresses.find(
      (address: Address) =>
        (!!profile.lastAddressId && address.id === profile.lastAddressId) ||
        (!!profile.lastEmail && address.address.toLowerCase() === profile.lastEmail.toLowerCase())
    );
    if (linkedAddress && !row.emails.includes(linkedAddress.address)) {
      row.emails.push(linkedAddress.address);
    }
    const identity = identities.find((item: Identity) => item.id === profile.lastIdentityId);
    if (identity && !row.identities.includes(identity.name)) row.identities.push(identity.name);
  }

  for (const rule of siteRules) {
    const patternDomain = rule.domainPattern.trim().replace(/^\*\./, '');
    const patternRow = getRow(patternDomain);
    if (patternRow && !patternRow.rules.some((item) => item.id === rule.id)) {
      patternRow.rules.push(rule);
    }
    for (const row of rows.values()) {
      if (ruleCoversDomain(rule, row.domain) && !row.rules.some((item) => item.id === rule.id)) {
        row.rules.push(rule);
      }
    }
  }

  for (const domain of Object.keys(emailRejections)) getRow(domain, true);
  for (const domain of Object.keys(webmcpDecisions)) getRow(domain, true);
  for (const row of rows.values()) {
    row.webmcp = persistentWebmcpAccess(row.domain, webmcpAccessList, webmcpDecisions);
  }

  return [...rows.values()].sort(
    (a, b) => b.lastUsedAt - a.lastUsedAt || a.domain.localeCompare(b.domain)
  );
});

const siteRows = $derived.by(() => {
  const query = searchQuery.trim().toLowerCase();
  if (!query) return allSiteRows;
  return allSiteRows.filter((row) => {
    const haystack = [
      row.domain,
      ...row.emails,
      ...row.identities,
      ...Object.keys(emailRejections[row.domain] || {}),
      ...row.logins.flatMap((login) => [login.username || '', login.name || '']),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  });
});

const selectedSite = $derived(siteRows.find((row) => row.domain === selectedDomain) || null);

function addressForLogin(login: CredentialsHistoryItem): Address | undefined {
  return allAddresses.find(
    (address: Address) =>
      (login.addressId && address.id === login.addressId) ||
      (!!login.email && address.address.toLowerCase() === login.email.toLowerCase())
  );
}

function iconForAddress(address?: Address): KnownIconName {
  return address?.status === 'active' ? 'check' : 'mail';
}

onMount(() => {
  void loadSiteData();
  const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local') return;
    if (
      changes.siteProfiles ||
      changes.siteRules ||
      changes.webmcpAccessList ||
      changes.webmcpSiteDecisions ||
      changes[SITE_EMAIL_REJECTIONS_KEY]
    )
      void loadSiteData();
  };
  browser.storage.onChanged.addListener(onChanged);
  return () => browser.storage.onChanged.removeListener(onChanged);
});

$effect(() => {
  if (!allSiteRows.some((row) => row.domain === selectedDomain)) selectedDomain = '';
});

async function clearRejectedDomains(domain: string) {
  if (clearingDomain) return;
  clearingDomain = domain;
  try {
    const result = await browser.runtime.sendMessage({
      type: 'clearSiteEmailDomainRejections',
      domain,
    });
    if (!result?.success) throw new Error('Could not clear site email exclusions');
    await loadSiteData();
  } catch (error: unknown) {
    logError('Could not clear site email exclusions', error);
    toastStore.error($t('toasts.operationFailed'));
  } finally {
    clearingDomain = '';
  }
}
</script>

<div class="scroll-body h-full min-h-0 overflow-y-auto py-3 space-y-3" data-sites-view>
  <SearchFilterHeader bind:value={searchQuery} scope="sites" placeholder={$t('savedLoginInfo.sitesSearchPlaceholder')} ariaLabel={$t('savedLoginInfo.sitesSearchLabel')} totalCount={allSiteRows.length} filteredCount={siteRows.length} showSlashButton borderBottom={false} paddingClass="p-0" onInputRef={(input) => { searchInput = input; }} />

  {#if loadError}
    <p class="text-sm text-md-error px-1" role="status">{$t('savedLoginInfo.sitesLoadFailed')}</p>
  {/if}

  {#if siteRows.length === 0 && !searchQuery.trim()}
    <div class="rounded-2xl border border-md-outline-variant/30 bg-md-surface-container px-4 py-6 text-center">
      <Icon name="globe" class="w-7 h-7 mx-auto mb-2 text-md-on-surface-variant" />
      <p class="text-sm font-semibold text-md-on-surface">{$t('savedLoginInfo.sitesEmptyTitle')}</p>
      <p class="mt-1 text-xs text-md-on-surface-variant">{$t('savedLoginInfo.sitesEmptyDescription')}</p>
    </div>
  {:else if siteRows.length === 0}
      <EmptyState compact icon="search" title={$t('savedLoginInfo.sitesNoMatches')} description={$t('common.noMatchesHint')} actionLabel={$t('common.clearSearch')} onAction={() => { searchQuery = ''; searchInput?.focus(); }} />
  {:else}
    {#each siteRows as site (site.domain)}
      <section class="rounded-2xl border border-md-outline-variant/30 bg-md-surface-container overflow-hidden">
        <button
          type="button"
          class="w-full flex items-center gap-3 text-start px-3.5 py-3 transition-colors {rowSurface({ active: selectedDomain === site.domain })}"
          aria-expanded={selectedDomain === site.domain}
          onclick={() => (selectedDomain = selectedDomain === site.domain ? '' : site.domain)}
        >
          <span class="w-9 h-9 rounded-xl bg-md-primary/10 text-md-primary flex items-center justify-center shrink-0">
            <Icon name="globe" class="w-4 h-4" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-semibold text-md-on-surface">{site.domain}</span>
            <span class="block text-xs text-md-on-surface-variant">
              {$t('nav.credentials')} {site.logins.length} · {$t('nav.addresses')} {site.emails.length}
            </span>
          </span>
          <Icon name={selectedDomain === site.domain ? 'chevronDown' : 'chevronRight'} class="w-4 h-4 text-md-on-surface-variant" />
        </button>

        {#if selectedDomain === site.domain}
          <div class="border-t border-md-outline-variant/20 px-3.5 py-3 space-y-3">
            {#if emailRejections[site.domain]}
              <div class="space-y-2">
                <p class="text-label-md text-md-on-surface-variant">{$t('savedLoginInfo.sitesRejectedEmailDomains')}</p>
                <p class="text-body-sm break-words text-md-on-surface">{Object.keys(emailRejections[site.domain]).join(', ')}</p>
                <Btn variant="tonal" label={$t('savedLoginInfo.sitesForgetEmailRejections')} busy={clearingDomain === site.domain} disabled={!!clearingDomain} onclick={() => void clearRejectedDomains(site.domain)} />
              </div>
            {/if}
            {#if site.emails.length}
              <div>
              <p class="text-label-md text-md-on-surface-variant mb-1">{$t('savedLoginInfo.sitesLinkedAddresses')}</p>
                <div class="space-y-2">
                  {#each site.emails as email (email)}
                    {@const address = allAddresses.find((address: Address) => address.address.toLowerCase() === email.toLowerCase())}
                    <div class="space-y-1" data-site-address={email}>
                      <p class="flex items-center gap-1 ui-support text-md-on-surface break-all"><Icon name={iconForAddress(address)} class="w-4 h-4 shrink-0" /><bdi>{email}</bdi></p>
                      <ButtonGroup tier="XS">
                        <Btn variant="tonal" icon="contentCopy" label={$t('savedLoginInfo.copyEmail')} onclick={() => void copyEmail(email)} />
                        {#if address && address.accountStatus !== 'deleted'}
                          <Btn variant="tonal" icon="mail" label={$t('savedLoginInfo.sitesOpenInbox')} busy={openingInbox === email} disabled={!!openingInbox} onclick={() => void openInbox(email)} />
                        {/if}
                      </ButtonGroup>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
            {#if site.identities.length}
              <div>
                <p class="text-label-md text-md-on-surface-variant mb-1">{$t('savedLoginInfo.identity')}</p>
                <p class="text-sm text-md-on-surface">{site.identities.join(', ')}</p>
              </div>
            {/if}
            {#if site.rules.length}
              <div>
                <p class="text-label-md text-md-on-surface-variant mb-1">{$t('intelligence.rulesTitle')}</p>
                <div class="flex flex-wrap gap-1.5">
                  {#each site.rules as rule (rule.id)}
                    <span class="rounded-full bg-md-primary/10 px-2 py-1 text-xs text-md-primary">{rule.name || rule.domainPattern}</span>
                  {/each}
                </div>
              </div>
            {/if}
            <div class="flex flex-wrap gap-1.5">
              {#if site.webmcp}
                <span class="rounded-full bg-md-tertiary-container px-2 py-1 text-xs text-md-on-tertiary-container">{$t('savedLoginInfo.sitesWebmcpEnabled')}</span>
              {/if}
              {#if site.hasMemory}
                <span class="rounded-full bg-md-surface-container-high px-2 py-1 text-xs text-md-on-surface-variant">{$t('savedLoginInfo.sitesSiteMemory')}</span>
              {/if}
            </div>
            {#if site.logins.length}
              <button
                type="button"
                class="md-action w-full min-h-10 rounded-xl bg-md-primary text-md-on-primary text-sm font-semibold px-3 flex items-center justify-center gap-2"
                onclick={() => onOpenCredentials(site.domain)}
              >
                <Icon name="lock" class="w-4 h-4" />
                {$t('savedLoginInfo.sitesOpenLogins')}
              </button>
            {/if}
          </div>
        {/if}
      </section>
    {/each}
  {/if}
</div>
