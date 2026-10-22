import type { ToastType } from '@/ui/blocks/feedback/toast-types.js';
import { detectIconFromMessage } from '@/utils/ui/iconMapping.js';

/**
 * Shared toast notification utilities
 */
export function getToastTypeFromMessage(message: string): ToastType {
  return detectIconFromMessage(message);
}

/**
 * Shared confirmation dialog state and functions
 * This is a helper function - the actual state should be managed in the component
 */
export interface ConfirmDialogState {
  message: string;
  onConfirm: () => void;
  title?: string;
  confirmLabel?: string;
  secondaryLabel?: string;
  onSecondary?: () => void;
  note?: string;
  /**
   * Paint the confirm button in the error (destructive) palette. Defaults to
   * the neutral primary action so ordinary confirms do not look like deletes.
   */
  destructive?: boolean;
}

/** Options accepted alongside a confirm message (everything but the core pair). */
export type ConfirmDialogOptions = Omit<ConfirmDialogState, 'message' | 'onConfirm'>;
