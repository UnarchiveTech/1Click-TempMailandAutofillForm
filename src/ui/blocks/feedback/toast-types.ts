/**
 * Toast model types. Defined in a plain .ts module (not Toast.svelte) so .ts
 * modules can import them without going through the ambient `*.svelte` shim,
 * which exposes only a default export to `tsc`. Toast.svelte re-exports these
 * for component-side importers.
 */
export type ToastType =
  | 'success'
  | 'error'
  | 'warning'
  | 'info'
  | 'expired'
  | 'archived'
  | 'deleted'
  | 'copy'
  | 'auto-renew'
  | 'back'
  | 'chart'
  | 'bell'
  | 'chevron-down'
  | 'chevron-up'
  | 'download'
  | 'edit'
  | 'envelope'
  | 'filter'
  | 'flame'
  | 'github'
  | 'globe'
  | 'inbox'
  | 'lock'
  | 'mail'
  | 'monitor'
  | 'moon'
  | 'plus'
  | 'qr'
  | 'refresh'
  | 'search'
  | 'settings'
  | 'shield'
  | 'sun'
  | 'tag'
  | 'user';

export type Toast = {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
  undoAction?: (() => void | Promise<void>) | null;
  /** Optional label for the action button (defaults to Undo) */
  actionLabel?: string | null;
};
