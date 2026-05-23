import type { Browser } from 'wxt/browser';
import { logError } from '@/utils/logger.js';
import { timeAgo } from '@/utils/time.js';
import type { Email } from '@/utils/types.js';

export interface ArchivedState {
  archivedEmails: Email[];
}

export interface ArchivedSetters {
  setArchivedEmails: (emails: Email[]) => void;
  setShowToast: (message: string, type?: 'success' | 'error' | 'warning') => void;
  loadInboxes: () => Promise<void>;
}

export async function loadArchivedEmails(ext: Browser, setters: ArchivedSetters) {
  try {
    const response = await ext.runtime.sendMessage({ action: 'getArchivedEmails' });
    if (response?.success) {
      const archivedEmails = (response.archivedEmails || []).map((m: Email) => ({
        id: m.id,
        subject: m.subject || 'No Subject',
        from: m.from_name || 'Unknown',
        date: m.archived_at ? new Date(m.archived_at).toLocaleDateString() : timeAgo(m.received_at),
        otp: m.otp,
        body_html: m.body_html,
        body_plain: m.body_plain,
        received_at: m.received_at,
      }));
      setters.setArchivedEmails(archivedEmails);
    }
  } catch (e: unknown) {
    logError('loadArchivedEmails error:', undefined, e instanceof Error ? e : new Error(String(e)));
  }
}

export async function restoreArchivedInbox(
  ext: Browser,
  email: Email,
  state: ArchivedState,
  setters: ArchivedSetters
) {
  try {
    const result = (await ext.storage.local.get(['inboxes'])) as {
      inboxes?: Array<{ id: string; accountStatus?: string }>;
    };
    const inboxes = result.inboxes || [];
    const updated = inboxes.map((i) => (i.id === email.id ? { ...i, accountStatus: 'active' } : i));
    await ext.storage.local.set({ inboxes: updated });
    setters.setArchivedEmails(state.archivedEmails.filter((e) => e.id !== email.id));
    setters.setShowToast('Email restored');
  } catch (_e) {
    setters.setShowToast('Failed to restore', 'error');
  }
}

export async function deleteArchivedEmail(
  email: Email,
  state: ArchivedState,
  setters: ArchivedSetters
) {
  setters.setArchivedEmails(state.archivedEmails.filter((e) => e.id !== email.id));
  setters.setShowToast('Archived email deleted');
}
