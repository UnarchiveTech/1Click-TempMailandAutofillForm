<script lang="ts">
/**
 * Provider / instance picker for Create Address (right-click FAB / sidebar CTA).
 * Shows favicon + ping latency when available.
 */
import { t } from 'svelte-i18n';
import Icon from '@/components/icons/Icon.svelte';
import FaviconImage from '@/components/ui/FaviconImage.svelte';
import { getAllProviderConfigs, type ProviderConfig } from '@/utils/email-service.js';
import * as PingService from '@/utils/ping-service.js';
import type { ProviderInstance } from '@/utils/types.js';

let {
  open = false,
  x = 0,
  y = 0,
  providerInstances = [] as ProviderInstance[],
  onClose = () => {},
  onPick = (_providerId: string, _instanceId?: string) => {},
} = $props<{
  open?: boolean;
  x?: number;
  y?: number;
  providerInstances?: ProviderInstance[];
  onClose?: () => void;
  onPick?: (providerId: string, instanceId?: string) => void;
}>();

let allProviders = $derived.by((): ProviderConfig[] => {
  try {
    return getAllProviderConfigs();
  } catch {
    return [];
  }
});

/** key = providerId or instanceId → ms | 'timeout' | null pending */
let pings = $state<Map<string, number | 'timeout' | null>>(new Map());

function providerFaviconDomain(provider: ProviderConfig): string {
  try {
    if (provider.websiteUrl) return new URL(provider.websiteUrl).hostname;
  } catch {
    /* ignore */
  }
  try {
    if (provider.apiUrl) return new URL(provider.apiUrl).hostname;
  } catch {
    /* ignore */
  }
  return '';
}

function instancesFor(provider: ProviderConfig): ProviderInstance[] {
  const fromConfig =
    provider.multiInstance?.enabled && Array.isArray(provider.multiInstance.instances)
      ? provider.multiInstance.instances.map((inst) => ({ ...inst, isCustom: false as const }))
      : [];
  const customs = (providerInstances || []).filter(
    (i: ProviderInstance) =>
      (i as ProviderInstance & { providerId?: string }).providerId === provider.id || !!i.isCustom
  );
  const ids = new Set(fromConfig.map((i: ProviderInstance) => i.id));
  return [...fromConfig, ...customs.filter((c: ProviderInstance) => !ids.has(c.id))];
}

function formatPing(ms: number | 'timeout' | null | undefined): string {
  if (ms === undefined || ms === null) return '…';
  return PingService.formatPing(ms);
}

function pingDot(ms: number | 'timeout' | null | undefined): string {
  if (ms === undefined || ms === null) return '⏳';
  if (ms === 'timeout') return '🔴';
  if (ms < 200) return '🟢';
  if (ms < 500) return '🟡';
  return '🟠';
}

async function pingAll() {
  const next = new Map<string, number | 'timeout' | null>();
  for (const provider of allProviders) {
    next.set(provider.id, null);
    for (const inst of instancesFor(provider)) next.set(inst.id, null);
  }
  pings = next;

  for (const provider of allProviders) {
    try {
      const results = await PingService.pingProviderInstances(provider, instancesFor(provider));
      const map = new Map(pings);
      for (const [k, v] of results) map.set(k, v);
      // If only provider id was measured (no instances)
      const providerPing = results.get(provider.id);
      if (providerPing !== undefined) map.set(provider.id, providerPing);
      else if (results.size === 0) map.set(provider.id, 'timeout');
      else {
        // Use fastest instance as provider-level summary
        const fastest = PingService.getFastestPing(results);
        map.set(provider.id, fastest === null ? 'timeout' : fastest);
      }
      pings = map;
    } catch {
      const map = new Map(pings);
      map.set(provider.id, 'timeout');
      pings = map;
    }
  }
}

$effect(() => {
  if (open) void pingAll();
});
</script>

{#if open}
  <button
    type="button"
    class="fixed inset-0 z-[200] cursor-default bg-transparent border-0"
    aria-label={$t('common.close')}
    onclick={() => onClose()}
  ></button>
  <div
    class="fixed z-[210] min-w-[220px] max-w-[min(280px,90vw)] max-h-[min(360px,70vh)] overflow-y-auto rounded-xl border border-md-outline-variant bg-md-surface-container shadow-2xl py-1"
    style="left: {x}px; top: {y}px;"
    role="menu"
    aria-label={$t('nav.fabCreateAddress')}
  >
    <div class="px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-md-on-surface/45">
      {$t('nav.createWithProvider')}
    </div>
    {#each allProviders as provider (provider.id)}
      {@const instances = instancesFor(provider)}
      {@const favDomain = providerFaviconDomain(provider)}
      {@const rootPing = pings.get(provider.id)}
      <button
        type="button"
        class="w-full px-3 py-2 text-start hover:bg-md-surface-variant text-sm flex items-center gap-2"
        role="menuitem"
        onclick={() => onPick(provider.id)}
      >
        {#if favDomain}
          <FaviconImage
            domain={favDomain}
            size={16}
            fallbackLetter={(provider.displayName || provider.id || '?').charAt(0)}
            class="shrink-0 rounded-sm"
          />
        {:else}
          <Icon name="mail" class="w-3.5 h-3.5 shrink-0 opacity-70" />
        {/if}
        <span class="truncate font-medium flex-1">{provider.displayName || provider.id}</span>
        <span class="text-[10px] text-md-on-surface/50 shrink-0 tabular-nums"
          >{pingDot(rootPing)} {formatPing(rootPing)}</span
        >
      </button>
      {#each instances as instance (instance.id)}
        {@const instDomain = (() => {
          try {
            return instance.apiUrl ? new URL(instance.apiUrl).hostname : favDomain;
          } catch {
            return favDomain;
          }
        })()}
        {@const iPing = pings.get(instance.id)}
        <button
          type="button"
          class="w-full px-3 py-1.5 text-start hover:bg-md-surface-variant text-xs flex items-center gap-2 ps-8 text-md-on-surface/80"
          role="menuitem"
          onclick={() => onPick(provider.id, instance.id)}
        >
          {#if instDomain}
            <FaviconImage
              domain={instDomain}
              size={14}
              fallbackLetter={(instance.displayName || instance.name || instance.id || '?').charAt(
                0
              )}
              class="shrink-0 rounded-sm"
            />
          {:else}
            <Icon name="instances" class="w-3 h-3 shrink-0 opacity-60" />
          {/if}
          <span class="truncate flex-1">{instance.displayName || instance.name || instance.id}</span>
          <span class="text-[10px] text-md-on-surface/50 shrink-0 tabular-nums"
            >{pingDot(iPing)} {formatPing(iPing)}</span
          >
        </button>
      {/each}
    {/each}
  </div>
{/if}
