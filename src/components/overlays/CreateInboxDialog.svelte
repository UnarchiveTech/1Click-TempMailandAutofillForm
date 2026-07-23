<script lang="ts">
import { tick } from 'svelte';
import { t } from 'svelte-i18n';
import Icon from '@/components/icons/Icon.svelte';
import Btn from '@/components/ui/primitives/Btn.svelte';
import type { ProviderConfig } from '@/utils/email-service.js';
import { getErrorMessage } from '@/utils/errors.js';
import { setupFocusTrap } from '@/utils/focusTrap.js';
import { portalToBody } from '@/utils/portal-layers.js';
import { validateUsername } from '@/utils/validation.js';

interface Props {
  open: boolean;
  onClose: () => void;
  /** type, username?, preferred domain? */
  onCreate: (type: 'random' | 'custom', username?: string, domain?: string) => void;
  providerConfig?: ProviderConfig;
}

let { open, onClose, onCreate, providerConfig }: Props = $props();

let inboxType = $state<'random' | 'custom'>('random');
let customUsername = $state('');
let selectedDomain = $state('');
let validationError = $state('');
let dialogRef = $state<HTMLElement | null>(null);
let overlayEl = $state<HTMLElement | null>(null);
let cleanupFocusTrap: (() => void) | null = null;

$effect(() => {
  if (open && overlayEl) {
    return portalToBody(overlayEl);
  }
});

let displayName = $derived(providerConfig?.displayName ?? 'Mail');
let domains = $derived(
  providerConfig?.multiDomain?.enabled && Array.isArray(providerConfig.multiDomain.domains)
    ? providerConfig.multiDomain.domains.filter(Boolean)
    : ([] as string[])
);
let defaultDomainHint = $derived(domains[0] ?? providerConfig?.multiDomain?.domains?.[0] ?? '');
let supportsCustomEmail = $derived(providerConfig?.customEmail?.supported ?? true);
let activeDomain = $derived(selectedDomain || defaultDomainHint || 'domain.com');

// Reset dialog state when opened
$effect(() => {
  if (open) {
    inboxType = 'random';
    customUsername = '';
    validationError = '';
    selectedDomain = domains[0] ?? '';
  }
});

let previousActiveElement = $state<HTMLElement | null>(null);

// Setup focus trap when dialog opens
$effect(() => {
  let prevOverflow = '';
  if (open) {
    previousActiveElement = document.activeElement as HTMLElement;
    prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    void tick().then(() => {
      if (dialogRef) {
        cleanupFocusTrap = setupFocusTrap(dialogRef);
      }
    });
  }
  return () => {
    if (cleanupFocusTrap) {
      cleanupFocusTrap();
      cleanupFocusTrap = null;
    }
    if (prevOverflow !== '') {
      document.body.style.overflow = prevOverflow;
    }
    if (previousActiveElement) {
      previousActiveElement.focus();
      previousActiveElement = null;
    }
  };
});

function handleCreate() {
  validationError = '';
  if (inboxType === 'random') {
    onCreate('random', undefined, activeDomain || undefined);
  } else {
    const trimmed = customUsername.trim();
    if (trimmed) {
      try {
        validateUsername(trimmed);
        onCreate('custom', trimmed, activeDomain || undefined);
      } catch (error) {
        validationError = getErrorMessage(error);
      }
    }
  }
}

function handleClose() {
  inboxType = 'random';
  customUsername = '';
  validationError = '';
  onClose();
}
</script>

{#if open}
  <div
    bind:this={overlayEl}
    class="fixed inset-0 z-[10000] flex items-center justify-center p-3"
    role="dialog"
    aria-modal="true"
  >
     <div
      class="absolute inset-0 bg-md-scrim/30 backdrop-blur-sm"
      role="button"
      tabindex="-1"
      onclick={(e) => { e.stopPropagation(); handleClose(); }}
      onkeydown={(e) => e.key === 'Escape' && handleClose()}
    ></div>

    <!-- Icon-only close — not a labelled action, stays as raw button -->
    <button
      class="absolute top-4 end-4 z-10 w-9 h-9 rounded-full bg-md-surface-container hover:bg-md-surface-variant flex items-center justify-center shadow-md transition-colors"
      aria-label="Close dialog"
      onclick={(e) => { e.stopPropagation(); handleClose(); }}
    >
      <Icon name="x" class="w-4 h-4 text-md-on-surface/70" />
    </button>

    <div
      class="dialog-enter relative bg-md-surface-container rounded-xl px-4 py-3 w-full max-w-[350px] max-h-[90vh] overflow-y-auto shadow-2xl border border-md-outline-variant/30"
      tabindex="-1"
      bind:this={dialogRef}
    >
      <div>
        <h3 class="font-bold text-sm mb-1">{$t('inbox.createNewInbox')}</h3>
      </div>

      <div class="flex flex-col gap-3">
        <label class="flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors {inboxType === 'random' ? 'border-md-primary bg-md-primary/5' : 'border-md-outline-variant hover:border-md-secondary-container/20'}">
          <input
            type="radio"
            bind:group={inboxType}
            value="random"
            class="radio radio-sm shrink-0"
            aria-label={$t('inbox.randomEmailAria')}
          />
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-md-on-surface">{$t('inbox.randomEmail', { values: { provider: displayName } })}</p>
            <p class="text-xs text-md-on-surface/50">{$t('inbox.randomEmailHint')}</p>
          </div>
        </label>

        {#if supportsCustomEmail}
        <div
          role="presentation"
          class="flex flex-col gap-2 p-3 rounded-xl border-2 cursor-pointer transition-colors {inboxType === 'custom' ? 'border-md-primary bg-md-primary/5' : 'border-md-outline-variant hover:border-md-secondary-container/20'}"
          onclick={() => { inboxType = 'custom'; }}
          onkeydown={(e) => { if (e.key === ' ' || e.key === 'Enter') inboxType = 'custom'; }}
        >
          <div class="flex items-center gap-3">
            <input
              type="radio"
              bind:group={inboxType}
              value="custom"
              class="radio radio-sm shrink-0"
              aria-label={$t('inbox.customEmail')}
            />
            <span class="text-sm font-semibold text-md-on-surface">{$t('inbox.customEmail')}</span>
          </div>
          {#if inboxType === 'custom'}
            <div
              role="none"
              class="flex items-stretch gap-1.5 ms-0 sm:ms-7 min-w-0"
              onclick={(e) => e.stopPropagation()}
              onkeydown={(e) => e.stopPropagation()}
            >
              <input
                type="text"
                class="flex-1 min-w-0 px-2 py-1.5 text-sm rounded-xl border border-md-outline-variant bg-md-surface-container-low outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary"
                placeholder={$t('inbox.customUsernamePlaceholder')}
                aria-label={$t('inbox.customEmail')}
                bind:value={customUsername}
                oninput={() => validationError = ''}
                onkeydown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                  else if (e.key === 'Escape') handleClose();
                }}
              />
              <span class="text-xs text-md-on-surface/50 self-center shrink-0">@</span>
              {#if domains.length > 1}
                <select
                  class="max-w-[42%] min-w-0 px-1.5 py-1.5 text-label-sm rounded-xl border border-md-outline-variant bg-md-surface-container-low text-md-on-surface outline-none focus:border-md-primary truncate"
                  bind:value={selectedDomain}
                  aria-label={$t('inbox.emailDomain')}
                  onclick={(e) => e.stopPropagation()}
                >
                  {#each domains as d (d)}
                    <option value={d}>{d}</option>
                  {/each}
                </select>
              {:else}
                <span
                  class="text-label-sm text-md-on-surface/60 self-center max-w-[42%] truncate"
                  title={activeDomain}
                >{activeDomain}</span>
              {/if}
            </div>
            {#if domains.length > 1}
              <p class="text-xs text-md-on-surface/40 ms-0 sm:ms-7">
                {$t('inbox.chooseDomainHint')}
              </p>
            {/if}
            {#if validationError}
              <p class="text-xs text-md-error ms-0 sm:ms-7">{validationError}</p>
            {:else}
              <p class="text-xs text-md-on-surface/40 ms-0 sm:ms-7">{$t('inbox.customUsernameRules')}</p>
            {/if}
          {/if}
        </div>
        {/if}

        <!-- Domain for random too when multi-domain -->
        {#if domains.length > 1 && inboxType === 'random'}
          <div class="px-1">
            <label class="text-label-sm font-medium text-md-on-surface/60 mb-1 block" for="create-domain-random">Preferred domain</label>
            <select
              id="create-domain-random"
              class="w-full px-2 py-1.5 text-xs rounded-xl border border-md-outline-variant bg-md-surface-container-low text-md-on-surface outline-none focus:border-md-primary"
              bind:value={selectedDomain}
            >
              {#each domains as d (d)}
                <option value={d}>{d}</option>
              {/each}
            </select>
          </div>
        {/if}
      </div>

      <div class="flex gap-2 pt-3">
        <Btn
          variant="secondary"
          size="sm"
          class="flex-1"
          aria-label={$t('inbox.createInboxCancelAria')}
          onclick={handleClose}
        >
          {$t('common.cancel')}
        </Btn>
        <Btn
          variant="primary"
          size="sm"
          class="flex-1"
          aria-label={$t('inbox.createInboxConfirmAria')}
          onclick={handleCreate}
          disabled={inboxType === 'custom' && !customUsername.trim()}
        >
          {$t('common.create')}
        </Btn>
      </div>
    </div>
  </div>
{/if}
