import { getCachedLocale, t } from '@/utils/i18n/i18n-utils.js';
import { logError } from '@/utils/logger.js';
import { getEmailMaps, resolveBagKey, setLogicalEmailMaps } from '@/utils/storage/storage-keys.js';
import { timeAgo } from '@/utils/time/time-format.js';
import type { Address, Email } from '@/utils/types.js';

export interface ArchivedState {
  archivedEmails: Email[];
}

export interface ArchivedSetters {
  setArchivedEmails: (emails: Email[]) => void;
  setShowToast: (message: string, type?: 'success' | 'error' | 'warning') => void;
  loadAddresses: () => Promise<void>;
}

export async function loadArchivedEmails(ext: Browser, setters: ArchivedSetters) {
  try {
    const response = await ext.runtime.sendMessage({ type: 'getArchivedEmails' });
    if (response?.success) {
      // The row stand-ins are the same facts the mailbox list shows, so they come
      // from the same keys the rest of the app uses for them - an English
      // literal here would win over those keys for the archived list alone.
      const unknownSender = await t('common.unknown');
      const noSubject = await t('notifications.noSubject');
      const archivedEmails = (response.archivedEmails || []).map((m: Email) => {
        const addr = m.original_inbox || '';
        // Build a display-friendly sender: prefer "Name <addr>" when both exist,
        // fall back to whichever is available, or the localized unknown sender.
        const from =
          m.from_name && m.from
            ? `${m.from_name} <${m.from}>`
            : m.from_name || m.from || unknownSender;
        return {
          // Compound key prevents ID collisions when multiple addresses share
          // provider-scoped numeric IDs (e.g. "1", "2").
          id: addr ? `${addr}_${m.id}` : m.id,
          subject: m.subject || noSubject,
          from,
          from_name: m.from_name,
          date: m.archived_at
            ? new Date(m.archived_at).toLocaleDateString(getCachedLocale())
            : timeAgo(m.received_at),
          otp: m.otp,
          body_html: m.body_html,
          body_plain: m.body_plain,
          raw_source: m.raw_source,
          received_at: m.received_at,
          original_inbox: addr,
        };
      });
      setters.setArchivedEmails(archivedEmails);
    }
  } catch (e: unknown) {
    logError('loadArchivedEmails error:', undefined, e instanceof Error ? e : new Error(String(e)));
  }
}

export async function restoreArchivedAddress(
  ext: Browser,
  email: Email,
  state: ArchivedState,
  setters: ArchivedSetters
) {
  try {
    const address = email.original_inbox || '';
    if (!address) {
      setters.setShowToast(await t('toasts.emailRestoreNoAddress'), 'error');
      return;
    }

    // Strip the compound UI prefix ("inbox@example.com_rawId") to get the raw
    // storage-level ID used inside the archivedEmails map.
    const rawId = email.id.startsWith(`${address}_`)
      ? email.id.slice(address.length + 1)
      : email.id;

    // 1. Find corresponding inbox to unarchive
    const { addresses = [] } = (await ext.storage.local.get(['addresses'])) as {
      addresses?: Address[];
    };
    const record = addresses.find((i) => i.address === address);
    if (record && record.accountStatus === 'archived') {
      const response = await ext.runtime.sendMessage({
        type: 'unarchiveAddress',
        addressId: record.id,
      });
      if (!response?.success) {
        throw new Error(response?.error || 'Failed to unarchive inbox');
      }
    }

    // 2. Move email from archivedEmails map back to storedEmails map in storage
    const { storedEmails = {}, archivedEmails = {} } = await getEmailMaps();

    // Resolve case-insensitively: a casing drift must not split the mailbox
    // across two keys (restoring under a second key would orphan the original).
    const archivedKey = resolveBagKey(archivedEmails, address);
    const storedKey = resolveBagKey(storedEmails, address);
    const archivedList = archivedEmails[archivedKey] || [];
    const storedList = storedEmails[storedKey] || [];

    // Filter from archived list using raw storage ID
    const updatedArchived = archivedList.filter((e) => e.id !== rawId);
    archivedEmails[archivedKey] = updatedArchived;
    if (updatedArchived.length === 0) {
      delete archivedEmails[archivedKey];
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
        storedEmails[storedKey] = storedList;
      }
    }

    await setLogicalEmailMaps(storedEmails, archivedEmails);

    // 3. Update UI state - filter by the compound UI key
    setters.setArchivedEmails(state.archivedEmails.filter((e) => e.id !== email.id));
    await setters.loadAddresses(); // Refresh the sidebar addresses status
    setters.setShowToast(await t('toasts.emailRestored'));
  } catch (e: unknown) {
    logError(
      'restoreArchivedAddress error:',
      undefined,
      e instanceof Error ? e : new Error(String(e))
    );
    setters.setShowToast(await t('toasts.emailRestoreFailed'), 'error');
  }
}

export async function deleteArchivedEmail(
  _ext: Browser,
  email: Email,
  state: ArchivedState,
  setters: ArchivedSetters
) {
  try {
    const address = email.original_inbox || '';

    // Strip the compound UI prefix to recover the raw storage ID
    const rawId =
      address && email.id.startsWith(`${address}_`) ? email.id.slice(address.length + 1) : email.id;

    if (!address) {
      setters.setArchivedEmails(state.archivedEmails.filter((e) => e.id !== email.id));
      setters.setShowToast(await t('toasts.archivedEmailDeleted'));
      return;
    }

    const { archivedEmails = {}, storedEmails = {} } = await getEmailMaps();

    const archivedKey = resolveBagKey(archivedEmails, address);
    const archivedList = archivedEmails[archivedKey] || [];
    const updatedArchived = archivedList.filter((e) => e.id !== rawId);
    archivedEmails[archivedKey] = updatedArchived;
    if (updatedArchived.length === 0) {
      delete archivedEmails[archivedKey];
    }

    // One read of both maps: a second getEmailMaps() between the archive
    // mutation and the write could re-read a bag another flow just changed
    // and drop this delete on the floor (or resurrect a concurrent edit).
    await setLogicalEmailMaps(storedEmails, archivedEmails);
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
