<script lang="ts">
import { onMount } from 'svelte';
import { t } from 'svelte-i18n';

import ConfirmDialog from '@/ui/blocks/dialogs/ConfirmDialog.svelte';
import EmptyState from '@/ui/components/composites/EmptyState.svelte';
import SearchFilterHeader from '@/ui/components/composites/SearchFilterHeader.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import { Btn, Toggle } from '@/ui/components/primitives';
import Badge from '@/ui/components/primitives/Badge.svelte';
import {
  type ConstantKey,
  DEFAULT_CONSTANTS,
  getConstantOverrides,
  resetAllConstantOverrides,
  resetConstantOverride,
  saveConstantOverrides,
} from '@/utils/constants.js';
import { logError } from '@/utils/logger.js';
import { toastStore } from '@/utils/ui/toastStore.js';

let { onBack = () => {} }: { onBack?: () => void } = $props();

let searchQuery = $state('');
let overrides = $state<Partial<Record<ConstantKey, unknown>>>({});
let editValues = $state<Record<string, string | number | boolean>>({});
let isResetConfirmOpen = $state(false);

const constantKeys = Object.keys(DEFAULT_CONSTANTS) as ConstantKey[];

onMount(() => {
  loadData().catch((err) => {
    logError('Failed to load constants data in onMount', undefined, err);
  });
});

async function loadData() {
  overrides = await getConstantOverrides();
  const initialValues: Record<string, string | number | boolean> = {};
  for (const key of constantKeys) {
    const val = overrides[key] !== undefined ? overrides[key] : DEFAULT_CONSTANTS[key];
    initialValues[key] = val as string | number | boolean;
  }
  editValues = initialValues;
}

async function handleSaveConstant(key: ConstantKey, rawValue: unknown) {
  let finalValue: unknown = rawValue;
  const defaultVal = DEFAULT_CONSTANTS[key];

  if (typeof defaultVal === 'number') {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      toastStore.error($t('settings.constantsInvalidNumber', { values: { key } }));
      return;
    }
    // Safety constraints to avoid negative intervals / counts
    if (key.endsWith('_MS') && parsed < 50) {
      toastStore.error($t('settings.constantsMin50', { values: { key } }));
      return;
    }
    if (
      (key.includes('LIMIT') ||
        key.includes('MAX') ||
        key.includes('ATTEMPTS') ||
        key.includes('ITERATIONS')) &&
      parsed < 1
    ) {
      toastStore.error($t('settings.constantsMin1', { values: { key } }));
      return;
    }
    if (parsed < 0) {
      toastStore.error($t('settings.constantsNoNegative', { values: { key } }));
      return;
    }
    finalValue = parsed;
  } else if (typeof defaultVal === 'boolean') {
    finalValue = Boolean(rawValue);
  } else {
    finalValue = String(rawValue);
  }

  await saveConstantOverrides({ [key]: finalValue });
  overrides[key] = finalValue;
  editValues[key] = finalValue as string | number | boolean;
  toastStore.success($t('settings.constantsUpdated', { values: { key } }));
}

async function handleResetConstant(key: ConstantKey) {
  await resetConstantOverride(key);
  delete overrides[key];
  editValues[key] = DEFAULT_CONSTANTS[key];
  toastStore.success($t('settings.constantsResetDone', { values: { key } }));
}

async function handleResetAll() {
  await resetAllConstantOverrides();
  overrides = {};
  for (const key of constantKeys) {
    editValues[key] = DEFAULT_CONSTANTS[key];
  }
  isResetConfirmOpen = false;
  toastStore.success($t('settings.constantsResetAllDone'));
}

const filteredKeys = $derived(
  constantKeys.filter((key) => key.toLowerCase().includes(searchQuery.trim().toLowerCase()))
);
</script>

<div class="scroll-frame flex flex-col h-full bg-md-surface text-md-on-surface">
  <!-- Title only - back lives in app header on this deep page -->
  <div class="scroll-edge py-3 border-b border-md-outline-variant/30">
    <h1 class="text-sm font-semibold text-md-on-surface">{$t('settings.developerConstants')}</h1>
    <p class="text-xs text-md-on-surface/50">{$t('settings.constantsDescription')}</p>
  </div>

  <div class="scroll-body scroll-body-framed flex-1 overflow-y-auto py-3 space-y-4">
    <!-- Action Header Card -->
    <div class="bg-md-surface-container-low rounded-xl px-3 py-3 border border-md-outline-variant/20 space-y-3">
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="w-8 h-8 rounded-xl bg-md-primary/10 text-md-primary flex items-center justify-center shrink-0">
            <Icon name="settings" class="w-4 h-4" />
          </div>
          <div class="min-w-0">
            <div class="text-sm font-medium text-md-on-surface">{$t('settings.constantOverrides')}</div>
            <div class="text-xs text-md-on-surface/50">{$t('settings.constantsOverridesDescription')}</div>
          </div>
        </div>
        <button
          type="button"
          class="shrink-0 px-2 py-1.5 text-xs font-semibold rounded-xl bg-md-error-container text-md-on-error-container hover:opacity-90 transition-opacity"
          onclick={() => (isResetConfirmOpen = true)}
        >
          {$t('settings.constantsResetAll')}
        </button>
      </div>
      <SearchFilterHeader
        scope="constants"
        bind:value={searchQuery}
        placeholder={$t('settings.constantsSearchPlaceholder')}
        ariaLabel={$t('settings.constantsSearchAria')}
        totalCount={constantKeys.length}
        filteredCount={filteredKeys.length}
      />
    </div>

    <!-- Constants List -->
    <div class="space-y-2">
      {#each filteredKeys as key (key)}
        {@const defaultValue = DEFAULT_CONSTANTS[key]}
        {@const isOverridden = overrides[key] !== undefined}
        {@const isBoolean = typeof defaultValue === 'boolean'}

        <div class="bg-md-surface-container-low rounded-xl p-3 border border-md-outline-variant/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-xs font-mono font-bold text-md-primary truncate">{key}</span>
              {#if isOverridden}
                <Badge variant="primary" size="sm" label={$t('settings.constantsModified')} />
              {/if}
            </div>
            <div class="text-xs text-md-on-surface/50 mt-0.5 truncate">
              {$t('settings.constantsDefaultLabel')} <code class="font-mono text-md-on-surface/70">{String(defaultValue)}</code>
            </div>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            {#if isBoolean}
              <Toggle
                id={`input-constant-${key}`}
                checked={Boolean(editValues[key])}
                ariaLabel={$t('settings.constantsToggleAria', { values: { key } })}
                size="sm"
                onChange={(next) => handleSaveConstant(key, next)}
              />
            {:else}
              <input
                type={typeof defaultValue === 'number' ? 'number' : 'text'}
                id={`input-constant-${key}`}
                value={editValues[key]}
                aria-label={$t('settings.constantsEditAria', { values: { key } })}
                class="w-28 sm:w-36 px-2 py-1 text-xs font-mono rounded-lg bg-md-surface-container border border-md-outline-variant/40 text-md-on-surface focus:outline-none focus:border-md-primary"
                onchange={(e) => handleSaveConstant(key, (e.target as HTMLInputElement).value)}
              />
            {/if}

            <Btn
              variant="outline"
              size="sm"
              disabled={!isOverridden}
              class="disabled:pointer-events-auto disabled:cursor-not-allowed"
              onclick={() => handleResetConstant(key)}
              title={$t('settings.constantsResetTitle')}
            >
              {$t('common.reset')}
            </Btn>
          </div>
        </div>
      {/each}

      {#if filteredKeys.length === 0}
        <EmptyState
          compact
          icon="search"
          title={$t('settings.constantsNoResults')}
          description={$t('settings.constantsNoResultsMatching', { values: { query: searchQuery } })}
        />
      {/if}
    </div>
  </div>
</div>

<ConfirmDialog
  confirmDialog={isResetConfirmOpen ? {
    title: $t('settings.constantsResetAllConfirmTitle'),
    message: $t('settings.constantsResetAllConfirmMessage'),
    confirmLabel: $t('settings.constantsResetAllConfirmLabel'),
    onConfirm: handleResetAll,
    destructive: true,
  } : null}
  onClose={() => (isResetConfirmOpen = false)}
/>
