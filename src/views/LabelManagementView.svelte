<script lang="ts">
import { onDestroy, onMount } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import Icon from '@/components/icons/Icon.svelte';
import ConfirmDialog from '@/components/overlays/ConfirmDialog.svelte';
import { logError } from '@/utils/logger.js';

let {
  onBack = () => {},
  onNavigateTo = undefined,
  createSignal = 0,
  embedded = false,
} = $props<{
  onBack?: () => void;
  onNavigateTo?: (view: string) => void;
  createSignal?: number;
  embedded?: boolean;
}>();

interface LabelEntry {
  name: string;
  count: number;
}

let labels = $state<LabelEntry[]>([]);
let loading = $state(true);
let renamingLabel = $state<string | null>(null);
let renameValue = $state('');
let deleteConfirmTarget = $state<string | null>(null);
let creatingLabel = $state(false);
let createLabelValue = $state('');
let labelCatalog = $state<string[]>([]);

let lastLabelCreateSignal = 0;
$effect(() => {
  const n = createSignal;
  if (n > 0 && n !== lastLabelCreateSignal) {
    lastLabelCreateSignal = n;
    creatingLabel = true;
    createLabelValue = '';
  }
});

async function loadLabels() {
  loading = true;
  try {
    const { emailTags = {}, emailLabelCatalog = [] } = (await browser.storage.local.get([
      'emailTags',
      'emailLabelCatalog',
    ])) as {
      emailTags?: Record<string, string[]>;
      emailLabelCatalog?: string[];
    };
    labelCatalog = emailLabelCatalog || [];
    const countMap: Record<string, number> = {};
    for (const tags of Object.values(emailTags)) {
      if (!Array.isArray(tags)) continue;
      for (const tag of tags) {
        countMap[tag] = (countMap[tag] ?? 0) + 1;
      }
    }
    for (const name of labelCatalog) {
      if (countMap[name] === undefined) countMap[name] = 0;
    }
    labels = Object.entries(countMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  } finally {
    loading = false;
  }
}

async function saveNewLabel() {
  const trimmed = createLabelValue.trim();
  if (!trimmed) {
    creatingLabel = false;
    return;
  }
  const next = Array.from(new Set([...labelCatalog, trimmed]));
  labelCatalog = next;
  await browser.storage.local.set({ emailLabelCatalog: next });
  creatingLabel = false;
  createLabelValue = '';
  await loadLabels();
}

function deleteLabel(labelName: string) {
  deleteConfirmTarget = labelName;
}

async function handleConfirmDelete() {
  if (!deleteConfirmTarget) return;
  const labelName = deleteConfirmTarget;
  deleteConfirmTarget = null;
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
  loadLabels().catch((err) => {
    logError('Failed to load labels in onMount', undefined, err);
  });

  const handleStorageChange = (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
    areaName: string
  ) => {
    if (areaName !== 'local') return;
    if (changes.emailTags) {
      loadLabels().catch((err) => {
        logError('Failed to load labels on storage change', undefined, err);
      });
    }
  };

  browser.storage.onChanged.addListener(handleStorageChange);
  onDestroy(() => browser.storage.onChanged.removeListener(handleStorageChange));
});
</script>

<div class="relative flex flex-col h-full min-h-0">
  {#if !embedded}
    <div class="px-4 py-4 border-b border-md-outline-variant/30 shrink-0">
      <h1 class="text-base font-bold text-md-on-surface leading-tight">{$t('labelManagement.title')}</h1>
      <p class="text-label-sm text-md-on-surface/50">{$t('labelManagement.subtitle')}</p>
    </div>
  {/if}

  <div class="flex-1 overflow-y-auto px-2 py-3 space-y-3 min-h-0">
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
      <div
        class="grid gap-3"
        style="grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));"
      >
      {#each labels as label}
        <div class="density-row-pad bg-md-primary-container rounded-xl px-4 flex items-center gap-3 min-w-0">
          <Icon name="tag" class="w-4 h-4 text-md-primary shrink-0" />
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium text-md-on-surface truncate">{label.name}</div>
            <div class="text-xs text-md-on-surface/40">{$t('labelManagement.emailCount', { default: 'labelManagement.emailCountPlural', values: { n: label.count } })}</div>
          </div>
          <button
            type="button"
            class="text-xs px-2 py-1 rounded-lg bg-md-secondary-container text-md-on-surface hover:bg-md-outline-variant transition-colors"
            onclick={() => startRename(label.name)}
          >{$t('labelManagement.rename')}</button>
          <button
            type="button"
            class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-md-error/10 text-md-error transition-colors shrink-0"
            aria-label={$t('labelManagement.deleteLabel')}
            onclick={() => deleteLabel(label.name)}
          >
            <Icon name="trash" class="w-4 h-4" />
          </button>
        </div>
      {/each}
      </div>
    {/if}
  </div>

  {#if creatingLabel}
    <div class="absolute inset-0 z-[100] flex items-center justify-center p-3" role="dialog" aria-modal="true">
      <button
        type="button"
        class="absolute inset-0 bg-md-scrim/40 backdrop-blur-sm border-0 cursor-default"
        aria-label={$t('common.close')}
        onclick={() => { creatingLabel = false; createLabelValue = ''; }}
      ></button>
      <div class="relative z-10 w-full max-w-sm rounded-2xl bg-md-surface border border-md-outline-variant/40 shadow-2xl p-4 space-y-3">
        <h3 class="text-sm font-bold text-md-on-surface">{$t('labelManagement.newLabelPlaceholder')}</h3>
        <input
          class="w-full bg-md-secondary-container rounded-lg px-3 py-2 text-sm text-md-on-surface outline-none border border-md-primary"
          placeholder={$t('labelManagement.newLabelPlaceholder')}
          bind:value={createLabelValue}
          onkeydown={(e) => {
            if (e.key === 'Enter') void saveNewLabel();
            else if (e.key === 'Escape') {
              creatingLabel = false;
              createLabelValue = '';
            }
          }}
        />
        <div class="flex gap-2">
          <button
            type="button"
            class="flex-1 px-3 py-2 text-xs rounded-xl bg-md-primary text-md-on-primary font-semibold"
            onclick={() => void saveNewLabel()}
          >{$t('labelManagement.save')}</button>
          <button
            type="button"
            class="flex-1 px-3 py-2 text-xs rounded-xl bg-md-secondary-container"
            onclick={() => { creatingLabel = false; createLabelValue = ''; }}
          >{$t('labelManagement.cancel')}</button>
        </div>
      </div>
    </div>
  {/if}

  {#if renamingLabel}
    <div class="absolute inset-0 z-[100] flex items-center justify-center p-3" role="dialog" aria-modal="true">
      <button
        type="button"
        class="absolute inset-0 bg-md-scrim/40 backdrop-blur-sm border-0 cursor-default"
        aria-label={$t('common.close')}
        onclick={() => { renamingLabel = null; renameValue = ''; }}
      ></button>
      <div class="relative z-10 w-full max-w-sm rounded-2xl bg-md-surface border border-md-outline-variant/40 shadow-2xl p-4 space-y-3">
        <h3 class="text-sm font-bold text-md-on-surface">{$t('labelManagement.rename')}</h3>
        <input
          class="w-full bg-md-secondary-container rounded-lg px-3 py-2 text-sm text-md-on-surface outline-none border border-md-primary"
          bind:value={renameValue}
          onkeydown={(e) => {
            if (e.key === 'Enter' && renamingLabel) void renameLabel(renamingLabel, renameValue);
            else if (e.key === 'Escape') { renamingLabel = null; renameValue = ''; }
          }}
        />
        <div class="flex gap-2">
          <button
            type="button"
            class="flex-1 px-3 py-2 text-xs rounded-xl bg-md-primary text-md-on-primary font-semibold"
            onclick={() => renamingLabel && void renameLabel(renamingLabel, renameValue)}
          >{$t('labelManagement.save')}</button>
          <button
            type="button"
            class="flex-1 px-3 py-2 text-xs rounded-xl bg-md-secondary-container"
            onclick={() => { renamingLabel = null; renameValue = ''; }}
          >{$t('labelManagement.cancel')}</button>
        </div>
      </div>
    </div>
  {/if}
</div>

<ConfirmDialog
  confirmDialog={deleteConfirmTarget ? {
    title: $t('labelManagement.deleteLabel'),
    message: $t('labelManagement.deleteConfirm', { values: { name: deleteConfirmTarget } }),
    confirmLabel: $t('labelManagement.delete'),
    onConfirm: handleConfirmDelete
  } : null}
  onClose={() => { deleteConfirmTarget = null; }}
/>
