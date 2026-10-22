import type { View } from '@/features/types/view-types.js';
import type { TranslateFn } from '@/utils/i18n/i18n-utils.js';
import type { Address, Email } from '@/utils/types.js';
import type { ConfirmDialogOptions } from '@/utils/ui/shared-ui.js';
// Static import (not `await import()`): this module is already statically
// imported by AppLayout / AddressesView / AddressCard / MailboxView, so a
// dynamic import here cannot defer loading - it only emits an
// INEFFECTIVE_DYNAMIC_IMPORT build warning.
import {
  archiveAddress,
  extendAddress,
  type ManagementSetters,
  removeAddress,
  restoreAddress,
  unarchiveAddress,
} from './address-management.js';

export interface AddressLifecycleDeps {
  ext: Browser;
  allAddresses: Address[];
  accounts: Address[];
  savedLogins: { email?: string | null }[];
  identities: { name: string; preferredEmail?: string | null; email?: string | null }[];
  managementSetters: ManagementSetters;
  selectedEmail: string;
  emails: Email[];
  loading: boolean;
  /** Show a confirmation dialog */
  showConfirm: (message: string, onConfirm: () => void, options?: ConfirmDialogOptions) => void;
  closeConfirm: () => void;
  getTranslation: TranslateFn;
  /** Notify that addresses whose ID is in this set were deleted */
  clearDetailIfAddressDeleted: (deletedAddresses: Set<string>) => void;
  /** Current view */
  getCurrentView: () => View;
  setCurrentView: (view: View) => void;
  /** Account detail being viewed */
  setCurrentEmailDetail: (detail: Address | null) => void;
  /** Management tab */
  setMgmtTab: (tab: string) => void;
}

export async function removeSingleAddress(
  deps: AddressLifecycleDeps,
  address: string
): Promise<void> {
  const {
    ext,
    allAddresses,
    savedLogins,
    identities,
    showConfirm,
    closeConfirm,
    getTranslation,
    managementSetters,
    selectedEmail,
    emails,
    loading,
    getCurrentView,
    setCurrentView,
    setCurrentEmailDetail,
    setMgmtTab,
    clearDetailIfAddressDeleted,
  } = deps;

  const account = allAddresses.find((a) => a.address === address);
  if (!account) return;

  const addrLower = account.address.toLowerCase();
  const linkedLogins = (savedLogins || []).filter(
    (l) => (l.email || '').toLowerCase() === addrLower
  );
  const linkedIdentities = (identities || []).filter(
    (id) =>
      (id.preferredEmail || '').toLowerCase() === addrLower || id.email?.toLowerCase() === addrLower
  );
  const impactParts: string[] = [];
  if (linkedLogins.length) {
    impactParts.push(getTranslation('address.deleteLinkedLogins', { n: linkedLogins.length }));
  }
  if (linkedIdentities.length) {
    impactParts.push(
      getTranslation('address.deleteLinkedIdentities', {
        n: linkedIdentities.length,
        names: linkedIdentities.map((i) => i.name).join(', '),
      })
    );
  }
  const wasInactive =
    account.accountStatus === 'archived' ||
    account.accountStatus === 'deleted' ||
    (account.status as string) === 'archived' ||
    (account.status as string) === 'deleted' ||
    (account.expiresAt > 0 && account.expiresAt <= Date.now());
  const returnToAddresses = getCurrentView() === 'addressView';

  const doDelete = async () => {
    closeConfirm();
    await removeAddress(ext, account, { selectedEmail, emails, loading }, managementSetters);
    clearDetailIfAddressDeleted(new Set([address.toLowerCase()]));
    if (returnToAddresses) {
      // These are side-effect signals that the caller handles
      setCurrentEmailDetail(null);
      setMgmtTab(wasInactive ? 'inactive' : 'active');
      setCurrentView('addresses');
    }
  };

  const doArchive = async () => {
    closeConfirm();
    await archiveAddress(
      ext,
      account,
      deps.accounts,
      { selectedEmail, emails, loading },
      managementSetters
    );
    if (returnToAddresses) {
      setCurrentEmailDetail(null);
      setMgmtTab('inactive');
      setCurrentView('addresses');
    }
  };

  showConfirm(getTranslation('address.deleteConfirmBody', { address: account.address }), doDelete, {
    title: getTranslation('address.deleteConfirmTitle'),
    confirmLabel: getTranslation('address.deletePermanently'),
    secondaryLabel:
      account.accountStatus !== 'archived' ? getTranslation('address.archiveInstead') : undefined,
    onSecondary: account.accountStatus !== 'archived' ? doArchive : undefined,
    note:
      impactParts.length > 0
        ? impactParts.join(' · ')
        : getTranslation('address.deleteConfirmNote'),
    destructive: true,
  });
}

export async function restoreSingleAddress(
  ext: Browser,
  allAddresses: Address[],
  address: string,
  managementSetters: ManagementSetters
): Promise<void> {
  const account = allAddresses.find((a) => a.address === address);
  if (!account) return;
  await restoreAddress(ext, account, managementSetters);
}

export async function archiveSingleAddress(
  ext: Browser,
  account: Address,
  deps: Pick<
    AddressLifecycleDeps,
    | 'accounts'
    | 'selectedEmail'
    | 'emails'
    | 'loading'
    | 'managementSetters'
    | 'showConfirm'
    | 'closeConfirm'
    | 'getTranslation'
    | 'allAddresses'
  >
): Promise<void> {
  if (account.accountStatus === 'deleted') {
    deps.showConfirm(
      deps.getTranslation('toasts.accountDeletedArchivePrompt', { address: account.address }),
      async () => {
        deps.closeConfirm();
        await restoreAddress(ext, account, deps.managementSetters);
        await archiveAddress(
          ext,
          account,
          deps.accounts,
          { selectedEmail: deps.selectedEmail, emails: deps.emails, loading: deps.loading },
          deps.managementSetters
        );
      }
    );
    return;
  }
  await archiveAddress(
    ext,
    account,
    deps.accounts,
    { selectedEmail: deps.selectedEmail, emails: deps.emails, loading: deps.loading },
    deps.managementSetters
  );
}

export async function unarchiveSingleAddress(
  ext: Browser,
  account: Address,
  managementSetters: ManagementSetters
): Promise<void> {
  await unarchiveAddress(ext, account, managementSetters);
}

export async function extendSingleAddress(
  ext: Browser,
  account: Address,
  managementSetters: ManagementSetters
): Promise<void> {
  await extendAddress(ext, account, managementSetters);
}
