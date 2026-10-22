<script lang="ts">
import { onMount } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import { updateAddressColors } from '@/features/settings/address-color.js';
import Icon from '@/ui/components/icons/Icon.svelte';
import { Toggle } from '@/ui/components/primitives';
import { logError } from '@/utils/logger.js';
import { parseStringRecord } from '@/utils/storage/rmw.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import type { Address } from '@/utils/types.js';
import { toastStore } from '@/utils/ui/toastStore.js';

let {
  allAddresses = [],
  onBack = undefined,
}: {
  allAddresses?: Address[];
  onBack?: () => void;
} = $props();

const HEX_COLOR = /^#[\da-f]{6}$/i;
let addressColors = $state<Record<string, string>>({});
let colorsEnabled = $state(false);
let savingIds = $state<Set<string>>(new Set());
let savingEnabled = $state(false);

function sanitizedColors(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(parseStringRecord(value)).filter(([, color]) => HEX_COLOR.test(color))
  );
}

function colorFor(address: Address): string {
  const stored = addressColors[address.id] || addressColors[address.address];
  return stored && HEX_COLOR.test(stored) ? stored : '#4c662b';
}

onMount(() => {
  let disposed = false;
  void browser.storage.local
    .get(['addressColors', 'addressColorThemeEnabled'])
    .then((stored) => {
      if (disposed) return;
      addressColors = sanitizedColors(stored.addressColors);
      colorsEnabled = stored.addressColorThemeEnabled === true;
    })
    .catch((error) => logError('Failed to load per-address accent colors', error));

  const onStorageChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local') return;
    if (changes.addressColors) addressColors = sanitizedColors(changes.addressColors.newValue);
    if (changes.addressColorThemeEnabled) {
      colorsEnabled = changes.addressColorThemeEnabled.newValue === true;
    }
  };
  browser.storage.onChanged.addListener(onStorageChanged);
  return () => {
    disposed = true;
    browser.storage.onChanged.removeListener(onStorageChanged);
  };
});

async function saveColor(address: Address, color: string) {
  if (!HEX_COLOR.test(color)) return;
  const key = address.id || address.address;
  savingIds = new Set(savingIds).add(key);
  try {
    addressColors = await updateAddressColors((current) => {
      const next = { ...current, [key]: color };
      if (address.id) delete next[address.address];
      return next;
    });
  } catch (error) {
    logError('Failed to save per-address accent color', error);
    toastStore.error($t('toasts.operationFailed'));
  } finally {
    const next = new Set(savingIds);
    next.delete(key);
    savingIds = next;
  }
}

async function toggleColors(enabled: boolean) {
  savingEnabled = true;
  try {
    await writeWithRetry({ addressColorThemeEnabled: enabled });
    colorsEnabled = enabled;
  } catch (error) {
    logError('Failed to update per-address accent color setting', error);
    toastStore.error($t('toasts.operationFailed'));
  } finally {
    savingEnabled = false;
  }
}
</script>

<div class="scroll-body h-full min-h-0 overflow-y-auto py-4">
  <div class="mx-auto flex w-full max-w-3xl flex-col gap-5 pb-8">
    <header class="flex items-start gap-3">
      {#if onBack}
        <button
          type="button"
          class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-md-on-surface transition-colors hover:bg-md-surface-variant/70 active:bg-md-surface-variant/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary/40"
          aria-label={$t('common.back')}
          title={$t('common.back')}
          onclick={onBack}
        >
          <Icon name="chevronLeft" class="h-4 w-4 rtl-flip" />
        </button>
      {/if}
      <div class="space-y-1">
        <h1 class="text-xl font-semibold text-md-on-surface">{$t('preferences.perAddressAccent')}</h1>
        <p class="text-sm text-md-on-surface/65">{$t('preferences.perAddressAccentDescription')}</p>
      </div>
    </header>

    <section class="rounded-2xl border border-md-outline-variant/40 bg-md-surface-container-low p-4">
      <label class="flex cursor-pointer items-center justify-between gap-4">
        <span class="text-sm font-medium text-md-on-surface">{$t('preferences.perAddressAccent')}</span>
        <Toggle
          checked={colorsEnabled}
          disabled={savingEnabled}
          ariaLabel={$t('preferences.perAddressAccent')}
          onChange={toggleColors}
        />
      </label>
    </section>

    <section class="space-y-3" aria-label={$t('preferences.perAddressAccent')}>
      {#each allAddresses as address (address.id || address.address)}
        {@const key = address.id || address.address}
        {@const color = colorFor(address)}
        <article
          class="flex min-w-0 items-center gap-3 rounded-2xl border border-md-outline-variant/35 bg-md-surface-container-low px-3 py-3 sm:px-4"
        >
          <span
            class="h-10 w-10 shrink-0 rounded-xl border border-md-outline-variant/50"
            style="background-color: {color};"
            aria-hidden="true"
          ></span>
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium text-md-on-surface" dir="ltr">
              {address.address}
            </div>
            <div class="text-xs text-md-on-surface/55">{address.provider}</div>
          </div>
          <input
            type="color"
            class="h-10 w-11 shrink-0 cursor-pointer rounded-lg border border-md-outline-variant bg-md-surface p-1 disabled:cursor-wait disabled:opacity-50"
            value={color}
            disabled={savingIds.has(key)}
            aria-label="{$t('preferences.perAddressAccent')}: {address.address}"
            onchange={(event) => void saveColor(address, (event.currentTarget as HTMLInputElement).value)}
          />
        </article>
      {/each}
    </section>
  </div>
</div>
