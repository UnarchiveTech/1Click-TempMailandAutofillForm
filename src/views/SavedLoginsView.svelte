<script lang="ts">
import { onMount } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import Icon from '@/components/icons/Icon.svelte';
import SearchBar from '@/components/ui/composites/SearchBar.svelte';
import DragHint from '@/components/ui/DragHint.svelte';
import FaviconImage from '@/components/ui/FaviconImage.svelte';
import type { CredentialsHistoryItem, Identity } from '@/utils/types.js';
import {
  getVaultConfig,
  isVaultLocked,
  unlockVaultWithBiometrics,
  unlockVaultWithPassword,
} from '@/utils/vault-lock.js';

let {
  context = 'popup',
  onBack = () => {},
  savedLogins = [],
  onDelete = () => {},
  showToast = (_msg: string) => {},
  identities = [] as Identity[],
  onReorder = (_sourceId: string, _targetId: string) => {},
  /** Pre-applied email filter (e.g. from message detail) */
  initialEmailFilter = '',
  /** Bump to focus the search field (ghost FAB) */
  focusSearchSignal = 0,
} = $props<{
  context?: 'popup' | 'sidepanel' | 'app';
  onBack?: () => void;
  savedLogins?: CredentialsHistoryItem[];
  onDelete?: (id: string) => void;
  showToast?: (message: string) => void;
  identities?: Identity[];
  /** Reorder by stable login id (not filtered list index) */
  onReorder?: (sourceId: string, targetId: string) => void;
  initialEmailFilter?: string;
  focusSearchSignal?: number;
}>();

let isLocked = $state(false);
let vaultMode = $state<'standard' | 'password' | 'biometrics'>('standard');
let unlockPassword = $state('');
let unlockError = $state('');
let unlocking = $state(false);
let searchRootEl = $state<HTMLElement | null>(null);
/** Local checklist: which policy URLs the user marked as reviewed */
let policyReviewed = $state<Record<string, boolean>>({});

$effect(() => {
  if (!focusSearchSignal) return;
  // Focus search input when ghost FAB is pressed
  queueMicrotask(() => {
    const input = searchRootEl?.querySelector<HTMLInputElement>('input');
    input?.focus();
  });
});

async function checkLockStatus() {
  const config = await getVaultConfig();
  vaultMode = config.mode;
  isLocked = await isVaultLocked();
}

onMount(() => {
  void checkLockStatus();
  void (async () => {
    try {
      const res = (await browser.storage.local.get(['policyReviewedMap'])) as {
        policyReviewedMap?: Record<string, boolean>;
      };
      if (res.policyReviewedMap) policyReviewed = res.policyReviewedMap;
    } catch {
      /* ignore */
    }
  })();
});

async function handleUnlockPassword() {
  unlockError = '';
  if (!unlockPassword) return;
  unlocking = true;
  const success = await unlockVaultWithPassword(unlockPassword);
  unlocking = false;
  if (success) {
    isLocked = false;
    unlockPassword = '';
    showToast($t('savedLoginInfo.vaultUnlocked'));
  } else {
    unlockError = 'Incorrect Master Password';
  }
}

async function handleUnlockBiometrics() {
  unlockError = '';
  unlocking = true;
  const success = await unlockVaultWithBiometrics();
  unlocking = false;
  if (success) {
    isLocked = false;
    showToast($t('savedLoginInfo.vaultUnlocked'));
  } else {
    unlockError = 'Biometric verification failed';
  }
}

import { copyToClipboardAndSchedulePurge } from '@/utils/clipboard.js';

function copyToClipboard(text: string, label = 'Copied', isPassword = false) {
  copyToClipboardAndSchedulePurge(text, isPassword ? 30000 : 60000).then((success) => {
    if (success) showToast(label);
  });
}

function formatTimestamp(ts: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function getDomain(login: CredentialsHistoryItem): string {
  try {
    const site = (login.website as string | undefined) || login.domain || '';
    return site.startsWith('http') ? new URL(site).hostname : site;
  } catch {
    return login.domain || '';
  }
}

let searchQuery = $state('');
let filterIdentityId = $state<string | null>(null);
let filterEmail = $state('');
let filterDropdownOpen = $state(false);
let filterEmailDropdownOpen = $state(false);
let searchFocused = $state(false);

$effect(() => {
  if (initialEmailFilter) filterEmail = initialEmailFilter;
});

let draggedLoginId = $state<string | null>(null);
let dropTargetLoginId = $state<string | null>(null);

function handleLoginDragStart(e: DragEvent, loginId: string) {
  if (searchQuery.trim() || filterIdentityId || filterEmail) {
    e.preventDefault();
    return;
  }
  draggedLoginId = loginId;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', loginId);
  }
}

let dragHintDismissed = $state(false);
function handleLoginDragHintDismiss(): void {
  dragHintDismissed = true;
}

function handleLoginDragOver(e: DragEvent, loginId: string) {
  if (!draggedLoginId || draggedLoginId === loginId) return;
  e.preventDefault();
  dropTargetLoginId = loginId;
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move';
  }
}

function handleLoginDragLeave(loginId: string) {
  if (dropTargetLoginId === loginId) {
    dropTargetLoginId = null;
  }
}

function handleLoginDrop(e: DragEvent, targetId: string) {
  e.preventDefault();
  const sourceId = draggedLoginId;
  draggedLoginId = null;
  dropTargetLoginId = null;
  if (!sourceId || sourceId === targetId) return;
  // Parent resolves ids against full loginInfo storage (not filteredLogins indices)
  onReorder(sourceId, targetId);
}

function handleLoginDragEnd() {
  draggedLoginId = null;
  dropTargetLoginId = null;
}

let filteredLogins = $derived.by(() => {
  let result = savedLogins;
  if (filterIdentityId) {
    result = result.filter((l: CredentialsHistoryItem) => l.identityId === filterIdentityId);
  }
  if (filterEmail) {
    const fe = filterEmail.toLowerCase();
    result = result.filter((l: CredentialsHistoryItem) => (l.email || '').toLowerCase() === fe);
  }
  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    // If search matches the active identity filter name, keep identity-only results
    const activeIdentityName = filterIdentityId
      ? (identities.find((i: Identity) => i.id === filterIdentityId)?.name || '').toLowerCase()
      : '';
    if (!(filterIdentityId && activeIdentityName && activeIdentityName === q)) {
      result = result.filter((l: CredentialsHistoryItem) => {
        const domain = getDomain(l).toLowerCase();
        const name = (l.name || '').toLowerCase();
        const email = (l.email || '').toLowerCase();
        const idName = (
          identities.find((i: Identity) => i.id === l.identityId)?.name || ''
        ).toLowerCase();
        return domain.includes(q) || name.includes(q) || email.includes(q) || idName.includes(q);
      });
    }
  }
  return result;
});

/** Group filtered logins into domain collections (preserve list order within each). */
let loginsByDomain = $derived.by(() => {
  const map = new Map<string, CredentialsHistoryItem[]>();
  for (const login of filteredLogins) {
    const d = getDomain(login) || 'unknown';
    const list = map.get(d) || [];
    list.push(login);
    map.set(d, list);
  }
  return Array.from(map.entries()).map(([domain, logins]) => ({ domain, logins }));
});

const identitiesWithLogins = $derived(
  identities.filter((i: Identity) =>
    savedLogins.some((l: CredentialsHistoryItem) => l.identityId === i.id)
  )
);

const emailsWithLogins = $derived.by(() => {
  const set = new Set<string>();
  for (const l of savedLogins) {
    if (l.email?.trim()) set.add(l.email.trim());
  }
  return [...set].sort((a, b) => a.localeCompare(b));
});

// Detect OS for keyboard shortcut hint
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/.test(navigator.platform);
const shortcutLabel = isMac ? '⌘ K' : 'Ctrl K';

/** Scrollspy for domain section chips */
let credentialsScrollEl = $state<HTMLElement | null>(null);
let activeDomainSpy = $state('');

// Set initial spy domain once — do not re-read activeDomainSpy after writing
let domainSpyInitialized = false;
$effect(() => {
  const domains = loginsByDomain.map((g) => g.domain);
  if (!domains.length) return;
  if (!domainSpyInitialized) {
    domainSpyInitialized = true;
    activeDomainSpy = domains[0];
  }
});

function scrollToDomain(domain: string) {
  activeDomainSpy = domain;
  const el = credentialsScrollEl?.querySelector(`[data-domain-section="${CSS.escape(domain)}"]`);
  if (el instanceof HTMLElement) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function onCredentialsScroll() {
  const root = credentialsScrollEl;
  if (!root) return;
  const sections = root.querySelectorAll<HTMLElement>('[data-domain-section]');
  let current = activeDomainSpy;
  const top = root.scrollTop + 48;
  for (const sec of sections) {
    if (sec.offsetTop <= top) current = sec.dataset.domainSection || current;
  }
  if (current) activeDomainSpy = current;
}
</script>

<div class="flex flex-col h-full">
{#if isLocked}
  <div class="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-4">
    <div class="w-16 h-16 rounded-full bg-md-primary/10 border border-md-primary/20 flex items-center justify-center text-md-primary shadow-lg">
      <Icon name="shield" class="w-8 h-8" />
    </div>

    <div class="max-w-xs space-y-1">
      <h3 class="text-base font-bold text-md-on-surface">{$t('savedLoginInfo.vaultLockedTitle')}</h3>
      <p class="text-xs text-md-on-surface/60">
        {#if vaultMode === 'password'}
          {$t('savedLoginInfo.vaultLockedPasswordBody')}
        {:else}
          {$t('savedLoginInfo.vaultLockedBiometricsBody')}
        {/if}
      </p>
    </div>

    {#if unlockError}
      <div class="p-2.5 rounded-xl bg-md-error-container/40 border border-md-error/30 text-xs text-md-error flex items-center gap-2 max-w-xs">
        <Icon name="info" class="w-4 h-4 shrink-0" />
        <span>{unlockError}</span>
      </div>
    {/if}

    {#if vaultMode === 'password'}
      <form class="w-full max-w-xs space-y-3" onsubmit={(e) => { e.preventDefault(); handleUnlockPassword(); }}>
        <input
          type="password"
          class="w-full bg-md-surface-variant/40 border border-md-outline-variant rounded-xl px-3.5 py-2.5 text-xs text-md-on-surface outline-none focus:border-md-primary transition-colors text-center"
          placeholder={$t('savedLoginInfo.masterPasswordPlaceholder')}
          bind:value={unlockPassword}
        />
        <button
          type="submit"
          disabled={unlocking}
          class="w-full py-2.5 px-4 rounded-xl bg-md-primary text-md-on-primary font-semibold text-xs hover:bg-md-primary/90 transition-colors shadow-md disabled:opacity-50"
        >
          {unlocking ? $t('savedLoginInfo.unlocking') : $t('savedLoginInfo.unlockVault')}
        </button>
      </form>
    {:else}
      <button
        onclick={handleUnlockBiometrics}
        disabled={unlocking}
        class="py-2.5 px-6 rounded-xl bg-md-primary text-md-on-primary font-semibold text-xs hover:bg-md-primary/90 transition-colors shadow-md flex items-center gap-2 disabled:opacity-50"
      >
        <Icon name="user" class="w-4 h-4" />
        <span>{unlocking ? $t('savedLoginInfo.verifying') : $t('savedLoginInfo.unlockBiometrics')}</span>
      </button>
    {/if}
  </div>
{:else}
<!-- Domain scrollspy chips -->
{#if loginsByDomain.length > 1}
  <div class="shrink-0 px-2 pt-2 pb-1 flex gap-1.5 overflow-x-auto border-b border-md-outline-variant/15" role="tablist" aria-label={$t('savedLoginInfo.domainSections')}>
    {#each loginsByDomain as group (group.domain)}
      <button
        type="button"
        role="tab"
        aria-selected={activeDomainSpy === group.domain}
        class="shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors
          {activeDomainSpy === group.domain
            ? 'bg-md-secondary-container text-md-on-secondary-container'
            : 'bg-md-surface-container-high text-md-on-surface/60 hover:bg-md-surface-variant'}"
        onclick={() => scrollToDomain(group.domain)}
      >
        {group.domain}
      </button>
    {/each}
  </div>
{/if}
<!-- Search + Filter bar (settings-style SearchWithHistory). z-30 so dropdowns sit above list. -->
<div class="relative z-30 px-0 pt-3 pb-2 border-b border-md-outline-variant/15 bg-md-surface/95 backdrop-blur-sm" bind:this={searchRootEl}>
  <div class="relative">
    <SearchBar
      scope="saved-logins"
      bind:value={searchQuery}
      placeholder={$t('savedLoginInfo.searchPlaceholder')}
      ariaLabel={$t('savedLoginInfo.searchAria')}
      settingsStyle={true}
      showSlashButton={true}
      shortcuts={[
        {
          prefix: 'domain:',
          label: 'domain:',
          description: $t('savedLoginInfo.filterByEmail'),
        },
      ]}
      onFocus={() => { searchFocused = true; }}
      onBlur={() => { searchFocused = false; }}
    >
      {#snippet filterControl()}
        <button
          id="button-savedlogin-filter"
          type="button"
          class="w-8 h-8 flex items-center justify-center rounded-xl border transition-colors relative
            {filterDropdownOpen || filterIdentityId || filterEmail
              ? 'border-md-primary bg-md-primary/10 text-md-primary'
              : 'border-md-outline-variant text-md-on-surface/60 hover:bg-md-surface-variant'}"
          aria-label={$t('common.filter')}
          title={$t('common.filter')}
          onclick={(e) => {
            e.stopPropagation();
            filterDropdownOpen = !filterDropdownOpen;
            filterEmailDropdownOpen = false;
          }}
        >
          <Icon name="filter" class="w-4 h-4" />
          {#if filterIdentityId || filterEmail}
            <span class="absolute top-1 end-1 w-1.5 h-1.5 rounded-full bg-md-primary"></span>
          {/if}
        </button>
      {/snippet}
    </SearchBar>

        <!-- Unified filter menu: Identity + Mailbox -->
        {#if filterDropdownOpen}
          <button
            class="fixed inset-0 z-[200] bg-transparent cursor-default"
            aria-label={$t('common.close')}
            onclick={() => filterDropdownOpen = false}
          ></button>

          <div class="absolute top-full end-0 mt-2 bg-md-surface border border-md-outline-variant rounded-2xl shadow-2xl z-[210] overflow-hidden min-w-[220px] max-h-80 overflow-y-auto">
            <div class="flex items-center justify-between px-4 py-3 border-b border-md-outline-variant/30">
              <span class="text-sm font-semibold text-md-on-surface">{$t('common.filter')}</span>
              <button
                class="w-5 h-5 flex items-center justify-center text-md-on-surface/60 hover:text-md-on-surface transition-colors rounded-lg"
                aria-label={$t('common.close')}
                onclick={() => filterDropdownOpen = false}
              >
                <Icon name="x" class="w-3.5 h-3.5" />
              </button>
            </div>

            <!-- Identity section -->
            <div class="px-3 pt-2 pb-1 text-label-sm font-bold uppercase tracking-wide text-md-on-surface/45">
              {$t('savedLoginInfo.filterByIdentity')}
            </div>
            <button
              class="w-full flex items-center gap-3 px-4 py-2 text-sm text-start hover:bg-md-surface-variant/50 transition-colors
                {!filterIdentityId ? 'text-md-primary font-medium' : 'text-md-on-surface'}"
              onclick={() => { filterIdentityId = null; }}
            >
              <span class="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors
                {!filterIdentityId ? 'border-md-primary' : 'border-md-outline-variant'}">
                {#if !filterIdentityId}
                  <span class="w-2 h-2 rounded-full bg-md-primary"></span>
                {/if}
              </span>
              {$t('savedLoginInfo.allIdentities')}
            </button>
            {#each identitiesWithLogins as identity (identity.id)}
              <button
                class="w-full flex items-center gap-3 px-4 py-2 text-sm text-start hover:bg-md-surface-variant/50 transition-colors
                  {filterIdentityId === identity.id ? 'text-md-primary font-medium' : 'text-md-on-surface'}"
                onclick={() => { filterIdentityId = identity.id; }}
              >
                <span class="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors
                  {filterIdentityId === identity.id ? 'border-md-primary' : 'border-md-outline-variant'}">
                  {#if filterIdentityId === identity.id}
                    <span class="w-2 h-2 rounded-full bg-md-primary"></span>
                  {/if}
                </span>
                <span class="truncate">{identity.name}</span>
              </button>
            {/each}

            <div class="h-px bg-md-outline-variant/30 my-1 mx-2"></div>

            <!-- Mailbox section (moved from standalone mail icon) -->
            <div class="px-3 pt-1 pb-1 text-label-sm font-bold uppercase tracking-wide text-md-on-surface/45 flex items-center gap-1.5">
              <Icon name="mail" class="w-3 h-3 opacity-70" />
              {$t('savedLoginInfo.filterMailbox')}
            </div>
            <button
              class="w-full flex items-center gap-3 px-4 py-2 text-sm text-start hover:bg-md-surface-variant/50 transition-colors
                {!filterEmail ? 'text-md-primary font-medium' : 'text-md-on-surface'}"
              onclick={() => { filterEmail = ''; }}
            >
              <span class="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0
                {!filterEmail ? 'border-md-primary' : 'border-md-outline-variant'}">
                {#if !filterEmail}
                  <span class="w-2 h-2 rounded-full bg-md-primary"></span>
                {/if}
              </span>
              {$t('savedLoginInfo.allEmails')}
            </button>
            {#each emailsWithLogins as addr (addr)}
              <button
                class="w-full flex items-center gap-3 px-4 py-2 text-sm text-start hover:bg-md-surface-variant/50 transition-colors
                  {filterEmail === addr ? 'text-md-primary font-medium' : 'text-md-on-surface'}"
                onclick={() => { filterEmail = addr; }}
              >
                <span class="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0
                  {filterEmail === addr ? 'border-md-primary' : 'border-md-outline-variant'}">
                  {#if filterEmail === addr}
                    <span class="w-2 h-2 rounded-full bg-md-primary"></span>
                  {/if}
                </span>
                <span class="truncate">{addr}</span>
              </button>
            {/each}
          </div>
        {/if}
  </div>

  <!-- Result count / active filter info -->
  {#if filteredLogins.length !== savedLogins.length}
    <div class="flex items-center justify-between mt-1.5">
      <div class="text-xs text-md-on-surface/40">{$t('savedLoginInfo.shown', { values: { filtered: filteredLogins.length, total: savedLogins.length } })}</div>
      {#if filterIdentityId || filterEmail || searchQuery}
        <button
          class="text-xs text-md-primary hover:underline flex items-center gap-0.5"
          onclick={() => { filterIdentityId = null; filterEmail = ''; searchQuery = ''; }}
        >
          <Icon name="x" class="w-2.5 h-2.5" />
          {$t('savedLoginInfo.clearFilters')}
        </button>
      {/if}
    </div>
  {/if}
</div>

<div
  class="relative z-0 flex-1 overflow-y-auto px-0 py-3 space-y-3"
  bind:this={credentialsScrollEl}
  onscroll={onCredentialsScroll}
>
  {#if savedLogins.length === 0}
    <div class="text-center py-8 text-md-on-surface/50">
      <Icon name="lock" class="w-12 h-12 mx-auto mb-2 opacity-30" />
      <p class="text-sm">{$t('savedLoginInfo.noSavedLogin')}</p>
    </div>
  {:else if filteredLogins.length === 0}
    <div class="text-center py-8 text-md-on-surface/50">
      <Icon name="search" class="w-10 h-10 mx-auto mb-2 opacity-30" />
      <p class="text-sm">{$t('savedLoginInfo.noResultsMatchSearch')}</p>
      <button class="mt-2 text-xs text-md-primary hover:underline" onclick={() => { searchQuery = ''; filterIdentityId = null; filterEmail = ''; }}>{$t('savedLoginInfo.clearFilters')}</button>
    </div>
  {:else}
    {#each loginsByDomain as group, groupIdx (group.domain)}
      <div class="space-y-2 scroll-mt-2" data-domain-section={group.domain}>
        <!-- Domain collection header -->
        <div class="flex items-center gap-2 px-1">
          <div class="w-6 h-6 rounded-lg bg-md-primary-container flex items-center justify-center shrink-0 overflow-hidden">
            <FaviconImage
              domain={group.domain}
              size={24}
              class="w-4 h-4 object-contain"
              fallbackLetter={group.domain.charAt(0).toUpperCase()}
              fallbackColor="bg-md-primary"
            />
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-xs font-bold text-md-on-surface truncate" style="direction: ltr; unicode-bidi: isolate;">{group.domain}</div>
            <div class="text-xs text-md-on-surface/45">{$t('savedLoginInfo.domainLoginCount', { values: { n: group.logins.length } })}</div>
          </div>
        </div>

    {#each group.logins as login, loginIdx (login.id)}
      {@const domain = group.domain}
      {@const isDragging = draggedLoginId === login.id}
      {@const isDropTarget = dropTargetLoginId === login.id}
      <div
        class="relative bg-md-surface-container-highest rounded-xl overflow-hidden transition-all {searchQuery.trim() || filterIdentityId ? '' : 'cursor-move'} {isDragging ? 'opacity-50' : ''} {isDropTarget ? 'ring-2 ring-md-primary drop-target-pulse' : ''}"
        draggable={!searchQuery.trim() && !filterIdentityId}
        role="listitem"
        ondragstart={(e) => { handleLoginDragStart(e, login.id || ''); dragHintDismissed = true; }}
        ondragover={(e) => handleLoginDragOver(e, login.id || '')}
        ondragleave={() => handleLoginDragLeave(login.id || '')}
        ondrop={(e) => handleLoginDrop(e, login.id || '')}
        ondragend={handleLoginDragEnd}
        aria-label={$t('savedLoginInfo.dragToReorder', { values: { domain } })}
      >
        {#if groupIdx === 0 && loginIdx === 0 && !dragHintDismissed}
          <DragHint
            hintKey="dragHintSeen_savedLoginInfo"
            text={$t('savedLoginInfo.dragHint')}
            visible={true}
            onDismiss={handleLoginDragHintDismiss}
          />
        {/if}
        <!-- Header: email/identity + timestamp + delete (domain is section title) -->
        <div class="flex items-center gap-3 px-3 pt-3 pb-2">
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-sm truncate" style="direction: ltr; unicode-bidi: isolate;">{login.email || login.username || domain}</div>
            <div class="flex items-center gap-2 flex-wrap">
              {#if login.timestamp}
                <div class="text-xs text-md-on-surface/40">{$t('savedLoginInfo.autofilledAt', { values: { time: formatTimestamp(login.timestamp) } })}</div>
              {/if}
              {#if login.identityId}
                {@const identityId = String(login.identityId)}
                {@const identity = identities.find((i: Identity) => i.id === identityId)}
                {#if identity}
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-md-primary text-md-on-primary font-semibold hover:brightness-110 transition-all cursor-pointer"
                    title={$t('savedLoginInfo.filterByIdentityName', { values: { name: identity.name } })}
                    onclick={(e) => {
                      e.stopPropagation();
                      filterIdentityId = identityId;
                      searchQuery = identity.name;
                      filterDropdownOpen = false;
                    }}
                  >
                    <span>👤</span>{identity.name}
                  </button>
                {:else}
                  <div class="text-xs px-2 py-0.5 rounded-full bg-md-secondary-container text-md-on-surface/50 font-medium">{$t('savedLoginInfo.identity')}</div>
                {/if}
              {/if}
            </div>
          </div>
          <button
            class="w-6 h-6 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-primary-container text-md-error transition-colors shrink-0"
            aria-label={$t('savedLoginInfo.deleteLogin')}
            onclick={() => onDelete(login.id)}
          >
            <Icon name="trash" class="w-4 h-4" />
          </button>
        </div>

        <div class="h-px bg-md-outline-variant/30 mx-3"></div>

        <!-- Details rows -->
        <div class="px-2 py-2 space-y-1.5">
          {#if login.name}
            <div class="flex items-center gap-2">
              <span class="text-xs uppercase tracking-wider text-md-on-surface/40 w-16 shrink-0">{$t('savedLoginInfo.name')}</span>
              <span class="text-xs text-md-on-surface flex-1 truncate">{login.name}</span>
              <button class="w-5 h-5 flex items-center justify-center rounded hover:bg-md-primary-container transition-colors shrink-0" aria-label={$t('savedLoginInfo.copyName')} onclick={() => copyToClipboard(String(login.name), $t('savedLoginInfo.nameCopied'))}>
                <Icon name="copy" class="w-3 h-3 text-md-on-surface/50" />
              </button>
            </div>
          {/if}
          {#if login.email}
            <div class="flex items-center gap-2">
              <span class="text-xs uppercase tracking-wider text-md-on-surface/40 w-16 shrink-0">{$t('savedLoginInfo.email')}</span>
              <span class="text-xs text-md-on-surface flex-1 truncate">{login.email}</span>
              <button class="w-5 h-5 flex items-center justify-center rounded hover:bg-md-primary-container transition-colors shrink-0" aria-label={$t('savedLoginInfo.copyEmail')} onclick={() => copyToClipboard(String(login.email), $t('savedLoginInfo.emailCopied'))}>
                <Icon name="copy" class="w-3 h-3 text-md-on-surface/50" />
              </button>
            </div>
          {/if}
          {#if login.phone}
            <div class="flex items-center gap-2">
              <span class="text-xs uppercase tracking-wider text-md-on-surface/40 w-16 shrink-0">{$t('savedLoginInfo.phone')}</span>
              <span class="text-xs text-md-on-surface flex-1 truncate">{login.phone}</span>
              <button class="w-5 h-5 flex items-center justify-center rounded hover:bg-md-primary-container transition-colors shrink-0" aria-label={$t('savedLoginInfo.copyPhone')} onclick={() => copyToClipboard(String(login.phone), $t('savedLoginInfo.phoneCopied'))}>
                <Icon name="copy" class="w-3 h-3 text-md-on-surface/50" />
              </button>
            </div>
          {/if}
          {#if login.password}
            <div class="flex items-center gap-2">
              <span class="text-xs uppercase tracking-wider text-md-on-surface/40 w-16 shrink-0">{$t('savedLoginInfo.password')}</span>
              <span class="text-xs text-md-on-surface flex-1 truncate font-mono">{login.password}</span>
              <button class="w-5 h-5 flex items-center justify-center rounded hover:bg-md-primary-container transition-colors shrink-0" aria-label={$t('savedLoginInfo.copyPassword')} onclick={() => copyToClipboard(String(login.password), $t('savedLoginInfo.passwordCopied'), true)}>
                <Icon name="copy" class="w-3 h-3 text-md-on-surface/50" />
              </button>
            </div>
          {/if}
          {#if login.otp}
            <div class="flex items-center gap-2">
              <span class="text-xs uppercase tracking-wider text-md-primary/60 w-16 shrink-0">{$t('savedLoginInfo.otp')}</span>
              <span class="text-xs text-md-primary flex-1 truncate font-mono font-semibold">{login.otp}</span>
              <button class="w-5 h-5 flex items-center justify-center rounded hover:bg-md-primary-container transition-colors shrink-0" aria-label={$t('savedLoginInfo.copyOtp')} onclick={() => copyToClipboard(String(login.otp), $t('savedLoginInfo.otpCopied'))}>
                <Icon name="copy" class="w-3 h-3 text-md-primary/60" />
              </button>
            </div>
          {/if}
          {#if true}
            {@const linkedIdentity = login.identityId
              ? identities.find((i: Identity) => i.id === login.identityId)
              : undefined}
            {@const countryVal = (login.country as string | null | undefined) || linkedIdentity?.country}
            {@const genderVal = (login.gender as string | null | undefined) || linkedIdentity?.gender}
            {@const dobVal = (login.dateOfBirth as string | null | undefined) || linkedIdentity?.dateOfBirth}
            {@const pinVal = (login.pin as string | null | undefined) || linkedIdentity?.pin}
            {#if countryVal}
              <div class="flex items-center gap-2">
                <span class="text-xs uppercase tracking-wider text-md-on-surface/40 w-16 shrink-0">{$t('savedLoginInfo.country')}</span>
                <span class="text-xs text-md-on-surface flex-1 truncate">{countryVal}</span>
                <button class="w-5 h-5 flex items-center justify-center rounded hover:bg-md-primary-container transition-colors shrink-0" aria-label={$t('savedLoginInfo.copyCountry')} onclick={() => copyToClipboard(String(countryVal), $t('savedLoginInfo.countryCopied'))}>
                  <Icon name="copy" class="w-3 h-3 text-md-on-surface/50" />
                </button>
              </div>
            {/if}
            {#if genderVal}
              <div class="flex items-center gap-2">
                <span class="text-xs uppercase tracking-wider text-md-on-surface/40 w-16 shrink-0">{$t('savedLoginInfo.gender')}</span>
                <span class="text-xs text-md-on-surface flex-1 truncate">{genderVal}</span>
                <button class="w-5 h-5 flex items-center justify-center rounded hover:bg-md-primary-container transition-colors shrink-0" aria-label={$t('savedLoginInfo.copyGender')} onclick={() => copyToClipboard(String(genderVal), $t('savedLoginInfo.genderCopied'))}>
                  <Icon name="copy" class="w-3 h-3 text-md-on-surface/50" />
                </button>
              </div>
            {/if}
            {#if dobVal}
              <div class="flex items-center gap-2">
                <span class="text-xs uppercase tracking-wider text-md-on-surface/40 w-16 shrink-0">{$t('savedLoginInfo.dateOfBirth')}</span>
                <span class="text-xs text-md-on-surface flex-1 truncate">{dobVal}</span>
                <button class="w-5 h-5 flex items-center justify-center rounded hover:bg-md-primary-container transition-colors shrink-0" aria-label={$t('savedLoginInfo.copyDob')} onclick={() => copyToClipboard(String(dobVal), $t('savedLoginInfo.dobCopied'))}>
                  <Icon name="copy" class="w-3 h-3 text-md-on-surface/50" />
                </button>
              </div>
            {/if}
            {#if pinVal}
              <div class="flex items-center gap-2">
                <span class="text-xs uppercase tracking-wider text-md-on-surface/40 w-16 shrink-0">{$t('savedLoginInfo.pinZip')}</span>
                <span class="text-xs text-md-on-surface flex-1 truncate font-mono">{pinVal}</span>
                <button class="w-5 h-5 flex items-center justify-center rounded hover:bg-md-primary-container transition-colors shrink-0" aria-label={$t('savedLoginInfo.copyPin')} onclick={() => copyToClipboard(String(pinVal), $t('savedLoginInfo.pinCopied'))}>
                  <Icon name="copy" class="w-3 h-3 text-md-on-surface/50" />
                </button>
              </div>
            {/if}
          {/if}
          {#if login.policyUrls?.length}
            <div class="pt-1 space-y-1.5">
              <div class="text-xs uppercase tracking-wider text-md-on-surface/40">{$t('savedLoginInfo.policyUrls')}</div>
              <p class="text-label-sm text-md-on-surface/55">{$t('savedLoginInfo.policyAcceptChecklist')}</p>
              {#each login.policyUrls as policyUrl, pIdx (policyUrl + String(pIdx))}
                {@const reviewedKey = `${login.id || login.email || ''}|${policyUrl}`}
                {@const isReviewed = policyReviewed[reviewedKey]}
                <div class="rounded-lg border border-md-outline-variant/30 bg-md-surface-container-low/50 px-2 py-1.5 space-y-1">
                  <div class="flex items-center gap-2">
                    <a
                      href={policyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-label-sm text-md-primary underline truncate flex-1 min-w-0"
                      style="direction: ltr; unicode-bidi: isolate;"
                      title={policyUrl}
                    >{policyUrl}</a>
                    <button
                      type="button"
                      class="w-6 h-6 flex items-center justify-center rounded hover:bg-md-primary-container transition-colors shrink-0"
                      aria-label={$t('savedLoginInfo.openPolicyUrl')}
                      title={$t('savedLoginInfo.openPolicyUrl')}
                      onclick={() => {
                        try {
                          void browser.tabs.create({ url: policyUrl });
                        } catch {
                          window.open(policyUrl, '_blank', 'noopener,noreferrer');
                        }
                      }}
                    >
                      <Icon name="expand" class="w-3.5 h-3.5 text-md-on-surface/50" />
                    </button>
                    <button
                      type="button"
                      class="w-6 h-6 flex items-center justify-center rounded hover:bg-md-primary-container transition-colors shrink-0"
                      aria-label={$t('savedLoginInfo.copyPolicyUrl')}
                      onclick={() => copyToClipboard(policyUrl, $t('savedLoginInfo.policyUrlCopied'))}
                    >
                      <Icon name="copy" class="w-3 h-3 text-md-on-surface/50" />
                    </button>
                  </div>
                  <label class="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      class="accent-md-primary"
                      checked={!!isReviewed}
                      onchange={(e) => {
                        const checked = (e.currentTarget as HTMLInputElement).checked;
                        policyReviewed = { ...policyReviewed, [reviewedKey]: checked };
                        void browser.storage.local.set({ policyReviewedMap: policyReviewed });
                      }}
                    />
                    <span class="text-label-sm text-md-on-surface/70">
                      {isReviewed ? $t('savedLoginInfo.policyAccepted') : $t('savedLoginInfo.policyAcceptedMark')}
                    </span>
                  </label>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    {/each}
      </div>
    {/each}
  {/if}
</div>
{/if}
</div>
