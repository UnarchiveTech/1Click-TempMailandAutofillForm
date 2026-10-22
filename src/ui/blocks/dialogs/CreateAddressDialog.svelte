<script lang="ts">
import { t } from 'svelte-i18n';
import ModalDialog from '@/ui/components/composites/ModalDialog.svelte';
import { Radio } from '@/ui/components/primitives';
import Dropdown from '@/ui/components/primitives/Dropdown.svelte';
import type { ProviderConfig } from '@/utils/email/email-service.js';
import { localizedErrorMessageOrFallback } from '@/utils/errors.js';
import { PORTAL_Z } from '@/utils/ui/portal-layers.js';
import { responsiveButtonLayout } from '@/utils/ui/responsive-button-layout.js';
import { controlSurface } from '@/utils/ui/row-surface.js';
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
        // `validateUsername` attaches a stable errors.* key per rule, so the
        // specific reason (length / charset) renders localized; anything else
        // falls back to the generic validation message rather than English.
        validationError = localizedErrorMessageOrFallback(error, $t, 'errors.validationError');
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

<ModalDialog
  {open}
  activityDialogKey="dialog:createAddress"
  title={$t('inbox.createNewAddress')}
  maxWidth="xs"
  onClose={handleClose}
  bind:dialogRef
>
  <div class="dialog-content-stack">
    <label class="flex items-center gap-3 p-3 rounded-xl border-2 border-md-outline-variant bg-md-surface-container-low cursor-pointer {controlSurface(inboxType === 'random', 'border')}">
      <Radio
        size="sm"
        checked={inboxType === 'random'}
        ariaLabel={$t('inbox.randomEmailAria')}
        onchange={() => {
          inboxType = 'random';
        }}
      />
      <div class="flex-1 min-w-0">
        <p class="text-sm font-semibold text-md-on-surface">{$t('inbox.randomEmail', { values: { provider: displayName } })}</p>
        <p class="text-xs text-md-on-surface-variant">{$t('inbox.randomEmailHint')}</p>
      </div>
    </label>

    {#if supportsCustomEmail}
    <div
      role="none"
      class="flex flex-col gap-2 p-3 rounded-xl border-2 border-md-outline-variant bg-md-surface-container-low cursor-pointer {controlSurface(inboxType === 'custom', 'border')}"
      onclick={() => { inboxType = 'custom'; }}
      onkeydown={(e) => { if (e.key === ' ' || e.key === 'Enter') inboxType = 'custom'; }}
    >
      <div class="flex items-center gap-3">
        <Radio
          size="sm"
          checked={inboxType === 'custom'}
          ariaLabel={$t('inbox.customEmail')}
          onchange={() => {
            inboxType = 'custom';
          }}
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
              if (e.key === 'Enter' && customUsername.trim()) handleCreate();
              else if (e.key === 'Escape') handleClose();
            }}
          />
          <span class="text-xs text-md-on-surface/50 self-center shrink-0">@</span>
          {#if domains.length > 1}
            <Dropdown
              class="max-w-[42%] min-w-0"
              size="xs"
              variant="outlined"
              zIndex={PORTAL_Z.dialogMenu}
              ariaLabel={$t('inbox.emailDomain')}
              bind:value={selectedDomain}
              options={domains.map((d) => ({ value: d, label: d }))}
            />
          {:else}
            <span
              class="text-xs text-md-on-surface-variant self-center max-w-[42%] truncate"
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

    {#if domains.length > 1 && inboxType === 'random'}
      <div class="dialog-field">
        <label class="text-sm font-medium text-md-on-surface-variant" for="create-domain-random">{$t('disposable.preferredDomain')}</label>
        <Dropdown
          id="create-domain-random"
          size="xs"
          variant="outlined"
          zIndex={PORTAL_Z.dialogMenu}
          ariaLabel={$t('inbox.emailDomain')}
          bind:value={selectedDomain}
          options={domains.map((d) => ({ value: d, label: d }))}
        />
      </div>
    {/if}
  </div>

  {#snippet footer()}
    <div class="w-full flex flex-nowrap items-center gap-2" use:responsiveButtonLayout data-action-tier="S">
      <button
        type="button"
        class="md-action flex-1 min-w-0 h-10 px-2.5 rounded-xl bg-md-secondary text-md-on-secondary transition-colors inline-flex items-center justify-center gap-1.5 font-bold tracking-wide whitespace-nowrap overflow-visible disabled:opacity-50 disabled:pointer-events-none"
        aria-label={$t('inbox.createAddressCancelAria')}
        onclick={handleClose}
      >
        <span class="btn-label leading-tight self-center whitespace-nowrap overflow-visible">{$t('common.cancel')}</span>
      </button>
      <button
        type="button"
        class="md-action flex-1 min-w-0 h-10 px-2.5 rounded-xl bg-md-primary text-md-on-primary transition-colors inline-flex items-center justify-center gap-1.5 font-bold tracking-wide whitespace-nowrap overflow-visible disabled:opacity-50 disabled:pointer-events-none"
        aria-label={$t('inbox.createAddressConfirmAria')}
        onclick={handleCreate}
        disabled={inboxType === 'custom' && !customUsername.trim()}
      >
        <span class="btn-label leading-tight self-center whitespace-nowrap overflow-visible">{$t('common.create')}</span>
      </button>
    </div>
  {/snippet}
</ModalDialog>
