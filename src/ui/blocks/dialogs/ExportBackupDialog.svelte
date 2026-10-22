<script lang="ts">
import { tick } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import {
  buildWebDAVConfig,
  loadWebDAVSettings,
  uploadExportToWebDAV,
  WEBDAV_BACKUP_FILENAME,
  type WebDAVSettings,
} from '@/features/backup/webdav-sync.js';
import {
  ALL_BACKUP_CATEGORIES,
  BACKUP_CATEGORY_META,
  type BackupCategory,
  type BackupInspection,
  exportBackup,
  inspectLocalForExport,
  MIN_BACKUP_PASSWORD_LENGTH,
} from '@/features/settings/backup-actions.js';
import Icon from '@/ui/components/icons/Icon.svelte';
import { Checkbox, Radio } from '@/ui/components/primitives';
import IconButton from '@/ui/components/primitives/IconButton.svelte';
import { localizedErrorMessageOrFallback, translateResultMessage } from '@/utils/errors.js';
import { logError } from '@/utils/logger.js';
import { isVaultLocked } from '@/utils/storage/vault-lock.js';
import { localDateStamp } from '@/utils/time/time-format.js';
import { subscribeBottomSheetPreference } from '@/utils/ui/bottom-sheet-preference.js';
import { beginDialogLifecycle } from '@/utils/ui/dialog-lifecycle.js';
import { ELEVATION } from '@/utils/ui/elevation.js';
import { PORTAL_Z_CLASS, portalToBody } from '@/utils/ui/portal-layers.js';
import { responsiveButtonLayout } from '@/utils/ui/responsive-button-layout.js';

let {
  open = false,
  onClose = () => {},
  onSuccess = (_msg?: string) => {},
  onError = (_msg: string) => {},
}: {
  open?: boolean;
  onClose?: () => void;
  onSuccess?: (message?: string) => void;
  onError?: (message: string) => void;
} = $props();

let selected = $state<Record<BackupCategory, boolean>>({
  settings: true,
  identities: true,
  savedLogins: true,
  addresses: true,
  filters: true,
  mailboxRules: true,
  siteRules: true,
});
let excludeSecrets = $state(false);
let usePassword = $state(false);
let password = $state('');
let passwordConfirm = $state('');
let passwordError = $state('');
/** True when a plain (unencrypted) download export just succeeded - drives the password-backup nudge. */
let showPasswordNudge = $state(false);
let vaultLocked = $state(false);
let preview = $state<BackupInspection | null>(null);
let isProcessing = $state(false);
let isDone = $state(false);
/** Export destination: download the file, or upload straight to WebDAV. */
let exportDest = $state<'download' | 'webdav'>('download');
let webdavSettings = $state<WebDAVSettings | null>(null);
let dialogRef = $state<HTMLElement | null>(null);
let overlayEl = $state<HTMLElement | null>(null);
let useBottomSheet = $state(false);

$effect(() =>
  subscribeBottomSheetPreference((value) => {
    useBottomSheet = value;
  })
);

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
    addresses: true,
    filters: true,
    mailboxRules: true,
    siteRules: true,
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
  showPasswordNudge = false;
  exportDest = 'download';
  webdavSettings = null;
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
    const lifecycle = beginDialogLifecycle();
    window.addEventListener('keydown', handleKeydown);
    let active = true;
    void (async () => {
      const locked = await isVaultLocked();
      if (!active) return;
      vaultLocked = locked;
      await refreshPreview();
      try {
        const wd = await loadWebDAVSettings();
        if (!active) return;
        webdavSettings = wd;
        if (!wd.url) exportDest = 'download';
      } catch {
        /* ignore */
      }
    })();
    void tick().then(() => lifecycle.attach(dialogRef));
    return () => {
      active = false;
      window.removeEventListener('keydown', handleKeydown);
      lifecycle.cleanup();
    };
  }
});

function validatePassword(): boolean {
  passwordError = '';
  if (!usePassword) return true;
  if (password.length < MIN_BACKUP_PASSWORD_LENGTH) {
    passwordError = $t('errors.backupPasswordTooShort');
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
    if (exportDest === 'webdav' && webdavSettings?.url) {
      const config = await buildWebDAVConfig(webdavSettings);
      const isFull = selectedCategories.length === ALL_BACKUP_CATEGORIES.length;
      const filename = isFull ? WEBDAV_BACKUP_FILENAME : `1click-partial-${localDateStamp()}.json`;
      const res = await uploadExportToWebDAV(
        config,
        { categories: selectedCategories, excludeSecrets },
        usePassword ? password : undefined,
        filename
      );
      if (!res.success) {
        throw new Error(translateResultMessage(res.error, $t) || $t('webdav.uploadFailed'));
      }
      isDone = true;
      onSuccess($t('webdav.uploadSuccess'));
    } else {
      await exportBackup(browser, {
        categories: selectedCategories,
        excludeSecrets,
        password: usePassword ? password : undefined,
      });
      isDone = true;
      // Plain (integrity-hash-only) exports stay readable by anyone with the
      // file - nudge toward password-protected (AES-GCM) exports, but only on
      // downloaded files; WebDAV uploads are typically encrypted at rest.
      showPasswordNudge = exportDest === 'download' && !usePassword;
      onSuccess($t('toasts.dataExportedSuccessfully'));
    }
    setTimeout(() => onClose(), 1600);
  } catch (e) {
    logError('Export backup failed', e);
    isProcessing = false;
    onError(localizedErrorMessageOrFallback(e, $t, 'errors.exportFailed'));
  }
}
</script>

{#if open}
  <div
    bind:this={overlayEl}
    class="dialog-viewport-inset fixed inset-0 {PORTAL_Z_CLASS.dialog} flex {useBottomSheet ? 'items-end' : 'items-center'} justify-center p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="export-backup-title"
    data-activity-dialog-key="dialog:export"
  >
    <!-- Backdrop (mouse-only dismiss, and only while idle; Escape handled globally above) -->
    <div
      class="fixed inset-0 -z-10 cursor-default bg-md-scrim-modal backdrop-blur-sm"
      aria-hidden="true"
      onclick={(e) => {
        e.stopPropagation();
        if (!isProcessing) onClose();
      }}
    ></div>

    <div
      class="dialog-surface scroll-frame dialog-enter relative w-full {useBottomSheet ? 'max-w-full rounded-t-2xl' : 'dialog-layout dialog-block-padding max-w-sm rounded-2xl'} max-h-[90vh] flex flex-col bg-md-surface-container/95 backdrop-blur-xl border border-md-outline-variant/30 {ELEVATION.level3} text-md-on-surface z-10 overflow-hidden"
      bind:this={dialogRef}
      tabindex="-1"
    >
      <!-- Header -->
      <div class="dialog-header dialog-inset scroll-edge shrink-0 {useBottomSheet ? 'dialog-editor-header border-b border-md-outline-variant/20' : ''}">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-4 min-w-0 flex-1">
            <div class="w-9 h-9 shrink-0 rounded-xl bg-md-primary/10 flex items-center justify-center text-md-primary">
              <Icon name="download" class="w-6 h-6" />
            </div>
            <h2 id="export-backup-title" class="dialog-heading min-w-0 break-words">
              {$t('backup.exportTitle')}
            </h2>
          </div>
          {#if !isProcessing}
            <IconButton
              icon="close"
              size="sm"
              ariaLabel={$t('common.close')}
              title={$t('common.close')}
              onclick={onClose}
            />
          {/if}
        </div>
        <p class="dialog-description">{$t('backup.exportSubtitle')}</p>
      </div>

      <!-- Body (scroll) -->
      <div class="dialog-inset scroll-body scroll-body-framed flex-1 min-h-0 overflow-y-auto space-y-3 {useBottomSheet ? 'dialog-body-padding' : ''}">
        {#if isDone}
          <div class="dialog-body-padding flex flex-col items-center gap-2 text-center">
            <div class="w-12 h-12 rounded-full bg-md-primary/15 text-md-primary flex items-center justify-center">
              <Icon name="checkCircle" class="w-7 h-7" />
            </div>
            <h3 class="text-sm font-bold">{$t('backup.exportComplete')}</h3>
            <p class="text-xs text-md-on-surface/60">{$t('backup.exportCompleteHint')}</p>
            {#if showPasswordNudge}
              <p
                class="mt-2 mx-2 px-3 py-2 rounded-xl bg-md-surface-variant/40 border border-md-outline-variant/20 text-xs text-md-on-surface/70 leading-snug flex items-start gap-1.5 text-start"
                role="note"
              >
                <Icon name="lock" class="w-3.5 h-3.5 shrink-0 mt-0.5 text-md-primary" />
                <span>{$t('backup.plainExportHint')}</span>
              </p>
            {/if}
          </div>
        {:else}
          <p class="text-sm font-medium text-md-on-surface">{$t('backup.chooseWhatToExport')}</p>

          <div class="w-full flex flex-nowrap items-center gap-3" use:responsiveButtonLayout data-action-tier="S">
            <button
              type="button"
              class="md-action flex-1 min-w-0 h-10 px-2.5 rounded-xl border border-md-outline text-md-on-surface transition-colors inline-flex items-center justify-center gap-1.5 font-bold tracking-wide whitespace-nowrap overflow-visible"
              onclick={() => { selectAll(); }}
            >
              <span class="btn-label leading-tight self-center whitespace-nowrap overflow-visible">{$t('common.selectAll')}</span>
            </button>
            <button
              type="button"
              class="md-action flex-1 min-w-0 h-10 px-2.5 rounded-xl border border-md-outline text-md-on-surface transition-colors inline-flex items-center justify-center gap-1.5 font-bold tracking-wide whitespace-nowrap overflow-visible"
              onclick={() => { clearAll(); }}
            >
              <span class="btn-label leading-tight self-center whitespace-nowrap overflow-visible">{$t('common.clear')}</span>
            </button>
          </div>

          <div class="flex flex-col gap-1.5">
            {#each ALL_BACKUP_CATEGORIES as category (category)}
              {@const cat = { id: category, ...BACKUP_CATEGORY_META[category] }}
              <label
                class="md-action flex items-center gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-colors {selected[
                  cat.id
                ]
                  ? 'border-md-primary'
                  : 'border-md-outline-variant bg-md-surface-container-low'}"
              >
                <Checkbox
                  class="shrink-0"
                  checked={selected[cat.id]}
                  onchange={() => toggle(cat.id)}
                  disabled={isProcessing}
                />
                <Icon name={cat.icon} class="w-4 h-4 text-md-primary/80 shrink-0" />
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-semibold leading-snug">{$t(`backup.category.${cat.id}`)}</div>
                  <div class="text-xs text-md-on-surface/50 truncate">
                    {$t(`backup.category.${cat.id}Hint`)}
                  </div>
                </div>
                {#if preview}
                  <span class="text-xs font-mono text-md-on-surface/45 shrink-0">
                    {#if cat.id === 'identities'}{preview.counts.identities}
                    {:else if cat.id === 'savedLogins'}{preview.counts.savedLogins}
                    {:else if cat.id === 'addresses'}{preview.counts.addressesTotal}
                    {:else if cat.id === 'filters'}{preview.counts.filters}
                    {:else if cat.id === 'mailboxRules'}{preview.counts.mailboxRules}
                    {:else if cat.id === 'siteRules'}{preview.counts.siteRules}
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
                  // `inboxes` is the name `backup.exportPreviewBody` declares -
                  // `addresses` left the placeholder unfilled in the preview line.
                  inboxes: selected.addresses ? preview.counts.addressesTotal : 0,
                  expired: selected.addresses ? preview.counts.addressesExpired : 0,
                  filters: selected.filters ? preview.counts.filters : 0,
                },
              })}
            </div>
          {/if}

          <label class="flex items-start gap-2 text-sm cursor-pointer">
            <Checkbox class="mt-0.5" bind:checked={excludeSecrets} disabled={isProcessing} />
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

          <label class="flex items-start gap-2 text-sm cursor-pointer">
            <Checkbox class="mt-0.5" bind:checked={usePassword} disabled={isProcessing} />
            <span class="font-semibold">{$t('preferences.encryptBackupPrompt')}</span>
          </label>

          {#if webdavSettings?.url}
            <div class="space-y-1.5">
              <div class="text-sm font-semibold text-md-on-surface">
                {$t('backup.exportDest')}
              </div>
              <label class="flex items-start gap-2 text-sm cursor-pointer">
                <Radio
                  checked={exportDest === 'download'}
                  onchange={() => {
                    exportDest = 'download';
                  }}
                />
                <span>
                  <span class="font-semibold">{$t('backup.destDownload')}</span>
                  <span class="block text-xs text-md-on-surface/50">{$t('backup.destDownloadHint')}</span>
                </span>
              </label>
              <label class="flex items-start gap-2 text-sm cursor-pointer">
                <Radio
                  checked={exportDest === 'webdav'}
                  onchange={() => {
                    exportDest = 'webdav';
                  }}
                />
                <span>
                  <span class="font-semibold">{$t('backup.destWebDAV')}</span>
                  <span class="block text-xs text-md-on-surface/50">
                    {$t('backup.webdavDestHint', { values: { url: webdavSettings.url } })}
                  </span>
                </span>
              </label>
            </div>
          {/if}

          {#if usePassword}
            <div class="space-y-2 ps-1">
              <input
                type="password"
                class="w-full px-3 py-2 text-sm rounded-xl border border-md-outline-variant/40 bg-md-surface-container"
                placeholder={$t('preferences.passwordPlaceholder')}
                bind:value={password}
                disabled={isProcessing}
                autocomplete="new-password"
              />
              <input
                type="password"
                class="w-full px-3 py-2 text-sm rounded-xl border border-md-outline-variant/40 bg-md-surface-container"
                placeholder={$t('preferences.confirmPasswordPlaceholder')}
                bind:value={passwordConfirm}
                disabled={isProcessing}
                autocomplete="new-password"
              />
              {#if passwordError}
                <p class="text-xs text-md-error">{passwordError}</p>
              {/if}
            </div>
          {/if}
        {/if}
      </div>

      <!-- Sticky footer -->
      {#if !isDone}
        <div class="dialog-inset scroll-edge shrink-0 flex flex-nowrap gap-2 {useBottomSheet ? 'dialog-body-padding border-t border-md-outline-variant/20' : 'dialog-actions'}" use:responsiveButtonLayout data-action-tier="S">
          <button
            type="button"
            class="md-action flex-1 min-w-0 h-10 px-2.5 rounded-xl border border-md-outline text-md-on-surface transition-colors inline-flex items-center justify-center gap-1.5 font-bold tracking-wide whitespace-nowrap overflow-visible disabled:opacity-50 disabled:pointer-events-none"
            disabled={isProcessing}
            onclick={onClose}
          >
            <span class="btn-label leading-tight self-center whitespace-nowrap overflow-visible">{$t('common.cancel')}</span>
          </button>
          <button
            type="button"
            class="md-action flex-1 min-w-0 h-10 px-2.5 rounded-xl bg-md-primary text-md-on-primary transition-colors inline-flex items-center justify-center gap-1.5 font-bold tracking-wide whitespace-nowrap overflow-visible disabled:opacity-50 disabled:pointer-events-none"
            disabled={!canExport || isProcessing}
            onclick={() => { void handleExport(); }}
          >
            <span class="btn-label leading-tight self-center whitespace-nowrap overflow-visible">{isProcessing ? $t('backup.exporting') : $t('backup.exportAction')}</span>
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}
