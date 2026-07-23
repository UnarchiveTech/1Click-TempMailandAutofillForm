<script lang="ts">
import { onMount, tick } from 'svelte';
import Icon from '@/components/icons/Icon.svelte';
import { rgbToHex } from '@/utils/color-utils.js';
import { setupFocusTrap } from '@/utils/focusTrap.js';
import { logError } from '@/utils/logger.js';
import { portalToBody } from '@/utils/portal-layers.js';

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
let overlayEl = $state<HTMLElement | null>(null);
let cleanupFocusTrap: (() => void) | null = null;

$effect(() => {
  if (open && overlayEl) {
    return portalToBody(overlayEl);
  }
});

let previousActiveElement = $state<HTMLElement | null>(null);

// Setup focus trap when dialog opens
$effect(() => {
  let prevOverflow = '';
  if (open) {
    previousActiveElement = document.activeElement as HTMLElement;
    // Lock body scroll so the background doesn't scroll behind the overlay
    prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    void tick().then(() => {
      if (qrDialogElement) {
        cleanupFocusTrap = setupFocusTrap(qrDialogElement);
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

    const QRCode = await import('qrcode');
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
  <div
    bind:this={overlayEl}
    class="fixed inset-0 z-[10000] flex items-center justify-center"
    role="dialog"
    aria-modal="true"
  >
    <div
      class="absolute inset-0 bg-md-scrim/30 backdrop-blur-sm"
      role="button"
      tabindex="-1"
      onclick={(e) => { e.stopPropagation(); onClose(); }}
      onkeydown={(e) => e.key === 'Escape' && onClose()}
    ></div>

    <button
      class="absolute top-4 end-4 z-10 w-9 h-9 rounded-full bg-md-surface-container hover:bg-md-surface-variant flex items-center justify-center shadow-md transition-colors"
      aria-label="Close dialog"
      onclick={(e) => { e.stopPropagation(); onClose(); }}
    >
      <Icon name="x" class="w-4 h-4 text-md-on-surface/70" />
    </button>

    <div
      class="relative z-10 bg-md-surface-container rounded-xl shadow-2xl p-4 flex flex-col items-center gap-3 w-60"
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
          onclick={(e) => { e.stopPropagation(); onDownload(); }}
        >
          <Icon name="download" class="w-3.5 h-3.5" />
          Download QR
        </button>
        <button
          class="w-full px-3 py-1.5 text-sm font-semibold rounded-xl bg-md-primary/10 hover:bg-md-primary/20 text-md-primary border-0 gap-2 transition-colors flex items-center justify-center"
          aria-label="Copy QR code as image"
          onclick={(e) => { e.stopPropagation(); onCopyImage(); }}
        >
          <Icon name="copy" class="w-3.5 h-3.5" />
          Copy QR Image
        </button>
      </div>
    </div>
  </div>
{/if}
