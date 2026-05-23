<script lang="ts">
import QRCode from 'qrcode';
import { onMount } from 'svelte';
import { rgbToHex } from '@/utils/color-utils.js';
import { setupFocusTrap } from '@/utils/focusTrap.js';
import { logError } from '@/utils/logger.js';

interface Props {
  open: boolean;
  selectedEmail: string;
  qrDialogElement?: HTMLElement | null;
  qrCanvas?: HTMLCanvasElement | null;
  onClose: () => void;
  onDownload: () => void;
  onCopyImage: () => void;
}
let {
  open,
  selectedEmail,
  qrDialogElement = $bindable(null),
  qrCanvas = $bindable(null),
  onClose,
  onDownload,
  onCopyImage,
}: Props = $props();

let localCanvas: HTMLCanvasElement | null = null;
let cleanupFocusTrap: (() => void) | null = null;

// Setup focus trap when dialog opens
$effect(() => {
  if (open && qrDialogElement) {
    setTimeout(() => {
      if (qrDialogElement) {
        cleanupFocusTrap = setupFocusTrap(qrDialogElement);
      }
    }, 50);
  }
  return () => {
    if (cleanupFocusTrap) {
      cleanupFocusTrap();
      cleanupFocusTrap = null;
    }
  };
});

async function generateQR() {
  if (!localCanvas || !selectedEmail) {
    logError('QR error: Missing canvas or email', {
      canvas: !!localCanvas,
      email: !!selectedEmail,
    });
    return;
  }
  try {
    const primaryColor =
      getComputedStyle(document.documentElement).getPropertyValue('--md-primary').trim() ||
      getComputedStyle(document.documentElement).getPropertyValue('--md-primary').trim() ||
      '#000000';

    // Convert RGB to hex if necessary
    const darkColor = rgbToHex(primaryColor);
    const lightColor = rgbToHex(
      getComputedStyle(document.documentElement).getPropertyValue('--md-surface').trim() ||
        getComputedStyle(document.documentElement).getPropertyValue('--md-background').trim() ||
        '#ffffff'
    );

    await QRCode.toCanvas(localCanvas, selectedEmail, {
      width: 160,
      margin: 2,
      color: {
        dark: darkColor,
        light: lightColor,
      },
    });
  } catch (e) {
    logError('QR error: Failed to generate QR code', {
      error: e instanceof Error ? e.message : String(e),
      email: selectedEmail.substring(0, 50),
      canvas: !!localCanvas,
    });
  }
}

onMount(() => {
  if (qrCanvas) localCanvas = qrCanvas;
});

$effect(() => {
  if (qrCanvas && qrCanvas !== localCanvas) {
    localCanvas = qrCanvas;
  }
  if (open && localCanvas) {
    generateQR();
  }
});
</script>

{#if open}
  <div class="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
    <div
      class="absolute inset-0 bg-md-surface/30 backdrop-blur-sm"
      role="button"
      tabindex="-1"
      onclick={onClose}
      onkeydown={(e) => e.key === 'Escape' && onClose()}
    ></div>

    <button
      class="absolute top-4 right-4 z-10 w-9 h-9 rounded-full bg-md-surface hover:bg-md-surface-variant flex items-center justify-center shadow-md transition-colors"
      aria-label="Close dialog"
      onclick={onClose}
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-md-on-surface/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
      </svg>
    </button>

    <div
      class="relative z-10 bg-md-surface rounded-xl shadow-2xl p-4 flex flex-col items-center gap-3 w-60"
      bind:this={qrDialogElement}
      tabindex="-1"
    >
      <div class="bg-md-surface-container-low rounded-xl p-3 w-full flex items-center justify-center">
        <canvas bind:this={qrCanvas} width="160" height="160" class="w-40 h-40 rounded-lg"></canvas>
      </div>

      <p class="text-xs font-medium text-md-on-surface text-center break-all px-1">{selectedEmail}</p>

      <div class="flex flex-col gap-1.5 w-full">
        <button
          class="w-full px-3 py-1.5 text-sm font-semibold rounded-xl bg-md-primary text-md-on-primary hover:bg-md-primary/90 gap-2 transition-colors flex items-center justify-center"
          aria-label="Download QR code"
          onclick={onDownload}
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
          </svg>
          Download QR
        </button>
        <button
          class="w-full px-3 py-1.5 text-sm font-semibold rounded-xl bg-md-primary/10 hover:bg-md-primary/20 text-md-primary border-0 gap-2 transition-colors flex items-center justify-center"
          aria-label="Copy QR code as image"
          onclick={onCopyImage}
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
          </svg>
          Copy QR Image
        </button>
      </div>
    </div>
  </div>
{/if}
