<script lang="ts">
import IconCopy from '@/components/icons/IconCopy.svelte';
import IconLock from '@/components/icons/IconLock.svelte';
import IconSearch from '@/components/icons/IconSearch.svelte';
import IconTrash from '@/components/icons/IconTrash.svelte';
import IconX from '@/components/icons/IconX.svelte';
import FaviconImage from '@/components/ui/FaviconImage.svelte';
import type { CredentialsHistoryItem, Identity } from '@/utils/types.js';

let {
  context = 'popup',
  onBack = () => {},
  savedLogins = [],
  onDelete = () => {},
  showToast = (_msg: string) => {},
  identities = [] as Identity[],
} = $props<{
  context?: 'popup' | 'sidepanel' | 'app';
  onBack?: () => void;
  savedLogins?: CredentialsHistoryItem[];
  onDelete?: (id: string) => void;
  showToast?: (message: string) => void;
  identities?: Identity[];
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
let identityFilterOpen = $state(false);

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
</script>

<div class="flex flex-col h-full">
<!-- Search + Filter bar -->
<div class="px-4 pt-3 pb-2 space-y-2 border-b border-md-secondary-container">
  <div class="flex items-center gap-2">
    <!-- Search input -->
    <div class="flex-1 flex items-center gap-2 bg-md-primary-container rounded-xl px-3 py-2">
      <IconSearch class="w-3.5 h-3.5 text-md-on-surface/40 shrink-0" />
      <input
        type="text"
        class="flex-1 bg-transparent text-sm outline-none text-md-on-surface placeholder:text-md-on-surface/40"
        placeholder="Search by domain, name or email…"
        bind:value={searchQuery}
        aria-label="Search saved logins"
      />
      {#if searchQuery}
        <button class="w-4 h-4 flex items-center justify-center" onclick={() => searchQuery = ''} aria-label="Clear search">
          <IconX class="w-3.5 h-3.5 text-md-on-surface/40" />
        </button>
      {/if}
    </div>
    <!-- Identity filter -->
    {#if identitiesWithLogins.length > 0}
      <div class="relative">
        <button
          class="flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-medium transition-colors {filterIdentityId ? 'bg-md-primary text-md-on-primary' : 'bg-md-primary-container text-md-on-surface hover:bg-md-secondary-container'}"
          onclick={() => identityFilterOpen = !identityFilterOpen}
          aria-label="Filter by identity"
        >
          <IconLock class="w-3.5 h-3.5" />
          <span class="max-w-[60px] truncate">{filterIdentityId ? (identities.find((i: Identity) => i.id === filterIdentityId)?.name ?? 'Identity') : 'Identity'}</span>
        </button>
        {#if identityFilterOpen}
          <button class="fixed inset-0 z-40 bg-transparent cursor-default" aria-label="Close" onclick={() => identityFilterOpen = false}></button>
          <div class="absolute top-full right-0 mt-1 bg-md-primary-container rounded-xl shadow-lg border border-md-secondary-container z-50 min-w-[140px] overflow-hidden">
            <button
              class="w-full px-3 py-2 text-sm text-left hover:bg-md-secondary-container {!filterIdentityId ? 'font-semibold text-md-primary' : 'text-md-on-surface'}"
              onclick={() => { filterIdentityId = null; identityFilterOpen = false; }}
            >All identities</button>
            {#each identitiesWithLogins as identity}
              <button
                class="w-full px-3 py-2 text-sm text-left hover:bg-md-secondary-container {filterIdentityId === identity.id ? 'font-semibold text-md-primary' : 'text-md-on-surface'}"
                onclick={() => { filterIdentityId = identity.id; identityFilterOpen = false; }}
              >{identity.name}</button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>
  {#if filteredLogins.length !== savedLogins.length}
    <div class="text-[10px] text-md-on-surface/40">{filteredLogins.length} of {savedLogins.length} shown</div>
  {/if}
</div>

<div class="flex-1 overflow-y-auto px-4 py-3 space-y-3" style="scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--md-outline, #75777f) 0.2, transparent) transparent;">
  {#if savedLogins.length === 0}
    <div class="text-center py-8 text-md-on-surface/50">
      <IconLock class="w-12 h-12 mx-auto mb-2 opacity-30" />
      <p class="text-sm">No saved login info yet</p>
    </div>
  {:else if filteredLogins.length === 0}
    <div class="text-center py-8 text-md-on-surface/50">
      <IconSearch class="w-10 h-10 mx-auto mb-2 opacity-30" />
      <p class="text-sm">No results match your search</p>
      <button class="mt-2 text-xs text-md-primary hover:underline" onclick={() => { searchQuery = ''; filterIdentityId = null; }}>Clear filters</button>
    </div>
  {:else}
    {#each filteredLogins as login}
      {@const domain = getDomain(login)}
      <div class="bg-md-secondary-container rounded-xl overflow-hidden">
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
                <div class="text-[10px] text-md-on-surface/40">Autofilled {formatTimestamp(login.timestamp)}</div>
              {/if}
              {#if login.identityId}
                {@const identityId = String(login.identityId)}
                {@const identity = identities.find((i: Identity) => i.id === identityId)}
                {#if identity}
                  <div class="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-md-primary text-md-on-primary font-semibold">
                    <span>👤</span>{identity.name}
                  </div>
                {:else}
                  <div class="text-[10px] px-2 py-0.5 rounded-full bg-md-secondary-container text-md-on-surface/50 font-medium">Identity</div>
                {/if}
              {/if}
            </div>
          </div>
          <button
            class="w-6 h-6 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-primary-container text-md-error transition-colors shrink-0"
            aria-label="Delete login"
            onclick={() => onDelete(login.id)}
          >
            <IconTrash class="w-4 h-4" />
          </button>
        </div>

        <div class="h-px bg-md-primary-container/50 mx-3"></div>

        <!-- Details rows -->
        <div class="px-3 py-2 space-y-1.5">
          {#if login.name}
            <div class="flex items-center gap-2">
              <span class="text-[10px] uppercase tracking-wider text-md-on-surface/40 w-16 shrink-0">Name</span>
              <span class="text-xs text-md-on-surface flex-1 truncate">{login.name}</span>
              <button class="w-5 h-5 flex items-center justify-center rounded hover:bg-md-primary-container transition-colors shrink-0" aria-label="Copy name" onclick={() => copyToClipboard(String(login.name), 'Name copied')}>
                <IconCopy class="w-3 h-3 text-md-on-surface/50" />
              </button>
            </div>
          {/if}
          {#if login.email}
            <div class="flex items-center gap-2">
              <span class="text-[10px] uppercase tracking-wider text-md-on-surface/40 w-16 shrink-0">Email</span>
              <span class="text-xs text-md-on-surface flex-1 truncate">{login.email}</span>
              <button class="w-5 h-5 flex items-center justify-center rounded hover:bg-md-primary-container transition-colors shrink-0" aria-label="Copy email" onclick={() => copyToClipboard(String(login.email), 'Email copied')}>
                <IconCopy class="w-3 h-3 text-md-on-surface/50" />
              </button>
            </div>
          {/if}
          {#if login.phone}
            <div class="flex items-center gap-2">
              <span class="text-[10px] uppercase tracking-wider text-md-on-surface/40 w-16 shrink-0">Phone</span>
              <span class="text-xs text-md-on-surface flex-1 truncate">{login.phone}</span>
              <button class="w-5 h-5 flex items-center justify-center rounded hover:bg-md-primary-container transition-colors shrink-0" aria-label="Copy phone" onclick={() => copyToClipboard(String(login.phone), 'Phone copied')}>
                <IconCopy class="w-3 h-3 text-md-on-surface/50" />
              </button>
            </div>
          {/if}
          {#if login.password}
            <div class="flex items-center gap-2">
              <span class="text-[10px] uppercase tracking-wider text-md-on-surface/40 w-16 shrink-0">Password</span>
              <span class="text-xs text-md-on-surface flex-1 truncate font-mono">{login.password}</span>
              <button class="w-5 h-5 flex items-center justify-center rounded hover:bg-md-primary-container transition-colors shrink-0" aria-label="Copy password" onclick={() => copyToClipboard(String(login.password), 'Password copied')}>
                <IconCopy class="w-3 h-3 text-md-on-surface/50" />
              </button>
            </div>
          {/if}
          {#if login.otp}
            <div class="flex items-center gap-2">
              <span class="text-[10px] uppercase tracking-wider text-md-primary/60 w-16 shrink-0">OTP</span>
              <span class="text-xs text-md-primary flex-1 truncate font-mono font-semibold">{login.otp}</span>
              <button class="w-5 h-5 flex items-center justify-center rounded hover:bg-md-primary-container transition-colors shrink-0" aria-label="Copy OTP" onclick={() => copyToClipboard(String(login.otp), 'OTP copied')}>
                <IconCopy class="w-3 h-3 text-md-primary/60" />
              </button>
            </div>
          {/if}
        </div>
      </div>
    {/each}
  {/if}
</div>
</div>
