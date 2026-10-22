import type { Address, Email } from '@/utils/types.js';

export type ScrollDirection = 'up' | 'down';

/**
 * Props consumed by AddressesListPane (lazy shell for AddressesView) and
 * re-declared by AddressesSplitView (split-layout host). Single source of
 * truth - never re-declare these inline in either component, or a prop
 * rename can silently drift between the two.
 */
export type AddressListPaneProps = {
  onBack: () => void;
  mgmtTab: string;
  mgmtSearch: string;
  selectedAddresses: Set<string>;
  mgmtAddresses: Address[];
  allAddresses: Address[];
  allSelected: boolean;
  loadingAddresses: boolean;
  storedEmails: Record<string, Email[]>;
  preExpiryWindowMinutes: number;
  onTabChange: (tab: string) => void;
  onSearchChange: (value: string) => void;
  onScrollDirection: (direction: ScrollDirection, atTop?: boolean) => void;
  onToggleSelectAll: () => void;
  onToggleSelect: (id: string) => void;
  onArchiveSelected: () => void | Promise<void>;
  onUnarchiveSelected: () => void | Promise<void>;
  onDeleteSelected: () => void | Promise<void>;
  onExportSelected: () => void | Promise<void>;
  onMarkSelectedRead: () => void | Promise<void>;
  onMarkSelectedUnread: () => void | Promise<void>;
  onTagSelected: () => void;
  onOpenAddressView: (account: Address) => void | Promise<void>;
  onArchiveAddress: (account: Address) => void | Promise<void>;
  onUnarchiveAddress: (account: Address) => void | Promise<void>;
  onDeleteAddresses: (accounts: Address[]) => void | Promise<void>;
  onArchiveAddresses: (accounts: Address[]) => void | Promise<void>;
  onUnarchiveAddresses: (accounts: Address[]) => void | Promise<void>;
  onRenewAddresses: (accounts: Address[]) => void | Promise<void>;
  onExportAddressEmails: (account: Address) => void | Promise<void>;
  onGenerateNewAddress: () => void;
  onEditAddress: (account: Address) => void | Promise<void>;
  onExtendAddress: (account: Address) => void | Promise<void>;
  onToggleAutoExtend: (account: Address) => void | Promise<void>;
  onTagAddress: (account: Address) => void;
  onMarkAddressAllRead: (account: Address) => void | Promise<void>;
  onMarkAddressAllUnread: (account: Address) => void | Promise<void>;
  onReorderAddresses: (sourceId: string, targetId: string) => void | Promise<void>;
  highlightAddress: string | null;
};
