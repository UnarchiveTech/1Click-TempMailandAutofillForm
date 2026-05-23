import type { ToastType } from '@/components/feedback/Toast.svelte';
import { detectIconFromMessage } from '@/utils/iconMapping.js';

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
}
