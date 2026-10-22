<script lang="ts">
import { tick } from 'svelte';
import { t } from 'svelte-i18n';
import Icon from '@/ui/components/icons/Icon.svelte';
import IconButton from '@/ui/components/primitives/IconButton.svelte';
import InputField from '@/ui/components/primitives/InputField.svelte';
import { subscribeBottomSheetPreference } from '@/utils/ui/bottom-sheet-preference.js';
import { beginDialogLifecycle } from '@/utils/ui/dialog-lifecycle.js';
import { ELEVATION } from '@/utils/ui/elevation.js';
import { PORTAL_Z_CLASS, portalToBody } from '@/utils/ui/portal-layers.js';
import { responsiveButtonLayout } from '@/utils/ui/responsive-button-layout.js';

let {
  isOpen = false,
  /**
   * 'setup'  = enabling protection (new password only)
   * 'change' = re-key / reset from a password vault (current + new)
   * 'switch' = replace biometrics/PIN protection with a password (new only)
   * 'rotate' = manual key rotation (current password / biometric prompt only)
   */
  mode = 'setup',
  /** Current vault protection mode - drives the 'rotate' form/verify UI. */
  vaultMode = 'standard',
  /** Pre-flight count from SettingsView (rotate only). */
  preflight = null,
  onClose = () => {},
  onSave = async (_payload: { currentPassword?: string; newPassword: string }) => true,
  onVerify = async (_password: string) => 'wrong' as const,
}: {
  isOpen?: boolean;
  mode?: 'setup' | 'change' | 'switch' | 'rotate';
  vaultMode?: 'standard' | 'password' | 'biometrics';
  preflight?: { migratable: number; undecryptable: number; checked: boolean } | null;
  onClose?: () => void;
  onSave?: (payload: {
    currentPassword?: string;
    newPassword: string;
  }) => boolean | Promise<boolean>;
  /**
   * Fresh-lock verification step ('change'/'switch'/'rotate'): the vault was
   * locked to simulate a restart; the user must re-enter the NEW password
   * (or confirm via a biometric prompt for a biometrics rotation).
   * 'ok' closes the modal, 'wrong'/'locked-out' keep it open for a retry.
   */
  onVerify?: (
    password: string
  ) => 'ok' | 'wrong' | 'locked-out' | Promise<'ok' | 'wrong' | 'locked-out'>;
} = $props();

let phase = $state<'form' | 'verify'>('form');
// Rotation of a biometrics vault needs no typed password anywhere.
let biometricRotate = $derived(mode === 'rotate' && vaultMode === 'biometrics');
let password = $state('');
let confirmPassword = $state('');
let currentPassword = $state('');
let verifyPassword = $state('');
let error = $state('');

let dialogRef = $state<HTMLElement | null>(null);
let overlayEl = $state<HTMLElement | null>(null);
let dialogLifecycle = $state<ReturnType<typeof beginDialogLifecycle> | null>(null);
let useBottomSheet = $state(false);

$effect(() =>
  subscribeBottomSheetPreference((value) => {
    useBottomSheet = value;
  })
);

$effect(() => {
  if (isOpen && overlayEl) {
    return portalToBody(overlayEl);
  }
});
// Handle Escape key globally when dialog is open
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && isOpen) {
    e.stopPropagation();
    onClose();
  }
}

$effect(() => {
  if (isOpen) {
    const lifecycle = beginDialogLifecycle({ lockBodyScroll: false });
    dialogLifecycle = lifecycle;
    window.addEventListener('keydown', handleKeydown);

    void tick().then(() => lifecycle.attach(dialogRef));
  }
  return () => {
    window.removeEventListener('keydown', handleKeydown);
    dialogLifecycle?.cleanup();
    dialogLifecycle = null;
  };
});
async function handleSubmit() {
  error = '';

  // ── Verify phase: prove the fresh lock unlocks with the new credential ──
  if (phase === 'verify') {
    // A biometrics rotation proves via the biometric prompt - no typed field.
    const result = biometricRotate ? await onVerify('') : await onVerify(verifyPassword);
    if (result !== 'ok') {
      // Stay open - retry, or cancel (the parent rolls the change back).
      error = $t(
        result === 'locked-out'
          ? 'preferences.masterPasswordLockedOut'
          : 'settings.masterPasswordVerifyFailed'
      );
      return;
    }
    verifyPassword = '';
    onClose();
    return;
  }

  // ── Form phase ───────────────────────────────────────────────────────────
  if (mode === 'change' || (mode === 'rotate' && vaultMode === 'password')) {
    if (!currentPassword) {
      error = $t('settings.masterPasswordCurrentRequired');
      return;
    }
  }
  if (mode !== 'rotate') {
    if (!password || password.length < 6) {
      error = $t('settings.masterPasswordTooShort');
      return;
    }
    if (password !== confirmPassword) {
      error = $t('settings.masterPasswordMismatch');
      return;
    }
  }
  const payload =
    mode === 'change' || (mode === 'rotate' && vaultMode === 'password')
      ? { currentPassword, newPassword: password }
      : { newPassword: password };
  const ok = await onSave(payload);
  if (mode === 'change' || mode === 'switch' || mode === 'rotate') {
    if (ok) {
      // Re-key applied with a rollback stash - now the fresh-lock proof.
      phase = 'verify';
      password = '';
      confirmPassword = '';
      currentPassword = '';
    } else {
      error = $t('preferences.masterPasswordFailed');
    }
    return;
  }
  // setup: close regardless; the parent surfaces success/failure.
  password = '';
  confirmPassword = '';
  onClose();
}
</script>

{#if isOpen}
  <div
    bind:this={overlayEl}
    class="dialog-viewport-inset fixed inset-0 bg-md-scrim-modal backdrop-blur-sm {PORTAL_Z_CLASS.dialog} flex {useBottomSheet ? 'items-end' : 'items-center'} justify-center p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="master-password-modal-title"
    aria-describedby="master-password-modal-description"
    data-activity-dialog-key="dialog:masterPassword"
  >
    <!-- Backdrop (mouse-only dismiss; Escape handled globally above) -->
    <div
      class="fixed inset-0 -z-10 cursor-default"
      aria-hidden="true"
      onclick={(e) => { e.stopPropagation(); onClose(); }}
    ></div>
    <div
      class="dialog-padding dialog-content-stack scroll-body bg-md-surface-container border border-md-outline-variant/60 {useBottomSheet ? 'rounded-t-2xl max-w-full' : 'rounded-2xl max-w-sm'} w-full max-h-[90dvh] overflow-y-auto {ELEVATION.level3} relative"
      bind:this={dialogRef}
      tabindex="-1"
    >
      <div class="dialog-header">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-full bg-md-primary-container flex items-center justify-center text-md-on-primary-container shrink-0">
            <Icon name="shield" class="w-6 h-6" />
          </div>
          <h2 id="master-password-modal-title" class="dialog-heading min-w-0 flex-1 break-words">
            {phase === 'verify'
              ? biometricRotate
                ? $t('settings.masterPasswordVerifyBiometricTitle')
                : $t('settings.masterPasswordVerifyTitle')
              : mode === 'setup'
                ? $t('settings.setMasterPassword')
                : mode === 'change'
                  ? $t('settings.masterPasswordChangeTitle')
                  : mode === 'switch'
                    ? $t('settings.masterPasswordSwitchTitle')
                    : $t('settings.masterPasswordRotateTitle')}
          </h2>
          <IconButton
            icon="close"
            size="sm"
            ariaLabel={$t('common.close')}
            title={$t('common.close')}
            onclick={onClose}
          />
        </div>
        <p id="master-password-modal-description" class="dialog-description">
            {phase === 'verify'
              ? biometricRotate
                ? $t('settings.masterPasswordVerifyBiometricSubtitle')
                : $t('settings.masterPasswordVerifySubtitle')
              : mode === 'setup'
                ? $t('settings.masterPasswordSubtitle')
                : mode === 'change'
                  ? $t('settings.masterPasswordChangeSubtitle')
                  : mode === 'switch'
                    ? $t('settings.masterPasswordSwitchSubtitle')
                    : $t('settings.masterPasswordRotateSubtitle')}
        </p>
      </div>

      {#if error}
        <div class="p-2.5 rounded-lg bg-md-error-container/40 border border-md-error/30 text-xs text-md-error flex items-center gap-2">
          <Icon name="info" class="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      {/if}

      <div class="space-y-3">
        {#if phase === 'verify'}
          {#if !biometricRotate}
            <div>
              <label for="input-verify-master-password" class="block text-xs font-medium text-md-on-surface/80 mb-1">{$t('settings.masterPasswordVerifyPlaceholder')}</label>
              <InputField
                id="input-verify-master-password"
                type="password"
                bind:value={verifyPassword}
                placeholder={$t('settings.masterPasswordVerifyPlaceholder')}
                showToggle
                size="sm"
              />
            </div>
          {/if}
        {:else}
          {#if mode === 'rotate' && preflight}
            <div class="p-2.5 rounded-lg bg-md-primary/10 border border-md-primary/30 text-xs text-md-on-surface flex items-start gap-2">
              <Icon name="shield" class="w-4 h-4 shrink-0 text-md-primary mt-0.5" />
              <span class="space-y-1 block">
                <span class="block">
                  {preflight.checked
                    ? $t('preferences.masterPasswordRotatePreflight', { values: { count: preflight.migratable } })
                    : $t('preferences.masterPasswordRotatePreflightLocked', { values: { count: preflight.migratable } })}
                </span>
                {#if preflight.undecryptable > 0}
                  <span class="block text-md-error">
                    {$t('preferences.masterPasswordRotateUndecryptable', { values: { count: preflight.undecryptable } })}
                  </span>
                {/if}
              </span>
            </div>
          {/if}

          {#if mode === 'change' || (mode === 'rotate' && vaultMode === 'password')}
            <div>
              <label for="input-current-master-password" class="block text-xs font-medium text-md-on-surface/80 mb-1">{$t('settings.masterPasswordCurrentPlaceholder')}</label>
              <InputField
                id="input-current-master-password"
                type="password"
                bind:value={currentPassword}
                placeholder={$t('settings.masterPasswordCurrentEnterPlaceholder')}
                showToggle
                size="sm"
              />
            </div>
          {/if}

          {#if mode !== 'rotate'}
            <div>
              <label for="input-master-password" class="block text-xs font-medium text-md-on-surface/80 mb-1">{$t('settings.masterPasswordPlaceholder')}</label>
              <InputField
                id="input-master-password"
                type="password"
                bind:value={password}
                placeholder={$t('settings.masterPasswordEnterPlaceholder')}
                showToggle
                size="sm"
              />
            </div>

            <div>
              <label for="input-confirm-master-password" class="block text-xs font-medium text-md-on-surface/80 mb-1">{$t('settings.confirmMasterPassword')}</label>
              <InputField
                id="input-confirm-master-password"
                type="password"
                bind:value={confirmPassword}
                placeholder={$t('settings.masterPasswordConfirmPlaceholder')}
                size="sm"
              />
            </div>
          {/if}
        {/if}
      </div>

      <div class="w-full flex flex-nowrap items-center gap-2 pt-2" use:responsiveButtonLayout data-action-tier="S">
        <button
          type="button"
          class="md-action flex-1 min-w-0 h-10 px-2.5 rounded-xl bg-transparent text-md-on-surface transition-colors inline-flex items-center justify-center gap-1.5 font-bold tracking-wide whitespace-nowrap overflow-visible"
          onclick={onClose}
        >
          <span class="btn-label leading-tight self-center whitespace-nowrap overflow-visible">{$t('common.cancel')}</span>
        </button>
        <button
          type="button"
          class="md-action flex-1 min-w-0 h-10 px-2.5 rounded-xl bg-md-primary text-md-on-primary transition-colors inline-flex items-center justify-center gap-1.5 font-bold tracking-wide whitespace-nowrap overflow-visible"
          onclick={handleSubmit}
        >
          <span class="btn-label leading-tight self-center whitespace-nowrap overflow-visible">
            {phase === 'verify'
              ? biometricRotate
                ? $t('settings.masterPasswordVerifyBiometricButton')
                : $t('settings.masterPasswordVerifyButton')
              : mode === 'rotate'
                ? $t('settings.masterPasswordRotateButton')
                : $t('settings.masterPasswordSave')}
          </span>
        </button>
      </div>
    </div>
  </div>
{/if}
