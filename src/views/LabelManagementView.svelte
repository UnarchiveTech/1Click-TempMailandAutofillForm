<script lang="ts">
import { onDestroy, onMount } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import Icon from '@/components/icons/Icon.svelte';
import SettingsSubNav from '@/components/ui/SettingsSubNav.svelte';

let { onBack = () => {}, onNavigateTo = undefined } = $props<{
  onBack?: () => void;
  onNavigateTo?: (view: string) => void;
}>();

interface LabelEntry {
  name: string;
  count: number;
}

let labels = $state<LabelEntry[]>([]);
let loading = $state(true);
let renamingLabel = $state<string | null>(null);
let renameValue = $state('');

async function loadLabels() {
  loading = true;
  try {
    const { emailTags = {} } = (await browser.storage.local.get(['emailTags'])) as {
      emailTags?: Record<string, string[]>;
    };
    const countMap: Record<string, number> = {};
    for (const tags of Object.values(emailTags)) {
      if (!Array.isArray(tags)) continue;
      for (const tag of tags) {
        countMap[tag] = (countMap[tag] ?? 0) + 1;
      }
    }
    labels = Object.entries(countMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  } finally {
    loading = false;
  }
}

async function deleteLabel(labelName: string) {
  const { emailTags = {} } = (await browser.storage.local.get(['emailTags'])) as {
    emailTags?: Record<string, string[]>;
  };
  const updated: Record<string, string[]> = {};
  for (const [id, tags] of Object.entries(emailTags)) {
    if (!Array.isArray(tags)) continue;
    const filtered = tags.filter((t) => t !== labelName);
    if (filtered.length > 0) updated[id] = filtered;
  }
  await browser.storage.local.set({ emailTags: updated });
  await loadLabels();
}

async function renameLabel(oldName: string, newName: string) {
  const trimmed = newName.trim();
  if (!trimmed || trimmed === oldName) {
    renamingLabel = null;
    return;
  }
  const { emailTags = {} } = (await browser.storage.local.get(['emailTags'])) as {
    emailTags?: Record<string, string[]>;
  };
  const updated: Record<string, string[]> = {};
  for (const [id, tags] of Object.entries(emailTags)) {
    if (!Array.isArray(tags)) continue;
    updated[id] = tags.map((t) => (t === oldName ? trimmed : t));
  }
  await browser.storage.local.set({ emailTags: updated });
  renamingLabel = null;
  renameValue = '';
  await loadLabels();
}

function startRename(name: string) {
  renamingLabel = name;
  renameValue = name;
}

onMount(() => {
  loadLabels();

  const handleStorageChange = (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
    areaName: string
  ) => {
    if (areaName !== 'local') return;
    if (changes.emailTags) loadLabels();
  };

  browser.storage.onChanged.addListener(handleStorageChange);
  onDestroy(() => browser.storage.onChanged.removeListener(handleStorageChange));
});
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
      <h1 class="text-base font-bold text-md-on-surface leading-tight">{$t('labelManagement.title')}</h1>
      <p class="text-[11px] text-md-on-surface/50">{$t('labelManagement.subtitle')}</p>
    </div>
  </div>

  <!-- Content -->
  <div class="flex-1 overflow-y-auto px-4 py-4 space-y-3">
    {#if loading}
      {#each [1, 2, 3] as _}
        <div class="rounded-xl bg-md-primary-container p-4 animate-pulse h-14"></div>
      {/each}
    {:else if labels.length === 0}
      <div class="flex flex-col items-center justify-center py-16 gap-3 text-center">
        <Icon name="tag" class="w-10 h-10 text-md-on-surface/20" />
        <div class="text-sm font-medium text-md-on-surface/40">{$t('labelManagement.noLabels')}</div>
        <div class="text-xs text-md-on-surface/30">{$t('labelManagement.noLabelsHint')}</div>
      </div>
    {:else}
      {#each labels as label}
        <div class="bg-md-primary-container rounded-xl px-4 py-3 flex items-center gap-3">
          <Icon name="tag" class="w-4 h-4 text-md-primary shrink-0" />

          {#if renamingLabel === label.name}
            <input
              class="flex-1 bg-md-secondary-container rounded-lg px-3 py-1.5 text-sm text-md-on-surface outline-none border border-md-primary"
              bind:value={renameValue}
              onkeydown={(e) => {
                if (e.key === 'Enter') renameLabel(label.name, renameValue);
                else if (e.key === 'Escape') { renamingLabel = null; renameValue = ''; }
              }}
            />
            <button
              class="px-3 py-1.5 text-xs rounded-lg bg-md-primary text-md-on-primary font-semibold transition-colors hover:bg-md-primary/90"
              onclick={() => renameLabel(label.name, renameValue)}
            >{$t('labelManagement.save')}</button>
            <button
              class="px-3 py-1.5 text-xs rounded-lg bg-md-secondary-container text-md-on-surface transition-colors hover:bg-md-outline-variant"
              onclick={() => { renamingLabel = null; renameValue = ''; }}
            >{$t('labelManagement.cancel')}</button>
          {:else}
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium text-md-on-surface truncate">{label.name}</div>
              <div class="text-[10px] text-md-on-surface/40">{$t('labelManagement.emailCount', { default: 'labelManagement.emailCountPlural', values: { n: label.count } })}</div>
            </div>
            <button
              class="text-xs px-2.5 py-1 rounded-lg bg-md-secondary-container text-md-on-surface hover:bg-md-outline-variant transition-colors"
              onclick={() => startRename(label.name)}
            >{$t('labelManagement.rename')}</button>
            <button
              class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-md-error/10 text-md-error transition-colors shrink-0"
              aria-label={$t('labelManagement.deleteLabel')}
              onclick={() => deleteLabel(label.name)}
            >
              <Icon name="trash" class="w-4 h-4" />
            </button>
          {/if}
        </div>
      {/each}
    {/if}
  </div>

  <!-- ── Settings Sub-Navigation Bar ── -->
  <div class="px-0 pb-1 mt-4">
    <SettingsSubNav currentSubPage="labelManagement" {onNavigateTo} />
  </div>
</div>
