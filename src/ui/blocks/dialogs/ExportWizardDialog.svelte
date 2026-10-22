<script lang="ts">
import { onDestroy } from 'svelte';
import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import ModalDialog from '@/ui/components/composites/ModalDialog.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import Btn from '@/ui/components/primitives/Btn.svelte';
import { logError } from '@/utils/logger.js';
import type { Address, Email } from '@/utils/types.js';
import { responsiveButtonLayout } from '@/utils/ui/responsive-button-layout.js';
import { controlSurface } from '@/utils/ui/row-surface.js';
import { toastStore } from '@/utils/ui/toastStore.js';

let {
  open = false,
  account = null as Address | null,
  messages = [] as Email[],
  onClose = () => {},
  onExecuteExport = async (_format: string) => {},
}: {
  open?: boolean;
  account?: Address | null;
  messages?: Email[];
  onClose?: () => void;
  onExecuteExport?: (format: string) => Promise<void>;
} = $props();

let selectedFormat = $state<'json' | 'eml' | 'mbox' | 'bitwarden-csv' | 'identities-csv'>('json');
let isProcessing = $state(false);
let progressPercent = $state(0);
let isDone = $state(false);
let exportError = $state(false);
let activeTimer: ReturnType<typeof setInterval> | null = null;
// True when the user cancelled a hung export - late promise settlement is ignored.
let cancelled = $state(false);
let dialogRef = $state<HTMLElement | null>(null);

function clearTimer() {
  if (activeTimer) {
    clearInterval(activeTimer);
    activeTimer = null;
  }
}

function resetState() {
  clearTimer();
  cancelled = false;
  selectedFormat = 'json';
  isProcessing = false;
  progressPercent = 0;
  isDone = false;
  exportError = false;
}

onDestroy(clearTimer);

$effect(() => {
  if (open) {
    resetState();
  } else {
    // Dialog unmounted while a fake-progress timer is still ticking (e.g. caller
    // forced close). Clear it so it doesn't leak.
    clearTimer();
  }
});

function handleCancelProcessing() {
  // User aborts a hung export: clear the fake progress, drop processing state
  // and mark cancelled so a late-settling onExecuteExport is ignored.
  cancelled = true;
  clearTimer();
  isProcessing = false;
  progressPercent = 0;
}

function handleStartExport() {
  if (isProcessing) return;
  exportError = false;
  isProcessing = true;
  cancelled = false;
  progressPercent = 10;

  activeTimer = setInterval(() => {
    if (progressPercent < 90) {
      progressPercent += 15;
    }
  }, 100);

  void onExecuteExport(selectedFormat)
    .then(() => {
      if (cancelled) return;
      progressPercent = 100;
      setTimeout(() => {
        if (cancelled) return;
        clearTimer();
        isProcessing = false;
        isDone = true;
      }, 200);
    })
    .catch((e: unknown) => {
      if (cancelled) return;
      clearTimer();
      isProcessing = false;
      progressPercent = 0;
      exportError = true;
      logError('Export failed', undefined, e instanceof Error ? e : undefined);
      toastStore.error(get(t)('toasts.exportFailed'));
    });
}
</script>

<ModalDialog
  {open}
  activityDialogKey="dialog:export"
  title={$t('backup.wizardTitle')}
  subtitle={account ? account.address : $t('backup.exportEmailsAndBackup')}
  maxWidth="sm"
  showCloseButton={true}
  onClose={() => {
    if (isProcessing) {
      handleCancelProcessing();
      onClose();
      return;
    }
    onClose();
  }}
  progress={
    isProcessing
      ? {
          value: progressPercent,
          label: `${$t('backup.generatingFile')} (${selectedFormat.toUpperCase()})`,
          showValue: true,
        }
      : undefined
  }
  bind:dialogRef
>
  {#if isDone}
    <!-- Done State -->
    <div class="dialog-body-padding flex flex-col items-center justify-center gap-2 text-center">
      <div class="w-12 h-12 rounded-full bg-md-primary/15 text-md-primary flex items-center justify-center animate-bounce motion-reduce:animate-none">
        <Icon name="checkCircle" class="w-7 h-7" />
      </div>
      <h3 class="text-sm font-bold text-md-on-surface">{$t('backup.exportComplete')}</h3>
      <p class="text-xs text-md-on-surface/60">{$t('backup.exportCompleteHint')}</p>
    </div>

  {:else if isProcessing}
    <!-- Progress State - fake 10→90% bar capped at 90 until the promise settles;
         intentionally not "real" - there is no incremental progress signal. The bar
         itself renders via ModalDialog's `progress` prop (shared ProgressBar). Cancel
         is available so a never-settling onExecuteExport cannot wedge the dialog. -->
    <div class="flex items-center justify-end pt-1">
      <Btn variant="ghost" size="md" onclick={handleCancelProcessing}>
        {$t('common.cancel')}
      </Btn>
    </div>
  {:else if exportError}
    <!-- Error State -->
    <div class="dialog-body-padding flex flex-col items-center justify-center gap-3 text-center">
      <div class="w-12 h-12 rounded-full bg-md-error/10 text-md-error flex items-center justify-center">
        <Icon name="warning" class="w-7 h-7" />
      </div>
      <h3 class="text-sm font-bold text-md-on-surface">{$t('toasts.exportFailed')}</h3>
      <p class="text-xs text-md-on-surface/60">{$t('backup.exportFailedHint')}</p>
    </div>
  {:else}
    <!-- Choice State -->
    <div class="dialog-section">
      <div class="text-sm font-medium text-md-on-surface">
        {$t('backup.selectExportFormat')}
      </div>

      <div class="grid gap-2">
        <button
          type="button"
          class="flex items-center justify-between p-3 rounded-xl border-2 border-md-outline-variant bg-md-surface-container-low text-start {controlSurface(selectedFormat === 'json', 'border')}"
          aria-pressed={selectedFormat === 'json'}
          onclick={() => (selectedFormat = 'json')}
        >
          <div class="flex min-w-0 items-center gap-2.5">
            <span class="shrink-0 text-xs font-mono font-bold px-2 py-1 rounded bg-md-primary-container text-md-on-primary-container">JSON</span>
            <div class="min-w-0">
              <div class="text-sm font-semibold text-md-on-surface">{$t('backup.structuredJsonBackup')}</div>
              <div class="text-xs text-md-on-surface/50">{$t('backup.includesMetadataAndFullRaw')}</div>
            </div>
          </div>
          {#if selectedFormat === 'json'}
            <Icon name="check" class="w-4 h-4 text-md-primary" />
          {/if}
        </button>

        <button
          type="button"
          class="flex items-center justify-between p-3 rounded-xl border-2 border-md-outline-variant bg-md-surface-container-low text-start {controlSurface(selectedFormat === 'eml', 'border')}"
          aria-pressed={selectedFormat === 'eml'}
          onclick={() => (selectedFormat = 'eml')}
        >
          <div class="flex min-w-0 items-center gap-2.5">
            <span class="shrink-0 text-xs font-mono font-bold px-2 py-1 rounded bg-md-secondary-container text-md-on-secondary-container">EML</span>
            <div class="min-w-0">
              <div class="text-sm font-semibold text-md-on-surface">{$t('backup.emlRawEmailFiles')}</div>
              <div class="text-xs text-md-on-surface/50">{$t('backup.individualEmlFiles')}</div>
            </div>
          </div>
          {#if selectedFormat === 'eml'}
            <Icon name="check" class="w-4 h-4 text-md-primary" />
          {/if}
        </button>

        <button
          type="button"
          class="flex items-center justify-between p-3 rounded-xl border-2 border-md-outline-variant bg-md-surface-container-low text-start {controlSurface(selectedFormat === 'mbox', 'border')}"
          aria-pressed={selectedFormat === 'mbox'}
          onclick={() => (selectedFormat = 'mbox')}
        >
          <div class="flex min-w-0 items-center gap-2.5">
            <span class="shrink-0 text-xs font-mono font-bold px-2 py-1 rounded bg-md-tertiary-container text-md-on-tertiary-container">MBOX</span>
            <div class="min-w-0">
              <div class="text-sm font-semibold text-md-on-surface">{$t('backup.mailboxArchive')}</div>
              <div class="text-xs text-md-on-surface/50">{$t('backup.singleFileAppleMail')}</div>
            </div>
          </div>
          {#if selectedFormat === 'mbox'}
            <Icon name="check" class="w-4 h-4 text-md-primary" />
          {/if}
        </button>
      </div>
    </div>

  {/if}

  {#snippet footer()}
    {#if isDone}
      <Btn variant="primary" size="md" class="w-full" onclick={onClose}>
        {$t('common.done')}
      </Btn>
    {:else if exportError && !isProcessing}
      <div class="w-full flex items-center gap-2" use:responsiveButtonLayout data-action-tier="S">
        <Btn variant="ghost" size="md" onclick={onClose}>
          {$t('common.close')}
        </Btn>
        <Btn variant="primary" size="md" onclick={handleStartExport}>
          {$t('common.retry')}
        </Btn>
      </div>
    {:else if !isProcessing}
      <div class="w-full flex items-center gap-2" use:responsiveButtonLayout data-action-tier="S">
        <button
          type="button"
          class="md-action flex-1 min-w-0 h-10 px-4 rounded-xl bg-transparent text-md-on-surface transition-colors inline-flex items-center justify-center gap-1.5 font-bold tracking-wide whitespace-nowrap overflow-visible"
          onclick={onClose}
        >
          <span class="btn-label leading-tight self-center whitespace-nowrap overflow-visible">{$t('common.cancel')}</span>
        </button>
        <button
          type="button"
          class="md-action flex-1 min-w-0 h-10 px-4 rounded-xl bg-md-primary text-md-on-primary transition-colors inline-flex items-center justify-center gap-1.5 font-bold tracking-wide whitespace-nowrap overflow-visible"
          onclick={handleStartExport}
        >
          <span class="btn-icon flex items-center justify-center w-5 h-5 rounded-full shrink-0">
            <Icon name="download" class="w-3.5 h-3.5" />
          </span>
          <span class="btn-label leading-tight self-center whitespace-nowrap overflow-visible">{$t('preferences.exportFile')}</span>
        </button>
      </div>
    {/if}
  {/snippet}
</ModalDialog>
