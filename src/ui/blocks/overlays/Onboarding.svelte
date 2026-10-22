<script lang="ts">
import { onMount, tick } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import { handleCreateAddress } from '@/features/onboarding/onboarding-actions.js';
import { setPendingProductTour } from '@/features/product-tour/tour-storage.js';
import LanguageSwitcher from '@/ui/blocks/widgets/LanguageSwitcher.svelte';
import ButtonGroup from '@/ui/components/composites/ButtonGroup.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import Btn from '@/ui/components/primitives/Btn.svelte';
import Radio from '@/ui/components/primitives/Radio.svelte';
import { getAllProviderConfigs, type ProviderConfig } from '@/utils/email/email-service.js';
import { localizedErrorMessageOrFallback } from '@/utils/errors.js';
import { locale, setLanguage } from '@/utils/i18n/i18n';
import { mapToSupportedLocale } from '@/utils/i18n/i18n-utils.js';
import { logError } from '@/utils/logger.js';
import { getProviderInstancesWithCustom } from '@/utils/provider/instance-manager.js';
import { getFastestPing, probeProviderInstances } from '@/utils/provider/ping-service.js';
import { formatCompactDuration, formatMilliseconds } from '@/utils/time/time-format.js';
import { beginDialogLifecycle } from '@/utils/ui/dialog-lifecycle.js';
import { PORTAL_Z_CLASS, portalDialogAction } from '@/utils/ui/portal-layers.js';
import { useReducedMotion } from '@/utils/ui/reduced-motion.svelte.js';
import { controlSurface } from '@/utils/ui/row-surface.js';

/** Brand mark for the welcome intro, copied verbatim from `public/welcome-icon.webp`. */
const welcomeIcon = (() => {
  const runtime = browser.runtime as { getURL?: (path: string) => string };
  return typeof runtime.getURL === 'function'
    ? runtime.getURL('/welcome-icon.webp')
    : '/welcome-icon.webp';
})();

let {
  onCreateAddress,
  onStartProductTour = () => {},
  onImportBackup = () => {},
  introBoundsEl = null,
}: {
  onCreateAddress: (provider: string, preparationId?: string) => void | Promise<void>;
  /** Called after first inbox so parent can launch the interactive tour */
  onStartProductTour?: () => void;
  /** Open full import backup dialog */
  onImportBackup?: () => void;
  /** The shared app surface, including its header, covered during the welcome intro. */
  introBoundsEl?: HTMLElement | null;
} = $props();

let selectedProvider = $state<string>('');
let step = $state<1 | 2>(1);
let creating = $state(false);
let createError = $state('');
let preparationId = $state<string | undefined>();
let preparationPort: ReturnType<typeof browser.runtime.connect> | null = null;

function stopPreparation() {
  preparationId = undefined;
  try {
    preparationPort?.disconnect();
  } catch (error) {
    logError('Onboarding preparation disconnect failed', error);
  }
  preparationPort = null;
}

onMount(() => {
  if (typeof browser.runtime.connect !== 'function') return;
  try {
    const port = browser.runtime.connect({ name: 'onboarding-preparation' });
    preparationPort = port;
    const receive = (message: unknown) => {
      if (
        message &&
        typeof message === 'object' &&
        'sessionId' in message &&
        typeof message.sessionId === 'string'
      )
        preparationId = message.sessionId;
    };
    const disconnected = () => {
      preparationId = undefined;
      if (preparationPort === port) preparationPort = null;
    };
    port.onMessage.addListener(receive);
    port.onDisconnect.addListener(disconnected);
    return () => {
      port.onMessage.removeListener(receive);
      port.onDisconnect.removeListener(disconnected);
      stopPreparation();
    };
  } catch (error) {
    logError('Onboarding preparation connection failed', error);
  }
});
/** Best instance ping ms per provider id */
let providerPings = $state<Record<string, number | 'timeout' | '…'>>({});
type PingError = 'dns' | 'validation' | 'unreadable' | 'request';
let providerPingErrors = $state<Record<string, PingError>>({});
let rootEl = $state<HTMLElement | null>(null);
let welcomeBodyEl = $state<HTMLDivElement | null>(null);
let introEl = $state<HTMLDivElement | null>(null);
let introBrandEl = $state<HTMLDivElement | null>(null);
let introActive = $state(true);
let introRevealing = $state(false);
let introStyle = $state('inset: 0;');
let introTimer: ReturnType<typeof setTimeout> | undefined;
let introAnimation: Animation | null = null;
const motionPreference = useReducedMotion();

function finishIntro() {
  clearTimeout(introTimer);
  introAnimation?.cancel();
  introAnimation = null;
  introActive = false;
}

$effect(() => {
  if (motionPreference.enabled) finishIntro();
});

onMount(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    finishIntro();
    return;
  }

  function placeIntro() {
    const bounds = introBoundsEl?.getBoundingClientRect();
    introStyle = bounds
      ? `left: ${bounds.left}px; top: ${bounds.top}px; width: ${bounds.width}px; height: ${bounds.height}px;`
      : 'inset: 0;';
  }
  placeIntro();
  const resize = new ResizeObserver(placeIntro);
  if (introBoundsEl) resize.observe(introBoundsEl);
  window.addEventListener('resize', placeIntro);

  introTimer = setTimeout(() => {
    if (!introActive || !introBrandEl || !welcomeBodyEl) {
      finishIntro();
      return;
    }
    // Move the intro toward the content's top edge, then remove it entirely.
    // The final page keeps no visible welcome title or reserved title space.
    const start = introBrandEl.getBoundingClientRect();
    const end = welcomeBodyEl.getBoundingClientRect();
    const x = end.left + end.width / 2 - (start.left + start.width / 2);
    const y = end.top - start.top;
    try {
      introRevealing = true;
      introAnimation = introBrandEl.animate(
        [
          { transform: 'translate(0, 0)', opacity: 1 },
          { transform: `translate(${x}px, ${y}px)`, opacity: 0 },
        ],
        { duration: 420, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
      );
      void introAnimation.finished.then(finishIntro).catch((error) => {
        // Cancellation is expected on reduced-motion changes or teardown.
        if (!introActive) return;
        logError('Onboarding welcome animation interrupted', error);
        finishIntro();
      });
    } catch (error) {
      logError('Onboarding welcome animation failed', error);
      finishIntro();
    }
  }, 1500);

  return () => {
    resize.disconnect();
    window.removeEventListener('resize', placeIntro);
    clearTimeout(introTimer);
    // Cancel the animation without its rejection revealing a detached view.
    introActive = false;
    introAnimation?.cancel();
  };
});

// Onboarding is a blocking full-screen surface (role="dialog" below): keep
// Tab cycling inside it while it is mounted, and re-attach when the step
// swaps the root element.
$effect(() => {
  const welcomeStep = step === 1;
  const showingIntro = welcomeStep && introActive;
  const lifecycle = beginDialogLifecycle({ lockBodyScroll: false });
  void tick().then(() => {
    const element = showingIntro ? introEl : rootEl;
    lifecycle.attach(element, welcomeStep ? element : undefined);
  });
  return () => lifecycle.cleanup();
});

// Detect browser/OS language and pre-select it on first onboarding (no saved preference yet)
onMount(() => {
  void (async () => {
    try {
      const stored = (await browser.storage.local.get(['locale', 'preferredLanguage'])) as {
        locale?: string;
        preferredLanguage?: string;
      };
      if (stored.preferredLanguage || stored.locale) {
        // Honor existing choice
        await setLanguage(mapToSupportedLocale(stored.preferredLanguage || stored.locale));
        return;
      }
      const nav =
        (typeof navigator !== 'undefined' && (navigator.language || navigator.languages?.[0])) ||
        'en';
      const mapped = mapToSupportedLocale(nav);
      await setLanguage(mapped);
    } catch (e) {
      logError('Onboarding locale detect failed', e);
    }
  })();
});

// Load providers dynamically - never include synthetic Demo
let providers = $derived.by((): ProviderConfig[] => {
  try {
    return getAllProviderConfigs();
  } catch (error) {
    logError('Failed to load onboarding provider configurations', error);
    return [];
  }
});

const providerNames = $derived(
  new Intl.ListFormat($locale || 'en', { style: 'long', type: 'conjunction' }).format(
    providers.map((provider) => provider.displayName)
  )
);

// Ping each provider (best instance) when step 2 is shown.
// Never read+write providerPings in the same reactive effect (causes effect_update_depth_exceeded).
$effect(() => {
  if (step !== 2 || providers.length === 0) return;
  const list = providers;
  let cancelled = false;
  void (async () => {
    const next: Record<string, number | 'timeout' | '…'> = {};
    const errors: Record<string, PingError> = {};
    await Promise.all(
      list.map(async (p) => {
        if (cancelled) return;
        next[p.id] = '…';
        // Write a new object without reading reactive providerPings
        providerPings = { ...next };
        try {
          const instances = await getProviderInstancesWithCustom(p.id);
          const results = await probeProviderInstances(p, instances);
          if (cancelled) return;
          const best = getFastestPing(new Map([...results].map(([id, probe]) => [id, probe.ping])));
          const probes = [...results.values()];
          if (best === null) {
            errors[p.id] = probes.every((probe) => probe.failure === 'validation')
              ? probes.some((probe) => probe.error === 'errors.networkErrorGeneric')
                ? 'dns'
                : 'validation'
              : probes.some((probe) => probe.failure === 'unreadable')
                ? 'unreadable'
                : 'request';
            providerPingErrors = { ...errors };
          }
          next[p.id] = best === null ? 'timeout' : best;
          providerPings = { ...next };
        } catch (error) {
          logError('Onboarding provider ping failed', error);
          if (!cancelled) {
            next[p.id] = 'timeout';
            errors[p.id] = 'request';
            providerPingErrors = { ...errors };
            providerPings = { ...next };
          }
        }
      })
    );
  })();
  return () => {
    cancelled = true;
  };
});

function formatPing(v: number | 'timeout' | '…' | undefined): string {
  if (v === undefined || v === '…') return $t('onboarding.pinging');
  if (v === 'timeout') return $t('address.unavailable');
  return formatMilliseconds(v);
}

function formatPingFailure(error: PingError): string {
  switch (error) {
    case 'dns':
      return $t('onboarding.pingDnsFailed');
    case 'validation':
      return $t('onboarding.pingValidationFailed');
    case 'unreadable':
      return $t('onboarding.pingUnreadable');
    case 'request':
      return $t('onboarding.pingRequestFailed');
  }
}

/** Format a provider expiry duration (ms) as a compact localized duration, e.g. "1h" / "30m" / "30d". */
function formatExpiryDuration(ms: number | undefined): string {
  if (!ms || ms <= 0) return $t('onboarding.noExpiry');
  return formatCompactDuration(ms);
}

// Reusable onboarding color tokens - keep icon & label colors consistent site-wide.
// (Tailwind's `text-md-*` utilities resolve to these same MD3 variables.)
const LABEL_CLASS = 'text-md-on-surface';
const LABEL_MUTED_CLASS = 'text-md-on-surface/60';

async function createFirstAddress(provider: string) {
  if (!provider || creating) return;
  creating = true;
  createError = '';
  try {
    await handleCreateAddress(provider, browser, {
      onCreateAddress: async (p) => {
        await onCreateAddress(p, preparationId);
      },
    });
    // Only queue / start product tour AFTER first inbox creation succeeds
    try {
      await setPendingProductTour(true);
    } catch {
      /* ignore */
    }
    onStartProductTour();
  } catch (e) {
    logError('Onboarding createFirstAddress failed', e);
    // Never surface the raw thrown value: typed errors render their keyed
    // message, everything else falls back to the localized create-failed copy.
    createError = localizedErrorMessageOrFallback(e, $t, 'errors.addressCreationFailed');
    // Allow retry with another provider - do not leave UI stuck
  } finally {
    creating = false;
  }
}
</script>

{#snippet supportIndicator(supported: boolean)}
  <span class="inline-flex items-center justify-center {supported ? 'text-md-success' : 'text-md-error'}" role="img" aria-label={supported ? $t('common.yes') : $t('common.no')}>
    <Icon name={supported ? 'check' : 'close'} class="w-5 h-5" />
  </span>
{/snippet}

{#snippet pageInformation()}
  <div class="flex flex-col gap-2">
    <div class="flex items-center justify-center gap-2" role="img" aria-label={$t('onboarding.pageIndicator', { values: { n: step, total: 2 } })}>
      {#each [1, 2] as page (page)}
        <span class="w-1.5 h-1.5 rounded-full {step === page ? 'bg-md-primary' : 'bg-md-outline-variant'}" aria-hidden="true"></span>
      {/each}
    </div>
    <div class="flex items-start gap-2 text-start text-md-on-surface-variant">
      <Icon name="shield" class="w-4 h-4 shrink-0 mt-0.5" />
      <p class="text-xs min-w-0">{$t('onboarding.developerNote')}</p>
    </div>
  </div>
{/snippet}

{#if step === 1}
  {#if introActive}
    <div
      bind:this={introEl}
      use:portalDialogAction
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-intro-title"
      tabindex="-1"
      class="welcome-intro fixed flex items-center justify-center page-inset {PORTAL_Z_CLASS.dialog} focus:outline-none"
      style={introStyle}
      style:background-color={introRevealing ? 'transparent' : 'var(--md-surface)'}
    >
      <div bind:this={introBrandEl} class="flex flex-col items-center gap-3">
        <img src={welcomeIcon} alt="" class="w-16 h-16 object-contain rounded-xl" />
        <h2 id="onboarding-intro-title" class="text-title-lg text-center whitespace-nowrap {LABEL_CLASS}">{$t('onboarding.welcome')}</h2>
      </div>
    </div>
  {/if}
  <!-- Welcome Step: the icon and visible welcome title belong only to the intro. -->
  <div
    bind:this={rootEl}
    role="dialog"
    aria-modal="true"
    aria-labelledby="onboarding-title"
    tabindex="-1"
    inert={introActive}
    aria-hidden={introActive ? 'true' : undefined}
    class="scroll-frame flex flex-col w-full max-w-md mx-auto h-full min-h-0 pt-3 gap-3 focus:outline-none {introActive && !introRevealing ? 'welcome-pending' : 'welcome-revealed'}"
  >
    <h2 id="onboarding-title" class="sr-only">{$t('onboarding.welcome')}</h2>
    <div class="welcome-details scroll-edge flex items-center justify-center gap-2 shrink-0" role="group" aria-labelledby="onboarding-language-label">
      <span id="onboarding-language-label" class="text-sm text-start {LABEL_CLASS}">{$t('onboarding.chooseLanguage')}</span>
      <div class="shrink-0"><LanguageSwitcher /></div>
    </div>

    <div bind:this={welcomeBodyEl} class="scroll-body scroll-body-framed flex-1 min-h-0 overflow-y-auto">
      <div class="w-full flex flex-col gap-4">
        <ul class="welcome-details w-full flex flex-col gap-2 list-none">
          <li class="flex items-start gap-3 bg-md-surface-container-low rounded-xl p-3">
            <div class="w-8 h-8 rounded-lg bg-md-primary-container text-md-on-primary-container flex items-center justify-center shrink-0" aria-hidden="true">
              <Icon name="mail" class="w-5 h-5" />
            </div>
            <div class="text-start min-w-0 flex flex-col gap-1">
              <h3 class="text-sm font-semibold {LABEL_CLASS}">{$t('onboarding.feature1Title')}</h3>
              <p class="text-sm text-md-on-surface-variant">{$t('onboarding.feature1Description')}</p>
              {#if providers.length > 0}
                <p class="text-xs text-md-on-surface-variant">{$t('onboarding.serviceProviders', { values: { providers: providerNames } })}</p>
              {/if}
            </div>
          </li>

          <li class="flex items-start gap-3 bg-md-surface-container-low rounded-xl p-3">
            <div class="w-8 h-8 rounded-lg bg-md-primary-container text-md-on-primary-container flex items-center justify-center shrink-0" aria-hidden="true">
              <Icon name="person" class="w-5 h-5" />
            </div>
            <div class="text-start min-w-0 flex flex-col gap-1">
              <h3 class="text-sm font-semibold {LABEL_CLASS}">{$t('onboarding.feature2Title')}</h3>
              <p class="text-sm text-md-on-surface-variant">{$t('onboarding.feature2Description')}</p>
            </div>
          </li>

          <li class="flex items-start gap-3 bg-md-surface-container-low rounded-xl p-3">
            <div class="w-8 h-8 rounded-lg bg-md-primary-container text-md-on-primary-container flex items-center justify-center shrink-0" aria-hidden="true">
              <Icon name="key" class="w-5 h-5" />
            </div>
            <div class="text-start min-w-0 flex flex-col gap-1">
              <h3 class="text-sm font-semibold {LABEL_CLASS}">{$t('onboarding.feature3Title')}</h3>
              <p class="text-sm text-md-on-surface-variant">{$t('onboarding.feature3Description')}</p>
              <p class="text-xs text-md-on-surface-variant">{$t('onboarding.aiDetectionNote')}</p>
            </div>
          </li>
        </ul>

      </div>
    </div>

    <div class="welcome-details scroll-edge shrink-0 flex flex-col gap-3">
      {@render pageInformation()}
      <ButtonGroup tier="S">
        <Btn variant="primaryOutline" icon="upload" label={$t('onboarding.importBackup')} title={$t('onboarding.importBackupHint')} onclick={() => { stopPreparation(); onImportBackup(); }} />
        <Btn variant="primary" icon="mail" label={$t('onboarding.continue')} onclick={() => step = 2} />
      </ButtonGroup>
    </div>
  </div>

{:else}
  <!-- Create First Inbox Step -->
  <div
    bind:this={rootEl}
    role="dialog"
    aria-modal="true"
    aria-labelledby="onboarding-title"
    class="scroll-frame flex flex-col w-full max-w-3xl mx-auto h-full min-h-0 pt-3 gap-3"
  >
    <div class="scroll-edge shrink-0 text-center">
      <h2 id="onboarding-title" class="text-title-lg {LABEL_CLASS}">{$t('onboarding.chooseProvider')}</h2>
    </div>

    <div class="scroll-body scroll-body-framed flex-1 min-h-0 overflow-y-auto">
      <div class="overflow-x-auto">
      <!-- One feature column, then one selectable column per configured provider. -->
      <table class="provider-comparison w-full text-sm text-md-on-surface border-collapse table-fixed" style:min-width={`${110 + providers.length * 106}px`}>
        <caption class="sr-only">{$t('onboarding.providerComparison')}</caption>
        <colgroup>
          <col style:width="110px" />
          {#each providers as provider (provider.id)}
            <col />
          {/each}
        </colgroup>
        <thead>
          <tr class="bg-md-surface-container-low">
            <th scope="col" class="px-2 py-2 text-start font-semibold">{$t('onboarding.tempProviderFallback')}</th>
            {#each providers as provider (provider.id)}
              <th scope="col" class="p-1 align-top font-semibold">
                <label for={`onboarding-provider-${provider.id}`} class="flex flex-col items-center justify-center gap-1 h-full rounded-lg p-1 border-2 border-transparent cursor-pointer text-md-on-surface {controlSurface(selectedProvider === provider.id, 'border')}">
                  <Radio id={`onboarding-provider-${provider.id}`} name="onboarding-provider" value={provider.id} checked={selectedProvider === provider.id} disabled={creating} ariaLabel={provider.displayName} onchange={() => { selectedProvider = provider.id; createError = ''; }} />
                  <span class="break-words w-full">{provider.displayName}</span>
                </label>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row" class="text-start font-medium">{$t('onboarding.compareCustom')}</th>
            {#each providers as provider (provider.id)}
              <td>{@render supportIndicator(!!(provider.customEmail?.supported || provider.ui?.supportsCustomEmail))}</td>
            {/each}
          </tr>
          <tr>
            <th scope="row" class="text-start font-medium">{$t('onboarding.compareRenew')}</th>
            {#each providers as provider (provider.id)}
              <td>{@render supportIndicator(!!provider.expiry?.renewable)}</td>
            {/each}
          </tr>
          <tr>
            <th scope="row" class="text-start font-medium">{$t('onboarding.compareExpiryIn')}</th>
            {#each providers as provider (provider.id)}
              <td class="tabular-nums">{formatExpiryDuration(provider.expiry?.duration)}</td>
            {/each}
          </tr>
          <tr>
            <th scope="row" class="text-start font-medium">{$t('onboarding.compareMultiInst')}</th>
            {#each providers as provider (provider.id)}
              <td>{@render supportIndicator(!!provider.multiInstance?.enabled)}</td>
            {/each}
          </tr>
          <tr>
            <th scope="row" class="text-start font-medium">{$t('onboarding.compareDomains')}</th>
            {#each providers as provider (provider.id)}
              <td>{provider.multiDomain?.domains?.length ? String(provider.multiDomain.domains.length) : '-'}</td>
            {/each}
          </tr>
          <tr>
            <th scope="row" class="text-start font-medium">{$t('onboarding.comparePing')}</th>
            {#each providers as provider (provider.id)}
              <td class="tabular-nums">{providerPings[provider.id] === 'timeout' && providerPingErrors[provider.id] ? formatPingFailure(providerPingErrors[provider.id]) : formatPing(providerPings[provider.id])}</td>
            {/each}
          </tr>
        </tbody>
      </table>
      </div>
      <p class="mt-3 text-xs text-md-on-surface-variant">{$t('onboarding.providerChangeNote')}</p>
    </div>

    {#if createError}
      <p class="scroll-edge text-sm text-md-error text-start shrink-0" role="alert">
        {createError}
        <span class="{LABEL_MUTED_CLASS}"> · {$t('onboarding.retryWithOtherProvider')}</span>
      </p>
    {/if}

    <!-- Back + Create First Address (same row) -->
    <div class="scroll-edge shrink-0 flex flex-col gap-3">
      {@render pageInformation()}
      <ButtonGroup tier="S">
        <Btn variant="primaryOutline" label={$t('onboarding.back')} disabled={creating} onclick={() => step = 1} />
        <Btn variant="primary" icon="mail" label={creating ? $t('common.loading') : $t('onboarding.createFirstAddress')} disabled={creating || !selectedProvider} onclick={() => void createFirstAddress(selectedProvider)} />
      </ButtonGroup>
    </div>
  </div>
{/if}

<style>
  .provider-comparison tbody th,
  .provider-comparison tbody td {
    padding: 10px 8px;
    border-top: 1px solid var(--md-outline-variant);
    overflow-wrap: anywhere;
  }
  .provider-comparison tbody td {
    text-align: center;
  }
  .welcome-intro {
    transition: background-color 420ms cubic-bezier(0.2, 0, 0, 1);
  }
  .welcome-pending {
    opacity: 0;
  }
  .welcome-revealed .welcome-details {
    animation: welcome-reveal 220ms ease-out;
  }
  @keyframes welcome-reveal {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .welcome-intro { transition: none; }
    .welcome-revealed .welcome-details { animation: none; }
  }
</style>
