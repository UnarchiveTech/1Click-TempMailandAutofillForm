<script lang="ts">
import { onMount } from 'svelte';
import Icon from '@/components/icons/Icon.svelte';
import ConfirmDialog from '@/components/overlays/ConfirmDialog.svelte';
import { Toggle } from '@/components/ui/primitives';
import {
  type ConstantKey,
  DEFAULT_CONSTANTS,
  getConstantOverrides,
  resetAllConstantOverrides,
  resetConstantOverride,
  saveConstantOverrides,
} from '@/utils/constants.js';
import { logError } from '@/utils/logger.js';
import { toastStore } from '@/utils/toastStore.js';

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
      toastStore.error(`Invalid number value for ${key}`);
      return;
    }
    // Safety constraints to avoid negative intervals / counts
    if (key.endsWith('_MS') && parsed < 50) {
      toastStore.error(`${key} must be at least 50ms`);
      return;
    }
    if (
      (key.includes('LIMIT') ||
        key.includes('MAX') ||
        key.includes('ATTEMPTS') ||
        key.includes('ITERATIONS')) &&
      parsed < 1
    ) {
      toastStore.error(`${key} must be at least 1`);
      return;
    }
    if (parsed < 0) {
      toastStore.error(`${key} cannot be negative`);
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
  toastStore.success(`Updated ${key}`);
}

function handleSearchKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    const firstFilteredKey = filteredKeys[0];
    if (firstFilteredKey) {
      const inputEl = document.getElementById(`input-constant-${firstFilteredKey}`);
      inputEl?.focus();
    }
  }
}

async function handleResetConstant(key: ConstantKey) {
  await resetConstantOverride(key);
  delete overrides[key];
  editValues[key] = DEFAULT_CONSTANTS[key];
  toastStore.success(`Reset ${key} to default`);
}

async function handleResetAll() {
  await resetAllConstantOverrides();
  overrides = {};
  for (const key of constantKeys) {
    editValues[key] = DEFAULT_CONSTANTS[key];
  }
  isResetConfirmOpen = false;
  toastStore.success('Reset all constants to default values');
}

const filteredKeys = $derived(
  constantKeys.filter((key) => key.toLowerCase().includes(searchQuery.trim().toLowerCase()))
);
</script>

<div class="flex flex-col h-full bg-md-surface text-md-on-surface">
  <!-- Title only - back lives in app header on this deep page -->
  <div class="px-2 py-3 bg-md-surface-container border-b border-md-outline-variant/30">
    <h1 class="text-sm font-bold text-md-on-surface">Developer Constants</h1>
    <p class="text-label-sm text-md-on-surface/50">Manage inner magic numbers & configuration settings</p>
  </div>

  <div class="flex-1 overflow-y-auto px-2 py-3 space-y-4">
    <!-- Action Header Card -->
    <div class="bg-md-surface-container rounded-2xl p-4 shadow-sm border border-md-outline-variant/30 space-y-3">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-base font-semibold text-md-on-surface">Constant Overrides</h2>
          <p class="text-xs text-md-on-surface/60">
            Customize timeouts, limits, and magic numbers individually.
          </p>
        </div>
        <button
          type="button"
          class="px-2 py-1.5 text-xs font-semibold rounded-xl bg-md-error-container text-md-on-error-container hover:opacity-90 transition-opacity"
          onclick={() => (isResetConfirmOpen = true)}
        >
          Reset All to Default
        </button>
      </div>

      <!-- Search Filter - matches Inbox FilterList chrome -->
      <div class="relative">
        <div class="w-full flex items-center gap-1 ps-8 pe-9 py-1.5 text-xs rounded-xl bg-md-surface-container-high border border-md-outline-variant/40 focus-within:border-md-primary transition-colors min-h-[32px]">
          <Icon
            name="search"
            class="w-4 h-4 text-md-on-surface-variant absolute start-2.5 top-1/2 -translate-y-1/2 pointer-events-none z-[1]"
          />
          <input
            type="text"
            bind:value={searchQuery}
            onkeydown={handleSearchKeydown}
            placeholder="Filter constants (e.g. MS, RETRY, LIMIT)..."
            class="w-full bg-transparent border-0 outline-none text-xs text-md-on-surface placeholder:text-md-on-surface-variant/60 min-w-0 flex-1 py-0.5"
            aria-label="Filter constants"
          />
          {#if searchQuery}
            <button
              type="button"
              class="absolute end-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-md-surface-variant transition-colors border-0 text-md-on-surface/40 z-[1]"
              onclick={() => (searchQuery = '')}
              aria-label="Clear search"
            >
              <Icon name="x" class="w-3.5 h-3.5" />
            </button>
          {/if}
        </div>
      </div>
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
                <span class="px-1.5 py-0.5 text-xs font-bold rounded bg-md-primary-container text-md-on-primary-container">
                  MODIFIED
                </span>
              {/if}
            </div>
            <div class="text-xs text-md-on-surface/50 mt-0.5 truncate">
              Default: <code class="font-mono text-md-on-surface/70">{String(defaultValue)}</code>
            </div>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            {#if isBoolean}
              <Toggle
                id={`input-constant-${key}`}
                checked={Boolean(editValues[key])}
                ariaLabel={`Toggle ${key}`}
                size="sm"
                onChange={(next) => handleSaveConstant(key, next)}
              />
            {:else}
              <input
                type={typeof defaultValue === 'number' ? 'number' : 'text'}
                id={`input-constant-${key}`}
                value={editValues[key]}
                aria-label={`Edit ${key}`}
                class="w-28 sm:w-36 px-2 py-1 text-xs font-mono rounded-lg bg-md-surface-container border border-md-outline-variant/40 text-md-on-surface focus:outline-none focus:border-md-primary"
                onchange={(e) => handleSaveConstant(key, (e.target as HTMLInputElement).value)}
              />
            {/if}

            <button
              type="button"
              disabled={!isOverridden}
              class="px-2 py-1 text-label-sm font-medium rounded-lg border border-md-outline-variant text-md-on-surface/70 hover:bg-md-surface-variant transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              onclick={() => handleResetConstant(key)}
              title="Reset to default value"
            >
              Reset
            </button>
          </div>
        </div>
      {/each}

      {#if filteredKeys.length === 0}
        <div class="p-8 text-center text-xs text-md-on-surface/50">
          No constants found matching "{searchQuery}".
        </div>
      {/if}
    </div>
  </div>
</div>

<ConfirmDialog
  confirmDialog={isResetConfirmOpen ? {
    title: 'Reset All Constant Overrides',
    message: 'Are you sure you want to reset all developer constants back to their default values?',
    confirmLabel: 'Reset All',
    onConfirm: handleResetAll
  } : null}
  onClose={() => (isResetConfirmOpen = false)}
/>
