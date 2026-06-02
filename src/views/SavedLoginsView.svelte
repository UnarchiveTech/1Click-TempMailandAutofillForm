<script lang="ts">
import { t } from 'svelte-i18n';
import Icon from '@/components/icons/Icon.svelte';
import DragHint from '@/components/ui/DragHint.svelte';
import FaviconImage from '@/components/ui/FaviconImage.svelte';
import type { CredentialsHistoryItem, Identity } from '@/utils/types.js';

let {
  context = 'popup',
  onBack = () => {},
  savedLogins = [],
  onDelete = () => {},
  showToast = (_msg: string) => {},
  identities = [] as Identity[],
  onReorder = (_fromIndex: number, _toIndex: number) => {},
} = $props<{
  context?: 'popup' | 'sidepanel' | 'app';
  onBack?: () => void;
  savedLogins?: CredentialsHistoryItem[];
  onDelete?: (id: string) => void;
  showToast?: (message: string) => void;
  identities?: Identity[];
  onReorder?: (fromIndex: number, toIndex: number) => void;
}>();

function copyToClipboard(text: string, label = 'Copied') {
  navigator.clipboard.writeText(text).then(() => {
    showToast(label);
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
let filterDropdownOpen = $state(false);
let searchFocused = $state(false);

let draggedLoginId = $state<string | null>(null);
let dropTargetLoginId = $state<string | null>(null);

function handleLoginDragStart(e: DragEvent, loginId: string) {
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
  const fromIndex = filteredLogins.findIndex((l: CredentialsHistoryItem) => l.id === sourceId);
  const toIndex = filteredLogins.findIndex((l: CredentialsHistoryItem) => l.id === targetId);
  if (fromIndex === -1 || toIndex === -1) return;
  onReorder(fromIndex, toIndex);
}

function handleLoginDragEnd() {
  draggedLoginId = null;
  dropTargetLoginId = null;
}

let filteredLogins = $derived.by(() => {
  let result = savedLogins;
  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    result = result.filter((l: CredentialsHistoryItem) => {
      const domain = getDomain(l).toLowerCase();
      const name = (l.name || '').toLowerCase();
      const email = (l.email || '').toLowerCase();
      return domain.includes(q) || name.includes(q) || email.includes(q);
    });
  }
  if (filterIdentityId) {
    result = result.filter((l: CredentialsHistoryItem) => l.identityId === filterIdentityId);
  }
  return result;
});

const identitiesWithLogins = $derived(
  identities.filter((i: Identity) =>
    savedLogins.some((l: CredentialsHistoryItem) => l.identityId === i.id)
  )
);

// Detect OS for keyboard shortcut hint
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/.test(navigator.platform);
const shortcutLabel = isMac ? '⌘ K' : 'Ctrl K';
</script>

<div class="flex flex-col h-full">
<!-- Search + Filter bar -->
<div class="px-4 pt-3 pb-2 border-b border-md-secondary-container">
  <div class="relative flex items-center">
    <!-- Search pill wrapper -->
    <div
      class="flex-1 flex items-center gap-2 rounded-2xl border-2 transition-all duration-200 px-3 py-2
        {searchFocused || filterDropdownOpen
          ? 'border-md-primary bg-md-surface shadow-[0_0_0_3px_rgba(var(--md-primary-rgb,99,102,241),0.12)]'
          : 'border-md-outline-variant/60 bg-md-primary-container hover:border-md-outline-variant'}"
    >
      <!-- Search icon -->
      <Icon name="search" class="w-4 h-4 shrink-0 transition-colors duration-200 {searchFocused ? 'text-md-primary' : 'text-md-on-surface/40'}" />

      <!-- Input -->
      <input
        type="text"
        class="flex-1 bg-transparent text-sm outline-none text-md-on-surface placeholder:text-md-on-surface/40 min-w-0"
        placeholder={$t('savedLoginInfo.searchPlaceholder')}
        bind:value={searchQuery}
        onfocus={() => { searchFocused = true; }}
        onblur={() => { setTimeout(() => { searchFocused = false; }, 150); }}
        aria-label={$t('savedLoginInfo.searchAria')}
      />

      <!-- Shortcut hint (hidden when there's text or focused) -->
      {#if !searchQuery && !searchFocused}
        <div class="flex items-center gap-0.5 shrink-0 select-none">
          <kbd class="inline-flex items-center justify-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-md-secondary-container/80 text-md-on-surface/50 border border-md-outline-variant/40 leading-none">
            {shortcutLabel}
          </kbd>
        </div>
      {/if}

      <!-- Clear button (when there's text) -->
      {#if searchQuery}
        <button
          class="w-4 h-4 flex items-center justify-center shrink-0 hover:text-md-on-surface transition-colors"
          onclick={() => searchQuery = ''}
          aria-label={$t('savedLoginInfo.clearSearch')}
        >
          <Icon name="x" class="w-3.5 h-3.5 text-md-on-surface/40" />
        </button>
      {/if}

      <!-- Divider -->
      <div class="w-px h-4 bg-md-outline-variant/40 shrink-0"></div>

      <!-- Filter icon button -->
      <div class="relative shrink-0">
        <button
          id="button-savedlogin-filter"
          class="w-7 h-7 flex items-center justify-center rounded-xl transition-colors
            {filterDropdownOpen
              ? 'bg-md-primary/15 text-md-primary'
              : filterIdentityId
                ? 'bg-md-primary/10 text-md-primary'
                : 'text-md-on-surface/40 hover:text-md-on-surface/70 hover:bg-md-secondary-container/60'}"
          aria-label={$t('savedLoginInfo.filterByIdentity')}
          onclick={(e) => {
            e.stopPropagation();
            if (identitiesWithLogins.length > 0) {
              filterDropdownOpen = !filterDropdownOpen;
            }
          }}
        >
          <Icon name="filter" class="w-4 h-4" />
          <!-- Active dot indicator -->
          {#if filterIdentityId}
            <span class="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-md-primary"></span>
          {/if}
        </button>

        <!-- Identity filter dropdown (sort-style like InboxView) -->
        {#if filterDropdownOpen && identitiesWithLogins.length > 0}
          <!-- Click-away backdrop -->
          <button
            class="fixed inset-0 z-40 bg-transparent cursor-default"
            aria-label={$t('common.close')}
            onclick={() => filterDropdownOpen = false}
          ></button>

          <div class="absolute top-full right-0 mt-2 bg-md-surface border border-md-outline-variant rounded-2xl shadow-xl z-50 overflow-hidden min-w-[190px]">
            <!-- Header -->
            <div class="flex items-center justify-between px-4 py-3 border-b border-md-outline-variant/30">
              <span class="text-sm font-semibold text-md-on-surface">Filter by Identity</span>
              <button
                class="w-5 h-5 flex items-center justify-center text-md-on-surface/60 hover:text-md-on-surface transition-colors rounded-lg"
                aria-label={$t('common.close')}
                onclick={() => filterDropdownOpen = false}
              >
                <Icon name="x" class="w-3.5 h-3.5" />
              </button>
            </div>

            <!-- All identities option -->
            <button
              class="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-md-surface-variant/50 transition-colors
                {!filterIdentityId ? 'text-md-primary font-medium' : 'text-md-on-surface'}"
              onclick={() => { filterIdentityId = null; filterDropdownOpen = false; }}
            >
              <!-- Radio circle -->
              <span class="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors
                {!filterIdentityId ? 'border-md-primary' : 'border-md-outline-variant'}">
                {#if !filterIdentityId}
                  <span class="w-2 h-2 rounded-full bg-md-primary"></span>
                {/if}
              </span>
              {$t('savedLoginInfo.allIdentities')}
            </button>

            <!-- Per-identity options -->
            {#each identitiesWithLogins as identity}
              <button
                class="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-md-surface-variant/50 transition-colors
                  {filterIdentityId === identity.id ? 'text-md-primary font-medium' : 'text-md-on-surface'}"
                onclick={() => { filterIdentityId = identity.id; filterDropdownOpen = false; }}
              >
                <!-- Radio circle -->
                <span class="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors
                  {filterIdentityId === identity.id ? 'border-md-primary' : 'border-md-outline-variant'}">
                  {#if filterIdentityId === identity.id}
                    <span class="w-2 h-2 rounded-full bg-md-primary"></span>
                  {/if}
                </span>
                <span class="truncate">{identity.name}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>

  <!-- Result count / active filter info -->
  {#if filteredLogins.length !== savedLogins.length}
    <div class="flex items-center justify-between mt-1.5">
      <div class="text-[10px] text-md-on-surface/40">{$t('savedLoginInfo.shown', { values: { filtered: filteredLogins.length, total: savedLogins.length } })}</div>
      {#if filterIdentityId}
        <button
          class="text-[10px] text-md-primary hover:underline flex items-center gap-0.5"
          onclick={() => { filterIdentityId = null; searchQuery = ''; }}
        >
          <Icon name="x" class="w-2.5 h-2.5" />
          {$t('savedLoginInfo.clearFilters')}
        </button>
      {/if}
    </div>
  {/if}
</div>

<div class="flex-1 overflow-y-auto px-4 py-3 space-y-3">
  {#if savedLogins.length === 0}
    <div class="text-center py-8 text-md-on-surface/50">
      <Icon name="lock" class="w-12 h-12 mx-auto mb-2 opacity-30" />
      <p class="text-sm">{$t('savedLoginInfo.noSavedLogin')}</p>
    </div>
  {:else if filteredLogins.length === 0}
    <div class="text-center py-8 text-md-on-surface/50">
      <Icon name="search" class="w-10 h-10 mx-auto mb-2 opacity-30" />
      <p class="text-sm">{$t('savedLoginInfo.noResultsMatchSearch')}</p>
      <button class="mt-2 text-xs text-md-primary hover:underline" onclick={() => { searchQuery = ''; filterIdentityId = null; }}>{$t('savedLoginInfo.clearFilters')}</button>
    </div>
  {:else}
    {#each filteredLogins as login}
      {@const domain = getDomain(login)}
      {@const isDragging = draggedLoginId === login.id}
      {@const isDropTarget = dropTargetLoginId === login.id}
      <div
        class="relative bg-md-secondary-container rounded-xl overflow-hidden cursor-move transition-all {isDragging ? 'opacity-50' : ''} {isDropTarget ? 'ring-2 ring-md-primary' : ''}"
        draggable={true}
        role="listitem"
        ondragstart={(e) => { handleLoginDragStart(e, login.id); dragHintDismissed = true; }}
        ondragover={(e) => handleLoginDragOver(e, login.id)}
        ondragleave={() => handleLoginDragLeave(login.id)}
        ondrop={(e) => handleLoginDrop(e, login.id)}
        ondragend={handleLoginDragEnd}
        aria-label={$t('savedLoginInfo.dragToReorder', { values: { domain } })}
      >
        {#if login === filteredLogins[0] && !dragHintDismissed}
          <DragHint
            hintKey="dragHintSeen_savedLoginInfo"
            text={$t('savedLoginInfo.dragHint')}
            visible={true}
            onDismiss={handleLoginDragHintDismiss}
          />
        {/if}
        <!-- Header: favicon + domain + timestamp + delete -->
        <div class="flex items-center gap-3 px-3 pt-3 pb-2">
          <div class="w-8 h-8 rounded-lg bg-md-primary-container flex items-center justify-center shrink-0 overflow-hidden">
            <FaviconImage
              {domain}
              size={32}
              class="w-6 h-6 object-contain"
              fallbackLetter={domain.charAt(0).toUpperCase()}
              fallbackColor="bg-md-primary"
            />
          </div>
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-sm truncate">{domain}</div>
            <div class="flex items-center gap-2 flex-wrap">
              {#if login.timestamp}
                <div class="text-[10px] text-md-on-surface/40">{$t('savedLoginInfo.autofilledAt', { values: { time: formatTimestamp(login.timestamp) } })}</div>
              {/if}
              {#if login.identityId}
                {@const identityId = String(login.identityId)}
                {@const identity = identities.find((i: Identity) => i.id === identityId)}
                {#if identity}
                  <div class="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-md-primary text-md-on-primary font-semibold">
                    <span>👤</span>{identity.name}
                  </div>
                {:else}
                  <div class="text-[10px] px-2 py-0.5 rounded-full bg-md-secondary-container text-md-on-surface/50 font-medium">{$t('savedLoginInfo.identity')}</div>
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

        <div class="h-px bg-md-primary-container/50 mx-3"></div>

        <!-- Details rows -->
        <div class="px-3 py-2 space-y-1.5">
          {#if login.name}
            <div class="flex items-center gap-2">
              <span class="text-[10px] uppercase tracking-wider text-md-on-surface/40 w-16 shrink-0">{$t('savedLoginInfo.name')}</span>
              <span class="text-xs text-md-on-surface flex-1 truncate">{login.name}</span>
              <button class="w-5 h-5 flex items-center justify-center rounded hover:bg-md-primary-container transition-colors shrink-0" aria-label={$t('savedLoginInfo.copyName')} onclick={() => copyToClipboard(String(login.name), $t('savedLoginInfo.nameCopied'))}>
                <Icon name="copy" class="w-3 h-3 text-md-on-surface/50" />
              </button>
            </div>
          {/if}
          {#if login.email}
            <div class="flex items-center gap-2">
              <span class="text-[10px] uppercase tracking-wider text-md-on-surface/40 w-16 shrink-0">{$t('savedLoginInfo.email')}</span>
              <span class="text-xs text-md-on-surface flex-1 truncate">{login.email}</span>
              <button class="w-5 h-5 flex items-center justify-center rounded hover:bg-md-primary-container transition-colors shrink-0" aria-label={$t('savedLoginInfo.copyEmail')} onclick={() => copyToClipboard(String(login.email), $t('savedLoginInfo.emailCopied'))}>
                <Icon name="copy" class="w-3 h-3 text-md-on-surface/50" />
              </button>
            </div>
          {/if}
          {#if login.phone}
            <div class="flex items-center gap-2">
              <span class="text-[10px] uppercase tracking-wider text-md-on-surface/40 w-16 shrink-0">{$t('savedLoginInfo.phone')}</span>
              <span class="text-xs text-md-on-surface flex-1 truncate">{login.phone}</span>
              <button class="w-5 h-5 flex items-center justify-center rounded hover:bg-md-primary-container transition-colors shrink-0" aria-label={$t('savedLoginInfo.copyPhone')} onclick={() => copyToClipboard(String(login.phone), $t('savedLoginInfo.phoneCopied'))}>
                <Icon name="copy" class="w-3 h-3 text-md-on-surface/50" />
              </button>
            </div>
          {/if}
          {#if login.password}
            <div class="flex items-center gap-2">
              <span class="text-[10px] uppercase tracking-wider text-md-on-surface/40 w-16 shrink-0">{$t('savedLoginInfo.password')}</span>
              <span class="text-xs text-md-on-surface flex-1 truncate font-mono">{login.password}</span>
              <button class="w-5 h-5 flex items-center justify-center rounded hover:bg-md-primary-container transition-colors shrink-0" aria-label={$t('savedLoginInfo.copyPassword')} onclick={() => copyToClipboard(String(login.password), $t('savedLoginInfo.passwordCopied'))}>
                <Icon name="copy" class="w-3 h-3 text-md-on-surface/50" />
              </button>
            </div>
          {/if}
          {#if login.otp}
            <div class="flex items-center gap-2">
              <span class="text-[10px] uppercase tracking-wider text-md-primary/60 w-16 shrink-0">{$t('savedLoginInfo.otp')}</span>
              <span class="text-xs text-md-primary flex-1 truncate font-mono font-semibold">{login.otp}</span>
              <button class="w-5 h-5 flex items-center justify-center rounded hover:bg-md-primary-container transition-colors shrink-0" aria-label={$t('savedLoginInfo.copyOtp')} onclick={() => copyToClipboard(String(login.otp), $t('savedLoginInfo.otpCopied'))}>
                <Icon name="copy" class="w-3 h-3 text-md-primary/60" />
              </button>
            </div>
          {/if}
        </div>
      </div>
    {/each}
  {/if}
</div>
</div>
