import { moveItemBefore } from '@/utils/array-utils.js';
import type { TranslateFn } from '@/utils/i18n/i18n-utils.js';
import { logError } from '@/utils/logger.js';
import { getAddresses, setAddresses } from '@/utils/storage/storage-keys.js';
import type { Address } from '@/utils/types.js';
import type { ConfirmDialogOptions } from '@/utils/ui/shared-ui.js';
import type { BulkActionsSetters, BulkActionsState } from './address-bulk-actions.js';
import type { ManagementSetters } from './address-management.js';

export interface AddressBulkDeps {
  ext: Browser;
  bulkActionsSetters: BulkActionsSetters;
  managementSetters: ManagementSetters;
  getSelectedAddresses: () => Set<string>;
  setSelectedAddresses: (v: Set<string>) => void;
  getMgmtAddresses: () => Address[];
  getAccounts: () => Address[];
  getAllAddresses: () => Address[];
  getSavedLogins: () => { email?: string | null }[];
  getIdentities: () => {
    name: string;
    preferredEmail?: string | null;
    email?: string | null;
  }[];
  showConfirm: (msg: string, onConfirm: () => void, opts?: ConfirmDialogOptions) => void;
  closeConfirm: () => void;
  getTranslation: TranslateFn;
  reloadAddresses: (skip?: boolean) => Promise<void>;
  removeSingleAddress: (address: string) => Promise<void>;
  /** Action functions (caller passes already-imported actions) */
  actions: {
    toggleSelectAll: (mgmt: Address[], sel: Set<string>) => Set<string>;
    toggleSelect: (sel: Set<string>, id: string) => Set<string>;
    archiveSelected: (
      ext: Browser,
      state: BulkActionsState,
      setters: BulkActionsSetters
    ) => Promise<void>;
    unarchiveSelected: (
      ext: Browser,
      state: BulkActionsState,
      setters: BulkActionsSetters
    ) => Promise<void>;
    deleteSelected: (
      ext: Browser,
      state: BulkActionsState,
      setters: BulkActionsSetters
    ) => Promise<void>;
    toggleAutoExtend: (
      ext: Browser,
      account: Address,
      setters: ManagementSetters,
      archivedRenewalDisposition?: 'unarchive' | 'keep-archived'
    ) => Promise<void>;
  };
}

export function toggleSelectAll(deps: AddressBulkDeps): void {
  deps.setSelectedAddresses(
    deps.actions.toggleSelectAll(deps.getMgmtAddresses(), deps.getSelectedAddresses())
  );
}

export function toggleSelect(deps: AddressBulkDeps, id: string): void {
  deps.setSelectedAddresses(deps.actions.toggleSelect(deps.getSelectedAddresses(), id));
}

export function archiveSelected(deps: AddressBulkDeps): Promise<void> {
  return deps.actions.archiveSelected(
    deps.ext,
    {
      selectedAddresses: deps.getSelectedAddresses(),
      accounts: deps.getAccounts(),
      allAddresses: deps.getAllAddresses(),
    },
    deps.bulkActionsSetters
  );
}

export function unarchiveSelected(deps: AddressBulkDeps): Promise<void> {
  return deps.actions.unarchiveSelected(
    deps.ext,
    {
      selectedAddresses: deps.getSelectedAddresses(),
      accounts: deps.getAccounts(),
      allAddresses: deps.getAllAddresses(),
    },
    deps.bulkActionsSetters
  );
}

export function deleteSelected(deps: AddressBulkDeps): Promise<void> {
  return deps.actions.deleteSelected(
    deps.ext,
    {
      selectedAddresses: deps.getSelectedAddresses(),
      accounts: deps.getAccounts(),
      allAddresses: deps.getAllAddresses(),
    },
    deps.bulkActionsSetters
  );
}

export async function deleteAddressesDirect(
  deps: AddressBulkDeps,
  toDelete: Address[]
): Promise<void> {
  if (!toDelete.length) return;
  if (toDelete.length === 1 && toDelete[0]) {
    await deps.removeSingleAddress(toDelete[0].address);
    return;
  }
  const addrs = new Set(toDelete.map((a) => (a.address || '').toLowerCase()));
  const loginHits = (deps.getSavedLogins() || []).filter((l) =>
    addrs.has((l.email || '').toLowerCase())
  );
  const idHits = (deps.getIdentities() || []).filter((id) => {
    const e = (id.preferredEmail || id.email || '').toLowerCase();
    return e && addrs.has(e);
  });
  const noteParts: string[] = [];
  if (loginHits.length)
    noteParts.push(deps.getTranslation('address.deleteLinkedLogins', { n: loginHits.length }));
  if (idHits.length)
    noteParts.push(
      deps.getTranslation('address.deleteLinkedIdentities', {
        n: idHits.length,
        names: idHits.map((i) => i.name).join(', '),
      })
    );

  deps.showConfirm(
    deps.getTranslation('address.deleteMultiBody', { n: toDelete.length }),
    async () => {
      deps.closeConfirm();
      const ids = new Set(toDelete.map((a) => a.id));
      deps.setSelectedAddresses(ids);
      await deps.actions.deleteSelected(
        deps.ext,
        {
          selectedAddresses: ids,
          accounts: deps.getAccounts(),
          allAddresses: deps.getAllAddresses(),
        },
        deps.bulkActionsSetters
      );
    },
    {
      title: deps.getTranslation('address.deleteConfirmTitle'),
      confirmLabel: deps.getTranslation('address.deletePermanently'),
      note: noteParts.length
        ? noteParts.join(' · ')
        : deps.getTranslation('address.deleteConfirmNote'),
      destructive: true,
    }
  );
}

export function toggleAutoExtend(
  deps: AddressBulkDeps,
  account: Address,
  archivedRenewalDisposition?: 'unarchive' | 'keep-archived'
): Promise<void> {
  return deps.actions.toggleAutoExtend(
    deps.ext,
    account,
    deps.managementSetters,
    archivedRenewalDisposition
  );
}

export async function reorderAddressesById(
  deps: Pick<AddressBulkDeps, 'reloadAddresses'>,
  sourceId: string,
  targetId: string
): Promise<void> {
  if (!sourceId || !targetId || sourceId === targetId) return;
  try {
    const addresses = await getAddresses();
    const fromIndex = addresses.findIndex((a) => a.id === sourceId);
    const toIndex = addresses.findIndex((a) => a.id === targetId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
    const reordered = moveItemBefore(addresses, fromIndex, toIndex);
    if (!reordered) return;
    await setAddresses(reordered);
    await deps.reloadAddresses(true);
  } catch (error) {
    logError('Failed to reorder accounts', error);
  }
}
