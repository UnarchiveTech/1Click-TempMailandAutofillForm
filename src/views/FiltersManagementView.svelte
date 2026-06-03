<script lang="ts">
import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import Icon from '@/components/icons/Icon.svelte';
import SettingsSubNav from '@/components/ui/SettingsSubNav.svelte';
import {
  deleteFilterFromStorage,
  loadSavedFilters,
  renameFilterInStorage,
} from '@/composables/useEmailFilters.js';
import type { SavedSearchFilter } from '@/utils/types.js';

let {
  onBack = () => {},
  savedSearchFilters = [] as SavedSearchFilter[],
  onFiltersChange = async () => {},
  onNavigateTo = undefined,
} = $props<{
  onBack?: () => void;
  savedSearchFilters?: SavedSearchFilter[];
  onFiltersChange?: () => Promise<void>;
  onNavigateTo?: (view: string) => void;
}>();

let renamingId = $state<string | null>(null);
let renameValue = $state('');
let saving = $state(false);

function startRename(filter: SavedSearchFilter) {
  renamingId = filter.id;
  renameValue = filter.name;
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

async function deleteFilter(id: string, name: string) {
  if (!confirm(get(t)('filtersManagement.deleteFilterConfirm', { values: { name } }))) return;
  saving = true;
  try {
    await deleteFilterFromStorage(browser.storage.local, savedSearchFilters, id);
    await onFiltersChange();
  } finally {
    saving = false;
  }
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
    <div>
      <h1 class="text-base font-bold text-md-on-surface">{$t('filtersManagement.title')}</h1>
      <p class="text-xs text-md-on-surface/50">{$t('filtersManagement.subtitle')}</p>
    </div>
  </div>

  <div class="flex-1 overflow-y-auto px-4 py-4 space-y-3">
    {#if savedSearchFilters.length === 0}
      <div class="text-center py-12 text-md-on-surface/40">
        <div class="text-4xl mb-3">🔍</div>
        <p class="text-sm">{$t('filtersManagement.noFilters')}</p>
        <p class="text-xs mt-1">{$t('filtersManagement.noFiltersHint')}</p>
      </div>
    {:else}
      {#each savedSearchFilters as filter}
        <div class="bg-md-primary-container rounded-xl px-4 py-3">
          {#if renamingId === filter.id}
            <div class="space-y-2">
              <input
                type="text"
                class="w-full bg-md-secondary-container text-sm text-md-on-surface rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-md-primary"
                bind:value={renameValue}
                placeholder={$t('filtersManagement.filterName')}
                aria-label={$t('filtersManagement.filterName')}
              />
              <div class="flex gap-2">
                <button
                  class="flex-1 px-3 py-1.5 text-xs rounded-lg bg-md-primary text-md-on-primary hover:bg-md-primary/90 transition-colors disabled:opacity-50"
                  onclick={saveRename}
                  disabled={saving}
                >{$t('filtersManagement.save')}</button>
                <button
                  class="flex-1 px-3 py-1.5 text-xs rounded-lg bg-md-secondary-container text-md-on-surface hover:bg-md-secondary-container/80 transition-colors"
                  onclick={cancelRename}
                >{$t('filtersManagement.cancel')}</button>
              </div>
            </div>
          {:else}
            <div class="flex items-start justify-between gap-2">
              <button
                class="flex-1 text-left"
                onclick={() => startRename(filter)}
                aria-label={$t('filtersManagement.renameFilter', { values: { name: filter.name } })}
              >
                <div class="font-medium text-sm text-md-on-surface">{filter.name}</div>
                <div class="text-xs text-md-on-surface/50 mt-0.5">{getFilterSummary(filter)}</div>
                <div class="text-[10px] text-md-on-surface/35 mt-0.5">{$t('filtersManagement.created', { values: { date: formatDate(filter.createdAt) } })}</div>
              </button>
              <button
                class="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-md-error/10 text-md-error transition-colors shrink-0"
                onclick={() => deleteFilter(filter.id, filter.name)}
                aria-label={$t('filtersManagement.deleteFilter', { values: { name: filter.name } })}
                disabled={saving}
              >
                <Icon name="trash" class="w-4 h-4" />
              </button>
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>

  <!-- ── Settings Sub-Navigation Bar ── -->
  <div class="px-0 pb-1 mt-4">
    <SettingsSubNav currentSubPage="filtersManagement" {onNavigateTo} />
  </div>
</div>
