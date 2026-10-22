import { writeWithRetry } from '@/utils/storage/storage-write.js';
import type { Address, Email } from '@/utils/types.js';

export interface AddressDetailOperationsDeps {
  ext: Browser;
  getCurrentEmailDetail: () => Address | null;
  getSelectedEmail: () => string;
  getAllAddresses: () => Address[];
  getEmails: () => Email[];
  getLayoutSplit: () => boolean;
  getLayoutVerticalSplit: () => boolean;
  getCurrentView: () => string;
  setCurrentEmailDetail: (value: Address | null) => void;
  setSelectedEmail: (value: string) => void;
  setDisplayedEmail: (value: string) => void;
  setCurrentView: (value: string) => void;
  setLoading: (value: boolean) => void;
  selectAddress: (address: string) => Promise<void>;
  checkMessages: (addressId: string) => Promise<void>;
  loadAddresses: (skipEmailSelection?: boolean) => Promise<void>;
  expandSplitPane: () => void;
  unarchiveAddress: (account: Address) => Promise<void>;
  toggleAutoExtend: (account: Address) => Promise<void>;
  extendAddress: (account: Address) => Promise<void>;
}

export interface AddressDetailOperationsController {
  openAddressView: (account: Address) => Promise<void>;
  refreshCurrentAddressMessages: () => Promise<void>;
  handleAddressDomainChanged: (address: string) => Promise<void>;
  navigateFromAddressToMailbox: () => Promise<void>;
  handleAddressUnarchive: (account: Address) => Promise<void>;
  handleAddressAutoExtend: (account: Address) => Promise<void>;
  handleAddressExtend: (account: Address) => Promise<void>;
}

export function createAddressDetailOperations(
  deps: AddressDetailOperationsDeps
): AddressDetailOperationsController {
  const isSplit = () => deps.getLayoutSplit() || deps.getLayoutVerticalSplit();

  const reloadDetail = async (account: Address) => {
    await deps.loadAddresses(true);
    const updated = deps.getAllAddresses().find((candidate) => candidate.id === account.id);
    if (updated) deps.setCurrentEmailDetail(updated);
  };

  return {
    openAddressView: async (account) => {
      deps.setCurrentEmailDetail(account);
      deps.expandSplitPane();
      if (account.address && account.address !== deps.getSelectedEmail()) {
        await deps.selectAddress(account.address);
      }
      deps.setCurrentView(isSplit() ? 'addresses' : 'addressView');
      deps.setLoading(true);
      try {
        await deps.checkMessages(account.id);
      } finally {
        deps.setLoading(false);
      }
    },

    refreshCurrentAddressMessages: async () => {
      const detail = deps.getCurrentEmailDetail();
      if (!detail) return;
      deps.setLoading(true);
      try {
        await deps.checkMessages(detail.id);
      } finally {
        deps.setLoading(false);
      }
    },

    handleAddressDomainChanged: async (address) => {
      const detail = deps.getCurrentEmailDetail();
      if (detail) deps.setCurrentEmailDetail({ ...detail, address });
      deps.setSelectedEmail(address);
      deps.setDisplayedEmail(address);
      await deps.loadAddresses(true);
      const updated = detail
        ? deps.getAllAddresses().find((candidate) => candidate.id === detail.id)
        : undefined;
      if (updated) deps.setCurrentEmailDetail(updated);
      try {
        await writeWithRetry({ activeAddressId: updated?.id ?? detail?.id });
      } catch {
        /* ignore */
      }
    },

    navigateFromAddressToMailbox: async () => {
      const detail = deps.getCurrentEmailDetail();
      if (detail?.address) await deps.selectAddress(detail.address);
      deps.setCurrentEmailDetail(null);
      deps.setCurrentView('mailbox');
    },

    handleAddressUnarchive: async (account) => {
      await deps.unarchiveAddress(account);
      await reloadDetail(account);
    },

    handleAddressAutoExtend: async (account) => {
      await deps.toggleAutoExtend(account);
      await reloadDetail(account);
    },

    handleAddressExtend: async (account) => {
      await deps.extendAddress(account);
      await reloadDetail(account);
    },
  };
}
