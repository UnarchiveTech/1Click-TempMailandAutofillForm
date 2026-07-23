import type { ToastType } from '@/components/feedback/Toast.svelte';
import { loadProviderConfig } from '@/utils/email-service.js';
import { getErrorMessage } from '@/utils/errors.js';
import { t } from '@/utils/i18n-utils.js';
import { detectIconFromMessage } from '@/utils/iconMapping.js';
import { logError } from '@/utils/logger.js';
import type { Account, Email } from '@/utils/types.js';

export interface ManagementState {
  selectedEmail: string;
  emails: Email[];
  loading: boolean;
}

export interface ManagementSetters {
  setSelectedEmail: (email: string) => void;
  setEmails: (emails: Email[]) => void;
  setLoading: (loading: boolean) => void;
  setShowToast: (
    toast:
      | {
          message: string;
          type?: ToastType;
          icon?: ToastType;
        }
      | string,
    type?: ToastType,
    undoAction?: (() => void | Promise<void>) | null
  ) => void;
  loadInboxes: (skipEmailSelection?: boolean) => Promise<void>;
  setDropdownOpen: (open: boolean) => void;
  setArchivedSectionOpen?: (open: boolean) => Promise<void>;
  showOnboarding?: () => void;
  setAllInboxes?: (inboxes: Account[] | ((prev: Account[]) => Account[])) => void;
}

/**
 * Toggle auto-extend for an account
 * @param ext - Browser extension API
 * @param account - Account to toggle auto-extend for
 * @param setters - Management setter functions
 */
export async function toggleAutoExtend(ext: Browser, account: Account, setters: ManagementSetters) {
  try {
    const result = (await ext.storage.local.get(['inboxes'])) as { inboxes?: Account[] };
    const inboxes = result.inboxes || [];
    const newAutoExtendValue = !account.autoExtend;
    const updated = inboxes.map((i: Account) =>
      i.id === account.id ? { ...i, autoExtend: newAutoExtendValue } : i
    );
    await ext.storage.local.set({ inboxes: updated });
    // Immediately update reactive state for UI reactivity using functional update to preserve computed fields
    if (setters.setAllInboxes) {
      setters.setAllInboxes((prev) =>
        prev.map((acc) =>
          acc.id === account.id ? { ...acc, autoExtend: newAutoExtendValue } : acc
        )
      );
    }
    await setters.loadInboxes(true);

    // Enabling auto-renew on an already-expired renewable address must renew now
    // (dismissing the renew strip previously left the flag on without extending).
    if (newAutoExtendValue) {
      const now = Date.now();
      const isExpired = account.expiresAt > 0 && account.expiresAt <= now;
      if (isExpired && (await canRenew(account.provider))) {
        try {
          setters.setShowToast(await t('toasts.extendingExpiry'));
          const renewResult = await ext.runtime.sendMessage({
            type: 'renewInbox',
            inboxId: account.id,
          });
          if (renewResult?.success) {
            await setters.loadInboxes(true);
            setters.setShowToast({
              message: await t('toasts.autoExtendRenewed', { address: account.address }),
              type: 'success',
            });
            return;
          }
          setters.setShowToast({
            message: await t('toasts.autoExtendRenewFailed', { address: account.address }),
            type: 'warning',
          });
          return;
        } catch (renewErr) {
          logError(
            'toggleAutoExtend renew error:',
            undefined,
            renewErr instanceof Error ? renewErr : new Error(String(renewErr))
          );
          setters.setShowToast({
            message: await t('toasts.autoExtendRenewFailed', { address: account.address }),
            type: 'warning',
          });
          return;
        }
      }
    }

    const toggleMsg = newAutoExtendValue
      ? await t('toasts.autoExtendEnabled', { address: account.address })
      : await t('toasts.autoExtendDisabled', { address: account.address });
    const iconType = detectIconFromMessage(toggleMsg);
    setters.setShowToast({
      message: toggleMsg,
      type: iconType,
    });
  } catch (_e) {
    setters.setShowToast({ message: 'Failed to toggle auto-extend', type: 'error' });
  }
}

/**
 * Remove an account from storage
 * @param ext - Browser extension API
 * @param account - Account to remove
 * @param state - Management state
 * @param setters - Management setter functions
 */
export async function removeAccount(
  ext: Browser,
  account: Account,
  state: ManagementState,
  setters: ManagementSetters
) {
  const acct = account;
  if (!acct) return;

  // Capture pre-deletion state from the active accounts list.
  const { inboxes: allAccounts = [] } = (await ext.storage.local.get(['inboxes'])) as {
    inboxes?: Account[];
  };
  const activeAccountsBefore = allAccounts.filter(
    (a: Account) => a.accountStatus !== 'archived' && a.accountStatus !== 'deleted'
  );
  const currentIndex = activeAccountsBefore.findIndex((a: Account) => a.address === acct.address);
  // Only navigate if the account being deleted was active (not already archived/deleted)
  const wasActiveAndSelected =
    state.selectedEmail === acct.address &&
    acct.accountStatus !== 'archived' &&
    acct.accountStatus !== 'deleted';

  try {
    const storageSnapshot = (await ext.storage.local.get([
      'inboxes',
      'storedEmails',
      'archivedEmails',
      'readEmails',
      'starredEmails',
      'seenEmailIds',
      'lastMessageTimestamps',
    ])) as {
      inboxes?: Account[];
      storedEmails?: Record<string, Email[]>;
      archivedEmails?: Record<string, Email[]>;
      readEmails?: Record<string, boolean>;
      starredEmails?: string[];
      seenEmailIds?: Record<string, string[]>;
      lastMessageTimestamps?: Record<string, number>;
    };

    const result = await ext.runtime.sendMessage({
      type: 'deleteInbox',
      inboxId: acct.id,
      preserveEmails: false,
    });

    if (!result?.success) {
      throw new Error(result?.error || 'Delete failed');
    }

    await setters.loadInboxes();

    // Handle navigation after deletion - only if it was the active selected account
    if (wasActiveAndSelected) {
      const { inboxes: updatedInboxes = [] } = (await ext.storage.local.get(['inboxes'])) as {
        inboxes?: Account[];
      };
      const activeAccountsAfter = updatedInboxes.filter(
        (a: Account) => a.accountStatus !== 'archived' && a.accountStatus !== 'deleted'
      );
      const archivedAccounts = updatedInboxes.filter(
        (a: Account) => a.accountStatus === 'archived' || a.accountStatus === 'deleted'
      );

      if (activeAccountsAfter.length > 0) {
        const nextCandidate =
          activeAccountsAfter[currentIndex] ?? activeAccountsAfter[currentIndex - 1];
        setters.setSelectedEmail(nextCandidate.address);
        setters.setEmails([]);
        setters.setDropdownOpen(true);
      } else if (archivedAccounts.length > 0 && setters.setArchivedSectionOpen) {
        // No active accounts left - open dropdown showing inactive tab
        setters.setSelectedEmail('');
        setters.setEmails([]);
        await setters.setArchivedSectionOpen(true);
      } else if (setters.showOnboarding) {
        // No accounts at all - show onboarding
        setters.setSelectedEmail('');
        setters.setEmails([]);
        setters.setDropdownOpen(false);
        setters.showOnboarding();
      } else {
        setters.setSelectedEmail('');
        setters.setEmails([]);
        setters.setDropdownOpen(true);
      }
    }
    // If account was already inactive (archived→deleted), keep current view - no navigation needed
    setters.setShowToast(
      { message: `Address ${acct.address} deleted`, type: 'success', icon: 'deleted' },
      undefined,
      async () => {
        const current = (await ext.storage.local.get([
          'inboxes',
          'storedEmails',
          'archivedEmails',
          'readEmails',
          'starredEmails',
          'seenEmailIds',
          'lastMessageTimestamps',
        ])) as {
          inboxes?: Account[];
          storedEmails?: Record<string, Email[]>;
          archivedEmails?: Record<string, Email[]>;
          readEmails?: Record<string, boolean>;
          starredEmails?: string[];
          seenEmailIds?: Record<string, string[]>;
          lastMessageTimestamps?: Record<string, number>;
        };

        const restoredInboxes = current.inboxes || [];
        if (!restoredInboxes.some((inbox) => inbox.id === acct.id)) {
          const originalAccount =
            storageSnapshot.inboxes?.find((inbox) => inbox.id === acct.id) || acct;
          restoredInboxes.push(originalAccount);
        }

        const storedEmails = current.storedEmails || {};
        const archivedEmails = current.archivedEmails || {};
        if (storageSnapshot.storedEmails?.[acct.address]) {
          storedEmails[acct.address] = storageSnapshot.storedEmails[acct.address];
        }
        if (storageSnapshot.archivedEmails?.[acct.address]) {
          archivedEmails[acct.address] = storageSnapshot.archivedEmails[acct.address];
        }

        const seenEmailIds = current.seenEmailIds || {};
        if (storageSnapshot.seenEmailIds?.[acct.address]) {
          seenEmailIds[acct.address] = storageSnapshot.seenEmailIds[acct.address];
        }

        const lastMessageTimestamps = current.lastMessageTimestamps || {};
        if (storageSnapshot.lastMessageTimestamps?.[acct.id] !== undefined) {
          lastMessageTimestamps[acct.id] = storageSnapshot.lastMessageTimestamps[acct.id];
        }

        await ext.storage.local.set({
          inboxes: restoredInboxes,
          storedEmails,
          archivedEmails,
          readEmails: storageSnapshot.readEmails || current.readEmails || {},
          starredEmails: storageSnapshot.starredEmails || current.starredEmails || [],
          seenEmailIds,
          lastMessageTimestamps,
        });
        await setters.loadInboxes(true);
        setters.setShowToast(await t('toasts.deleteUndone'));
      }
    );
  } catch (error: unknown) {
    const msg = getErrorMessage(error);
    setters.setShowToast({
      message: await t('toasts.deleteInboxFailed', { msg }),
      type: 'error',
    });
  }
}

/**
 * Archive an account
 * @param ext - Browser extension API
 * @param account - Account to archive
 * @param _accounts - List of all accounts (unused)
 * @param state - Management state
 * @param setters - Management setter functions
 */
export async function archiveAccount(
  ext: Browser,
  account: Account,
  _accounts: Account[],
  state: ManagementState,
  setters: ManagementSetters
) {
  try {
    // Only navigate if account was active before archiving (not already deleted→archived)
    const wasActiveAndSelected =
      state.selectedEmail === account.address && account.accountStatus !== 'deleted';
    await ext.runtime.sendMessage({ type: 'archiveInbox', inboxId: account.id });
    await setters.loadInboxes();

    // If the active selected account was archived, navigate to next active account
    if (wasActiveAndSelected) {
      const { inboxes: updatedInboxes = [] } = (await ext.storage.local.get(['inboxes'])) as {
        inboxes?: Account[];
      };
      const activeAccounts = updatedInboxes.filter(
        (a: Account) => a.accountStatus !== 'archived' && a.accountStatus !== 'deleted'
      );

      if (activeAccounts.length > 0) {
        setters.setSelectedEmail(activeAccounts[0].address);
        setters.setDropdownOpen(true);
      } else {
        setters.setSelectedEmail('');
        if (setters.setArchivedSectionOpen) {
          await setters.setArchivedSectionOpen(true);
        } else {
          setters.setDropdownOpen(true);
        }
      }
    }
    // If already inactive (deleted→archived), keep current view as-is

    setters.setShowToast(
      {
        message: await t('toasts.addressArchived', { address: account.address }),
        type: 'success',
        icon: 'archived',
      },
      undefined,
      async () => {
        await ext.runtime.sendMessage({ type: 'unarchiveInbox', inboxId: account.id });
        await setters.loadInboxes(true);
        setters.setShowToast(await t('toasts.archiveUndone'));
      }
    );
  } catch (e) {
    logError('archiveAccount error:', undefined, e instanceof Error ? e : new Error(String(e)));
    setters.setShowToast({ message: await t('toasts.archiveFailed'), type: 'error' });
  }
}

/**
 * Unarchive an account
 * @param ext - Browser extension API
 * @param account - Account to unarchive
 * @param setters - Management setter functions
 */
export async function unarchiveAccount(ext: Browser, account: Account, setters: ManagementSetters) {
  try {
    await ext.runtime.sendMessage({ type: 'unarchiveInbox', inboxId: account.id });
    await setters.loadInboxes();
    // Switch back to live tab
    if (setters.setArchivedSectionOpen) {
      await setters.setArchivedSectionOpen(false);
    }
    const iconType = detectIconFromMessage(`Address ${account.address} unarchived`);
    setters.setShowToast({
      message: `Address ${account.address} unarchived`,
      type: iconType,
    });
  } catch (e) {
    logError('unarchiveAccount error:', undefined, e instanceof Error ? e : new Error(String(e)));
    setters.setShowToast({ message: 'Failed to unarchive', type: 'error' });
  }
}

/**
 * Restore a deleted account
 * @param ext - Browser extension API
 * @param account - Account to restore
 * @param setters - Management setter functions
 */
export async function restoreAccount(ext: Browser, account: Account, setters: ManagementSetters) {
  try {
    await ext.runtime.sendMessage({ type: 'restoreInbox', inboxId: account.id });
    await setters.loadInboxes();
    // Switch back to live tab
    if (setters.setArchivedSectionOpen) {
      await setters.setArchivedSectionOpen(false);
    }
    const iconType = detectIconFromMessage(`Address ${account.address} restored`);
    setters.setShowToast({
      message: `Address ${account.address} restored`,
      type: iconType,
    });
  } catch (e) {
    logError('restoreAccount error:', undefined, e instanceof Error ? e : new Error(String(e)));
    setters.setShowToast({ message: 'Failed to restore', type: 'error' });
  }
}

/**
 * Check if an account can be unarchived
 * @param account - Account to check
 * @returns true if the account can be unarchived
 */
export function canUnarchive(account: Account): boolean {
  const config = loadProviderConfig(account.provider);
  const canUnarchiveRule = config.ui?.canUnarchive;

  if (canUnarchiveRule === 'ifNotExpired') {
    const isExpired = account.expiresAt > 0 && account.expiresAt <= Date.now();
    const currentStatus = account.status || account.accountStatus;
    return currentStatus !== 'expired' && !isExpired;
  } else if (canUnarchiveRule) {
    return true;
  }
  return false;
}

async function canRenew(providerId: string): Promise<boolean> {
  const config = loadProviderConfig(providerId);
  return config.expiry?.renewable || false;
}

/**
 * Extend an account's expiry time
 * @param ext - Browser extension API
 * @param account - Account to extend
 * @param setters - Management setter functions
 */
export async function extendAccount(ext: Browser, account: Account, setters: ManagementSetters) {
  try {
    if (!(await canRenew(account.provider))) {
      setters.setShowToast(await t('toasts.extendNotAvailable'), 'error');
      return;
    }

    setters.setShowToast(await t('toasts.extendingExpiry'));

    const result = await ext.runtime.sendMessage({
      type: 'renewInbox',
      inboxId: account.id,
    });

    if (result.success) {
      await setters.loadInboxes();
      const successMsg = await t('toasts.expiryExtended');
      const iconType = detectIconFromMessage(successMsg);
      setters.setShowToast(successMsg, iconType);
    } else {
      setters.setShowToast(await t('toasts.expiryExtendFailed'), 'error');
    }
  } catch (e) {
    logError('extendAccount error:', undefined, e instanceof Error ? e : new Error(String(e)));
    setters.setShowToast(await t('toasts.expiryExtendFailed'), 'error');
  }
}
