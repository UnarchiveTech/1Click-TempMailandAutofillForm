import type { QueuedReadStateOp } from '@/features/address/address-actions.js';
import { computeUnreadCounts } from '@/utils/email/email-mapper.js';
import type { TranslateFn } from '@/utils/i18n/i18n-utils.js';
import { logDebug, logError } from '@/utils/logger.js';
import {
  getEmailStorageMetadata,
  getReadEmailsMap,
  getStoredEmailsMap,
  isEmailRead,
  refreshEmailStorageMetadataForAddress,
  refreshEmailStorageMetadataForAddresses,
  resolveBagKey,
  setEmailReadState,
} from '@/utils/storage/storage-keys.js';
import type { Address, Email } from '@/utils/types.js';

export interface MailboxReadStateDeps {
  ext: Browser;
  getSelectedEmail: () => string;
  getAccounts: () => Address[];
  getAllAddresses: () => Address[];
  getEmails: () => Email[];
  setEmails: (emails: Email[]) => void;
  getUnreadByAddress: () => Record<string, number>;
  setUnreadByAddress: (counts: Record<string, number>) => void;
  persistQueuedReadState: (emailId: string, addresses: string[], read: boolean) => Promise<void>;
  archiveOnRead?: (email: Email) => Promise<void>;
}

/**
 * Find an address record by its email, case-insensitively, preferring the
 * live accounts list over the full (archived/deleted-inclusive) list.
 */
export function findAddressByEmail(
  accounts: Address[],
  allAddresses: Address[],
  address: string
): Address | undefined {
  const lower = (address || '').trim().toLowerCase();
  if (!lower) return undefined;
  return (
    accounts.find((a) => (a.address || '').trim().toLowerCase() === lower) ||
    allAddresses.find((a) => (a.address || '').trim().toLowerCase() === lower)
  );
}

export interface MailboxStateProjection {
  storedEmails: Record<string, Email[]>;
  unreadByAddress: Record<string, number>;
  allAddresses: Address[];
  accounts: Address[];
}

export function projectStoredEmailMetadata(
  storedEmails: Record<string, Email[]>,
  readEmails: Record<string, boolean>,
  allAddresses: Address[],
  accounts: Address[]
): MailboxStateProjection {
  const withReceivedCounts = (records: Address[]) =>
    records.map((record) => ({
      ...record,
      received: (storedEmails[resolveBagKey(storedEmails, record.address)] || []).length,
    }));

  return {
    storedEmails,
    unreadByAddress: computeUnreadCounts(storedEmails, readEmails),
    allAddresses: withReceivedCounts(allAddresses),
    accounts: withReceivedCounts(accounts),
  };
}

export function resolveUnreadBadgeKey(
  unreadByAddress: Record<string, number>,
  address: string
): string {
  if (!address || unreadByAddress[address] !== undefined) return address;
  const lower = address.toLowerCase();
  return Object.keys(unreadByAddress).find((key) => key.toLowerCase() === lower) ?? address;
}

export async function persistEmailRead(deps: MailboxReadStateDeps, email: Email): Promise<boolean> {
  try {
    const readEmails = await getReadEmailsMap();
    const inboxAddress = email.original_inbox || deps.getSelectedEmail();
    const wasUnread = !isEmailRead(readEmails, email.id, inboxAddress);
    const addresses = [inboxAddress];
    setEmailReadState(readEmails, email.id, addresses, true);
    await deps.persistQueuedReadState(email.id, addresses, true);

    await refreshEmailStorageMetadataForAddress(
      findAddressByEmail(deps.getAccounts(), deps.getAllAddresses(), inboxAddress)?.id || '',
      inboxAddress,
      readEmails
    );

    if (wasUnread) {
      try {
        const { automationRules } = (await deps.ext.storage.local.get(['automationRules'])) as {
          automationRules?: { autoArchiveOnRead?: boolean };
        };
        // Tally via the background's recordEmailRead handler, which increments
        // under analytics_lock. A bare get→set here would race the background's
        // locked poll-time tally (processNewMessages) and clobber its deltas
        // with a stale copy of the analytics object.
        await deps.ext.runtime.sendMessage({ type: 'recordEmailRead' });
        if (automationRules?.autoArchiveOnRead && deps.archiveOnRead) {
          await deps.archiveOnRead(email);
        }
      } catch (error) {
        logDebug('Failed to update email-read analytics or auto-archive on read', error);
      }
    }
  } catch (error) {
    logError('Failed to persist email read state', error);
    return false;
  }
  return true;
}

export async function persistEmailUnread(
  deps: MailboxReadStateDeps,
  email: Email
): Promise<boolean> {
  try {
    const readEmails = await getReadEmailsMap();
    const inboxAddress = email.original_inbox || deps.getSelectedEmail();
    const addresses = [inboxAddress];
    setEmailReadState(readEmails, email.id, addresses, false);
    await deps.persistQueuedReadState(email.id, addresses, false);
    await refreshEmailStorageMetadataForAddress(
      findAddressByEmail(deps.getAccounts(), deps.getAllAddresses(), inboxAddress)?.id || '',
      inboxAddress,
      readEmails
    );
  } catch (error) {
    logError('Failed to persist email unread state', error);
    return false;
  }
  return true;
}

export async function markOtpEmailRead(deps: MailboxReadStateDeps, otp: string): Promise<boolean> {
  const otpEmail = deps.getEmails().find((email) => email.otp === otp && email.unread);
  if (!otpEmail) return true;
  deps.setEmails(
    deps
      .getEmails()
      .map((email) => (email.id === otpEmail.id ? { ...email, unread: false } : email))
  );
  const persisted = await persistEmailRead(deps, otpEmail);
  if (!persisted) {
    // Storage write failed - revert the optimistic update so the row does
    // not lie about being read (matched by id against the live list, so a
    // concurrent refresh that already replaced the row is left alone).
    // The badge decrement below stays success-only.
    deps.setEmails(
      deps
        .getEmails()
        .map((email) => (email.id === otpEmail.id ? { ...email, unread: true } : email))
    );
    return false;
  }

  const badgeAddress = otpEmail.original_inbox || deps.getSelectedEmail();
  if (badgeAddress) {
    const unreadByAddress = deps.getUnreadByAddress();
    const badgeKey = resolveUnreadBadgeKey(unreadByAddress, badgeAddress);
    const unreadCount = unreadByAddress[badgeKey] ?? 0;
    if (unreadCount > 0) {
      deps.setUnreadByAddress({
        ...unreadByAddress,
        [badgeKey]: unreadCount - 1,
      });
    }
  }
  return true;
}

export async function refreshUnreadCounts(
  deps: MailboxReadStateDeps,
  applyStoredMetadata: (stored: Record<string, Email[]>, read: Record<string, boolean>) => void
): Promise<boolean> {
  try {
    const { readEmails = {} } = (await deps.ext.storage.local.get(['readEmails'])) as {
      readEmails?: Record<string, boolean>;
    };
    const metadata = await getEmailStorageMetadata();
    const accounts = deps.getAccounts();
    if (accounts.every((record) => metadata[record.id])) {
      deps.setUnreadByAddress(
        Object.fromEntries(
          accounts.map((record) => [record.address, metadata[record.id]?.unreadCount ?? 0])
        )
      );
      return true;
    }
    applyStoredMetadata(await getStoredEmailsMap(), readEmails);
    return true;
  } catch (error) {
    logError('Failed to update unread inbox counts', error);
    return false;
  }
}

export interface MarkReadUnreadDeps {
  ext: Browser;
  getStoredEmails: () => Record<string, Email[]>;
  showToast: (message: string, type?: string) => void;
  getTranslation: TranslateFn;
  /**
   * Read-state queue (owned by address-actions). Injected rather than imported
   * because address-actions already imports from this module - a direct import
   * would be a cycle. Routing bulk writes through the queue keeps them ordered
   * with the debounced single-read flush instead of racing it.
   */
  queueReadStates: (ops: QueuedReadStateOp[]) => void;
  flushReadStates: () => Promise<void>;
}

/**
 * Mark every stored message for a set of addresses read or unread (bulk).
 * Refreshes the compact per-address metadata afterwards so unread-count
 * reads stay correct without a full reload.
 */
export async function markAddressesReadUnread(
  deps: MarkReadUnreadDeps,
  targets: Address[],
  read: boolean
): Promise<void> {
  const accounts = targets.filter((a): a is Address => Boolean(a?.address));
  if (accounts.length === 0) return;
  try {
    const storedEmails = deps.getStoredEmails();
    const ops: QueuedReadStateOp[] = [];
    for (const acc of accounts) {
      const bagKey = resolveBagKey(storedEmails, acc.address);
      for (const email of storedEmails[bagKey] || []) {
        ops.push({
          emailId: email.id,
          casings: [bagKey, acc.address, email.original_inbox],
          read,
        });
      }
    }
    // Queue, then flush BEFORE the metadata refresh and toast: the refresh
    // must read the map this write just landed in, and the toast must not
    // promise state that is still sitting in a debounce timer.
    deps.queueReadStates(ops);
    await deps.flushReadStates();
    const readEmails = await getReadEmailsMap();
    // One locked pass + one metadata write for the whole batch instead of one
    // lease acquire + metadata read/write per address (write amplification on
    // large mark-all-read selections).
    await refreshEmailStorageMetadataForAddresses(
      readEmails,
      accounts.map((acc) => ({ addressId: acc.id, address: acc.address }))
    );
    deps.showToast(
      deps.getTranslation(read ? 'addressView.markAllRead' : 'addressView.markAllUnread'),
      'success'
    );
  } catch (error) {
    logError('Failed to mark addresses read/unread', error);
    deps.showToast(deps.getTranslation('toasts.operationFailed'), 'error');
  }
}
