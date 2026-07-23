<script lang="ts">
import { onDestroy, tick } from 'svelte';
import Icon from '@/components/icons/Icon.svelte';
import Btn from '@/components/ui/primitives/Btn.svelte';
import { setupFocusTrap } from '@/utils/focusTrap.js';

interface Props {
  confirmDialog: {
    message: string;
    onConfirm: () => void;
    title?: string;
    confirmLabel?: string;
    secondaryLabel?: string;
    onSecondary?: () => void;
    note?: string;
  } | null;
  confirmDialogRef?: HTMLElement | null;
  onClose: () => void;
}
let { confirmDialog, confirmDialogRef = $bindable(null), onClose }: Props = $props();

let dialogRef = $state<HTMLElement | null>(null);
let overlayEl = $state<HTMLElement | null>(null);
let cleanupFocusTrap: (() => void) | null = null;

let previousActiveElement = $state<HTMLElement | null>(null);

/** Portal to body so AccountSelector / transforms never bury the confirm UI */
$effect(() => {
  if (!confirmDialog || !overlayEl) return;
  if (overlayEl.parentElement !== document.body) {
    document.body.appendChild(overlayEl);
  }
  return () => {
    try {
      if (overlayEl?.parentElement === document.body) overlayEl.remove();
    } catch {
      /* ignore */
    }
  };
});

onDestroy(() => {
  try {
    if (overlayEl?.parentElement === document.body) overlayEl.remove();
  } catch {
    /* ignore */
  }
});

// Setup focus trap when dialog opens
$effect(() => {
  let prevOverflow = '';
  if (confirmDialog) {
    previousActiveElement = document.activeElement as HTMLElement;
    // Lock body scroll so the background doesn't scroll behind the overlay
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
    // Restore body scroll only if we locked it (avoids clobbering other locks)
    if (prevOverflow !== '') {
      document.body.style.overflow = prevOverflow;
    }
    if (previousActiveElement) {
      previousActiveElement.focus();
      previousActiveElement = null;
    }
  };
});
</script>

{#if confirmDialog}
  <!-- Portaled to body; PORTAL_Z.dialog (10000) above AccountSelector (40) — see portal-layers.ts -->
  <div
    bind:this={overlayEl}
    class="fixed inset-0 z-[10000] flex items-center justify-center bg-md-scrim/40 backdrop-blur-sm"
    data-portal-layer="dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="confirm-dialog-title"
    data-confirm-dialog-overlay
  >
    <div
      class="absolute inset-0"
      role="button"
      tabindex="-1"
      aria-label="Close dialog"
      onclick={(e) => { e.stopPropagation(); onClose(); }}
      onkeydown={(e) => e.key === 'Escape' && onClose()}
    ></div>
    <div class="bg-md-surface-container rounded-xl px-4 py-4 shadow-xl max-w-xs w-full relative mx-4 z-10" bind:this={dialogRef} tabindex="-1">
      <h3 id="confirm-dialog-title" class="font-bold text-base mb-2">{confirmDialog.title ?? 'Confirm Action'}</h3>
      <p class="text-sm text-md-on-surface/80 mb-3">{confirmDialog.message}</p>
      {#if confirmDialog.note}
        <p class="text-xs text-md-on-surface/50 bg-md-surface-variant/40 rounded-lg px-3 py-2 mb-4">{confirmDialog.note}</p>
      {/if}
      {#if confirmDialog.onSecondary && confirmDialog.secondaryLabel}
        <Btn
          variant="outline"
          size="md"
          class="w-full mb-2 text-md-primary border-md-primary/30 hover:bg-md-primary/10 justify-start"
          aria-label={confirmDialog.secondaryLabel}
          onclick={() => confirmDialog.onSecondary?.()}
        >
          <Icon name="trashBox" class="w-4 h-4 shrink-0" />
          {confirmDialog.secondaryLabel}
        </Btn>
      {/if}
      <div class="flex justify-end gap-2">
        <Btn
          variant="ghost"
          size="sm"
          aria-label="Cancel action"
          onclick={onClose}
        >
          Cancel
        </Btn>
        <Btn
          variant="danger"
          size="sm"
          aria-label="Confirm action"
          onclick={() => {
            const fn = confirmDialog.onConfirm;
            onClose();
            fn();
          }}
        >
          {confirmDialog.confirmLabel ?? 'Confirm'}
        </Btn>
      </div>
    </div>
  </div>
{/if}
