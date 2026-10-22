import type { ToastType } from '@/ui/blocks/feedback/toast-types.js';
import { loadProviderConfig, tryLoadProviderConfig } from '@/utils/email/email-service.js';
// loadProviderConfig kept for canRenew and other call sites below
import { renderResultError } from '@/utils/errors.js';
import { t, tSync } from '@/utils/i18n/i18n-utils.js';
import { logError } from '@/utils/logger.js';
import { withAddressLock } from '@/utils/mutex.js';
import { getAddresses, setAddresses } from '@/utils/storage/storage-keys.js';
import {
  captureStorageSnapshot,
  restoreStorageSnapshot,
} from '@/utils/storage/storage-snapshot.js';
import type { Address, Email } from '@/utils/types.js';
import { isUndoCurrent, markAddressMutation } from './undo-generation.js';

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
  loadAddresses: (skipEmailSelection?: boolean) => Promise<void>;
  /** Select an inbox through the normal mailbox-loading path after archiving the active one. */
  selectAddress?: (address: string) => Promise<void>;
  setDropdownOpen: (open: boolean) => void;
  setArchivedSectionOpen?: (open: boolean) => Promise<void>;
  showOnboarding?: () => void;
  setAllAddresses?: (addresses: Address[] | ((prev: Address[]) => Address[])) => void;
}

/**
 * Retry fields describe the previous retry lane. A toggle in either direction
 * starts a fresh lifecycle decision; enabling a previously dormant archived
 * inbox must not inherit an expired backoff deadline.
 *
 * The stored renewal-failure streak describes a retry that will never happen.
 * Leaving it behind (a) keeps the "retrying in X" banner promising a retry the
 * background will not make - `expiry-manager` and `expiry-alarms` both gate
 * every retry on `autoExtend`, so the timestamp is inert there, but re-enabling
 * must not delay the first renewal by an old backoff deadline.
 */
function autoRenewTransitionReset(): Partial<Address> {
  return { renewalFailCount: 0, lastFailureAt: undefined, nextRetryAt: undefined };
}

/**
 * Toggle auto-extend for an account
 * @param ext - Browser extension API
 * @param account - Address to toggle auto-extend for
 * @param setters - Management setter functions
 */
export async function toggleAutoExtend(
  ext: Browser,
  account: Address,
  setters: ManagementSetters,
  archivedRenewalDisposition?: 'unarchive' | 'keep-archived'
) {
  try {
    // The toggle read-modify-write runs inside the address lock - H-2: this
    // is the one management action that still wrote storage directly instead
    // of routing through a (locked) background handler, so a rapid
    // double-toggle or a concurrent expiry-manager renewal could interleave
    // and last-write-wins (toggle reverted).
    const { currentAddress, newAutoExtendValue } = await withAddressLock(async () => {
      const addresses = await getAddresses();
      // UI account objects are sometimes stale (and may come from the raw
      // encrypted storage snapshot). Use the freshly decrypted record for the
      // expiry/provider decision so every toggle surface behaves identically.
      const currentAddress = addresses.find((i) => i.id === account.id) || account;
      const newAutoExtendValue = !currentAddress.autoExtend;
      const updated = addresses.map((i: Address) =>
        i.id === currentAddress.id
          ? {
              ...i,
              autoExtend: newAutoExtendValue,
              ...autoRenewTransitionReset(),
              ...(newAutoExtendValue &&
              i.accountStatus === 'archived' &&
              i.archiveReason === 'manual'
                ? { unarchiveAfterRenewal: archivedRenewalDisposition === 'unarchive' }
                : { unarchiveAfterRenewal: undefined }),
            }
          : i
      );
      await setAddresses(updated);
      return { currentAddress, newAutoExtendValue };
    });
    // Immediately update reactive state for UI reactivity using functional update to preserve computed fields
    if (setters.setAllAddresses) {
      setters.setAllAddresses((prev) =>
        prev.map((acc) =>
          acc.id === currentAddress.id ? { ...acc, autoExtend: newAutoExtendValue } : acc
        )
      );
    }
    await setters.loadAddresses(true);

    // Enabling auto-renew on an already-expired renewable address must renew now
    // (dismissing the renew strip previously left the flag on without extending).
    if (newAutoExtendValue) {
      const now = Date.now();
      const isNearingOrExpired =
        currentAddress.expiresAt > 0 &&
        (currentAddress.expiresAt <= now || currentAddress.expiresAt - now <= 10 * 60 * 1000);
      if (isNearingOrExpired && (await canRenew(currentAddress.provider))) {
        try {
          setters.setShowToast(await t('toasts.extendingExpiry'));
          const renewResult = await ext.runtime.sendMessage({
            type: 'renewAddress',
            addressId: currentAddress.id,
          });
          if (renewResult?.success) {
            await setters.loadAddresses(true);
            setters.setShowToast({
              message: await t('toasts.autoExtendRenewed', { address: currentAddress.address }),
              type: 'success',
            });
            return;
          }
          setters.setShowToast({
            message: await t('toasts.autoExtendRenewFailed', { address: currentAddress.address }),
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
            message: await t('toasts.autoExtendRenewFailed', { address: currentAddress.address }),
            type: 'warning',
          });
          return;
        }
      }
    }

    const toggleMsg = newAutoExtendValue
      ? await t('toasts.autoExtendEnabled', { address: currentAddress.address })
      : await t('toasts.autoExtendDisabled', { address: currentAddress.address });
    setters.setShowToast({
      message: toggleMsg,
      type: 'auto-renew',
    });
  } catch (error) {
    logError(
      'toggleAutoExtend error:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
    setters.setShowToast({ message: await t('toasts.autoExtendToggleFailed'), type: 'error' });
  }
}

/**
 * Apply an auto-extend value to every non-deleted address (global backfill).
 * Archived addresses are included so users can explicitly re-enable renewal
 * from Settings; deleted addresses remain excluded.
 * Read-modify-writes under the address lock like toggleAutoExtend, mirrors
 * the result into reactive state, then reloads with skipEmailSelection so the
 * toggle-pattern selection behavior is preserved.
 * @param value - Auto-extend value to apply
 * @param setters - Management setter functions
 * @returns Number of addresses changed (0 = no write, no toast)
 */
export async function applyAutoRenewToAll(
  value: boolean,
  setters: ManagementSetters
): Promise<number> {
  const { changedIds, changed } = await withAddressLock(async () => {
    const addresses = await getAddresses();
    const targets = addresses.filter(
      (a) => a.accountStatus !== 'deleted' && a.autoExtend !== value
    );
    if (targets.length === 0) return { changedIds: new Set<string>(), changed: 0 };
    const changedIds = new Set(targets.map((a) => a.id));
    const updated = addresses.map((a) =>
      changedIds.has(a.id) ? { ...a, autoExtend: value, ...autoRenewTransitionReset() } : a
    );
    await setAddresses(updated);
    return { changedIds, changed: targets.length };
  });
  if (changed === 0) return 0;
  // Immediately update reactive state for UI reactivity using functional update to preserve computed fields
  if (setters.setAllAddresses) {
    setters.setAllAddresses((prev) =>
      prev.map((acc) => (changedIds.has(acc.id) ? { ...acc, autoExtend: value } : acc))
    );
  }
  await setters.loadAddresses(true);
  const backfillMsg = value
    ? await t('toasts.autoRenewBackfillEnabled', { count: changed })
    : await t('toasts.autoRenewBackfillDisabled', { count: changed });
  setters.setShowToast({ message: backfillMsg, type: 'success' });
  return changed;
}

/**
 * Remove an account from storage
 * @param ext - Browser extension API
 * @param account - Address to remove
 * @param state - Management state
 * @param setters - Management setter functions
 */
export async function removeAddress(
  ext: Browser,
  account: Address,
  state: ManagementState,
  setters: ManagementSetters
) {
  const acct = account;
  if (!acct) return;

  // Capture pre-deletion state from the active accounts list.
  const { addresses: allAddresses = [] } = (await ext.storage.local.get(['addresses'])) as {
    addresses?: Address[];
  };
  const activeAddressesBefore = allAddresses.filter(
    (a: Address) => a.accountStatus !== 'archived' && a.accountStatus !== 'deleted'
  );
  const currentIndex = activeAddressesBefore.findIndex((a: Address) => a.address === acct.address);
  // Only navigate if the account being deleted was active (not already archived/deleted)
  const wasActiveAndSelected =
    state.selectedEmail === acct.address &&
    acct.accountStatus !== 'archived' &&
    acct.accountStatus !== 'deleted';

  try {
    const storageSnapshot = await captureStorageSnapshot(ext);

    const result = await ext.runtime.sendMessage({
      type: 'deleteAddress',
      addressId: acct.id,
      preserveEmails: false,
    });

    if (!result?.success) {
      // The background rejects a stale addressId with a stable `errors.*` code;
      // when there is no specific reason, the localized failure copy wins.
      logError('removeAddress rejected by background', {
        addressId: acct.id,
        error: result?.error,
      });
      setters.setShowToast({
        message: renderResultError(result?.error, tSync, 'toasts.deleteAddressFailed'),
        type: 'error',
      });
      return;
    }

    // The delete landed, so this undo describes the newest lifecycle state -
    // and every undo offered before it stops being able to overwrite it.
    const revision = await markAddressMutation();
    await setters.loadAddresses();

    // Handle navigation after deletion - only if it was the active selected account
    if (wasActiveAndSelected) {
      const { addresses: updatedAddresses = [] } = (await ext.storage.local.get(['addresses'])) as {
        addresses?: Address[];
      };
      const activeAddressesAfter = updatedAddresses.filter(
        (a: Address) => a.accountStatus !== 'archived' && a.accountStatus !== 'deleted'
      );
      const archivedAddresses = updatedAddresses.filter(
        (a: Address) => a.accountStatus === 'archived' || a.accountStatus === 'deleted'
      );

      if (activeAddressesAfter.length > 0) {
        const nextCandidate =
          activeAddressesAfter[currentIndex] ?? activeAddressesAfter[currentIndex - 1];
        setters.setSelectedEmail(nextCandidate.address);
        setters.setEmails([]);
        setters.setDropdownOpen(true);
      } else if (archivedAddresses.length > 0 && setters.setArchivedSectionOpen) {
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
      {
        message: await t('toasts.addressDeleted', { address: acct.address }),
        type: 'success',
        icon: 'deleted',
      },
      undefined,
      async () => {
        // A newer delete / archive / restore landed while this toast was on
        // screen: this undo restores a pre-delete snapshot of the mailbox
        // surface, so running it would walk that newer work back.
        if (!(await isUndoCurrent(revision))) {
          setters.setShowToast({ message: await t('toasts.undoSuperseded'), type: 'warning' });
          return;
        }
        // Keep single-address undo on the same restore path as bulk undo. This
        // ensures future fixes for ID-keyed bags, casing drift, read state, and
        // schema synchronization apply consistently to both actions.
        const originalAddress =
          storageSnapshot.addresses?.find((record) => record.id === acct.id) || acct;
        await restoreStorageSnapshot(ext, storageSnapshot, [originalAddress]);
        await setters.loadAddresses(true);
        setters.setShowToast(await t('toasts.deleteUndone'));
      }
    );
  } catch (error: unknown) {
    logError(
      'removeAddress error:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
    setters.setShowToast({
      message: await t('toasts.deleteAddressFailed'),
      type: 'error',
    });
  }
}

/**
 * Archive an account
 * @param ext - Browser extension API
 * @param account - Address to archive
 * @param _accounts - List of all accounts (unused)
 * @param state - Management state
 * @param setters - Management setter functions
 */
export async function archiveAddress(
  ext: Browser,
  account: Address,
  _accounts: Address[],
  state: ManagementState,
  setters: ManagementSetters
) {
  try {
    // Only navigate if account was active before archiving (not already deleted→archived)
    const wasActiveAndSelected =
      state.selectedEmail === account.address && account.accountStatus !== 'deleted';
    const result = await ext.runtime.sendMessage({ type: 'archiveAddress', addressId: account.id });
    if (!result?.success) {
      // success:false (e.g. stale addressId deleted in another window) - never
      // show the archived-success toast / undo for a rejected archive. The
      // background's `errors.*` code, when present, is more specific
      // ("Address not found") than the generic failure copy.
      setters.setShowToast({
        message: renderResultError(result?.error, tSync, 'toasts.archiveFailed'),
        type: 'error',
      });
      return;
    }
    const previousAutoExtend =
      typeof result.previousAutoExtend === 'boolean'
        ? result.previousAutoExtend
        : account.autoExtend === true;
    await setters.loadAddresses();
    // The archive landed: a pending delete undo still holds this inbox as
    // active in its snapshot, so it must not run any more.
    const revision = await markAddressMutation();

    // If the active selected account was archived, navigate to next active account
    if (wasActiveAndSelected) {
      const { addresses: updatedAddresses = [] } = (await ext.storage.local.get(['addresses'])) as {
        addresses?: Address[];
      };
      const activeAddresses = updatedAddresses.filter(
        (a: Address) => a.accountStatus !== 'archived' && a.accountStatus !== 'deleted'
      );

      if (activeAddresses.length > 0) {
        const nextAddress = activeAddresses[0].address;
        if (setters.selectAddress) {
          await setters.selectAddress(nextAddress);
        } else {
          // Keep standalone callers coherent if they do not own mailbox loading.
          setters.setSelectedEmail(nextAddress);
        }
        // selectAddress can close the selector as part of its normal UI callback.
        // Reopen it after selection so the user can see the archived inbox state.
        setters.setDropdownOpen(true);
      } else {
        setters.setSelectedEmail('');
        setters.setEmails([]);
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
        if (!(await isUndoCurrent(revision))) {
          setters.setShowToast({ message: await t('toasts.undoSuperseded'), type: 'warning' });
          return;
        }
        const undoResult = await ext.runtime.sendMessage({
          type: 'unarchiveAddress',
          addressId: account.id,
          restoreAutoExtend: previousAutoExtend,
        });
        if (!undoResult?.success) {
          setters.setShowToast({
            message: renderResultError(undoResult?.error, tSync, 'toasts.unarchiveFailed'),
            type: 'error',
          });
          return;
        }
        await setters.loadAddresses(true);
        setters.setShowToast(await t('toasts.archiveUndone'));
      }
    );
  } catch (e) {
    logError('archiveAddress error:', undefined, e instanceof Error ? e : new Error(String(e)));
    setters.setShowToast({ message: await t('toasts.archiveFailed'), type: 'error' });
  }
}

/**
 * Unarchive an account
 * @param ext - Browser extension API
 * @param account - Address to unarchive
 * @param setters - Management setter functions
 */
export async function unarchiveAddress(ext: Browser, account: Address, setters: ManagementSetters) {
  try {
    const result = await ext.runtime.sendMessage({
      type: 'unarchiveAddress',
      addressId: account.id,
    });
    if (!result?.success) {
      // stale addressId / rejected in background - no false success toast.
      setters.setShowToast({
        message: renderResultError(result?.error, tSync, 'toasts.unarchiveFailed'),
        type: 'error',
      });
      return;
    }
    await setters.loadAddresses();
    await markAddressMutation();
    // Switch back to live tab
    if (setters.setArchivedSectionOpen) {
      await setters.setArchivedSectionOpen(false);
    }
    const unarchivedMsg = await t('toasts.addressUnarchived', { address: account.address });
    setters.setShowToast({
      message: unarchivedMsg,
      type: 'archived',
    });
  } catch (e) {
    logError('unarchiveAddress error:', undefined, e instanceof Error ? e : new Error(String(e)));
    setters.setShowToast({ message: await t('toasts.unarchiveFailed'), type: 'error' });
  }
}

/**
 * Restore a deleted account
 * @param ext - Browser extension API
 * @param account - Address to restore
 * @param setters - Management setter functions
 */
export async function restoreAddress(ext: Browser, account: Address, setters: ManagementSetters) {
  try {
    const result = await ext.runtime.sendMessage({ type: 'restoreAddress', addressId: account.id });
    if (!result?.success) {
      // stale addressId / rejected in background - no false success toast.
      setters.setShowToast({
        message: renderResultError(result?.error, tSync, 'toasts.restoreFailed'),
        type: 'error',
      });
      return;
    }
    await setters.loadAddresses();
    await markAddressMutation();
    // Switch back to live tab
    if (setters.setArchivedSectionOpen) {
      await setters.setArchivedSectionOpen(false);
    }
    const restoredMsg = await t('toasts.addressRestored', { address: account.address });
    setters.setShowToast({
      message: restoredMsg,
      type: 'archived',
    });
  } catch (e) {
    logError('restoreAddress error:', undefined, e instanceof Error ? e : new Error(String(e)));
    setters.setShowToast({ message: await t('toasts.restoreFailed'), type: 'error' });
  }
}

/**
 * Check if an account can be unarchived (JSON-driven via providers.jsonc ui.canUnarchive).
 * Expired non-renewable addresses cannot be unarchived (nothing to renew into).
 * Never throws - unknown/missing provider → false.
 */
export function canUnarchive(account: Address): boolean {
  const config = tryLoadProviderConfig(account.provider);
  if (!config) return false;

  const isExpired =
    typeof account.expiresAt === 'number' &&
    account.expiresAt > 0 &&
    account.expiresAt <= Date.now();
  const renewable = !!(config.expiry?.renewable || config.capabilities?.supportsRenew);
  // Expired + non-renewable: keep archived; Unarchive would be meaningless
  if (isExpired && !renewable) return false;

  const canUnarchiveRule = config.ui?.canUnarchive;
  if (canUnarchiveRule === 'ifNotExpired') {
    return !isExpired;
  }
  // Explicit true only (avoid treating random strings as allow)
  return canUnarchiveRule === true;
}

async function canRenew(providerId: string): Promise<boolean> {
  const config = loadProviderConfig(providerId);
  return (
    (config.expiry?.renewable === true || config.capabilities?.supportsRenew === true) &&
    typeof config.expiry?.renewalMethod === 'string' &&
    config.expiry.renewalMethod.length > 0
  );
}

/**
 * Extend an account's expiry time
 * @param ext - Browser extension API
 * @param account - Address to extend
 * @param setters - Management setter functions
 */
export async function extendAddress(ext: Browser, account: Address, setters: ManagementSetters) {
  try {
    if (!(await canRenew(account.provider))) {
      setters.setShowToast(await t('toasts.extendNotAvailable'), 'error');
      return;
    }

    setters.setShowToast(await t('toasts.extendingExpiry'));

    const result = await ext.runtime.sendMessage({
      type: 'renewAddress',
      addressId: account.id,
    });

    if (result.success) {
      await setters.loadAddresses();
      const successMsg = await t('toasts.expiryExtended');
      setters.setShowToast(successMsg, 'auto-renew');
    } else {
      // The background explains *why* (unsupported renewal / no token / the
      // address vanished) with an `errors.*` code; prefer it over the generic.
      setters.setShowToast(
        renderResultError(result.error, tSync, 'toasts.expiryExtendFailed'),
        'error'
      );
    }
  } catch (e) {
    logError('extendAddress error:', undefined, e instanceof Error ? e : new Error(String(e)));
    setters.setShowToast(await t('toasts.expiryExtendFailed'), 'error');
  }
}
