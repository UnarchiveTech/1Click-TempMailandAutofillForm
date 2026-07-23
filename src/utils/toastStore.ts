import type { Toast, ToastType } from '@/components/feedback/Toast.svelte';

class ToastStore {
  private toasts: Toast[] = [];
  private listeners = new Set<(toasts: Toast[]) => void>();
  /** Dedupe rapid identical messages (e.g. spam-clicking Copy). */
  private lastMessage = '';
  private lastMessageAt = 0;
  private static DEDUPE_MS = 1800;

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

  add(
    type: ToastType,
    message: string,
    duration?: number,
    undoAction?: (() => void | Promise<void>) | null,
    actionLabel?: string | null
  ) {
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
      updatedToasts.shift();
    }
    this.toasts = [...updatedToasts, toast];

    this.notify();
    return id;
  }

  remove(id: string) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.notify();
  }

  clear() {
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
