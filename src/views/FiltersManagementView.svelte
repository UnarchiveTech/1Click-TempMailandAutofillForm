<script lang="ts">
import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import Icon from '@/components/icons/Icon.svelte';
import {
  deleteFilterFromStorage,
  loadSavedFilters,
  renameFilterInStorage,
} from '@/features/inbox/use-email-filters.js';
import type { SavedSearchFilter } from '@/utils/types.js';

let {
  onBack = () => {},
  savedSearchFilters = [] as SavedSearchFilter[],
  onFiltersChange = async () => {},
  onNavigateTo = undefined,
  showConfirm = (_message: string, _onConfirm: () => void) => {},
  embedded = false,
} = $props<{
  onBack?: () => void;
  savedSearchFilters?: SavedSearchFilter[];
  onFiltersChange?: () => Promise<void>;
  onNavigateTo?: (view: string) => void;
  showConfirm?: (message: string, onConfirm: () => void) => void;
  embedded?: boolean;
}>();

let renamingId = $state<string | null>(null);
let renameValue = $state('');
let saving = $state(false);
/** Full edit of filter conditions (not just rename) */
let editingId = $state<string | null>(null);
let editDraft = $state({
  name: '',
  searchQuery: '',
  hasOTP: false,
  senderDomain: '',
  dateFrom: '',
  dateTo: '',
  sortBy: 'newest',
});

// Custom Rules Engine automation settings
interface AutomationRules {
  autoArchiveOnCopyOtp: boolean;
  autoArchiveOnRead: boolean;
  autoDeletePromo24h: boolean;
}

let automationRules = $state<AutomationRules>({
  autoArchiveOnCopyOtp: true,
  autoArchiveOnRead: false,
  autoDeletePromo24h: false,
});

async function loadAutomationRules() {
  try {
    const res = (await browser.storage.local.get(['automationRules'])) as {
      automationRules?: AutomationRules;
    };
    if (res.automationRules) {
      automationRules = { ...automationRules, ...res.automationRules };
    }
  } catch {}
}

async function saveRule(key: keyof AutomationRules, val: boolean) {
  automationRules[key] = val;
  try {
    await browser.storage.local.set({ automationRules });
  } catch {}
}

$effect(() => {
  loadAutomationRules();
});

function startRename(filter: SavedSearchFilter) {
  renamingId = filter.id;
  renameValue = filter.name;
  editingId = null;
}

function cancelRename() {
  renamingId = null;
  renameValue = '';
}

async function saveRename() {
  if (!renamingId) return;
  const trimmed = renameValue.trim();
  if (!trimmed) return;
  saving = true;
  try {
    await renameFilterInStorage(browser.storage.local, savedSearchFilters, renamingId, trimmed);
    await onFiltersChange();
    renamingId = null;
  } finally {
    saving = false;
  }
}

function startEdit(filter: SavedSearchFilter) {
  editingId = filter.id;
  renamingId = null;
  editDraft = {
    name: filter.name,
    searchQuery: filter.searchQuery || '',
    hasOTP: !!filter.hasOTP,
    senderDomain: filter.senderDomain || '',
    dateFrom: filter.dateFrom || '',
    dateTo: filter.dateTo || '',
    sortBy: filter.sortBy || 'newest',
  };
}

function cancelEdit() {
  editingId = null;
}

async function saveEdit() {
  if (!editingId) return;
  const name = editDraft.name.trim();
  if (!name) return;
  saving = true;
  try {
    const next = savedSearchFilters.map((f: SavedSearchFilter) =>
      f.id === editingId
        ? {
            ...f,
            name,
            searchQuery: editDraft.searchQuery.trim(),
            hasOTP: editDraft.hasOTP,
            senderDomain: editDraft.senderDomain.trim(),
            dateFrom: editDraft.dateFrom,
            dateTo: editDraft.dateTo,
            sortBy: editDraft.sortBy,
          }
        : f
    );
    await browser.storage.local.set({ savedSearchFilters: next });
    await onFiltersChange();
    editingId = null;
  } finally {
    saving = false;
  }
}

async function deleteFilter(id: string, name: string) {
  showConfirm(get(t)('filtersManagement.deleteFilterConfirm', { values: { name } }), () => {
    void (async () => {
      saving = true;
      try {
        await deleteFilterFromStorage(browser.storage.local, savedSearchFilters, id);
        await onFiltersChange();
      } finally {
        saving = false;
      }
    })();
  });
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString();
}

function getFilterSummary(f: SavedSearchFilter): string {
  const tr = get(t);
  const parts: string[] = [];
  if (f.searchQuery) parts.push(`"${f.searchQuery}"`);
  if (f.hasOTP) parts.push(tr('filtersManagement.otpOnly'));
  if (f.senderDomain)
    parts.push(tr('filtersManagement.fromDomain', { values: { domain: f.senderDomain } }));
  if (f.dateFrom) parts.push(tr('filtersManagement.fromDate', { values: { date: f.dateFrom } }));
  if (f.dateTo) parts.push(tr('filtersManagement.toDate', { values: { date: f.dateTo } }));
  return parts.length > 0 ? parts.join(' · ') : tr('filtersManagement.noConditions');
}
</script>

<div class="relative flex flex-col h-full min-h-0">
  {#if !embedded}
    <div class="px-2 py-2 border-b border-md-outline-variant/30 shrink-0">
      <h1 class="text-base font-bold text-md-on-surface">{$t('filtersManagement.title')}</h1>
      <p class="text-xs text-md-on-surface/50">{$t('filtersManagement.subtitle')}</p>
    </div>
  {/if}

  <div class="flex-1 overflow-y-auto px-2 py-3 space-y-3 min-h-0">
    {#if savedSearchFilters.length === 0}
      <div class="text-center py-8 text-md-on-surface/40">
        <div class="text-3xl mb-2">🔍</div>
        <p class="text-sm">{$t('filtersManagement.noFilters')}</p>
        <p class="text-xs mt-1">{$t('filtersManagement.noFiltersHint')}</p>
      </div>
    {:else}
      <div
        class="grid gap-3"
        style="grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr));"
      >
      {#each savedSearchFilters as filter}
        <div class="density-row-pad bg-md-primary-container rounded-xl px-4 min-w-0">
          <div class="flex items-start justify-between gap-2">
            <button
              type="button"
              class="flex-1 text-start min-w-0"
              onclick={() => startEdit(filter)}
              aria-label={$t('filtersManagement.editFilter', { values: { name: filter.name } })}
            >
              <div class="font-medium text-sm text-md-on-surface truncate">{filter.name}</div>
              <div class="text-xs text-md-on-surface/50 mt-0.5 line-clamp-2">{getFilterSummary(filter)}</div>
              <div class="text-xs text-md-on-surface/35 mt-0.5">{$t('filtersManagement.created', { values: { date: formatDate(filter.createdAt) } })}</div>
            </button>
            <div class="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                class="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-md-surface-variant text-md-on-surface/60 transition-colors"
                onclick={() => startRename(filter)}
                aria-label={$t('filtersManagement.renameFilter', { values: { name: filter.name } })}
                title={$t('filtersManagement.renameFilter', { values: { name: filter.name } })}
              >
                <Icon name="edit" class="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                class="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-md-error/10 text-md-error transition-colors"
                onclick={() => deleteFilter(filter.id, filter.name)}
                aria-label={$t('filtersManagement.deleteFilter', { values: { name: filter.name } })}
                disabled={saving}
              >
                <Icon name="trash" class="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      {/each}
      </div>
    {/if}

    <!-- ── Custom Rules Engine Automation ── -->
    <div class="mt-6 pt-4 border-t border-md-outline-variant/20 space-y-3">
      <div class="flex items-center gap-2">
        <Icon name="cog" class="w-4 h-4 text-md-primary" />
        <h2 class="text-sm font-bold text-md-on-surface">{$t('filtersManagement.automationsTitle')}</h2>
      </div>

      <div class="space-y-2">
        <!-- Rule 1: Auto-archive on copy OTP -->
        <label class="flex items-center justify-between p-3 rounded-xl bg-md-surface-container-low border border-md-outline-variant/20 cursor-pointer hover:bg-md-surface-container transition-colors">
          <div class="space-y-0.5">
            <div class="text-xs font-semibold text-md-on-surface">Auto-Archive on OTP Copy</div>
            <div class="text-xs text-md-on-surface/50">Automatically archive email message after copying its verification code</div>
          </div>
          <input
            type="checkbox"
            class="w-4 h-4 rounded text-md-primary focus:ring-md-primary accent-md-primary cursor-pointer"
            checked={automationRules.autoArchiveOnCopyOtp}
            onchange={(e) => saveRule('autoArchiveOnCopyOtp', (e.target as HTMLInputElement).checked)}
          />
        </label>

        <!-- Rule 2: Auto-archive on read -->
        <label class="flex items-center justify-between p-3 rounded-xl bg-md-surface-container-low border border-md-outline-variant/20 cursor-pointer hover:bg-md-surface-container transition-colors">
          <div class="space-y-0.5">
            <div class="text-xs font-semibold text-md-on-surface">Auto-Archive on Read</div>
            <div class="text-xs text-md-on-surface/50">Automatically archive an email thread after opening details</div>
          </div>
          <input
            type="checkbox"
            class="w-4 h-4 rounded text-md-primary focus:ring-md-primary accent-md-primary cursor-pointer"
            checked={automationRules.autoArchiveOnRead}
            onchange={(e) => saveRule('autoArchiveOnRead', (e.target as HTMLInputElement).checked)}
          />
        </label>

        <!-- Rule 3: Auto-delete promo older than 24h -->
        <label class="flex items-center justify-between p-3 rounded-xl bg-md-surface-container-low border border-md-outline-variant/20 cursor-pointer hover:bg-md-surface-container transition-colors">
          <div class="space-y-0.5">
            <div class="text-xs font-semibold text-md-on-surface">Auto-Delete Marketing/Promo (24h)</div>
            <div class="text-xs text-md-on-surface/50">Purge promotional emails older than 24 hours</div>
          </div>
          <input
            type="checkbox"
            class="w-4 h-4 rounded text-md-primary focus:ring-md-primary accent-md-primary cursor-pointer"
            checked={automationRules.autoDeletePromo24h}
            onchange={(e) => saveRule('autoDeletePromo24h', (e.target as HTMLInputElement).checked)}
          />
        </label>
      </div>
    </div>
  </div>

  {#if editingId}
    <div class="absolute inset-0 z-[100] flex items-center justify-center p-3" role="dialog" aria-modal="true">
      <button
        type="button"
        class="absolute inset-0 bg-md-scrim/40 backdrop-blur-sm border-0 cursor-default"
        aria-label={$t('common.close')}
        onclick={cancelEdit}
      ></button>
      <div class="relative z-10 w-full max-w-sm max-h-[min(90%,560px)] overflow-y-auto rounded-2xl bg-md-surface border border-md-outline-variant/40 shadow-2xl p-4 space-y-2">
        <h3 class="text-sm font-bold text-md-on-surface mb-1">{$t('filtersManagement.editFilter', { values: { name: editDraft.name || '' } })}</h3>
        <label class="block text-xs text-md-on-surface/50" for="edit-filter-name">{$t('filtersManagement.filterName')}</label>
        <input
          id="edit-filter-name"
          type="text"
          class="w-full bg-md-secondary-container text-sm text-md-on-surface rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-md-primary"
          bind:value={editDraft.name}
        />
        <label class="block text-xs text-md-on-surface/50" for="edit-filter-q">{$t('filtersManagement.searchQuery')}</label>
        <input
          id="edit-filter-q"
          type="text"
          class="w-full bg-md-secondary-container text-sm text-md-on-surface rounded-lg px-3 py-1.5 outline-none"
          bind:value={editDraft.searchQuery}
          placeholder={$t('filtersManagement.searchQueryPlaceholder')}
        />
        <label class="block text-xs text-md-on-surface/50" for="edit-filter-dom">{$t('filtersManagement.senderDomain')}</label>
        <input
          id="edit-filter-dom"
          type="text"
          class="w-full bg-md-secondary-container text-sm text-md-on-surface rounded-lg px-3 py-1.5 outline-none"
          bind:value={editDraft.senderDomain}
          placeholder="example.com"
        />
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block text-xs text-md-on-surface/50" for="edit-filter-from">{$t('filtersManagement.dateFrom')}</label>
            <input id="edit-filter-from" type="date" class="w-full bg-md-secondary-container text-xs rounded-lg px-2 py-1.5 outline-none" bind:value={editDraft.dateFrom} />
          </div>
          <div>
            <label class="block text-xs text-md-on-surface/50" for="edit-filter-to">{$t('filtersManagement.dateTo')}</label>
            <input id="edit-filter-to" type="date" class="w-full bg-md-secondary-container text-xs rounded-lg px-2 py-1.5 outline-none" bind:value={editDraft.dateTo} />
          </div>
        </div>
        <label class="flex items-center gap-2 text-xs cursor-pointer">
          <input type="checkbox" bind:checked={editDraft.hasOTP} class="rounded border-md-outline" />
          {$t('filtersManagement.otpOnly')}
        </label>
        <div class="flex gap-2 pt-1">
          <button
            type="button"
            class="flex-1 px-3 py-2 text-xs rounded-xl bg-md-primary text-md-on-primary font-semibold disabled:opacity-50"
            onclick={saveEdit}
            disabled={saving}
          >{$t('filtersManagement.save')}</button>
          <button
            type="button"
            class="flex-1 px-3 py-2 text-xs rounded-xl bg-md-secondary-container"
            onclick={cancelEdit}
          >{$t('filtersManagement.cancel')}</button>
        </div>
      </div>
    </div>
  {/if}

  {#if renamingId}
    <div class="absolute inset-0 z-[100] flex items-center justify-center p-3" role="dialog" aria-modal="true">
      <button
        type="button"
        class="absolute inset-0 bg-md-scrim/40 backdrop-blur-sm border-0 cursor-default"
        aria-label={$t('common.close')}
        onclick={cancelRename}
      ></button>
      <div class="relative z-10 w-full max-w-sm rounded-2xl bg-md-surface border border-md-outline-variant/40 shadow-2xl p-4 space-y-3">
        <h3 class="text-sm font-bold text-md-on-surface">{$t('filtersManagement.filterName')}</h3>
        <input
          type="text"
          class="w-full bg-md-secondary-container text-sm text-md-on-surface rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-md-primary"
          bind:value={renameValue}
          placeholder={$t('filtersManagement.filterName')}
          aria-label={$t('filtersManagement.filterName')}
        />
        <div class="flex gap-2">
          <button
            type="button"
            class="flex-1 px-3 py-2 text-xs rounded-xl bg-md-primary text-md-on-primary font-semibold disabled:opacity-50"
            onclick={saveRename}
            disabled={saving}
          >{$t('filtersManagement.save')}</button>
          <button
            type="button"
            class="flex-1 px-3 py-2 text-xs rounded-xl bg-md-secondary-container"
            onclick={cancelRename}
          >{$t('filtersManagement.cancel')}</button>
        </div>
      </div>
    </div>
  {/if}
</div>
