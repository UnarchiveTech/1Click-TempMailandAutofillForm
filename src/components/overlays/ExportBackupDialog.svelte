<script lang="ts">
import { tick } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import Icon from '@/components/icons/Icon.svelte';
import Btn from '@/components/ui/primitives/Btn.svelte';
import {
  ALL_BACKUP_CATEGORIES,
  type BackupCategory,
  type BackupInspection,
  exportBackup,
  inspectLocalForExport,
} from '@/features/settings/backup-actions.js';
import { setupFocusTrap } from '@/utils/focusTrap.js';
import { logError } from '@/utils/logger.js';
import { portalToBody } from '@/utils/portal-layers.js';
import { isVaultLocked } from '@/utils/vault-lock.js';

let {
  open = false,
  onClose = () => {},
  onSuccess = (_msg?: string) => {},
  onError = (_msg: string) => {},
} = $props<{
  open?: boolean;
  onClose?: () => void;
  onSuccess?: (message?: string) => void;
  onError?: (message: string) => void;
}>();

const CATEGORY_META: { id: BackupCategory; icon: string }[] = [
  { id: 'settings', icon: 'settings' },
  { id: 'identities', icon: 'user' },
  { id: 'savedLogins', icon: 'lock' },
  { id: 'inboxes', icon: 'mail' },
  { id: 'filters', icon: 'filter' },
];

let selected = $state<Record<BackupCategory, boolean>>({
  settings: true,
  identities: true,
  savedLogins: true,
  inboxes: true,
  filters: true,
});
let excludeSecrets = $state(false);
let usePassword = $state(false);
let password = $state('');
let passwordConfirm = $state('');
let passwordError = $state('');
let vaultLocked = $state(false);
let preview = $state<BackupInspection | null>(null);
let isProcessing = $state(false);
let isDone = $state(false);
let dialogRef = $state<HTMLElement | null>(null);
let overlayEl = $state<HTMLElement | null>(null);
let cleanupFocusTrap: (() => void) | null = null;
let previousActiveElement: HTMLElement | null = null;

$effect(() => {
  if (open && overlayEl) {
    return portalToBody(overlayEl);
  }
});

let selectedCategories = $derived(ALL_BACKUP_CATEGORIES.filter((c) => selected[c]));
let canExport = $derived(selectedCategories.length > 0 && !isProcessing);
let secretsWarning = $derived(!excludeSecrets && (selected.savedLogins || selected.identities));

function resetState() {
  selected = {
    settings: true,
    identities: true,
    savedLogins: true,
    inboxes: true,
    filters: true,
  };
  excludeSecrets = false;
  usePassword = false;
  password = '';
  passwordConfirm = '';
  passwordError = '';
  vaultLocked = false;
  preview = null;
  isProcessing = false;
  isDone = false;
}

function selectAll() {
  for (const c of ALL_BACKUP_CATEGORIES) selected[c] = true;
  selected = { ...selected };
  void refreshPreview();
}

function clearAll() {
  for (const c of ALL_BACKUP_CATEGORIES) selected[c] = false;
  selected = { ...selected };
  preview = null;
}

function toggle(cat: BackupCategory) {
  selected[cat] = !selected[cat];
  selected = { ...selected };
  void refreshPreview();
}

async function refreshPreview() {
  const cats = ALL_BACKUP_CATEGORIES.filter((c) => selected[c]);
  if (!cats.length) {
    preview = null;
    return;
  }
  try {
    preview = await inspectLocalForExport(browser, cats);
  } catch (e) {
    logError('export preview failed', e);
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && open && !isProcessing) {
    e.stopPropagation();
    onClose();
  }
}

$effect(() => {
  if (open) {
    resetState();
    previousActiveElement = document.activeElement as HTMLElement;
    window.addEventListener('keydown', handleKeydown);
    document.body.style.overflow = 'hidden';
    let active = true;
    void (async () => {
      const locked = await isVaultLocked();
      if (!active) return;
      vaultLocked = locked;
      await refreshPreview();
    })();
    void tick().then(() => {
      if (dialogRef) cleanupFocusTrap = setupFocusTrap(dialogRef);
    });
    return () => {
      active = false;
      window.removeEventListener('keydown', handleKeydown);
      document.body.style.overflow = '';
      if (cleanupFocusTrap) {
        cleanupFocusTrap();
        cleanupFocusTrap = null;
      }
      if (previousActiveElement) {
        previousActiveElement.focus();
        previousActiveElement = null;
      }
    };
  }
});

function validatePassword(): boolean {
  passwordError = '';
  if (!usePassword) return true;
  if (password.length < 4) {
    passwordError = $t('preferences.passwordTooShort');
    return false;
  }
  if (password !== passwordConfirm) {
    passwordError = $t('preferences.passwordsDoNotMatch');
    return false;
  }
  return true;
}

async function handleExport() {
  if (!canExport) {
    onError($t('backup.selectAtLeastOne'));
    return;
  }
  if (!validatePassword()) return;
  if (vaultLocked && !excludeSecrets && (selected.savedLogins || selected.identities)) {
    onError($t('backup.vaultLockedWarning'));
    return;
  }
  isProcessing = true;
  try {
    await exportBackup(browser, {
      categories: selectedCategories,
      excludeSecrets,
      password: usePassword ? password : undefined,
    });
    isDone = true;
    onSuccess($t('toasts.dataExportedSuccessfully'));
    setTimeout(() => onClose(), 1600);
  } catch (e) {
    logError('Export backup failed', e);
    isProcessing = false;
    onError(e instanceof Error ? e.message : String(e));
  }
}
</script>

{#if open}
  <div
    bind:this={overlayEl}
    class="fixed inset-0 z-[10000] flex items-center justify-center p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="export-backup-title"
  >
    <div
      class="absolute inset-0 bg-md-scrim/30 backdrop-blur-sm"
      role="button"
      tabindex="-1"
      aria-label={$t('common.close')}
      onclick={(e) => {
        e.stopPropagation();
        if (!isProcessing) onClose();
      }}
      onkeydown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !isProcessing) onClose();
      }}
    ></div>

    <div
      class="dialog-enter relative w-full max-w-sm max-h-[90vh] flex flex-col bg-md-surface-container/95 backdrop-blur-xl border border-md-outline-variant/30 rounded-2xl shadow-2xl text-md-on-surface z-10 overflow-hidden"
      bind:this={dialogRef}
      tabindex="-1"
    >
      <!-- Header -->
      <div class="flex items-center justify-between border-b border-md-outline-variant/20 px-5 pt-5 pb-3 shrink-0">
        <div class="flex items-center gap-2.5">
          <div class="w-9 h-9 rounded-xl bg-md-primary/10 flex items-center justify-center text-md-primary">
            <Icon name="download" class="w-5 h-5" />
          </div>
          <div>
            <h2 id="export-backup-title" class="text-sm font-bold tracking-tight">
              {$t('backup.exportTitle')}
            </h2>
            <p class="text-xs text-md-on-surface/50">{$t('backup.exportSubtitle')}</p>
          </div>
        </div>
        {#if !isProcessing}
          <button
            class="w-7 h-7 flex items-center justify-center rounded-full hover:bg-md-surface-variant/50"
            onclick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            aria-label={$t('common.close')}
          >
            <Icon name="x" class="w-4 h-4 text-md-on-surface/60" />
          </button>
        {/if}
      </div>

      <!-- Body (scroll) -->
      <div class="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {#if isDone}
          <div class="py-8 flex flex-col items-center gap-2 text-center">
            <div class="w-12 h-12 rounded-full bg-md-primary/15 text-md-primary flex items-center justify-center">
              <Icon name="checkCircle" class="w-7 h-7" />
            </div>
            <h3 class="text-sm font-bold">{$t('backup.exportComplete')}</h3>
            <p class="text-xs text-md-on-surface/60">{$t('backup.exportCompleteHint')}</p>
          </div>
        {:else}
          <p class="text-xs text-md-on-surface/70">{$t('backup.chooseWhatToExport')}</p>

          <div class="flex gap-2">
            <Btn
              variant="outline"
              size="sm"
              onclick={() => { selectAll(); }}
            >{$t('backup.selectAll')}</Btn>
            <Btn
              variant="outline"
              size="sm"
              onclick={() => { clearAll(); }}
            >{$t('backup.clearAll')}</Btn>
          </div>

          <div class="flex flex-col gap-1.5">
            {#each CATEGORY_META as cat (cat.id)}
              <label
                class="flex items-center gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-all {selected[
                  cat.id
                ]
                  ? 'border-md-primary bg-md-primary/10'
                  : 'border-md-outline-variant/20 bg-md-surface-container-low/50 hover:bg-md-surface-variant/30'}"
              >
                <input
                  type="checkbox"
                  class="rounded border-md-outline-variant text-md-primary focus:ring-md-primary shrink-0"
                  checked={selected[cat.id]}
                  onchange={() => toggle(cat.id)}
                  disabled={isProcessing}
                />
                <Icon name={cat.icon} class="w-4 h-4 text-md-primary/80 shrink-0" />
                <div class="flex-1 min-w-0">
                  <div class="text-xs font-bold leading-tight">{$t(`backup.category.${cat.id}`)}</div>
                  <div class="text-xs text-md-on-surface/50 truncate">
                    {$t(`backup.category.${cat.id}Hint`)}
                  </div>
                </div>
                {#if preview}
                  <span class="text-xs font-mono text-md-on-surface/45 shrink-0">
                    {#if cat.id === 'identities'}{preview.counts.identities}
                    {:else if cat.id === 'savedLogins'}{preview.counts.savedLogins}
                    {:else if cat.id === 'inboxes'}{preview.counts.inboxesTotal}
                    {:else if cat.id === 'filters'}{preview.counts.filters}
                    {:else}·{/if}
                  </span>
                {/if}
              </label>
            {/each}
          </div>

          {#if preview && selectedCategories.length > 0}
            <div class="rounded-xl bg-md-surface-variant/30 border border-md-outline-variant/20 px-3 py-2 text-xs text-md-on-surface/70 leading-relaxed">
              <div class="font-semibold text-md-on-surface/85 mb-0.5">{$t('backup.exportPreviewTitle')}</div>
              {$t('backup.exportPreviewBody', {
                values: {
                  identities: selected.identities ? preview.counts.identities : 0,
                  logins: selected.savedLogins ? preview.counts.savedLogins : 0,
                  inboxes: selected.inboxes ? preview.counts.inboxesTotal : 0,
                  expired: selected.inboxes ? preview.counts.inboxesExpired : 0,
                  filters: selected.filters ? preview.counts.filters : 0,
                },
              })}
            </div>
          {/if}

          <label class="flex items-start gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              class="mt-0.5 rounded border-md-outline-variant text-md-primary"
              bind:checked={excludeSecrets}
              disabled={isProcessing}
            />
            <span>
              <span class="font-semibold">{$t('backup.excludeSecrets')}</span>
              <span class="block text-xs text-md-on-surface/50">{$t('backup.excludeSecretsHint')}</span>
            </span>
          </label>

          {#if secretsWarning}
            <p class="text-xs text-md-warning leading-snug flex gap-1.5">
              <Icon name="warning" class="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {$t('backup.secretsDeviceKeyHint')}
            </p>
          {/if}

          {#if vaultLocked && !excludeSecrets && (selected.savedLogins || selected.identities)}
            <p class="text-xs text-md-error leading-snug">{$t('backup.vaultLockedWarning')}</p>
          {/if}

          <label class="flex items-start gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              class="mt-0.5 rounded border-md-outline-variant text-md-primary"
              bind:checked={usePassword}
              disabled={isProcessing}
            />
            <span>
              <span class="font-semibold">{$t('preferences.encryptBackupPrompt')}</span>
            </span>
          </label>

          {#if usePassword}
            <div class="space-y-2 ps-1">
              <input
                type="password"
                class="w-full px-3 py-2 text-xs rounded-xl border border-md-outline-variant/40 bg-md-surface-container"
                placeholder={$t('preferences.passwordPlaceholder')}
                bind:value={password}
                disabled={isProcessing}
                autocomplete="new-password"
              />
              <input
                type="password"
                class="w-full px-3 py-2 text-xs rounded-xl border border-md-outline-variant/40 bg-md-surface-container"
                placeholder={$t('preferences.confirmPasswordPlaceholder')}
                bind:value={passwordConfirm}
                disabled={isProcessing}
                autocomplete="new-password"
              />
              {#if passwordError}
                <p class="text-label-sm text-md-error">{passwordError}</p>
              {/if}
            </div>
          {/if}
        {/if}
      </div>

      <!-- Sticky footer -->
      {#if !isDone}
        <div class="shrink-0 border-t border-md-outline-variant/20 px-5 py-3 flex gap-2 bg-md-surface-container/95">
          <Btn
            variant="outline"
            size="md"
            class="flex-1"
            disabled={isProcessing}
            onclick={onClose}
          >{$t('common.cancel')}</Btn>
          <Btn
            variant="primary"
            size="md"
            class="flex-1"
            disabled={!canExport}
            busy={isProcessing}
            onclick={() => { void handleExport(); }}
          >
            {isProcessing ? $t('backup.exporting') : $t('backup.exportAction')}
          </Btn>
        </div>
      {/if}
    </div>
  </div>
{/if}
