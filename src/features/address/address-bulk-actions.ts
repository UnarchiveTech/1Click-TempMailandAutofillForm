import { pluralKey } from '@/utils/i18n/i18n-plural.js';
import { t } from '@/utils/i18n/i18n-utils.js';
import { logError } from '@/utils/logger.js';
import { withAddressLock } from '@/utils/mutex.js';
import { getAddresses, setAddresses } from '@/utils/storage/storage-keys.js';
import {
  captureStorageSnapshot,
  restoreStorageSnapshot,
} from '@/utils/storage/storage-snapshot.js';
import type { Address } from '@/utils/types.js';
import type { ConfirmDialogOptions } from '@/utils/ui/shared-ui.js';
import { canUnarchive } from './address-management.js';
import { isUndoCurrent, markAddressMutation } from './undo-generation.js';

export interface BulkActionsState {
  selectedAddresses: Set<string>;
  accounts: Address[];
  allAddresses: Address[];
}

export interface BulkActionsSetters {
  setSelectedAddresses: (addresses: Set<string>) => void;
  setShowToast: (
    message: string,
    type?: 'success' | 'error' | 'warning',
    undoAction?: (() => void | Promise<void>) | null
  ) => void;
  loadAddresses: () => Promise<void>;
  showConfirm: (message: string, onConfirm: () => void, options?: ConfirmDialogOptions) => void;
  closeConfirm: () => void;
}

export function toggleSelectAll(
  mgmtAddresses: Address[],
  selectedAddresses: Set<string>
): Set<string> {
  const allSelected =
    mgmtAddresses.length > 0 && mgmtAddresses.every((a) => selectedAddresses.has(a.id));
  if (allSelected) return new Set();
  return new Set(mgmtAddresses.map((a) => a.id));
}

export function toggleSelect(selectedAddresses: Set<string>, id: string): Set<string> {
  const next = new Set(selectedAddresses);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export async function archiveSelected(
  _ext: Browser,
  state: BulkActionsState,
  setters: BulkActionsSetters
) {
  try {
    const selectedIds = new Set(state.selectedAddresses);
    let archivedAddresses: Address[] = [];
    await withAddressLock(async () => {
      const addresses = await getAddresses();
      archivedAddresses = addresses.filter((i: Address) => selectedIds.has(i.id));
      if (archivedAddresses.length === 0) return;
      const updated = addresses.map((i) =>
        selectedIds.has(i.id)
          ? {
              ...i,
              accountStatus: 'archived' as const,
              archiveReason: 'manual' as const,
              archivedAt: Math.max(Date.now(), (i.archivedAt ?? 0) + 1),
              autoExtend: false,
              unarchiveAfterRenewal: undefined,
            }
          : i
      );
      await setAddresses(updated);
    });

    if (archivedAddresses.length === 0) {
      setters.setSelectedAddresses(new Set());
      setters.setShowToast(await t('toasts.archiveFailed'), 'error');
      return;
    }

    await setters.loadAddresses();
    const archivedCount = archivedAddresses.length;
    // The archive landed: an undo offered before it (e.g. a delete undo whose
    // snapshot still holds these inboxes as active) is stale from here on.
    const revision = await markAddressMutation();
    setters.setSelectedAddresses(new Set());
    setters.setShowToast(
      await t(
        pluralKey(
          {
            oneKey: 'toasts.emailsArchivedCount',
            otherKey: 'toasts.emailsArchivedCountPlural',
          },
          archivedCount
        ),
        { n: archivedCount }
      ),
      'success',
      async () => {
        // A newer delete / archive / restore landed while this toast was on
        // screen: this undo re-derives active status from a pre-archive list,
        // so running it would walk that newer work back.
        if (!(await isUndoCurrent(revision))) {
          setters.setShowToast(await t('toasts.undoSuperseded'), 'warning');
          return;
        }
        // Undo: restore archived addresses
        const previousStatuses = new Map(
          archivedAddresses.map((address) => [address.id, address.accountStatus])
        );
        const previousArchiveReasons = new Map(
          archivedAddresses.map((address) => [address.id, address.archiveReason])
        );
        const previousArchivedAt = new Map(
          archivedAddresses.map((address) => [address.id, address.archivedAt])
        );
        const previousAutoExtend = new Map(
          archivedAddresses.map((address) => [address.id, address.autoExtend])
        );
        const previousRenewalState = new Map(
          archivedAddresses.map((address) => [
            address.id,
            {
              renewalFailCount: address.renewalFailCount,
              lastFailureAt: address.lastFailureAt,
              nextRetryAt: address.nextRetryAt,
            },
          ])
        );
        await withAddressLock(async () => {
          const currentAddresses = await getAddresses();
          const restored = currentAddresses.map((i: Address) => {
            if (!previousStatuses.has(i.id)) return i;
            const previousStatus = previousStatuses.get(i.id);
            const address = { ...i };
            if (previousStatus === undefined) delete address.accountStatus;
            else address.accountStatus = previousStatus;
            const previousArchiveReason = previousArchiveReasons.get(i.id);
            if (previousArchiveReason === undefined) delete address.archiveReason;
            else address.archiveReason = previousArchiveReason;
            const previousAt = previousArchivedAt.get(i.id);
            if (previousAt === undefined) delete address.archivedAt;
            else address.archivedAt = previousAt;
            const previousRenewal = previousRenewalState.get(i.id);
            if (previousRenewal) Object.assign(address, previousRenewal);
            const priorAutoExtend = previousAutoExtend.get(i.id);
            if (priorAutoExtend === undefined) delete address.autoExtend;
            else address.autoExtend = priorAutoExtend;
            return address;
          });
          await setAddresses(restored);
        });
        await setters.loadAddresses();
        setters.setShowToast(await t('toasts.archiveUndone'));
      }
    );
  } catch (e) {
    logError('Bulk archiving of selected addresses failed', e);
    setters.setShowToast(await t('toasts.archiveFailed'), 'error');
  }
}

export async function unarchiveSelected(
  _ext: Browser,
  state: BulkActionsState,
  setters: BulkActionsSetters
) {
  try {
    const count = state.selectedAddresses.size;
    let actualUnarchivedCount = 0;
    let showUnarchiveFailed = false;
    let showWarning = false;
    let warningCount = 0;

    await withAddressLock(async () => {
      const addresses = await getAddresses();

      // Filter out expired emails that cannot be unarchived
      const canUnarchiveIds = new Set<string>();
      for (const id of state.selectedAddresses) {
        const record = addresses.find((i) => i.id === id);
        if (record && canUnarchive(record)) {
          canUnarchiveIds.add(id);
        }
      }

      if (canUnarchiveIds.size === 0) {
        showUnarchiveFailed = true;
        return;
      }

      if (canUnarchiveIds.size < state.selectedAddresses.size) {
        showWarning = true;
        warningCount = canUnarchiveIds.size;
      }

      const updated = addresses.map((i) =>
        canUnarchiveIds.has(i.id) ? { ...i, accountStatus: 'active' as const } : i
      );
      await setAddresses(updated);
      actualUnarchivedCount = canUnarchiveIds.size;
    });

    if (showUnarchiveFailed) {
      setters.setShowToast(await t('toasts.noEmailsCanBeUnarchived'), 'error');
      return;
    }

    if (showWarning) {
      setters.setShowToast(
        await t(
          pluralKey(
            {
              oneKey: 'toasts.someEmailsCanBeUnarchived',
              otherKey: 'toasts.someEmailsCanBeUnarchivedPlural',
            },
            count
          ),
          { n: count, unarchivedCount: warningCount }
        ),
        'warning'
      );
    }

    if (actualUnarchivedCount > 0) {
      await setters.loadAddresses();
      await markAddressMutation();
      setters.setSelectedAddresses(new Set());
      setters.setShowToast(
        await t(
          pluralKey(
            {
              oneKey: 'toasts.emailsUnarchivedCount',
              otherKey: 'toasts.emailsUnarchivedCountPlural',
            },
            actualUnarchivedCount
          ),
          { n: actualUnarchivedCount }
        ),
        'success'
      );
    }
  } catch (e) {
    logError('Bulk unarchiving of selected addresses failed', e);
    setters.setShowToast(await t('toasts.unarchiveFailed'), 'error');
  }
}

export async function deleteSelected(
  ext: Browser,
  state: BulkActionsState,
  setters: BulkActionsSetters
) {
  const count = state.selectedAddresses.size;
  const confirmMsg = await t(
    pluralKey(
      {
        oneKey: 'toasts.deleteConfirmMessage',
        otherKey: 'toasts.deleteConfirmMessagePlural',
      },
      count
    ),
    { n: count }
  );
  setters.showConfirm(
    confirmMsg,
    async () => {
      try {
        const storageSnapshot = await captureStorageSnapshot(ext);
        // Transactional delete: attempt every selected id, collect per-id
        // results so a mid-loop failure doesn't leave a half-deleted state with
        // no undo path for the ones that actually succeeded.
        const totalCount = state.selectedAddresses.size;
        // One batched round-trip: the background deletes every id under a single
        // address/email-storage lock pass and reports per-address outcomes, so N
        // selected inboxes no longer perform N full-list read-modify-writes.
        const result = (await ext.runtime.sendMessage({
          type: 'deleteAddresses',
          addressIds: [...state.selectedAddresses],
          preserveEmails: false,
        })) as { results?: Array<{ addressId?: string; success?: boolean }> } | undefined;
        const succeededIds = Array.isArray(result?.results)
          ? result.results
              .filter((r) => r?.success && typeof r.addressId === 'string')
              .map((r) => r.addressId as string)
          : [];
        const failedCount = totalCount - succeededIds.length;
        // Only the addresses actually deleted server-side are eligible for undo.
        const deletedAddresses = (storageSnapshot.addresses || []).filter((record) =>
          succeededIds.includes(record.id)
        );
        await setters.loadAddresses();

        if (succeededIds.length === 0) {
          setters.setShowToast(await t('toasts.deleteFailed'), 'error');
          return;
        }
        // The delete landed, so this undo describes the newest lifecycle state -
        // and every undo offered before it stops being able to overwrite it.
        const revision = await markAddressMutation();
        setters.setShowToast(
          await t(
            pluralKey(
              {
                oneKey: 'toasts.addressesDeletedCount',
                otherKey: 'toasts.addressesDeletedCountPlural',
              },
              succeededIds.length
            ),
            { n: succeededIds.length }
          ),
          'success',
          async () => {
            // A newer delete / archive / restore landed while this toast was on
            // screen: this undo restores a pre-delete snapshot of the mailbox
            // surface, so running it would walk that newer work back.
            if (!(await isUndoCurrent(revision))) {
              setters.setShowToast(await t('toasts.undoSuperseded'), 'warning');
              return;
            }
            await restoreStorageSnapshot(ext, storageSnapshot, deletedAddresses);
            await setters.loadAddresses();
            setters.setShowToast(await t('toasts.deleteUndone'));
          }
        );
        setters.setSelectedAddresses(new Set());
        setters.closeConfirm();

        if (failedCount > 0) {
          setters.setShowToast(
            await t('toasts.deletePartialFailed', { failed: failedCount, total: totalCount }),
            'warning'
          );
        }
      } catch (e) {
        logError('Bulk deletion of selected addresses failed', e);
        setters.setShowToast(await t('toasts.deleteFailed'), 'error');
      }
    },
    { destructive: true }
  );
}

export async function exportSelected(
  allAddresses: Address[],
  selectedAddresses: Set<string>,
  exportAddressEmails: (account: Address | Address[]) => Promise<void>
) {
  // Resolve from the full inbox list (not active-only `accounts`) so selections
  // made in the Inactive tab (archived/deleted accounts) are exportable too -
  // mirroring archiveSelected/deleteSelected, which also resolve from allAddresses.
  const selectedList = allAddresses.filter((a) => selectedAddresses.has(a.id));
  if (selectedList.length === 1) {
    await exportAddressEmails(selectedList[0]);
  } else if (selectedList.length > 1) {
    await exportAddressEmails(selectedList);
  }
}
