<script lang="ts">
import { t } from 'svelte-i18n';
import ModalDialog from '@/ui/components/composites/ModalDialog.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import { logError } from '@/utils/logger.js';
import { rgbToHex } from '@/utils/theme/color-utils.js';
import { responsiveButtonLayout } from '@/utils/ui/responsive-button-layout.js';

interface Props {
  open: boolean;
  selectedEmail: string;
  qrCanvas?: HTMLCanvasElement | null;
  onClose: () => void;
  onDownload: () => void;
  onCopyImage: () => void;
}
let {
  open,
  selectedEmail,
  qrCanvas = $bindable(null),
  onClose,
  onDownload,
  onCopyImage,
}: Props = $props();

let generationError = $state(false);
let generatedEmail = $state('');
let generatedCanvas = $state<HTMLCanvasElement | null>(null);
let generation = 0;
const canExport = $derived(
  open && !!selectedEmail && generatedEmail === selectedEmail && generatedCanvas === qrCanvas
);

async function generateQR(canvas: HTMLCanvasElement, email: string, request: number) {
  generationError = false;
  try {
    const primaryColor =
      getComputedStyle(document.documentElement).getPropertyValue('--md-primary').trim() ||
      '#000000';

    const darkColor = rgbToHex(primaryColor);
    const lightColor = rgbToHex(
      getComputedStyle(document.documentElement).getPropertyValue('--md-surface').trim() ||
        getComputedStyle(document.documentElement).getPropertyValue('--md-background').trim() ||
        '#ffffff'
    );

    const QRCode = await import('qrcode');
    // Stale work must never paint into the currently displayed canvas.
    const staging = document.createElement('canvas');
    await QRCode.toCanvas(staging, email, {
      width: 160,
      margin: 2,
      color: {
        dark: darkColor,
        light: lightColor,
      },
    });
    if (request !== generation) return;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('QR canvas context unavailable');
    canvas.width = staging.width;
    canvas.height = staging.height;
    context.drawImage(staging, 0, 0);
    generatedEmail = email;
    generatedCanvas = canvas;
    generationError = false;
  } catch (e) {
    if (request !== generation) return;
    generatedEmail = '';
    generatedCanvas = null;
    generationError = true;
    logError('QR error: Failed to generate QR code', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

$effect(() => {
  const request = ++generation;
  const canvas = qrCanvas;
  const email = selectedEmail;
  generatedEmail = '';
  generatedCanvas = null;
  generationError = false;
  if (open && canvas && email) {
    // Resetting the width clears a previous image without requiring a 2D context.
    canvas.width = 160;
    void generateQR(canvas, email, request);
  }
  return () => {
    generation += 1;
  };
});
</script>

<ModalDialog
  {open}
  activityDialogKey="dialog:qr"
  ariaLabel={$t('activity.dialogQr')}
  maxWidth="xs"
  {onClose}
>
  <div class="dialog-content-stack items-center">
    <div class="bg-md-surface-container-low rounded-xl p-3 w-full flex items-center justify-center">
      <canvas bind:this={qrCanvas} width="160" height="160" class="w-40 h-40 rounded-lg"></canvas>
    </div>
    {#if generationError}
      <p class="text-xs text-md-error text-center" role="alert">{$t('qr.generationFailed')}</p>
    {/if}

    <p class="text-xs font-medium text-md-on-surface text-center break-all px-1">{selectedEmail}</p>
  </div>

  {#snippet footer()}
    <div class="w-full flex flex-nowrap items-center gap-2" use:responsiveButtonLayout data-action-tier="S">
      <button
        type="button"
        id="button-qr-download"
        class="md-action bg-md-primary text-md-on-primary flex-1 flex items-center justify-center gap-1.5 px-2.5 h-10 rounded-xl font-bold tracking-wide transition-colors min-w-0"
        aria-label={$t('qr.downloadQr')}
        title={$t('qr.downloadQr')}
        disabled={!canExport}
        class:opacity-50={!canExport}
        class:cursor-not-allowed={!canExport}
        onclick={(e) => { e.stopPropagation(); if (canExport) onDownload(); }}
      >
        <span class="btn-icon flex items-center justify-center w-5 h-5 rounded-full shrink-0">
          <Icon name="download" class="w-3.5 h-3.5" />
        </span>
        <span class="leading-tight self-center whitespace-nowrap overflow-visible">{$t('qr.download')}</span>
      </button>
      <button
        type="button"
        id="button-qr-copy-image"
        class="md-action bg-md-secondary-container text-md-on-secondary-container flex-1 flex items-center justify-center gap-1.5 px-2.5 h-10 rounded-xl font-bold tracking-wide transition-colors min-w-0"
        aria-label={$t('qr.copyImage')}
        title={$t('qr.copyImage')}
        disabled={!canExport}
        class:opacity-50={!canExport}
        class:cursor-not-allowed={!canExport}
        onclick={(e) => { e.stopPropagation(); if (canExport) onCopyImage(); }}
      >
        <span class="btn-icon flex items-center justify-center w-5 h-5 rounded-full shrink-0">
          <Icon name="contentCopy" class="w-3.5 h-3.5" />
        </span>
        <span class="leading-tight self-center whitespace-nowrap overflow-visible">{$t('qr.copyImage')}</span>
      </button>
    </div>
  {/snippet}
</ModalDialog>
