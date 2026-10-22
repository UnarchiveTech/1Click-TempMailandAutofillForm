/**
 * Single subscription for `emailLabels` storage - avoids duplicate loaders across
 * MailboxView, EmailList, MessageDetail, and AppLayout.
 *
 */
import { browser } from 'wxt/browser';
import {
  isScopedEmailLabelKey,
  migrateLegacyEmailLabelKeys,
} from '@/utils/email/email-label-key.js';
import {
  getEmailLabelsMap,
  getEmailMaps,
  updateEmailLabelsMap,
} from '@/utils/storage/storage-keys.js';

export function sanitizeEmailLabelsMap(
  raw: Record<string, string[]> | undefined | null
): Record<string, string[]> {
  const sanitized: Record<string, string[]> = {};
  const source = raw || {};
  for (const [k, v] of Object.entries(source)) {
    sanitized[k] = Array.isArray(v) ? v : [];
  }
  return sanitized;
}

export type EmailLabelsLoadStatus = 'loading' | 'ready' | 'error';

class EmailLabelsStore {
  private map: Record<string, string[]> = {};
  private status: EmailLabelsLoadStatus = 'loading';
  private listeners = new Set<
    (map: Record<string, string[]>, status: EmailLabelsLoadStatus) => void
  >();
  private initPromise: Promise<void> | null = null;
  private listenerAttached = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelayMs = 1_000;
  private refreshGeneration = 0;

  subscribe(
    listener: (map: Record<string, string[]>, status: EmailLabelsLoadStatus) => void
  ): () => void {
    this.listeners.add(listener);
    listener(this.map, this.status);
    void this.init();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
    };
  }

  private notify() {
    for (const listener of this.listeners) {
      listener(this.map, this.status);
    }
  }

  private attachStorageListener() {
    if (this.listenerAttached) return;
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.emailLabels) {
        void this.refresh();
      }
    });
    this.listenerAttached = true;
  }

  async init(): Promise<void> {
    if (!this.initPromise) {
      // Listen before the first read so a storage update during startup or a
      // transient read failure can still recover without requiring a reload.
      this.attachStorageListener();
      this.initPromise = this.refresh();
    }
    return this.initPromise;
  }

  private async migrateLegacyKeys(): Promise<void> {
    const current = await getEmailLabelsMap();
    if (!Object.keys(current).some((key) => !isScopedEmailLabelKey(key))) return;
    const emailMaps = await getEmailMaps();
    await updateEmailLabelsMap((current) => migrateLegacyEmailLabelKeys(current, emailMaps));
  }

  async refresh(): Promise<void> {
    const generation = ++this.refreshGeneration;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    try {
      await this.migrateLegacyKeys();
      const loaded = await getEmailLabelsMap();
      if (generation !== this.refreshGeneration) return;
      this.map = sanitizeEmailLabelsMap(loaded);
      this.status = 'ready';
      this.retryDelayMs = 1_000;
      this.notify();
    } catch {
      if (generation !== this.refreshGeneration) return;
      // Retain the last known snapshot and retry with capped backoff. An empty
      // map is valid data, so status distinguishes it from a failed read.
      this.status = 'error';
      this.notify();
      this.initPromise = null;
      if (this.listeners.size === 0) return;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        void this.refresh();
      }, this.retryDelayMs);
      this.retryDelayMs = Math.min(this.retryDelayMs * 2, 60_000);
    }
  }

  async replaceMap(next: Record<string, string[]>): Promise<void> {
    const sanitized = sanitizeEmailLabelsMap(next);
    await updateEmailLabelsMap(() => sanitized);
    this.refreshGeneration += 1;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.map = sanitized;
    this.status = 'ready';
    this.retryDelayMs = 1_000;
    this.notify();
  }

  getSnapshot(): Record<string, string[]> {
    return this.map;
  }

  getStatus(): EmailLabelsLoadStatus {
    return this.status;
  }
}

export const emailLabelsStore = new EmailLabelsStore();
