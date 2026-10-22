import type { Toast, ToastType } from '@/ui/blocks/feedback/toast-types.js';

class ToastStore {
  private toasts: Toast[] = [];
  private listeners = new Set<(toasts: Toast[]) => void>();
  /** Dedupe rapid identical messages (e.g. spam-clicking Copy). */
  private lastMessage = '';
  private lastMessageAt = 0;
  private static DEDUPE_MS = 1800;
  /** Master switch - when off, push() is a no-op and visible toasts clear. */
  private enabled = true;
  /** Only the currently focused toast is protected; cleared on blur/removal. */
  private focusedToastId: string | null = null;

  setFocused(id: string, focused: boolean) {
    if (focused && this.toasts.some((toast) => toast.id === id)) this.focusedToastId = id;
    else if (!focused && this.focusedToastId === id) this.focusedToastId = null;
  }

  subscribe(listener: (toasts: Toast[]) => void) {
    this.listeners.add(listener);
    listener(this.toasts);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((listener) => {
      listener(this.toasts);
    });
  }

  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.clear(); // dismiss any toasts already on screen
  }

  add(
    type: ToastType,
    message: string,
    duration?: number,
    undoAction?: (() => void | Promise<void>) | null,
    actionLabel?: string | null
  ) {
    if (!this.enabled) return '';
    const now = Date.now();
    const normalized = (message || '').trim();
    // Collapse duplicate toasts fired in a short window (copy spam, etc.)
    if (
      !undoAction &&
      normalized &&
      normalized === this.lastMessage &&
      now - this.lastMessageAt < ToastStore.DEDUPE_MS
    ) {
      // Refresh duration on the existing matching toast if still visible
      const existing = [...this.toasts].reverse().find((t) => t.message === message);
      if (existing) {
        // Replacing a focused card would detach its Undo/Close control.
        // Preserve action-bearing cards as well when an ordinary message repeats.
        if (existing.id === this.focusedToastId || existing.undoAction) {
          this.lastMessageAt = now;
          return existing.id;
        }
        this.remove(existing.id);
        const refreshed: Toast = {
          id: crypto.randomUUID(),
          type,
          message,
          duration: duration ?? 2500,
          undoAction: null,
          actionLabel: null,
        };
        this.toasts = [...this.toasts, refreshed];
        this.lastMessageAt = now;
        this.notify();
        return refreshed.id;
      }
      // Same message still in dedupe window but toast already dismissed - skip
      this.lastMessageAt = now;
      return '';
    }

    this.lastMessage = normalized;
    this.lastMessageAt = now;

    const id = crypto.randomUUID();
    const toast: Toast = {
      id,
      type,
      message,
      // Action buttons need longer visibility so the user can tap them
      duration: duration ?? (undoAction ? 8000 : 2500),
      undoAction: undoAction ?? null,
      actionLabel: actionLabel ?? null,
    };

    const updatedToasts = [...this.toasts];
    // Keep stack short - OTP-strip-sized notifications
    if (updatedToasts.length >= 3) {
      const removable = updatedToasts.findIndex((toast) => toast.id !== this.focusedToastId);
      if (removable >= 0) updatedToasts.splice(removable, 1);
    }
    this.toasts = [...updatedToasts, toast];

    this.notify();
    return id;
  }

  remove(id: string) {
    this.setFocused(id, false);
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.notify();
  }

  clear() {
    this.focusedToastId = null;
    this.toasts = [];
    this.lastMessage = '';
    this.lastMessageAt = 0;
    this.notify();
  }

  success(message: string, duration?: number, undoAction?: (() => void | Promise<void>) | null) {
    return this.add('success', message, duration, undoAction);
  }

  error(message: string, duration?: number, undoAction?: (() => void | Promise<void>) | null) {
    return this.add('error', message, duration, undoAction);
  }

  warning(message: string, duration?: number, undoAction?: (() => void | Promise<void>) | null) {
    return this.add('warning', message, duration, undoAction);
  }

  info(message: string, duration?: number, undoAction?: (() => void | Promise<void>) | null) {
    return this.add('info', message, duration, undoAction);
  }
}

export const toastStore = new ToastStore();
