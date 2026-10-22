import type { ConfirmDialogOptions, ConfirmDialogState } from '@/utils/ui/shared-ui.js';

export function useConfirmDialog() {
  let confirmDialog = $state<ConfirmDialogState | null>(null);

  function showConfirm(
    message: string,
    onConfirm: () => void,
    options: ConfirmDialogOptions | undefined = undefined
  ) {
    // ConfirmDialog is rendered through ModalDialog, which owns focus capture,
    // trapping, scroll locking, and restoration for the whole lifecycle.
    confirmDialog = { message, onConfirm, ...options };
  }

  function closeConfirm() {
    confirmDialog = null;
  }

  function dispose() {
    confirmDialog = null;
  }

  return {
    get confirmDialog() {
      return confirmDialog;
    },
    showConfirm,
    closeConfirm,
    dispose,
  };
}
