import type { ToastType } from '@/components/feedback/Toast.svelte';
import { EmailService, loadProviderConfig } from '@/utils/email-service.js';
import { getErrorMessage } from '@/utils/errors.js';
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
    type?: ToastType
  ) => void;
  loadInboxes: (skipEmailSelection?: boolean) => Promise<void>;
  setDropdownOpen: (open: boolean) => void;
  setEditingAccount: (account: Account | null) => void;
  setEditEmailDialogOpen: (open: boolean) => void;
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
    const iconType = detectIconFromMessage(
      `Auto-extend ${newAutoExtendValue ? 'enabled' : 'disabled'} for ${account.address}`
    );
    setters.setShowToast({
      message: `Auto-extend ${newAutoExtendValue ? 'enabled' : 'disabled'} for ${account.address}`,
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

  // Capture pre-deletion state from the active accounts list (no archived)
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
    // Soft delete: mark as deleted instead of removing from storage
    const { inboxes = [] } = (await ext.storage.local.get(['inboxes'])) as { inboxes?: Account[] };
    const inboxIndex = inboxes.findIndex((i: Account) => i.id === acct.id);

    if (inboxIndex !== -1) {
      inboxes[inboxIndex] = { ...inboxes[inboxIndex], accountStatus: 'deleted' as const };
      await ext.storage.local.set({ inboxes });
    }

    await setters.loadInboxes();

    // Handle navigation after deletion — only if it was the active selected account
    if (wasActiveAndSelected) {
      const updatedInboxes = (await (await ext.storage.local.get(['inboxes']))?.inboxes) || [];
      const activeAccountsAfter = updatedInboxes.filter(
        (a: Account) => a.accountStatus !== 'archived' && a.accountStatus !== 'deleted'
      );
      const archivedAccounts = updatedInboxes.filter(
        (a: Account) => a.accountStatus === 'archived'
      );
      const deletedAccounts = updatedInboxes.filter((a: Account) => a.accountStatus === 'deleted');

      if (activeAccountsAfter.length > 0) {
        const nextCandidate =
          activeAccountsAfter[currentIndex] ?? activeAccountsAfter[currentIndex - 1];
        setters.setSelectedEmail(nextCandidate.address);
        setters.setEmails([]);
        setters.setDropdownOpen(true);
      } else if (
        (archivedAccounts.length > 0 || deletedAccounts.length > 0) &&
        setters.setArchivedSectionOpen
      ) {
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
    // If account was already inactive (archived→deleted), keep current view — no navigation needed
  } catch (error: unknown) {
    const msg = getErrorMessage(error);
    setters.setShowToast({ message: `Failed to delete inbox: ${msg}`, type: 'error' });
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
      const updatedInboxes = (await (await ext.storage.local.get(['inboxes']))?.inboxes) || [];
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

    setters.setShowToast({
      message: `Address ${account.address} archived`,
      type: 'success',
      icon: 'archived',
    });
  } catch (e) {
    logError('archiveAccount error:', e);
    setters.setShowToast({ message: 'Failed to archive', type: 'error' });
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
    logError('unarchiveAccount error:', e);
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
    logError('restoreAccount error:', e);
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

  if (canUnarchiveRule === true) {
    return true;
  } else if (canUnarchiveRule === 'ifNotExpired') {
    return account.status !== 'expired';
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
      setters.setShowToast('Extend functionality is not available for this provider', 'error');
      return;
    }

    setters.setShowToast('Extending email expiry...');

    const result = await ext.runtime.sendMessage({
      type: 'extendInbox',
      inboxId: account.id,
    });

    if (result.success) {
      await setters.loadInboxes();
      const iconType = detectIconFromMessage('Email expiry extended successfully');
      setters.setShowToast('Email expiry extended successfully', iconType);
    } else {
      setters.setShowToast('Failed to extend email expiry', 'error');
    }
  } catch (e) {
    logError('extendAccount error:', e);
    setters.setShowToast('Failed to extend email expiry', 'error');
  }
}

/**
 * Open the edit email dialog
 * @param account - Account to edit
 * @param setters - Management setter functions
 */
export function openEditEmailDialog(account: Account, setters: ManagementSetters) {
  setters.setEditingAccount(account);
  setters.setEditEmailDialogOpen(true);
}

/**
 * Close the edit email dialog
 * @param setters - Management setter functions
 */
export function closeEditEmailDialog(setters: ManagementSetters) {
  setters.setEditEmailDialogOpen(false);
  setters.setEditingAccount(null);
}

/**
 * Edit an account
 * @param ext - Browser extension API
 * @param account - Account to edit
 * @param setters - Management setter functions
 */
export async function editAccount(ext: Browser, account: Account, setters: ManagementSetters) {
  try {
    if (!(await canRenew(account.provider))) {
      setters.setShowToast('Edit functionality is not available for this provider', 'error');
      return;
    }

    const currentAddress = account.address;
    const _currentUser = currentAddress.split('@')[0];

    setters.setShowToast('Editing email address...');

    const result = await ext.runtime.sendMessage({
      type: 'editInbox',
      inboxId: account.id,
    });

    if (result.success) {
      await setters.loadInboxes();
      const iconType = detectIconFromMessage('Email address edited successfully');
      setters.setShowToast('Email address edited successfully', iconType);
    } else {
      setters.setShowToast('Failed to edit email address', 'error');
    }
  } catch (e) {
    logError('editAccount error:', e);
    setters.setShowToast('Failed to edit email address', 'error');
  }
}

/**
 * Edit an account's email address
 * @param account - Account to edit
 * @param setters - Management setter functions
 */
export async function editEmailAddress(account: Account, setters: ManagementSetters) {
  if (!(await canRenew(account.provider))) {
    setters.setShowToast('Edit functionality is not available for this provider', 'error');
    return;
  }

  openEditEmailDialog(account, setters);
}

/**
 * Handle saving email username
 * @param ext - Browser extension API
 * @param username - New username to save
 * @param account - Account being edited
 * @param setters - Management setter functions
 */
export async function handleSaveEmailUsername(
  ext: Browser,
  newUsername: string,
  editingAccount: Account | null,
  setters: ManagementSetters
) {
  if (!editingAccount) return;

  try {
    const config = loadProviderConfig(editingAccount.provider);

    // Check if provider supports setEmailUser operation
    if (!config.operations?.setEmailUser) {
      setters.setShowToast('Email username change not supported for this provider', 'error');
      return;
    }

    const currentAddress = editingAccount.address;
    const domain = currentAddress.split('@')[1];
    const newAddress = `${newUsername}@${domain}`;

    // Use EmailService to change email address
    const service = new EmailService(config, ext);
    const response = await service.executeOperation('setEmailUser', {
      auth: { token: editingAccount.sidToken as string },
      variables: { emailUser: newUsername },
    });

    if (response) {
      // Update inbox with new address
      const { inboxes = [] } = (await ext.storage.local.get(['inboxes'])) as {
        inboxes?: Account[];
      };
      const inboxIndex = inboxes.findIndex((i) => i.id === editingAccount!.id);
      if (inboxIndex !== -1) {
        inboxes[inboxIndex].address = newAddress;
        inboxes[inboxIndex].id = newAddress;
        await ext.storage.local.set({ inboxes });
      }

      // Reload inboxes
      await setters.loadInboxes();
      const iconType = detectIconFromMessage('Email address updated successfully');
      setters.setShowToast('Email address updated successfully', iconType);
      closeEditEmailDialog(setters);
    } else {
      setters.setShowToast('Failed to update email address', 'error');
    }
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);
    logError(
      'Error updating email address:',
      { account: editingAccount?.address, error: errorMessage },
      error instanceof Error ? error : new Error(errorMessage)
    );
    setters.setShowToast('Failed to update email address', 'error');
  }
}
