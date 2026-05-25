<script lang="ts">
import IconTrashBox from '@/components/icons/IconTrashBox.svelte';
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
let cleanupFocusTrap: (() => void) | null = null;

// Setup focus trap when dialog opens
$effect(() => {
  if (confirmDialog && dialogRef) {
    setTimeout(() => {
      if (dialogRef) {
        cleanupFocusTrap = setupFocusTrap(dialogRef);
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
</script>

{#if confirmDialog}
  <div class="absolute inset-0 z-50 flex items-center justify-center bg-md-surface/30 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
    <div
      class="absolute inset-0"
      role="button"
      tabindex="-1"
      aria-label="Close dialog"
      onclick={onClose}
      onkeydown={(e) => e.key === 'Escape' && onClose()}
    ></div>
    <div class="bg-md-surface rounded-xl px-4 py-4 shadow-xl max-w-xs w-full relative mx-4" bind:this={dialogRef} tabindex="-1">
      <h3 id="confirm-dialog-title" class="font-bold text-base mb-2">{confirmDialog.title ?? 'Confirm Action'}</h3>
      <p class="text-sm text-md-on-surface/80 mb-3">{confirmDialog.message}</p>
      {#if confirmDialog.note}
        <p class="text-xs text-md-on-surface/50 bg-md-surface-variant/40 rounded-lg px-3 py-2 mb-4">{confirmDialog.note}</p>
      {/if}
      {#if confirmDialog.onSecondary && confirmDialog.secondaryLabel}
        <button
          class="w-full mb-2 px-3 py-2 text-sm font-medium rounded-xl bg-md-primary/10 hover:bg-md-primary/20 text-md-primary transition-colors text-left flex items-center gap-2"
          aria-label={confirmDialog.secondaryLabel}
          onclick={confirmDialog.onSecondary}
        >
          <IconTrashBox class="w-4 h-4 shrink-0" />
          {confirmDialog.secondaryLabel}
        </button>
      {/if}
      <div class="flex justify-end gap-2">
        <button class="px-3 py-1.5 text-sm rounded-lg bg-md-surface-variant hover:bg-md-surface-variant/80 text-md-on-surface transition-colors" aria-label="Cancel action" onclick={onClose}>Cancel</button>
        <button class="px-3 py-1.5 text-sm rounded-lg bg-md-error text-md-on-error hover:bg-md-error/90 transition-colors" aria-label="Confirm action" onclick={confirmDialog.onConfirm}>{confirmDialog.confirmLabel ?? 'Confirm'}</button>
      </div>
    </div>
  </div>
{/if}
