<script lang="ts">
/**
 * Provider / instance picker for Create Address (right-click FAB / sidebar CTA).
 * Shows favicon + ping latency when available.
 *
 * IMPORTANT: The overlay is portaled to document.body via $effect so that
 * `position:fixed` escapes CSS-transform stacking contexts (Footer slide-in,
 * split-pane, etc.). Without this, fixed children of a transformed ancestor
 * are positioned relative to that ancestor, not the viewport, making the menu
 * appear in the wrong place and intercepting clicks from the invisible backdrop.
 */
import { onDestroy } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import { registerEscapeTier, topEscapeTierId } from '@/features/keyboard-shortcuts/escape-stack.js';
import Icon from '@/ui/components/icons/Icon.svelte';
import FaviconImage from '@/ui/components/primitives/FaviconImage.svelte';
import { getAllProviderConfigs, type ProviderConfig } from '@/utils/email/email-service.js';
import { localizedErrorMessageOrFallback } from '@/utils/errors.js';
import { logError } from '@/utils/logger.js';
import {
  getDisabledInstances,
  setDisabledInstances,
  toggleDisabledInstance,
} from '@/utils/provider/instance-manager.js';
import * as PingService from '@/utils/provider/ping-service.js';
import { getSelectedProvider } from '@/utils/storage/storage-keys.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import type { ProviderInstance } from '@/utils/types.js';
import { beginDialogLifecycle } from '@/utils/ui/dialog-lifecycle.js';
import { ELEVATION } from '@/utils/ui/elevation.js';
import { PORTAL_Z } from '@/utils/ui/portal-layers.js';
import { toastStore } from '@/utils/ui/toastStore.js';

let {
  open = false,
  x = 0,
  y = 0,
  providerInstances = [] as ProviderInstance[],
  onClose = () => {},
  onPick = (_providerId: string, _instanceId?: string) => {},
  onOpenProviderSettings = undefined as (() => void) | undefined,
}: {
  open?: boolean;
  x?: number;
  y?: number;
  providerInstances?: ProviderInstance[];
  onClose?: () => void;
  onPick?: (providerId: string, instanceId?: string) => void;
  /** Settings gear - open Mail Provider Settings */
  onOpenProviderSettings?: () => void;
} = $props();

let allProviders = $derived.by((): ProviderConfig[] => {
  try {
    return getAllProviderConfigs();
  } catch {
    /* ignore */
    return [];
  }
});

/** Currently-default provider id (loaded from storage when the menu opens). */
let defaultProviderId = $state('');
/** providerId → set of DISABLED instance ids (checkbox pool blacklist). */
let disabledByProvider = $state<Map<string, Set<string>>>(new Map());

$effect(() => {
  if (open) {
    void getSelectedProvider()
      .then((id) => {
        defaultProviderId = id;
      })
      .catch(/* ignore */);
    // Load each provider's disabled-instance blacklist so checkboxes reflect reality.
    void loadDisabledInstances();
  }
});

async function loadDisabledInstances() {
  const next = new Map<string, Set<string>>();
  await Promise.all(
    allProviders.map(async (provider) => {
      try {
        next.set(provider.id, new Set(await getDisabledInstances(provider.id)));
      } catch {
        /* ignore */
        next.set(provider.id, new Set());
      }
    })
  );
  disabledByProvider = next;
}

/** Persist the chosen provider as the app default (no need to visit Settings). */
async function setDefaultProvider(provider: ProviderConfig) {
  try {
    await writeWithRetry({ selectedProvider: provider.id });
    defaultProviderId = provider.id;
    toastStore.success(
      $t('nav.defaultProviderSet', {
        values: { provider: provider.displayName || provider.id },
      })
    );
  } catch (err) {
    // A storage throw has no keyable message - its raw text (a DOMException
    // quota error, etc.) would reach the toast in English in every locale.
    logError('Failed to set the default provider', err);
    toastStore.error(localizedErrorMessageOrFallback(err, $t, 'errors.storageWriteFailed'));
  }
}

function isInstanceEnabled(providerId: string, instanceId: string): boolean {
  return !(disabledByProvider.get(providerId)?.has(instanceId) ?? false);
}

/** Toggle an instance in the enabled pool (min-1 guard: never disable all). */
async function toggleInstance(provider: ProviderConfig, instance: ProviderInstance) {
  // Only the default provider's instance pool is actionable. Non-default
  // providers are used for one-off picks; their checkbox pool is disabled.
  if (defaultProviderId && provider.id !== defaultProviderId) return;
  const current = disabledByProvider.get(provider.id) ?? new Set<string>();
  const next = toggleDisabledInstance(current, instance.id, instancesFor(provider).length);
  if (!next) {
    toastStore.warning($t('nav.minOneInstance'));
    return;
  }
  try {
    await setDisabledInstances(provider.id, [...next]);
    disabledByProvider = new Map(disabledByProvider).set(provider.id, next);
  } catch (err) {
    logError('Failed to persist the enabled instance pool', err);
    toastStore.error(localizedErrorMessageOrFallback(err, $t, 'errors.storageWriteFailed'));
  }
}

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
  if (ms === 'timeout') return $t('ping.timeout');
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
      /* ignore */
      const map = new Map(pings);
      map.set(provider.id, 'timeout');
      pings = map;
    }
  }
}

$effect(() => {
  if (open) void pingAll();
});

// ── Portal: physically move wrapper to document.body so position:fixed escapes
//    any CSS transform/filter ancestor in the Footer / split-pane layout. ──────
let wrapperEl = $state<HTMLElement | null>(null);

$effect(() => {
  const el = wrapperEl;
  if (!el) return;
  // Move to body if not already there
  if (el.parentElement !== document.body) {
    document.body.appendChild(el);
  }
  return () => {
    try {
      if (el.parentElement === document.body) el.remove();
    } catch {
      /* ignore */
    }
  };
});

// ── Viewport clamping ──────────────────────────────────────────────────────────
// The parent estimates the panel size (240×300) before it renders, which is
// wrong for narrow popup windows (menu can be up to 280×360). After the panel
// mounts we measure its real box and nudge it back into the viewport so the
// menu never clips off-screen - essential in compact popup mode.
let menuX = $state(0);
let menuY = $state(0);
let menuMeasured = $state(false);
let panelEl = $state<HTMLElement | null>(null);

$effect(() => {
  if (!open || !panelEl) return;
  const lifecycle = beginDialogLifecycle({ lockBodyScroll: false });
  lifecycle.attach(panelEl, panelEl.querySelector<HTMLElement>('[role="menuitem"]'));
  const releaseEscape = registerEscapeTier('provider.createMenu', onClose);
  return () => {
    releaseEscape();
    lifecycle.cleanup();
  };
});

function onMenuKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && topEscapeTierId() === 'provider.createMenu') {
    event.preventDefault();
    event.stopPropagation();
    onClose();
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const controls = Array.from(
    panelEl?.querySelectorAll<HTMLElement>('button:not([disabled])') || []
  );
  if (!controls.length) return;
  const index = controls.indexOf(document.activeElement as HTMLElement);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? controls.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length;
  event.preventDefault();
  event.stopPropagation();
  controls[next]?.focus();
}

$effect(() => {
  if (!open) return;
  menuX = x;
  menuY = y;
  menuMeasured = false;
});

// Measure after layout and re-clamp when async provider details or the viewport
// change size. Hidden until the first measurement so placement does not flash.
$effect(() => {
  if (!open || !panelEl) return;
  let raf = 0;
  const clamp = () => {
    const el = panelEl;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) {
      raf = requestAnimationFrame(clamp);
      return;
    }
    const pad = 8;
    menuX = Math.max(pad, Math.min(menuX, window.innerWidth - r.width - pad));
    menuY = Math.max(pad, Math.min(menuY, window.innerHeight - r.height - pad));
    menuMeasured = true;
  };
  const schedule = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(clamp);
  };
  const observer = new ResizeObserver(schedule);
  observer.observe(panelEl);
  window.addEventListener('resize', schedule, { passive: true });
  schedule();
  return () => {
    if (raf) cancelAnimationFrame(raf);
    observer.disconnect();
    window.removeEventListener('resize', schedule);
  };
});

onDestroy(() => {
  try {
    if (wrapperEl && wrapperEl.parentElement === document.body) wrapperEl.remove();
  } catch {
    /* ignore */
  }
});
</script>

<!--
  The bind:this wrapper is always in the DOM so the $effect can portal it.
  Visibility is controlled by display via `open`.
-->
<div bind:this={wrapperEl} style="display: contents;">
  {#if open}
    <!-- Backdrop: closes menu when clicking outside -->
    <button
      type="button"
      style="position:fixed; inset:0; z-index:{PORTAL_Z.dialog - 1}; cursor:default; background:transparent; border:0; padding:0;"
      aria-label={$t('common.close')}
      onclick={() => onClose()}
    ></button>
    <!-- Menu panel -->
    <div
      bind:this={panelEl}
      style="position:fixed; z-index:{PORTAL_Z.dialog}; left:{menuX}px; top:{menuY}px; width:min(280px,calc(100vw - 16px)); min-width:0; max-height:min(360px,70vh); overflow-y:auto; opacity:{menuMeasured ? 1 : 0}; transition:opacity 120ms ease;"
      class="rounded-xl border border-md-outline-variant bg-md-surface-container {ELEVATION.level2} py-1"
      role="menu"
      tabindex="-1"
      onkeydown={onMenuKeydown}
      aria-label={$t('address.newMailAddress')}
    >
      <div class="px-3 py-1.5 flex items-center justify-between gap-2">
        <span class="text-xs font-bold text-md-on-surface/45">
          {$t('nav.createWithProvider')}
        </span>
        {#if onOpenProviderSettings}
          <button
            type="button"
            class="w-7 h-7 flex items-center justify-center rounded-full text-md-on-surface/55 hover:text-md-primary hover:bg-md-primary/10 active:bg-md-primary/20 transition-colors shrink-0"
            aria-label={$t('preferences.mailProviderSettings')}
            title={$t('preferences.mailProviderSettings')}
            onclick={(e) => {
              e.stopPropagation();
              onClose();
              onOpenProviderSettings();
            }}
          >
            <Icon name="settings" class="w-3.5 h-3.5" />
          </button>
        {/if}
      </div>
      {#each allProviders as provider (provider.id)}
        {@const instances = instancesFor(provider)}
        {@const favDomain = providerFaviconDomain(provider)}
        {@const rootPing = pings.get(provider.id)}
        <!-- Provider row: leading default radio + name + (Default) badge + ping -->
        <div
          class="w-full px-3 py-2 text-start hover:bg-md-surface-variant text-sm flex items-center gap-2"
          role="none"
        >
          <button
            type="button"
            class="shrink-0 w-5 h-5 flex items-center justify-center rounded-full transition-colors {provider
              .id === defaultProviderId
              ? 'text-md-primary'
              : 'text-md-on-surface/30 hover:text-md-primary'}"
            title={
              provider.id === defaultProviderId
                ? $t('nav.defaultBadge')
                : $t('nav.setAsDefaultProvider')
            }
            aria-label={
              provider.id === defaultProviderId
                ? $t('nav.defaultBadge')
                : $t('nav.setAsDefaultProvider')
            }
            aria-checked={provider.id === defaultProviderId}
            role="radio"
            onclick={(e) => {
              e.stopPropagation();
              if (provider.id !== defaultProviderId) void setDefaultProvider(provider);
            }}
          >
            <Icon
              name={provider.id === defaultProviderId ? 'radioButtonChecked' : 'radioButtonUnchecked'}
              class="w-4 h-4"
            />
          </button>
          <button
            type="button"
            role="menuitem"
            class="flex-1 min-w-0 flex items-center gap-2 text-start"
            onclick={() => onPick(provider.id)}
          >
            {#if favDomain}
              <FaviconImage
                domain={favDomain}
                size="xs"
                fallbackLetter={(provider.displayName || provider.id || '?').charAt(0)}
                class="shrink-0 rounded-sm"
              />
            {:else}
              <Icon name="mail" class="w-3.5 h-3.5 shrink-0 opacity-70" />
            {/if}
            <span class="truncate font-medium flex-1">{provider.displayName || provider.id}</span>
            {#if provider.id === defaultProviderId}
              <span
                class="shrink-0 text-label-sm font-semibold text-md-primary bg-md-primary/10 rounded-full px-1.5 py-0.5"
                >({$t('nav.defaultBadge')})</span
              >
            {/if}
          </button>
          <span class="text-xs text-md-on-surface-variant shrink-0 tabular-nums"
            >{pingDot(rootPing)} {formatPing(rootPing)}</span
          >
        </div>
        {#each instances as instance (instance.id)}
          {@const instDomain = (() => {
            try {
              return instance.apiUrl ? new URL(instance.apiUrl).hostname : favDomain;
            } catch {
              /* ignore */
              return favDomain;
            }
          })()}
          {@const iPing = pings.get(instance.id)}
          {@const instEnabled = isInstanceEnabled(provider.id, instance.id)}
          {@const poolLocked = defaultProviderId !== '' && provider.id !== defaultProviderId}
          <!-- Instance row: leading enable checkbox + name + ping -->
          <div
            class="w-full min-h-10 px-3 py-1.5 text-start hover:bg-md-surface-variant text-sm flex items-center gap-2 ps-8 {poolLocked
              ? 'text-md-on-surface/35'
              : 'text-md-on-surface/80'}"
            role="none"
          >
            <button
              type="button"
              class="shrink-0 w-5 h-5 flex items-center justify-center rounded transition-colors {poolLocked
                ? 'text-md-on-surface/15 cursor-not-allowed'
                : instEnabled
                  ? 'text-md-primary'
                  : 'text-md-on-surface/25 hover:text-md-primary'}"
              title={poolLocked
                ? $t('nav.instancePoolLocked')
                : instEnabled
                  ? $t('nav.disableInstance')
                  : $t('nav.enableInstance')}
              aria-label={poolLocked
                ? $t('nav.instancePoolLocked')
                : instEnabled
                  ? $t('nav.disableInstance')
                  : $t('nav.enableInstance')}
              aria-checked={instEnabled}
              aria-disabled={poolLocked}
              disabled={poolLocked}
              role="checkbox"
              onclick={(e) => {
                e.stopPropagation();
                if (poolLocked) return;
                void toggleInstance(provider, instance);
              }}
            >
              <Icon name={instEnabled ? 'checkBox' : 'checkBoxOutlineBlank'} class="w-4 h-4" />
            </button>
            <button
              type="button"
              role="menuitem"
              class="flex-1 min-w-0 flex items-center gap-2 text-start"
              onclick={() => onPick(provider.id, instance.id)}
            >
              {#if instDomain}
                <FaviconImage
                  domain={instDomain}
                  size="xs"
                  fallbackLetter={
                    (instance.displayName || instance.name || instance.id || '?').charAt(0)
                  }
                  class="shrink-0 rounded-sm"
                />
              {:else}
                <Icon name="layers" class="w-3 h-3 shrink-0 opacity-60" />
              {/if}
              <span class="truncate flex-1"
                >{instance.displayName || instance.name || instance.id}</span
              >
            </button>
            <span class="text-xs text-md-on-surface-variant shrink-0 tabular-nums"
              >{pingDot(iPing)} {formatPing(iPing)}</span
            >
          </div>
        {/each}
      {/each}
    </div>
  {/if}
</div>
