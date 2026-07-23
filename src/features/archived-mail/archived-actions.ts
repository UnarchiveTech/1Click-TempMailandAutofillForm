import type { Browser } from 'wxt/browser';
import { t } from '@/utils/i18n-utils.js';
import { logError } from '@/utils/logger.js';
import { timeAgo } from '@/utils/time.js';
import type { Account, Email } from '@/utils/types.js';

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
      const archivedEmails = (response.archivedEmails || []).map((m: Email) => {
        const inbox = m.original_inbox || '';
        // Build a display-friendly sender: prefer "Name <addr>" when both exist,
        // fall back to whichever is available, or 'Unknown'.
        const from =
          m.from_name && m.from ? `${m.from_name} <${m.from}>` : m.from_name || m.from || 'Unknown';
        return {
          // Compound key prevents ID collisions when multiple inboxes share
          // provider-scoped numeric IDs (e.g. "1", "2").
          id: inbox ? `${inbox}_${m.id}` : m.id,
          subject: m.subject || 'No Subject',
          from,
          from_name: m.from_name,
          date: m.archived_at
            ? new Date(m.archived_at).toLocaleDateString()
            : timeAgo(m.received_at),
          otp: m.otp,
          body_html: m.body_html,
          body_plain: m.body_plain,
          received_at: m.received_at,
          original_inbox: inbox,
        };
      });
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
    const inboxAddress = email.original_inbox || '';
    if (!inboxAddress) {
      setters.setShowToast(await t('toasts.emailRestoreNoInbox'), 'error');
      return;
    }

    // Strip the compound UI prefix ("inbox@example.com_rawId") to get the raw
    // storage-level ID used inside the archivedEmails map.
    const rawId = email.id.startsWith(`${inboxAddress}_`)
      ? email.id.slice(inboxAddress.length + 1)
      : email.id;

    // 1. Find corresponding inbox to unarchive
    const { inboxes = [] } = (await ext.storage.local.get(['inboxes'])) as {
      inboxes?: Account[];
    };
    const inbox = inboxes.find((i) => i.address === inboxAddress);
    if (inbox && inbox.accountStatus === 'archived') {
      const response = await ext.runtime.sendMessage({
        type: 'unarchiveInbox',
        inboxId: inbox.id,
      });
      if (!response?.success) {
        throw new Error(response?.error || 'Failed to unarchive inbox');
      }
    }

    // 2. Move email from archivedEmails map back to storedEmails map in storage
    const { storedEmails = {}, archivedEmails = {} } = (await ext.storage.local.get([
      'storedEmails',
      'archivedEmails',
    ])) as {
      storedEmails?: Record<string, Email[]>;
      archivedEmails?: Record<string, Email[]>;
    };

    const archivedList = archivedEmails[inboxAddress] || [];
    const storedList = storedEmails[inboxAddress] || [];

    // Filter from archived list using raw storage ID
    const updatedArchived = archivedList.filter((e) => e.id !== rawId);
    archivedEmails[inboxAddress] = updatedArchived;
    if (updatedArchived.length === 0) {
      delete archivedEmails[inboxAddress];
    }

    // Add to stored list
    const foundEmail = archivedList.find((e) => e.id === rawId);
    if (foundEmail) {
      const restoredEmail: Email = {
        ...foundEmail,
        archived: false,
        local_archived: false,
      };
      // Delete archived metadata
      delete restoredEmail.archived_at;
      delete restoredEmail.local_archived_at;

      if (!storedList.some((e) => e.id === rawId)) {
        storedList.push(restoredEmail);
        storedEmails[inboxAddress] = storedList;
      }
    }

    await ext.storage.local.set({ storedEmails, archivedEmails });

    // 3. Update UI state - filter by the compound UI key
    setters.setArchivedEmails(state.archivedEmails.filter((e) => e.id !== email.id));
    await setters.loadInboxes(); // Refresh the sidebar inboxes status
    setters.setShowToast(await t('toasts.emailRestored'));
  } catch (e: unknown) {
    logError(
      'restoreArchivedInbox error:',
      undefined,
      e instanceof Error ? e : new Error(String(e))
    );
    setters.setShowToast(await t('toasts.emailRestoreFailed'), 'error');
  }
}

export async function deleteArchivedEmail(
  ext: Browser,
  email: Email,
  state: ArchivedState,
  setters: ArchivedSetters
) {
  try {
    const inboxAddress = email.original_inbox || '';

    // Strip the compound UI prefix to recover the raw storage ID
    const rawId =
      inboxAddress && email.id.startsWith(`${inboxAddress}_`)
        ? email.id.slice(inboxAddress.length + 1)
        : email.id;

    if (!inboxAddress) {
      setters.setArchivedEmails(state.archivedEmails.filter((e) => e.id !== email.id));
      setters.setShowToast(await t('toasts.archivedEmailDeleted'));
      return;
    }

    const { archivedEmails = {} } = (await ext.storage.local.get(['archivedEmails'])) as {
      archivedEmails?: Record<string, Email[]>;
    };

    const archivedList = archivedEmails[inboxAddress] || [];
    const updatedArchived = archivedList.filter((e) => e.id !== rawId);
    archivedEmails[inboxAddress] = updatedArchived;
    if (updatedArchived.length === 0) {
      delete archivedEmails[inboxAddress];
    }

    await ext.storage.local.set({ archivedEmails });
    // Filter UI state by the compound key
    setters.setArchivedEmails(state.archivedEmails.filter((e) => e.id !== email.id));
    setters.setShowToast(await t('toasts.archivedEmailDeleted'));
  } catch (e: unknown) {
    logError(
      'deleteArchivedEmail error:',
      undefined,
      e instanceof Error ? e : new Error(String(e))
    );
    setters.setShowToast(await t('toasts.archivedEmailDeleteFailed'), 'error');
  }
}
