import type { ToastType } from '@/ui/blocks/feedback/toast-types.js';
import { addToastNotification } from '@/utils/activity/activity-tracker.js';
import { toastStore } from '@/utils/ui/toastStore.js';

const TOAST_TYPES = new Set<ToastType>([
  'success',
  'error',
  'warning',
  'info',
  'expired',
  'archived',
  'deleted',
  'copy',
  'auto-renew',
  'back',
  'chart',
  'bell',
  'chevron-down',
  'chevron-up',
  'download',
  'edit',
  'envelope',
  'filter',
  'flame',
  'github',
  'globe',
  'inbox',
  'lock',
  'mail',
  'monitor',
  'moon',
  'plus',
  'qr',
  'refresh',
  'search',
  'settings',
  'shield',
  'sun',
  'tag',
  'user',
]);

// Mail events are already recorded by the mail activity pipeline. Keep them
// out of the generic toast activity log using stable categories, not translated
// message text.
const MAIL_ACTIVITY_TOAST_TYPES = new Set<ToastType>(['envelope', 'inbox', 'mail']);

function resolveToastType(value: string): ToastType {
  return TOAST_TYPES.has(value as ToastType) ? (value as ToastType) : 'success';
}

/**
 * Canonical toast callback signature used across dependency contracts and
 * component props. `type` is deliberately `string` (not `ToastType`) because
 * callers legitimately pass extended labels like `'tag'`.
 */
/** A toast message: plain text or an object carrying its own type/icon hints. */
export type ToastMessage = string | { message: string; type?: ToastType; icon?: ToastType };

export type ToastFn = (
  message: ToastMessage,
  type?: string,
  undoAction?: (() => void | Promise<void>) | null,
  actionLabel?: string | null
) => void;

export function showToast(
  message: ToastMessage,
  type: string = 'success',
  undoAction: (() => void) | null = null,
  actionLabel: string | null = null
) {
  const messageText = typeof message === 'string' ? message : message.message;
  if (!messageText?.trim()) return;

  // Log to activity tab except mail events, which have their own activity
  // records. The classification must not depend on the translated copy.
  const activityType =
    typeof message === 'string' ? resolveToastType(type) : message.type || resolveToastType(type);
  const isMailRelated = MAIL_ACTIVITY_TOAST_TYPES.has(activityType);

  if (!isMailRelated) {
    const toastType =
      type === 'success' || type === 'error' || type === 'warning' || type === 'info'
        ? type
        : 'info';
    addToastNotification(messageText, toastType);
  }

  // Toasts receive localized prose, so their visual type must come from the
  // stable type supplied by the caller, never from matching English words.
  if (typeof message === 'string') {
    toastStore.add(
      resolveToastType(type),
      message,
      undoAction ? 10000 : 2500,
      undoAction,
      actionLabel
    );
  } else {
    const finalType = message.icon || message.type || resolveToastType(type);
    toastStore.add(finalType, message.message, undoAction ? 10000 : 2500, undoAction, actionLabel);
  }
}
